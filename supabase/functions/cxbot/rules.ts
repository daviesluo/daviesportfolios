// CXBOT_RULES: the deterministic layer the outside Grok agent cannot override (the audit:
// docs/agents/reviews/2026-10-29-crypto-grok-bot-audit.md §5-§7; the pre-registration, a DRAFT:
// docs/agents/reviews/2026-10-29-cxbot-phase1-prereg.md §2 and §5). Pure: `engine.ts` reads the tape and the database and
// feeds these functions what it read, so every number here is pinned alone in `rules.test.ts`.
//
// Phase 1 is PAPER. Every open is a bracket on a perpetual (an entry, a stop, a limit, long or short); its baseline is the
// model-free m = (entry − stop) / (limit − stop) (a short mirrored): at a fair price the expected outcome of the bracket,
// with a timeout scored where the price stands between stop (0) and limit (1), is exactly m for any hold (optional
// stopping). The agent's p must beat m by the server's costs plus `edgeMin`.

import { CB_RELEASE_MS, cbInBlackout } from "../agents/cb_releases.ts";

const M = 60e3, H = 3600e3, DAY = 86400e3;

export const COINS = ["BTC", "ETH", "SOL"] as const;
export type Coin = typeof COINS[number];
export type Dir = "long" | "short";
export const VENUES = ["hyperliquid", "binance", "okx"] as const;
export type Venue = typeof VENUES[number];

export const CXBOT_RULES = {
  /** Risk at the stop, costs included, of one open: at most this share of the budget (1 %). */
  riskPerTradeFrac: 0.01,
  /** Everything open and resting, at its stops: at most this share of the budget (3 %). */
  maxTotalRiskFrac: 0.03,
  /** Everything in one direction, at its stops: at most this share (2 %): BTC, ETH and SOL move together. */
  maxDirectionRiskFrac: 0.02,
  /** Positions and resting orders together; one per coin. */
  maxOpen: 3,
  /** Gross notional at most this multiple of the budget; net (longs less shorts) at most `maxNetMult`. */
  maxGrossMult: 2, maxNetMult: 1,
  /** The limit's distance over the stop's. */
  minRewardRisk: 1.5,
  /** p over p* = m + costs / (d_stop + d_limit). */
  edgeMin: 0.08,
  /** Risk at most a quarter of the Kelly stake of the equity at p and R. */
  kellyFraction: 0.25,
  /** The stop's distance, in the coin's one-day standard deviations, and never under 1 % of the entry. */
  stopMinSd: 0.75, stopMaxSd: 5, stopMinFrac: 0.01,
  /** Leverage the server sets (isolated): at most 3×, and low enough that liquidation lies 2.5 stop distances beyond the stop. */
  maxLeverage: 3, liqStopMult: 2.5,
  /** No open whose side pays more than this a hour, now or predicted (0.01 %, 8× Hyperliquid's floor). */
  maxFundingPerHour: 0.0001,
  /** No open from 10 minutes before to 5 minutes after a listed release; no resting order alive into that window. */
  blackoutLeadMs: 10 * M, blackoutTrailMs: 5 * M,
  /** The tape at most this old, and the book at most this wide (bps) for an open. */
  maxTapeAgeMs: 2 * M, maxSpreadBps: { BTC: 5, ETH: 5, SOL: 10 } as Record<Coin, number>,
  /** A market open's worst price at most this share of the stop distance beyond the touch. */
  maxSlippageFrac: 0.1,
  /** A resting order (a limit or a stop entry) lives 5 minutes to 24 hours. */
  minWorkingMs: 5 * M, maxWorkingMs: 24 * H,
  /** The server closes a position this old. */
  maxHoldMs: 7 * DAY,
  /** Trading requests a rolling minute; orders a UTC day. */
  maxOrdersPerMinute: 3, maxOrdersDay: 30,
  /** Category E names a listed release within 72 hours ahead; R one within 24 hours behind. */
  eventAheadMs: 72 * H, eventBehindMs: 24 * H,
  /** A stop's fill: the worse of the stop less this and the next minute's open. */
  stopSlippage: 0.0005,
  /** Margin in use at most this share of the equity. */
  maxMarginFrac: 0.5,
} as const;

