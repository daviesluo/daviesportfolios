// F3, validated (Davies, 2026-10-09: ""F3 卖出价可以再挂远一个 tick"完整验证一下"): PR5's rule carried out by its realistic
// twin — the production code itself, `runQuotesTwins` (quotes_twin.ts) with the live executor (quotes_live.ts) on the
// simulated Revolut X account (revx_sim.ts), in the in-memory database of testing.ts, exactly as
// docs/agents/backtests/twins/scripts/backfill.ts builds a twin's record — over the whole recorded history,
// 2026-09-23 15:09 → 2026-10-09 16:00 UTC (data/inputs.json.gz, scripts/build_inputs.py), with the exit at fair or
// `offset` ticks beyond it, and under either fill assumption. The two things production lacks come from patched copies
// of quotes_live.ts and revx_sim.ts (scripts/patch.py), mapped in by an import map; production files are only read.
//
//   python3 -I scripts/patch.py "$GEN"
//   npx --yes deno@1.46.3 run --allow-read --allow-write --allow-env --import-map="$GEN/import_map.json" \
//     scripts/replay.ts <name> <twin: pr5|p50|s10> <offset ticks> <fill: through|at> [fallback minutes|-] [until ISO]
//
// The twin turns in every minute PR5's call ran (the beats), at :25, less each twin's own missed turns in production
// (its dead-man gaps, build_inputs.py); s10 (LIVE's £10 a rung, £120) takes pr5's. Writes results/runs/<name>.json.gz:
// every order the twin wrote (live mode), its trips by the page's own `liveRungs`/`liveRungTrips`, and its account.

const REPO = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const { memDb } = await import(`${REPO}/supabase/functions/agents/testing.ts`);
const Q = await import(`${REPO}/supabase/functions/agents/quotes_twin.ts`);
const IX = await import(`${REPO}/supabase/functions/agents/index.ts`);
type Row = Record<string, unknown>;

const [name, twin, offArg, fill, fbArg, untilArg] = Deno.args;
const offset = Number(offArg), fallbackMin = fbArg && fbArg !== "-" ? Number(fbArg) : null;
if (!name || !["pr5", "p50", "s10"].includes(twin) || !Number.isInteger(offset) || !["through", "at"].includes(fill)) {
  throw new Error("usage: replay.ts <name> <pr5|p50|s10> <offset ticks> <through|at> [fallback minutes|-] [until ISO]");
}
(globalThis as unknown as { __SCQ_F3: unknown }).__SCQ_F3 = { offset, fallbackMin, fill };

const M = 60e3;
const UNTIL = Date.parse(untilArg ?? "2026-10-09T16:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const gz = await Deno.readFile(`${REPO}/docs/agents/backtests/scq_f3/data/inputs.json.gz`);
const bundle = JSON.parse(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).text()) as
  { files: Record<string, string>; gaps: Record<string, Array<[number, number | null]>> };
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
// The twin's turns: PR5's call minutes, less the twin's own production gaps (a minute whose turn at :25 falls inside one;
// the minute of the turn that ended it is kept).
const gaps = bundle.gaps[twin === "s10" ? "pr5" : twin] ?? [];
const inGap = (m: number) => gaps.some(([last, next]) => m + Q.TWIN_TURN_OFFSET_MS > last && (next == null || (m + Q.TWIN_TURN_OFFSET_MS < next && Math.floor(next / M) * M !== m)));
const beatMinutes = (JSON.parse(bundle.files["quotes_beats.json"]) as number[]).filter((m) => m <= UNTIL);
const beats: Row[] = beatMinutes.filter((m) => !inGap(m)).map((ms) => ({ minute: iso(ms), path: "agents?action=quotes", ts: iso(ms) }));
const pr5Last = Math.max(...minutes.map((r) => Date.parse(String(r.minute))));

