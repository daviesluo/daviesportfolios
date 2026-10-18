// Migration 0132 keeps Coinbase's prints 40 days as `cb_print_minutes` (prints summed by second, price and aggressor side,
// a row per book and minute), rebuilt from `cb_trades` by a SQL function pg_cron runs. Its aggregation was checked on
// production on 2026-10-18 (read-only, before it applied): run as `docs/agents/backtests/cbbooks/sql/verify_print_minutes.sql`
// it reproduced the database md5 of every one of CBBOOKS-1's five print pulls (`cbbooks/MANIFEST.json`, 202,273 groups).
// These pins keep that check meaning something: the migration's aggregation must stay the one that was verified, the table
// stays closed to the anon key, and the build can never reach back past what `cb_trades` holds.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const strip = (s) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
const MIG = strip(fs.readFileSync(path.join(ROOT, 'supabase/migrations/0132_cb_print_minutes.sql'), 'utf8'));
const VERIFY = strip(fs.readFileSync(path.join(ROOT, 'docs/agents/backtests/cbbooks/sql/verify_print_minutes.sql'), 'utf8'));
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/agents/backtests/cbbooks/MANIFEST.json'), 'utf8'));

/** The text between two markers, both included. */
function cut(s, from, to) {
  const i = s.indexOf(from);
  const j = s.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error(`missing ${from} … ${to}`);
  return s.slice(i, j + to.length);
}

describe('0132 cb_print_minutes', () => {
  it('aggregates exactly as the query verified against CBBOOKS-1\'s pulls', () => {
    const select = (s) => cut(s, "select t.product, date_trunc('minute', t.ts) mi", 'from public.cb_trades t');
    const group = (s) => cut(s, 'group by 1, 2, 3, 4, 5 ), r as (', 'from g group by 1, 2 )');
    expect(select(MIG)).toBe(select(VERIFY));
    expect(group(MIG)).toBe(group(VERIFY));
    // the five pulls it reproduced, by the database's own md5
    expect(Object.keys(MANIFEST.pulls).filter((k) => k.startsWith('trades_')).map((k) => MANIFEST.pulls[k].md5_db).sort()).toEqual([
      '3b81525338ec46298a870372f99bf5c0', '4996b4c8e724a3e29c707ff94ff114fe', 'e68fb12ee4bb42b5d35cd8865c6c9c40',
      'e6a5b0c6d6eed9e119579182dca10c87', 'efd5f2fe72fac54ff298cd5f6eaa5fd5',
    ]);
  });

  it('keeps the price steps of cb_book_levels and the stored (aggressor) side', () => {
    expect(MIG).toContain("case when t.product = 'USDT-EUR' then 0.00001 else 0.0001 end");
    expect(MIG).toContain("t.side = 'buy' b");
  });

  it('never overwrites a minute the cb_trades prune may have cut, and never deletes from the build', () => {
    expect(MIG).toContain("date_trunc('minute', f.ts) + interval '1 minute'");
    expect(MIG).toContain("greatest(date_trunc('minute', p_from), f.t)");
    const fn = cut(MIG, 'create or replace function public.cb_print_minutes_build', '$fn$;');
    expect(fn).not.toMatch(/\bdelete\b/i);
    expect(fn).toContain('is distinct from');
  });

  it('is closed to the anon key: RLS on, no grant, the function not callable by it', () => {
    expect(MIG).toContain('alter table public.cb_print_minutes enable row level security');
    expect(MIG).toContain('revoke all on public.cb_print_minutes from anon, authenticated');
    expect(MIG).toContain('revoke all on function public.cb_print_minutes_build(timestamptz, timestamptz) from public, anon, authenticated');
    expect(MIG).not.toMatch(/\bgrant\b/i);
    expect(MIG).not.toMatch(/create policy/i);
  });

  it('rebuilds the last six hours every ten minutes and keeps 40 days', () => {
    expect(MIG).toContain("'cb-print-minutes-build', '4-59/10 * * * *', $cron$select public.cb_print_minutes_build(now() - interval '6 hours', now() - interval '2 minutes');$cron$");
    expect(MIG).toContain("delete from public.cb_print_minutes where minute < now() - interval '40 days'");
  });
});