/** Fees at the entry tier, maker and taker (audit §2.3). */
export const CXBOT_FEES: Record<Venue, { maker: number; taker: number }> = {
  hyperliquid: { maker: 0.00015, taker: 0.00045 },
  binance: { maker: 0.0002, taker: 0.0005 },
  okx: { maker: 0.0002, taker: 0.0005 },
};

/** Maintenance margin as a share of notional: half the initial margin at Hyperliquid's maximum leverage (40×, 25×, 20×). */
export const CXBOT_MAINTENANCE: Record<Coin, number> = { BTC: 0.0125, ETH: 0.02, SOL: 0.025 };
/** Size decimals (Hyperliquid's `szDecimals`, read 2026-10-29). */
export const CXBOT_SZ_DECIMALS: Record<Coin, number> = { BTC: 5, ETH: 4, SOL: 2 };

/** The release list (`agents/cb_releases.ts`) ends 2026-12-31: no open after it until the list is extended. */
export const CXBOT_CALENDAR_UNTIL_MS = Date.parse("2027-01-01T00:00:00Z");
export const CXBOT_RELEASE_MS: readonly number[] = CB_RELEASE_MS;

/** The assigned questions (prereg §5): every 4 hours, both directions of each coin; stop 1 day-sd, limit 2; 72 h. */
export const CXBOT_QUESTIONS = {
  everyHours: 4, answerMs: 20 * M, stopSd: 1, limitSd: 2, minStopFrac: 0.01, holdMs: 72 * H,
  /** Polymarket's daily "above" questions: horizons before resolution, the answer window, the target mids. */
  pmHorizonsH: [24, 8, 2] as readonly number[], pmAnswerMs: 15 * M, pmTargets: [0.25, 0.5, 0.75] as readonly number[],
  /** Own and shadow brackets: the hold the reading scores them over, the window a shadow's entry must be reached in. */
  ownHoldMs: 7 * DAY, shadowFillMs: 24 * H,
} as const;

export type Refusal = { rule: string; why: string };
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Where a price stands in a bracket, from the stop (0) to the limit (1), clipped (prereg §5). */
export function fractionOf(dir: Dir, stop: number, limit: number, x: number): number {
  const f = dir === "long" ? (x - stop) / (limit - stop) : (stop - x) / (stop - limit);
  return Math.min(1, Math.max(0, f));
}

export type Bracket = { ok: true; dStop: number; dLimit: number; rewardRisk: number; m: number } | { ok: false; why: string };

/** A bracket's geometry: distances as shares of the entry, the reward/risk and m. */
export function bracketOf(dir: Dir, entry: number, stop: number, limit: number): Bracket {
  if (![entry, stop, limit].every((x) => Number.isFinite(x) && x > 0)) return { ok: false, why: "entry, stop and limit must be positive numbers" };
  const ok = dir === "long" ? stop < entry && entry < limit : limit < entry && entry < stop;
  if (!ok) return { ok: false, why: dir === "long" ? "a long needs stop < entry < limit" : "a short needs limit < entry < stop" };
  const dStop = Math.abs(entry - stop) / entry, dLimit = Math.abs(limit - entry) / entry;
  return { ok: true, dStop, dLimit, rewardRisk: dLimit / dStop, m: dStop / (dStop + dLimit) };
}

/**
 * The server's costs of a bracket as a share of the entry, the stop path taken (the dearer): the entry's fee (taker for a
 * market or stop entry, maker for a resting limit), a taker exit at the stop plus its slippage, and the funding the side
 * would pay over the hold at the dearer of the current and the predicted rate (a rate in its favour counts as nothing).
 * p* = m + costs / (d_stop + d_limit); the bar is p* + `edgeMin`.
 */
