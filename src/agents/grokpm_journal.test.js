// @vitest-environment jsdom
// "Polymarket analyst"'s JOURNAL (Davies, 2026-10-29: "…JOURNAL也默认只显示前10条，然后加个和上面days类似的按钮叫"Load more"，然后每点一次多
// 加载10条"): ten by default, ten more a click, no button once everything is shown; past the dashboard's thirty, the next ones
// from the server.
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { GrokPmJournal } from './agents.jsx';

afterEach(cleanup);

const m = (/** @type {string} */ s) => s;
const T0 = Date.parse('2026-10-29T12:00:00Z');
/** @param {number} i */
const entry = (i) => ({ id: `d${i}`, ts: new Date(T0 - i * 60e3).toISOString(), action: 'no_action', category: null, title: null, url: null, marketId: null,
  outcome: null, side: null, price: null, size: null, p: null, m: null, reason: `reason ${i}`, invalidation: null, sources: [] });
const entries = (/** @type {number} */ n, from = 0) => Array.from({ length: n }, (_, i) => entry(from + i));
const view = (/** @type {any} */ g, /** @type {any} */ fetchImpl = undefined) => render(React.createElement(GrokPmJournal, { g, m, fetchImpl }));
const count = (/** @type {HTMLElement} */ root) => root.querySelectorAll('.ag-gpm-entry').length;

describe('the JOURNAL, ten at a time', () => {
  it('shows ten, ten more a click, and no button once all are shown', () => {
    const { container, getByText, queryByText } = view({ journal: entries(25), journalMore: false });
    expect(count(container)).toBe(10);
    expect(container.querySelector('.ag-gpm-entry')?.textContent).toContain('reason 0');
    fireEvent.click(getByText('Load more'));
    expect(count(container)).toBe(20);
    fireEvent.click(getByText('Load more'));
    expect(count(container)).toBe(25);
    expect(queryByText('Load more')).toBeNull();
    // The button is DAYS' "Load full history" button.
    cleanup();
    expect(view({ journal: entries(11), journalMore: false }).container.querySelector('.ag-gpm-journal button.btn-ghost.ag-more')?.textContent).toBe('Load more');
  });

  it('ten or fewer: no button', () => {
    expect(view({ journal: entries(10), journalMore: false }).queryByText('Load more')).toBeNull();
    cleanup();
    expect(count(view({ journal: entries(3), journalMore: false }).container)).toBe(3);
    cleanup();
    const empty = view({ journal: [], journalMore: false });
    expect(empty.getByText('Nothing reported yet.')).toBeTruthy();
    expect(empty.queryByText('Load more')).toBeNull();
  });

  it('past the dashboard\'s thirty it asks the server for the next ten, and stops when none remain', async () => {
    /** @type {string[]} */
    const asked = [];
    const fetchImpl = /** @type {any} */ (async (/** @type {string} */ url) => {
      asked.push(url);
      return { ok: true, status: 200, text: async () => JSON.stringify({ journal: entries(6, 30), more: false }) };
    });
    const { container, getByText, queryByText } = view({ journal: entries(30), journalMore: true }, fetchImpl);
    fireEvent.click(getByText('Load more'));
    fireEvent.click(getByText('Load more'));
    expect(count(container)).toBe(30);
    expect(asked).toEqual([]);
    // Thirty shown and the server has more: the button stays, and the next click asks for the ten older than d29.
    fireEvent.click(getByText('Load more'));
    await waitFor(() => expect(count(container)).toBe(36));
    expect(asked).toHaveLength(1);
    const q = new URL(asked[0]).searchParams;
    expect([q.get('action'), q.get('before'), q.get('skip'), q.get('limit')]).toEqual(['grokpmjournal', entry(29).ts, 'd29', '10']);
    expect(queryByText('Load more')).toBeNull();
  });
});
