// Pins the capital compounding (0146, 0183, quotes_compound.ts): off by default and before its migration; once a UTC day; base +
// realised since its start up to the day's 00:00, in whole units, between the floor and the cap, moved only a step or more; the
// coins' marks left out, a conversion's sale counted (0183); the USDC/GBP executor on its own config and unit; every twin with a
// row on, only once its account has turned into the day, the same capital as its live strategy from the same record; and
// `runQuotesAction` runs LIVE's and the USDC/GBP executor's before the executor's turn, a fault reported and never thrown.
import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { COMPOUND_RXU, COMPOUND_UNIT_GBP, compoundPlan, realisedSince, runLiveCompound, runTwinsCompound, TWIN_COMPOUND_TABLE } from "./quotes_compound.ts";
import { memDb } from "./testing.ts";
import { runQuotesAction } from "./index.ts";
import type { Db } from "./db.ts";

const NOW = Date.parse("2026-11-03T00:00:30Z");
const ON = { compound_mode: "realised", compound_base_gbp: 600, compound_from: "2026-10-28T00:00:00Z", compound_cap_gbp: 1200, compound_floor_gbp: 300, compound_step_gbp: 12, compound_on: "2026-11-02" };
const config = (o: Record<string, unknown> = {}) => ({ id: 1, dry_run: false, live_confirmed_at: "2026-10-01T16:29:53Z", capital_gbp: 600, updated_at: "2026-10-27T03:08:37Z", take_mode: "shadow", weekend_mode: "live", ...o });
let nextId = 1;
/** A filled live order of a rung, as the executor writes it. */
const fill = (o: { at: string; leg: "entry" | "exit" | "stop"; side: "bid" | "ask"; base: number; price: number; fee?: number; book?: string; k?: number }) => ({
  id: nextId++, ts: o.at, filled_at: o.at, mode: "live", book: o.book ?? "USDC-GBP", rung_side: o.side, k: o.k ?? 0.001, leg: o.leg,
  side: (o.side === "bid") === (o.leg === "entry") ? "buy" : "sell", price: o.price, base_size: o.base, filled_base: o.base, avg_fill_price: o.price,
  fee_gbp: o.fee ?? 0, state: "filled", client_order_id: crypto.randomUUID(),
});
/** A conversion that buys: rung-less, a lot for a later sale; it realises nothing itself. */
const convert = { ...fill({ at: "2026-10-29T10:00:00Z", leg: "entry", side: "bid", base: 159, price: 0.7485 }), rung_side: null, k: null, leg: "convert", side: "buy", fee_gbp: 0.5 };

Deno.test("compoundPlan: base + realised in whole £12, between the floor and the cap, moved only a step or more", () => {
  assertEquals(COMPOUND_UNIT_GBP, 12);
  // 600 + 13.40 = 613.40 → 612: £12 away, one step, it moves (a pound a rung, £51).
  assertEquals([compoundPlan({ base: 600, realised: 13.4, current: 600, cap: 1200, floor: 300, step: 12 })].map((p) => [p.target, p.change]), [[612, true]]);
  // 600 + 11.99 → 600: no move. 600 + 23.99 → 612 from 612: none either.
  assertEquals(compoundPlan({ base: 600, realised: 11.99, current: 600, cap: 1200, floor: 300, step: 12 }).change, false);
  assertEquals(compoundPlan({ base: 600, realised: 23.99, current: 612, cap: 1200, floor: 300, step: 12 }).change, false);
  // The cap and the floor hold, and say so.
  const up = compoundPlan({ base: 1190, realised: 40, current: 1188, cap: 1200, floor: 300, step: 12 });
  assertEquals([up.target, up.change, up.why], [1200, true, "held at the cap £1200"]);
  const down = compoundPlan({ base: 600, realised: -400, current: 600, cap: 1200, floor: 300, step: 12 });
  assertEquals([down.target, down.change, down.why], [300, true, "held at the floor £300"]);
  // A drawdown shrinks it, a step at a time of the same rule: 600 − 12.01 → 576.
  assertEquals(compoundPlan({ base: 600, realised: -12.01, current: 600, cap: 1200, floor: 300, step: 12 }).target, 576);
});