export function costsOf(o: {
  venue: Venue; dir: Dir; entryType: "market" | "limit" | "stop"; dStop: number; dLimit: number; m: number;
  fundingPerHour: number | null; predictedPerHour: number | null; holdMs: number;
}) {
  const fee = CXBOT_FEES[o.venue];
  const feeIn = o.entryType === "limit" ? fee.maker : fee.taker;
  const exit = fee.taker + CXBOT_RULES.stopSlippage;
  const sign = o.dir === "long" ? 1 : -1;
  const rate = Math.max(0, sign * (o.fundingPerHour ?? 0), sign * (o.predictedPerHour ?? 0));
  const funding = rate * (o.holdMs / H);
  const total = feeIn + exit + funding;
  const pStar = o.m + total / (o.dStop + o.dLimit);
  return {
    fee_in_bps: r4(feeIn * 1e4), exit_bps: r4(exit * 1e4), funding_bps: r4(funding * 1e4), total_bps: r4(total * 1e4),
    total, p_star: r4(pStar), bar: r4(pStar + CXBOT_RULES.edgeMin),
  };
}

/**
 * The leverage the server sets for an isolated position: the most, at most `maxLeverage`, that keeps the liquidation price
 * at least `liqStopMult` stop distances beyond the stop (distance from the entry ≥ (1 + mult) × d_stop), rounded down to a
 * tenth; null when even 1× cannot (a stop over about a quarter of the price).
 */
export function leverageFor(coin: Coin, dir: Dir, dStop: number): number | null {
  const mm = CXBOT_MAINTENANCE[coin];
  const need = (1 + CXBOT_RULES.liqStopMult) * dStop;
  const inv = need * (dir === "long" ? 1 - mm : 1 + mm) + mm; // 1/L at which the liquidation distance is exactly `need`
  const lev = Math.floor(Math.min(CXBOT_RULES.maxLeverage, 1 / inv) * 10) / 10;
  return lev >= 1 ? lev : null;
}

/** An isolated position's liquidation price at leverage L (Hyperliquid's rule: equity down to the maintenance margin). */
export function liquidationPrice(coin: Coin, dir: Dir, entry: number, lev: number): number {
  const mm = CXBOT_MAINTENANCE[coin];
  return dir === "long" ? entry * (1 - 1 / lev) / (1 - mm) : entry * (1 + 1 / lev) / (1 + mm);
}

/** A quarter of the Kelly stake at p and reward/risk R, of the equity: the most the stop may lose. */
export function kellyRisk(p: number, rr: number, equity: number): number {
  return CXBOT_RULES.kellyFraction * Math.max(0, p - (1 - p) / rr) * Math.max(0, equity);
}

/** Round a size down to the coin's decimals. */
export function roundSize(coin: Coin, size: number): number {
  const k = 10 ** CXBOT_SZ_DECIMALS[coin];
  return Math.floor(size * k + 1e-9) / k;
}

/** The most a bracket may hold, in coins: the smaller of the risk cap and ¼ Kelly, over the loss a coin takes at the stop with costs. */
export function sizeMax(o: { coin: Coin; entry: number; dStop: number; costs: number; p: number; rr: number; budget: number; equity: number }): number {
  const cap = Math.min(CXBOT_RULES.riskPerTradeFrac * o.budget, kellyRisk(o.p, o.rr, o.equity));
  const perCoin = o.entry * (o.dStop + o.costs);
  return perCoin > 0 ? roundSize(o.coin, cap / perCoin) : 0;
}

/** Whether `t` is inside a listed release's window (T − lead ≤ t ≤ T + trail). */
export const inBlackout = (t: number, releases: readonly number[] = CXBOT_RELEASE_MS) =>
  cbInBlackout(t, releases, CXBOT_RULES.blackoutLeadMs, CXBOT_RULES.blackoutTrailMs);

/** The first instant in [from, to] that is inside a release window, or null. */
export function blackoutWithin(from: number, to: number, releases: readonly number[] = CXBOT_RELEASE_MS): number | null {
  for (const r of releases) {
    const a = r - CXBOT_RULES.blackoutLeadMs, b = r + CXBOT_RULES.blackoutTrailMs;
    if (b >= from && a <= to) return Math.max(a, from);
  }
  return null;
}

