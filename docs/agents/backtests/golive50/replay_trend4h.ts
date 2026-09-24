// S2(a)/(b) — the paper `trend-4h` row's life, replayed bar by bar with the loop's OWN decision functions on the public
// candles the loop reads, beside the backtester's `run` on the same bars. A study, not a rulebook. Run by hand, from the
// repository root:
//
//   deno run --allow-read --allow-write docs/agents/backtests/golive50/replay_trend4h.ts \
//     --inputs docs/agents/backtests/golive50/inputs --out docs/agents/backtests/golive50
//
// Inputs (committed beside this file, pulled keylessly 2026-09-24 00:12 UTC by `pull_public.py`):
//   kraken_ohlc.json.gz   Kraken public OHLC, 4h and daily, the 720 most recent each — the loop's signal series
//   revx_candles.json.gz  Revolut X UK candles: 1-minute from 2026-09-20 12:00 and 4-hour for 40 days — the book the
//                         paper row fills against
//
// Two arms, one set of decisions:
//   backtester — `backtest.ts` `run`'s fill model on Kraken's tape (the next bar's open ± the half-spread, 9 bps; the
//                8 % floor against the next bar's low), so its return must equal `run`'s to the digit (fidelity);
//   loop       — what `tick.ts` does on each bar: `buildSnapshot` + `ruleDecision` on Kraken's CLOSED 4h bars and
//                closed daily candles, the high-water trailed from the entry's bar (`fromItsBar`), the two-bar cooldown
//                counted in bars, the v2 Jev gate at 0.45 from 2026-09-23 00:52 (deterministic: it refuses exactly a
//                weak trend in high volatility, `jev_answers_v2.json`), and the paper fill at the Revolut X UK touch in
//                the decision minute (that minute's candle open ± the half-spread) with the 8 % floor read against
//                every UK minute's low.
// The recorded production facts this can be checked against are in the review (2026-09-24-trend4h-golive-validation.md)
// with the exact queries that would read the rest. No database is read here.

import { applyFill, buildSnapshot, DEFAULT_TREND, FLAT, highWaterSince, ruleDecision, type Candle, type Position } from "../../../../supabase/functions/_shared/agents_strategy.ts";
import { COSTS, run, SHIPPED_STOPS, spreadOf } from "../../../../supabase/functions/agents/backtest.ts";
import { fromItsBar } from "../../../../supabase/functions/agents/tick.ts";

const FOUR_H = 4 * 3600e3, ONE_D = 86400e3, ONE_M = 60e3;
const P = DEFAULT_TREND;   // the paper row's params are DEFAULT_TREND's (go_live.sql.draft writes them out; they match)
const TAKER = COSTS.revx.takerBps / 1e4;
const FLOOR = SHIPPED_STOPS.maxLossPct;
const ms = (s: string) => Date.parse(s);
const iso = (t: number) => new Date(t).toISOString().slice(0, 16) + "Z";

/** When each coin could first be decided on the paper row: the row went live 2026-09-20 18:23; AVAX joined by `0039`
 *  (pushed 13:10:18) and SUI by `0040` (14:11:10) on 2026-09-21. A coin's first turn decides the last CLOSED bar. */
const JOINED: Record<string, number> = {
  "BTC/USD": ms("2026-09-20T18:23:00Z"), "ETH/USD": ms("2026-09-20T18:23:00Z"), "SOL/USD": ms("2026-09-20T18:23:00Z"),
  "AVAX/USD": ms("2026-09-21T13:10:18Z"), "SUI/USD": ms("2026-09-21T14:11:10Z"),
};
/** The four the live row trades (the paper row keeps SUI). */
const LIVE4 = ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD"];
/** `0047` (the v2 question at 0.45) was pushed 2026-09-23 00:51:55; before it the v1 question at 0.60. */
const V2_FROM = ms("2026-09-23T00:52:00Z");
/** The last 4h bar any study scored: Kraken's tape ended 2026-09-21 20:00 (sizing.json), the Revolut X UK tape 2026-09-22. */
const LAST_STUDIED_BAR = ms("2026-09-21T20:00:00Z");

async function gz(path: string): Promise<unknown> {
  const f = await Deno.open(path);
  return JSON.parse(await new Response(f.readable.pipeThrough(new DecompressionStream("gzip"))).text());
}
type KRow = [number, string, string, string, string, string, string, number];
const kCandles = (rows: KRow[]): Candle[] => rows.map((r) => ({ start: r[0] * 1000, open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[6] }));
type RRow = { start: string | number; open: string; high: string; low: string; close: string; volume: string };
const rCandles = (rows: RRow[]): Candle[] => rows.map((r) => ({ start: Number(r.start), open: +r.open, high: +r.high, low: +r.low, close: +r.close, volume: +r.volume }));

