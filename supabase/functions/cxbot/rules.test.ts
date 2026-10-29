// Pins CXBOT_RULES (`rules.ts`) one rule at a time, the outcome the reading scores (prereg §5), the paper fills (audit
// §7.3), the bracket's decomposition against the audit's Monte Carlo, and the prompt's examples
// (docs/agents/cxbot/GROK_PROMPT.md prints exactly these; `src/cxbot.test.js` checks it) against the server's own checks.
import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import examples from "../../../docs/agents/cxbot/examples.json" with { type: "json" };
import { answerOf, cycleOf, dailyOf, decisionOf, validateAnswers, validateBatch } from "./ingest.ts";
import {
  assignedBracket, blackoutWithin, bracketOf, costsOf, CXBOT_RULES, decompose, entryEvent, fractionOf, inBlackout, kellyRisk, leverageFor, liquidationPrice,
  type MarketState, type Minute, normCdf, openRefusals, type OpenRequest, positionEvent, resolveOnTape, roundSize, sizeMax, stopEntryFill, stopFill, walkBook, liqReached,
} from "./rules.ts";

const M = 60e3, H = 3600e3;
const T = Date.parse("2026-11-04T08:00:00Z");
const BTC: MarketState = { bid: 81200, ask: 81201, mid: 81200.5, spreadBps: 0.12, tapeAgeMs: 30e3, sd24: 0.02, fundingPerHour: 0.0000125, predictedPerHour: 0.0000125 };
const ETH: MarketState = { bid: 2400, ask: 2400.1, mid: 2400.05, spreadBps: 0.42, tapeAgeMs: 30e3, sd24: 0.028, fundingPerHour: 0.0000125, predictedPerHour: 0.0000125 };
const ctx = (o: Record<string, unknown> = {}) => ({ nowMs: T, venue: "hyperliquid" as const, market: BTC, book: [], budget: 1000, equity: 1000, ordersToday: 0, ordersLastMinute: 0, maxOrdersDay: 30, dayStopHit: false, totalStopHit: false, ...o });
const LONG: OpenRequest = { coin: "BTC", dir: "long", entryType: "market", entry: 81240, stop: 79580, limit: 84450, size: 0.0054, p: 0.47, category: "N", eventAt: null, goodTill: null };
const rules = (r: Partial<OpenRequest>, c: Record<string, unknown> = {}) => openRefusals({ ...LONG, ...r }, ctx(c)).refusals.map((x) => x.rule);

Deno.test("a bracket's geometry and its model-free m; a timeout's fraction", () => {
  const b = bracketOf("long", 100, 97.5, 105);
  assert(b.ok);
  assertAlmostEquals(b.m, 1 / 3, 1e-12);
  assertAlmostEquals(b.rewardRisk, 2, 1e-12);
  const s = bracketOf("short", 100, 102, 96);
  assert(s.ok);
  assertAlmostEquals(s.m, 1 / 3, 1e-12);
  assertEquals(bracketOf("long", 100, 101, 105).ok, false);
  assertEquals([fractionOf("long", 97.5, 105, 100), fractionOf("long", 97.5, 105, 90), fractionOf("short", 102, 96, 99)], [1 / 3, 0, 0.5]);
});

Deno.test("costs: taker in, a taker stop with slippage, the dearer funding over the hold; p* and the bar", () => {
  const c = costsOf({ venue: "hyperliquid", dir: "long", entryType: "market", dStop: 0.02, dLimit: 0.04, m: 1 / 3, fundingPerHour: 0.0000125, predictedPerHour: 0.00002, holdMs: 72 * H });
  // 4.5 + (4.5 + 5) + 72 × 0.2 bps = 28.4 bps; p* = 1/3 + 0.00284 / 0.06.
  assertAlmostEquals(c.total, 0.00284, 1e-12);
  assertAlmostEquals(c.p_star, Math.round((1 / 3 + 0.00284 / 0.06) * 1e4) / 1e4, 1e-12);
  assertAlmostEquals(c.bar, c.p_star + 0.08, 1e-9);
  // A short receives a positive rate: no funding cost. A resting limit pays the maker fee.
  const s = costsOf({ venue: "hyperliquid", dir: "short", entryType: "limit", dStop: 0.02, dLimit: 0.04, m: 1 / 3, fundingPerHour: 0.0000125, predictedPerHour: 0.0000125, holdMs: 72 * H });
  assertAlmostEquals(s.total, 0.00015 + 0.00045 + 0.0005, 1e-12);
  assertEquals(costsOf({ venue: "binance", dir: "long", entryType: "market", dStop: 0.02, dLimit: 0.04, m: 1 / 3, fundingPerHour: 0, predictedPerHour: 0, holdMs: 0 }).total_bps, 15);
});

