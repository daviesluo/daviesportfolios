import { describe, it, expect } from 'vitest';
import {
  SRC_OTHER, brokerLedgerFor, rebuildLedgerFromFills, ledgerDiffers,
  applyFillLedgers, ledgerProvenance, withClosedFromFills,
} from './t212_fills.js';
import { netPosition } from './transactions.js';

const fill = (ticker, date, side, shares, price) => ({
  ticker, executed_at: `${date}T14:30:00.000Z`, side, shares, price,
});

// SPCX as it really is: 59 shares at Trading 212 across twelve fills,
// 71 more bought at another platform in two lots, 130 on the board.
const SPCX_FILLS = [
  fill('SPCX', '2026-06-22', 'buy', 15, 165.58),
  fill('SPCX', '2026-06-22', 'buy', 2, 162.45),
  fill('SPCX', '2026-06-22', 'buy', 3, 158.74),
  fill('SPCX', '2026-06-22', 'buy', 4, 156.39),
  fill('SPCX', '2026-07-08', 'buy', 4, 145.55),
  fill('SPCX', '2026-07-08', 'buy', 0.5, 145.65),
  fill('SPCX', '2026-07-13', 'buy', 5.5, 140.5),
  fill('SPCX', '2026-07-13', 'buy', 5, 140.28),
  fill('SPCX', '2026-07-15', 'buy', 5, 133.39),
  fill('SPCX', '2026-07-17', 'buy', 5, 125.65),
  fill('SPCX', '2026-07-20', 'buy', 5, 120.48),
  fill('SPCX', '2026-07-22', 'buy', 5, 115.48),
];
const spcxHolding = () => ({
  shares: 130, cost: 127.840692307692, currency: 'USD',
  t212Shares: 59, t212Cost: 144.31457627,
  lots: [
    { date: '2026-04-19', shares: 50, cost: 105.4, src: SRC_OTHER },
    { date: '2026-06-12', shares: 21, cost: 135, src: SRC_OTHER },
  ],
});

describe('brokerLedgerFor', () => {
  it('splits a ticker\'s fills into buys and sales', () => {
    const out = brokerLedgerFor([
      fill('RKLB', '2025-11-13', 'buy', 1, 45.97),
      fill('RKLB', '2026-08-17', 'sell', 0.5, 70),
      fill('AAPL', '2025-11-13', 'buy', 2, 200),
    ], 'RKLB');
    expect(out.lots.map((l) => [l.date, l.shares, l.cost])).toEqual([['2025-11-13', 1, 45.97]]);
    expect(out.sells.map((x) => [x.date, x.shares, x.price])).toEqual([['2026-08-17', 0.5, 70]]);
  });

  it('is empty rather than null when the backfill has nothing yet', () => {
    expect(brokerLedgerFor([], 'RKLB')).toEqual({ lots: [], sells: [] });
    expect(brokerLedgerFor(null, 'RKLB')).toEqual({ lots: [], sells: [] });
  });
});

