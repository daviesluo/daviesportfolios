// LP-ALLOC (2026-10-10): how live-prep should use more money. Davies, 2026-10-10: "如果我现在想补充资金你建议补多少并切策略如何改进，
// 增加QUOTING TODAY的数量吗？你研究一下确保效果最好". Live-prep's rule (LPSELF's L1, checked byte for byte against LPSELF's committed
// result first), then L1 as it runs live now (Addendum 7's near-certain limit, and the reward check of the lp-reward-refresh
// change: the minute's programme in the formula, no entry where it no longer pays), at the total caps that each amount added
// gives (cap = floor(equity - 75 - 5): $330 today, $430, $580, $830, $1,330 at +$100 / +$250 / +$500 / +$1,000), over the
// knobs: markets a day M, order size k x N, the ceiling on N (nMax), the cap a market and the first-quote budget.
// From this folder (docs/agents/backtests/lp_alloc):
//   deno run --v8-flags=--max-old-space-size=7000 --allow-read --allow-write --allow-env --no-check scripts/alloc_run.ts <pr_record.json> data/progs.json.gz <stage> [--at-price]
// stages: check (L1 against ../lpself/results/lp_pr.json, and L1-now), grid (M x k at N <= 20), nmax (the ceiling on N with M, k, the
// market cap), knobs (budget and the market cap alone), live (the 10-09 live selection, for the calibration). SHARD=i/n runs every
// n-th arm from i. Writes results/raw/lb<LOOKBACK>/<stage>[_atprice][.i].json (gzip'd for the commit: gzip -9).
import { simulate, type Variant } from "./alloc_sim.ts";
import { sizeN } from "../../../../../supabase/functions/agents/pmrw.ts";
import { loadAlloc } from "./rec_alloc.ts";
import type { Meta, Rec } from "../../lpself/scripts/rec.ts";

