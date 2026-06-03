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
      // When the modal saves an explicit `lots` array we recompute total shares
      // and weighted-average cost from it, so the lots stay the source of truth.
      if (Array.isArray(patch.lots)) {
        const totalShares = patch.lots.reduce((s, l) => s + (Number(l.shares) || 0), 0);
        const totalCost   = patch.lots.reduce((s, l) => s + (Number(l.shares) || 0) * (Number(l.cost) || 0), 0);
        next.shares = totalShares;
        next.cost   = totalShares > 0 ? totalCost / totalShares : 0;
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

  const addHolding = guard((posKey, ticker, shares, cost, lastPrice, buyDate) => {
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
      const holdings = {
        ...p.holdings,
        [ticker]: {
          shares: Number(shares) || 0,
          cost: Number(cost) || 0,
          lastPrice: newLast,
          prevClose,
          dayPct: prevClose > 0 ? ((newLast - prevClose) / prevClose) * 100 : 0,
          currency,
          lots: [{ date: lotDate, shares: Number(shares) || 0, cost: Number(cost) || 0 }],
        },
      };
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