/** One open or resting bracket of the book, as the rules count it. */
export type BookItem = { coin: Coin; dir: Dir; size: number; entry: number; stop: number; pending?: boolean; leverage?: number | null };
export const riskOf = (b: BookItem) => b.size * Math.abs(b.entry - b.stop);

export type OpenRequest = {
  coin: Coin; dir: Dir; entryType: "market" | "limit" | "stop"; entry: number; stop: number; limit: number; size: number; p: number;
  category: "E" | "R" | "N"; eventAt: number | null; goodTill: number | null;
};
export type MarketState = {
  bid: number; ask: number; mid: number; spreadBps: number; tapeAgeMs: number; sd24: number | null;
  fundingPerHour: number | null; predictedPerHour: number | null;
};
export type OpenContext = {
  nowMs: number; venue: Venue; market: MarketState; book: BookItem[]; budget: number; equity: number; ordersToday: number;
  ordersLastMinute: number; maxOrdersDay: number; dayStopHit: boolean; totalStopHit: boolean; releases?: readonly number[];
};

/**
 * Every rule an open breaks, by name (the prompt lists each). Empty: the open may go. The checks a request's shape needs
 * (types, lengths, sources) are `ingest.ts`'s; these are the money's.
 */
export function openRefusals(req: OpenRequest, x: OpenContext): { refusals: Refusal[]; checks: Record<string, unknown> } {
  const out: Refusal[] = [];
  const no = (rule: string, why: string) => out.push({ rule, why });
  const R = CXBOT_RULES;
  const checks: Record<string, unknown> = {};
  const releases = x.releases ?? CXBOT_RELEASE_MS;
  if (x.totalStopHit) no("total_stop", "the total stop is reached: close-only to the end");
  if (x.dayStopHit) no("day_stop", "the day stop is reached: no open until 00:00 UTC");
  if (x.nowMs >= CXBOT_CALENDAR_UNTIL_MS) no("calendar", "the release list ends 2026-12-31: no open until it is extended");
  if (x.ordersToday >= x.maxOrdersDay) no("orders_day", `${x.ordersToday} orders today, at most ${x.maxOrdersDay}`);
  if (x.ordersLastMinute >= R.maxOrdersPerMinute) no("orders_minute", `at most ${R.maxOrdersPerMinute} trading requests a minute`);
  const br = bracketOf(req.dir, req.entry, req.stop, req.limit);
  if (!br.ok) { no("bracket", br.why); return { refusals: out, checks }; }
  checks.m = r4(br.m);
  checks.d_stop = r6(br.dStop);
  checks.d_limit = r6(br.dLimit);
  const mk = x.market;
  // The stop must not already be through the price (the exit side: a long's bid, a short's ask).
  if (req.dir === "long" ? mk.bid <= req.stop : mk.ask >= req.stop) no("bracket", "the stop is already through the price");
  if (br.rewardRisk < R.minRewardRisk - 1e-9) no("reward_risk", `the limit's distance is ${br.rewardRisk.toFixed(2)} × the stop's, at least ${R.minRewardRisk}`);
  if (mk.sd24 === null || !(mk.sd24 > 0)) no("stale_tape", "the coin's one-day volatility is not known yet");
  else {
    const sd = br.dStop / mk.sd24;
    checks.stop_sd = r4(sd);
    if (sd < R.stopMinSd - 1e-9 || sd > R.stopMaxSd + 1e-9 || br.dStop < R.stopMinFrac - 1e-12) {
      no("stop_distance", `the stop is ${(br.dStop * 100).toFixed(2)} % away, ${sd.toFixed(2)} day-sd; it must be ${R.stopMinSd}–${R.stopMaxSd} day-sd (${(mk.sd24 * 100).toFixed(2)} % a day) and at least 1 %`);
    }
  }
  const holdMs = R.maxHoldMs;
  const c = costsOf({ venue: x.venue, dir: req.dir, entryType: req.entryType, dStop: br.dStop, dLimit: br.dLimit, m: br.m, fundingPerHour: mk.fundingPerHour, predictedPerHour: mk.predictedPerHour, holdMs: Math.min(holdMs, 72 * H) });
  checks.costs_bps = c.total_bps;
  checks.p_star = c.p_star;
  checks.bar = c.bar;
  if (!(req.p >= c.bar - 1e-9)) no("edge", `p ${req.p} is under the bar ${c.bar} (p* ${c.p_star} = m ${r4(br.m)} + costs ${c.total_bps} bps over the bracket, plus ${R.edgeMin})`);
  // Entry shapes: a market open's entry is the worst price it accepts.
  const touch = req.dir === "long" ? mk.ask : mk.bid;
  if (req.entryType === "market") {
    const room = R.maxSlippageFrac * br.dStop * touch;
    if (req.dir === "long" ? req.entry < touch : req.entry > touch) no("level", `a market ${req.dir}'s entry is the worst price it accepts: at or ${req.dir === "long" ? "above the ask" : "below the bid"} (${touch})`);
    else if (Math.abs(req.entry - touch) > room + 1e-9) no("slippage", `the entry is ${Math.abs(req.entry - touch).toFixed(4)} from the touch, at most a tenth of the stop distance (${room.toFixed(4)})`);
  } else {
    const rests = req.entryType === "limit" ? (req.dir === "long" ? req.entry < mk.ask : req.entry > mk.bid) : (req.dir === "long" ? req.entry > mk.ask : req.entry < mk.bid);
    if (!rests) no("level", req.entryType === "limit" ? "a resting limit sits below the ask (a long) or above the bid (a short)" : "a stop entry sits above the ask (a long) or below the bid (a short)");
    if (req.goodTill === null) no("good_till", "a resting order needs good_till");
    else if (req.goodTill < x.nowMs + R.minWorkingMs || req.goodTill > x.nowMs + R.maxWorkingMs) no("good_till", "a resting order lives 5 minutes to 24 hours");
    else if (blackoutWithin(x.nowMs, req.goodTill, releases) !== null) no("blackout", "a resting order may not be alive into a release window");
  }
  if (inBlackout(x.nowMs, releases)) no("blackout", "no open from 10 minutes before to 5 minutes after a listed release");
  // Categories: E a listed release ahead, R one behind.
  if (req.category === "E" || req.category === "R") {
    const listed = req.eventAt !== null && releases.includes(req.eventAt);
    const ahead = req.eventAt !== null && req.eventAt > x.nowMs && req.eventAt - x.nowMs <= R.eventAheadMs;
    const behind = req.eventAt !== null && req.eventAt <= x.nowMs && x.nowMs - req.eventAt <= R.eventBehindMs;
    if (!listed || (req.category === "E" ? !ahead : !behind)) {
      no("category", req.category === "E" ? "E names a listed release (event_at exactly as the calendar gives it) within 72 hours ahead" : "R names a listed release within the last 24 hours");
    }
  }
  if (mk.tapeAgeMs > R.maxTapeAgeMs) no("stale_tape", `the tape is ${Math.round(mk.tapeAgeMs / 1000)} s old, at most 120 s`);
  if (mk.spreadBps > R.maxSpreadBps[req.coin]) no("wide_book", `the spread is ${mk.spreadBps.toFixed(2)} bps, at most ${R.maxSpreadBps[req.coin]}`);
  const sign = req.dir === "long" ? 1 : -1;
  const worstFunding = Math.max(sign * (mk.fundingPerHour ?? 0), sign * (mk.predictedPerHour ?? 0));
  if (worstFunding > R.maxFundingPerHour) no("funding", `the ${req.dir} side pays ${(worstFunding * 100).toFixed(4)} %/h now or predicted, at most 0.01 %/h`);
  // Size, risk and the book.
  if (!(req.size > 0) || roundSize(req.coin, req.size) !== req.size) no("size", `over 0, in at most ${CXBOT_SZ_DECIMALS[req.coin]} decimals`);
  const risk = req.size * req.entry * (br.dStop + c.total);
  const kelly = kellyRisk(req.p, br.rewardRisk, x.equity);
  checks.risk_usd = Math.round(risk * 100) / 100;
  checks.kelly_usd = Math.round(kelly * 100) / 100;
  if (risk > R.riskPerTradeFrac * x.budget + 1e-6) no("risk", `risk at the stop with costs $${risk.toFixed(2)}, at most $${(R.riskPerTradeFrac * x.budget).toFixed(2)} (1 %)`);
  if (risk > kelly + 1e-6) no("kelly", `risk $${risk.toFixed(2)} over a quarter Kelly of the equity at p and R ($${kelly.toFixed(2)})`);
  const book = x.book;
  const total = book.reduce((s, b) => s + riskOf(b), 0) + risk;
  const dirRisk = book.filter((b) => b.dir === req.dir).reduce((s, b) => s + riskOf(b), 0) + risk;
  if (total > R.maxTotalRiskFrac * x.budget + 1e-6) no("total_risk", `everything at its stops would be $${total.toFixed(2)}, at most $${(R.maxTotalRiskFrac * x.budget).toFixed(2)}`);
  if (dirRisk > R.maxDirectionRiskFrac * x.budget + 1e-6) no("direction_risk", `the ${req.dir} side at its stops would be $${dirRisk.toFixed(2)}, at most $${(R.maxDirectionRiskFrac * x.budget).toFixed(2)}`);
  if (book.length >= R.maxOpen) no("positions", `${book.length} positions and resting orders, at most ${R.maxOpen}`);
  if (book.some((b) => b.coin === req.coin)) no(book.some((b) => b.coin === req.coin && b.pending) ? "pending" : "one_per_coin", "one position or resting order a coin: no adding, averaging down or hedging");
  const notional = req.size * req.entry;
  const gross = book.reduce((s, b) => s + b.size * b.entry, 0) + notional;
  const net = Math.abs(book.reduce((s, b) => s + (b.dir === "long" ? 1 : -1) * b.size * b.entry, 0) + sign * notional);
  if (gross > R.maxGrossMult * x.budget + 1e-6) no("notional", `gross notional would be $${gross.toFixed(0)}, at most $${(R.maxGrossMult * x.budget).toFixed(0)}`);
  else if (net > R.maxNetMult * x.budget + 1e-6) no("notional", `net notional would be $${net.toFixed(0)}, at most $${(R.maxNetMult * x.budget).toFixed(0)}`);
  const lev = leverageFor(req.coin, req.dir, br.dStop);
  if (lev === null) no("leverage", "the stop is too far for any isolated leverage to keep liquidation 2.5 stop distances beyond it");
  else {
    checks.leverage = lev;
    checks.liq_price = r6(liquidationPrice(req.coin, req.dir, req.entry, lev));
    // Each held or resting bracket at its own leverage (the server's, stored on it); 3× only when none is known.
    const margin = book.reduce((s, b) => s + (b.size * b.entry) / (b.leverage && b.leverage > 0 ? b.leverage : R.maxLeverage), 0) + notional / lev;
    if (margin > R.maxMarginFrac * x.equity + 1e-6) no("leverage", `margin in use would be $${margin.toFixed(0)}, at most half the equity`);
  }
  return { refusals: out, checks };
}

