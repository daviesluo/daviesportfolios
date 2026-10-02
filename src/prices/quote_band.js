// A plausibility band on every live quote the board takes (improvement plan item 6, 2026-10-02).
//
// The quotes are the board's prices for every holding, as `refreshPrices` hands them over: the `prices` Edge Function
// first, then, for what it leaves out, the public proxies racing Yahoo's chart endpoint, and a CN fund's own proxy
// path. Nothing checked a quote between the fetch and the board until now. This module does, at that write: a quote
// that cannot be the same instrument in the same units as the last good one is held — the board keeps the last good
// price, the quote is reported to the errors box, and the next refresh tries again.
//
// It must never hold a real price: a dropped real move is worse than the defect. So a quote passes when ANY of its two
// prices (last, previous close) sits within the band of ANY of the last good quote's two. An earnings gap of 40 % at
// the open, a biotech halving, a thin listing's 18 % jump between bars, a CN fund switching from its estimate to its
// official NAV: each comes with a previous close the last good quote knows, and passes however far the price moved.
// What fails all four comparisons is what this codebase has met — a quote in pence where pounds were (the GBp
// normalisation exists twice, in the Edge Function and in the proxy parse), a proxy's body for something else, a value
// that is not a price at all — and what a real quote does only rarely: a split, an IPO's first minutes, a long gap.
// The rare real ones are believed as soon as a second source agrees (the Edge Function and a proxy, two paths to
// Yahoo), or, for anything but the pence shape, once one source has repeated them for five minutes.
//
// The band's width is the after-hours guard's own (`ahQuoteTolerance`: twice the name's largest five-minute step in its
// last twelve bars, 3 % to 15 %), widened by the square root of the bars since the last good quote, never past ×5. A
// holding with no last good quote — a new name, an IPO, the first quote of a session with nothing kept — passes.
//
// The after-hours half of a quote keeps its own guard: `extPriceIsRealAh` against the intraday bars at the write
// (app.jsx), `extPriceLooksReal` when there are none (metrics.js). That is where SFTBY's open served as an after-hours
// price is caught; here an `extPrice` that is not a price, or is 100× its own last price, is only dropped.

import { ahQuoteTolerance } from '../charts/indicators.js';

/** One bar: the after-hours guard's tolerance is measured in five-minute steps. */
export const BAND_STEP_MS = 5 * 60e3;
/** However old the last good quote, the band never widens past ×5 / ÷5. */
export const BAND_MAX_RATIO = 5;
/** A quote 100× or 1/100× the last good one, give or take 30 %: pence for pounds, or pounds for pence. */
export const UNIT_RATIO_LO = 70, UNIT_RATIO_HI = 140;
/** One source repeating a held price this long is believed (never for the pence shape against this page's own quote). */
export const HOLD_CONFIRM_MS = 5 * 60e3;

/** @param {unknown} v @returns {number | null} */
const price = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
/** @param {unknown} v @returns {number | null} */
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** @param {number} r */
export function isUnitRatio(r) {
  return (r >= UNIT_RATIO_LO && r <= UNIT_RATIO_HI) || (r >= 1 / UNIT_RATIO_HI && r <= 1 / UNIT_RATIO_LO);
}

/**
 * Whether a holding can arrive in a subunit: a London listing, which Yahoo quotes in pence (`GBp`).
 * @param {string} ticker @param {string | null | undefined} currency
 */
export function quotedInPence(ticker, currency) {
  return /\.L$/i.test(ticker) || currency === 'GBP' || currency === 'GBp' || currency === 'GBX';
}

/**
 * The quote with every field that is not a number of its kind taken out, or null when its last price is not a price
 * (zero, negative, not finite, missing): such a quote is not shown at all. A previous close that is not a price goes,
 * with the day's percent worked from it; so does an after-hours price that is not one, or is 100× or 1/100× the
 * quote's own last price.
 * @param {any} q
 */
export function cleanQuote(q) {
  if (!q || typeof q !== 'object') return null;
  const lastPrice = price(q.lastPrice);
  if (lastPrice == null) return null;
  const prevClose = price(q.prevClose);
  let extPrice = price(q.extPrice);
  if (extPrice != null && isUnitRatio(extPrice / lastPrice)) extPrice = null;
  return {
    ...q, lastPrice, prevClose, extPrice,
    dayPct: prevClose == null ? null : finite(q.dayPct),
    extDayPct: extPrice == null ? null : finite(q.extDayPct),
  };
}

/**
 * The band's half-width in log units for a last good quote `ageMs` old: the after-hours guard's tolerance for this name,
 * widened by the square root of the bars since, capped at ×5.
 * @param {Array<{ close?: number }> | null | undefined} bars the name's recent five-minute bars, if any are at hand
 * @param {number} ageMs
 */
export function bandWidth(bars, ageMs) {
  const tol = ahQuoteTolerance(Array.isArray(bars) ? bars : []);
  const steps = Math.max(1, (Number.isFinite(ageMs) ? ageMs : 0) / BAND_STEP_MS);
  return Math.min(Math.log1p(tol) * Math.sqrt(steps), Math.log(BAND_MAX_RATIO));
}

/**
 * How close a quote sits to another, in log units: the nearest of its last price and previous close to the other's
 * last price and previous close. Infinity when no pair can be compared.
 * @param {{ lastPrice: number, prevClose?: number | null }} q
 * @param {{ lastPrice: number, prevClose?: number | null }} ref
 */
export function distance(q, ref) {
  let best = Infinity;
  for (const a of [q.lastPrice, q.prevClose]) {
    for (const b of [ref.lastPrice, ref.prevClose]) {
      const x = price(a), y = price(b);
      if (x != null && y != null) best = Math.min(best, Math.abs(Math.log(x / y)));
    }
  }
  return best;
}

