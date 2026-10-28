// @vitest-environment jsdom
// The Stablecoin quotes pages' DAYS table (Davies, 2026-10-28): by default today's open row and the seven closed days the
// "7-day realised, annualised" figure sums, "Load full history" for every day, "Show last 7 days" to fold it back.
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { QuoteDaysTable } from './agents.jsx';
import { quoteDaysAnnualPct, quoteDaysRecent, quoteDaysWindow } from './agents.js';

afterEach(cleanup);

const NOW = Date.parse('2026-10-28T12:00:00Z');
const DAY = 86400e3;
const iso = (/** @type {number} */ ms) => new Date(ms).toISOString().slice(0, 10);
/** Twelve rows newest first: today (open) and the eleven closed days before it, each earning 0.01 more than the last. */
const days = Array.from({ length: 12 }, (_, i) => ({
  day: iso(Date.parse('2026-10-28T00:00:00Z') - i * DAY), today: i === 0, orders: 10 + i, fills: i, trips: 1, won: 1, realisedGbp: 0.01 * (12 - i), capitalGbp: 600,
}));
const m = (/** @type {string} */ s) => s;
const view = (/** @type {any[]} */ rows) => render(React.createElement(QuoteDaysTable, { days: rows, m, capitalGbp: 600, nowMs: NOW }));
const dayCells = (/** @type {HTMLElement} */ root) => [...root.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td')?.textContent);

describe('DAYS, last seven by default', () => {
  it('shows today and the seven closed days the figure uses, all rows after Load full history, and folds back', () => {
    const { container, getByText, queryByText } = view(days);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(8);
    expect(dayCells(container)[0]).toBe('28 Oct · today');
    expect(dayCells(container)[1]).toBe('27 Oct');
    expect(dayCells(container)[7]).toBe('21 Oct');
    expect(queryByText('Show last 7 days')).toBeNull();
    fireEvent.click(getByText('Load full history'));
    expect(container.querySelectorAll('tbody tr')).toHaveLength(12);
    expect(dayCells(container)[0]).toBe('28 Oct · today');
    fireEvent.click(getByText('Show last 7 days'));
    expect(container.querySelectorAll('tbody tr')).toHaveLength(8);
    expect(getByText('Load full history')).toBeTruthy();
  });

  it('the seven rows are exactly the days the heading figure sums', () => {
    const shown = quoteDaysRecent(days, NOW);
    expect(shown[0].day).toBe('2026-10-28');
    const rows = shown.filter((d) => !d.today);
    expect(rows.map((d) => d.day)).toEqual(['2026-10-27', '2026-10-26', '2026-10-25', '2026-10-24', '2026-10-23', '2026-10-22', '2026-10-21']);
    // The figure over the shown rows (today's open row left out, as the figure leaves it) equals the figure over the whole history, and dropping any one of them moves it.
    const full = quoteDaysAnnualPct(days, 600, NOW);
    expect(quoteDaysAnnualPct(shown, 600, NOW)).toBeCloseTo(/** @type {number} */ (full), 10);
    expect(quoteDaysAnnualPct(rows.slice(1), 600, NOW)).not.toBeCloseTo(/** @type {number} */ (full), 3);
    // The same window bounds both: from the seventh day back, up to but not including today.
    expect(quoteDaysWindow(NOW)).toEqual({ from: '2026-10-21', today: '2026-10-28' });
    // And what the page prints beside DAYS is that figure.
    const { container } = view(days);
    const sum = rows.reduce((s, d) => s + d.realisedGbp / 600, 0);
    expect(container.querySelector('.ag-quote-days-annual')?.textContent).toContain(`+${(sum * (365 / 7) * 100).toFixed(1)}%`);
  });

  it('a day with no row leaves fewer than seven closed; with nothing to fold there is no button', () => {
    const few = days.filter((d) => d.day !== '2026-10-25' && d.day >= '2026-10-21');
    const { container, queryByText } = view(few);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(few.length);
    expect(queryByText('Load full history')).toBeNull();
    cleanup();
    // Older rows exist beside a short window: the window's rows show, the button offers the rest.
    const some = [...few, { ...days[11], day: '2026-10-10', today: false }];
    const v = view(some);
    expect(v.container.querySelectorAll('tbody tr')).toHaveLength(few.length);
    expect(v.getByText('Load full history')).toBeTruthy();
  });

  it('a page with no closed day in the window shows what it has', () => {
    const only = [days[0]];
    const { container, queryByText } = view(only);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(queryByText('Load full history')).toBeNull();
    cleanup();
    const old = [{ ...days[11], day: '2026-10-01', today: false }];
    expect(view(old).container.querySelectorAll('tbody tr')).toHaveLength(1);
  });
});
