// "Stablecoin quotes variant-3" (`take50wk`; docs/agents/reviews/2026-10-18-revx-weekend-prereg.md): variant-2 (TAKE's twin)
// with PR5-W's weekend rule. Its spec row as 0130 inserts it (variant-2's but for its id, name, place, tables, lease, start,
// second rule, backfill and pre-registration), the row the pre-registration shows, its window's first minute a closure's, and the
// files the pre-registration froze, by sha256.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p));
const sha = (p) => crypto.createHash('sha256').update(read(p)).digest('hex');
const rowsOf = (f) => JSON.parse(/null::public\.agent_quote_twin_specs, \$json\$(\[[\s\S]*?\])\$json\$/.exec(read(`supabase/migrations/${f}`).toString('utf8').replace(/--[^\n]*/g, ''))?.[1] ?? '[]');
const ROW = rowsOf('0130_quote_twin_take50wk.sql').find((r) => r.id === 'take50wk');
const TAKE50 = rowsOf('0089_quote_twin_take50.sql').find((r) => r.id === 'take50');
const DOC = read('docs/agents/reviews/2026-10-18-revx-weekend-prereg.md').toString('utf8');

describe('variant-3, variant-2 with the weekend rule', () => {
  it("is a row of 0130: variant-2's (with 0090's take.from) but for its id, name, place, tables, lease, start, weekend rule, backfill and pre-registration", () => {
    expect(ROW).toEqual({
      ...TAKE50, id: 'take50wk', display_name: 'Stablecoin quotes variant-3', display_order: 35, table_prefix: 'agent_quote_twin_take50wk', lease: 'quotes-twin-take50wk',
      start: '2026-10-19T00:00:00Z', rules: { take: { from: '2026-10-04T16:00:00Z' }, weekend: { from: '2026-10-23T21:00:00Z' } }, backfill: null,
      prereg: 'docs/agents/reviews/2026-10-18-revx-weekend-prereg.md', migration: '0130',
    });
    // The rule starts at a closure's first minute (a Friday, 21:00 UTC), after the twin's start, as the window does.
    const from = new Date(ROW.rules.weekend.from);
    expect([from.getUTCDay(), from.getUTCHours(), from.getUTCMinutes()]).toEqual([5, 21, 0]);
    expect(from.getTime()).toBeGreaterThan(Date.parse(ROW.start));
    // The pre-registration shows the row as the migration inserts it, and is frozen.
    expect(JSON.parse(/```json\n(\{[^\n]*\})\n```/.exec(DOC)?.[1] ?? 'null')).toEqual(ROW);
    expect(DOC).toContain('**Status: FROZEN**');
  });

  it('names the sha256 of each file it froze, once, and each file is that one, as its deviation 1 left it', () => {
    const named = (f) => [...DOC.matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);
    // Deviation 1 (2026-10-21, its §7): the driver and the simulated account gain LIVE's fill rule (a twin rule this twin does not
    // name) and the validation's replay of LIVE's operations. §5 keeps the hashes they were frozen at; §7 names them as they are.
    // Deviation 2 (2026-10-27): the driver gains PR5-OPT's rules weights and holdMin; it names the driver as it is.
    const before = {
      'supabase/functions/agents/quotes_twin.ts': ['fd4b6f992ea7c094c97759933fb714b49d81dcf60756dee18fee4860525a1524', '36092d7f506565d5c89d11ea389d569e2106f738768d1a7450f4e3e39595c3d7'],
      'supabase/functions/agents/revx_sim.ts': ['4b8f99e925f0ba6e05e188554e4b6bf8a43eead0aaec0b5d946a65664361f8aa'],
    };
    for (const f of [
      'supabase/migrations/0130_quote_twin_take50wk.sql', 'supabase/functions/agents/quotes_weekend.ts', 'supabase/functions/agents/quotes_twin.ts',
      'supabase/functions/agents/revx_sim.ts', 'docs/agents/backtests/wk3/scripts/read.ts', 'docs/agents/backtests/wk3/sql/export.sql',
    ]) expect(named(f), f).toEqual(before[f] ? [...before[f], sha(f)] : [sha(f)]);
  });
});
