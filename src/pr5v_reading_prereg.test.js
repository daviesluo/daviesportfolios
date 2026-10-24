// PR5V's and rule D's reading scripts (docs/agents/scripts/pr5v/reading_*.py, committed 2026-10-24) were written before
// either reading (2026-10-28) from the frozen pre-registrations (docs/agents/reviews/2026-09-28-pr5-variant-prereg.md,
// 2026-09-28-pr5-rule-d-prereg.md) and their recorded deviations. A script edited after that would read the record on
// terms nobody committed to in advance. This fails on any change to them, on a hash the note and the manifest do not
// share, on a bar that is not the pre-registrations', and on a fixture run that did not pass.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
const NOTE = read('docs/agents/reviews/2026-10-24-pr5v-ruled-reading-scripts.md');
const MANIFEST = JSON.parse(read('docs/agents/scripts/pr5v/reading_manifest.json'));
const DIR = 'docs/agents/scripts/pr5v/';
const FROZEN = ['reading_common.py', 'reading_pr5v.py', 'reading_ruled.py', 'reading_grab.py', 'reading_pull.sql', 'reading_pull_ruled.sql',
  'reading_fixture.py', 'test_reading.py'].map((f) => DIR + f).concat(['docs/agents/backtests/pr5v/test_reading.txt']);

describe("PR5V's and rule D's reading scripts", () => {
  it.each(FROZEN)('the note names the sha256 of %s, the file is that hash, and the manifest agrees', (f) => {
    const named = new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| `([0-9a-f]{64})` \\|').exec(NOTE)?.[1];
    expect(named).toMatch(/^[0-9a-f]{64}$/);
    expect(sha(f)).toBe(named);
    expect(MANIFEST.sha256[f]).toBe(named);
  });

  it('checks the frozen simulators and the study by the hashes the pre-registrations name', () => {
    const common = read(DIR + 'reading_common.py');
    expect(common).toContain('"pr5v_sim.py": "54ad41982d143758ece6ee8e5bb48d5a4aafe1dc0429ccc0af6d1c57282de27a"');
    expect(common).toContain('"../pr5/pr5_sim.py": "56fbad85ee4df6292f596188d091ad064d030180f33cefe3bd09089d7e772a1a"');
    expect(common).toContain('"study.py": "4a5d077ef0f97060ee5613d9a5f1c75b6e404b15ed052d367c1fe67f6d8e7b50"');
    expect(common).toContain('"fastx_sim.py": "f9562974fae8f60ff118f371af95b722318e4cb0f68c0df77948509d70bc6f17"');
    for (const [f, h] of [['pr5v_sim.py', '54ad41982d143758ece6ee8e5bb48d5a4aafe1dc0429ccc0af6d1c57282de27a'],
      ['study.py', '4a5d077ef0f97060ee5613d9a5f1c75b6e404b15ed052d367c1fe67f6d8e7b50'], ['fastx_sim.py', 'f9562974fae8f60ff118f371af95b722318e4cb0f68c0df77948509d70bc6f17']]) {
      expect(sha(DIR + f), f).toBe(h);
    }
    expect(sha('docs/agents/scripts/pr5/pr5_sim.py')).toBe('56fbad85ee4df6292f596188d091ad064d030180f33cefe3bd09089d7e772a1a');
  });

  it("reads the pre-registrations' window, E, governor (deviations 2 / 3), null and bootstraps", () => {
    const common = read(DIR + 'reading_common.py');
    expect(common).toContain('START = ms("2026-09-28T00:00")');
    expect(common).toContain('W0, W1 = ms("2026-09-29T00:00"), ms("2026-10-27T00:00")');
    expect(common).toContain('E = ms("2026-10-28T00:30")');
    expect(common).toContain('READ_FROM = ms("2026-10-28T01:00")');
    expect(common).toContain('NINE = [0.0003, 0.0005, 0.00075, 0.001, 0.00125, 0.0015, 0.002, 0.0025, 0.003]');
    expect(common).toContain('GOV = {"entry_at": 900, "stop_at": 950}');
    expect(common).toContain('RULE_D = {"frac": 1 / 3, "away": None}');
    expect(common).toContain('NULL_DRAWS, NULL_SEED = 2000, 20260923');
    expect(common).toContain('BOOT_BLOCK, BOOT_N = 7, 10000');
    expect(common).toContain('old = "min(N1, m + 2 * DAY)"');
    expect(common).toContain('"pass": bb["p_le_0"] < 0.05');
    expect(common).toContain('se >= 0.95 and sr >= 0.95 and abs(pr - pe) <= tol');
    expect(common).toContain('MIN_DAYS = 21');
    expect(read(DIR + 'reading_pr5v.py')).toContain('SEED_PAIRED = 20261027');
    expect(read(DIR + 'reading_pr5v.py')).toContain('{"N": (563, 29.5129), "F": (40, 2.5438)}');
    expect(read(DIR + 'reading_ruled.py')).toContain('SEED_PAIRED = 20261028');
    expect(read(DIR + 'reading_ruled.py')).toContain('{"N": (593, 30.3004), "F": (60, 3.742)}');
    expect(read(DIR + 'reading_ruled.py')).toContain('CHECK_MAX_USD = 0.01');
  });

  it('was proven on the synthetic fixture before any reading', () => {
    const out = read('docs/agents/backtests/pr5v/test_reading.txt');
    expect(out.trim().split('\n').at(-1)).toBe('all 33 reading checks pass');
    expect(out).not.toContain('Traceback');
  });
});
