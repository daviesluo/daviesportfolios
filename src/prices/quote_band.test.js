// The plausibility band on live quotes (improvement plan item 6), pinned in closed form. Every real move Davies named
// must pass — an earnings gap, a biotech halving, an IPO's first day, a split, a London listing, a CN fund, an OTC name,
// a holding with no previous price — and every defect shape this codebase has met must be held: pence for pounds, a
// proxy's body for something else, a stale price, a value that is not a price. The sweep checks the same on the built
// bundle (src/e2e/app-sweep.mjs, part `quote-band`).
import { describe, it, expect } from 'vitest';
import {
  BAND_MAX_RATIO, BAND_STEP_MS, HOLD_CONFIRM_MS, bandWidth, cleanQuote, createQuoteGuard, distance, holdMessage,
  isUnitRatio, quotedInPence,
} from './quote_band.js';
import { extPriceIsRealAh } from '../charts/indicators.js';
import { quotesRegularSessionOnly } from './yahoo_fetch.js';

const T0 = Date.UTC(2026, 9, 1, 19, 55);          // Thursday 1 Oct 2026, 15:55 ET
const MIN = 60e3, HOUR = 3600e3, DAY = 86400e3;
/** A quote as refreshPrices hands it over. */
const q = (lastPrice, prevClose, extra = {}) => ({ lastPrice, prevClose, extPrice: null, currency: 'USD', dayPct: prevClose > 0 ? ((lastPrice - prevClose) / prevClose) * 100 : 0, ...extra });
/** A guard that has accepted `quotes` at `at`, from the price function. */
function guardWith(quotes, at = T0) {
  const g = createQuoteGuard();
  const r = g.screen({ quotes, now: at });
  expect(Object.keys(r.accepted).sort()).toEqual(Object.keys(quotes).sort());
  return g;
}

describe('the band\'s width', () => {
  it('is the after-hours guard\'s tolerance for fresh quotes: 3 % with no bars, twice the largest step with them, 15 % at most', () => {
    expect(bandWidth(null, 30e3)).toBeCloseTo(Math.log(1.03), 12);
    // Steps 10 % and 9.09 %: twice the larger is 20 %, capped at 15 %.
    expect(bandWidth([{ close: 100 }, { close: 110 }, { close: 120 }], 0)).toBeCloseTo(Math.log(1.15), 12);
    // Steps of 1 %: twice is 2 %, floored at 3 %.
    expect(bandWidth([{ close: 100 }, { close: 101 }, { close: 102.01 }], 0)).toBeCloseTo(Math.log(1.03), 12);
    // Steps of 5 %: 10 %.
    expect(bandWidth([{ close: 100 }, { close: 105 }], 0)).toBeCloseTo(Math.log(1.10), 12);
  });
  it('widens with the square root of the bars since the last good quote, and never past ×5', () => {
    expect(bandWidth(null, HOUR)).toBeCloseTo(Math.log(1.03) * Math.sqrt(12), 12);           // 0.1024: ±10.8 %
    expect(bandWidth(null, DAY)).toBeCloseTo(Math.log(1.03) * Math.sqrt(288), 12);            // 0.5016: ×1.65
    expect(bandWidth([{ close: 100 }, { close: 120 }], DAY)).toBeCloseTo(Math.log(BAND_MAX_RATIO), 12);
    expect(bandWidth(null, 7 * DAY)).toBeCloseTo(Math.log(1.03) * Math.sqrt(7 * DAY / BAND_STEP_MS), 12); // 1.327: ×3.77
  });
});

describe('a quote sits near the last good one when any of its two prices does', () => {
  it('measures the nearest of the four pairs, in log units', () => {
    expect(distance({ lastPrice: 60, prevClose: 100 }, { lastPrice: 100, prevClose: 98 })).toBe(0);
    expect(distance({ lastPrice: 250, prevClose: 240 }, { lastPrice: 2.5, prevClose: 2.4 })).toBeCloseTo(Math.log(240 / 2.5), 12);   // the nearest pair: their close, our price
    expect(distance({ lastPrice: 110, prevClose: null }, { lastPrice: 100, prevClose: null })).toBeCloseTo(Math.log(1.1), 12);
    expect(distance({ lastPrice: 110 }, { lastPrice: NaN, prevClose: 0 })).toBe(Infinity);
  });
  it('knows the pence shape and the listings that can have it', () => {
    for (const r of [100, 70, 140, 0.01, 1 / 70, 1 / 140]) expect(isUnitRatio(r)).toBe(true);
    for (const r of [69, 141, 10, 50, 1, 0.1, 0.02, 1 / 141]) expect(isUnitRatio(r)).toBe(false);
    expect(quotedInPence('BRIT.L', 'GBP')).toBe(true);
    expect(quotedInPence('VUAA.L', 'USD')).toBe(true);
    expect(quotedInPence('ACME', 'USD')).toBe(false);
    expect(quotedInPence('017731', 'CNY')).toBe(false);
  });
});

