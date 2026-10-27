// LIVE's next size on LIVE's rules (`live1200`, "Stablecoin quotes variant-1"; docs/agents/reviews/2026-10-27-live-next-size-prereg.md),
// and what 0144 does to the two size twins (the size twins' pre-registration's deviation 1): its row as 0144 inserts it (the £600
// twin's but for the id, name, place, capital, tables, lease, start, rules' fill date and pre-registration), the row the
// pre-registration shows, and the files it froze, by sha256.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p));
const sha = (p) => crypto.createHash('sha256').update(read(p)).digest('hex');
const sqlOf = (f) => read(`supabase/migrations/${f}`).toString('utf8').replace(/--[^\n]*/g, '');
const rowsOf = (f) => JSON.parse(/null::public\.agent_quote_twin_specs, \$json\$(\[[\s\S]*?\])\$json\$/.exec(sqlOf(f))?.[1] ?? '[]');
const M = '0144_quote_twins_live_at_600.sql';
const BASE = rowsOf('0141_quote_twins_relayout.sql').find((r) => r.id === 'live600');
const DOC = read('docs/agents/reviews/2026-10-27-live-next-size-prereg.md').toString('utf8');
const SIZE_DOC = read('docs/agents/reviews/2026-10-26-live-size-twins-prereg.md').toString('utf8');

describe("LIVE's next size, £1,200 on LIVE's rules", () => {
  it("is the one row of 0144: the £600 twin's but for id, name, place, capital, tables, lease, start, fill date and pre-registration", () => {
    const rows = rowsOf(M);
    expect(rows).toEqual([{
      ...BASE, id: 'live1200', display_name: 'Stablecoin quotes variant-1', display_order: 13, capital_gbp: 1200,
      table_prefix: 'agent_quote_twin_live1200', lease: 'quotes-twin-live1200', start: '2026-10-28T00:00:00Z',
      rules: { fill: { model: 'at', from: '2026-10-28T00:00:00Z' }, weekend: BASE.rules.weekend },
      prereg: 'docs/agents/reviews/2026-10-27-live-next-size-prereg.md', migration: '0144',
    }]);
    // £100 a rung: twelve rungs, both books, both sides, three a side; no take.
    expect(rows[0].capital_gbp / 12).toBe(100);
    expect('take' in rows[0].rules).toBe(false);
    // The pre-registration shows the row as the migration inserts it, and is frozen.
    const shown = [...DOC.matchAll(/```json\n(\{[^\n]*\})\n```/g)].map((m) => JSON.parse(m[1]));
    expect(shown).toEqual(rows);
    expect(DOC).toContain('**Status: FROZEN**');
  });

  it("renames the £600 twin the LIVE twin and switches the £300 twin off, resizing none, and records it as the size twins' deviation 1", () => {
    const sql = sqlOf(M);
    expect(sql).toContain("set display_name = 'Stablecoin quotes LIVE twin'\n where id = 'live600' and display_name = 'Stablecoin quotes variant-1';");
    expect(sql).toContain("set enabled = false\n where id = 'live300';");
    expect(/capital_gbp\s*=|agent_quote_live_config|edge_calls|take_mode|weekend_mode/.test(sql)).toBe(false);
    expect(SIZE_DOC).toContain('**Deviation 1 (2026-10-27)');
    expect(SIZE_DOC).toContain('我已经加到600了');
  });

  it('names the sha256 of each file it froze, once, and each file is that one', () => {
    const named = (f) => [...DOC.matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);
    for (const f of [
      `supabase/migrations/${M}`, 'supabase/functions/agents/quotes_twin.ts', 'supabase/functions/agents/revx_sim.ts',
      'supabase/functions/agents/quotes_weekend.ts',
    ]) expect(named(f), f).toEqual([sha(f)]);
  });
});
