// Lot helpers — sanitise + sum the per-purchase records the
// EditTickerModal collects. Pulled out of the modal so the rules
// can be pinned by vitest: the previous inline logic accepted
// negative `cost` silently (`Number("-50") || 0` evaluates to -50,
// not 0) and a corrupted lot would understate `totalCost` without
// any UI signal.
//
// Each lot is `{ date: "YYYY-MM-DD", shares: number, cost: number }`.
// All inputs are assumed to be user-typed strings or numbers; the
// helpers normalise both.

/**
 * Drop unfinishable / non-sensical rows and coerce remaining values
 * to finite numbers. Rules:
 *   - `shares` must be > 0 and finite (zero shares = no holding).
 *   - `cost` must be ≥ 0 and finite (zero allowed for gifts /
 *     spinoffs / stock splits with no cost basis); a negative cost
 *     is data corruption.
 *   - `date` must be a non-empty string in YYYY-MM-DD shape — the
 *     YTD chart math expects ISO-prefixed dates, and a malformed
 *     date silently breaks lot lookups.
 *
 * Returns a freshly-allocated sorted array (ascending by date) so
 * callers can write it straight back without mutating their input.
 *
 * @param {Array<{date?: any, shares?: any, cost?: any}>} lots
 * @returns {Array<{date: string, shares: number, cost: number}>}
 */
export function cleanLots(lots) {
  if (!Array.isArray(lots)) return [];
  /** @type {Array<{date: string, shares: number, cost: number}>} */
  const out = [];
  for (const l of lots) {
    const date = typeof l?.date === 'string' ? l.date.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const shares = Number(l?.shares);
    if (!Number.isFinite(shares) || shares <= 0) continue;
    const cost = Number(l?.cost);
    if (!Number.isFinite(cost) || cost < 0) continue;
    out.push({ date, shares, cost });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Total share count. Assumes `lots` has already been through
 * `cleanLots()` (so values are guaranteed finite + non-negative);
 * for raw user input call `cleanLots(...)` first.
 *
 * @param {Array<{shares: number}>} lots
 */
export function totalShares(lots) {
  let s = 0;
  for (const l of lots) s += l.shares;
  return s;
}

/**
 * Share-weighted average cost basis ("AC"). 0 when no shares — the
 * scoreboard / drill modal calls this on every render so the /0
 * fallback is part of the contract.
 *
 * @param {Array<{shares: number, cost: number}>} lots
 */
export function weightedAvgCost(lots) {
  let shares = 0, dollars = 0;
  for (const l of lots) { shares += l.shares; dollars += l.shares * l.cost; }
  return shares > 0 ? dollars / shares : 0;
}
