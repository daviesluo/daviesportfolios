// The LP-SKEW-FT pre-registration (docs/agents/reviews/2026-10-11-lp-skew-ft-prereg.md) freezes its module, migration and
// readout by sha256, and names the order path's three files it does not touch. This fails on any change to a frozen file,
// on a hash the document and the manifest do not share, on a bar that is not its seed and draws, and if pm_live.ts,
// pm_lp.ts or pm_prep.ts is not the bytes they were when the test was frozen.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC = fs.readFileSync(path.join(ROOT, 'docs/agents/reviews/2026-10-11-lp-skew-ft-prereg.md'), 'utf8');
const DIR = 'docs/agents/backtests/lpskew';
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, DIR, 'MANIFEST.json'), 'utf8'));
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
const FROZEN = ['supabase/functions/agents/lpskew.ts', 'supabase/migrations/0117_lpskew.sql', `${DIR}/scripts/bar.py`, `${DIR}/sql/readout.sql`];

describe('the LP-SKEW-FT pre-registration', () => {
  it.each(FROZEN)('names the sha256 of %s and the file is that hash', (f) => {
    const named = new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| `([0-9a-f]{64})` \\|').exec(DOC)?.[1];
    expect(named).toMatch(/^[0-9a-f]{64}$/);
    expect(sha(f)).toBe(named);
  });

  it("the manifest's hashes are the folder's files", () => {
    for (const [f, h] of Object.entries(MANIFEST.sha256)) expect(sha(`${DIR}/${f}`), f).toBe(h);
  });

  it('leaves the order path untouched: pm_live.ts, pm_lp.ts and pm_prep.ts are the bytes the document names', () => {
    for (const f of ['pm_live.ts', 'pm_lp.ts', 'pm_prep.ts']) {
      const named = new RegExp('`' + f.replace('.', '\\.') + '` `([0-9a-f]{64})`').exec(DOC.replace(/\n/g, ' '))?.[1];
      expect(named, f).toMatch(/^[0-9a-f]{64}$/);
      expect(sha(`supabase/functions/agents/${f}`), f).toBe(named);
    }
  });

  it('freezes the bar, the arms, the start and the reading as the document writes them', () => {
    const bar = fs.readFileSync(path.join(ROOT, DIR, 'scripts/bar.py'), 'utf8');
    expect(bar).toContain('rng = random.Random(20261019)');
    expect(bar).toContain('for _ in range(2000)');
    expect(bar).toContain('s[100] > 0');
    expect(bar).toContain('R = 0.737');
    const mod = fs.readFileSync(path.join(ROOT, 'supabase/functions/agents/lpskew.ts'), 'utf8');
    expect(mod).toContain('{ id: "skew", capShares: 40, k: 0.001 }');
    expect(mod).toContain('export const LPSKEW_START = "2026-10-12T00:00:00.000Z";');
    expect(mod).not.toMatch(/pm_lp_(config|orders|fills|state|markets)/);
    expect(DOC).toContain('on or after 2026-10-19\n00:05 UTC');
  });
});
