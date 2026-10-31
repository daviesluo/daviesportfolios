// "Crypto quotes XRP/GBP" (mm_core.ts, mm_paper.ts, 0192; docs/agents/reviews/2026-10-31-xrp-gbp-paper-prereg.md): the files its
// pre-registration froze are those files, and the rule's numbers, its arms, its start and its bar are the ones it states.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p));
const sha = (p) => crypto.createHash('sha256').update(read(p)).digest('hex');
const DOC = read('docs/agents/reviews/2026-10-31-xrp-gbp-paper-prereg.md').toString('utf8');
const named = (doc, f) => [...doc.matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);
const FROZEN = [
  'supabase/functions/agents/mm_core.ts', 'supabase/functions/agents/mm_core.test.ts', 'supabase/functions/agents/mm_paper.ts',
  'supabase/migrations/0192_mm_xrp_paper.sql', 'docs/agents/backtests/cryptobooks/scripts/rule.py', 'docs/agents/backtests/cryptobooks/scripts/xrp_study.py',
  'docs/agents/backtests/cryptobooks/scripts/final_card.py', 'docs/agents/backtests/cryptobooks/scripts/regimes_hist.py',
  'docs/agents/backtests/cryptobooks/scripts/paper_reading.py', 'docs/agents/backtests/cryptobooks/results/parity_XRP-GBP.json',
];

describe("'Crypto quotes XRP/GBP'", () => {
  it('names the sha256 of each file it froze, once, and each file is that one', () => {
    for (const f of FROZEN) expect(named(DOC, f), f).toEqual([sha(f)]);
    expect(DOC).toContain('**Status: FROZEN**');
    expect(DOC).toContain('## 11. Deviations\n\nNone at freezing.');
  });

  it("is the card it states: 14 bps, θ 5, κ 0.5, £200 on £600, a 10 bps arbitrageur, a 300 bps stop for an hour, a second's rest, 3 hours of basis", () => {
    const core = read('supabase/functions/agents/mm_core.ts').toString('utf8');
    expect(core).toContain('dBps: 14, thetaBps: 5, kappa: 0.5, qGbp: 200, capGbp: 600, xArbBps: 10, stopBps: 300, exitSlipBps: 20, cooldownS: 3600, restLagS: 1,');
    expect(core).toContain('trailS: 3 * 3600,');
    expect(core).toContain('export const MM_TAKER_FEE_BPS = 9;');
    const study = read('docs/agents/backtests/cryptobooks/scripts/xrp_study.py').toString('utf8');
    expect(study).toContain('CARD = dict(d_min=14.0, theta=5.0, kappa=0.5, Q=200.0, cap=600.0)');
    expect(read('docs/agents/backtests/cryptobooks/scripts/final_card.py').toString('utf8')).toContain('FINAL = {"stop": 300.0, "cooldown": 3600, "rest_lag": 1}');
    const paper = read('supabase/functions/agents/mm_paper.ts').toString('utf8');
    for (const line of [
      '{ arm: "p600", capGbp: 600, qGbp: 200 },', '{ arm: "p120", capGbp: 120, qGbp: 40 },', '{ arm: "p1200", capGbp: 1200, qGbp: 400 },',
      'export const MM_PLANNED_START = Date.UTC(2026, 10, 1);', 'export const MM_WARM_MS = 3 * 3600e3;', 'export const MM_LAG_MINUTES = 2;',
      'export const MM_USDT_FRESH_MS = 30 * 60e3;', 'export const MM_FX_FRESH_MS = 10 * 60e3;', 'export const MM_NAME = "Crypto quotes XRP/GBP";',
      'export const MM_BN_SYMBOL = "XRPUSDT";',
    ]) expect(paper).toContain(line);
  });

  it('is the bar and the window it states: 28 days, sum > 0, P < 0.10 by 3-day blocks of 10,000 from 20261031, tight hours ≥ 0, 100 fills, void at 10 % and 24 h', () => {
    const r = read('docs/agents/backtests/cryptobooks/scripts/paper_reading.py').toString('utf8');
    for (const line of ['DAYS = 28', 'P_BAR = 0.10', 'MIN_TIGHT_HOURS = 100', 'MIN_FILLS = 100', 'VOID_STALE = 0.10', 'VOID_SILENT_S = 24 * 3600',
      '"p_mean_le_0": boot(pnl, 3, n=10000, seed=20261031)']) expect(r).toContain(line);
    expect(read('docs/agents/backtests/cryptobooks/scripts/regimes_hist.py').toString('utf8')).toContain('WIDE = 16.0');
    for (const w of ['好 再研究下确保策略一切最优后就开做然后上testing', '**28 UTC days**', '**P(mean ≤ 0) < 0.10**', '`random.Random(20261031)`',
      '**At least 100 fills.**', '**Only prints strictly through our price**', '**Its start: 2026-11-01 00:00 UTC**']) expect(DOC).toContain(w);
  });
});
