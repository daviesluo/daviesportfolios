// Scratch: mini-pool's and mid-pool's paper layers per market, as their page computes a market's part (pm_prep_view.ts).
import { bookPnl } from "/home/user/daviesportfolios/supabase/functions/agents/pm_live.ts";
import { paperPnl, type PrepFill, type PrepState } from "/home/user/daviesportfolios/supabase/functions/agents/pm_prep.ts";
import { accStress } from "/home/user/daviesportfolios/supabase/functions/agents/pmrw.ts";
const DAY = 86400e3;
const P = JSON.parse(Deno.readTextFileSync("./data/pools.json"));
const fr = JSON.parse(Deno.readTextFileSync("./classes_frozen.json")).classes;
const cls = (q: string) => (["P", "V", "C"].find((k) => new RegExp(fr[k].q, "i").test(q)) ?? "-");
for (const k of ["prep", "mid"]) {
  const x = P[k];
  const st = x.state.state as PrepState;
  const now = Date.parse(x.state.last_minute);
  const fills: PrepFill[] = (x.fills ?? []).filter((f: { minute: string }) => Date.parse(f.minute) <= st.lastDecided).map((f: Record<string, string>) => ({
    cond: f.cond, minute: Date.parse(f.minute), printId: f.print_id, ts: Date.parse(f.ts), side: f.side as "bid" | "ask", price: Number(f.price), size: Number(f.size),
    token: f.token, tokenSide: f.token_side as "BUY" | "SELL", tokenPrice: Number(f.token_price), closeOnly: !!f.close_only,
  }));
  const pnl = paperPnl(fills, x.settlements ?? [], st.tokens ?? {}, st.marks ?? {}, Math.floor(now / DAY) * DAY);
  const q = new Map<string, string>((x.markets as Array<Record<string, string>>).map((m) => [m.cond, m.question]));
  let T = 0, R = 0, F = 0, S = 0;
  const rows: string[] = [];
  for (const c of new Set([...Object.keys(st.tokens ?? {}), ...Object.keys(st.acc ?? {})])) {
    const tk = st.tokens?.[c];
    let fp = 0;
    if (tk) {
      const mid = st.marks?.[c];
      const books: typeof pnl.books = {};
      for (const t of [tk.yes, tk.no]) if (pnl.books[t]) books[t] = pnl.books[t];
      fp = bookPnl(books, { [tk.yes]: mid ?? null, [tk.no]: mid == null ? null : 1 - mid }).total;
    }
    const a = st.acc?.[c];
    const rew = a?.reward ?? 0, str = a ? accStress(a) : 0;
    T += rew + fp; R += rew; F += fp; S += str;
    const nf = fills.filter((f) => f.cond === c).length;
    rows.push(`  ${c.slice(0, 10)} ${cls(q.get(c) ?? "")} total ${(rew + fp).toFixed(2).padStart(7)} rewards ${rew.toFixed(2).padStart(6)} fills ${fp.toFixed(2).padStart(7)} (${nf}) | ${(q.get(c) ?? "(no question: an 0074 placeholder)").slice(0, 70)}`);
  }
  console.log(`== ${k === "prep" ? "mini-pool (pm_prep_*)" : "mid-pool (pm_midprep_*)"} at ${x.state.last_minute}: total ${T.toFixed(2)}, rewards ${R.toFixed(2)} (R=0.4 ${(T - 0.6 * R).toFixed(2)}), fills ${F.toFixed(2)}, ${fills.length} fills; page total check ${(pnl.total + R).toFixed(2)}`);
  for (const r of rows.sort()) console.log(r);
}
