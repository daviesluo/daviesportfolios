// The scheduled releases the two Coinbase paper tests sit out ("Stablecoin quotes with Euros", cb_quotes.ts, Deviation 3 of
// docs/agents/reviews/2026-10-10-coinbase-paper-prereg.md; "Stablecoin quotes with Euros - 2", cb_hold.ts, Deviation 2 of
// docs/agents/reviews/2026-10-13-coinbase-weekend-prereg.md; Davies, 2026-10-15: "目前的两个Coinbase 测试采用发布前后暂停的规则吧").
//
// THE RULE: in the minutes that start from CB_BLACKOUT_LEAD_MS before a release to CB_BLACKOUT_TRAIL_MS after it (seven
// minutes: T-1, T, …, T+5), the minute's `fairU` is withheld. `stepMinute` (quotes.ts, unchanged) then does what it does in
// any dark minute: it withdraws the entry rungs and places none, a held rung's exit order is neither placed nor re-priced
// (one already resting stays and can fill, and the 24-hour stop still runs), and the stored minute's `fair` is null, so the
// engine's decision is its record and `replay.py` / `replay_wk.py` reproduce it without knowing about releases.
// Why: docs/agents/reviews/2026-10-15-coinbase-fast-move.md and 2026-10-15-coinbase-blackout.md, priced on two 12-month
// spans of Coinbase's history: +£25.96 and +£7.89 a year on the screen's £2,400, positive in all 75 variants tried.
//
// THE LIST is frozen with the commit that adds it, UTC instants (CPI and NFP 08:30 New York, FOMC statement 14:00 New York,
// ECB decision 14:15 Frankfurt, BoE announcement 12:00 London, DST as it is on the day), from the Fed's, the ECB's and the Bank
// of England's own calendars (fetched 2026-10-15 by docs/agents/backtests/cbreview/scripts/release_calendar.py, which
// also holds every URL tried and the answer). The BLS dates (CPI, NFP) are NOT from the BLS: bls.gov refused this machine
// (HTTP 403) and FRED did not connect, so 2026-11-06 (NFP; also on tradingeconomics.com's calendar and what BLS's
// third-Friday rule gives) and 2026-12-04 (the same rule) and the CPI of 2026-11-10 and 2026-12-10 are the published schedule as
// recalled. A wrong BLS date costs the blackout, not the rule: the minute is then decided as it always was. The list stops at
// 2026-12-31; a later release needs a deviation that extends it. The CPI of 2026-10-14 is not in it: it was over when the
// blackout was decided, and both tests' records of it stand as they ran.

const M = 60e3;

/** Minutes before a release from which the fair is withheld (the minute that starts at T − 1 min is the first dark one). */
export const CB_BLACKOUT_LEAD_MS = 1 * M;
/** Minutes after a release up to which it is still withheld (the minute that starts at T + 5 min is the last dark one). */
export const CB_BLACKOUT_TRAIL_MS = 5 * M;

export type CbReleaseKind = "cpi" | "nfp" | "fomc" | "ecb" | "boe";

/** The releases, ascending, as UTC instants. */
export const CB_RELEASES: ReadonlyArray<readonly [string, CbReleaseKind]> = [
  ["2026-10-28T18:00:00Z", "fomc"],  // Fed calendar: FOMC statement 14:00 EDT
  ["2026-10-29T13:15:00Z", "ecb"],   // ECB Governing Council calendar: decision 14:15 CET (summer time ended 10-25)
  ["2026-11-05T12:00:00Z", "boe"],   // BoE MPC dates: 12:00 GMT
  ["2026-11-06T13:30:00Z", "nfp"],   // BLS refused; tradingeconomics' calendar and the third-Friday rule: 08:30 EST (US summer time ended 11-01)
  ["2026-11-10T13:30:00Z", "cpi"],   // BLS refused; as recalled, UNCONFIRMED: 08:30 EST
  ["2026-12-04T13:30:00Z", "nfp"],   // BLS refused; the third-Friday rule, UNCONFIRMED
  ["2026-12-09T19:00:00Z", "fomc"],  // Fed calendar: 14:00 EST
  ["2026-12-10T13:30:00Z", "cpi"],   // BLS refused; as recalled, UNCONFIRMED
  ["2026-12-17T12:00:00Z", "boe"],   // BoE MPC dates
  ["2026-12-17T13:15:00Z", "ecb"],   // ECB Governing Council calendar
];

/** The same instants in ms, ascending. */
export const CB_RELEASE_MS: readonly number[] = CB_RELEASES.map(([t]) => Date.parse(t));

/**
 * Whether the minute that starts at `t` is a blackout minute: some release T with T − lead ≤ t ≤ T + trail. `releases` ascending.
 * The deploy does not matter: every listed release is after it, and a minute is judged by its own start, never by when the
 * engine got to decide it, so a replay of the record is the same function.
 */
export function cbInBlackout(t: number, releases: readonly number[] = CB_RELEASE_MS, lead = CB_BLACKOUT_LEAD_MS, trail = CB_BLACKOUT_TRAIL_MS): boolean {
  let lo = 0, hi = releases.length;                      // the first release at or after t − trail
  while (lo < hi) { const mid = (lo + hi) >> 1; if (releases[mid] >= t - trail) hi = mid; else lo = mid + 1; }
  return lo < releases.length && releases[lo] <= t + lead;
}
