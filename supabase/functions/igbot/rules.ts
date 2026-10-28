// IGBOT_RULES: the deterministic risk layer the outside Grok agent cannot override (docs/agents/reviews/2026-10-29-igbot-
// prereg.md §2, a DRAFT; the research behind each number is docs/agents/reviews/2026-10-29-igbot-research.md §6). Pure:
// `exec.ts` reads IG and the database and feeds these functions what it read.
//
// The bot trades IG spread bets only (daily funded bets, `expiry` "DFB", in £ a point), so a position's profit in pounds
// is its size times the move in IG's own level, whatever the market: a US 500 point, an FX pip (IG quotes FX spread bets
// scaled, AUD/USD as 6910.7), an FTSE point. Every number below is in pounds or in IG's points.
//
// Every open is a bracket: an entry, a GUARANTEED stop and a limit (take-profit), each at a level. Its risk is what the
// guaranteed stop costs when it triggers: the size times the distance from the entry (the worst fill it accepts, for an
// immediate deal) to the stop, plus IG's guaranteed-stop premium. Its baseline m is the chance a driftless price reaches
// the limit before the stop, d_stop / (d_stop + d_limit); the agent's p (that the limit is hit first) must beat m by
// `edgeMin`, the GROKPM lesson translated: IG quotes no probability, so the bracket's geometry is the market's price.

import { CB_RELEASES } from "../agents/cb_releases.ts";

const M = 60e3, H = 3600e3, DAY = 86400e3;

export const IGBOT_RULES = {
  /** Risk at the stop, premium included, of one open: at most this share of the budget (1 %). */
  riskPerTradeFrac: 0.01,
  /** Every open position and working order together, at their stops: at most this share of the budget (3 %). */
  maxTotalRiskFrac: 0.03,
  /** Open positions and working orders together. */
  maxOpen: 3,
  /** Notional (size × level, in £) of everything open and this order: at most this multiple of the budget. */
  maxNotionalMult: 5,
  /** The limit's distance over the stop's. */
  minRewardRisk: 1.5,
  /** p (the limit before the stop) over m = d_stop / (d_stop + d_limit). */
  edgeMin: 0.08,
  /** Risk at most a quarter of the Kelly stake of the equity at p and R (and never more than `riskPerTradeFrac`). */
  kellyFraction: 0.25,
  /** An immediate deal's worst acceptable level may be at most this share of its stop distance beyond the touch. */
  maxSlippageFrac: 0.1,
  /** A working order lives at least 5 minutes and at most 24 hours (good-till-date). */
  minWorkingMs: 5 * M, maxWorkingMs: 24 * H,
  /** No open from 5 minutes before to 2 minutes after a listed release; a working order may not rest into one. */
  blackoutLeadMs: 5 * M, blackoutTrailMs: 2 * M,
  /** No open, and no working order alive, from Friday 20:00 UTC to Sunday 22:00 UTC. */
  weekendFromFriUtcHour: 20, weekendToSunUtcHour: 22,
  /** A position the server closes itself once it is this old. */
  maxHoldMs: 5 * DAY,
  /** Trading requests (opens, closes, amends, cancels) a rolling minute, at most. */
  maxOrdersPerMinute: 3,
  /** Category E needs a release within 72 hours ahead; R one within 24 hours behind. */
  eventAheadMs: 72 * H, eventBehindMs: 24 * H,
  /** A size has at most two decimals (IG's spread-bet stakes: £0.50, £1.25 a point). */
  sizeDecimals: 2,
  /** An order whose answer is still pending or unknown blocks a new open in its market for this long (2026-10-29 audit). */
  pendingBlockMs: 2 * H,
  /**
   * A close is IG's LIMIT fill-or-kill at the exit touch less this much (2026-10-29 audit: every whitelisted market's
   * `marketOrderPreference` is AVAILABLE_DEFAULT_OFF on the demo spread-bet account, so a MARKET close may be refused):
   * the larger of three spreads and this share of the price, rounded outward to a whole point.
   */
  closeSpreads: 3, closeMinFrac: 0.0005,
} as const;

/**
 * The release list (`agents/cb_releases.ts`) stops at 2026-12-31. Past this instant the blackout would silently stop, so
 * no open is taken until a migration-and-code change extends the list (2026-10-29 audit).
 */
