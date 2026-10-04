// Round 8: S1 under a stop that counts only what Polymarket paid (the rewards of days before today, at an assumed R), for
// R = 1, 0.4, 0.2 and 0, against no stop; the P&L read at the same R.
import { loadRW } from "./rec.ts";
import { simulate, type Variant } from "./sim.ts";
import { sizeN } from "../../../../../supabase/functions/agents/pmrw.ts";
const rec = loadRW();
const S1: Variant = { id: "S1", noWeatherFrom: undefined, skipMarket: (m) => sizeN(m.minSize) > 20, budget: 200, maxMarkets: 10, caps: { total: 320, market: 100, reduceFirst: true }, exitPassiveModel: { sharesPerMin: 9.1 / 60, costPerShare: 0.018 }, invCap: 5 };
console.log("R     stop              P&L at R   fills    rewards  stop tripped (day)");
for (const R of [1, 0.4, 0.2, 0]) {
  for (const stop of [undefined, { day: 1e9, total: 75, basis: "paid" as const, R }, { day: 1e9, total: 50, basis: "paid" as const, R }]) {
    const o = simulate(rec, { ...S1, stops: stop });
    const trip = o.days.find((d) => d.stopTotal);
    const pnl = o.end.fillsPnl + R * o.end.reward;
    console.log(`${R.toFixed(1)}   ${stop ? `paid total ${stop.total}` : "none            "}   ${pnl.toFixed(2).padStart(8)} ${o.end.fillsPnl.toFixed(2).padStart(8)} ${o.end.reward.toFixed(2).padStart(9)}  ${trip ? trip.day : "-"}`);
  }
}
