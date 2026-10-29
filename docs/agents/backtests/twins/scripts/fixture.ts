// The browser test's twins fixture (src/e2e/quotes_twin_fixture.json), made from the twins' spec rows: every enabled row
// the migrations insert (spec_rows.ts), in the page's order, with the live quotes fixture's book (quotes_live_fixture.json:
// no real balance or fill) run as its tables at its capital, beside a driver state of its engine's (`SIMS`) that carries
// its own backfill file and its operator's quarter of its capital. `twins` is the dashboard's own answer
// (`readQuotesTwin`), which the agents function's test asserts and the browser test serves. Nothing here is written per
// twin: after a migration adds a row, this run makes the new twin a row of the fixture, and the browser test checks it.
//
//   cd docs/agents/backtests/twins/scripts && npx --yes deno@1.46.3 run --allow-read --allow-write --allow-env fixture.ts

import { readQuotesTwin } from "../../../../../supabase/functions/agents/index.ts";
import { specFromRow } from "../../../../../supabase/functions/agents/quotes_twin.ts";
import { memDb, twinFixtureTables } from "../../../../../supabase/functions/agents/testing.ts";
import { specRowsOfMigrations } from "./spec_rows.ts";

const E2E = new URL("../../../../../src/e2e/", import.meta.url);
const live = JSON.parse(await Deno.readTextFile(new URL("quotes_live_fixture.json", E2E)));
/** The browser test's clock, 2026-09-17 23:00 UTC, and its day. */
const NOW = Date.parse("2026-09-17T23:00:00Z"), DAY = Date.parse("2026-09-17T00:00:00Z");
const at = (s: string) => Date.parse(s);
/**
 * Each engine's driver state as its twins' pages read it (the fixture's own since 0087), its start moved before the clock:
 * the account the live fixture's book leaves, how it runs, its replica's check, the dead-man, and the orders it sent each
 * day (6 on 16 Sep, 18 on 17 Sep).
 */
const SIMS = {
  pr5: { start: "2026-09-16T15:09:00.000Z", seq: 412, deadmen: [{ at: at("2026-09-17T16:00:00Z"), cancelled: 11 }], turns: 1910, events: 3480 },
  "ruled-d": { start: "2026-09-17T03:00:00.000Z", seq: 1530, deadmen: [], turns: 1195, events: 6112 },
};

/**
 * What later migrations did to the rows, in the migrations' order and each file's: a page name given (0108: rule D's twin,
 * "variant-3" to "variant-4"; 0109: back to "variant-3", Davies 2026-10-09; 0141), each `update … set display_name = '<new>'
 * where id = '<id>' and display_name = '<old>'`; a row taken off (0109: `p50x1`), each `delete from
 * public.agent_quote_twin_specs where id = '<id>'`; and since 0141 a rule added (`set rules = rules || '<json>'::jsonb where id
 * = '<id>' and not (rules ? '<key>')`), a row switched off (`set enabled = false where id = '<id>'`) and rows left off the page or
 * brought back (`set hidden = true|false where id in (…)`, 0142 for TAKE's twin). src/twin_specs.test.js reads them the same way. spec_rows.ts (frozen with p50's
 * pre-registration) returns the rows as first inserted; this makes them the rows as they stand. A hidden row stays in the
 * fixture: it still runs, and the browser test keeps its page under test until a migration switches it off.
 */
const RENAME = /update public\.agent_quote_twin_specs\s+set display_name = '([^']+)'\s+where id = '(\w+)' and display_name = '([^']+)';/g;
const DELETE = /delete from public\.agent_quote_twin_specs\s+where id = '(\w+)';/g;
const RULE_ADD = /update public\.agent_quote_twin_specs\s+set rules = rules \|\| '(\{[^']*\})'::jsonb\s+where id = '(\w+)' and not \(rules \? '(\w+)'\);/g;
const OFF = /update public\.agent_quote_twin_specs\s+set enabled = false\s+where id = '(\w+)';/g;
const HIDE = /update public\.agent_quote_twin_specs\s+set hidden = (true|false)\s+where id in \(([^)]*)\);/g;
/** A rule's instant, and a row's start, moved, each guarded on the value it replaces (0090, 0154), as src/twin_specs.test.js reads them. */
const RULE_MOVE = /update public\.agent_quote_twin_specs\s+set rules = jsonb_set\(rules, '\{(\w+),from\}', '"([0-9T:Z-]+)"'::jsonb\)\s+where id = '(\w+)' and rules->'(\w+)'->>'from' = '([0-9T:Z-]+)';/g;
const START = /update public\.agent_quote_twin_specs\s+set start = '([0-9T:Z-]+)'\s+where id = '(\w+)' and start = '([0-9T:Z-]+)';/g;
/**
 * Since 0178: a rule replaced whole, guarded on the rule it replaces (jsonb equality: keys in any order), and a row's place
 * moved, guarded on the place it leaves, as src/twin_specs.test.js reads them.
 */
