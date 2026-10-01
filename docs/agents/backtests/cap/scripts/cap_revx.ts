// CAP: what the live row's exposure cap does to it, priced with the house rule functions.
//
// The live row (`trend-4h-live`: BTC/ETH/SOL/AVAX, $100, four $25 slots, seeded params) runs under
// `agent_risk.max_exposure_usd` = $25, so `riskGate` refuses any entry while one position is held:
// `exposureUsd + orderUsd > maxExposureUsd`, exposure marked to market (`_shared/agents_strategy.ts` riskGate,
// `agents/tick.ts` decide). No study has priced that cap: every sleeve figure (§3.11, §3.19, §3.20) adds the
// four coins' slots independently.
//
// Method. One joint loop over the four coins' own 4h bars in time order (coins in the row's order within a
// bar), each coin stepped EXACTLY as `run()` in agents/backtest.ts steps it (same snapshot, same `ruleFor`,
// same next-open fill at the touch, same 8 % floor against the next bar's low, same two-bar cooldown), with
// one addition: an entry is refused when the marked exposure of the open positions plus the slot exceeds the
// cap. Two bookkeeping modes:
//   * "compound": each coin's own cash from 1.0, no cap — must equal `run()` coin by coin (the fidelity check);
//   * "slot": what the live loop does — every entry is a fixed $25 (capital / 4, `slotUsdOf`), the fee 9 bps of
//     it, P&L accrues to one $100 book, exposure = Σ base × the decision bar's close.
// Not modelled (as in every house study): Jev's gate, the $5 daily loss limit, the 40 orders a day.
//
// Run from this folder: npx --yes deno@1.46.3 run --allow-read --allow-write cap_study.ts
// Reads ../inputs/{SYM}-USD_1h_3y.json.gz and ../inputs/revx_4h/{SYM}-USD_4h_revx.json (pull_revx_4h.py), writes ../results/cap_revx.json.
import { COSTS, resample, run, SHIPPED_STOPS, spreadOf, stopsForKind } from "../../../../../supabase/functions/agents/backtest.ts";
import { applyFill, buildSnapshot, DEFAULT_TREND, FLAT, precompute, ruleFor, type Candle, type Position } from "../../../../../supabase/functions/_shared/agents_strategy.ts";

const HERE = new URL(".", import.meta.url).pathname;
const SYMS = ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD"];
const P = DEFAULT_TREND;
const COST = COSTS.revx;
const STOPS = stopsForKind("trend-4h", P, SHIPPED_STOPS);
const BAR_H = 4;
const CAPITAL = 100, SLOT = CAPITAL / SYMS.length;

type Series = { c4h: Candle[]; daily: Candle[]; idx: Map<number, number> };
const data: Record<string, Series> = {};
// AUDIT cross-check tape: Revolut X's own public UK 4h candles (keyless, pull_revx_4h.py), with Coinbase's
// 4h bars spliced strictly BEFORE the venue's first bar for warm-up (as backtest_set2.ts splices Kraken's). The daily series
// is the combined 4h tape resampled to UTC days. Coverage (the share of scored bars that are Revolut X's own) is reported.
const REVX_FIRST: Record<string, number> = {};
for (const s of SYMS) {
  const gz = await Deno.readFile(`${HERE}../inputs/${s.replace("/", "-")}_1h_3y.json.gz`);
  const raw: number[][] = JSON.parse(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).text());
  const hourly: Candle[] = raw.map(([t, o, h, l, c, v]) => ({ start: t * 1000, open: o, high: h, low: l, close: c, volume: v }));
  const cb4h = resample(hourly, 4);
  const rx: number[][] = JSON.parse(await Deno.readTextFile(`${HERE}../inputs/revx_4h/${s.replace("/", "-")}_4h_revx.json`));
  const rx4h: Candle[] = rx.map(([t, o, h, l, c, v]) => ({ start: t, open: o, high: h, low: l, close: c, volume: v }));
  REVX_FIRST[s] = rx4h[0].start;
  const c4h = [...cb4h.filter((c) => c.start < rx4h[0].start), ...rx4h];
  const daily = resample(c4h, 24);
  data[s] = { c4h, daily, idx: new Map(c4h.map((c, i) => [c.start, i])) };
}

const WINDOWS: Record<string, [string, string]> = {
  // window A as every published live-row figure dates it; its first 15 days are Coinbase's (the venue's tape starts 2025-09-25)
  A: ["2025-09-10", "2026-09-21"],
  // the venue's own span: every scored bar is Revolut X's (Coinbase's bars are warm-up only)
  RX: ["2025-09-25", "2026-09-30"],
};

