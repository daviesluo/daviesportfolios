// Tactics-board edit handlers, lifted out of app.jsx (which had grown
// past 1100 lines). `createPortfolioEditHandlers` is a plain factory —
// NOT a hook — so it can be called wherever the handlers are needed and
// stays trivially unit-testable: each handler is `setPortfolio(p => …)`,
// a pure reducer over the portfolio that the tests can exercise by
// capturing the updater and applying it to a fixture.
//
// Every handler is wrapped by `guard` so it's a no-op in read-only mode,
// exactly as before — the board's view-only share link can't mutate the
// book even if a stray click reaches one of these.

import { detectCurrency } from './fx.js';
import { netPosition } from './transactions.js';

/**
 * @param {{
 *   setPortfolio: (updater: (p: any) => any) => void,
 *   isReadOnly: boolean,
 * }} deps
 */
export function createPortfolioEditHandlers({ setPortfolio, isReadOnly }) {
  /** @param {(...a: any[]) => void} fn */
  const guard = (fn) => (/** @type {any[]} */ ...args) => { if (isReadOnly) return; fn(...args); };

  const updateHolding = guard((ticker, patch) => {
    setPortfolio(p => {
      const cur = p.holdings[ticker];
      if (!cur) return p;
      const next = { ...cur, ...patch };
      // When the modal saves explicit `lots` / `sells` arrays we recompute
      // the NET position (buys − sells) and the net-cash average cost — so
      // a sale's realized P&L folds into the remaining basis (see
      // transactions.netPosition). `shares`/`cost` stay the board's source
      // of truth; `lots`/`sells` are the full ledger the history reads.
      if (Array.isArray(patch.lots) || Array.isArray(patch.sells)) {
        const lots  = Array.isArray(patch.lots)  ? patch.lots  : (cur.lots  || []);
        const sells = Array.isArray(patch.sells) ? patch.sells : (cur.sells || []);
        const np = netPosition(lots, sells);
        next.shares = np.shares;
        next.cost   = np.avgCost;
        // Net 0 (or over-sold) → the position is closed: take it off the
        // board (remove from every position's `tickers`) but KEEP the
        // holding in `holdings` so its buy + sell history survives in the
        // Transaction History. `closed` marks it; nothing prunes orphan
        // holdings (portfolio_remote.migrate leaves them be).
        if (np.shares <= 0) {
          next.closed = true;
          const positions = {};
          for (const [k, pos] of Object.entries(p.positions)) {
            positions[k] = { ...pos, tickers: pos.tickers.filter(t => t !== ticker) };
          }
          return { ...p, holdings: { ...p.holdings, [ticker]: next }, positions };
        }
        delete next.closed; // re-opened (a fresh buy brought it back positive)
      }
      return { ...p, holdings: { ...p.holdings, [ticker]: next } };
    });
  });

  const removeHolding = guard((ticker) => {
    setPortfolio(p => {
      const holdings = { ...p.holdings }; delete holdings[ticker];
      const positions = {};
      for (const [k, pos] of Object.entries(p.positions)) {
        positions[k] = { ...pos, tickers: pos.tickers.filter(t => t !== ticker) };
      }
      return { ...p, holdings, positions };
    });
  });

  // Swap two tactics-board positions' player content. The slot
  // designation (label like "CM"/"CDM", role, key, pitch coord) stays
  // put; everything that identifies the *players* — the subtitle
  // (group name) and the tickers — trades places. Like two footballers
  // swapping positions on the pitch. Wired to the edit-mode drag-and-
  // drop in pitch.jsx. No-op for same slot or a missing slot.
  const swapPositions = guard((keyA, keyB) => {
    if (keyA === keyB) return;
    setPortfolio(p => {
      const a = p.positions[keyA], b = p.positions[keyB];
      if (!a || !b) return p;
      return {
        ...p,
        positions: {
          ...p.positions,
          [keyA]: { ...a, subtitle: b.subtitle, tickers: b.tickers },
          [keyB]: { ...b, subtitle: a.subtitle, tickers: a.tickers },
        },
      };
    });
  });

  // Move a holding to a different tactics-board position: strip it from
  // whatever slot currently holds it, then append to the target slot.
  // Holdings/lots are untouched — only the position membership moves.
  // No-op if the target doesn't exist or already holds the ticker.
  const moveHolding = guard((ticker, toPosKey) => {
    setPortfolio(p => {
      if (!p.positions[toPosKey]) return p;
      const positions = {};
      for (const [k, pos] of Object.entries(p.positions)) {
        positions[k] = { ...pos, tickers: pos.tickers.filter(t => t !== ticker) };
      }
      if (!positions[toPosKey].tickers.includes(ticker)) {
        positions[toPosKey] = {
          ...positions[toPosKey],
          tickers: [...positions[toPosKey].tickers, ticker],
        };
      }
      return { ...p, positions };
    });
  });

  /**
   * Add a ticker to a slot, or restate/extend one already held.
   *
   * `mode` decides what happens to an EXISTING holding's ledger:
   *   - 'append'  — record this as an ADDITIONAL buy: the new lot is
   *                 appended and shares/cost are recomputed from the
   *                 full lot+sell ledger (weighted average).
   *   - 'replace' — restate the BUY side: lots become just this entry,
   *                 earlier sells stay on the ledger and still net
   *                 against it. The `.PVT` revalue flow relies on this
   *                 (those holdings are never price-refreshed, so
   *                 re-adding is the only way to update their price);
   *                 having no sells, they net to the typed values.
   * Either way `sells` and `closed` are CARRIED OVER. The previous
   * implementation rebuilt the holding from scratch, so re-adding a
   * ticker silently destroyed its entire transaction history — sells,
   * closed flag and every prior lot — and Transaction History / YTD
   * went with it, with no warning and no undo.
   */
  const addHolding = guard((posKey, ticker, shares, cost, lastPrice, buyDate, mode = 'replace') => {
    ticker = ticker.toUpperCase().trim();
    if (!ticker) return;
    const currency = detectCurrency(ticker);
    const today = new Date().toISOString().slice(0, 10);
    const lotDate = buyDate || today;
    setPortfolio(p => {
      const existing = p.holdings[ticker];
      const newLast = Number(lastPrice) || Number(cost) || 0;
      // `.PVT` holdings are never price-refreshed (the prices Edge
      // Function skips them), so this re-add is their only price-update
      // path. Carry the OLD price into `prevClose` when the price
      // actually changes, so the day change shows (today's price vs the
      // previous update) instead of a flat 0 — the behaviour the user
      // wants for SPAX.PVT, which they revalue daily. New holdings (no
      // prior) seed prevClose = newLast → 0 % on day one. Fetched
      // tickers ignore this seed (the next refresh overwrites prevClose).
      const prevClose = (ticker.endsWith('.PVT')
          && existing && typeof existing.lastPrice === 'number'
          && existing.lastPrice > 0 && existing.lastPrice !== newLast)
        ? existing.lastPrice
        : newLast;
      const newLot = { date: lotDate, shares: Number(shares) || 0, cost: Number(cost) || 0 };
      const priorLots = Array.isArray(existing?.lots) ? existing.lots : [];
      const appending = mode === 'append' && priorLots.length > 0;
      const lots = appending ? [...priorLots, newLot] : [newLot];
      // BOTH modes derive the totals from the ledger, exactly like
      // updateHolding does — the typed shares/cost describe the LOT, and
      // the holding's shares are always lots minus sells. Taking the
      // typed number verbatim let the board disagree with the ledger:
      // sell 2 of 10, then replace with 8, and the tile said 8 while the
      // history said 8 − 2 = 6; the next Save from the edit modal would
      // then "correct" it and could close the position outright.
      // A holding with no sells (every `.PVT`, every first buy) nets to
      // exactly the typed values, so the revalue flow is unchanged.
      const np = netPosition(lots, existing?.sells);
      const holdings = {
        ...p.holdings,
        [ticker]: {
          // Spread first so ledger fields we don't manage here
          // (`sells`, `closed`, and anything added later) survive.
          ...(existing || {}),
          shares: np.shares,
          cost: np.avgCost,
          lastPrice: newLast,
          prevClose,
          dayPct: prevClose > 0 ? ((newLast - prevClose) / prevClose) * 100 : 0,
          currency,
          lots,
        },
      };
      // Buying back into a sold-out name re-opens it. Without this the
      // holding kept `closed: true` while sitting on the board — the
      // exact state migrate()'s heal exists to clean up.
      if (np.shares > 0) delete holdings[ticker].closed;
      else holdings[ticker].closed = true;
      const positions = {};
      for (const [k, pos] of Object.entries(p.positions)) {
        const tickers = pos.tickers.filter(t => t !== ticker);
        if (k === posKey) tickers.push(ticker);
        positions[k] = { ...pos, tickers };
      }
      return { ...p, holdings, positions };
    });
  });

  const updatePosition = guard((posKey, patch) => {
    setPortfolio(p => ({ ...p, positions: { ...p.positions, [posKey]: { ...p.positions[posKey], ...patch } } }));
  });

  return { updateHolding, removeHolding, swapPositions, moveHolding, addHolding, updatePosition };
}
