// "Stablecoin quotes with Euros - 3" (cb_nudge.ts, 0168; docs/agents/reviews/2026-10-29-cb-usdc-nudge-prereg.md): the files its
// pre-registration froze are those files, it is frozen, its rule is the code's (USDC-GBP, $50 a rung, the nudge inside closures),
// and its bar is as written.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p));
const sha = (p) => crypto.createHash('sha256').update(read(p)).digest('hex');
const DOC = read('docs/agents/reviews/2026-10-29-cb-usdc-nudge-prereg.md').toString('utf8');
const named = (f) => [...DOC.matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);

describe('"Stablecoin quotes with Euros - 3"', () => {
  it('names the sha256 of each file it froze, once, and each file is that one', () => {
    for (const f of [
      'supabase/migrations/0168_cb_usdc_nudge.sql', 'supabase/functions/agents/cb_nudge.ts', 'supabase/functions/agents/cb_nudge.test.ts',
      'supabase/functions/agents/cb_usdc.ts', 'supabase/functions/agents/quotes_weekend.ts', 'supabase/functions/agents/quotes.ts',
    ]) expect(named(f), f).toEqual([sha(f)]);
    expect(DOC).toContain('**Status: FROZEN**');
    // Deviation 1 (0170, Davies 2026-10-29: "你新做好的两个测试策略现在就上线"): the start moved to 2026-10-29 08:00 UTC, and only that.
    expect(DOC).toMatch(/## 7\. Deviations\n\n- \*\*Deviation 1 \(2026-10-29, before the start; migration `0170`\): the start moves to 2026-10-29 08:00 UTC\.\*\*/);
  });

  it("is USDC-GBP at $50 a rung, its nudge inside closures alone on Davies' choice, and the study's numbers as the expectation", () => {
    const src = read('supabase/functions/agents/cb_nudge.ts').toString('utf8');
    for (const line of [
      'export const CB_NUDGE_ROW_NAME = "Stablecoin quotes with Euros - 3";', 'export const CB_NUDGE_PRODUCTS = ["USDC-GBP"] as const',
      'export const CB_NUDGE_RUNG_USD = CB_RUNG_USD / CB_USDC_FACTOR_50;', 'export const CB_NUDGE_SCOPE: CbNudgeScope = "closures";',
      'export const CB_NUDGE_W = 0.5;', 'export const CB_NUDGE_HL_MIN = 1440;', 'export const CB_NUDGE_MAX_DEV = 0.005;', 'export const CB_NUDGE_FRESH_MS = 5 * M;',
    ]) expect(src).toContain(line);
    for (const w of ['建USDC 那个线索，在with euro-2的基础上开-3，只做300美元的USDC-GBP', '-3 只在休市时用', '**$300**', '**24-hour half-life**',
      '**inside PR5-W\'s FX closures**', '+0.21 bps a day (band +0.05 to +0.39, P ≤ 0 0.01)', '−0.14 bps of $300 a day', 'a twentieth of the base']) expect(DOC).toContain(w);
  });

  it('reads 28 days against "- 2"\'s USDC-GBP book, a 3-day block bootstrap, P(mean ≤ 0) < 0.10', () => {
    for (const w of ['28 UTC days', "`book = 'USDC-GBP'`", 'blocks of 3 days, 10,000 resamples, `random.Random(20261126)`',
      '**"- 3" passes if P(mean ≤ 0) < 0.10.**', 'bps a trip', 'A miss** retires "- 3"']) expect(DOC).toContain(w);
  });
});
