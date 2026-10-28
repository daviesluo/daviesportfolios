// Pins the live read of the hand-kept tables (hand.ts; Davies, 2026-10-21): each file checked whole and refused whole on
// any fault, the branch head asked for at most every five minutes and the files read at that commit, the fallbacks when
// GitHub's API or the network refuses, a failure reported once, and the job rebuilding the bitcoin and VUAA rows and the
// GET serving the risks when the branch moves.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { memDb } from "../agents/testing.ts";
import { checkHand, EMPTY_HAND, HAND_CHECK_MS, headFromRefAdvertisement, validateHandRisks, validateHandTargets } from "./hand.ts";
import { handTables, readTargets, runTargets, TARGETS_STATE, TARGETS_TABLE } from "./run.ts";
import { INDEX_TARGETS, STRATEGIST_TARGETS } from "./strategists.ts";

const LEVELS = { btcPrice: 108_000, spxLevel: 7_757 };
const row = (firm: string, target: number, date: string, horizon: string) => ({ firm, target, date, horizon, url: `https://example.com/${firm.replace(/\W/g, "")}` });
const TARGETS = () => ({
  asOf: "2026-10-22",
  btc: { asset: "BTC-USD", unit: "USD per bitcoin", rows: [row("Citi", 82_000, "2026-07-01", "12 months"), row("Bernstein", 150_000, "2026-08-26", "mid-2027")] },
  sp500: { asset: "VUAA.L via ^GSPC", unit: "S&P 500 index points", horizon: "end-2026", rows: [row("Goldman Sachs", 8_000, "2026-05-26", "end-2026"), row("BofA", 7_400, "2026-10-22", "end-2026")] },
});
const RISKS = () => ({ asOf: "2026-10-22", risks: { RKLB: [{ text: "Net cash" }, { text: "@lowest-target" }, { text: "earnings 11/9", until: "2026-11-09" }], ORCL: [{ text: "S&P BBB−" }] } });

Deno.test("validateHandTargets: a good file passes whole; each kind of fault refuses it", () => {
  const ok = validateHandTargets(TARGETS(), LEVELS);
  assert(ok.ok);
  assertEquals([ok.value.asOf, ok.value.btc.length, ok.value.sp500[1]], ["2026-10-22", 2, row("BofA", 7_400, "2026-10-22", "end-2026")]);
  const faults: Array<[string, (t: any) => void]> = [
    ["keys are not asOf, btc, sp500", (t) => { t.extra = 1; }],
    ["btc's keys changed", (t) => { delete t.btc.unit; }],
    ["target is not a positive number", (t) => { t.btc.rows[0].target = "82000"; }],
    ["date is not YYYY-MM-DD", (t) => { t.sp500.rows[0].date = "2026-02-30"; }],
    ["dated after the file's asOf", (t) => { t.sp500.rows[0].date = "2026-10-23"; }],
    ["url is not https", (t) => { t.btc.rows[1].url = "http://example.com"; }],
    ["horizon is not end-YYYY", (t) => { t.sp500.rows[1].horizon = "12 months"; }],
    ["Goldman Sachs twice", (t) => { t.sp500.rows[1].firm = "Goldman Sachs"; }],
    // 2,000 on 7,757 is 0.26×: a typo or a unit slip, outside 0.3–3×.
    ["0.26× the current level", (t) => { t.sp500.rows[0].target = 2_000; }],
    ["3.24× the current level", (t) => { t.btc.rows[1].target = 350_000; }],
    ["keys are not firm, target, date, horizon, url", (t) => { t.btc.rows[0].note = "x"; }],
    ["rows is empty", (t) => { t.btc.rows = []; }],
  ];
  for (const [want, mutate] of faults) {
    const t = TARGETS();
    mutate(t);
    const r = validateHandTargets(t, LEVELS);
    assert(!r.ok && r.error.includes(want), `${want}: ${JSON.stringify(r)}`);
  }
  assert(!validateHandTargets(TARGETS(), { btcPrice: 0, spxLevel: 7_757 }).ok);
});