/** The assigned bracket of a coin and direction from a price and the coin's one-day volatility (prereg §5, layer A). */
export function assignedBracket(dir: Dir, entry: number, sd24: number) {
  const q = CXBOT_QUESTIONS;
  const d = Math.max(q.minStopFrac, q.stopSd * sd24), l = (q.limitSd / q.stopSd) * d;
  const stop = dir === "long" ? entry * (1 - d) : entry * (1 + d);
  const limit = dir === "long" ? entry * (1 + l) : entry * (1 - l);
  return { stop: r6(stop), limit: r6(limit), dStop: d, dLimit: l, m: d / (d + l) };
}

/** One recorded minute of the tape: its start, and the trades' high, low and close (and open). */
export type Minute = { t: number; o: number; h: number; l: number; c: number };

/**
 * A bracket's outcome on the tape (prereg §5): from `start` (a minute boundary), each recorded minute in turn; 1 when a
 * minute's trades reach the limit, 0 the stop; a minute reaching both is ambiguous (y 0 stop-first, `yAlt` 1 limit-first);
 * neither by start + hold: the close of the last minute inside it, as its fraction. Pending until the tape covers it.
 */
export function resolveOnTape(b: { dir: Dir; start: number; stop: number; limit: number; holdMs: number }, minutes: Minute[]):
  { y: number; how: "limit" | "stop" | "timeout" | "ambiguous"; yAlt?: number; at: number } | { pending: true } {
  const end = b.start + b.holdMs;
  let last: Minute | null = null;
  for (const mi of minutes) {
    if (mi.t < b.start) continue;
    if (mi.t >= end) break;
    const hitLimit = b.dir === "long" ? mi.h >= b.limit : mi.l <= b.limit;
    const hitStop = b.dir === "long" ? mi.l <= b.stop : mi.h >= b.stop;
    if (hitLimit && hitStop) return { y: 0, yAlt: 1, how: "ambiguous", at: mi.t };
    if (hitLimit) return { y: 1, how: "limit", at: mi.t };
    if (hitStop) return { y: 0, how: "stop", at: mi.t };
    last = mi;
  }
  const covered = minutes.length > 0 && minutes[minutes.length - 1].t >= end - M;
  if (!covered || !last) return { pending: true };
  return { y: fractionOf(b.dir, b.stop, b.limit, last.c), how: "timeout", at: end };
}

