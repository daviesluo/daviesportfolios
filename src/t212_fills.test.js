import { describe, it, expect } from 'vitest';
import { brokerLedgerFor, splitAgainstLedger, reconcileFills, withFillsApplied } from './t212_fills.js';

const order = (ticker, executed_at, side, shares, price) => ({
  ticker, executed_at, side, shares, price,
});

describe('brokerLedgerFor', () => {
  it('splits a ticker\'s fills into buys and sales', () => {
    const orders = [
      order('RKLB', '2025-11-13T14:30:00Z', 'buy', 1, 45.97),
      order('RKLB', '2025-11-21T15:00:00Z', 'sell', 0.5, 39.5),
      order('AAPL', '2025-11-13T14:30:00Z', 'buy', 2, 200),
    ];
    const out = brokerLedgerFor(orders, 'RKLB');
    expect(out.lots).toEqual([{ date: '2025-11-13', shares: 1, cost: 45.97 }]);
    expect(out.sells).toEqual([{ date: '2025-11-21', shares: 0.5, price: 39.5 }]);
  });

  it('is empty rather than null when the backfill has nothing yet', () => {
    expect(brokerLedgerFor([], 'RKLB')).toEqual({ lots: [], sells: [] });
    expect(brokerLedgerFor(null, 'RKLB')).toEqual({ lots: [], sells: [] });
  });
});

describe('splitAgainstLedger', () => {
  const priceOf = (r) => Number(r.cost);

  it('matches a hand-typed row to the fill it recorded', () => {
    const broker = [{ date: '2025-11-13', shares: 1, cost: 45.97 }];
    const own = [{ date: '2025-11-13', shares: 1, cost: 45.97 }];
    const { matched, missing } = splitAgainstLedger(broker, own, priceOf);
    expect(matched).toHaveLength(1);
    expect(missing).toHaveLength(0);
  });

  it('tolerates a cent of rounding on price but not a different trade', () => {
    const own = [{ date: '2025-11-13', shares: 1, cost: 45.97 }];
    expect(splitAgainstLedger(
      [{ date: '2025-11-13', shares: 1, cost: 45.9712 }], own, priceOf,
    ).missing).toHaveLength(0);
    expect(splitAgainstLedger(
      [{ date: '2025-11-13', shares: 1, cost: 52.4 }], own, priceOf,
    ).missing).toHaveLength(1);
  });

  it('needs two ledger rows to absorb two identical fills', () => {
    // RKLB really does carry two 0.5-share rows at 39.50 on the same
    // day. One ledger row swallowing both would lose half the position.
    const broker = [
      { date: '2025-11-21', shares: 0.5, cost: 39.5 },
      { date: '2025-11-21', shares: 0.5, cost: 39.5 },
    ];
    const one = splitAgainstLedger(broker, [{ date: '2025-11-21', shares: 0.5, cost: 39.5 }], priceOf);
    expect(one.matched).toHaveLength(1);
    expect(one.missing).toHaveLength(1);
    const two = splitAgainstLedger(broker, [
      { date: '2025-11-21', shares: 0.5, cost: 39.5 },
      { date: '2025-11-21', shares: 0.5, cost: 39.5 },
    ], priceOf);
    expect(two.missing).toHaveLength(0);
  });

  it('treats a different date as a different trade', () => {
    const { missing } = splitAgainstLedger(
      [{ date: '2025-11-14', shares: 1, cost: 45.97 }],
      [{ date: '2025-11-13', shares: 1, cost: 45.97 }],
      priceOf,
    );
    expect(missing).toHaveLength(1);
  });
});

describe('reconcileFills', () => {
  it('flags the fills already in the ledger and lists the rest newest first', () => {
    const orders = [
      order('RKLB', '2025-11-13T14:30:00Z', 'buy', 1, 45.97),
      order('RKLB', '2026-08-18T14:30:00Z', 'buy', 3, 71.2),
      order('RKLB', '2026-08-17T14:30:00Z', 'sell', 2, 70),
    ];
    const holding = { lots: [{ date: '2025-11-13', shares: 1, cost: 45.97 }], sells: [] };
    const { rows, missingLots, missingSells } = reconcileFills(orders, 'RKLB', holding);
    expect(rows.map(r => `${r.date}:${r.kind}:${r.known}`)).toEqual([
      '2026-08-18:buy:false',
      '2026-08-17:sell:false',
      '2025-11-13:buy:true',
    ]);
    expect(missingLots).toEqual([{ date: '2026-08-18', shares: 3, cost: 71.2 }]);
    expect(missingSells).toEqual([{ date: '2026-08-17', shares: 2, price: 70 }]);
  });

  it('reports nothing for a ticker the broker never traded', () => {
    const out = reconcileFills([order('AAPL', '2026-08-18T14:30:00Z', 'buy', 1, 200)], 'BTC-USD', {});
    expect(out.rows).toEqual([]);
    expect(out.missingLots).toEqual([]);
  });
});

describe('withFillsApplied', () => {
  it('keeps every row the ledger already had — including another platform\'s', () => {
    // SPCX's 2026-04-19 and 2026-06-12 lots were bought elsewhere; the
    // broker's history will never mention them and must never drop them.
    const holding = {
      lots: [
        { date: '2026-04-19', shares: 50, cost: 105.4 },
        { date: '2026-06-12', shares: 21, cost: 135 },
      ],
      sells: [],
    };
    const out = withFillsApplied(holding, [{ date: '2026-06-22', shares: 59, cost: 144.31 }], []);
    expect(out.lots).toEqual([
      { date: '2026-04-19', shares: 50, cost: 105.4 },
      { date: '2026-06-12', shares: 21, cost: 135 },
      { date: '2026-06-22', shares: 59, cost: 144.31 },
    ]);
  });

  it('leaves the ledger untouched when nothing is missing', () => {
    const holding = { lots: [{ date: '2026-04-19', shares: 50, cost: 105.4 }], sells: [] };
    expect(withFillsApplied(holding, [], [])).toEqual({
      lots: [{ date: '2026-04-19', shares: 50, cost: 105.4 }],
      sells: [],
    });
  });

  it('survives a holding with no ledger at all', () => {
    expect(withFillsApplied(undefined, [{ date: '2026-08-18', shares: 1, cost: 10 }], []))
      .toEqual({ lots: [{ date: '2026-08-18', shares: 1, cost: 10 }], sells: [] });
  });
});
