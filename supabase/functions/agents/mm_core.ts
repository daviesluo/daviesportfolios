// The XRP/GBP maker's rule, second by second: a port of `rule.sim` (docs/agents/backtests/cryptobooks/scripts/rule.py) at the
// card the paper test "Crypto quotes XRP/GBP" freezes (docs/agents/reviews/2026-10-31-xrp-gbp-paper-prereg.md; the studies
// reviews/2026-10-31-xrp-gbp-strategy.md and the CRYPTOBOOKS-3 pass, scripts/final_opt.py and final_card.py). Pure: no clock, no
// I/O. `mm_core.test.ts` replays rule.py's own fills on a committed slice (backtests/cryptobooks/results/parity_*.json) and
// matches them fill for fill, in one pass and a minute at a time.
//
// Per second s, in this order (rule.py's):
//  1. the basis: each Revolut X print of second s, in the tape's order, is a deviation 1e4·ln(price / F(sec − 1)); before every
//     tenth, the centre of the deviations of the trailing `trailS` seconds ((median of the buys + median of the sells) / 2, five
//     of each at least) becomes the basis when it differs from the last (`replay.basis_steps`). Quoting starts the second after
//     the first centre;
//  2. the fair it knows: F(s − 1) · e^(basis/1e4); the true fair F(s) · e^(basis/1e4) (the arbitrageur's and the stop's); F is
//     Binance's last trade of the second × USDT/USD ÷ GBP/USD. A second with either missing is stale: nothing rests;
//  3. the stop: coin marked `stopBps` under its average cost is sold whole as a taker at the true fair less 9 bps less
//     `exitSlipBps`, and nothing is bid for `cooldownS`;
//  4. re-pricing, after a fill, when the known fair has moved more than `thetaBps` from the price the quotes were set at, or
//     when nothing rests: bid ref·(1 − d − k), ask ref·(1 + d − k), k = κ·d·(coin value ÷ capital); a bid while pounds are left
//     and the coin is worth less than the capital, £Q (or the pounds left); an ask only for coin held, £Q of it at most. A side
//     whose price changed, or that a fill left short, is a cancel and a placement;
//  5. the public taker orders of second s (the prints of one ms and side, in the order the book filled them): a buy fills our
//     ask by the part of it priced strictly above the ask (all of it when the ask was below its first price), a sell our bid the
//     same way round; never more than the order's size or what is left of ours, at our price, and only once the quote has
//     rested `restLagS` seconds (1: never by the prints of the second it was placed in);
//  6. the arbitrageur: a quote more than `xArbBps` beyond the true fair is taken whole, at once, at our price.
// Money is in pounds; the coin in coins. It starts in pounds and sells only what it bought.

/** The rule's numbers (`rule.py`'s names in brackets). */
export type MmParams = {
  dBps: number;        // d_min (vol_k 0: fixed)
  thetaBps: number;    // theta (U 1: checked every second)
  kappa: number;       // kappa
  qGbp: number;        // Q
  capGbp: number;      // cap
  xArbBps: number;     // x_arb (arb on)
  stopBps: number | null; // stop
  exitSlipBps: number; // exit_slip
  cooldownS: number;   // cooldown
  restLagS: number;    // rest_lag
  trailS: number;      // replay.TRAIL
};

/** The card (rule.py's xrp_study.CARD with final_card.FINAL), frozen by the pre-registration. */
export const MM_CARD: MmParams = {
  dBps: 14, thetaBps: 5, kappa: 0.5, qGbp: 200, capGbp: 600, xArbBps: 10, stopBps: 300, exitSlipBps: 20, cooldownS: 3600, restLagS: 1,
  trailS: 3 * 3600,
};
/** Revolut X's taker fee, which the stop's sale pays (folded into its price, as rule.py does). */
export const MM_TAKER_FEE_BPS = 9;

export type MmQuote = { price: number; left: number; since: number };
export type MmState = {
  cash: number; coin: number; cost: number;
  bid: MmQuote | null; ask: MmQuote | null;
  ref: number | null; need: boolean; coolUntil: number;
  /** The basis: the deviations in its window [sec, side, bps], how many there have been, the last centre, and the first's second. */
  devs: Array<[number, number, number]>; nDev: number; c: number | null; firstStep: number | null;
  placed: number; cancels: number; stops: number;
};
/** A print as the tape keeps it: ms, price, coins, +1 a taker buy and −1 a taker sell. */
export type MmPrint = { ms: number; price: number; qty: number; side: 1 | -1 };
export type MmFill = { sec: number; side: 1 | -1; qty: number; price: number; fair: number; kind: "taker" | "arb" | "stop" };
/** One second's quotes after it, for the minute's record. */
export type MmSecond = { sec: number; fair: number | null; c: number | null; stale: boolean };

