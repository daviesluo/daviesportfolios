// "Stablecoin quotes with Euros - 2" (the weekend variant of the Coinbase paper test; docs/agents/reviews/2026-10-13-coinbase-weekend-prereg.md,
// supabase/functions/agents/cb_hold.ts, migration 0118): the frozen files are the files, the migration's tables are 0112's shapes
// under their own names, and the pre-registration's numbers are the code's and the script's.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
const MANIFEST = JSON.parse(read('docs/agents/backtests/cbwk/MANIFEST.json'));
const PREREG = read('docs/agents/reviews/2026-10-13-coinbase-weekend-prereg.md');
const sql = (f) => read(`supabase/migrations/${f}`).replace(/--[^\n]*/g, '');
const table = (text, name) => new RegExp(`create table if not exists public\\.${name} \\(([\\s\\S]*?)\\n\\);`).exec(text)?.[1].replace(/\s+/g, ' ').trim();

describe('the weekend variant of the Coinbase paper test', () => {
  it('has the files it froze: this arm\'s, and the base test\'s as they were', () => {
    const groups = Object.entries(MANIFEST.frozen);
    expect(groups.map(([g]) => g)).toEqual(["the base test's, unchanged by 0118", "this arm's"].sort());
    for (const [, files] of groups) {
      expect(Object.keys(files).length).toBeGreaterThan(5);
      for (const [p, h] of Object.entries(files)) expect([p, sha(p)]).toEqual([p, h]);
    }
    // The pre-registration names every one of this arm's files.
    for (const p of ['cb_hold.ts', 'cb_hold.test.ts', '0118_cb_hold.sql', 'replay_wk.py']) expect(PREREG).toContain(p);
    for (const [p, h] of Object.entries(MANIFEST.files)) expect([p, sha(`docs/agents/backtests/cbwk/${p}`)]).toEqual([p, h.sha256]);
  });

  it("has 0112's paper-test tables under the prefix cb_hold_, column for column", () => {
    const base = sql('0112_cb_recorder_paper.sql'), mine = sql('0118_cb_hold.sql');
    for (const t of ['state', 'events', 'trips', 'minutes']) {
      const a = table(base, `cb_quote_${t}`), b = table(mine, `cb_hold_${t}`);
      expect(a, t).toBeTruthy();
      expect(b, t).toBe(a);
    }
    // The days view is 0112's over its own tables.
    const view = (text, n) => new RegExp(`create or replace view public\\.${n}_days with \\(security_invoker = true\\) as([\\s\\S]*?);\\n`).exec(text)?.[1].replace(/\s+/g, ' ').replace(new RegExp(`${n}_(events|trips)`, 'g'), '$1');
    expect(view(mine, 'cb_hold')).toBe(view(base, 'cb_quote'));
    expect(mine).not.toContain('cb_quote');
    expect(mine).not.toMatch(/\b(cb_trades|cb_touch|cb_rec_state)\b/);
  });

  it("holds the rate bar for the 60 hours the pre-registration says, and the script keeps the base test's ten minutes and the seed", () => {
    const mod = read('supabase/functions/agents/cb_hold.ts');
    expect(/^export const CB_HOLD_MS = 60 \* H;$/m.test(mod)).toBe(true);
    expect(PREREG).toMatch(/\*\*The change: a rate bar is used for up to 60 hours after it started, not ten minutes\.\*\*/);
    expect(mod).toContain('QUOTE_FX_LOOKBACK_MS');
    const py = read('docs/agents/backtests/cbwk/scripts/replay_wk.py');
    expect(py).toContain('BASE_DARK_MS = 10 * M');
    const seed = /^SEED = (\d+)/m.exec(py)?.[1];
    expect(seed).toBe('20261113');
    expect(PREREG).toContain(`random.Random(${seed})`);
    expect(py).toContain('WINDOW_DAYS = 28');
    // The tolerances are the base test's (replay.py), 5 % and 10 %.
    expect(py).toContain('within(tot["replay_trips"], tot["engine_trips"], 0.05)');
    expect(py).toContain('within(tot["replay_ccy"], tot["engine_ccy"], 0.10)');
    // The call and the name.
    expect(mod).toContain('export const CB_HOLD_ROW_NAME = "Stablecoin quotes with Euros - 2";');
    expect(PREREG).toContain('**"Stablecoin quotes with Euros - 2"**');
  });

  it("starts at the first 00:00 UTC after its first run, and the pre-registration's table of starts is that rule", () => {
    const day = 86400e3;
    const start = (now) => (Math.floor(now / day) + 1) * day;
    const at = (s) => Date.parse(`${s}T00:00:00Z`);
    // First run before 10-14 .. 10-17 00:00 gives the start in its row, four whole weekends up to 10-16 and three from 10-17.
    for (const [before, from, end, weekends] of [['2026-10-14', '2026-10-14', '2026-11-11', 4], ['2026-10-15', '2026-10-15', '2026-11-12', 4], ['2026-10-16', '2026-10-16', '2026-11-13', 4], ['2026-10-17', '2026-10-17', '2026-11-14', 3]]) {
      expect(start(at(before) - 1000)).toBe(at(from));
      expect(PREREG).toContain(`| ${from === '2026-10-16' ? '**' : ''}${from}`);
      expect(new Date(at(from) + 28 * day).toISOString().slice(0, 10)).toBe(end);
      // Friday 22:00 to Sunday 23:00 UTC of the weekends 10-16, 10-23, 10-30 and 11-06 that lie inside [from, end).
      let whole = 0;
      for (const fri of ['2026-10-16', '2026-10-23', '2026-10-30', '2026-11-06']) {
        const a = at(fri) + 22 * 3600e3, monday = at(fri) + 3 * day;
        if (a > at(from) && monday <= at(end)) whole++;
      }
      expect([from, whole]).toEqual([from, weekends]);
    }
  });
});