Deno.test("validateHandRisks: 1–3 notes, ≤ 120 characters, real until dates, only the one placeholder", () => {
  const ok = validateHandRisks(RISKS());
  assert(ok.ok);
  assertEquals(ok.value.risks.RKLB[1], { text: "@lowest-target" });
  // "@" before a price is not a placeholder: Grok's "@$625" note of 10-27 took both tables down for 30 hours.
  const at = RISKS();
  at.risks.ORCL[0].text = "Sold 2 calls @$625, 1 @ 640";
  const atOk = validateHandRisks(at);
  assert(atOk.ok, JSON.stringify(atOk));
  assertEquals(atOk.value.risks.ORCL[0].text, "Sold 2 calls @$625, 1 @ 640");
  const faults: Array<[string, (r: any) => void]> = [
    ["4 notes", (r) => { r.risks.ORCL = [{ text: "a" }, { text: "b" }, { text: "c" }, { text: "d" }]; }],
    ["121 characters", (r) => { r.risks.ORCL[0].text = "x".repeat(121); }],
    ["until is not a date", (r) => { r.risks.RKLB[2].until = "11/9"; }],
    ["unknown placeholder", (r) => { r.risks.ORCL[0].text = "@highest-target"; }],
    ["unknown placeholder", (r) => { r.risks.ORCL[0].text = "below @lowest-target"; }],
    ["has no text", (r) => { r.risks.ORCL[0].text = " "; }],
    ["keys are not text, until", (r) => { r.risks.ORCL[0].source = "x"; }],
    ["keys are not asOf, risks", (r) => { delete r.asOf; }],
  ];
  for (const [want, mutate] of faults) {
    const r = RISKS();
    mutate(r);
    const v = validateHandRisks(r);
    assert(!v.ok && v.error.includes(want), `${want}: ${JSON.stringify(v)}`);
  }
});

Deno.test("headFromRefAdvertisement: the branch's commit from git's smart-HTTP ref list", () => {
  const body = "001e# service=git-upload-pack\n0000015b" + "a".repeat(40) + " HEAD\0multi_ack\n003f" + "b".repeat(40) + " refs/heads/hand-targets\n003c" + "c".repeat(40) + " refs/heads/hand-targets-old\n0000";
  assertEquals(headFromRefAdvertisement(body, "hand-targets"), "b".repeat(40));
  assertEquals(headFromRefAdvertisement(body, "main"), null);
});

const SHA1 = "1".repeat(40), SHA2 = "2".repeat(40);
/** GitHub as the loader sees it: the API's head, git's ref list, raw files by ref; `calls` lists each URL asked. */
function github(o: { head?: string | null; api?: boolean; git?: boolean; files?: Record<string, { targets: unknown; risks: unknown }>; down?: boolean }) {
  const calls: string[] = [];
  const f = ((input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (o.down) return Promise.reject(new TypeError("network down"));
    if (url.startsWith("https://api.github.com/")) {
      return Promise.resolve(o.api === false || !o.head ? new Response("{\"message\":\"API rate limit exceeded\"}", { status: 403 }) : new Response(o.head));
    }
    if (url.includes("/info/refs")) {
      return Promise.resolve(o.git === false || !o.head ? new Response("", { status: 503 }) : new Response(`003f${o.head} refs/heads/hand-targets\n0000`));
    }
    const m = url.match(/raw\.githubusercontent\.com\/daviesluo\/daviesportfolios\/([^/]+)\/(HAND_\w+)\.json$/);
    const file = m && o.files?.[m[1]];
    if (!m || !file) return Promise.resolve(new Response("404", { status: 404 }));
    return Promise.resolve(new Response(JSON.stringify(m[2] === "HAND_TARGETS" ? file.targets : file.risks)));
  }) as typeof fetch;
  return { f, calls };
}
const levels = () => Promise.resolve(LEVELS);
const T0 = Date.parse("2026-10-22T13:31:00Z");