/** A new book: the capital in pounds, no coin. */
export function mmNew(p: MmParams = MM_CARD): MmState {
  return { cash: p.capGbp, coin: 0, cost: 0, bid: null, ask: null, ref: null, need: true, coolUntil: 0, devs: [], nDev: 0, c: null, firstStep: null,
    placed: 0, cancels: 0, stops: 0 };
}

/** The tape's order: ms, price, coins, side (rule.py sorts the tuples). */
export function mmSortPrints(ps: MmPrint[]): MmPrint[] {
  return [...ps].sort((a, b) => a.ms - b.ms || a.price - b.price || a.qty - b.qty || a.side - b.side);
}

/** The taker orders of sorted prints: one ms and side running together, each order's prints in the order the book filled them. */
export function mmTakerOrders(ps: MmPrint[]): Array<{ ms: number; side: 1 | -1; prints: Array<[number, number]> }> {
  const out: Array<{ ms: number; side: 1 | -1; prints: Array<[number, number]> }> = [];
  for (const x of ps) {
    const o = out[out.length - 1];
    if (o && o.ms === x.ms && o.side === x.side) o.prints.push([x.price, x.qty]);
    else out.push({ ms: x.ms, side: x.side, prints: [[x.price, x.qty]] });
  }
  for (const o of out) o.prints.sort((a, b) => a[0] * o.side - b[0] * o.side);
  return out;
}

function median(xs: number[]): number {
  const v = [...xs].sort((a, b) => a - b), n = v.length, h = Math.floor(n / 2);
  return n % 2 ? v[h] : (v[h - 1] + v[h]) / 2;
}

/** Folds second `sec`'s prints into the basis (rule.py's basis_steps, a print at a time). `fPrev` is F(sec − 1). */
export function mmBasis(st: MmState, p: MmParams, sec: number, prints: MmPrint[], fPrev: number | null): void {
  if (fPrev == null) return;
  for (const x of prints) {
    if (st.nDev % 10 === 0) {
      let j = 0;
      while (j < st.devs.length && st.devs[j][0] < sec - p.trailS) j++;
      if (j) st.devs.splice(0, j);
      const bs = st.devs.filter((d) => d[1] > 0).map((d) => d[2]), ss = st.devs.filter((d) => d[1] < 0).map((d) => d[2]);
      if (bs.length >= 5 && ss.length >= 5) {
        const c = (median(bs) + median(ss)) / 2;
        if (c !== st.c) {
          st.c = c;
          if (st.firstStep == null) st.firstStep = sec;
        }
      }
    }
    st.devs.push([sec, x.side, 1e4 * Math.log(x.price / fPrev)]);
    st.nDev++;
  }
}

/**
 * Runs seconds [from, to) on `st` (mutated). `F(s)` is the fair before the basis (null when Binance or the rates are missing),
 * `prints(s)` the second's prints in the tape's order; quoting starts at `quoteFrom` (and never before the second after the first
 * basis). Returns the fills and each second's record.
 */
