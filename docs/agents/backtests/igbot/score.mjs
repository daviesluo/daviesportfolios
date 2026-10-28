// IGBOT's reading (docs/agents/reviews/2026-10-29-igbot-prereg.md §5-§6), written before the demo starts, from the draft
// as the 2026-10-29 audit left it. Run from the repository root on the export `export.sql` writes:
//
//   node docs/agents/backtests/igbot/score.mjs igbot_export.json > igbot_reading.json
//
// Pure functions below; `src/igbot_score.test.js` pins them on brackets whose answers are worked by hand, and shows that a
// forecaster with no skill (p = the baseline, or the baseline moved by a constant) does not pass the bar.
//
// What it computes:
//   * every bracket, real (an open IG filled) and shadow (a `no_action` decision with a full bracket and p), with its
//     spread-adjusted driftless baseline m: a buy's limit and stop are reached by the BID, so m = (x0 − stop) / (limit −
//     stop) with x0 the bid at the start (the entry less the spread); a sell's by the OFFER, mirrored. The bracket's own
//     m (from the entry level) overstates the limit's chance by spread / (d_stop + d_limit), which a forecaster could
//     "beat" by shading every p down without any skill;
//   * its outcome y on IG's own hour bars (`igbot_bars`): 1 if the limit is reached first, 0 if the stop is; an hour that
//     reaches both, or the start's own hour reaching either, cannot be ordered and is excluded (counted); five days with
//     neither, excluded (counted); a gap of incomplete bars before it resolves, excluded (counted). A real bracket resolves
//     by how IG closed it (`igbot_positions.close_how`: limit 1, stop 0); closed by the agent or the server, or amended,
//     it is excluded from the Brier reading (counted) and kept in the money;
//   * D = Brier(m) − Brier(p) (positive: the agent is better), its paired bootstrap (10,000 resamples of brackets,
//     mulberry32 seeded 20261029) 5th and 95th percentiles, the same on real brackets alone and by category; and D_c, the
//     same against the baseline moved by the mean of (y − m) over all brackets (an oracle shift in the baseline's favour),
//     so a constant bias is not read as skill;
//   * the money from the snapshots: equity at the end less equity at the arm, the worst drawdown, the days.

export const SEED = 20261029;
export const RESAMPLES = 10000;
export const SHADOW_DEDUPE_MS = 4 * 3600e3;
export const RESOLVE_MS = 5 * 86400e3;
export const FILL_WINDOW_MS = 24 * 3600e3;
export const BAR = { minResolved: 150 };
const H = 3600e3;

/** A seeded uniform generator (mulberry32), so the bootstrap is the same on every machine. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (x) => Math.min(0.999, Math.max(0.001, x));
const num = (x) => (x === null || x === undefined || x === '' ? null : Number(x));
/** @param {number | null} bid @param {number | null} ask */
const spreadOf = (bid, ask) => (bid === null || ask === null ? null : ask - bid);

/**
 * The spread-adjusted driftless baseline of a bracket: the chance the exit side (a buy's bid, a sell's offer) reaches the
 * limit before the stop, from x0 = the entry less the spread (a buy) or plus it (a sell). Null when x0 is not inside.
 */
export function baseline(direction, entry, stop, limit, spread) {
  const s = Math.max(0, spread ?? 0);
  if (direction === 'BUY') {
    const x0 = entry - s;
    if (!(stop < x0 && x0 < limit)) return null;
    return (x0 - stop) / (limit - stop);
  }
  const x0 = entry + s;
  if (!(limit < x0 && x0 < stop)) return null;
  return (stop - x0) / (stop - limit);
}

/** Hour bars by market, complete ones flagged (read after their hour ended), ascending. */
export function barsByEpic(bars) {
  const out = new Map();
  for (const b of bars) {
    const t = Date.parse(b.hour);
    const row = {
      t, complete: Date.parse(b.fetched_at) >= t + H,
      bidHigh: num(b.bid_high), bidLow: num(b.bid_low), askHigh: num(b.ask_high), askLow: num(b.ask_low),
      spread: spreadOf(num(b.bid_open), num(b.ask_open)),
    };
    if (!out.has(b.epic)) out.set(b.epic, []);
    out.get(b.epic).push(row);
  }
  for (const list of out.values()) list.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * A shadow bracket's outcome on the hour bars: its start (the hour its entry is reachable: a buy's level at or above the
 * hour's lowest ask, a sell's at or below its highest bid, within 24 hours of its `ts`), then each later hour in turn.
 * Returns { y } or { excluded: reason }, with the start's spread.
 */
