// The variants' replay (pmrw_x.ts) on stored records built by hand: an inventory cap stops the side RW still quoted and
// runs RW's own rule from there, a jump in the adjusted mid pauses a market, a category left out is never quoted, and
// the research never reads a minute of RW-E's twelve days. That an arm with RW-E's rule is RW-E, on the engine's own
// stored record, is pinned beside RW-E's own test (pmrw_e.test.ts).

import { assert, assertAlmostEquals, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { quote, RW_RUN_START, type BookRow } from "./pmrw.ts";
import { printOrder, type PmPrint } from "../_shared/polymarket_public.ts";
import { newRweState, replayMinutes, RWE_START, type RweInputs } from "./pmrw_e.ts";
import {
  leanTicks, minutePrints, newRwxState, parseRwxSpecs, replayArms, researchRwx, restRow, runPmrwX, RWX_NAMES, RWX_REST_START, RWX_SPECS, RWX_START, RWX_STATE_VERSION,
  rwxArmStart, wideTicks, type RwxSpec, type RwxStored,
} from "./pmrw_x.ts";
import { rwxArmSummaries } from "./pmrw_view.ts";
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
  // The page's record of the pause, which the accounts above never read: minutes 4, 5 and 6.
  assertEquals(st.arms.p10.pauses, { [X]: [[T(4), T(7)]] });
  assertEquals(st.arms.p25.pauses, undefined);
});