/**
 * The paper fill of a protective stop reached in a minute: the worst of the stop less `stopSlippage`, the minute's own open
 * (a minute that OPENS beyond the stop has gapped through it: the first trade there is the open, not the stop), and the
 * next minute's open. A long sells: min; a short buys back: max. (Independent audit 2026-10-29, F6: the minute's open was
 * left out, so a gap through the stop that recovered inside its minute filled at the stop.)
 */
export function stopFill(dir: Dir, stop: number, minuteOpen: number, nextOpen: number): number {
  return dir === "long"
    ? Math.min(stop * (1 - CXBOT_RULES.stopSlippage), minuteOpen, nextOpen)
    : Math.max(stop * (1 + CXBOT_RULES.stopSlippage), minuteOpen, nextOpen);
}

/** The paper fill of a resting stop ENTRY reached in a minute: the mirror of `stopFill` (a long buys: the worst is the highest). */
export function stopEntryFill(dir: Dir, entry: number, minuteOpen: number, nextOpen: number): number {
  return dir === "long"
    ? Math.max(entry * (1 + CXBOT_RULES.stopSlippage), minuteOpen, nextOpen)
    : Math.min(entry * (1 - CXBOT_RULES.stopSlippage), minuteOpen, nextOpen);
}

/** Whether a position's liquidation price is reached in a minute (on trades: conservative against Hyperliquid's mark). */
export const liqReached = (dir: Dir, liq: number, mi: Minute) => (dir === "long" ? mi.l <= liq : mi.h >= liq);