export function resolveOnBars(br, list) {
  const t0 = Date.parse(br.ts);
  const h0 = Math.floor(t0 / H) * H;
  const buy = br.direction === 'BUY';
  const path = (list ?? []).filter((b) => b.t >= h0);
  let start = null;
  for (const b of path) {
    if (b.t > h0 + FILL_WINDOW_MS) break;
    if (!b.complete) return { excluded: 'data' };
    if (buy ? br.level >= b.askLow : br.level <= b.bidHigh) { start = b; break; }
  }
  if (!start) return { excluded: 'never_filled' };
  const touches = (b) => ({
    limit: buy ? b.bidHigh >= br.limit_level : b.askLow <= br.limit_level,
    stop: buy ? b.bidLow <= br.stop_level : b.askHigh >= br.stop_level,
  });
  const first = touches(start);
  if (first.limit || first.stop) return { excluded: 'ambiguous', spread: start.spread };
  for (const b of path) {
    if (b.t <= start.t) continue;
    if (b.t > start.t + RESOLVE_MS) break;
    if (!b.complete) return { excluded: 'data', spread: start.spread };
    const x = touches(b);
    if (x.limit && x.stop) return { excluded: 'ambiguous', spread: start.spread };
    if (x.limit) return { y: 1, spread: start.spread };
    if (x.stop) return { y: 0, spread: start.spread };
  }
  const last = path.length ? path[path.length - 1].t : -Infinity;
  return { excluded: last >= start.t + RESOLVE_MS ? 'unresolved' : 'open', spread: start.spread };
}

/** Every bracket of the export, real and shadow, each with its m, p, y or the reason it is excluded. */
export function brackets(x) {
  const bars = barsByEpic(x.bars ?? []);
  const orders = new Map((x.orders ?? []).map((o) => [o.decision_id, o]));
  const amended = new Set(x.amended ?? []);
  const positions = x.positions ?? [];
  const out = [];
  const realSpans = []; // [epic, from, to] while a real bracket is open: no shadow is counted there
  for (const d of x.decisions ?? []) {
    if (d.action !== 'open') continue;
    const o = orders.get(d.id);
    const pos = positions.find((p) => p.decision_id === d.id);
    if (!o || o.state !== 'accepted' || !pos) continue;
    const spread = spreadOf(num(o.bid), num(o.offer)) ?? 0;
    const m = baseline(d.direction, num(pos.open_level), num(d.stop_level), num(d.limit_level), spread);
    const row = { id: d.id, kind: 'real', category: d.category, epic: d.epic, p: num(d.p_target), m };
    realSpans.push([d.epic, Date.parse(pos.opened_at), pos.closed_at ? Date.parse(pos.closed_at) : Infinity]);
    if (m === null) row.excluded = 'baseline';
    else if (amended.has(pos.deal_id)) row.excluded = 'amended';
    else if (pos.close_how === 'limit') row.y = 1;
    else if (pos.close_how === 'stop') row.y = 0;
    else row.excluded = pos.state === 'open' ? 'open' : `closed_by_${pos.close_how ?? 'unknown'}`;
    out.push(row);
  }
  const lastShadow = new Map();
  const shadows = (x.decisions ?? []).filter((d) => d.action === 'no_action' && d.epic && d.direction && d.level !== null && d.stop_level !== null && d.limit_level !== null && d.p_target !== null)
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  for (const d of shadows) {
    const t = Date.parse(d.ts);
    /** @type {{ id: string, kind: string, category: string, epic: string, p: number | null, m: number | null, y?: number, excluded?: string }} */
    const row = { id: d.id, kind: 'shadow', category: d.category, epic: d.epic, p: num(d.p_target), m: null };
    if (realSpans.some(([e, a, b]) => e === d.epic && t >= a && t <= b)) { out.push({ ...row, excluded: 'real_open' }); continue; }
    const prev = lastShadow.get(d.epic);
    if (prev !== undefined && t - prev < SHADOW_DEDUPE_MS) { out.push({ ...row, excluded: 'dedupe' }); continue; }
    lastShadow.set(d.epic, t);
    const br = { ts: d.ts, direction: d.direction, level: num(d.level), stop_level: num(d.stop_level), limit_level: num(d.limit_level) };
    const r = resolveOnBars(br, bars.get(d.epic));
    row.m = r.spread === undefined || r.spread === null ? null : baseline(d.direction, br.level, br.stop_level, br.limit_level, r.spread);
    if (r.excluded) row.excluded = r.excluded;
    else if (row.m === null) row.excluded = 'baseline';
    else row.y = r.y;
    out.push(row);
  }
  return out;
}

