// Pins IGBOT_RULES (`rules.ts`) one rule at a time: a well-formed bracket passes, and each rule, broken alone, is refused
// under its own name. The numbers are worked by hand in each test's comment.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  amendRefusals, bookOf, bracketOf, closeLimitLevel, closeRefusals, gateRefusals, IGBOT_CALENDAR_UNTIL_MS, IGBOT_RELEASE_MS, IGBOT_RULES, igGoodTill, type IgMarket,
  type IgPosition, inWeekend, nextWeekendStart, openRefusals, type OpenRequest, overdue, positionRisk, positionUpl, releaseAt, releaseBetween, rulePoints, stopLatches,
  workingRisk,
} from "./rules.ts";
import { type Decision, decisionOf, validateBatch } from "./ingest.ts";
import examples from "../../../docs/agents/igbot/examples.json" with { type: "json" };

// Tuesday 2026-11-03 15:00 UTC: no listed release within a day (the BoE's is 11-05 12:00), not the weekend.
const T0 = Date.parse("2026-11-03T15:00:00Z");
const US500 = "IX.D.SPTRD.DAILY.IP";
const MKT: IgMarket = {
  epic: US500, name: "US 500", type: "INDICES", expiry: "DFB", status: "TRADEABLE", bid: 6800, offer: 6800.4, minDealSize: 0.04,
  minGsDistance: { unit: "POINTS", value: 4 }, gsPremium: 0.6, gbp: true, updateTime: "15:00:00",
};
// A buy: worst fill 6801 (0.6 over the offer, under a tenth of the 40-point stop), stop 6761, limit 6881: d_stop 40,
// d_limit 80, R 2, m 40/120 = 0.3333; p 0.5 clears m by 16.7 points. Kelly 0.5 − 0.5/2 = 0.25, a quarter of it 6.25 % of
// £1,000 = £62.50, so 1 % (£10) binds. £0.24 a point risks 0.24 × (40 + 0.6) = £9.74.
const REQ: OpenRequest = {
  category: "N", epic: US500, direction: "BUY", size: 0.24, level: 6801, stopLevel: 6761, limitLevel: 6881, p: 0.5, eventAt: null,
  sources: ["https://www.federalreserve.gov/"], entry: "market", goodTillMs: null,
};
const EMPTY = bookOf({ budgetGbp: 1000, equityGbp: null, startEquityGbp: null, dayOpenEquityGbp: null, positions: [], working: [] });
const run = (req: Partial<OpenRequest> = {}, o: Partial<Parameters<typeof openRefusals>[0]> = {}) => openRefusals({
  req: { ...REQ, ...req }, market: MKT, book: EMPTY, whitelist: [US500], nowMs: T0, ordersToday: 0, maxOrdersDay: 40, ordersLastMinute: 0, ...o,
});
const rules = (r: ReturnType<typeof run>) => r.refusals.map((x) => x.rule).sort();
const POS: IgPosition = {
  dealId: "DIAAAA1", dealReference: "IGB-x", epic: US500, direction: "BUY", size: 0.24, level: 6801, stopLevel: 6761, limitLevel: 6881, guaranteed: true, premium: 0.6,
  createdMs: T0, bid: 6800, offer: 6800.4,
};

Deno.test("a well-formed bracket passes every rule, and its checks are the hand-worked numbers", () => {
  const r = run();
  assertEquals(r.refusals, []);
  assertEquals([r.checks.d_stop, r.checks.d_limit, r.checks.reward_risk, r.checks.m_base, r.checks.kelly, r.checks.risk_gbp, r.checks.risk_cap_gbp], [40, 80, 2, 0.3333, 0.25, 9.74, 10]);
  // A sell mirrors it: worst fill 6799.5 under the bid 6800, stop 6839.5, limit 6719.5.
  assertEquals(rules(run({ direction: "SELL", level: 6799.5, stopLevel: 6839.5, limitLevel: 6719.5 })), []);
});

