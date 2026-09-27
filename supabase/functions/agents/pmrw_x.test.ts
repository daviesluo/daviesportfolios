// The variants' replay (pmrw_x.ts) on stored records built by hand: an inventory cap stops the side RW still quoted and
// runs RW's own rule from there, a jump in the adjusted mid pauses a market, a category left out is never quoted, and
// the research never reads a minute of RW-E's twelve days. That an arm with RW-E's rule is RW-E, on the engine's own
// stored record, is pinned beside RW-E's own test (pmrw_e.test.ts).

import { assert, assertAlmostEquals, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { RW_RUN_START } from "./pmrw.ts";
import { RWE_START, type RweInputs } from "./pmrw_e.ts";
import { newRwxState, parseRwxSpecs, replayArms, researchRwx, type RwxSpec } from "./pmrw_x.ts";
import { memDb, type Row } from "./testing.ts";

const M = 60e3;
const X = "0xx1";
const T = (k: number) => RW_RUN_START + k * M;
const iso = (ms: number) => new Date(ms).toISOString();
const sel = (cat = "culture_fees") => ({ day: "2026-09-25", cond: X, tick: 0.01, v: 3, min_size: 20, rate: 144, end_date: "2026-12-01T00:00:00Z", q: "X", cat });
/** A minute as RW recorded it: a 0.48/0.52 book (or `mid` ± 0.02), quoting, its quotes a tick inside, and its reward. */
const row = (k: number, reward: number, mid = 0.50) => ({
  cond: X, minute: iso(T(k)), quoting: true, tick: 0.01, bb: mid - 0.02, ba: mid + 0.02, ab: mid - 0.02, aa: mid + 0.02, q1: 10, q2: 10,
  m: mid, b: mid - 0.01, a: mid + 0.01, reward,
});
/** A sale through RW's 0.49 bid in minute k, and the fill it gave RW when RW was bidding. */
const sale = (k: number) => ({ id: `p${k}`, cond: X, ts: iso(T(k) + 30e3), side: "SELL" as const, oi: 0, price: 0.47, size: 20 });
const fill = (k: number) => ({ cond: X, minute: iso(T(k)), ts: iso(T(k) + 30e3), side: "bid" as const, price: 0.49, size: 20, print_id: `p${k}` });

/**
 * Ten minutes of one market, N = 20: a sale through the bid in minutes 1–6. RW bought 20 in each of 1, 2 and 3 and then
 * stood at 3N, bidding no more and so earning nothing (its reward is the smaller side's).
 */
function capWorld(): RweInputs {
  return {
    rows: Array.from({ length: 10 }, (_, k) => row(k, k <= 3 ? 0.1 : 0)),
    fills: [1, 2, 3].map(fill),
    prints: [1, 2, 3, 4, 5, 6].map(sale),
    selection: [sel()], settlements: [], rwDays: [],
  };
}

Deno.test("an inventory cap of N stops the bid RW kept, earns nothing one-sided, and holds N where RW held 3N", () => {
  const specs: RwxSpec[] = [{ id: "cap1", noSameDayFrom: null, from: RW_RUN_START, invCap: 1 }, { id: "cap3", noSameDayFrom: null, from: RW_RUN_START, invCap: 3 }];
  const st = newRwxState(specs);
  replayArms(st, T(9), capWorld(), specs);
  const rw = st.arms.rw.acc[X], cap1 = st.arms.cap1.acc[X], cap3 = st.arms.cap3.acc[X];
  assertEquals([rw.net, rw.fills], [60, 3]);
  assertAlmostEquals(rw.reward, 0.4, 1e-12);
  // Minute 1 is RW's (it held what RW held and quoted both sides); from minute 2 its cap stops the bid, RW's does not.
  assertEquals([cap1.net, cap1.fills], [20, 1]);
  assertAlmostEquals(cap1.reward, 0.2, 1e-12);
  assertAlmostEquals(cap1.cash, -20 * 0.49, 1e-12);
  assertEquals(st.arms.cap1.diverged, [X]);
  // A cap of 3N is RW's own rule: the arm is RW to the last bit, and never ran the rule itself.
  assertEquals([cap3.net, cap3.fills, cap3.cash, cap3.reward], [rw.net, rw.fills, rw.cash, rw.reward]);
  assertEquals(st.arms.cap3.diverged, []);
});

Deno.test("a jump in the adjusted mid pauses the market for its minutes, holding and marking what it has, then RW again", () => {
  // No fills; the mid jumps 0.50 → 0.70 in minute 4 and stays.
  const inputs: RweInputs = {
    rows: Array.from({ length: 10 }, (_, k) => row(k, 0.1, k >= 4 ? 0.70 : 0.50)), fills: [], prints: [], selection: [sel()], settlements: [], rwDays: [],
  };
  const specs: RwxSpec[] = [
    { id: "p10", noSameDayFrom: null, from: RW_RUN_START, pause: { cents: 10, minutes: 3 } },
    { id: "p25", noSameDayFrom: null, from: RW_RUN_START, pause: { cents: 25, minutes: 3 } },
  ];
  const st = newRwxState(specs);
  replayArms(st, T(9), inputs, specs);
  // Minutes 4, 5 and 6 are not quoted: seven of ten rewards. A 25 ¢ threshold never trips on a 20 ¢ jump.
  assertAlmostEquals(st.arms.p10.acc[X].reward, 0.7, 1e-12);
  assertEquals(st.arms.p10.acc[X].quotedMinutes, 7);
  assertAlmostEquals(st.arms.p25.acc[X].reward, 1.0, 1e-12);
  assertAlmostEquals(st.arms.rw.acc[X].reward, 1.0, 1e-12);
  // Holding the same (nothing), it takes RW's decisions again after the pause: no minute was run through the rule.
  assertEquals(st.arms.p10.diverged, []);
  assertAlmostEquals(st.arms.p10.acc[X].lastM!, 0.70, 1e-12);
});

Deno.test("a category left out is never quoted from the arm's start, and the rule waits for `from`", () => {
  const specs: RwxSpec[] = [
    { id: "nocul", noSameDayFrom: null, from: RW_RUN_START, noCats: ["culture_fees"] },
    { id: "late", noSameDayFrom: null, from: T(5), noCats: ["culture_fees"] },
    { id: "noweather", noSameDayFrom: null, from: RW_RUN_START, noCats: ["weather_fees"] },
  ];
  const st = newRwxState(specs);
  replayArms(st, T(9), capWorld(), specs);
  assertEquals(st.arms.nocul.acc[X], undefined);
  // Before minute 5 it is RW, and holds RW's 60 from then on, marked at the mid and quoting nothing.
  assertEquals(st.arms.late.acc[X].net, 60);
  assertAlmostEquals(st.arms.late.acc[X].reward, 0.4, 1e-12);
  assertEquals([st.arms.noweather.acc[X].net, st.arms.noweather.acc[X].reward], [st.arms.rw.acc[X].net, st.arms.rw.acc[X].reward]);
});

Deno.test("RW-E's rule in an arm leaves a market out on a day its scheduled end falls inside, from the minute it starts", () => {
  const ends = { ...sel(), end_date: "2026-09-25T20:00:00Z" };
  const specs: RwxSpec[] = [{ id: "e0", noSameDayFrom: RW_RUN_START, from: RW_RUN_START }, { id: "e5", noSameDayFrom: T(5), from: T(5) }];
  const st = newRwxState(specs);
  replayArms(st, T(9), { ...capWorld(), selection: [ends] }, specs);
  assertEquals(st.arms.e0.acc[X], undefined);
  assertEquals(st.arms.e5.acc[X].net, 60);
  assertAlmostEquals(st.arms.e5.acc[X].reward, 0.4, 1e-12);
});

Deno.test("research specs are checked: short new ids, caps 1–3, pauses in range, at most twelve arms", () => {
  const ok = parseRwxSpecs({ specs: [{ id: "cap1", invCap: 1 }, { id: "p10", pause: { cents: 10, minutes: 60 } }, { id: "all", noSameDay: false }] });
  assertEquals(ok.map((s) => [s.id, s.noSameDayFrom, s.from]), [["cap1", RW_RUN_START, RW_RUN_START], ["p10", RW_RUN_START, RW_RUN_START], ["all", null, RW_RUN_START]]);
  assertThrows(() => parseRwxSpecs({ specs: [{ id: "rw" }] }));
  assertThrows(() => parseRwxSpecs({ specs: [{ id: "a" }, { id: "a" }] }));
  assertThrows(() => parseRwxSpecs({ specs: [{ id: "x", invCap: 4 }] }));
  assertThrows(() => parseRwxSpecs({ specs: [{ id: "x", pause: { cents: 0, minutes: 5 } }] }));
  assertThrows(() => parseRwxSpecs({ specs: [{ id: "x", noCats: ["DROP TABLE"] }] }));
  assertThrows(() => parseRwxSpecs({ specs: Array.from({ length: 13 }, (_, i) => ({ id: `a${i}` })) }));
  assertThrows(() => parseRwxSpecs(null));
});

Deno.test("the research stops at RW-E's first minute: nothing of its twelve days is read, whatever `until` asks", async () => {
  const late = RWE_START + 5 * M;
  const seed: Record<string, Row[]> = {
    pm_rw_minutes: [row(0, 0.1), row(1, 0.1), { ...row(0, 1000), minute: iso(late) }] as Row[],
    pm_rw_fills: [], pm_rw_prints: [],
    pm_rw_selection: [sel()] as Row[],
    pm_rw_settlements: [{ cond: X, payout: 1, settled_at: iso(late) }] as Row[],
    pm_rw_days: [],
  };
  const { db } = memDb(seed, { now: () => RWE_START + DAY_MS });
  const out = await researchRwx(db, [{ id: "a", noSameDayFrom: null, from: RW_RUN_START }], Date.parse("2026-10-05T00:00:00Z"));
  assertEquals(out.until, iso(RWE_START));
  assertEquals(out.minutes, (RWE_START - RW_RUN_START) / M);
  // The minute past the twelve days' start, worth $1,000, and the settlement after it, are in neither arm.
  assertAlmostEquals(out.arms.rw.reward, 0.2, 1e-9);
  assertAlmostEquals(out.arms.a.reward, 0.2, 1e-9);
  assert(out.arms.rw.days.length >= 1);
});

const DAY_MS = 86400e3;
