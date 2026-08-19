// Pure helpers for the Investment Performance rendering of the
// performance panel. Kept out of the JSX so the axis maths and the
// legend arithmetic can be pinned without mounting React.

/**
 * Round a raw axis step up to a "nice" one — 1, 2, 2.5 or 5 times a
 * power of ten. Dollar axes span anything from a few hundred to
 * millions, so the step has to be derived rather than picked from the
 * fixed ladder the percentage axis uses.
 *
 * @param {number} raw
 * @returns {number}
 */
export function niceStep(raw) {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/**
 * Tick values covering [min, max] with roughly `target` gridlines.
 *
 * Deliberately does NOT force zero onto the axis. The percentage chart
 * wants a zero line because zero is the comparison; a dollar chart of a
 * $167k book with a $129k deposit line would waste 77 % of its height
 * getting down to $0 and flatten both lines into the top edge.
 *
 * @param {number} min
 * @param {number} max
 * @param {number} [target]
 * @returns {number[]}
 */
export function moneyTicks(min, max, target = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (max === min) return [min];
  const step = niceStep((max - min) / Math.max(1, target));
  /** @type {number[]} */
  const out = [];
  const first = Math.ceil(min / step) * step;
  // Guard the loop against a degenerate step so a bad range can't hang
  // the render.
  for (let t = first, i = 0; t <= max + step * 1e-9 && i < 64; t += step, i++) {
    out.push(Math.abs(t) < step * 1e-9 ? 0 : t);
  }
  return out;
}

/**
 * Compact money for an axis tick: `$1.2M`, `$167k`, `$950`. Negative
 * values keep the sign in front of the symbol (`-$1.2k`) the way the
 * rest of the app writes losses.
 *
 * @param {number} n
 * @returns {string}
 */
export function fmtAxisMoney(n) {
  if (!Number.isFinite(n)) return '';
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return `${sign}$${a.toFixed(0)}`;
}

/**
 * Full money for the crosshair chip — thousands separators, no cents.
 * Cents on a six-figure book are noise, and the chip is 40px wide.
 *
 * @param {number} n
 * @returns {string}
 */
export function fmtChipMoney(n) {
  if (!Number.isFinite(n)) return '';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
}

/**
 * A line's move across the window it is drawn over, as a percentage of
 * where it started. This is what the legend reports for each line —
 * the user asked for the difference-between-the-lines ("gain") figure
 * to go and for each line to carry its own move instead.
 *
 * Returns null when the first point is non-positive: a percentage of
 * zero deposited is not a number anyone should be shown.
 *
 * @param {Array<{v: number}>} series
 * @returns {number | null}
 */
export function windowPct(series) {
  if (!Array.isArray(series) || series.length < 2) return null;
  const first = series[0]?.v;
  const last = series[series.length - 1]?.v;
  if (!Number.isFinite(first) || !Number.isFinite(last) || !(first > 0)) return null;
  return ((last - first) / first) * 100;
}

/**
 * Where the recorded series takes over from the reconstructed one.
 *
 * Everything left of this index is drawn faded with a dotted rule at the
 * handover, and its crosshair readings are prefixed `~`: those points
 * are what the ledger and Yahoo's bars imply the book was worth, not
 * something anybody wrote down at the time. Returns -1 when the whole
 * window is reconstructed, 0 when the whole window is recorded.
 *
 * @param {Array<{date: string}>} series
 * @param {number | null} recordedFromMs
 * @param {(date: string) => number} toMs
 * @returns {number}
 */
export function provenanceSplitIndex(series, recordedFromMs, toMs) {
  if (!Array.isArray(series) || series.length === 0) return -1;
  if (recordedFromMs == null || !Number.isFinite(recordedFromMs)) return -1;
  for (let i = 0; i < series.length; i++) {
    const t = toMs(series[i].date);
    if (Number.isFinite(t) && t >= recordedFromMs) return i;
  }
  return -1;
}
