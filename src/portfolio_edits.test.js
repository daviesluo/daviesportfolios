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