/**
 * @typedef {'edge' | 'proxy'} QuoteSource
 * @typedef {{ lastPrice: number, prevClose: number | null, at: number, own: boolean }} GoodQuote
 *   `own`: accepted by this page (false for one kept from the page's last visit)
 * @typedef {{ quote: any, source: QuoteSource, since: number, at: number, shape: 'unit' | 'jump' }} HeldQuote
 * @typedef {{ ticker: string, source: QuoteSource, shape: 'unit' | 'jump', quote: any, good: GoodQuote, width: number }} HoldReport
 * @typedef {{ ticker: string, source: QuoteSource, quote: any }} BadReport
 */

/**
 * The band's memory for one page: the last good quote of each holding and the quote held for each, if any.
 * `seed` is what the page showed on its last visit (`dp.lastPrices`) and `seedAt` when; those count as last good
 * quotes until this page's own replace them, except that the pence shape against them is believed as any other.
 * @param {{ seed?: Record<string, { lastPrice?: unknown, prevClose?: unknown }> | null, seedAt?: number }} [opts]
 */
export function createQuoteGuard({ seed = null, seedAt = 0 } = {}) {
  /** @type {Map<string, GoodQuote>} */
  const good = new Map();
  /** @type {Map<string, HeldQuote>} */
  const held = new Map();
  if (seed && seedAt > 0) {
    for (const [t, p] of Object.entries(seed)) {
      const lastPrice = price(p?.lastPrice);
      if (lastPrice != null) good.set(t, { lastPrice, prevClose: price(p?.prevClose), at: seedAt, own: false });
    }
  }

  return {
    /** Each held ticker and the source its quote came from: the next fetch asks the other source too. */
    pending() {
      /** @type {Record<string, QuoteSource>} */
      const out = {};
      for (const [t, h] of held) out[t] = h.source;
      return out;
    },

    /**
     * Screens one refresh's quotes. `quotes` and `sources` are what the fetch returned and where each came from;
     * `alt` is a second source's answer for a held ticker, when one was asked. Returns the quotes to apply, the quotes
     * newly held (to report), and the ones that were not prices at all.
     * @param {{ quotes: Record<string, any> | null | undefined, sources?: Record<string, QuoteSource>,
     *   alt?: Record<string, any> | null, now: number, barsOf?: (t: string) => Array<{ close?: number }> | null | undefined }} input
     */
    screen({ quotes, sources = {}, alt = null, now, barsOf }) {
      /** @type {Record<string, any>} */
      const accepted = {};
      /** @type {HoldReport[]} */
      const holds = [];
      /** @type {BadReport[]} */
      const bad = [];
      const tickers = new Set([...Object.keys(quotes || {}), ...Object.keys(alt || {})]);
      for (const t of tickers) {
        /** @type {{ q: any, src: QuoteSource }[]} */
        const cands = [];
        /** @type {[any, QuoteSource][]} */
        const offered = [[quotes?.[t], sources[t] === 'proxy' ? 'proxy' : 'edge'], [alt?.[t], 'proxy']];
        for (const [raw, src] of offered) {
          if (raw == null) continue;
          const q = cleanQuote(raw);
          if (q) cands.push({ q, src });
          else bad.push({ ticker: t, source: src, quote: raw });
        }
        if (cands.length === 0) continue;
        const ref = good.get(t);
        const take = (/** @type {{ q: any, src: QuoteSource }} */ c) => {
          accepted[t] = c.q;
          good.set(t, { lastPrice: c.q.lastPrice, prevClose: c.q.prevClose ?? ref?.prevClose ?? null, at: now, own: true });
          held.delete(t);
        };
        // Nothing to compare with: a new name, an IPO, a first quote with nothing kept.
        if (!ref) { take(cands[0]); continue; }
        const bars = barsOf ? barsOf(t) : null;
        const width = bandWidth(bars, now - ref.at);
        const fits = cands.find((c) => distance(c.q, ref) <= width);
        if (fits) { take(fits); continue; }
        // Nothing sits near the last good quote. Two sources agreeing with each other are believed.
        const fresh = bandWidth(bars, 0);
        if (cands.length > 1 && cands[0].src !== cands[1].src && distance(cands[0].q, cands[1].q) <= fresh) { take(cands[0]); continue; }
        const h = held.get(t);
        const same = h ? cands.find((c) => distance(c.q, h.quote) <= bandWidth(bars, now - h.at)) : null;
        if (h && same) {
          if (same.src !== h.source) { take(same); continue; }
          const strict = h.shape === 'unit' && ref.own;
          if (!strict && now - h.since >= HOLD_CONFIRM_MS) { take(same); continue; }
          h.quote = same.q; h.at = now;
          continue;
        }
        const c = cands[0];
        const shape = quotedInPence(t, c.q.currency) && isUnitRatio(c.q.lastPrice / ref.lastPrice) ? 'unit' : 'jump';
        held.set(t, { quote: c.q, source: c.src, since: now, at: now, shape });
        holds.push({ ticker: t, source: c.src, shape, quote: c.q, good: { ...ref }, width });
      }
      return { accepted, holds, bad };
    },
  };
}

/**
 * The words a hold is reported with: what came, from where, against what, and what the board does about it.
 * @param {HoldReport} h
 */
export function holdMessage(h) {
  const ratio = h.quote.lastPrice / h.good.lastPrice;
  const why = h.shape === 'unit' ? '100× off: pence for pounds' : 'outside the band';
  return `${h.ticker} ${h.quote.lastPrice} from ${h.source === 'proxy' ? 'a proxy' : 'the price function'} against ${h.good.lastPrice} (×${ratio.toPrecision(3)}, ${why}); the last good price stays until a second source agrees`;
}
