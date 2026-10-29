// CXBOT's reading (docs/agents/reviews/2026-10-29-cxbot-phase1-prereg.md §5-§6), written and pinned before the start.
// Run from the repository root on the export `export.sql` writes:
//
//   node docs/agents/backtests/cxbot/score.mjs cxbot_export.json > cxbot_reading.json
//
// Pure functions below; `src/cxbot_score.test.js` pins them on brackets worked by hand and shows that forecasters with no
// skill (p = m; p shaded toward the resolved-only chance; a drift bet) do not pass, on simulated martingale paths.
//
// It recomputes every outcome from the recorded tape (never the server's `y`):
//   * y: 1 when a minute's trades reach the limit first, 0 the stop; a minute reaching both is ambiguous and the reading
//     runs twice, stop-first and limit-first; neither by the hold: the close of the last minute inside it, as its
//     fraction between stop (0) and limit (1) (the audit's §5.1: E[y] = m for a fair price, so the baseline needs no model);
//   * layer A, the assigned brackets: D = Brier(m) − Brier(p) on the answered ones, its circular 3-day-block bootstrap
//     (10,000 resamples, mulberry32 seeded 20261029), D_c against m moved per (coin, direction) by that cell's mean (y − m);
//   * layer B, Polymarket's strikes: Brier of p against the market's mid and its last trade, a bootstrap of event days;
//   * layer C, the agent's own brackets (real paper opens on their ORIGINAL levels, shadows from their first reachable
//     minute), one per coin per four hours, none beside a real one: the same D and D_c;
//   * the money: the paper equity's last snapshot less the budget; and the bar.

export const SEED = 20261029;
export const RESAMPLES = 10000;
export const BLOCK_DAYS = 3;
export const SHAKEDOWN_MS = 48 * 3600e3;
export const BAR = { answeredShare: 0.9, minOwn: 60 };
const M = 60e3, H = 3600e3, DAY = 86400e3;
const OWN_HOLD = 7 * DAY, SHADOW_FILL = 24 * H, DEDUPE = 4 * H;

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

const num = (x) => (x === null || x === undefined || x === '' ? null : Number(x));
const ms = (s) => Date.parse(s);
const clamp = (x) => Math.min(0.999, Math.max(0.001, x));

/** Where a price stands in a bracket, from the stop (0) to the limit (1), clipped. */
export function fractionOf(dir, stop, limit, x) {
  const f = dir === 'long' ? (x - stop) / (limit - stop) : (stop - x) / (stop - limit);
  return Math.min(1, Math.max(0, f));
}

export const mOf = (dir, entry, stop, limit) => (dir === 'long' ? (entry - stop) / (limit - stop) : (stop - entry) / (stop - limit));

/** The outcome on the tape (minutes ascending, {t, o, h, l, c}): the same rule as `cxbot/rules.ts`'s `resolveOnTape`. */
export function resolve(b, minutes) {
  const end = b.start + b.holdMs;
  let last = null;
  for (const mi of minutes) {
    if (mi.t < b.start) continue;
    if (mi.t >= end) break;
    const lim = b.dir === 'long' ? mi.h >= b.limit : mi.l <= b.limit;
    const stp = b.dir === 'long' ? mi.l <= b.stop : mi.h >= b.stop;
    if (lim && stp) return { y: 0, yAlt: 1, how: 'ambiguous' };
    if (lim) return { y: 1, how: 'limit' };
    if (stp) return { y: 0, how: 'stop' };
    last = mi;
  }
  const covered = minutes.length > 0 && minutes[minutes.length - 1].t >= end - M;
  if (!covered || !last) return { pending: true };
  return { y: fractionOf(b.dir, b.stop, b.limit, last.c), how: 'timeout' };
}

