// Pins the two outside-Grok TESTING rows' summaries (`grok_tests_view.ts`): CXBOT's paper equity, today, positions and its
// three layers' Brier scores; IGBOT's money as its £1,000 budget plus the demo account's CHANGE since the arm (never the
// account's balance), its open positions with stop and limit, and its closed brackets scored with the F11 outcome.
import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { brierOf, cxbotSummary, fraction, igbotSummary } from "./grok_tests_view.ts";

const NOW = Date.parse("2026-11-10T12:00:00Z");

Deno.test("Brier of p and of the baseline, and D (positive: the agent better)", () => {
  const b = brierOf([{ p: 0.6, base: 0.4, y: 1 }, { p: 0.3, base: 0.4, y: 0 }]);
  assertAlmostEquals(b.brierP!, (0.16 + 0.09) / 2, 1e-9);
  assertAlmostEquals(b.brierBase!, (0.36 + 0.16) / 2, 1e-9);
  assertAlmostEquals(b.d!, 0.135, 1e-9);
  assertEquals(brierOf([]).d, null);
  assertEquals([fraction(true, 98, 104, 100), fraction(false, 102, 96, 99)], [1 / 3, 0.5]);
});

Deno.test("Crypto analyst: dry-run shows the budget and nothing else; paper its snapshot, its day, its layers after the shakedown", () => {
  const base = { state: {}, snapshot: null, dayOpen: null, positions: [], resting: 0, questions: [], forecasts: [], lastFetchedAt: "2026-11-10T11:59:30Z", mids: {}, nowMs: NOW };
  const dry = cxbotSummary({ ...base, config: { mode: "dry_run", started_at: null, budget_usd: 1000 } })!;
  assertEquals([dry.mode, dry.equity, dry.today, dry.daysRun, dry.running], ["dry_run", 1000, 0, null, true]);
  const started = "2026-11-01T00:00:00Z";
  const s = cxbotSummary({
    ...base, config: { mode: "paper", started_at: started, budget_usd: 1000 }, snapshot: { equity_usd: 1012.5, unrealised_usd: 2.5, fees_usd: 1.2 }, dayOpen: 1010,
    positions: [
      { coin: "BTC", direction: "long", size: 0.005, entry: 80000, stop: 78400, limit_px: 83200, stop0: 78400, limit0: 83200, p: 0.45, leverage: 3, opened_at: "2026-11-10T10:00:00Z", fee_open_usd: 0.18, funding_usd: 0.02, state: "open" },
      { coin: "ETH", direction: "short", size: 0.1, entry: 2400, stop: 2460, limit_px: 2280, stop0: 2460, limit0: 2280, p: 0.4, leverage: 3, opened_at: "2026-11-05T10:00:00Z", state: "closed", close_price: 2340, close_how: "agent" },
    ],
    questions: [
      { id: "A-early", layer: "A", issued_at: "2026-11-01T04:00:00Z", state: "resolved", m: 1 / 3, y: 1 },
      { id: "A-1", layer: "A", issued_at: "2026-11-05T04:00:00Z", state: "resolved", m: 1 / 3, y: 1 },
      { id: "A-2", layer: "A", issued_at: "2026-11-05T04:00:00Z", state: "scoring", m: 1 / 3, y: null },
      { id: "B-1", layer: "B", issued_at: "2026-11-05T04:00:00Z", state: "resolved", pm_mid: 0.3, y: 0 },
    ],
    forecasts: [{ question_id: "A-early", p: 0.9 }, { question_id: "A-1", p: 0.5 }, { question_id: "B-1", p: 0.2 }], mids: { BTC: 80100 },
  })!;
  assertEquals([s.mode, s.equity, s.unrealised, s.realised, s.today, s.daysRun, s.shakedown], ["paper", 1012.5, 2.5, 10, 2.5, 10, false]);
  assertEquals(s.positions.length, 1);
  assertEquals([s.positions[0].stop, s.positions[0].limit, s.positions[0].pnl], [78400, 83200, Math.round((100 * 0.005 - 0.18 - 0.02) * 100) / 100]);
  assertEquals([s.layers[0].issued, s.layers[0].answered, s.layers[0].scored], [2, 1, 1]); // the shakedown's question is not counted
  assertAlmostEquals(s.layers[0].d!, (2 / 3) ** 2 - 0.25, 1e-4);
  assertEquals(s.layers[1].scored, 1);
  // The closed ETH short, closed by the agent at 2,340: (2,460 − 2,340) / (2,460 − 2,280) = 2/3, against m 1/3.
  assertEquals(s.layers[2].scored, 1);
  assertAlmostEquals(s.layers[2].brierP!, (0.4 - 2 / 3) ** 2, 1e-4);
  assertEquals(s.deployed, Math.round((0.005 * 80000 / 3) * 100) / 100);
});