Deno.test("leverage: at most 3×, low enough that liquidation lies 2.5 stop distances beyond the stop", () => {
  assertEquals(leverageFor("BTC", "long", 0.02), 3);
  // A 10 % stop: 1 / (3.5 × 0.10 × 0.9875 + 0.0125) = 2.79, rounded down to 2.7 (the research's 3× contradicted its own rule).
  assertEquals(leverageFor("BTC", "long", 0.10), 2.7);
  assertEquals(leverageFor("SOL", "short", 0.30), null);
  for (const [coin, dir, d] of [["BTC", "long", 0.1], ["ETH", "short", 0.08], ["SOL", "long", 0.05]] as const) {
    const lev = leverageFor(coin, dir, d)!;
    const liq = liquidationPrice(coin, dir, 100, lev);
    assert(Math.abs(liq - 100) / 100 >= 3.5 * d - 1e-9, `${coin} ${dir} ${d}`);
  }
  // At 3× isolated on BTC the liquidation is ~32 % from the entry (the research's §5.5).
  assertAlmostEquals(1 - liquidationPrice("BTC", "long", 100, 3) / 100, 0.3249, 1e-3);
});

Deno.test("size: the smaller of 1 % of the budget and a quarter Kelly, over the stop's loss with costs, rounded down", () => {
  assertAlmostEquals(kellyRisk(0.5, 2, 1000), 0.25 * 0.25 * 1000, 1e-9);
  assertEquals(kellyRisk(0.3, 2, 1000), 0);
  assertEquals(sizeMax({ coin: "BTC", entry: 80000, dStop: 0.02, costs: 0.002, p: 0.5, rr: 2, budget: 1000, equity: 1000 }), roundSize("BTC", 10 / (80000 * 0.022)));
  assertEquals(roundSize("SOL", 1.239), 1.23);
});

