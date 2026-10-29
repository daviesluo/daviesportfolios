// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  defaultChartSymbol, fetchAgentsChart, fetchAgentsDashboard, fmtBps, fmtFees, FULL_HISTORY_LIMIT, historyLimitOf, lastChangeText, showFullHistory, symbolOrderRows, fmtFrac, fmtPct2, fmtPctSigned, fmtUsd, kindLabel, liveStateRows, nextDecisionText, observationAgeMs, observationAgeText, observationView, orderView, strategyRows, strategyStatus, totalsView, untilText, venueHue, venueRows, VENUE_LABELS, VENUE_HUES, agentsAlerts, agentsErrorView, parseAgentsErrorBody, shortErrorMessage, positionLines, shareSegments, paperOnly, strategyNameParts, quoteLadderRows, quoteRungLabel, quoteBookLabel, fmtQuotePrice, countdownText, prefetchAgentsDashboard, readAgentsCache, readChartCache, glText, scoreboardView, strategyScoreboard, newestWins, sizeText, dashboardInFlight, _reloadAgentsCache, QUOTES_LIVE_ROW_ID, quotesLiveRow, QUOTES_TWIN_ROW_PREFIX, quotesTwinLines, quotesTwinOf, quotesTwinRow, quotesTwinRows, fmtQuoteQty, testedForText, rwBarTileKeys, fmtUsd4, fmtCents, rwHeldText, rwHeldOf, rwFillView, rwShareText, venueLabel, paperTestRows, GROKPM_ROW_ID, GROKPM_ROW_NAME, grokPmRow, grokPmModeTag, grokPmTiles, linkDomain, utcStamp, grokPmStopText, grokPmMismatchText, grokPmDayCells, grokPmJournalView, fmtProb, fmtBrier, LP_LIVE_ROW_ID, fmtR, lpStopRoomText, liveExtraRows, lpEstimateTexts, lpLiveDayCells, lpLiveQuoteRows, lpLiveRow, quoteDaysAnnualPct, QUOTE_DAYS_ANNUAL_LABEL, QUOTE_DAYS_ANNUAL_TITLE, lpLiveStatus, AGENT_TABS, agentsTabsView, alertsFor, defaultAgentsTab, liveArming, pctOf, splitCents, splitStrategyRows, strategyTab, tabStrategies, fmtFeeGbp4, fmtGbp, fmtGbp4, fmtIn, glTextIn, orderStateText, quotesLiveBooks, quotesLiveInventory, quotesPageFor, rowMoney, QUOTES_COINBASE_ROW_ID, QUOTES_COINBASE_HOLD_ROW_ID, QUOTES_COINBASE_USDC_ROW_ID, quotesCoinbaseRow,
} from './agents.js';
// The live quotes page's fixture: what the dashboard serves for a book worked out by hand (the agents function's test
// proves it is the server's own answer for its rows; the browser test serves it).
import liveFixture from '../e2e/quotes_live_fixture.json';
// The realistic twins' fixture: the live fixture's rows run as each twin's, and the dashboard's answer for them.
import twinFixture from '../e2e/quotes_twin_fixture.json';
// "Stablecoin quotes with Euros"'s: its driver and the dashboard's view run on a small recorded world (cb_quotes.test.ts).
import cbFixture from '../e2e/quotes_coinbase_fixture.json';
import cbHoldFixture from '../e2e/quotes_coinbase_hold_fixture.json';
import lpFixture from '../e2e/lp_fixture.json';
// Live-prep's real-money book: a live record worked out by hand, and the dashboard's answer for it (pm_lp_live_view.test.ts).
import lpLiveFixture from '../e2e/lp_live_fixture.json';
import grokPmFixture from '../e2e/grokpm_fixture.json';
import {
  chartGeometry, fmtChartPrice, fmtChartStamp, fmtChartTime, hoverPoint, isResting, markPath, niceStep, priceTicks, tooltipBox, windowText, plotLabelY,
} from './agents_chart.js';
import { dropDot00 } from '../app/formatters.js';
import { onSignOut } from '../app/auth.js';

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
    // A whole number is an integer. The old printers wrote "$100.00", "$0.00", "+25.00%".
    expect(fmtUsd(100)).toBe('$100');
    expect(fmtUsd(0)).toBe('$0');
    expect(fmtUsd(-0.004)).toBe('$0');
    expect(fmtUsd(1.2)).toBe('$1.20');
    // A browser that writes a decimal comma: a loss under a dollar keeps its minus (it read "$0,50"), and ",00" goes.
    expect(dropDot00('-$0,50')).toBe('-$0,50');
    expect(dropDot00('-$0,00')).toBe('$0');
    // Pounds as dollars (Davies, 2026-10-01: the stablecoin quotes' pages): a loss that rounds to nothing is no loss.
    expect([dropDot00('-£0.00'), dropDot00('+£0.00'), dropDot00('-£0.50'), dropDot00('-£1,000.00')]).toEqual(['£0', '£0', '-£0.50', '-£1,000']);
    expect(dropDot00('+$1.234,00')).toBe('+$1.234');
    expect(dropDot00('$1,000')).toBe('$1,000');
    expect(dropDot00('-$1,000.00')).toBe('-$1,000');
    expect(fmtPctSigned(25, 2)).toBe('+25%');
    expect(fmtPctSigned(21.5, 2)).toBe('+21.50%');
    expect(fmtPctSigned(0, 2)).toBe('0%');
    expect(fmtPctSigned(0.001, 2)).toBe('0%');
    expect(fmtPct2(25)).toBe('25%');
    expect(fmtPct2(21.5)).toBe('21.50%');
    expect(fmtFrac(-0.2806)).toBe('-28.1%');
    expect(fmtFrac(null)).toBe('—');
    expect(fmtFees({ maker: 40, taker: 80 })).toBe('maker 0.4% / taker 0.8%');
    expect(fmtFees(undefined)).toBe('—');
  });
});

