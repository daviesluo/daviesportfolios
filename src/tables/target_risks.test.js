// Pins the Target price page's Key risks (target_risks.js): Davies's five notes, keyed by the ticker the page shows, a
// dated note dropping out the day after its date in New York, and RKLB's lowest target worked out from the row.
import { describe, expect, it } from 'vitest';
import { nyDate, risksFor, TARGET_RISKS } from './target_risks.js';

const at = (iso) => Date.parse(iso);
const row = { low: null, price: null, lowVsPrice: null };

describe('Key risks', () => {
  it('holds the five holdings Davies named, by the ticker the page shows', () => {
    expect(Object.keys(TARGET_RISKS).sort()).toEqual(['NBIS', 'ORCL', 'RKLB', 'SIVE', 'SPCX']);
    expect(risksFor('NBIS', row, at('2026-10-21T12:00:00Z'))).toBe('Average target inflated by stale targets; convertible financing');
    expect(risksFor('SIVE', row, at('2026-10-21T12:00:00Z'))).toBe('Only Redeye (paid) covers it; public short report');
    expect(risksFor('AAPL', row, at('2026-10-21T12:00:00Z'))).toBe('');
  });

  it('a dated note shows through its day in New York and drops out after it', () => {
    // 28 Oct 23:30 ET is 03:30 UTC on the 29th: still the 28th in New York.
    expect(nyDate(at('2026-10-29T03:30:00Z'))).toBe('2026-10-28');
    expect(risksFor('ORCL', row, at('2026-10-29T03:30:00Z'))).toBe('BBB− rated; net debt ~$132B; investor day 10/28');
    expect(risksFor('ORCL', row, at('2026-10-29T04:30:00Z'))).toBe('BBB− rated; net debt ~$132B');
    expect(risksFor('SPCX', row, at('2026-10-21T12:00:00Z'))).toBe('Lock-up expiry from 10/22: up to 1.31B shares');
    expect(risksFor('SPCX', row, at('2026-11-23T12:00:00Z'))).toBe('');
  });

  it("RKLB's lowest target against the price is computed from the row, above or below", () => {
    const now = at('2026-10-21T12:00:00Z');
    // $67 against $55.37: 67 / 55.37 − 1 = 21.0 %.
    expect(risksFor('RKLB', { low: 67, price: 55.37, lowVsPrice: (67 / 55.37 - 1) * 100 }, now)).toBe('Net cash; lowest target $67 still 21% above price; earnings 11/9');
    expect(risksFor('RKLB', { low: 64, price: 80, lowVsPrice: -20 }, now)).toBe('Net cash; lowest target $64 20% below price; earnings 11/9');
    expect(risksFor('RKLB', row, at('2026-11-10T12:00:00Z'))).toBe('Net cash');
  });
});
