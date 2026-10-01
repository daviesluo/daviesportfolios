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
});