/** The tape by coin, ascending, numbers. */
export function tapeOf(rows) {
  const out = /** @type {Record<string, Array<{ t: number, o: number, h: number, l: number, c: number }>>} */ ({});
  for (const r of rows ?? []) {
    const m = { t: ms(r.t), o: Number(r.o ?? NaN), h: Number(r.h ?? NaN), l: Number(r.l ?? NaN), c: Number(r.c ?? NaN) };
    if (![m.t, m.o, m.h, m.l, m.c].every(Number.isFinite)) continue;
    (out[r.coin] ??= []).push(m);
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.t - b.t);
  return out;
}

/** D, its block bootstrap and D_c over rows {p, m, y, cell, day}; `yKey` picks the outcome column. */
export function calibration(rows, { seed = SEED, resamples = RESAMPLES, blockDays = BLOCK_DAYS, yKey = 'y', baseKey = 'm' } = {}) {
  const n = rows.length;
  if (!n) return { n: 0, brier_p: NaN, brier_m: NaN, d: NaN, d_p05: NaN, d_p95: NaN, d_c: NaN };
  const xs = rows.map((r) => ({ p: clamp(r.p), m: clamp(r[baseKey]), y: r[yKey], cell: r.cell ?? 'all', day: r.day }));
  const diff = xs.map((r) => (r.m - r.y) ** 2 - (r.p - r.y) ** 2);
  const d = diff.reduce((s, v) => s + v, 0) / n;
  const shift = {};
  for (const r of xs) { const c = (shift[r.cell] ??= { s: 0, k: 0 }); c.s += r.y - r.m; c.k++; }
  const dc = xs.reduce((s, r) => { const mc = clamp(r.m + shift[r.cell].s / shift[r.cell].k); return s + (mc - r.y) ** 2 - (r.p - r.y) ** 2; }, 0) / n;
  // The circular block bootstrap over days: blocks of `blockDays` consecutive days, as many as cover the days.
  const days = [...new Set(xs.map((r) => r.day))].sort();
  const byDay = /** @type {Map<string, number[]>} */ (new Map(days.map((dd) => [dd, []])));
  xs.forEach((r, i) => byDay.get(r.day)?.push(i));
  const rnd = mulberry32(seed);
  const nb = Math.ceil(days.length / blockDays);
  const boot = [];
  for (let k = 0; k < resamples; k++) {
    let s = 0, c = 0;
    for (let b = 0; b < nb; b++) {
      const start = Math.floor(rnd() * days.length);
      for (let j = 0; j < blockDays; j++) for (const i of byDay.get(days[(start + j) % days.length]) ?? []) { s += diff[i]; c++; }
    }
    boot.push(c ? s / c : 0);
  }
  boot.sort((a, b) => a - b);
  const pct = (q) => boot[Math.min(boot.length - 1, Math.floor(q * boot.length))];
  const brier = (k) => xs.reduce((s, r) => s + (r[k] - r.y) ** 2, 0) / n;
  return { n, brier_p: brier('p'), brier_m: brier('m'), d, d_p05: pct(0.05), d_p95: pct(0.95), d_c: dc, mean_y: xs.reduce((s, r) => s + r.y, 0) / n, mean_m: xs.reduce((s, r) => s + r.m, 0) / n };
}

const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

/** Layer A: every issued bracket after the shakedown, its answer, its outcome on the tape. */
export function layerA(x, tape) {
  const t0 = ms(x.started_at) + SHAKEDOWN_MS, tEnd = x.ended_at ? ms(x.ended_at) : Infinity;
  const p = new Map((x.forecasts ?? []).map((f) => [f.question_id, num(f.p)]));
  const out = { issued: 0, answered: 0, rows: /** @type {any[]} */ ([]), pending: 0, voided: 0 };
  for (const q of x.questions ?? []) {
    if (q.layer !== 'A' || ms(q.issued_at) < t0 || ms(q.issued_at) >= tEnd) continue;
    out.issued++;
    if (q.state === 'void' || q.start_at === null) { out.voided++; continue; }
    const pv = p.get(q.id);
    if (pv === undefined || pv === null) continue;
    out.answered++;
    const b = { dir: q.direction, start: ms(q.start_at), stop: num(q.stop), limit: num(q.limit_px), holdMs: num(q.hold_ms) };
    const r = resolve(b, tape[q.coin] ?? []);
    if (r.pending) { out.pending++; continue; }
    out.rows.push({ id: q.id, p: pv, m: mOf(b.dir, num(q.entry), b.stop, b.limit), y: r.y, yAlt: r.yAlt ?? r.y, how: r.how, cell: `${q.coin}-${q.direction}`, day: dayOf(b.start) });
  }
  return out;
}

