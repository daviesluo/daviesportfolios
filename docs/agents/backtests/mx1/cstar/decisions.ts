// The rules' own decision times for MX-1's C*: every fill `trend-4h` and `trend-1h` make on BTC/USD, ETH/USD and
// SOL/USD in walk-forward windows A–D, read out of the repository's own simulator. Nothing here decides anything:
//
//   * `runSplit` (agents/backtest_fill.ts, exported) is `backtest.ts`'s `run` with a fill log. With the fill series
//     === the signal series it IS `run` (that study's `f1_fidelity.runSplit`), and every fill carries its time and
//     its reason: "entry" (a buy), "exit" (the rulebook's own sell, `ruleDecision`) or "stop" (the protective floor,
//     8 % under cost, read against the next bar's low).
//   * `run` (agents/backtest.ts) is called on the same arguments as a check: same trades, stops, return, drawdown.
//   * The series and the windows are `backtest_testingset.ts`'s (reference §3.17): Coinbase's hourly 3-year series
//     with Kraken's quarterly-bundle hourly history spliced strictly before it, resampled by `backtest.ts`'s
//     `resample`; the windows by `windowsOn`, copied verbatim from that file (it does calendar arithmetic only and is
//     not exported). A 1-hour row's window is the 4-hour window mapped by calendar, as `windowOnSeries` does there.
//   * Seeded parameters (`DEFAULT_TREND`), Revolut X costs, the shipped stops (`stopsForKind`: the 8 % floor, no
//     intra-bar trail, two-bar cooldown) — the configuration `testingset.json`'s `s2_rows` prices.
//
// Output: decisions.json — every fill with its window, side, reason, the fill bar's start (`fillTs`) and the decision
// bar's close (`decisionTs`), plus the per coin × window check against `testingset.json`.
//
//   npx --yes deno@1.46.3 run --allow-read --allow-write decisions.ts
import { DEFAULT_TREND, type Candle, type StrategyKind } from "../../../../../supabase/functions/_shared/agents_strategy.ts";
import { COSTS, resample, run, SHIPPED_STOPS, stopsForKind } from "../../../../../supabase/functions/agents/backtest.ts";
import { runSplit } from "../../../../../supabase/functions/agents/backtest_fill.ts";

type Raw = [number, number, number, number, number, number]; // [t_sec, o, h, l, c, v]
const toCandles = (raw: Raw[]): Candle[] => raw.map(([t, o, h, l, c, v]) => ({ start: t * 1000, open: o, high: h, low: l, close: c, volume: v }));
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16) + "Z";

