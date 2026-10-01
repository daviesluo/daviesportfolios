// Polymarket's order path: the executor, rule-independent, built INERT on 2026-10-01 during RW-C (Option 1 of
// docs/agents/reviews/2026-10-01-polymarket-live-prestudy.md, on Davies' word; the design is
// docs/agents/reviews/2026-10-01-polymarket-order-path.md, migration 0074).
//
// WHAT RUNS NOW: a dry-run, every minute, from Supabase's Ireland region (`agents?action=pmlive`). It records the
// runtime's `SB_REGION`, runs every gate, and writes the orders it WOULD send or cancel, on two markets a UTC day that
// are outside RW's universe. It never loads the private key: an order's id is its EIP-712 hash, which needs none. It
// reads and writes only its own tables (`PM_LIVE_TABLES`), the global pause in `agent_risk` and its lease. Nothing of
// RW's or RW-C's (`pm_rw_*`, `pm_rwc_*`) is read; its markets are chosen by its own rule, never RW's ranking.
//
// WHAT IT DOES, each turn, in order:
//   1. The day's markets: one standard and one neg-risk market that Gamma shows accepting orders, with two tokens and a
//      two-sided book, whose daily reward rate in `/rewards/markets/current` is under $10 or absent — taken in Gamma's
//      order by 24-hour volume, the first of each kind. Chosen once a UTC day; a kind not found is tried again every
//      five minutes. RW's universe is $10 and over, so these markets are never RW's or RW-C's.
//   2. What the venue says: each market's book, the geoblock's answer for this runtime's address, the account's
//      closed-only flag and what it holds of each token (L2 GETs); in live mode every open order read back by its hash
//      and its trades until CONFIRMED or FAILED.
//   3. The gates, in this order (`gates`): `agent_risk.global_pause` cancels everything and places nothing; the path's
//      own `live_confirmed_at` (live only: cleared, nothing that opens); the runtime's region (eu-west-1); the geoblock
//      (country IE); the account's closed-only flag; Davies' Ireland attestation; the inventory read; the loss stops.
//      While any of them stops opening, the path is close-only exactly as RW-NEXT Part 4 words it (`closeOnly`).
//   4. The quotes: the rule's intents (`placeholderQuotes` now: join the touch at the minimum size), close-only when it
//      must be, then the caps and the governor; each slot (market, token, side) holds at most one order.
//   5. The orders: a slot whose order is right is left alone; one that must change is cancelled and its replacement
//      sent only once the cancel is READ BACK; a missing one is sent. In live mode every order is written `pending`,
//      keyed by its hash, before the POST; a 4xx with an error is a refusal, a 5xx or a lost reply is unknown and the
//      row stays pending until a read-back by hash settles it; one the venue shows nowhere stays pending for a person.
//
// THE THREE LOCKS on a live order, each enough alone: `PM_ORDER_SENDS_ENABLED` (false: `pmOrderCall` sends no POST or
// DELETE), the key (this phase never loads it, so nothing can be signed), and `dry_run` (true, from 0074).
//
// A TURN'S TIME: it shares the one-minute cron job's batch, so it stays inside its call's 58 s and its 55 s lease. Every
// venue request gives up after 5 s; no selection read starts later than 40 s into the turn and no order is sent later
// than 40 s, and a live order is sent only while the turn still holds its lease, renewed once half of it is gone (PR5's
// executor's rule, `quotes_live.ts`).

import {
  asTickSize, buildOrder, newSalt, orderProblems, PM_GTD_EARLY_S, PM_ORDER_REGION, type PmOpenOrder, type PmOrder, type PmReply,
  type PmSendReply, type PmSigner, type PmTickSize, type PmTrade, type PmVenue,
} from "../_shared/polymarket_orders.ts";
import type { Db } from "./db.ts";

const M = 60e3, DAY = 86400e3;

/** The tables this path owns. It also reads `agent_risk` (the global pause) and holds its lease in `agent_locks`. */
export const PM_LIVE_TABLES = ["pm_live_config", "pm_live_markets", "pm_live_orders", "pm_live_fills", "pm_live_events", "pm_live_state"] as const;
export const PM_LIVE_DB_TABLES: readonly string[] = [...PM_LIVE_TABLES, "agent_risk", "agent_locks"];

// The code's ceilings (RW-NEXT Part 3.1 and the pre-study): a config row may lower each, never raise it.
export const PM_LIVE_CAP_TOTAL_USD = 300;
export const PM_LIVE_CAP_MARKET_USD = 60;
export const PM_LIVE_LOSS_DAY_USD = 25;
export const PM_LIVE_LOSS_TOTAL_USD = 75;
export const PM_LIVE_MAX_POSTS_DAY = 6000;
/**
 * A GTD order's effective life, in seconds: it is sent with expiration now + 60 + this. The venue refuses an expiration
 * less than 3 minutes ahead, so the floor is 180, not the docs' "about two minutes": an order sent as late as
 * `PM_LIVE_SEND_UNTIL_MS` into its turn, and answered only at its timeout, still reaches the venue with 3 minutes left.
 */
export const PM_LIVE_LIFETIME_S = { min: 180, max: 600 } as const;
/** Each venue request gives up after this long (the action hands it to the client). */
export const PM_LIVE_TIMEOUT_MS = 5e3;
/**
 * No selection read starts later than this into a turn. The reward listing alone was 39 pages of up to 500 markets
 * (18,600 rows, 6.5 MB) on 2026-10-01, 36 s from a container behind Cloudflare's Atlanta edge; from eu-west-1, next to
 * Polymarket's eu-west-2, it should be quicker, and each selection's `ms` records what it took.
 */
export const PM_LIVE_SELECT_UNTIL_MS = 40e3;
/** No order is sent later than this into a turn: it reaches the venue with its 3 minutes, and the turn ends inside its lease. */
export const PM_LIVE_SEND_UNTIL_MS = 40e3;
/** A resting order is replaced when less than this is left of its effective life (its expiration less the venue's minute). */
export const PM_LIVE_REFRESH_S = 90;
/** RW's universe is a daily reward rate of $10 and over: this path quotes only below it. */
export const PM_LIVE_REWARD_RATE_MAX = 10;
const GAMMA_PAGES = 5, BOOK_READS = 40, REWARD_PAGES = 200, SELECT_RETRY_MS = 5 * M;
/** The turn's lease on `agent_locks` (pm-live), as the other minute loops hold theirs. */
export const PM_LIVE_LEASE_MS = 55e3;
const PENDING_GRACE_MS = 60e3;
/** Blocked completely, on the frontend and the API (api-reference/geoblock): nothing may be placed from there, not even a sell. */
const OFAC_COUNTRIES = new Set(["IR", "SY", "CU", "KP"]);
const OFAC_REGIONS = new Set(["UA-43", "UA-14", "UA-09"]);

export type PmLiveMode = "dry_run" | "live";
export type PmLiveConfig = {
  dry_run: boolean; live_confirmed_at: string | null; ireland_attested_at: string | null; ireland_until: string | null;
  cap_total_usd: number | string; cap_market_usd: number | string; loss_day_usd: number | string; loss_total_usd: number | string;
  max_posts_day: number | string; gtd_lifetime_s: number | string;
};
export type PmMarketRow = {
  day: string; kind: "standard" | "neg_risk"; cond: string; yes_token: string; no_token: string; neg_risk: boolean;
  tick: number | string; min_size: number | string; reward_rate: number | string | null; rank: number; question: string | null;
};
export type PmOrderRow = {
  id: number; ts: string; mode: PmLiveMode; cond: string; token: string; outcome: "yes" | "no"; side: "BUY" | "SELL";
  price: number | string; size: number | string; order_type: "GTD"; post_only: boolean; expiration: number | string; neg_risk: boolean;
  hash: string; state: "pending" | "live" | "filled" | "cancelled" | "expired" | "rejected"; size_matched: number | string;
  gate: "open" | "reduce"; reason: string | null; book_seen: unknown; request: unknown; response: unknown;
  cancel_requested_at: string | null; cancel_gate: string | null; cancel_reason: string | null; filled_at: string | null; cancelled_at: string | null;
};
type FillRow = { trade_id: string; hash: string; cond: string; token: string; side: "BUY" | "SELL"; price: number | string; size: number | string; status: string; match_time: string | null };