Deno.test("an open that keeps every rule passes; each rule refuses on its own", () => {
  assertEquals(openRefusals(LONG, ctx()).refusals, []);
  assertEquals(rules({ p: 0.4 }), ["edge"]);
  assertEquals(rules({ limit: 82500 }).includes("reward_risk"), true);
  assertEquals(rules({ stop: 80600 }).includes("stop_distance"), true); // 0.79 % < 1 %
  assertEquals(rules({ size: 0.006 }), ["risk"]);
  assertEquals(rules({ size: 0.00541 }).includes("size"), false);
  assertEquals(rules({ size: 0.000011 }).includes("size"), true);
  assertEquals(rules({ entry: 81190 }), ["level"]);
  assertEquals(rules({ entry: 81420 }).includes("slippage"), true);
  assertEquals(rules({}, { market: { ...BTC, tapeAgeMs: 200e3 } }), ["stale_tape"]);
  assertEquals(rules({}, { market: { ...BTC, ask: 81300, spreadBps: 12 } }).includes("wide_book"), true);
  assertEquals(rules({}, { market: { ...BTC, predictedPerHour: 0.0002 } }).includes("funding"), true);
  assertEquals(rules({}, { dayStopHit: true }), ["day_stop"]);
  assertEquals(rules({}, { totalStopHit: true }), ["total_stop"]);
  assertEquals(rules({}, { ordersToday: 30 }), ["orders_day"]);
  assertEquals(rules({}, { ordersLastMinute: 3 }), ["orders_minute"]);
  assertEquals(rules({}, { nowMs: Date.parse("2026-11-06T13:25:00Z") }), ["blackout"]);
  assertEquals(rules({}, { nowMs: Date.parse("2027-01-02T00:00:00Z") }).includes("calendar"), true);
  assertEquals(rules({ category: "E", eventAt: Date.parse("2026-11-06T13:30:00Z") }), []);
  assertEquals(rules({ category: "E", eventAt: Date.parse("2026-11-06T13:31:00Z") }), ["category"]);
  assertEquals(rules({ category: "R", eventAt: Date.parse("2026-11-06T13:30:00Z") }), ["category"]);
  const held = { coin: "BTC" as const, dir: "long" as const, size: 0.005, entry: 80000, stop: 78400 };
  assertEquals(rules({}, { book: [held] }).includes("one_per_coin"), true);
  assertEquals(rules({}, { book: [{ ...held, pending: true }] }).includes("pending"), true);
  const eth = { coin: "ETH" as const, dir: "long" as const, size: 0.15, entry: 2400, stop: 2340 };
  const sol = { coin: "SOL" as const, dir: "short" as const, size: 1, entry: 180, stop: 189 };
  assertEquals(rules({}, { book: [eth] }), []); // $9 + $9.97 of long risk: under the $20 a direction
  assertEquals(rules({}, { book: [{ ...eth, size: 0.2 }] }), ["direction_risk"]);
  assertEquals(rules({}, { book: [{ ...eth, size: 0.1 }, sol, { coin: "SOL", dir: "long", size: 0.1, entry: 180, stop: 175 }] }).includes("positions"), true);
  assertEquals(rules({ entryType: "limit", entry: 81000, goodTill: T + 6 * H }), []);
  assertEquals(rules({ entryType: "limit", entry: 81000, goodTill: T + 2 * M }), ["good_till"]);
  assertEquals(rules({ entryType: "limit", entry: 81000, goodTill: Date.parse("2026-11-06T14:00:00Z") }), ["good_till"]);
  assertEquals(rules({ entryType: "limit", entry: 81000, goodTill: T + 20 * H }), []);
  assertEquals(rules({ entryType: "limit", entry: 81300, goodTill: T + 6 * H }).includes("level"), true);
  assertEquals(rules({ entryType: "stop", entry: 81300, goodTill: T + 6 * H, stop: 79650, limit: 84600 }), []);
});

Deno.test("the blackout window: T−10 to T+5 minutes of a listed release; a resting order may not live into one", () => {
  const nfp = Date.parse("2026-11-06T13:30:00Z");
  assertEquals([inBlackout(nfp - 11 * M), inBlackout(nfp - 10 * M), inBlackout(nfp + 5 * M), inBlackout(nfp + 6 * M)], [false, true, true, false]);
  assertEquals(blackoutWithin(nfp - 2 * H, nfp - 11 * M), null);
  assertEquals(blackoutWithin(nfp - 2 * H, nfp), nfp - 10 * M);
  assertEquals(CXBOT_RULES.blackoutLeadMs, 10 * M);
});

Deno.test("the assigned bracket: stop 1 day-sd (at least 1 %), limit 2, so m is a third", () => {
  const a = assignedBracket("long", 100, 0.025);
  assertAlmostEquals(a.stop, 97.5, 1e-9);
  assertAlmostEquals(a.limit, 105, 1e-9);
  assertAlmostEquals(a.m, 1 / 3, 1e-12);
  const s = assignedBracket("short", 100, 0.004);
  assertEquals([s.stop, s.limit], [101, 98]);
});

