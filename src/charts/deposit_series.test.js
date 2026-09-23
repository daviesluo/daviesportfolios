// Closed-form pins for the deposit line. Every expected number here is
// arithmetic you can do on paper from the fixture above it — the rule is
// that a chart figure is checked against the arithmetic, never against
// another part of the app.
import { describe, it, expect } from 'vitest';
import {
  depositAt, depositSeries, depositLedgerFor, frozenFxRate,
  freezeDepositFxRates, missingDepositFxCurrencies, ledgerEventIsAfter, t212FillsFor,
} from './deposit_series.js';

const USD_ONLY = { USD: 1 };

describe('depositAt — cumulative buys minus sale proceeds', () => {
  const portfolio = {
    holdings: {
      AAPL: {
        shares: 15, cost: 120, currency: 'USD',
        lots: [
          { date: '2026-01-10', shares: 10, cost: 100 },  // $1,000
          { date: '2026-03-05', shares: 10, cost: 140 },  // $1,400
        ],
        sells: [{ date: '2026-04-01', shares: 5, price: 160 }], // -$800
      },
    },
    positions: { P: { tickers: ['AAPL'] } },
  };

  it('steps on the ledger dates and nowhere else', () => {
    const at = (d) => depositAt({ portfolio, date: d, fxRates: USD_ONLY });
    expect(at('2026-01-09')).toBeCloseTo(0, 6);      // before the first buy
    expect(at('2026-01-10')).toBeCloseTo(1000, 6);   // first buy counts on its day
    expect(at('2026-02-20')).toBeCloseTo(1000, 6);   // flat between events
    expect(at('2026-03-05')).toBeCloseTo(2400, 6);   // + 10 x 140
    expect(at('2026-03-31')).toBeCloseTo(2400, 6);   // still flat
    expect(at('2026-04-01')).toBeCloseTo(1600, 6);   // - 5 x 160
    expect(at('2026-12-31')).toBeCloseTo(1600, 6);
  });

  it('is a STEP function, never a slope', () => {
    // Sample densely across a stretch with no ledger event in it. Every
    // reading must be identical — a deposit line that moves on a day no
    // money changed hands is the bug this pins.
    const dates = [];
    for (let d = 11; d <= 28; d++) dates.push(`2026-02-${String(d).padStart(2, '0')}`);
    const series = depositSeries({ portfolio, dates, fxRates: USD_ONLY }) || [];
    expect(series.length).toBe(dates.length);
    expect(new Set(series.map(p => p.v)).size).toBe(1);
  });

  it('counts a lot bought on an intraday point\'s own day', () => {
    // "2026-01-10" vs "2026-01-10T13:30": a naive string compare reads
    // the 10-char date as EARLIER and would drop today's buy.
    expect(depositAt({ portfolio, date: '2026-01-10T13:30', fxRates: USD_ONLY }))
      .toBeCloseTo(1000, 6);
  });
});

describe('depositAt — scope and cash', () => {
  it('matches the value line: only what is on the board', () => {
    const portfolio = {
      holdings: {
        AAPL:   { shares: 10, cost: 100, currency: 'USD', lots: [{ date: '2026-01-02', shares: 10, cost: 100 }] },
        ORPHAN: { shares: 10, cost: 999, currency: 'USD', lots: [{ date: '2026-01-02', shares: 10, cost: 999 }] },
      },
      positions: { P: { tickers: ['AAPL'] } },
    };
    // ORPHAN is not referenced by any position, so `computeAt` leaves it
    // out of the value line. If it counted here, the gap between the two
    // lines would be an accounting artefact rather than profit.
    expect(depositAt({ portfolio, date: '2026-06-01', fxRates: USD_ONLY })).toBeCloseTo(1000, 6);
  });

  it('counts board cash — it was deposited too', () => {
    const portfolio = {
      holdings: {
        AAPL: { shares: 10, cost: 100, currency: 'USD', lots: [{ date: '2026-01-02', shares: 10, cost: 100 }] },
        CASH: { shares: 1, isCash: true, lastPrice: 500 },
      },
      positions: { P: { tickers: ['AAPL', 'CASH'] } },
    };
    // `computeAt` adds cash to the value, so cash has to lift the deposit
    // line by the same amount — otherwise idle cash reads as pure profit.
    expect(depositAt({ portfolio, date: '2026-06-01', fxRates: USD_ONLY })).toBeCloseTo(1500, 6);
  });

  it('a holding with no lots stands in at board cost, before every window', () => {
    const portfolio = {
      holdings: { PVT: { shares: 4, cost: 250, currency: 'USD' } },
      positions: { P: { tickers: ['PVT'] } },
    };
    const { lots } = depositLedgerFor(portfolio.holdings.PVT);
    expect(lots).toEqual([{ date: '1970-01-01', shares: 4, cost: 250 }]);
    // "Owned, dates unknown" — the money is on the line at the right
    // level everywhere rather than appearing as a step that never
    // happened.
    expect(depositAt({ portfolio, date: '2026-01-01', fxRates: USD_ONLY })).toBeCloseTo(1000, 6);
  });
});