const [recFile, progsFile, stage] = Deno.args, atPrice = Deno.args.includes("--at-price");
const rec = loadAlloc(recFile, progsFile);
// LOOKBACK=L (minutes): the programme in force is the highest-rate reading of the last L minutes with the latest spread
// and minimum (the listing's rate flickers between readings: results/calib.txt); 0 reads each reading as it is.
const LB = Number(Deno.env.get("LOOKBACK") ?? "0");
const LPSELF_LAST = Date.parse("2026-10-08T22:59:00Z");   // the last minute of LPSELF's record
// L1 exactly as LPSELF's lpgrid.ts (and LPCAP's cap_run.ts) write it, on the full-universe record.
const L1: Variant = {
  id: "L1", skipMarket: (m) => sizeN(m.minSize) > 20, budget: 200, maxMarkets: 10, caps: { total: 320, market: 100, reduceFirst: true }, invCap: 5,
  stops: { day: 1e9, total: 75, basis: "paid", R: 0.4 }, pause: { cents: 15, minutes: 60 }, tight: { mode: "skip", maxTicks: 1 }, exitCarried: true,
};
export const CAPS = [330, 430, 580, 830, 1330];
type P = { M: number; k: number; nMax: number; capMarket: number; budget?: number };
/** Live-prep as it runs now, at total cap C, with the knobs P; the stop stays $75 (his figure), on the paid basis at R = 0.33. */
const arm = (C: number, p: P, id?: string): Variant => ({
  ...L1, id: id ?? `C${C} M${p.M} k${p.k} n${p.nMax} cm${p.capMarket}${p.budget !== undefined ? ` b${p.budget}` : ""}`,
  skipMarket: (m: Meta) => sizeN(m.minSize) > p.nMax, maxMarkets: p.M, budget: p.budget ?? C, k: p.k,
  caps: { total: C, market: p.capMarket, reduceFirst: true }, stops: { day: 1e9, total: 75, basis: "paid", R: 0.33 },
  nearCertain: { thr: 0.95, share: 0.08 }, liveProg: { nMax: p.nMax, minRate: 10, lookbackMin: LB },
});
const arms: Variant[] = [];
let checkL1 = false;
if (stage === "check") {
  checkL1 = true;
  arms.push(arm(330, { M: 10, k: 1, nMax: 20, capMarket: 100, budget: 200 }, "L1-now C330"));
  arms.push({ ...arm(330, { M: 10, k: 1, nMax: 20, capMarket: 100, budget: 200 }, "L1-now C330 formula at 00:00 programme"), liveProg: undefined });
  arms.push({ ...arm(330, { M: 10, k: 1, nMax: 20, capMarket: 100, budget: 200 }, "L1-now C330 no near-certain"), nearCertain: undefined });
}
if (stage === "grid") for (const C of CAPS) for (const M of [10, 15, 20, 30, 40]) for (const k of [1, 1.5, 2, 3]) arms.push(arm(C, { M, k, nMax: 20, capMarket: 100 * k }));
if (stage === "nmax") for (const C of CAPS) for (const nMax of [50, 100, 200]) for (const M of [10, 20, 30]) for (const k of [1, 2]) for (const cmx of [1, 2]) arms.push(arm(C, { M, k, nMax, capMarket: 100 * k * cmx }));
if (stage === "knobs") for (const C of CAPS) {
  for (const budget of [200, 300, 400, 600]) arms.push(arm(C, { M: 40, k: 1, nMax: 20, capMarket: 100, budget }));
  for (const capMarket of [60, 150, 200, 300]) arms.push(arm(C, { M: 10, k: 1, nMax: 20, capMarket }));
  for (const capMarket of [60, 150, 200, 300]) arms.push(arm(C, { M: 20, k: 1, nMax: 20, capMarket }));
}
// ideas: the selection's own reading of the programme. `stable`: a market is taken only while every reading of its programme
// in the 3 hours before the selection lists one at $10 or more with the minimum it has now and at least 0.8 of the rate
// it has now (the listing's rate flickers, and Polymarket paid the low reading: results/calib.txt); `reselect`: the rule
// chooses again every H hours from the record's slot at that minute (scored on the programme then).
const stableAt = (m: Meta, at?: number) => {
  const l = rec.progs.get(m.cond) ?? [], t = (at ?? Date.parse(`${m.day}T00:00:00Z`)) / 60e3, from = t - 180;
  const inWin = l.filter((e, i) => e[0] <= t && (e[0] >= from || (l[i + 1]?.[0] ?? Infinity) > from));
  if (!inWin.length) return false;
  const now = inWin[inWin.length - 1];
  return inWin.every((e) => e[1] !== null && e[1] >= 10 && e[3] === now[3] && e[1] >= 0.8 * (now[1] as number));
};
if (stage === "ideas") for (const C of CAPS) for (const [M, k, cm] of [[10, 1, 100], [10, 1.5, 150], [10, 2, 200], [15, 1, 100], [20, 1, 100]]) {
  const b = arm(C, { M, k, nMax: 20, capMarket: cm });
  arms.push({ ...b, id: `${b.id} stable`, skipMarket: (m: Meta, at?: number) => sizeN(m.minSize) > 20 || !stableAt(m, at) });
  for (const H of [2, 6]) {
    arms.push({ ...b, id: `${b.id} resel${H}`, reselectEveryH: H });
    arms.push({ ...b, id: `${b.id} stable resel${H}`, reselectEveryH: H, skipMarket: (m: Meta, at?: number) => sizeN(m.minSize) > 20 || !stableAt(m, at) });
  }
}
// risk: the inventory knobs, priced against the rewards they cost, and the reserve that refills a place a programme vacated.
// The type of a market is a pattern on its question, the list of sql/markouts.sql word for word (keep the two the same).
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
const without = (types: string[], nMax = 20) => (m: Meta) => sizeN(m.minSize) > nMax || types.includes(typeOf(m.q));
if (stage === "risk") for (const C of CAPS) for (const [M, k, cm] of [[10, 1, 100], [15, 1, 100], [10, 1.5, 150]]) {
  const b = arm(C, { M, k, nMax: 20, capMarket: cm });
  for (const inv of [3, 2]) arms.push({ ...b, id: `${b.id} inv${inv}N`, invCap: inv });
  for (const d of [5, 10, 20]) arms.push({ ...b, id: `${b.id} drift${d}`, driftStop: d });
  arms.push({ ...b, id: `${b.id} noAI`, skipMarket: without(["AI"]) });
  arms.push({ ...b, id: `${b.id} noAI-counts`, skipMarket: without(["AI", "counts"]) });
  for (const off of [15, 60]) arms.push({ ...b, id: `${b.id} refill${off}`, refill: { reserve: 10, offMin: off } });
  arms.push({ ...b, id: `${b.id} inv3N drift10`, invCap: 3, driftStop: 10 });
  arms.push({ ...b, id: `${b.id} inv3N drift10 refill15`, invCap: 3, driftStop: 10, refill: { reserve: 10, offMin: 15 } });
  arms.push({ ...b, id: `${b.id} inv3N drift10 refill15 noAI`, invCap: 3, driftStop: 10, refill: { reserve: 10, offMin: 15 }, skipMarket: without(["AI"]) });
  arms.push({ ...b, id: `${b.id} refill15 noAI`, refill: { reserve: 10, offMin: 15 }, skipMarket: without(["AI"]) });
}
// zero: no BUY that the formula scores 0 (Davies' "白挂了并且承担风险并且没奖励"), alone and with the risk knobs
if (stage === "zero") for (const C of CAPS) for (const [M, k, cm] of [[10, 1, 100], [15, 1, 100], [10, 1.5, 150]]) {
  const b = arm(C, { M, k, nMax: 20, capMarket: cm });
  for (const z of ["side", "market"] as const) {
    arms.push({ ...b, id: `${b.id} zero-${z}`, zeroBuy: z });
    arms.push({ ...b, id: `${b.id} zero-${z} refill15`, zeroBuy: z, refill: { reserve: 10, offMin: 15 } });
    arms.push({ ...b, id: `${b.id} zero-${z} inv3N drift10 refill15`, zeroBuy: z, invCap: 3, driftStop: 10, refill: { reserve: 10, offMin: 15 } });
  }
}
const extra = Deno.env.get("ARMS");   // a JSON list of [C, M, k, nMax, capMarket, budget?] for a refinement run
if (stage === "extra" && extra) for (const [C, M, k, nMax, capMarket, budget] of JSON.parse(extra)) arms.push(arm(C, { M, k, nMax, capMarket, budget: budget ?? undefined }));
// The 10-09 live selection (pm_lp_markets, day 2026-10-09) imposed on the sim for that day: the calibration against live.
if (stage === "live") {
  const aux = JSON.parse(Deno.readTextFileSync("data/lp_live_1009.json"));
  const liveConds = new Set((aux.markets as Array<{ day: string; cond: string }>).filter((m) => m.day === "2026-10-09").map((m) => m.cond));
  // the live markets the record's 00:00 slot did not rank (it keeps the best 60 by its own score): their latest slot row
  // before 10-09 00:00 joins that day's selection, at the programme the live selection read (pm_lp_markets)
  const day0 = Date.parse("2026-10-09T00:00:00Z"), sel = rec.selection.get("2026-10-09")!;
  const liveRow = new Map((aux.markets as Array<{ day: string; cond: string; rate: number; min_size: number; max_spread: number }>).filter((m) => m.day === "2026-10-09").map((m) => [m.cond, m]));
  for (const c of liveConds) {
    if (sel.some((m) => m.cond === c)) continue;
    const t = [...rec.slots.keys()].filter((x) => x <= day0 && rec.slots.get(x)!.some((m) => m.cond === c)).sort((a, b) => b - a)[0];
    if (t === undefined) { console.error(`live market ${c.slice(0, 10)} is not in the record`); continue; }
    const m = rec.slots.get(t)!.find((x) => x.cond === c)!, lr = liveRow.get(c)!;
    sel.push({ ...m, day: "2026-10-09", rate: Number(lr.rate), minSize: Number(lr.min_size), v: Number(lr.max_spread), rank: 99 });
    console.error(`live market ${c.slice(0, 10)} joins 10-09's selection from the slot of ${new Date(t).toISOString()}`);
  }
  const base = arm(330, { M: 10, k: 1, nMax: 20, capMarket: 100, budget: 1e9 }, "live selection 10-09");
  arms.push({ ...base, skipMarket: (m: Meta) => !liveConds.has(m.cond) });
  arms.push({ ...base, id: "live selection 10-09, 00:00 programme", skipMarket: (m: Meta) => !liveConds.has(m.cond), liveProg: undefined });
}
const [si, sn] = (Deno.env.get("SHARD") ?? "0/1").split("/").map(Number);
const mine = arms.filter((_, i) => i % sn === si);