describe('rebuildLedgerFromFills', () => {
  it('replaces an averaged stand-in lot with the trades that really happened', () => {
    // The board's `59 @ 144.31` is T212's average price, not a trade.
    // Row-by-row reconciliation can never fix that — twelve fills from
    // 165.58 down to 115.48 correspond to no single row.
    const holding = spcxHolding();
    holding.lots.push(/** @type {any} */ ({ date: '2026-06-22', shares: 59, cost: 144.31 }));
    const out = /** @type {NonNullable<ReturnType<typeof rebuildLedgerFromFills>>} */ (
      rebuildLedgerFromFills(holding, SPCX_FILLS, 'SPCX'));
    expect(out).not.toBeNull();
    expect(out.lots).toHaveLength(14);           // 12 fills + 2 other-platform
    expect(netPosition(out.lots, out.sells).shares).toBe(130);
    expect(out.lots.filter((l) => l.cost === 144.31)).toHaveLength(0);
  });

  it('never drops a lot held at another platform', () => {
    const out = /** @type {NonNullable<ReturnType<typeof rebuildLedgerFromFills>>} */ (
      rebuildLedgerFromFills(spcxHolding(), SPCX_FILLS, 'SPCX'));
    expect(out.lots.filter((l) => l.src === SRC_OTHER)).toEqual([
      { date: '2026-04-19', shares: 50, cost: 105.4, src: SRC_OTHER },
      { date: '2026-06-12', shares: 21, cost: 135, src: SRC_OTHER },
    ]);
  });

  it('keeps the ledger in date order', () => {
    const out = /** @type {NonNullable<ReturnType<typeof rebuildLedgerFromFills>>} */ (
      rebuildLedgerFromFills(spcxHolding(), SPCX_FILLS, 'SPCX'));
    const dates = out.lots.map((l) => l.date);
    expect(dates).toEqual([...dates].sort());
    expect(dates[0]).toBe('2026-04-19');
  });

  it('refuses when the fills do not add up to the board — a half-walked backfill', () => {
    // NVDA: the board holds 60, the walk has only reached 33.5 of them.
    // Rewriting here would publish a ledger that contradicts the board.
    const holding = {
      shares: 60, cost: 136.1, t212Shares: 60,
      lots: [{ date: '2025-01-01', shares: 60, cost: 136.1 }],
    };
    expect(rebuildLedgerFromFills(holding, [
      fill('NVDA', '2026-03-27', 'buy', 33.5, 157.19),
    ], 'NVDA')).toBeNull();
  });

  it('leaves a holding the broker knows nothing about alone', () => {
    // A CN fund and a cold wallet have no `t212Shares` tag and no fills.
    // Neither may ever be emptied by this.
    const cnFund = { shares: 3336.39, cost: 1.68, lots: [{ date: '2026-05-13', shares: 3336.39, cost: 1.68 }] };
    expect(rebuildLedgerFromFills(cnFund, SPCX_FILLS, '017731')).toBeNull();
    const tagged = { ...cnFund, t212Shares: 3336.39 };
    expect(rebuildLedgerFromFills(tagged, SPCX_FILLS, '017731')).toBeNull();
  });

  it('carries sales through, and prices the remainder from them', () => {
    const holding = { shares: 1, cost: 0, t212Shares: 1, lots: [], sells: [] };
    const out = /** @type {NonNullable<ReturnType<typeof rebuildLedgerFromFills>>} */ (
      rebuildLedgerFromFills(holding, [
        fill('X', '2026-01-02', 'buy', 3, 100),
        fill('X', '2026-02-02', 'sell', 2, 130),
      ], 'X'));
    expect(out.sells.map((/** @type {any} */ x) => [x.date, x.shares, x.price]))
      .toEqual([['2026-02-02', 2, 130]]);
    // Net-cash model: the banked gain lowers what the kept share cost.
    expect(netPosition(out.lots, out.sells).avgCost).toBeCloseTo(40, 9);
  });
});

describe('ledgerDiffers', () => {
  it('is false once the ledger already equals the rebuild', () => {
    const holding = spcxHolding();
    const nn = /** @type {(h: any) => NonNullable<ReturnType<typeof rebuildLedgerFromFills>>} */ (
      (h) => /** @type {any} */ (rebuildLedgerFromFills(h, SPCX_FILLS, 'SPCX')));
    const next = nn(holding);
    expect(ledgerDiffers(holding, next)).toBe(true);
    const settled = { ...holding, lots: next.lots, sells: next.sells };
    expect(ledgerDiffers(settled, nn(settled))).toBe(false);
  });
});

