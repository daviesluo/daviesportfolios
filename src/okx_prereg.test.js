// "Stablecoin quotes OKX USDG" and "… OKX EURC" (okx_quotes.ts, 0150; docs/agents/reviews/2026-10-27-okx-paper-prereg.md):
// the files its pre-registration froze are those files, it is frozen, and the rule's numbers are the ones it states.
// Deviation 2 (2026-10-29: $100 a rung, the record in dollars; Davies: "…改成600吧？…目前的数字按倍率乘", "C，coinbase的也是改用美元")
// changed okx_quotes.ts and its test: §7 keeps their original sha256 (held here as they were frozen), and §8's Deviation 2
// names the bytes since, which each file must be.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p));
const sha = (p) => crypto.createHash('sha256').update(read(p)).digest('hex');
const DOC = read('docs/agents/reviews/2026-10-27-okx-paper-prereg.md').toString('utf8');
/** The OKX compounding deviation (2026-10-30), recorded apart: under each pre-registration's own heading, the files as they are. */
const APART = read('docs/agents/reviews/2026-10-30-okx-compounding-deviation.md').toString('utf8');
const namedApart = (head, f) => {
  const s = APART.indexOf('### `docs/agents/reviews/' + head + '`'), rest = s < 0 ? '' : APART.slice(s + 1), e = rest.search(/\n##/);
  return [...rest.slice(0, e < 0 ? undefined : e).matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);
};
const named = (f) => [...DOC.matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);
/** §7's sha256 of the two files Deviation 2 changed, as frozen on 2026-10-27. */
const FROZEN_2026_10_27 = {
  'supabase/functions/agents/okx_quotes.ts': '67a2cc1f82afb6fc401ef397f0ce0eefec22d29aa9283bf7e3d217e2313bb1e2',
  'supabase/functions/agents/okx_quotes.test.ts': '5a0448688596160fbfee9bd555cd3266ee0c1cf7082d1b30a52bf85ca534a1b7',
};

describe("OKX's paper twins", () => {
  it('names the sha256 of each file it froze, once, and each unchanged file is that one', () => {
    for (const f of ['supabase/migrations/0150_okx_rec_paper.sql', 'supabase/functions/agents/okx_rec.ts', 'supabase/functions/agents/quotes.ts']) {
      expect(named(f), f).toEqual([sha(f)]);
    }
    expect(DOC).toContain('**Status: FROZEN**');
  });

  it("names Deviation 2's bytes after §7's for the two files it changed, and each file is Deviation 2's", () => {
    const dev = DOC.indexOf('**Deviation 2 (2026-10-29)');
    expect(dev).toBeGreaterThan(DOC.indexOf('## 8. Deviations'));
    // Then the compounding deviation (2026-10-30), recorded apart: okx_quotes.ts as it is, Deviation 2's bytes the ones before it.
    for (const [f, frozen] of Object.entries(FROZEN_2026_10_27)) {
      const apart = namedApart('2026-10-27-okx-paper-prereg.md', f), dev2 = apart.length ? named(f).at(-1) : sha(f);
      expect([...named(f), ...apart], f).toEqual([frozen, dev2, ...(apart.length ? [sha(f)] : [])]);
      expect(DOC.indexOf(`| \`${f}\` | ${dev2} |`), f).toBeGreaterThan(dev);
    }
    expect(namedApart('2026-10-27-okx-paper-prereg.md', 'supabase/functions/agents/okx_quotes.ts')).toEqual([sha('supabase/functions/agents/okx_quotes.ts')]);
    expect(APART).toContain("The bytes before it, Deviation 2's: `257e8ccb4d302ce5b26c51f5ca8d9bdcee11a52e0c8253d467fda3df57f832e7`.");
    for (const w of ['OKX每个策略为什么是250usd？改成600吧？正好6个档每个50，目前的数字按倍率乘', 'C，coinbase的也是改用美元', '**$600 a book, $1,200 on the two**',
      'Fills and fees scale linearly with size', '600 ÷ 334.56 = **1.793**', 'total dollars ÷ 28 ÷ $1,200 ≥ 0.0005']) expect(DOC).toContain(w);
  });

  it("is LIVE's rule on the two books, €50 a rung before Deviation 2 and $100 from it, and its bar as frozen", () => {
    const src = read('supabase/functions/agents/okx_quotes.ts').toString('utf8');
    for (const line of [
      'export const OKX_RUNGS = [0.001, 0.002, 0.003];', 'export const OKX_REPRICE = 0.0005;', 'export const OKX_RUNG_EUR = 50;',
      'export const OKX_RUNG_USD = 100;', 'export const OKX_BOOK_USD = 6 * OKX_RUNG_USD;', 'export const OKX_RESIZE = 0.05;',
      'export const OKX_DEPEG = 0.005;', 'export const OKX_LOSS_STOP = 0.01;', 'export const OKX_MAKER = 0;', 'export const OKX_TAKER = 0.001;',
    ]) expect(src).toContain(line);
    expect(read('supabase/functions/agents/okx_rec.ts').toString('utf8')).toContain('export const OKX_BOOKS = ["USDG-EUR", "EURC-USDC"] as const;');
    for (const w of ['P&L in pounds > 0 on each book', 'At least 150 round trips on USDG-EUR and at least 40 on EURC-USDC',
      'at most 10 % of trips', '`random.Random(20261029)`', '≥ 0.0005', '28 UTC days']) expect(DOC).toContain(w);
  });
});