Deno.test("realisedSince: every rung's realised from the start, fees included, by the executor's own walk; a conversion's buy and earlier trips left out", () => {
  const from = Date.parse("2026-10-28T00:00:00Z");
  const orders = [
    // Before the start: a whole trip, not counted.
    fill({ at: "2026-10-27T12:00:00Z", leg: "entry", side: "bid", base: 66, price: 0.7480 }), fill({ at: "2026-10-27T13:00:00Z", leg: "exit", side: "bid", base: 66, price: 0.7490 }),
    // After it: a bid trip, +66 × 0.0008, and an ask trip, +66 × 0.0010 less a £0.01 fee.
    fill({ at: "2026-10-28T09:00:00Z", leg: "entry", side: "bid", base: 66, price: 0.7480 }), fill({ at: "2026-10-28T10:00:00Z", leg: "exit", side: "bid", base: 66, price: 0.7488 }),
    fill({ at: "2026-10-29T09:00:00Z", leg: "entry", side: "ask", base: 66, price: 0.7500, book: "USDT-GBP" }),
    fill({ at: "2026-10-29T11:00:00Z", leg: "exit", side: "ask", base: 66, price: 0.7490, fee: 0.01, book: "USDT-GBP" }),
    convert,
  ];
  // deno-lint-ignore no-explicit-any
  assertAlmostEquals(realisedSince(orders as any, from), 66 * 0.0008 + 66 * 0.0010 - 0.01, 1e-12);
  // Up to the day's 00:00 only (0183): the ask trip of 10-29 11:00 is after a 10-29 00:00 cut.
  // deno-lint-ignore no-explicit-any
  assertAlmostEquals(realisedSince(orders as any, from, Date.parse("2026-10-29T00:00:00Z")), 66 * 0.0008, 1e-12);
});

Deno.test("realisedSince counts a conversion's sale against the coins it sold, first in, first out, as the page's REALIZED does (0183)", () => {
  const from = Date.parse("2026-10-28T00:00:00Z");
  // The 159 bought at 0.7485 (10-29 10:00), 100 of them sold at 0.7470 less a £0.02 fee (10-30 23:34): −£0.17.
  const sale = { ...convert, id: nextId++, ts: "2026-10-30T23:34:00Z", filled_at: "2026-10-30T23:34:00Z", side: "sell", filled_base: 100, base_size: 100, price: 0.747, avg_fill_price: 0.747, fee_gbp: 0.02 };
  // deno-lint-ignore no-explicit-any
  assertAlmostEquals(realisedSince([convert, sale] as any, from), 100 * 0.747 - 0.02 - 100 * 0.7485, 1e-9);
  // Before the start, or after the cut: not counted.
  // deno-lint-ignore no-explicit-any
  assertEquals(realisedSince([convert, sale] as any, Date.parse("2026-10-31T00:00:00Z")), 0);
  // deno-lint-ignore no-explicit-any
  assertEquals(realisedSince([convert, sale] as any, from, Date.parse("2026-10-30T00:00:00Z")), 0);
});

