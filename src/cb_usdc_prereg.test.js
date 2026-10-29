// "Stablecoin quotes with Euros - 2" (cb_usdc.ts, 0142; docs/agents/reviews/2026-10-26-cb-usdc-prereg.md): the files its
// pre-registration froze are those files, it is frozen, and its migration makes the two-book tables and touches no frozen
// Coinbase file's tables.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p));
const sha = (p) => crypto.createHash('sha256').update(read(p)).digest('hex');
const DOC = read('docs/agents/reviews/2026-10-26-cb-usdc-prereg.md').toString('utf8');

/** §5's sha256 of the files its Deviation 1 (2026-10-29, $25 a rung) changed, as frozen on 2026-10-26. */
const FROZEN_2026_10_26 = {
  'supabase/functions/agents/cb_usdc.ts': '3d48794f78f8e71f51a396e16ba5ed503145ae5ffa395805c2038fcbaf9567d3',
  'supabase/functions/agents/cb_usdc.test.ts': 'b3e2383ab6460986c3bce14bd7be15065483a0bd77a17701400844fcdbbc809e',
  'supabase/functions/agents/cb_hold.ts': '3795b05c5c3b38b30065c13c6c907e6c684fafe195055d3792d3290b25d365f8',
  'supabase/functions/agents/cb_quotes.ts': '3929d8a9a47d0ac240d865fec3fd56c4b08e6912b10c72e6fe8d7ee31eebd808',
};
/** Deviation 1's sha256 of the two files its Deviation 2 (2026-10-29, $50 a rung) changed again. */
const DEV1_2026_10_29 = {
  'supabase/functions/agents/cb_usdc.ts': '4fdf89c16b92ac7279b9593ee7946a209276de2b1a44ad8ae1b91d0f89d704a2',
  'supabase/functions/agents/cb_usdc.test.ts': 'dfa42316993faec080a5bd8c9ab0fa5361e29c0351db47af1d04cb3a059fe2db',
};
const named = (f) => [...DOC.matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);

describe('the USDC arm of the Coinbase paper test', () => {
  it('names the sha256 of each file it froze, once, and each unchanged file is that one', () => {
    for (const f of ['supabase/migrations/0142_quote_twins_take50_cb_usdc.sql', 'supabase/functions/agents/quotes.ts']) expect(named(f), f).toEqual([sha(f)]);
    expect(DOC).toContain('**Status: FROZEN**');
  });

  it("names Deviation 1's bytes after §5's, and Deviation 2's after those, and each file is the last one named", () => {
    const dev = DOC.indexOf('**Deviation 1 (2026-10-29'), dev2 = DOC.indexOf('**Deviation 2 (2026-10-29');
    expect(dev).toBeGreaterThan(DOC.indexOf('## 7. Deviations'));
    expect(dev2).toBeGreaterThan(dev);
    for (const [f, frozen] of Object.entries(FROZEN_2026_10_26)) {
      const again = DEV1_2026_10_29[f];
      expect(named(f), f).toEqual(again ? [frozen, again, sha(f)] : [frozen, sha(f)]);
      expect(DOC.indexOf(`| \`${f}\` | ${sha(f)} |`), f).toBeGreaterThan(again ? dev2 : dev);
    }
    const d2 = DOC.slice(dev2);
    for (const w of ['建USDC 那个线索，在with euro-2的基础上开-3，只做300美元的USDC-GBP；另外把目前的-2数字*2做600美元funded', '**$600 on the two books**',
      '**2026-10-29 12:00 UTC**', 'USDC-GBP at 2026-10-28 01:03 UTC', 'realised ÷ **$600** × 365 / 14 ≥ 8 %']) expect(d2).toContain(w);
    for (const w of ['Coinbase策略中funded数字怎么那么奇怪，都改成整数调整', 'C，coinbase的也是改用美元', '**$300 on the two books**',
      'Fills and fees scale linearly with size', '$300 ÷ $367.13 = **0.817**', 'realised ÷ **$300** × 365 / 14 ≥ 8 %']) expect(DOC).toContain(w);
  });

  it('is the two USDC books at 25 a rung, its own tables, and its bar as frozen', () => {
    const src = read('supabase/functions/agents/cb_usdc.ts').toString('utf8');
    expect(src).toContain('export const CB_USDC_PRODUCTS = ["USDC-GBP", "USDC-EUR"] as const');
    expect(src).toContain('export const CB_USDC_RUNG = 25;');
    expect(src).toContain('export const CB_USDC_FACTOR_50 = 2;');
    expect(src).toContain('export const CB_USDC_50_NOT_BEFORE = Date.UTC(2026, 9, 29, 12);');
    expect(src).toContain('export const CB_USDC_ROW_NAME = "Stablecoin quotes with Euros - 2";');
    const sql = read('supabase/migrations/0142_quote_twins_take50_cb_usdc.sql').toString('utf8').replace(/--[^\n]*/g, '');
    expect(/\bcb_hold_|\bcb_quote_(state|events|trips|minutes)\b/.test(sql)).toBe(false);
    for (const w of ['Realised P&L above zero', 'at least 8 % a year', 'at least +5 bps a round trip', 'with hindsight']) expect(DOC).toContain(w);
  });
});