Deno.test("the bracket: sides, reward to risk 1.5, and p over the driftless m by 8 points", () => {
  assertEquals(rules(run({ stopLevel: 6820 })), ["bracket"]);
  assertEquals(rules(run({ limitLevel: 6790 })), ["bracket"]);
  // R 1.25 (limit 50 points away) fails 1.5; at p 0.6 the edge over m 0.444 still clears.
  assertEquals(rules(run({ limitLevel: 6851, p: 0.6 })), ["reward_risk"]);
  // p 0.41 is 7.7 points over m 0.3333: under 8 (its quarter Kelly, ¼ × 0.115 × £1,000 = £28.75, does not bind).
  assertEquals(rules(run({ p: 0.41 })), ["edge"]);
  assertEquals(bracketOf("BUY", 100, 90, 120, 0.5), { ok: true, dStop: 10, dLimit: 20, R: 2, m: 0.3333, kelly: 0.25 });
  assertEquals(bracketOf("SELL", 100, 90, 120, 0.5).ok, false);
});

Deno.test("risk: 1 % of the budget at the stop with the premium, a quarter Kelly when smaller, and 3 % in all", () => {
  // £0.25 a point risks 0.25 × 40.6 = £10.15 > £10.
  assertEquals(rules(run({ size: 0.25 })), ["risk"]);
  // The Kelly cap is on the bot's own equity, the budget plus its P&L (the demo account holds more): £100 lost leaves £900,
  // ¼ × 0.25 × £900 = £56.25, so 1 % (£10) still binds and £9.74 passes.
  const lost = bookOf({ budgetGbp: 1000, equityGbp: 9900, startEquityGbp: 10000, dayOpenEquityGbp: 9900, positions: [], working: [] });
  assertEquals(rules(run({}, { book: lost })), []);
  const lostKelly = run({ p: 0.43 }, { book: lost }); // Kelly 0.43 − 0.57/2 = 0.145, a quarter × £900 = £32.6: 1 % binds, passes
  assertEquals(rules(lostKelly), []);
  const thin = run({ p: 0.42, size: 0.2 }, { book: bookOf({ budgetGbp: 1000, equityGbp: 9400, startEquityGbp: 10000, dayOpenEquityGbp: 9400, positions: [], working: [] }) });
  // equity £400: Kelly 0.13 × ¼ × 400 = £13 > £10, so 1 % binds; £0.20 × 40.6 = £8.12 passes.
  assertEquals(rules(thin), []);
  const thinner = run({ p: 0.42, size: 0.2 }, { book: bookOf({ budgetGbp: 1000, equityGbp: 9200, startEquityGbp: 10000, dayOpenEquityGbp: 9200, positions: [], working: [] }) });
  // equity £200: ¼ × 0.13 × 200 = £6.50 < £8.12: Kelly binds.
  assertEquals(rules(thinner), ["risk"]);
  // £25 already at the stops plus £9.74 is over £30.
  const busy = { ...EMPTY, openRiskGbp: 25, openCount: 1, openEpics: ["CS.D.AUDUSD.TODAY.IP"] };
  assertEquals(rules(run({}, { book: busy })), ["total_risk"]);
});

Deno.test("what is open: three at most, one per market (no adding, averaging down or hedging), notional at most five budgets", () => {
  assertEquals(rules(run({}, { book: { ...EMPTY, openCount: 3, openEpics: ["A.B.C.D.E", "F.G.H.I.J", "K.L.M.N.O"] } })), ["positions"]);
  assertEquals(rules(run({}, { book: { ...EMPTY, openCount: 1, openEpics: [US500] } })), ["one_per_market"]);
  assertEquals(rules(run({}, { book: { ...EMPTY, notionalGbp: 3500 } })), ["notional"]);
});

