// QUEUE's scorer and checks 1-3 (docs/agents/backtests/queue/, committed 2026-10-24) were written after the freeze and
// before the export (2026-11-02) from the frozen pre-registration (docs/agents/reviews/2026-09-28-queue-prereg.md). A
// scorer edited after that would score the window on terms nobody committed to in advance. This fails on any change to
// its files, on a hash the note and the manifest do not share, on a rule constant or bar that is not the
// pre-registration's, and on synthetic runs that did not pass.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
const Q = 'docs/agents/backtests/queue/';
const NOTE = read('docs/agents/reviews/2026-10-24-queue-scorer.md');
const MANIFEST = JSON.parse(read(Q + 'MANIFEST.json'));
const FROZEN = ['qsim.py', 'inputs.py', 'bar.py', 'checks.py', 'score.py', 'test_score.py', 'decode_pages.py', 'grab.py', 'pull_tape.py', 'pull_kraken.py']
  .map((f) => Q + 'scripts/' + f).concat([Q + 'sql/book_pages.sql', Q + 'sql/pr5_records.sql', Q + 'check3.txt', Q + 'test_score.txt']);

describe("QUEUE's scorer and checks 1-3", () => {
  it.each(FROZEN)('the note names the sha256 of %s, the file is that hash, and the manifest agrees', (f) => {
    const named = new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| `([0-9a-f]{64})` \\|').exec(NOTE)?.[1];
    expect(named).toMatch(/^[0-9a-f]{64}$/);
    expect(sha(f)).toBe(named);
    expect(MANIFEST.sha256[f]).toBe(named);
  });

  it("holds the pre-registration's queue rules: 120 s, + 2,000 ms, L + 60 s, five levels, x 1.5, one tick, twice the stop", () => {
    const q = read(Q + 'scripts/qsim.py');
    expect(q).toContain('STALE_MS = 120000 ');
    expect(q).toContain('READ_LAG_MS = 2000 ');
    expect(q).toContain('JOIN_MAX_MS = 60000 ');
    expect(q).toContain('DEPTH = 5');
    expect(q).toContain('mult = 1.5 if cfg.stress else 1.0');
    expect(q).toContain('thr = 1 if cfg.stress else 0');
    expect(q).toContain('taker = (2 * FEE + 2 * cfg.hs) if cfg.stress else (FEE + cfg.hs)');
    expect(q).toContain('fills.append(min(rem, max(0.0, q - A - ahead_rem)))');
    expect(q).toContain('newA.append(max(0.0, A - (q - ahead_fill)))');
  });

  it("holds the pre-registration's window, rungs, fair and bar", () => {
    const i = read(Q + 'scripts/inputs.py');
    expect(i).toContain('W0, HALF, W1 = ms("2026-10-04T00:00"), ms("2026-10-18T00:00"), ms("2026-11-01T00:00")');
    expect(i).toContain('DATA_END = ms("2026-11-02T00:00")');
    expect(i).toContain('KRAKEN_FROM, KRAKEN_TO = ms("2026-10-03T21:00"), ms("2026-11-01T22:00")');
    expect(i).toContain('EXPORT_LO, EXPORT_HI = ms("2026-10-03T22:00"), ms("2026-11-02T00:10")');
    expect(i).toContain('HALF_SPREAD = {"USDC-USD": 0.00005, "USDT-USD": 0.0002}');
    expect(i).toContain('PAR, GUARD_TICKS = 10000, 30');
    expect(i).toContain('DARK_AFTER_MS = 180 * M');
    expect(i).toContain('rounding=decimal.ROUND_HALF_UP');
    const b = read(Q + 'scripts/bar.py');
    expect(b).toContain('SEED, RESAMPLES = 20261004, 10000');
    expect(b).toContain('NEED_USD = CAPITAL * 0.08 * 28 / 365');
    expect(b).toContain('SHIFT_HOURS = list(range(1, 672))');
    expect(b).toContain('SHIFT_P95_INDEX = 636');
    expect(b).toContain('a = p1 <= 0.025');
    expect(b).toContain('return a, a and p2 <= 0.05');
    expect(b).toContain('"5_no_day_over_40pct": share is not None and share <= 0.40');
    const s = read(Q + 'scripts/score.py');
    expect(s).toContain('Q1_RUNGS, Q2_RUNGS, Q3_RUNGS = [0.0001, 0.0002, 0.0003], [1, 2, 3], [0.001, 0.002, 0.003]');
    expect(s).toContain('"56fbad85ee4df6292f596188d091ad064d030180f33cefe3bd09089d7e772a1a"');
    expect(s).toContain('"7dedbaa189febaf2d712c7e809d62da79be0375edf1ae620ac1b73245e888243"');
    expect(s).toContain('PR6_JSON, PR6_JSON_PREFIX = "docs/agents/backtests/pr6/pr6.json", "a9cefc21"');
    expect(s).toContain('len(ref6) == 8341 and len(ref5) == 8192');
  });

  it('keeps the page statement word for word as the pre-registration writes it', () => {
    const doc = read('docs/agents/reviews/2026-09-28-queue-prereg.md');
    const sql = read(Q + 'sql/book_pages.sql');
    const stmt = /(\s+with r as \([\s\S]*?as page\n\s+from p;)/.exec(doc.slice(doc.indexOf('1. **The book record.**')))?.[1];
    expect(stmt).toBeTruthy();
    const norm = (t) => t.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
    expect(norm(sql)).toContain(norm(stmt));
  });

  it('was proven on synthetic data before the export', () => {
    expect(read(Q + 'check3.txt').trim().split('\n').at(-1)).toBe('check 3: all pins hold and every broken copy fails');
    expect(read(Q + 'test_score.txt').trim().split('\n').at(-1)).toBe('all 21 scorer checks pass');
  });
});