function bounds(s: string, w: [string, string]): [number, number] {
  const c = data[s].c4h, a = Date.parse(w[0] + "T00:00:00Z"), b = Date.parse(w[1] + "T00:00:00Z");
  let from = c.findIndex((x) => x.start >= a); if (from < 0) from = c.length;
  let to = c.findIndex((x) => x.start >= b); if (to < 0) to = c.length;
  return [from, to];
}

type CoinState = { pos: Position; cash: number; trades: number; peak: number; maxDD: number; stopsHit: number; lastExitBar: number; dk: number; barsLong: number;
  slotRealised: number; entries: number; refused: number; mark: number; eqMark: number };

function joint(w: [string, string], mode: "compound" | "slot", capUsd: number, ord: string[] = SYMS, cashUsd: number = Infinity, dll = false) {
  let maxOpen = 0, barsAllFourOpen = 0, cashRefused = 0, dllRefused = 0;
  const pre: Record<string, ReturnType<typeof precompute>> = {};
  const st: Record<string, CoinState> = {};
  const rng: Record<string, [number, number]> = {};
  const times = new Set<number>();
  for (const s of SYMS) {
    pre[s] = precompute(data[s].c4h, P);
    st[s] = { pos: FLAT, cash: 1.0, trades: 0, peak: 1.0, maxDD: 0, stopsHit: 0, lastExitBar: -Infinity, dk: 0, barsLong: 0, slotRealised: 0, entries: 0, refused: 0, mark: 0, eqMark: 0 };
    rng[s] = bounds(s, w);
    const [from, to] = rng[s];
    for (let i = Math.max(from, P.slow + 1); i < to - 1; i++) times.add(data[s].c4h[i].start);
  }
  const order = [...times].sort((a, b) => a - b);
  let bookPeak = CAPITAL, bookMaxDD = 0, barsAnyOpen = 0, openSlotBars = 0;
  // The $5 daily loss limit is not simulated; this counts the UTC days on which the book, marked at 4h closes, stood $5 or
  // more below where it opened the day (when the limit would have refused new entries for the rest of that day).
  let dayKey = -1, dayOpenEq = CAPITAL, dayHit = false, daysOverLimit = 0, lastEq = CAPITAL;
  const refusedList: { t: string; sym: string; held: string[] }[] = [];
  const tradeLog: string[] = [];
  for (const t of order) {
    // The gate's view at this bar close (tick.ts: exposure is built once at the start of the turn from the positions held,
    // marked at the current mid, and only a BUY placed during the turn adds to it; a sell placed in the turn frees nothing
    // until the next turn). The decision bar's close stands in for the mid.
    for (const s of SYMS) { const i0 = data[s].idx.get(t); if (i0 != null) st[s].mark = data[s].c4h[i0].close; }
    let startExposure = 0;
    for (const s of SYMS) if (st[s].pos.base > 0) startExposure += st[s].pos.base * st[s].mark;
    let enteredThisTurn = 0;
    for (const s of ord) {
      const { c4h, daily, idx } = data[s];
      const i = idx.get(t);
      const [from, to] = rng[s];
      if (i == null || i < Math.max(from, P.slow + 1) || i >= to - 1) continue;
      const c = st[s];
      const hs = spreadOf(COST, s), fill = COST.takerBps / 1e4;
      while (c.dk < daily.length && daily[c.dk].start + 86400e3 <= c4h[i].start + BAR_H * 3600e3) c.dk++;
      const snap = buildSnapshot(s, c4h, i, daily.slice(0, c.dk), c.pos, c4h[i].start + BAR_H * 3600e3, P, pre[s], (24 / BAR_H) * 365);
      const rule = ruleFor("trend-4h", snap, c.pos, P);
      const next = c4h[i + 1];
      const coolingDown = i - c.lastExitBar < STOPS.reentryBars;
      if (rule.action === "enter" && c.pos.base === 0 && !coolingDown) {
        // The live gate, marked to market at the decision: every other open position at its latest close.
        const exposure = startExposure + enteredThisTurn;
        // AUDIT addition: the account's free USD. Cash out on a buy is the slot (Revolut X takes the buy fee in the coin);
        // the IOC is limited 10 bps over the touch, so the venue is assumed to want slot x 1.001 free (unverified).
        let freeUsd = cashUsd;
        if (mode === "slot" && Number.isFinite(cashUsd)) for (const o of SYMS) { freeUsd += st[o].pos.realisedUsd; if (st[o].pos.base > 0) freeUsd -= st[o].pos.base * st[o].pos.avgCost; }
        // AUDIT: the $5 daily loss limit, approximated at 4h closes: once the book stood $5 under the day's open at a close,
        // no entry for the rest of that UTC day (exits are never refused).
        const decisionDay = Math.floor((t + BAR_H * 3600e3) / 86400e3);
        if (mode === "slot" && dll && dayHit && dayKey === decisionDay) {
          dllRefused++; c.refused++;
        } else if (mode === "slot" && exposure + SLOT > capUsd + 1e-9) {
          c.refused++; refusedList.push({ t: new Date(t).toISOString(), sym: s, held: SYMS.filter((o) => st[o].pos.base > 0) });
        } else if (mode === "slot" && freeUsd < SLOT * 1.001 - 1e-9) {
          cashRefused++; c.refused++; refusedList.push({ t: new Date(t).toISOString(), sym: s + " (cash)", held: SYMS.filter((o) => st[o].pos.base > 0) });
        } else {
          const price = next.open * (1 + hs);
          if (mode === "compound") {
            const base = c.cash / (price * (1 + fill));
            const fee = base * price * fill;
            c.pos = applyFill(c.pos, { ts: next.start, side: "buy", base, price, feeUsd: fee }); c.cash = 0;
          } else {
            const base = SLOT / price, fee = SLOT * fill;
            c.pos = applyFill(c.pos, { ts: next.start, side: "buy", base, price, feeUsd: fee });
            enteredThisTurn += SLOT;
          }
          tradeLog.push(`buy ${s} decided on the bar starting ${new Date(t).toISOString().slice(0, 16)}`);
          c.trades++; c.entries++;
        }
      } else if (rule.action === "exit" && c.pos.base > 0) {
        const price = next.open * (1 - hs);
        const fee = c.pos.base * price * fill;
        if (mode === "compound") c.cash = c.pos.base * price - fee;
        c.pos = applyFill(c.pos, { ts: next.start, side: "sell", base: c.pos.base, price, feeUsd: fee });
        c.trades++; c.lastExitBar = i + 1;
        tradeLog.push(`sell ${s} (rule) decided on the bar starting ${new Date(t).toISOString().slice(0, 16)}`);
      } else if (c.pos.base > 0) {
        const floor = c.pos.avgCost * (1 - STOPS.maxLossPct);
        const level = Math.max(floor, -Infinity);
        if (next.low <= level) {
          const price = Math.min(level, next.open) * (1 - hs);
          const fee = c.pos.base * price * fill;
          if (mode === "compound") c.cash = c.pos.base * price - fee;
          c.pos = applyFill(c.pos, { ts: next.start, side: "sell", base: c.pos.base, price, feeUsd: fee });
          c.trades++; c.stopsHit++; c.lastExitBar = i + 1;
          tradeLog.push(`sell ${s} (floor) during the bar after ${new Date(t).toISOString().slice(0, 16)}`);
        }
      }
      if (c.pos.base > 0) { c.barsLong++; c.pos = { ...c.pos, highWater: Math.max(c.pos.highWater ?? next.high, next.high) }; }
      c.eqMark = next.close;
      if (mode === "compound") {
        const eq = c.cash + c.pos.base * next.close;
        c.peak = Math.max(c.peak, eq); c.maxDD = Math.max(c.maxDD, 1 - eq / c.peak);
      }
    }
    if (mode === "slot") {
      // The one book: capital + every coin's realised (fees included) + unrealised at its latest close.
      let eq = CAPITAL, open = 0;
      for (const s of SYMS) { const c = st[s]; eq += c.pos.realisedUsd + (c.pos.base > 0 ? c.pos.base * (c.eqMark - c.pos.avgCost) : 0); if (c.pos.base > 0) open++; }
      bookPeak = Math.max(bookPeak, eq); bookMaxDD = Math.max(bookMaxDD, 1 - eq / bookPeak);
      const dk = Math.floor((t + BAR_H * 3600e3) / 86400e3);
      if (dk !== dayKey) { dayKey = dk; dayOpenEq = lastEq; dayHit = false; }
      if (!dayHit && eq - dayOpenEq <= -5) { dayHit = true; daysOverLimit++; }
      lastEq = eq;
      if (open > 0) barsAnyOpen++; openSlotBars += open;
      maxOpen = Math.max(maxOpen, open); if (open === 4) barsAllFourOpen++;
    }
  }
  const per: Record<string, unknown> = {};
  let pnl = 0, trades = 0, entries = 0, refused = 0, stops = 0, fees = 0;
  for (const s of SYMS) {
    const c = st[s], [, to] = rng[s];
    const lastClose = data[s].c4h[to - 1].close;
    if (mode === "compound") per[s] = { ret: c.cash + c.pos.base * lastClose - 1, maxDD: c.maxDD, trades: c.trades, stopsHit: c.stopsHit };
    else {
      const coinPnl = c.pos.realisedUsd + (c.pos.base > 0 ? c.pos.base * (lastClose - c.pos.avgCost) : 0);
      pnl += coinPnl; trades += c.trades; entries += c.entries; refused += c.refused; stops += c.stopsHit; fees += c.pos.feesUsd;
      per[s] = { pnlUsd: +coinPnl.toFixed(4), trades: c.trades, entries: c.entries, refused: c.refused, stopsHit: c.stopsHit };
    }
  }
  if (mode === "compound") return { per };
  return { capUsd, pnlUsd: +pnl.toFixed(4), ret: +(pnl / CAPITAL).toFixed(5), maxDD: +bookMaxDD.toFixed(5), retOverDD: +((pnl / CAPITAL) / Math.max(bookMaxDD, 1e-9)).toFixed(3),
    fills: trades, entries, refusedEntries: refused, stopsHit: stops, feesUsd: +fees.toFixed(4), barsWithAPosition: barsAnyOpen, bars: order.length,
    meanOpenSlots: +(openSlotBars / order.length).toFixed(4), daysBookDown5UsdFromDayOpen: daysOverLimit, maxOpen, barsAllFourOpen, cashRefused, dllRefused, cashUsd: Number.isFinite(cashUsd) ? cashUsd : null, tradeLog: w[0] >= "2026" ? tradeLog : undefined, per, refusedSample: refusedList.slice(0, 5) };
}