export function mmRun(st: MmState, p: MmParams, from: number, to: number, F: (s: number) => number | null, prints: (s: number) => MmPrint[],
  quoteFrom: number): { fills: MmFill[]; seconds: MmSecond[] } {
  const fills: MmFill[] = [], seconds: MmSecond[] = [];
  const CAP = p.capGbp, Q = p.qGbp;
  for (let s = from; s < to; s++) {
    const ps = prints(s);
    const fPrev = F(s - 1);
    const hadStep = st.firstStep != null;
    mmBasis(st, p, s, ps, fPrev);
    // rule.py's s0 = the first centre's second + 1: a centre that first appears in this second quotes from the next.
    const active = s >= quoteFrom && hadStep && st.c != null && s >= (st.firstStep as number) + 1;
    if (!active) { seconds.push({ sec: s, fair: null, c: st.c, stale: true }); continue; }
    const ec = Math.exp((st.c as number) / 1e4);
    const fNow = F(s);
    const stale = fPrev == null || fNow == null;
    const fKnow = stale ? NaN : (fPrev as number) * ec, fTrue = stale ? NaN : (fNow as number) * ec;
    // the stop
    if (!stale && p.stopBps != null && st.coin * fTrue > 1.0 && st.cost > 0) {
      if ((st.coin * fTrue) / st.cost - 1 < -p.stopBps / 1e4) {
        const px = fTrue * (1 - (MM_TAKER_FEE_BPS + p.exitSlipBps) / 1e4);
        st.cash += st.coin * px;
        fills.push({ sec: s, side: -1, qty: st.coin, price: px, fair: fTrue, kind: "stop" });
        st.coin = 0; st.cost = 0;
        st.stops++;
        st.coolUntil = s + p.cooldownS;
        if (st.ask) st.cancels++;
        st.ask = null;
        st.need = true;
      }
    }
    // re-price
    if (!stale && (st.need || (st.ref != null && Math.abs(1e4 * Math.log(fKnow / st.ref)) > p.thetaBps) || (!st.bid && !st.ask))) {
      st.ref = fKnow;
      const d = p.dBps / 1e4;
      const k = p.kappa * d * (st.coin * fKnow - 0) / CAP;
      const nb = st.ref * (1 - d - k), na = st.ref * (1 + d - k);
      const canBid = s >= st.coolUntil && st.cash >= 1.0 && st.coin * fKnow < CAP;
      const canAsk = st.coin * na >= 1.0;
      const newBid = canBid ? nb : null, newAsk = canAsk ? na : null;
      const oldBid = st.bid?.price ?? null, oldAsk = st.ask?.price ?? null;
      const bidShort = oldBid != null && (st.bid as MmQuote).left < Math.min(Q, st.cash) / oldBid - 1e-12;
      if (newBid !== oldBid || bidShort) {
        if (oldBid != null) st.cancels++;
        if (newBid != null) st.placed++;
        st.bid = newBid != null ? { price: newBid, left: Math.min(Q, st.cash) / nb, since: s } : null;
      }
      const askShort = oldAsk != null && (st.ask as MmQuote).left < Math.min(Q / na, st.coin) - 1e-12;
      if (newAsk !== oldAsk || askShort) {
        if (oldAsk != null) st.cancels++;
        if (newAsk != null) st.placed++;
        st.ask = newAsk != null ? { price: newAsk, left: Math.min(Q / na, st.coin), since: s } : null;
      }
      st.need = false;
    } else if (stale && (st.bid || st.ask)) {
      st.cancels += (st.bid ? 1 : 0) + (st.ask ? 1 : 0);
      st.bid = null; st.ask = null;
      st.need = true;
    }
    // the public taker orders of the second
    for (const o of mmTakerOrders(ps)) {
      const first = o.prints[0][0];
      if (o.side > 0 && st.ask && st.ask.left > 0 && s - st.ask.since >= p.restLagS) {
        const a = st.ask.price;
        let q = a < first ? o.prints.reduce((t, x) => t + x[1], 0) : o.prints.reduce((t, x) => t + (x[0] > a ? x[1] : 0), 0);
        q = Math.min(Math.max(q, 0.0), st.ask.left);
        if (q > 0) {
          st.ask.left -= q;
          st.cost -= st.coin > 0 ? st.cost * q / st.coin : 0;
          st.coin -= q;
          st.cash += q * a;
          fills.push({ sec: s, side: -1, qty: q, price: a, fair: fTrue, kind: "taker" });
          st.need = true;
        }
      } else if (o.side < 0 && st.bid && st.bid.left > 0 && s - st.bid.since >= p.restLagS) {
        const b = st.bid.price;
        let q = b > first ? o.prints.reduce((t, x) => t + x[1], 0) : o.prints.reduce((t, x) => t + (x[0] < b ? x[1] : 0), 0);
        q = Math.min(Math.max(q, 0.0), st.bid.left);
        if (q > 0) {
          st.bid.left -= q;
          st.coin += q;
          st.cost += q * b;
          st.cash -= q * b;
          fills.push({ sec: s, side: 1, qty: q, price: b, fair: fTrue, kind: "taker" });
          st.need = true;
        }
      }
    }
    // the arbitrageur
    if (!stale) {
      if (st.ask && st.ask.left > 0 && st.ask.price < fTrue * (1 - p.xArbBps / 1e4)) {
        const q = st.ask.left, a = st.ask.price;
        st.ask.left = 0;
        st.cost -= st.coin > 0 ? st.cost * q / st.coin : 0;
        st.coin -= q;
        st.cash += q * a;
        fills.push({ sec: s, side: -1, qty: q, price: a, fair: fTrue, kind: "arb" });
        st.need = true;
      }
      if (st.bid && st.bid.left > 0 && st.bid.price > fTrue * (1 + p.xArbBps / 1e4)) {
        const q = st.bid.left, b = st.bid.price;
        st.bid.left = 0;
        st.coin += q;
        st.cost += q * b;
        st.cash -= q * b;
        fills.push({ sec: s, side: 1, qty: q, price: b, fair: fTrue, kind: "arb" });
        st.need = true;
      }
    }
    seconds.push({ sec: s, fair: stale ? null : fKnow, c: st.c, stale });
  }
  return { fills, seconds };
}
