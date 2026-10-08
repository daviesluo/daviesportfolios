// The RWC-OPT pre-registration (docs/agents/reviews/2026-10-09-rwc-optimised-arms-prereg.md) freezes its scripts by
// sha256 before RW-C's first minute: a script edited after the freeze would read RW-C's record on terms nobody
// pre-registered. This fails on any change to them, on a hash the document and the folder's manifest do not share, on
// arms that are not the document's, and on a bar that is not its seed, draws and index.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'docs/agents/backtests/rwc_opt');
const DOC = fs.readFileSync(path.join(ROOT, 'docs/agents/reviews/2026-10-09-rwc-optimised-arms-prereg.md'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(DIR, 'MANIFEST.json'), 'utf8'));
const FROZEN = ['scripts/sim.ts', 'scripts/rec.ts', 'scripts/arms.ts', 'scripts/run.ts', 'scripts/check.ts', 'scripts/bar.py', 'scripts/grid.ts',
  'scripts/analyse.py', 'scripts/grab.py', 'scripts/grab_payload.py', 'sql/pull_minutes.sql', 'sql/pull_record.sql'];
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(DIR, f))).digest('hex');
const text = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');

describe('the RWC-OPT pre-registration', () => {
  it.each(FROZEN)('names the sha256 of %s, the file is that hash, and the manifest agrees', (f) => {
    const named = new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| `([0-9a-f]{64})` \\|').exec(DOC)?.[1];
    expect(named).toMatch(/^[0-9a-f]{64}$/);
    expect(sha(f)).toBe(named);
    expect(MANIFEST.sha256[f]).toBe(named);
  });

  it('every committed input and result is the hash its manifest names', () => {
    for (const [f, h] of Object.entries(MANIFEST.sha256)) expect(sha(f), f).toBe(h);
  });

  it("freezes the document's arms: S2, C1 = S2 + TB1 skip at one tick, C2's exits, C3 = x1 + x2's pause + TB1 skip", () => {
    const arms = text('scripts/arms.ts');
    expect(arms).toContain('budget: 200, maxMarkets: 10, caps: { total: 320, market: 100, reduceFirst: true }');
    expect(arms).toContain('exitPassiveModel: { sharesPerMin: 9.1 / 60, costPerShare: 0.018 }, invCap: 5, stops: { day: 1e9, total: 75, basis: "paid", R: 0.4 }');
    expect(arms).toContain('const TB1_SKIP = { tight: { mode: "skip" as const, maxTicks: 1 } };');
    expect(arms).toContain('export const C1: Variant = { ...S2, ...TB1_SKIP, id: "C1 S2+tb1-skip" };');
    expect(arms).toContain('export const C3: Variant = { ...X1, pause: { cents: 15, minutes: 60 }, ...TB1_SKIP, id: "C3 x1+pause+tb1-skip" };');
    expect(arms).toContain('exitPassiveModel: undefined, exitCarried: true');
  });

  it("reads the bar as the document writes it: random.Random(20261023), 2,000 draws, index 100, R = 0.40, both fill models", () => {
    const bar = text('scripts/bar.py');
    expect(bar).toContain('def boot(D, seed=20261023, B=2000)');
    expect(bar).toContain('s[int(0.05 * B)]');
    expect(bar).toContain("for fill in ('strict', 'at-price'):");
    expect(bar).toContain('day_fig(a, 0.4)');
    expect(bar).toContain('ok = ok and p5 > 0 and wo > 0');
    expect(DOC).toContain('`random.Random(20261023)`, 2,000 draws, index 100, > 0 under both fill models');
    expect(DOC).toContain('**2026-10-23 00:05 UTC**');
  });

  it("loads RW-C's record from its own tables and window, flat at 2026-10-09 00:00, and reads no RW-C row here", () => {
    const rec = text('scripts/rec.ts');
    expect(rec).toContain('start: Date.UTC(2026, 9, 9), end: Date.UTC(2026, 9, 23)');
    expect(text('sql/pull_record.sql')).toContain('{{p}}_selection');
    expect(fs.readdirSync(path.join(DIR, 'data')).filter((f) => f.startsWith('rwc_'))).toEqual([]);
  });
});