Deno.test("the market and the list: whitelisted, tradeable, a £ daily funded bet, IG's minimum size and guaranteed distance", () => {
  assertEquals(rules(run({}, { whitelist: [] })), ["instrument"]);
  assertEquals(rules(run({}, { market: { ...MKT, status: "EDITS_ONLY" } })), ["market"]);
  assertEquals(rules(run({}, { market: { ...MKT, expiry: "DEC-26" } })), ["market"]);
  assertEquals(rules(run({}, { market: { ...MKT, gbp: false } })), ["market"]);
  assertEquals(rules(run({}, { market: null })), ["market"]);
  assertEquals(rules(run({ size: 0.02 })), ["size"]);
  assertEquals(rules(run({ size: 0.245 })), ["size"]);
  assertEquals(rules(run({ size: 0.29, p: 0.5 })), ["risk"]); // 0.29 has two decimals (a float that is not exactly 29/100)
  // A stop 3 points away is under IG's 4: R 26.7 at that distance, p 0.5 still clears; risk tiny.
  assertEquals(rules(run({ level: 6800.4, stopLevel: 6797.4, limitLevel: 6881 })), ["stop_distance"]);
  // The 2026-10-29 audit: IG measures the guaranteed distance from the deal's level, and an immediate deal fills at the
  // touch. Level 6800.8 (0.4 over the offer, inside a tenth of the stop) with the stop at 6796.5 is 4.3 points from the
  // level but 3.9 from the offer 6800.4: under IG's 4, refused (until then it passed, and IG would refuse the deal).
  assertEquals(rules(run({ level: 6800.8, stopLevel: 6796.5, limitLevel: 6881 })), ["stop_distance"]);
  assertEquals(rules(run({ level: 6800.8, stopLevel: 6796.4, limitLevel: 6881 })), []);
  // IG's other two dealing rules: the limit's minimum distance and the maximum distance of either.
  assertEquals(rules(run({}, { market: { ...MKT, minLimitDistance: { unit: "POINTS", value: 100 } } })), ["limit_distance"]);
  assertEquals(rules(run({}, { market: { ...MKT, maxStopLimitDistance: { unit: "POINTS", value: 50 } } })), ["limit_distance"]);
  assertEquals(rules(run({}, { market: { ...MKT, minLimitDistance: { unit: "POINTS", value: 1 }, maxStopLimitDistance: { unit: "POINTS", value: 1500 } } })), []);
  assertEquals(rulePoints({ unit: "PERCENTAGE", value: 2 }, 25000), 500);
  assertEquals(rulePoints(null, 25000), 0);
});

Deno.test("an immediate deal: its level at or beyond the touch, by at most a tenth of the stop; a working order on its side", () => {
  assertEquals(rules(run({ level: 6800.2, stopLevel: 6760.2, limitLevel: 6880.2 })), ["level"]);
  // 4.6 points over the offer with a 40-point stop: over 4.
  assertEquals(rules(run({ level: 6805, stopLevel: 6765, limitLevel: 6885 })), ["slippage"]);
  const gt = T0 + 3600e3;
  assertEquals(rules(run({ entry: "limit", level: 6790, stopLevel: 6750, limitLevel: 6870, goodTillMs: gt })), []);
  assertEquals(rules(run({ entry: "limit", level: 6810, stopLevel: 6770, limitLevel: 6890, goodTillMs: gt })), ["level"]);
  assertEquals(rules(run({ entry: "stop", level: 6810, stopLevel: 6770, limitLevel: 6890, goodTillMs: gt })), []);
  assertEquals(rules(run({ entry: "stop", level: 6790, stopLevel: 6750, limitLevel: 6870, goodTillMs: gt })), ["level"]);
});

