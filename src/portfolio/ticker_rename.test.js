// Pins the GOOG → GOOGL rename of a stored board (ticker_rename.js; Davies, 2026-10-21): the holding moves whole, the
// slot lists the new ticker in the old one's place, a second run changes nothing, and a board holding both is left
// alone rather than merged or doubled.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyTickerRenames, renameTicker, renameTickerRows, TICKER_RENAMES } from './ticker_rename.js';
import { ledgerProvenance } from './t212_fills.js';

const goog = { shares: 24, cost: 150, t212Shares: 22, t212Cost: 160, closed: false,
  lots: [{ date: '2024-07-24', shares: 20, cost: 140 }, { date: '2025-03-28', shares: 6, cost: 180 }],
  sells: [{ date: '2025-06-01', shares: 2, price: 170 }] };
const board = () => ({
  holdings: { NVDA: { shares: 5, cost: 100 }, GOOG: goog },
  positions: { CM: { label: 'CM', subtitle: 'BIG 7', tickers: ['NVDA', 'GOOG', 'META'] }, ST: { label: 'ST', tickers: ['RKLB'] } },
  depositFxRates: { USD: 1 },
});

describe('renameTicker', () => {
  it('is GOOG to GOOGL, the one rename there is', () => {
    expect(TICKER_RENAMES).toEqual([{ from: 'GOOG', to: 'GOOGL', on: '2026-10-21' }]);
  });

  it('moves the holding whole (lots, sales, T212 tags) and renames it in its slot, in place', () => {
    const before = board();
    const { portfolio, renamed, conflict } = renameTicker(before, 'GOOG', 'GOOGL');
    expect([renamed, conflict]).toEqual([true, false]);
    expect(Object.keys(portfolio.holdings).sort()).toEqual(['GOOGL', 'NVDA']);
    expect(portfolio.holdings.GOOGL).toBe(goog);
    expect(portfolio.positions.CM).toEqual({ label: 'CM', subtitle: 'BIG 7', tickers: ['NVDA', 'GOOGL', 'META'] });
    expect(portfolio.positions.ST).toBe(before.positions.ST);
    expect(portfolio.depositFxRates).toBe(before.depositFxRates);
    // The input is untouched.
    expect(Object.keys(before.holdings)).toEqual(['NVDA', 'GOOG']);
    expect(before.positions.CM.tickers).toEqual(['NVDA', 'GOOG', 'META']);
  });

  it('is idempotent: a renamed board is returned as it is', () => {
    const once = renameTicker(board(), 'GOOG', 'GOOGL').portfolio;
    const twice = renameTicker(once, 'GOOG', 'GOOGL');
    expect([twice.renamed, twice.conflict, twice.portfolio]).toEqual([false, false, once]);
    expect(twice.portfolio).toBe(once);
  });

  it('never makes two keys or two slot entries: a board holding both is left alone; a slot listing both keeps one', () => {
    const both = board();
    both.holdings = { ...both.holdings, GOOGL: { shares: 1, cost: 300 } };
    const out = renameTicker(both, 'GOOG', 'GOOGL');
    expect([out.renamed, out.conflict, out.portfolio]).toEqual([false, true, both]);
    const slot = board();
    slot.positions.CM = { ...slot.positions.CM, tickers: ['GOOGL', 'NVDA', 'GOOG'] };
    expect(renameTicker(slot, 'GOOG', 'GOOGL').portfolio.positions.CM.tickers).toEqual(['GOOGL', 'NVDA']);
  });

  it('a board with no GOOG anywhere is returned as it is; a slot still listing GOOG without its holding is fixed', () => {
    const none = { holdings: { NVDA: {} }, positions: { CM: { tickers: ['NVDA'] } } };
    expect(renameTicker(none, 'GOOG', 'GOOGL')).toEqual({ portfolio: none, renamed: false, conflict: false });
    const stray = { holdings: { GOOGL: goog }, positions: { CM: { tickers: ['GOOG'] } } };
    expect(renameTicker(stray, 'GOOG', 'GOOGL').portfolio.positions.CM.tickers).toEqual(['GOOGL']);
    expect(applyTickerRenames(board()).conflicts).toEqual([]);
  });

  it("stored rows: the class A line's rows become GOOGL; a GOOG_US_EQ row stays GOOG", () => {
    const rows = [{ ticker: 'GOOG', t212_ticker: 'GOOGL_US_EQ' }, { ticker: 'GOOG', t212_ticker: 'GOOG_US_EQ' }, { ticker: 'GOOG' }, { ticker: 'NVDA' }];
    expect(renameTickerRows(rows).map((r) => r.ticker)).toEqual(['GOOGL', 'GOOG', 'GOOGL', 'NVDA']);
    const plain = [{ ticker: 'NVDA' }];
    expect(renameTickerRows(plain)).toBe(plain);
  });
});


describe('after the rename, the lot editor finds the fills under GOOGL', () => {
  it('fills stored as GOOGL (0135 renames the class A rows) are the GOOGL holding\'s, and none are left on GOOG', () => {
    // t212_orders as the client reads them after 0135: the class A line's rows under GOOGL.
    const orders = [
      { id: 'invest:1', ticker: 'GOOGL', side: 'buy', shares: 20, price: 140, executed_at: '2024-07-24T14:00:00Z', account: 'invest', currency: 'USD' },
      { id: 'isa:2', ticker: 'GOOGL', side: 'buy', shares: 2, price: 180, executed_at: '2025-03-28T14:00:00Z', account: 'isa', currency: 'USD' },
    ];
    const holding = renameTicker(board(), 'GOOG', 'GOOGL').portfolio.holdings.GOOGL;
    expect(ledgerProvenance(holding, orders, 'GOOGL', true).fills).toBe(2);
    expect(ledgerProvenance(holding, orders, 'GOOG', true).fills).toBe(0);
  });
});


describe('migration 0135 renames the stored board the same way, once, and only the class A line', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '0135_googl_rename.sql'), 'utf8')
    .replace(/--[^\n]*/g, '');
  it('moves the holding whole, renames its slot entry, and bumps the version so an old tab cannot save GOOG back', () => {
    expect(sql).toContain("jsonb_set(old_data #- '{holdings,GOOG}', '{holdings,GOOGL}', old_data->'holdings'->'GOOG')");
    expect(sql).toContain("case when x.t = 'GOOG' then 'GOOGL' else x.t end");
    expect(sql).toMatch(/update public\.board_data set data = new_data, version = version \+ 1, updated_at = now\(\) where id = 1;/);
  });
  it('stops, changing nothing, when the board holds both; touches the board only when GOOG is there', () => {
    expect(sql).toMatch(/if old_data->'holdings' \? 'GOOGL' then\s+raise exception/);
    expect(sql).toMatch(/and old_data->'holdings' \? 'GOOG' then/);
  });
  it("renames only the fills and dividends whose broker code is the class A line's", () => {
    expect(sql).toContain("update public.t212_orders set ticker = 'GOOGL' where ticker = 'GOOG' and t212_ticker = 'GOOGL_US_EQ';");
    expect(sql).toContain("update public.t212_dividends set ticker = 'GOOGL' where ticker = 'GOOG' and t212_ticker = 'GOOGL_US_EQ';");
    expect(sql).not.toMatch(/price_snapshots|overnight_intraday_points|board_data_history/);
  });
});
