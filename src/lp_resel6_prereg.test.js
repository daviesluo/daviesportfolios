// The LPRESEL6 pre-registration (docs/agents/reviews/2026-10-09-lp-reselect6h-prereg.md) freezes its scripts by sha256
// before any pm-rec data of 2026-10-09 or later is read for design: a script edited after the freeze would read the
// window on terms nobody pre-registered. This fails on any change to them, on a hash the document and the folder's
// manifest do not share, on arms that are not the document's, and on a bar that is not its seed, draws and index.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'docs/agents/backtests/lpresel6');
const DOC = fs.readFileSync(path.join(ROOT, 'docs/agents/reviews/2026-10-09-lp-reselect6h-prereg.md'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(DIR, 'MANIFEST.json'), 'utf8'));
const FROZEN = ['scripts/sim2.ts', 'scripts/rec.ts', 'scripts/build.ts', 'scripts/arms.ts', 'scripts/run.ts', 'scripts/bar.py', 'scripts/fetch.py', 'sql/archive_urls.sql', 'sql/aux.sql'];
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(DIR, f))).digest('hex');
const text = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');

describe('the LPRESEL6 pre-registration', () => {
  it.each(FROZEN)('names the sha256 of %s, the file is that hash, and the manifest agrees', (f) => {
    const named = new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| `([0-9a-f]{64})` \\|').exec(DOC)?.[1];
    expect(named).toMatch(/^[0-9a-f]{64}$/);
    expect(sha(f)).toBe(named);
    expect(MANIFEST.sha256[f]).toBe(named);
  });

  it('every committed file is the hash its manifest names', () => {
    for (const [f, h] of Object.entries(MANIFEST.sha256)) expect(sha(f), f).toBe(h);
  });

  it("freezes the document's arms: live-prep's deployed rule, and the same choosing again every six hours", () => {
    const arms = text('scripts/arms.ts');
    expect(arms).toContain('budget: 200, maxMarkets: 10, caps: { total: 320, market: 100, reduceFirst: true }, invCap: 5');
    expect(arms).toContain('pause: { cents: 15, minutes: 60 }, tight: { mode: "skip", maxTicks: 1 }, exitCarried: true');
    expect(arms).toContain('export const RESEL6: Variant = { ...L1, reselectEveryH: 6, id: "RESEL6" };');
  });

  it('reads the bar as the document writes it: random.Random(20261023), 2,000 draws, index 100, R = 0.40, both fill models, the worst day', () => {
    const bar = text('scripts/bar.py');
    expect(bar).toContain('rng = random.Random(20261023)');
    expect(bar).toContain('for _ in range(2000)');
    expect(bar).toContain('s[100] > 0');
    expect(bar).toContain('for fill in ("strict", "at-price"):');
    expect(bar).toContain('wa >= wb - 1e-9');
    expect(DOC).toContain('on or after 2026-10-23 00:05 UTC');
  });

  it("builds the window it names, and the folder holds no data of it", () => {
    expect(DOC).toContain('2026-10-09T00:00:00Z 2026-10-23T00:00:00Z');
    expect(fs.existsSync(path.join(DIR, 'data'))).toBe(false);
  });
});