Deno.test("checkHand: reads both files at the head's commit, then asks only for the head, at most every five minutes", async () => {
  const gh = github({ head: SHA1, files: { [SHA1]: { targets: TARGETS(), risks: RISKS() } } });
  const a = await checkHand(null, T0, gh.f, levels);
  assertEquals([a.state.sha, a.state.via, a.state.error, a.changed, a.newError, a.state.targets?.btc.length], [SHA1, "api", null, true, null, 2]);
  assertEquals(gh.calls.filter((u) => u.includes(`/${SHA1}/`)).length, 2);
  // Within five minutes: nothing asked.
  const b = await checkHand(a.state, T0 + HAND_CHECK_MS - 1, gh.f, levels);
  assertEquals([b.state, b.changed, gh.calls.length], [a.state, false, 3]);
  // After: the head alone, unchanged, so no file is read.
  const c = await checkHand(a.state, T0 + HAND_CHECK_MS, gh.f, levels);
  assertEquals([c.changed, c.state.checkedAt, gh.calls.length], [false, T0 + HAND_CHECK_MS, 4]);
});

Deno.test("checkHand: a new commit is read; a faulty one is refused whole, reported once, and the baked tables stand", async () => {
  const good = github({ head: SHA1, files: { [SHA1]: { targets: TARGETS(), risks: RISKS() } } });
  const a = await checkHand(null, T0, good.f, levels);
  const broken = TARGETS();
  broken.sp500.rows[0].target = 80; // 80 for 8,000: a slip of two zeros
  const bad = github({ head: SHA2, files: { [SHA2]: { targets: broken, risks: RISKS() } } });
  const b = await checkHand(a.state, T0 + HAND_CHECK_MS, bad.f, levels);
  assertEquals([b.state.sha, b.state.targets, b.state.risks, b.changed], [null, null, null, true]);
  assert(b.newError?.includes("Goldman Sachs's 80 is 0.01× the current level"), b.newError ?? "");
  // The run uses the baked tables while the error stands; a second check of the same fault reports nothing new.
  assertEquals(handTables(b.state.targets).strategist, STRATEGIST_TARGETS);
  const c = await checkHand(b.state, T0 + 2 * HAND_CHECK_MS, bad.f, levels);
  assertEquals([c.newError, c.changed, c.state.error], [null, false, b.state.error]);
  // Fixed: loaded again, the error cleared.
  const fixed = github({ head: SHA1, files: { [SHA1]: { targets: TARGETS(), risks: RISKS() } } });
  const d = await checkHand(c.state, T0 + 3 * HAND_CHECK_MS, fixed.f, levels);
  assertEquals([d.state.sha, d.state.error, d.changed], [SHA1, null, true]);
});

Deno.test("checkHand: the API refusing, git's ref list; both refusing, the branch's own raw URL; the network down, the baked tables", async () => {
  const files = { [SHA1]: { targets: TARGETS(), risks: RISKS() }, "hand-targets": { targets: TARGETS(), risks: RISKS() } };
  const viaGit = await checkHand(null, T0, github({ head: SHA1, api: false, files }).f, levels);
  assertEquals([viaGit.state.sha, viaGit.state.via], [SHA1, "git"]);
  const viaBranch = github({ head: null, files });
  const br = await checkHand(null, T0, viaBranch.f, levels);
  assertEquals([br.state.sha, br.state.via, br.state.error, !!br.state.targets], [null, "branch", null, true]);
  assert(viaBranch.calls.some((u) => u.endsWith("/hand-targets/HAND_TARGETS.json")));
  const down = await checkHand(viaGit.state, T0 + HAND_CHECK_MS, github({ down: true }).f, levels);
  assertEquals([down.state.targets, down.changed], [null, true]);
  assert(down.newError?.startsWith("hand-targets: could not read the branch"), down.newError ?? "");
  // No price to check the targets against: refused too.
  const noLevels = await checkHand(null, T0, github({ head: SHA1, files }).f, () => Promise.resolve(null));
  assertEquals([noLevels.state.targets, !!noLevels.newError], [null, true]);
});

