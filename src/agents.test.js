import { describe, it, expect, vi } from 'vitest';
import {
  backtestRows, basisRows, decisionView, fetchAgentsDashboard, fmtBps, fmtFees, fmtFrac, fmtUsd, orderView, strategyRows, strategyStatus,
  rotationBacktestRows, totalsView, untilText, venueRows,
} from './agents.js';

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
    expect(strategyStatus(strategy(), null, NOW)).toEqual({ label: 'paper', running: true, detail: 'decided 3h 55m ago' });
    const old = strategy({ lastDecision: { ts: '2026-09-19T20:00:00Z', symbol: 'BTC/USD', action: 'hold' } });
    expect(strategyStatus(old, null, NOW).running).toBe(false);
    expect(strategyStatus(old, null, NOW).detail).toMatch(/^last decision 16h 00m ago$/);
    // A daily strategy is allowed two days.
    expect(strategyStatus(strategy({ kind: 'momentum-1d', lastDecision: { ts: '2026-09-19T00:10:00Z' } }), null, NOW).running).toBe(true);
  });
  it('paused rows, the global pause and a strategy that never decided are not running', () => {
    expect(strategyStatus(strategy({ mode: 'paused' }), null, NOW)).toEqual({ label: 'paused', running: false, detail: 'paused' });
    expect(strategyStatus(strategy({ mode: 'live' }), { global_pause: true }, NOW)).toEqual({ label: 'live', running: false, detail: 'global pause' });
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

describe('decisionView / orderView', () => {
  it('reads the words the model saw and its vote out of a decision row', () => {
    const v = decisionView({
      id: 9, ts: '2026-09-20T08:05:00Z', symbol: 'ETH/USD',
      state: { trend_4h: 'up', breakout_4h: 'above_range', volatility: 'normal', momentum_30d: 'positive', position: 'flat' },
      answers: { healthy_trend: { type: 'noul', probability: 0.87 }, caution: { type: 'score', score: 0.12 }, _state: { type: 'choice', choice: 'ETH/USD' } },
      rule_action: 'enter', final_action: 'enter', provider: 'openrouter', risk_allowed: true, final_reason: 'trend up; model agrees', risk_reason: 'within limits', cost_usd: 0.0000184, latency_ms: 470,
    });
    expect(v).toMatchObject({ symbol: 'ETH/USD', stateText: 'trend up · above_range · vol normal · mom positive · flat', ruleAction: 'enter', finalAction: 'enter', healthy: 0.87, caution: 0.12, provider: 'openrouter', allowed: true, latencyMs: 470 });
    expect(decisionView({ answers: {}, state: {} }).healthy).toBeNull();
  });
  it('an order row: notional from the fill when there is one, else from the resting price', () => {
    expect(orderView({ id: 1, ts: 't', symbol: 'BTC/USD', side: 'buy', mode: 'paper', state: 'filled', price: 80000, base_size: 0.00025, filled_base: 0.00025, avg_fill_price: 79990, fee_usd: 0.08 }))
      .toMatchObject({ fillPrice: 79990, notionalUsd: 19.9975, feeUsd: 0.08, base: 0.00025 });
    expect(orderView({ price: 80000, base_size: 0.00025, filled_base: 0, avg_fill_price: null }).notionalUsd).toBe(20);
  });
});

describe('backtestRows', () => {
  const summary = {
    results: {
      'BTC/USD': { buyHoldOutOfSample: -0.2806, 'trend-4h': { chosen: { fast: 30, slow: 100, atrStop: 4 }, revx: { outOfSample: { ret: -0.18, maxDD: 0.24, trades: 26 }, fullPeriod: { ret: 0.47, maxDD: 0.3 } }, kraken: { outOfSample: { ret: -0.278, maxDD: 0.3, trades: 26 }, fullPeriod: { ret: 0.028, maxDD: 0.35 } } }, 'momentum-1d': { revx: { outOfSample: { ret: -0.136 }, fullPeriod: { ret: 1.19 } } } },
    },
  };
  it('picks one rulebook on one venue, keeping the chosen parameters for the trend rule only', () => {
    expect(backtestRows(summary, 'trend-4h', 'kraken')).toEqual([{ symbol: 'BTC/USD', oosRet: -0.278, oosDD: 0.3, oosTrades: 26, fullRet: 0.028, fullDD: 0.35, buyHoldOos: -0.2806, chosen: { fast: 30, slow: 100, atrStop: 4 } }]);
    expect(backtestRows(summary, 'momentum-1d', 'revx')[0]).toMatchObject({ oosRet: -0.136, chosen: null });
    expect(backtestRows(summary, 'momentum-1d', 'kraken')).toEqual([]);
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
      expect(String(url)).toMatch(/\/functions\/v1\/agents\?action=dashboard$/);
      expect(init.headers['X-App-Token']).toBe('tok.sig');
      return new Response(JSON.stringify({ at: 'x', strategies: [] }), { status: 200 });
    });
    expect(await fetchAgentsDashboard(fetchImpl)).toEqual({ at: 'x', strategies: [] });
    const bad = vi.fn(async () => new Response('{"error":"unauthorised"}', { status: 401 }));
    await expect(fetchAgentsDashboard(bad)).rejects.toThrow(/401 .*unauthorised/);
  });
});