const iso = (ms: number) => new Date(ms).toISOString();
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const enc = encodeURIComponent;

// ------------------------------------------------------------------ pure rules, each pinned in pm_live.test.ts

/** The config's caps, each at most the code's ceiling; the GTD lifetime inside its bounds. */
export function effectiveLimits(c: PmLiveConfig) {
  const lower = (v: number | string, ceiling: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.min(n, ceiling) : ceiling; };
  const life = Number(c.gtd_lifetime_s);
  return {
    capTotal: lower(c.cap_total_usd, PM_LIVE_CAP_TOTAL_USD),
    capMarket: lower(c.cap_market_usd, PM_LIVE_CAP_MARKET_USD),
    lossDay: lower(c.loss_day_usd, PM_LIVE_LOSS_DAY_USD),
    lossTotal: lower(c.loss_total_usd, PM_LIVE_LOSS_TOTAL_USD),
    maxPosts: Math.floor(lower(c.max_posts_day, PM_LIVE_MAX_POSTS_DAY)),
    lifetimeS: Number.isFinite(life) ? Math.min(PM_LIVE_LIFETIME_S.max, Math.max(PM_LIVE_LIFETIME_S.min, Math.floor(life))) : PM_LIVE_LIFETIME_S.min,
  };
}

/**
 * Davies' Ireland attestation is current from `ireland_attested_at` until `ireland_until`; with no `ireland_until` it
 * stands (his word, 2026-10-01: until he says otherwise). An unreadable timestamp is no attestation.
 */
export function attestationCurrent(c: Pick<PmLiveConfig, "ireland_attested_at" | "ireland_until">, now: number): boolean {
  const at = c.ireland_attested_at ? Date.parse(c.ireland_attested_at) : NaN;
  if (!Number.isFinite(at) || at > now) return false;
  if (c.ireland_until == null) return true;
  const until = Date.parse(c.ireland_until);
  return Number.isFinite(until) && now < until;
}

export type GateInputs = {
  mode: PmLiveMode; globalPause: boolean; riskReadable: boolean; armed: boolean; sbRegion: string | null;
  geo: { ok: boolean; country: string | null; region: string | null; blocked: boolean | null };
  /** The account's closed-only flag; null when it could not be read. */
  closedOnly: boolean | null;
  attested: boolean; inventoryReadable: boolean; lossDay: boolean; lossTotal: boolean;
};
export type Gates = {
  /** May an order that opens or enlarges a position be placed? */
  open: boolean;
  /** May a sell of tokens held be placed? */
  reduce: boolean;
  /** The global pause: cancel every open order, place nothing. */
  cancelAll: boolean;
  openBlockedBy: string | null;
  reduceBlockedBy: string | null;
  verdicts: Record<string, boolean | null>;
};
/** The order the gates are listed and reported in: the first that fails is the one that decided. */
export const PM_OPEN_GATES = ["global_pause", "risk_readable", "armed", "region", "geoblock", "closed_only", "attestation", "inventory", "loss_day", "loss_total"] as const;

/**
 * Every gate's verdict, and what they allow together. Opening needs all of them. Reducing (a sell of what is held, which
 * the UK's close-only rule and the account's closed-only mode both allow) needs no global pause, the region (every POST
 * leaves from eu-west-1 or not at all), a country the geoblock does not block completely, and the inventory read that
 * sizes it. `armed` is the live switch: in a dry-run it decides nothing, and the dry-run shows what live and armed would
 * send (PR5's dry-run did the same).
 */
export function gates(i: GateInputs): Gates {
  const v: Record<string, boolean | null> = {
    global_pause: !i.globalPause,
    risk_readable: i.riskReadable,
    armed: i.mode === "dry_run" ? null : i.armed,
    region: i.sbRegion === PM_ORDER_REGION,
    // From eu-west-1 the geoblock answered `blocked: true, country IE` (reference §6): it answers for polymarket.com's
    // frontend, where Ireland is close-only, while "the API itself is not restricted". So the gate is the country.
    geoblock: i.geo.ok && i.geo.country === "IE",
    closed_only: i.closedOnly === false,
    attestation: i.attested,
    inventory: i.inventoryReadable,
    loss_day: !i.lossDay,
    loss_total: !i.lossTotal,
  };
  const openBlockedBy = PM_OPEN_GATES.find((k) => v[k] === false) ?? null;
  const country = i.geo.country ?? "", region = i.geo.region ?? "";
  const ofac = i.geo.ok && (OFAC_COUNTRIES.has(country) || OFAC_REGIONS.has(`${country}-${region}`) || OFAC_REGIONS.has(region));
  const reduceBlockedBy = i.globalPause ? "global_pause" : !v.region ? "region" : ofac ? "geoblock" : !i.inventoryReadable ? "inventory" : null;
  return { open: !openBlockedBy, reduce: !reduceBlockedBy, cancelAll: i.globalPause, openBlockedBy, reduceBlockedBy, verdicts: v };
}

/** A book's touch and the market's trading constraints, as the order path reads them. */
export type PmBookNow = { bestBid: number; bestAsk: number; tick: PmTickSize; minSize: number; negRisk: boolean; at: string | null; hash: string | null };
/** GET /book as served, reduced to its touch; null unless it is two-sided with both prices inside [tick, 1 − tick]. */
export function bookNow(raw: unknown): PmBookNow | null {
  const b = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  if (!b) return null;
  const px = (xs: unknown) => (Array.isArray(xs) ? xs : [])
    .map((l) => ({ p: Number((l as Record<string, unknown>)?.price), s: Number((l as Record<string, unknown>)?.size) }))
    .filter((l) => Number.isFinite(l.p) && Number.isFinite(l.s) && l.s > 0 && l.p > 0 && l.p < 1).map((l) => l.p);
  const bids = px(b.bids), asks = px(b.asks);
  const tick = asTickSize(b.tick_size), minSize = Number(b.min_order_size);
  if (!tick || !(minSize > 0) || !bids.length || !asks.length) return null;
  const bestBid = Math.max(...bids), bestAsk = Math.min(...asks), t = Number(tick);
  if (!(bestBid < bestAsk) || bestBid < t - 1e-12 || bestAsk > 1 - t + 1e-12) return null;
  const ts = Number(b.timestamp);
  return { bestBid, bestAsk, tick, minSize, negRisk: b.neg_risk === true, at: Number.isFinite(ts) && ts > 0 ? iso(ts) : null, hash: typeof b.hash === "string" ? b.hash : null };
}

/** `x` on the tick, as a clean decimal: 1 − 0.53 is 0.47, not 0.47000000000000003. */
export function onTick(x: number, tick: PmTickSize): number {
  const decimals = tick.split(".")[1].length;
  return Number((Math.round(x / Number(tick)) * Number(tick)).toFixed(decimals));
}

/** One order the rule wants resting: on the market's YES or NO token. */
export type PmIntent = { outcome: "yes" | "no"; side: "BUY" | "SELL"; price: number; size: number };
export type PmQuoteInput = { market: PmMarketRow; book: PmBookNow; held: { yes: number; no: number } };
/** The pluggable quoting rule: a market's book and holdings in, the orders it wants resting out. */
export type PmQuoteRule = (m: PmQuoteInput) => PmIntent[];

/**
 * The PLACEHOLDER rule, for the plumbing only: join the touch at the market's minimum size, a bid as BUY YES at the best
 * bid and an ask as BUY NO at 1 − the best ask, re-priced when the touch moves. RW-NEXT's candidate plugs in here after
 * RW-C, under the live design; nothing about this rule is a strategy.
 */
export const placeholderQuotes: PmQuoteRule = ({ book }) => [
  { outcome: "yes", side: "BUY", price: book.bestBid, size: book.minSize },
  { outcome: "no", side: "BUY", price: onTick(1 - book.bestAsk, book.tick), size: book.minSize },
];

/** Down to the size's two decimals, through integers (a binary float like 19.99 × 100 is 1998.9999…). */
const floorSize = (x: number) => Math.floor(Math.round(x * 1e6) / 1e4 + 1e-9) / 100;

