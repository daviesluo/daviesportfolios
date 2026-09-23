// Pins the tactics-board edit reducers extracted from app.jsx. Each
// handler calls `setPortfolio(p => next)`; the harness captures that
// updater and applies it to a fixture so we assert the pure transform
// without React. These reducers were untested while inline in app.jsx.
import { describe, it, expect } from 'vitest';
import { createPortfolioEditHandlers } from './portfolio_edits.js';

/** Build handlers + a `run(handler, ...args) → nextPortfolio` driver. */
function setup(portfolio, isReadOnly = false) {
  let p = portfolio;
  const setPortfolio = (updater) => { p = typeof updater === 'function' ? updater(p) : updater; };
  const h = createPortfolioEditHandlers({ setPortfolio, isReadOnly });
  return { handlers: h, get: () => p };
}

const FIXTURE = () => ({
  holdings: {
    NVDA: { shares: 10, cost: 100, lastPrice: 120, currency: 'USD', lots: [{ date: '2025-01-01', shares: 10, cost: 100 }] },
    AAPL: { shares: 5, cost: 150, lastPrice: 200, currency: 'USD', lots: [{ date: '2025-02-01', shares: 5, cost: 150 }] },
  },
  positions: {
    ST: { role: 'FWD', subtitle: 'Growth', tickers: ['NVDA'] },
    CM: { role: 'MID', subtitle: 'Value', tickers: ['AAPL'] },
  },
});

describe('createPortfolioEditHandlers', () => {
  it('updateHolding recomputes shares + weighted-avg cost from an explicit lots array', () => {
    const { handlers, get } = setup(FIXTURE());
    handlers.updateHolding('NVDA', { lots: [
      { date: '2025-01-01', shares: 10, cost: 100 },
      { date: '2025-03-01', shares: 30, cost: 200 },
    ] });
    const h = get().holdings.NVDA;
    expect(h.shares).toBe(40);
    expect(h.cost).toBeCloseTo((10 * 100 + 30 * 200) / 40, 6); // 175
  });

  it('updateHolding applies sells via the net-cash model (net shares + folded AC)', () => {
    const { handlers, get } = setup(FIXTURE());
    // 10 @ 100, sell 5 @ 120 → net 5 sh, netCash 1000−600=400, AC 80.
    handlers.updateHolding('NVDA', {
      lots: [{ date: '2025-01-01', shares: 10, cost: 100 }],
      sells: [{ date: '2025-02-01', shares: 5, price: 120 }],
    });
    const h = get().holdings.NVDA;
    expect(h.shares).toBe(5);
    expect(h.cost).toBe(80);
    expect(get().positions.ST.tickers).toEqual(['NVDA']); // still on the board
  });

  it('net 0 closes the holding: off the board, kept in holdings with its ledger', () => {
    const { handlers, get } = setup(FIXTURE());
    // Sell the whole 10-share NVDA position.
    handlers.updateHolding('NVDA', {
      lots: [{ date: '2025-01-01', shares: 10, cost: 100 }],
      sells: [{ date: '2025-02-01', shares: 10, price: 130 }],
    });
    // Removed from the board…
    expect(get().positions.ST.tickers).toEqual([]);
    // …but the holding survives (closed) so its history persists.
    const h = get().holdings.NVDA;
    expect(h).toBeDefined();
    expect(h.shares).toBe(0);
    expect(h.closed).toBe(true);
    expect(h.sells).toHaveLength(1);
  });

  it('removeHolding drops the holding AND its position membership', () => {
    const { handlers, get } = setup(FIXTURE());
    handlers.removeHolding('NVDA');
    expect(get().holdings.NVDA).toBeUndefined();
    expect(get().positions.ST.tickers).toEqual([]);
  });

  it('swapPositions trades subtitle + tickers but keeps the slot role/key', () => {
    const { handlers, get } = setup(FIXTURE());
    handlers.swapPositions('ST', 'CM');
    expect(get().positions.ST).toMatchObject({ role: 'FWD', subtitle: 'Value', tickers: ['AAPL'] });
    expect(get().positions.CM).toMatchObject({ role: 'MID', subtitle: 'Growth', tickers: ['NVDA'] });
  });

  it('moveHolding strips from the old slot and appends to the target (no dupes)', () => {
    const { handlers, get } = setup(FIXTURE());
    handlers.moveHolding('NVDA', 'CM');
    expect(get().positions.ST.tickers).toEqual([]);
    expect(get().positions.CM.tickers).toEqual(['AAPL', 'NVDA']);
    handlers.moveHolding('NVDA', 'CM'); // already there → no duplicate
    expect(get().positions.CM.tickers).toEqual(['AAPL', 'NVDA']);
  });

  it('addHolding seeds lots + detects currency + places in the target slot', () => {
    const { handlers, get } = setup(FIXTURE());
    handlers.addHolding('CM', 'vuaa.l', 3, 80, 85, '2025-05-01');
    const h = get().holdings['VUAA.L'];
    expect(h.shares).toBe(3);
    expect(h.currency).toBe('USD'); // override table: VUAA.L settles USD despite .L
    expect(h.lots).toEqual([{ date: '2025-05-01', shares: 3, cost: 80 }]);
    expect(get().positions.CM.tickers).toContain('VUAA.L');
  });

  it('.PVT re-add carries the old price into prevClose so the day-change shows', () => {
    const base = FIXTURE();
    base.holdings['SPAX.PVT'] = { shares: 1, cost: 100, lastPrice: 100, currency: 'USD', lots: [] };
    base.positions.ST.tickers.push('SPAX.PVT');
    const { handlers, get } = setup(base);
    handlers.addHolding('ST', 'SPAX.PVT', 1, 100, 130);
    const h = get().holdings['SPAX.PVT'];
    expect(h.lastPrice).toBe(130);
    expect(h.prevClose).toBe(100);                 // old price retained
    expect(h.dayPct).toBeCloseTo(30, 6);           // (130-100)/100
  });

  it('every handler is a no-op in read-only mode', () => {
    const { handlers, get } = setup(FIXTURE(), /* isReadOnly */ true);
    handlers.removeHolding('NVDA');
    handlers.addHolding('CM', 'TSLA', 1, 1, 1);
    handlers.swapPositions('ST', 'CM');
    handlers.updatePosition('ST', { subtitle: 'hacked' });
    expect(get().holdings.NVDA).toBeDefined();
    expect(get().holdings.TSLA).toBeUndefined();
    expect(get().positions.ST.subtitle).toBe('Growth');
  });
});