Deno.test("time: the release windows, the weekend, and a working order's life", () => {
  const rel = Date.parse("2026-11-06T13:30:00Z"); // NFP
  assertEquals(rules(run({}, { nowMs: rel - 4 * 60e3 })), ["blackout"]);
  assertEquals(rules(run({}, { nowMs: rel + 2 * 60e3 })), ["blackout"]);
  assertEquals(rules(run({}, { nowMs: rel + 3 * 60e3 })), []);
  assertEquals(rules(run({}, { nowMs: rel - 6 * 60e3 })), []);
  assertEquals(releaseAt(rel - 5 * 60e3), rel);
  assertEquals(releaseAt(rel - 5 * 60e3 - 1), null);
  assertEquals(releaseBetween(rel - 3600e3, rel - 6 * 60e3), null);
  assertEquals(releaseBetween(rel - 3600e3, rel - 5 * 60e3), rel);
  // A working order placed 2 hours before NFP may not live past its window's start.
  const w = { entry: "limit" as const, level: 6790, stopLevel: 6750, limitLevel: 6870 };
  assertEquals(rules(run({ ...w, goodTillMs: rel }, { nowMs: rel - 2 * 3600e3 })), ["blackout"]);
  assertEquals(rules(run({ ...w, goodTillMs: rel - 6 * 60e3 }, { nowMs: rel - 2 * 3600e3 })), []);
  assertEquals(rules(run({ ...w, goodTillMs: T0 + 4 * 60e3 })), ["good_till"]);
  assertEquals(rules(run({ ...w, goodTillMs: T0 + 25 * 3600e3 })), ["good_till"]);
  assertEquals(rules(run({ ...w, goodTillMs: null })), ["good_till"]);
  // Friday 19:30 UTC: open allowed, but a working order may not live past 20:00.
  const fri = Date.parse("2026-11-13T19:30:00Z");
  assertEquals(rules(run({}, { nowMs: fri })), []);
  assertEquals(rules(run({ ...w, goodTillMs: fri + 3600e3 }, { nowMs: fri })), ["weekend"]);
  assertEquals(rules(run({}, { nowMs: fri + 3600e3 })), ["weekend"]);
  assertEquals([inWeekend(Date.parse("2026-11-14T12:00:00Z")), inWeekend(Date.parse("2026-11-15T21:59:00Z")), inWeekend(Date.parse("2026-11-15T22:00:00Z"))], [true, true, false]);
  assertEquals(new Date(nextWeekendStart(T0)).toISOString(), "2026-11-06T20:00:00.000Z");
  assertEquals(igGoodTill(Date.parse("2026-11-03T09:05:07Z")), "2026/11/03 09:05:07");
});

Deno.test("the categories: E names a listed release ahead, R one behind, every open a source; orders a day and a minute", () => {
  assertEquals(rules(run({ category: "E" })), ["category"]);
  assertEquals(rules(run({ category: "E", eventAt: "2026-11-05T12:00:00Z" })), []); // the BoE, listed
  assertEquals(rules(run({ category: "E", eventAt: "2026-11-07T12:00:00Z" })), ["category"]); // 93 hours ahead, and not listed
  // An R on a release listed 1.5 hours before T0 (a list given to the rules), and one 25.5 hours before.
  const rel = [Date.parse("2026-11-02T13:30:00Z"), Date.parse("2026-11-03T13:30:00Z")];
  assertEquals(rules(run({ category: "R", eventAt: "2026-11-03T13:30:00Z" }, { releases: rel })), []);
  assertEquals(rules(run({ category: "R", eventAt: "2026-11-02T13:30:00Z" }, { releases: rel })), ["category"]);
  // The 2026-10-29 audit: E and R name a LISTED release, as the pre-registration and the prompt say. Until then any time
  // within the window passed: an E "positioned" for a time no calendar lists (the BoE's hour, a day early) is refused.
  assertEquals(rules(run({ category: "E", eventAt: "2026-11-04T12:00:00Z" })), ["category"]);
  assertEquals(rules(run({ category: "R", eventAt: "2026-11-03T13:30:00Z" })), ["category"]);
  // To the minute: the BoE at 12:00:30 is the listed 12:00 release.
  assertEquals(rules(run({ category: "E", eventAt: "2026-11-05T12:00:30Z" })), []);
  assertEquals(rules(run({ sources: [] })), ["sources"]);
  assertEquals(rules(run({}, { ordersToday: 40 })), ["orders_day"]);
  assertEquals(rules(run({}, { ordersLastMinute: IGBOT_RULES.maxOrdersPerMinute })), ["orders_minute"]);
});