const RULE_SET = /update public\.agent_quote_twin_specs\s+set rules = jsonb_set\(rules, '\{(\w+)\}', '(\{[^']*\})'::jsonb\)\s+where id = '(\w+)' and rules->'(\w+)' = '(\{[^']*\})'::jsonb;/g;
const PLACE = /update public\.agent_quote_twin_specs\s+set display_order = (\d+)\s+where id = '(\w+)' and display_order = (\d+);/g;
/** A value with its keys sorted at every depth: two jsonb values are equal when these are. */
const canon = (v: unknown) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const MIGRATIONS = new URL("../../../../../supabase/migrations/", import.meta.url);
type Op = { at: number; apply: (rows: Array<Record<string, unknown> & { id: string; display_name: string }>) => typeof rows };
const asTheyStand = async <T extends { id: string; display_name: string }>(first: T[]): Promise<T[]> => {
  let rows = first as unknown as Array<Record<string, unknown> & { id: string; display_name: string }>;
  const files: string[] = [];
  for await (const e of Deno.readDir(MIGRATIONS)) if (e.isFile && /^\d{4}_.*\.sql$/.test(e.name)) files.push(e.name);
  for (const f of files.sort()) {
    const sql = (await Deno.readTextFile(new URL(f, MIGRATIONS))).replace(/--[^\n]*/g, "");
    const ops: Op[] = [
      ...[...sql.matchAll(RENAME)].map((m): Op => ({ at: m.index ?? 0, apply: (rs) => rs.map((r) => (r.id === m[2] && r.display_name === m[3] ? { ...r, display_name: m[1] } : r)) })),
      ...[...sql.matchAll(DELETE)].map((m): Op => ({ at: m.index ?? 0, apply: (rs) => rs.filter((r) => r.id !== m[1]) })),
      ...[...sql.matchAll(RULE_ADD)].map((m): Op => ({ at: m.index ?? 0, apply: (rs) => rs.map((r) => {
        const rules = (r.rules ?? {}) as Record<string, unknown>;
        return r.id === m[2] && !(m[3] in rules) ? { ...r, rules: { ...rules, ...JSON.parse(m[1]) } } : r;
      }) })),
      ...[...sql.matchAll(OFF)].map((m): Op => ({ at: m.index ?? 0, apply: (rs) => rs.map((r) => (r.id === m[1] ? { ...r, enabled: false } : r)) })),
      ...[...sql.matchAll(HIDE)].map((m): Op => {
        const ids = m[2].split(",").map((x) => x.trim().replace(/^'|'$/g, ""));
        return { at: m.index ?? 0, apply: (rs) => rs.map((r) => (ids.includes(r.id) ? { ...r, hidden: m[1] === "true" } : r)) };
      }),
      ...[...sql.matchAll(RULE_MOVE)].map((m): Op => ({ at: m.index ?? 0, apply: (rs) => rs.map((r) => {
        const rules = (r.rules ?? {}) as Record<string, Record<string, unknown>>;
        return r.id === m[3] && rules[m[1]]?.from === m[5] ? { ...r, rules: { ...rules, [m[1]]: { ...rules[m[1]], from: m[2] } } } : r;
      }) })),
      ...[...sql.matchAll(START)].map((m): Op => ({ at: m.index ?? 0, apply: (rs) => rs.map((r) => (r.id === m[2] && Date.parse(String(r.start)) === Date.parse(m[3]) ? { ...r, start: m[1] } : r)) })),
      ...[...sql.matchAll(RULE_SET)].map((m): Op => ({ at: m.index ?? 0, apply: (rs) => rs.map((r) => {
        const rules = (r.rules ?? {}) as Record<string, unknown>;
        return r.id === m[3] && m[1] === m[4] && canon(rules[m[4]]) === canon(JSON.parse(m[5])) ? { ...r, rules: { ...rules, [m[1]]: JSON.parse(m[2]) } } : r;
      }) })),
      ...[...sql.matchAll(PLACE)].map((m): Op => ({ at: m.index ?? 0, apply: (rs) => rs.map((r) => (r.id === m[2] && Number(r.display_order) === Number(m[3]) ? { ...r, display_order: Number(m[1]) } : r)) })),
    ].sort((a, b) => a.at - b.at);
    for (const op of ops) rows = op.apply(rows);
  }
  // In the page's order, as a moved place leaves it (0178).
  return (rows as unknown as T[]).sort((a, b) => Number((a as Record<string, unknown>).display_order) - Number((b as Record<string, unknown>).display_order));
};
const rows = (await asTheyStand(await specRowsOfMigrations())).filter((r) => r.enabled);
const starts: Record<string, string> = {}, sims: Record<string, unknown> = {}, twins: unknown[] = [];
for (const row of rows) {
  const spec = specFromRow(row), e = SIMS[row.engine];
  const sim = {
    id: 1, updated_at: "2026-09-17T22:59:25.000Z", last_error: null,
    state: {
      venue: { v: 1, seq: e.seq, balances: { GBP: 600.696306, USDC: 263.6436, USDT: 527.6436 }, orders: [], applied: {}, lastTurnAt: at("2026-09-17T22:59:25Z"), deadmen: e.deadmen },
      mode: "forward", turns: e.turns, started: at(e.start) + 85e3,
      paperCheck: { through: at("2026-09-17T22:58:00Z"), minutes: e.turns, events: e.events, mismatches: 0, first: null },
      origin: row.backfill
        ? { kind: "backfill", file: row.backfill.file, sha256: "0".repeat(64), until: at("2026-09-17T20:00:00Z"), loadedAt: at("2026-09-17T20:00:30Z") }
        : { kind: "fresh" },
      lastReport: null,
      operator: Object.fromEntries(["USDC-GBP", "USDT-GBP"].map((b) => [b, { cid: null, at: e.start, gbp: spec.capitalGbp / 4, sent: 1, done: true }])),
      days: { "2026-09-16": 6, "2026-09-17": 18 },
    },
  };
  starts[row.id] = e.start;
  sims[row.id] = sim;
  const mem = memDb(twinFixtureTables(live, spec, sim), { now: () => NOW });
  twins.push(await readQuotesTwin(mem.db, { ...spec, start: at(e.start) }, NOW, DAY, live.tickers));
}
if (twins.some((t) => t == null)) throw new Error("a twin read nothing");

const named = rows.map((r) => `"${r.display_name}" (\`${r.id}\`, £${Number(r.capital_gbp).toLocaleString("en-GB")})`).join(", ");
const about = "The realistic twins' rows as the dashboard serves them (`readQuotesTwin`), made by " +
  "docs/agents/backtests/twins/scripts/fixture.ts from the twins' spec rows (`specs`), in the page's order: " + named + ". Each is the " +
  "live quotes fixture's book (quotes_live_fixture.json: no real balance or fill) run as its tables at its capital, beside " +
  "a driver state of its engine's (`sims`: its account, mode, turns, replica check, backfill and orders sent each day, with " +
  "its operator's quarter of its capital), its start (`starts`) moved before the browser test's clock, 2026-09-17 23:00 " +
  "UTC. `twins` is the function's answer, which the agents function's test asserts and the browser test serves.";
const out = { about, nowMs: NOW, dayStartMs: DAY, specs: rows, starts, sims, twins: JSON.parse(JSON.stringify(twins)) };
await Deno.writeTextFile(new URL("quotes_twin_fixture.json", E2E), JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify({ twins: rows.map((r) => r.id) }));