/** Which side of an open position a recorded minute reaches: the stop first when both (conservative for money). */
export function positionEvent(dir: Dir, stop: number, limit: number, mi: Minute): "stop" | "limit" | null {
  const s = dir === "long" ? mi.l <= stop : mi.h >= stop;
  // A take-profit fills only when trades go strictly through it.
  const l = dir === "long" ? mi.h > limit : mi.l < limit;
  return s ? "stop" : l ? "limit" : null;
}

/** Whether a resting entry fills in a minute: a limit only strictly through; a stop entry when trades reach it. */
export function entryEvent(dir: Dir, type: "limit" | "stop", price: number, mi: Minute): boolean {
  if (type === "limit") return dir === "long" ? mi.l < price : mi.h > price;
  return dir === "long" ? mi.h >= price : mi.l <= price;
}

/** A market fill through the book: the volume-weighted price of `size` coins taken from `levels` (best first), and one tick. */
export function walkBook(levels: Array<[number, number]>, size: number, tick: number, buy: boolean): number | null {
  let rem = size, cost = 0;
  for (const [px, sz] of levels) {
    const take = Math.min(rem, sz);
    cost += take * px;
    rem -= take;
    if (rem <= 1e-12) break;
  }
  if (rem > 1e-12) return null;
  const vwap = cost / size;
  return buy ? vwap + tick : vwap - tick;
}