export const IGBOT_CALENDAR_UNTIL_MS = Date.parse("2027-01-01T00:00:00Z");

/** The release kinds the calendar lists (CPI, NFP, FOMC, ECB, BoE: `agents/cb_releases.ts`, frozen to 2026-12-31). */
export const IGBOT_RELEASE_MS: readonly number[] = CB_RELEASES.map(([t]) => Date.parse(t));

export type Direction = "BUY" | "SELL";
export type Refusal = { rule: string; why: string };
const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const EPS = 1e-9;

/** A dealing rule as IG states it: points, or a percentage of the level. */
export type DealingRule = { unit: "POINTS" | "PERCENTAGE"; value: number } | null;
export const rulePoints = (r: DealingRule, level: number): number => !r ? 0 : r.unit === "PERCENTAGE" ? (r.value / 100) * level : r.value;

/** A market as the rules read it (`exec.ts`'s `marketOf` builds it from `GET /markets/{epic}`). */
export type IgMarket = {
  epic: string; name: string; type: string; expiry: string; status: string; bid: number | null; offer: number | null;
  minDealSize: number; minGsDistance: DealingRule; gsPremium: number; gbp: boolean; updateTime: string | null;
  /** IG's `minNormalStopOrLimitDistance` (binds the limit) and `maxStopOrLimitDistance` (binds both); null when unread. */
  minLimitDistance?: DealingRule; maxStopLimitDistance?: DealingRule;
  /** The day's range so far as IG's snapshot gives it (the agent's yardstick for a stop beyond the day's noise). */
  dayHigh?: number | null; dayLow?: number | null;
};

/** An open position as IG lists it (`GET /positions`). */
export type IgPosition = {
  dealId: string; dealReference: string | null; epic: string; direction: Direction; size: number; level: number;
  stopLevel: number | null; limitLevel: number | null; guaranteed: boolean; premium: number; createdMs: number | null; bid: number | null; offer: number | null;
  /** The market's status as `GET /positions` reports it (`market.marketStatus`), when it does. */
  marketStatus?: string | null;
};
/** A working order as IG lists it (`GET /workingorders`). */
export type IgWorkingOrder = {
  dealId: string; epic: string; direction: Direction; size: number; level: number; type: string; goodTillMs: number | null;
  guaranteed: boolean; stopDistance: number | null; limitDistance: number | null; premium: number;
  dealReference?: string | null;
};

const sign = (d: Direction) => (d === "BUY" ? 1 : -1);

/** A position's risk at its stop: what is still lost if the stop triggers, plus the premium; 0 under a stop past entry. */
export function positionRisk(p: Pick<IgPosition, "direction" | "size" | "level" | "stopLevel" | "premium">): number {
  if (p.stopLevel === null) return Infinity;
  const lossPts = Math.max(0, sign(p.direction) * (p.level - p.stopLevel));
  return r2(p.size * (lossPts + p.premium));
}
/** A working order's risk at its stop. */
export const workingRisk = (w: Pick<IgWorkingOrder, "size" | "stopDistance" | "premium">): number =>
  w.stopDistance === null ? Infinity : r2(w.size * (w.stopDistance + w.premium));
/** A position marked at the side it would close into (a buy at the bid). */
export function positionUpl(p: Pick<IgPosition, "direction" | "size" | "level" | "bid" | "offer">): number | null {
  const mark = p.direction === "BUY" ? p.bid : p.offer;
  return mark === null ? null : r2(sign(p.direction) * p.size * (mark - p.level));
}