/**
 * Close-only, exactly as RW-NEXT Part 4 words it. No buy at all, so every quote that would open or enlarge a position on
 * either side is cancelled. A market may rest only a sell of tokens it holds, for at most what it holds: our bid (a BUY
 * YES at b) becomes a SELL of NO at 1 − b if NO is held, our ask (a BUY NO at 1 − a) a SELL of YES at a if YES is held,
 * and a sell the rule already wanted stays, capped at the holding. A flat market rests nothing. A sell under the
 * market's minimum size cannot be placed and is dropped.
 */
export function closeOnly(intents: PmIntent[], held: { yes: number; no: number }, book: Pick<PmBookNow, "tick" | "minSize">): PmIntent[] {
  const out: PmIntent[] = [];
  const left = { yes: Math.max(0, held.yes), no: Math.max(0, held.no) };
  for (const x of intents) {
    const sell: PmIntent | null = x.side === "SELL" ? x
      : x.outcome === "yes" ? { outcome: "no", side: "SELL", price: onTick(1 - x.price, book.tick), size: x.size }
      : { outcome: "yes", side: "SELL", price: onTick(1 - x.price, book.tick), size: x.size };
    if (out.some((o) => o.outcome === sell.outcome)) continue;                     // one sell per token
    const size = floorSize(Math.min(sell.size, left[sell.outcome]));
    if (!(size > 0) || size < book.minSize) continue;
    left[sell.outcome] -= size;
    out.push({ ...sell, size });
  }
  return out;
}

/** Would a post-only order at `price` take? A buy at or over the token's best ask, a sell at or under its best bid. */
export function crosses(x: Pick<PmIntent, "outcome" | "side" | "price">, b: Pick<PmBookNow, "bestBid" | "bestAsk">): boolean {
  // The NO book is the YES book's mirror: NO's best bid is 1 − YES's best ask, NO's best ask 1 − YES's best bid.
  const bid = x.outcome === "yes" ? b.bestBid : 1 - b.bestAsk, ask = x.outcome === "yes" ? b.bestAsk : 1 - b.bestBid;
  return x.side === "BUY" ? x.price >= ask - 1e-9 : x.price <= bid + 1e-9;
}

/** One trade's fill of one of our orders. */
export type PmFill = { token: string; side: "BUY" | "SELL"; price: number; size: number; ts: number };
/**
 * Each token's holding from CONFIRMED fills, at its average cost, and the P&L realised by its sells (all of it, and
 * today's). Fills only: a reconstruction of a balance is not a record (the working-with-davies skill).
 */
export function tokenBooks(fills: PmFill[], dayStart: number): Record<string, { held: number; avgCost: number; realised: number; realisedToday: number }> {
  const out: Record<string, { held: number; avgCost: number; realised: number; realisedToday: number }> = {};
  for (const f of [...fills].sort((a, b) => a.ts - b.ts)) {
    const t = (out[f.token] ??= { held: 0, avgCost: 0, realised: 0, realisedToday: 0 });
    if (f.side === "BUY") {
      t.avgCost = t.held + f.size > 0 ? (t.avgCost * t.held + f.price * f.size) / (t.held + f.size) : 0;
      t.held += f.size;
    } else {
      const q = Math.min(t.held, f.size), pnl = q * (f.price - t.avgCost);
      t.realised += pnl;
      if (f.ts >= dayStart) t.realisedToday += pnl;
      t.held = Math.max(0, Number((t.held - f.size).toPrecision(12)));
      if (t.held === 0) t.avgCost = 0;
    }
  }
  return out;
}

/** The day's and the run's P&L: realised plus every holding marked against its cost (all of it counts today: stricter). */
export function bookPnl(books: ReturnType<typeof tokenBooks>, marks: Record<string, number | null>): { day: number; total: number } {
  let day = 0, total = 0;
  for (const [token, t] of Object.entries(books)) {
    const m = marks[token];
    const unrealised = t.held > 0 && m != null ? t.held * (m - t.avgCost) : 0;
    day += t.realisedToday + unrealised;
    total += t.realised + unrealised;
  }
  return { day: Math.round(day * 1e8) / 1e8, total: Math.round(total * 1e8) / 1e8 };
}

/** A trade's status in the docs' words: the OpenAPI writes TRADE_STATUS_CONFIRMED, the clients and the lifecycle page CONFIRMED. */
export function tradeStatus(s: unknown): "MATCHED" | "MINED" | "CONFIRMED" | "RETRYING" | "FAILED" | null {
  const x = String(s ?? "").toUpperCase().replace(/^TRADE_STATUS_/, "");
  return x === "MATCHED" || x === "MINED" || x === "CONFIRMED" || x === "RETRYING" || x === "FAILED" ? x : null;
}

/** A market's daily reward rate as `/rewards/markets/current` lists it: the total, else native plus sponsored. */
export function rewardRate(r: Record<string, unknown>): number {
  const n = (x: unknown) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };
  return n(r.total_daily_rate) || n(r.native_daily_rate) + n(r.sponsored_daily_rate);
}

const jsonList = (v: unknown): unknown[] => {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string") return [];
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
};

/**
 * Gamma's market as a candidate, or null: accepting orders (`enableOrderBook`, `acceptingOrders`, not closed), two
 * tokens, a condition id, and a daily reward rate under $10 or none at all — outside RW's universe.
 */
export function candidateOf(m: Record<string, unknown>, rates: Map<string, number>): { cond: string; yes: string; no: string; negRisk: boolean; question: string; rate: number | null } | null {
  if (m.enableOrderBook !== true || m.acceptingOrders !== true || m.closed === true) return null;
  const toks = jsonList(m.clobTokenIds);
  if (toks.length !== 2 || toks.some((t) => typeof t !== "string" || !/^\d+$/.test(t))) return null;
  const cond = String(m.conditionId ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(cond)) return null;
  const rate = rates.get(cond) ?? null;
  if (rate != null && !(rate < PM_LIVE_REWARD_RATE_MAX)) return null;
  return { cond, yes: toks[0] as string, no: toks[1] as string, negRisk: m.negRisk === true, question: String(m.question ?? "").slice(0, 100), rate };
}

/** A clock in milliseconds and the instant on it after which no further read starts. */
export type PmDeadline = { clock: () => number; until: number };
const NO_DEADLINE: PmDeadline = { clock: () => 0, until: Infinity };
const pastDeadline = (dl: PmDeadline) => dl.clock() > dl.until;

/**
 * Every rewarded market's daily rate, from both listings (native and sponsored), every page; a market listed twice keeps
 * its larger. A listing not read to its end by the deadline is a failure, like an unreadable page.
 */
export async function rewardRates(venue: PmVenue, dl: PmDeadline = NO_DEADLINE): Promise<{ ok: boolean; rates: Map<string, number>; pages: number; error?: string }> {
  const rates = new Map<string, number>();
  let pages = 0;
  for (const sponsored of [false, true]) {
    let cursor = "";
    for (let page = 0; page < REWARD_PAGES; page++) {
      if (pastDeadline(dl)) return { ok: false, rates, pages, error: `time budget: the reward listing was not read to its end (${pages} pages) by the deadline` };
      const r = await venue.rewardsPage(sponsored, cursor);
      pages++;
      if (!r.ok) return { ok: false, rates, pages, error: `rewards/markets/current (sponsored ${sponsored}): ${r.status} ${r.error}` };
      const rows = Array.isArray(r.data?.data) ? r.data!.data! : [];
      for (const row of rows) {
        const cond = String(row.condition_id ?? "").toLowerCase();
        if (!cond) continue;
        const rate = rewardRate(row);
        if (!rates.has(cond) || rate > rates.get(cond)!) rates.set(cond, rate);
      }
      cursor = typeof r.data?.next_cursor === "string" ? r.data.next_cursor : "";
      if (!cursor || cursor === "LTE=" || !rows.length) break;
    }
  }
  return { ok: true, rates, pages };
}

/**
 * The day's markets, deterministically: Gamma's open markets in its order by 24-hour volume (five pages of 100 at most),
 * each candidate's YES book read in turn (40 reads at most), and the first standard and the first neg-risk market whose
 * book is two-sided and agrees with Gamma about `neg_risk` are taken. `kinds` are the ones still wanted; `exclude` the
 * markets already taken today. A failed reward read takes nothing: without it, RW's universe cannot be told apart. Past
 * the deadline no read starts: what was taken stands, and the rest is looked for again on the next try.
 */
