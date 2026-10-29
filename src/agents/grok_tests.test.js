// The outside-Grok TESTING rows (Davies, 2026-10-29: "在testing列表中把IG Trader…都上线"): "Crypto analyst" (CXBOT) and
// "IG Trader" (IGBOT), from the dashboard's `cxbot` and `igbot` (`supabase/functions/agents/grok_tests_view.ts`). Pinned: the
// row's money in its own currency with dollars for the scoreboard, the dry-run's amber status, the rows' place after the
// paper tests, the page each opens, its tiles and its layer cells; and no row while the payload has none.
import { describe, expect, it } from 'vitest';
import { GROK_TEST_ROW_PREFIX, grokTestLayerCells, grokTestOf, grokTestRow, grokTestRows, grokTestTiles, paperTestRows, rowMoney, venueLabel } from './agents.js';

const CX = {
  id: 'cxbot', name: 'Crypto analyst', venueId: 'hyperliquid', ccy: 'USD', usdPerUnit: 1, mode: 'paper', startedAt: '2026-11-01T00:00:00Z', daysRun: 10, shakedown: false,
  running: true, lagMinutes: 0, budget: 1000, equity: 1012.5, realised: 10, unrealised: 2.5, fees: 1.2, today: 2.5, deployed: 133.33,
  positions: [{ market: 'BTC-PERP', direction: 'long', size: 0.005, entry: 80000, stop: 78400, limit: 83200, openedAt: '2026-11-10T10:00:00Z', pnl: 0.3 }],
  resting: 1, trades: 2, stops: { dayHit: false, totalHit: false },
  layers: [{ key: 'A', label: 'Assigned brackets', scored: 1, issued: 2, answered: 1, d: 0.1944, brierP: 0.25, brierBase: 0.4444, base: 'm' }, { key: 'B', label: 'Polymarket strikes', scored: 0, d: null, brierP: null, brierBase: null, base: 'market mid' }],
};
const IG = { ...CX, id: 'igbot', name: 'IG Trader', venueId: 'ig', ccy: 'GBP', usdPerUnit: 1.3, mode: 'dry_run', daysRun: null, equity: 1000, realised: 0, unrealised: 0, today: 0, deployed: 0, fees: 0, positions: [], resting: 0, trades: 0 };

describe('the outside-Grok TESTING rows', () => {
  it('a paper row: funded its budget, deployed its margin, its G/L on them, the green status', () => {
    const r = /** @type {any} */ (grokTestRow(CX));
    expect([r.id, r.name, r.venue, r.venueId, r.mode]).toEqual([`${GROK_TEST_ROW_PREFIX}cxbot`, 'Crypto analyst', 'Hyperliquid', 'hyperliquid', 'paper']);
    const x = rowMoney(r);
    expect([x.ccy, x.capital, x.value, x.today, x.unrealised, x.realised]).toEqual(['USD', 1000, 133.33, 2.5, 2.5, 10]);
    expect(x.todayPct).toBeCloseTo(0.25, 12);
    expect([r.status.label, r.status.tone, r.openPositions, r.openOrders]).toEqual(['paper', 'running', 1, 1]);
    expect(r.status.detail).toBe('an outside Grok agent on paper · day 10 · 1 open');
  });

  it("IG Trader in pounds, its dollars at the stored GBP/USD for the scoreboard, amber while it is a dry-run", () => {
    const r = /** @type {any} */ (grokTestRow(IG));
    expect([r.venue, r.ccy, r.capitalUsd, r.gbp.capital, r.fundedKnown]).toEqual(['IG', 'GBP', 1300, 1000, true]);
    expect([r.status.label, r.status.tone, r.status.running]).toEqual(['dry-run', 'stale', false]);
    expect(r.status.detail).toBe("dry-run on IG's demo: orders checked and journalled, none sent");
    expect(grokTestRow({ ...IG, usdPerUnit: null })?.fundedKnown).toBe(false);
    // Back in dry-run after a start the test has ENDED (the CXBOT audit, 2026-10-29), not "dry-run".
    const ended = /** @type {any} */ (grokTestRow({ ...CX, mode: 'dry_run', daysRun: 58 }));
    expect([ended.status.label, ended.status.tone]).toEqual(['ended', 'stale']);
    expect(ended.status.detail).toContain('ended after 58 days');
    expect(grokTestTiles({ ...CX, mode: 'dry_run' }, (s) => s)[0].v).toBe('ENDED');
    expect(venueLabel('ig')).toBe('IG');
  });

  it('sit after the paper tests, open their own page, and are absent while the payload has none', () => {
    const rows = paperTestRows({ cxbot: CX, igbot: IG });
    expect(rows.map((r) => r.name)).toEqual(['Crypto analyst', 'IG Trader']);
    expect(grokTestRows({})).toEqual([]);
    expect(grokTestOf(`${GROK_TEST_ROW_PREFIX}igbot`, { igbot: IG })?.name).toBe('IG Trader');
    expect(grokTestOf(`${GROK_TEST_ROW_PREFIX}nope`, { igbot: IG })).toBe(null);
    expect(grokTestOf('__grokpm', { igbot: IG })).toBe(null);
  });

  it('the page: STATUS tiles through the mask, the layer cells with D signed', () => {
    const m = (s) => s.replace(/\d/g, '•');
    const t = Object.fromEntries(grokTestTiles(CX, m).map((x) => [x.k, x]));
    expect([t.MODE.v, t['DAYS RUN'].v, t.TRADES.v, t.OPEN.v, t.OPEN.note]).toEqual(['PAPER', '10', '2', '1', '1 resting']);
    expect(t.EQUITY.v).not.toMatch(/\d/);
    expect(grokTestTiles(IG, (s) => s)[0].v).toBe('DRY-RUN');
    expect(grokTestLayerCells(CX.layers[0])).toEqual({ label: 'Assigned brackets', scored: '1 of 1 answered, 2 issued', brier: '0.250 / 0.444', base: 'm', d: '+0.194', dTone: 'gain' });
    expect(grokTestLayerCells(CX.layers[1])).toMatchObject({ scored: '0', brier: '—', d: '—', dTone: null });
    expect(grokTestLayerCells({ ...CX.layers[0], d: -0.01 }).d).toBe('−0.010');
  });
});
