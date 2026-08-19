import { describe, it, expect } from 'vitest';
import {
  SRC_OTHER, brokerLedgerFor, rebuildLedgerFromFills, ledgerDiffers,
  applyFillLedgers, ledgerProvenance,
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
    expect(out.lots).toEqual([{ date: '2025-11-13', shares: 1, cost: 45.97 }]);
    expect(out.sells).toEqual([{ date: '2026-08-17', shares: 0.5, price: 70 }]);
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
    expect(out.sells).toEqual([{ date: '2026-02-02', shares: 2, price: 130 }]);
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