describe('deposit FX is frozen, not live', () => {
  const portfolio = {
    holdings: {
      'VOD.L': {
        shares: 100, cost: 2, currency: 'GBP',
        lots: [{ date: '2026-01-02', shares: 100, cost: 2 }],
      },
    },
    positions: { P: { tickers: ['VOD.L'] } },
  };

  it('uses the stored rate, so the line cannot move with today\'s FX', () => {
    // 100 x £2 x 1.25 = $250, whatever sterling is doing right now.
    expect(depositAt({ portfolio, date: '2026-06-01', fxRates: { GBP: 1.25 } })).toBeCloseTo(250, 6);
    expect(depositAt({ portfolio, date: '2026-06-01', fxRates: { GBP: 1.40 } })).toBeCloseTo(280, 6);
  });

  it('declines to draw rather than convert at a 1:1 fallback', () => {
    // `fxRateToUSD` returns 1 when Yahoo didn't hand back the pair. A
    // CNY position at 1.0 instead of ~0.14 is SEVEN TIMES its real size;
    // that has already been written into a chart once. Null here means
    // the caller draws the value line alone.
    expect(depositAt({ portfolio, date: '2026-06-01', fxRates: {} })).toBe(null);
    expect(depositSeries({ portfolio, dates: ['2026-06-01'], fxRates: {} })).toBe(null);
  });

  it('freezes a live rate once and never revalues it', () => {
    expect(missingDepositFxCurrencies(portfolio)).toEqual(['GBP']);
    const first = freezeDepositFxRates(portfolio, () => 1.25, {});
    expect(first).toEqual({ GBP: 1.25 });
    const withRates = { ...portfolio, depositFxRates: first };
    expect(missingDepositFxCurrencies(withRates)).toEqual([]);
    // A later, different live rate must not overwrite it.
    expect(freezeDepositFxRates(withRates, () => 1.40, {})).toEqual({ GBP: 1.25 });
    // …and the same object comes back when nothing changed, so the
    // caller can skip a write.
    expect(freezeDepositFxRates(withRates, () => 1.40, {})).toBe(first);
  });

  it('refuses to freeze an exact 1 for a non-USD currency', () => {
    // That is the shape of `fxRateToUSD`'s missing-pair fallback, and
    // freezing it would make the seven-times error permanent.
    expect(freezeDepositFxRates(portfolio, () => 1, {})).toEqual({});
  });

  it('frozenFxRate: USD is 1, unknown is null', () => {
    expect(frozenFxRate('USD', {})).toBe(1);
    expect(frozenFxRate(undefined, {})).toBe(1);
    expect(frozenFxRate('EUR', { EUR: 1.08 })).toBe(1.08);
    expect(frozenFxRate('EUR', { EUR: 0 })).toBe(null);
    expect(frozenFxRate('EUR', null)).toBe(null);
  });
});

describe('ledgerEventIsAfter', () => {
  it('compares whole days unless both sides carry minutes', () => {
    expect(ledgerEventIsAfter('2026-04-28', '2026-04-27')).toBe(true);
    expect(ledgerEventIsAfter('2026-04-27', '2026-04-28')).toBe(false);
    expect(ledgerEventIsAfter('2026-04-28', '2026-04-28T13:30')).toBe(false);
    expect(ledgerEventIsAfter('2026-04-28T14:00', '2026-04-28T13:30')).toBe(true);
    expect(ledgerEventIsAfter('2026-04-28T13:00', '2026-04-28T13:30')).toBe(false);
    expect(ledgerEventIsAfter('', '2026-04-28')).toBe(true);
  });
});

