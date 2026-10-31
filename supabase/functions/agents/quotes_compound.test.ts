// Pins the capital compounding (0146, 0183, quotes_compound.ts): off by default and before its migration; once a UTC day; base +
// realised since its start up to the day's 00:00, in whole units, between the floor and the cap, moved only a step or more; the
// coins' marks left out, a conversion's sale counted (0183); the USDC/GBP executor on its own config and unit; every twin with a
// row on, only once its account has turned into the day, the same capital as its live strategy from the same record; and
// `runQuotesAction` runs LIVE's and the USDC/GBP executor's before the executor's turn, a fault reported and never thrown.
import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { COMPOUND_LIVE, COMPOUND_RXU, COMPOUND_UNIT_GBP, COMPOUND_UNIT_RUNGS_FROM, compoundPlan, compoundUnitOf, realisedSince, runLiveCompound, runTwinsCompound, TWIN_COMPOUND_TABLE } from "./quotes_compound.ts";
import { QUOTE_LIVE_INSTANCE, QUOTE_RXU_INSTANCE, rungGbpOf, type QuoteLiveInstance } from "./quotes_live.ts";
import { QUOTE_BOOKS } from "./quotes.ts";
import { cbLiveRungCount } from "./cb_live.ts";
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

// A pound a rung it quotes (Davies, 2026-10-31 ~03:05 UTC, "c也改"; reviews/2026-10-31-compound-unit-deviation.md): from 2026-11-01
// 00:00 UTC each executor's and twin's unit and step is its own rung count, so LIVE on USDT-GBP's six rungs moves in whole £6, not
// the £12 of the twelve it was built with, and a change of rungs can never leave it stale again.
/** The rungs an instance gives pounds to at `at`, counted from its sizing (`rungGbpOf`), not from the unit's own code. */
const pricedRungs = (inst: QuoteLiveInstance, at: number) => {
  let n = 0;
  for (const b of QUOTE_BOOKS) for (const side of ["bid", "ask"] as const) for (const k of inst.rungs) if (rungGbpOf(inst, 600, b, side, k, at) > 0) n++;
  return n;
};
Deno.test("the unit is £1 a rung each executor quotes: LIVE £6 on USDT-GBP alone, the USDC/GBP executor £4, Coinbase £6", () => {
  const day = COMPOUND_UNIT_RUNGS_FROM;
  assertEquals(day, Date.parse("2026-11-01T00:00:00Z"));
  assertEquals([compoundUnitOf(QUOTE_LIVE_INSTANCE, day), compoundUnitOf(QUOTE_RXU_INSTANCE, day), cbLiveRungCount()], [6, 4, 6]);
  // Checked against what each sizes: a unit that is not £1 times the rungs given pounds fails here, whatever changed.
  for (const inst of [QUOTE_LIVE_INSTANCE, QUOTE_RXU_INSTANCE]) assertEquals(compoundUnitOf(inst, day), pricedRungs(inst, day));
  assertEquals([COMPOUND_LIVE.instance, COMPOUND_RXU.instance], [QUOTE_LIVE_INSTANCE, QUOTE_RXU_INSTANCE]);
  // Before USDT-only LIVE quoted both books: twelve.
  assertEquals(compoundUnitOf(QUOTE_LIVE_INSTANCE, Date.parse("2026-10-29T00:00:00Z")), 12);
});