/** Layer B: the strikes after the shakedown, answered and resolved, against the mid and the last trade. */
export function layerB(x) {
  const t0 = ms(x.started_at) + SHAKEDOWN_MS;
  const p = new Map((x.forecasts ?? []).map((f) => [f.question_id, num(f.p)]));
  const rows = /** @type {any[]} */ ([]);
  for (const q of x.questions ?? []) {
    if (q.layer !== 'B' || ms(q.issued_at) < t0 || q.y === null || q.y === undefined) continue;
    const pv = p.get(q.id);
    if (pv === undefined || pv === null || num(q.pm_mid) === null) continue;
    rows.push({ p: pv, mid: num(q.pm_mid), last: num(q.pm_last) ?? num(q.pm_mid), deribit: num(q.deribit_p), y: num(q.y), day: String(q.pm_end).slice(0, 10), cell: q.coin });
  }
  return { rows, vsMid: calibration(rows, { baseKey: 'mid', blockDays: 1 }), vsLast: calibration(rows, { baseKey: 'last', blockDays: 1 }) };
}

/** Layer C: the agent's own brackets: real paper opens on their original levels, shadows from their first reachable minute. */
export function layerC(x, tape) {
  const t0 = ms(x.started_at) + SHAKEDOWN_MS, tEnd = x.ended_at ? ms(x.ended_at) : Infinity;
  const rows = /** @type {any[]} */ ([]), excluded = /** @type {Record<string, number>} */ ({});
  const ex = (k) => { excluded[k] = (excluded[k] ?? 0) + 1; };
  const real = /** @type {any[]} */ ([]);
  for (const pos of x.positions ?? []) {
    const opened = ms(pos.opened_at);
    if (opened < t0 || opened >= tEnd) continue;
    const start = Math.floor(opened / M) * M + M;
    real.push({ coin: pos.coin, from: opened, to: pos.closed_at ? ms(pos.closed_at) : Infinity });
    const b = { dir: pos.direction, start, stop: num(pos.stop0), limit: num(pos.limit0), holdMs: OWN_HOLD };
    const r = resolve(b, tape[pos.coin] ?? []);
    if (r.pending) { ex('pending'); continue; }
    rows.push({ id: `pos-${pos.id}`, kind: 'real', p: num(pos.p), m: mOf(b.dir, num(pos.entry), b.stop, b.limit), y: r.y, yAlt: r.yAlt ?? r.y, cell: `${pos.coin}-${pos.direction}`, day: dayOf(start) });
  }
  const lastShadow = new Map();
  const shadows = (x.decisions ?? []).filter((d) => d.action === 'no_action' && d.coin && d.direction && [d.entry, d.stop, d.limit_px, d.p].every((v) => num(v) !== null))
    .sort((a, b) => ms(a.ts) - ms(b.ts));
  for (const d of shadows) {
    const ts = ms(d.ts);
    if (ts < t0 || ts >= tEnd) continue;
    if (real.some((r) => r.coin === d.coin && ts >= r.from && ts <= r.to)) { ex('real_open'); continue; }
    const prev = lastShadow.get(d.coin);
    if (prev !== undefined && ts - prev < DEDUPE) { ex('dedupe'); continue; }
    lastShadow.set(d.coin, ts);
    const entry = Number(d.entry), stop = Number(d.stop), limit = Number(d.limit_px);
    const mins = tape[d.coin] ?? [];
    const from = Math.floor(ts / M) * M + M;
    const reach = mins.find((mi) => mi.t >= from && mi.t < from + SHADOW_FILL && mi.l <= entry && entry <= mi.h);
    if (!reach) { ex('never_filled'); continue; }
    const startTouches = d.direction === 'long' ? (reach.h >= limit || reach.l <= stop) : (reach.l <= limit || reach.h >= stop);
    if (startTouches) { ex('ambiguous_start'); continue; }
    const b = { dir: d.direction, start: reach.t + M, stop, limit, holdMs: OWN_HOLD };
    const r = resolve(b, mins);
    if (r.pending) { ex('pending'); continue; }
    rows.push({ id: d.id, kind: 'shadow', p: num(d.p), m: mOf(d.direction, entry, stop, limit), y: r.y, yAlt: r.yAlt ?? r.y, cell: `${d.coin}-${d.direction}`, day: dayOf(b.start) });
  }
  return { rows, excluded };
}