// 1. Fidelity: compound mode, no cap, against run() coin by coin.
const fidelity: Record<string, unknown> = {};
let worst = 0;
for (const [wn, w] of Object.entries(WINDOWS)) {
  const j = joint(w, "compound", Infinity).per as Record<string, { ret: number; maxDD: number; trades: number; stopsHit: number }>;
  for (const s of SYMS) {
    const [from, to] = bounds(s, w);
    const r = run("trend-4h", s, data[s].c4h, data[s].daily, from, to, P, COST, BAR_H, STOPS);
    const d = Math.max(Math.abs(r.ret - j[s].ret), Math.abs(r.maxDD - j[s].maxDD), Math.abs(r.trades - j[s].trades), Math.abs((r.stopsHit ?? 0) - j[s].stopsHit));
    worst = Math.max(worst, d);
    fidelity[`${wn} ${s}`] = { runRet: +r.ret.toFixed(6), jointRet: +j[s].ret.toFixed(6), runTrades: r.trades, jointTrades: j[s].trades, maxAbsDiff: d };
  }
}

// 2. The cap arms, in the live loop's fixed-slot bookkeeping.
const CAPS = [25, 50, 60, 100, 150, Infinity];   // AUDIT cross-check caps
const arms: Record<string, unknown> = {};
for (const [wn, w] of Object.entries(WINDOWS)) {
  arms[wn] = Object.fromEntries(CAPS.map((cap) => [cap === Infinity ? "none" : `$${cap}`, joint(w, "slot", cap)]));
}

