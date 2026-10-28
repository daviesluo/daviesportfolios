// IGBOT's reading (docs/agents/backtests/igbot/score.mjs, pre-registration docs/agents/reviews/2026-10-29-igbot-prereg.md
// §5-§6), written by the 2026-10-29 audit before the demo starts: the baseline, the outcome on IG's hour bars, the Brier
// difference and its bootstrap, the oracle-shift guard and the money, each on numbers worked by hand; and synthetic
// forecasters with no skill (p = m, p = m shaded by a constant) that must not pass the bar, beside one with skill that does.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BAR, baseline, barsByEpic, brackets, calibration, money, mulberry32, RESAMPLES, resolveOnBars, score, SEED,
} from '../docs/agents/backtests/igbot/score.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREREG = fs.readFileSync(path.join(ROOT, 'docs/agents/reviews/2026-10-29-igbot-prereg.md'), 'utf8');
const H = 3600e3;
const T0 = Date.parse('2026-11-03T15:00:00Z');
const iso = (t) => new Date(t).toISOString();
/** An hour bar of US 500 at hour `h` after T0's hour: bid range [lo, hi], the ask 0.4 above, read after the hour ended. */
const bar = (h, lo, hi, o = {}) => ({
  epic: 'US500', hour: iso(T0 + h * H), fetched_at: iso(T0 + (h + 1) * H + 120e3),
  bid_open: lo, bid_high: hi, bid_low: lo, ask_open: lo + 0.4, ask_high: hi + 0.4, ask_low: lo + 0.4, ...o,
});
const BUY = { ts: iso(T0 + 5 * 60e3), direction: 'BUY', level: 6801, stop_level: 6761, limit_level: 6881 };