/** The book: the account's equity against its start and the day's open, and what is open at its stops. */
export type Book = {
  budgetGbp: number; equityGbp: number | null; startEquityGbp: number | null; dayOpenEquityGbp: number | null;
  totalPnlGbp: number | null; dayPnlGbp: number | null; openRiskGbp: number; notionalGbp: number; openCount: number; openEpics: string[];
};
export function bookOf(p: {
  budgetGbp: number; equityGbp: number | null; startEquityGbp: number | null; dayOpenEquityGbp: number | null;
  positions: IgPosition[]; working: IgWorkingOrder[];
}): Book {
  const risk = p.positions.reduce((s, x) => s + positionRisk(x), 0) + p.working.reduce((s, w) => s + workingRisk(w), 0);
  const notional = p.positions.reduce((s, x) => s + x.size * x.level, 0) + p.working.reduce((s, w) => s + w.size * w.level, 0);
  const pnl = (a: number | null, b: number | null) => (a === null || b === null ? null : r2(a - b));
  return {
    budgetGbp: p.budgetGbp, equityGbp: p.equityGbp, startEquityGbp: p.startEquityGbp, dayOpenEquityGbp: p.dayOpenEquityGbp,
    totalPnlGbp: pnl(p.equityGbp, p.startEquityGbp), dayPnlGbp: pnl(p.equityGbp, p.dayOpenEquityGbp),
    openRiskGbp: r2(risk), notionalGbp: r2(notional), openCount: p.positions.length + p.working.length,
    openEpics: [...new Set([...p.positions.map((x) => x.epic), ...p.working.map((w) => w.epic)])].sort(),
  };
}

/** The listed release whose window [T − lead, T + trail] holds `t`, or null. */
export function releaseAt(t: number, releases: readonly number[] = IGBOT_RELEASE_MS): number | null {
  for (const r of releases) if (t >= r - IGBOT_RULES.blackoutLeadMs && t <= r + IGBOT_RULES.blackoutTrailMs) return r;
  return null;
}
/** The first release whose window meets [from, to], or null (a working order may not rest into one). */
export function releaseBetween(from: number, to: number, releases: readonly number[] = IGBOT_RELEASE_MS): number | null {
  for (const r of releases) if (r - IGBOT_RULES.blackoutLeadMs <= to && r + IGBOT_RULES.blackoutTrailMs >= from) return r;
  return null;
}
/** Whether `t` is in the weekend window (Friday 20:00 UTC to Sunday 22:00 UTC). */
export function inWeekend(t: number): boolean {
  const d = new Date(t), dow = d.getUTCDay(), h = d.getUTCHours();
  return (dow === 5 && h >= IGBOT_RULES.weekendFromFriUtcHour) || dow === 6 || (dow === 0 && h < IGBOT_RULES.weekendToSunUtcHour);
}
/** The weekend window's next start at or after `t` (a working order must end before it). */
export function nextWeekendStart(t: number): number {
  const d = new Date(t);
  const daysToFri = (5 - d.getUTCDay() + 7) % 7;
  const fri = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysToFri, IGBOT_RULES.weekendFromFriUtcHour);
  return fri >= t ? fri : fri + 7 * DAY;
}

/** The bracket's geometry from its levels: distances in points, R, the driftless baseline m, and Kelly at p. */
export function bracketOf(dir: Direction, level: number, stop: number, limit: number, p: number | null) {
  const dStop = sign(dir) * (level - stop), dLimit = sign(dir) * (limit - level);
  const ok = dStop > 0 && dLimit > 0;
  const R = ok ? dLimit / dStop : 0, m = ok ? dStop / (dStop + dLimit) : 1;
  const kelly = ok && p !== null ? p - (1 - p) / R : null;
  return { ok, dStop: r4(dStop), dLimit: r4(dLimit), R: r4(R), m: r4(m), kelly: kelly === null ? null : r4(kelly) };
}

export type OpenRequest = {
  category: "E" | "N" | "R"; epic: string; direction: Direction; size: number; level: number; stopLevel: number; limitLevel: number;
  p: number; eventAt: string | null; sources: string[]; entry: "market" | "limit" | "stop"; goodTillMs: number | null;
};
export type Gates = {
  mode: "dry_run" | "demo"; armed: boolean; globalPause: boolean; credsProblem: string | null; equityRead: boolean;
  dayStopped: boolean; totalStopped: boolean;
  /** A position or working order in the account that the bot did not place: the account's equity is then not its book. */
  foreign?: string | null;
};