const mi = (t: number, o: number, h: number, l: number, c: number): Minute => ({ t, o, h, l, c });
Deno.test("an outcome on the tape: the first side reached, an ambiguous minute both ways, a timeout at its fraction, pending until covered", () => {
  const b = { dir: "long" as const, start: T, stop: 97.5, limit: 105, holdMs: 10 * M };
  const flat = (k: number, c = 100) => mi(T + k * M, 100, 101, 99, c);
  assertEquals(resolveOnTape(b, [flat(0), flat(1), mi(T + 2 * M, 100, 105, 100, 104)]), { y: 1, how: "limit", at: T + 2 * M });
  assertEquals(resolveOnTape(b, [flat(0), mi(T + M, 100, 100, 97.5, 98)]), { y: 0, how: "stop", at: T + M });
  assertEquals(resolveOnTape(b, [flat(0), mi(T + M, 100, 106, 97, 100)]), { y: 0, yAlt: 1, how: "ambiguous", at: T + M });
  const ten = Array.from({ length: 10 }, (_, k) => flat(k, k === 9 ? 102.5 : 100));
  const r = resolveOnTape(b, ten);
  assert("y" in r);
  assertAlmostEquals(r.y, (102.5 - 97.5) / 7.5, 1e-12);
  assertEquals(r.how, "timeout");
  assertEquals(resolveOnTape(b, ten.slice(0, 8)), { pending: true });
  // Missing minutes are skipped: the last minute inside the hold decides.
  const gap = [flat(0), flat(1), flat(9, 99)];
  const g = resolveOnTape(b, gap);
  assert("y" in g && g.how === "timeout");
  assertAlmostEquals(g.y, 1.5 / 7.5, 1e-12);
});

Deno.test("paper fills: a stop at the worst of its level less 5 bps, a gap's open and the next open; a limit only strictly through; entries", () => {
  assertEquals(stopFill("long", 100, 100.5, 99.99), 99.95);
  assertEquals(stopFill("long", 100, 100.5, 98), 98);
  assertEquals(stopFill("short", 100, 99.5, 101), 101);
  // F6 (independent audit): a minute that OPENS through the stop has gapped: it fills at that open even when the price is
  // back above the stop by the next minute (the old rule, the stop less 5 bps, booked 99.95 here instead of 98).
  assertEquals(stopFill("long", 100, 98, 100.5), 98);
  assertEquals(stopFill("short", 100, 102, 99.5), 102);
  assertEquals([stopEntryFill("long", 100, 99.5, 100.01), stopEntryFill("long", 100, 101, 100), stopEntryFill("short", 100, 99, 100.5)], [100.05, 101, 99]);
  assertEquals([liqReached("long", 70, mi(T, 80, 81, 70, 75)), liqReached("short", 130, mi(T, 120, 129.9, 119, 125))], [true, false]);
  assertEquals(positionEvent("long", 97.5, 105, mi(T, 100, 105, 99, 104)), null);
  assertEquals(positionEvent("long", 97.5, 105, mi(T, 100, 105.01, 99, 104)), "limit");
  assertEquals(positionEvent("long", 97.5, 105, mi(T, 100, 106, 97.5, 104)), "stop");
  assertEquals(positionEvent("short", 102, 96, mi(T, 100, 101, 95.9, 96)), "limit");
  assertEquals([entryEvent("long", "limit", 99, mi(T, 100, 101, 99, 100)), entryEvent("long", "limit", 99, mi(T, 100, 101, 98.99, 100))], [false, true]);
  assertEquals([entryEvent("long", "stop", 101, mi(T, 100, 101, 99, 100)), entryEvent("short", "stop", 99, mi(T, 100, 101, 99.5, 100))], [true, false]);
  assertEquals(walkBook([[100, 1], [101, 1]], 1.5, 0.1, true), (100 + 0.5 * 101) / 1.5 + 0.1);
  assertEquals(walkBook([[100, 1]], 2, 0.1, true), null);
});

