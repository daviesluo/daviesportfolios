// LP-REFILL (2026-10-10): refill mechanisms and loss guards for live-prep. Davies, 2026-10-10 ~14:00 UTC: "现在就做补选吧，不然
// 资金利用率太低了，研究出一套最合理的机制，你说的亏损还没控制你研究下"; then: the reserve refreshed through the day ("实时更新比如每分钟
// 之类的") and never every place idle while paying candidates exist. Live-prep as it runs now (L1, the near-certain limit, the
// reward check on the programme as read each minute, AI markets out: Addendum 12) at a total cap of $300 (its equity at
// cost less $80 on 10-10), on LP-ALLOC's full-universe record extended to 10-10 13:00 UTC.
// From this folder: deno run --v8-flags=--max-old-space-size=7000 --allow-read --allow-write --allow-env --no-check scripts/refill_run.ts <pr_record.json> <progs.json.gz> <stage> [--at-price]
// stages: refill, guards, combo, final, final2, deployed, episodes. Writes results/raw/<stage>[_atprice].json.
import { simulate, type Variant } from "./refill_sim.ts";
import { sizeN } from "../../../../../supabase/functions/agents/pmrw.ts";
import { loadAlloc } from "./rec_alloc.ts";
import type { Meta, Rec } from "../../lpself/scripts/rec.ts";

