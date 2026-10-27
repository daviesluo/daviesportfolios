// Pins LIVE's capital compounding (0146, quotes_compound.ts): off by default and before its migration; once a UTC day; base +
// realised since its start, in whole £12, between the floor and the cap, moved only a step or more; the coins' marks and the
// conversions left out; and `runQuotesAction` runs it before the executor's turn, a fault reported and never thrown.
import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { COMPOUND_UNIT_GBP, compoundPlan, realisedSince, runLiveCompound } from "./quotes_compound.ts";
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
/** A conversion: rung-less, so it counts for nothing here. */
const convert = { ...fill({ at: "2026-10-29T10:00:00Z", leg: "entry", side: "bid", base: 159, price: 0.7485 }), rung_side: null, k: null, leg: "convert", fee_gbp: 0.5 };

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

Deno.test("realisedSince: every rung's realised from the start, fees included, by the executor's own walk; conversions and earlier trips left out", () => {
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

Deno.test("runQuotesAction runs the compounding before the executor's turn, and a fault is one report, never a throw", async () => {
  const order: string[] = [], reports: string[] = [];
  const out = await runQuotesAction(false, {
    // deno-lint-ignore no-explicit-any
    paper: () => { order.push("paper"); return Promise.resolve({} as any); },
    weekend: () => { order.push("weekend"); return Promise.resolve({}); },
    compound: () => { order.push("compound"); return Promise.resolve({ day: "2026-11-03", error: "boom" }); },
    // deno-lint-ignore no-explicit-any
    live: () => { order.push("live"); return Promise.resolve({ errors: [] } as any); },
    report: (kind) => { reports.push(kind); return Promise.resolve(); },
    now: () => NOW,
  });
  assertEquals(order, ["paper", "weekend", "compound", "live"]);
  assertEquals(reports, ["agents.quotes_compound"]);
  assert("live" in out);
});
