import { describe, it, expect } from 'vitest';
import { INITIAL_PORTFOLIO } from './data.js';

// The demo book ships inside the public bundle. It once held a real snapshot
// of the owner's holdings — share counts and average costs that anyone could
// download without a password. It stays fictional: ten shares of each name
// (0.1 BTC) at a cost of 80 % of the listed price.
describe('INITIAL_PORTFOLIO', () => {
  it('is a fictional demo book, not anyone’s holdings', () => {
    for (const [ticker, h] of Object.entries(INITIAL_PORTFOLIO.holdings)) {
      if (h.isCash) {
        expect(h.shares, ticker).toBe(1);
        expect(h.cost, ticker).toBe(0);
        continue;
      }
      expect(h.shares, ticker).toBe(ticker === 'BTC-USD' ? 0.1 : 10);
      expect(Math.abs(h.cost - h.lastPrice * 0.8), ticker).toBeLessThan(0.01);
    }
  });

  it('holds every ticker a position names', () => {
    const named = Object.values(INITIAL_PORTFOLIO.positions).flatMap((p) => p.tickers);
    for (const t of named) expect(INITIAL_PORTFOLIO.holdings[t], t).toBeDefined();
  });
});