Deno.test("the decomposition matches the audit's Monte Carlo, and its expected outcome is m", () => {
  // bracket.py, 200,000 paths: −2.5 % / +5 %, 30 %, 72 h → 0.071, 0.356, 0.574, 0.459; −5 % / +10 %, 45 %, 7 d → 0.118, 0.420, 0.462, 0.467.
  const a = decompose("long", 81200, 81200 * 0.975, 81200 * 1.05, 0.30, 72 * H);
  assertAlmostEquals(a.p_limit_first, 0.071, 0.004);
  assertAlmostEquals(a.p_stop_first, 0.356, 0.004);
  assertAlmostEquals(a.p_neither, 0.574, 0.004);
  assertAlmostEquals(a.y_if_neither!, 0.459, 0.004);
  assertAlmostEquals(a.e_y, 1 / 3, 0.001);
  const b = decompose("long", 100, 95, 110, 0.45, 168 * H);
  assertAlmostEquals(b.p_limit_first, 0.118, 0.004);
  assertAlmostEquals(b.p_stop_first, 0.420, 0.004);
  assertAlmostEquals(b.e_y, 1 / 3, 0.001);
  const s = decompose("short", 100, 102.5, 95, 0.30, 72 * H);
  assertAlmostEquals(s.e_y, 1 / 3, 0.001);
  assertAlmostEquals(normCdf(0), 0.5, 1e-7);
  assertAlmostEquals(normCdf(1.96), 0.975, 1e-4);
});

// The prompt's examples (docs/agents/cxbot/GROK_PROMPT.md prints exactly these; `src/cxbot.test.js` checks it) are valid and
// the opens pass every rule at their own time, on the market this test states.
Deno.test("the prompt's examples are valid and the opens pass every rule at their own time", () => {
  const errors: string[] = [];
  const o = decisionOf(examples.order.decision, "order", Date.parse(examples.order.decision.ts), errors)!;
  const w = decisionOf(examples.working.decision, "working", Date.parse(examples.working.decision.ts), errors)!;
  for (const k of ["close", "amend", "cancel"] as const) decisionOf(examples[k].decision, k, Date.parse(examples[k].decision.ts), errors);
  assertEquals(errors, []);
  const req = (d: typeof o, et: OpenRequest["entryType"], gt: string | null): OpenRequest => ({
    coin: d.coin!, dir: d.direction!, entryType: et, entry: d.entry!, stop: d.stop!, limit: d.limit!, size: d.size!, p: d.p!, category: d.category as "E" | "R" | "N",
    eventAt: d.event_at ? Date.parse(d.event_at) : null, goodTill: gt ? Date.parse(gt) : null,
  });
  const r1 = openRefusals(req(o, "market", null), ctx({ nowMs: Date.parse(o.ts) }));
  assertEquals(r1.refusals, []);
  // The numbers its reason quotes are the server's.
  assertEquals([r1.checks.m, r1.checks.bar], [0.3409, 0.4592]);
  const r2 = openRefusals(req(w, "limit", examples.working.good_till), ctx({ nowMs: Date.parse(w.ts), market: ETH }));
  assertEquals(r2.refusals, []);
  assertEquals([r2.checks.m, r2.checks.bar], [0.3333, 0.4282]);
  const v = validateBatch({ decisions: [examples.shadow], cycles: [examples.cycle], daily: [examples.daily] }, Date.parse("2026-11-05T00:30:00Z"));
  assert(v.ok, JSON.stringify(v));
  const sb = bracketOf("long", examples.shadow.entry, examples.shadow.stop, examples.shadow.limit);
  assert(sb.ok);
  const sc = costsOf({ venue: "hyperliquid", dir: "long", entryType: "market", dStop: sb.dStop, dLimit: sb.dLimit, m: sb.m, fundingPerHour: 0.0000125, predictedPerHour: 0.0000125, holdMs: 72 * H });
  assertAlmostEquals(sc.bar, 0.43, 0.006);
  assert(validateAnswers(examples.forecast).ok);
  assert(cycleOf(examples.cycle, "c", Date.parse("2026-11-04T08:30:00Z"), []) !== null);
  assert(dailyOf(examples.daily, "d", Date.parse("2026-11-05T00:30:00Z"), []) !== null);
  assert(answerOf(examples.forecast.answers[0], "a", []) !== null);
});