describe('applyFillLedgers', () => {
  it('rewrites what it can and reports it, leaving the rest untouched', () => {
    const holdings = {
      SPCX: spcxHolding(),
      NVDA: { shares: 60, cost: 136.1, t212Shares: 60, lots: [{ date: '2025-01-01', shares: 60, cost: 136.1 }] },
      'BTC-USD': { shares: 0.075, cost: 65495, lots: [{ date: '2026-02-11', shares: 0.075, cost: 65495 }] },
    };
    const changed = applyFillLedgers(holdings, [...SPCX_FILLS, fill('NVDA', '2026-03-27', 'buy', 33.5, 157.19)]);
    expect(changed).toEqual(['SPCX']);
    expect(holdings.NVDA.lots).toHaveLength(1);
    expect(holdings['BTC-USD'].lots).toHaveLength(1);
    expect(netPosition(holdings.SPCX.lots, holdings.SPCX.sells).shares).toBe(130);
  });

  it('is idempotent — a second pass reports nothing', () => {
    const holdings = { SPCX: spcxHolding() };
    expect(applyFillLedgers(holdings, SPCX_FILLS)).toEqual(['SPCX']);
    expect(applyFillLedgers(holdings, SPCX_FILLS)).toEqual([]);
  });

  it('does nothing at all before the backfill has produced anything', () => {
    const holdings = { SPCX: spcxHolding() };
    expect(applyFillLedgers(holdings, [])).toEqual([]);
    expect(holdings.SPCX.lots).toHaveLength(2);
  });

  it('never changes a share count', () => {
    // The cost DOES move to the ledger's own figure (see below); the
    // share count is the one thing this may not touch.
    const holdings = { SPCX: spcxHolding() };
    applyFillLedgers(holdings, SPCX_FILLS);
    expect(holdings.SPCX.shares).toBe(130);
  });
});

describe('ledgerProvenance', () => {
  it('says synced once the rows are the broker\'s own history', () => {
    expect(ledgerProvenance(spcxHolding(), SPCX_FILLS, 'SPCX'))
      .toEqual({ state: 'synced', fills: 12, other: 2 });
  });

  it('says pending while the walk is still running', () => {
    const holding = { shares: 60, cost: 136.1, t212Shares: 60, lots: [] };
    expect(ledgerProvenance(holding, [fill('NVDA', '2026-03-27', 'buy', 33.5, 157.19)], 'NVDA').state)
      .toBe('pending');
  });

  it('says manual for a holding the broker never had', () => {
    const cnFund = { shares: 3336.39, cost: 1.68, lots: [] };
    expect(ledgerProvenance(cnFund, SPCX_FILLS, '017731').state).toBe('manual');
  });

  it('stops saying pending once the walk has finished', () => {
    const holding = { shares: 60, cost: 136.1, t212Shares: 60, lots: [] };
    const orders = [fill('NVDA', '2026-03-27', 'buy', 33.5, 157.19)];
    expect(ledgerProvenance(holding, orders, 'NVDA', true).state).toBe('manual');
  });
});

describe('applyFillLedgers — cost follows the trades', () => {
  it('sets the average cost from the rebuilt ledger, not the broker\'s buy-only average', () => {
    // A holding sold down: T212 reports the average of what was BOUGHT
    // and says nothing about the sale. The net-cash model this app uses
    // folds the realized loss into what the kept shares cost.
    const holdings = {
      X: {
        shares: 1, cost: 100, t212Shares: 1,
        lots: [{ date: '2026-01-02', shares: 1, cost: 100 }],
      },
    };
    applyFillLedgers(holdings, [
      fill('X', '2026-01-02', 'buy', 3, 100),
      fill('X', '2026-02-02', 'sell', 2, 80),
    ]);
    // 300 paid − 160 taken back = 140 of net cash behind 1 share.
    expect(holdings.X.cost).toBeCloseTo(140, 9);
    expect(holdings.X.shares).toBe(1);
  });

  it('leaves the cost alone on a holding that was only ever bought', () => {
    const holdings = { SPCX: spcxHolding() };
    applyFillLedgers(holdings, SPCX_FILLS);
    // 71 elsewhere at 8,105 + 59 at T212 = 16,619.56 over 130 shares.
    expect(holdings.SPCX.cost).toBeCloseTo(127.8427, 4);
  });

  it('re-applies the cost even when the ledger is already settled', () => {
    // The position sync writes its own average first on every tick, so
    // a rebuild that skipped an unchanged ledger would let the two
    // alternate on screen.
    const holdings = { SPCX: spcxHolding() };
    applyFillLedgers(holdings, SPCX_FILLS);
    holdings.SPCX.cost = 999;
    expect(applyFillLedgers(holdings, SPCX_FILLS)).toEqual([]);
    expect(holdings.SPCX.cost).toBeCloseTo(127.8427, 4);
  });
});