/** Why the server would send nothing now (the order rules aside): an open needs every gate, a close every gate but the stops. */
export function gateRefusals(g: Gates, kind: "open" | "close" | "amend" | "cancel"): Refusal[] {
  const out: Refusal[] = [];
  if (g.globalPause && kind !== "cancel") out.push({ rule: "global_pause", why: "the project's global pause is on: nothing is sent but cancels" });
  if (g.mode === "demo" && !g.armed) out.push({ rule: "armed", why: "the demo path is not armed" });
  if (g.credsProblem) out.push({ rule: "credentials", why: g.credsProblem });
  if (kind === "open") {
    if (!g.equityRead && g.mode === "demo") out.push({ rule: "account", why: "the account's equity could not be read: no new open on a guess" });
    if (g.totalStopped) out.push({ rule: "total_stop", why: "the total stop was reached: close-only to the end of the test" });
    if (g.dayStopped) out.push({ rule: "day_stop", why: "the day stop was reached: no new open until 00:00 UTC" });
    if (g.foreign) out.push({ rule: "account_shared", why: g.foreign });
  }
  return out;
}

/**
 * Every rule an open breaks, given the book, the market as IG has it, the whitelist, today's and this minute's orders,
 * and the clock. Returns the refusals and, when there are none, the bracket's numbers for the order row.
 */