Deno.test("runLiveCompound: off by default and before 0146, once a UTC day, and the capital it sets is the plan's", async () => {
  // Before 0146: the columns are not there. The double refuses them as PostgREST does: off, not an error.
  const before: Db = { ...memDb({}, { now: () => NOW }).db, select: () => Promise.reject(new Error('db select → 400: {"code":"42703","message":"column agent_quote_live_config.compound_mode does not exist"}')) } as Db;
  assertEquals(await runLiveCompound(before, NOW), { skipped: "0146 has not run" });
  // Off (0146's default): nothing read past the config, nothing written.
  const off = memDb({ agent_quote_live_config: [config({ compound_mode: "off" })] }, { now: () => NOW });
  assertEquals(await runLiveCompound(off.db, NOW), { skipped: "off" });
  assertEquals(off.tables.agent_quote_live_config[0].capital_gbp, 600);
  // On: £13.40 realised since 10-28 (a trip of 13,400 coins at 0.0010) → £612, written with the day and what it found.
  const trips = [fill({ at: "2026-10-30T09:00:00Z", leg: "entry", side: "bid", base: 13400, price: 0.7480 }), fill({ at: "2026-10-30T09:30:00Z", leg: "exit", side: "bid", base: 13400, price: 0.7490 })];
  const on = memDb({ agent_quote_live_config: [config(ON)], agent_quote_live_orders: [...trips, convert] }, { now: () => NOW });
  const r = await runLiveCompound(on.db, NOW);
  assertEquals([r.day, r.from, r.to], ["2026-11-03", 600, 612]);
  const row = on.tables.agent_quote_live_config[0];
  assertEquals([Number(row.capital_gbp), row.compound_on, (row.compound_last as { equity: number }).equity], [612, "2026-11-03", 613.4]);
  // The same day again: done.
  assertEquals(await runLiveCompound(on.db, NOW + 60e3), { skipped: "done for 2026-11-03" });
  // On without a base: refused by the config's own check in the database; here, a fault named, nothing changed.
  const bad = memDb({ agent_quote_live_config: [config({ ...ON, compound_mode: "off", compound_base_gbp: null })] }, { now: () => NOW });
  bad.tables.agent_quote_live_config[0].compound_mode = "realised";
  const b = await runLiveCompound(bad.db, NOW);
  assert(b.error?.includes("without a base"), b.error);
  assertEquals(bad.tables.agent_quote_live_config[0].capital_gbp, 600);
});

Deno.test("the USDC/GBP executor compounds on its own config, unit and record (0183), off by default and before its migration", async () => {
  const rxuCfg = (o: Record<string, unknown> = {}) => ({ id: 1, dry_run: false, live_confirmed_at: "2026-10-30T00:00:00Z", capital_gbp: 120, compound_mode: "off", compound_cap_gbp: 240, compound_floor_gbp: 60, compound_step_gbp: 4, compound_unit_gbp: 4, ...o });
  const before: Db = { ...memDb({}, { now: () => NOW }).db, select: () => Promise.reject(new Error('db select → 400: {"code":"42703","message":"column agent_quote_rxu_config.compound_mode does not exist"}')) } as Db;
  assertEquals(await runLiveCompound(before, NOW, COMPOUND_RXU), { skipped: "0183 has not run" });
  const off = memDb({ agent_quote_rxu_config: [rxuCfg()] }, { now: () => NOW });
  assertEquals(await runLiveCompound(off.db, NOW, COMPOUND_RXU), { skipped: "off" });
  // £5.36 realised (6,700 coins at 0.0008) → 125.36 → whole £4: £124, a pound a rung of its four. LIVE's config is not touched.
  const trips = [fill({ at: "2026-10-31T09:00:00Z", leg: "entry", side: "bid", base: 6700, price: 0.7480 }), fill({ at: "2026-10-31T09:30:00Z", leg: "exit", side: "bid", base: 6700, price: 0.7488 })];
  const on = memDb({ agent_quote_rxu_config: [rxuCfg({ compound_mode: "realised", compound_base_gbp: 120, compound_from: "2026-10-31T00:00:00Z" })], agent_quote_rxu_orders: trips,
    agent_quote_live_config: [config()] }, { now: () => NOW });
  const r = await runLiveCompound(on.db, NOW, COMPOUND_RXU);
  assertEquals([r.from, r.to], [120, 124]);
  assertEquals([Number(on.tables.agent_quote_rxu_config[0].capital_gbp), on.tables.agent_quote_live_config[0].capital_gbp], [124, 600]);
  // The counterfactual: the same record under LIVE's £12 unit would not move (125.36 → 120).
  assertEquals(compoundPlan({ base: 120, realised: 5.36, current: 120, cap: 240, floor: 60, step: 4, unit: 12 }).change, false);
});