describe('rebuildLedgerFromFills — sold-out holdings', () => {
  // Trading 212 stops reporting a position once it's closed, so a
  // sold-out holding has no `t212Shares` tag. Those were exactly the
  // ones the history was missing most: NET showed eight purchases and
  // not one sale, against a board reading zero shares.
  const NET_FILLS = [
    fill('NET', '2025-11-18', 'buy', 2, 300),
    fill('NET', '2025-11-21', 'buy', 1.5, 310),
    fill('NET', '2025-12-02', 'sell', 3.5, 340),
  ];

  it('rebuilds a closed position from its fills even with no tag', () => {
    const holding = {
      shares: 0, cost: 0, closed: true,
      lots: [{ date: '2025-11-18', shares: 3.5, cost: 305 }],
      sells: [],
    };
    const out = /** @type {NonNullable<ReturnType<typeof rebuildLedgerFromFills>>} */ (
      rebuildLedgerFromFills(holding, NET_FILLS, 'NET'));
    expect(out).not.toBeNull();
    expect(out.lots).toHaveLength(2);
    expect(out.sells).toHaveLength(1);
    expect(netPosition(out.lots, out.sells).shares).toBe(0);
  });

  it('still refuses when the fills do not net to the closed position', () => {
    const holding = { shares: 0, cost: 0, lots: [], sells: [] };
    expect(rebuildLedgerFromFills(holding, [fill('NET', '2025-11-18', 'buy', 2, 300)], 'NET'))
      .toBeNull();
  });

  it('leaves an untagged OPEN holding alone — the wallet stays the owner\'s', () => {
    const wallet = { shares: 0.075, cost: 65495, lots: [{ date: '2026-02-11', shares: 0.075, cost: 65495 }] };
    expect(rebuildLedgerFromFills(wallet, NET_FILLS, 'BTC-USD')).toBeNull();
  });
});

describe('withClosedFromFills', () => {
  const ORDERS = [
    fill('NFLX', '2025-12-02', 'buy', 3, 900),
    fill('NFLX', '2026-06-22', 'sell', 3, 1100),
    fill('SPCX', '2026-06-22', 'buy', 15, 165.58),
    { ticker: null, executed_at: '2026-01-01T00:00:00Z', side: 'buy', shares: 1, price: 5 },
  ];

  it('adds a ticker the board no longer carries, with its whole history', () => {
    // 41 tickers and ~950 executed trades were invisible to the
    // transaction history for want of a row to hang them on.
    const out = withClosedFromFills({ SPCX: spcxHolding() }, ORDERS);
    expect(Object.keys(out).sort()).toEqual(['NFLX', 'SPCX']);
    expect(out.NFLX.lots).toHaveLength(1);
    expect(out.NFLX.sells).toHaveLength(1);
    expect(out.NFLX.shares).toBe(0);
    expect(out.NFLX.closed).toBe(true);
  });

  it('never touches a ticker the board still has', () => {
    const board = { SPCX: spcxHolding() };
    const out = withClosedFromFills(board, ORDERS);
    expect(out.SPCX).toBe(board.SPCX);
  });

  it('skips a fill the mapper could not name', () => {
    const out = withClosedFromFills({}, ORDERS);
    expect(Object.keys(out).sort()).toEqual(['NFLX', 'SPCX']);
  });

  it('hands the board straight back when there are no fills', () => {
    const board = { SPCX: spcxHolding() };
    expect(withClosedFromFills(board, [])).toBe(board);
    expect(withClosedFromFills(board, null)).toBe(board);
  });
});

// ---- The fill's currency is Trading 212's, stored on the fill (0095, 2026-10-07) ----
import { statedFillCurrency, fillCurrencyConflicts, dividendEventsByTicker, withDividendCosts } from './t212_fills.js';
import { lotsFromOrders, fillCurrency, T212_PENCE_TICKERS } from './trading212.js';
import { annotateLedger } from './transactions.js';

const cfill = (ticker, date, side, shares, price, currency) => ({ ...fill(ticker, date, side, shares, price), currency });