// addHolding used to rebuild the holding from scratch, so re-adding a
// ticker you already own silently destroyed its whole ledger — every
// prior lot, every sell, and the `closed` flag — taking Transaction
// History and the YTD basis with it, with no warning and no undo.
describe('addHolding — never destroys the transaction ledger', () => {
  const withLedger = () => ({
    positions: {
      ST: { role: 'FWD', label: '', subtitle: '', tickers: ['NVDA'] },
      CM: { role: 'MID', label: '', subtitle: '', tickers: [] },
    },
    holdings: {
      NVDA: {
        shares: 10, cost: 100, lastPrice: 120, currency: 'USD',
        lots: [{ date: '2025-01-01', shares: 10, cost: 100 }],
        sells: [{ date: '2025-06-01', shares: 2, price: 150 }],
        closed: false,
      },
    },
  });

  it("'replace' restates the buy side but still nets against earlier sells", () => {
    const { handlers, get } = setup(withLedger());
    handlers.addHolding('ST', 'NVDA', 8, 110, 130, '2026-02-01', 'replace');
    const h = get().holdings.NVDA;
    // The ledger survives…
    expect(h.sells).toEqual([{ date: '2025-06-01', shares: 2, price: 150 }]);
    // …lots are restated to just this entry…
    expect(h.lots).toEqual([{ date: '2026-02-01', shares: 8, cost: 110 }]);
    // …and shares come from the LEDGER, not the typed number: 8 bought
    // − 2 already sold = 6. Taking the 8 verbatim let the tile disagree
    // with the transaction history, and the next Save from the edit
    // modal (which always nets) would then "correct" it out from under
    // the user.
    expect(h.shares).toBeCloseTo(6, 9);
  });

  it('buying back into a sold-out name clears `closed`', () => {
    const sold = withLedger();
    sold.holdings.NVDA = {
      ...sold.holdings.NVDA, shares: 0, cost: 0, closed: true,
      sells: [{ date: '2025-06-01', shares: 10, price: 150 }],
    };
    const { handlers, get } = setup(sold);
    handlers.addHolding('ST', 'NVDA', 5, 120, 125, '2026-02-01', 'replace');
    const h = get().holdings.NVDA;
    // 5 bought − 10 sold is still negative, so it stays closed…
    expect(h.closed).toBe(true);
    // …but a buy that actually restores a positive position re-opens it.
    handlers.addHolding('ST', 'NVDA', 20, 120, 125, '2026-02-02', 'replace');
    const h2 = get().holdings.NVDA;
    expect(h2.closed).toBeUndefined();
    expect(h2.shares).toBeCloseTo(10, 9);
  });

  it("'append' adds a lot and recomputes totals from the whole ledger", () => {
    const { handlers, get } = setup(withLedger());
    handlers.addHolding('ST', 'NVDA', 10, 200, 210, '2026-02-01', 'append');
    const h = get().holdings.NVDA;
    expect(h.lots).toEqual([
      { date: '2025-01-01', shares: 10, cost: 100 },
      { date: '2026-02-01', shares: 10, cost: 200 },
    ]);
    expect(h.sells).toHaveLength(1);
    // 20 bought − 2 sold = 18 net shares, not the 10 that were typed.
    expect(h.shares).toBeCloseTo(18, 9);
    expect(h.cost).toBeGreaterThan(0);
  });

  it('a brand-new ticker still seeds a single lot (no ledger to keep)', () => {
    const { handlers, get } = setup(withLedger());
    handlers.addHolding('CM', 'TSLA', 3, 300, 310, '2026-02-01', 'append');
    const h = get().holdings.TSLA;
    expect(h.lots).toEqual([{ date: '2026-02-01', shares: 3, cost: 300 }]);
    expect(h.shares).toBe(3);
    expect(h.sells).toBeUndefined();
  });
});
