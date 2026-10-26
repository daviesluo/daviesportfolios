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

describe('the USDC arm of the Coinbase paper test', () => {
  it('names the sha256 of each file it froze, once, and each file is that one', () => {
    const named = (f) => [...DOC.matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);
    for (const f of [
      'supabase/migrations/0142_quote_twins_take50_cb_usdc.sql', 'supabase/functions/agents/cb_usdc.ts', 'supabase/functions/agents/cb_usdc.test.ts',
      'supabase/functions/agents/cb_hold.ts', 'supabase/functions/agents/cb_quotes.ts', 'supabase/functions/agents/quotes.ts',
    ]) expect(named(f), f).toEqual([sha(f)]);
    expect(DOC).toContain('**Status: FROZEN**');
  });

  it('is the two USDC books at 25 a rung, its own tables, and its bar as frozen', () => {
    const src = read('supabase/functions/agents/cb_usdc.ts').toString('utf8');
    expect(src).toContain('export const CB_USDC_PRODUCTS = ["USDC-GBP", "USDC-EUR"] as const');
    expect(src).toContain('export const CB_USDC_RUNG = 25;');
    expect(src).toContain('export const CB_USDC_ROW_NAME = "Stablecoin quotes with Euros - 2";');
    const sql = read('supabase/migrations/0142_quote_twins_take50_cb_usdc.sql').toString('utf8').replace(/--[^\n]*/g, '');
    expect(/\bcb_hold_|\bcb_quote_(state|events|trips|minutes)\b/.test(sql)).toBe(false);
    for (const w of ['Realised P&L above zero', 'at least 8 % a year', 'at least +5 bps a round trip', 'with hindsight']) expect(DOC).toContain(w);
  });
});