Deno.test("IG Trader: the £1,000 budget plus the change since the arm, never the demo account's balance; F11 on its closed brackets", () => {
  const base = { atArm: null, dayOpen: null, positions: [], working: 0, decisions: [], shadows: 3, gbpusd: 1.3, nowMs: NOW, instruments: { "IX.D.SPTRD.DAILY.IP": "US 500" } };
  const dry = igbotSummary({ ...base, config: { mode: "dry_run", armed_at: null, started_at: null, budget_gbp: 1000 }, state: {}, latest: { at: "2026-11-10T11:58:00Z", equity_gbp: 9876.5, upl_gbp: 12, margin_gbp: 300 } })!;
  assertEquals([dry.mode, dry.equity, dry.unrealised, dry.deployed, dry.today, dry.layers[1].scored], ["dry_run", 1000, 0, 0, 0, 3]);
  const live = igbotSummary({
    ...base, config: { mode: "demo", armed_at: "2026-11-03T08:00:00Z", started_at: "2026-11-03T08:00:00Z", budget_gbp: 1000 },
    state: { startEquity: { equityGbp: 9850 }, dayOpen: { day: "2026-11-10", equityGbp: 9870 }, dayStop: { day: "2026-11-09" } },
    latest: { at: "2026-11-10T11:58:00Z", equity_gbp: 9876.5, upl_gbp: 2, margin_gbp: 40 },
    positions: [
      { epic: "IX.D.SPTRD.DAILY.IP", direction: "BUY", size: 0.2, open_level: 6800, stop_level: 6760, limit_level: 6880, opened_at: "2026-11-10T09:00:00Z", decision_id: "o1", state: "open" },
      { epic: "IX.D.SPTRD.DAILY.IP", direction: "BUY", size: 0.2, open_level: 6800, opened_at: "2026-11-05T09:00:00Z", decision_id: "o0", state: "closed", close_level: 6820, close_how: "bot" },
    ],
    decisions: [{ id: "o0", m_base: 1 / 3, p_target: 0.5, stop_level: 6760, limit_level: 6880 }, { id: "o1", m_base: 1 / 3, p_target: 0.45, stop_level: 6760, limit_level: 6880 }],
  })!;
  assertEquals([live.mode, live.equity, live.unrealised, live.realised, live.today, live.deployed, live.daysRun, live.stops.dayHit], ["demo", 1026.5, 2, 24.5, 6.5, 40, 8, false]);
  assertEquals(live.positions, [{ market: "US 500", direction: "long", size: 0.2, entry: 6800, stop: 6760, limit: 6880, openedAt: "2026-11-10T09:00:00Z", pnl: null }]);
  // Closed by the bot at 6,820: (6,820 − 6,760) / 120 = 0.5, scored, never dropped.
  assertEquals(live.layers[0].scored, 1);
  assertAlmostEquals(live.layers[0].brierP!, 0, 1e-9);
  assertEquals([live.ccy, live.usdPerUnit], ["GBP", 1.3]);
});