/** The money: the last snapshot's equity less the budget, the worst drawdown. */
export function money(snapshots, budget = 1000) {
  const s = (snapshots ?? []).map((r) => ({ t: r.slot, e: num(r.equity_usd) })).filter((r) => r.e !== null);
  if (!s.length) return { snapshots: 0, pnl_usd: 0 };
  let peak = s[0].e, dd = 0;
  for (const r of s) { peak = Math.max(peak, r.e); dd = Math.min(dd, r.e - peak); }
  const pnl = s[s.length - 1].e - budget;
  return { snapshots: s.length, from: s[0].t, to: s[s.length - 1].t, pnl_usd: Math.round(pnl * 100) / 100, pnl_units: Math.round(pnl * 10) / 100, worst_drawdown_usd: Math.round(dd * 100) / 100 };
}

const passes = (c) => c.n > 0 && c.d > 0 && c.d_p05 > 0 && c.d_c > 0;

/** The whole reading and the bar (prereg §6). `opts` lets the tests run a cheaper bootstrap. */
export function score(x, opts = {}) {
  const tape = tapeOf(x.tape);
  const A = layerA(x, tape);
  const aStop = calibration(A.rows, opts), aLimit = calibration(A.rows.map((r) => ({ ...r, y: r.yAlt })), opts);
  const B = layerB(x);
  const C = layerC(x, tape);
  const cStop = calibration(C.rows, opts), cLimit = calibration(C.rows.map((r) => ({ ...r, y: r.yAlt })), opts);
  const m = money(x.snapshots, num(x.budget_usd) ?? 1000);
  const answered = A.issued ? A.answered / A.issued : 0;
  const bar = {
    a_answered_90: answered >= BAR.answeredShare,
    a_passes_stop_first: passes(aStop),
    a_passes_limit_first: passes(aLimit),
    c_own_60: C.rows.length >= BAR.minOwn,
    c_d_and_d_c_positive: cStop.n > 0 && cStop.d > 0 && cStop.d_c > 0 && cLimit.d > 0 && cLimit.d_c > 0,
    pnl_positive: (m.pnl_usd ?? 0) > 0,
    total_stop_never: !x.total_stop_hit,
    no_liquidation: !(x.positions ?? []).some((p) => p.close_how === 'liquidation'),
  };
  return {
    layer_a: { issued: A.issued, answered: A.answered, answered_share: answered, pending: A.pending, voided: A.voided, ambiguous: A.rows.filter((r) => r.how === 'ambiguous').length, stop_first: aStop, limit_first: aLimit },
    layer_b: { n: B.rows.length, vs_mid: B.vsMid, vs_last: B.vsLast },
    layer_c: { n: C.rows.length, excluded: C.excluded, stop_first: cStop, limit_first: cLimit },
    money: m, bar, passes: Object.values(bar).every(Boolean),
  };
}

/** The futility look at day 28 (prereg §6): stop as a FAIL when layer A's bootstrap 95th percentile of D is below 0. */
export const futile = (reading) => reading.layer_a.stop_first.n > 0 && reading.layer_a.stop_first.d_p95 < 0;

if (import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import('node:fs');
  const x = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  process.stdout.write(JSON.stringify(score(x), null, 1) + '\n');
}
