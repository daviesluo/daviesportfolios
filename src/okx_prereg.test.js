// "Stablecoin quotes OKX USDG" and "… OKX EURC" (okx_quotes.ts, 0150; docs/agents/reviews/2026-10-27-okx-paper-prereg.md):
// the files its pre-registration froze are those files, it is frozen, and the rule's numbers are the ones it states.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p));
const sha = (p) => crypto.createHash('sha256').update(read(p)).digest('hex');
const DOC = read('docs/agents/reviews/2026-10-27-okx-paper-prereg.md').toString('utf8');

describe("OKX's paper twins", () => {
  it('names the sha256 of each file it froze, once, and each file is that one', () => {
    const named = (f) => [...DOC.matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);
    for (const f of [
      'supabase/migrations/0150_okx_rec_paper.sql', 'supabase/functions/agents/okx_rec.ts', 'supabase/functions/agents/okx_quotes.ts',
      'supabase/functions/agents/okx_quotes.test.ts', 'supabase/functions/agents/quotes.ts',
    ]) expect(named(f), f).toEqual([sha(f)]);
    expect(DOC).toContain('**Status: FROZEN**');
  });

  it("is LIVE's rule at €50 a rung on the two books, and its bar as frozen", () => {
    const src = read('supabase/functions/agents/okx_quotes.ts').toString('utf8');
    for (const line of [
      'export const OKX_RUNGS = [0.001, 0.002, 0.003];', 'export const OKX_REPRICE = 0.0005;', 'export const OKX_RUNG_EUR = 50;',
      'export const OKX_DEPEG = 0.005;', 'export const OKX_LOSS_STOP = 0.01;', 'export const OKX_MAKER = 0;', 'export const OKX_TAKER = 0.001;',
    ]) expect(src).toContain(line);
    expect(read('supabase/functions/agents/okx_rec.ts').toString('utf8')).toContain('export const OKX_BOOKS = ["USDG-EUR", "EURC-USDC"] as const;');
    for (const w of ['P&L in pounds > 0 on each book', 'At least 150 round trips on USDG-EUR and at least 40 on EURC-USDC',
      'at most 10 % of trips', '`random.Random(20261029)`', '≥ 0.0005', '28 UTC days']) expect(DOC).toContain(w);
  });
});
