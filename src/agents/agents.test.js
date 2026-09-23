import { describe, it, expect, vi } from 'vitest';
import {
  defaultChartSymbol, fetchAgentsChart, fetchAgentsDashboard, fmtBps, fmtFees, lastChangeText, symbolOrderRows,
  fmtFrac, fmtUsd, kindLabel, liveStateRows, nextDecisionText, observationAgeMs, observationAgeText, observationView, orderView,
  strategyRows, strategyStatus, totalsView, untilText, venueHue, venueRows,
  agentsAlerts, agentsErrorView, parseAgentsErrorBody, shortErrorMessage, positionLines, shareSegments, paperOnly, countdownText, prefetchAgentsDashboard, readAgentsCache, readChartCache, glText, scoreboardView, strategyScoreboard,
  newestWins, sizeText } from './agents.js';
import {
  chartGeometry, fmtChartPrice, fmtChartStamp, fmtChartTime, hoverPoint, isResting, markPath, niceStep, priceTicks, tooltipBox, windowText, plotLabelY,
} from './agents_chart.js';

const NOW = Date.parse('2026-09-20T12:00:00Z');

const strategy = (over = {}) => ({
  id: 'trend-4h', kind: 'trend-4h', venue: 'revx', name: 'Trend 4h · Revolut X', mode: 'paper', capitalUsd: 60,
  costUsd: 20, valueUsd: 21.5, unrealisedUsd: 1.5, realisedUsd: -0.4, feesUsd: 0,
  positions: [{ symbol: 'BTC/USD', base: 0.00025 }, { symbol: 'ETH/USD', base: 0 }],
  openOrders: 1, ordersToday: 2,
  lastDecision: { ts: '2026-09-20T08:05:00Z', symbol: 'BTC/USD', action: 'hold' },
  ...over,
});

describe('strategyStatus', () => {
  it('runs while the last decision is within two bars, stale after', () => {
    expect(strategyStatus(strategy(), null, NOW)).toEqual({ label: 'paper', running: true, tone: 'running', detail: 'decided 3h 55m ago' });
    const old = strategy({ lastDecision: { ts: '2026-09-19T20:00:00Z', symbol: 'BTC/USD', action: 'hold' } });
    expect(strategyStatus(old, null, NOW).running).toBe(false);
    expect(strategyStatus(old, null, NOW).detail).toMatch(/^last decision 16h 00m ago$/);
    // A daily strategy is allowed two days.
    expect(strategyStatus(strategy({ kind: 'momentum-1d', lastDecision: { ts: '2026-09-19T00:10:00Z' } }), null, NOW).running).toBe(true);
  });
  it('paused rows, the global pause and a strategy that never decided are not running', () => {
    expect(strategyStatus(strategy({ mode: 'paused' }), null, NOW)).toEqual({ label: 'paused', running: false, tone: 'paused', detail: 'paused' });
    expect(strategyStatus(strategy({ mode: 'live' }), { global_pause: true }, NOW)).toEqual({ label: 'live', running: false, tone: 'paused', detail: 'global pause' });
    expect(strategyStatus(strategy({ lastDecision: null }), null, NOW).detail).toBe('no decision yet');
  });
});

describe('strategyRows / totalsView', () => {
  it('derives total P&L, return on capital and the counts the table shows', () => {
    const dash = { risk: { global_pause: false }, strategies: [strategy(), strategy({ id: 'trend-4h-kraken', venue: 'kraken', unrealisedUsd: -2, realisedUsd: 0, capitalUsd: 0, positions: [] })] };
    const rows = strategyRows(dash, NOW);
    expect(rows[0]).toMatchObject({ id: 'trend-4h', venue: 'Revolut X', kind: 'Trend 4h', mode: 'paper', totalPnlUsd: 1.1, openPositions: 1, openOrders: 1, ordersToday: 2, lastAction: 'hold', lastSymbol: 'BTC/USD' });
    expect(rows[0].returnPct).toBeCloseTo(1.1 / 60 * 100, 6);
    expect(rows[0].lastAgeMs).toBe(NOW - Date.parse('2026-09-20T08:05:00Z'));
    expect(rows[1]).toMatchObject({ venue: 'Kraken', totalPnlUsd: -2, returnPct: null, openPositions: 0 });
  });
  it('totals fall back to zero and split by mode', () => {
    expect(totalsView(null)).toEqual({ realisedUsd: 0, unrealisedUsd: 0, valueUsd: 0, costUsd: 0, feesUsd: 0, liveRealisedUsd: 0, paperRealisedUsd: 0 });
    expect(totalsView({ totals: { realisedUsd: 3, byMode: { live: { realisedUsd: 1 }, paper: { realisedUsd: 2 } } } })).toMatchObject({ realisedUsd: 3, liveRealisedUsd: 1, paperRealisedUsd: 2 });
  });
});

describe('orderView', () => {
  it('an order row: notional from the fill when there is one, else from the resting price', () => {
    expect(orderView({ id: 1, ts: 't', symbol: 'BTC/USD', side: 'buy', mode: 'paper', state: 'filled', price: 80000, base_size: 0.00025, filled_base: 0.00025, avg_fill_price: 79990, fee_usd: 0.08 }))
      .toMatchObject({ fillPrice: 79990, notionalUsd: 19.9975, feeUsd: 0.08, base: 0.00025 });
    expect(orderView({ price: 80000, base_size: 0.00025, filled_base: 0, avg_fill_price: null }).notionalUsd).toBe(20);
  });
});

describe('formatting', () => {
  it('keeps cents on a small book and signs gains', () => {
    expect(fmtUsd(1.5, true)).toBe('+$1.50');
    expect(fmtUsd(-0.4)).toBe('-$0.40');
    expect(fmtFrac(-0.2806)).toBe('-28.1%');
    expect(fmtFrac(null)).toBe('—');
    expect(fmtFees({ maker: 40, taker: 80 })).toBe('0.4% / 0.8%');
    expect(fmtFees(undefined)).toBe('—');
  });
});

