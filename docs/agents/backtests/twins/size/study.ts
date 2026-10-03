// The size study (reference §4 item 51, its addendum of 2026-10-03): PR5's rule carried out by its realistic twin, the
// production code itself, at other rung sizes and with a reserve of pounds beyond the rungs, on the twins' committed
// inputs (2026-09-23 15:10 → 2026-10-02 21:05 UTC). PR5's twin only: rule D is not run (its twin's results stay unread
// before rule D's reading, 2026-10-28).
//
//   npx --yes deno@1.46.3 run --allow-read --allow-write --allow-env study.ts <name> <capitalGbp> [startGbp]
//   (s100 1200 reproduces PR5's twin's committed backfill: 47 trips, 44 won, +£6.0476)

const REPO = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const { memDb } = await import(`${REPO}/supabase/functions/agents/testing.ts`);
const Q = await import(`${REPO}/supabase/functions/agents/quotes_twin.ts`);
const { newSimState } = await import(`${REPO}/supabase/functions/agents/revx_sim.ts`);
const IX = await import(`${REPO}/supabase/functions/agents/index.ts`);
type Row = Record<string, unknown>;

const [name, capArg, startArg] = Deno.args;
const capitalGbp = Number(capArg), startGbp = Number(startArg ?? capArg);
if (!name || !(capitalGbp > 0) || !(startGbp > 0)) throw new Error("usage: study.ts <name> <capitalGbp> [startGbp]");

const UNTIL = Date.parse("2026-10-02T21:05:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const gz = await Deno.readFile(`${REPO}/docs/agents/backtests/twins/inputs/twins_inputs.json.gz`);
const bundle = JSON.parse(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).text()) as { files: Record<string, string> };
const lines = (f: string) => bundle.files[f].split("\n").filter(Boolean);

const prints: Row[] = lines("prints.txt").map((l) => { const [pid, book, ms, price, qty, side] = l.split("|"); return { id: pid, book, ts: iso(Number(ms)), price: Number(price), qty: Number(qty), side }; });
const recorded = new Map(lines("minutes_rec.txt").map((l) => { const [b, ms, rec] = l.split("|"); return [`${b}|${ms}`, iso(Number(rec))] as [string, string]; }));
const minutes: Row[] = lines("minutes.txt").map((l) => {
  const [book, ms, x, xt, fu, hn, pn] = l.split("|");
  return { book, minute: iso(Number(ms)), x: x === "" ? null : Number(x), x_t: xt === "" ? null : iso(Number(xt)), fair_u: fu === "" ? null : Number(fu), hours_n: Number(hn), prints_n: Number(pn), recorded_at: recorded.get(`${book}|${ms}`) ?? null };
});
const inputs: Row[] = lines("inputs.txt").map((l) => { const [kind, ms, v] = l.split("|"); return { kind, t: iso(Number(ms)), value: Number(v) }; });
const events: Row[] = lines("pr5_events.tsv").map((l) => {
  const [book, ms, side, k, kind, ticks, d] = l.split("\t");
  return { book, minute: iso(Number(ms)), side, k: Number(k), kind, ticks: ticks === "" ? null : Number(ticks), detail: JSON.parse(d) };
});
const beats: Row[] = (JSON.parse(bundle.files["quotes_beats.json"]) as number[]).map((ms) => ({ minute: iso(ms), path: "agents?action=quotes", ts: iso(ms) }));
const pr5Last = Math.max(...minutes.map((r) => Date.parse(String(r.minute))));

const spec = { ...Q.TWINS.pr5, capitalGbp };
const I = spec.instance;
const mem = memDb({
  agent_locks: [{ name: "quotes-twins", lease_until: iso(0), holder: null }, { name: I.lease, lease_until: iso(0), holder: null }],
  agent_risk: [{ id: 1, global_pause: false }],
  agent_quote_state: [{ id: 1, state: { fetchedTo: { "USDC-GBP": UNTIL + 25e3, "USDT-GBP": UNTIL + 25e3 } }, last_minute: iso(Math.min(pr5Last, UNTIL)), updated_at: iso(UNTIL), last_error: null }],
  agent_quote_minutes: minutes, agent_quote_prints: prints, agent_quote_inputs: inputs, agent_quote_events: events,
  agent_quoted_state: [{ id: 1, state: {}, last_minute: iso(UNTIL), updated_at: iso(UNTIL), last_error: null }],
  agent_quoted_events: [], edge_call_beats: beats,
}, { now: () => UNTIL });

// A reserve: the twin's account starts with more pounds than the capital its rungs are sized from (startTwin's own rows,
// seeded here with the larger balance; with no reserve the twin starts as the production one does).
if (startGbp !== capitalGbp) {
  const seeds = await Q.seedPrints(mem.db, spec.start);
  const paper = Q.newTwinPaper(spec, seeds);
  await mem.db.upsert(I.config, [{ id: 1, dry_run: false, live_confirmed_at: iso(spec.start), capital_gbp: capitalGbp, updated_at: iso(spec.start) }], "id");
  await mem.db.upsert(I.paper, [{ id: 1, state: paper, last_minute: iso(paper.lastMinute), updated_at: iso(spec.start) }], "id");
  await mem.db.upsert(spec.sim, [{ id: 1, state: { venue: newSimState({ GBP: startGbp }, seeds), mode: "catch-up", turns: 0, started: null, paperCheck: null, origin: { kind: "fresh" }, lastReport: null }, updated_at: iso(spec.start), last_error: null }], "id");
}