export function openRefusals(p: {
  req: OpenRequest; market: IgMarket | null; book: Book; whitelist: string[]; nowMs: number;
  ordersToday: number; maxOrdersDay: number; ordersLastMinute: number; releases?: readonly number[];
  /** Markets where an order of the bot is still pending or unknown (`pendingBlockMs`). */
  pendingEpics?: readonly string[];
  /** The release list's last covered instant (`IGBOT_CALENDAR_UNTIL_MS`). */
  calendarUntilMs?: number;
}): { refusals: Refusal[]; checks: Record<string, unknown> } {
  const { req, market: m, book: b } = p, R = IGBOT_RULES, out: Refusal[] = [];
  const releases = p.releases ?? IGBOT_RELEASE_MS;
  if (!p.whitelist.includes(req.epic)) out.push({ rule: "instrument", why: `${req.epic} is not on the bot's list of instruments` });
  if (p.ordersToday >= p.maxOrdersDay) out.push({ rule: "orders_day", why: `${p.ordersToday} orders today, at most ${p.maxOrdersDay}` });
  if (p.ordersLastMinute >= R.maxOrdersPerMinute) out.push({ rule: "orders_minute", why: `${p.ordersLastMinute} orders in the last minute, at most ${R.maxOrdersPerMinute}` });
  if (!(req.size > 0) || Math.abs(Math.round(req.size * 10 ** R.sizeDecimals) - req.size * 10 ** R.sizeDecimals) > 1e-6) {
    out.push({ rule: "size", why: `a size is over 0 with at most ${R.sizeDecimals} decimals (£ a point)` });
  }
  // The market as IG has it now.
  if (!m) out.push({ rule: "market", why: "IG's market could not be read" });
  else {
    if (m.status !== "TRADEABLE") out.push({ rule: "market", why: `the market is ${m.status}, not TRADEABLE` });
    if (m.expiry !== "DFB") out.push({ rule: "market", why: `the bot trades daily funded bets only (expiry DFB), not ${m.expiry}` });
    if (!m.gbp) out.push({ rule: "market", why: "the market does not take a £ stake" });
    if (req.size < m.minDealSize - EPS) out.push({ rule: "size", why: `IG's minimum is ${m.minDealSize} a point` });
    if (m.bid === null || m.offer === null) out.push({ rule: "market", why: "no bid or offer" });
  }
  // The bracket.
  const br = bracketOf(req.direction, req.level, req.stopLevel, req.limitLevel, req.p);
  const touch = m ? (req.direction === "BUY" ? m.offer : m.bid) : null;
  if (!br.ok) out.push({ rule: "bracket", why: req.direction === "BUY" ? "a buy needs stop < level < limit" : "a sell needs limit < level < stop" });
  else {
    if (br.R < R.minRewardRisk - EPS) out.push({ rule: "reward_risk", why: `the limit is ${br.R.toFixed(2)} times the stop's distance, at least ${R.minRewardRisk}` });
    if (req.p - br.m < R.edgeMin - EPS) {
      out.push({ rule: "edge", why: `p ${req.p} is ${((req.p - br.m) * 100).toFixed(1)} points over the bracket's driftless m ${br.m}, at least ${R.edgeMin * 100}` });
    }
    if (m) {
      // IG measures the guaranteed distance from the deal's level. An immediate deal fills at the touch or better, so its
      // stop is measured from the touch, never from the worst fill accepted (2026-10-29 audit: a level beyond the touch
      // passed here and IG would refuse the deal).
      const from = req.entry === "market" && touch !== null ? touch : req.level;
      const dIg = r4(sign(req.direction) * (from - req.stopLevel));
      const minGs = rulePoints(m.minGsDistance, from);
      if (dIg < minGs - EPS) out.push({ rule: "stop_distance", why: `the guaranteed stop is ${dIg} points from ${req.entry === "market" ? "the touch" : "the level"}, IG's minimum is ${r4(minGs)}` });
      const minLim = rulePoints(m.minLimitDistance ?? null, req.level);
      if (br.dLimit < minLim - EPS) out.push({ rule: "limit_distance", why: `the limit is ${br.dLimit} points away, IG's minimum is ${r4(minLim)}` });
      const maxD = m.maxStopLimitDistance ? rulePoints(m.maxStopLimitDistance, req.level) : Infinity;
      if (br.dStop > maxD + EPS || br.dLimit > maxD + EPS) out.push({ rule: "limit_distance", why: `IG's maximum stop or limit distance is ${r4(maxD)} points` });
    }
    if (touch !== null) {
      const s = sign(req.direction);
      if (req.entry === "market") {
        // The level is the worst fill accepted (IG's LIMIT fill-or-kill): at or beyond the touch, by at most a tenth of the stop.
        if (s * (req.level - touch) < -EPS) out.push({ rule: "level", why: `an immediate ${req.direction.toLowerCase()} at ${req.level} cannot fill: the ${req.direction === "BUY" ? "offer" : "bid"} is ${touch}` });
        else if (s * (req.level - touch) > R.maxSlippageFrac * br.dStop + EPS) {
          out.push({ rule: "slippage", why: `the level is ${r4(s * (req.level - touch))} points beyond the touch, at most ${r4(R.maxSlippageFrac * br.dStop)} (a tenth of the stop)` });
        }
        // The stop must be on the far side of where the deal closes from (a buy's stop under the bid).
        const exit = req.direction === "BUY" ? m?.bid ?? null : m?.offer ?? null;
        if (exit !== null && s * (exit - req.stopLevel) <= EPS) out.push({ rule: "bracket", why: "the stop is already through the price the position would close at" });
      } else {
        const below = req.direction === "BUY" ? req.entry === "limit" : req.entry === "stop";
        if (below ? !(req.level < touch - EPS) : !(req.level > touch + EPS)) {
          out.push({ rule: "level", why: `a ${req.entry} ${req.direction.toLowerCase()} rests ${below ? "below" : "above"} the ${req.direction === "BUY" ? "offer" : "bid"} ${touch}` });
        }
      }
    }
  }
  // Size: risk at the stop, the premium included, against 1 % of the budget and a quarter Kelly of the equity.
  const premium = m?.gsPremium ?? 0;
  const risk = br.ok ? r2(req.size * (br.dStop + premium)) : Infinity;
  // The bot's own equity: its notional budget plus what it has made or lost (the demo account itself holds far more).
  const equity = b.budgetGbp + (b.totalPnlGbp ?? 0);
  const kellyCap = br.kelly !== null && br.kelly > 0 ? r2(R.kellyFraction * br.kelly * equity) : 0;
  const riskCap = r2(Math.min(R.riskPerTradeFrac * b.budgetGbp, kellyCap));
  if (br.ok && risk > riskCap + EPS) {
    out.push({ rule: "risk", why: `£${risk.toFixed(2)} at the stop (premium included), at most £${riskCap.toFixed(2)}: the smaller of ${R.riskPerTradeFrac * 100} % of the budget and a quarter Kelly (${br.kelly ?? "n/a"}) of the equity` });
  }
  if (br.ok && b.openRiskGbp + risk > R.maxTotalRiskFrac * b.budgetGbp + EPS) {
    out.push({ rule: "total_risk", why: `£${r2(b.openRiskGbp + risk).toFixed(2)} would be at the stops, at most £${r2(R.maxTotalRiskFrac * b.budgetGbp).toFixed(2)}` });
  }
  if (b.openCount >= R.maxOpen) out.push({ rule: "positions", why: `${b.openCount} positions and working orders open, at most ${R.maxOpen}` });
  if (b.openEpics.includes(req.epic)) out.push({ rule: "one_per_market", why: "the bot already holds or rests something in this market: no adding, averaging down or hedging" });
  const notional = r2(b.notionalGbp + req.size * req.level);
  if (notional > R.maxNotionalMult * b.budgetGbp + EPS) out.push({ rule: "notional", why: `£${notional.toFixed(0)} of notional, at most ${R.maxNotionalMult} times the budget` });
  // Time: the release windows, the weekend, a working order's life.
  const rel = releaseAt(p.nowMs, releases);
  if (rel !== null) out.push({ rule: "blackout", why: `a listed release at ${new Date(rel).toISOString()}: no open from 5 minutes before to 2 minutes after` });
  if (inWeekend(p.nowMs)) out.push({ rule: "weekend", why: "no open from Friday 20:00 UTC to Sunday 22:00 UTC" });
  if (req.entry !== "market") {
    const life = req.goodTillMs === null ? NaN : req.goodTillMs - p.nowMs;
    if (!(life >= R.minWorkingMs && life <= R.maxWorkingMs)) out.push({ rule: "good_till", why: "a working order ends 5 minutes to 24 hours ahead (`good_till`)" });
    else {
      const into = releaseBetween(p.nowMs, req.goodTillMs!, releases);
      if (into !== null) out.push({ rule: "blackout", why: `a working order may not rest into the release at ${new Date(into).toISOString()}: end it 5 minutes before` });
      if (req.goodTillMs! > nextWeekendStart(p.nowMs)) out.push({ rule: "weekend", why: "a working order ends before Friday 20:00 UTC" });
    }
  }
  if ((p.pendingEpics ?? []).includes(req.epic)) {
    out.push({ rule: "pending_order", why: "an earlier order of the bot in this market has no answer from IG yet: read ?action=account, never send it again under a new id" });
  }
  if (p.nowMs >= (p.calendarUntilMs ?? IGBOT_CALENDAR_UNTIL_MS)) out.push({ rule: "calendar", why: "the release list ends 2026-12-31: no open until it is extended" });
  // The category's own terms: E and R name a LISTED release (the pre-registration's §2 and the prompt say so; until the
  // 2026-10-29 audit any time passed), to the minute.
  const ev = req.eventAt === null ? null : Date.parse(req.eventAt);
  const listed = ev !== null && releases.some((t) => Math.abs(t - ev) < 60e3);
  if (req.category === "E" && !(listed && ev! > p.nowMs && ev! <= p.nowMs + R.eventAheadMs)) {
    out.push({ rule: "category", why: "category E names the listed release it is positioned for (`event_at`, a time from ?action=calendar, within 72 hours ahead)" });
  }
  if (req.category === "R" && !(listed && ev! <= p.nowMs && ev! >= p.nowMs - R.eventBehindMs)) {
    out.push({ rule: "category", why: "category R names the listed release it trades the reaction to (`event_at`, a time from ?action=calendar, within 24 hours behind)" });
  }
  if (!req.sources.length) out.push({ rule: "sources", why: "an open links at least one source" });
  return {
    refusals: out,
    checks: {
      touch, bid: m?.bid ?? null, offer: m?.offer ?? null, d_stop: br.dStop, d_limit: br.dLimit, reward_risk: br.R, m_base: br.m, edge: r4(req.p - br.m),
      kelly: br.kelly, premium, risk_gbp: Number.isFinite(risk) ? risk : null, risk_cap_gbp: riskCap, open_risk_gbp: b.openRiskGbp, notional_gbp: notional,
    },
  };
}

