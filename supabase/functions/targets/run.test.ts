// Pins one run of the analyst-target job (run.ts) against the in-memory database and a fake Yahoo / Alpha Vantage: when it
// runs and when it leaves the slot alone, what it writes, a Yahoo outage that keeps the slot owed, the day's Alpha Vantage
// cache, and the page's read.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { memDb, type Row } from "../agents/testing.ts";
import { AV_CACHE_MS, CLAIM_MS, readTargets, RUN_BUDGET_MS, runTargets, TARGETS_STATE, TARGETS_TABLE } from "./run.ts";

const NOW = Date.parse("2026-10-21T13:30:20Z");   // 09:30 ET on a trading day, 20 s into the slot
const SLOT = "2026-10-21T13:30:00.000Z";

const qs = (o: { price: number; mean?: number; low?: number; high?: number; n?: number; currency?: string; holdings?: Array<[string, number]> }) => ({
  quoteSummary: { result: [{
    price: { currency: o.currency ?? "USD", regularMarketPrice: { raw: o.price } },
    financialData: o.mean === undefined ? {} : { currentPrice: { raw: o.price }, targetMeanPrice: { raw: o.mean }, targetLowPrice: { raw: o.low }, targetHighPrice: { raw: o.high }, numberOfAnalystOpinions: { raw: o.n }, recommendationMean: { raw: 2 } },
    upgradeDowngradeHistory: { history: [] },
    topHoldings: { holdings: (o.holdings ?? []).map(([symbol, w]) => ({ symbol, holdingPercent: { raw: w } })) },
  }] },
});
const YAHOO: Record<string, unknown> = {
  AAPL: qs({ price: 200, mean: 240, low: 180, high: 300, n: 40 }),
  "VUAA.L": qs({ price: 100, holdings: [["AAPL", 0.07], ["MSFT", 0.06]] }),
  MSFT: qs({ price: 400, mean: 500, low: 400, high: 600, n: 50 }),
  "SAEM.L": qs({ price: 10, holdings: [["005930.KQ", 0.04]] }),
  "005930.KS": qs({ price: 50_000, mean: 60_000, low: 50_000, high: 70_000, n: 30, currency: "KRW" }),
};

function fakeFetch(opts: { down?: boolean; av?: Array<[string, string]> } = {}) {
  const calls: string[] = [];
  const f = ((input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("alphavantage")) {
      return Promise.resolve(new Response(JSON.stringify({ holdings: (opts.av ?? []).map(([symbol, weight]) => ({ symbol, weight })) })));
    }
    const sym = decodeURIComponent(url.split("/quoteSummary/")[1].split("?")[0]);
    if (opts.down || !(sym in YAHOO)) return Promise.resolve(new Response("{}", { status: 404 }));
    return Promise.resolve(new Response(JSON.stringify(YAHOO[sym])));
  }) as typeof fetch;
  return { f, calls };
}

const board = (tickers: string[]) => ({ id: 1, data: { holdings: Object.fromEntries([...tickers.map((t) => [t, { currency: "USD" }]), ["CASH", { isCash: true }]]) } });
const seed = (state: Row = {}) => ({
  board_data: [board(["AAPL", "VUAA.L", "SAEM.L", "BTC-USD", "017731"])],
  [TARGETS_STATE]: [{ id: 1, last_slot: "2026-10-21T08:00:00.000Z", claimed_slot: null, claimed_at: null, cache: {}, updated_at: null, last_error: null, ...state }],
  [TARGETS_TABLE]: [] as Row[],
});
const crumb = () => Promise.resolve({ crumb: "c", cookie: "k" });