const summary = (o: ReturnType<typeof simulate>) => {
  let prev = { total: 0, stress: 0, reward: 0 };
  const daily = o.days.map((d) => {
    const r = { day: d.day, tot: d.total - prev.total, rew: d.reward - prev.reward, comMax: d.committedMax, comMean: d.committedMean, heldClose: d.heldClose, posts: d.posts, pool: d.pool,
      progOff: d.progOff, progChanged: d.progChanged, refills: d.refills, markets: d.markets, capWithheld: d.capWithheld, stop: d.stopDay || d.stopTotal, chosen: (o.chosen[d.day] ?? []).length };
    prev = { total: d.total, stress: d.stress, reward: d.reward };
    return r;
  });
  const fills = Object.values(o.perMarket).reduce((s, x) => s + x.fills, 0), fillShares = Object.values(o.perMarket).reduce((s, x) => s + (x.fillShares ?? 0), 0);
  const perMarket = stage === "live" ? Object.fromEntries(Object.entries(o.perMarket).map(([c, x]) => [c, { reward: x.reward, total: x.total, fills: x.fills, fillShares: x.fillShares, quotedMin: x.quotedMin }])) : undefined;
  // the markets whose fills lost most over the run (total less reward: the fills' P&L at the last mark), and their type
  const worstMarkets = Object.entries(o.perMarket).map(([c, x]) => ({ c: c.slice(0, 10), fills: x.total - x.reward, reward: x.reward, t: x.meta ? typeOf(x.meta.q) : "?" })).sort((a, b) => a.fills - b.fills).slice(0, 5);
  return { daily, fills, fillShares, end: o.end, worstMarkets, perMarketTop: Object.values(o.perMarket).map((x) => x.reward).sort((a, b) => b - a).slice(0, 5), perMarket };
};
const out: Record<string, unknown> = {};
if (checkL1 && si === 0) {
  // L1 through this copy on the new record, cut at LPSELF's last minute, is LPSELF's committed L1 (lpgrid.ts's output shape).
  const l1 = simulate(rec as unknown as Rec, { ...L1, fillAtPrice: atPrice }, { to: LPSELF_LAST });
  let prev = { total: 0, stress: 0, reward: 0 };
  const daily = l1.days.map((d) => { const r = { day: d.day, tot: d.total - prev.total, str: d.stress - prev.stress, rew: d.reward - prev.reward, comMax: d.committedMax, stop: d.stopDay || d.stopTotal }; prev = { total: d.total, stress: d.stress, reward: d.reward }; return r; });
  const mine = { daily, fills: Object.values(l1.perMarket).reduce((s, x) => s + x.fills, 0), end: l1.end, chosenPerDay: Object.values(l1.chosen).reduce((s, l) => s + l.length, 0) / Math.max(1, Object.keys(l1.chosen).length) };
  const committed = JSON.parse(Deno.readTextFileSync(`../lpself/results/lp_pr${atPrice ? "_atprice" : ""}.json`)).L1;
  const same = JSON.stringify(mine) === JSON.stringify(committed);
  console.error(`L1 on this record to ${new Date(LPSELF_LAST).toISOString()}${atPrice ? " (at-price)" : ""}: ${same ? "REPRODUCES" : "does NOT reproduce"} LPSELF's lp_pr${atPrice ? "_atprice" : ""}.json byte for byte`);
  out["L1 check"] = { same, mine, committed };
  out["L1"] = summary(simulate(rec as unknown as Rec, { ...L1, fillAtPrice: atPrice }));
}
const t0 = performance.now();
// the live stage runs from the minute live-prep first quoted live (01:33 UTC), as the readout counts it
const span = stage === "live" ? { from: Date.parse("2026-10-09T01:33:00Z") } : {};
for (const v of mine) { out[v.id] = summary(simulate(rec as unknown as Rec, { ...v, fillAtPrice: atPrice }, span)); console.error(`  ${v.id} ${((performance.now() - t0) / 1000).toFixed(0)} s`); }
Deno.mkdirSync(`results/raw/lb${LB}`, { recursive: true });
Deno.writeTextFileSync(`results/raw/lb${LB}/${stage}${atPrice ? "_atprice" : ""}${sn > 1 ? `.${si}` : ""}.json`, JSON.stringify(out));