// ── copied verbatim from backtest_testingset.ts (calendar arithmetic; not exported there) ──────────────────────────
const YEAR_MS = 365 * 86400e3;
const MIN_IN_SAMPLE_DAYS = 180;
type WName = "A" | "B" | "C" | "D";
function indexAtOrAfter(bars: Candle[], ts: number): number {
  let lo = 0, hi = bars.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (bars[mid].start < ts) lo = mid + 1; else hi = mid; }
  return lo;
}
type Win = {
  name: WName; isSeries: "coinbase" | "combined";
  isFrom: number; isTo: number; oosFrom: number; oosTo: number;
  isDays: number; oosDays: number; isFromIso: string; oosFromIso: string; oosToIso: string;
  scored: boolean; why: string;
};
function windowsOn(comb: Candle[], cb: Candle[], maxLookbackBars: number): Win[] {
  const nCb = cb.length, t1 = Math.floor(nCb / 3), t2 = Math.floor(nCb * 2 / 3);
  const z = indexAtOrAfter(comb, cb[0].start);
  const T1 = indexAtOrAfter(comb, cb[t1].start);
  const T2 = indexAtOrAfter(comb, cb[t2].start);
  const N = comb.length;
  const Zc = indexAtOrAfter(comb, cb[0].start - 2 * YEAR_MS);
  const Zd1 = indexAtOrAfter(comb, cb[0].start - 1 * YEAR_MS);
  const Zd3 = indexAtOrAfter(comb, cb[0].start - 3 * YEAR_MS);
  const days = (a: number, b: number) => b > a ? (comb[b - 1].start - comb[a].start) / 86400e3 : 0;
  const mk = (name: WName, isSeries: Win["isSeries"], isFrom: number, isTo: number, oosFrom: number, oosTo: number): Win => {
    const arr = isSeries === "coinbase" ? cb : comb;
    const isDays = isTo > isFrom ? (arr[isTo - 1].start - arr[isFrom].start) / 86400e3 : 0;
    const oosDays = days(oosFrom, oosTo);
    let why = "";
    if (isTo - isFrom <= maxLookbackBars + 2) why = `in-sample is ${isTo - isFrom} bars, shorter than the widest lookback (${maxLookbackBars})`;
    else if (isDays < MIN_IN_SAMPLE_DAYS) why = `in-sample is ${isDays.toFixed(0)} days, under the ${MIN_IN_SAMPLE_DAYS}-day floor`;
    else if (oosTo - oosFrom <= maxLookbackBars + 2) why = `out-of-sample is ${oosTo - oosFrom} bars, shorter than the widest lookback`;
    return {
      name, isSeries, isFrom, isTo, oosFrom, oosTo,
      isDays: Number(isDays.toFixed(1)), oosDays: Number(oosDays.toFixed(1)),
      isFromIso: isTo > isFrom ? iso(arr[isFrom].start) : "", oosFromIso: oosTo > oosFrom ? iso(comb[oosFrom].start) : "",
      oosToIso: oosTo > oosFrom ? iso(comb[oosTo - 1].start) : "",
      scored: why === "", why,
    };
  };
  return [
    mk("A", "coinbase", 0, t2, T2, N), mk("B", "coinbase", 0, t1, T1, T2),
    mk("C", "combined", Zc, z, z, T1), mk("D", "combined", Zd3, Zd1, Zd1, z),
  ];
}
const MAX_LOOKBACK = 201;   // backtest_testingset.ts's value
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const DIR = new URL(".", import.meta.url).pathname;
const SYMBOLS = ["BTC/USD", "ETH/USD", "SOL/USD"];
const RULES: { kind: StrategyKind; barHours: number; row: string }[] = [
  { kind: "trend-4h", barHours: 4, row: "trend-4h·revx" },
  { kind: "trend-1h", barHours: 1, row: "trend-1h·revx" },
];
const WINDOWS: WName[] = ["A", "B", "C", "D"];
const r4 = (x: number) => Number.isFinite(x) ? Number(x.toFixed(4)) : 0;

const published = JSON.parse(await Deno.readTextFile(new URL("../../testingset.json", import.meta.url)));
const pubRows = published.s2_rows.perStopRule.shipped.rows as { id: string; perWindow: Record<string, { perCoin: Record<string, { ret: number; maxDD: number; trades: number; stopsHit: number; days: number; exposure: number }> }> }[];

type Dec = {
  rule: StrategyKind; symbol: string; window: WName; side: "buy" | "sell"; reason: "entry" | "exit" | "stop";
  decisionTs: number; fillTs: number; decisionIso: string; barOpenAtFill: number;
};
const decisions: Dec[] = [];
const checks: Record<string, unknown>[] = [];
const provenance: Record<string, unknown>[] = [];