describe('fill currency — what Trading 212 states decides, the hand tables only stand in', () => {
  it('a new London line stated in pence is divided by 100 although no hand table lists it', () => {
    const led = lotsFromOrders([cfill('NEWP.L', '2026-01-05', 'buy', 2, 1234, 'GBX')], 'NEWP.L');
    expect(led?.lots[0].cost).toBeCloseTo(12.34, 9);
    expect(withClosedFromFills({}, [cfill('NEWP.L', '2026-01-05', 'buy', 2, 1234, 'GBX')])['NEWP.L'].currency).toBe('GBP');
  });

  it('a new London line stated in dollars is booked in dollars, not the suffix\'s pounds', () => {
    const all = withClosedFromFills({}, [cfill('NEWD.L', '2026-01-05', 'buy', 1, 50, 'USD')]);
    expect(all['NEWD.L'].currency).toBe('USD');
    expect(all['NEWD.L'].lots[0].cost).toBe(50);
  });

  it('a row without a currency falls back to the pence list and the ticker\'s rule, as before', () => {
    expect(fillCurrency({}, 'JEQP.L')).toEqual({ currency: 'GBP', unit: 0.01, stated: false });
    expect(fillCurrency({ currency: null }, 'ROLG.L')).toEqual({ currency: 'GBP', unit: 1, stated: false });
    expect(fillCurrency({ currency: 'gbx' }, 'ROLG.L')).toEqual({ currency: 'GBP', unit: 0.01, stated: true });
    expect(lotsFromOrders([fill('JEQP.L', '2026-01-05', 'buy', 1, 2000)], 'JEQP.L')?.lots[0].cost).toBe(20);
  });

  it('statedFillCurrency: one currency when the fills agree, null when none states one or they disagree', () => {
    expect(statedFillCurrency([cfill('A.L', '2026-01-05', 'buy', 1, 1, 'GBX'), fill('A.L', '2026-01-06', 'buy', 1, 1)], 'A.L')).toBe('GBP');
    expect(statedFillCurrency([fill('A.L', '2026-01-05', 'buy', 1, 1)], 'A.L')).toBe(null);
    expect(statedFillCurrency([cfill('A.L', '2026-01-05', 'buy', 1, 1, 'GBP'), cfill('A.L', '2026-01-06', 'buy', 1, 1, 'USD')], 'A.L')).toBe(null);
  });

  // The book's London and European fills as Trading 212 states them (the probe, 2026-10-07), against the hand tables:
  // no disagreement, so nothing is reported today.
  it('every currency the stored fills carry agrees with the hand tables', () => {
    const stated = [
      ['JEQP.L', 'GBX'], ['CSPX.L', 'USD'], ['QQQ3.L', 'USD'], ['VUAA.L', 'USD'], ['SAEM.L', 'USD'],
      ['ROLG.L', 'GBP'], ['SEGM.L', 'GBP'], ['VUAG.L', 'GBP'], ['2DG.SG', 'EUR'], ['XFAB.PA', 'EUR'], ['AAPL', 'USD'],
    ];
    const orders = stated.map(([t, c]) => cfill(t, '2026-01-05', 'buy', 1, 1, c));
    expect(fillCurrencyConflicts(orders, {})).toEqual([]);
    expect([...T212_PENCE_TICKERS]).toEqual(['JEQP.L']);
  });

  it('a disagreement is named: pence the list lacks, a listed line stated otherwise, a holding in another currency, two currencies', () => {
    const got = fillCurrencyConflicts([
      cfill('NEWP.L', '2026-01-05', 'buy', 1, 1, 'GBX'),
      cfill('JEQP.L', '2026-01-05', 'buy', 1, 1, 'GBP'),
      cfill('AAPL', '2026-01-05', 'buy', 1, 1, 'USD'),
      cfill('MIX', '2026-01-05', 'buy', 1, 1, 'USD'), cfill('MIX', '2026-01-06', 'buy', 1, 1, 'EUR'),
    ], { AAPL: { currency: 'EUR' } });
    expect(got).toEqual([
      { ticker: 'NEWP.L', stated: 'GBX', expected: 'not GBX', reason: 'pence list' },
      { ticker: 'JEQP.L', stated: 'GBP', expected: 'GBX', reason: 'pence list' },
      { ticker: 'AAPL', stated: 'USD', expected: 'EUR', reason: 'holding currency' },
      { ticker: 'MIX', stated: 'EUR/USD', expected: 'one currency', reason: 'fills disagree' },
    ]);
  });

  it('a holding kept in another currency than its fills is not rebuilt from them', () => {
    const orders = [cfill('ABC', '2026-01-05', 'buy', 2, 10, 'EUR')];
    expect(rebuildLedgerFromFills({ shares: 2, t212Shares: 2, currency: 'USD', lots: [] }, orders, 'ABC')).toBe(null);
    expect(rebuildLedgerFromFills({ shares: 2, t212Shares: 2, currency: 'EUR', lots: [] }, orders, 'ABC')?.lots).toHaveLength(1);
  });
});

