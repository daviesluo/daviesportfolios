import { loadRW } from "./rec.ts";
import { chooseDay, type Variant } from "./sim.ts";
import { sizeN } from "../../../../../supabase/functions/agents/pmrw.ts";
const rec = loadRW();
const S1: Variant = { id: "S1", skipMarket: (m) => sizeN(m.minSize) > 20, budget: 200, maxMarkets: 10 };
for (const d of rec.days) {
  const ch = chooseDay(rec, S1, d), all = rec.selection.get(d) ?? [];
  const cap = ch.reduce((s, m) => s + (m.capital ?? 0), 0);
  console.log(`${d}: RW selected ${all.length}, S1 takes ${ch.length} ($${cap.toFixed(0)} of first quotes); rates ${ch.map((m) => m.rate).join(", ")}`);
}
