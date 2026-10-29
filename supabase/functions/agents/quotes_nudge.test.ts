// The USDC-GBP fair nudge (quotes_nudge.ts, "Stablecoin quotes variant-7", 0169): its arithmetic as REVX-FAIR's replay computed
// it (docs/agents/backtests/fair_price/scripts/replay.py, lead.py: an EMA of Coinbase's mid / fair − 1 with a 24-hour HALF-LIFE,
// updated only on minutes with both, dev = g − e after the minute's move, f′ = f (1 + 0.5 dev) under a 50 bps cap; the touch
// read at t − 1 ms and at most 5 minutes before it), the rule's settings, and the executor's side (`nudgedInputs`).

import { assert, assertAlmostEquals, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FAIR_NUDGE_DEFAULTS, newNudgeState, nudgedFair, nudgeRow, nudgeStep, parseFairNudge, touchAt, type Touch } from "./quotes_nudge.ts";
import { nudgedInputs, type BookInputs } from "./quotes_live.ts";

const M = 60e3;
const T = Date.parse("2026-10-30T10:00:00Z");
const RULE = parseFairNudge({ from: "2026-10-30T00:00:00Z", book: "USDC-GBP", w: 0.5, halfLifeMin: 1440 });

Deno.test("the rule: from and book required, the study's settings by default, anything else refused", () => {
  assertEquals(RULE, { from: Date.parse("2026-10-30T00:00:00Z"), book: "USDC-GBP", w: 0.5, halfLifeMin: 1440, staleMs: 5 * M, capFrac: 0.005, warmMs: 72 * 3600e3 });
  assertEquals(parseFairNudge({ from: "2026-10-30T00:00:00Z", book: "USDC-GBP" }), RULE);
  assertEquals([FAIR_NUDGE_DEFAULTS.w, FAIR_NUDGE_DEFAULTS.halfLifeMin], [0.5, 1440]);
  assertThrows(() => parseFairNudge({ book: "USDC-GBP" }), Error, `needs "from"`);
  assertThrows(() => parseFairNudge({ from: "2026-10-30T00:00:00Z", book: "USDC-EUR" }), Error, `needs "book"`);
  assertThrows(() => parseFairNudge({ from: "2026-10-30T00:00:00Z", book: "USDC-GBP", w: 0 }), Error, `"w"`);
  assertThrows(() => parseFairNudge({ from: "2026-10-30T00:00:00Z", book: "USDC-GBP", w: 1.5 }), Error, `"w"`);
  assertThrows(() => parseFairNudge({ from: "2026-10-30T00:00:00Z", book: "USDC-GBP", halfLifeMin: 30 }), Error, `"halfLifeMin"`);
});

Deno.test("the touch a minute reads: the latest stamped at or before t − 1 ms, none when over 5 minutes before t − 1 ms", () => {
  const touches: Touch[] = [[T - 10 * M, 0.75], [T - 2 * M, 0.751], [T, 0.752]];
  assertEquals(touchAt(touches, T, 5 * M), [T - 2 * M, 0.751]);          // the one stamped AT t is not read: t − 1 ms is before it
  assertEquals(touchAt(touches, T + 1, 5 * M), [T, 0.752]);
  assertEquals(touchAt([[T - 2 * M, 0.751]], T - 2 * M + 5 * M + 1, 5 * M), [T - 2 * M, 0.751]); // exactly 5 minutes before t − 1 ms: read
  assertEquals(touchAt([[T - 6 * M, 0.75]], T, 5 * M), null);           // over 5 minutes: stale
  assertEquals(touchAt([[T - 5 * M - 1, 0.75]], T, 5 * M), [T - 5 * M - 1, 0.75]);
  assertEquals(touchAt([[T - 5 * M - 2, 0.75]], T, 5 * M), null);
  assertEquals(touchAt([], T, 5 * M), null);
});

