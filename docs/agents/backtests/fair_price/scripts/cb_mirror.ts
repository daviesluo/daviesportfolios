// REVX-FAIR addendum (2026-10-29): the USDC-GBP lead mirrored onto Coinbase, replayed with "Stablecoin quotes with Euros - 2"'s
// own engine. Davies, 2026-10-29: "建USDC 那个线索，在with euro-2的基础上开-3，只做300美元的USDC-GBP".
//
// The engine is production's, imported: `stepMinute` (agents/quotes.ts) driven as `runCbUsdc` (agents/cb_usdc.ts) drives it on
// USDC-GBP: the GBP/USD bar held up to 60 hours (`cbHoldBarAt`), fairU the median of Revolut X's USDC-USD hourly closes over the
// last day (`fairHours`, `median`), the book's inputs from `cbMinuteInputs` in dollars (Deviation 1's rule, x = GBP/USD), fairU
// withheld in a release blackout (`cbInBlackout`), the prints at the arm's size (`stepMinute`'s 100 over FACTOR: FACTOR 2 is -3's
// $50 a rung; FACTOR 4 is -2's $25), its trips back at that size and a stop at Coinbase's cost (`cbStopExit`). Its fill model is
// the engine's: a print strictly through, the rung capped at 10 % of the minute's printed value.
//
// The prints are `cb_print_minutes` (the recorder's minute summary: second, price, aggressor, count and size, from 2026-10-09
// 19:57), since `cb_trades` keeps only its last ten days (from 10-18 10:54 here). Each entry becomes one print at its second.
//
// The nudge (the coordinator's spec): d(t) = (RX(t) - fair(t)) - EMA(RX - fair); fair' = fair + w d, where RX is Revolut X's
// USDC-GBP mid read at the turn (data/rx_mid_USDC-GBP.txt, cb_mirror_prep.py: the snapshot of agent_book_levels stamped before
// t, none when its seen_until is over 5 minutes before t), fair today's book fair (fairU / x). The EMA has half-life HL minutes
// and moves only on minutes with an RX; d is skipped (fair unchanged) when RX is missing or |d| >= 50 bps of fair.
//
//   npx --yes deno@1.46.3 run --allow-read --allow-write docs/agents/backtests/fair_price/scripts/cb_mirror.ts
// writes results/cb_mirror_trips.json (every configuration's trips); cb_mirror.py scores them.
import { fairHours, median, newBookState, stepMinute, type MinuteInputs, type Print, type QuoteBook, type Trip } from "../../../../../supabase/functions/agents/quotes.ts";
import { cbMinuteInputs, cbStopExit } from "../../../../../supabase/functions/agents/cb_quotes.ts";
import { cbHoldBarAt } from "../../../../../supabase/functions/agents/cb_hold.ts";
import { cbInBlackout } from "../../../../../supabase/functions/agents/cb_releases.ts";
import { inQuoteClosure } from "../../../../../supabase/functions/agents/quotes_weekend.ts";

const M = 60e3;
const HERE = new URL("..", import.meta.url).pathname;
const B = "USDC-GBP";

async function text(name: string): Promise<string> {
  try { return await Deno.readTextFile(HERE + "data/" + name); } catch { /* compressed */ }
  const f = await Deno.open(HERE + "data/" + name + ".gz");
  return await new Response(f.readable.pipeThrough(new DecompressionStream("gzip"))).text();
}
const lines = (s: string) => s.split("\n").filter((l) => l.length);

// ------------------------------------------------------------------ inputs
const fx = lines(await text("fx.txt")).map((l) => l.split("|").map(Number) as [number, number]).sort((a, b) => a[0] - b[0]);
const hours = lines(await text("hours.txt")).map((l) => l.split("|")).filter((p) => p[0] === "fair:USDC-USD")
  .map((p) => [Number(p[1]), Number(p[2])] as [number, number]).sort((a, b) => a[0] - b[0]);
const pm = new Map<number, Print[]>();
for (const l of lines(await text("cb_print_minutes_USDC-GBP.txt"))) {
  const [m, sec, px, buy, _n, sz] = l.split("|");
  const t = Number(m), S = sec.split(",").map(Number), P = px.split(",").map(Number), Bu = buy.split(","), Z = sz.split(",").map(Number);
  const ps: Print[] = S.map((s, i) => ({ id: `${t}-${i}`, ts: t + s * 1000, ticks: P[i], qty: Z[i] / 100, side: Bu[i] === "1" ? "buy" : "sell" }));
  ps.sort((a, b) => a.ts - b.ts);
  pm.set(t, ps);
}
const rx = new Map<number, { raw: number | null; clean: number | null }>();
for (const l of lines(await text("rx_mid_USDC-GBP.txt"))) {
  const [m, raw, clean] = l.split("|");
  rx.set(Number(m), { raw: raw ? Number(raw) : null, clean: clean ? Number(clean) : null });
}

type Cfg = { name: string; w: number; hl: number; where: "all" | "weekday" | "closure"; mid: "raw" | "clean"; factor: number; from: number; to: number };
type Out = { tEntry: number; tExit: number; side: string; k: number; how: string; pnl: number; notional: number; entry: number; exit: number; qty: number };