const key = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair).privateKey;
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, "0")}`;
const t0 = Date.now();
const r = await Q.runQuotesTwins({ db: mem.db, now: UNTIL, holder: "study", signingKey: key, catchUpUntil: UNTIL, budgetMs: Number.POSITIVE_INFINITY, clock: () => 0, uuid }, [spec]);
const tw = r.twins[0];
if (!tw || tw.errors.length) throw new Error(`run ${name}: ${JSON.stringify(tw?.errors ?? r).slice(0, 2000)}`);
const tables = mem.tables as Record<string, Row[]>;
const orders = (tables[I.orders] ?? []) as Row[];
const exState = ((tables[I.state] ?? [])[0]?.state ?? {}) as Record<string, unknown>;
const sim = ((tables[spec.sim] ?? [])[0]?.state ?? {}) as Record<string, any>;
const dust = (exState.dust ?? {}) as Record<string, number>;
const dayStart = Date.parse("2026-10-02T00:00:00Z");

const views = orders.filter((o) => o.mode === "live").map((o) => ({
  id: Number(o.id), ts: String(o.ts), mode: String(o.mode), book: String(o.book), rung_side: o.rung_side == null ? null : String(o.rung_side),
  k: o.k == null ? null : Number(o.k), leg: String(o.leg), state: String(o.state), filled_base: Number(o.filled_base ?? 0),
  avg_fill_price: o.avg_fill_price == null ? null : Number(o.avg_fill_price), price: Number(o.price), fee_gbp: Number(o.fee_gbp ?? 0),
  filled_at: o.filled_at == null ? null : String(o.filled_at), side: String(o.side), base_size: Number(o.base_size ?? 0),
  not_sent: !!((o.response as Record<string, unknown> | null)?.wouldBeRefused),
}));
const rungs = IX.liveRungs(views, null, dayStart, dust);
const out: Record<string, unknown>[] = [];
let tTrips = 0, tWon = 0, tReal = 0, tPenny = 0, tNotional = 0;
for (const rg of rungs) {
  const trips = IX.liveRungTrips({ ...rg, dust: rg.dust }, dayStart);
  const mine = views.filter((o) => o.book === rg.book && o.rung_side === rg.side && o.k === rg.k);
  const entries = mine.filter((o) => o.leg === "entry");
  const resp = (id: number) => (orders.find((o) => Number(o.id) === id)?.response ?? null) as Record<string, unknown> | null;
  const funds = entries.filter((o) => o.state === "rejected" && !o.not_sent && JSON.stringify(resp(o.id) ?? "").includes("Not enough funds")).length;
  // Penny settlement on maker fills: the pounds booked against the fill at the order's own price.
  let penny = 0;
  for (const o of mine) {
    if (!(o.filled_base > 0) || o.leg === "stop" || o.avg_fill_price == null) continue;
    const booked = o.filled_base * o.avg_fill_price, exact = o.filled_base * o.price;
    penny += o.side === "buy" ? booked - exact : exact - booked;
  }
  const real = rg.rb.realisedGbp;
  const notional = trips.reduce((a, t) => a + t.qty * t.entry, 0);
  const partial = entries.filter((o) => o.filled_base > 0 && o.filled_base < o.base_size - 1e-9).length;
  out.push({
    rung: `${rg.book.slice(0, 4)} ${rg.side} ${(rg.k * 100).toFixed(1)}%`, trips: trips.length, won: trips.filter((t) => t.pnlGbp > 0).length,
    realised: +real.toFixed(4), bpsPerTrip: trips.length && notional ? +((trips.reduce((a, t) => a + t.pnlGbp, 0) / notional) * 1e4).toFixed(1) : null,
    pennyCost: +penny.toFixed(4), entriesSent: entries.filter((o) => !o.not_sent).length, notSent: entries.filter((o) => o.not_sent).length,
    noFunds: funds, partialEntries: partial, held: rg.held ? +rg.rb.held.toFixed(2) : 0,
  });
  tTrips += trips.length; tWon += trips.filter((t) => t.pnlGbp > 0).length; tReal += real; tPenny += penny; tNotional += notional;
}
const conv = views.filter((o) => o.leg === "convert" && o.filled_base > 0).map((o) => ({ at: o.ts, book: o.book, coins: +o.filled_base.toFixed(4), price: o.avg_fill_price }));
const sentPosts = views.filter((o) => !o.not_sent && o.state !== "rejected").length;
const summary = {
  name, capitalGbp, startGbp, rungGbp: capitalGbp / 12, turns: tw.turns, seconds: Math.round((Date.now() - t0) / 1000),
  trips: tTrips, won: tWon, realised: +tReal.toFixed(4), pennyCost: +tPenny.toFixed(4), bpsPerTrip: tNotional ? +((tReal / tNotional) * 1e4).toFixed(2) : null,
  perDay: +(tReal / ((UNTIL - spec.start) / 864e5)).toFixed(4), annualPct: +((tReal / ((UNTIL - spec.start) / 864e5)) * 365 / startGbp * 100).toFixed(2),
  ordersRows: views.length, sent: sentPosts, conversions: conv, balances: sim.venue?.balances ?? null,
};
// results.json holds each run's two parts as { summary, rungs }.
console.log(JSON.stringify(summary));
for (const x of out) console.log(JSON.stringify(x));