Deno.test("a jump inside a pause extends it, and the page's record of it is one span", () => {
  // 0.50, then 0.70 from minute 2 and back to 0.50 from minute 4: two jumps, the second inside the first's pause.
  const mid = (k: number) => (k >= 2 && k < 4 ? 0.70 : 0.50);
  const inputs: RweInputs = {
    rows: Array.from({ length: 12 }, (_, k) => row(k, 0.1, mid(k))), fills: [], prints: [], selection: [sel()], settlements: [], rwDays: [],
  };
  const specs: RwxSpec[] = [{ id: "p", noSameDayFrom: null, from: RW_RUN_START, pause: { cents: 15, minutes: 3 } }];
  const st = newRwxState(specs);
  replayArms(st, T(11), inputs, specs);
  // Paused 2–4 by the first jump, then 4–6 by the second: minutes 2 to 6, five of twelve.
  assertEquals(st.arms.p.acc[X].quotedMinutes, 7);
  assertAlmostEquals(st.arms.p.acc[X].reward, 0.7, 1e-12);
  assertEquals(st.arms.p.pauses, { [X]: [[T(2), T(7)]] });
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

Deno.test("the tracked arms are the pre-registrations', frozen: RW-E, each rule from 2026-09-28 00:00 UTC, then x1 with its quotes moved from 10-03", () => {
  assertEquals(RWX_START, Date.parse("2026-09-28T00:00:00Z"));
  assertEquals(RWE_START, Date.parse("2026-09-27T00:00:00Z"));
  assertEquals(RWX_REST_START, Date.parse("2026-10-03T00:00:00Z"));
  // The first four exactly as `reviews/2026-09-27-polymarket-rw-variants-prereg.md` froze them.
  assertEquals(RWX_SPECS.slice(0, 4), [
    { id: "e", noSameDayFrom: RWE_START, from: RWE_START },
    { id: "x1", noSameDayFrom: RWE_START, from: RWX_START, noCats: ["weather_fees"] },
    { id: "x2", noSameDayFrom: RWE_START, from: RWX_START, pause: { cents: 15, minutes: 60 } },
    { id: "x3", noSameDayFrom: RWE_START, from: RWX_START, noCats: ["weather_fees"], pause: { cents: 15, minutes: 60 } },
  ]);
  // x4 and x5 exactly as `reviews/2026-10-02-polymarket-rw-rest-prereg.md` froze them: x1, plus where the quotes rest.
  assertEquals(RWX_SPECS.slice(4), [
    { id: "x4", noSameDayFrom: RWE_START, from: RWX_START, noCats: ["weather_fees"], rest: { rule: "wide", from: RWX_REST_START, keep: 0.9 }, seed: "x1" },
    { id: "x5", noSameDayFrom: RWE_START, from: RWX_START, noCats: ["weather_fees"], rest: { rule: "lean", from: RWX_REST_START }, seed: "x1" },
  ]);
  // Their rules before their own minute are x1's, rule for rule, which is what lets a running replay start them as x1.
  for (const s of RWX_SPECS.slice(4)) {
    const { rest: _rest, seed: _seed, ...rules } = s;
    assertEquals({ ...rules, id: "x1" }, RWX_SPECS[1], s.id);
    assertEquals([s.seed, rwxArmStart(s)], ["x1", RWX_REST_START], s.id);
  }
  // The page's names are Davies': numbered after RW-E's "variant-1"; variant-3 and -4 are x4 and x5 since 2026-10-02.
  assertEquals(RWX_NAMES, { x1: "Reward quotes variant-2", x4: "Reward quotes variant-3", x5: "Reward quotes variant-4" });
});

/**
 * Twenty minutes across RW-X's first midnight, both markets quoted by RW in every one at 0.1 of reward a minute, no
 * fills: X (culture) whose adjusted mid jumps 20 ¢ before the midnight and again at 00:03, and W (weather). Closed form:
 * RW and RW-E earn 2.0 in each; x1 drops W at midnight (1.0), x2 pauses X from 00:03 (1.3), x3 both.
 */
function midnightWorld() {
  const K = (k: number) => RWX_START + k * M;
  const X = "0xcul", W = "0xwea";
  const mk = (c: string, k: number, mid: number) => ({
    cond: c, minute: iso(K(k)), quoting: true, tick: 0.01, bb: mid - 0.02, ba: mid + 0.02, ab: mid - 0.02, aa: mid + 0.02, q1: 10, q2: 10,
    m: mid, b: mid - 0.01, a: mid + 0.01, reward: 0.1,
  });
  const xMid = (k: number) => (k < -5 ? 0.50 : k < 3 ? 0.70 : 0.50);
  const rows = [];
  for (let k = -10; k <= 9; k++) rows.push(mk(X, k, xMid(k)), mk(W, k, 0.50));
  const s = (day: string, cond: string, cat: string) => ({ day, cond, tick: 0.01, v: 3, min_size: 20, rate: 144, end_date: "2026-12-01T00:00:00Z", q: cond, cat });
  const selection = ["2026-09-27", "2026-09-28"].flatMap((day) => [s(day, X, "culture_fees"), s(day, W, "weather_fees")]);
  return { K, X, W, inputs: { rows, fills: [], prints: [], selection, settlements: [], rwDays: [] } as RweInputs };
}

Deno.test("the forward replay: every arm's day rows, RW-E's own days checked on every run once it has them, each rule from its frozen minute", async () => {
  const { K, X, W, inputs } = midnightWorld();
  // What RW and RW-E wrote for 09-27, from RW-E's own replay (pmrw_e.ts), a second implementation of the same rule.
  const rwe = { ...newRweState(), lastDecided: K(-11), dayOf: RWX_START - DAY_MS };
  const own = replayMinutes(rwe, K(9), inputs).days;
  const ownRw = own.find((d) => d.arm === "rw")!, ownE = own.find((d) => d.arm === "e")!;
  const seeded: RwxStored = { ...newRwxState(RWX_SPECS), lastDecided: K(-11), dayOf: RWX_START - DAY_MS, version: RWX_STATE_VERSION, checkEMaxUsd: 0 };
  const { db, tables } = memDb({
    agent_locks: [{ name: "pmrw-x", lease_until: iso(0), holder: null }],
    pm_rw_state: [{ id: 1, state: {}, last_minute: iso(K(5)) }],
    pm_rw_minutes: inputs.rows as unknown as Row[], pm_rw_fills: [], pm_rw_prints: [], pm_rw_settlements: [],
    pm_rw_selection: inputs.selection as unknown as Row[],
    pm_rw_days: [{ day: ownRw.day, total: ownRw.total, stress_total: ownRw.stress_total, reward: ownRw.reward, fills: ownRw.fills, capital: ownRw.capital, markets: ownRw.markets, detail: {} }],
    pm_rw_e_days: [], pm_rw_x_days: [],
    pm_rw_x_state: [{ id: 1, state: seeded as unknown as Row, last_minute: null }],
  }, { now: () => K(6) });

  // Run 1, to 00:05: 09-27 closes for every arm; RW-E has not written its day yet, so there is nothing to check it by.
  const r1 = await runPmrwX({ db, now: K(6) + 5e3, holder: "a" });
  assertEquals(r1.errors, []);
  assertEquals([r1.from, r1.to, r1.minutes, r1.days], [K(-10), K(5), 16, 7]);
  assertEquals(tables.pm_rw_x_days.map((d) => d.arm).sort(), ["e", "rw", "x1", "x2", "x3", "x4", "x5"]);
  for (const d of tables.pm_rw_x_days) {
    // Before its midnight every variant is RW-E, and RW-E is RW: one day row, seven times.
    assertEquals([d.day, d.fills], ["2026-09-27", 0]);
    assertAlmostEquals(Number(d.reward), 2.0, 1e-12);
    assertAlmostEquals(Number(d.total), ownRw.total, 1e-12);
  }
  let st = tables.pm_rw_x_state[0].state as unknown as RwxStored;
  assertEquals([st.checkEDays, st.checkEMaxUsd], [0, 0]);
  assert(st.checkMaxUsd < 1e-12);
  assertEquals((tables.pm_rw_x_days.find((d) => d.arm === "e")!.detail as Record<string, unknown>).checkE, null);

  // RW-E's day arrives, off by 5 ¢ in its total (a planted gap); run 2 to 00:09 checks it against the day already closed.
  tables.pm_rw_e_days.push({ day: ownE.day, arm: "e", total: ownE.total + 0.05, stress_total: ownE.stress_total, reward: ownE.reward, fills: ownE.fills, capital: ownE.capital, markets: ownE.markets, detail: {} } as Row);
  tables.pm_rw_state[0].last_minute = iso(K(9));
  const r2 = await runPmrwX({ db, now: K(10) + 5e3, holder: "b" });
  assertEquals([r2.errors, r2.from, r2.to, r2.days], [[], K(6), K(9), 0]);
  st = tables.pm_rw_x_state[0].state as unknown as RwxStored;
  assertEquals(st.checkEDays, 1);
  assertAlmostEquals(st.checkEMaxUsd, 0.05, 1e-9);

  // The rules, each from its minute: x1 stopped quoting W at midnight; x2 paused X at 00:03 (not at the jump before
  // midnight) until 01:03; x3 both; RW-E is RW here; x4 and x5 are x1 until their own minute, 10-03.
  const reward = (arm: string, c: string) => st.arms[arm].acc[c].reward;
  for (const [arm, x, w] of [["rw", 2.0, 2.0], ["e", 2.0, 2.0], ["x1", 2.0, 1.0], ["x2", 1.3, 2.0], ["x3", 1.3, 1.0], ["x4", 2.0, 1.0], ["x5", 2.0, 1.0]] as const) {
    assertAlmostEquals(reward(arm, X), x, 1e-12, `${arm} X`);
    assertAlmostEquals(reward(arm, W), w, 1e-12, `${arm} W`);
    assertEquals(st.arms[arm].diverged, []);
  }
  assertEquals(st.arms.x2.pauses, { [X]: [[K(3), K(63)]] });
  assertEquals(st.arms.x1.pauses, undefined);

  // Nothing new from RW: nothing replayed. Another run holding the lease: skipped.
  assertEquals((await runPmrwX({ db, now: K(11), holder: "c" })).skipped, "nothing new from RW");
  tables.agent_locks[0].lease_until = iso(K(30));
  tables.agent_locks[0].holder = "other";
  assertEquals((await runPmrwX({ db, now: K(12), holder: "d" })).skipped, "another run holds the pmrw-x lease");
});

Deno.test("a stored state of another rule version is replayed again from RW's start", async () => {
  const { K, inputs } = midnightWorld();
  const old = { ...newRwxState(RWX_SPECS), lastDecided: K(-11), dayOf: RWX_START - DAY_MS, version: RWX_STATE_VERSION + 1, checkEMaxUsd: 0 };
  const { db, tables } = memDb({
    agent_locks: [{ name: "pmrw-x", lease_until: iso(0), holder: null }],
    pm_rw_state: [{ id: 1, state: {}, last_minute: iso(K(9)) }],
    pm_rw_minutes: inputs.rows as unknown as Row[], pm_rw_fills: [], pm_rw_prints: [], pm_rw_settlements: [],
    pm_rw_selection: inputs.selection as unknown as Row[], pm_rw_days: [], pm_rw_e_days: [], pm_rw_x_days: [],
    pm_rw_x_state: [{ id: 1, state: old as unknown as Row, last_minute: iso(K(-11)) }],
  }, { now: () => K(10) });
  const out = await runPmrwX({ db, now: K(10), holder: "h" });
  assertEquals(out.errors, []);
  assertEquals(out.from, RW_RUN_START);
  assertEquals((tables.pm_rw_x_state[0].state as unknown as RwxStored).version, RWX_STATE_VERSION);
});

Deno.test("a variant's page leaves out the fills RW made while it was paused: a round trip it sat out is not its P&L", () => {
  // X (culture) from 09-27 23:59: its adjusted mid jumps 20 ¢ at 00:02, and RW buys at 00:03 and sells at 00:04, back
  // to nothing. x2 is paused from 00:02 for an hour, holds what RW holds again after the round trip, and so never
  // diverges; its accounts have 0.3 of reward and no fill. The page must say the same: no fill, realised = total.
  const K = (k: number) => RWX_START + k * M;
  const C = "0xrt";
  const mid = (k: number) => (k < 2 ? 0.50 : 0.70);
  const rows = Array.from({ length: 11 }, (_, i) => i - 1).map((k) => ({
    cond: C, minute: iso(K(k)), quoting: true, tick: 0.01, bb: mid(k) - 0.02, ba: mid(k) + 0.02, ab: mid(k) - 0.02, aa: mid(k) + 0.02, q1: 10, q2: 10,
    m: mid(k), b: mid(k) - 0.01, a: mid(k) + 0.01, reward: 0.1,
  }));
  const fills = [
    { cond: C, minute: iso(K(3)), ts: iso(K(3) + 30e3), side: "bid" as const, price: 0.69, size: 20, print_id: "s3" },
    { cond: C, minute: iso(K(4)), ts: iso(K(4) + 30e3), side: "ask" as const, price: 0.71, size: 20, print_id: "b4" },
  ];
  const prints = [
    { id: "s3", cond: C, ts: iso(K(3) + 30e3), side: "SELL" as const, oi: 0, price: 0.66, size: 20 },
    { id: "b4", cond: C, ts: iso(K(4) + 30e3), side: "BUY" as const, oi: 0, price: 0.74, size: 20 },
  ];
  const selection = ["2026-09-27", "2026-09-28"].map((day) => ({ day, cond: C, tick: 0.01, v: 3, min_size: 20, rate: 144, end_date: "2026-12-01T00:00:00Z", q: "C", cat: "culture_fees" }));
  const st = { ...newRwxState(RWX_SPECS), lastDecided: K(-2), dayOf: RWX_START - DAY_MS };
  const out = replayArms(st, K(9), { rows, fills, prints, selection, settlements: [], rwDays: [] }, RWX_SPECS);
  assertEquals([st.arms.rw.acc[C].fills, st.arms.rw.acc[C].net, st.arms.x2.acc[C].fills, st.arms.x2.acc[C].net], [2, 0, 0, 0]);
  assertAlmostEquals(st.arms.x2.acc[C].reward, 0.3, 1e-12);
  assertEquals(st.arms.x2.diverged, []);

  const input = {
    rwState: { state: { acc: {}, meta: {} }, last_minute: iso(K(9)), last_error: null },
    xState: { state: { ...st, version: RWX_STATE_VERSION, checkEMaxUsd: 0 }, last_minute: iso(K(9)), last_error: null },
    selectionAll: selection, today: [{ day: "2026-09-28", cond: C, rank: 1, rate: 144, v: 3, min_size: 20, capital: 20, q: "C", cat: "culture_fees", end_date: "2026-12-01T00:00:00Z" }],
    latest: [{ cond: C, minute: iso(K(9)), b: 0.69, a: 0.71, m: 0.70, ours: 5, others: 5, qb: true, qa: true }],
    days: out.days, fills, nowMs: K(10),
  };
  // x2 is off the page since 2026-10-02 (Davies), as x3 since 09-28; variant-3 and -4 are x4 and x5, which say when they
  // start until 10-03 00:00 UTC. The page's handling of a paused arm is pinned below with x2 put back on it.
  const shown = rwxArmSummaries(input);
  assertEquals(shown.map((r) => [r.id, r.name, r.notStarted, r.startsAt]), [
    ["x1", "Reward quotes variant-2", false, iso(RWX_START)],
    ["x4", "Reward quotes variant-3", true, iso(RWX_REST_START)], ["x5", "Reward quotes variant-4", true, iso(RWX_REST_START)],
  ]);
  const page = rwxArmSummaries({ ...input, offPage: new Set(["x3"]) });
  const x1 = page.find((r) => r.id === "x1")!, x2 = page.find((r) => r.id === "x2")!;
  // Each counts from its own first minute, 00:00 (Davies, 2026-09-27): 23:59's reward was RW-E's, and is in the base.
  assertAlmostEquals(st.arms.x2.base![C].reward, 0.1, 1e-12);
  // x1 is RW here (a culture market): both fills, the round trip's 0.40 realised with the ten rewards from 00:00.
  assertEquals([x1.fills, x1.recent.length], [2, 2]);
  assertAlmostEquals(x1.realisedUsd, 1.0 + 0.4, 1e-9);
  // x2 sat it out: no fill listed, realised is its rewards (00:00 and 00:01, then paused) and equals its total, and
  // nothing is left unexplained.
  assertEquals([x2.fills, x2.recent.length], [0, 0]);
  assertAlmostEquals(x2.totalUsd, 0.2, 1e-9);
  assertAlmostEquals(x2.realisedUsd, 0.2, 1e-9);
  assertAlmostEquals(x2.mismatchUsd, 0, 1e-9);
  // Paused now, so its quote is not shown; x1's is.
  const q = (r: typeof x1) => r.markets.map((m) => [m.bid, m.ask]);
  assertEquals([q(x1), q(x2)], [[[0.69, 0.71]], [[null, null]]]);
});

Deno.test("variant-4 (x3) is x1 on every weather market and x2 on every other, market by market, which is why it left the page", () => {
  // Davies (2026-09-28) asked whether variant-4's figures follow from variant-2's and variant-3's, and took it off the
  // page when they did. Each of its rules acts on one market at a time and no account reads another market's, so on a
  // weather market x3 does what x1 does (not quoted, by category) and elsewhere what x2 does (paused after a jump). Here
  // both rules bite: culture market C jumps 20 ¢ at 00:02 and RW makes a round trip in it, which x2 and x3 sit out; weather
  // market W never jumps and RW buys in it at 00:05, which x2 takes and x1 and x3 do not.
  const K = (k: number) => RWX_START + k * M;
  const C = "0xc4", W = "0xw4";
  const midC = (k: number) => (k < 2 ? 0.50 : 0.70), midW = () => 0.40;
  const book = (cond: string, mid: (k: number) => number) => Array.from({ length: 11 }, (_, i) => i - 1).map((k) => ({
    cond, minute: iso(K(k)), quoting: true, tick: 0.01, bb: mid(k) - 0.02, ba: mid(k) + 0.02, ab: mid(k) - 0.02, aa: mid(k) + 0.02, q1: 10, q2: 10,
    m: mid(k), b: mid(k) - 0.01, a: mid(k) + 0.01, reward: 0.1,
  }));
  const rows = [...book(C, midC), ...book(W, midW)];
  const fills = [
    { cond: C, minute: iso(K(3)), ts: iso(K(3) + 30e3), side: "bid" as const, price: 0.69, size: 20, print_id: "c3" },
    { cond: C, minute: iso(K(4)), ts: iso(K(4) + 30e3), side: "ask" as const, price: 0.71, size: 20, print_id: "c4" },
    { cond: W, minute: iso(K(5)), ts: iso(K(5) + 30e3), side: "bid" as const, price: 0.39, size: 20, print_id: "w5" },
  ];
  const prints = [
    { id: "c3", cond: C, ts: iso(K(3) + 30e3), side: "SELL" as const, oi: 0, price: 0.66, size: 20 },
    { id: "c4", cond: C, ts: iso(K(4) + 30e3), side: "BUY" as const, oi: 0, price: 0.74, size: 20 },
    { id: "w5", cond: W, ts: iso(K(5) + 30e3), side: "SELL" as const, oi: 0, price: 0.37, size: 20 },
  ];
  const selection = ["2026-09-27", "2026-09-28"].flatMap((day) => [
    { day, cond: C, tick: 0.01, v: 3, min_size: 20, rate: 144, end_date: "2026-12-01T00:00:00Z", q: "C", cat: "culture_fees" },
    { day, cond: W, tick: 0.01, v: 3, min_size: 20, rate: 144, end_date: "2026-12-01T00:00:00Z", q: "W", cat: "weather_fees" },
  ]);
  const st = { ...newRwxState(RWX_SPECS), lastDecided: K(-2), dayOf: RWX_START - DAY_MS };
  replayArms(st, K(9), { rows, fills, prints, selection, settlements: [], rwDays: [] }, RWX_SPECS);
  const a = (arm: string, cond: string) => st.arms[arm].acc[cond];
  // Both rules bit: x1 took C's round trip and x2 did not; x2 took W's fill and x1 did not.
  assertEquals([a("x1", C).fills, a("x2", C).fills, a("x1", W).fills, a("x2", W).fills], [2, 0, 0, 1]);
  assertEquals([a("x2", W).net, a("x1", W).net], [20, 0]);
  // x3 is x2 on C and x1 on W, to the bit, and has no other market.
  assertEquals(a("x3", C), a("x2", C));
  assertEquals(a("x3", W), a("x1", W));
  assertEquals(Object.keys(st.arms.x3.acc).sort(), [C, W].sort());
  // So its total is the sum of those two parts, and the page's row would have repeated them.
  const total = (x: Record<string, unknown>) => Number(x.cash) + Number(x.net) * Number(x.lastM) + Number(x.reward);
  assertAlmostEquals(total(a("x3", C)) + total(a("x3", W)), total(a("x2", C)) + total(a("x1", W)), 1e-12);
  // And it is still in the replay: RWX_SPECS runs it, as the frozen pre-registration has it.
  assert(RWX_SPECS.some((s) => s.id === "x3" && s.noCats?.includes("weather_fees") && s.pause?.cents === 15));
});

// ---------------------------------------------------------------------------------------- x4 and x5: where quotes rest
// Pre-registration `reviews/2026-10-02-polymarket-rw-rest-prereg.md`: x1 plus, from 2026-10-03 00:00 UTC, x4 rests both
// quotes the most whole ticks further from the mid that keep nine tenths of the minute's reward at RW's quotes, and x5
// moves the quote that would add to what it holds a tick out for every whole N it holds. RW's own `quote` places them
// (through `restRow`) and RW's own `stepRw` scores, fills and books them.

/** A small seeded generator (mulberry32), so a property test draws the same books every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

Deno.test("restRow: RW's own quote rests the moved quotes exactly where the rule put them, and with no move exactly where RW's were", () => {
  const r = rng(20261002);
  let checked = 0, unmoved = 0;
  for (let i = 0; i < 20000; i++) {
    const tick = r() < 0.5 ? 0.01 : 0.001, top = Math.round(1 / tick);
    const ib = 1 + Math.floor(r() * (top - 3)), spread = 1 + Math.floor(r() * 6), ia = Math.min(top - 1, ib + spread);
    if (ia <= ib) continue;
    const iab = Math.max(1, ib - Math.floor(r() * 4)), iaa = Math.min(top - 1, ia + Math.floor(r() * 4));
    const row: BookRow = [ib * tick, ia * tick, iab * tick, iaa * tick, Math.round(r() * 5000) / 100, Math.round(r() * 5000) / 100];
    const q = quote(row, tick);
    if (!q) continue;
    const kb = Math.round(q.b / tick), ka = Math.round(q.a / tick);
    const out = { bid: Math.min(kb - 1, Math.floor(r() * 6)), ask: Math.min(top - 1 - ka, Math.floor(r() * 6)) };
    const moved = quote(restRow(row, q, tick, out), tick)!;
    // The mid, the others' scores and so the pool's split are RW's own; the quotes are RW's moved whole ticks out.
    assertEquals(moved, { m: q.m, b: (kb - out.bid) * tick, a: (ka + out.ask) * tick, q1: q.q1, q2: q.q2 }, JSON.stringify({ row, tick, out }));
    if (out.bid === 0 && out.ask === 0) { assertEquals(moved, q); unmoved++; }
    // RW's quote of the book is on the grid the rule counts in.
    assertEquals([q.b, q.a], [kb * tick, ka * tick]);
    checked++;
  }
  assert(checked > 15000 && unmoved > 100, `${checked} books, ${unmoved} unmoved`);
});

Deno.test("minutePrints: a minute's prints are every print stepRw keeps for it, in the market's order, on its edges too", () => {
  const r = rng(61);
  const T0 = Date.UTC(2026, 9, 3) / 1000;
  const printsOf = new Map<string, PmPrint[]>();
  for (const c of ["0xa", "0xb"]) {
    const list: PmPrint[] = Array.from({ length: 4000 }, (_, i) => {
      // Whole seconds, a quarter of them on a minute's edge, some in milliseconds; several in one second.
      const sec = T0 + Math.floor(r() * 600), ts = r() < 0.25 ? Math.floor(sec / 60) * 60 : r() < 0.5 ? sec : sec + Math.floor(r() * 1000) / 1000;
      return { id: `${c}${i}`, ts, side: r() < 0.5 ? "BUY" : "SELL", oi: r() < 0.2 ? 1 : 0, price: Math.round(r() * 98 + 1) / 100, size: 1 + Math.floor(r() * 50) };
    });
    list.sort(printOrder);
    printsOf.set(c, list);
  }
  const at = minutePrints(printsOf);
  const keep = (list: PmPrint[], tSec: number) => list.filter((p) => p.ts > tSec && p.ts <= tSec + 60).map((p) => p.id);
  let edges = 0;
  for (const c of ["0xa", "0xb", "0xnone"]) {
    for (let k = -2; k <= 11; k++) {
      const t = (T0 + 60 * k) * 1000;
      assertEquals(keep(at(c, t), t / 1000), keep(printsOf.get(c) ?? [], t / 1000), `${c} ${k}`);
      edges += (printsOf.get(c) ?? []).filter((p) => p.ts === t / 1000 + 60).length;
    }
  }
  assert(edges > 100, `${edges} prints on a minute's last second`);
});

Deno.test("wideTicks: the most whole ticks out that keep nine tenths of the minute's reward, inside the band and (0, 1)", () => {
  // A 0.48 / 0.52 book: mid 0.50, RW quotes 0.49 / 0.51, 1 ¢ out; v = 3 ¢ and N = 20, so S(1 ¢) = 4/9, S(2 ¢) = 1/9 and
  // S(3 ¢) = 0. Our score at RW's quotes is 20 × 4/9 = 80/9, a tick out 20/9; against others' O the shares are
  // 80/(80 + 9 O) and 20/(20 + 9 O), and a tick out keeps nine tenths while O ≤ 0.1 · (80/9)(20/9) / (0.9 · 80/9 − 20/9),
  // which is 0.34188….
  const w = (others: number, v = 3, keep = 0.9) => wideTicks(0.50, 0.49, 0.51, others, 0.01, v, 20, keep);
  assertEquals([w(0), w(0.3), w(0.341), w(0.342), w(0.4), w(10)], [1, 1, 1, 0, 0, 0]);
  // Two ticks out is 3 ¢, the edge of a 3 ¢ band, whose score is zero: never taken, even with the pool to itself.
  // A 4.5 ¢ band with nobody else in it: out to 4 ¢ (three ticks), not 5 ¢ (outside it).
  assertEquals(w(0, 4.5), 3);
  // Keeping all of it never moves a quote that others share; RW's quotes earning nothing never move.
  assertEquals([w(0.3, 3, 1), wideTicks(0.50, 0.49, 0.51, 0.3, 0.01, 0.5, 20, 0.9)], [0, 0]);
  // Never to 0 or 1: a bid at one tick has nowhere lower to go.
  assertEquals(wideTicks(0.015, 0.01, 0.03, 0, 0.01, 4.5, 20, 0.9), 0);
  // In a pool of $144 a day the minute pays 0.1 × the share: 0.0967… at RW's quotes, 0.0881… a tick out (91 %).
  const rwShare = (80 / 9) / (80 / 9 + 0.3), outShare = (20 / 9) / (20 / 9 + 0.3);
  assertAlmostEquals(outShare / rwShare, 0.910793, 1e-6);
});

Deno.test("leanTicks: the quote that adds to what is held moves a tick out per whole N held, inside the band, the other stays", () => {
  const l = (net: number, v = 4.5) => leanTicks(0.50, 0.49, 0.51, 0.01, v, 20, net);
  assertEquals([l(0), l(19.99), l(20), l(39.9999999999), l(40), l(59.9)], [
    { bid: 0, ask: 0 }, { bid: 0, ask: 0 }, { bid: 1, ask: 0 }, { bid: 2, ask: 0 }, { bid: 2, ask: 0 }, { bid: 2, ask: 0 },
  ]);
  assertEquals([l(-20), l(-45)], [{ bid: 0, ask: 1 }, { bid: 0, ask: 2 }]);
  // In a 3 ¢ band the second tick out is its edge: one tick, however much is held.
  assertEquals([l(40, 3), l(-40, 3)], [{ bid: 1, ask: 0 }, { bid: 0, ask: 1 }]);
  // A bid at one tick cannot move lower; an ask a tick under 1 cannot move higher.
  assertEquals([leanTicks(0.015, 0.01, 0.03, 0.01, 4.5, 20, 40), leanTicks(0.985, 0.97, 0.99, 0.01, 4.5, 20, -40)], [{ bid: 0, ask: 0 }, { bid: 0, ask: 0 }]);
});

/**
 * One culture market across the arms' first minute, 2026-10-03 00:00 UTC (K(0)), on a 0.48 / 0.52 book every minute
 * (others' score 0.3): RW quotes 0.49 / 0.51 and earns 0.1 × 80/82.7 a minute. A sale at 0.47 in K(0), one at 0.48 in
 * K(1), a purchase at 0.53 in K(2): RW buys 20 at 0.49 twice and sells 20 at 0.51. A weather market beside it, which
 * x1's rule has left out since 09-28.
 */
function restWorld() {
  const K = (k: number) => RWX_REST_START + k * M;
  const C = "0xc5", W = "0xw5";
  const rwReward = 0.1 * (80 / 9) / (80 / 9 + 0.3);
  const rows = [];
  for (let k = -3; k <= 3; k++) {
    for (const c of [C, W]) {
      rows.push({ cond: c, minute: iso(K(k)), quoting: true, tick: 0.01, bb: 0.48, ba: 0.52, ab: 0.48, aa: 0.52, q1: 0.3, q2: 0.3, m: 0.50, b: 0.49, a: 0.51, reward: rwReward });
    }
  }
  const prints = [
    { id: "s0", cond: C, ts: iso(K(0) + 20e3), side: "SELL" as const, oi: 0, price: 0.47, size: 20 },
    { id: "s1", cond: C, ts: iso(K(1) + 20e3), side: "SELL" as const, oi: 0, price: 0.48, size: 20 },
    { id: "b2", cond: C, ts: iso(K(2) + 20e3), side: "BUY" as const, oi: 0, price: 0.53, size: 20 },
  ];
  const fills = [
    { cond: C, minute: iso(K(0)), ts: iso(K(0) + 20e3), side: "bid" as const, price: 0.49, size: 20, print_id: "s0" },
    { cond: C, minute: iso(K(1)), ts: iso(K(1) + 20e3), side: "bid" as const, price: 0.49, size: 20, print_id: "s1" },
    { cond: C, minute: iso(K(2)), ts: iso(K(2) + 20e3), side: "ask" as const, price: 0.51, size: 20, print_id: "b2" },
  ];
  const s = (day: string, cond: string, cat: string) => ({ day, cond, tick: 0.01, v: 3, min_size: 20, rate: 144, end_date: "2026-12-01T00:00:00Z", q: cond, cat });
  const selection = ["2026-10-02", "2026-10-03"].flatMap((day) => [s(day, C, "culture_fees"), s(day, W, "weather_fees")]);
  return { K, C, W, rwReward, inputs: { rows, fills, prints, selection, settlements: [], rwDays: [] } as RweInputs };
}

Deno.test("x4 rests a tick wider from 10-03 and x5 leans against what it holds: their fills and rewards by hand, x1 untouched", () => {
  const { K, C, W, rwReward, inputs } = restWorld();
  const st = { ...newRwxState(RWX_SPECS), lastDecided: K(-4), dayOf: RWX_REST_START - DAY_MS };
  replayArms(st, K(3), inputs, RWX_SPECS);
  const out = 0.1 * (20 / 9) / (20 / 9 + 0.3);   // the minute's reward with one quote, or both, a tick out (1 ¢ → 2 ¢)
  const acc = (arm: string) => st.arms[arm].acc[C];
  // x1 is RW in a culture market: seven minutes of RW's reward, its three fills, long 20.
  assertEquals([acc("x1").fills, acc("x1").net], [3, 20]);
  assertAlmostEquals(acc("x1").reward, 7 * rwReward, 1e-12);
  assertAlmostEquals(acc("x1").cash, -0.49 * 20 * 2 + 0.51 * 20, 1e-12);
  assertEquals(st.arms.x1.diverged, []);
  // x4: RW's until K(0), then 0.48 / 0.52 (a tick out keeps 91 % of the reward; two is the band's edge). The sale at
  // 0.47 fills its bid at 0.48; the sale at 0.48 is not through it; the purchase at 0.53 fills its ask at 0.52.
  assertEquals([acc("x4").fills, acc("x4").net, st.arms.x4.diverged], [2, 0, [C]]);
  assertAlmostEquals(acc("x4").reward, 3 * rwReward + 4 * out, 1e-12);
  assertAlmostEquals(acc("x4").cash, -0.48 * 20 + 0.52 * 20, 1e-12);
  // x5: flat in K(0), so RW's quotes and RW's fill at 0.49; long 20 in K(1) and K(2), so its bid rests at 0.48 (the sale
  // at 0.48 is not through it) and its ask stays RW's 0.51, which the purchase fills; flat again in K(3).
  assertEquals([acc("x5").fills, acc("x5").net, st.arms.x5.diverged], [2, 0, [C]]);
  assertAlmostEquals(acc("x5").reward, 5 * rwReward + 2 * out, 1e-12);
  assertAlmostEquals(acc("x5").cash, -0.49 * 20 + 0.51 * 20, 1e-12);
  // The weather market is x1's rule in all three: never quoted since 09-28, so never held.
  assertEquals([st.arms.x1.acc[W], st.arms.x4.acc[W], st.arms.x5.acc[W]], [undefined, undefined, undefined]);
  // Each page counts from its own first minute: x4's and x5's base is their accounts as 10-03 began, x1's three minutes.
  assertEquals(st.arms.x4.base, st.arms.x5.base);
  assertEquals([st.arms.x4.base![C].net, st.arms.x4.base![C].fills, st.arms.x4.base![C].quotedMinutes], [0, 0, 3]);
  assertAlmostEquals(st.arms.x4.base![C].reward, 3 * rwReward, 1e-12);
});

Deno.test("an arm added to a running replay starts as a copy of x1 and ends where a replay that always had it ends; once its minute is past, it is left out", () => {
  const { K, inputs } = restWorld();
  const fresh = (specs: RwxSpec[]) => ({ ...newRwxState(specs), lastDecided: K(-4), dayOf: RWX_REST_START - DAY_MS });
  // Always had it.
  const always = fresh(RWX_SPECS);
  const daysAlways = [...replayArms(always, K(-2), inputs, RWX_SPECS).days, ...replayArms(always, K(3), inputs, RWX_SPECS).days];
  // Production's state before 2026-10-02's deploy: the five arms 0064 started; x4 and x5 join on the next pass.
  const added = fresh(RWX_SPECS.slice(0, 4));
  replayArms(added, K(-2), inputs, RWX_SPECS.slice(0, 4));
  assertEquals(Object.keys(added.arms).sort(), ["e", "rw", "x1", "x2", "x3"]);
  const daysAdded = replayArms(added, K(3), inputs, RWX_SPECS).days;
  assertEquals(added, always);
  // The day it closed on the way (10-02) has a row for every arm, x4's and x5's equal to x1's.
  const day = (days: typeof daysAdded, arm: string) => days.find((d) => d.day === "2026-10-02" && d.arm === arm);
  for (const arm of ["rw", "e", "x1", "x2", "x3", "x4", "x5"]) assertEquals(day(daysAdded, arm), day(daysAlways, arm), arm);
  assertEquals({ ...day(daysAdded, "x4")!, arm: "x1" }, day(daysAdded, "x1"));
  // Adding them changed nothing of the five arms 0064 started: the same world without x4 and x5, minute for minute.
  const without = fresh(RWX_SPECS.slice(0, 4));
  replayArms(without, K(3), inputs, RWX_SPECS.slice(0, 4));
  for (const arm of ["rw", "e", "x1", "x2", "x3"]) assertEquals(added.arms[arm], without.arms[arm], arm);
  // A state already past 10-03 00:00 without them cannot start them: they are left out, and nothing else changes.
  const late = fresh(RWX_SPECS.slice(0, 4));
  replayArms(late, K(0), inputs, RWX_SPECS.slice(0, 4));
  const daysLate = replayArms(late, K(3), inputs, RWX_SPECS).days;
  assertEquals(Object.keys(late.arms).sort(), ["e", "rw", "x1", "x2", "x3"]);
  assertEquals(daysLate.filter((d) => d.arm === "x4" || d.arm === "x5"), []);
  for (const arm of ["rw", "e", "x1", "x2", "x3"]) assertEquals(late.arms[arm], without.arms[arm], arm);
});

Deno.test("a rest arm's page shows where its own quotes rest: x4 a tick out on both sides, x5 RW's while flat", () => {
  const { K, C, inputs } = restWorld();
  const st = { ...newRwxState(RWX_SPECS), lastDecided: K(-4), dayOf: RWX_REST_START - DAY_MS };
  // The world starts after x1's first minute (09-28), when it held nothing.
  st.arms.x1.base = {};
  const out = replayArms(st, K(3), inputs, RWX_SPECS);
  const page = rwxArmSummaries({
    rwState: { state: { acc: {}, meta: {} }, last_minute: iso(K(3)), last_error: null },
    xState: { state: { ...st, version: RWX_STATE_VERSION, checkEMaxUsd: 0 }, last_minute: iso(K(3)), last_error: null },
    selectionAll: inputs.selection, today: [{ day: "2026-10-03", cond: C, rank: 1, rate: 144, v: 3, min_size: 20, capital: 20, q: C, cat: "culture_fees", end_date: "2026-12-01T00:00:00Z" }],
    latest: [{ cond: C, minute: iso(K(3)), tick: 0.01, b: 0.49, a: 0.51, m: 0.50, ours: 80 / 9, others: 0.3, qb: true, qa: true }],
    days: out.days, fills: inputs.fills, nowMs: K(4),
  });
  const quoteOf = (id: string) => page.find((r) => r.id === id)!.markets.map((m) => [m.bid, m.ask, Number(Number(m.share).toFixed(6))]);
  assertEquals(quoteOf("x1"), [[0.49, 0.51, Number(((80 / 9) / (80 / 9 + 0.3)).toFixed(6))]]);
  assertEquals(quoteOf("x4"), [[0.48, 0.52, Number(((20 / 9) / (20 / 9 + 0.3)).toFixed(6))]]);
  assertEquals(quoteOf("x5"), [[0.49, 0.51, Number(((80 / 9) / (80 / 9 + 0.3)).toFixed(6))]]);
  // Every figure of theirs is their own since 10-03 00:00: x4 made 0.80 on two fills and four minutes' reward.
  const x4 = page.find((r) => r.id === "x4")!;
  assertEquals([x4.notStarted, x4.startedAt, x4.fills], [false, iso(RWX_REST_START), 2]);
  assertAlmostEquals(x4.totalUsd, 4 * 0.1 * (20 / 9) / (20 / 9 + 0.3) + 0.8, 1e-9);
});