Deno.test("a due slot: every holding's snapshot written under it, the slot done, the claim cleared", async () => {
  const { db } = memDb(seed(), { now: () => NOW });
  const { f, calls } = fakeFetch();
  const r = await runTargets({ db, now: NOW, fetchImpl: f, crumb });
  assertEquals(r, { slot: SLOT, written: 4, covered: ["AAPL", "BTC-USD", "SAEM.L", "VUAA.L"], uncovered: ["017731"], errors: [] });
  const rows = await db.select<{ ticker: string; slot: string; payload: any }>(TARGETS_TABLE, "select=*&order=ticker.asc");
  assertEquals(rows.map((x) => [x.ticker, x.slot, x.payload.kind]), [
    ["AAPL", SLOT, "consensus"], ["BTC-USD", SLOT, "strategist"], ["SAEM.L", SLOT, "holdings"], ["VUAA.L", SLOT, "holdings"],
  ]);
  // VUAA: AAPL 1.2× / 0.9× / 1.5× at 7 %, MSFT 1.25× / 1.0× / 1.5× at 6 %, on 100:
  //   mean 100 × (0.084 + 0.075) / 0.13 = 122.3077; low 100 × (0.063 + 0.06) / 0.13 = 94.6154; high 150.
  const vuaa = rows.find((x) => x.ticker === "VUAA.L")!.payload;
  assertEquals([vuaa.mean, vuaa.low, vuaa.high, vuaa.analysts, vuaa.coverage.weight], [122.3077, 94.6154, 150, 45, 0.13]);
  // SAEM: Samsung asked as .KQ (nothing), then .KS: 1.2× on 10.
  const saem = rows.find((x) => x.ticker === "SAEM.L")!.payload;
  assertEquals([saem.mean, saem.low, saem.high, saem.coverage.names], [12, 10, 14, 1]);
  assertEquals(calls.filter((u) => u.includes("005930")).length, 2);
  // Bitcoin and the CN fund ask Yahoo nothing; no Alpha Vantage key, no Alpha Vantage call.
  assertEquals(calls.some((u) => u.includes("BTC-USD") || u.includes("017731") || u.includes("alphavantage")), false);
  const st = (await db.select<Row>(TARGETS_STATE, "id=eq.1&select=*"))[0];
  assertEquals([st.last_slot, st.claimed_slot, st.claimed_at, st.last_error], [SLOT, null, null, null]);
  // The page's read: every row with its slot, and when the run was.
  const read = await readTargets(db) as { slot: string; asOf: string; rows: Record<string, any> };
  assertEquals([read.slot, read.asOf, Object.keys(read.rows)], [SLOT, new Date(NOW).toISOString(), ["AAPL", "BTC-USD", "SAEM.L", "VUAA.L"]]);
  assertEquals([read.rows.AAPL.mean, read.rows.AAPL.slot], [240, SLOT]);
});

Deno.test("no slot due: nothing read, nothing written", async () => {
  const { db } = memDb(seed({ last_slot: SLOT }), { now: () => NOW });
  const { f, calls } = fakeFetch();
  assertEquals(await runTargets({ db, now: NOW, fetchImpl: f, crumb }), { skipped: "no slot due", errors: [] });
  assertEquals(calls.length, 0);
});

Deno.test("a slot claimed by a run still working is left alone; a claim older than CLAIM_MS is taken over", async () => {
  const live = new Date(NOW - 10_000).toISOString();
  const a = memDb(seed({ claimed_slot: SLOT, claimed_at: live }), { now: () => NOW });
  const fa = fakeFetch();
  assertEquals(await runTargets({ db: a.db, now: NOW, fetchImpl: fa.f, crumb }), { skipped: "running", slot: SLOT, errors: [] });
  assertEquals(fa.calls.length, 0);
  const dead = new Date(NOW - CLAIM_MS - 1000).toISOString();
  const b = memDb(seed({ claimed_slot: SLOT, claimed_at: dead }), { now: () => NOW });
  assertEquals((await runTargets({ db: b.db, now: NOW, fetchImpl: fakeFetch().f, crumb })).written, 4);
  // Another slot's claim (a run that died at 04:00) does not hold this one.
  const c = memDb(seed({ claimed_slot: "2026-10-21T08:00:00.000Z", claimed_at: live }), { now: () => NOW });
  assertEquals((await runTargets({ db: c.db, now: NOW, fetchImpl: fakeFetch().f, crumb })).written, 4);
});

