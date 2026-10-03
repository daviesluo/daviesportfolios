// The realistic twins' spec rows as the migrations insert them: every row of `agent_quote_twin_specs` written by 0088 or a
// later migration (`jsonb_populate_recordset(null::public.agent_quote_twin_specs, $json$[…]$json$`), the first insert of an
// id winning, as `on conflict (id) do nothing` makes it, in the page's order. The backfill builder and the browser test's
// fixture read them, so a variant a migration adds is built and shown without a line of code; src/twin_specs.test.js
// reads them the same way.

import type { TwinSpecRow } from "../../../../../supabase/functions/agents/quotes_twin.ts";

const MIGRATIONS = new URL("../../../../../supabase/migrations/", import.meta.url);
const INSERT = /jsonb_populate_recordset\(null::public\.agent_quote_twin_specs, \$json\$(\[[\s\S]*?\])\$json\$/g;

export async function specRowsOfMigrations(): Promise<TwinSpecRow[]> {
  const files: string[] = [];
  for await (const e of Deno.readDir(MIGRATIONS)) if (e.isFile && /^\d{4}_.*\.sql$/.test(e.name)) files.push(e.name);
  const rows = new Map<string, TwinSpecRow>();
  for (const f of files.sort()) {
    const sql = (await Deno.readTextFile(new URL(f, MIGRATIONS))).replace(/--[^\n]*/g, "");
    for (const m of sql.matchAll(INSERT)) for (const r of JSON.parse(m[1]) as TwinSpecRow[]) if (!rows.has(r.id)) rows.set(r.id, r);
  }
  return [...rows.values()].sort((a, b) => a.display_order - b.display_order);
}
