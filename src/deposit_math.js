// Deposit-ledger accounting shared by the Investment chart and its live
// sampler. T212 contributes actual fills; card/cash transactions never
// enter this model. A board row can combine T212 and another broker, so
// machine history is reconciled as one slice rather than replacing the
// user's whole ledger.

import { netPosition } from './transactions.js';

/**
 * Position math for already-shaped history. Unlike `netPosition`, this
 * accepts T212's minute-bearing dates instead of sanitising them as
 * manual YYYY-MM-DD editor rows.
 *
 * @param {Array<any>} lots
 * @param {Array<any>} sells
 */
function shapedLedgerPosition(lots, sells) {
  let shares = 0;
  let netCash = 0;
  for (const lot of lots) {
    const n = Number(lot?.shares);
    const cost = Number(lot?.cost);
    if (!isFinite(n) || n <= 0 || !isFinite(cost)) continue;
    shares += n;
    netCash += n * cost;
  }
  for (const sell of sells) {
    const n = Number(sell?.shares);
    const price = Number(sell?.price);
    if (!isFinite(n) || n <= 0 || !isFinite(price)) continue;
    shares -= n;
    netCash -= n * price;
  }
  if (Math.abs(shares) < 1e-9) shares = 0;
  return { shares, netCash };
}

/**
 * Cost for a missing opening slice. Prefer the cash that makes the
 * known lots plus this residual match the board AC; otherwise the
 * board AC / lastPrice.
 *
 * @param {any} h
 * @param {number} missingShares
 * @param {number} existingNetCash
 */
function residualLotCost(h, missingShares, existingNetCash) {
  const cost = Number(h?.cost);
  const px = Number(h?.lastPrice);
  const shares = Number(h?.shares);
  if (isFinite(cost) && isFinite(shares) && missingShares > 0) {
    return (shares * cost - existingNetCash) / missingShares;
  }
  if (isFinite(cost) && cost !== 0) return cost;
  if (isFinite(px) && px > 0) return px;
  return isFinite(cost) ? cost : 0;
}

/**
 * Full historical ledger for one holding. A short machine ledger cannot
 * reduce an OPEN board position: keep the known lots/sells and append
 * only the missing shares before every chart window. Replacing the
 * whole book with one 1970 lot erases real dates (the August step).
 * Closed rows keep their actual history.
 *
 * @param {any} h
 * @returns {{lots: Array<{date: string, shares: number, cost: number, source?: string}>, sells: Array<any>}}
 */
export function historyLedgerFor(h) {
  const lots = Array.isArray(h?.lots) ? h.lots : [];
  const sells = Array.isArray(h?.sells) ? h.sells : [];
  const shares = Number(h?.shares);
  const hasLots = lots.some(l => Number(l?.shares) > 0);
  if (h?.closed || !(isFinite(shares) && shares > 0)) {
    return { lots, sells };
  }
  if (!hasLots) {
    const cost = Number(h?.cost);
    const px = Number(h?.lastPrice);
    return {
      lots: [{
        date: '1970-01-01',
        shares,
        cost: isFinite(cost) && cost > 0 ? cost : (isFinite(px) && px > 0 ? px : 0),
      }],
      sells: [],
    };
  }
  const pos = shapedLedgerPosition(lots, sells);
  const missingShares = shares - pos.shares;
  if (missingShares <= 1e-6) {
    return { lots, sells };
  }
  return {
    lots: [
      ...lots,
      {
        date: '1970-01-01',
        shares: missingShares,
        cost: residualLotCost(h, missingShares, pos.netCash),
        source: 'opening-residual',
      },
    ],
    sells,
  };
}

/**
 * @param {any} h
 * @returns {Array<{date: string, shares: number, cost: number}>}
 */
export function historyLotsFor(h) {
  return historyLedgerFor(h).lots;
}

/**
 * T212's own lot/sell slice for one board ticker.
 *
 * @param {Array<any> | null | undefined} orders
 * @param {string} ticker
 * @returns {{lots: Array<{date:string,shares:number,cost:number}>, sells: Array<{date:string,shares:number,price:number}>}}
 */
export function t212LedgerForTicker(orders, ticker) {
  const lots = [];
  const sells = [];
  if (!Array.isArray(orders)) return { lots, sells };
  for (const o of orders) {
    if (o?.ticker !== ticker) continue;
    const executedAt = String(o?.executed_at || '');
    const date = executedAt.length >= 16
      ? executedAt.slice(0, 16)
      : executedAt.slice(0, 10);
    const shares = Number(o?.shares);
    const price = Number(o?.price);
    if (!date || !isFinite(shares) || shares <= 0 || !isFinite(price) || price <= 0) continue;
    if (o?.side === 'sell') sells.push({ date, shares, price });
    else lots.push({ date, shares, cost: price });
  }
  return { lots, sells };
}

/**
 * True when a ledger event happens after a chart point. Manual rows carry
 * only YYYY-MM-DD and count for that whole day; T212 fills retain
 * YYYY-MM-DDTHH:MM and step at the actual minute on intraday ranges.
 *
 * @param {unknown} eventDate
 * @param {unknown} chartDate
 */
export function ledgerEventIsAfter(eventDate, chartDate) {
  const event = String(eventDate || '');
  const chart = String(chartDate || '');
  const eventDay = event.slice(0, 10);
  const chartDay = chart.slice(0, 10);
  if (!eventDay || !chartDay) return true;
  if (eventDay !== chartDay) return eventDay > chartDay;
  if (event.length >= 16 && chart.length >= 16) {
    return event.slice(0, 16) > chart.slice(0, 16);
  }
  return false;
}