// AUDIT: the same arms with the account's USD as a second limit (99.34 = $100 funded less the one round trip's $0.66).
const cashArms: Record<string, unknown> = {};
for (const [wn, w] of Object.entries(WINDOWS)) {
  cashArms[wn] = Object.fromEntries([[60, 99.34], [150, 99.34], [150, 100.0], [150, 101.0], [150, 105.0], [Infinity, 99.34]].map(([cap, cash]) =>
    [`${cap === Infinity ? "none" : `$${cap}`} cash $${cash}`, joint(w, "slot", cap, SYMS, cash)]));
}

// 3. Which coin takes a capped slot when several signal on one bar depends on the order the tick visits them (the row's
// `symbols`, BTC ETH SOL AVAX). Every one of the 24 orders, for the capped arms.
const perms = (a: string[]): string[][] => a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((r) => [x, ...r]));
const orderSensitivity: Record<string, unknown> = {};
for (const [wn, w] of Object.entries(WINDOWS)) {
  for (const cap of [25, 50, 60, 150]) {
    const pnls = perms(SYMS).map((o) => (joint(w, "slot", cap, o) as { pnlUsd: number }).pnlUsd).sort((a, b) => a - b);
    orderSensitivity[`${wn} $${cap}`] = { orders: pnls.length, minPnlUsd: pnls[0], medianPnlUsd: pnls[Math.floor(pnls.length / 2)], maxPnlUsd: pnls[pnls.length - 1] };
  }
}
console.log(JSON.stringify(orderSensitivity));