Deno.test("LIVE compounds in whole £6 from 2026-11-01 00:00 UTC, the stored £12 before it (the counterfactual)", async () => {
  // £6.70 realised (6,700 coins at 0.0010): 606.70 → £606, £6 away, one step: it moves. In whole £12 it would not (600).
  const trips = [fill({ at: "2026-11-01T09:00:00Z", leg: "entry", side: "bid", base: 6700, price: 0.7480, book: "USDT-GBP" }),
    fill({ at: "2026-11-01T09:30:00Z", leg: "exit", side: "bid", base: 6700, price: 0.7490, book: "USDT-GBP" })];
  const cfg = { ...ON, compound_from: "2026-10-31T00:00:00Z", compound_on: "2026-11-01" };
  const on = memDb({ agent_quote_live_config: [config(cfg)], agent_quote_live_orders: trips }, { now: () => NOW });
  const r = await runLiveCompound(on.db, NOW);
  assertEquals([r.from, r.to, r.plan?.why], [600, 606, "equity £606.70 in whole £6"]);
  assertEquals(compoundPlan({ base: 600, realised: 6.7, current: 600, cap: 1200, floor: 300, step: 12, unit: 12 }).change, false);
  // On 10-31 (before the instant) the stored £12 and its step still decide: 600 + 6.70 does not move.
  const early = Date.parse("2026-10-31T00:00:30Z");
  const trips0 = trips.map((t) => ({ ...t, ts: "2026-10-30T09:00:00Z", filled_at: "2026-10-30T09:00:00Z" }));
  const e = memDb({ agent_quote_live_config: [config({ ...cfg, compound_from: "2026-10-28T00:00:00Z", compound_on: "2026-10-30" })], agent_quote_live_orders: trips0 }, { now: () => early });
  const r0 = await runLiveCompound(e.db, early);
  assertEquals([r0.to, r0.plan?.why], [600, "equity £606.70 in whole £12"]);
});

Deno.test("a twin compounds by a pound a rung of its own from 2026-11-01: USDT-GBP alone £6, without its 0.3 % rung £4, both books £12", async () => {
  const day = Date.parse("2026-11-03T00:00:00Z");
  const usdtOnly = { ...QUOTE_LIVE_INSTANCE, weights: { from: 0, book: { "USDC-GBP": 0, "USDT-GBP": 1 } } } as QuoteLiveInstance;
  const no03 = { ...QUOTE_LIVE_INSTANCE, weights: { from: 0, book: { "USDC-GBP": 0, "USDT-GBP": 1 }, k: { "0.003": 0 } } } as QuoteLiveInstance;
  const both = { ...QUOTE_LIVE_INSTANCE, weights: { from: 0, book: { "USDC-GBP": 1, "USDT-GBP": 1 } } } as QuoteLiveInstance;
  assertEquals([compoundUnitOf(usdtOnly, day), compoundUnitOf(no03, day), compoundUnitOf(both, day)], [6, 4, 12]);
  for (const inst of [usdtOnly, no03, both]) assertEquals(compoundUnitOf(inst, day), pricedRungs(inst, day));
  // £4.02 realised: 604.02 → £604 on four rungs; the row's stored £12 would leave it at 600.
  const twin = { id: "n600no03", config: "agent_quote_twin_n600no03_config", orders: "agent_quote_twin_n600no03_orders", sim: "agent_quote_twin_n600no03_sim", instance: no03 };
  const trips = [fill({ at: "2026-11-02T09:00:00Z", leg: "entry", side: "bid", base: 4020, price: 0.7480, book: "USDT-GBP" }),
    fill({ at: "2026-11-02T09:30:00Z", leg: "exit", side: "bid", base: 4020, price: 0.7490, book: "USDT-GBP" })];
  const world = () => memDb({
    [TWIN_COMPOUND_TABLE]: [{ twin_id: twin.id, mode: "realised", base_gbp: 600, from_at: "2026-10-31T00:00:00Z", cap_gbp: 1200, floor_gbp: 300, step_gbp: 12, unit_gbp: 12, on_day: null, last: null }],
    [twin.config]: [{ id: 1, dry_run: false, live_confirmed_at: "2026-10-28T00:00:00Z", capital_gbp: 600, updated_at: "2026-10-28T00:00:00Z" }],
    [twin.orders]: trips, [twin.sim]: [{ id: 1, state: { venue: { lastTurnAt: day + 25e3 } }, updated_at: "2026-11-03T00:00:25Z", last_error: null }],
  }, { now: () => day + 30e3 });
  const w = world();
  const [r] = await runTwinsCompound(w.db, day + 30e3, [twin]);
  assertEquals([r.from, r.to, r.plan?.why], [600, 604, "equity £604.02 in whole £4"]);
  // Without its instance (the old call), the row's stored £12 decides: it stays at 600.
  const { instance: _i, ...stored } = twin;
  const [r0] = await runTwinsCompound(world().db, day + 30e3, [stored]);
  assertEquals(r0.to, 600);
});
