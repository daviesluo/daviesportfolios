// 2026-10-09 stablecoin quotes review, finding F1: a buy-back exit worth between the venue's £0.10 minimum and £0.11
// pays the next whole penny for nothing. `pennyExit` (agents/quotes_live.ts) trims a buy to the penny below, but at the
// minimum that trim falls under it, so the exit goes out untrimmed and Revolut X debits the notional rounded UP (the
// executor's own rule, `pennyUp`; revx_sim.ts rule 2; live fills 3956, 4245, 4304). The alternative priced here: such an
// exit buys what that next penny buys (`floorToStep(pennyUp(n) / price)`), so no penny is paid for nothing; the hair
// over the holding stays in the account as coin the asks use.
// npx --yes deno@1.46.3 run --allow-read --allow-write --no-check scripts/dust_exit.ts   (from this folder)
import { pennyExit, pennyUp, dustBase } from "../../../../../supabase/functions/agents/quotes_live.ts";
import { floorToStep } from "../../../../../supabase/functions/_shared/agents_strategy.ts";

const here = new URL("..", import.meta.url).pathname;
const PAIR = { base_step: "0.00001", quote_step: "0.0001", min_order_size: "0.00001", min_order_size_quote: "0.1" } as never; // revx_sim.ts's pair, the venue's
const TABLES: Record<string, string> = {
  live: "agent_quote_live_orders", pr5: "agent_quote_twin_pr5_orders", p50: "agent_quote_twin_p50_orders",
  take50: "agent_quote_twin_take50_orders", d: "agent_quote_twin_d_orders",
};
/** The pounds the venue moves for a buy: the notional rounded up to the penny. */
const debit = (base: number, price: number) => pennyUp(base * price);
const out: Record<string, unknown> = {};
for (const [id, table] of Object.entries(TABLES)) {
  const rows = JSON.parse(await Deno.readTextFile(`${here}data/${table}.json`)).rows as unknown[][];
  const cases = [];
  for (const r of rows) {
    const [oid, ts, , book, rungSide, k, leg, side, , baseSize, filled, avg, price] = r as [number, string, string, string, string, string, string, string, string, string, string, string, string];
    if (leg !== "exit" || side !== "buy" || !(Number(filled) > 0)) continue;
    const px = Number(price), b = Number(baseSize), n = b * px;
    const dust = dustBase(PAIR, px);
    // Was this exit one the trim could not reach? (the order as sent equals its untrimmed self, worth under £0.11)
    const trimmed = pennyExit("buy", baseSize, px, PAIR, dust);
    if (!(n < 0.11 && trimmed === baseSize && Math.abs(n * 100 - Math.round(n * 100)) > 1e-6)) continue;
    const paid = Number(avg) * Number(filled);
    const alt = Number(floorToStep(pennyUp(n) / px, "0.00001"));
    const altPaid = debit(alt, px);
    cases.push({
      id: oid, ts, book, side: rungSide, k: Number(k), base: b, limit: px, notional: n, paidGbp: Math.round(paid * 1e6) / 1e6,
      alternativeBase: alt, alternativePaidGbp: altPaid,
      // what the penny bought in coin under each sizing, valued at the limit: the waste is the pounds less the coins' worth
      // An exit that filled in part paid for what filled; the alternative is priced only for one that filled whole.
      filledWhole: Number(filled) >= b - 1e-9,
      wasteGbp: Math.round((paid - Number(filled) * px) * 1e6) / 1e6,
      alternativeWasteGbp: Number(filled) >= b - 1e-9 ? Math.round((altPaid - alt * px) * 1e6) / 1e6 : Math.round((paid - Number(filled) * px) * 1e6) / 1e6,
    });
  }
  const sum = (k: "wasteGbp" | "alternativeWasteGbp") => cases.reduce((a, c) => a + (c[k] as number), 0);
  out[id] = { n: cases.length, wasteGbp: sum("wasteGbp"), alternativeWasteGbp: sum("alternativeWasteGbp"), saved: sum("wasteGbp") - sum("alternativeWasteGbp"), cases };
  console.log(id.padEnd(7), "exits at the minimum", cases.length, "filled whole", cases.filter((c) => c.filledWhole).length, "penny paid for nothing £", sum("wasteGbp").toFixed(4), "→ with the alternative £", sum("alternativeWasteGbp").toFixed(4));
}
await Deno.writeTextFile(`${here}results/dust_exit.json`, JSON.stringify(out, null, 1));
