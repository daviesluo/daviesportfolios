// The mid-pool pre-registration (docs/agents/reviews/2026-10-02-polymarket-mid-pool-prereg.md) freezes three statements
// by sha256: its day-1 check, its fourteen-day readout and its overlap audit (docs/agents/backtests/pmlive/mid_*.sql). A
// statement edited after the window opened would read the run on terms nobody pre-registered: this fails on any change
// to them, on a window that is not the document's, on a write, on a read of another test's tables where the document
// forbids one, and on a margin the code, the check and the document do not share.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC = fs.readFileSync(path.join(ROOT, 'docs/agents/reviews/2026-10-02-polymarket-mid-pool-prereg.md'), 'utf8');
const read = (f) => fs.readFileSync(path.join(ROOT, 'docs/agents/backtests/pmlive', f));
const FILES = ['mid_check.sql', 'mid_readout.sql', 'mid_audit.sql'];
const sqlOf = (f) => read(f).toString('utf8').replace(/--[^\n]*/g, '');
/** Every table a statement names after FROM or JOIN, schema-qualified. */
const tablesOf = (sql) => [...new Set([...sql.matchAll(/\b(?:from|join)\s+public\.([a-z_]+)/g)].map((m) => m[1]))].sort();

describe('the mid-pool pre-registration', () => {
  it.each(FILES)('names the sha256 of %s, and the statement is that file', (f) => {
    const named = new RegExp('`' + f.replace('.', '\\.') + '` sha256 `([0-9a-f]{64})`').exec(DOC)?.[1];
    expect(named).toMatch(/^[0-9a-f]{64}$/);
    expect(crypto.createHash('sha256').update(read(f)).digest('hex')).toBe(named);
  });

  it.each(FILES)('%s is one read-only statement', (f) => {
    const sql = sqlOf(f);
    expect(sql).not.toMatch(/\b(insert|update|delete|alter|drop|create|truncate|grant|revoke|copy|call|do)\b/i);
    // One statement: no `;` outside its string literals but the last.
    expect(sql.replace(/'(?:[^']|'')*'/g, "''").trim().replace(/;\s*$/, '')).not.toContain(';');
    expect(sql.trim()).toMatch(/^with\b/);
  });

  it("reads the document's window: d1, the first full UTC day after pm_mid_config.created_at, and fourteen days from it", () => {
    expect(DOC).toContain('**d1 is the first full UTC day after `pm_mid_config.created_at`**');
    expect(DOC).toContain('**The window is\nfourteen UTC days, d1 00:00 → d15 00:00 UTC.**');
    const d1 = "(date_trunc('day', c.created_at at time zone 'utc') + interval '1 day')";
    for (const f of FILES) expect(sqlOf(f), f).toContain(d1);
    expect(sqlOf('mid_check.sql')).toContain("x.w0 + interval '1 day' as w1");
    for (const f of ['mid_readout.sql', 'mid_audit.sql']) expect(sqlOf(f), f).toContain('generate_series(0, 13) k');
  });

  it("the day-1 check reads mid-pool's tables and ops_errors alone; the readout adds small-pool's paper days and its live record", () => {
    expect(tablesOf(sqlOf('mid_check.sql'))).toEqual(['ops_errors', 'pm_mid_config', 'pm_mid_events', 'pm_mid_markets', 'pm_mid_minutes', 'pm_mid_orders', 'pm_midprep_days', 'pm_midprep_events', 'pm_midprep_state']);
    expect(tablesOf(sqlOf('mid_readout.sql'))).toEqual(['pm_live_minutes', 'pm_live_reward_days', 'pm_mid_config', 'pm_midprep_days', 'pm_prep_days']);
    for (const f of ['mid_check.sql', 'mid_readout.sql']) expect(sqlOf(f), f).not.toMatch(/pm_rwc?_/);
  });

  it("the audit reads RW's and RW-C's selections only from 2026-10-23 00:05 UTC, each behind the clock in a materialized expression", () => {
    const sql = sqlOf('mid_audit.sql');
    expect(tablesOf(sql)).toEqual(['pm_mid_config', 'pm_mid_markets', 'pm_rw_selection', 'pm_rwc_selection']);
    const gate = "where now() >= timestamptz '2026-10-23 00:05:00+00')";
    expect(sql).toContain(`rw as materialized (select r.day, r.cond from public.pm_rw_selection r ${gate}`);
    expect(sql).toContain(`rwc as materialized (select x.day, x.cond from public.pm_rwc_selection x ${gate}`);
    // Every other mention of their tables is one of those two reads.
    expect((sql.match(/pm_rwc?_selection/g) ?? []).length).toBe(2);
    expect(DOC).toContain('no earlier than 2026-10-23 00:05 UTC');
  });

  it('shares one margin between the code, the check and the document: 0.67', () => {
    const code = fs.readFileSync(path.join(ROOT, 'supabase/functions/agents/pm_mid.ts'), 'utf8');
    const margin = /export const PM_MID_EXCLUSION_MARGIN = ([0-9.]+);/.exec(code)?.[1];
    expect(margin).toBe('0.67');
    expect(sqlOf('mid_check.sql')).toContain(`(b_ex.ex->>'margin')::numeric = ${margin}`);
    expect(DOC).toContain(`(\`PM_MID_EXCLUSION_MARGIN\` = ${margin})`);
    expect(DOC).toContain(`\`margin\` ${margin}, \`excluded\` a count`);
  });

  it("names the code it froze: the path's, the layer's and mid-pool's instance, each by a sha256", () => {
    for (const f of ['pm_live.ts', 'pm_prep.ts', 'pm_mid.ts']) expect(DOC).toMatch(new RegExp('`' + f.replace('.', '\\.') + '` sha256 `[0-9a-f]{64}`'));
  });
});