describe("IGBOT's reading", () => {
  it('the baseline is the exit side\'s driftless chance, from the entry less the spread', () => {
    // A buy at 6801 with a 0.4 spread starts its bid at 6800.6: (6800.6 − 6761) / (6881 − 6761) = 39.6 / 120 = 0.33.
    expect(baseline('BUY', 6801, 6761, 6881, 0.4)).toBeCloseTo(0.33, 10);
    // The bracket's own m (no spread) is 40 / 120 = 0.3333: the spread is worth 0.4 / 120 = 0.0033 of it.
    expect(baseline('BUY', 6801, 6761, 6881, 0)).toBeCloseTo(1 / 3, 10);
    // A sell at 6799.5, stop 6839.5, limit 6719.5, spread 0.5: its offer starts at 6800, (6839.5 − 6800) / 120 = 0.3292.
    expect(baseline('SELL', 6799.5, 6839.5, 6719.5, 0.5)).toBeCloseTo(39.5 / 120, 10);
    expect(baseline('BUY', 6801, 6801, 6881, 0.4)).toBe(null);
  });

  it('resolves a shadow bracket on the hour bars: the first side reached, never an hour that reaches both, never its start hour', () => {
    const r = (bars) => resolveOnBars(BUY, barsByEpic(bars).get('US500'));
    // The start hour (15:00) holds the entry and touches neither side; 16:00 reaches the limit.
    const up = r([bar(0, 6795, 6805), bar(1, 6800, 6885)]);
    expect(up.y).toBe(1);
    expect(up.spread).toBeCloseTo(0.4, 9);
    expect(r([bar(0, 6795, 6805), bar(1, 6790, 6810), bar(2, 6755, 6800)]).y).toBe(0);
    expect(r([bar(0, 6795, 6805), bar(1, 6755, 6885)]).excluded).toBe('ambiguous');
    expect(r([bar(0, 6760, 6805)]).excluded).toBe('ambiguous'); // the start hour reaches the stop: order unknown
    expect(r([bar(0, 6810, 6820), bar(1, 6810, 6830)]).excluded).toBe('never_filled'); // the ask never came down to 6801
    expect(r([bar(0, 6795, 6805), bar(1, 6800, 6885, { fetched_at: iso(T0 + 1.5 * H) })]).excluded).toBe('data');
    const flat = [bar(0, 6795, 6805), ...Array.from({ length: 121 }, (_, i) => bar(i + 1, 6790, 6810))];
    expect(r(flat).excluded).toBe('unresolved');
    expect(r(flat.slice(0, 30)).excluded).toBe('open');
  });

  it('counts one shadow a market each four hours, none while a real bracket is open there, and resolves real brackets by how IG closed them', () => {
    const d = (id, h, o = {}) => ({ id, ts: iso(T0 + h * H), action: 'no_action', category: 'N', epic: 'US500', direction: 'BUY', level: 6801, stop_level: 6761, limit_level: 6881, p_target: 0.4, ...o });
    const x = {
      decisions: [
        { ...d('open-1', 10), action: 'open', category: 'E', p_target: 0.5 },
        d('s-1', 0), d('s-2', 2), d('s-3', 4.5), d('s-4', 11),
      ],
      orders: [{ decision_id: 'open-1', kind: 'open', state: 'accepted', bid: 6800, offer: 6800.4 }],
      positions: [{ deal_id: 'D1', decision_id: 'open-1', epic: 'US500', direction: 'BUY', open_level: 6800.8, opened_at: iso(T0 + 10 * H), closed_at: iso(T0 + 20 * H), close_how: 'stop', state: 'closed' }],
      bars: [bar(0, 6795, 6805), bar(1, 6800, 6885), bar(4, 6795, 6805), bar(5, 6750, 6800)],
    };
    const b = Object.fromEntries(brackets(x).map((r) => [r.id, r]));
    // The real bracket's bid starts at its fill less the spread it was decided on: 6800.8 − 0.4 = 6800.4, so m = 39.4 / 120.
    expect([b['open-1'].kind, b['open-1'].y]).toEqual(['real', 0]);
    expect(b['open-1'].m).toBeCloseTo(39.4 / 120, 10);
    expect([b['s-1'].y, b['s-2'].excluded, b['s-3'].y, b['s-4'].excluded]).toEqual([1, 'dedupe', 0, 'real_open']);
    // Closed by the agent, or amended: kept out of the Brier reading.
    x.positions[0].close_how = 'bot';
    expect(brackets(x).find((r) => r.id === 'open-1')?.excluded).toBe('closed_by_bot');
    x.positions[0].close_how = 'limit';
    expect(brackets({ ...x, amended: ['D1'] }).find((r) => r.id === 'open-1')?.excluded).toBe('amended');
  });

  it('D, its bootstrap and the oracle shift, on four brackets worked by hand', () => {
    const rows = [{ p: 0.6, m: 0.4, y: 1 }, { p: 0.3, m: 0.4, y: 0 }, { p: 0.5, m: 0.4, y: 1 }, { p: 0.5, m: 0.4, y: 0 }];
    const c = calibration(rows);
    // Brier(p) = (0.16 + 0.09 + 0.25 + 0.25) / 4 = 0.1875; Brier(m) = (0.36 + 0.16 + 0.36 + 0.16) / 4 = 0.26; D = 0.0725.
    expect(c.brier_p).toBeCloseTo(0.1875, 12);
    expect(c.brier_m).toBeCloseTo(0.26, 12);
    expect(c.d).toBeCloseTo(0.0725, 12);
    // The shift: mean(y − m) = 0.1, so the baseline 0.5 everywhere: Brier 0.25, D_c = 0.0625.
    expect(c.shift_c).toBeCloseTo(0.1, 12);
    expect(c.d_c).toBeCloseTo(0.0625, 12);
    expect(c.d_p05).toBeLessThanOrEqual(c.d);
    expect(calibration(rows)).toEqual(c); // the seed makes it the same every time
    expect([SEED, RESAMPLES, BAR.minResolved]).toEqual([20261029, 10000, 150]);
    expect(mulberry32(1)()).toBe(mulberry32(1)());
  });

  // A synthetic world: 400 brackets whose true chance q differs from the baseline m by a signal; y drawn from q.
  const world = (n, seed, skew = 0) => {
    const rnd = mulberry32(seed);
    return Array.from({ length: n }, () => {
      const m = 0.25 + 0.3 * rnd();
      const q = Math.min(0.95, Math.max(0.05, m + skew + (rnd() - 0.5) * 0.4));
      return { m, q, y: rnd() < q ? 1 : 0 };
    });
  };

  it('a forecaster with no skill does not pass: p = m, or p = m shaded by a constant', () => {
    const w = world(400, 7).map((b) => ({ ...b, mOwn: b.m }));
    const noSkill = calibration(w.map((b) => ({ p: b.m, m: b.m, y: b.y })));
    expect(noSkill.d).toBeCloseTo(0, 12);
    expect(noSkill.d_p05 > 0).toBe(false);
    // The world's outcomes run below the baseline (a spread the baseline missed, say: true chance m − 0.06 on average).
    // Shading every p down by 0.06 then beats m on Brier with no skill at all, its bootstrap's 5th percentile over 0 too:
    // D alone would pass it. The oracle shift sees through it (D_c is not over 0).
    const biased = world(4000, 11, -0.06).map((b) => ({ p: b.m - 0.06, m: b.m, y: b.y }));
    const c = calibration(biased);
    expect(c.d).toBeGreaterThan(0);
    expect(c.d_p05).toBeGreaterThan(0);
    expect(c.d_c > 0).toBe(false);
  });

  it('a forecaster with skill passes the calibration bar: it knows part of what moves the true chance', () => {
    const w = world(1000, 13);
    const skilled = calibration(w.map((b) => ({ p: b.m + 0.7 * (b.q - b.m), m: b.m, y: b.y })));
    expect(skilled.d).toBeGreaterThan(0);
    expect(skilled.d_p05).toBeGreaterThan(0);
    expect(skilled.d_c).toBeGreaterThan(0);
  });

  it('the money: the arm to the last snapshot, the worst drawdown, in pounds and in units of the £10 risk', () => {
    const s = [
      { slot: '2026-11-01T00:00:00Z', equity_gbp: 9990 }, { slot: '2026-11-02T00:00:00Z', equity_gbp: 10000 }, { slot: '2026-11-03T00:00:00Z', equity_gbp: 10030 },
      { slot: '2026-11-04T00:00:00Z', equity_gbp: 9995 }, { slot: '2026-11-05T00:00:00Z', equity_gbp: 10012.5 },
    ];
    expect(money(s, '2026-11-02T00:00:00Z')).toEqual({ snapshots: 4, from: '2026-11-02T00:00:00Z', to: '2026-11-05T00:00:00Z', pnl_gbp: 12.5, pnl_risk_units: 1.25, worst_drawdown_gbp: -35 });
  });

  it('the bar needs every part: 150 resolved, D and its 5th percentile over 0, D_c over 0, P&L over 0, the total stop never hit', () => {
    const r = score({ decisions: [], snapshots: [], started_at: null });
    expect(r.passes).toBe(false);
    expect(Object.keys(r.bar)).toEqual(['resolved_150', 'd_positive', 'd_p05_positive', 'd_c_positive', 'pnl_positive', 'total_stop_never']);
    // The pre-registration names the same bar, seed and resamples.
    for (const words of ['at least **150** resolved brackets', 'mulberry32', '20261029', '10,000 resamples', 'D_c', 'docs/agents/backtests/igbot/score.mjs']) {
      expect(PREREG, words).toContain(words);
    }
  });
});
