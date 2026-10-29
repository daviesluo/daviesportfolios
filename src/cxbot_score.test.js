// CXBOT's reading (docs/agents/backtests/cxbot/score.mjs, pre-registration docs/agents/reviews/2026-10-29-cxbot-phase1-prereg.md
// §5-§6), pinned before the test starts: the outcome on the tape (the same rule as the server's `resolveOnTape`, on the same
// minutes as `supabase/functions/cxbot/rules.test.ts`), D and its block bootstrap and the oracle shift worked by hand, the
// three layers' rows, and, on simulated martingale tapes, forecasters with no skill that must not pass beside ones that do.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BAR, BLOCK_DAYS, calibration, fractionOf, futile, layerA, layerC, mOf, mulberry32, RESAMPLES, resolve, score, SEED, SHAKEDOWN_MS, tapeOf,
} from '../docs/agents/backtests/cxbot/score.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREREG = fs.readFileSync(path.join(ROOT, 'docs/agents/reviews/2026-10-29-cxbot-phase1-prereg.md'), 'utf8');
const M = 60e3, H = 3600e3, DAY = 86400e3;
const T = Date.parse('2026-11-04T08:00:00Z');
const iso = (t) => new Date(t).toISOString();
const mi = (t, o, h, l, c) => ({ t, o, h, l, c });