/** An amend: the stop stays guaranteed and may only move to reduce the risk; a limit stays on the profit side of the price. */
export function amendRefusals(p: {
  pos: IgPosition; stopLevel: number | null; limitLevel: number | null; market: IgMarket | null;
}): Refusal[] {
  const { pos } = p, out: Refusal[] = [], s = sign(pos.direction);
  if (p.stopLevel === null && p.limitLevel === null) return [{ rule: "amend", why: "an amend names a new stop_level, a new limit_level or both" }];
  const exit = pos.direction === "BUY" ? p.market?.bid ?? pos.bid : p.market?.offer ?? pos.offer;
  if (p.stopLevel !== null) {
    if (pos.stopLevel === null || s * (p.stopLevel - pos.stopLevel) < -EPS) out.push({ rule: "stop_wider", why: "a stop may only move toward the price (less risk), never away" });
    if (exit === null) out.push({ rule: "market", why: "IG's price could not be read" });
    else {
      if (s * (exit - p.stopLevel) <= EPS) out.push({ rule: "stop_through", why: `a stop at ${p.stopLevel} is already through the price ${exit}` });
      const minGs = p.market ? rulePoints(p.market.minGsDistance, exit) : 0;
      if (s * (exit - p.stopLevel) < minGs - EPS) out.push({ rule: "stop_distance", why: `IG's minimum guaranteed distance from the price is ${r4(minGs)}` });
    }
  }
  if (p.limitLevel !== null && exit !== null && s * (p.limitLevel - exit) <= EPS) {
    out.push({ rule: "limit_through", why: `a limit at ${p.limitLevel} is not on the profit side of the price ${exit}: close instead` });
  }
  return out;
}