describe('fetchAgentsDashboard', () => {
  it('sends the app token and surfaces the server message on failure', async () => {
    sessionStorage.setItem('dp.token', 'tok.sig');
    const fetchImpl = vi.fn(async (url, init) => {
      // Pinned to London: the dashboard reads the Binance account, and Binance refuses a US region (451).
      expect(String(url)).toMatch(/\/functions\/v1\/agents\?action=dashboard&forceFunctionRegion=eu-west-2$/);
      expect(init.headers['X-App-Token']).toBe('tok.sig');
      return new Response(JSON.stringify({ at: 'x', strategies: [] }), { status: 200 });
    });
    expect(await fetchAgentsDashboard(fetchImpl)).toEqual({ at: 'x', strategies: [] });
    const bad = vi.fn(async () => new Response('{"error":"unauthorised"}', { status: 401 }));
    await expect(fetchAgentsDashboard(bad)).rejects.toThrow(/401 .*unauthorised/);
  });
});

describe('venueRows / untilText', () => {
  it('splits the book by venue and takes the share of deployed value, or of capital while nothing is deployed', () => {
    const dash = {
      byVenue: { revx: { valueUsd: 30, capitalUsd: 140, realisedUsd: 1, strategies: 4, live: 0 }, binance: { valueUsd: 10, capitalUsd: 140, realisedUsd: -2, strategies: 3, live: 1 }, kraken: { valueUsd: 99, capitalUsd: 99 } },
      venues: [{ id: 'revx', canTrade: true, balances: { USD: 100 }, feeBps: { maker: 0, taker: 9 } }, { id: 'binance', canTrade: true, balances: { USD: 0, USDT: 75 }, feeBps: { maker: 10, taker: 10 } }],
    };
    const rows = venueRows(dash);
    expect(rows.map((r) => r.label)).toEqual(['Revolut X', 'Binance']);   // Kraken is the signal venue: never a card, even with a book
    expect(rows[0]).toMatchObject({ valueUsd: 30, balanceUsd: 100, share: 0.75, shareOf: 'value', live: 0 });
    // The card's percentages sit on the scoreboard's bases: unrealised on cost, realised and today on the venue's capital.
    const based = venueRows({ byVenue: { revx: { valueUsd: 30, costUsd: 20, capitalUsd: 140, unrealisedUsd: 1, realisedUsd: 7, todayUsd: -1.4 } }, venues: [] })[0];
    expect(based.unrealisedPct).toBeCloseTo(5, 6);
    expect(based.realisedPct).toBeCloseTo(5, 6);
    expect(based.todayPct).toBeCloseTo(-1, 6);
    expect(venueRows({ byVenue: {}, venues: [] })[0].unrealisedPct).toBeNull();
    expect(rows[1]).toMatchObject({ valueUsd: 10, balanceUsd: 0, share: 0.25, live: 1 });
    const idle = venueRows({ byVenue: { revx: { valueUsd: 0, capitalUsd: 60 }, binance: { valueUsd: 0, capitalUsd: 140 } }, venues: [] });
    expect(idle.map((r) => [r.share, r.shareOf])).toEqual([[0.3, 'capital'], [0.7, 'capital']]);
    expect(venueRows(null).map((r) => r.share)).toEqual([0, 0]);
  });
  it('untilText counts down to the next bar close', () => {
    const now = Date.parse('2026-09-20T04:05:00Z');
    expect(untilText('2026-09-20T08:00:00Z', now)).toBe('in 3h 55m');
    expect(untilText('2026-09-20T04:20:00Z', now)).toBe('in 15m');
    expect(untilText('2026-09-22T06:00:00Z', now)).toBe('in 2d 1h');
    expect(untilText('2026-09-20T04:00:00Z', now)).toBe('due');
    expect(untilText(null, now)).toBe('—');
    expect(fmtBps(-0.61)).toBe('-0.61 bps');
    expect(fmtBps(null)).toBe('—');
  });
});

// ── What the rule sees, and the minute rule ─────────────────────────────

const obsAt = (ms, state = {}, numbers = {}) => ({
  ts: new Date(ms).toISOString(), barStart: new Date(Math.floor(ms / 60e3) * 60e3).toISOString(), state, numbers,
});