export async function selectMarkets(venue: PmVenue, day: string, kinds: Array<PmMarketRow["kind"]>, exclude: Set<string>, dl: PmDeadline = NO_DEADLINE): Promise<{ picks: PmMarketRow[]; note: Record<string, unknown> }> {
  const rr = await rewardRates(venue, dl);
  if (!rr.ok) return { picks: [], note: { error: rr.error, rewardPages: rr.pages } };
  const wanted = new Set(kinds), picks: PmMarketRow[] = [];
  let rank = 0, booksRead = 0, cursor: string | null = null, gammaPages = 0, considered = 0;
  const late = () => ({ picks, note: { error: "time budget: the deadline came before every kind was found", rewardPages: rr.pages, rewarded: rr.rates.size, gammaPages, considered, booksRead, notFound: [...wanted] } });
  for (let page = 0; page < GAMMA_PAGES && wanted.size && booksRead < BOOK_READS; page++) {
    if (pastDeadline(dl)) return late();
    const g = await venue.gammaMarkets(cursor);
    gammaPages++;
    if (!g.ok) return { picks, note: { error: `gamma markets/keyset: ${g.status} ${g.error}`, rewardPages: rr.pages, gammaPages, booksRead } };
    const markets = Array.isArray(g.data?.markets) ? g.data!.markets! : [];
    for (const m of markets) {
      rank++;
      const c = candidateOf(m, rr.rates);
      if (!c) continue;
      const kind = c.negRisk ? "neg_risk" : "standard";
      if (!wanted.has(kind) || exclude.has(c.cond)) continue;
      if (booksRead >= BOOK_READS) break;
      if (pastDeadline(dl)) return late();
      considered++;
      booksRead++;
      const r = await venue.book(c.yes);
      const b = r.ok ? bookNow(r.data) : null;
      if (!b || b.negRisk !== c.negRisk) continue;
      picks.push({ day, kind, cond: c.cond, yes_token: c.yes, no_token: c.no, neg_risk: c.negRisk, tick: Number(b.tick), min_size: b.minSize, reward_rate: c.rate, rank, question: c.question });
      wanted.delete(kind);
      if (!wanted.size) break;
    }
    cursor = typeof g.data?.next_cursor === "string" && g.data.next_cursor && g.data.next_cursor !== "LTE=" ? g.data.next_cursor : null;
    if (!cursor) break;
  }
  return { picks, note: { rewardPages: rr.pages, rewarded: rr.rates.size, gammaPages, considered, booksRead, notFound: [...wanted] } };
}

/** What a read-back's status makes of our row: LIVE rests, MATCHED filled, CANCELED (the market resolving too) cancelled, INVALID refused. */
export function stateOfStatus(s: unknown): PmOrderRow["state"] | null {
  const x = String(s ?? "").toUpperCase();
  if (x === "LIVE") return "live";
  if (x === "MATCHED") return "filled";
  if (x === "CANCELED" || x === "CANCELLED" || x === "CANCELED_MARKET_RESOLVED") return "cancelled";
  if (x === "INVALID") return "rejected";
  return null;
}

/**
 * How a POST's reply settles its pending row. A reply the venue accepted rests (`live`); an explicit refusal is
 * `rejected` (a 4xx with its error, a 200 with `success: false`, or a refusal made here before any request left; a 425
 * restart or a 429 says the order was not taken, and is sent again as a new order); anything else — a 5xx, a timeout, a
 * reply that never came — says nothing about the order, which stays `pending` until a read-back by its hash settles it.
 */
export function postOutcome(r: PmReply<PmSendReply>, hash: string): { state: "live" | "rejected" | "pending"; why: string; retry?: boolean } {
  if (r.refused) return { state: "rejected", why: `refused before sending: ${r.error}` };
  if (r.ok) {
    if (r.data?.success === false) return { state: "rejected", why: String(r.data.errorMsg ?? "success: false") };
    const id = String(r.data?.orderID ?? "").toLowerCase();
    if (id && id !== hash) return { state: "pending", why: `the venue named it ${id}, not its hash ${hash}: settled by read-back` };
    return { state: "live", why: String(r.data?.status ?? "accepted") };
  }
  if (r.status === 425 || r.status === 429) return { state: "rejected", why: `${r.status} ${r.error ?? ""}: not taken`, retry: true };
  if (r.status >= 400 && r.status < 500 && r.error) return { state: "rejected", why: `${r.status} ${r.error}` };
  return { state: "pending", why: `${r.status || "no reply"} ${r.error ?? ""}: outcome unknown` };
}

// ------------------------------------------------------------------ the executor

export type PmLiveDeps = {
  db: Db;
  now: number;
  holder: string;
  venue: PmVenue;
  /** The runtime's `SB_REGION`, as the action read it. */
  sbRegion: string | null;
  /** `PM_ORDER_SENDS_ENABLED` in production: false, so the path is a dry-run whatever its config says. */
  sendsEnabled: boolean;
  /** The account's addresses from the secrets: the proxy wallet (an order's maker) and the EOA (its signer). */
  account: { maker: string; signer: string } | null;
  /** What signs an order; null in this phase, which never loads the key. */
  signer: PmSigner | null;
  rule?: PmQuoteRule;
  salt?: () => string;
  /** Milliseconds, for the turn's deadlines and its lease's renewal only; nothing recorded is read from it. Date.now by default. */
  clock?: () => number;
};

export type PmLiveReport = {
  at: string; skipped?: string; mode: PmLiveMode | null; why: string; sbRegion: string | null; gates: Gates | null;
  markets: Array<{ kind: string; cond: string; book: PmBookNow | null; held: { yes: number; no: number } | null }>;
  placed: Array<{ mode: PmLiveMode; slot: string; side: string; price: number; size: number; hash: string; state: string }>;
  cancelled: Array<{ mode: PmLiveMode; slot: string; gate: string; outcome: string }>;
  withheld: Array<{ slot: string; gate: string; reason: string }>;
  settled: Array<{ hash: string; state: string }>;
  posts: number; pnl: { day: number; total: number } | null; errors: string[];
};

type Slot = { cond: string; token: string; outcome: "yes" | "no"; side: "BUY" | "SELL"; negRisk: boolean; tick: PmTickSize; minSize: number; book: PmBookNow };
type Want = Slot & { price: number; size: number; gate: "open" | "reduce" };
const slotKey = (x: { cond: string; token: string; side: string }) => `${x.cond}|${x.token}|${x.side}`;
const isOpenRow = (o: Pick<PmOrderRow, "state">) => o.state === "pending" || o.state === "live";

/** One turn of the path. It never throws: whatever fails ends in `errors`, and the lease is always given back. */
export async function runPmLive(d: PmLiveDeps): Promise<PmLiveReport> {
  const report: PmLiveReport = {
    at: iso(d.now), mode: null, why: "", sbRegion: d.sbRegion, gates: null, markets: [], placed: [], cancelled: [], withheld: [], settled: [],
    posts: 0, pnl: null, errors: [],
  };
  const clock = d.clock ?? (() => Date.now());
  const t0 = clock();
  let held: unknown[];
  try {
    held = await d.db.claim("agent_locks", `name=eq.pm-live&lease_until=lt.${enc(iso(d.now))}`, { lease_until: iso(d.now + PM_LIVE_LEASE_MS), holder: d.holder });
  } catch (e) {
    if (/PGRST205|42P01|Could not find the table|relation .* does not exist/i.test(msg(e))) return { ...report, skipped: "agent_locks is not there" };
    report.errors.push(`LEASE CLAIM FAILED — agent_locks: ${msg(e)}; nothing done this minute`);
    return report;
  }
  if (!held.length) return { ...report, skipped: "another run holds the pm-live lease (or migration 0074 has not run)" };
  try {
    await turn(d, report, clock, t0);
  } catch (e) {
    report.errors.push(`turn: ${msg(e)}`);
  } finally {
    try { await d.db.update("agent_locks", `name=eq.pm-live&holder=eq.${enc(d.holder)}`, { lease_until: iso(d.now), holder: null }); } catch { /* it expires on its own */ }
  }
  return report;
}

