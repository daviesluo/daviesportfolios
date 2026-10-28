// LIVE's rules at £300 and £600 (`live300`, "Stablecoin quotes LIVE twin"; `live600`, "Stablecoin quotes variant-1";
// docs/agents/reviews/2026-10-26-live-size-twins-prereg.md), and what 0141 does to the £120 LIVE twin (`live`, now
// "variant-2", its pre-registration's deviation 1). Their rows as 0141 inserts them (the £120 twin's but for the id, name, place,
// capital, tables, lease, start, rules, backfill and pre-registration), the rows the pre-registration shows, and the files it
// froze, by sha256.
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
const M = '0141_quote_twins_relayout.sql';
const LIVE = rowsOf('0136_quote_twin_live.sql').find((r) => r.id === 'live');
const DOC = read('docs/agents/reviews/2026-10-26-live-size-twins-prereg.md').toString('utf8');
const LIVE_DOC = read('docs/agents/reviews/2026-10-21-live-twin-prereg.md').toString('utf8');
const RULES = { fill: { model: 'at', from: '2026-10-27T00:00:00Z' }, weekend: { from: '2026-10-30T21:00:00Z' } };

describe("the size twins on LIVE's rules", () => {
  it("are rows of 0141: the £120 LIVE twin's but for id, name, place, capital, tables, lease, start, rules, backfill and pre-registration", () => {
    const rows = rowsOf(M);
    const want = (id, display_name, display_order, capital_gbp) => ({
      ...LIVE, id, display_name, display_order, capital_gbp, table_prefix: `agent_quote_twin_${id}`, lease: `quotes-twin-${id}`,
      start: '2026-10-27T00:00:00Z', rules: RULES, backfill: null, prereg: 'docs/agents/reviews/2026-10-26-live-size-twins-prereg.md', migration: '0141',
    });
    expect(rows).toEqual([want('live300', 'Stablecoin quotes LIVE twin', 11, 300), want('live600', 'Stablecoin quotes variant-1', 12, 600)]);
    // Their weekend begins at a closure's first minute (a Friday, 21:00 UTC), after their start; neither takes (LIVE's take is in
    // shadow, which sends nothing).
    const from = new Date(RULES.weekend.from);
    expect([from.getUTCDay(), from.getUTCHours(), from.getUTCMinutes()]).toEqual([5, 21, 0]);
    expect(from.getTime()).toBeGreaterThan(Date.parse('2026-10-27T00:00:00Z'));
    for (const r of rows) expect('take' in r.rules, r.id).toBe(false);
    // The pre-registration shows each row as the migration inserts it, and is frozen.
    const shown = [...DOC.matchAll(/```json\n(\{[^\n]*\})\n```/g)].map((m) => JSON.parse(m[1]));
    expect(shown).toEqual(rows);
    expect(DOC).toContain('**Status: FROZEN**');
  });

  it('gives the £120 twin the same weekend from the same closure, guarded, and records it as its deviation 1', () => {
    expect(sqlOf(M)).toContain(`set rules = rules || '{"weekend": {"from": "2026-10-30T21:00:00Z"}}'::jsonb\n where id = 'live' and not (rules ? 'weekend');`);
    expect(LIVE_DOC).toContain('**Deviation 1 (2026-10-26)');
    expect(LIVE_DOC).toContain('2026-10-23 21:00 → 10-25 21:00 UTC are left out of both records');
  });

  it('switches variant-3 off and hides the four that stop at their readings, and touches no live config', () => {
    const sql = sqlOf(M);
    expect(sql).toContain("set enabled = false\n where id = 'take50wk';");
    expect(sql).toContain("set hidden = true\n where id in ('pr5', 'p50', 'take50', 'd');");
    expect(/agent_quote_live_config|edge_calls|take_mode|weekend_mode/.test(sql)).toBe(false);
    expect(fs.existsSync(path.join(ROOT, 'docs/agents/reviews/2026-10-26-variant3-withdrawn.md'))).toBe(true);
  });

  it('names the sha256 of each file it froze, once, and each file is that one, as its deviation 3 left it', () => {
    // Its deviation (2026-10-27): the driver gains PR5-OPT's rules weights and holdMin; §5 keeps the hash it was frozen at and the
    // deviation names it as it is.
    const before = { 'supabase/functions/agents/quotes_twin.ts': ['36092d7f506565d5c89d11ea389d569e2106f738768d1a7450f4e3e39595c3d7', '015f3af08ba852c372e6b0a9f9d6815999731bd3322e03c8b5f944cdac8f4544'] };
    const named = (f) => [...DOC.matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);
    for (const f of [
      `supabase/migrations/${M}`, 'supabase/functions/agents/quotes_twin.ts', 'supabase/functions/agents/revx_sim.ts',
      'supabase/functions/agents/quotes_weekend.ts',
    ]) expect(named(f), f).toEqual(before[f] ? [...before[f], sha(f)] : [sha(f)]);
  });
});
