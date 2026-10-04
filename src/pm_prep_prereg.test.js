// The live-prep pre-registration (docs/agents/reviews/2026-10-01-polymarket-live-prep-prereg.md) freezes its check,
// docs/agents/backtests/pmlive/prep_check.sql, by sha256. A check edited after its window opened would decide a go-live
// on a bar nobody pre-registered: this fails on any change to the file, and on a window that is not the document's.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC = fs.readFileSync(path.join(ROOT, 'docs/agents/reviews/2026-10-01-polymarket-live-prep-prereg.md'), 'utf8');
const SQL = fs.readFileSync(path.join(ROOT, 'docs/agents/backtests/pmlive/prep_check.sql'));
const ADD1 = fs.readFileSync(path.join(ROOT, 'docs/agents/backtests/pmlive/prep_check_addendum1.sql'));
const ADD2 = fs.readFileSync(path.join(ROOT, 'docs/agents/backtests/pmlive/prep_check_addendum2.sql'));
const ADD6 = fs.readFileSync(path.join(ROOT, 'docs/agents/backtests/pmlive/prep_check_addendum6.sql'));

describe('the live-prep pre-registration', () => {
  it('names the sha256 of the check it froze, and the check is that file', () => {
    const named = /`prep_check\.sql` sha256 `([0-9a-f]{64})`/.exec(DOC)?.[1];
    expect(named).toMatch(/^[0-9a-f]{64}$/);
    expect(crypto.createHash('sha256').update(SQL).digest('hex')).toBe(named);
  });

  it("reads the document's window, 2026-10-02 00:00 to 2026-10-03 00:00 UTC, and nothing else", () => {
    expect(DOC).toContain('**2026-10-02 00:00:00 → 2026-10-03 00:00:00 UTC**');
    const sql = SQL.toString('utf8');
    expect(sql).toContain("timestamptz '2026-10-02 00:00:00+00' as w0, timestamptz '2026-10-03 00:00:00+00' as w1, date '2026-10-02' as d");
    // Read-only: one statement, a select, and no statement that writes.
    expect(sql.replace(/--[^\n]*/g, '')).not.toMatch(/\b(insert|update|delete|alter|drop|create|truncate|grant)\b/i);
  });

  // Addendum 1 (Davies, 2026-10-01: "改为现在就开始测试，可以测试今天剩余时间+明天一整天") moved the window to open after
  // today's selection. Its check is a file of its own, frozen the same way; prep_check.sql stays as it was frozen.
  it("names the sha256 of Addendum 1's check, and the check is that file", () => {
    const named = /`prep_check_addendum1\.sql`\*\*, sha256 `([0-9a-f]{64})`/.exec(DOC)?.[1];
    expect(named).toMatch(/^[0-9a-f]{64}$/);
    expect(crypto.createHash('sha256').update(ADD1).digest('hex')).toBe(named);
  });

  it("reads Addendum 1's window, the first full UTC hour after 2026-10-01's selection to 2026-10-03 00:00, and nothing else", () => {
    expect(DOC).toContain("**The window: from the first full UTC hour after 2026-10-01's selection to 2026-10-03 00:00:00 UTC**");
    const sql = ADD1.toString('utf8');
    expect(sql).toContain("w as (select date_trunc('hour', s.at at time zone 'utc') at time zone 'utc' + interval '1 hour' as w0, timestamptz '2026-10-03 00:00:00+00' as w1");
    expect(sql).toContain("where m.day = date '2026-10-01' and m.reward_rate is not null) s)");
    expect(sql.replace(/--[^\n]*/g, '')).not.toMatch(/\b(insert|update|delete|alter|drop|create|truncate|grant)\b/i);
  });

  // Addendum 2 (Davies, 2026-10-02: "现在就切 全功率320刀，并且什么时候上线我说了算不自动转了"): 0080 resized the path
  // inside Addendum 1's window, which ends it as FAIL, so the check moves to the next full UTC day. Its check is the
  // frozen one with the window's dates moved by a day and nothing else, and it arms nothing.
  it("names the sha256 of Addendum 2's check, and the check is that file", () => {
    const named = /`prep_check_addendum2\.sql`\*\*, sha256 `([0-9a-f]{64})`/.exec(DOC)?.[1];
    expect(named).toMatch(/^[0-9a-f]{64}$/);
    expect(crypto.createHash('sha256').update(ADD2).digest('hex')).toBe(named);
  });

  // The instance build (2026-10-02) runs the code this document froze beside today's default instances, minute by
  // minute (supabase/functions/agents/pm_instance.test.ts): the copies it runs are the frozen files, byte for byte.
  it('keeps the path and the layer it froze, byte for byte, as the copies the instance build is checked against', () => {
    const sha = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex');
    const live = /`pm_live\.ts` sha256 `([0-9a-f]{64})`/.exec(DOC)?.[1];
    const prep = /`pm_prep\.ts` sha256 `([0-9a-f]{64})`/.exec(DOC)?.[1];
    expect(live).toMatch(/^[0-9a-f]{64}$/);
    expect(prep).toMatch(/^[0-9a-f]{64}$/);
    expect(sha('supabase/functions/agents/pm_live_frozen.ts')).toBe(live);
    expect(sha('supabase/functions/agents/pm_prep_frozen.ts')).toBe(prep);
  });

  it("reads Addendum 2's window, 2026-10-03 00:00 to 2026-10-04 00:00 UTC, with every bar of the frozen check", () => {
    expect(DOC).toContain('**The window: 2026-10-03 00:00:00 → 2026-10-04 00:00:00 UTC**');
    const sql = ADD2.toString('utf8');
    expect(sql).toContain("w as (select timestamptz '2026-10-03 00:00:00+00' as w0, timestamptz '2026-10-04 00:00:00+00' as w1, date '2026-10-03' as d),");
    expect(sql.replace(/--[^\n]*/g, '')).not.toMatch(/\b(insert|update|delete|alter|drop|create|truncate|grant)\b/i);
    // Line for line the frozen check, but for its header comment and the two lines that name the window's dates.
    const body = (b) => b.toString('utf8').split('\n').filter((l) => !l.startsWith('--'));
    const frozen = body(SQL), moved = body(ADD2);
    expect(moved.length).toBe(frozen.length);
    const differ = frozen.map((l, i) => (l === moved[i] ? null : i)).filter((i) => i !== null);
    expect(differ.length).toBe(2);
    for (const i of differ) expect(moved[i]).toBe(frozen[i].replaceAll('2026-10-03', '2026-10-04').replaceAll('2026-10-02', '2026-10-03'));
  });

  // Addendum 6 (2026-10-04, Davies: "把mini-pool现在就全部修复优化了，dry-run的问题如果影响mid-pool的话也都修复掉"): the formula's
  // measurement fix and mini-pool's book-quality rule, deployed after Addendum 2's window, move the check to the first full
  // UTC day after the deploy. Its check is the frozen one with the window's dates moved and nothing else, and it arms nothing.
  it("names the sha256 of Addendum 6's check, and the check is that file", () => {
    const named = /`prep_check_addendum6\.sql`\*\*, sha256 `([0-9a-f]{64})`/.exec(DOC)?.[1];
    expect(named).toMatch(/^[0-9a-f]{64}$/);
    expect(crypto.createHash('sha256').update(ADD6).digest('hex')).toBe(named);
  });

  it("reads Addendum 6's window, 2026-10-05 00:00 to 2026-10-06 00:00 UTC, with every bar of the frozen check", () => {
    expect(DOC).toContain('**The window: 2026-10-05 00:00:00 → 2026-10-06 00:00:00 UTC**');
    const sql = ADD6.toString('utf8');
    expect(sql).toContain("w as (select timestamptz '2026-10-05 00:00:00+00' as w0, timestamptz '2026-10-06 00:00:00+00' as w1, date '2026-10-05' as d),");
    expect(sql.replace(/--[^\n]*/g, '')).not.toMatch(/\b(insert|update|delete|alter|drop|create|truncate|grant)\b/i);
    // Line for line the frozen check, but for its header comment and the two lines that name the window's dates.
    const body = (b) => b.toString('utf8').split('\n').filter((l) => !l.startsWith('--'));
    const frozen = body(SQL), moved = body(ADD6);
    expect(moved.length).toBe(frozen.length);
    const differ = frozen.map((l, i) => (l === moved[i] ? null : i)).filter((i) => i !== null);
    expect(differ.length).toBe(2);
    for (const i of differ) expect(moved[i]).toBe(frozen[i].replaceAll('2026-10-03', '2026-10-06').replaceAll('2026-10-02', '2026-10-05'));
  });

  it("names the code Addendum 6 deploys, the path's and the layer's, each by a sha256", () => {
    const add6 = DOC.slice(DOC.indexOf('## Addendum 6'));
    expect(add6.length).toBeGreaterThan(100);
    for (const f of ['pm_live.ts', 'pm_prep.ts']) expect(add6).toMatch(new RegExp('`' + f.replace('.', '\\.') + '` sha256 `[0-9a-f]{64}`'));
  });
});
