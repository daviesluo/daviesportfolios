// Pure display formatters and the hidden-values mask. Lifted out of
// utils.js so a one-line component can `import { fmtMoney } from
// './formatters.js'` instead of pulling in fetch plumbing /
// portfolio math / FX / market-hours / etc. Same exports, same
// behaviour — just narrower scope.

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
 * @param {{signed?: boolean, symbol?: string}} [opts]
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
  if (abs >= 1e12) return sign + sym + (abs / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return sign + sym + (abs / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return sign + sym + (abs / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return sign + sym + abs.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return sign + sym + abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/** @param {number | null | undefined} n */
export const fmtPct = (n) => {
  if (n == null || isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return sign + n.toFixed(2) + "%";
};

/** @param {number | null | undefined} n */
export const fmtPrice = (n) => {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n >= 10) return n.toFixed(2);
  return n.toFixed(2);
};

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