Deno.test("the gates: an open needs every one; a close every one but the stops; a cancel goes through the pause", () => {
  const g = { mode: "demo" as const, armed: true, globalPause: false, credsProblem: null, equityRead: true, dayStopped: false, totalStopped: false };
  assertEquals(gateRefusals(g, "open"), []);
  assertEquals(gateRefusals({ ...g, armed: false }, "open").map((r) => r.rule), ["armed"]);
  assertEquals(gateRefusals({ ...g, globalPause: true }, "close").map((r) => r.rule), ["global_pause"]);
  assertEquals(gateRefusals({ ...g, globalPause: true }, "cancel"), []);
  assertEquals(gateRefusals({ ...g, equityRead: false }, "open").map((r) => r.rule), ["account"]);
  assertEquals(gateRefusals({ ...g, equityRead: false, mode: "dry_run", armed: false }, "open"), []);
  assertEquals(gateRefusals({ ...g, dayStopped: true, totalStopped: true }, "open").map((r) => r.rule), ["total_stop", "day_stop"]);
  assertEquals(gateRefusals({ ...g, dayStopped: true, totalStopped: true }, "close"), []);
  assertEquals(gateRefusals({ ...g, credsProblem: "IG is not configured" }, "close").map((r) => r.rule), ["credentials"]);
  // The 2026-10-29 audit: an account holding what the bot did not place is not the bot's book: no open, in either mode; a
  // close of the bot's own still goes.
  assertEquals(gateRefusals({ ...g, foreign: "1 foreign" }, "open").map((r) => r.rule), ["account_shared"]);
  assertEquals(gateRefusals({ ...g, foreign: "1 foreign", mode: "dry_run", armed: false }, "open").map((r) => r.rule), ["account_shared"]);
  assertEquals(gateRefusals({ ...g, foreign: "1 foreign" }, "close"), []);
});

Deno.test("an open waits for an earlier order's answer in its market, and stops where the release list ends", () => {
  assertEquals(rules(run({}, { pendingEpics: [US500] })), ["pending_order"]);
  assertEquals(rules(run({}, { pendingEpics: ["CS.D.AUDUSD.TODAY.IP"] })), []);
  assertEquals(new Date(IGBOT_CALENDAR_UNTIL_MS).toISOString(), "2027-01-01T00:00:00.000Z");
  // The list's last release is in it, and nothing past 2026-12-31.
  assert(IGBOT_RELEASE_MS.every((t) => t < IGBOT_CALENDAR_UNTIL_MS));
  const jan = Date.parse("2027-01-05T15:00:00Z");
  assertEquals(rules(run({}, { nowMs: jan })), ["calendar"]);
  assertEquals(rules(run({}, { nowMs: jan, calendarUntilMs: Date.parse("2027-02-01T00:00:00Z") })), []);
});

Deno.test("a close is a fill-or-kill at the exit touch less three spreads or 5 bps, rounded outward to a point", () => {
  // A buy closes into the bid 6800: the spread 0.4 x 3 = 1.2 < 0.0005 x 6800 = 3.4, so 6796.6, down to 6796.
  assertEquals(closeLimitLevel(POS), 6796);
  // A sell closes into the offer 6800.4: up to 6804.
  assertEquals(closeLimitLevel({ ...POS, direction: "SELL" }), 6804);
  // AUD/USD at 6910.7 / 6911.3: 3 x 0.6 = 1.8 < 3.46, so 6907.24, down to 6907.
  assertEquals(closeLimitLevel({ direction: "BUY", bid: 6910.7, offer: 6911.3 }), 6907);
  // A wide spread (the US 500 out of hours, 1.5) widens it: 4.5 over 3.4.
  assertEquals(closeLimitLevel({ direction: "BUY", bid: 6800, offer: 6801.5 }), 6795);
  assertEquals(closeLimitLevel({ direction: "BUY", bid: null, offer: 6800 }), null);
});

