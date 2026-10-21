// The simulation that stands for LIVE, replayed over LIVE's own life (Davies, 2026-10-21: "…要确保模拟的真实性和实盘策略完全
// 一致，不一致的地方就直接改"): PR5's rule carried out by the production code — `runQuotesTwins` (quotes_twin.ts) driving the live
// executor (quotes_live.ts) on the simulated Revolut X account (revx_sim.ts), in the in-memory database of testing.ts — at
// LIVE's own size and start, as the twins' pre-registration §7 validated it on LIVE's first day: PR5's twin's spec at
// £120 (£10 a rung), its replica from PR5's first minute, its first turn at LIVE's go-live instant (2026-10-01 16:29:53),
// LIVE's starting £120.33, LIVE's two go-live conversions at their own instants (taker IOCs of £30), and the dead-man from
// 2026-10-02 19:06 (when it went live). It turns in every minute PR5's call ran (scripts/build_inputs.py), to 2026-10-21
// 15:09. `rules` (JSON, optional) are twin rule extensions (TWIN_RULES) laid over the spec, e.g. the LIVE fill model.
//
//   npx --yes deno@1.46.3 run --allow-read --allow-write --allow-env scripts/replay.ts <name> ['<rules JSON>']
//
// Writes results/runs/<name>.json.gz: every order the simulation wrote (live mode), its account and its trips by the page's
// own `liveRungs`/`liveRungTrips`.

const REPO = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const { memDb } = await import(`${REPO}/supabase/functions/agents/testing.ts`);
const Q = await import(`${REPO}/supabase/functions/agents/quotes_twin.ts`);
const IX = await import(`${REPO}/supabase/functions/agents/index.ts`);
type Row = Record<string, unknown>;