describe('dividends — one set of events for the board and the history', () => {
  const row = (over = {}) => ({
    ticker: 'ABC', paid_on: '2026-02-01T12:00:00.000Z', quantity: 10, amount: 15, currency: 'GBP',
    amount_holding: 20, holding_currency: 'USD', ...over,
  });

  it('dividendEventsByTicker: the converted net amount in the holding\'s currency, and why a row was left out', () => {
    const { byTicker, skipped } = dividendEventsByTicker([
      row(),
      row({ paid_on: '2026-02-02T12:00:00.000Z', amount_holding: null }),
      row({ ticker: 'XYZ', holding_currency: 'USD' }),
    ], { ABC: { currency: 'USD' }, XYZ: { currency: 'EUR' } });
    expect(byTicker).toEqual({ ABC: [{ date: '2026-02-01', amount: 20, ts: Date.parse('2026-02-01T12:00:00.000Z'), shares: 10 }] });
    expect(skipped).toEqual([
      { ticker: 'ABC', reason: 'not yet converted', paidOn: '2026-02-02T12:00:00.000Z' },
      { ticker: 'XYZ', reason: 'currency USD ≠ EUR', paidOn: '2026-02-01T12:00:00.000Z' },
    ]);
  });

  it('withDividendCosts: a holding with no dividends is the same object; one with them reads cost − dividends / shares', () => {
    const portfolio = { holdings: { ABC: { shares: 10, cost: 100, currency: 'USD' }, DEF: { shares: 5, cost: 7 } } };
    expect(withDividendCosts(portfolio, {})).toBe(portfolio);
    expect(withDividendCosts(portfolio, { DEF: [] })).toBe(portfolio);
    const shown = withDividendCosts(portfolio, { ABC: [{ date: '2026-02-01', amount: 20 }] });
    expect(shown?.holdings.ABC.cost).toBeCloseTo(98, 9);
    expect(shown?.holdings.ABC.dividendsReceived).toBe(20);
    expect(shown?.holdings.DEF).toBe(portfolio.holdings.DEF);
    expect(portfolio.holdings.ABC.cost).toBe(100); // the stored book is never touched
    // Sold out: no average cost to lower.
    const closed = { holdings: { ABC: { shares: 0, cost: 0 } } };
    expect(withDividendCosts(closed, { ABC: [{ date: '2026-02-01', amount: 20 }] })).toBe(closed);
  });

  it('a position rebuilt from its fills reads the same Avg Cost on the board and on its latest history row', () => {
    const orders = [
      fill('ABC', '2026-01-05', 'buy', 10, 100),
      fill('ABC', '2026-01-20', 'sell', 4, 130),
      fill('ABC', '2026-03-01', 'buy', 6, 90),
    ];
    const holdings = { ABC: { shares: 12, cost: 0, t212Shares: 12, currency: 'USD', lots: [] } };
    applyFillLedgers(holdings, orders);
    const divs = [{ date: '2026-02-10', amount: 3, shares: 6 }, { date: '2026-04-10', amount: 6, shares: 12 }];
    const board = withDividendCosts({ holdings }, { ABC: divs })?.holdings.ABC.cost;
    const last = annotateLedger(holdings.ABC.lots, holdings.ABC.sells, divs).at(-1);
    expect(last?.kind).toBe('div');
    expect(board).toBeCloseTo(/** @type {number} */ (last?.acAfter), 9);
    expect(board).toBeCloseTo((1000 - 520 + 540 - 9) / 12, 9);
  });
});