describe('observations as the liveness signal', () => {
  const trendState = { symbol: 'BTC/USD', trend_4h: 'up', trend_strength: 'strong', breakout: 'above_range', volatility: 'normal', momentum_30d: 'positive', position: 'flat', unrealised: 'none', time_in_position: 'none' };

  it('a reading in the last three minutes means running, whatever the decision clock says', () => {
    const s = strategy({
      lastDecision: { ts: '2026-09-19T20:00:00Z', symbol: 'BTC/USD', action: 'hold' },   // 16 h old: stale on its own
      positions: [{ symbol: 'BTC/USD', base: 0.00025, observation: obsAt(NOW - 40e3, trendState) }, { symbol: 'ETH/USD', base: 0 }],
    });
    expect(strategyStatus(s, null, NOW)).toEqual({ label: 'paper', running: true, tone: 'running', detail: 'watching · changed 40s ago' });
    expect(observationAgeMs(s, NOW)).toBe(40e3);
  });

  it('falls back to the decision clock once the readings stop', () => {
    const s = strategy({
      lastDecision: { ts: '2026-09-19T20:00:00Z', symbol: 'BTC/USD', action: 'hold' },
      positions: [{ symbol: 'BTC/USD', base: 0, observation: obsAt(NOW - 11 * 60e3, trendState) }],
    });
    expect(strategyStatus(s, null, NOW)).toMatchObject({ running: false, tone: 'stale', detail: 'last decision 16h 00m ago' });
    const never = strategy({ lastDecision: null, positions: [{ symbol: 'BTC/USD', base: 0, observation: obsAt(NOW - 11 * 60e3, trendState) }] });
    expect(strategyStatus(never, null, NOW)).toMatchObject({ running: false, tone: 'stale', detail: 'last reading 11m 00s ago' });
    expect(observationAgeMs({ positions: [{ symbol: 'BTC/USD', base: 0 }] }, NOW)).toBeNull();
  });

  it('the paused row and the global pause still win over a fresh reading', () => {
    const live = { positions: [{ symbol: 'BTC/USD', base: 0, observation: obsAt(NOW - 5e3, trendState) }] };
    expect(strategyStatus(strategy({ mode: 'paused', ...live }), null, NOW).running).toBe(false);
    expect(strategyStatus(strategy({ mode: 'live', ...live }), { global_pause: true }, NOW).running).toBe(false);
  });

  it('the minute rule goes stale after a quarter of an hour, not after two of its bars', () => {
    const fresh = strategy({ kind: 'dislocation-1m', lastDecision: { ts: new Date(NOW - 5 * 60e3).toISOString() } });
    expect(strategyStatus(fresh, null, NOW)).toMatchObject({ running: true, detail: 'decided 5m 00s ago' });
    const cold = strategy({ kind: 'dislocation-1m', lastDecision: { ts: new Date(NOW - 20 * 60e3).toISOString() } });
    expect(strategyStatus(cold, null, NOW).running).toBe(false);
  });

  it('labels the minute rule and reads its next decision as a rhythm, not a countdown', () => {
    expect(kindLabel('dislocation-1m')).toBe('Dislocation');
    expect(kindLabel('rotation-1d')).toBe('Rotation');
    expect(nextDecisionText('dislocation-1m', '2026-09-20T12:01:00Z', NOW)).toBe('every minute');
    expect(nextDecisionText('trend-4h', '2026-09-20T16:00:00Z', NOW)).toBe('4h 00m');
    expect(strategyRows({ strategies: [strategy({ kind: 'dislocation-1m', nextDecisionAt: '2026-09-20T12:01:00Z' })] }, NOW)[0])
      .toMatchObject({ kind: 'Dislocation', kindId: 'dislocation-1m', nextText: 'every minute' });
  });

  it('turns one observation into pills, an age and the numbers behind it', () => {
    const v = /** @type {any} */ (observationView(obsAt(NOW - 40e3,
      { symbol: 'BTC/USD', basis: 'revx_cheap', basis_size: 'small', reference_move_5m: 'sharp_up', position: 'flat', time_in_position: 'none' },
      { basisBps: -3.42, mark: 86000 }), NOW));
    expect(v.ageText).toBe('changed 40 s ago');
    expect(v.fresh).toBe(true);
    expect(v.basisBps).toBe(-3.42);
    expect(v.mark).toBe(86000);
    expect(v.pills.map((p) => `${p.label} ${p.value}`)).toEqual(['basis revx cheap', 'basis size small', 'reference 5m sharp up', 'position flat', 'held none']);
    expect(v.pills.map((p) => p.tone)).toEqual(['up', 'flat', 'warn', 'flat', 'flat']);
    // The symbol is the row's own label, never a pill.
    expect(v.pills.some((p) => p.key === 'symbol')).toBe(false);
    expect(observationView(null, NOW)).toBeNull();
  });

  it('the age reads in seconds while it is seconds old, then minutes, then hours', () => {
    expect(observationAgeText(0)).toBe('changed 0 s ago');
    expect(observationAgeText(89e3)).toBe('changed 89 s ago');
    expect(observationAgeText(4 * 60e3)).toBe('unchanged for 4 min');
    expect(observationAgeText(125 * 60e3)).toBe('unchanged for 2 h 05 min');
    expect(observationAgeText(null)).toBe('no reading yet');
  });

  it('one live-state row per symbol, in the strategy\'s own order, held or not', () => {
    const s = strategy({
      symbols: ['BTC/USD', 'ETH/USD', 'SOL/USD'],
      positions: [{ symbol: 'ETH/USD', base: 0.01, observation: obsAt(NOW - 20e3, { trend_4h: 'down' }) }, { symbol: 'BTC/USD', base: 0 }],
    });
    const rows = liveStateRows(s, NOW);
    expect(rows.map((r) => r.symbol)).toEqual(['BTC/USD', 'ETH/USD', 'SOL/USD']);
    expect(rows[0].observation).toBeNull();
    expect(rows[1]).toMatchObject({ base: 0.01 });
    expect(/** @type {any} */ (rows[1].observation).pills).toEqual([{ key: 'trend_4h', label: 'trend 4h', value: 'down', tone: 'down' }]);
    expect(rows[2]).toEqual({ symbol: 'SOL/USD', base: 0, observation: null });
  });

  it('opens the chart on what is held, else on what has traded, else on the first pair', () => {
    const symbols = ['BTC/USD', 'ETH/USD', 'SOL/USD'];
    expect(defaultChartSymbol({ symbols, positions: [{ symbol: 'BTC/USD', base: 0, fills: 2 }, { symbol: 'ETH/USD', base: 0.01, fills: 1 }] })).toBe('ETH/USD');
    expect(defaultChartSymbol({ symbols, positions: [{ symbol: 'BTC/USD', base: 0, fills: 0 }, { symbol: 'ETH/USD', base: 0, fills: 3 }] })).toBe('ETH/USD');
    expect(defaultChartSymbol({ symbols, positions: [] })).toBe('BTC/USD');
    expect(defaultChartSymbol({ symbols: [], positions: [] })).toBeNull();
  });
});

// ── The detail chart ────────────────────────────────────────────────────

const T0 = Date.parse('2026-09-20T08:00:00Z');
const H = 3600e3;
const CANDLES = [100, 110, 105, 120, 115].map((c, i) => [T0 + i * H, c, c + 5, c - 5, c]);
const CHART = {
  strategyId: 'trend-4h-kraken', symbol: 'BTC/USD', venue: 'kraken', signalVenue: 'kraken', kind: 'trend-4h', mode: 'paper',
  intervalMin: 60, since: new Date(T0).toISOString(), at: new Date(T0 + 5 * H).toISOString(),
  candles: CANDLES,
  fills: [
    { id: 1, ts: new Date(T0 + H).toISOString(), side: 'buy', price: 110, base: 0.25, feeUsd: 0.11, venue: 'kraken', mode: 'paper', marketable: false, decisionId: 7 },
    { id: 2, ts: new Date(T0 + 3 * H).toISOString(), side: 'sell', price: 120, base: 0.1, feeUsd: 0.05, venue: 'kraken', mode: 'paper', marketable: true, decisionId: 9 },
  ],
  orders: [
    { id: 1, ts: new Date(T0 + H).toISOString(), side: 'buy', price: 110, base: 0.25, state: 'filled', venue: 'kraken', mode: 'paper', requotes: 0, marketable: false, filledAt: new Date(T0 + H).toISOString(), cancelledAt: null, decisionId: 7 },
    { id: 3, ts: new Date(T0 + 2 * H).toISOString(), side: 'buy', price: 108, base: 0.2, state: 'new', venue: 'kraken', mode: 'paper', requotes: 1, marketable: false, filledAt: null, cancelledAt: null, decisionId: 8 },
  ],
  decisions: [{ id: 7, ts: new Date(T0 + H).toISOString(), barStart: new Date(T0 + H).toISOString(), action: 'enter', ruleAction: 'enter', reason: 'trend up', provider: 'openrouter', riskAllowed: true, kind: 'bar', mark: 110 }],
  position: { base: 0.15, avgCost: 110, realisedUsd: 1, feesUsd: 0.16, openedAt: new Date(T0 + H).toISOString() },
  observation: null,
};
const PAD = { padL: 50, padR: 10, padT: 10, padB: 20 };
const geo = () => chartGeometry({
  candles: CHART.candles, fills: CHART.fills, orders: CHART.orders, position: CHART.position,
  intervalMin: 60, width: 400, height: 200, nowMs: T0 + 5 * H, pad: PAD,
});

