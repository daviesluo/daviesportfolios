// The three Coinbase paper arms in whole dollars (Davies, 2026-10-29: "C，coinbase的也是改用美元", then "Coinbase策略中funded数字
// 怎么那么奇怪，都改成整数调整"): each pre-registration carries the change as a dated deviation that quotes him, states the instant,
// the factor and the linear-scaling assumption, and names the bytes; the code holds the rung each one states.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
const A = 'supabase/functions/agents/';
/** The compounding deviation (2026-10-30, 0183), recorded apart: under each pre-registration's own heading, the files as they are. */
const APART = read('docs/agents/reviews/2026-10-30-compounding-deviation.md');
const apartFor = (doc) => {
  const s = APART.indexOf('### `' + doc + '`'), rest = s < 0 ? '' : APART.slice(s + 1), e = rest.search(/\n##/);
  return rest.slice(0, e < 0 ? undefined : e);
};
const DEVS = [
  { doc: 'docs/agents/reviews/2026-10-10-coinbase-paper-prereg.md', head: '### Deviation 4 (2026-10-29', state: 'cb_quote_state', files: ['cb_quotes.ts', 'cb_quotes.test.ts'], funded: '**$2,400 on the four books**' },
  { doc: 'docs/agents/reviews/2026-10-13-coinbase-weekend-prereg.md', head: '**Deviation 3 (2026-10-29', state: 'cb_hold_state', files: ['cb_hold.ts', 'cb_hold.test.ts', 'cb_quotes.ts'], funded: '**$2,400 on the four books**' },
  { doc: 'docs/agents/reviews/2026-10-26-cb-usdc-prereg.md', head: '**Deviation 1 (2026-10-29', state: 'cb_usdc_state', files: ['cb_usdc.ts', 'cb_usdc.test.ts', 'cb_hold.ts', 'cb_quotes.ts'], funded: '**$300 on the two books**' },
];

describe('the Coinbase arms in whole dollars', () => {
  for (const d of DEVS) {
    it(`${d.doc.split('/').pop()}: a dated deviation that quotes Davies, states the instant, the factor and the assumption, and names its bytes`, () => {
      const doc = read(d.doc);
      const at = doc.indexOf(d.head);
      expect(at, d.head).toBeGreaterThan(Math.max(doc.indexOf('## 7. Deviations'), 0));
      const dev = doc.slice(at);
      for (const w of ['Coinbase策略中funded数字怎么那么奇怪，都改成整数调整', 'C，coinbase的也是改用美元', d.funded, `${d.state}.state`, 'usdFrom',
        '2026-10-29 00:00 UTC', '1 / GBP/USD', '1 / EUR/USD', 'GBP/USD 1.3324', 'EUR/USD 1.1151', '**0.817**', 'Fills and fees scale linearly with size']) expect(dev, w).toContain(w);
      // A file changed since, by the compounding (0183), is named as it is in that deviation, recorded apart.
      for (const f of d.files) expect(dev + apartFor(d.doc), f).toContain(sha(A + f));
    });
  }

  it('the code holds those rungs: $100 on the four-book arms, $25 on the USDC arm, from 2026-10-29 00:00 UTC', () => {
    const q = read(A + 'cb_quotes.ts'), u = read(A + 'cb_usdc.ts'), h = read(A + 'cb_hold.ts');
    expect(q).toContain('export const CB_RUNG_USD = 100;');
    expect(q).toContain('export const CB_USD_NOT_BEFORE = Date.UTC(2026, 9, 29);');
    expect(u).toContain('export const CB_USDC_RUNG_USD = CB_RUNG_USD / CB_USDC_FACTOR;');
    expect(u).toContain('export const CB_USDC_RUNG = 25;');
    for (const [f, src] of [['cb_quotes.ts', q], ['cb_hold.ts', h], ['cb_usdc.ts', u]]) {
      expect(src, f).toContain('cbUsdSwitch(st, first, ');
      expect(src, f).toContain('coinU, cbInUsd(st, t));');
    }
    // The page funds each arm with a whole number of dollars.
    const idx = read(A + 'index.ts');
    // The weekend arm at $50 since its Deviation 7 (2026-10-30), $1,200, what came before × 1/2; its rows in the engine's units now.
    expect(idx).toContain('{ rungUsd: CB_HOLD_RUNG_USD_50, books: 4, resizeFactor: 1 / CB_HOLD_FACTOR_50, shape: (v, st) => cbUsdcView(v, { factor: cbHoldFactorNow(st), products: CB_PRODUCTS }) }');
    expect(h).toContain('export const CB_HOLD_RUNG_USD_50 = CB_RUNG_USD / CB_HOLD_FACTOR_50;');
    // "- 2" at $50 since its Deviation 2 (cb_usdc_prereg.test.js), $600, what came before × 2.
    expect(idx).toContain('{ rungUsd: CB_USDC_RUNG_USD_50, books: 2, resizeFactor: 2, shape: (v, st) => cbUsdcView(v, { factor: cbUsdcFactorNow(st) }) }');
  });
});