async function sha256(path: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await Deno.readFile(path));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Decision = {
  barStart: string; decidedAt: string; position: "flat" | "long"; rule: string; reason: string;
  state: { trend: string; strength: string; breakout: string; volatility: string; momentum: string };
  jev: string; final: string; loopFill?: { side: string; price: number; touchMinute: string };
};

async function main(args: Record<string, string>) {
  const inDir = String(args.inputs ?? "docs/agents/backtests/golive50/inputs");
  const outDir = String(args.out ?? "docs/agents/backtests/golive50");
  const k = await gz(`${inDir}/kraken_ohlc.json.gz`) as { meta: { pulled_at: string; pulled_at_ms: number }; series: Record<string, { data: { result: Record<string, KRow[] | number> } }> };
  const rx = await gz(`${inDir}/revx_candles.json.gz`) as { series: Record<string, RRow[]> };
  const pulledAt = k.meta.pulled_at_ms;
  const out: Record<string, unknown> = {};
  const fidelity: Record<string, unknown> = {};
  const oos: Record<string, unknown> = {};

  for (const sym of Object.keys(JOINED)) {
    const res = k.series[`${sym}|240`].data.result, resD = k.series[`${sym}|1440`].data.result;
    const key = Object.keys(res).find((x) => x !== "last")!, keyD = Object.keys(resD).find((x) => x !== "last")!;
    // Closed bars only: the endpoint appends the forming one, and `last` is the start of the last CLOSED one.
    const bars = kCandles(res[key] as KRow[]).filter((c) => c.start + FOUR_H <= pulledAt);
    const daily = kCandles(resD[keyD] as KRow[]).filter((c) => c.start + ONE_D <= pulledAt);
    const m1 = rCandles(rx.series[`${sym.replace("/", "-")}|1`]);
    const m1ByStart = new Map(m1.map((c) => [c.start, c]));
    const hs = spreadOf(COSTS.revx, sym);
    // The first bar the row decided for this coin: the last bar CLOSED at the coin's first turn.
    let first = bars.findIndex((c) => c.start + FOUR_H > JOINED[sym]) - 1;
    if (first < P.slow + 1) throw new Error(`${sym}: not enough warm-up`);
    const lastIdx = bars.length - 1;

    // ── the loop arm ─────────────────────────────────────────────────
    let pos: Position = FLAT, lastExitMs: number | null = null;
    const decisions: Decision[] = [];
    const loopFills: { ts: string; side: string; price: number; why: string }[] = [];
    let floorBreaches: string[] = [];
    for (let i = first; i <= lastIdx; i++) {
      const barStart = bars[i].start, closeMs = barStart + FOUR_H;
      // Between this bar's decision and the next: the floor against every UK minute's low (the loop reads the bid once a
      // minute; a minute's low is the most pessimistic reading of it, so a breach here is flagged, not assumed).
      const decidedAt = i === first ? Math.max(closeMs, JOINED[sym]) : closeMs;
      const di = daily.findLastIndex((c) => c.start + ONE_D <= decidedAt);
      const closedDaily = daily.slice(0, di + 1);
      const posBar = pos.base > 0 ? { ...pos, highWater: highWaterSince(fromItsBar(pos, bars), bars, i) ?? pos.highWater } : pos;
      const snap = buildSnapshot(sym, bars.slice(0, i + 1), i, closedDaily, posBar, decidedAt, P);
      let rule = ruleDecision(snap, posBar, P);
      if (rule.action === "enter" && lastExitMs != null && barStart - Math.floor(lastExitMs / FOUR_H) * FOUR_H < 2 * FOUR_H) {
        rule = { action: "hold", reason: "cooling down" };
      }
      let jev = "not asked", final = rule.action as string;
      if (rule.action === "enter") {
        if (decidedAt >= V2_FROM) {
          const veto = snap.state.trend_strength === "weak" && snap.state.volatility === "high";
          jev = veto ? "v2 vetoes (weak trend, high volatility: P 0.35–0.41 < 0.45)" : "v2 allows (P ≥ 0.47)";
          if (veto) final = "hold";
        } else {
          jev = "v1 at 0.60 (answer read from the record where one exists)";
        }
      }
      const s = snap.state;
      const d: Decision = {
        barStart: iso(barStart), decidedAt: iso(decidedAt), position: pos.base > 0 ? "long" : "flat", rule: rule.action, reason: rule.reason,
        state: { trend: s.trend_4h, strength: s.trend_strength, breakout: s.breakout_4h, volatility: s.volatility, momentum: s.momentum_30d }, jev, final,
      };
      // The paper fill: the touch in the decision minute. Its candle's open stands in for the mid at the turn (the loop's
      // ticker read), and the half-spread the backtests charge for the side taken.
      const touchMin = Math.floor(decidedAt / ONE_M) * ONE_M;
      const mc = m1ByStart.get(touchMin) ?? m1.find((c) => c.start >= touchMin);
      if (final === "enter" && pos.base === 0 && mc) {
        const price = mc.open * (1 + hs);
        pos = applyFill(pos, { ts: decidedAt, side: "buy", base: 1 / (price * (1 + TAKER)), price, feeUsd: TAKER / (1 + TAKER) });
        loopFills.push({ ts: iso(decidedAt), side: "buy", price, why: rule.reason });
        d.loopFill = { side: "buy", price, touchMinute: iso(mc.start) };
      } else if (final === "exit" && pos.base > 0 && mc) {
        const price = mc.open * (1 - hs);
        pos = applyFill(pos, { ts: decidedAt, side: "sell", base: pos.base, price, feeUsd: pos.base * price * TAKER });
        loopFills.push({ ts: iso(decidedAt), side: "sell", price, why: rule.reason });
        d.loopFill = { side: "sell", price, touchMinute: iso(mc.start) };
        lastExitMs = decidedAt;
      }
      decisions.push(d);
      // The floor until the next decision.
      if (pos.base > 0) {
        const until = i < lastIdx ? bars[i + 1].start + FOUR_H : pulledAt;
        const level = pos.avgCost * (1 - FLOOR);
        for (const c of m1) {
          if (c.start < decidedAt || c.start >= until) continue;
          if (c.low <= level) { floorBreaches.push(`${iso(c.start)} low ${c.low} ≤ floor ${level.toFixed(6)}`); break; }
        }
      }
    }
    const lastMid = m1[m1.length - 1].close;
    const loopMarked = pos.base > 0 ? pos.base * lastMid * (1 - hs) : 0;
    const loopEquity = (() => {
      // per unit of slot: cash after the fills, plus the open position at the last UK minute's close less the half-spread
      let cash = 1, p: Position = FLAT;
      for (const f of loopFills) {
        if (f.side === "buy") { const base = cash / (f.price * (1 + TAKER)); p = applyFill(p, { ts: 0, side: "buy", base, price: f.price, feeUsd: base * f.price * TAKER }); cash = 0; }
        else { const fee = p.base * f.price * TAKER; cash = p.base * f.price - fee; p = applyFill(p, { ts: 0, side: "sell", base: p.base, price: f.price, feeUsd: fee }); }
      }
      return cash + p.base * lastMid * (1 - hs);
    })();

    // ── the backtester arm: `run` itself, and the same decisions with run's fills, checked against it ──
    const from = first, to = bars.length;
    const r = run("trend-4h", sym, bars, daily, from, to, P, COSTS.revx, 4, SHIPPED_STOPS);
    fidelity[sym] = { runFrom: iso(bars[Math.max(from, P.slow + 1)].start), runTo: iso(bars[to - 1].start), runReturn: Number(r.ret.toFixed(6)), runTrades: r.trades, runStopsHit: r.stopsHit ?? 0 };

    // ── the stretch no study has scored: bars after LAST_STUDIED_BAR ──
    const k0 = bars.findIndex((c) => c.start > LAST_STUDIED_BAR);
    const rOos = run("trend-4h", sym, bars, daily, k0, to, P, COSTS.revx, 4, SHIPPED_STOPS);
    const bh = bars[to - 1].close / bars[k0].open - 1;
    // The loop arm's own book over the stretch, per $1 of slot: its fills up to a moment, marked at that moment's UK
    // minute close less the half-spread (what the position would sell for), from the stretch's first bar to the end.
    const ukAt = (t: number) => { const c = m1.findLast((x) => x.start <= t); return c ? c.close : NaN; };
    const equityAt = (t: number) => {
      let cash = 1, p: Position = FLAT;
      for (const f of loopFills) {
        if (Date.parse(f.ts) > t) break;
        if (f.side === "buy") { const base = cash / (f.price * (1 + TAKER)); p = applyFill(p, { ts: 0, side: "buy", base, price: f.price, feeUsd: base * f.price * TAKER }); cash = 0; }
        else { const fee = p.base * f.price * TAKER; cash = p.base * f.price - fee; p = applyFill(p, { ts: 0, side: "sell", base: p.base, price: f.price, feeUsd: fee }); }
      }
      return cash + p.base * ukAt(t) * (1 - hs);
    };
    const s0 = bars[k0].start, s1 = pulledAt;
    oos[sym] = {
      from: iso(bars[k0].start), to: iso(bars[to - 1].start), bars: to - k0,
      loopBookPerSlotDollar: { atStart: Number(equityAt(s0).toFixed(6)), atEnd: Number(equityAt(s1).toFixed(6)), change: Number((equityAt(s1) / equityAt(s0) - 1).toFixed(6)), heldAtStart: loopFills.filter((f) => Date.parse(f.ts) <= s0).length % 2 === 1 },
      buyAndHoldUk: Number((ukAt(s1) / ukAt(s0) - 1).toFixed(6)),
      runFlatStart: { ret: Number(rOos.ret.toFixed(6)), trades: rOos.trades, note: "run starts flat at the first unstudied bar, so a position opened before it is not carried" },
      buyAndHoldKraken: Number(bh.toFixed(6)),
      entriesOrExitsInStretch: loopFills.filter((f) => Date.parse(f.ts) > LAST_STUDIED_BAR).map((f) => `${f.side} ${f.ts} (${f.why})`),
    };

    out[sym] = {
      joined: iso(JOINED[sym]), firstBarDecided: iso(bars[first].start), barsDecided: decisions.length,
      entries: decisions.filter((d) => d.final === "enter").map((d) => d.barStart),
      exits: decisions.filter((d) => d.final === "exit").map((d) => d.barStart),
      ruleEntrySignals: decisions.filter((d) => d.rule === "enter").map((d) => ({ bar: d.barStart, position: d.position, jev: d.jev, final: d.final })),
      loopFills, floorBreachesUkMinuteLow: floorBreaches,
      openAtEnd: pos.base > 0 ? { avgCost: Number(pos.avgCost.toPrecision(10)), highWater: pos.highWater, lastUkClose: lastMid, unrealisedPerSlotDollar: Number((loopEquity - 1).toFixed(6)) } : null,
      loopArmSlotReturn: Number((loopEquity - 1).toFixed(6)),
      decisions,
    };
    console.log(`${sym}: decided ${decisions.length} bars from ${iso(bars[first].start)} | rule entry signals ${decisions.filter((d) => d.rule === "enter").map((d) => `${d.barStart}(${d.final})`).join(", ") || "none"} | exits ${decisions.filter((d) => d.final === "exit").map((d) => d.barStart).join(", ") || "none"} | floor breaches ${floorBreaches.length} | loop slot ${((loopEquity - 1) * 100).toFixed(2)}% | run ${(r.ret * 100).toFixed(2)}% (${r.trades} fills)`);
  }

  const report = {
    study: "S2(a)/(b): the paper trend-4h row replayed bar by bar with the loop's decision functions on Kraken's public candles, beside backtest.ts run on the same bars",
    inputs: {
      krakenOhlc: { file: "inputs/kraken_ohlc.json.gz", sha256: await sha256(`${inDir}/kraken_ohlc.json.gz`), pulledAt: k.meta.pulled_at },
      revxCandles: { file: "inputs/revx_candles.json.gz", sha256: await sha256(`${inDir}/revx_candles.json.gz`) },
    },
    assumptions: {
      joined: Object.fromEntries(Object.entries(JOINED).map(([s, t]) => [s, iso(t)])),
      jev: "v1 at 0.60 before 2026-09-23 00:52 (the recorded answers for the three entries: ETH 0.94, BTC 0.95, SOL 0.61 — all allowed); v2 at 0.45 after, which refuses exactly weak-trend high-volatility states",
      loopFill: "the paper order's price is the ticker's ask (buy) / bid (sell) at the turn; stood in for by the decision minute's UK candle open × (1 ± half-spread from COSTS.revx), 9 bps taker",
      floor: "8 % under average cost, read against every UK 1-minute low from the decision to the next decision (conservative: the loop reads the bid once a minute)",
      trail: "the high-water from the START of the entry's bar (fromItsBar, P5; the loop before 2026-09-23 20:25 skipped the entry bar's own high — D5)",
    },
    perCoin: out,
    fidelityAgainstRun: fidelity,
    stretchNoStudyScored: { lastStudiedBar: iso(LAST_STUDIED_BAR), perCoin: oos, liveFour: LIVE4 },
  };
  await Deno.mkdir(outDir, { recursive: true });
  await Deno.writeTextFile(`${outDir}/replay.json`, JSON.stringify(report, null, 1) + "\n");
  console.log(`wrote ${outDir}/replay.json`);
}

if (import.meta.main) {
  const args = Object.fromEntries(Deno.args.map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1]] : []).filter((x) => x.length)) as Record<string, string>;
  await main(args);
}
