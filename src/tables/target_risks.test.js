// Pins the Target price page's Key risks (target_risks.js): Davies's five notes, keyed by the ticker the page shows, a
// dated note dropping out the day after its date in New York, and RKLB's lowest target worked out from the row.
import { describe, expect, it } from 'vitest';
import { nyDate, risksFor, TARGET_RISKS } from './target_risks.js';

const at = (iso) => Date.parse(iso);
const row = { low: null, price: null, lowVsPrice: null };

describe('Key risks', () => {
  it('holds every holding on the board of 2026-10-21, by the ticker the page shows, 1 to 3 items each', () => {
    // The board's 30 holdings (read-only SQL on board_data, 2026-10-21), through displayTicker.
    const BOARD = ['017731', 'SIVE', 'AAPL', 'AMZN', 'APLD', 'AVGO', 'BE', 'BMNR', 'BTC-USD', 'CRWV', 'GOOG', 'HOOD', 'META', 'MSFT', 'MSTR',
      'MU', 'NBIS', 'NET', 'NVDA', 'NVTS', 'ORCL', 'PLTR', 'RKLB', 'SAEM', 'SFTBY', 'SPCX', 'TSLA', 'TSM', 'VST', 'VUAA'];
    expect(Object.keys(TARGET_RISKS).sort()).toEqual([...BOARD].sort());
    for (const k of BOARD) {
      expect(TARGET_RISKS[k].length, k).toBeGreaterThanOrEqual(1);
      expect(TARGET_RISKS[k].length, k).toBeLessThanOrEqual(3);
      for (const n of TARGET_RISKS[k]) if (n.until) expect(n.until, k).toMatch(/^2026-\d{2}-\d{2}$/);
      expect(risksFor(k, { low: 64, price: 53.83, lowVsPrice: 18.9 }, at('2026-10-21T12:00:00Z')), k).not.toBe('');
    }
    expect(risksFor('NBIS', row, at('2026-10-21T12:00:00Z'))).toBe('Average target inflated by stale targets; converts ~$4.3B (3/2026) + ~$5.75B (8/2026); earnings ~11/11 (est.)');
    expect(risksFor('SIVE', row, at('2026-10-21T12:00:00Z'))).toBe('Only Redeye (paid) covers it; Ningi Research short report (6/1); auditor going-concern doubt; SEK 825M raise (8/27)');
    expect(risksFor('XYZ', row, at('2026-10-21T12:00:00Z'))).toBe('');
  });

  it('a dated note shows through its day in New York and drops out after it', () => {
    // 28 Oct 23:30 ET is 03:30 UTC on the 29th: still the 28th in New York.
    expect(nyDate(at('2026-10-29T03:30:00Z'))).toBe('2026-10-28');
    expect(risksFor('ORCL', row, at('2026-10-29T03:30:00Z'))).toBe('S&P BBB− since 7/9 (one notch above junk); total debt ~$130B (5/2026); investor day 10/28');
    expect(risksFor('ORCL', row, at('2026-10-29T04:30:00Z'))).toBe('S&P BBB− since 7/9 (one notch above junk); total debt ~$130B (5/2026)');
    expect(risksFor('SPCX', row, at('2026-10-21T12:00:00Z'))).toBe('Lock-up: up to 328.4M shares 10/24; ~1.3B more unlock after the Q3 report (10/20); ~800M more 12/8');
    expect(risksFor('SPCX', row, at('2026-11-23T12:00:00Z'))).toBe('~800M more 12/8');
    expect(risksFor('SPCX', row, at('2026-12-09T12:00:00Z'))).toBe('');
  });

  it("RKLB's lowest target against the price is computed from the row, above or below", () => {
    const now = at('2026-10-21T12:00:00Z');
    // $67 against $55.37: 67 / 55.37 − 1 = 21.0 %.
    expect(risksFor('RKLB', { low: 67, price: 55.37, lowVsPrice: (67 / 55.37 - 1) * 100 }, now)).toBe('Net cash; lowest target $67 still 21% above price; earnings ~11/9–11/12 (est.)');
    expect(risksFor('RKLB', { low: 64, price: 80, lowVsPrice: -20 }, now)).toBe('Net cash; lowest target $64 20% below price; earnings ~11/9–11/12 (est.)');
    expect(risksFor('RKLB', row, at('2026-11-13T12:00:00Z'))).toBe('Net cash');
  });
});