/** The standard normal distribution function (Abramowitz-Stegun 26.2.17, |error| < 7.5e-8). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/**
 * A bracket's outcome distribution if the price is a martingale with annual volatility `sigma` (log price: drift −σ²/2):
 * P(limit first within the hold), P(stop first), P(neither) and the mean fraction when neither. Brownian motion killed at
 * two barriers, by its eigenfunction series (exit fluxes integrated over the hold; the survivors' density on a grid).
 * Pinned against `docs/agents/backtests/cxbot/bracket.py`'s Monte Carlo in `rules.test.ts`.
 */
export function decompose(dir: Dir, entry: number, stop: number, limit: number, sigma: number, holdMs: number) {
  const T = holdMs / (365 * DAY);
  const lo = Math.log(Math.min(stop, limit) / entry), hi = Math.log(Math.max(stop, limit) / entry);
  const L = hi - lo, u = -lo / L; // the start's place between the barriers
  const s2 = sigma * sigma, mu = -s2 / 2;
  const kap = (n: number) => (s2 * n * n * Math.PI * Math.PI) / (2 * L * L) + (mu * mu) / (2 * s2);
  // Exit at the upper barrier by T, and at the lower: the closed form with no time limit (with drift −σ²/2 it is the
  // price martingale's (entry − low) / (high − low)) less what would still exit after T, whose series converges fast.
  const pHiInf = (1 - Math.exp(lo)) / (Math.exp(hi) - Math.exp(lo));
  let tailHi = 0, tailLo = 0;
  const N = Math.min(4000, Math.max(5, Math.ceil(Math.sqrt((80 * L * L) / (s2 * Math.PI * Math.PI * Math.max(T, 1e-12)))) + 5));
  for (let n = 1; n <= N; n++) {
    const k = kap(n), w = (s2 * n * Math.PI) / (L * L), sn = Math.sin(n * Math.PI * u), g = Math.exp(-k * T) / k;
    tailHi += w * (n % 2 === 1 ? 1 : -1) * sn * Math.exp((mu * hi) / s2) * g;
    tailLo += w * sn * Math.exp((mu * lo) / s2) * g;
  }
  const pHi = pHiInf - tailHi, pLo = 1 - pHiInf - tailLo;
  // The survivors' density at T on a grid of the log price, and the mean fraction of the price between stop and limit.
  const G = 400;
  let surv = 0, frac = 0;
  for (let i = 1; i < G; i++) {
    const y = lo + (L * i) / G;
    let p = 0;
    for (let n = 1; n <= N; n++) p += Math.sin(n * Math.PI * u) * Math.sin((n * Math.PI * (y - lo)) / L) * Math.exp(-kap(n) * T);
    p *= (2 / L) * Math.exp((mu * y) / s2);
    const dy = L / G;
    surv += p * dy;
    frac += p * dy * fractionOf(dir, stop, limit, entry * Math.exp(y));
  }
  const up = dir === "long";
  const pLimit = Math.max(0, up ? pHi : pLo), pStop = Math.max(0, up ? pLo : pHi), pNeither = Math.max(0, surv);
  return { p_limit_first: r4(pLimit), p_stop_first: r4(pStop), p_neither: r4(pNeither), y_if_neither: pNeither > 1e-9 ? r4(frac / pNeither) : null, e_y: r4(pLimit + frac) };
}