for (const symbol of SYMBOLS) {
  const base = symbol.replace("/", "-");
  const cbH = toCandles(JSON.parse(await Deno.readTextFile(`${DIR}data/cb/${base}_1h_3y.json`)));
  const kH = toCandles(JSON.parse(await Deno.readTextFile(`${DIR}data/ext/${base}_1h_kraken.json`)));
  const spliceAt = cbH[0].start;
  const extension = kH.filter((c) => c.start < spliceAt);
  const combH = [...extension, ...cbH];
  const comb4h = resample(combH, 4), combDaily = resample(combH, 24);
  const cb4hAll = resample(cbH, 4);
  const wins = windowsOn(comb4h, cb4hAll, MAX_LOOKBACK);
  provenance.push({ symbol, coinbaseHourly: cbH.length, coinbaseFirst: iso(cbH[0].start), coinbaseLast: iso(cbH[cbH.length - 1].start), extensionHourly: extension.length, windows: wins.map((w) => ({ name: w.name, oosFromIso: w.oosFromIso, oosToIso: w.oosToIso, scored: w.scored })) });
  for (const rule of RULES) {
    const bars = rule.barHours === 1 ? combH : comb4h;
    const stops = { ...stopsForKind(rule.kind, DEFAULT_TREND), maxLossPct: SHIPPED_STOPS.maxLossPct };
    for (const wname of WINDOWS) {
      const w = wins.find((x) => x.name === wname)!;
      if (!w.scored) continue;
      const span = rule.barHours === 4
        ? { from: w.oosFrom, to: w.oosTo }
        : { from: indexAtOrAfter(bars, comb4h[w.oosFrom].start), to: indexAtOrAfter(bars, comb4h[w.oosTo - 1].start + 4 * 3600e3) };
      const r = runSplit(rule.kind, symbol, bars, bars, combDaily, span.from, span.to, DEFAULT_TREND, COSTS.revx, rule.barHours, stops);
      const r0 = run(rule.kind, symbol, bars, combDaily, span.from, span.to, DEFAULT_TREND, COSTS.revx, rule.barHours, stops);
      const byStart = new Map<number, number>(bars.map((c, k) => [c.start, k]));
      let gapFills = 0;
      for (const f of r.fills) {
        const j = byStart.get(f.ts)!;
        const decisionTs = bars[j - 1].start + rule.barHours * 3600e3;   // the close of the bar the rule decided on
        if (decisionTs !== f.ts) gapFills++;
        decisions.push({ rule: rule.kind, symbol, window: wname, side: f.side, reason: f.reason, decisionTs, fillTs: f.ts, decisionIso: iso(decisionTs), barOpenAtFill: f.fillRef });
      }
      const pub = pubRows.find((x) => x.id === rule.row)!.perWindow[wname]?.perCoin?.[symbol];
      const n = (reason: string) => r.fills.filter((f) => f.reason === reason).length;
      checks.push({
        rule: rule.kind, symbol, window: wname, from: iso(bars[Math.max(span.from, DEFAULT_TREND.slow + 1)].start), to: iso(bars[span.to - 1].start),
        fills: r.fills.length, entries: n("entry"), ruleExits: n("exit"), stops: n("stop"), gapFills,
        runSplit: { trades: r.trades, stopsHit: r.stopsHit, ret: r4(r.ret), maxDD: r4(r.maxDD) },
        run: { trades: r0.trades, stopsHit: r0.stopsHit, ret: r4(r0.ret), maxDD: r4(r0.maxDD) },
        published: pub ? { trades: pub.trades, stopsHit: pub.stopsHit, ret: pub.ret, maxDD: pub.maxDD } : null,
        runSplitEqualsRun: r.trades === r0.trades && r.stopsHit === r0.stopsHit && r.ret === r0.ret && r.maxDD === r0.maxDD,
        equalsPublished: pub ? pub.trades === r.trades && pub.stopsHit === r.stopsHit && pub.ret === r4(r.ret) && pub.maxDD === r4(r.maxDD) : null,
      });
    }
  }
}

for (const c of checks) {
  const x = c as { rule: string; symbol: string; window: string; fills: number; entries: number; ruleExits: number; stops: number; gapFills: number; runSplitEqualsRun: boolean; equalsPublished: boolean | null; published: unknown; runSplit: unknown };
  console.log(`${x.rule} ${x.symbol} ${x.window}: fills ${x.fills} = ${x.entries} entries + ${x.ruleExits} rule exits + ${x.stops} stops | gap fills ${x.gapFills} | runSplit==run ${x.runSplitEqualsRun} | ==testingset.json ${x.equalsPublished} ${JSON.stringify(x.runSplit)} vs ${JSON.stringify(x.published)}`);
}
await Deno.writeTextFile(`${DIR}decisions.json`, JSON.stringify({
  source: "runSplit (agents/backtest_fill.ts) with fill === signal, i.e. backtest.ts's run with a fill log; series and windows as backtest_testingset.ts; DEFAULT_TREND, COSTS.revx, shipped stops",
  hashes: Object.fromEntries(await Promise.all([
    "supabase/functions/agents/backtest.ts", "supabase/functions/agents/backtest_fill.ts",
    "supabase/functions/_shared/agents_strategy.ts", "docs/agents/backtests/testingset.json",
  ].map(async (f) => [f, [...new Uint8Array(await crypto.subtle.digest("SHA-256", await Deno.readFile(new URL(`../../../../../${f}`, import.meta.url))))].map((b) => b.toString(16).padStart(2, "0")).join("")]))),
  provenance, checks, decisions,
}, null, 1));
console.log(`wrote decisions.json: ${decisions.length} fills`);