describe("CXBOT's reading", () => {
  it('resolves on the tape as the server does: the first side, an ambiguous minute both ways, a timeout at its fraction', () => {
    const b = { dir: 'long', start: T, stop: 97.5, limit: 105, holdMs: 10 * M };
    const flat = (k, c = 100) => mi(T + k * M, 100, 101, 99, c);
    expect(resolve(b, [flat(0), flat(1), mi(T + 2 * M, 100, 105, 100, 104)])).toEqual({ y: 1, how: 'limit' });
    expect(resolve(b, [flat(0), mi(T + M, 100, 100, 97.5, 98)])).toEqual({ y: 0, how: 'stop' });
    expect(resolve(b, [flat(0), mi(T + M, 100, 106, 97, 100)])).toEqual({ y: 0, yAlt: 1, how: 'ambiguous' });
    const ten = Array.from({ length: 10 }, (_, k) => flat(k, k === 9 ? 102.5 : 100));
    expect(resolve(b, ten).y).toBeCloseTo((102.5 - 97.5) / 7.5, 12);
    expect(resolve(b, ten.slice(0, 8))).toEqual({ pending: true });
    expect(resolve(b, [flat(0), flat(1), flat(9, 99)]).y).toBeCloseTo(1.5 / 7.5, 12);
    expect([fractionOf('short', 102, 96, 99), mOf('short', 100, 102, 96)]).toEqual([0.5, 1 / 3]);
  });

  it('D, its block bootstrap and the oracle shift per cell, on four brackets worked by hand', () => {
    const rows = [
      { p: 0.6, m: 0.4, y: 1, cell: 'BTC-long', day: '2026-11-05' }, { p: 0.3, m: 0.4, y: 0, cell: 'BTC-long', day: '2026-11-05' },
      { p: 0.5, m: 0.4, y: 1, cell: 'ETH-short', day: '2026-11-06' }, { p: 0.5, m: 0.4, y: 0.5, cell: 'ETH-short', day: '2026-11-07' },
    ];
    const c = calibration(rows, { resamples: 200 });
    // Brier(p) = (0.16 + 0.09 + 0.25 + 0) / 4 = 0.125; Brier(m) = (0.36 + 0.16 + 0.36 + 0.01) / 4 = 0.2225.
    expect(c.brier_p).toBeCloseTo(0.125, 12);
    expect(c.brier_m).toBeCloseTo(0.2225, 12);
    expect(c.d).toBeCloseTo(0.0975, 12);
    // The shift: BTC-long's mean (y − m) is 0.1, so its m is 0.5; ETH-short's is 0.35, so 0.75.
    // D_c = [(0.25 − 0.16) + (0.25 − 0.09) + (0.0625 − 0.25) + (0.0625 − 0)] / 4 = 0.03125.
    expect(c.d_c).toBeCloseTo(0.03125, 12);
    expect(c.d_p05).toBeLessThanOrEqual(c.d_p95);
    expect(calibration(rows, { resamples: 200 })).toEqual(c);
    expect([SEED, RESAMPLES, BLOCK_DAYS, SHAKEDOWN_MS, BAR.answeredShare, BAR.minOwn]).toEqual([20261029, 10000, 7, 48 * H, 0.9, 60]);
    expect(mulberry32(7)()).toBe(mulberry32(7)());
  });

  it("layer A: after the shakedown only, the unanswered counted, every outcome recomputed from the tape (the server's y ignored)", () => {
    const start = Date.parse('2026-11-01T00:00:00Z');
    const q = (id, issued, o = {}) => ({ id, layer: 'A', issued_at: iso(issued), coin: 'BTC', direction: 'long', start_at: iso(issued + 20 * M), entry: 100, stop: 98, limit_px: 104, hold_ms: 2 * H, state: 'scoring', y: 0.999, ...o });
    const t1 = start + 3 * DAY;
    const tape = [];
    for (let k = 0; k < 200; k++) tape.push({ coin: 'BTC', t: iso(t1 + 20 * M + k * M), o: 100, h: k === 50 ? 104 : 100.5, l: 99.5, c: 100 });
    const x = { started_at: iso(start), questions: [q('early', start + H), q('a1', t1), q('a2', t1, { id: 'a2' })], forecasts: [{ question_id: 'early', p: 0.5 }, { question_id: 'a1', p: 0.4 }], tape };
    const a = layerA(x, tapeOf(x.tape));
    expect([a.issued, a.answered, a.rows.length]).toEqual([2, 1, 1]);
    expect(a.rows[0]).toMatchObject({ id: 'a1', y: 1, how: 'limit', cell: 'BTC-long' });
    expect(a.rows[0].m).toBeCloseTo(1 / 3, 12);
  });

  it('layer C: a real bracket on its original levels, a shadow from its first reachable minute, one a coin each four hours, none beside a real one', () => {
    const start = Date.parse('2026-11-01T00:00:00Z'), t1 = start + 3 * DAY;
    const tape = [];
    for (let k = 0; k < 8 * 24 * 60; k++) {
      const t = t1 + k * M;
      tape.push({ coin: 'SOL', t: iso(t), o: 180, h: k === 30 ? 182.6 : 180.5, l: 179.5, c: 180 });
      tape.push({ coin: 'BTC', t: iso(t), o: 100, h: 100.5, l: k === 100 ? 97 : 99.5, c: 100 });
    }
    const x = {
      started_at: iso(start),
      positions: [{ id: 1, coin: 'BTC', direction: 'long', entry: 100, stop0: 98, limit0: 104, p: 0.45, opened_at: iso(t1 + 10 * M + 5e3), closed_at: iso(t1 + 12 * M) }],
      decisions: [
        { id: 's1', action: 'no_action', ts: iso(t1), received_at: iso(t1), coin: 'SOL', direction: 'long', entry: 182.5, stop: 176.9, limit_px: 194, p: 0.38 },
        { id: 's2', action: 'no_action', ts: iso(t1 + H), received_at: iso(t1 + H), coin: 'SOL', direction: 'long', entry: 181, stop: 176, limit_px: 191, p: 0.38 },
        { id: 's3', action: 'no_action', ts: iso(t1 + 11 * M), received_at: iso(t1 + 11 * M), coin: 'BTC', direction: 'short', entry: 100, stop: 102, limit_px: 96, p: 0.4 },
        { id: 's4', action: 'no_action', ts: iso(t1 + 5 * H), received_at: iso(t1 + 5 * H), coin: 'SOL', direction: 'long', entry: 300, stop: 290, limit_px: 320, p: 0.4 },
      ],
      tape,
    };
    const c = layerC(x, tapeOf(x.tape));
    const by = Object.fromEntries(c.rows.map((r) => [r.id, r]));
    // The real bracket: opened inside minute 10, judged from minute 11; minute 100 trades through 98: the stop.
    expect([by['pos-1'].kind, by['pos-1'].y, by['pos-1'].p]).toEqual(['real', 0, 0.45]);
    // s1 is reached at minute 30 (182.6 ≥ 182.5); then a week of 179.5–180.5: a timeout at 180 between 176.9 and 194.
    expect(by.s1.y).toBeCloseTo((180 - 176.9) / (194 - 176.9), 12);
    expect(c.excluded).toEqual({ dedupe: 1, real_open: 1, never_filled: 1 });
  });

  it('audit F1: a shadow runs on the server\'s receipt, never on the ts the agent writes (the journal takes one 7 days old)', () => {
    const start = Date.parse('2026-11-01T00:00:00Z'), t1 = start + 3 * DAY;
    const tape = [];
    // SOL reaches 182.5 at minute 30 and its limit (194) at minute 60; after two hours it sits at 180.
    for (let k = 0; k < 8 * 24 * 60; k++) tape.push({ coin: 'SOL', t: iso(t1 + k * M), o: 180, h: k === 30 ? 182.6 : k === 60 ? 195 : 180.5, l: 179.5, c: 180 });
    const shadow = { id: 'late', action: 'no_action', ts: iso(t1), received_at: iso(t1 + 2 * H), coin: 'SOL', direction: 'long', entry: 182.5, stop: 176.9, limit_px: 194, p: 0.95 };
    const c = layerC({ started_at: iso(start), decisions: [shadow], tape }, tapeOf(tape));
    // On its own ts it would score y = 1 at p 0.95: a move already made, booked as a forecast.
    expect(c.rows).toEqual([]);
    expect(c.excluded).toEqual({ never_filled: 1 });
    expect(layerC({ started_at: iso(start), decisions: [{ ...shadow, received_at: undefined }], tape }, tapeOf(tape)).excluded).toEqual({ no_receipt: 1 });
  });

  it('audit F9, F10, F11: a fill on a minute boundary starts there; a voided question is not issued; the P&L counts from the shakedown\'s end', () => {
    const start = Date.parse('2026-11-01T00:00:00Z'), t1 = start + 3 * DAY;
    const tape = [];
    for (let k = 0; k < 8 * 24 * 60; k++) tape.push({ coin: 'BTC', t: iso(t1 + k * M), o: 100, h: 100.5, l: k === 10 ? 97 : 99.5, c: 100 });
    const pos = { id: 1, coin: 'BTC', direction: 'long', entry: 100, stop0: 98, limit0: 104, p: 0.45, opened_at: iso(t1 + 10 * M), closed_at: null };
    const c = layerC({ started_at: iso(start), positions: [pos], tape }, tapeOf(tape));
    expect([c.rows[0].y, c.rows[0].day]).toEqual([0, '2026-11-04']); // the stop in the fill's own (first) minute
    const q = (id, o = {}) => ({ id, layer: 'A', issued_at: iso(t1), coin: 'BTC', direction: 'long', start_at: iso(t1 + 20 * M), entry: 100, stop: 98, limit_px: 104, hold_ms: 2 * H, state: 'scoring', ...o });
    const a = layerA({ started_at: iso(start), questions: [q('a'), q('v', { state: 'void', start_at: null })], forecasts: [{ question_id: 'a', p: 0.4 }] }, tapeOf(tape));
    expect([a.issued, a.answered, a.voided]).toEqual([1, 1, 1]);
    const snaps = [{ slot: iso(start + H), equity_usd: 990 }, { slot: iso(start + 47 * H), equity_usd: 985 }, { slot: iso(start + 50 * H), equity_usd: 992 }, { slot: iso(start + 60 * H), equity_usd: 995 }];
    const m = score({ started_at: iso(start), questions: [], tape: [], snapshots: snaps }, { resamples: 20 }).money;
    expect([m.equity_at_start_usd, m.pnl_usd, m.pnl_whole_run_usd, m.worst_drawdown_usd]).toEqual([985, 10, -5, 0]);
  });

  // A simulated world: martingale minute paths for three coins, the assigned brackets every four hours (1 and 2 day-sd, 72 h),
  // and forecasters with and without skill. The tape is what the reading reads.
  const simulate = (days, seed) => {
    const rnd = mulberry32(seed);
    const gauss = () => { const u = Math.max(1e-12, rnd()), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const start = Date.parse('2026-11-01T00:00:00Z');
    const sig = { BTC: 0.4, ETH: 0.55, SOL: 0.7 };
    const tape = [], questions = [];
    const step = 5 * M, dt = step / (365 * DAY);
    const px = { BTC: 80000, ETH: 2400, SOL: 180 };
    const series = { BTC: [], ETH: [], SOL: [] };
    for (let t = start; t < start + (days + 4) * DAY; t += step) {
      const z = gauss();
      for (const c of ['BTC', 'ETH', 'SOL']) {
        const s = sig[c], e = 0.8 * z + 0.6 * gauss();
        const o = px[c];
        px[c] = o * Math.exp(-0.5 * s * s * dt + s * Math.sqrt(dt) * e);
        series[c].push({ t, o, h: Math.max(o, px[c]), l: Math.min(o, px[c]), c: px[c] });
      }
    }
    for (const c of ['BTC', 'ETH', 'SOL']) for (const m of series[c]) tape.push({ coin: c, t: iso(m.t), o: m.o, h: m.h, l: m.l, c: m.c });
    for (let t = start + 3 * DAY; t < start + days * DAY; t += 4 * H) {
      for (const c of ['BTC', 'ETH', 'SOL']) {
        const sd = sig[c] / Math.sqrt(365);
        const e = series[c].find((m) => m.t >= t + 20 * M);
        for (const dir of ['long', 'short']) {
          const k = dir === 'long' ? 1 : -1;
          questions.push({ id: `A-${iso(t)}-${c}-${dir}`, layer: 'A', issued_at: iso(t), coin: c, direction: dir, start_at: iso(e.t), entry: e.o, stop: e.o * (1 - k * sd), limit_px: e.o * (1 + 2 * k * sd), hold_ms: 72 * H, state: 'scoring' });
        }
      }
    }
    return { started_at: iso(start), ended_at: iso(start + days * DAY), questions, tape, forecasts: [] };
  };
  const world = simulate(30, 11);
  const tape = tapeOf(world.tape);
  const answerAll = (f) => ({ ...world, forecasts: world.questions.map((q) => ({ question_id: q.id, p: f(q) })) });
  const layerAOf = (x) => { const a = layerA(x, tape); return calibration(a.rows, { resamples: 400 }); };
  const truth = new Map(layerA(answerAll(() => 0.5), tape).rows.map((r) => [r.id, r]));

  it('forecasters with no skill do not pass layer A: p = m; p shaded to the resolved-only chance; a bull bias', () => {
    const resolvedOnly = [...truth.values()].filter((r) => r.how === 'limit' || r.how === 'stop');
    const shade = resolvedOnly.filter((r) => r.y === 1).length / resolvedOnly.length;
    expect(shade).toBeLessThan(1 / 3); // the bias the old exclusion rule would have rewarded
    for (const f of [(q) => 1 / 3, () => shade, (q) => (q.direction === 'long' ? 1 / 3 + 0.1 : 1 / 3 - 0.05)]) {
      const c = layerAOf(answerAll(f));
      expect(c.d > 0 && c.d_p05 > 0 && c.d_c > 0).toBe(false);
    }
  });

  it('a forecaster that knows the outcome in part passes layer A', () => {
    const c = layerAOf(answerAll((q) => 0.5 * (1 / 3) + 0.5 * (truth.get(q.id)?.y ?? 1 / 3)));
    expect(c.d).toBeGreaterThan(0);
    expect(c.d_p05).toBeGreaterThan(0);
    expect(c.d_c).toBeGreaterThan(0);
  });

  it('the bar needs every part; the futility look can only end the test', () => {
    const r = score({ started_at: '2026-11-01T00:00:00Z', questions: [], tape: [], snapshots: [] }, { resamples: 50 });
    expect(r.passes).toBe(false);
    expect(Object.keys(r.bar)).toEqual(['a_answered_90', 'a_passes_stop_first', 'a_passes_limit_first', 'c_own_60', 'c_d_and_d_c_positive', 'pnl_positive', 'total_stop_never', 'no_liquidation']);
    expect(futile({ layer_a: { stop_first: { n: 10, d_p95: -0.001 } } })).toBe(true);
    expect(futile({ layer_a: { stop_first: { n: 10, d_p95: 0.001 } } })).toBe(false);
    for (const words of ['mulberry32', '20261029', '10,000 resamples', 'circular blocks of 7 consecutive UTC days', 'D_c', 'docs/agents/backtests/cxbot/score.mjs', 'at least 90 %', 'at least 60 scored brackets', 'the first 48 hours']) {
      expect(PREREG, words).toContain(words);
    }
  });
});