const out = {
  orderSensitivity,
  study: "CAP — the live row's exposure cap priced with the house rule functions (research screen, 2026-10-01; not a pre-registered test)",
  inputs: { source: "Coinbase Exchange hourly candles, keyless, pulled 2026-10-01 (pull_coinbase.py), resampled by backtest.ts resample()", symbols: SYMS, params: P, costs: "COSTS.revx (9 bps taker + half-spread)", stops: STOPS, capitalUsd: CAPITAL, slotUsd: SLOT },
  windows: WINDOWS,
  fidelity: { worstAbsDiff: worst, cells: Object.keys(fidelity).length, detail: fidelity },
  arms,
  cashArms,
};
const coverage: Record<string, unknown> = {};
for (const [wn, w] of Object.entries(WINDOWS)) for (const s of SYMS) {
  const [from, to] = bounds(s, w); const c = data[s].c4h.slice(Math.max(from, DEFAULT_TREND.slow + 1), to - 1);
  coverage[`${wn} ${s}`] = { scored: c.length, revxOwn: c.filter((x) => x.start >= REVX_FIRST[s]).length };
}
console.log("COVERAGE", JSON.stringify(coverage));
await Deno.writeTextFile(`${HERE}../results/cap_revx.json`, JSON.stringify({ ...out, coverage }, null, 1));
console.log(JSON.stringify({ worstAbsDiff: worst, cells: Object.keys(fidelity).length }));
for (const [wn, a] of Object.entries({ ...Object.fromEntries(Object.entries(arms).map(([k, v]) => [k, v])), ...Object.fromEntries(Object.entries(cashArms).map(([k, v]) => [k + "-cash", v])) } as Record<string, Record<string, Record<string, unknown>>>)) {
  for (const [k, v] of Object.entries(a)) console.log(wn, k, JSON.stringify({ pnlUsd: v.pnlUsd, ret: v.ret, maxDD: v.maxDD, retOverDD: v.retOverDD, fills: v.fills, entries: v.entries, refused: v.refusedEntries, stops: v.stopsHit, maxOpen: v.maxOpen, barsAllFourOpen: v.barsAllFourOpen, cashRefused: v.cashRefused, meanOpenSlots: v.meanOpenSlots, daysDown5: v.daysBookDown5UsdFromDayOpen, barsWithAPosition: v.barsWithAPosition, bars: v.bars }));
}

// AUDIT: the least USD at the start of each window for which the account's cash never refuses an entry (in $0.25 steps),
// per cap, under the assumption that the venue wants slot x 1.001 free for a $25 IOC buy.
const cashNeeded: Record<string, unknown> = {};
for (const [wn, w] of Object.entries(WINDOWS)) {
  for (const cap of [60, 150]) {
    let need: number | null = null;
    for (let cash = 50; cash <= 160; cash += 0.25) {
      const r = joint(w, "slot", cap, SYMS, cash) as { cashRefused: number };
      if (r.cashRefused === 0) { need = cash; break; }
    }
    cashNeeded[`${wn} $${cap}`] = need;
  }
}
console.log("CASH-NEEDED", JSON.stringify(cashNeeded));
await Deno.writeTextFile(`${HERE}../results/cash_needed_revx.json`, JSON.stringify(cashNeeded, null, 1));

// AUDIT: the same caps with the $5 daily loss limit applied (approximated at 4h closes).
const dllArms: Record<string, unknown> = {};
for (const [wn, w] of Object.entries(WINDOWS)) for (const cap of [25, 60, 150]) {
  const r = joint(w, "slot", cap, SYMS, Infinity, true) as Record<string, number>;
  dllArms[`${wn} $${cap} +dll`] = { pnlUsd: r.pnlUsd, maxDD: r.maxDD, retOverDD: r.retOverDD, entries: r.entries, dllRefused: r.dllRefused, capRefused: r.refusedEntries - r.dllRefused, daysDown5: r.daysBookDown5UsdFromDayOpen };
}
console.log("DLL", JSON.stringify(dllArms));