const base = Q.TWINS[twin === "s10" ? "pr5" : twin];
const spec = { ...base, capitalGbp: twin === "s10" ? 120 : base.capitalGbp, backfill: undefined };
const I = spec.instance;
const mem = memDb({
  agent_locks: [{ name: "quotes-twins", lease_until: iso(0), holder: null }, { name: I.lease, lease_until: iso(0), holder: null }],
  agent_risk: [{ id: 1, global_pause: false }],
  agent_quote_state: [{ id: 1, state: { fetchedTo: { "USDC-GBP": UNTIL + 25e3, "USDT-GBP": UNTIL + 25e3 } }, last_minute: iso(Math.min(pr5Last, UNTIL)), updated_at: iso(UNTIL), last_error: null }],
  agent_quote_minutes: minutes, agent_quote_prints: prints, agent_quote_inputs: inputs, agent_quote_events: events,
  agent_quoted_state: [{ id: 1, state: {}, last_minute: iso(UNTIL), updated_at: iso(UNTIL), last_error: null }],
  agent_quoted_events: [], edge_call_beats: beats,
}, { now: () => UNTIL });

const key = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair).privateKey;
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, "0")}`;
const t0 = Date.now();
const r = await Q.runQuotesTwins({ db: mem.db, now: UNTIL, holder: "scq_f3", signingKey: key, catchUpUntil: UNTIL, budgetMs: Number.POSITIVE_INFINITY, clock: () => 0, uuid }, [spec]);
const tw = r.twins[0];
if (!tw || tw.errors.length) throw new Error(`run ${name}: ${JSON.stringify(tw?.errors ?? r).slice(0, 2000)}`);
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
const held = rungs.filter((rg: any) => rg.rb.held > (rg.dust ?? 0) + 1e-9).map((rg: any) => ({ book: rg.book, side: rg.side, k: rg.k, held: rg.rb.held, avgEntry: rg.rb.avgEntry, openedAt: rg.rb.openedAt }));
const realised = rungs.reduce((a: number, rg: any) => a + rg.rb.realisedGbp, 0);
const out = {
  name, twin, offset, fill, fallbackMin, until: iso(UNTIL), capitalGbp: spec.capitalGbp, turns: tw.turns, lastTurn: tw.lastTurn, check: tw.check,
  seconds: Math.round((Date.now() - t0) / 1000), realisedGbp: realised, dust, held, balances: sim.venue?.balances ?? null, deadmen: sim.venue?.deadmen ?? [],
  days: sim.days ?? {}, conversions: (sim.conversions ?? []).length,
  // [id, ts, book, rung_side, k, leg, side, state, price, base_size, filled_base, avg_fill_price, fee_gbp, filled_at, not_sent, cancel_requested_at, cancelled_at, fair]
  orders: orders.filter((o) => o.mode === "live").map((o) => [Number(o.id), ms(o.ts), o.book, o.rung_side, o.k == null ? null : Number(o.k), o.leg, o.side, o.state, Number(o.price), Number(o.base_size ?? 0),
    Number(o.filled_base ?? 0), o.avg_fill_price == null ? null : Number(o.avg_fill_price), Number(o.fee_gbp ?? 0), ms(o.filled_at), !!((o.response as Record<string, unknown> | null)?.wouldBeRefused),
    ms(o.cancel_requested_at), ms(o.cancelled_at), o.fair == null ? null : Number(o.fair)]),
  trips,
};
await Deno.mkdir(`${REPO}/docs/agents/backtests/scq_f3/results/runs`, { recursive: true });
const bytes = new Uint8Array(await new Response(new Blob([JSON.stringify(out)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
await Deno.writeFile(`${REPO}/docs/agents/backtests/scq_f3/results/runs/${name}.json.gz`, bytes);
console.log(JSON.stringify({ name, turns: tw.turns, check: tw.check, seconds: out.seconds, orders: out.orders.length, trips: trips.length,
  won: trips.filter((t: any) => t.pnlGbp > 0).length, stops: trips.filter((t: any) => t.how === "stop").length, realisedGbp: +realised.toFixed(4), deadmen: out.deadmen.length, held: held.length }));