describe('deposit — real Trading 212 fill dates', () => {
  // The board says 30 shares at an average cost of $100 → $3,000 in.
  // T212's order history only reaches back to 2026-07-20, and covers
  // 10 of those shares: a buy of 10 @ $150 on 2026-07-20.
  //   stand-in = 30 - 10 = 20 shares @ board AC 100 = $2,000, undated
  //   fills    = 10 x 150 = $1,500 on 2026-07-20
  //   → $2,000 before 20 Jul, $3,500 after.
  // The stand-in absorbs exactly the residue, so the slice always nets
  // to the board's 30 shares however much history has been walked.
  const boardHolding = {
    shares: 30, cost: 100, currency: 'USD',
    // What the sync writes when it has no dates: one tagged stand-in.
    lots: [{ date: '2026-01-01', shares: 30, cost: 100, source: 't212-synthetic' }],
    t212Shares: 30, t212Cost: 100,
  };
  const portfolio = { holdings: { NVDA: boardHolding }, positions: { P: { tickers: ['NVDA'] } } };
  const orders = [
    { ticker: 'NVDA', executed_at: '2026-07-20T14:30:00Z', side: 'buy', shares: 10, price: 150 },
  ];

  it('steps on the real fill date and stands the rest in undated', () => {
    const at = (d) => depositAt({ portfolio, date: d, fxRates: USD_ONLY, t212Orders: orders });
    expect(at('2026-07-19')).toBeCloseTo(2000, 6);
    expect(at('2026-07-20')).toBeCloseTo(3500, 6);
    expect(at('2026-08-18')).toBeCloseTo(3500, 6);
  });

  it('without the fills it is one flat line at the board total', () => {
    // Counterfactual: this is what the chart drew before the history
    // walk existed — the right level, but no dated steps at all.
    const at = (d) => depositAt({ portfolio, date: d, fxRates: USD_ONLY });
    expect(at('2026-07-19')).toBeCloseTo(3000, 6);
    expect(at('2026-08-18')).toBeCloseTo(3000, 6);
  });

  it('a sale in the fills subtracts its proceeds on its own date', () => {
    const withSell = [
      ...orders,
      { ticker: 'NVDA', executed_at: '2026-08-01T14:00:00Z', side: 'sell', shares: 4, price: 200 },
    ];
    // Net fills = 10 - 4 = 6, so the stand-in grows to 24 @ 100 = $2,400.
    //   before 20 Jul : 2400
    //   20 Jul        : 2400 + 1500 = 3900
    //   1 Aug         : 3900 - 800  = 3100
    const p = { holdings: { NVDA: { ...boardHolding, shares: 30 } }, positions: { P: { tickers: ['NVDA'] } } };
    const at = (d) => depositAt({ portfolio: p, date: d, fxRates: USD_ONLY, t212Orders: withSell });
    expect(at('2026-07-19')).toBeCloseTo(2400, 6);
    expect(at('2026-07-20')).toBeCloseTo(3900, 6);
    expect(at('2026-08-01')).toBeCloseTo(3100, 6);
  });

  it('NEVER overwrites a hand-kept ledger for the same ticker', () => {
    // A board row can hold the same ticker at T212 and at another
    // broker. Replacing its ledger with machine history was a
    // production data-loss bug — so a ledger whose own lots already net
    // to the board's shares is used as-is and the fills are ignored.
    const manual = {
      shares: 30, cost: 100, currency: 'USD',
      lots: [{ date: '2026-02-01', shares: 30, cost: 100 }],
    };
    const p = { holdings: { NVDA: manual }, positions: { P: { tickers: ['NVDA'] } } };
    const at = (d) => depositAt({ portfolio: p, date: d, fxRates: USD_ONLY, t212Orders: orders });
    expect(at('2026-01-31')).toBeCloseTo(0, 6);
    expect(at('2026-02-01')).toBeCloseTo(3000, 6);
    expect(at('2026-08-18')).toBeCloseTo(3000, 6);
  });

  it('a fill steps at its own MINUTE on an intraday point', () => {
    const at = (d) => depositAt({ portfolio, date: d, fxRates: USD_ONLY, t212Orders: orders });
    expect(at('2026-07-20T14:00')).toBeCloseTo(2000, 6);
    expect(at('2026-07-20T14:30')).toBeCloseTo(3500, 6);
  });

  it('t212FillsFor: other tickers and unusable rows are ignored', () => {
    expect(t212FillsFor(orders, 'AAPL')).toBe(null);
    expect(t212FillsFor([{ ticker: 'NVDA', executed_at: '', shares: 1, price: 1 }], 'NVDA')).toBe(null);
    expect(t212FillsFor(null, 'NVDA')).toBe(null);
  });
});

describe('deposit — an incomplete lot ledger still reconciles to the board', () => {
  // Measured on the real book: 16 of 26 holdings carry lots that don't
  // add up to their board share count, always short — BMNR has 7 lot
  // shares against 225 on the board, RKLB 30 against 160. Those shares
  // exist; they were just never written into the ledger. Trusting the
  // lots alone understates Deposited by the whole un-lotted slice.
  const portfolio = {
    holdings: {
      BMNR: {
        shares: 225, cost: 18, currency: 'USD',
        lots: [{ date: '2026-06-01', shares: 7, cost: 20 }],
      },
    },
    positions: { P: { tickers: ['BMNR'] } },
  };

  it('stands the missing slice in at board cost, before every window', () => {
    // stand-in = (225 - 7) x 18 = 3,924 undated
    // lot       = 7 x 20        =   140 on 2026-06-01
    const at = (d) => depositAt({ portfolio, date: d, fxRates: USD_ONLY });
    expect(at('2026-05-31')).toBeCloseTo(3924, 6);
    expect(at('2026-06-01')).toBeCloseTo(4064, 6);
  });

  it('leaves an over-counting ledger as written — the residue is only ever added', () => {
    // The other direction. Lots saying 9 shares were bought against a
    // board of 5 is an inconsistent ledger, but the 9 lots are real
    // recorded cash flows; inventing a negative stand-in to force the
    // share count would delete money that was actually spent.
    const over = {
      holdings: {
        X: { shares: 5, cost: 10, currency: 'USD', lots: [{ date: '2026-01-01', shares: 9, cost: 10 }] },
      },
      positions: { P: { tickers: ['X'] } },
    };
    expect(depositAt({ portfolio: over, date: '2026-06-01', fxRates: USD_ONLY })).toBeCloseTo(90, 6);
  });
});