const brier = (xs, k) => xs.reduce((s, b) => s + (b[k] - b.y) ** 2, 0) / xs.length;

/** D = Brier(m) − Brier(p) and its paired bootstrap; D_c against m moved by the mean (y − m). */
export function calibration(resolved, seed = SEED, resamples = RESAMPLES) {
  const n = resolved.length;
  // No bracket: every figure is NaN (null in the JSON), and every comparison with it false.
  if (!n) return { n: 0, brier_p: NaN, brier_m: NaN, d: NaN, d_p05: NaN, d_p95: NaN, shift_c: NaN, d_c: NaN, mean_y: NaN, mean_m: NaN, mean_p: NaN };
  const rows = resolved.map((b) => ({ ...b, p: clamp(b.p), m: clamp(b.m) }));
  const c = rows.reduce((s, b) => s + (b.y - b.m), 0) / n;
  const shifted = rows.map((b) => ({ ...b, mc: clamp(b.m + c) }));
  const d = brier(rows, 'm') - brier(rows, 'p');
  const dc = brier(shifted, 'mc') - brier(shifted, 'p');
  const rnd = mulberry32(seed);
  const diffs = rows.map((b) => (b.m - b.y) ** 2 - (b.p - b.y) ** 2);
  const boot = [];
  for (let r = 0; r < resamples; r++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += diffs[Math.floor(rnd() * n)];
    boot.push(s / n);
  }
  boot.sort((a, b) => a - b);
  const pct = (q) => boot[Math.min(boot.length - 1, Math.floor(q * boot.length))];
  return {
    n, brier_p: brier(rows, 'p'), brier_m: brier(rows, 'm'), d, d_p05: pct(0.05), d_p95: pct(0.95), shift_c: c, d_c: dc,
    mean_y: rows.reduce((s, b) => s + b.y, 0) / n, mean_m: rows.reduce((s, b) => s + b.m, 0) / n, mean_p: rows.reduce((s, b) => s + b.p, 0) / n,
  };
}

/** The money from the five-minute snapshots: the arm's equity to the last, the worst drawdown. */
export function money(snapshots, startedAt) {
  const t0 = startedAt ? Date.parse(startedAt) : -Infinity;
  const s = (snapshots ?? []).filter((r) => r.equity_gbp !== null && Date.parse(r.slot) >= t0).map((r) => ({ t: r.slot, e: Number(r.equity_gbp) }));
  if (!s.length) return { snapshots: 0 };
  let peak = s[0].e, dd = 0;
  for (const r of s) { peak = Math.max(peak, r.e); dd = Math.min(dd, r.e - peak); }
  const pnl = s[s.length - 1].e - s[0].e;
  return { snapshots: s.length, from: s[0].t, to: s[s.length - 1].t, pnl_gbp: Math.round(pnl * 100) / 100, pnl_risk_units: Math.round((pnl / 10) * 100) / 100, worst_drawdown_gbp: Math.round(dd * 100) / 100 };
}

/** The whole reading and the bar (§6): every part, and whether it is met. */
export function score(x) {
  const all = brackets(x);
  const resolved = all.filter((b) => b.y === 0 || b.y === 1);
  const excluded = {};
  for (const b of all) if (b.excluded) excluded[b.excluded] = (excluded[b.excluded] ?? 0) + 1;
  const cal = calibration(resolved);
  const real = calibration(resolved.filter((b) => b.kind === 'real'));
  const byCategory = Object.fromEntries(['E', 'R', 'N'].map((k) => [k, calibration(resolved.filter((b) => b.category === k))]));
  const m = money(x.snapshots, x.started_at);
  const bar = {
    resolved_150: cal.n >= BAR.minResolved,
    d_positive: cal.n > 0 && cal.d > 0,
    d_p05_positive: cal.n > 0 && cal.d_p05 > 0,
    d_c_positive: cal.n > 0 && cal.d_c > 0,
    pnl_positive: (m.pnl_gbp ?? 0) > 0,
    total_stop_never: !x.total_stop_hit,
  };
  return { brackets: all.length, resolved: resolved.length, excluded, calibration: cal, real, by_category: byCategory, money: m, bar, passes: Object.values(bar).every(Boolean) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import('node:fs');
  const x = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  process.stdout.write(JSON.stringify(score(x), null, 1) + '\n');
}
