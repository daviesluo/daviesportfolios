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
 * A page name a later migration gave a row (0108: rule D's twin, "variant-3" to "variant-4", Davies 2026-10-09), each
 * `update … set display_name = '<new>' where id = '<id>' and display_name = '<old>'` in the migrations' order;
 * src/twin_specs.test.js reads them the same way. spec_rows.ts (frozen with p50's pre-registration) returns the rows as
 * first inserted; this makes them the rows as they stand.
 */
const RENAME = /update public\.agent_quote_twin_specs\s+set display_name = '([^']+)'\s+where id = '(\w+)' and display_name = '([^']+)';/g;
const MIGRATIONS = new URL("../../../../../supabase/migrations/", import.meta.url);
const renamed = async <T extends { id: string; display_name: string }>(rows: T[]): Promise<T[]> => {
  const files: string[] = [];
  for await (const e of Deno.readDir(MIGRATIONS)) if (e.isFile && /^\d{4}_.*\.sql$/.test(e.name)) files.push(e.name);
  for (const f of files.sort()) {
    const sql = (await Deno.readTextFile(new URL(f, MIGRATIONS))).replace(/--[^\n]*/g, "");
    for (const [, to, id, from] of sql.matchAll(RENAME)) for (const r of rows) if (r.id === id && r.display_name === from) r.display_name = to;
  }
  return rows;
};
const rows = (await renamed(await specRowsOfMigrations())).filter((r) => r.enabled);
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