/** A close: of a position the bot holds, at most its size. */
export function closeRefusals(pos: IgPosition | null, size: number | null): Refusal[] {
  if (!pos) return [{ rule: "not_held", why: "no open position of the bot with that deal_id" }];
  if (size !== null && !(size > 0 && size <= pos.size + EPS)) return [{ rule: "size", why: `a close is over 0 and at most the position's ${pos.size}` }];
  return [];
}

/**
 * The level of a close sent as IG's LIMIT fill-or-kill: the exit touch (a buy closes into the bid) less the larger of
 * `closeSpreads` spreads and `closeMinFrac` of the price, rounded outward to a whole point. Null without a two-sided price.
 */
export function closeLimitLevel(pos: Pick<IgPosition, "direction" | "bid" | "offer">): number | null {
  if (pos.bid === null || pos.offer === null || !(pos.offer >= pos.bid)) return null;
  const tol = Math.max(IGBOT_RULES.closeSpreads * (pos.offer - pos.bid), IGBOT_RULES.closeMinFrac * pos.bid);
  return pos.direction === "BUY" ? Math.floor(pos.bid - tol) : Math.ceil(pos.offer + tol);
}

/** The positions the server closes itself: older than `maxHoldMs`. */
export const overdue = (positions: IgPosition[], nowMs: number): IgPosition[] =>
  positions.filter((p) => p.createdMs !== null && nowMs - p.createdMs >= IGBOT_RULES.maxHoldMs);

/** The stops' latches (the prereg's §3): the day's holds until 00:00 UTC, the total's to the end. Live only in demo. */
export function stopLatches(p: {
  book: Book; dayStopGbp: number; totalStopGbp: number; nowMs: number; state: { dayStop?: { day: string } | null; totalStop?: { at: string } | null };
}): { dayStop: { day: string; at: string } | null; totalStop: { at: string } | null; dayStopped: boolean; totalStopped: boolean } {
  const today = new Date(p.nowMs).toISOString().slice(0, 10), at = new Date(p.nowMs).toISOString();
  let dayStop = (p.state.dayStop ?? null) as { day: string; at: string } | null, totalStop = p.state.totalStop ?? null;
  if (p.book.dayPnlGbp !== null && p.book.dayPnlGbp <= -p.dayStopGbp && dayStop?.day !== today) dayStop = { day: today, at };
  if (p.book.totalPnlGbp !== null && p.book.totalPnlGbp <= -p.totalStopGbp && !totalStop) totalStop = { at };
  return { dayStop, totalStop, dayStopped: dayStop?.day === today, totalStopped: !!totalStop };
}

/** IG's good-till-date as its working-order call takes it: `yyyy/mm/dd hh:mm:ss`, UTC. */
export function igGoodTill(ms: number): string {
  const d = new Date(ms), p2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}/${p2(d.getUTCMonth() + 1)}/${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
}