describe('real moves pass', () => {
  it('an earnings gap of 40 % down or up at the open: the quote\'s previous close is the last good price', () => {
    const g = guardWith({ DOWN: q(100, 98), UP: q(50, 49) });
    const r = g.screen({ quotes: { DOWN: q(60, 100), UP: q(70, 50) }, now: T0 + 17.6 * HOUR });
    expect(r.accepted.DOWN.lastPrice).toBe(60);
    expect(r.accepted.UP.lastPrice).toBe(70);
    expect(r.holds).toEqual([]);
  });
  it('a biotech halving, at the open and in the middle of a session thirty seconds after the last quote', () => {
    const g = guardWith({ OPEN: q(30, 29.5), MID: q(30, 29.5) });
    const r = g.screen({ quotes: { OPEN: q(15, 30), MID: q(14, 29.5) }, now: T0 + 30e3 });
    expect(r.accepted.OPEN.lastPrice).toBe(15);
    expect(r.accepted.MID.lastPrice).toBe(14);
  });
  it('a holding with no previous price — an IPO\'s first quote, a new name — passes whatever it is', () => {
    const g = createQuoteGuard();
    const r = g.screen({ quotes: { IPO: q(40, 40), NEW: q(0.0042, 0.004) }, now: T0 });
    expect(r.accepted.IPO.lastPrice).toBe(40);
    expect(r.accepted.NEW.lastPrice).toBe(0.0042);
  });
  it('an IPO\'s first day moving 15 % in thirty seconds with its previous close the open: held, then believed when the proxy agrees', () => {
    const g = guardWith({ IPO: q(40, 40) });
    const bars = [{ close: 38 }, { close: 40 }];        // a 5 % step: a 10 % band
    const one = g.screen({ quotes: { IPO: q(46, 46) }, now: T0 + 30e3, barsOf: () => bars });
    expect(one.accepted).toEqual({});
    expect(g.pending()).toEqual({ IPO: 'edge' });
    const two = g.screen({ quotes: { IPO: q(46.4, 46.4) }, alt: { IPO: q(46.3, 46.3) }, now: T0 + 60e3, barsOf: () => bars });
    expect(two.accepted.IPO.lastPrice).toBe(46.4);
    expect(g.pending()).toEqual({});
  });
  it('a 10:1 split: held, then believed as soon as a second source agrees', () => {
    const g = guardWith({ SPLIT: q(1200, 1190) });
    const day = T0 + 17.6 * HOUR;
    const first = g.screen({ quotes: { SPLIT: q(121, 120) }, now: day });
    expect(first.accepted).toEqual({});
    expect(first.holds.map((h) => [h.ticker, h.shape, h.source])).toEqual([['SPLIT', 'jump', 'edge']]);
    // The next refresh asks the proxy, which says the same: two paths to Yahoo agree.
    const second = g.screen({ quotes: { SPLIT: q(121.5, 120) }, alt: { SPLIT: q(121.4, 120) }, now: day + 30e3 });
    expect(second.accepted.SPLIT.lastPrice).toBe(121.5);
  });
  it('a split first seen from a proxy while the price function was down is believed when the function, back, says the same', () => {
    const g = guardWith({ SPLIT: q(1200, 1190) });
    const day = T0 + 17.6 * HOUR;
    expect(g.screen({ quotes: { SPLIT: q(121, 120) }, sources: { SPLIT: 'proxy' }, now: day }).holds[0].source).toBe('proxy');
    const back = g.screen({ quotes: { SPLIT: q(121.2, 120) }, now: day + 30e3 });
    expect(back.accepted.SPLIT.lastPrice).toBe(121.2);
  });
  it('a split with only one source answering is believed once that source has repeated it for five minutes', () => {
    const g = guardWith({ SPLIT: q(1200, 1190) });
    const day = T0 + 17.6 * HOUR;
    g.screen({ quotes: { SPLIT: q(121, 120) }, now: day });
    for (let s = 30; s < HOLD_CONFIRM_MS / 1000; s += 30) {
      expect(g.screen({ quotes: { SPLIT: q(121 + s / 1000, 120) }, now: day + s * 1000 }).accepted).toEqual({});
    }
    const at = g.screen({ quotes: { SPLIT: q(121.4, 120) }, now: day + HOLD_CONFIRM_MS });
    expect(at.accepted.SPLIT.lastPrice).toBe(121.4);
  });
  it('a London listing in pounds — Yahoo\'s pence normalised — moves like any other, and a USD line on London too', () => {
    const g = guardWith({ 'BRIT.L': q(2.5, 2.4, { currency: 'GBP' }), 'VUAA.L': q(80, 79, { currency: 'USD' }) });
    const r = g.screen({ quotes: { 'BRIT.L': q(2.62, 2.4, { currency: 'GBP' }), 'VUAA.L': q(80.4, 79, { currency: 'USD' }) }, now: T0 + 30e3 });
    expect(r.accepted['BRIT.L'].lastPrice).toBe(2.62);
    expect(r.accepted['VUAA.L'].lastPrice).toBe(80.4);
  });
  it('a CN fund: its estimate, its official NAV the next morning, and a 9.9 % day', () => {
    const g = guardWith({ '017731': q(1.59, 1.5, { currency: 'CNY' }) });              // fundgz: estimate 1.59 on NAV 1.50
    const lsjz = g.screen({ quotes: { '017731': q(1.585, 1.5, { currency: 'CNY' }) }, now: T0 + 14 * HOUR });
    expect(lsjz.accepted['017731'].lastPrice).toBe(1.585);                            // official NAV, previous NAV 1.50
    const limit = g.screen({ quotes: { '017731': q(1.742, 1.585, { currency: 'CNY' }) }, now: T0 + 38 * HOUR });
    expect(limit.accepted['017731'].lastPrice).toBe(1.742);                           // +9.9 % on the day
  });
  it('an OTC name, a thin listing\'s 18.5 % jump between five-minute bars, crypto past its 16:00 anchor', () => {
    const g = guardWith({ SFTBY: q(27.11, 27.3), '2DG.SG': q(10, 9.8), 'BTC-USD': q(60000, 59000) });
    const r = g.screen({ quotes: {
      SFTBY: q(27.5, 27.11),
      '2DG.SG': q(8.15, 9.8),
      'BTC-USD': q(60100, 59000, { extPrice: 60200 }),
    }, now: T0 + 5 * MIN });
    expect(Object.keys(r.accepted).sort()).toEqual(['2DG.SG', 'BTC-USD', 'SFTBY']);
  });
  it('the price the page showed a week ago still lets a +60 % week through', () => {
    const g = createQuoteGuard({ seed: { MSTR: { lastPrice: 100, prevClose: 99 } }, seedAt: T0 - 7 * DAY });
    const r = g.screen({ quotes: { MSTR: q(160, 158) }, now: T0 });
    expect(r.accepted.MSTR.lastPrice).toBe(160);
  });
});