Deno.test("Yahoo down: bitcoin's table is still written, but a run with no crumb says so; no data at all keeps the slot owed", async () => {
  const { db } = memDb(seed(), { now: () => NOW });
  const r = await runTargets({ db, now: NOW, fetchImpl: fakeFetch({ down: true }).f, crumb: () => Promise.resolve(null) });
  assertEquals([r.written, r.covered, r.errors], [1, ["BTC-USD"], ["yahoo: no crumb"]]);
  // A board without bitcoin and Yahoo answering nothing: nothing written, the slot not marked done, the claim released.
  const s = seed();
  s.board_data = [board(["AAPL"])];
  s[TARGETS_TABLE] = [{ ticker: "AAPL", slot: "2026-10-20T20:00:00.000Z", as_of: "2026-10-20T20:00:30.000Z", payload: { ticker: "AAPL", mean: 230 } }];
  const m = memDb(s, { now: () => NOW });
  const r2 = await runTargets({ db: m.db, now: NOW, fetchImpl: fakeFetch({ down: true }).f, crumb });
  assertEquals([r2.written, r2.uncovered], [0, ["AAPL"]]);
  const st = (await m.db.select<Row>(TARGETS_STATE, "id=eq.1&select=*"))[0];
  assertEquals([st.last_slot, st.claimed_slot], ["2026-10-21T08:00:00.000Z", null]);
  // The last good snapshot stays for the page.
  assertEquals((await m.db.select<{ payload: any }>(TARGETS_TABLE, "select=payload"))[0].payload.mean, 230);
});

Deno.test("Alpha Vantage: VUAA's constituents from SPY's full list when it is longer, read once a day", async () => {
  const { db } = memDb(seed(), { now: () => NOW });
  const av: Array<[string, string]> = [["AAPL", "0.07"], ["MSFT", "0.06"], ["NVDA", "0.065"]];
  const one = fakeFetch({ av });
  await runTargets({ db, now: NOW, fetchImpl: one.f, crumb, avKey: "test-key" });
  assertEquals(one.calls.filter((u) => u.includes("alphavantage")).length, 1);
  const vuaa = (await db.select<{ payload: any }>(TARGETS_TABLE, "ticker=eq.VUAA.L&select=payload"))[0].payload;
  // NVDA has no data in the fake: covered 13 % of 19.5 %, 2 of 3 names; the source names Alpha Vantage.
  assertEquals([vuaa.coverage.weight, vuaa.coverage.names, vuaa.coverage.source.includes("Alpha Vantage")], [0.13, 2, true]);
  // The next slot, the same day: the cached list, no second call.
  const LATER = Date.parse("2026-10-21T20:00:10Z");
  const two = fakeFetch({ av });
  await runTargets({ db, now: LATER, fetchImpl: two.f, crumb, avKey: "test-key" });
  assertEquals(two.calls.filter((u) => u.includes("alphavantage")).length, 0);
  // A day on, it is read again.
  const NEXT = NOW + AV_CACHE_MS + 60_000;
  const three = fakeFetch({ av });
  await runTargets({ db, now: NEXT, fetchImpl: three.f, crumb, avKey: "test-key" });
  assertEquals(three.calls.filter((u) => u.includes("alphavantage")).length, 1);
});

Deno.test("the run's budget: past RUN_BUDGET_MS no request starts, what was read is written, and the run says so", async () => {
  const { db } = memDb(seed(), { now: () => NOW });
  let t = 0;
  const { f, calls } = fakeFetch();
  // Each request takes the clock past the budget: the first is answered, nothing after it starts.
  const slow = ((u: string) => { t += RUN_BUDGET_MS; return f(u); }) as typeof fetch;
  const r = await runTargets({ db, now: NOW, fetchImpl: slow, crumb, clock: () => t });
  assertEquals([calls.length, r.covered, r.errors], [1, ["AAPL", "BTC-USD"], [`budget: stopped after ${RUN_BUDGET_MS / 1000} s`]]);
});