Deno.test("amend: a guaranteed stop only toward the price, never through it or inside IG's distance; a limit on the profit side", () => {
  assertEquals(amendRefusals({ pos: POS, stopLevel: 6780, limitLevel: null, market: MKT }), []);
  assertEquals(amendRefusals({ pos: POS, stopLevel: 6750, limitLevel: null, market: MKT }).map((r) => r.rule), ["stop_wider"]);
  assertEquals(amendRefusals({ pos: POS, stopLevel: 6800, limitLevel: null, market: MKT }).map((r) => r.rule), ["stop_through", "stop_distance"]);
  assertEquals(amendRefusals({ pos: POS, stopLevel: 6797, limitLevel: null, market: MKT }).map((r) => r.rule), ["stop_distance"]);
  assertEquals(amendRefusals({ pos: POS, stopLevel: null, limitLevel: 6850, market: MKT }), []);
  assertEquals(amendRefusals({ pos: POS, stopLevel: null, limitLevel: 6790, market: MKT }).map((r) => r.rule), ["limit_through"]);
  assertEquals(amendRefusals({ pos: POS, stopLevel: null, limitLevel: null, market: MKT }).map((r) => r.rule), ["amend"]);
  // A sell's stop moves down to tighten.
  const short = { ...POS, direction: "SELL" as const, level: 6799.5, stopLevel: 6839.5, limitLevel: 6719.5 };
  assertEquals(amendRefusals({ pos: short, stopLevel: 6820, limitLevel: null, market: MKT }), []);
  assertEquals(amendRefusals({ pos: short, stopLevel: 6850, limitLevel: null, market: MKT }).map((r) => r.rule), ["stop_wider"]);
});

Deno.test("close: only a position held, at most its size", () => {
  assertEquals(closeRefusals(null, null).map((r) => r.rule), ["not_held"]);
  assertEquals(closeRefusals(POS, 0.3).map((r) => r.rule), ["size"]);
  assertEquals(closeRefusals(POS, 0.1), []);
  assertEquals(closeRefusals(POS, null), []);
});

Deno.test("the book: risk at the stops with premiums, a stop past entry risks its premium only, P&L from the start and the day", () => {
  assertEquals(positionRisk(POS), 9.74);
  assertEquals(positionRisk({ ...POS, stopLevel: 6810 }), 0.14);
  assertEquals(positionRisk({ ...POS, stopLevel: null }), Infinity);
  assertEquals(workingRisk({ size: 1, stopDistance: 20, premium: 0.6 }), 20.6);
  assertEquals(positionUpl(POS), -0.24);
  const b = bookOf({
    budgetGbp: 1000, equityGbp: 9990, startEquityGbp: 10000, dayOpenEquityGbp: 9995, positions: [POS],
    working: [{ dealId: "W1", epic: "CS.D.AUDUSD.TODAY.IP", direction: "SELL", size: 1, level: 6900, type: "LIMIT", goodTillMs: null, guaranteed: true, stopDistance: 5, limitDistance: 10, premium: 1.5 }],
  });
  assertEquals([b.totalPnlGbp, b.dayPnlGbp, b.openRiskGbp, b.notionalGbp, b.openCount, b.openEpics], [-10, -5, 16.24, 8532.24, 2, ["CS.D.AUDUSD.TODAY.IP", US500]]);
});

