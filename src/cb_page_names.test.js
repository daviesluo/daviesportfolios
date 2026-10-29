// The Coinbase arms' page names since 2026-10-29 (Davies: "coinbase quotes with euros删了吧，因为加周末表现更好应该已经很明显了吧，然后把-1改成
// coinbase quotes with euros，-2和-3都减小一个数字"): display only, set on the page layer (cb_page.ts) so no frozen engine file changes;
// the dashboard sends each arm under its page name and no longer reads the base test, whose call runs on as the weekend reading's control.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const A = 'supabase/functions/agents/';

describe("the Coinbase arms' names on the page", () => {
  it('names the weekend arm "with Euros", the USDC arm "- 1" and the nudged arm "- 2" on the page, the frozen files keeping theirs', () => {
    const page = read(A + 'cb_page.ts');
    expect(page).toContain('export const CB_HOLD_PAGE_NAME = "Stablecoin quotes with Euros";');
    expect(page).toContain('export const CB_USDC_PAGE_NAME = "Stablecoin quotes with Euros - 1";');
    expect(page).toContain('export const CB_NUDGE_PAGE_NAME = "Stablecoin quotes with Euros - 2";');
    // The frozen files' own names are as they were frozen (their sha256 chains unchanged).
    expect(read(A + 'cb_hold.ts')).toContain('export const CB_HOLD_ROW_NAME = "Stablecoin quotes with Euros - 2";');
    expect(read(A + 'cb_usdc.ts')).toContain('export const CB_USDC_ROW_NAME = "Stablecoin quotes with Euros - 2";');
    expect(read(A + 'cb_nudge.ts')).toContain('export const CB_NUDGE_ROW_NAME = "Stablecoin quotes with Euros - 3";');
  });

  it('the dashboard sends the three arms under their page names and does not read the base test; its call still runs', () => {
    const idx = read(A + 'index.ts');
    expect(idx).toContain('{ id: CB_HOLD_ID, name: CB_HOLD_PAGE_NAME }');
    expect(idx).toContain('{ id: CB_USDC_ID, name: CB_USDC_PAGE_NAME }');
    expect(idx).toContain('{ id: CB_NUDGE_ID, name: CB_NUDGE_PAGE_NAME }');
    expect(idx).not.toMatch(/quotesCoinbaseRead|quotesCoinbase: await|"cb_quote_state", trips: "cb_quote_trips"/);
    // The base test's call (cbrec runs it after recording) is unchanged: it decides every minute as its pre-registration says.
    expect(idx).toContain('runCbQuotes');
  });
});