describe('chart geometry', () => {
  it('scales time across the plot and price down it, padded so nothing sits on the frame', () => {
    const g = geo();
    expect(g.hasData).toBe(true);
    expect([g.x0, g.x1, g.y0, g.y1]).toEqual([50, 390, 10, 180]);
    // The window runs from the first candle to one bar past the last.
    expect([g.t0, g.t1]).toEqual([T0, T0 + 5 * H]);
    expect(g.xOf(T0)).toBe(50);
    expect(g.xOf(T0 + 5 * H)).toBe(390);
    expect(g.xOf(T0 + 4 * H)).toBeCloseTo(322, 6);
    // Highs and lows set the range: 95 … 125, plus 8 % of air each side.
    expect(g.p0).toBeCloseTo(92.6, 6);
    expect(g.p1).toBeCloseTo(127.4, 6);
    expect(g.yOf(110)).toBeCloseTo(95, 6);          // the midpoint sits in the middle
    expect(g.yOf(1e9)).toBe(10);                     // clamped, never off the top
    expect(g.yOf(-1e9)).toBe(180);
    expect(g.linePath.startsWith('M50.0 ')).toBe(true);
    expect(g.linePath.split('L').length).toBe(5);    // one segment per candle
    expect(g.bandPath.endsWith('Z')).toBe(true);
  });

  it('marks every fill, rests the open order at its price and dots the average cost', () => {
    const g = geo();
    expect(g.fillMarks.map((f) => f.side)).toEqual(['buy', 'sell']);
    expect(g.fillMarks[0].x).toBeCloseTo(118, 6);
    expect(g.fillMarks[0].y).toBeCloseTo(95, 6);     // bought at 110, the middle
    expect(g.restingLines).toHaveLength(1);          // the filled order is not resting
    expect(g.restingLines[0]).toMatchObject({ id: 3, side: 'buy', price: 108 });
    expect(g.restingLines[0].xa).toBeCloseTo(186, 6);
    expect(g.restingLines[0].xb).toBe(390);          // …to the right edge, which is now
    expect(g.avgCost.price).toBe(110);
    expect(g.avgCost.y).toBeCloseTo(95, 6);
    expect(chartGeometry({ candles: CHART.candles, position: { base: 0, avgCost: 0 }, width: 400, height: 200, pad: PAD }).avgCost).toBeNull();
    expect(isResting({ state: 'new' })).toBe(true);
    expect([isResting({ state: 'filled' }), isResting({ state: 'cancelled' }), isResting(null)]).toEqual([false, false, false]);
  });

  it('puts three to five recessive gridlines on one axis and dates under it', () => {
    const g = geo();
    expect(g.yTicks.map((t) => t.v)).toEqual([100, 110, 120]);
    expect(g.yTicks.map((t) => t.label)).toEqual(['100.0', '110.0', '120.0']);   // one decimal is all a 30-wide range needs
    expect(g.yTicks[1].y).toBeCloseTo(95, 6);
    // UK local: the fixture's bars start at 08:00 UTC, which is 09:00 BST.
    expect(g.xTicks.map((t) => t.label)).toEqual(['20 Sep 09:00', '20 Sep 11:00', '20 Sep 13:00']);
    // A wider plot earns more ticks, never more than five.
    const wide = chartGeometry({ candles: CHART.candles, intervalMin: 60, width: 1200, height: 230, nowMs: T0 + 5 * H });
    expect(wide.xTicks.length).toBeLessThanOrEqual(5);
    expect(wide.xTicks.length).toBeGreaterThanOrEqual(3);
  });

  it('is empty, not broken, when the candle cache has nothing in it yet', () => {
    for (const candles of [[], [[T0, 1, 1, 1, 1]], null]) {
      const g = chartGeometry({ candles: candles ?? undefined, width: 400, height: 200, pad: PAD });
      expect(g.hasData).toBe(false);
      expect(g.linePath).toBe('');
      expect(g.fillMarks).toEqual([]);
      expect(g.yTicks).toEqual([]);
      expect(hoverPoint(g, 100)).toBeNull();
    }
    expect(chartGeometry()).toMatchObject({ hasData: false });
  });

  it('the crosshair snaps to the nearest candle and picks up a fill under the cursor', () => {
    const g = geo();
    /** @param {number} px */
    const at = (px) => /** @type {any} */ (hoverPoint(g, px));
    const at190 = at(190);
    expect(at190).toMatchObject({ i: 2, close: 105, fills: [] });
    expect(at190.x).toBeCloseTo(186, 6);
    const onFill = at(120);
    expect(onFill.i).toBe(1);
    expect(onFill.fills.map((/** @type {any} */ f) => f.id)).toEqual([1]);
    // Off either end it clamps to the first and last candle rather than vanishing.
    expect(at(-500).i).toBe(0);
    expect(at(5000).i).toBe(4);
  });

  it('keeps the tooltip inside the plot, flipping it left at the right-hand edge', () => {
    const g = geo();
    const lines = ['20 Sep 11:00 UTC', 'close  115.00'];
    const left = tooltipBox(g, 100, 95, lines);
    expect(left.x).toBe(110);
    expect(left.y + left.h).toBeLessThanOrEqual(g.y1);
    const flipped = tooltipBox(g, 380, 95, lines);
    expect(flipped.x).toBeLessThan(380);
    expect(flipped.x + flipped.w).toBeLessThanOrEqual(380);
    // Never off the top or the bottom either.
    expect(tooltipBox(g, 100, 12, lines).y).toBeGreaterThanOrEqual(g.y0);
    expect(tooltipBox(g, 100, 179, lines).y + tooltipBox(g, 100, 179, lines).h).toBeLessThanOrEqual(g.y1);
  });

  it('buys point up, sells point down, both centred on the fill', () => {
    expect(markPath('buy', 10, 10, 5)).toBe('M4.3 15.0L10.0 5.0L15.8 15.0Z');
    expect(markPath('sell', 10, 10, 5)).toBe('M4.3 5.0L10.0 15.0L15.8 5.0Z');
  });

  it('axis and tooltip formatting follows the bar, and the window reads in words', () => {
    expect(niceStep(30, 4)).toBe(10);
    expect(niceStep(100, 4)).toBe(20);
    expect(niceStep(0, 4)).toBe(1);
    expect(priceTicks(95, 125, 4)).toEqual([100, 110, 120]);
    expect(priceTicks(5, 5)).toEqual([5]);
    expect(priceTicks(NaN, 1)).toEqual([]);
    expect(fmtChartPrice(86000.4, 400)).toBe('86,000');
    expect(fmtChartPrice(110.25, 12)).toBe('110.25');
    expect(fmtChartPrice(0.5123, 0.05)).toBe('0.5123');
    expect(fmtChartPrice(null, 1)).toBe('—');
    // UK LOCAL time, the clock the site's own header shows: 08:05 UTC in September is 09:05 BST.
    expect(fmtChartTime(Date.parse('2026-09-20T08:05:00Z'), 1)).toBe('09:05');
    expect(fmtChartTime(Date.parse('2026-09-20T08:05:00Z'), 60)).toBe('20 Sep 09:05');
    expect(fmtChartTime(Date.parse('2026-09-20T08:05:00Z'), 240)).toBe('20 Sep');
    expect(fmtChartStamp('2026-09-20T08:05:00Z')).toBe('20 Sep 09:05');
    // …and GMT in the winter, from the same code and no DST table of our own.
    expect(fmtChartStamp('2026-01-20T08:05:00Z')).toBe('20 Jan 08:05');
    // A bar that starts at 23:30 UTC in BST is already tomorrow in London.
    expect(fmtChartStamp('2026-09-20T23:30:00Z')).toBe('21 Sep 00:30');
    expect(fmtChartStamp('nonsense')).toBe('—');
    expect(windowText(1, 12 * H)).toBe('1-minute candles · last 12 h');
    expect(windowText(60, 7 * 24 * H)).toBe('1-hour candles · last 7 d');
    expect(windowText(240, 30 * 24 * H)).toBe('4-hour candles · last 30 d');
  });
});

