// "Stablecoin quotes USDG/EUR - 1" (okx_basis.ts, 0171; docs/agents/reviews/2026-10-29-okx-usdg-basis-prereg.md): the files its
// pre-registration froze are those files, the OKX twins' own frozen files are still the bytes their pre-registration names (so the
// USDG/EUR and EURC/USDC rows are untouched), and the rule's numbers and its bar are the ones it states.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p));
const sha = (p) => crypto.createHash('sha256').update(read(p)).digest('hex');
const DOC = read('docs/agents/reviews/2026-10-29-okx-usdg-basis-prereg.md').toString('utf8');
const OKX = read('docs/agents/reviews/2026-10-27-okx-paper-prereg.md').toString('utf8');
const named = (doc, f) => [...doc.matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);

describe("'Stablecoin quotes USDG/EUR - 1'", () => {
  it('names the sha256 of each file it froze, once, and each file is that one', () => {
    for (const f of ['supabase/functions/agents/okx_basis.ts', 'supabase/functions/agents/okx_basis.test.ts', 'supabase/migrations/0171_okx_usdg_basis.sql']) {
      expect(named(DOC, f), f).toEqual([sha(f)]);
    }
    expect(DOC).toContain('**Status: FROZEN**');
  });

  it("leaves the OKX twins' frozen files as their pre-registration names them, byte for byte", () => {
    for (const f of ['supabase/functions/agents/okx_quotes.ts', 'supabase/functions/agents/okx_rec.ts', 'supabase/functions/agents/quotes.ts',
      'supabase/migrations/0150_okx_rec_paper.sql']) {
      expect(named(DOC, f), f).toEqual([sha(f)]);
      expect(named(OKX, f).at(-1), f).toBe(sha(f));      // the OKX pre-registration's latest bytes for it (Deviation 2's where it has one)
    }
  });

  it("is the USDG/EUR rule with the basis fair: ½, 24 hours, five minutes or par, and its bar as frozen", () => {
    const src = read('supabase/functions/agents/okx_basis.ts').toString('utf8');
    for (const line of [
      'export const OKX_BASIS_BOOK = "USDG-EUR" as const;', 'export const OKX_BASIS_WEIGHT = 0.5;', 'export const OKX_BASIS_WINDOW_MS = DAY;',
      'export const OKX_BASIS_MIN_MINUTES = 5;', 'export const OKX_BASIS_ID = "okxusdgb";', 'export const OKX_BASIS_NAME = "Stablecoin quotes USDG/EUR - 1";',
      'stepOkxMinute(st.books[b], t,',
    ]) expect(src).toContain(line);
    expect(src).not.toMatch(/okx_quote_(state|events|trips|minutes)/);
    for (const w of ['okx usdg/eur可以按你说的做一个 -1', '…你先按okx的研究下，还成立的话再上线', '**par × (1 + ½ × b)**', '28 UTC days',
      '`random.Random(20261029)`', '**P(mean ≤ 0) < 0.10**', '+€0.168 a day [+0.099, +0.234], P(≤ 0) 0.000', 'PR5\'s simulator',
      'the first 00:00 UTC after its first run']) expect(DOC).toContain(w);
  });
});
