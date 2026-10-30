// @vitest-environment jsdom
// The line about the other maker on the two Revolut X live pages (Davies, 2026-10-30: "我们能不能对他加个监控，实时观察和记录他的
// 行为"): the dashboard's `makerWatch[book]` (supabase/functions/agents/maker_watch.ts, 0185) in words, under the scoreboard of
// LIVE's USDT-GBP page and RX USDC/GBP's USDC-GBP page, and nowhere else.
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { QuotesLiveDetail } from './agents.jsx';
import liveFixture from '../e2e/quotes_live_fixture.json';
import { heldForText, MAKER_WATCH_BOOK, MAKER_WATCH_STALE_MS, makerWatchLine } from './agents.js';

afterEach(cleanup);

// 2026-10-30 is GMT in London (the clocks went back on 10-25), so UK times read as UTC.
const NOW = Date.parse('2026-10-30T02:50:00Z');
const ABSENT = { book: 'USDT-GBP', at: '2026-10-30T02:49:00.000Z', status: 'absent', since: '2026-10-29T21:17:00.000Z', present: 'none', width: 5, bid: null, ask: null, bidBps: null, askBps: null, size: 5007 };
const PRESENT = { book: 'USDC-GBP', at: '2026-10-30T02:49:00.000Z', status: 'present', since: '2026-10-30T00:44:00.000Z', present: 'both', width: 12, bid: 0.7531, ask: 0.7543, bidBps: 6.14, askBps: 9.8, size: 5001 };

describe('makerWatchLine', () => {
  it('says absent and since when, how long, in UK time', () => {
    expect(makerWatchLine(ABSENT, NOW)).toBe('Other maker: absent since 29 Oct 21:17 UK (5 h 33 min)');
  });
  it('says present, how wide, and how far each side sits from fair', () => {
    expect(makerWatchLine(PRESENT, NOW)).toBe('Other maker: present since 30 Oct 00:44 UK (2 h 6 min), 12 ticks wide, its bid 6.1 bps and ask 9.8 bps from fair');
  });
  it('says when only one side was there this minute, or none of it in the five levels, without the distances', () => {
    expect(makerWatchLine({ ...PRESENT, present: 'bid' }, NOW)).toBe('Other maker: present since 30 Oct 00:44 UK (2 h 6 min), 12 ticks wide, bid only this minute');
    expect(makerWatchLine({ ...PRESENT, present: 'none' }, NOW)).toBe('Other maker: present since 30 Oct 00:44 UK (2 h 6 min), 12 ticks wide, not in the top five levels this minute');
  });
  it('says the watch is behind rather than a status more than ten minutes old', () => {
    const at = NOW - MAKER_WATCH_STALE_MS - 60e3;
    expect(makerWatchLine({ ...PRESENT, at: new Date(at).toISOString() }, NOW)).toBe('Other maker: the watch is behind, its last minute 30 Oct 02:39 UK');
    // Ten minutes is still current.
    expect(makerWatchLine({ ...PRESENT, at: new Date(NOW - MAKER_WATCH_STALE_MS).toISOString() }, NOW)).toMatch(/^Other maker: present/);
  });
  it('is nothing before the watch has a status', () => {
    expect(makerWatchLine(null, NOW)).toBe(null);
    expect(makerWatchLine({ ...ABSENT, status: null, since: null }, NOW)).toBe(null);
  });
  it('heldForText: minutes, then hours and minutes, then days and hours', () => {
    expect([heldForText(59 * 60e3), heldForText(61 * 60e3), heldForText(47 * 3600e3 + 59 * 60e3), heldForText(50 * 3600e3)]).toEqual(['59 min', '1 h 1 min', '47 h 59 min', '2 d 2 h']);
  });
  it('each live page reads its own book', () => {
    expect(MAKER_WATCH_BOOK).toEqual({ live: 'USDT-GBP', rxu: 'USDC-GBP' });
  });
});

describe('QuotesLiveDetail', () => {
  it('draws the line under the scoreboard when given the book\'s watch, and none without it', () => {
    const q = liveFixture.live;
    const { container } = render(React.createElement(QuotesLiveDetail, { q, m: (/** @type {string} */ s) => s, at: null, nowMs: NOW, maker: ABSENT }));
    expect(container.querySelector('.ag-scoreboard')).not.toBe(null);
    const line = container.querySelector('.ag-maker-line');
    expect(line?.textContent).toBe('Other maker: absent since 29 Oct 21:17 UK (5 h 33 min)');
    // Right under the scoreboard.
    expect(line?.previousElementSibling?.classList.contains('ag-scoreboard')).toBe(true);
    cleanup();
    const bare = render(React.createElement(QuotesLiveDetail, { q, m: (/** @type {string} */ s) => s, at: null, nowMs: NOW }));
    expect(bare.container.querySelector('.ag-maker-line')).toBe(null);
  });
});