describe('lastChangeText', () => {
  it('one phrasing down the column: seconds under a minute, minutes under an hour, then hours', () => {
    expect(lastChangeText(0)).toBe('Last change: 0 secs ago');
    expect(lastChangeText(40_000)).toBe('Last change: 40 secs ago');
    expect(lastChangeText(60_000)).toBe('Last change: 1 min ago');
    expect(lastChangeText(9 * 60_000)).toBe('Last change: 9 mins ago');
    expect(lastChangeText(125 * 60_000)).toBe('Last change: 2h 05m ago');
    expect(lastChangeText(null)).toBe('No reading yet');
  });
});

describe('symbolOrderRows / fetchAgentsChart', () => {
  it('every order on the pair, newest first, priced by its fill where there is one', () => {
    const rows = symbolOrderRows(CHART, null, 'BTC/USD');
    expect(rows.map((r) => r.id)).toEqual([3, 1]);                      // newest first: the resting bid, then the fill
    expect(rows[0]).toMatchObject({ side: 'buy', state: 'new', price: 108, base: 0.2, costUsd: 21.6, fillPrice: null, feeUsd: 0, liquidity: 'maker' });
    expect(rows[1]).toMatchObject({ side: 'buy', state: 'filled', fillPrice: 110, costUsd: 27.5, feeUsd: 0.11 });
    expect(symbolOrderRows(null, null, null)).toEqual([]);
  });
  it('the full history widens the same table and never duplicates a row', () => {
    const more = { orders: [
      { id: 1, ts: CHART.orders[0].ts, symbol: 'BTC/USD', side: 'buy', mode: 'paper', state: 'filled', price: 110, base_size: 0.25, filled_base: 0.25, avg_fill_price: 110, fee_usd: 0.11 },
      { id: 42, ts: '2026-09-01T00:00:00Z', symbol: 'BTC/USD', side: 'sell', mode: 'paper', state: 'filled', price: 99, base_size: 0.1, filled_base: 0.1, avg_fill_price: 99, fee_usd: 0.04, request: { marketable: true } },
      { id: 43, ts: '2026-09-01T00:00:00Z', symbol: 'ETH/USD', side: 'buy', mode: 'paper', state: 'filled', price: 2, base_size: 1, filled_base: 1, avg_fill_price: 2, fee_usd: 0 },
    ] };
    const rows = symbolOrderRows(CHART, more, 'BTC/USD');
    expect(rows.map((r) => r.id)).toEqual([3, 1, 42]);                  // the other pair's row is not this table's
    expect(rows[2]).toMatchObject({ side: 'sell', costUsd: 9.9, feeUsd: 0.04, liquidity: 'taker' });
  });
  it('asks the Edge Function for one strategy × symbol, with the app token', async () => {
    sessionStorage.setItem('dp.token', 'tok.sig');
    const fetchImpl = vi.fn(async (url, init) => {
      expect(String(url)).toMatch(/\/agents\?action=chart&strategy=trend-4h-kraken&symbol=BTC%2FUSD$/);
      expect(init.headers['X-App-Token']).toBe('tok.sig');
      return new Response(JSON.stringify(CHART), { status: 200 });
    });
    expect((await fetchAgentsChart('trend-4h-kraken', 'BTC/USD', fetchImpl)).symbol).toBe('BTC/USD');
    const bad = vi.fn(async () => new Response('{"error":"unknown strategy"}', { status: 500 }));
    await expect(fetchAgentsChart('nope', 'BTC/USD', bad)).rejects.toThrow(/500 .*unknown strategy/);
  });
  it('the two venue hues are the ones the badges wear, and Kraken, off the page, has none', () => {
    expect([venueHue('revx'), venueHue('binance')]).toEqual(['#8ec5ff', '#f0b90b']);
    expect(venueHue('kraken')).toBe('rgba(244,239,227,0.6)');
    expect(venueHue('other')).toBe('rgba(244,239,227,0.6)');
  });
});