const [recFile, progsFile, stage] = Deno.args, atPrice = Deno.args.includes("--at-price");
const rec = loadAlloc(recFile, progsFile);
/** LP-ALLOC's type of a market (backtests/lp_alloc/scripts/alloc_run.ts `typeOf`, the list of its sql/markouts.sql), copied as it is. */
export function typeOf(q: string): string {
  const x = q.toLowerCase(), t = (re: string) => new RegExp(re).test(x);
  if (t("(highest temperature|lowest temperature|rain |rain\\?|precipitation|wind gust|drought|earthquake|water level|peak at category|°)")) return "weather/nature";
  if (t("(mtv|video music)")) return "entertainment/sports";
  if (t("(views|video|posts? |tweets|truth social|monthly listeners|streams|first week sales|spotify|song this week|netflix show|tokens the week|market share|deaths)")) return "counts";
  if (t("(box office|rotten tomatoes|tomatometer)")) return "box office/reviews";
  if (t("(ai model|anthropic|openai|gemini|gpt|grok|claude|deepseek|mistral|llm|arena|livebench|meta muse|fable model)")) return "AI";
  if (t("(inflation|cpi|pce|gdp|jobs|jolts|pmi|fed |bps|s&p|spx|spy|wti|crude|etf|\\(low\\)|\\(high\\)|closes above|up or down|home value|net worth|diesel|committed to|combined ratio)")) return "macro/markets";
  if (t("(election|presidential|mayor|senate|parliament|nomination|votes|trump|xi jinping|iran|saudi|yemen|houthi|hormuz|russia|ukraine|israel|military|troops|sanaa|bab el|ships|summit|white house|vatican|zelensky|khamenei|moratorium|plague|ubs|lula|bolsonaro|centcom)")) return "politics/geo";
  if (t("(mtv|video music|coachella|dancing with the stars|award|mlb|nba|nfl|nhl|lcs|major|grand prix|game|bruins|minecraft|messi)")) return "entertainment/sports";
  return "other";
}
const skipOf = (types: string[]) => (m: Meta) => sizeN(m.minSize) > 20 || types.includes(typeOf(m.q));
// The steady-programme test (LP-ALLOC's `stable`): every reading of the 3 hours before lists a programme of $10 or more
// with the minimum it has now and at least 0.8 of the rate it has now.
const stableAt = (m: Meta, at: number) => {
  const l = rec.progs.get(m.cond) ?? [], tm = at / 60e3, from = tm - 180;
  const inWin = l.filter((e, i) => e[0] <= tm && (e[0] >= from || (l[i + 1]?.[0] ?? Infinity) > from));
  if (!inWin.length) return false;
  const now = inWin[inWin.length - 1];
  return inWin.every((e) => e[1] !== null && e[1] >= 10 && e[3] === now[3] && e[1] >= 0.8 * (now[1] as number));
};
const BASE: Variant = {
  id: "base", skipMarket: skipOf(["AI"]), budget: 200, maxMarkets: 10, caps: { total: 300, market: 100, reduceFirst: true }, invCap: 5, k: 1,
  stops: { day: 1e9, total: 75, basis: "paid", R: 0.47 }, pause: { cents: 15, minutes: 60 }, tight: { mode: "skip", maxTicks: 1 }, exitCarried: true,
  nearCertain: { thr: 0.95, share: 0.08 }, liveProg: { nMax: 20, minRate: 10, lookbackMin: 0 },
};
const arms: Variant[] = [];
const R = (id: string, refill: Variant["refill"], extra: Partial<Variant> = {}): Variant => ({ ...BASE, ...extra, id, refill });
if (stage === "refill") {
  arms.push({ ...BASE, id: "none" });
  for (const off of [0, 5, 15, 60]) for (const cap of [undefined, 10]) for (const st of [false, true]) {
    arms.push(R(`reserve00 off${off}${cap ? ` max${cap}` : ""}${st ? " stable" : ""}`, { reserve: 20, offMin: off, maxPerDay: cap, source: "reserve", ok: st ? stableAt : undefined }));
  }
  for (const off of [0, 15]) arms.push(R(`fresh2h off${off}`, { reserve: 20, offMin: off, source: "fresh" }));
  for (const rr of [5, 15, 60]) for (const off of [0, 15]) for (const all of [false, true]) for (const st of [false, true]) {
    arms.push(R(`live${rr} off${off}${all ? " allOut" : ""}${st ? " stable" : ""}`, { reserve: 20, offMin: off, source: "live", rerankMin: rr, allOut: all, ok: st ? stableAt : undefined }));
  }
  for (const rr of [5, 15]) arms.push(R(`live${rr} off15 allOut max20`, { reserve: 20, offMin: 15, source: "live", rerankMin: rr, allOut: true, maxPerDay: 20 }));
  arms.push({ ...BASE, id: "reselect6h", reselectEveryH: 6 });
  arms.push({ ...BASE, id: "reselect2h", reselectEveryH: 2 });
}
const CARRIERS: Array<[string, Variant["refill"]]> = [["", undefined], ["live15 off15 allOut | ", { reserve: 20, offMin: 15, source: "live", rerankMin: 15, allOut: true }]];
if (stage === "guards") for (const [pre, refill] of CARRIERS) {
  const G = (id: string, extra: Partial<Variant>) => arms.push({ ...BASE, ...extra, refill, id: `${pre}${id}` });
  G("none", {});
  for (const mn of [30, 60, 120]) for (const c of [5, 10, 15]) G(`midMove ${mn}m ${c}c`, { midMove: { minutes: mn, cents: c } });
  for (const f of [3, 4, 6]) for (const h of [60, 240]) G(`oneWay ${f} ${h}m`, { oneWay: { fills: f, holdMin: h } });
  G("band .2-.8 3N", { bandCap: { lo: 0.2, hi: 0.8, invCap: 3 } });
  G("band .2-.8 2N", { bandCap: { lo: 0.2, hi: 0.8, invCap: 2 } });
  G("band .15-.85 3N", { bandCap: { lo: 0.15, hi: 0.85, invCap: 3 } });
  for (const h of [6, 24, 48]) G(`noBuyEnd ${h}h`, { noBuyEndH: h });
  for (const y of [5, 10, 15, 20]) G(`marketLoss $${y}`, { marketLoss: y });
  for (const d of [10, 15]) G(`drift ${d}c`, { driftStop: d });
  G("no counts", { skipMarket: skipOf(["AI", "counts"]) });
  G("side cap 3N", { invCap: 3 });
}
const COMBOS: Array<[string, Partial<Variant>]> = [
  ["midMove 60m 10c + marketLoss $10", { midMove: { minutes: 60, cents: 10 }, marketLoss: 10 }],
  ["midMove 60m 10c + oneWay 4 240m", { midMove: { minutes: 60, cents: 10 }, oneWay: { fills: 4, holdMin: 240 } }],
  ["oneWay 4 240m + marketLoss $10", { oneWay: { fills: 4, holdMin: 240 }, marketLoss: 10 }],
  ["midMove 60m 10c + oneWay 4 240m + marketLoss $10", { midMove: { minutes: 60, cents: 10 }, oneWay: { fills: 4, holdMin: 240 }, marketLoss: 10 }],
  ["midMove 60m 10c + band .2-.8 3N", { midMove: { minutes: 60, cents: 10 }, bandCap: { lo: 0.2, hi: 0.8, invCap: 3 } }],
  ["midMove 120m 10c + marketLoss $10", { midMove: { minutes: 120, cents: 10 }, marketLoss: 10 }],
];
const COMBO_ENV = Deno.env.get("COMBOS");   // a JSON list of [label, partial variant] to add (the analysis's picks)
if (stage === "combo") {
  const list = [...COMBOS, ...(COMBO_ENV ? JSON.parse(COMBO_ENV) as Array<[string, Partial<Variant>]> : [])];
  for (const [rid, refill] of [["none", undefined], ["live15 off15 allOut", { reserve: 20, offMin: 15, source: "live", rerankMin: 15, allOut: true }], ["live5 off15 allOut", { reserve: 20, offMin: 15, source: "live", rerankMin: 5, allOut: true }], ["reserve00 off15", { reserve: 20, offMin: 15, source: "reserve" }]] as Array<[string, Variant["refill"]]>) {
    arms.push({ ...BASE, refill, id: `${rid} | guards none` });
    for (const [g, extra] of list) arms.push({ ...BASE, ...extra, refill, id: `${rid} | ${g}` });
  }
}
// final: the candidates the tables point to, at caps of $300 (today), $400 and $500.
if (stage === "final") {
  const RF = (rr: number, max?: number): Variant["refill"] => ({ reserve: 20, offMin: 15, source: "live", rerankMin: rr, allOut: true, maxPerDay: max });
  const G: Array<[string, Partial<Variant>]> = [
    ["guards none", {}],
    ["marketLoss $10", { marketLoss: 10 }],
    ["midMove 60m 15c", { midMove: { minutes: 60, cents: 15 } }],
    ["marketLoss $10 + midMove 60m 15c", { marketLoss: 10, midMove: { minutes: 60, cents: 15 } }],
    ["marketLoss $10 + midMove 60m 15c + oneWay 4 240m", { marketLoss: 10, midMove: { minutes: 60, cents: 15 }, oneWay: { fills: 4, holdMin: 240 } }],
    ["marketLoss $10 + midMove 60m 15c + drift 10c", { marketLoss: 10, midMove: { minutes: 60, cents: 15 }, driftStop: 10 }],
  ];
  for (const C of [300, 400, 500]) {
    const caps = { total: C, market: 100, reduceFirst: true };
    for (const [rid, refill] of [["no refill", undefined], ["live15 off15 allOut max20", RF(15, 20)], ["live5 off15 allOut max20", RF(5, 20)], ["live15 off15 allOut", RF(15)], ["reserve00 off60 max10", { reserve: 20, offMin: 60, source: "reserve", maxPerDay: 10 }]] as Array<[string, Variant["refill"]]>) {
      for (const [g, extra] of G) arms.push({ ...BASE, ...extra, caps, refill, id: `C${C} | ${rid} | ${g}` });
    }
  }
}
// final2: the reserve the refill table points to (00:00 ranking, refilled the minute the reward check takes a market out, ten a day) with the guards.
if (stage === "final2") {
  const G: Array<[string, Partial<Variant>]> = [["guards none", {}], ["marketLoss $10", { marketLoss: 10 }], ["marketLoss $5", { marketLoss: 5 }], ["midMove 60m 15c", { midMove: { minutes: 60, cents: 15 } }],
    ["oneWay 4 240m", { oneWay: { fills: 4, holdMin: 240 } }], ["marketLoss $10 + oneWay 4 240m", { marketLoss: 10, oneWay: { fills: 4, holdMin: 240 } }], ["marketLoss $10 + midMove 60m 15c", { marketLoss: 10, midMove: { minutes: 60, cents: 15 } }]];
  for (const C of [300, 400]) for (const [rid, refill] of [["no refill", undefined], ["reserve00 off0 max10", { reserve: 20, offMin: 0, source: "reserve", maxPerDay: 10 }], ["reserve00 off5 max10", { reserve: 20, offMin: 5, source: "reserve", maxPerDay: 10 }], ["live60 off15 max10", { reserve: 20, offMin: 15, source: "live", rerankMin: 60, allOut: true, maxPerDay: 10 }]] as Array<[string, Variant["refill"]]>) {
    for (const [g, extra] of G) arms.push({ ...BASE, ...extra, caps: { total: C, market: 100, reduceFirst: true }, refill, id: `C${C} | ${rid} | ${g}` });
  }
}
// deployed: Addendum 13 as it went live at about 14:00 UTC on 10-10 (PM_LP_REFILL: a live reserve of 30 re-ranked every
// 5 minutes, a slot refilled after 15 minutes out or at once when none quotes, ten a day), and its neighbours, at $300.
if (stage === "deployed") {
  const L = (rr: number, off: number): Variant["refill"] => ({ reserve: 30, offMin: off, source: "live", rerankMin: rr, allOut: true, maxPerDay: 10, liveTop: 30 });
  const rows: Array<[string, Variant["refill"]]> = [["no refill", undefined]];
  for (const rr of [5, 15, 60]) for (const off of [0, 15, 60]) rows.push([`live${rr} off${off} max10 top30${rr === 5 && off === 15 ? " (A13 as deployed)" : ""}`, L(rr, off)]);
  for (const off of [0, 15]) rows.push([`reserve00 off${off} max10 res30`, { reserve: 30, offMin: off, source: "reserve", maxPerDay: 10 }]);
  for (const [rid, refill] of rows) arms.push({ ...BASE, caps: { total: 300, market: 100, reduceFirst: true }, refill, id: `${rid} | guards none` });
  for (const [rid, refill] of [rows[0], rows[2], rows[8], rows[10], rows[11]]) arms.push({ ...BASE, caps: { total: 300, market: 100, reduceFirst: true }, refill, marketLoss: 10, id: `${rid} | marketLoss $10` });
  // A refill only while the inventory held is under $H (the cap is $300 of holdings and resting buys together).
  for (const [rid, refill] of [rows[2], rows[10]]) for (const h of [100, 150, 200]) arms.push({ ...BASE, caps: { total: 300, market: 100, reduceFirst: true }, refill: { ...refill!, maxHeld: h }, id: `${rid} held<$${h} | guards none` });
  // How close $10 sits to the $5 that costs: the levels between, on today's rule and on the deployed refill.
  for (const [rid, refill] of [rows[0], rows[2]]) for (const y of [5, 7.5, 12.5]) arms.push({ ...BASE, caps: { total: 300, market: 100, reduceFirst: true }, refill, marketLoss: y, id: `${rid} | marketLoss $${y}` });
}
// The live episodes: live-prep's own selections of 10-09 and 10-10 imposed from its first live minute, quoted as live-prep
// quoted them then (the 00:00 programme all day on 10-09: no reward check yet; AI not yet out), each guard alone.
if (stage === "episodes") {
  const aux = JSON.parse(Deno.readTextFileSync("data/aux.json"));
  const live = new Map<string, Set<string>>();
  for (const m of aux.lp_markets as Array<{ day: string; cond: string }>) if (m.day >= "2026-10-09") (live.get(m.day) ?? live.set(m.day, new Set()).get(m.day)!).add(m.cond);
  // markets the 00:00 slot did not rank join their day's selection from their latest slot row
  for (const [day, set] of live) {
    const day0 = Date.parse(`${day}T00:00:00Z`), sel = rec.selection.get(day) ?? [];
    for (const c of set) {
      if (sel.some((m) => m.cond === c)) continue;
      const t = [...rec.slots.keys()].filter((x) => x <= day0 && rec.slots.get(x)!.some((m) => m.cond === c)).sort((a, b) => b - a)[0];
      if (t === undefined) { console.error(`live market ${c.slice(0, 10)} of ${day} is not in the record`); continue; }
      sel.push({ ...rec.slots.get(t)!.find((x) => x.cond === c)!, day, rank: 99 });
    }
    rec.selection.set(day, sel);
  }
  const E: Variant = { ...BASE, id: "as live", liveProg: undefined, skipMarket: (m: Meta, at?: number) => !live.get(new Date(at ?? 0).toISOString().slice(0, 10))?.has(m.cond), budget: 1e9, caps: { total: 330, market: 100, reduceFirst: true } };
  arms.push(E);
  for (const mn of [30, 60, 120]) for (const c of [5, 10, 15]) arms.push({ ...E, id: `midMove ${mn}m ${c}c`, midMove: { minutes: mn, cents: c } });
  for (const f of [3, 4, 6]) arms.push({ ...E, id: `oneWay ${f} 240m`, oneWay: { fills: f, holdMin: 240 } });
  arms.push({ ...E, id: "band .2-.8 3N", bandCap: { lo: 0.2, hi: 0.8, invCap: 3 } });
  for (const y of [5, 10, 15]) arms.push({ ...E, id: `marketLoss $${y}`, marketLoss: y });
  arms.push({ ...E, id: "drift 10c", driftStop: 10 });
  for (const h of [24, 48]) arms.push({ ...E, id: `noBuyEnd ${h}h`, noBuyEndH: h });
  arms.push({ ...E, id: "side cap 3N", invCap: 3 });
  arms.push({ ...E, id: "midMove 60m 10c + marketLoss $10", midMove: { minutes: 60, cents: 10 }, marketLoss: 10 });
}
const span = stage === "episodes" ? { from: Date.parse("2026-10-09T01:33:00Z") } : {};
const out: Record<string, unknown> = {};
const t0 = performance.now();
for (const v of arms) {
  const o = simulate(rec as unknown as Rec, { ...v, fillAtPrice: atPrice }, span);
  let prev = { total: 0, reward: 0 };
  const daily = o.days.map((d) => {
    const r = { day: d.day, tot: d.total - prev.total, rew: d.reward - prev.reward, comMax: d.committedMax, comMean: d.committedMean, heldClose: d.heldClose, posts: d.posts, refills: d.refills,
      guardBlocks: d.guardBlocks, activeMean: d.activeMean, zeroSlotMin: d.zeroSlotMin, progOff: d.progOff, capWithheld: d.capWithheld, stop: d.stopDay || d.stopTotal };
    prev = { total: d.total, reward: d.reward };
    return r;
  });
  const per = Object.entries(o.perMarket).map(([c, x]) => ({ c: c.slice(0, 10), fills: x.total - x.reward, reward: x.reward, n: x.fills, sh: x.fillShares ?? 0, t: x.meta ? typeOf(x.meta.q) : "?", q: x.meta?.q?.slice(0, 60) ?? "" }));
  out[v.id] = { daily, fills: Object.values(o.perMarket).reduce((s, x) => s + x.fills, 0), fillShares: Object.values(o.perMarket).reduce((s, x) => s + (x.fillShares ?? 0), 0), end: o.end,
    worst: per.slice().sort((a, b) => a.fills - b.fills).slice(0, 5), ...(stage === "episodes" ? { perMarket: per } : {}) };
  console.error(`  ${v.id} ${((performance.now() - t0) / 1000).toFixed(0)} s`);
}
Deno.mkdirSync("results/raw", { recursive: true });
Deno.writeTextFileSync(`results/raw/${stage}${atPrice ? "_atprice" : ""}.json`, JSON.stringify(out));
