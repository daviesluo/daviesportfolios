// "Stablecoin quotes variant-7" and its control (0169; docs/agents/reviews/2026-10-29-revx-usdc-nudge-twin-prereg.md): the rows
// the pre-registration shows are the migration's, the two differ only by the nudge, the files it froze are those files by
// sha256, and its bar is as written.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p));
const sha = (p) => crypto.createHash('sha256').update(read(p)).digest('hex');
const M = '0169_quote_twin_usdc_nudge.sql';
const sqlOf = (f) => read(`supabase/migrations/${f}`).toString('utf8').replace(/--[^\n]*/g, '');
const rowsOf = (f) => JSON.parse(/null::public\.agent_quote_twin_specs, \$json\$(\[[\s\S]*?\])\$json\$/.exec(sqlOf(f))?.[1] ?? '[]');
const DOC = read('docs/agents/reviews/2026-10-29-revx-usdc-nudge-twin-prereg.md').toString('utf8');
const named = (f) => [...DOC.matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);

describe("variant-7's pre-registration", () => {
  it('shows the rows 0169 inserts, frozen; the two are the same but for the nudge, its id, name, place, tables, lease and hiding', () => {
    const rows = rowsOf(M);
    const shown = [...DOC.matchAll(/```json\n(\{[^\n]*\})\n```/g)].map((m) => JSON.parse(m[1]));
    expect(shown).toEqual(rows);
    expect(DOC).toContain('**Status: FROZEN**');
    const [nu, ctl] = rows;
    expect([nu.id, nu.display_name, nu.hidden, ctl.id, ctl.hidden]).toEqual(['u300nudge', 'Stablecoin quotes variant-7', false, 'u300ctl', true]);
    const { fairNudge, ...nuRules } = nu.rules;
    expect(nuRules).toEqual(ctl.rules);
    expect(fairNudge).toEqual({ from: nu.start, book: 'USDC-GBP', w: 0.5, halfLifeMin: 1440 });
    const strip = (r) => ({ ...r, id: null, display_name: null, display_order: null, table_prefix: null, lease: null, hidden: null, rules: null });
    expect(strip(nu)).toEqual(strip(ctl));
    // $300 at the fixed rate, to the penny; six rungs of £37.55 on USDC-GBP alone; from 2026-10-30 00:00 UTC, no backfill.
    expect(Math.round((300 / 1.3314) * 100) / 100).toBe(nu.capital_gbp);
    expect(Math.floor((nu.capital_gbp / 6) * 100) / 100).toBe(37.55);
    expect([nu.start, nu.backfill, nu.rules.weights.book]).toEqual(['2026-10-30T00:00:00Z', null, { 'USDC-GBP': 1, 'USDT-GBP': 0 }]);
  });

  it('makes its tables and the nudge record, and touches no live table, capital, call or other twin', () => {
    const sql = sqlOf(M);
    for (const id of ['u300nudge', 'u300ctl']) expect(sql).toContain(`select public.create_quote_twin_tables('${id}');`);
    expect(sql).toContain('create table if not exists public.agent_quote_twin_nudge');
    expect(sql).toContain('alter table public.agent_quote_twin_nudge enable row level security;');
    expect(/capital_gbp\s*=|agent_quote_live_config|edge_calls|take_mode|weekend_mode|cron\.|\bgrant\b|create policy/i.test(sql)).toBe(false);
  });

  it('names the sha256 of each file it froze, once, and each file is that one', () => {
    for (const f of [
      `supabase/migrations/${M}`, 'supabase/functions/agents/quotes_nudge.ts', 'supabase/functions/agents/quotes_twin.ts',
      'supabase/functions/agents/quotes_live.ts', 'supabase/functions/agents/revx_sim.ts', 'supabase/functions/agents/quotes_weekend.ts',
    ]) expect(named(f), f).toEqual([sha(f)]);
  });

  it('holds its bar and its comparison as written', () => {
    for (const w of [
      'The bar: PASS when the mean is above 0 and the share at or below 0 is under 0.10.', 'seed 20261127', 'circular 3-day block bootstrap',
      '2026-10-30 00:00 → 2026-11-27 00:00', 'about +1.28 bps of capital a day', '24-hour half-life', 'f′ = f × (1 + 0.5 × dev)',
      'The control is the comparison.',
    ]) expect(DOC).toContain(w);
  });
});
