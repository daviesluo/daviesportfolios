// @vitest-environment jsdom
// The board's refresh refreshes the Agents page and every page opened over it (Davies, 2026-10-30: "网页主页刷新时agent页和所有子策略页也同步
// 刷新，agent页刷新时所有子策略页也同步刷新"): its ↻ asks anew; its tick refreshes the page only near the page's own minute, so no
// dashboard is asked for twice in a minute; and the page's own clock starts again from the board's refresh.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render, cleanup, act } from '@testing-library/react';
import { announceBoardRefresh, onBoardRefresh, BOARD_REFRESH_EVENT } from '../app/refresh_bus.js';

const calls = { n: 0 };
vi.mock('./agents.js', async (importOriginal) => {
  const real = /** @type {any} */ (await importOriginal());
  return {
    ...real,
    readAgentsCache: () => null,
    dashboardInFlight: () => null,
    prefetchAgentsDashboard: () => {},
    fetchAgentsDashboard: async () => { calls.n++; return { at: new Date().toISOString(), strategies: [], totals: {}, byVenue: {}, venues: [], quotesTwins: [] }; },
  };
});
const { AgentsModal, BOARD_SYNC_MS } = await import('./agents.jsx');

beforeEach(() => { calls.n = 0; vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] }); vi.setSystemTime(Date.parse('2026-10-30T12:00:00Z')); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe("the board's refresh is the Agents page's", () => {
  it('announces on a window event the page hears, ↻ as manual, the tick not', () => {
    const got = /** @type {boolean[]} */ ([]);
    const off = onBoardRefresh(({ manual }) => got.push(manual));
    announceBoardRefresh(true); announceBoardRefresh(false);
    off();
    announceBoardRefresh(true);
    expect(got).toEqual([true, false]);
    expect(BOARD_REFRESH_EVENT).toBe('dp:board-refresh');
  });

  it("↻ on the board asks the dashboard anew; its tick does only near the page's minute; the page's own clock restarts from it", async () => {
    render(React.createElement(AgentsModal, { hideValues: false, onClose: () => {} }));
    await flush();
    expect(calls.n).toBe(1);                                   // the page's own first read
    await act(async () => { announceBoardRefresh(true); });
    await flush();
    expect(calls.n).toBe(2);                                   // the board's ↻
    await act(async () => { vi.advanceTimersByTime(30_000); announceBoardRefresh(false); });
    await flush();
    expect(calls.n).toBe(2);                                   // a tick 30 s after: the answer is fresh, nothing asked
    await act(async () => { vi.advanceTimersByTime(BOARD_SYNC_MS - 30_000); announceBoardRefresh(false); });
    await flush();
    expect(calls.n).toBe(3);                                   // a tick 40 s after: refreshed with the board
    await act(async () => { vi.advanceTimersByTime(59_000); });
    await flush();
    expect(calls.n).toBe(3);                                   // the page's minute restarted from the board's refresh
    await act(async () => { vi.advanceTimersByTime(1_000); });
    await flush();
    expect(calls.n).toBe(4);
  });
});