describe('the defect shapes this codebase has met are held', () => {
  it('a value that is not a price is never shown, and is named', () => {
    const g = guardWith({ A: q(10, 9.9) });
    const r = g.screen({ quotes: { A: q(0, 9.9), B: q(-5, 1), C: q(NaN, 1), D: q(Infinity, 1), E: { lastPrice: '12', prevClose: 11 }, F: null }, now: T0 + 30e3 });
    expect(r.accepted).toEqual({});
    expect(r.bad.map((b) => b.ticker).sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
  it('a previous close or after-hours price that is not a price is taken out, the quote kept', () => {
    expect(cleanQuote(q(10, 0))).toMatchObject({ lastPrice: 10, prevClose: null, dayPct: null });
    expect(cleanQuote(q(10, 9, { extPrice: -1, extDayPct: 5 }))).toMatchObject({ extPrice: null, extDayPct: null });
    // An after-hours price 100× its own last price is pence in that half alone.
    expect(cleanQuote(q(2.5, 2.4, { extPrice: 252, extDayPct: 9980 }))).toMatchObject({ lastPrice: 2.5, extPrice: null, extDayPct: null });
    expect(cleanQuote(q(240, 238, { extPrice: 247.2, extDayPct: 3 }))).toMatchObject({ extPrice: 247.2, extDayPct: 3 });
  });
  it('pence for pounds from a proxy: held against this page\'s own price however long one source repeats it', () => {
    const g = guardWith({ 'BRIT.L': q(2.5, 2.4, { currency: 'GBP' }) });
    const r = g.screen({ quotes: { 'BRIT.L': q(250, 240, { currency: 'GBP' }) }, sources: { 'BRIT.L': 'proxy' }, now: T0 + 30e3 });
    expect(r.accepted).toEqual({});
    expect(r.holds).toHaveLength(1);
    expect(r.holds[0]).toMatchObject({ ticker: 'BRIT.L', shape: 'unit', source: 'proxy' });
    expect(holdMessage(r.holds[0])).toBe('BRIT.L 250 from a proxy against 2.5 (×100, 100× off: pence for pounds); the last good price stays until a second source agrees');
    for (let s = 60; s <= 30 * 60; s += 30) {
      expect(g.screen({ quotes: { 'BRIT.L': q(250, 240, { currency: 'GBP' }) }, sources: { 'BRIT.L': 'proxy' }, now: T0 + s * 1000 }).accepted).toEqual({});
    }
    // The price function comes back with pounds: that is the price, and the hold is dropped.
    const back = g.screen({ quotes: { 'BRIT.L': q(2.55, 2.4, { currency: 'GBP' }) }, now: T0 + 31 * MIN });
    expect(back.accepted['BRIT.L'].lastPrice).toBe(2.55);
    expect(g.pending()).toEqual({});
  });
  it('pounds for pence the other way, and both paths agreeing on pence is believed: Yahoo itself says so', () => {
    const g = guardWith({ 'BRIT.L': q(2.5, 2.4, { currency: 'GBP' }) });
    expect(g.screen({ quotes: { 'BRIT.L': q(0.025, 0.024, { currency: 'GBP' }) }, now: T0 + 30e3 }).holds[0].shape).toBe('unit');
    const both = g.screen({ quotes: { 'BRIT.L': q(250, 240, { currency: 'GBP' }) }, alt: { 'BRIT.L': q(251, 240, { currency: 'GBP' }) }, now: T0 + 60e3 });
    expect(both.accepted['BRIT.L'].lastPrice).toBe(250);
  });
  it('against a price kept from the last visit, the pence shape is believed after five minutes like anything else', () => {
    const g = createQuoteGuard({ seed: { 'BRIT.L': { lastPrice: 250, prevClose: 240 } }, seedAt: T0 - HOUR });
    const r = g.screen({ quotes: { 'BRIT.L': q(2.5, 2.4, { currency: 'GBP' }) }, now: T0 });
    expect(r.holds[0].shape).toBe('unit');
    expect(g.screen({ quotes: { 'BRIT.L': q(2.5, 2.4, { currency: 'GBP' }) }, now: T0 + HOLD_CONFIRM_MS - 1 }).accepted).toEqual({});
    expect(g.screen({ quotes: { 'BRIT.L': q(2.5, 2.4, { currency: 'GBP' }) }, now: T0 + HOLD_CONFIRM_MS }).accepted['BRIT.L'].lastPrice).toBe(2.5);
  });
  it('a proxy\'s body for another symbol is held, and the price function\'s next answer is taken', () => {
    const g = guardWith({ ACME: q(240, 238) });
    const r = g.screen({ quotes: { ACME: q(1520, 1500) }, sources: { ACME: 'proxy' }, now: T0 + 30e3 });
    expect(r.accepted).toEqual({});
    expect(r.holds[0]).toMatchObject({ ticker: 'ACME', shape: 'jump', source: 'proxy' });
    expect(g.pending()).toEqual({ ACME: 'proxy' });
    const next = g.screen({ quotes: { ACME: q(241, 238) }, now: T0 + 60e3 });
    expect(next.accepted.ACME.lastPrice).toBe(241);
  });
  it('a stale price from an old cached body is held: neither its price nor its close is near today\'s', () => {
    const g = guardWith({ ACME: q(240, 238) });
    expect(g.screen({ quotes: { ACME: q(180, 178) }, sources: { ACME: 'proxy' }, now: T0 + 30e3 }).holds).toHaveLength(1);
  });
  it('a second source that sides with the last good price wins over the held one', () => {
    const g = guardWith({ ACME: q(240, 238) });
    g.screen({ quotes: { ACME: q(1520, 1500) }, now: T0 + 30e3 });
    const r = g.screen({ quotes: { ACME: q(1521, 1500) }, alt: { ACME: q(240.5, 238) }, now: T0 + 60e3 });
    expect(r.accepted.ACME.lastPrice).toBe(240.5);
    expect(g.pending()).toEqual({});
  });
  it('a new deviation replaces the one held, and is reported again', () => {
    const g = guardWith({ ACME: q(240, 238) });
    g.screen({ quotes: { ACME: q(1520, 1500) }, now: T0 + 30e3 });
    const r = g.screen({ quotes: { ACME: q(24, 23.8) }, now: T0 + 60e3 });
    expect(r.holds.map((h) => h.quote.lastPrice)).toEqual([24]);
  });
  it('SFTBY\'s open served as an after-hours price is caught by the after-hours guard the write keeps', () => {
    // Its after-hours price is suppressed outright (no overnight session), and where a price slips through, the
    // intraday bars say it is not where the tape is: the open 8 % above the last bar.
    expect(quotesRegularSessionOnly('SFTBY')).toBe(true);
    const bars = [
      { date: '2026-10-01T19:50', close: 25.0 }, { date: '2026-10-01T19:55', close: 25.02 },
      { date: '2026-10-01T20:30', close: 25.01 },
    ];
    expect(extPriceIsRealAh(bars, 27.11, 13 * 60 + 30, 20 * 60)).toBe(false);
    expect(extPriceIsRealAh(bars, 25.1, 13 * 60 + 30, 20 * 60)).toBe(true);
  });
});
