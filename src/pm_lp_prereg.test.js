// The live-prep pre-registration (docs/agents/reviews/2026-10-04-polymarket-lp-prereg.md) freezes two statements by
// sha256: its day-1 check and its live readout (docs/agents/backtests/pmlp/lp_*.sql). A statement edited after the
// window opened would read the run on terms nobody pre-registered: this fails on any change to them, on a window that is
// not the document's, on a write, on a read of another test's tables where the document allows none, and on a rule the
// code, the migration and the document do not share (5N, $100 a market, x2's pause, no weather market, ten markets and
// $200, the −$75 stop on the fills and what was paid, no day stop).
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC = fs.readFileSync(path.join(ROOT, 'docs/agents/reviews/2026-10-04-polymarket-lp-prereg.md'), 'utf8');
const read = (f) => fs.readFileSync(path.join(ROOT, 'docs/agents/backtests/pmlp', f));
const FILES = ['lp_check.sql', 'lp_readout.sql'];
const sqlOf = (f) => read(f).toString('utf8').replace(/--[^\n]*/g, '');
/** Every table a statement names after FROM or JOIN, schema-qualified. */
const tablesOf = (sql) => [...new Set([...sql.matchAll(/\b(?:from|join)\s+public\.([a-z_]+)/g)].map((m) => m[1]))].sort();
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('the live-prep pre-registration', () => {
  it.each(FILES)('names the sha256 of %s, and the statement is that file', (f) => {
    const named = new RegExp('`(?:[\\w./-]*/)?' + f.replace('.', '\\.') + '` sha256\\s+`([0-9a-f]{64})`').exec(DOC)?.[1];
    expect(named).toMatch(/^[0-9a-f]{64}$/);
    expect(crypto.createHash('sha256').update(read(f)).digest('hex')).toBe(named);
  });

  it.each(FILES)('%s is one read-only statement', (f) => {
    const sql = sqlOf(f);
    expect(sql).not.toMatch(/\b(insert|update|delete|alter|drop|create|truncate|grant|revoke|copy|call|do)\b/i);
    expect(sql.replace(/'(?:[^']|'')*'/g, "''").trim().replace(/;\s*$/, '')).not.toContain(';');
    expect(sql.trim()).toMatch(/^with\b/);
  });

  it("reads the document's window: d1, the first full UTC day after pm_lp_config.created_at", () => {
    expect(DOC).toContain('**d1 is the first full UTC day after `pm_lp_config.created_at`**');
    expect(sqlOf('lp_check.sql')).toContain("(date_trunc('day', c.created_at at time zone 'utc') + interval '1 day')");
    expect(sqlOf('lp_check.sql')).toContain("x.w0 + interval '1 day' as w1");
    expect(sqlOf('lp_check.sql')).toContain('from public.pm_lp_config c where c.id = 1');
  });

  it("reads live-prep's own tables and ops_errors; of the others, only mini-pool's and mid-pool's arms, in (f)", () => {
    expect(tablesOf(sqlOf('lp_check.sql'))).toEqual(['ops_errors', 'pm_live_config', 'pm_lp_config', 'pm_lp_events', 'pm_lp_markets', 'pm_lp_minutes', 'pm_lp_orders',
      'pm_lp_state', 'pm_lpprep_days', 'pm_lpprep_state', 'pm_mid_config']);
    expect(tablesOf(sqlOf('lp_readout.sql'))).toEqual(['pm_lp_fills', 'pm_lp_orders', 'pm_lp_reward_days', 'pm_lp_state']);
    for (const f of FILES) expect(sqlOf(f), f).not.toMatch(/pm_rwc?_|pm_prep_|pm_midprep_/);
    expect([...sqlOf('lp_check.sql').matchAll(/public\.pm_(live|mid)_config/g)].length).toBe(2);
    expect(sqlOf('lp_check.sql')).toContain('live_confirmed_at is not null');
  });

  it("names the code it froze, the path's, the layer's and live-prep's instance, and the migration, each by a sha256", () => {
    for (const f of ['pm_live.ts', 'pm_prep.ts', 'pm_lp.ts', '0091_pm_lp.sql']) expect(DOC).toMatch(new RegExp('`' + f.replace('.', '\\.') + '` sha256\\s+`[0-9a-f]{64}`'));
    // The migration is named by its bytes: 0091 is applied once, and a different file would be a different test.
    const mig = /`0091_pm_lp\.sql` sha256\s+`([0-9a-f]{64})`/.exec(DOC)?.[1];
    expect(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'supabase/migrations/0091_pm_lp.sql'))).digest('hex')).toBe(mig);
  });

  it('shares its rules between the code, the migration, the check and the document', () => {
    const lp = src('supabase/functions/agents/pm_lp.ts'), mig = src('supabase/migrations/0091_pm_lp.sql');
    expect(lp).toContain('export const PM_LP_INV_CAP = 5;');
    expect(lp).toContain('export const PM_LP_CAP_MARKET_USD = 100;');
    expect(lp).toContain('export const PM_LP_PAUSE = { cents: 15, minutes: 60 } as const;');
    expect(lp).toContain('export const PM_LP_CANDIDATE: PmCandidateRules = { endHorizon: false, excludeFeeTypes: ["weather_fees"] };');
    expect(lp).toContain('export const PM_LP_BAND = { floor: RW_MIN_RATE, ceiling: Infinity } as const;');
    expect(mig).toContain('cap_market_usd      numeric not null default 100 check (cap_market_usd > 0 and cap_market_usd <= 100)');
    expect(mig).toContain('loss_day_usd        numeric check (loss_day_usd is null)');
    expect(mig).toContain('loss_total_usd      numeric not null default 75 check (loss_total_usd > 0 and loss_total_usd <= 75)');
    expect(mig).toContain('320, 100, null, 75, 6000, 600, 10, 200');
    expect(mig).toContain('reward_rate    numeric not null check (reward_rate >= 10),');
    expect(DOC).toContain('**5N** its way (RW\'s 3N)');
    expect(DOC).toContain('**$100 a market**');
    expect(DOC).toContain('at most **10 markets\nwithin $200**');
    expect(DOC).toContain('**No day stop**');
    expect(DOC).toContain('no market of Gamma\'s fee type `weather_fees`');
    expect(sqlOf('lp_check.sql')).toContain('5 * od.n - 1e-9');
    expect(sqlOf('lp_check.sql')).toContain('d.scored >= 0.60 * d.rows');
    expect(sqlOf('lp_check.sql')).toContain('e.pnl_day_r40 > -25');
    expect(sqlOf('lp_check.sql')).toContain('f.pusd >= 81');
  });

  it("says RW-C's markets stay in on Davies' own words, and that live-prep arms only on his", () => {
    expect(DOC).toContain('不考虑其他一切因素');
    expect(DOC).toContain('目前上线live的最大candidate是这个live-prep策略');
    expect(DOC).toMatch(/Live-prep goes live only in the\s+conversation where he\s+says go/);
  });
});
