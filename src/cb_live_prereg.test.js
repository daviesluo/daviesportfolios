// Every Coinbase paper arm on Coinbase's own coin price (Davies, 2026-10-29: "目前coinbase的测试策略全部直接改用coinbase自己的币价而不是
// revolutx的"; the CB/OKX fair-price study's `cb_live`): each pre-registration carries it as a dated deviation that quotes him and
// names the bytes; every driver takes the coin value from the one function with the de-peg guard; and Revolut X's engine is
// untouched (quotes.ts is the bytes every frozen list names).
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
const A = 'supabase/functions/agents/';
const QUOTE = '目前coinbase的测试策略全部直接改用coinbase自己的币价而不是revolutx的';
const DEVS = [
  { doc: 'docs/agents/reviews/2026-10-10-coinbase-paper-prereg.md', head: '### Deviation 5 (2026-10-29', files: ['cb_quotes.ts', 'cb_quotes.test.ts'] },
  { doc: 'docs/agents/reviews/2026-10-13-coinbase-weekend-prereg.md', head: '**Deviation 4 (2026-10-29', files: ['cb_hold.ts', 'cb_hold.test.ts', 'cb_quotes.ts'] },
  { doc: 'docs/agents/reviews/2026-10-26-cb-usdc-prereg.md', head: '**Deviation 3 (2026-10-29', files: ['cb_usdc.ts', 'cb_usdc.test.ts', 'cb_hold.ts', 'cb_quotes.ts'] },
  { doc: 'docs/agents/reviews/2026-10-29-cb-usdc-nudge-prereg.md', head: '**Deviation 2 (2026-10-29', files: ['cb_usdc.ts', 'cb_quotes.ts'] },
];

describe("the Coinbase arms on Coinbase's own coin price", () => {
  for (const d of DEVS) {
    it(`${d.doc.split('/').pop()}: a dated deviation quoting Davies, the rule, the guard, the instant, and its bytes`, () => {
      const doc = read(d.doc), at = doc.indexOf(d.head);
      expect(at, d.head).toBeGreaterThan(doc.indexOf('## 7. Deviations'));
      const dev = doc.slice(at);
      for (const w of [QUOTE, '**USDC is 1**', "**USDT is Coinbase USDT-USD's own price**", '[t − 10 min, t − 1 min]', '**50 bps**', '`liveFrom`',
        '2026-10-29 08:00 UTC', 'There is no backfill', '60 → 7']) expect(dev, w).toContain(w);
      for (const f of d.files) expect(dev, f).toContain(sha(A + f));
    });
  }

  it("the nudge's deviation says its expectation was measured on the old fair", () => {
    const dev = read('docs/agents/reviews/2026-10-29-cb-usdc-nudge-prereg.md').split('**Deviation 2 (2026-10-29')[1];
    expect(dev).toContain("**§2's expectation was measured on the old fair.**");
    expect(dev).toContain('**The nudge keeps its definition.**');
  });

  it('every driver takes the coin value from cbCoinFair after cbLiveSwitch; the base call stores the minutes; Revolut X untouched', () => {
    const q = read(A + 'cb_quotes.ts');
    for (const line of ['export const CB_LIVE_NOT_BEFORE = Date.UTC(2026, 9, 29, 8);', 'export const CB_DEPEG = 0.005;', 'export const CB_USDT_KIND = "cb:USDT-USD";',
      '`${CB_API}/products/USDT-USD/candles?granularity=60`', 'const depeg = !f3 || Math.abs(v / f3 - 1) > CB_DEPEG;',
      'const v = coin === "USDC" ? 1 : fxBarAt(t, usdt)?.[1] ?? null;']) expect(q).toContain(line);
    for (const f of ['cb_quotes.ts', 'cb_hold.ts', 'cb_usdc.ts']) {
      const src = read(A + f);
      expect(src, f).toContain('cbLiveSwitch(st, first);');
      expect(src, f).toMatch(/const coinU = cbCoinFair\(st, t, CB_BOOK\[b\]\.coin, median\(window\), (usdtBars|\[\])\)\.fairU;/);
      expect(src, f).toContain('coinU, cbInUsd(st, t));');
    }
    // The USDC arms read no USDT minutes (their books are USDC alone); the two four-book arms read the stored ones.
    for (const f of ['cb_quotes.ts', 'cb_hold.ts']) expect(read(A + f), f).toContain('const usdtBars = await series("cb_quote_inputs", CB_USDT_KIND, first - QUOTE_FX_LOOKBACK_MS);');
    expect(read(A + 'cb_usdc.ts')).toContain('export const CB_USDC_PRODUCTS = ["USDC-GBP", "USDC-EUR"] as const');
    // stepMinute's file is the bytes the frozen lists name (cbwk's MANIFEST, "- 2"'s and "- 3"'s §5): Revolut X's rows are as they were.
    const manifest = JSON.parse(read('docs/agents/backtests/cbwk/MANIFEST.json'));
    expect(manifest.frozen["the base test's, unchanged by 0118 and by the release blackout"][A + 'quotes.ts']).toBe(sha(A + 'quotes.ts'));
    expect(sha(A + 'quotes.ts')).toBe('0782ed8140a2e490f19b9e92fe7093c2cb9a6f205866180314f609537277f517');
  });
});