/**
 * Combine T212 fills with the non-T212 slice of a board row.
 *
 * Exact fill-shaped rows are removed from the user ledger as a multiset,
 * then added back from T212 once. If the old overwrite already destroyed
 * the other rows, infer their residual cash from board shares/AC and date
 * it before every chart window.
 *
 * @param {any} h
 * @param {{lots: Array<any>, sells: Array<any>}} t212Ledger
 */
export function depositLedgerForHolding(h, t212Ledger) {
  if (t212Ledger.lots.length === 0) return historyLedgerFor(h);
  /** @param {any} row @param {'cost'|'price'} field */
  const key = (row, field) =>
    `${String(row?.date || '').slice(0, 10)}|${Number(row?.shares)}|${Number(row?.[field])}`;
  /** @type {Map<string, number>} */
  const lotCounts = new Map();
  /** @type {Map<string, number>} */
  const sellCounts = new Map();
  for (const l of t212Ledger.lots) {
    const k = key(l, 'cost');
    lotCounts.set(k, (lotCounts.get(k) || 0) + 1);
  }
  for (const s of t212Ledger.sells) {
    const k = key(s, 'price');
    sellCounts.set(k, (sellCounts.get(k) || 0) + 1);
  }
  /**
   * @param {any[]} rows
   * @param {Map<string, number>} counts
   * @param {'cost'|'price'} field
   */
  const keepUnmatched = (rows, counts, field) => rows.filter((row) => {
    const k = key(row, field);
    const n = counts.get(k) || 0;
    if (n <= 0) return true;
    counts.set(k, n - 1);
    return false;
  });
  const otherLots = keepUnmatched(Array.isArray(h?.lots) ? h.lots : [], lotCounts, 'cost');
  const otherSells = keepUnmatched(Array.isArray(h?.sells) ? h.sells : [], sellCounts, 'price');
  const exactOther = shapedLedgerPosition(otherLots, otherSells);
  const combinedExact = {
    lots: [...otherLots, ...t212Ledger.lots],
    sells: [...otherSells, ...t212Ledger.sells],
  };

  const boardShares = Number(h?.shares);
  const boardCost = Number(h?.cost);
  // A closed other-broker ROUND TRIP has zero board shares but real
  // historical cash flows. Preserve it. A non-zero unmatched residue is
  // the old synthetic T212 lot with no matching manual sell; adding it
  // beside the complete T212 round trip would double-count the buy.
  if (!isFinite(boardShares) || boardShares <= 0 || !isFinite(boardCost)) {
    if (Math.abs(exactOther.shares) <= 1e-6) return combinedExact;
    const syntheticIndex = otherLots.findIndex((lot) =>
      Math.abs(Number(lot?.shares) - exactOther.shares) <= 1e-6
      && (lot?.source === 't212-synthetic' || String(lot?.date || '').startsWith('1970-'))
    );
    if (syntheticIndex >= 0) {
      const preservedLots = otherLots.filter((_, index) => index !== syntheticIndex);
      const preserved = shapedLedgerPosition(preservedLots, otherSells);
      if (Math.abs(preserved.shares) <= 1e-6) {
        return {
          lots: [...preservedLots, ...t212Ledger.lots],
          sells: [...otherSells, ...t212Ledger.sells],
        };
      }
    }
    return t212Ledger;
  }
  const taggedShares = Number(h?.t212Shares);
  const t212Position = shapedLedgerPosition(t212Ledger.lots, t212Ledger.sells);
  const t212Shares = isFinite(taggedShares) && taggedShares >= 0
    ? taggedShares
    : Math.max(0, t212Position.shares);
  const residualShares = Math.max(0, boardShares - t212Shares);
  const tolerance = Math.max(1e-6, residualShares * 1e-6);
  if (Math.abs(exactOther.shares - residualShares) <= tolerance) {
    return combinedExact;
  }

  const taggedCost = Number(h?.t212Cost);
  const t212CashForSplit = isFinite(taggedShares) && taggedShares >= 0
      && isFinite(taggedCost)
    ? taggedShares * taggedCost
    : t212Position.netCash;
  let otherCash = boardShares * boardCost - t212CashForSplit;
  if (!isFinite(otherCash)) otherCash = residualShares * boardCost;

  const missingShares = residualShares - exactOther.shares;
  if (missingShares > 1e-6) {
    const missingCash = otherCash - exactOther.netCash;
    return {
      lots: [
        ...otherLots,
        ...t212Ledger.lots,
        {
          date: '1970-01-01',
          shares: missingShares,
          cost: isFinite(missingCash) ? missingCash / missingShares : boardCost,
          source: 'opening-residual',
        },
      ],
      sells: [...otherSells, ...t212Ledger.sells],
    };
  }

  // Other lots longer than the residual: a blended board lot that
  // still contains the T212 slice. Cannot unblend those dates; stand
  // in the residual cash only. A SHORT other ledger must not take
  // this path — that was the August-step wipe.
  if (residualShares <= 1e-6) return combinedExact;
  return {
    lots: [{
      date: '1970-01-01',
      shares: residualShares,
      cost: residualShares > 0 ? otherCash / residualShares : 0,
      source: 'opening-residual',
    }, ...t212Ledger.lots],
    sells: t212Ledger.sells,
  };
}