Deno.test("a twin compounds by its live strategy's rule from its own record, once its account has turned into the day; off, nothing moves", async () => {
  const day = Date.parse("2026-11-03T00:00:00Z");
  const twin = { id: "live600", config: "agent_quote_twin_live600_config", orders: "agent_quote_twin_live600_orders", sim: "agent_quote_twin_live600_sim" };
  const trips = [fill({ at: "2026-11-01T09:00:00Z", leg: "entry", side: "bid", base: 13400, price: 0.7480 }), fill({ at: "2026-11-01T09:30:00Z", leg: "exit", side: "bid", base: 13400, price: 0.7490 }),
    // After the day's 00:00: not this day's.
    fill({ at: "2026-11-03T00:00:10Z", leg: "entry", side: "ask", base: 13400, price: 0.7500 }), fill({ at: "2026-11-03T00:00:20Z", leg: "exit", side: "ask", base: 13400, price: 0.7480 })];
  const world = (mode: string, lastTurnAt: number) => memDb({
    [TWIN_COMPOUND_TABLE]: [{ twin_id: "live600", mode, base_gbp: 600, from_at: "2026-10-31T00:00:00Z", cap_gbp: 1200, floor_gbp: 300, step_gbp: 12, unit_gbp: 12, on_day: null, last: null }],
    [twin.config]: [{ id: 1, dry_run: false, live_confirmed_at: "2026-10-27T00:00:00Z", capital_gbp: 600, updated_at: "2026-10-27T00:00:00Z" }],
    [twin.orders]: trips, [twin.sim]: [{ id: 1, state: { venue: { lastTurnAt } }, updated_at: "2026-11-03T00:00:25Z", last_error: null }],
    // LIVE on the same rule from the same instant, the same fills.
    agent_quote_live_config: [config({ ...ON, compound_from: "2026-10-31T00:00:00Z", compound_on: null })], agent_quote_live_orders: trips,
  }, { now: () => day + 30e3 });
  // Still catching up (its last turn ten minutes before 00:00): it waits.
  const behind = world("realised", day - 10 * 60e3);
  const b0 = await runTwinsCompound(behind.db, day + 30e3, [twin]);
  assertEquals(b0[0]?.skipped, "its account has not turned into the day yet", JSON.stringify(b0));
  assertEquals(behind.tables[twin.config][0].capital_gbp, 600);
  // Turned into the day: £13.40 before 00:00 → £612, as LIVE's own compounding sets from the same record.
  const w = world("realised", day + 25e3);
  const [r] = await runTwinsCompound(w.db, day + 30e3, [twin]);
  assertEquals([r.from, r.to, w.tables[TWIN_COMPOUND_TABLE][0].on_day], [600, 612, "2026-11-03"]);
  assertEquals(Number(w.tables[twin.config][0].capital_gbp), 612);
  assertEquals(w.tables[TWIN_COMPOUND_TABLE][0].days, { "2026-11-03": 612 });   // what a reading divides the day by
  await runLiveCompound(w.db, day + 30e3);
  assertEquals(Number(w.tables.agent_quote_live_config[0].capital_gbp), Number(w.tables[twin.config][0].capital_gbp));
  // Done for the day; and off (the counterfactual) moves nothing.
  assertEquals(await runTwinsCompound(w.db, day + 90e3, [twin]), []);
  const off = world("off", day + 25e3);
  assertEquals(await runTwinsCompound(off.db, day + 30e3, [twin]), []);
  assertEquals(off.tables[twin.config][0].capital_gbp, 600);
  // Before the table exists: nothing, no fault.
  assertEquals(await runTwinsCompound(memDb({}, { now: () => day }).db, day, [twin]), []);
});

Deno.test("runQuotesAction runs the compounding before the executor's turn, and a fault is one report, never a throw", async () => {
  const order: string[] = [], reports: string[] = [];
  const out = await runQuotesAction(false, {
    // deno-lint-ignore no-explicit-any
    paper: () => { order.push("paper"); return Promise.resolve({} as any); },
    weekend: () => { order.push("weekend"); return Promise.resolve({}); },
    compound: () => { order.push("compound"); return Promise.resolve({ day: "2026-11-03", error: "boom" }); },
    compoundRxu: () => { order.push("compoundRxu"); return Promise.resolve({ skipped: "off" }); },
    // deno-lint-ignore no-explicit-any
    live: () => { order.push("live"); return Promise.resolve({ errors: [] } as any); },
    report: (kind) => { reports.push(kind); return Promise.resolve(); },
    now: () => NOW,
  });
  assertEquals(order, ["paper", "weekend", "compound", "compoundRxu", "live"]);
  assertEquals(reports, ["agents.quotes_compound"]);
  assert("live" in out);
});