describe('agentsErrorView / parseAgentsErrorBody / shortErrorMessage', () => {
  it('reads the server envelope and names the failure in words, with the raw text kept for the details fold', () => {
    const raw = 'agents dashboard: 500 {"error":"agents crashed","message":"db GET agent_strategies → 500: code 57014"}';
    const v = agentsErrorView(new Error(raw));
    expect(v.status).toBe(500);
    expect(v.kind).toBe('server');
    expect(v.title.length).toBeGreaterThan(0);
    expect(v.sentence.length).toBeGreaterThan(0);
    expect(v.short).not.toMatch(/[{]/);            // the sentence never shows the JSON
    expect(v.detail).toContain('57014');            // the details fold keeps everything
    expect(agentsErrorView(new Error('agents dashboard: 401 {"error":"unauthorised"}')).kind).toBe('auth');
    expect(agentsErrorView(new Error('Failed to fetch')).kind).toBe('offline');
    expect(agentsErrorView(null).message.length).toBeGreaterThan(0);
  });
  it('parses message or error out of a JSON body and leaves plain text alone', () => {
    expect(parseAgentsErrorBody('{"error":"x","message":"the message"}')).toBe('the message');
    expect(parseAgentsErrorBody('{"error":{"message":"nested"}}')).toBe('nested');
    expect(parseAgentsErrorBody('plain')).toBe('plain');
    expect(parseAgentsErrorBody('')).toBe('');
    expect(shortErrorMessage('db GET agent_strategies → 500: {"code":"57014"}')).toBe('db GET agent_strategies → 500');
    expect(shortErrorMessage('x'.repeat(200)).length).toBe(120);
  });
});

describe('agentsAlerts', () => {
  const venues = [{ id: 'revx', canTrade: true, note: null }, { id: 'binance', canTrade: true, note: null }];
  it('is silent when nothing blocks trading', () => {
    expect(agentsAlerts({ risk: { global_pause: false }, venues, strategies: [] })).toEqual([]);
  });
  it('raises the global pause and a venue fault as banners with a tone and a label', () => {
    const out = agentsAlerts({ risk: { global_pause: true }, venues: [venues[0], { id: 'binance', canTrade: false, note: 'account 451: restricted location' }], strategies: [] });
    expect(out.map((a) => [a.id, a.tone, a.label])).toEqual([['global-pause', 'stop', 'Global pause'], ['venue-binance', 'fault', 'Binance fault']]);
    expect(out[1].text).toContain('451');
  });
  it('flags a venue without a key only when a LIVE strategy trades there — paper needs no key', () => {
    const noKey = [{ id: 'revx', canTrade: false, note: null }];
    expect(agentsAlerts({ risk: { live_confirmed_at: 'x' }, venues: noKey, strategies: [{ venue: 'revx', mode: 'paper' }] })).toEqual([]);
    expect(agentsAlerts({ risk: { live_confirmed_at: 'x' }, venues: noKey, strategies: [{ venue: 'revx', mode: 'live' }] }).map((a) => a.id)).toEqual(['nokey-revx']);
  });
  it('flags live rows while live_confirmed_at is unset — entries are refused in that state, and the exits still run', () => {
    const dash = { risk: { live_confirmed_at: null }, venues, strategies: [{ id: 'trend-4h', venue: 'revx', mode: 'live', positions: [] }] };
    const out = agentsAlerts(dash);
    expect(out.map((a) => a.id)).toEqual(['live-unconfirmed']);
    // Since 2026-09-22 clearing the confirmation stops the BUYING only. The banner said every live order was refused,
    // which would have told the owner a position had no way out while its floor was running.
    expect(out[0].text).toContain('ENTRY');
    expect(out[0].text).toContain('exits');
    expect(out[0].text).not.toContain('every live order');
    expect(agentsAlerts({ ...dash, risk: { live_confirmed_at: '2026-09-21T00:00:00Z' } })).toEqual([]);
    expect(agentsAlerts({ ...dash, strategies: [{ ...dash.strategies[0], mode: 'paper' }] })).toEqual([]);   // paper needs no confirmation
  });
  it('counts a row relabelled away from REAL coins as live, and says it is winding down — the payload vouches for it with holdsLive and windingDown', () => {
    // A live row set to `paper` while it still holds coins at the venue: the tick keeps selling them as live and refuses
    // entries. Counted by its label alone, the page raised nothing about real money it could not see was there.
    const s = { id: 'trend-4h-live', name: 'Trend 4h · live', venue: 'revx', mode: 'paper', holdsLive: true, windingDown: true, positions: [{ symbol: 'BTC/USD', base: 0.0002 }] };
    const out = agentsAlerts({ risk: { live_confirmed_at: null }, venues, strategies: [s] });
    expect(out.map((a) => a.id)).toEqual(['live-unconfirmed', 'winding-down-trend-4h-live']);
    expect(out[1].tone).toBe('paused');
    expect(out[1].text).toContain('Set to paper while holding BTC/USD');
  });
  it('a PAUSED (not retired) row the tick is winding down reads as winding down, not as the fault', () => {
    const s = { id: 'trend-4h', name: 'Trend 4h · Revolut X', venue: 'revx', mode: 'paused', windingDown: true, positions: [{ symbol: 'BTC/USD', base: 0.00025 }] };
    const out = agentsAlerts({ risk: {}, venues, strategies: [s] });
    expect(out.map((a) => [a.id, a.tone])).toEqual([['winding-down-trend-4h', 'paused']]);
    expect(out[0].text).toContain('Paused while holding BTC/USD');
  });
  it('a retired row holding a position reads as winding down, not as a fault — the loop still runs its exits', () => {
    // Since 2026-09-22 the tick keeps a retired row's floor and rule exit running and refuses every
    // entry, and the payload says so with `windingDown`. The old text claimed nothing protected it,
    // which was true until that day and is now the opposite of what happens.
    const s = { id: 'rotation-1d', name: 'Rotation · Revolut X', venue: 'revx', mode: 'paused', windingDown: true, positions: [{ symbol: 'BTC/USD', base: 0.00025 }, { symbol: 'ETH/USD', base: 0 }] };
    const out = agentsAlerts({ risk: {}, venues, strategies: [s] });
    expect(out.map((a) => a.id)).toEqual(['winding-down-rotation-1d']);
    expect(out[0].tone).toBe('paused');                       // a controlled state, not a fault
    expect(out[0].text).toContain('BTC/USD');
    expect(out[0].text).not.toContain('ETH/USD');
    expect(out[0].text).toContain('can never buy again');
    // Flat: nothing to say, and the row leaves the page anyway.
    expect(agentsAlerts({ risk: {}, venues, strategies: [{ ...s, positions: [{ symbol: 'BTC/USD', base: 0 }] }] })).toEqual([]);
  });
  it('a paused row holding a position with NO windingDown flag is still a fault — never assume the protection', () => {
    // An older payload, or a paused row the tick is not covering. The flag is the evidence that the
    // exits are running; without it the alert must not claim they are.
    const s = { id: 'trend-4h', name: 'Trend 4h · Revolut X', venue: 'revx', mode: 'paused', positions: [{ symbol: 'BTC/USD', base: 0.00025 }] };
    const out = agentsAlerts({ risk: {}, venues, strategies: [s] });
    expect(out.map((a) => a.id)).toEqual(['paused-long-trend-4h']);
    expect(out[0].tone).toBe('fault');
    expect(out[0].text).toContain('Check that the tick is covering it');
  });
  it('flags a live order left pending past two minutes: its outcome is unknown and a person settles it', () => {
    const now = Date.parse('2026-09-21T12:10:00Z');
    const order = (ago, state = 'pending', mode = 'live') => ({ id: 1, ts: new Date(now - ago).toISOString(), state, mode });
    const s = (recentOrders) => ({ id: 'trend-4h', name: 'Trend 4h', venue: 'revx', mode: 'live', positions: [], recentOrders });
    const risk = { live_confirmed_at: '2026-09-21T00:00:00Z' };
    const out = agentsAlerts({ risk, venues, strategies: [s([order(3 * 60e3)])] }, now);
    expect(out.map((a) => a.id)).toEqual(['pending-trend-4h']);
    expect(out[0].text).toContain('will not guess');
    expect(agentsAlerts({ risk, venues, strategies: [s([order(60e3)])] }, now)).toEqual([]);                      // this turn's own row
    expect(agentsAlerts({ risk, venues, strategies: [s([order(3 * 60e3, 'new')])] }, now)).toEqual([]);           // a resting order is normal
    expect(agentsAlerts({ risk, venues, strategies: [s([order(3 * 60e3, 'pending', 'paper')])] }, now)).toEqual([]);
  });
});

describe('newestWins / fetchAgentsDashboard ordering', () => {
  it('only the newest request may be applied: an older answer arriving late is dropped', () => {
    const g = newestWins();
    const a = g.start(), b = g.start();
    expect([g.isLatest(a), g.isLatest(b)]).toEqual([false, true]);
  });
  it("the dashboard cache keeps the newest request's answer whatever order the answers arrive in", async () => {
    /** @type {(v?: unknown) => void} */
    let releaseSlow = () => {};
    const slow = new Promise((r) => { releaseSlow = r; });
    const slowFetch = /** @type {any} */ (async () => { await slow; return new Response(JSON.stringify({ at: 'older' }), { status: 200 }); });
    const fastFetch = /** @type {any} */ (async () => new Response(JSON.stringify({ at: 'newer' }), { status: 200 }));
    const p1 = fetchAgentsDashboard(slowFetch);
    const p2 = fetchAgentsDashboard(fastFetch);
    await p2;
    expect(readAgentsCache()?.dash?.at).toBe('newer');
    releaseSlow();
    await p1;
    expect(readAgentsCache()?.dash?.at).toBe('newer');
  });
});

describe('sizeText', () => {
  it('six decimals, and masked with the money when values are hidden — a size beside a mark is the value', () => {
    expect(sizeText(0.00025)).toBe('0.000250');
    expect(sizeText(2.25, (s) => s.replace(/\d/g, '•'))).toBe('•.••••••');
  });
});

describe('positionLines', () => {
  it('lists only the held symbols, with the return on cost', () => {
    const s = { positions: [
      { symbol: 'BTC/USD', base: 0.00025, avgCost: 80000, mark: 86000, valueUsd: 21.5, unrealisedUsd: 1.5, costUsd: 20 },
      { symbol: 'ETH/USD', base: 0, avgCost: 0, mark: 2500, valueUsd: 0, unrealisedUsd: 0, costUsd: 0 },
    ] };
    const lines = positionLines(s);
    expect(lines.map((l) => l.symbol)).toEqual(['BTC/USD']);
    expect(lines[0].returnPct).toBeCloseTo(7.5, 6);
    expect(positionLines({})).toEqual([]);
  });
});

describe('shareSegments', () => {
  it('labels a segment with the venue and its share, a sliver with nothing, and keeps what the share is of in the title', () => {
    const rows = /** @type {any} */ ([{ id: 'binance', label: 'Binance', share: 0.8, shareOf: 'value' }, { id: 'revx', label: 'Revolut X', share: 0.2, shareOf: 'value' }]);
    const seg = shareSegments(rows);
    expect(seg[0].text).toBe('Binance 80%');
    expect(seg[0].title).toBe('Binance: 80% of deployed value');
    expect(seg[1].text).toBe('Revolut X 20%');
    expect(seg[0].widthPct).toBe(80);
    expect(shareSegments(/** @type {any} */ ([{ id: 'x', label: 'X', share: 0.05, shareOf: 'value' }]))[0].text).toBe('');
  });
});

describe('plotLabelY', () => {
  it('leaves a label alone unless it sits on a tick, then nudges it away, inside the plot', () => {
    const ticks = [{ y: 100 }, { y: 200 }];
    expect(plotLabelY(150, ticks)).toBe(150);
    expect(plotLabelY(103, ticks)).toBe(110);                      // down by the nudge
    expect(plotLabelY(197, ticks)).toBe(190);                      // down would still clash with the tick: up instead
    expect(plotLabelY(103, ticks, { y0: 100, y1: 105 })).toBe(105); // no room either way: clamped to the plot
  });
});

describe('paperOnly', () => {
  // Davies, 2026-09-23: every row trades paper, so a venue card labels its funded figure "(Paper)" and the page no
  // longer shows the accounts' real balances. The label must not outlive the day a row goes live.
  const rows = [
    { venue: 'revx', mode: 'paper' }, { venue: 'revx', mode: 'paper' }, { venue: 'binance', mode: 'paper' },
  ];
  it('is true while every row is paper, on the page and on each venue', () => {
    expect(paperOnly(rows)).toBe(true);
    expect(paperOnly(rows, 'revx')).toBe(true);
    expect(paperOnly(rows, 'binance')).toBe(true);
    expect(paperOnly([])).toBe(true);
    expect(paperOnly(null)).toBe(true);
  });
  it('turns false for the venue, and the page, the moment one row is live', () => {
    const withLive = [...rows, { venue: 'revx', mode: 'live' }];
    expect(paperOnly(withLive)).toBe(false);
    expect(paperOnly(withLive, 'revx')).toBe(false);
    expect(paperOnly(withLive, 'binance')).toBe(true);
  });
  it('treats a paused row still holding live coins as live money, not paper', () => {
    const paused = [{ venue: 'revx', mode: 'paused', holdsLive: true }];
    expect(paperOnly(paused)).toBe(false);
    expect(paperOnly([{ venue: 'revx', mode: 'paused', holdsLive: false }])).toBe(true);
  });
});

describe('countdownText', () => {
  const now = Date.parse('2026-09-20T18:00:00Z');
  it('counts down to the second and says due once the moment has passed', () => {
    expect(countdownText('2026-09-20T19:12:05Z', now)).toBe('1h 12m 05s');
    expect(countdownText('2026-09-20T18:12:05Z', now)).toBe('12m 05s');
    expect(countdownText('2026-09-20T18:00:05Z', now)).toBe('5s');
    expect(countdownText('2026-09-20T17:59:00Z', now)).toBe('due');
    expect(countdownText(null, now)).toBe('—');
  });
});

describe('prefetchAgentsDashboard', () => {
  it('fills the dashboard cache and schedules one chart per strategy, spaced out; a failure leaves the cache alone', async () => {
    const calls = [];
    const fetchImpl = /** @type {any} */ (async (url) => {
      calls.push(String(url));
      if (String(url).includes('action=dashboard')) return new Response(JSON.stringify({ at: 'x', strategies: [{ id: 's1', symbols: ['BTC/USD'], positions: [] }, { id: 's2', symbols: ['ETH/USD'], positions: [] }] }), { status: 200 });
      return new Response(JSON.stringify({ candles: [], fills: [] }), { status: 200 });
    });
    const scheduled = [];
    const later = (fn, ms) => { scheduled.push(ms); fn(); };
    const dash = await prefetchAgentsDashboard(fetchImpl, later);
    expect(dash.strategies.length).toBe(2);
    expect(readAgentsCache()?.dash).toBe(dash);
    expect(scheduled).toEqual([200, 400]);
    await new Promise((r) => setTimeout(r, 0));
    expect(readChartCache('s1', 'BTC/USD')?.chart).toBeTruthy();
    const failing = /** @type {any} */ (async () => new Response('{"error":"unauthorised"}', { status: 401 }));
    expect(await prefetchAgentsDashboard(failing, later)).toBeNull();
    expect(readAgentsCache()?.dash).toBe(dash);
  });
});

describe('glText / scoreboardView / strategyScoreboard', () => {
  it('writes a gain the way the home scoreboard does, and drops the percent without a base', () => {
    expect(glText(1521.4, 0.86)).toBe('+$1,521 (+0.86%)');
    expect(glText(-0.09, -0.47)).toBe('-$0.09 (-0.47%)');
    expect(glText(0, null)).toBe('$0.00');
  });
  it('puts today, unrealised and realised on their stated bases, and carries no total', () => {
    const dash = { dayStart: '2026-09-21T00:00:00.000Z', totals: { costUsd: 40, valueUsd: 41, unrealisedUsd: 1, realisedUsd: 3, feesUsd: 0.1, todayUsd: 2, byMode: { live: { realisedUsd: 0 }, paper: { realisedUsd: 3 } } },
      strategies: [{ capitalUsd: 60 }, { capitalUsd: 40 }] };
    const v = scoreboardView(dash);
    expect(v.capitalUsd).toBe(100);
    expect(v.todayPct).toBeCloseTo(2, 6);           // 2 on 100 of capital
    expect('totalUsd' in v).toBe(false);            // the owner took the total off every scoreboard
    expect(v.unrealisedPct).toBeCloseTo(2.5, 6);    // 1 on 40 of cost
    expect(v.realisedPct).toBeCloseTo(3, 6);
    expect(v.deployedPct).toBeCloseTo(41, 6);
    expect(v.dayStart).toBe('2026-09-21T00:00:00.000Z');
    const one = strategyScoreboard({ capitalUsd: 40, costUsd: 20, valueUsd: 21.5, unrealisedUsd: 1.5, realisedUsd: 0.5, todayUsd: -0.2 });
    expect(one.unrealisedPct).toBeCloseTo(7.5, 6);
    expect(one.todayPct).toBeCloseTo(-0.5, 6);
    expect(scoreboardView(null).realisedPct).toBeNull();
    expect('totalPct' in strategyScoreboard(one)).toBe(false);
  });
});

describe('strategyRows G/L columns and the next column', () => {
  it('carries unrealised on cost, realised on capital, today, and a countdown without "in"', () => {
    const dash = { strategies: [{ id: 'x', kind: 'trend-4h', venue: 'revx', name: 'X', symbols: ['BTC/USD'], mode: 'paper', capitalUsd: 40, costUsd: 20, unrealisedUsd: 1.5, realisedUsd: 0.5, todayUsd: 0.25, positions: [], nextDecisionAt: new Date(Date.parse('2026-09-21T00:00:00Z') + 2 * 3600e3 + 13 * 60e3).toISOString(), lastDecision: null }] };
    const r = strategyRows(dash, Date.parse('2026-09-21T00:00:00Z'))[0];
    expect(r.unrealisedPct).toBeCloseTo(7.5, 6);
    expect(r.realisedPct).toBeCloseTo(1.25, 6);
    expect(r.todayUsd).toBe(0.25);
    expect(r.nextText).toBe('2h 13m');
  });
});