Deno.test("a minute: the EMA moves by 1 − 0.5^(minutes / 1440), dev is g less the moved EMA, f′ = f (1 + 0.5 dev); dark, stale and the cap fall back", () => {
  const s = newNudgeState(), f = 0.7554;
  // The first minute with both sets the EMA to g: dev 0, f unchanged but not a fallback.
  const r0 = nudgeStep(s, T, f, [T - 30e3, f * 1.0002], RULE);
  assertAlmostEquals(r0.ema!, 0.0002, 1e-12);
  assertEquals([r0.dev, r0.fairNudged, r0.fallback], [0, f, null]);
  // A jump of g to 22 bps one minute later: e moves by α = 1 − 0.5^(1/1440) of the gap.
  const a = 1 - Math.pow(0.5, 1 / 1440);
  const r1 = nudgeStep(s, T + M, f, [T + 30e3, f * 1.0022], RULE);
  const e1 = 0.0002 + a * (0.0022 - 0.0002);
  assertAlmostEquals(r1.ema!, e1, 1e-12);
  assertAlmostEquals(r1.dev!, 0.0022 - e1, 1e-12);
  assertAlmostEquals(r1.fairNudged!, f * (1 + 0.5 * (0.0022 - e1)), 1e-12);
  // Half-life: after 1,440 minutes with no touch, one minute's move is half the gap (Δ is the minutes since the EMA last moved).
  const sGap = { ...s };
  const r2 = nudgeStep(sGap, T + M + 1440 * M, f, [T + 1440 * M, f * (1 + e1 + 0.002)], RULE);
  assertAlmostEquals(r2.ema!, e1 + 0.5 * 0.002, 1e-12);
  // Stale: the EMA does not move, f is left, and it says so.
  const before = s.ema;
  assertEquals(nudgeStep(s, T + 2 * M, f, null, RULE), { minute: T + 2 * M, fair: f, cbMid: null, cbAt: null, ema: before, dev: null, fairNudged: f, fallback: "stale" });
  assertEquals(s.ema, before);
  // Dark: no fair, nothing priced.
  assertEquals(nudgeStep(s, T + 3 * M, null, [T + 2 * M, f], RULE).fallback, "dark");
  // The cap: a deviation of 50 bps or more leaves f (the EMA still moves).
  const c = newNudgeState();
  nudgeStep(c, T, f, [T, f], RULE);
  const rc = nudgeStep(c, T + M, f, [T + M - 1, f * 1.006], RULE);
  assertEquals([rc.fallback, rc.fairNudged], ["cap", f]);
  assert(c.ema! > 0);
});

Deno.test("the executor's side: the replica's record of the minute it carries out moves fair on the rule's book alone, from its instant", () => {
  const i: BookInputs = { f: 0.7554, fairU: 1, x: 1.3238, usdLast: 1, usdHourEnd: T - 3600e3 };
  const rec = { minute: T, fair: 0.7554, cbMid: 0.7561, cbAt: T - 30e3, ema: 0.0002, dev: 0.0008, fairNudged: 0.7554 * 1.0004, fallback: null };
  assertAlmostEquals(nudgedInputs(i, "USDC-GBP", T, RULE, rec).f!, 0.7554 * 1.0004, 1e-12);
  assertEquals(nudgedInputs(i, "USDT-GBP", T, RULE, rec), i);                       // another book
  assertEquals(nudgedInputs(i, "USDC-GBP", T, undefined, rec), i);                  // no rule: the inputs exactly
  assertEquals(nudgedInputs(i, "USDC-GBP", T + M, RULE, rec), i);                   // a record of another minute
  assertEquals(nudgedInputs(i, "USDC-GBP", T, { ...RULE, from: T + M }, rec), i);   // before its instant
  assertEquals(nudgedInputs(i, "USDC-GBP", T, RULE, { ...rec, fallback: "stale" as const, dev: null }), i);
  assertEquals(nudgedInputs({ ...i, f: null }, "USDC-GBP", T, RULE, rec).f, null);  // dark stays dark
  assertEquals(nudgedFair(0.7554, null, 0.5), 0.7554);
});

Deno.test("a record as agent_quote_twin_nudge keeps it", () => {
  assertEquals(nudgeRow("u300nudge", "USDC-GBP", { minute: T, fair: 0.75, cbMid: 0.751, cbAt: T - 1000, ema: 0.001, dev: 0.0003, fairNudged: 0.7501125, fallback: null }), {
    twin_id: "u300nudge", book: "USDC-GBP", minute: "2026-10-30T10:00:00.000Z", fair: 0.75, cb_mid: 0.751, cb_at: "2026-10-30T09:59:59.000Z", ema: 0.001, dev: 0.0003,
    fair_nudged: 0.7501125, fallback: null,
  });
});