function run(c: Cfg): { trips: Out[]; orders: number; refused: number; nudged: number; minutes: number } {
  const st = newBookState(B as unknown as QuoteBook);
  let ema: number | null = null, lastE: number | null = null, orders = 0, refused = 0, nudged = 0, minutes = 0;
  const trips: Out[] = [];
  for (let t = c.from; t < c.to; t += M) {
    minutes++;
    const bar = cbHoldBarAt(t, fx), window = fairHours(t, hours);
    const io = cbMinuteInputs(B as never, bar ? bar[1] : null, null, median(window), true);
    let fairU = cbInBlackout(t) ? null : io.fairU;
    if (fairU != null && io.x) {
      const f = fairU / io.x;
      const r = rx.get(t)?.[c.mid] ?? null;
      if (r != null) {
        const g = r - f;
        ema = ema == null ? g : ema + (1 - Math.pow(0.5, (t - lastE!) / M / c.hl)) * (g - ema);
        lastE = t;
        const d = g - ema, closed = inQuoteClosure(t);
        const on = c.w > 0 && (c.where === "all" || (c.where === "closure") === closed);
        if (on && Math.abs(d / f) < 0.005) { fairU = (f + c.w * d) * io.x; nudged++; }
      }
    }
    const mine = (pm.get(t) ?? []).map((p) => ({ ...p, qty: p.qty * c.factor }));
    const inp: MinuteInputs = { x: io.x, fairU, prints: mine };
    const out = stepMinute(st, t, inp);
    orders += out.orders;
    refused += out.events.filter((e) => e.kind === "refused").length;
    for (const x0 of out.trips) {
      const f = c.factor;
      const x1: Trip = { ...x0, qty: x0.qty / f, nq: x0.nq / f, notionalUsd: x0.notionalUsd / f, pnlUsd: x0.pnlUsd / f };
      const x = cbStopExit(x1, B as never);
      trips.push({ tEntry: x.tEntry, tExit: x.tExit, side: x.side, k: x.k, how: x.how, pnl: x.pnlUsd, notional: x.notionalUsd, entry: x.entry, exit: x.exit, qty: x.qty });
    }
  }
  // a holding still open at the end: marked at the last print, as the Revolut X replay marks one
  const lp = st.lastPrint ? st.lastPrint.ticks * 1e-4 : null;
  for (const r of st.rungs) if (r.mode === "position" && lp != null) {
    const pnlQ = r.side === "bid" ? r.qty! * (lp - r.entry!) : r.qty! * (r.entry! - lp);
    trips.push({ tEntry: r.tEntry!, tExit: c.to, side: r.side, k: r.k, how: "open", pnl: pnlQ * (st.lastX ?? 1) / c.factor, notional: r.nq! * (st.lastX ?? 1) / c.factor, entry: r.entry!, exit: lp, qty: r.qty! / c.factor });
  }
  return { trips, orders, refused, nudged, minutes };
}

const D = (s: string) => Date.parse(s);
const FROM = D("2026-10-10T00:00:00Z"), TO = D("2026-10-29T00:00:00Z");
const cfgs: Cfg[] = [];
const add = (name: string, w: number, hl: number, where: Cfg["where"] = "all", mid: Cfg["mid"] = "raw") => cfgs.push({ name, w, hl, where, mid, factor: 2, from: FROM, to: TO });
add("base", 0, 1440);
for (const w of [0.25, 0.5, 0.75, 1.0]) for (const hl of [360, 1440, 2880]) add(`w${w}|hl${hl}|all|raw`, w, hl);
add("w0.5|hl1440|weekday|raw", 0.5, 1440, "weekday"); add("w0.5|hl1440|closure|raw", 0.5, 1440, "closure");
for (const w of [0.5, 1.0]) add(`w${w}|hl1440|all|clean`, w, 1440, "all", "clean");
// reproduction: -1 ("with Euros - 1", cb_hold, £100 a rung, from 10-13) and -2 (cb_usdc, £25, from 10-27), in pounds as they ran
const repro: Cfg[] = [
  { name: "repro_hold", w: 0, hl: 1440, where: "all", mid: "raw", factor: 1, from: D("2026-10-13T00:00:00Z"), to: TO },
  { name: "repro_usdc", w: 0, hl: 1440, where: "all", mid: "raw", factor: 4, from: D("2026-10-27T00:00:00Z"), to: TO },
];
const res: Record<string, unknown> = {};
for (const c of cfgs) { const r = run(c); res[c.name] = { cfg: c, ...r }; console.log(c.name, r.trips.length, r.orders, r.refused, r.nudged, r.trips.reduce((a, x) => a + x.pnl, 0).toFixed(4)); }
// the reproductions run the pounds rule (x = 1) the record was decided under before 10-29
function runPounds(c: Cfg) {
  const st = newBookState(B as unknown as QuoteBook); const trips: Out[] = [];
  for (let t = c.from; t < c.to; t += M) {
    const bar = cbHoldBarAt(t, fx), window = fairHours(t, hours);
    const io = cbMinuteInputs(B as never, bar ? bar[1] : null, null, median(window), false);
    const inp: MinuteInputs = { x: io.x, fairU: cbInBlackout(t) ? null : io.fairU, prints: (pm.get(t) ?? []).map((p) => ({ ...p, qty: p.qty * c.factor })) };
    for (const x0 of stepMinute(st, t, inp).trips) {
      const f = c.factor, x = cbStopExit({ ...x0, qty: x0.qty / f, nq: x0.nq / f, notionalUsd: x0.notionalUsd / f, pnlUsd: x0.pnlUsd / f }, B as never);
      trips.push({ tEntry: x.tEntry, tExit: x.tExit, side: x.side, k: x.k, how: x.how, pnl: x.pnlUsd, notional: x.notionalUsd, entry: x.entry, exit: x.exit, qty: x.qty });
    }
  }
  return trips;
}
for (const c of repro) { const tr = runPounds(c); res[c.name] = { cfg: c, trips: tr }; console.log(c.name, tr.length); }
await Deno.writeTextFile(HERE + "results/cb_mirror_trips.json", JSON.stringify(res));
