// The backfill of "Stablecoin quotes LIVE twin" (`live`, 0136; docs/agents/reviews/2026-10-21-live-twin-prereg.md): its record
// from PR5's first minute to 2026-10-21 15:09 UTC, computed by the production code (`runQuotesTwins`, quotes_live.ts, revx_sim.ts)
// on PR5's stored record (data/inputs.json.gz, scripts/build_inputs.py), as docs/agents/backtests/twins/scripts/backfill.ts builds
// every twin's, with its spec row as 0136 inserts it (spec_rows.ts) and the validation's replay of LIVE laid over it: no turn
// until LIVE's go-live, LIVE's starting £120.33 and its two go-live conversions, the dead-man from 2026-10-02 19:06, a turn
// every minute 30 s in, the monitor's 48 dead-man cancels of 2026-10-07 and the venue's outage of 2026-10-20 (`scripts/replay.ts`
// with `ops`, which measured them). Writes docs/agents/backtests/twins/live.json.gz; its sha256 goes in the row.
//
//   cd docs/agents/backtests/livesim && npx --yes deno@1.46.3 run --allow-read --allow-write --allow-env scripts/backfill_live.ts
import { memDb, type Row } from "../../../../../supabase/functions/agents/testing.ts";
import { runQuotesTwins, specFromRow, twinBackfillOf, type TwinSpec } from "../../../../../supabase/functions/agents/quotes_twin.ts";
import { specRowsOfMigrations } from "../../twins/scripts/spec_rows.ts";

const HERE = new URL("../", import.meta.url);
const M = 60e3;
const UNTIL = Date.parse("2026-10-21T15:09:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const gunzip = async (u: URL) => await new Response(new Blob([await Deno.readFile(u)]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
const bundle = JSON.parse(await gunzip(new URL("data/inputs.json.gz", HERE))) as { files: Record<string, string> };
const lines = (f: string) => bundle.files[f].split("\n").filter(Boolean);

const row = (await specRowsOfMigrations()).find((r) => r.id === "live");
if (!row) throw new Error("no spec row `live` in the migrations");
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
const GO_LIVE = Date.parse("2026-10-01T16:29:53Z");
const first = Math.floor(GO_LIVE / M) * M;
const beats: Row[] = Array.from({ length: (UNTIL - first) / M + 1 }, (_, i) => first + i * M).map((ms) => ({ minute: iso(ms), path: "agents?action=quotes", ts: iso(ms) }));
const pr5Last = Math.max(...minutes.map((r) => Date.parse(String(r.minute))));
const deadmen = (await gunzip(new URL("data/live_events.txt.gz", HERE))).split("\n").filter(Boolean).map((l) => l.split("|"))
  .filter((f) => f[0] === "live" && f[5] === "deadman").map((f) => Number(f[1]) + 5e3).sort((a, b) => a - b);
const spec: TwinSpec = {
  ...specFromRow(row),
  replay: {
    firstTurn: GO_LIVE, balances: { GBP: 120.33 },
    conversions: [{ at: Date.parse("2026-10-01T16:31:48.836Z"), book: "USDT-GBP", gbp: 30 }, { at: Date.parse("2026-10-01T16:32:49.680Z"), book: "USDC-GBP", gbp: 30 }],
    deadmanFrom: Date.parse("2026-10-02T19:06:00Z"), turnOffsetMs: 30e3, deadmen,
    outages: [
      { from: Date.parse("2026-10-20T06:03:00Z"), to: Date.parse("2026-10-20T08:37:00Z"), method: "GET", path: "/api/1.0/orders/", status: 500, message: "Something went wrong!" },
      { from: Date.parse("2026-10-20T11:00:00Z"), to: Date.parse("2026-10-20T12:00:00Z"), method: "GET", path: "/api/1.0/orders/", status: 403, message: "This action is forbidden" },
      { from: Date.parse("2026-10-20T08:00:00Z"), to: Date.parse("2026-10-20T11:36:00Z"), public: true, path: "/api/1.0/public/configuration/pairs", status: 502, message: "502 Server Error" },
      { from: Date.parse("2026-10-20T08:37:00Z"), to: Date.parse("2026-10-20T15:02:28Z"), method: "DELETE", path: "/api/1.0/orders/", status: 503, message: "Failed to cancel order. Error: CIRCUIT_BREAKER_OPEN_ERROR" },
    ],
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
const r = await runQuotesTwins({ db: mem.db, now: UNTIL, holder: "backfill", signingKey: key, catchUpUntil: UNTIL, budgetMs: Number.POSITIVE_INFINITY, clock: () => 0, uuid }, [spec]);
const t = r.twins[0];
if (!t || t.errors.length) throw new Error(`backfill live: ${JSON.stringify(t?.errors ?? r)}`);
const tables = mem.tables as Record<string, Row[]>;
const data = twinBackfillOf(spec, UNTIL, {
  config: tables[I.config] ?? [], orders: tables[I.orders] ?? [], events: tables[I.events] ?? [], state: tables[I.state] ?? [], paper: tables[I.paper] ?? [], sim: tables[spec.sim] ?? [],
});
const bytes = new Uint8Array(await new Response(new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
await Deno.writeFile(new URL("../twins/live.json.gz", HERE), bytes);
const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) => x.toString(16).padStart(2, "0")).join("");
console.log(JSON.stringify({ twin: "live", until: iso(UNTIL), turns: t.turns, lastTurn: t.lastTurn, mode: t.mode, check: t.check, orders: data.orders.length, events: data.events.length, bytes: bytes.length, sha256: sha }));
