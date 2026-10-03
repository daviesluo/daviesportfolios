// The realistic twins' backfills (docs/agents/reviews/2026-10-02-pr5-realistic-twins-prereg.md): each twin's record from
// its engine's first decided minute to `until`, computed by the production code itself (`runQuotesTwins` in
// supabase/functions/agents/quotes_twin.ts, the live executor's `quotes_live.ts` under it, the simulated account of
// `revx_sim.ts`) on PR5's stored record, in the in-memory database that holds the schema's own checks (testing.ts). The
// production call loads the file it writes, checked by the sha256 its spec row pins (`backfill`), and catches up from `until`.
//
//   cd docs/agents/backtests/twins/scripts && npx --yes deno@1.46.3 run --allow-read --allow-write --allow-env backfill.ts pr5
//   … backfill.ts d
//   … backfill.ts p50  (any id of the spec rows the migrations insert, spec_rows.ts; a later variant's too)
//
// Its input is ../inputs/twins_inputs.json.gz (MANIFEST.json says what it holds and how it was read). The order ids are
// numbered, not random, so a run writes the same bytes each time.

import { memDb, type Row } from "../../../../../supabase/functions/agents/testing.ts";
import { runQuotesTwins, specFromRow, twinBackfillOf } from "../../../../../supabase/functions/agents/quotes_twin.ts";
import { specRowsOfMigrations } from "./spec_rows.ts";

const id = Deno.args[0];
const row = (await specRowsOfMigrations()).find((r) => r.id === id);
if (!row) throw new Error("usage: backfill.ts <the id of a twin's spec row>");
/** The record's end: the last minute both engines had decided when the inputs were read (MANIFEST.json). */
const UNTIL = Date.parse("2026-10-02T21:05:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const gz = await Deno.readFile(new URL("../inputs/twins_inputs.json.gz", import.meta.url));
const bundle = JSON.parse(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).text()) as { files: Record<string, string> };
const lines = (f: string) => bundle.files[f].split("\n").filter(Boolean);

// PR5's record and rule D's decisions, as the tables hold them.
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
const ruled: Row[] = lines("d_struct.txt").map((l) => {
  const [book, ms, side, k, kind, what, ticks, oid, leg, why] = l.split("|");
  return { arm: "d", book, minute: iso(Number(ms)), side, k: Number(k), kind, what: what || null, key: null, ticks: ticks === "" ? null : Number(ticks), detail: { oid, leg, why } };
});
const beats: Row[] = (JSON.parse(bundle.files["quotes_beats.json"]) as number[]).map((ms) => ({ minute: iso(ms), path: "agents?action=quotes", ts: iso(ms) }));
const pr5Last = Math.max(...minutes.map((r) => Date.parse(String(r.minute))));
const dLast = Math.max(...ruled.map((r) => Date.parse(String(r.minute))));

const spec = specFromRow(row);
const mem = memDb({
  agent_locks: [{ name: "quotes-twins", lease_until: iso(0), holder: null }, { name: spec.instance.lease, lease_until: iso(0), holder: null }],
  agent_risk: [{ id: 1, global_pause: false }],
  // PR5's call as it stood at the end: decided to `UNTIL`, its prints read to 25 s past it.
  agent_quote_state: [{ id: 1, state: { fetchedTo: { "USDC-GBP": UNTIL + 25e3, "USDT-GBP": UNTIL + 25e3 } }, last_minute: iso(Math.min(pr5Last, UNTIL)), updated_at: iso(UNTIL), last_error: null }],
  agent_quote_minutes: minutes, agent_quote_prints: prints, agent_quote_inputs: inputs, agent_quote_events: events,
  agent_quoted_state: [{ id: 1, state: {}, last_minute: iso(dLast), updated_at: iso(dLast), last_error: null }],
  agent_quoted_events: ruled, edge_call_beats: beats,
}, { now: () => UNTIL });
const key = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair).privateKey;
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, "0")}`;
const r = await runQuotesTwins({ db: mem.db, now: UNTIL, holder: "backfill", signingKey: key, catchUpUntil: UNTIL, budgetMs: Number.POSITIVE_INFINITY, clock: () => 0, uuid }, [spec]);
const t = r.twins[0];
if (!t || t.errors.length) throw new Error(`backfill ${id}: ${JSON.stringify(t?.errors ?? r)}`);
const I = spec.instance, tables = mem.tables as Record<string, Row[]>;
const data = twinBackfillOf(spec, UNTIL, {
  config: tables[I.config] ?? [], orders: tables[I.orders] ?? [], events: tables[I.events] ?? [], state: tables[I.state] ?? [], paper: tables[I.paper] ?? [], sim: tables[spec.sim] ?? [],
});
const bytes = new Uint8Array(await new Response(new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
const out = new URL(`../${id}.json.gz`, import.meta.url);
await Deno.writeFile(out, bytes);
const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) => x.toString(16).padStart(2, "0")).join("");
// What the run did, and nothing of what it made: rule D's results are not read before its reading (its no-peek).
console.log(JSON.stringify({ twin: id, until: iso(UNTIL), turns: t.turns, lastTurn: t.lastTurn, mode: t.mode, check: t.check, orders: data.orders.length, events: data.events.length, bytes: bytes.length, sha256: sha }));
