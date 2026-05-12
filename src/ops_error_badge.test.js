// Pin tests for the desktop-viewport gate on the admin error-triage
// badge. The whole point of the gate is to keep the badge from
// mounting on mobile (≤ 760 px) where the header has no room and the
// previous CSS-only hide caused a 2-second flash before layout
// collapsed it. Regressing the predicate re-introduces that flash.

import { describe, it, expect, vi } from 'vitest';
import { DESKTOP_MEDIA_QUERY, isDesktopViewport } from './ops_error_badge.jsx';

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
