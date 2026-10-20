// Pin tests for the desktop-viewport gate on the admin error-triage
// badge. The whole point of the gate is to keep the badge from
// mounting on mobile (≤ 760 px) where the header has no room and the
// previous CSS-only hide caused a 2-second flash before layout
// collapsed it. Regressing the predicate re-introduces that flash.

import { describe, it, expect, vi } from 'vitest';
import { DESKTOP_MEDIA_QUERY, isDesktopViewport, latestErrorAt, opsBoxView, opsLineMeta } from './ops_error_badge.jsx';

describe('DESKTOP_MEDIA_QUERY constant', () => {
  it('matches the header CSS mobile breakpoint (≤ 760 px)', () => {
    // styles.css line 934 declares `@media (max-width: 760px)` for the
    // stacked-header layout. The badge must STAY UNMOUNTED across that
    // same boundary, so the query is `(min-width: 761px)` — strictly
    // greater than 760, in lockstep with the header's "desktop" side.
    expect(DESKTOP_MEDIA_QUERY).toBe('(min-width: 761px)');
  });
});

describe('isDesktopViewport', () => {
  it('returns false when matchMedia isn\'t available', () => {
    expect(isDesktopViewport(null)).toBe(false);
    expect(isDesktopViewport(undefined)).toBe(false);
    expect(isDesktopViewport(/** @type {any} */ ({}))).toBe(false);
    expect(isDesktopViewport(/** @type {any} */ ('not a function'))).toBe(false);
  });

  it('queries matchMedia with the desktop breakpoint', () => {
    const fn = vi.fn(() => ({ matches: true }));
    isDesktopViewport(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(DESKTOP_MEDIA_QUERY);
  });

  it('returns matches=true (desktop viewport)', () => {
    expect(isDesktopViewport(() => ({ matches: true }))).toBe(true);
  });

  it('returns matches=false (mobile viewport)', () => {
    // 390 px iPhone, 600 px tablet portrait, etc. — anything ≤ 760.
    expect(isDesktopViewport(() => ({ matches: false }))).toBe(false);
  });

  it('coerces non-boolean matches values to false (strict === true comparison)', () => {
    // A buggy matchMedia stub that returned a truthy non-boolean would
    // otherwise sneak past — but the badge should ONLY paint when the
    // viewport definitively matches.
    expect(isDesktopViewport(() => (/** @type {any} */ ({ matches: 'true' })))).toBe(false);
    expect(isDesktopViewport(() => (/** @type {any} */ ({ matches: 1 })))).toBe(false);
  });

  it('returns false when matchMedia throws (private-mode iOS Safari)', () => {
    expect(isDesktopViewport(() => { throw new Error('safari'); })).toBe(false);
  });
});

describe('latestErrorAt', () => {
  it('prefers the summary-level latestAt over the (sliced) bySymbol max', () => {
    // bySymbol is sliced to the top-100-by-count server-side, so a
    // newer one-off error can be missing from it. summary.latestAt is
    // computed before slicing — trust it even when every bySymbol row
    // is older (otherwise Acknowledge could hide an unacked error).
    const summary = {
      latestAt: '2026-05-15T09:00:00Z',                                 // server-computed, pre-slice
      bySymbol: [{ symbol: 'NVDA', latestAt: '2026-05-15T03:00:00Z' }],  // stale top-100 slice
    };
    expect(latestErrorAt(summary)).toBe(Date.parse('2026-05-15T09:00:00Z'));
  });

  it('falls back to the newest bySymbol latestAt when summary.latestAt is absent (older Edge Function)', () => {
    const summary = {
      bySymbol: [
        { symbol: 'CBRS', latestAt: '2026-05-15T00:10:58Z' },
        { symbol: 'NVDA', latestAt: '2026-05-15T03:22:00Z' },  // newest
        { symbol: 'AAPL', latestAt: '2026-05-14T19:00:00Z' },
      ],
    };
    expect(latestErrorAt(summary)).toBe(Date.parse('2026-05-15T03:22:00Z'));
  });

  it('returns 0 for empty / missing / malformed summaries — badge stays visible', () => {
    expect(latestErrorAt(null)).toBe(0);
    expect(latestErrorAt(undefined)).toBe(0);
    expect(latestErrorAt({})).toBe(0);
    expect(latestErrorAt({ bySymbol: [] })).toBe(0);
    expect(latestErrorAt({ bySymbol: [{ symbol: 'X' }] })).toBe(0);        // no latestAt
    expect(latestErrorAt({ bySymbol: [{ latestAt: 'not a date' }] })).toBe(0);
    expect(latestErrorAt({ bySymbol: [null] })).toBe(0);
  });

  it('skips unparseable rows but keeps the max of the valid ones', () => {
    const summary = {
      bySymbol: [
        { latestAt: 'garbage' },
        { latestAt: '2026-05-15T01:00:00Z' },
        null,
      ],
    };
    expect(latestErrorAt(summary)).toBe(Date.parse('2026-05-15T01:00:00Z'));
  });
});

// The box shows LINES a person must act on (Davies, 2026-10-20), not every row: on that day's 24 h, 878 rows became 11
// lines (ops-error/noise.ts). The badge counts the lines and acknowledges up to the newest line, not the newest row.
describe('opsBoxView', () => {
  const box = {
    lines: [
      { kind: 'agents.quotes_live', cls: 'other', message: 'pending buy … 548 min on', count: 83, firstAt: '2026-10-20T06:20:00Z', latestAt: '2026-10-20T16:23:00Z' },
      { kind: 'agents.tick', cls: 'transient', message: 'upstream errors failed 08:48–11:34 UTC, 167 times; latest: …', count: 167, firstAt: '2026-10-20T08:48:00Z', latestAt: '2026-10-20T11:34:00Z', persistent: { ongoing: false } },
    ],
    shownRows: 250, hiddenRows: 76, latestAt: '2026-10-20T16:23:00Z',
  };
  it('counts the lines, not the rows, and acknowledges up to the newest line', () => {
    const v = opsBoxView({ hours: 24, total: 878, latestAt: '2026-10-20T16:24:00Z', byKind: [], bySymbol: [], box });
    expect([v?.count, v?.hiddenRows, v?.latestAt, v?.lines?.length]).toEqual([2, 76, Date.parse('2026-10-20T16:23:00Z'), 2]);
  });
  it('nothing to act on is no badge, however many rows of noise', () => {
    expect(opsBoxView({ hours: 24, total: 69, byKind: [], bySymbol: [], box: { lines: [], shownRows: 0, hiddenRows: 69, latestAt: null } })).toEqual({ count: 0, lines: [], hiddenRows: 69, latestAt: 0 });
  });
  it('an older Edge deploy without box reads as before: every row', () => {
    const v = opsBoxView({ hours: 24, total: 5, latestAt: '2026-05-15T09:00:00Z', byKind: [], bySymbol: [] });
    expect([v?.count, v?.lines, v?.latestAt]).toEqual([5, null, Date.parse('2026-05-15T09:00:00Z')]);
    expect(opsBoxView(null)).toBe(null);
  });
  it('a line says how many rows and since when, or whether its persistent failure is still going', () => {
    expect(opsLineMeta(box.lines[0])).toBe('×83 · 06:20–16:23 UTC');
    expect(opsLineMeta(box.lines[1])).toBe('stopped · 11:34 UTC');
    expect(opsLineMeta({ ...box.lines[1], persistent: { ongoing: true } })).toBe('still failing · 11:34 UTC');
    expect(opsLineMeta({ ...box.lines[0], count: 1 })).toBe('16:23 UTC');
  });
});