describe('fetchAgentsDashboard', () => {
  it('sends the app token and surfaces the server message on failure', async () => {
    sessionStorage.setItem('dp.token', 'tok.sig');
    const fetchImpl = vi.fn(async (url, init) => {
      // Pinned to London, beside the database (and Binance, which refuses a US region with 451, for a Binance row).
      expect(String(url)).toMatch(/\/functions\/v1\/agents\?action=dashboard&forceFunctionRegion=eu-west-2$/);
      expect(init.headers['X-App-Token']).toBe('tok.sig');
      return new Response(JSON.stringify({ at: 'x', strategies: [] }), { status: 200 });
    });
    expect(await fetchAgentsDashboard(fetchImpl)).toEqual({ at: 'x', strategies: [] });
    const bad = vi.fn(async () => new Response('{"error":"unauthorised"}', { status: 401 }));
    await expect(fetchAgentsDashboard(bad)).rejects.toThrow(/401 .*unauthorised/);
  });

  it('a 401 signs this browser out, so the app shows its login form instead of an error card (Davies, 2026-09-27)', async () => {
    sessionStorage.setItem('dp.token', 'tok.sig');
    const seen = [];
    const off = onSignOut(() => seen.push('out'));
    const denied = vi.fn(async () => new Response('{"error":"invalid token"}', { status: 401 }));
    await expect(fetchAgentsDashboard(denied)).rejects.toThrow(/401/);
    expect([sessionStorage.getItem('dp.token'), seen]).toEqual([null, ['out']]);
    // A 403 is an answer to a good token (an operator action), not a lapsed one: it signs nothing out.
    sessionStorage.setItem('dp.token', 'tok.sig');
    const forbidden = vi.fn(async () => new Response('{"error":"forbidden"}', { status: 403 }));
    await expect(fetchAgentsDashboard(forbidden)).rejects.toThrow(/403/);
    expect([sessionStorage.getItem('dp.token'), seen]).toEqual(['tok.sig', ['out']]);
    off();
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
    expect(fmtBps(2)).toBe('+2 bps');
    expect(fmtBps(0)).toBe('0 bps');
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
    expect(fmtChartPrice(115, 12)).toBe('115');
    expect(fmtChartPrice(110.5, 12)).toBe('110.50');
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
  it('Load full history is shown only when the chart says the log would add a row', () => {
    // The button used to sit under every strategy. A chart that already holds
    // every order the log would return (`ordersMore: false`) must hide it;
    // an older server that does not say leaves it up.
    expect(FULL_HISTORY_LIMIT).toBe(300);
    expect(showFullHistory({ ordersMore: false }, null)).toBe(false);
    expect(showFullHistory({ ordersMore: true }, null)).toBe(true);
    expect(showFullHistory({}, null)).toBe(true);
    expect(showFullHistory(null, null)).toBe(false);
    expect(showFullHistory({ ordersMore: true }, { orders: [] })).toBe(false);
    expect(historyLimitOf({ historyLimit: 300 })).toBe(300);
    expect(historyLimitOf({})).toBe(300);
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
  it('keeps the full label and a percent-only short form, and what the share is of in the title', () => {
    const rows = /** @type {any} */ ([{ id: 'binance', label: 'Binance', share: 0.8, shareOf: 'value' }, { id: 'revx', label: 'Revolut X', share: 0.2, shareOf: 'value' }]);
    const seg = shareSegments(rows);
    expect(seg[0].text).toBe('Binance 80%');
    expect(seg[0].short).toBe('80%');
    expect(seg[0].title).toBe('Binance: 80% of deployed value');
    expect(seg[1].text).toBe('Revolut X 20%');
    expect(seg[0].widthPct).toBe(80);
    // The data keeps the full label even for a sliver. The bar drops the name when the slice cannot show it.
    const sliver = shareSegments(/** @type {any} */ ([{ id: 'x', label: 'X', share: 0.05, shareOf: 'value' }]))[0];
    expect(sliver.text).toBe('X 5%');
    expect(sliver.short).toBe('5%');
    expect(shareSegments(/** @type {any} */ ([{ id: 'z', label: 'Z', share: 0, shareOf: 'value' }]))[0].text).toBe('');
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
    expect(glText(0, null)).toBe('$0');
    expect(glText(12, 25)).toBe('+$12 (+25%)');
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
    // A live row paused (or relabelled) once flat still carries real money it made: its fills keep it on LIVE, so its
    // realised dollars are never added into TESTING's paper totals. A paper row's own fills do not move it.
    const stopped = { ...rows[3], mode: 'paused', holdsLive: false, positions: [], otherBooks: [{ symbol: 'SOL/USD', book: 'live', base: 0, fills: 2 }] };
    expect(strategyTab(stopped)).toBe('live');
    expect(strategyTab({ mode: 'paper', positions: [{ symbol: 'SOL/USD', book: 'paper', base: 0, fills: 4 }] })).toBe('testing');
    expect(strategyTab({ mode: 'paused', positions: [{ symbol: 'SOL/USD', book: 'live', base: 0, fills: 0 }] })).toBe('testing');
    const afterLive = { ...dash, strategies: [...rows.slice(0, 3), stopped] };
    for (const k of keys) expect(scoreboardView(afterLive, 'testing')[k]).toBe(dash.totals.byMode.paper[k]);
    expect(scoreboardView(afterLive, 'live').realisedUsd).toBe(0.3);
  });
  it('says what each total covers, and what each percent is of', () => {
    expect([scoreboardView(dash, 'live').strategies, scoreboardView(dash, 'testing').strategies, scoreboardView(dash).strategies]).toEqual([1, 3, 4]);
    expect(pctOf(360, 'capital')).toBe('% of $360 capital');
    expect(pctOf(99.75, 'held', (s) => s.replace(/\d/g, '•'))).toBe('% of $••.•• held');   // a base is money: the mask covers it
    // The paper tests are rows of TESTING that no total adds up, and each says what its unrealised percent is of.
    // A realistic twin (Davies, 2026-10-02) has a book of its own, so its unrealised is on what that book cost, as a
    // strategy's; a paper test scored on what it has deployed (`scoreDeployed`, as RW's row was until 0120) is on that.
    // The row is RW's as its maker built it, kept as a literal since the maker left with RW's page (2026-10-20).
    // The £1,200 twin on LIVE's rules (live1200, variant-1 since 0144): "Stablecoin quotes" (pr5) was until 0151 switched it off.
    const q = quotesTwinRow(/** @type {any} */ (twinFixture.twins).find((/** @type {any} */ t) => t.twin.id === 'live1200'));
    const w = {
      id: '__rw', name: 'Reward quotes', venue: 'Polymarket', venueId: 'polymarket', mode: 'paper', scoreDeployed: true, capitalUsd: 296, valueUsd: 14.4, heldUsd: 14.4,
      todayUsd: 12.5, unrealisedUsd: -1, unrealisedPct: null, unrealisedBaseUsd: 0, realisedUsd: 42, rewards: { realisedUsd: 41.6, unrealisedUsd: 0 }, orders: { realisedUsd: 0.4, unrealisedUsd: -1 },
      feesUsd: null, nextText: 'every minute', openPositions: 0, status: { label: 'paper', running: true, tone: 'running', detail: '' },
    };
    if (!q || !w) throw new Error('a test row was missing');
    expect([/** @type {any} */ (q).scoreDeployed, /** @type {any} */ (q).unrealisedOf, w?.scoreDeployed]).toEqual([undefined, undefined, true]);
    expect(strategyRows(dash, NOW).some((r) => 'apart' in r)).toBe(false);
    // Davies, 2026-09-24: the paper tests count in TESTING's scoreboard. Stablecoin quotes counts on the Revolut X card;
    // Reward quotes is Polymarket's card. Leaving either out fails this. LIVE does not take them.
    const testing = scoreboardView(dash, 'testing', [q, w]);
    const paper = scoreboardView(dash, 'testing');
    expect(testing.capitalUsd).toBe(paper.capitalUsd + 1584 + 296);           // the twin's £1,200 at 1.32
    expect(testing.valueUsd).toBeCloseTo(paper.valueUsd + q.valueUsd + 14.4, 10);
    expect(testing.todayUsd).toBeCloseTo(paper.todayUsd + q.todayUsd + 12.5, 10);
    expect(testing.realisedUsd).toBeCloseTo(paper.realisedUsd + q.realisedUsd + w.realisedUsd, 10);
    expect(testing.unrealisedUsd).toBeCloseTo(paper.unrealisedUsd + q.unrealisedUsd + w.unrealisedUsd, 10);
    expect(testing.feesUsd).toBeCloseTo(paper.feesUsd + q.feesUsd, 10);
    expect(testing.tests).toBe(2);
    expect(testing.unrealisedOf).toBe('cost and deployed');
    expect(testing.unrealisedBase).toBeCloseTo(29.9 + q.costUsd + 14.4, 10);   // the paper rows' and the twin's cost, and what RW holds
    expect(testing.unrealisedPct).toBeCloseTo(testing.unrealisedUsd / testing.unrealisedBase * 100, 9);
    // Each tab adds the rows its caller hands it: the page hands TESTING the paper tests and LIVE only PR5's live executor.
    expect(scoreboardView(dash, 'live').capitalUsd).toBe(50);
    const cards = venueRows(dash, 'testing', [q, w]);
    const revx = cards.find((c) => c.id === 'revx');
    const pm = cards.find((c) => c.id === 'polymarket');
    if (!revx || !pm) throw new Error('a venue card was missing');
    expect(revx.capitalUsd).toBe(140 + 1584);                               // the two paper Revolut X rows, plus the twin
    expect(revx.valueUsd).toBeCloseTo(21.5 + q.valueUsd, 10);
    expect(revx.unrealisedPct).toBeCloseTo((revx.unrealisedUsd / (20 + q.costUsd)) * 100, 9);
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
    expect(liveArming(dash)).toEqual({ state: 'unarmed', since: null, paused: false, count: 1, holding: true });
    const armed = { ...dash, risk: { ...dash.risk, live_confirmed_at: '2026-09-25T09:00:00Z' } };
    expect(liveArming(armed)).toEqual({ state: 'armed', since: '2026-09-25T09:00:00Z', paused: false, count: 1, holding: true });
    expect(liveArming({ ...armed, risk: { ...armed.risk, global_pause: true } })).toMatchObject({ state: 'armed', paused: true });
    // The switch left on after the last live row went is not "armed": there is nothing for it to arm.
    expect(liveArming({ ...armed, strategies: rows.slice(0, 3) })).toEqual({ state: 'none', since: null, paused: false, count: 0, holding: false });
    // A row on LIVE only because it still holds real coins under a paper or paused label can never buy: it is winding
    // down, and "awaiting arming" would say arming could change that.
    const winding = { ...dash, strategies: [...rows.slice(0, 3), { ...rows[3], mode: 'paused', windingDown: true }] };
    expect(liveArming(winding)).toEqual({ state: 'winding', since: null, paused: false, count: 1, holding: true });
    expect(agentsTabsView(winding).live).toMatchObject({ text: 'Real money · selling what it holds', tone: 'winding' });
    const words = (d, extra = 0) => { const v = agentsTabsView(d, extra); return [v.live.count, v.live.text, v.live.tone, v.testing.count, v.testing.text, v.testing.tone]; };
    // TESTING's count takes in the two paper tests' rows, and its line says how many of the rows are strategies — the
    // ones its totals add up — and how many are tests.
    expect(words(armed, 2)).toEqual([1, 'Real money · trading', 'armed', 5, 'Paper', 'paper']);
    // Unarmed stops buys only: a live row still holding coins is selling them, and "not trading yet" is for a flat one.
    expect(words(dash)).toEqual([1, 'Real money · selling what it holds', 'unarmed', 3, 'Paper', 'paper']);
    const flat = { ...dash, strategies: [...rows.slice(0, 3), { ...rows[3], holdsLive: false }] };
    expect(words(flat)).toEqual([1, 'Real money · not trading yet', 'unarmed', 3, 'Paper', 'paper']);
    // A live row paused once flat can neither buy nor sell: stopped, not winding down.
    const stopped = { ...dash, strategies: [...rows.slice(0, 3), { ...rows[3], mode: 'paused', holdsLive: false, otherBooks: [{ symbol: 'SOL/USD', book: 'live', base: 0, fills: 2 }] }] };
    expect(liveArming(stopped)).toEqual({ state: 'stopped', since: null, paused: false, count: 1, holding: false });
    expect(words(stopped)).toEqual([1, 'Real money · stopped', 'paused', 3, 'Paper', 'paper']);
    expect(words({ ...armed, risk: { ...armed.risk, global_pause: true } })).toEqual([1, 'Real money · paused', 'paused', 3, 'Paper', 'paper']);
    expect(words({ strategies: rows.slice(0, 3) }, 2)).toEqual([0, 'Nothing is live', 'none', 5, 'Paper', 'paper']);
    expect(words({ strategies: rows.slice(1, 2) }, 1)).toEqual([0, 'Nothing is live', 'none', 2, 'Paper', 'paper']);
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
      'pending-trend-4h-live': 'live+testing',   // real money in an unknown state, whichever tab is open
    });
    expect(alertsFor(busy, 'live', now).map((a) => a.id)).toEqual(['global-pause', 'venue-revx', 'pending-trend-4h-live']);
    expect(alertsFor(busy, 'testing', now).map((a) => a.id)).toEqual(['global-pause', 'venue-revx', 'venue-binance', 'winding-down-momentum-1d', 'pending-trend-4h-live']);
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

/** The twins the dashboard sends: the fixture's, but for those whose spec row is hidden (0141; 0167 hides the USDT 2:1 one and switches the £120 twin off). */
const shownTwins = /** @type {any[]} */ (twinFixture.twins).filter((t) => !(/** @type {any[]} */ (twinFixture.specs)).some((s) => s.id === t.twin.id && s.hidden));

describe("the realistic twins as rows of TESTING (Davies, 2026-10-02: the live executor's code on a simulated account)", () => {
  // By id: the fixture holds every enabled twin of the spec rows, in their order (a later variant is a row of it too). Since
  // 0151 (2026-10-28) "Stablecoin quotes" (pr5), the size twin (p50) and rule D's twin (d) are off, their readouts written:
  // the £1,200 and £600 twins on LIVE's rules carry what these checks read of them (the same book, at £1,200 and at £600).
  const twin = (/** @type {string} */ id) => /** @type {any} */ (twinFixture.twins).find((/** @type {any} */ t) => t.twin.id === id);
  const t1200 = twin('live1200'), t600 = twin('live600'), t50 = twin('take50');
  it("fills a strategy row's cells as the live executor's LIVE row does, on paper", () => {
    const r = /** @type {any} */ (quotesTwinRow(t1200));
    expect([r.id, r.name, r.venueId, r.mode, r.nextText]).toEqual([`${QUOTES_TWIN_ROW_PREFIX}live1200`, 'Stablecoin quotes variant-1', 'revx', 'paper', 'every minute']);
    // The same figures as the LIVE row for the same book: the fixture's twin is the live fixture's rows at £1,200.
    const live = /** @type {any} */ (quotesLiveRow(liveFixture.live));
    for (const k of ['capitalUsd', 'costUsd', 'valueUsd', 'feesUsd', 'todayUsd', 'todayPct', 'unrealisedUsd', 'unrealisedPct', 'realisedUsd', 'realisedPct', 'ccy', 'gbp', 'openPositions', 'openOrders']) {
      expect(r[k]).toEqual(live[k]);
    }
    expect([r.holdsLive, r.armed]).toEqual([undefined, undefined]);         // paper money: never a LIVE row's
    expect(r.status).toEqual({ label: 'paper', running: true, tone: 'running', detail: 'the live code on a simulated account · last turn 1 min ago' });
    const x = rowMoney(r);
    expect([x.ccy, x.capital, x.fees]).toEqual(['GBP', 1200, t1200.feesGbp]);
  });
  it('puts a name without a variant on one line (rule D\'s twin was "Stablecoin quotes rule-D twin" until 0151 switched it off)', () => {
    expect(strategyNameParts('Stablecoin quotes rule-D twin')).toEqual({ head: 'Stablecoin quotes rule-D twin', qual: null, twoLines: false });
    expect(strategyNameParts('Stablecoin quotes size twin').twoLines).toBe(false);
    expect(strategyNameParts('Reward quotes variant-1')).toEqual({ head: 'Reward quotes variant-1', qual: null, twoLines: false });
    expect(strategyNameParts('Reward quotes (no same-day)')).toEqual({ head: 'Reward quotes', qual: '(no same-day)', twoLines: false });
  });
  it('is "Stablecoin quotes LIVE twin" (live600, LIVE\'s size since 2026-10-27) and "variant-1" (live1200, the next step) on LIVE\'s rules (0144), on two lines, the first two', () => {
    const r6 = /** @type {any} */ (quotesTwinRow(t600)), r12 = /** @type {any} */ (quotesTwinRow(t1200));
    expect([r6.id, r6.name, rowMoney(r6).capital, r6.capitalUsd, r6.venueId, r6.mode]).toEqual([`${QUOTES_TWIN_ROW_PREFIX}live600`, 'Stablecoin quotes LIVE twin', 600, 792, 'revx', 'paper']);
    expect([r12.id, r12.name, rowMoney(r12).capital, r12.venueId, r12.mode]).toEqual([`${QUOTES_TWIN_ROW_PREFIX}live1200`, 'Stablecoin quotes variant-1', 1200, 'revx', 'paper']);
    expect(strategyNameParts(r6.name)).toEqual({ head: 'Stablecoin quotes', qual: 'LIVE twin', twoLines: true });
    expect(strategyNameParts(r12.name)).toEqual({ head: 'Stablecoin quotes', qual: 'variant-1', twoLines: true });
    // The fixture drops the switched-off twins (the £300 twin, the weekend twin, 0148's three, and since 0151 pr5, p50 and d).
    const names = quotesTwinRows({ quotesTwins: shownTwins }).map((x) => x.name);
    // Since 0167 (Davies, 2026-10-29): the £120 twin is off, the USDT 2:1 twin hidden, and the visible variants count 1 to 6.
    expect(names).toEqual(['Stablecoin quotes LIVE twin', 'Stablecoin quotes variant-1', 'Stablecoin quotes variant-2', 'Stablecoin quotes variant-3',
      'Stablecoin quotes variant-4', 'Stablecoin quotes variant-5', 'Stablecoin quotes variant-6']);
    expect(twin('live')).toBeUndefined();
    expect(twinFixture.twins.map((t) => t.twin.name)).toContain('Stablecoin quotes USDT 2:1 from 10-28');
    expect(names).not.toContain('Stablecoin quotes USDT 2:1 from 10-28');
    // The same book as the £1,200 twin in the fixture, so the same money; its percents are on its own £600.
    for (const k of ['costUsd', 'valueUsd', 'feesUsd', 'todayUsd', 'unrealisedUsd', 'unrealisedPct', 'realisedUsd', 'openPositions', 'openOrders']) expect(r6[k]).toEqual(r12[k]);
    expect(r6.todayPct).toBeCloseTo(r12.todayPct * 2, 12);
    expect(r6.realisedPct).toBeCloseTo(r12.realisedPct * 2, 12);
  });
  it('is "Stablecoin quotes variant-2" for TAKE\'s twin (take50; variant-3 until 0167, 2026-10-29, which retired the £120 twin that was variant-2), on two lines', () => {
    const r = /** @type {any} */ (quotesTwinRow(t50));
    expect([r.id, r.name, rowMoney(r).capital, r.venueId, r.mode]).toEqual([`${QUOTES_TWIN_ROW_PREFIX}take50`, 'Stablecoin quotes variant-2', 600, 'revx', 'paper']);
    expect(strategyNameParts(r.name)).toEqual({ head: 'Stablecoin quotes', qual: 'variant-2', twoLines: true });
  });
  it('lists the twins in the payload\'s order, opens each on its page, and is absent before its record is loaded', () => {
    const dash = { quotesTwins: [t600, null, t50], quotes: { live: liveFixture.live } };
    expect(quotesTwinRows(dash).map((r) => r.name)).toEqual(['Stablecoin quotes LIVE twin', 'Stablecoin quotes variant-2']);
    // Three of the dashboard's twins in its order; one not loaded yet is no row.
    const three = { quotesTwins: [t600, t1200, t50] };
    expect(quotesTwinRows(three).map((r) => r.name)).toEqual(['Stablecoin quotes LIVE twin', 'Stablecoin quotes variant-1', 'Stablecoin quotes variant-2']);
    expect([quotesTwinOf(`${QUOTES_TWIN_ROW_PREFIX}live1200`, three), quotesPageFor(`${QUOTES_TWIN_ROW_PREFIX}live1200`, three)]).toEqual([t1200, 'twin']);
    expect(quotesTwinOf(`${QUOTES_TWIN_ROW_PREFIX}take50`, dash)).toBe(t50);
    expect(quotesPageFor(`${QUOTES_TWIN_ROW_PREFIX}live600`, dash)).toBe('twin');
    expect(quotesPageFor(QUOTES_LIVE_ROW_ID, dash)).toBe('live');
    expect([quotesTwinOf('__quotes', dash), quotesTwinOf(`${QUOTES_TWIN_ROW_PREFIX}x`, dash), quotesTwinOf(`${QUOTES_TWIN_ROW_PREFIX}pr5`, dash), quotesTwinOf(null, dash)]).toEqual([null, null, null, null]);
    expect([quotesPageFor('__quotes', dash), quotesPageFor('__quotesv', dash), quotesPageFor('__quotesd', dash)]).toEqual([null, null, null]);
    expect([quotesTwinRow(null), quotesTwinRow({ ...t600, twin: undefined }), quotesTwinRows({})]).toEqual([null, null, []]);
  });
  it('says when it has stopped, or is still catching up to the present', () => {
    expect(quotesTwinRow({ ...t600, running: false, lagMinutes: 12 })?.status).toMatchObject({ tone: 'stale', detail: 'its last turn was 12 min ago' });
    const catching = quotesTwinRow({ ...t600, running: false, lagMinutes: 300, twin: { ...t600.twin, mode: 'catch-up', lastTurn: '2026-09-17T18:00:25.000Z' } });
    expect(catching?.status.detail).toMatch(/^catching up: its record stands at \d{1,2} \w{3} \d{2}:\d{2}$/);
  });
  it('says on its page which asks wait for the coin a maker conversion is buying', () => {
    const mask = (/** @type {string} */ s) => s.replace(/\d/g, '•');
    expect(quotesTwinLines(t1200)).toEqual({ waiting: [] });
    expect(quotesTwinLines(t600)).toEqual({ waiting: [] });
    const waiting = { ...t600, twin: { ...t600.twin, converting: [{ book: 'USDT-GBP', ts: '2026-09-17T22:40:00Z', price: 0.7566, base: 594.79, filledBase: 120.5 }] } };
    expect(quotesTwinLines(waiting).waiting).toEqual(['USDT asks wait for their coin: a maker conversion rests at £0.7566, 120.50 of 594.79 filled']);
    expect(quotesTwinLines(waiting, mask).waiting).toEqual(['USDT asks wait for their coin: a maker conversion rests at £•.••••, •••.•• of •••.•• filled']);
  });
});

describe('quoteRungLabel — a rung as the page prints it', () => {
  it('keeps the variant\'s 0.075 % and 0.125 % whole, and the quote test\'s rungs as they were', () => {
    expect([0.0003, 0.0005, 0.00075, 0.001, 0.00125, 0.0015, 0.002, 0.0025, 0.003].map(quoteRungLabel))
      .toEqual(['0.03 %', '0.05 %', '0.075 %', '0.1 %', '0.125 %', '0.15 %', '0.2 %', '0.25 %', '0.3 %']);
    // Two decimals, as the page had it, printed these two as 0.07 % and 0.13 %.
    expect([+(0.00075 * 100).toFixed(2), +(0.00125 * 100).toFixed(2)]).toEqual([0.07, 0.13]);
    expect(quoteLadderRows({ rungs: [{ side: 'bid', k: 0.00075, mode: 'quote', price: 0.7545 }] }).map((r) => r.label)).toEqual(['0.075 %']);
  });
});

describe('fmtUsd4 — one trip\'s P&L on the quote pages, to four places like the price beside it', () => {
  it('prints what the cent hid (Davies, 2026-09-26: a $1.72 round trip that made +$0.0023 read "$0")', () => {
    expect(fmtUsd4(0.0022793346577876495)).toBe('+$0.0023');
    expect(fmtUsd(0.0022793346577876495, true)).toBe('$0');     // what the cell printed before
    expect(fmtUsd4(0.13262071942488218)).toBe('+$0.1326');
    expect(fmtUsd4(-0.00123)).toBe('-$0.0012');
    expect(fmtUsd4(0)).toBe('$0');
    expect(fmtUsd4(-0.00001)).toBe('$0');
    expect(fmtUsd4(null)).toBe('—');
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
    // 10,000 expectations: ~1.5 s alone, past vitest's 5 s default when the gates run the browser sweeps beside it
    // (it timed out there once, 2026-09-28). The work is the same; only the wait is longer.
  }, 30_000);
});

describe('quoteLadderRows — a book as the page draws it', () => {
  const book = { book: 'USDC-GBP', rungs: [
    { side: 'bid', k: 0.002, mode: 'quote', price: 0.7535 },
    { side: 'bid', k: 0.001, mode: 'position', price: 0.755, entry: 0.7542, unrealisedUsd: 0.14, unrealisedGbp: 0.105, heldSince: '2026-09-24T11:40:00.000Z' },
    { side: 'ask', k: 0.001, mode: 'quote', price: 0.7559 },
    { side: 'ask', k: 0.002, mode: 'idle', price: null },
  ] };
  it('one row per distance from interbank, nearest first, with its bid and its ask', () => {
    const rows = quoteLadderRows(book);
    expect(rows.map((r) => r.label)).toEqual(['0.1 %', '0.2 %']);
    // A held rung shows what it paid, not the exit it is quoting; a quoting rung shows its price.
    expect(rows[0].bid).toEqual({ state: 'held', price: 0.7542, unrealisedUsd: 0.14, unrealisedGbp: 0.105, heldSince: '2026-09-24T11:40:00.000Z' });
    expect(rows[0].ask).toMatchObject({ state: 'quoting', price: 0.7559 });
    expect(rows[1].bid).toMatchObject({ state: 'quoting', price: 0.7535 });
    expect(rows[1].ask.state).toBe('idle');
    expect(quoteLadderRows(null)).toEqual([]);
  });
  it('writes a book as a pair and a price as pounds to four places', () => {
    expect(quoteBookLabel('USDT-GBP')).toBe('USDT/GBP');
    expect([fmtQuotePrice(0.75), fmtQuotePrice(null)]).toEqual(['£0.7500', '—']);
    // A EUR book's in euros, USDT-EUR's to its five-place step (Coinbase, 0112).
    expect([fmtQuotePrice(0.8649, 'USDC-EUR'), fmtQuotePrice(0.86493, 'USDT-EUR'), fmtQuotePrice(0.7568, 'USDC-GBP')]).toEqual(['€0.8649', '€0.86493', '£0.7568']);
  });
  it('"Stablecoin quotes with Euros" is the TESTING row right after the last twin, "Stablecoin quotes variant-6" in the fixture, on Coinbase, in pounds, and opens its own page', () => {
    const q = cbFixture.quotesCoinbase;
    const row = quotesCoinbaseRow(q);
    expect(row).toMatchObject({ id: QUOTES_COINBASE_ROW_ID, name: 'Stablecoin quotes with Euros', venue: 'Coinbase', venueId: 'coinbase', mode: 'paper', ccy: 'GBP' });
    // £1,200 + €1,200 at the fixture's £0.875 a euro (Davies, 2026-10-10: "每一档100磅/100欧元").
    expect(row?.gbp).toMatchObject({ capital: 2250, value: q.valueGbp, realised: q.realisedGbp });
    expect(q.capitalGbp).toBe(1200 + 1200 * q.eurGbp);
    expect(row?.status.running).toBe(true);
    const dash = { quotesTwins: shownTwins, quotesCoinbase: q };
    const names = paperTestRows(dash).map((r) => r.name);
    expect(names.indexOf('Stablecoin quotes with Euros')).toBe(shownTwins.length);
    expect(names[names.indexOf('Stablecoin quotes with Euros') - 1]).toBe('Stablecoin quotes variant-6');
    // On two lines, as the variants are: the same run of rows.
    expect(strategyNameParts(String(row?.name))).toEqual({ head: 'Stablecoin quotes', qual: 'with Euros', twoLines: true });
    expect(quotesPageFor(QUOTES_COINBASE_ROW_ID, dash)).toBe('coinbase');
    // VENUES' share bar on TESTING has a Coinbase slice, in its own colour, and the slices add up to the whole (Davies,
    // 2026-10-10: "testing页面venue中最上面的占比条里没有coinbase"). The bar is each venue's share of the tab's deployed
    // value (of its funded capital while nothing is deployed).
    const tests = paperTestRows(dash);
    const venues = venueRows(dash, 'testing', tests);
    const segs = shareSegments(venues);
    expect(venues.map((r) => r.id)).toEqual(['revx', 'coinbase']);
    expect(venues[0].shareOf).toBe('value');
    expect(venues.reduce((a, r) => a + r.share, 0)).toBeCloseTo(1, 12);
    const cbSeg = segs.find((x) => x.id === 'coinbase');
    expect(cbSeg?.pct).toBe(Math.round((q.valueUsd / venues.reduce((a, r) => a + r.valueUsd, 0)) * 100));
    expect(cbSeg?.pct).toBeGreaterThan(0);
    expect(cbSeg?.title).toMatch(/^Coinbase: \d+% of deployed value$/);
    const css = fs.readFileSync(path.join(process.cwd(), 'app/styles.css'), 'utf8');
    for (const id of Object.keys(VENUE_LABELS).filter((v) => v !== 'kraken')) {
      expect([id, /background:\s*(rgba\(|#[0-9a-f]{6}\b)/.test(new RegExp(`\\.ag-share-${id} \\{([^}]*)\\}`).exec(css)?.[1] ?? '')]).toEqual([id, true]);
    }
    expect(quotesPageFor(QUOTES_COINBASE_ROW_ID, { quotesTwins: [] })).toBe(null);
    expect(quotesCoinbaseRow(null)).toBe(null);
  });
  it('"Stablecoin quotes with Euros - 2" (the weekend variant, 0118) is the TESTING row right after "Stablecoin quotes with Euros", on Coinbase, and opens its own page', () => {
    const q = cbFixture.quotesCoinbase, h = cbHoldFixture.quotesCoinbaseHold;
    const row = quotesCoinbaseRow(h);
    // Davies, 2026-10-13: "周末变体写预注册然后上线paper trading 策略with Euros - 2".
    expect(row).toMatchObject({ id: QUOTES_COINBASE_HOLD_ROW_ID, name: 'Stablecoin quotes with Euros - 2', venue: 'Coinbase', venueId: 'coinbase', mode: 'paper', ccy: 'GBP' });
    expect(QUOTES_COINBASE_HOLD_ROW_ID).not.toBe(QUOTES_COINBASE_ROW_ID);
    expect(row?.status.detail).toMatch(/held through a closure/);
    expect(quotesCoinbaseRow(q)?.status.detail).not.toMatch(/closure/);
    // Its world is the base fixture's with a closure in it, held rates constant: the same figures under its own name.
    expect(row?.gbp).toMatchObject({ capital: 2250, value: h.valueGbp, realised: q.realisedGbp });
    const dash = { quotesTwins: shownTwins, quotesCoinbase: q, quotesCoinbaseHold: h };
    const names = paperTestRows(dash).map((r) => r.name);
    const at = names.indexOf('Stablecoin quotes with Euros');
    expect(at).toBe(shownTwins.length);
    expect(names.slice(at, at + 2)).toEqual(['Stablecoin quotes with Euros', 'Stablecoin quotes with Euros - 2']);
    expect(paperTestRows({ ...dash, quotesCoinbaseHold: null }).map((r) => r.name)).not.toContain('Stablecoin quotes with Euros - 2');
    // On two lines, as the variants are.
    expect(strategyNameParts(String(row?.name))).toEqual({ head: 'Stablecoin quotes', qual: 'with Euros - 2', twoLines: true });
    expect(strategyNameParts('Stablecoin quotes with Euros')).toEqual({ head: 'Stablecoin quotes', qual: 'with Euros', twoLines: true });
    expect(quotesPageFor(QUOTES_COINBASE_HOLD_ROW_ID, dash)).toBe('coinbase');
    expect(quotesPageFor(QUOTES_COINBASE_HOLD_ROW_ID, { quotesTwins: [], quotesCoinbase: q })).toBe(null);
    // Coinbase's card adds both rows' capital and deployed value: it is one venue.
    const venues = venueRows(dash, 'testing', paperTestRows(dash));
    const cb = venues.find((r) => r.id === 'coinbase');
    expect(cb?.capitalUsd).toBeCloseTo(q.capitalUsd + h.capitalUsd, 6);
    expect(cb?.valueUsd).toBeCloseTo(q.valueUsd + h.valueUsd, 6);
  });
  it('"Stablecoin quotes with Euros - 2" since 0142 is the USDC arm (cb_usdc.ts), right after the weekend variant, now "- 1"; each opens its own page', () => {
    // Davies, 2026-10-26: "目前的Stablecoin quotes with Euros - 2改为-1，然后-2改为你说的这个新策略在-1（含周末）的基础上做". The dashboard sends the
    // weekend variant under "- 1" (`CB_HOLD_PAGE_NAME`, cb_page.ts) and the USDC arm as `quotesCoinbaseUsdc`, twin id `coinbaseusdc`.
    const q = cbFixture.quotesCoinbase, h0 = cbHoldFixture.quotesCoinbaseHold;
    const h = { ...h0, twin: { ...h0.twin, name: 'Stablecoin quotes with Euros - 1' } };
    const u = { ...h0, capitalGbp: 281.25, twin: { ...h0.twin, id: 'coinbaseusdc', name: 'Stablecoin quotes with Euros - 2' } };
    const row = quotesCoinbaseRow(u);
    expect(row).toMatchObject({ id: QUOTES_COINBASE_USDC_ROW_ID, name: 'Stablecoin quotes with Euros - 2', venueId: 'coinbase', mode: 'paper', ccy: 'GBP' });
    expect(new Set([QUOTES_COINBASE_ROW_ID, QUOTES_COINBASE_HOLD_ROW_ID, QUOTES_COINBASE_USDC_ROW_ID]).size).toBe(3);
    expect(row?.status.detail).toMatch(/the USDC books at 25 a rung, the interbank rates held through a closure/);
    expect(quotesCoinbaseRow(h)?.status.detail).not.toMatch(/USDC/);
    expect(row?.gbp.capital).toBe(281.25);
    const dash = { quotesTwins: shownTwins, quotesCoinbase: q, quotesCoinbaseHold: h, quotesCoinbaseUsdc: u };
    const names = paperTestRows(dash).map((r) => r.name);
    const at = names.indexOf('Stablecoin quotes with Euros');
    expect(names.slice(at, at + 3)).toEqual(['Stablecoin quotes with Euros', 'Stablecoin quotes with Euros - 1', 'Stablecoin quotes with Euros - 2']);
    expect(paperTestRows({ ...dash, quotesCoinbaseUsdc: null }).map((r) => r.name)).not.toContain('Stablecoin quotes with Euros - 2');
    for (const n of ['with Euros - 1', 'with Euros - 2']) expect(strategyNameParts(`Stablecoin quotes ${n}`)).toEqual({ head: 'Stablecoin quotes', qual: n, twoLines: true });
    expect(quotesPageFor(QUOTES_COINBASE_USDC_ROW_ID, dash)).toBe('coinbase');
    expect(quotesPageFor(QUOTES_COINBASE_USDC_ROW_ID, { quotesTwins: [], quotesCoinbase: q, quotesCoinbaseHold: h })).toBe(null);
    // Coinbase's card adds the three rows.
    const cb = venueRows(dash, 'testing', paperTestRows(dash)).find((r) => r.id === 'coinbase');
    expect(cb?.capitalUsd).toBeCloseTo(q.capitalUsd + h.capitalUsd + u.capitalUsd, 6);
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

  // A click on the page's refresh asks the chart anew, as it asks the dashboard anew. Joining answered the click with a
  // request sent before it and asked the server nothing (2026-10-08, the sweep's "chart 25→25"). The request it overtook
  // may answer last, and must not then put its older chart in the cache over the click's.
  it('a click asks a chart anew rather than joining the one on its way, and the newer answer keeps the cache', async () => {
    _reloadAgentsCache();
    /** @type {((v?: unknown) => void)[]} */
    const gates = [];
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      const mine = ++n;
      await new Promise((r) => { gates.push(r); });
      return new Response(JSON.stringify({ symbol: 'BTC/USD', answer: mine }), { status: 200 });
    });
    const before = fetchAgentsChart('s1', 'BTC/USD', /** @type {any} */ (fetchImpl));         // a tab's first draw
    const joined = fetchAgentsChart('s1', 'BTC/USD', /** @type {any} */ (fetchImpl));         // the minute's: joins it
    await settle(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const click = fetchAgentsChart('s1', 'BTC/USD', /** @type {any} */ (fetchImpl), true);    // the refresh button's
    await settle(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    gates[1]();                                     // the click's answer lands first …
    expect((await click).answer).toBe(2);
    gates[0]();                                     // … and the request it overtook after it
    expect((await before).answer).toBe(1);
    expect((await joined).answer).toBe(1);
    expect(readChartCache('s1', 'BTC/USD')?.chart.answer).toBe(2);
  });
});

describe("PR5's live executor on LIVE (Davies, 2026-09-26)", () => {
  // The dashboard's `quotes.live` as quotesLiveSummary shapes it: live and armed, one rung holding, in USD.
  const ql = {
    dryRun: false, armed: true, entryBook: 'live', running: true, lagMinutes: 0, postsToday: { dryRun: 0, live: 7 }, lossStopped: false,
    capitalGbp: 50, x: 1.35, capitalUsd: 67.5, tradedLive: true, openOrders: 1, heldRungs: 1, pending: [], fills: 3,
    realisedUsd: 0.0135, todayUsd: 0.027, unrealisedUsd: 0.0135, costUsd: 4.97475, valueUsd: 4.98825, feesUsd: 0,
    realisedGbp: 0.01, todayGbp: 0.02, unrealisedGbp: 0.01, costGbp: 3.685, valueGbp: 3.695, feesGbp: 0,
  };
  const paperRow = { id: 'trend-4h', venue: 'revx', mode: 'paper', capitalUsd: 100, costUsd: 0, valueUsd: 0, unrealisedUsd: 0, realisedUsd: 1, feesUsd: 0, todayUsd: 0, positions: [] };
  it('is a LIVE row from its first real order, in USD, with its percents on its own bases; dry-run keeps it off', () => {
    const r = quotesLiveRow(ql);
    if (!r) throw new Error('no row');
    expect([r.id, r.name, r.mode, r.venueId, r.capitalUsd, r.openPositions, r.holdsLive, r.armed]).toEqual([QUOTES_LIVE_ROW_ID, 'Stablecoin quotes', 'live', 'revx', 67.5, 1, true, true]);
    expect(r.unrealisedPct).toBeCloseTo(0.0135 / 4.97475 * 100, 9);
    expect(r.realisedPct).toBeCloseTo(0.0135 / 67.5 * 100, 9);
    // Shown in pounds, the book's own (Davies, 2026-10-01), its percents on the same bases.
    const x = rowMoney(r);
    expect([x.ccy, x.capital, x.value, x.today, x.unrealised, x.realised, x.fees]).toEqual(['GBP', 50, 3.695, 0.02, 0.01, 0.01, 0]);
    expect(x.todayPct).toBeCloseTo(0.02 / 50 * 100, 12);
    expect(x.unrealisedPct).toBeCloseTo(0.01 / 3.685 * 100, 12);
    expect(quotesLiveRow({ ...ql, tradedLive: false, entryBook: 'dry_run', dryRun: true })).toBe(null);
    expect(quotesLiveRow(null)).toBe(null);
  });
  it("puts LIVE first and counts it there, in LIVE's totals, with the tab saying what its switch allows", () => {
    const dash = { risk: { global_pause: false, live_confirmed_at: null }, strategies: [paperRow], quotes: { live: ql } };
    expect(defaultAgentsTab(dash)).toBe('live');
    expect(defaultAgentsTab({ ...dash, quotes: { live: { ...ql, tradedLive: false, entryBook: 'dry_run' } } })).toBe('testing');
    const v = agentsTabsView(dash, 2);
    expect([v.live.count, v.live.text, v.live.tone]).toEqual([1, 'Real money · trading', 'armed']);
    expect(agentsTabsView({ ...dash, quotes: { live: { ...ql, armed: false } } }, 2).live.text).toBe('Real money · selling what it holds');
    expect(agentsTabsView({ ...dash, quotes: { live: { ...ql, armed: false, heldRungs: 0 } } }, 2).live.text).toBe('Real money · not trading yet');
    const r = /** @type {any} */ (quotesLiveRow(ql));
    const live = scoreboardView(dash, 'live', [r]);
    expect([live.capitalUsd, live.valueUsd, live.unrealisedOf]).toEqual([67.5, 4.98825, 'cost']);
    expect(live.unrealisedPct).toBeCloseTo(0.0135 / 4.97475 * 100, 9);
    const cards = venueRows(dash, 'live', [r]);
    expect(cards.map((c) => [c.id, c.capitalUsd])).toEqual([['revx', 67.5]]);
  });
  it('raises a live order that needs a person on both tabs, and its loss stop on LIVE', () => {
    const dash = { risk: {}, venues: [], strategies: [], quotes: { live: { ...ql, pending: [{ id: 9, ts: '2026-10-22T11:50:00Z' }], lossStopped: true } } };
    const ids = (tab) => alertsFor(dash, tab).map((a) => a.id);
    expect(ids('live')).toEqual(['pending-quotes-live', 'loss-stop-quotes-live']);
    expect(ids('testing')).toEqual(['pending-quotes-live']);
  });
});

describe("the live quotes' own page (Davies, 2026-10-01: LIVE's row opened the paper test's page)", () => {
  // `quotes.live` as the dashboard serves it for the fixture's book: £1,200 at £100 a rung, GBP/USD 1.32, read 17 Sep
  // 23:00 UTC (00:00 BST): B holds a short of 132 USDC from £0.7591, E a long of 132 USDT from £0.7565.
  const q = /** @type {any} */ (liveFixture.live);
  const mask = (/** @type {string} */ s) => s.replace(/\d/g, '•');
  it("opens from LIVE's row on its own page; the paper test's row is gone from TESTING (Davies, 2026-10-02)", () => {
    const dash = { quotes: { ...liveFixture.live, live: q } };
    expect(quotesPageFor(QUOTES_LIVE_ROW_ID, dash)).toBe('live');
    expect(quotesPageFor('__quotes', dash)).toBe(null);
    // A dry run that has never traded is no LIVE row, so it has no page.
    expect(quotesPageFor(QUOTES_LIVE_ROW_ID, { quotes: { live: { ...q, tradedLive: false, entryBook: 'dry_run' } } })).toBe(null);
    for (const id of ['trend-4h', '__rw', null]) expect(quotesPageFor(id, dash)).toBe(null);
  });
  it('writes a resting order "open", not the venue\'s "new" (Davies, 2026-10-02)', () => {
    expect(['new', 'partially_filled', 'filled', 'rejected', 'cancelled', 'pending', null].map(orderStateText))
      .toEqual(['open', 'partially filled', 'filled', 'rejected', 'cancelled', 'pending', '—']);
  });
  it('writes pounds as the dollars are written, and fees unsigned to four places', () => {
    expect([fmtGbp(1200), fmtGbp(-12), fmtGbp(0.227106, true), fmtGbp(600.696306), fmtGbp(0)]).toEqual(['£1,200', '-£12', '+£0.23', '£600.70', '£0']);
    expect([fmtGbp4(0.0287874), fmtGbp4(-0.168894), fmtGbp4(0), fmtGbp4(null)]).toEqual(['+£0.0288', '-£0.1689', '£0', '—']);
    expect([fmtFeeGbp4(0.0900126), fmtFeeGbp4(0), fmtFeeGbp4(null)]).toEqual(['£0.0900', '£0', '—']);
  });
  it("lays each book out as the paper page's BOOKS: a rung held at its entry, one quoting its order's price, the rest idle", () => {
    const books = quotesLiveBooks(q);
    expect(books.map((b) => [b.book, b.lastPrice, b.fair, b.index, b.trips, b.won])).toEqual([['USDC-GBP', 0.7576, 0.75766, 0.7575, 1, 1], ['USDT-GBP', 0.7572, 0.75727, 0.757, 2, 1]]);
    const [usdc, usdt] = books.map((b) => quoteLadderRows(b));
    expect(usdc.map((r) => [r.label, r.bid.state, r.bid.price, r.ask.state, r.ask.price])).toEqual([
      ['0.1 %', 'quoting', 0.7569, 'quoting', 0.7585],
      ['0.2 %', 'quoting', 0.7561, 'held', 0.7591],                        // B: sold 132 at 0.7591, its exit resting
      ['0.3 %', 'quoting', 0.7553, 'quoting', 0.76],
    ]);
    // What a holding has made, at its book's index price as the coins are valued: B 132 × (0.7591 − 0.7575).
    expect(usdc[1].ask.unrealisedGbp).toBeCloseTo(132 * (0.7591 - 0.7575), 12);
    // USDT's guard withdrew its entries: E holds on the 0.1 % bid, every other rung is idle.
    expect(usdt.map((r) => [r.bid.state, r.ask.state])).toEqual([['held', 'idle'], ['idle', 'idle'], ['idle', 'idle']]);
    expect(usdt[0].bid.unrealisedGbp).toBeCloseTo(132 * (0.757 - 0.7565), 12);
    // The books' realised, in pounds, add up to the LIVE row's.
    expect(books[0].realisedGbp + books[1].realisedGbp).toBeCloseTo(q.realisedGbp, 12);
    expect(quotesLiveBooks({ ...q, detail: null })).toEqual([]);
  });
  it("shows the account's coins as its last turn read them, each at its index price and with its unrealised, which add up to UNREALIZED", () => {
    const inv = quotesLiveInventory(q);
    // Valued at the tickers' index prices, as Revolut X's account page values them: USDC £0.7575, USDT £0.7570.
    expect(inv?.rows.map((a) => [a.asset, a.amount, a.gbp, a.price, a.priceFrom])).toEqual([
      ['GBP', '£600.70', null, null, null], ['USDC', '263.64 USDC', '£199.71', '£0.7575', 'index'], ['USDT', '527.64 USDT', '£399.43', '£0.7570', 'index'],
    ]);
    expect(inv?.rows[0].unrealisedGbp).toBe(null);
    expect(/** @type {number} */ (inv?.rows[1].unrealisedGbp) + /** @type {number} */ (inv?.rows[2].unrealisedGbp)).toBeCloseTo(q.unrealisedGbp, 12);
    expect(quotesLiveInventory(q, mask)?.rows[1]).toMatchObject({ asset: 'USDC', amount: '•••.•• USDC', gbp: '£•••.••', price: '£•.••••' });
    expect(quotesLiveInventory({ ...q, detail: { ...q.detail, inventory: { at: null, assets: null } } })).toBe(null);
  });
  it("puts the LIVE row's own figures on its page's scoreboard", () => {
    const r = /** @type {any} */ (quotesLiveRow(q));
    expect([r.capitalUsd, r.openPositions, r.openOrders]).toEqual([1584, 2, 7]);
    expect([r.todayUsd, r.unrealisedUsd, r.realisedUsd, r.feesUsd, r.valueUsd]).toEqual([q.todayUsd, q.unrealisedUsd, q.realisedUsd, q.feesUsd, q.valueUsd]);
    expect(r.todayUsd).toBeCloseTo((0.1056 + 0.198 - 0.168894 + 0.0924) * 1.32, 12);
    // …and in pounds, what the page shows: TODAY is what the executor's loss stop reads; the fees are the stop's and D's
    // share of the USDT conversion's fee (it sold 132 of the 395.6436 coins that conversion bought).
    const x = rowMoney(r);
    expect([x.ccy, x.capital]).toEqual(['GBP', 1200]);
    expect(x.today).toBeCloseTo(0.1056 + 0.198 - 0.168894 + 0.0924, 12);
    expect(x.fees).toBeCloseTo(0.089694 + 132 * 0.2697948 / 395.6436, 12);
  });
});

describe('how long a strategy has been under test (Davies, 2026-09-28)', () => {
  const now = Date.parse('2026-09-28T02:00:00Z');
  it('is whole hours, then days and hours, and stops where the test ended', () => {
    expect(testedForText('2026-09-28T01:30:00Z', now)).toBe('under 1h');
    expect(testedForText('2026-09-28T01:00:00Z', now)).toBe('1h');
    expect(testedForText('2026-09-27T02:00:01Z', now)).toBe('23h');           // a second short of a day is 23 hours
    expect(testedForText('2026-09-27T02:00:00Z', now)).toBe('1d 0h');
    expect(testedForText('2026-09-20T18:23:35.656Z', now)).toBe('7d 7h');     // the paper rows' creation
    expect(testedForText('2026-09-24T22:51:15.132Z', now)).toBe('3d 3h');     // the live row's
    expect(testedForText('2026-09-25T00:00:00Z', now, '2026-09-26T12:00:00Z')).toBe('1d 12h');   // a finished test
  });
  it('says nothing when the start is unknown or still to come', () => {
    expect(testedForText(null, now)).toBe(null);
    expect(testedForText('not a date', now)).toBe(null);
    expect(testedForText('2026-10-09T00:00:00Z', now)).toBe(null);
  });
  it("writes a round trip's size in coins of its book", () => {
    expect(fmtQuoteQty(99.3012, 'USDC-GBP')).toBe('99.30 USDC');
    expect(fmtQuoteQty('132.6', 'USDT/GBP')).toBe('132.60 USDT');
    expect(fmtQuoteQty(null, 'USDC-GBP')).toBe('—');
  });
});

describe('lpLiveRow (live-prep\'s real money, "Reward quotes" on LIVE, 2026-10-09)', () => {
  const l = /** @type {any} */ (lpLiveFixture.output);
  const paperRow = { id: 'trend-4h', venue: 'revx', mode: 'paper', capitalUsd: 100, costUsd: 0, valueUsd: 0, unrealisedUsd: 0, realisedUsd: 1, feesUsd: 0, todayUsd: 0, positions: [] };
  it('is a LIVE row on Polymarket named "Reward quotes", its figures the live book\'s on their own bases', () => {
    const r = /** @type {any} */ (lpLiveRow(l));
    expect([r.id, r.name, r.mode, r.venueId, r.venue, r.capitalUsd, r.valueUsd, r.costUsd, r.feesUsd, r.openPositions, r.openOrders, r.holdsLive, r.armed])
      .toEqual([LP_LIVE_ROW_ID, 'Reward quotes', 'live', 'polymarket', 'Polymarket', 320, 35.2, 5.8, 0, 3, 5, true, true]);
    expect([r.todayUsd, r.unrealisedUsd, r.realisedUsd]).toEqual([0.8, 0.2, 2.85]);
    expect(r.todayPct).toBeCloseTo(0.8 / 320 * 100, 12);
    expect(r.unrealisedPct).toBeCloseTo(0.2 / 5.8 * 100, 12);
    expect(r.realisedPct).toBeCloseTo(2.85 / 320 * 100, 12);
    // Realised splits into what Polymarket paid (rewards and rebates) and what its orders closed, to the cent.
    expect([r.rewards.realisedUsd, r.orders.realisedUsd, r.orders.unrealisedUsd]).toEqual([2.25, 0.6, 0.2]);
    expect(r.status).toEqual({ label: 'live', running: true, tone: 'running', detail: 'quoting real money in 3 markets' });
    // In dollars, the row's own currency.
    expect(rowMoney(r).ccy).toBe('USD');
    // Not TESTING's "Reward quotes" (RW's) nor live-prep's paper row: an id of its own, so no two rows share a page.
    expect(new Set([r.id, '__rw', '__lp']).size).toBe(3);
  });
  it('is no row until armed or traded; a stale, stopped or disarmed book says so', () => {
    expect(lpLiveRow(null)).toBe(null);
    // FUNDED is the money put in, booked or as read (Addendum 10); percents are on it; unknown, a dash, never the cap.
    const funded = /** @type {any} */ (lpLiveRow({ ...l, fundedUsd: 400, realisedUsd: 4 }));
    expect([funded.capitalUsd, funded.realisedPct]).toEqual([400, 1]);
    const unknown = /** @type {any} */ (lpLiveRow({ ...l, fundedUsd: null }));
    expect([unknown.capitalUsd, unknown.fundedKnown, funded.fundedKnown]).toEqual([0, false, true]);
    expect(lpLiveRow({ ...l, armed: false, tradedLive: false })).toBe(null);
    expect(lpLiveRow({ ...l, armed: true, tradedLive: false })?.id).toBe(LP_LIVE_ROW_ID);
    expect(lpLiveRow({ ...l, running: false, lagMinutes: 9 })?.status).toEqual({ label: 'live', running: false, tone: 'stale', detail: 'its last turn was 9 min ago' });
    expect(lpLiveRow({ ...l, stop: { ...l.stop, trippedAt: '2026-09-17T20:00:00.000Z' } })?.status.detail).toBe('its total loss stop has tripped: it only sells what it holds');
    expect(lpLiveRow({ ...l, armed: false })?.status.detail).toBe('disarmed · its sells of what it holds still run');
  });
  it('disarmed, it is off LIVE: no row, nothing in its totals or its Polymarket card, the analyst\'s $100 counted once', () => {
    // Davies, 2026-10-17 ("你的其他问题都按你推荐的来"): liquidated and disarmed by 0125, its funded is the account the analyst's
    // $100 comes from. As production reads: traded live, not armed, beside the analyst before its go.
    const off = { ...l, armed: false, tradedLive: true };
    const g = /** @type {any} */ (grokPmFixture.waiting);
    const dash = { risk: { global_pause: false, live_confirmed_at: null }, strategies: [], lpLive: off, grokPm: g };
    // The row itself still exists for its page; LIVE's list leaves it out.
    expect(lpLiveRow(off)?.id).toBe(LP_LIVE_ROW_ID);
    expect(liveExtraRows(dash).map((x) => x.id)).toEqual([GROKPM_ROW_ID]);
    const rows = liveExtraRows(dash);
    const live = scoreboardView(dash, 'live', rows);
    expect([live.capitalUsd, live.valueUsd, live.costUsd, live.todayUsd, live.unrealisedUsd, live.realisedUsd]).toEqual([100, 0, 0, 0, 0, 0]);
    const cards = venueRows(dash, 'live', rows);
    expect(cards.map((c) => [c.id, c.capitalUsd, c.live])).toEqual([['polymarket', 100, 1]]);
    // Without the analyst nothing is live, and the page opens on TESTING.
    expect(liveExtraRows({ ...dash, grokPm: null })).toEqual([]);
    expect(defaultAgentsTab({ ...dash, grokPm: null })).toBe('testing');
    // Armed again, it is LIVE's row again.
    expect(liveExtraRows({ ...dash, lpLive: { ...off, armed: true } }).map((x) => x.id)).toEqual([LP_LIVE_ROW_ID, GROKPM_ROW_ID]);
  });
  it("opens the page on LIVE, counts once on LIVE's bar, scoreboard and Polymarket card, and never on TESTING's", () => {
    const dash = { risk: { global_pause: false, live_confirmed_at: null }, strategies: [paperRow], prepLp: lpFixture.output, lpLive: l };
    expect(defaultAgentsTab(dash)).toBe('live');
    expect(defaultAgentsTab({ ...dash, lpLive: null })).toBe('testing');
    const r = /** @type {any} */ (lpLiveRow(l));
    expect(liveExtraRows(dash).map((x) => x.id)).toEqual([LP_LIVE_ROW_ID]);
    const v = agentsTabsView(dash, 1);
    expect([v.live.count, v.live.text, v.live.tone]).toEqual([1, 'Real money · trading', 'armed']);
    // With PR5's live executor too: both, PR5's first.
    const both = { ...dash, quotes: { live: { tradedLive: true, armed: false, heldRungs: 0, capitalUsd: 10 } } };
    expect(liveExtraRows(both).map((x) => x.id)).toEqual([QUOTES_LIVE_ROW_ID, LP_LIVE_ROW_ID]);
    expect([agentsTabsView(both, 1).live.count, agentsTabsView(both, 1).live.tone]).toEqual([2, 'armed']);
    const live = scoreboardView(dash, 'live', [r]);
    expect([live.capitalUsd, live.valueUsd, live.costUsd, live.todayUsd, live.unrealisedUsd, live.realisedUsd, live.feesUsd]).toEqual([320, 35.2, 5.8, 0.8, 0.2, 2.85, 0]);
    expect(live.unrealisedPct).toBeCloseTo(0.2 / 5.8 * 100, 12);
    // Its Polymarket card on LIVE: real money, so not "(Paper)", its cost and fees its own, rewards and orders under realised.
    const [card] = venueRows(dash, 'live', [r]);
    expect([card.id, card.paper, card.live, card.capitalUsd, card.valueUsd, card.costUsd, card.feesUsd, card.realisedUsd, card.todayUsd])
      .toEqual(['polymarket', false, 1, 320, 35.2, 5.8, 0, 2.85, 0.8]);
    expect([card.test.rewards.realisedUsd, card.test.orders.realisedUsd]).toEqual([2.25, 0.6]);
    // TESTING has no row of its paper layer since 2026-10-10: the strategy's row alone, nothing of live-prep's.
    const tests = paperTestRows(dash);
    expect(tests).toEqual([]);
    const testing = scoreboardView(dash, 'testing', tests);
    expect(testing.capitalUsd).toBe(100);
    expect(venueRows(dash, 'testing', tests).find((c) => c.id === 'polymarket')).toBe(undefined);
  });
  it("LIVE's QUOTES has Rewards (est.) and Total (est.): what was paid plus the unread days at each market's point R, adding up to the cent", () => {
    const q = /** @type {any[]} */ (lpLiveFixture.output.quotes);
    expect(q.map((x) => [x.q, x.rewardEstUsd, x.fillsPnlUsd, x.totalEstUsd])).toEqual([
      ['Will G happen?', 1.327491, 0.6, 1.927491], ['Will H happen?', 1.3288, 0.1, 1.4288], ['Will J happen?', 0, 0.1, 0.1]]);
    for (const x of q) {
      const s = splitCents(x.totalEstUsd, [x.rewardEstUsd, x.fillsPnlUsd]);
      expect(Math.round((s.parts[0] + s.parts[1]) * 100)).toBe(Math.round(s.total * 100));
    }
    // No average cost any more.
    expect(q.some((x) => 'yesCost' in x || 'noCost' in x)).toBe(false);
  });
  it("LIVE's QUOTES lists only the markets with an order resting or a token held", () => {
    const q = lpLiveFixture.output.quotes;
    expect(lpLiveQuoteRows(q).map((/** @type {any} */ x) => x.q)).toEqual(['Will G happen?', 'Will H happen?', 'Will J happen?']);
    // A chosen market resting nothing and holding nothing goes; one resting on one side only, or only holding, stays.
    const rows = [
      { q: 'quiet', bid: null, ask: null, yes: 0, no: 0 }, { q: 'bid', bid: 0.4, ask: null, yes: 0, no: 0 },
      { q: 'held', bid: null, ask: null, yes: 0, no: 20 }, { q: 'ask', bid: null, ask: 0.6, yes: 0, no: 0 },
    ];
    expect(lpLiveQuoteRows(rows).map((x) => x.q)).toEqual(['bid', 'held', 'ask']);
    expect(lpLiveQuoteRows(undefined)).toEqual([]);
  });
  it("DAYS reads each day's Orders beside its rewards: the fills marked to market, adding up to the scoreboard's orders; a day not yet read has its Orders alone", () => {
    // The fixture (pm_lp_live_view.test.ts works it by hand): 17 Sep, today and not yet read, +0.30; 16 Sep, read, +0.50
    // beside its $5.50 of whole formula, $2.20 paid (R 0.40 over it: LP-OBS-DEEP, 2026-10-11, the STATUS tile's basis; 0.44
    // over the $5 of scored formula, which DAYS no longer shows) and $0.05 of rebates.
    const id = (/** @type {string} */ x) => x;
    const rows = l.days.map((/** @type {any} */ d) => [d.day, d.today, lpLiveDayCells(d, id)]);
    expect(rows).toEqual([
      ['2026-09-17', true, { markets: '—', orders: '+$0.30', ordersUsd: 0.3, formula: '—', paid: '—', paidUsd: null, r: '—', rebates: '—' }],
      ['2026-09-16', false, { markets: '2', orders: '+$0.50', ordersUsd: 0.5, formula: '$5.50', paid: '+$2.20', paidUsd: 2.2, r: '0.40', rebates: '$0.05' }],
    ]);
    // The days' Orders are the orders' part of REALIZED G/L plus UNREALIZED G/L, to the cent.
    const r = /** @type {any} */ (lpLiveRow(l));
    expect(Math.round(l.days.reduce((/** @type {number} */ s, /** @type {any} */ d) => s + d.ordersUsd, 0) * 100)).toBe(Math.round((r.orders.realisedUsd + r.orders.unrealisedUsd) * 100));
    // Before any payout, every day is unread: Orders alone.
    expect(lpLiveFixture.noPayout.days.map((/** @type {any} */ d) => lpLiveDayCells(d, id).orders + ' ' + lpLiveDayCells(d, id).paid)).toEqual(['+$0.30 —', '+$0.50 —']);
    // Hidden values: every dollar through the mask; the markets count and R are not dollars.
    const mask = (/** @type {string} */ x) => x.replace(/[\d.,]/g, '•');
    const h = lpLiveDayCells(l.days[1], mask);
    expect([h.markets, h.orders, h.formula, h.paid, h.r, h.rebates]).toEqual(['2', '+$••••', '$••••', '+$••••', '0.40', '$••••']);
    expect(lpLiveDayCells({ day: '2026-09-18', read: false, ordersUsd: -32.544741 }, id).orders).toBe('-$32.54');
  });
  it("the total stop's room under the scoreboard (Addendum 18): the stop judges the page's TOTAL, every dollar masked; none once tripped", () => {
    // The fixture: TOTAL +3.05 (fills +0.80, paid +2.20, rebates +0.05, fees 0), 78.05 from −75.
    const id = (/** @type {string} */ x) => x;
    expect(lpStopRoomText(l, id)).toBe('total stop at -$75: $78.05 of room (total +$3.05)');
    expect(l.stop.basisUsd).toBe(l.totalUsd);
    expect(lpStopRoomText(l, (/** @type {string} */ x) => x.replace(/[\d.,]/g, '•'))).toBe('total stop at -$••: $••••• of room (total +$••••)');
    expect(lpStopRoomText({ ...l, stop: { ...l.stop, trippedAt: '2026-09-17T20:00:00.000Z' } }, id)).toBe(null);
    expect(lpStopRoomText({ ...l, stop: undefined }, id)).toBe(null);
  });
  it("the restarted stop's room (Addendum 19): from the restart's minute, at its $25, its figure what the book made since then", () => {
    const id = (/** @type {string} */ x) => x;
    const stop = { limitUsd: 25, basisUsd: -3.5, roomUsd: 21.5, trippedAt: null, since: '2026-10-13T02:31:00.000Z' };
    expect(lpStopRoomText({ ...l, stop }, id)).toBe('total stop at -$25 since 10-13 02:31 UTC: $21.50 of room (since then -$3.50)');
    // The time is not a dollar: the mask leaves it.
    expect(lpStopRoomText({ ...l, stop }, (/** @type {string} */ x) => x.replace(/[\d.,]/g, '•'))).toBe('total stop at -$•• since 10-13 02:31 UTC: $••••• of room (since then -$••••)');
    expect(lpStopRoomText({ ...l, stop: { ...stop, trippedAt: '2026-10-13T05:00:00.000Z' } }, id)).toBe(null);
  });
  it("prints R to two places, a dash without a formula figure", () => {
    expect([fmtR(0.44), fmtR(null), fmtR(1)]).toEqual(['0.44', '—', '1.00']);
  });
  it("its STATUS: R (PAID ÷ FORMULA), QUOTING TODAY, POSITIONS STILL HELD, then today's rewards estimated, where TOP SHARE was; TESTING's keeps TOP SHARE", () => {
    expect(rwBarTileKeys('run', true)).toEqual(['R (PAID ÷ FORMULA)', 'QUOTING TODAY', 'POSITIONS STILL HELD', 'REWARDS TODAY (EST.)']);
    expect(rwBarTileKeys('run')).toEqual(['WORST CASE', 'TOP SHARE', 'QUOTING TODAY', 'POSITIONS STILL HELD']);
    // The fixture's estimate (pm_lp_live_view.test.ts works it by hand): so far 0.181699 to 0.908493, the day 0 to
    // 1.393023, R 0.198919 to 0.994594 on one day read; before any payout, the prior's 0.2 to 1.
    const s = lpLiveStatus(l);
    // One R, labelled (LP-OBS-DEEP, 2026-10-11): the tile is 2.20 over the whole formula's 5.50, 0.40; under it 2.20 over the
    // scored 5.00, 0.44, and the prior-weighted point the estimate uses, exp((2 × −0.804719 + ln 0.44) / 3) = 0.444796.
    expect([s.phase, s.rText, s.quoting, s.open, 'bestShareText' in s]).toEqual(['run', '0.40', 3, 2, false]);
    expect(s.rNotes).toEqual([]);  // nothing under the tile (Davies, 2026-10-11)
    expect(s.est).toEqual({ lowUsd: 0.181699, highUsd: 0.908493, dayLowUsd: 0, dayHighUsd: 1.393023, rBand: '0.20–0.99', rDays: 1 });
    const id = (/** @type {string} */ x) => x;
    expect(lpEstimateTexts(s.est, id)).toEqual({ text: '$0.18 – $0.91', color: 'var(--gain)' });
    const np = lpLiveStatus(lpLiveFixture.noPayout);
    expect([np.rText, lpEstimateTexts(np.est, id)]).toEqual(['—', { text: '$0.18 – $0.90', color: 'var(--gain)' }]);
    // Before a payout: a dash, and nothing under it.
    expect(np.rNotes).toEqual([]);
    // A payload from before the whole basis (no `rWhole`) shows a dash, never the scored R under the new label.
    expect(lpLiveStatus({ ...l, rWhole: undefined }).rText).toBe('—');
    // Hidden values: every dollar goes through the mask.
    const mask = (/** @type {string} */ x) => x.replace(/[\d.,]/g, '•');
    expect(lpEstimateTexts(s.est, mask)).toEqual({ text: '$•••• – $••••', color: 'var(--gain)' });
    expect(lpEstimateTexts(null, id)).toEqual({ text: '—', color: null });
    expect(lpLiveStatus({ ...l, estimate: undefined }).est).toBe(null);
  });
});

describe("the Stablecoin quotes pages' DAYS heading: the seven calendar days before today, a year of them", () => {
  const NOW = Date.parse('2026-10-09T15:00:00Z');
  it('sums the seven days before today by the calendar, a missing day earning nothing, and annualises over the capital', () => {
    // Rows for 10-09 (today, left out), 10-08 … 10-02 but the weekend 10-04/10-05 (no orders, no rows), and 10-01 (8 days
    // back, left out). By hand: 0.05 + 0.04 + 0.03 + 0.02 + 0.01 = 0.15 over £120, 365 / 7: 6.5178… %.
    const days = [['2026-10-09', 5], ['2026-10-08', 0.05], ['2026-10-07', 0.04], ['2026-10-06', 0.03], ['2026-10-03', 0.02], ['2026-10-02', 0.01], ['2026-10-01', 9]]
      .map(([day, realisedGbp]) => ({ day: String(day), realisedGbp: Number(realisedGbp) }));
    expect(quoteDaysAnnualPct(days, 120, NOW)).toBeCloseTo((0.15 / 120) * (365 / 7) * 100, 10);
    // Seven rows would have reached back to 10-01 across the weekend: that is the overstatement this rules out.
    expect(quoteDaysAnnualPct(days, 120, NOW)).not.toBeCloseTo(((0.15 + 9) / 120) * (365 / 7) * 100, 2);
  });
  it('reads a row younger than a week over the days since its first, and nothing without a closed day or a capital', () => {
    const young = [{ day: '2026-10-09', realisedGbp: 1 }, { day: '2026-10-07', realisedGbp: 0.03 }];
    // First row 10-07: two closed days (10-07, 10-08). 0.03 over £600, 365 / 2.
    expect(quoteDaysAnnualPct(young, 600, NOW)).toBeCloseTo((0.03 / 600) * (365 / 2) * 100, 10);
    expect([quoteDaysAnnualPct([{ day: '2026-10-09', realisedGbp: 1 }], 120, NOW), quoteDaysAnnualPct(young, 0, NOW), quoteDaysAnnualPct([], 120, NOW)]).toEqual([null, null, null]);
  });
  it('says what it measures: realised round trips, simple-annualised, the coins not marked (2026-10-26)', () => {
    // LIVE's DAYS read "7-day annualised +64.9%" on 2026-10-26: £1.4938 realised over 10-19 → 10-25 on £120, 365 / 7, the
    // first live weekend half of it, while the account marked to market had made 54.6 % a year and 15.5 % since its go.
    // The heading now names the figure, and its tooltip says what is left out.
    expect(QUOTE_DAYS_ANNUAL_LABEL).toBe('7-day realised, annualised');
    for (const w of ['realised', 'over the capital', '365 / 7', 'simple', 'not marked', 'UNREALIZED G/L', 'short sample']) expect(QUOTE_DAYS_ANNUAL_TITLE).toContain(w);
    const week = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']
      .map((day, i) => ({ day, realisedGbp: [0.1959, 0.0458, 0.0773, 0.1107, 0.5308, 0.5183, 0.0151][i] }));
    expect(quoteDaysAnnualPct([{ day: '2026-10-26', realisedGbp: 0 }, ...week], 120, Date.parse('2026-10-26T00:59:00Z'))).toBeCloseTo(64.91, 2);
  });
  it('reads each day over the capital it ran on, so a week at £120 is not divided by £600 (Davies, 2026-10-27: LIVE £120 → £600)', () => {
    const at = Date.parse('2026-10-26T00:59:00Z');
    const week = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']
      .map((day, i) => ({ day, realisedGbp: [0.1959, 0.0458, 0.0773, 0.1107, 0.5308, 0.5183, 0.0151][i], capitalGbp: 120 }));
    // The row's capital is £600 now; each day still carries its £120: the figure is the week's, 64.91 %, not a fifth of it.
    expect(quoteDaysAnnualPct(week, 600, at)).toBeCloseTo(64.91, 2);
    expect(quoteDaysAnnualPct(week.map(({ capitalGbp: _c, ...d }) => d), 600, at)).toBeCloseTo(64.91 / 5, 2);
    // A mixed week: the last three days at £600 each earn their own share. By hand: (0.1959 + 0.0458 + 0.0773 + 0.1107) / 120
    // + (0.5308 + 0.5183 + 0.0151) / 600, times 365 / 7.
    const mixed = week.map((d, i) => ({ ...d, capitalGbp: i < 4 ? 120 : 600 }));
    const want = ((0.1959 + 0.0458 + 0.0773 + 0.1107) / 120 + (0.5308 + 0.5183 + 0.0151) / 600) * (365 / 7) * 100;
    expect(quoteDaysAnnualPct(mixed, 600, at)).toBeCloseTo(want, 10);
    // A day with no capital of its own (a twin's) falls back to the row's; a constant capital gives the old figure exactly.
    expect(quoteDaysAnnualPct(week.map((d) => ({ ...d, capitalGbp: null })), 120, at)).toBeCloseTo(64.91, 2);
  });
});

describe('grokPmRow and its page (GROKPM, "Polymarket analyst" on LIVE, 2026-10-15; renamed and its journal redone 2026-10-17)', () => {
  const g = /** @type {any} */ (grokPmFixture.output);
  const w = /** @type {any} */ (grokPmFixture.waiting);
  const mask = (/** @type {string} */ t) => t.replace(/\d/g, '•');
  it('is a LIVE row on Polymarket, its money the record\'s: funded $100, deployed its cost, the percents on their bases', () => {
    const r = /** @type {any} */ (grokPmRow(g));
    expect([r.id, r.name, r.mode, r.venueId, r.capitalUsd, r.valueUsd, r.costUsd, r.feesUsd, r.openPositions, r.holdsLive, r.armed])
      .toEqual([GROKPM_ROW_ID, GROKPM_ROW_NAME, 'live', 'polymarket', 100, 30, 30, 0, 2, true, true]);
    // Davies, 2026-10-17: "“Polymarket analyst (Grok)”策略改为“Polymarket analyst“".
    expect(GROKPM_ROW_NAME).toBe('Polymarket analyst');
    // By hand (grokpm_view.test.ts): today +0.70, unrealised +0.20 on a cost of 30, realised +2.10.
    expect([r.todayUsd, r.unrealisedUsd, r.realisedUsd]).toEqual([0.7, 0.2, 2.1]);
    expect(r.todayPct).toBeCloseTo(0.7, 12);
    expect(r.unrealisedPct).toBeCloseTo(0.2 / 30 * 100, 12);
    expect(r.realisedPct).toBeCloseTo(2.1, 12);
    expect(r.status).toEqual({ label: 'live', running: true, tone: 'running', detail: 'an outside agent trading real money · 2 positions open' });
    expect(rowMoney(r).ccy).toBe('USD');
  });
  it('before the go it is funded $100 on LIVE, counts nothing yet, and says it is a dry-run; no account, no row', () => {
    const r = /** @type {any} */ (grokPmRow(w));
    // Davies, 2026-10-17: "明确目前funded就是100美元": its budget from now (it was $0 until the go).
    expect([r.capitalUsd, r.fundedKnown, r.costUsd, r.valueUsd, r.armed]).toEqual([100, true, 0, 0, false]);
    expect([r.todayUsd, r.unrealisedUsd, r.realisedUsd, r.todayPct, r.unrealisedPct, r.realisedPct]).toEqual([0, 0, 0, 0, null, 0]);
    expect(r.status).toEqual({ label: 'dry-run', running: false, tone: 'stale', detail: 'dry-run: its orders are checked and journalled, none is sent' });
    // The budget is the configured one, whatever the record says it has seen.
    expect(grokPmRow({ ...w, configuredFundedUsd: 150 })?.capitalUsd).toBe(150);
    expect(grokPmRow({ ...w, configuredFundedUsd: null, fundedUsd: null })?.capitalUsd).toBe(0);
    expect(grokPmRow({ ...w, mode: 'live' })?.status.detail).toBe('armed: its record has not read its first trade yet');
    expect(grokPmRow(null)).toBe(null);
    expect(grokPmStopText(w, (x) => x)).toBe(null);
    expect(grokPmRow({ ...g, stop: { ...g.stop, totalTripped: true } })?.status.detail).toBe('its total stop is reached: by its rules it may only close');
    expect(grokPmRow({ ...g, running: false, lagMinutes: 22 })?.status.detail).toBe('its record last read the account 22 min ago');
  });
  it('adds once to LIVE beside live-prep, on one Polymarket card, and never to TESTING', () => {
    const dash = { risk: { global_pause: false, live_confirmed_at: null }, strategies: [], lpLive: lpLiveFixture.output, grokPm: g };
    expect(liveExtraRows(dash).map((x) => x.id)).toEqual([LP_LIVE_ROW_ID, GROKPM_ROW_ID]);
    expect(defaultAgentsTab({ ...dash, lpLive: null })).toBe('live');
    const rows = liveExtraRows(dash);
    const live = scoreboardView(dash, 'live', rows);
    expect(live.capitalUsd).toBeCloseTo(320 + 100, 12);
    expect(live.realisedUsd).toBeCloseTo(2.85 + 2.1, 12);
    const cards = venueRows(dash, 'live', rows);
    expect(cards.map((c) => c.id)).toEqual(['polymarket']);
    expect([cards[0].live, cards[0].tests]).toEqual([2, 2]);
    expect(cards[0].todayUsd).toBeCloseTo(0.8 + 0.7, 12);
    expect(paperTestRows(dash).some((t) => t.id === GROKPM_ROW_ID)).toBe(false);
  });
  it("before the go its $100 is in LIVE's FUNDED and on the Polymarket card, and every percent stays on that base", () => {
    const dash = { risk: { global_pause: false, live_confirmed_at: null }, strategies: [], lpLive: lpLiveFixture.output, grokPm: w };
    const rows = liveExtraRows(dash);
    const live = scoreboardView(dash, 'live', rows), alone = scoreboardView({ ...dash, grokPm: null }, 'live', liveExtraRows({ ...dash, grokPm: null }));
    expect(live.capitalUsd - alone.capitalUsd).toBeCloseTo(100, 12);
    // It adds no money made, held or deployed: only the base the percents are on.
    expect([live.todayUsd, live.realisedUsd, live.unrealisedUsd, live.valueUsd, live.costUsd]).toEqual([alone.todayUsd, alone.realisedUsd, alone.unrealisedUsd, alone.valueUsd, alone.costUsd]);
    expect(live.todayPct).toBeCloseTo(alone.todayUsd / (alone.capitalUsd + 100) * 100, 12);
    expect(live.realisedPct).toBeCloseTo(alone.realisedUsd / (alone.capitalUsd + 100) * 100, 12);
    expect(live.unrealisedPct).toBeCloseTo(/** @type {number} */ (alone.unrealisedPct), 12);
    const card = venueRows(dash, 'live', rows)[0];
    expect([card.id, card.capitalUsd]).toEqual(['polymarket', alone.capitalUsd + 100]);
    expect(Number.isFinite(card.todayPct)).toBe(true);
  });
  it("its page's scoreboard is the stablecoin quotes' live page's: FUNDED, DEPLOYED, TODAY, UNREALIZED, REALIZED (incl. fees), from its row", () => {
    // Davies, 2026-10-17: "这个策略的页面score board请做的和stablecoin quote的live策略子页面的一样". Both pages read `rowMoney` of their
    // own LIST row, so the list and the page show one set of figures; no VALUE or TOTAL cell (the PR5 page has none).
    expect(rowMoney(grokPmRow(g))).toEqual({
      ccy: 'USD', capital: 100, value: 30, today: 0.7, todayPct: grokPmRow(g)?.todayPct, unrealised: 0.2, unrealisedPct: grokPmRow(g)?.unrealisedPct,
      realised: 2.1, realisedPct: grokPmRow(g)?.realisedPct, fees: 0,
    });
    // Its fees are its own fills' (inside realised): what the page's "(incl. fees …)" shows. Before the go, none.
    expect([grokPmRow({ ...g, feesUsd: 0.15 })?.feesUsd, grokPmRow(w)?.feesUsd, grokPmRow({ ...g, feesUsd: undefined })?.feesUsd]).toEqual([0.15, 0, 0]);
    // The page's scoreboard JSX is the PR5 page's: FundedCells, then TODAY, UNREALIZED G/L, REALIZED G/L with its fees aside.
    const jsx = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'agents.jsx'), 'utf8');
    const board = (/** @type {string} */ fn) => {
      const body = jsx.slice(jsx.indexOf(`function ${fn}(`));
      const sb = body.slice(body.indexOf('<div className="ag-scoreboard ag-scoreboard-sm">'));
      return sb.slice(0, sb.indexOf('\n      </div>\n')).split('\n').map((l) => (/<(\w+)(?:[^>]*?(?:label="([^"]+)"|className="([^"]+)"))?/.exec(l) ?? []).slice(1).filter(Boolean).join(' ')).filter(Boolean);
    };
    expect(board('GrokPmDetail')).toEqual(['div ag-scoreboard ag-scoreboard-sm', 'FundedCells', 'div ag-sb-divider', 'GlCell TODAY', 'div ag-sb-divider', 'GlCell UNREALIZED G/L', 'div ag-sb-divider', 'GlCell REALIZED G/L']);
    expect(board('GrokPmDetail')).toEqual(board('QuotesLiveDetail'));
    expect(/function GrokPmDetail[\s\S]*?label="REALIZED G\/L"[^\n]*aside=\{`\(incl\. fees /.test(jsx)).toBe(true);
  });
  it("its page's head says DRY-RUN while the list's light is amber, LIVE once armed", () => {
    // Davies, 2026-10-17: "agent页策略列表里显示的黄灯怎么子页面点开现实的是live的tag".
    expect([grokPmModeTag(w), grokPmRow(w)?.status.tone]).toEqual(['dry-run', 'stale']);
    expect([grokPmModeTag(g), grokPmRow(g)?.status.tone]).toEqual(['live', 'running']);
    expect(grokPmModeTag({ ...w, mode: 'live' })).toBe('live');
    expect(grokPmModeTag(null)).toBe('dry-run');
  });
  it('its STATUS tiles, stop room and mismatch line, every dollar through the mask and no probability masked', () => {
    expect(grokPmTiles(g, (x) => x)).toEqual([
      { k: 'OPEN POSITIONS', v: '2' }, { k: 'CASH', v: '$69.10' }, { k: 'BRIER YOU / MARKET', v: '0.106 / 0.084' }, { k: 'RESOLVED', v: '2' },
    ]);
    expect(grokPmTiles(g, mask)[1].v).toBe('$••.••');
    expect(grokPmTiles(w, (x) => x)[2]).toEqual({ k: 'BRIER YOU / MARKET', v: '—' });
    expect(grokPmStopText(g, (x) => x)).toBe('total stop at -$30: $32.30 of room · day stop at -$10.16: $10.86 of room');
    expect(grokPmMismatchText(g, (x) => x)).toBe("the agent's numbers differ from the record by more than $1: its 22:31 UTC report says $100.10 (+$0.10), the record $102.30 (+$2.30)");
    expect(grokPmMismatchText({ ...g, mismatch: false }, (x) => x)).toBe(null);
    expect(/\d/.test(grokPmMismatchText(g, mask)?.replace('22:31', '').replace('$1:', '') ?? '')).toBe(false);
  });
  it('DAYS and the journal as the page reads them', () => {
    expect(g.days.map((/** @type {any} */ d) => grokPmDayCells(d, (x) => x))).toEqual([
      { record: '+$0.70', recordUsd: 0.7, agent: '—', agentUsd: null, trades: '—', flag: '' },
      { record: '+$1.60', recordUsd: 1.6, agent: '+$1.50', agentUsd: 1.5, trades: '3', flag: '' },
    ]);
    expect(grokPmDayCells({ ...g.days[1], mismatch: true }, (x) => x).flag).toBe('differs');
    // The page's DAYS columns (Davies, 2026-10-29: "DAYS里trades和record调换位置"): day, trades, agent says, record, each header over its own cell.
    const jsx = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'agents.jsx'), 'utf8');
    const daysTable = jsx.slice(jsx.indexOf('ag-gpm-days'));
    expect([...daysTable.slice(0, daysTable.indexOf('</thead>')).matchAll(/<th className="hl-th">([^<]+)<\/th>/g)].map((x) => x[1])).toEqual(['Day (UTC)', 'Trades', 'Agent says', 'Record']);
    const cells = daysTable.slice(daysTable.indexOf('<tr key={d.day}>'), daysTable.indexOf('</tr>', daysTable.indexOf('<tr key={d.day}>')));
    expect([...cells.matchAll(/\{(c\.\w+)\}/g)].map((x) => x[1])).toEqual(['c.trades', 'c.agent', 'c.record', 'c.flag']);
    const v = grokPmJournalView(g.journal[5], (x) => x);
    expect(v).toEqual({
      time: '16 Sep 10:58 UTC', action: 'open', tone: 'open', category: 'cat A', side: 'buy Yes', trade: '10 @ 70¢',
      market: { text: 'Will the nominee be confirmed?', href: 'https://polymarket.com/market/will-the-nominee-be-confirmed', pending: false },
      probs: 'p 90¢ vs market 71¢ (edge +19.0)',
      reason: 'The roll call is published: confirmed 52-48.', invalidation: 'The vote record is corrected.',
      sources: [{ href: 'https://www.senate.gov/legislative/votes.htm', text: 'senate.gov' }],
    });
    expect(grokPmJournalView({ ...g.journal[5], sources: ['javascript:alert(1)', 'https://ok.example/'] }, (x) => x).sources).toEqual([{ href: 'https://ok.example/', text: 'ok.example' }]);
    expect(grokPmJournalView(g.journal[0], (x) => x)).toMatchObject({ action: 'no action', tone: 'quiet', category: '', side: '', market: null, trade: '', probs: '' });
    expect(grokPmJournalView(g.journal[5], mask).trade).toBe('•• @ ••¢');
  });
  it('the journal never shows a condition id: Gamma\'s title linked, the record\'s unlinked, else "market title pending"', () => {
    // Davies, 2026-10-17: "目前还有“0xdf9bf27e…”这种乱码"; the old view showed the id's first ten characters.
    const views = g.journal.map((/** @type {any} */ j) => grokPmJournalView(j, (x) => x));
    expect(views.map((/** @type {any} */ v) => v.market && [v.market.text, v.market.href])).toEqual([
      null,
      ['Will the Fed cut rates in October?', 'https://polymarket.com/market/will-the-fed-cut-rates-in-october'],
      ['Will the bill be signed by September 30?', null],
      ['Will the summit take place by September 17?', null],
      ['Will the summit take place by September 17?', null],
      ['Will the nominee be confirmed?', 'https://polymarket.com/market/will-the-nominee-be-confirmed'],
      ['Will there be no change in Fed interest rates after the October 2026 meeting?', 'https://polymarket.com/market/will-there-be-no-change-in-fed-interest-rates-after-the-october-2026-meeting'],
      ['market title pending', null],
    ]);
    expect(JSON.stringify(views)).not.toMatch(/0x[0-9a-f]{4}/i);
    // A link only in the server's shape: anything else leaves the title unlinked.
    expect(grokPmJournalView({ ...g.journal[5], url: 'javascript:alert(1)' }, (x) => x).market).toEqual({ text: 'Will the nominee be confirmed?', href: null, pending: false });
    expect(grokPmJournalView({ ...g.journal[5], url: 'https://evil.example/market/x' }, (x) => x).market?.href).toBe(null);
    // p against the market and the edge in points, signed; one of them alone; neither.
    const x2 = views[6];
    expect([x2.time, x2.action, x2.category, x2.side, x2.trade, x2.probs]).toEqual(['16 Sep 10:40 UTC', 'open', 'cat B', 'buy Yes', '5 @ 85¢', 'p 85¢ vs market 86.5¢ (edge \u22121.5)']);
    expect(x2.sources).toEqual([
      { href: 'https://www.actionforex.com/action-insight/market-overview/657759-dollar-extends-slide/', text: 'actionforex.com' },
      { href: 'https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html', text: 'cmegroup.com' },
    ]);
    expect(grokPmJournalView({ ...g.journal[6], m: null }, (x) => x).probs).toBe('p 85¢');
    expect(grokPmJournalView({ ...g.journal[6], p: null }, (x) => x).probs).toBe('market 86.5¢');
    expect(grokPmJournalView({ ...g.journal[6], p: 0.5, m: 0.5 }, (x) => x).probs).toBe('p 50¢ vs market 50¢ (edge 0)');
    expect(views[7]).toMatchObject({ action: 'cancel', tone: 'quiet', category: 'cat C', side: '', trade: '', probs: '', market: { text: 'market title pending', href: null, pending: true } });
    expect([linkDomain('https://www.example.co.uk/a?b'), linkDomain('http://sub.example.org'), linkDomain('ftp://x.y'), linkDomain('https://'), linkDomain(3)])
      .toEqual(['example.co.uk', 'sub.example.org', null, null, null]);
    expect([utcStamp('2026-10-16T15:38:04+00:00'), utcStamp('2026-01-05T00:07:00Z'), utcStamp('nope'), utcStamp(null)]).toEqual(['16 Oct 15:38 UTC', '5 Jan 00:07 UTC', '', '']);
    expect([fmtProb(0.835), fmtProb(null), fmtBrier(0.10625)]).toEqual(['83.5¢', '—', '0.106']);
  });
});

describe('the venue hues (Davies, 2026-10-29: Hyperliquid its mint, Coinbase its blue, the share bar in the theme colours)', () => {
  const css = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'app', 'styles.css'), 'utf8');
  const rgb = (/** @type {string} */ h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lum = (/** @type {number[]} */ c) => c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (/** @type {number[]} */ a, /** @type {number[]} */ b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const over = (/** @type {number[]} */ f, /** @type {number} */ a, /** @type {number[]} */ b) => f.map((v, i) => a * v + (1 - a) * b[i]);
  const PAGES = [rgb('#0c1310'), rgb('#14201b')];  // the page's background, its flat colour and the top of its gradient

  it('are in the table: Hyperliquid its mint, Coinbase its blue, darker than Revolut X and lighter than its brand #0052ff', () => {
    expect([VENUE_HUES.hyperliquid, VENUE_HUES.coinbase, VENUE_HUES.revx]).toEqual(['#97fce4', '#4d8bff', '#8ec5ff']);
    expect(lum(rgb(VENUE_HUES.coinbase))).toBeGreaterThan(lum(rgb('#0052ff')));
    expect(lum(rgb(VENUE_HUES.coinbase))).toBeLessThan(lum(rgb(VENUE_HUES.revx)) / 1.5);
  });

  it("every venue's badge, card and share-bar slice is its hue, the slice at the one alpha 0.35 with light text of 4.5:1 or more on the composited fill", () => {
    for (const [id, hue] of Object.entries(VENUE_HUES)) {
      const [r, g, b] = rgb(hue);
      expect(css, id).toContain(`.ag-venue-${id} { color: ${hue}; border-color: rgba(${r},${g},${b},`);
      const slice = new RegExp(`\\.ag-share-${id} \\{ background: rgba\\((\\d+),(\\d+),(\\d+),([\\d.]+)\\); color: (#[0-9a-f]{6}); \\}`).exec(css);
      expect([slice?.[1], slice?.[2], slice?.[3], slice?.[4]].map(Number), `${id} slice`).toEqual([r, g, b, 0.35]);
      // The fill as it shows: the hue at 0.35 over the bar (white at 0.04 over the page), at either of the page's backgrounds.
      for (const page of PAGES) {
        const fill = over([r, g, b], 0.35, over([255, 255, 255], 0.04, page));
        expect(ratio(rgb(slice?.[5] ?? '#000000'), fill), `${id} slice text`).toBeGreaterThanOrEqual(4.5);
      }
      expect(new RegExp(`\\.ag-venue-card-${id}\\b[^{]*\\{ border-left-color: rgba\\(${r},${g},${b},0\\.75?\\); \\}`).test(css), `${id} card`).toBe(true);
    }
  });

  it("Coinbase's badge text holds 4.5:1 on its own fill over the page, at both of the page's backgrounds", () => {
    const c = rgb(VENUE_HUES.coinbase);
    for (const page of PAGES) expect(ratio(c, over(c, 0.1, page))).toBeGreaterThanOrEqual(4.5);
    // The brand blue and the old 35 % slice are the shades this replaced: neither would hold.
    expect(ratio(rgb('#0052ff'), PAGES[0])).toBeLessThan(4.5);
    expect(css).not.toContain('0,82,255');
    expect(css).not.toContain('159,216,200');
  });
});