Deno.test("the stops latch: the day's until 00:00 UTC, the total's to the end", () => {
  const b = (eq: number, day: number) => bookOf({ budgetGbp: 1000, equityGbp: eq, startEquityGbp: 10000, dayOpenEquityGbp: day, positions: [], working: [] });
  const s1 = stopLatches({ book: b(9980, 10000), dayStopGbp: 20, totalStopGbp: 100, nowMs: T0, state: {} });
  assertEquals([s1.dayStopped, s1.totalStopped], [true, false]);
  // Recovered an hour later: the day stop holds.
  const s2 = stopLatches({ book: b(9999, 10000), dayStopGbp: 20, totalStopGbp: 100, nowMs: T0 + 3600e3, state: { dayStop: s1.dayStop } });
  assertEquals(s2.dayStopped, true);
  // The next day it is open again.
  const s3 = stopLatches({ book: b(9999, 9999), dayStopGbp: 20, totalStopGbp: 100, nowMs: T0 + 86400e3, state: { dayStop: s1.dayStop } });
  assertEquals(s3.dayStopped, false);
  const s4 = stopLatches({ book: b(9900, 9950), dayStopGbp: 20, totalStopGbp: 100, nowMs: T0, state: {} });
  assert(s4.totalStopped);
  const s5 = stopLatches({ book: b(10050, 10050), dayStopGbp: 20, totalStopGbp: 100, nowMs: T0 + 7 * 86400e3, state: { totalStop: s4.totalStop } });
  assertEquals(s5.totalStopped, true);
});

Deno.test("the five-day limit names the positions the server closes", () => {
  assertEquals(overdue([POS, { ...POS, dealId: "OLD", createdMs: T0 - IGBOT_RULES.maxHoldMs }, { ...POS, dealId: "NODATE", createdMs: null }], T0).map((p) => p.dealId), ["OLD"]);
});

// The prompt's examples (docs/agents/igbot/GROK_PROMPT.md prints exactly these; `src/igbot.test.js` checks it) are valid
// requests that pass every rule at their own time, against markets as IG's demo quoted them in October.
Deno.test("the prompt's examples are valid and pass every rule at their own time", () => {
  const errors: string[] = [];
  const order = decisionOf(examples.order.decision, "order", Date.parse(examples.order.decision.ts), errors)!;
  const working = decisionOf(examples.working.decision, "working", Date.parse(examples.working.decision.ts), errors)!;
  for (const k of ["close", "amend", "cancel"] as const) decisionOf(examples[k].decision, k, Date.parse(examples[k].decision.ts), errors);
  assertEquals(errors, []);
  const asReq = (d: Decision, entry: "market" | "limit", goodTill: string | null): OpenRequest => ({
    category: d.category as "E" | "N" | "R", epic: d.epic!, direction: d.direction!, size: d.size!, level: d.level!, stopLevel: d.stop_level!, limitLevel: d.limit_level!,
    p: d.p_target!, eventAt: d.event_at, sources: d.sources, entry, goodTillMs: goodTill === null ? null : Date.parse(goodTill),
  });
  const us = { ...MKT, bid: 7700, offer: 7700.4 };
  const au: IgMarket = { ...MKT, epic: "CS.D.AUDUSD.TODAY.IP", name: "AUD/USD", type: "CURRENCIES", bid: 6910, offer: 6910.8, minGsDistance: { unit: "POINTS", value: 6 }, gsPremium: 1.5 };
  const wl = [US500, "CS.D.AUDUSD.TODAY.IP"];
  const r1 = openRefusals({ req: asReq(order, "market", null), market: us, book: EMPTY, whitelist: wl, nowMs: Date.parse(order.ts), ordersToday: 0, maxOrdersDay: 40, ordersLastMinute: 0 });
  assertEquals(r1.refusals, []);
  assertEquals([r1.checks.m_base, r1.checks.risk_gbp], [0.3333, 9.74]);
  const r2 = openRefusals({ req: asReq(working, "limit", examples.working.good_till), market: au, book: EMPTY, whitelist: wl, nowMs: Date.parse(working.ts), ordersToday: 1, maxOrdersDay: 40, ordersLastMinute: 0 });
  assertEquals(r2.refusals, []);
  assertEquals([r2.checks.m_base, r2.checks.risk_gbp], [0.375, 9.45]);
  const v = validateBatch({ decisions: [examples.shadow], cycles: [examples.cycle], daily: [examples.daily] }, Date.parse("2026-11-04T00:30:00Z"));
  assertEquals(v.ok, true, JSON.stringify(v));
  assertEquals(bracketOf("SELL", examples.shadow.level, examples.shadow.stop_level, examples.shadow.limit_level, examples.shadow.p_target).m, 0.4);
});
