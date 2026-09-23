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
 * callers can write it straight back without mutating their input. An
 * optional `ts` (epoch ms, stamped when the row was added in the editor)
 * is preserved when present so the Transaction History can order same-day
 * rows by actual record time; legacy lots simply lack it.
 *
 * `src` survives too. `src: 'other'` marks a row the Trading 212 sync has
 * no claim over — shares held at another platform, or anything typed into
 * the lot editor — and the rebuild in `t212_fills.js` reads it to decide
 * what it may replace. Dropping it here would hand those rows to the
 * broker on the next refresh.
 *
 * @param {Array<{date?: any, shares?: any, cost?: any, ts?: any, src?: any}>} lots
 * @returns {Array<{date: string, shares: number, cost: number, ts?: number, src?: string}>}
 */
export function cleanLots(lots) {
  if (!Array.isArray(lots)) return [];
  /** @type {Array<{date: string, shares: number, cost: number, ts?: number, src?: string}>} */
  const out = [];
  // Reject future-dated lots — the EditTickerModal's <input type="date">
  // sets max=today but a paste / programmatic edit can still slip
  // through. computeAt() in ytd.js correctly says "not yet held" for a
  // future date and skips the lot, while the scoreboard reads
  // h.shares directly — leaving the YTD chart and the scoreboard
  // displaying different totals for the same holding. Gate here so
  // both paths agree.
  const today = new Date().toISOString().slice(0, 10);
  for (const l of lots) {
    const date = typeof l?.date === 'string' ? l.date.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (date > today) continue;
    const shares = Number(l?.shares);
    if (!Number.isFinite(shares) || shares <= 0) continue;
    const cost = Number(l?.cost);
    if (!Number.isFinite(cost) || cost < 0) continue;
    const ts = Number(l?.ts);
    const src = typeof l?.src === 'string' && l.src ? { src: l.src } : {};
    out.push(Number.isFinite(ts) ? { date, shares, cost, ts, ...src } : { date, shares, cost, ...src });
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
