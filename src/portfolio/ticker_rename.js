// A holding's ticker changed on the board, carried through a copy of the board kept in this browser.
//
// Davies holds Alphabet's class A line, GOOGL: every Trading 212 fill and dividend of it is `GOOGL_US_EQ`. Until
// 2026-10-21 the shared T212 map put it on the board as GOOG (class C), so the board, its slot on the tactics board,
// its fills and dividends all said GOOG, and prices, the chart, earnings and Target price read the other line
// (Davies, 2026-10-21: "I've only just noticed that all the Google I hold is GOOGL, not the GOOG the site shows").
//
// The stored board is renamed by migration 0135, in the database. This is the same rename for the copies a browser
// holds of it (the cached board, an unsaved draft, the cached dividends), run once by `Storage.migrate()` at schema
// version 3, so a copy kept from before cannot paint GOOG again or save it back. It moves the holding whole, lots,
// sells, Trading 212 tags and all, and touches nothing else.

/** The renames a stored copy is brought through, in order. */
export const TICKER_RENAMES = Object.freeze([Object.freeze({ from: 'GOOG', to: 'GOOGL', on: '2026-10-21' })]);

/**
 * The board with `from` renamed `to`: the holding moved whole to the new key, and every tactics-board slot listing
 * `from` listing `to` in its place (once: a slot that already lists `to` just drops `from`). Returns the same object
 * when there is nothing to rename, and never mutates its input.
 *
 * When the board already holds BOTH tickers, nothing is renamed and `conflict` is true: two positions cannot become
 * one without a person deciding how, and a rename that dropped either would lose its lots.
 *
 * @template {{ holdings?: Record<string, any>, positions?: Record<string, any> }} P
 * @param {P} portfolio @param {string} from @param {string} to
 * @returns {{ portfolio: P, renamed: boolean, conflict: boolean }}
 */
export function renameTicker(portfolio, from, to) {
  const holdings = portfolio && typeof portfolio.holdings === 'object' && portfolio.holdings ? portfolio.holdings : null;
  if (!holdings || from === to) return { portfolio, renamed: false, conflict: false };
  const has = (/** @type {string} */ k) => Object.prototype.hasOwnProperty.call(holdings, k);
  if (has(from) && has(to)) return { portfolio, renamed: false, conflict: true };
  const positions = portfolio.positions && typeof portfolio.positions === 'object' ? portfolio.positions : null;
  const listed = !!positions && Object.values(positions).some((p) => Array.isArray(p?.tickers) && p.tickers.includes(from));
  if (!has(from) && !listed) return { portfolio, renamed: false, conflict: false };

  /** @type {Record<string, any>} */
  let nextHoldings = holdings;
  if (has(from)) {
    nextHoldings = {};
    for (const [k, v] of Object.entries(holdings)) nextHoldings[k === from ? to : k] = v;
  }
  /** @type {Record<string, any> | undefined} */
  let nextPositions = positions ?? undefined;
  if (listed && positions) {
    nextPositions = {};
    for (const [key, p] of Object.entries(positions)) {
      if (!Array.isArray(p?.tickers) || !p.tickers.includes(from)) { nextPositions[key] = p; continue; }
      const already = p.tickers.includes(to);
      nextPositions[key] = { ...p, tickers: p.tickers.flatMap((/** @type {string} */ t) => (t !== from ? [t] : already ? [] : [to])) };
    }
  }
  return { portfolio: /** @type {P} */ ({ ...portfolio, holdings: nextHoldings, ...(nextPositions ? { positions: nextPositions } : {}) }), renamed: true, conflict: false };
}

/**
 * Every rename of TICKER_RENAMES applied in turn; `conflicts` names the ones left undone because both tickers were held.
 * @template {{ holdings?: Record<string, any>, positions?: Record<string, any> }} P
 * @param {P} portfolio
 * @returns {{ portfolio: P, renamed: boolean, conflicts: string[] }}
 */
export function applyTickerRenames(portfolio) {
  let p = portfolio, renamed = false;
  /** @type {string[]} */
  const conflicts = [];
  for (const r of TICKER_RENAMES) {
    const out = renameTicker(p, r.from, r.to);
    p = out.portfolio;
    renamed = renamed || out.renamed;
    if (out.conflict) conflicts.push(`${r.from}→${r.to}`);
  }
  return { portfolio: p, renamed, conflicts };
}

/**
 * Stored rows that carry a `ticker` (the cached Trading 212 dividends): each row of a renamed ticker under the new one,
 * when the row says it is that line (`t212_ticker` `GOOGL_US_EQ`, or no `t212_ticker` at all).
 * @param {any[]} rows
 */
export function renameTickerRows(rows) {
  if (!Array.isArray(rows)) return rows;
  let changed = false;
  const out = rows.map((r) => {
    const rule = TICKER_RENAMES.find((x) => r && r.ticker === x.from);
    if (!rule) return r;
    if (r.t212_ticker && r.t212_ticker !== `${rule.to}_US_EQ`) return r;
    changed = true;
    return { ...r, ticker: rule.to };
  });
  return changed ? out : rows;
}