describe('venueRows / basisRows / untilText', () => {
  it('splits the book by venue and takes the share of deployed value, or of capital while nothing is deployed', () => {
    const dash = {
      byVenue: { revx: { valueUsd: 30, capitalUsd: 140, realisedUsd: 1, strategies: 4, live: 0 }, kraken: { valueUsd: 10, capitalUsd: 140, realisedUsd: -2, strategies: 3, live: 1 } },
      venues: [{ id: 'revx', canTrade: true, balances: { USD: 100 }, feeBps: { maker: 0, taker: 9 } }, { id: 'kraken', canTrade: true, balances: { USD: 0, GBP: 75 }, feeBps: { maker: 40, taker: 80 } }],
    };
    const rows = venueRows(dash);
    expect(rows.map((r) => r.label)).toEqual(['Revolut X', 'Kraken']);
    expect(rows[0]).toMatchObject({ valueUsd: 30, balanceUsd: 100, share: 0.75, shareOf: 'value', live: 0 });
    expect(rows[1]).toMatchObject({ valueUsd: 10, balanceUsd: 0, share: 0.25, live: 1 });
    const idle = venueRows({ byVenue: { revx: { valueUsd: 0, capitalUsd: 60 }, kraken: { valueUsd: 0, capitalUsd: 140 } }, venues: [] });
    expect(idle.map((r) => [r.share, r.shareOf])).toEqual([[0.3, 'capital'], [0.7, 'capital']]);
    expect(venueRows(null).map((r) => r.share)).toEqual([0, 0]);
  });
  it('basis rows are sorted by symbol and carry the 24 h counts', () => {
    const rows = basisRows({ basis: { 'SOL/USD': { latest: -0.6, n: 200, absP95: 1.5, over40: 0 }, 'BTC/USD': { latest: 0.3, n: 200, absP95: 1.1, over40: 0 } } });
    expect(rows.map((r) => r.symbol)).toEqual(['BTC/USD', 'SOL/USD']);
    expect(rows[0]).toMatchObject({ latest: 0.3, over40: 0 });
    expect(basisRows(null)).toEqual([]);
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

describe('rotationBacktestRows', () => {
  it('lists the basket variants for one venue with the other venue beside them', () => {
    const summary = { basket: { symbols: ['BTC/USD', 'ETH/USD'], buyHoldEqualWeightOutOfSample: -0.467, buyHoldEqualWeightFull: 2.25, variants: {
      default: { params: {}, revx: { outOfSample: { ret: -0.122, maxDD: 0.3, exposure: 0.33, turnover: 21.7 }, fullPeriod: { ret: 1.284 } }, kraken: { outOfSample: { ret: -0.209 }, fullPeriod: { ret: 0.555 } } },
    } } };
    const r = rotationBacktestRows(summary, 'revx');
    expect(r.symbols).toEqual(['BTC/USD', 'ETH/USD']);
    expect(r.buyHoldOos).toBe(-0.467);
    expect(r.rows).toEqual([{ name: 'default', label: 'top 2, bear filter on', oosRet: -0.122, oosDD: 0.3, exposure: 0.33, turnover: 21.7, fullRet: 1.284, otherOosRet: -0.209 }]);
    expect(rotationBacktestRows(summary, 'kraken').rows[0]).toMatchObject({ oosRet: -0.209, otherOosRet: -0.122 });
    expect(rotationBacktestRows(null, 'revx')).toEqual({ rows: [], buyHoldOos: null, buyHoldFull: null, symbols: [] });
  });
});