async function turn(d: PmLiveDeps, report: PmLiveReport, clock: () => number, t0: number): Promise<void> {
  const { db, venue } = d;
  const nowIso = iso(d.now), nowS = Math.floor(d.now / 1000), minute = iso(Math.floor(d.now / M) * M);
  const dayStart = Math.floor(d.now / DAY) * DAY, day = nowIso.slice(0, 10);
  const elapsed = () => clock() - t0;
  let renewedAt = t0, leaseLost = false;
  /**
   * Keep, and check, the lease before every live order: a turn that lost it sends nothing more (PR5's executor's rule).
   * Stricter than PR5's in one way: a renewal that cannot be confirmed stops the sending too.
   */
  const holdLease = async (): Promise<boolean> => {
    if (leaseLost) return false;
    const at = clock();
    if (at - renewedAt < PM_LIVE_LEASE_MS / 2) return true;
    try {
      const rows = await db.claim("agent_locks", `name=eq.pm-live&holder=eq.${enc(d.holder)}`, { lease_until: iso(d.now + (at - t0) + PM_LIVE_LEASE_MS) });
      if (!rows.length) { leaseLost = true; report.errors.push("lease lost: another run holds pm-live now; this one sends nothing more"); return false; }
      renewedAt = at;
      return true;
    } catch (e) { leaseLost = true; report.errors.push(`lease renewal failed (${msg(e)}): this run sends nothing more`); return false; }
  };

  // ── the config, the last turn, the global pause, the mode ─────────────────────────────────────────────────────────
  let cfg: PmLiveConfig | undefined;
  try { cfg = (await db.select<PmLiveConfig>("pm_live_config", "id=eq.1&select=*"))[0]; }
  catch (e) {
    if (/PGRST205|42P01|Could not find the table|relation .* does not exist/i.test(msg(e))) { report.skipped = "the pm_live tables are not in this database yet: migration 0074 has not run"; return; }
    throw e;
  }
  if (!cfg) { report.skipped = "no pm_live_config row: migration 0074 has not run"; return; }
  const lim = effectiveLimits(cfg);
  const prev = ((await db.select<{ state: Record<string, unknown> }>("pm_live_state", "id=eq.1&select=state"))[0]?.state ?? {}) as Record<string, any>;
  let globalPause = false, riskReadable = true;
  try { globalPause = !!(await db.select<{ global_pause: boolean }>("agent_risk", "id=eq.1&select=global_pause"))[0]?.global_pause; }
  catch (e) { riskReadable = false; report.errors.push(`agent_risk unreadable (${msg(e)}): nothing that opens this turn`); }
  const keyed = !!d.signer && !!d.account && d.signer.address().toLowerCase() === d.account.signer.toLowerCase();
  const mode: PmLiveMode = d.sendsEnabled && !cfg.dry_run && keyed ? "live" : "dry_run";
  report.mode = mode;
  report.why = mode === "live" ? "live: sends enabled in code, dry_run off, the key loaded and matching the signer"
    : !d.sendsEnabled ? "dry-run: PM_ORDER_SENDS_ENABLED is false in code" : cfg.dry_run ? "dry-run: pm_live_config.dry_run is on"
    : "dry-run: no signing key loaded for the stored signer";

  // ── 1. the day's markets ──────────────────────────────────────────────────────────────────────────────────────────
  let markets = await db.select<PmMarketRow>("pm_live_markets", `day=eq.${day}&select=*&order=kind.asc`);
  const missing = (["standard", "neg_risk"] as const).filter((k) => !markets.some((m) => m.kind === k));
  let selectionTriedAt = prev.selectionDay === day ? (prev.selectionTriedAt as string | undefined) ?? null : null;
  if (missing.length && (!selectionTriedAt || d.now - Date.parse(selectionTriedAt) >= SELECT_RETRY_MS)) {
    selectionTriedAt = nowIso;
    try {
      const began = clock();
      const sel = await selectMarkets(venue, day, [...missing], new Set(markets.map((m) => m.cond)), { clock, until: t0 + PM_LIVE_SELECT_UNTIL_MS });
      sel.note.ms = Math.round(clock() - began);
      if (sel.picks.length) {
        await db.upsert("pm_live_markets", sel.picks.map((p) => ({ ...p, detail: { note: sel.note }, selected_at: nowIso })), "day,kind");
        markets = [...markets, ...sel.picks].sort((a, b) => a.kind.localeCompare(b.kind));
      }
      await db.upsert("pm_live_events", [{ mode, minute, kind: "selection", detail: { day, picked: sel.picks.map((p) => ({ kind: p.kind, cond: p.cond, rate: p.reward_rate, rank: p.rank })), ...sel.note } }], "mode,minute,kind");
      if (sel.note.error) report.errors.push(`selection: ${sel.note.error}`);
    } catch (e) { report.errors.push(`selection: ${msg(e)}`); }
  }

  // ── 2. what the venue says ────────────────────────────────────────────────────────────────────────────────────────
  const openAll = await db.selectAll<PmOrderRow>("pm_live_orders", "state=in.(pending,live)&select=*&order=id.asc");
  const geoR = await venue.geoblock();
  const geo = { ok: geoR.ok, country: geoR.ok ? (geoR.data?.country ?? null) : null, region: geoR.ok ? (geoR.data?.region ?? null) : null, blocked: geoR.ok ? (geoR.data?.blocked ?? null) : null };
  if (!geoR.ok) report.errors.push(`geoblock unreadable: ${geoR.status} ${geoR.error}`);
  const coR = await venue.closedOnly();
  const closedOnly = coR.ok && typeof coR.data?.closed_only === "boolean" ? coR.data.closed_only : null;
  if (closedOnly === null) report.errors.push(`closed-only flag unreadable: ${coR.status} ${coR.error ?? "no closed_only in the reply"}`);
  const books = new Map<string, PmBookNow | null>();
  const heldOf = new Map<string, number>();
  let inventoryReadable = true;
  for (const m of markets) {
    const r = await venue.book(m.yes_token);
    const b = r.ok ? bookNow(r.data) : null;
    books.set(m.cond, b && b.negRisk === m.neg_risk ? b : null);
    if (!b) report.errors.push(`${m.kind} ${m.cond.slice(0, 10)}…: book ${r.ok ? "not two-sided" : `unreadable (${r.status} ${r.error})`}`);
    else if (b.negRisk !== m.neg_risk) report.errors.push(`${m.kind} ${m.cond.slice(0, 10)}…: the book's neg_risk is ${b.negRisk}, the selection's ${m.neg_risk}; nothing quoted`);
    for (const token of [m.yes_token, m.no_token]) {
      const br = await venue.conditionalBalance(token);
      const units = br.ok ? Number(br.data?.balance) : NaN;
      if (Number.isFinite(units) && units >= 0) heldOf.set(token, units / 1e6);
      else { inventoryReadable = false; report.errors.push(`balance of ${token.slice(0, 10)}… unreadable: ${br.status} ${br.error ?? "no balance"}`); }
    }
  }

  // ── live orders read back by hash, and their trades ───────────────────────────────────────────────────────────────
  const unreadable = new Set<number>();
  const patch = async (o: PmOrderRow, p: Partial<PmOrderRow>) => {
    await db.update("pm_live_orders", `id=eq.${o.id}`, { ...p, updated_at: nowIso });
    Object.assign(o, p);
  };
  const recordTrades = async (o: PmOrderRow, ids: string[]) => {
    for (const id of ids) {
      const r = await venue.trade(id);
      const t: PmTrade | undefined = r.ok ? (r.data?.data ?? []).find((x) => x.id === id) : undefined;
      if (!t) { report.errors.push(`trade ${id} of ${o.hash.slice(0, 12)}… unreadable: ${r.status} ${r.error ?? "not in the reply"}`); continue; }
      const mine = (t.maker_orders ?? []).find((x) => String(x.order_id ?? "").toLowerCase() === o.hash);
      const size = Number(mine?.matched_amount), price = Number(mine?.price ?? o.price), status = tradeStatus(t.status);
      if (!mine || !(size > 0) || !status) { report.errors.push(`trade ${id}: no fill of ${o.hash.slice(0, 12)}… in it, or an unknown status ${t.status}; left for a person`); continue; }
      await db.upsert("pm_live_fills", [{
        trade_id: id, hash: o.hash, cond: o.cond, token: o.token, side: o.side, price, size, status,
        match_time: Number(t.match_time) > 0 ? iso(Number(t.match_time) * 1000) : null, tx_hash: t.transaction_hash ?? null, detail: { trade: t }, updated_at: nowIso,
      }], "trade_id,hash");
    }
  };
  /** Apply what GET /data/order/{hash} says. Never a guess: a status it does not know leaves the row as it is. */
  const applyReadBack = async (o: PmOrderRow, v: PmOpenOrder) => {
    const state = stateOfStatus(v.status);
    const matched = Number(v.size_matched ?? 0);
    if (!state) { report.errors.push(`${o.hash.slice(0, 12)}…: the venue says ${v.status}, which this path does not know; left for a person`); return; }
    const p: Partial<PmOrderRow> = {};
    if (state !== o.state) p.state = state;
    if (Number.isFinite(matched) && matched !== Number(o.size_matched)) p.size_matched = matched;
    if (state === "filled" && !o.filled_at) p.filled_at = nowIso;
    if ((state === "cancelled" || state === "rejected") && !o.cancelled_at) p.cancelled_at = nowIso;
    if (Object.keys(p).length) { await patch(o, { ...p, response: { ...(o.response as object ?? {}), readBack: v } }); report.settled.push({ hash: o.hash, state: o.state }); }
    if (matched > 0 && Array.isArray(v.associate_trades) && v.associate_trades.length) await recordTrades(o, v.associate_trades.map(String));
  };
  const readBack = async (o: PmOrderRow): Promise<boolean> => {
    const r = await venue.order(o.hash);
    if (r.status === 404) {
      report.errors.push(o.state === "pending"
        ? `${o.hash.slice(0, 12)}… (pending ${Math.round((d.now - Date.parse(o.ts)) / M)} min) is shown nowhere by the venue: outcome unknown; it stays pending for a person to settle, and its slot places nothing`
        : `${o.hash.slice(0, 12)}…: the venue no longer finds an order it accepted; left for a person`);
      unreadable.add(o.id);
      return false;
    }
    if (!r.ok || !r.data) { unreadable.add(o.id); report.errors.push(`${o.hash.slice(0, 12)}…: read-back failed (${r.status} ${r.error}); left as it is`); return false; }
    await applyReadBack(o, r.data);
    return true;
  };
  for (const o of openAll.filter((x) => x.mode === "live")) {
    try {
      if (o.state === "pending" && d.now - Date.parse(o.ts) < PENDING_GRACE_MS) { unreadable.add(o.id); continue; }
      await readBack(o);
    } catch (e) { unreadable.add(o.id); report.errors.push(`${o.hash.slice(0, 12)}…: ${msg(e)}`); }
  }
  // Trades not yet final are read again until CONFIRMED or FAILED.
  const fillRows = await db.selectAll<FillRow>("pm_live_fills", "select=*&order=trade_id.asc,hash.asc");
  for (const f of fillRows.filter((x) => x.status !== "CONFIRMED" && x.status !== "FAILED")) {
    const o = openAll.find((x) => x.hash === f.hash) ?? (await db.select<PmOrderRow>("pm_live_orders", `hash=eq.${f.hash}&select=*`))[0];
    if (o) { try { await recordTrades(o, [f.trade_id]); } catch (e) { report.errors.push(`trade ${f.trade_id}: ${msg(e)}`); } }
  }
  // A dry-run row left pending (its second write failed) was never sent anywhere: closed, so it cannot hold its slot.
  for (const o of openAll.filter((x) => x.mode === "dry_run" && x.state === "pending" && d.now - Date.parse(x.ts) >= PENDING_GRACE_MS)) {
    try { await patch(o, { state: "cancelled", cancelled_at: nowIso, cancel_reason: "a dry-run row left pending: nothing was sent" }); } catch (e) { report.errors.push(`dry-run row ${o.id}: ${msg(e)}`); }
  }
  // A dry-run order the venue would have expired by now (its expiration less the venue's minute) is expired.
  for (const o of openAll.filter((x) => x.mode === "dry_run" && x.state === "live" && Number(x.expiration) - PM_GTD_EARLY_S <= nowS)) {
    try { await patch(o, { state: "expired", cancelled_at: nowIso }); } catch (e) { report.errors.push(`dry-run row ${o.id}: ${msg(e)}`); }
  }

  // ── P&L from CONFIRMED live fills, and the loss stops ─────────────────────────────────────────────────────────────
  const confirmed = (await db.selectAll<FillRow>("pm_live_fills", "status=eq.CONFIRMED&select=*&order=trade_id.asc,hash.asc"))
    .map((f): PmFill => ({ token: f.token, side: f.side, price: Number(f.price), size: Number(f.size), ts: f.match_time ? Date.parse(f.match_time) : d.now }));
  const tb = tokenBooks(confirmed, dayStart);
  const marks: Record<string, number | null> = {};
  for (const m of markets) {
    const b = books.get(m.cond);
    const mid = b ? (b.bestBid + b.bestAsk) / 2 : null;
    marks[m.yes_token] = mid; marks[m.no_token] = mid == null ? null : 1 - mid;
  }
  const pnl = bookPnl(tb, marks);
  report.pnl = pnl;
  const hasEvent = async (kind: string, since: string | null) => (await db.select("pm_live_events", `mode=eq.live&kind=eq.${kind}${since ? `&minute=gte.${enc(since)}` : ""}&select=minute&limit=1`)).length > 0;
  let lossDay = false, lossTotal = false;
  try {
    lossDay = await hasEvent("loss_stop_day", iso(dayStart));
    lossTotal = await hasEvent("loss_stop_total", null);
  } catch (e) { lossDay = lossTotal = true; report.errors.push(`loss stops unreadable (${msg(e)}): nothing that opens this turn`); }
  if (!lossDay && pnl.day <= -lim.lossDay) {
    lossDay = true;
    await db.upsert("pm_live_events", [{ mode: "live", minute, kind: "loss_stop_day", detail: { dayPnl: pnl.day, limit: -lim.lossDay } }], "mode,minute,kind");
    report.errors.push(`LOSS STOP (day): ${pnl.day} USD is past −${lim.lossDay}; nothing opens until the next UTC day; sells of what is held stay armed`);
  }
  if (!lossTotal && pnl.total <= -lim.lossTotal) {
    lossTotal = true;
    await db.upsert("pm_live_events", [{ mode: "live", minute, kind: "loss_stop_total", detail: { totalPnl: pnl.total, limit: -lim.lossTotal } }], "mode,minute,kind");
    report.errors.push(`LOSS STOP (all): ${pnl.total} USD is past −${lim.lossTotal}; nothing opens again until a person clears the stop; sells stay armed`);
  }

  // ── 3. the gates ──────────────────────────────────────────────────────────────────────────────────────────────────
  const attested = attestationCurrent(cfg, d.now);
  const g = gates({
    mode, globalPause, riskReadable, armed: !!cfg.live_confirmed_at, sbRegion: d.sbRegion, geo, closedOnly, attested, inventoryReadable, lossDay, lossTotal,
  });
  report.gates = g;

  // ── 4. what each slot should hold ─────────────────────────────────────────────────────────────────────────────────
  const rule = d.rule ?? placeholderQuotes;
  const wants = new Map<string, Want>();
  const withheld = new Map<string, string>();
  const withhold = (slot: string, gate: string, reason: string) => { withheld.set(slot, gate); report.withheld.push({ slot, gate, reason }); };
  const lifetime = lim.lifetimeS;
  for (const m of markets) {
    const b = books.get(m.cond);
    const held = { yes: heldOf.get(m.yes_token) ?? 0, no: heldOf.get(m.no_token) ?? 0 };
    report.markets.push({ kind: m.kind, cond: m.cond, book: b ?? null, held: inventoryReadable ? held : null });
    if (!b || g.cancelAll) continue;
    let intents: PmIntent[];
    try { intents = rule({ market: m, book: b, held }); } catch (e) { report.errors.push(`${m.kind}: the rule threw (${msg(e)}); nothing quoted`); continue; }
    const tokenOf = (o: "yes" | "no") => (o === "yes" ? m.yes_token : m.no_token);
    // Sells a rule wants are capped at what is held, whatever the mode; while opening is stopped, buys become close-only sells.
    const sellsCapped = closeOnly(intents.filter((x) => x.side === "SELL"), held, b);
    const list = g.open ? [...intents.filter((x) => x.side === "BUY"), ...sellsCapped] : g.reduce ? closeOnly(intents, held, b) : [];
    for (const x of intents) {
      const slot = slotKey({ cond: m.cond, token: tokenOf(x.outcome), side: x.side });
      if (!list.some((y) => y.outcome === x.outcome && y.side === x.side)) {
        withhold(slot, g.cancelAll ? "global_pause" : x.side === "BUY" ? g.openBlockedBy ?? "rule" : g.reduceBlockedBy ?? "rule", x.side === "BUY" ? "nothing that opens" : "nothing held to sell");
      }
    }
    for (const x of list) {
      const slot = slotKey({ cond: m.cond, token: tokenOf(x.outcome), side: x.side });
      const expiration = nowS + PM_GTD_EARLY_S + lifetime;
      const problems = orderProblems({ price: x.price, size: x.size, expiration }, { tick: b.tick, minSize: b.minSize, nowS });
      if (problems.length) { withhold(slot, "venue_rules", problems.join("; ")); continue; }
      if (crosses(x, b)) { withhold(slot, "post_only", `${x.side} ${x.outcome} at ${x.price} would take the book (${b.bestBid}/${b.bestAsk})`); continue; }
      if (wants.has(slot)) continue;
      wants.set(slot, { cond: m.cond, token: tokenOf(x.outcome), outcome: x.outcome, side: x.side, negRisk: m.neg_risk, tick: b.tick, minSize: b.minSize, book: b, price: x.price, size: x.size, gate: x.side === "BUY" ? "open" : "reduce" });
    }
  }

  // The caps, on what would rest after this turn: buys' collateral (N × b for a YES bid, N × (1 − a) for a NO bid) plus
  // what the holdings cost. Rows this turn cannot touch (pending, frozen, unread) keep their collateral.
  const open = openAll.filter(isOpenRow);
  const untouchable = (o: PmOrderRow) => o.state === "pending" || !!o.cancel_requested_at || unreadable.has(o.id);
  const byMarket = new Map<string, number>();
  let committed = 0;
  const commit = (cond: string | null, usd: number) => { committed += usd; if (cond) byMarket.set(cond, (byMarket.get(cond) ?? 0) + usd); };
  const condOfToken = new Map<string, string>();
  for (const m of markets) { condOfToken.set(m.yes_token, m.cond); condOfToken.set(m.no_token, m.cond); }
  // Every holding the fills explain, in any market, at its cost; and what today's markets hold beyond their fills (no
  // fill to price it, so counted at $1 a share, the most a share can be worth).
  for (const [token, t] of Object.entries(tb)) commit(condOfToken.get(token) ?? null, t.held * t.avgCost);
  for (const [token, cond] of condOfToken) commit(cond, Math.max(0, (heldOf.get(token) ?? 0) - (tb[token]?.held ?? 0)));
  for (const o of open) if (o.mode === mode && o.side === "BUY" && untouchable(o)) commit(o.cond, Number(o.price) * Math.max(0, Number(o.size) - Number(o.size_matched)));
  for (const [slot, w] of [...wants.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (w.side !== "BUY") continue;
    const usd = w.price * w.size;
    if (committed + usd > lim.capTotal + 1e-9) { wants.delete(slot); withhold(slot, "cap_total", `${(committed + usd).toFixed(2)} USD would pass the cap of ${lim.capTotal}`); continue; }
    if ((byMarket.get(w.cond) ?? 0) + usd > lim.capMarket + 1e-9) { wants.delete(slot); withhold(slot, "cap_market", `${((byMarket.get(w.cond) ?? 0) + usd).toFixed(2)} USD in one market would pass ${lim.capMarket}`); continue; }
    commit(w.cond, usd);
  }

  // ── 5. the orders ─────────────────────────────────────────────────────────────────────────────────────────────────
  const today = await db.selectAll<Pick<PmOrderRow, "id" | "mode" | "cond" | "token" | "side" | "price" | "size" | "state" | "response">>("pm_live_orders",
    `ts=gte.${enc(iso(dayStart))}&select=id,mode,cond,token,side,price,size,state,response&order=id.asc`);
  let posts = today.filter((o) => o.mode === mode).length;
  /** Each slot's newest order today: one the venue refused is not sent again at the same price and size. */
  const lastInSlot = new Map<string, (typeof today)[number]>();
  for (const o of today) if (o.mode === mode) lastInSlot.set(slotKey(o), o);
  const slotLabel = (o: { cond: string; outcome: string; side: string }) => `${o.cond.slice(0, 6)}…${o.cond.slice(-4)}|${o.outcome}|${o.side}`;

  /** Take an order off the book, CONFIRMED by a read-back; a dry-run row is simply closed. */
  const cancel = async (o: PmOrderRow, gate: string, reason: string): Promise<"cancelled" | "filled" | "frozen"> => {
    const done = (outcome: "cancelled" | "filled" | "frozen") => { report.cancelled.push({ mode: o.mode, slot: slotLabel(o), gate, outcome }); return outcome; };
    if (o.mode === "dry_run") {
      await patch(o, { state: "cancelled", cancel_requested_at: o.cancel_requested_at ?? nowIso, cancel_gate: gate, cancel_reason: reason, cancelled_at: nowIso });
      return done("cancelled");
    }
    if (!o.cancel_requested_at) await patch(o, { cancel_requested_at: nowIso, cancel_gate: gate, cancel_reason: reason });
    // The DELETE's own word decides nothing, a lost reply included: only the read-back below does.
    try {
      const c = await venue.cancelOrder(o.hash);
      if (!c.ok) report.errors.push(`${slotLabel(o)}: cancel of ${o.hash.slice(0, 12)}… ${c.refused ? `refused here (${c.error})` : `answered ${c.status} ${c.error}`}`);
    } catch (e) { report.errors.push(`${slotLabel(o)}: cancel of ${o.hash.slice(0, 12)}… has no reply (${msg(e)}); read back`); }
    const r = await venue.order(o.hash);
    if (!r.ok || !r.data) { report.errors.push(`${slotLabel(o)}: cancel of ${o.hash.slice(0, 12)}… could not be read back (${r.status} ${r.error}); the slot is FROZEN until it is`); return done("frozen"); }
    await applyReadBack(o, r.data);
    if (o.state === "cancelled" || o.state === "rejected") return done("cancelled");
    if (o.state === "filled") return done("filled");
    report.errors.push(`${slotLabel(o)}: cancel of ${o.hash.slice(0, 12)}… sent, and the venue still shows it ${r.data.status}; the slot is FROZEN: no replacement until the venue shows it cancelled`);
    return done("frozen");
  };

  /** Write the order `pending` (the slot's claim), then send it (live) or record what the venue would say (dry-run). */
  const post = async (w: Want, reason: string) => {
    const label = slotLabel(w);
    if (elapsed() > PM_LIVE_SEND_UNTIL_MS) { withhold(slotKey(w), "time", `${Math.round(elapsed() / 1000)} s into the turn, past the ${PM_LIVE_SEND_UNTIL_MS / 1000} s after which nothing is sent; next minute`); return; }
    if (posts >= lim.maxPosts) { withhold(slotKey(w), "governor", `${posts} POSTs today, the limit is ${lim.maxPosts}`); return; }
    const last = lastInSlot.get(slotKey(w));
    if (last?.state === "rejected" && !(last.response as { retry?: boolean } | null)?.retry && Math.abs(Number(last.price) - w.price) < 1e-9 && Math.abs(Number(last.size) - w.size) < 1e-9) {
      withhold(slotKey(w), "refused", `the venue refused this quote (${(last.response as { why?: string } | null)?.why ?? "rejected"}); it is not sent again until the rule's price or size changes`);
      return;
    }
    const maker = d.account?.maker ?? null, signer = d.account?.signer ?? null;
    if (!maker || !signer) { withhold(slotKey(w), "account", "no stored funder and signer: an order's hash needs both"); return; }
    if (mode === "live" && !(await holdLease())) { withhold(slotKey(w), "lease", "this run no longer holds the pm-live lease: it sends nothing more"); return; }
    const expiration = nowS + PM_GTD_EARLY_S + lifetime;
    const built = buildOrder({
      tokenId: w.token, side: w.side, price: w.price, size: w.size, tick: w.tick, negRisk: w.negRisk, maker, signer,
      salt: (d.salt ?? newSalt)(), timestampMs: d.now, expiration,
    });
    const request: PmOrder & { exchange: string; orderType: "GTD"; postOnly: true } = { ...built.order, exchange: built.exchange, orderType: "GTD", postOnly: true };
    const bookSeen = { bestBid: w.book.bestBid, bestAsk: w.book.bestAsk, tick: w.tick, minSize: w.minSize, negRisk: w.negRisk, at: w.book.at, hash: w.book.hash };
    let row: PmOrderRow;
    try {
      [row] = await db.insert<PmOrderRow>("pm_live_orders", {
        mode, cond: w.cond, token: w.token, outcome: w.outcome, side: w.side, price: w.price, size: w.size, order_type: "GTD", post_only: true,
        expiration, neg_risk: w.negRisk, hash: built.hash, state: "pending", gate: w.gate, reason, book_seen: bookSeen, request,
      }, true);
    } catch (e) {
      if (/duplicate key|23505|409/.test(msg(e))) { report.errors.push(`${label}: another open order holds this slot, or this hash exists; nothing sent`); return; }
      throw e;
    }
    posts++;
    report.posts++;
    if (mode === "dry_run") {
      await patch(row, { state: "live", response: { dryRun: true, wouldRest: true } });
      report.placed.push({ mode, slot: label, side: w.side, price: w.price, size: w.size, hash: built.hash, state: "live" });
      return;
    }
    let reply: PmReply<PmSendReply>;
    try {
      const signature = d.signer!.signDigest(built.hash);
      reply = await venue.postOrder({ ...built.order, signature }, "GTD", true);
    } catch (e) {
      report.errors.push(`${label}: ${built.hash.slice(0, 12)}… has no reply (${msg(e)}); left pending, to be settled by its hash`);
      report.placed.push({ mode, slot: label, side: w.side, price: w.price, size: w.size, hash: built.hash, state: "pending" });
      return;
    }
    const out = postOutcome(reply, built.hash);
    const response = { status: reply.status, ok: reply.ok, data: reply.data ?? null, error: reply.error ?? null, refused: reply.refused ?? null, retryAfterS: reply.retryAfterS ?? null, why: out.why, retry: out.retry ?? false };
    if (out.state === "pending") {
      await patch(row, { response });
      report.errors.push(`${label}: ${built.hash.slice(0, 12)}… — ${out.why}; it stays pending for the read-back`);
    } else await patch(row, out.state === "rejected" ? { state: "rejected", cancelled_at: nowIso, response } : { state: "live", response });
    report.placed.push({ mode, slot: label, side: w.side, price: w.price, size: w.size, hash: built.hash, state: row.state });
  };

  // The global pause: everything open is cancelled (the kill switch, one request for the lot), nothing is placed.
  if (g.cancelAll) {
    if (open.some((o) => o.mode === "live")) {
      try {
        const c = await venue.cancelAll();
        if (!c.ok) report.errors.push(`cancel-all ${c.refused ? `refused here (${c.error})` : `answered ${c.status} ${c.error}`}`);
      } catch (e) { report.errors.push(`cancel-all has no reply (${msg(e)}); every order is read back`); }
    }
    for (const o of open) {
      try {
        if (o.mode === "dry_run") await cancel(o, "global_pause", "agent_risk.global_pause");
        else if (await readBack(o) && isOpenRow(o)) report.errors.push(`${slotLabel(o)}: still ${o.state} after the global pause's cancel-all; it is asked again next minute`);
      } catch (e) { report.errors.push(`${slotLabel(o)}: ${msg(e)}`); }
    }
  } else {
    // Rows of the other mode: the dry-run's give way to a live path; a live path that went back to dry-run cancels its own.
    for (const o of open.filter((x) => x.mode !== mode)) {
      try { if (!untouchable(o)) await cancel(o, "mode", `the path is ${mode === "live" ? "live" : "in dry-run"}`); } catch (e) { report.errors.push(`${slotLabel(o)}: ${msg(e)}`); }
    }
    const mine = open.filter((x) => x.mode === mode && isOpenRow(x));
    const replace: Want[] = [];
    // Cancels first, so their collateral is free before anything new is sent.
    for (const o of mine) {
      try {
        if (o.state === "pending" || unreadable.has(o.id)) continue;                            // in flight or unread: never a second order
        if (o.cancel_requested_at) { await cancel(o, o.cancel_gate ?? "cancel", o.cancel_reason ?? "an earlier cancel"); continue; }
        const slot = slotKey(o);
        const w = wants.get(slot);
        if (!w) {
          const managed = markets.some((m) => m.cond === o.cond);
          await cancel(o, withheld.get(slot) ?? (!managed ? "selection" : books.get(o.cond) ? "rule" : "book"),
            !managed ? "the market is not in today's selection" : books.get(o.cond) ? "the rule wants nothing resting here" : "the book is unreadable or one-sided");
          continue;
        }
        const samePrice = Math.abs(Number(o.price) - w.price) < 1e-9 && Math.abs(Number(o.size) - w.size) < 1e-9;
        const lifeLeft = Number(o.expiration) - PM_GTD_EARLY_S - nowS;
        if (samePrice && lifeLeft > PM_LIVE_REFRESH_S) { wants.delete(slot); continue; }   // resting as wanted
        const c = await cancel(o, samePrice ? "refresh" : "reprice", samePrice ? `${lifeLeft} s left of its life` : `the rule's price is ${w.price} × ${w.size}`);
        wants.delete(slot);
        if (c === "cancelled") replace.push(w);
      } catch (e) { report.errors.push(`${slotLabel(o)}: ${msg(e)}`); }
    }
    const blocked = new Set(mine.filter((o) => isOpenRow(o) && (o.state === "pending" || unreadable.has(o.id) || !!o.cancel_requested_at)).map(slotKey));
    for (const w of [...replace, ...wants.values()]) {
      try {
        if (blocked.has(slotKey(w))) continue;
        await post(w, replace.includes(w) ? "replacement" : "new");
      } catch (e) { report.errors.push(`${slotLabel(w)}: ${msg(e)}`); }
    }
  }

  // ── the record: the gates when they change, the governor, and this turn ───────────────────────────────────────────
  const gateKey = JSON.stringify({ v: g.verdicts, region: d.sbRegion, country: geo.country, mode });
  try {
    if (prev.gateKey !== gateKey) {
      await db.upsert("pm_live_events", [{ mode, minute, kind: "gates", detail: { verdicts: g.verdicts, openBlockedBy: g.openBlockedBy, reduceBlockedBy: g.reduceBlockedBy, sbRegion: d.sbRegion, geo, closedOnly, attested, before: prev.gates ?? null } }], "mode,minute,kind");
    }
    if (posts >= lim.maxPosts && prev.governorDay !== day) {
      await db.upsert("pm_live_events", [{ mode, minute, kind: "governor", detail: { posts, limit: lim.maxPosts } }], "mode,minute,kind");
    }
    await db.upsert("pm_live_state", [{
      id: 1, updated_at: nowIso, last_error: report.errors.length ? report.errors.join(" | ").slice(0, 500) : null,
      state: {
        at: nowIso, minute, mode, why: report.why, sbRegion: d.sbRegion, sendsEnabled: d.sendsEnabled, dryRun: cfg.dry_run, armed: !!cfg.live_confirmed_at,
        attested, gates: g.verdicts, openBlockedBy: g.openBlockedBy, reduceBlockedBy: g.reduceBlockedBy, gateKey, geo, closedOnly,
        limits: lim, posts: { day, [mode]: posts }, governorDay: posts >= lim.maxPosts ? day : prev.governorDay ?? null, pnl,
        selectionDay: day, selectionTriedAt,
        markets: report.markets, withheld: report.withheld,
        open: (await db.select<{ id: number }>("pm_live_orders", "state=in.(pending,live)&select=id&limit=50")).length,
      },
    }], "id");
  } catch (e) { report.errors.push(`state not recorded (${msg(e)})`); }
}