Deno.test("the job: a push rebuilds bitcoin's and VUAA's rows between slots, and the GET serves the branch's risks", async () => {
  const NOW = Date.parse("2026-10-22T15:01:00Z"); // 11:01 ET: no slot due (the open's was done)
  const vuaa = { ticker: "VUAA.L", kind: "strategist", currency: "USD", refPrice: 150, mean: 1, low: 1, high: 1, rating: null, analysts: 19, targets: [],
    sources: [], index: { symbol: "^GSPC", name: "S&P 500", level: 7500, price: 150, scale: 0.02 }, crossCheck: { mean: 189, low: 115, high: 263, analysts: 50, coverage: null } };
  const { db } = memDb({
    board_data: [{ id: 1, data: { holdings: { "BTC-USD": {}, "VUAA.L": {} } } }],
    [TARGETS_STATE]: [{ id: 1, last_slot: "2026-10-22T13:30:00.000Z", claimed_slot: null, claimed_at: null, cache: {}, updated_at: "2026-10-22T13:30:30.000Z", last_error: null }],
    [TARGETS_TABLE]: [
      { ticker: "VUAA.L", slot: "2026-10-22T13:30:00.000Z", as_of: "2026-10-22T13:30:30.000Z", payload: vuaa },
      { ticker: "BTC-USD", slot: "2026-10-22T13:30:00.000Z", as_of: "2026-10-22T13:30:30.000Z", payload: { ticker: "BTC-USD", kind: "strategist", mean: 1 } },
    ],
  }, { now: () => NOW });
  // GitHub, and the chart reads the targets are checked against.
  const gh = github({ head: SHA1, files: { [SHA1]: { targets: TARGETS(), risks: RISKS() } } });
  const f = ((u: string | URL | Request, i?: RequestInit) => {
    const url = String(u);
    if (url.includes("/v8/finance/chart/")) {
      const price = url.includes("BTC-USD") ? 108_000 : 7_757;
      return Promise.resolve(new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: price, currency: "USD" } }] } })));
    }
    return gh.f(u, i);
  }) as typeof fetch;
  const r = await runTargets({ db, now: NOW, fetchImpl: f, crumb: () => Promise.resolve(null), hand: true });
  assertEquals([r.skipped, r.rebuilt, r.notices], ["no slot due", ["BTC-USD", "VUAA.L"], undefined]);
  const rows = Object.fromEntries((await db.select<{ ticker: string; payload: any }>(TARGETS_TABLE, "select=ticker,payload")).map((x) => [x.ticker, x.payload]));
  // Bitcoin: (82,000 + 150,000) / 2 = 116,000. VUAA: (8,000 + 7,400) / 2 = 7,700 × 0.02 = 154, on its stored scale.
  assertEquals([rows["BTC-USD"].mean, rows["VUAA.L"].mean, rows["VUAA.L"].analysts, rows["VUAA.L"].crossCheck.mean], [116_000, 154, 2, 189]);
  const read = await readTargets(db) as any;
  assertEquals([read.risks.asOf, read.risks.risks.RKLB[1].text, read.hand.sha, read.hand.error, read.hand.targetsAsOf], ["2026-10-22", "@lowest-target", SHA1, null, "2026-10-22"]);
  // The next minute: nothing asked of GitHub, nothing rebuilt.
  const before = gh.calls.length;
  const r2 = await runTargets({ db, now: NOW + 60_000, fetchImpl: f, crumb: () => Promise.resolve(null), hand: true });
  assertEquals([r2.rebuilt, gh.calls.length], [undefined, before]);
  // Baked tables untouched by any of this.
  assertEquals(INDEX_TARGETS["VUAA.L"].rows.length, 19);
  assertEquals(EMPTY_HAND.sha, null);
});