const [name, rulesArg, opsArg, offsetArg] = Deno.args;
// `offset` (seconds, with `ops`): the turn's instant into the call minute in place of LIVE's 30 s (the timing question of
// 2026-10-21: place at the paper's live_at, the minute's start, or a few seconds in).
const OFFSET_MS = offsetArg != null && offsetArg !== "" ? Number(offsetArg) * 1e3 : 30e3;
if (!name) throw new Error("usage: replay.ts <name> ['<rules JSON>'] [ops]");
// `ops`: what LIVE met that a twin does not, measured from its record (data/live_events.txt; ops_errors of 2026-10-20 as
// read in the 2026-10-20 incident review): a turn in every minute (below), 30 s into it (it places a median 32.3 s in), the
// monitor's 48 dead-man cancels of 2026-10-07 (its state unreadable; each at its minute + 5 s), and the venue's outage of
// 2026-10-20 (order reads 500 06:03-08:37 and 403 11:00-12:00, the pair list 502 08:00-11:36, cancels 503 08:37-15:02:28).
const OPS = opsArg === "ops";
const M = 60e3;
const UNTIL = Date.parse("2026-10-21T15:09:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const gz = await Deno.readFile(`${REPO}/docs/agents/backtests/livesim/data/inputs.json.gz`);
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
// The minutes PR5's call ran. Without `ops`, those in which PR5's engine recorded a minute (build_inputs.py). With `ops`, every
// minute from LIVE's go-live: pg_cron calls each minute, and the live executor turns in every call, also in those whose
// paper engine decided nothing (it then withdraws its entries on the stale-input guard; LIVE wrote 430 such cancels, the
// recorded minutes alone gave 130).
const beatMinutes = OPS
  ? Array.from({ length: Math.floor((UNTIL - Date.parse("2026-10-01T16:29:00Z")) / M) + 1 }, (_, i) => Date.parse("2026-10-01T16:29:00Z") + i * M)
  : (JSON.parse(bundle.files["quotes_beats.json"]) as number[]).filter((m) => m <= UNTIL);
const beats: Row[] = beatMinutes.map((ms) => ({ minute: iso(ms), path: "agents?action=quotes", ts: iso(ms) }));
const pr5Last = Math.max(...minutes.map((r) => Date.parse(String(r.minute))));

const base = Q.TWINS["pr5"];
const extra = rulesArg ? JSON.parse(rulesArg) as Record<string, unknown> : {};
const rules: Record<string, unknown> = {};
for (const [k, v] of Object.entries(extra)) Object.assign(rules, Q.TWIN_RULES[k](v));
const spec = {
  ...base, capitalGbp: 120, backfill: undefined, instance: { ...base.instance, ...rules },
  replay: {
    firstTurn: Date.parse("2026-10-01T16:29:53Z"), balances: { GBP: 120.33 },
    conversions: [{ at: Date.parse("2026-10-01T16:31:48.836Z"), book: "USDT-GBP", gbp: 30 }, { at: Date.parse("2026-10-01T16:32:49.680Z"), book: "USDC-GBP", gbp: 30 }],
    deadmanFrom: Date.parse("2026-10-02T19:06:00Z"),
    ...(OPS ? {
      turnOffsetMs: OFFSET_MS,
      deadmen: (await new Response(new Blob([await Deno.readFile(`${REPO}/docs/agents/backtests/livesim/data/live_events.txt.gz`)]).stream().pipeThrough(new DecompressionStream("gzip"))).text()).split("\n").filter(Boolean)
        .map((l) => l.split("|")).filter((f) => f[0] === "live" && f[5] === "deadman").map((f) => Number(f[1]) + 5e3).sort((a, b) => a - b),
      outages: [
        { from: Date.parse("2026-10-20T06:03:00Z"), to: Date.parse("2026-10-20T08:37:00Z"), method: "GET", path: "/api/1.0/orders/", status: 500, message: "Something went wrong!" },
        { from: Date.parse("2026-10-20T11:00:00Z"), to: Date.parse("2026-10-20T12:00:00Z"), method: "GET", path: "/api/1.0/orders/", status: 403, message: "This action is forbidden" },
        { from: Date.parse("2026-10-20T08:00:00Z"), to: Date.parse("2026-10-20T11:36:00Z"), public: true, path: "/api/1.0/public/configuration/pairs", status: 502, message: "502 Server Error" },
        { from: Date.parse("2026-10-20T08:37:00Z"), to: Date.parse("2026-10-20T15:02:28Z"), method: "DELETE", path: "/api/1.0/orders/", status: 503, message: "Failed to cancel order. Error: CIRCUIT_BREAKER_OPEN_ERROR" },
      ],
    } : {}),
  },
};
const I = spec.instance;
const mem = memDb({
  agent_locks: [{ name: "quotes-twins", lease_until: iso(0), holder: null }, { name: I.lease, lease_until: iso(0), holder: null }],
  agent_risk: [{ id: 1, global_pause: false }],
  agent_quote_state: [{ id: 1, state: { fetchedTo: { "USDC-GBP": UNTIL + 25e3, "USDT-GBP": UNTIL + 25e3 } }, last_minute: iso(Math.min(pr5Last, UNTIL)), updated_at: iso(UNTIL), last_error: null }],
  agent_quote_minutes: minutes, agent_quote_prints: prints, agent_quote_inputs: inputs, agent_quote_events: events,
  agent_quoted_state: [{ id: 1, state: {}, last_minute: iso(UNTIL), updated_at: iso(UNTIL), last_error: null }],
  agent_quoted_events: [], edge_call_beats: beats, agent_book_levels: [],
}, { now: () => UNTIL });

const key = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair).privateKey;
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, "0")}`;
const t0 = Date.now();
const r = await Q.runQuotesTwins({ db: mem.db, now: UNTIL, holder: "livesim", signingKey: key, catchUpUntil: UNTIL, budgetMs: Number.POSITIVE_INFINITY, clock: () => 0, uuid }, [spec]);
const tw = r.twins[0];
if (!tw || tw.errors.length) console.error(`run ${name}: ${JSON.stringify(tw?.errors ?? r).slice(0, 2000)}`);
const tables = mem.tables as Record<string, Row[]>;
const orders = (tables[I.orders] ?? []) as Row[];
const exState = ((tables[I.state] ?? [])[0]?.state ?? {}) as Record<string, unknown>;
const sim = ((tables[spec.sim] ?? [])[0]?.state ?? {}) as Record<string, any>;
const dust = (exState.dust ?? {}) as Record<string, number>;
const ms = (v: unknown) => (v == null ? null : Date.parse(String(v)));
const views = orders.filter((o) => o.mode === "live").map((o) => ({
  id: Number(o.id), ts: String(o.ts), mode: String(o.mode), book: String(o.book), rung_side: o.rung_side == null ? null : String(o.rung_side),
  k: o.k == null ? null : Number(o.k), leg: String(o.leg), state: String(o.state), filled_base: Number(o.filled_base ?? 0),
  avg_fill_price: o.avg_fill_price == null ? null : Number(o.avg_fill_price), price: Number(o.price), fee_gbp: Number(o.fee_gbp ?? 0),
  filled_at: o.filled_at == null ? null : String(o.filled_at), side: String(o.side), base_size: Number(o.base_size ?? 0),
  not_sent: !!((o.response as Record<string, unknown> | null)?.wouldBeRefused),
}));
const dayStart = Math.floor(UNTIL / 864e5) * 864e5;
const rungs = IX.liveRungs(views, null, dayStart, dust);
const trips = rungs.flatMap((rg: any) => IX.liveRungTrips({ ...rg, dust: rg.dust }, dayStart));
const realised = rungs.reduce((a: number, rg: any) => a + rg.rb.realisedGbp, 0);
const events_ = ((tables[I.events] ?? []) as Row[]).map((e) => [ms(e.minute), e.book, e.rung_side, e.k, e.kind, (e.detail as Row)?.reason ?? null]);
const out = {
  name, rules: extra, ops: OPS, turnOffsetMs: OPS ? OFFSET_MS : null, until: iso(UNTIL), capitalGbp: spec.capitalGbp, turns: tw?.turns, lastTurn: tw?.lastTurn, check: tw?.check, errors: tw?.errors ?? [],
  seconds: Math.round((Date.now() - t0) / 1000), realisedGbp: realised, dust, balances: sim.venue?.balances ?? null, deadmen: sim.venue?.deadmen ?? [],
  days: sim.days ?? {},
  // [id, ts, book, rung_side, k, leg, side, state, price, base_size, filled_base, avg_fill_price, fee_gbp, filled_at, not_sent, cancel_requested_at, cancelled_at, fair, cancel_reason, paper_oid]
  orders: orders.filter((o) => o.mode === "live").map((o) => [Number(o.id), ms(o.ts), o.book, o.rung_side, o.k == null ? null : Number(o.k), o.leg, o.side, o.state, Number(o.price), Number(o.base_size ?? 0),
    Number(o.filled_base ?? 0), o.avg_fill_price == null ? null : Number(o.avg_fill_price), Number(o.fee_gbp ?? 0), ms(o.filled_at), !!((o.response as Record<string, unknown> | null)?.wouldBeRefused),
    ms(o.cancel_requested_at), ms(o.cancelled_at), o.fair == null ? null : Number(o.fair), o.cancel_reason ?? null, o.paper_oid ?? null]),
  events: events_, trips,
};
await Deno.mkdir(`${REPO}/docs/agents/backtests/livesim/results/runs`, { recursive: true });
const bytes = new Uint8Array(await new Response(new Blob([JSON.stringify(out)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
await Deno.writeFile(`${REPO}/docs/agents/backtests/livesim/results/runs/${name}.json.gz`, bytes);
console.log(JSON.stringify({ name, turns: tw?.turns, check: tw?.check, seconds: out.seconds, orders: out.orders.length, trips: trips.length,
  won: trips.filter((t: any) => t.pnlGbp > 0).length, stops: trips.filter((t: any) => t.how === "stop").length, realisedGbp: +realised.toFixed(4), deadmen: out.deadmen.length, errors: out.errors.length }));
