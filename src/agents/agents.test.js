import { describe, it, expect, vi } from 'vitest';
import {
  defaultChartSymbol, fetchAgentsChart, fetchAgentsDashboard, fmtBps, fmtFees, lastChangeText, symbolOrderRows,
  fmtFrac, fmtUsd, kindLabel, liveStateRows, nextDecisionText, observationAgeMs, observationAgeText, observationView, orderView,
  strategyRows, strategyStatus, totalsView, untilText, venueHue, venueRows,
  agentsAlerts, agentsErrorView, parseAgentsErrorBody, shortErrorMessage, positionLines, shareSegments, paperOnly, quotesView, quotesRow, quoteLadderRows, quoteBookLabel, fmtQuotePrice, QUOTES_ROW_ID, countdownText, prefetchAgentsDashboard, readAgentsCache, readChartCache, glText, scoreboardView, strategyScoreboard,
  newestWins, sizeText, dashboardInFlight, _reloadAgentsCache, RW_ROW_ID, rwBarTileKeys, rwInventoryCost, rwRow, rwView, fmtCents, rwHeldText, venueLabel,
  AGENT_TABS, agentsTabsView, alertsFor, defaultAgentsTab, liveArming, pctOf, splitCents, splitStrategyRows, strategyTab, tabStrategies } from './agents.js';
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
  const row = (venue, over = {}) => ({ venue, mode: 'paper', capitalUsd: 0, costUsd: 0, valueUsd: 0, unrealisedUsd: 0, realisedUsd: 0, feesUsd: 0, todayUsd: 0, ...over });
  it('sums the rows by venue and takes the share of deployed value, or of capital while nothing is deployed', () => {
    const dash = {
      strategies: [row('revx', { valueUsd: 30, capitalUsd: 100, realisedUsd: 1 }), row('revx', { capitalUsd: 40 }), row('binance', { valueUsd: 10, capitalUsd: 140, realisedUsd: -2, mode: 'live' }),
        row('kraken', { valueUsd: 99, capitalUsd: 99 })],
      venues: [{ id: 'revx', canTrade: true, balances: { USD: 100 }, feeBps: { maker: 0, taker: 9 } }, { id: 'binance', canTrade: true, balances: { USD: 0, USDT: 75 }, feeBps: { maker: 10, taker: 10 } }],
    };
    const rows = venueRows(dash);
    expect(rows.map((r) => r.label)).toEqual(['Revolut X', 'Binance']);   // Kraken is the signal venue: never a card, even with a book
    expect(rows[0]).toMatchObject({ valueUsd: 30, capitalUsd: 140, realisedUsd: 1, balanceUsd: 100, share: 0.75, shareOf: 'value', strategies: 2, live: 0 });
    // The card's percentages sit on the scoreboard's bases: unrealised on cost, realised and today on the venue's capital.
    const based = venueRows({ strategies: [row('revx', { valueUsd: 30, costUsd: 20, capitalUsd: 140, unrealisedUsd: 1, realisedUsd: 7, todayUsd: -1.4 })], venues: [] })[0];
    expect(based.unrealisedPct).toBeCloseTo(5, 6);
    expect(based.realisedPct).toBeCloseTo(5, 6);
    expect(based.todayPct).toBeCloseTo(-1, 6);
    expect(venueRows({ strategies: [row('revx', { capitalUsd: 40 })], venues: [] })[0].unrealisedPct).toBeNull();
    expect(rows[1]).toMatchObject({ valueUsd: 10, balanceUsd: 0, share: 0.25, strategies: 1, live: 1 });
    const idle = venueRows({ strategies: [row('revx', { capitalUsd: 60 }), row('binance', { capitalUsd: 140 })], venues: [] });
    expect(idle.map((r) => [r.share, r.shareOf])).toEqual([[0.3, 'capital'], [0.7, 'capital']]);
    // A venue with no row gets no card: there is nothing on it to show.
    expect(venueRows(null)).toEqual([]);
    expect(venueRows({ strategies: [row('binance', { capitalUsd: 40 })] }).map((r) => r.id)).toEqual(['binance']);
  });
  it('on a tab, sums only that tab\'s rows: LIVE\'s Revolut X card is the live row, TESTING\'s the paper ones', () => {
    const dash = { strategies: [row('revx', { capitalUsd: 100, valueUsd: 21.5, realisedUsd: 12.34 }), row('binance', { capitalUsd: 100 }), row('revx', { mode: 'live', holdsLive: true, capitalUsd: 50, valueUsd: 12.5, realisedUsd: 0.3 })], venues: [] };
    expect(venueRows(dash, 'live').map((r) => [r.id, r.capitalUsd, r.valueUsd, r.realisedUsd, r.strategies, r.live])).toEqual([['revx', 50, 12.5, 0.3, 1, 1]]);
    expect(venueRows(dash, 'testing').map((r) => [r.id, r.capitalUsd, r.valueUsd, r.realisedUsd, r.strategies, r.live])).toEqual([['revx', 100, 21.5, 12.34, 1, 0], ['binance', 100, 0, 0, 1, 0]]);
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
  it('does not banner a live row whose confirmation is unset — the tab already says it, and the box was removed', () => {
    const dash = { risk: { live_confirmed_at: null }, venues, strategies: [{ id: 'trend-4h', venue: 'revx', mode: 'live', positions: [] }] };
    expect(agentsAlerts(dash).map((a) => a.id)).toEqual([]);
    expect(agentsAlerts({ ...dash, risk: { live_confirmed_at: '2026-09-21T00:00:00Z' } })).toEqual([]);
    expect(agentsAlerts({ ...dash, strategies: [{ ...dash.strategies[0], mode: 'paper' }] })).toEqual([]);
  });
  it('counts a row relabelled away from REAL coins as live, and says it is winding down — the payload vouches for it with holdsLive and windingDown', () => {
    // A live row set to `paper` while it still holds coins at the venue: the tick keeps selling them as live and refuses
    // entries. Counted by its label alone, the page raised nothing about real money it could not see was there.
    const s = { id: 'trend-4h-live', name: 'Trend 4h · live', venue: 'revx', mode: 'paper', holdsLive: true, windingDown: true, positions: [{ symbol: 'BTC/USD', base: 0.0002 }] };
    const out = agentsAlerts({ risk: { live_confirmed_at: null }, venues, strategies: [s] });
    expect(out.map((a) => a.id)).toEqual(['winding-down-trend-4h-live']);
    expect(out[0].tone).toBe('paused');
    expect(out[0].text).toContain('Set to paper while holding BTC/USD');
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
    const dash = { dayStart: '2026-09-21T00:00:00.000Z',
      strategies: [{ capitalUsd: 60, costUsd: 40, valueUsd: 41, unrealisedUsd: 1, realisedUsd: 2.5, feesUsd: 0.1, todayUsd: 1.5 }, { capitalUsd: 40, realisedUsd: 0.5, todayUsd: 0.5 }] };
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

describe('the two tabs: LIVE and TESTING (Davies, 2026-09-24)', () => {
  // A dashboard the way `dashboard()` shapes one: the rows, then `totals` (with `byMode` by book) and `byVenue`
  // summed from them in the payload's order. Three paper rows, and the go-live draft's row on Revolut X.
  const keys = ['costUsd', 'valueUsd', 'unrealisedUsd', 'realisedUsd', 'feesUsd', 'todayUsd'];
  /** @param {any[]} rows */
  const sum = (rows) => {
    const t = /** @type {Record<string, number>} */ (Object.fromEntries(keys.map((k) => [k, 0])));
    for (const r of rows) for (const k of keys) t[k] += r[k];
    return t;
  };
  const row = (id, venue, mode, capitalUsd, f, over = {}) => ({
    id, venue, mode, capitalUsd, costUsd: f[0], valueUsd: f[1], unrealisedUsd: f[2], realisedUsd: f[3], feesUsd: f[4], todayUsd: f[5], positions: [], ...over,
  });
  const rows = [
    row('momentum-1d', 'revx', 'paper', 40, [0, 0, 0, -0.11, 0.02, -0.05]),
    row('trend-4h', 'revx', 'paper', 100, [20, 21.5, 1.5, 12.34, 0.08, 0.42]),
    row('trend-4h-binance', 'binance', 'paper', 100, [9.9, 10.1, 0.2, 0.7, 0.01, 0.13]),
    row('trend-4h-live', 'revx', 'live', 50, [12, 12.5, 0.5, 0.3, 0.03, 0.2], { holdsLive: true }),
  ];
  /** @type {Record<string, any>} */
  const byVenue = {};
  for (const r of rows) {
    const v = (byVenue[r.venue] ??= { ...sum([]), capitalUsd: 0, strategies: 0, live: 0 });
    for (const k of keys) v[k] += r[k];
    v.capitalUsd += r.capitalUsd; v.strategies += 1; if (r.mode === 'live') v.live += 1;
  }
  const venues = [{ id: 'revx', canTrade: true, note: null, feeBps: { maker: 0, taker: 9 } }, { id: 'binance', canTrade: true, note: null, feeBps: { maker: 10, taker: 10 } }];
  const dash = { risk: { global_pause: false, live_confirmed_at: null }, strategies: rows, venues, byVenue,
    totals: { ...sum(rows), byMode: { paper: sum(rows.slice(0, 3)), live: sum(rows.slice(3)) } } };

  it('a row is LIVE while it is labelled live or still holds real coins, and TESTING otherwise — a paused row included', () => {
    expect(AGENT_TABS).toEqual(['live', 'testing']);
    expect(strategyTab({ mode: 'live' })).toBe('live');
    expect(strategyTab({ mode: 'paper', holdsLive: true })).toBe('live');     // relabelled away from real coins: the coins outrank the label
    expect(strategyTab({ mode: 'paused', holdsLive: true })).toBe('live');
    expect(strategyTab({ mode: 'paused' })).toBe('testing');
    expect(strategyTab({ mode: 'paper' })).toBe('testing');
    expect(strategyTab(null)).toBe('testing');
    expect(tabStrategies(dash, 'live').map((r) => r.id)).toEqual(['trend-4h-live']);
    expect(tabStrategies(dash, 'testing').map((r) => r.id)).toEqual(['momentum-1d', 'trend-4h', 'trend-4h-binance']);
    const split = splitStrategyRows(strategyRows(dash, NOW));
    expect(split.live.map((r) => r.id)).toEqual(['trend-4h-live']);
    expect(split.testing.map((r) => r.id)).toEqual(['momentum-1d', 'trend-4h', 'trend-4h-binance']);
    expect(splitStrategyRows(strategyRows({ strategies: [row('x', 'revx', 'paper', 40, [0, 0, 0, 0, 0, 0], { holdsLive: true })] }, NOW)).live.length).toBe(1);
  });
  it('says what each total covers, and what each percent is of', () => {
    expect([scoreboardView(dash, 'live').strategies, scoreboardView(dash, 'testing').strategies, scoreboardView(dash).strategies]).toEqual([1, 3, 4]);
    expect(pctOf(360, 'capital')).toBe('% of $360.00 capital');
    expect(pctOf(99.75, 'held', (s) => s.replace(/\d/g, '•'))).toBe('% of $••.•• held');   // a base is money: the mask covers it
    // The paper tests are rows of TESTING that no total adds up, and each says what its unrealised percent is of.
    const q = quotesRow({ capitalUsd: 1200, openUsd: 99.75, unrealisedUsd: 0.14, realisedUsd: 0.42, todayUsd: 0.12, running: true, lagMinutes: 1 });
    const w = rwRow({ capitalUsd: 296, heldUsd: 14.4, totalUsd: 41, rewardUsd: 41.6, realisedUsd: 42, unrealisedUsd: -1, todayUsd: 12.5, running: true, lagMinutes: 2 });
    if (!q || !w) throw new Error('a test row was missing');
    expect([q?.unrealisedOf, w?.scoreDeployed]).toEqual(['deployed', true]);
    expect(strategyRows(dash, NOW).some((r) => 'apart' in r)).toBe(false);
    // Davies, 2026-09-24: both paper tests count in TESTING's scoreboard. Stablecoin quotes counts on the Revolut X
    // card; Reward quotes is Polymarket's card. Leaving either out fails this. LIVE does not take them.
    const testing = scoreboardView(dash, 'testing', [q, w]);
    const paper = scoreboardView(dash, 'testing');
    expect(testing.capitalUsd).toBe(paper.capitalUsd + 1200 + 296);
    expect(testing.valueUsd).toBeCloseTo(paper.valueUsd + 99.75 + 14.4, 10);
    expect(testing.todayUsd).toBeCloseTo(paper.todayUsd + 0.12 + 12.5, 10);
    expect(testing.realisedUsd).toBeCloseTo(paper.realisedUsd + 0.42 + w.realisedUsd, 10);
    expect(testing.unrealisedUsd).toBeCloseTo(paper.unrealisedUsd + 0.14 + w.unrealisedUsd, 10);
    expect(testing.tests).toBe(2);
    expect(testing.unrealisedOf).toBe('cost and deployed');
    expect(testing.unrealisedBase).toBeCloseTo(29.9 + 99.75 + 14.4, 10);   // the three paper rows' cost, plus what the tests hold
    expect(testing.unrealisedPct).toBeCloseTo(testing.unrealisedUsd / testing.unrealisedBase * 100, 9);
    expect(scoreboardView(dash, 'live', [q, w]).capitalUsd).toBe(50);
    const cards = venueRows(dash, 'testing', [q, w]);
    const revx = cards.find((c) => c.id === 'revx');
    const pm = cards.find((c) => c.id === 'polymarket');
    if (!revx || !pm) throw new Error('a venue card was missing');
    expect(revx.capitalUsd).toBe(140 + 1200);                               // the two paper Revolut X rows, plus the quote test
    expect(revx.valueUsd).toBeCloseTo(21.5 + 99.75, 10);
    expect(revx.tests).toBe(1);
    expect(revx.apart).toEqual([]);
    expect(pm.capitalUsd).toBe(296);
    for (const k of keys) expect(cards.reduce((a, c) => a + (c[k] ?? 0), 0)).toBeCloseTo(testing[k], 8);
  });
  it('over every row, the page\'s sums are the server\'s own totals and byVenue, to the last bit', () => {
    const all = scoreboardView(dash);
    for (const k of keys) expect(all[k]).toBe(dash.totals[k]);
    const cards = venueRows(dash);
    expect(cards.map((c) => c.id)).toEqual(['revx', 'binance']);
    for (const c of cards) for (const k of [...keys, 'capitalUsd', 'strategies', 'live']) expect(c[k]).toBe(byVenue[c.id][k]);
  });
  it('each tab is its own rows: LIVE is the live book, TESTING the paper book, and the two add up to every row', () => {
    const live = scoreboardView(dash, 'live'), testing = scoreboardView(dash, 'testing'), all = scoreboardView(dash);
    for (const k of keys) {
      expect(live[k]).toBe(dash.totals.byMode.live[k]);
      expect(testing[k]).toBe(dash.totals.byMode.paper[k]);
      expect(live[k] + testing[k]).toBeCloseTo(all[k], 10);
    }
    expect([live.capitalUsd, testing.capitalUsd]).toEqual([50, 240]);
    expect(live.todayPct).toBeCloseTo(0.4, 9);                                  // +0.20 on the live row's $50
    expect(live.unrealisedPct).toBeCloseTo(0.5 / 12 * 100, 9);                  // on the $12 the live row holds
    expect(testing.realisedPct).toBeCloseTo((-0.11 + 12.34 + 0.7) / 240 * 100, 9);
    // A tab's venue cards add up to that tab's scoreboard.
    for (const [tab, sb] of /** @type {const} */ ([['live', live], ['testing', testing]])) {
      const cards = venueRows(dash, tab);
      for (const k of keys) expect(cards.reduce((a, c) => a + c[k], 0)).toBeCloseTo(sb[k], 10);
    }
    expect(venueRows(dash, 'live').map((c) => c.id)).toEqual(['revx']);
  });
  it('opens on LIVE while anything is live, else on TESTING', () => {
    expect(defaultAgentsTab(dash)).toBe('live');
    expect(defaultAgentsTab({ strategies: rows.slice(0, 3) })).toBe('testing');
    expect(defaultAgentsTab(null)).toBe('testing');
  });
  it('says whether the live rows may buy — armed, awaiting arming or nothing live — with the pause beside it', () => {
    expect(liveArming(dash)).toEqual({ state: 'unarmed', since: null, paused: false, count: 1 });
    const armed = { ...dash, risk: { ...dash.risk, live_confirmed_at: '2026-09-25T09:00:00Z' } };
    expect(liveArming(armed)).toEqual({ state: 'armed', since: '2026-09-25T09:00:00Z', paused: false, count: 1 });
    expect(liveArming({ ...armed, risk: { ...armed.risk, global_pause: true } })).toMatchObject({ state: 'armed', paused: true });
    // The switch left on after the last live row went is not "armed": there is nothing for it to arm.
    expect(liveArming({ ...armed, strategies: rows.slice(0, 3) })).toEqual({ state: 'none', since: null, paused: false, count: 0 });
    // A row on LIVE only because it still holds real coins under a paper or paused label can never buy: it is winding
    // down, and "awaiting arming" would say arming could change that.
    const winding = { ...dash, strategies: [...rows.slice(0, 3), { ...rows[3], mode: 'paused', windingDown: true }] };
    expect(liveArming(winding)).toEqual({ state: 'winding', since: null, paused: false, count: 1 });
    expect(agentsTabsView(winding).live).toMatchObject({ text: 'Real money · selling what it holds', tone: 'winding' });
    const words = (d, extra = 0) => { const v = agentsTabsView(d, extra); return [v.live.count, v.live.text, v.live.tone, v.testing.count, v.testing.text, v.testing.tone]; };
    // TESTING's count takes in the two paper tests' rows, and its line says how many of the rows are strategies — the
    // ones its totals add up — and how many are tests.
    expect(words(armed, 2)).toEqual([1, 'Real money · trading', 'armed', 5, 'Paper · 5 strategies', 'paper']);
    expect(words(dash)).toEqual([1, 'Real money · not trading yet', 'unarmed', 3, 'Paper · 3 strategies', 'paper']);
    expect(words({ ...armed, risk: { ...armed.risk, global_pause: true } })).toEqual([1, 'Real money · paused', 'paused', 3, 'Paper · 3 strategies', 'paper']);
    expect(words({ strategies: rows.slice(0, 3) }, 2)).toEqual([0, 'Nothing is live', 'none', 5, 'Paper · 5 strategies', 'paper']);
    expect(words({ strategies: rows.slice(1, 2) }, 1)).toEqual([0, 'Nothing is live', 'none', 2, 'Paper · 2 strategies', 'paper']);
  });
  it('puts each banner on the tabs it concerns', () => {
    const now = Date.parse('2026-09-21T12:10:00Z');
    const pending = { id: 7, ts: new Date(now - 3 * 60e3).toISOString(), state: 'pending', mode: 'live' };
    const busy = {
      ...dash,
      risk: { global_pause: true, live_confirmed_at: null },
      venues: [{ id: 'revx', canTrade: true, note: 'quotes: 502' }, { id: 'binance', canTrade: true, note: 'account 451' }],
      strategies: [...rows.slice(0, 3).map((r) => (r.id === 'momentum-1d' ? { ...r, mode: 'paused', windingDown: true, positions: [{ symbol: 'BTC/USD', base: 0.001 }] } : r)),
        { ...rows[3], recentOrders: [pending] }],
    };
    const tabsOf = Object.fromEntries(alertsFor(busy, 'live', now).concat(alertsFor(busy, 'testing', now)).map((a) => [a.id, a.tabs.join('+')]));
    expect(tabsOf).toEqual({
      'global-pause': 'live+testing',            // holds everything
      'venue-revx': 'live+testing',              // Revolut X has rows on both tabs
      'venue-binance': 'testing',                // Binance's rows are all paper
      'winding-down-momentum-1d': 'testing',     // a paused paper row winds down where it is listed
      'pending-trend-4h-live': 'live',
    });
    expect(alertsFor(busy, 'live', now).map((a) => a.id)).toEqual(['global-pause', 'venue-revx', 'pending-trend-4h-live']);
    expect(alertsFor(busy, 'testing', now).map((a) => a.id)).toEqual(['global-pause', 'venue-revx', 'venue-binance', 'winding-down-momentum-1d']);
    // A venue no row trades on still says its fault, on both tabs: nothing is known about whom it concerns.
    expect(alertsFor({ risk: {}, venues: [{ id: 'binance', note: 'down' }], strategies: [] }, 'live').map((a) => a.id)).toEqual(['venue-binance']);
    // A live venue without a key, and a row still holding real coins under a paper label, are LIVE's.
    const noKey = { risk: { live_confirmed_at: 'x' }, venues: [{ id: 'revx', canTrade: false, note: null }], strategies: [{ id: 'l', name: 'L', venue: 'revx', mode: 'live', positions: [] }] };
    expect(alertsFor(noKey, 'live').map((a) => a.id)).toEqual(['nokey-revx']);
    expect(alertsFor(noKey, 'testing')).toEqual([]);
    const relabelled = { risk: { live_confirmed_at: 'x' }, venues, strategies: [{ id: 'l', name: 'L', venue: 'revx', mode: 'paper', holdsLive: true, windingDown: true, positions: [{ symbol: 'ETH/USD', base: 0.005 }] }] };
    expect(alertsFor(relabelled, 'live').map((a) => a.id)).toEqual(['winding-down-l']);
    expect(alertsFor(relabelled, 'testing')).toEqual([]);
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

describe('quotesView', () => {
  // PR5's quotes on paper (reference §4 item 31): the card shows what the notebook concluded, and says so when it stops.
  const q = { startedAt: '2026-09-23T15:09:00Z', lastMinute: '2026-09-24T12:00:00Z', lagMinutes: 1, running: true, lastError: null, capitalUsd: 1200,
    realisedUsd: 0.42, realisedPct: 0.035, todayUsd: 0.12, todayPct: 0.01, trips: 7, won: 6, open: 1, openUsd: 99.75, ordersToday: 205, fillsToday: 8 };
  it("reads the round trips, the orders against the venue's 1,000 a day, and what is held", () => {
    const v = quotesView(q);
    expect(v?.tripsText).toBe('7 · 86 % won');
    expect(v?.ordersText).toBe('205 of 1,000 · 8 filled');
    expect([v?.open, v?.openUsd, v?.capitalUsd, v?.running, v?.stoppedText]).toEqual([1, 99.75, 1200, true, '']);
  });
  it('says when it has stopped, and stays off the page until it exists', () => {
    expect(quotesView({ ...q, running: false, lagMinutes: 12 })?.stoppedText).toBe('not running: its last decided minute is 12 min old');
    expect(quotesView({ ...q, trips: 0, won: 0 })?.tripsText).toBe('0');
    expect(quotesView(null)).toBe(null);
    expect(quotesView(undefined)).toBe(null);
  });
});

describe('quotesRow — the quote test as a row of TESTING STRATEGIES', () => {
  // Davies, 2026-09-23: the stablecoin quotes sit in the testing table with the strategies, in the same cells.
  const q = { startedAt: '2026-09-23T15:09:00Z', lastMinute: '2026-09-24T12:00:00Z', lagMinutes: 1, running: true, lastError: null, capitalUsd: 1200,
    realisedUsd: 0.42, realisedPct: 0.035, todayUsd: 0.12, todayPct: 0.01, trips: 7, won: 6, open: 1, openUsd: 99.75, unrealisedUsd: 0.14, ordersToday: 205, fillsToday: 8 };
  it('fills the cells a strategy row has, on paper, at Revolut X', () => {
    const r = quotesRow(q);
    expect([r?.id, r?.name, r?.venueId, r?.mode, r?.nextText]).toEqual([QUOTES_ROW_ID, 'Stablecoin quotes', 'revx', 'paper', 'every minute']);
    expect([r?.capitalUsd, r?.valueUsd, r?.openPositions]).toEqual([1200, 99.75, 1]);
    expect([r?.todayUsd, r?.todayPct, r?.realisedUsd, r?.realisedPct]).toEqual([0.12, 0.01, 0.42, 0.035]);
    // Unrealised on what is held, the strategies' base (the cost of the position), not on the $1,200.
    expect(r?.unrealisedUsd).toBe(0.14);
    expect(r?.unrealisedPct).toBeCloseTo((0.14 / 99.75) * 100, 12);
    expect(r?.status.tone).toBe('running');
  });
  it('is amber with the reason when it has stopped, flat when it holds nothing, and absent before it exists', () => {
    expect(quotesRow({ ...q, running: false, lagMinutes: 12 })?.status).toMatchObject({ tone: 'stale', detail: 'not running: its last decided minute is 12 min old' });
    expect(quotesRow({ ...q, open: 0, openUsd: 0, unrealisedUsd: 0 })?.unrealisedPct).toBe(null);
    expect(quotesRow({ ...q, unrealisedUsd: null })?.unrealisedUsd).toBe(0);    // a book with no print yet: nothing to show, not NaN
    expect(quotesRow(null)).toBe(null);
  });
});

describe('rwRow / rwView — RW\'s paper test as a row of TESTING STRATEGIES', () => {
  // Davies, 2026-09-24: the Polymarket paper test sits in the testing table beside the quote test, in the same cells.
  const r = { phase: 'run', dayOfRun: 3, runStart: '2026-09-25T00:00:00.000Z', runEnd: '2026-10-09T00:00:00.000Z', startedAt: '2026-09-24T19:31:00Z',
    lastMinute: '2026-09-27T10:02:00Z', lagMinutes: 2, running: true, finished: false, lastError: null,
    capitalUsd: 296, totalUsd: 60, stressUsd: 24, rewardUsd: 62, fillsPnlUsd: -2, realisedUsd: 61, unrealisedUsd: -1, mismatchUsd: 0,
    todayUsd: 20, heldUsd: 40, open: 3, fills: 12, quoting: 16, bestMarketUsd: 12,
    markets: [{ net: 100, avgCost: 0.4 }], days: [], recent: [] };
  it('fills the cells a strategy row has, on paper, at Polymarket', () => {
    const row = rwRow(r);
    expect([row?.id, row?.name, row?.venueId, row?.venue, row?.mode, row?.nextText]).toEqual([RW_ROW_ID, 'Reward quotes', 'polymarket', 'Polymarket', 'paper', 'every minute']);
    expect([row?.capitalUsd, row?.valueUsd, row?.openPositions]).toEqual([296, 40, 3]);
    // Today and realised on the capital at work; unrealised on inventory cost, the same base as every other row.
    expect(row?.todayPct).toBeCloseTo((20 / 296) * 100, 12);
    expect(row?.realisedPct).toBeCloseTo((61 / 296) * 100, 12);
    expect(rwInventoryCost(r.markets)).toBeCloseTo(40, 12);
    expect(row?.unrealisedPct).toBeCloseTo((-1 / 40) * 100, 12);
    expect(row?.unrealisedOf).toBeUndefined();
    const shortNo = rwInventoryCost([{ net: -20, avgCost: 0.66 }]);
    expect(shortNo).toBeCloseTo(20 * 0.34, 12);
    expect(rwRow({ ...r, markets: [{ net: -20, avgCost: 0.66 }], heldUsd: 14.4 })?.unrealisedPct).toBeCloseTo((-1 / shortNo) * 100, 12);
    expect(row?.status).toMatchObject({ tone: 'running', detail: 'quoting 16 markets · last minute decided 2 min ago' });
    expect(venueLabel('polymarket')).toBe('Polymarket');
  });
  it('is amber when it has stopped, grey when the fourteen days are over, flat when it holds nothing, and absent before it exists', () => {
    expect(rwRow({ ...r, running: false, lagMinutes: 9 })?.status).toMatchObject({ tone: 'stale', detail: 'not running: its last decided minute is 9 min old' });
    expect(rwRow({ ...r, running: false, finished: true })).toMatchObject({ nextText: 'finished', status: { tone: 'paused', detail: 'the fourteen days are over' } });
    expect(rwRow({ ...r, markets: [], heldUsd: 0, unrealisedUsd: 0 })?.unrealisedPct).toBe(null);
    expect(rwRow({ ...r, quoting: 1 })?.status.detail).toBe('quoting 1 market · last minute decided 2 min ago');
    expect(rwRow(null)).toBe(null);
  });
  it('says which part of the run it is in, the fills against the bar, and a split that disagrees', () => {
    expect(rwView(r)).toMatchObject({ phaseText: 'day 3 of 14', fillsText: '12 of 100', bestShareText: '20 %', stoppedText: '', mismatch: false });
    expect(rwView({ ...r, phase: 'warm-up', dayOfRun: null })?.phaseText).toBe('warm-up, counted nowhere');
    expect(rwBarTileKeys('warm-up')).toEqual(['STRESS', 'BEST MARKET', 'MARKETS', 'OPEN']);
    expect(rwBarTileKeys('run')).toEqual(['STRESS', 'BEST MARKET', 'MARKETS', 'OPEN']);
    expect(rwView({ ...r, totalUsd: -5 })?.bestShareText).toBe('—');
    expect(rwView({ ...r, mismatchUsd: 0.02 })?.mismatch).toBe(true);
    expect(rwView(undefined)).toBe(null);
  });
  it('writes a price in cents and a holding as the side it is long', () => {
    expect([fmtCents(0.49), fmtCents(0.045), fmtCents(0.5), fmtCents(null)]).toEqual(['49¢', '4.5¢', '50¢', '—']);
    expect([rwHeldText(20), rwHeldText(-20), rwHeldText(0), rwHeldText(2.5)]).toEqual(['20 Yes', '20 No', '—', '2.50 Yes']);
  });
  it('prints realised and unrealised, and rewards and orders, so every part adds up to the total printed beside it', () => {
    // Production, 2026-09-24 (the ops read): total +$34.23 beside realised 55.75 and unrealised −21.53, which make 34.22.
    // Figures of that shape: each part rounds on its own the way it did, and the rounded parts miss the rounded total.
    const live = { ...r, totalUsd: 34.227, realisedUsd: 55.754, unrealisedUsd: -21.527, rewardUsd: 48.7149, fillsPnlUsd: 34.227 - 48.7149, mismatchUsd: 0 };
    const printed = (x) => Math.round(Number(fmtUsd(x).replace(/[^0-9.-]/g, '')) * 100);
    expect([fmtUsd(55.754), fmtUsd(-21.527), fmtUsd(34.227)]).toEqual(['$55.75', '-$21.53', '$34.23']);   // each alone: 34.22 of parts
    const row = rwRow(live), view = rwView(live);
    expect([fmtUsd(row?.realisedUsd), fmtUsd(row?.unrealisedUsd), fmtUsd(view?.totalUsd)]).toEqual(['$55.76', '-$21.53', '$34.23']);
    const T = printed(view?.totalUsd);
    expect(printed(row?.realisedUsd) + printed(row?.unrealisedUsd)).toBe(T);
    expect(printed(view?.rewardUsd) + printed(view?.ordersUsd)).toBe(T);
    // Davies (2026-09-24): realised and unrealised each split into rewards and what orders made, printed to add up.
    expect(printed(row?.rewards.realisedUsd) + printed(row?.orders.realisedUsd)).toBe(printed(row?.realisedUsd));
    expect(printed(row?.rewards.unrealisedUsd) + printed(row?.orders.unrealisedUsd)).toBe(printed(row?.unrealisedUsd));
    expect(row?.rewards.realisedUsd).toBe(view?.rewardUsd);                                  // one rewards figure on the page
    expect(printed(row?.orders.realisedUsd) + printed(row?.orders.unrealisedUsd)).toBe(printed(view?.ordersUsd));
    // The row the table shows and the page's scoreboard are one object: the realised the table prints is the page's.
    expect(row?.realisedPct).toBeCloseTo((55.76 / 296) * 100, 12);
  });
});

describe('splitCents — parts that add up to their total as printed', () => {
  const printed = (x) => Math.round(Number(fmtUsd(x).replace(/[^0-9.-]/g, '')) * 100);
  it('gives each missing cent to the part rounding cut the most', () => {
    expect(splitCents(34.227, [55.754, -21.527])).toEqual({ total: 34.23, parts: [55.76, -21.53] });
    expect(splitCents(0.01, [0.005, 0.005])).toEqual({ total: 0.01, parts: [0, 0.01] });        // each alone rounds up: 0.02 of parts
    expect(splitCents(-0.01, [-0.005, -0.005])).toEqual({ total: -0.01, parts: [0, -0.01] });
    expect(splitCents(0.01, [0.0033, 0.0033, 0.0034])).toEqual({ total: 0.01, parts: [0, 0, 0.01] });  // three pieces, none a cent alone
    expect(splitCents(60, [61, -1])).toEqual({ total: 60, parts: [61, -1] });                   // nothing to hand out
    expect(splitCents(-0.125, [-0.125, 0])).toEqual({ total: -0.13, parts: [-0.13, 0] });       // halves away from zero, as fmtMoney prints them
  });
  it('leaves parts that really disagree with their total as they are, so the disagreement still shows', () => {
    expect(splitCents(10, [7.004, 3.006])).toEqual({ total: 10, parts: [7, 3.01] });            // off by a cent: shown, not hidden
    expect(splitCents(Number.NaN, [1, 2])).toEqual({ total: Number.NaN, parts: [1, 2] });
  });
  it('over 2,000 random splits into two and three, the printed parts add up to the printed total, each within a cent', () => {
    let seed = 20260924;
    const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const draw = () => Math.round((rand() - 0.5) * 5e6) / 1e4;       // ±$250, so no part reaches the $1,000 where fmtMoney drops cents
    for (let i = 0; i < 2000; i++) {
      const total = draw(), a = draw(), c = i % 2 ? draw() : null;
      const parts = c == null ? [a, total - a] : [a, c, total - a - c];
      const s = splitCents(total, parts);
      expect(s.parts.reduce((x, p) => x + printed(p), 0)).toBe(printed(s.total));
      expect(fmtUsd(s.total)).toBe(fmtUsd(total));                                              // the total prints as it always did
      s.parts.forEach((p, k) => expect(Math.abs(p - parts[k])).toBeLessThan(0.01 + 1e-9));
    }
  });
});

describe('quoteLadderRows — a book as the page draws it', () => {
  const book = { book: 'USDC-GBP', rungs: [
    { side: 'bid', k: 0.002, mode: 'quote', price: 0.7535 },
    { side: 'bid', k: 0.001, mode: 'position', price: 0.755, entry: 0.7542, unrealisedUsd: 0.14, heldSince: '2026-09-24T11:40:00.000Z' },
    { side: 'ask', k: 0.001, mode: 'quote', price: 0.7559 },
    { side: 'ask', k: 0.002, mode: 'idle', price: null },
  ] };
  it('one row per distance from interbank, nearest first, with its bid and its ask', () => {
    const rows = quoteLadderRows(book);
    expect(rows.map((r) => r.label)).toEqual(['0.1 %', '0.2 %']);
    // A held rung shows what it paid, not the exit it is quoting; a quoting rung shows its price.
    expect(rows[0].bid).toEqual({ state: 'held', price: 0.7542, unrealisedUsd: 0.14, heldSince: '2026-09-24T11:40:00.000Z' });
    expect(rows[0].ask).toMatchObject({ state: 'quoting', price: 0.7559 });
    expect(rows[1].bid).toMatchObject({ state: 'quoting', price: 0.7535 });
    expect(rows[1].ask.state).toBe('idle');
    expect(quoteLadderRows(null)).toEqual([]);
  });
  it('writes a book as a pair and a price as pounds to four places', () => {
    expect(quoteBookLabel('USDT-GBP')).toBe('USDT/GBP');
    expect([fmtQuotePrice(0.75), fmtQuotePrice(null)]).toEqual(['£0.7500', '—']);
  });
});

// The page opens on what it last drew — including the first open after a
// reload, when memory is empty — and a request already out is joined.
// Measured before: opened right after a reload the page said "Loading…" for
// the length of the (slow) dashboard call, and asked for it a second time
// while the app's own fetch after first paint was still out.
describe('the Agents page kept across a reload', () => {
  const DASH = { at: 'kept', strategies: [{ id: 's1', symbols: ['BTC/USD', 'ETH/USD'], positions: [{ symbol: 'ETH/USD', base: 0.5 }] }] };
  const respond = (url) => new Response(JSON.stringify(String(url).includes('action=dashboard') ? DASH : { candles: [[1, 1, 2, 0.5, 1.5]], symbol: 'x' }), { status: 200 });
  const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

  it('reads back the last dashboard and each strategy\'s first chart after a reload — and only that chart', async () => {
    localStorage.clear();
    _reloadAgentsCache();
    await fetchAgentsDashboard(/** @type {any} */ (async (u) => respond(u)));
    await fetchAgentsChart('s1', 'ETH/USD', /** @type {any} */ (async (u) => respond(u)));   // the held coin: the one the detail opens on
    await fetchAgentsChart('s1', 'BTC/USD', /** @type {any} */ (async (u) => respond(u)));
    await settle();

    _reloadAgentsCache();                                                                  // what a reload does to memory
    expect(readAgentsCache()?.dash).toEqual(DASH);
    expect(readChartCache('s1', 'ETH/USD')?.chart).toBeTruthy();
    expect(readChartCache('s1', 'BTC/USD')).toBeNull();
  });

  it('never lets the kept copy stand over a fresher answer in memory', async () => {
    localStorage.clear();
    _reloadAgentsCache();
    await fetchAgentsDashboard(/** @type {any} */ (async (u) => respond(u)));
    await settle();
    _reloadAgentsCache();
    await fetchAgentsDashboard(/** @type {any} */ (async () => new Response(JSON.stringify({ at: 'fresh', strategies: [] }), { status: 200 })));
    expect(readAgentsCache()?.dash?.at).toBe('fresh');
  });

  it('joins the request already out instead of asking the slow dashboard call again', async () => {
    _reloadAgentsCache();
    /** @type {(v?: unknown) => void} */
    let answer = () => {};
    const gate = new Promise((r) => { answer = r; });
    const fetchImpl = vi.fn(async (u) => { await gate; return respond(u); });
    const first = prefetchAgentsDashboard(/** @type {any} */ (fetchImpl), () => {});
    expect(dashboardInFlight()).toBeTruthy();
    const second = prefetchAgentsDashboard(/** @type {any} */ (fetchImpl), () => {});
    answer();
    await Promise.all([first, second]);
    expect(fetchImpl.mock.calls.filter(([u]) => String(u).includes('action=dashboard')).length).toBe(1);
    expect(dashboardInFlight()).toBeNull();
  });

  it('joins a chart request for the same pair, and only the same pair', async () => {
    _reloadAgentsCache();
    const fetchImpl = vi.fn(async (u) => respond(u));
    await Promise.all([
      fetchAgentsChart('s1', 'BTC/USD', /** @type {any} */ (fetchImpl)),
      fetchAgentsChart('s1', 'BTC/USD', /** @type {any} */ (fetchImpl)),
      fetchAgentsChart('s1', 'ETH/USD', /** @type {any} */ (fetchImpl)),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
