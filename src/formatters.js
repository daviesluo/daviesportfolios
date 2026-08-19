// Pure display formatters and the hidden-values mask. Lifted out of
// the since-retired utils.js barrel so a one-line component can `import { fmtMoney } from
// './formatters.js'` instead of pulling in fetch plumbing /
// portfolio math / FX / market-hours / etc. Same exports, same
// behaviour — just narrower scope.

import { isCrypto } from './ticker_class.js';

/**
 * Replaces each digit in a formatted string with a centred bullet so
 * the masked text stays vertically aligned with neighbouring real
 * numbers ("$129,341.49" → "$•••,•••.••"). Bullet is preferred over
 * asterisk because `*` sits high in the x-height of our mono font and
 * makes masked rows look elevated.
 * @param {any} s
 */
export function maskDigits(s) {
  return typeof s === 'string' ? s.replace(/\d/g, '•') : s;
}

/**
 * @param {number | null | undefined} n
 * @param {{signed?: boolean, symbol?: string, compact?: boolean, precision?: number}} [opts]
 */
export const fmtMoney = (n, opts = {}) => {
  if (n == null || isNaN(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : (opts.signed && n > 0 ? "+" : "");
  // Symbol defaults to "$" so every existing call site stays
  // byte-identical. The mobile scoreboard's currency-cycle button
  // passes "£" / "¥" to render GBP / CNY without touching anything
  // upstream of fmtMoney.
  const sym = opts.symbol ?? "$";
  // `compact: false` opts out of the M / B / T abbreviation tiers
  // and falls through to the full-digit toLocaleString path. Used
  // by the mobile scoreboard so a portfolio that's $159 K in USD
  // doesn't collapse to "¥1.08M" the moment the user cycles to
  // CNY — the user prefers the actual yuan amount over a
  // scale-units shorthand. Default `true` preserves every other
  // call site.
  if (opts.compact !== false) {
    if (abs >= 1e12) return sign + sym + (abs / 1e12).toFixed(2) + "T";
    if (abs >= 1e9) return sign + sym + (abs / 1e9).toFixed(2) + "B";
    if (abs >= 1e6) return sign + sym + (abs / 1e6).toFixed(2) + "M";
  }
  if (abs >= 1e3) return sign + sym + abs.toLocaleString(undefined, { maximumFractionDigits: 0 });
  // `precision` only affects the sub-1000 path where the default is
  // 2 (so a $5.50 lot reads as "$5.50"). The mobile scoreboard's
  // DAY CHANGE passes `precision: 0` so a sub-$1000 daily swing
  // reads as "$500" instead of "$500.00". The >=1e3 branch above
  // already uses maxFractionDigits: 0 so dollars-per-thousands
  // were always integer there.
  const prec = opts.precision ?? 2;
  return sign + sym + abs.toLocaleString(undefined, { minimumFractionDigits: prec, maximumFractionDigits: prec });
};

/**
 * @param {number | null | undefined} n
 * @param {{precision?: number}} [opts]
 */
export const fmtPct = (n, opts = {}) => {
  if (n == null || isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  // Default 2 decimals (the legacy behaviour every existing caller
  // sees). The mobile scoreboard's DAY CHANGE passes precision: 0
  // for an integer percent — see Header in header_sidebar.jsx.
  return sign + n.toFixed(opts.precision ?? 2) + "%";
};

/** @param {number | null | undefined} n */
export const fmtPrice = (n) => {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n >= 10) return n.toFixed(2);
  return n.toFixed(2);
};

/**
 * Share quantity for display — at most 2 decimal places, with no forced
 * trailing zeros (5 → "5", 18.5 → "18.5", 5.125 → "5.13", 0.3333 →
 * "0.33"). Holdings can carry fractional shares (DRIP / fractional buys)
 * with long trailing decimals; this trims the noise without padding whole
 * shares to "5.00".
 * @param {number | null | undefined} n
 * @param {number} [maxDecimals]  cap on decimal places (default 2)
 */
export const fmtShares = (n, maxDecimals = 2) => {
  if (n == null || isNaN(n)) return "—";
  return String(Number(n.toFixed(maxDecimals)));
};

/**
 * Shares formatted for a SPECIFIC ticker: crypto (`-USD`) shows up to 3
 * decimals — coin balances are often small fractions (0.043 BTC) that the
 * default 2-dp cap would round to a misleading "0.04". Everything else
 * keeps 2. Trailing zeros are still stripped (1 → "1", not "1.000").
 * @param {number | null | undefined} n
 * @param {string} ticker
 */
export const fmtSharesFor = (n, ticker) => fmtShares(n, isCrypto(ticker) ? 3 : 2);

/** @param {number | null | undefined} n */
export const pctColor = (n) => {
  if (n == null || isNaN(n) || Math.abs(n) < 0.005) return "var(--chalk-dim)";
  return n >= 0 ? "var(--gain)" : "var(--loss)";
};

// e.g. 1m 24s / 12s / 1h 03m
/** @param {number | null | undefined} ms */
export function formatAgo(ms) {
  if (ms == null || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), rs = s % 60;
  if (m < 60) return `${m}m ${String(rs).padStart(2, "0")}s`;
  const h = Math.floor(m / 60), rm = m % 60;
  return `${h}h ${String(rm).padStart(2, "0")}m`;
}

// ── Ticker display label ─────────────────────────────────────────────────
// Display-only aliases for holdings whose Yahoo symbol is an opaque
// foreign-listing code; the UI shows the company's home-market symbol
// instead. Applied AFTER the suffix strip so every variant of the
// listing (2DG / 2DG.F / 2DG.SG / 2DG.DE) maps to one label.
// 2DG = Sivers Semiconductors' German listing; its home (Nasdaq
// Stockholm) symbol is SIVE.
const TICKER_DISPLAY_ALIASES = { '2DG': 'SIVE' };

/**
 * Label for a ticker in the compact surfaces — heatmap tiles, tactics-
 * board chips, Top Movers rows. Strips the Yahoo exchange suffix
 * (XFAB.PA → XFAB, VUAG.L → VUAG, 0700.HK → 0700) so tight rows aren't
 * cluttered by ".PA" / ".L", then maps TICKER_DISPLAY_ALIASES.
 *
 * Display-only: the real symbol stays on the data everywhere it matters
 * (React keys, click handlers, the chart modal's own header) so a tap
 * still resolves the right instrument — the modal is deliberately the
 * one place that shows the true Yahoo ticker.
 *
 * Only a trailing dot + 1–4 letters is stripped, so hyphenated symbols
 * (BRK-B, BTC-USD) and ^-prefixed indices survive intact, and bare CN
 * fund codes (017731) have nothing to strip.
 */
export function displayTicker(ticker) {
  const stripped = String(ticker || '').replace(/\.[A-Za-z]{1,4}$/, '');
  return TICKER_DISPLAY_ALIASES[stripped] || stripped;
}

/**
 * "Did this row actually move?" — one threshold, shared by every
 * surface that ranks or colours a day change.
 *
 * 0.005 is the rounding boundary of the two-decimal percent the UI
 * prints: anything under it renders as "0.00%". The heatmap already
 * painted those tiles flat/neutral, but Top Movers ranked them with a
 * bare `> 0` / `< 0`, so a -0.004 % row showed up as a dark "no change"
 * tile AND as a red LOSERS entry reading "-0.00%" at the same time
 * (MSFT, 2026-08). Same number, two different verdicts.
 */
export function pctIsFlat(pct) {
  return pct == null || !isFinite(pct) || Math.abs(pct) < 0.005;
}

/**
 * Normalise a decimal field's raw input as the user types.
 *
 * Only job: give a bare leading decimal point its zero, so typing
 * `.5` in a shares / price box reads back as `0.5`. Everything else is
 * returned untouched — this runs on every keystroke, so it must never
 * fight the user mid-entry (a half-typed `0.` or `1.` has to survive).
 *
 * Purely cosmetic for the maths: `Number('.5')` is already 0.5. It's
 * the field that looked wrong, not the value.
 */
export function normalizeDecimalInput(raw) {
  const s = String(raw ?? '');
  if (s.startsWith('.')) return `0${s}`;
  if (s.startsWith('-.')) return `-0${s.slice(1)}`;
  return s;
}
