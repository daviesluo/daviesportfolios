// GROKPM's order path: the outside Grok agent trades through THIS server, on the project's Polymarket account, and never
// holds a key (Davies, 2026-10-16: "让grok用我们搭好的爱尔兰服务器下单，不是网页端"; the pre-registration's Deviation D2,
// docs/agents/reviews/2026-10-15-grokpm-prereg.md §9; migration 0125).
//
// The server is the deterministic risk layer the agent cannot override. Every order arrives with the journal decision
// that justifies it, in one request, and is refused with its reason (HTTP 422, `refusals`) unless every rule of the
// pre-registration's §2 that a machine can check holds:
//   a BUY        rests (post-only) and opens: price ≥ 0.05; under 0.90 unless category A; its market's cost (held at cost
//                plus resting buys plus this order) at most $10; at most 6 markets open; at most $25 a theme (the agent
//                names the theme; a market keeps the theme of its first buy); the agent's cash after it at least $30;
//                neither stop reached (−$10 the UTC day, −$30 in all, both from the agent's OWN book); a market that ends
//                within 30 days, is not a sport or a crypto price market ending within 7 days, accepts orders, and whose
//                book is not thin (spread at most 5 points, and at least $500 within 5 points of the mid on the bid, the
//                side it would exit into); and the decision carries p, m, its category, sources and its invalidation.
//   a SELL       closes what the agent itself bought (its own fills, less its own resting sells), never a token it did
//                not buy: the account's other holdings (live-prep's dust) are never the agent's. It rests unless it would
//                cross the book, which only a close of category C (a broken thesis) may do.
//   every order  GTD, at least 3 minutes and at most 65 minutes ahead (`expires_at`, clamped), at most 50 a UTC day.
// Live sends need, besides: eu-west-1, the config armed (`dry_run` false, `armed_at` set), the key loaded for the stored
// signer, Davies' Ireland attestation current, the account's geoblock read from here answering country IE, no global
// pause, no other order path of the account armed, and the account not closed-only (for a BUY). Disarmed, everything is
// checked and journalled and the answer says what would have been sent; nothing is signed or sent.
//
// The agent's book is its own orders and their fills only (`grokpm_orders`, `grokpm_fills`): its equity is the $100
// budget plus what its trades realised, less fees, plus what it holds at the mid (at its payout once resolved, at cost
// when no mid is read). The shared wallet's pUSD and live-prep's dust are read for information and never counted.
//
// What it reuses, unchanged: the order path's client (`_shared/polymarket_orders.ts`: the order, its hash, the venue's
// wire with its region and route rules) and live-prep's pure helpers (`agents/pm_live.ts`: the book's touch, a send's
// outcome, a read-back's state, a trade's fill, the attestation; `agents/pm_fees.ts`: a taker fill's fee).

import {
  asTickSize, buildOrder, newSalt, orderProblems, PM_GTD_EARLY_S, PM_ORDER_REGION, type PmOpenOrder, type PmReply, type PmSigner, type PmTickSize, type PmTrade,
  type PmVenue,
} from "../_shared/polymarket_orders.ts";
import { attestationCurrent, bookNow, postOutcome, stateOfStatus, tokenBooks, tradeFillOf, tradeStatus, type PmFill } from "../agents/pm_live.ts";
import { pmLiveFillFee } from "../agents/pm_fees.ts";
import type { Db } from "../agents/db.ts";
import { decisionOf, type Decision } from "./ingest.ts";

const M = 60e3, DAY = 86400e3;
/** The rules of the pre-registration's §2 that a machine checks, and the server's own limits. */
export const GROKPM_RULES = {
  marketCapUsd: 10, maxPositions: 6, themeCapUsd: 25, cashFloorUsd: 30,
  favouriteMin: 0.9, longshotUnder: 0.05, maxDaysToEnd: 30, shortDays: 7,
  thinSpread: 0.05, thinDepthUsd: 500, depthBand: 0.05,
  /** An order's own lifetime (the venue ends a GTD order a minute before its stated expiry, which this adds). */
  minLifetimeS: 180, maxLifetimeS: 65 * 60, defaultLifetimeS: 35 * 60,
  /** A held token at least this big is a position; under it, rounding dust of the agent's own fills. */
  heldMin: 0.01,
} as const;
/** The last good geoblock reading is used for this long when a new read fails. */
export const GROKPM_GEO_CACHE_MS = 10 * M;

const num = (x: unknown) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const iso = (ms: number) => new Date(ms).toISOString();
const COND = /^0x[0-9a-f]{64}$/, TOKEN = /^[0-9]{1,80}$/, HASH = /^0x[0-9a-f]{64}$/;

// ── what the server reads ─────────────────────────────────────────────────────────────────────────────────────────────

/** The venue as this path asks it: the order path's own calls, and Gamma by condition or token id with its tags. */
export type GrokVenue = Pick<PmVenue, "geoblock" | "book" | "closedOnly" | "collateral" | "order" | "trade" | "postOrder" | "cancelOrder"> & {
  gamma(q: { cond?: string; token?: string }): Promise<PmReply<{ markets?: Array<Record<string, unknown>> }>>;
};

export type GrokConfig = {
  wallet: string | null; funded_usd: number | string; daily_loss_usd: number | string; total_stop_usd: number | string; started_at: string | null;
  dry_run: boolean; armed_at: string | null; ireland_attested_at: string | null; ireland_until: string | null; max_orders_day: number;
};
export const GROKPM_CONFIG_SELECT = "wallet,funded_usd,daily_loss_usd,total_stop_usd,started_at,dry_run,armed_at,ireland_attested_at,ireland_until,max_orders_day";
export type GrokOrderRow = {
  id: number; created_at: string; mode: "dry_run" | "live"; decision_id: string; cond: string; token: string; outcome: string | null; side: "BUY" | "SELL";
  price: number | string; size: number | string; post_only: boolean; expiration: number | string; neg_risk: boolean; hash: string; theme: string | null;
  category: string | null; state: "pending" | "live" | "filled" | "cancelled" | "rejected" | "expired"; size_matched: number | string;
  request?: unknown; response?: unknown; cancel_requested_at: string | null; cancelled_at: string | null; filled_at: string | null;
};
export type GrokFillRow = {
  trade_id: string; hash: string; cond: string; token: string; side: "BUY" | "SELL"; price: number | string; size: number | string; fee_usd: number | string;
  taker: boolean; status: string; match_time: string | null; tx_hash: string | null;
};
const isOpen = (o: Pick<GrokOrderRow, "state">) => o.state === "pending" || o.state === "live";

/** A market as Gamma describes it, reduced to what the rules read. */
export type GrokMarket = {
  cond: string; question: string; tokens: string[]; outcomes: string[]; endDate: string | null; negRisk: boolean; closed: boolean; accepting: boolean;
  tick: number | null; minSize: number | null; feeType: string | null; sports: boolean; crypto: boolean; gameStartTime: string | null; tags: string[];
  payouts: number[] | null;
};
const parseList = (x: unknown): string[] => {
  if (Array.isArray(x)) return x.map(String);
  try { const v = JSON.parse(String(x ?? "[]")); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
};
const SPORT_TAGS = /^(sports|soccer|football|nfl|nba|mlb|nhl|tennis|cricket|esports|ufc|mma|boxing|golf|f1|formula-1|baseball|basketball|hockey|epl|ucl|games)$/;
const CRYPTO_TAGS = /^(crypto|crypto-prices|bitcoin|ethereum|solana|xrp|dogecoin|btc|eth)$/;
/** Gamma's record as the rules read it; null for one without a condition id or two tokens. */
export function marketOf(m: Record<string, unknown> | undefined): GrokMarket | null {
  if (!m) return null;
  const cond = String(m.conditionId ?? "").toLowerCase(), tokens = parseList(m.clobTokenIds);
  if (!COND.test(cond) || tokens.length !== 2) return null;
  const tags = (Array.isArray(m.tags) ? m.tags : []).map((t) => String((t as Record<string, unknown>)?.slug ?? "").toLowerCase()).filter(Boolean);
  const feeType = typeof m.feeType === "string" ? m.feeType : null;
  const gst = typeof m.gameStartTime === "string" && m.gameStartTime ? m.gameStartTime : null;
  const prices = parseList(m.outcomePrices).map(Number);
  const closed = m.closed === true;
  return {
    cond, question: String(m.question ?? "").slice(0, 300), tokens, outcomes: parseList(m.outcomes), endDate: typeof m.endDate === "string" ? m.endDate : null,
    negRisk: m.negRisk === true, closed, accepting: m.acceptingOrders === true && m.enableOrderBook !== false && !closed,
    tick: Number.isFinite(Number(m.orderPriceMinTickSize)) && Number(m.orderPriceMinTickSize) > 0 ? Number(m.orderPriceMinTickSize) : null,
    minSize: Number.isFinite(Number(m.orderMinSize)) && Number(m.orderMinSize) > 0 ? Number(m.orderMinSize) : null,
    feeType, gameStartTime: gst, tags,
    sports: !!(feeType && /^sports/.test(feeType)) || !!m.sportsMarketType || !!gst || tags.some((t) => SPORT_TAGS.test(t)),
    crypto: !!(feeType && /^crypto/.test(feeType)) || tags.some((t) => CRYPTO_TAGS.test(t)),
    payouts: closed && prices.length === 2 && prices.every((p) => Number.isFinite(p)) ? prices : null,
  };
}
/** A Postgres-style or ISO time as epoch ms; null when unreadable. */
export function timeMs(s: string | null): number | null {
  if (!s) return null;
  const t = Date.parse(s.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  return Number.isFinite(t) ? t : null;
}

/** A token's book, its touch and the dollars within `band` of the mid on each side; null fields when one-sided. */
export type GrokBook = {
  tick: PmTickSize | null; minSize: number | null; negRisk: boolean; bestBid: number | null; bestAsk: number | null; mid: number | null; spread: number | null;
  bidDepthUsd: number; askDepthUsd: number; twoSided: boolean;
};
export function bookOf(raw: unknown): GrokBook | null {
  const b = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  if (!b) return null;
  const now = bookNow(raw);
  const lv = (xs: unknown) => (Array.isArray(xs) ? xs : []).map((l) => [Number((l as Record<string, unknown>)?.price), Number((l as Record<string, unknown>)?.size)] as [number, number])
    .filter(([p, s]) => p > 0 && p < 1 && s > 0);
  const bids = lv(b.bids).sort((x, y) => y[0] - x[0]), asks = lv(b.asks).sort((x, y) => x[0] - y[0]);
  const bestBid = bids[0]?.[0] ?? null, bestAsk = asks[0]?.[0] ?? null;
  const mid = now ? (now.bestBid + now.bestAsk) / 2 : null, band = GROKPM_RULES.depthBand;
  return {
    tick: asTickSize(b.tick_size), minSize: Number(b.min_order_size) > 0 ? Number(b.min_order_size) : null, negRisk: b.neg_risk === true, bestBid, bestAsk,
    mid: mid === null ? null : r6(mid), spread: now ? r6(now.bestAsk - now.bestBid) : null,
    bidDepthUsd: mid === null ? 0 : r6(bids.filter(([p]) => p >= mid - band - 1e-9).reduce((s, [p, q]) => s + p * q, 0)),
    askDepthUsd: mid === null ? 0 : r6(asks.filter(([p]) => p <= mid + band + 1e-9).reduce((s, [p, q]) => s + p * q, 0)),
    twoSided: !!now,
  };
}

// ── the agent's own book ──────────────────────────────────────────────────────────────────────────────────────────────

export type GrokLedger = {
  fundedUsd: number; cashUsd: number; feesUsd: number; heldValueUsd: number; equityUsd: number; totalUsd: number; restingBuyUsd: number;
  freeCashUsd: number;
  held: Record<string, { cond: string; held: number; avgCost: number; mark: number | null; markFrom: "payout" | "mid" | "cost" }>;
  restingSell: Record<string, number>;
  costByCond: Record<string, number>;
  themeOf: Record<string, string>;
  costByTheme: Record<string, number>;
  openConds: string[];
};
/**
 * The agent's book from its own orders and fills only. `orders` are the current mode's (dry-run counts its own resting
 * orders the same way, so its answers are live's); `fills` are the live orders' (a dry-run order never fills).
 */
export function ledgerOf(p: {
  fundedUsd: number; orders: GrokOrderRow[]; fills: GrokFillRow[]; mids: Record<string, number | null>; payouts: Record<string, number>; nowMs: number;
}): GrokLedger {
  const counted = p.fills.filter((f) => f.status !== "FAILED");
  const pm: PmFill[] = counted.map((f) => ({ token: f.token, side: f.side, price: num(f.price), size: num(f.size), ts: f.match_time ? Date.parse(f.match_time) : p.nowMs }))
    .sort((a, b) => a.ts - b.ts || (a.side === b.side ? 0 : a.side === "BUY" ? -1 : 1));
  const books = tokenBooks(pm, Math.floor(p.nowMs / DAY) * DAY);
  const condOf = new Map<string, string>();
  for (const f of counted) condOf.set(f.token, f.cond);
  for (const o of p.orders) condOf.set(o.token, o.cond);
  let cash = p.fundedUsd, fees = 0;
  for (const f of counted) { cash += (f.side === "SELL" ? 1 : -1) * num(f.price) * num(f.size); fees += num(f.fee_usd); }
  cash -= fees;
  const held: GrokLedger["held"] = {};
  const marks: Record<string, number | null> = {};
  let heldValue = 0;
  const costByCond: Record<string, number> = {};
  for (const [token, b] of Object.entries(books)) {
    if (!(b.held > 0)) continue;
    const payout = p.payouts[token], mid = p.mids[token] ?? null;
    const mark = payout !== undefined ? payout : mid;
    const cond = condOf.get(token) ?? "";
    marks[token] = mark;
    heldValue += b.held * (mark ?? b.avgCost);
    if (!(b.held >= GROKPM_RULES.heldMin)) continue;
    held[token] = { cond, held: r6(b.held), avgCost: r6(b.avgCost), mark: mark === null ? null : r6(mark), markFrom: payout !== undefined ? "payout" : mid !== null ? "mid" : "cost" };
    // A resolved holding is not at risk any more: it no longer counts against its market's cap or the six positions.
    if (payout === undefined) costByCond[cond] = (costByCond[cond] ?? 0) + b.held * b.avgCost;
  }
  const restingSell: Record<string, number> = {};
  let restingBuy = 0;
  for (const o of p.orders.filter(isOpen)) {
    const left = Math.max(0, num(o.size) - num(o.size_matched));
    if (o.side === "BUY") { restingBuy += left * num(o.price); costByCond[o.cond] = (costByCond[o.cond] ?? 0) + left * num(o.price); }
    else restingSell[o.token] = (restingSell[o.token] ?? 0) + left;
  }
  // A market keeps the theme of its first buy.
  const themeOf: Record<string, string> = {};
  for (const o of [...p.orders].sort((a, b) => a.id - b.id)) if (o.side === "BUY" && o.theme && !(o.cond in themeOf)) themeOf[o.cond] = o.theme;
  const costByTheme: Record<string, number> = {};
  for (const [cond, c] of Object.entries(costByCond)) { const t = themeOf[cond] ?? "(none)"; costByTheme[t] = r6((costByTheme[t] ?? 0) + c); }
  for (const k of Object.keys(costByCond)) costByCond[k] = r6(costByCond[k]);
  // The total is the equity less the budget: the trades' cash and what is held at its mark (`bookPnl`'s total less fees).
  const total = cash + heldValue - p.fundedUsd;
  return {
    fundedUsd: p.fundedUsd, cashUsd: r6(cash), feesUsd: r6(fees), heldValueUsd: r6(heldValue), equityUsd: r6(cash + heldValue), totalUsd: r6(total),
    restingBuyUsd: r6(restingBuy), freeCashUsd: r6(cash - restingBuy), held, restingSell, costByCond, themeOf, costByTheme,
    openConds: Object.keys(costByCond).filter((c) => costByCond[c] > 1e-9).sort(),
  };
}

// ── the rules ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Refusal = { rule: string; why: string };
export type Gates = {
  region: string | null; mode: "dry_run" | "live"; armed: boolean; keyProblem: string | null; attestation: boolean;
  geo: { ok: boolean; country: string | null; blocked: boolean | null }; globalPause: boolean; otherArmed: string | null; closedOnly: boolean | null;
};
/** The GTD expiry the venue is sent: the asked lifetime clamped to [3, 65] minutes (35 when none), plus the venue's minute. */
export function expiryOf(expiresAt: string | null | undefined, nowMs: number): { expiration: number; lifetimeS: number; clamped: boolean } {
  const nowS = Math.floor(nowMs / 1000);
  const asked = expiresAt ? Math.floor(Date.parse(expiresAt) / 1000) - nowS : NaN;
  const want = Number.isFinite(asked) ? asked : GROKPM_RULES.defaultLifetimeS;
  const lifetimeS = Math.min(GROKPM_RULES.maxLifetimeS, Math.max(GROKPM_RULES.minLifetimeS, want));
  return { expiration: nowS + PM_GTD_EARLY_S + lifetimeS, lifetimeS, clamped: lifetimeS !== want };
}

/** Why the server would not send anything live now (the order rules aside); empty when every gate is open. */
export function liveGateRefusals(g: Gates, side: "BUY" | "SELL"): Refusal[] {
  const out: Refusal[] = [];
  if (g.region !== PM_ORDER_REGION) out.push({ rule: "region", why: `this request ran in ${g.region ?? "an unknown region"}, not ${PM_ORDER_REGION}: call with ?forceFunctionRegion=${PM_ORDER_REGION}` });
  if (g.globalPause) out.push({ rule: "global_pause", why: "the project's global pause is on: nothing is sent" });
  if (g.mode === "live") {
    if (g.keyProblem) out.push({ rule: "key", why: g.keyProblem });
    if (g.otherArmed) out.push({ rule: "one_armed", why: `${g.otherArmed} is armed on the same account` });
    if (!g.geo.ok) out.push({ rule: "geoblock", why: "the account's geoblock could not be read from the server" });
    else if (g.geo.country !== "IE") out.push({ rule: "geoblock", why: `the server's geoblock answers country ${g.geo.country ?? "unknown"}, not IE` });
    if (side === "BUY" && !g.attestation) out.push({ rule: "attestation", why: "Davies' Ireland attestation is not current: only closes" });
    if (side === "BUY" && g.closedOnly === true) out.push({ rule: "closed_only", why: "the account is closed-only at Polymarket: only closes" });
  }
  return out;
}

export type OrderPlan = { token: string; cond: string; side: "BUY" | "SELL"; price: number; size: number; postOnly: boolean; tick: PmTickSize; minSize: number; negRisk: boolean; expiration: number };
/**
 * Every rule an order breaks, given the agent's own book, the market as Gamma has it, the token's book now, today's
 * orders and the stops. Pure: the run below feeds it what it read.
 */
export function orderRefusals(p: {
  decision: Decision; theme: string | null; ledger: GrokLedger; market: GrokMarket | null; book: GrokBook | null; nowMs: number;
  dayPnlUsd: number; dailyLossUsd: number; totalStopUsd: number; ordersToday: number; maxOrdersDay: number; expiresAt?: string | null;
}): { refusals: Refusal[]; plan: OrderPlan | null } {
  const d = p.decision, out: Refusal[] = [];
  const R = GROKPM_RULES;
  if (d.action !== "open" && d.action !== "close") return { refusals: [{ rule: "action", why: "an order's decision is an open (a BUY) or a close (a SELL)" }], plan: null };
  const side = d.side!, price = d.price!, size = d.size!, token = d.token_id!, cond = d.market_id!;
  if (p.ordersToday >= p.maxOrdersDay) out.push({ rule: "orders_day", why: `${p.ordersToday} orders today, at most ${p.maxOrdersDay}` });
  const m = p.market, b = p.book;
  if (!m) out.push({ rule: "market", why: `Gamma has no open market ${cond}` });
  else {
    if (m.cond !== cond) out.push({ rule: "market", why: `token ${token} belongs to ${m.cond}, not ${cond}` });
    if (!m.tokens.includes(token)) out.push({ rule: "market", why: `token ${token} is not one of ${cond}'s outcomes` });
    if (!m.accepting) out.push({ rule: "market", why: "the market does not accept orders (closed or paused)" });
  }
  if (!b || !b.tick || !b.minSize) out.push({ rule: "book", why: "the token's book could not be read (no tick or minimum size)" });
  const exp = expiryOf(p.expiresAt, p.nowMs);
  if (side === "BUY") {
    const L = p.ledger;
    if (price < R.longshotUnder) out.push({ rule: "longshot", why: `a buy under ${R.longshotUnder} is forbidden` });
    if (price >= R.favouriteMin && d.category !== "A") out.push({ rule: "favourite", why: `a buy at ${R.favouriteMin} or above is category A only` });
    if (L.totalUsd <= -p.totalStopUsd) out.push({ rule: "total_stop", why: `the book is ${L.totalUsd.toFixed(2)} from the budget, at or past −${p.totalStopUsd}: close only` });
    if (p.dayPnlUsd <= -p.dailyLossUsd) out.push({ rule: "day_stop", why: `the UTC day is ${p.dayPnlUsd.toFixed(2)}, at or past −${p.dailyLossUsd}: no new open until 00:00 UTC` });
    const cost = price * size;
    const inMarket = (L.costByCond[cond] ?? 0) + cost;
    if (inMarket > R.marketCapUsd + 1e-9) out.push({ rule: "market_cap", why: `this market would hold ${inMarket.toFixed(2)} at cost, over ${R.marketCapUsd}` });
    if (!L.openConds.includes(cond) && L.openConds.length >= R.maxPositions) out.push({ rule: "positions", why: `${L.openConds.length} markets open, at most ${R.maxPositions}` });
    const theme = L.themeOf[cond] ?? p.theme;
    if (!p.theme) out.push({ rule: "theme", why: "an open names its theme (`theme`)" });
    else if (L.themeOf[cond] && L.themeOf[cond] !== p.theme) out.push({ rule: "theme", why: `this market is already under the theme "${L.themeOf[cond]}"` });
    else if ((L.costByTheme[theme!] ?? 0) + cost > R.themeCapUsd + 1e-9) out.push({ rule: "theme_cap", why: `the theme "${theme}" would hold ${((L.costByTheme[theme!] ?? 0) + cost).toFixed(2)}, over ${R.themeCapUsd}` });
    if (L.freeCashUsd - cost < R.cashFloorUsd - 1e-9) out.push({ rule: "cash_floor", why: `cash after it would be ${(L.freeCashUsd - cost).toFixed(2)}, under ${R.cashFloorUsd}` });
    if (m) {
      const end = timeMs(m.endDate);
      if (end === null) out.push({ rule: "end_date", why: "the market names no end date" });
      else if (end > p.nowMs + R.maxDaysToEnd * DAY) out.push({ rule: "end_date", why: `it resolves ${((end - p.nowMs) / DAY).toFixed(1)} days out, more than ${R.maxDaysToEnd}` });
      const soon = (end !== null && end <= p.nowMs + R.shortDays * DAY) || ((timeMs(m.gameStartTime) ?? Infinity) <= p.nowMs + R.shortDays * DAY);
      if (m.sports && soon) out.push({ rule: "sports", why: "a sports market playing or ending within 7 days" });
      if (m.crypto && end !== null && end <= p.nowMs + R.shortDays * DAY) out.push({ rule: "crypto", why: "a crypto price market ending within 7 days" });
    }
    if (b) {
      if (!b.twoSided || b.mid === null) out.push({ rule: "thin", why: "the book is one-sided" });
      else {
        if (b.spread! > R.thinSpread + 1e-9) out.push({ rule: "thin", why: `the spread is ${(b.spread! * 100).toFixed(1)} points, over 5` });
        if (b.bidDepthUsd < R.thinDepthUsd) out.push({ rule: "thin", why: `$${b.bidDepthUsd.toFixed(0)} bid within 5 points of the mid, under $${R.thinDepthUsd}` });
        if (b.bestAsk !== null && price >= b.bestAsk - 1e-9) out.push({ rule: "post_only", why: `a buy at ${price} would take the ask ${b.bestAsk}: an open rests (post-only)` });
      }
    }
  } else {
    const h = p.ledger.held[token];
    const free = (h?.held ?? 0) - (p.ledger.restingSell[token] ?? 0);
    if (!h) out.push({ rule: "not_owned", why: "the agent holds none of this token from its own buys: it sells only what it bought" });
    else if (size > free + 1e-9) out.push({ rule: "not_owned", why: `it may sell at most ${r6(Math.max(0, free))} of this token (its own fills less its resting sells)` });
  }
  let postOnly = true;
  if (side === "SELL" && b && b.bestBid !== null && price <= b.bestBid + 1e-9) {
    if (d.category === "C") postOnly = false;
    else out.push({ rule: "post_only", why: `a sell at ${price} would take the bid ${b.bestBid}: only a close of category C (a broken thesis) may cross` });
  }
  if (b?.tick && b.minSize) for (const why of orderProblems({ price, size, expiration: exp.expiration }, { tick: b.tick, minSize: b.minSize, nowS: Math.floor(p.nowMs / 1000) })) out.push({ rule: "venue", why });
  const plan = b?.tick && b.minSize ? { token, cond, side, price, size, postOnly, tick: b.tick, minSize: b.minSize, negRisk: m?.negRisk ?? b.negRisk, expiration: exp.expiration } : null;
  return { refusals: out, plan };
}

// ── the runs ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ExecDeps = {
  db: Db; venue: GrokVenue; now: number; region: string | null;
  /** The signing key, loaded for the stored signer; null in dry-run or when it is not (`keyProblem`). */
  signer: PmSigner | null; keyProblem: string | null;
  /** The account: its proxy wallet (an order's maker) and its signer EOA. Never returned to the agent. */
  account: { maker: string; signer: string } | null;
  salt?: () => string;
};
export type ExecContext = {
  cfg: GrokConfig; mode: "dry_run" | "live"; gates: Gates; ledger: GrokLedger; dayPnlUsd: number; dayOpenEquityUsd: number; orders: GrokOrderRow[];
  ordersToday: number; state: Record<string, unknown>; errors: string[];
};

const openOrdersQuery = `state=in.(pending,live)&select=*&order=id.asc&limit=500`;

/** Read back each open live order by its hash, and book the trades it names; expire what can no longer rest. */
export async function syncOrders(deps: ExecDeps, errors: string[]): Promise<{ read: number; fills: number; settled: number }> {
  const { db, venue, now } = deps;
  const nowIso = iso(now), nowS = Math.floor(now / 1000);
  const open = await db.select<GrokOrderRow>("grokpm_orders", openOrdersQuery);
  let read = 0, fills = 0, settled = 0;
  for (const o of open) {
    if (o.mode === "dry_run") {
      // A dry-run order never fills; it ends when the venue would have ended it.
      if (num(o.expiration) - PM_GTD_EARLY_S <= nowS) { await db.update("grokpm_orders", `id=eq.${o.id}`, { state: "expired", cancelled_at: nowIso, updated_at: nowIso }); settled++; }
      continue;
    }
    const r = await venue.order(o.hash);
    read++;
    if (!r.ok || !r.data) {
      if (r.status === 404 && num(o.expiration) - PM_GTD_EARLY_S <= nowS) {
        await db.update("grokpm_orders", `id=eq.${o.id}`, { state: "expired", cancelled_at: nowIso, updated_at: nowIso }); settled++;
      } else if (r.status !== 404) errors.push(`order ${o.hash.slice(0, 12)}… unread: ${r.status} ${r.error ?? ""}`);
      continue;
    }
    const v = r.data as PmOpenOrder;
    const state = stateOfStatus(v.status), matched = num(v.size_matched);
    if (!state) { errors.push(`order ${o.hash.slice(0, 12)}…: the venue says ${v.status}; left as it is`); continue; }
    const patch: Record<string, unknown> = {};
    if (state !== o.state) patch.state = state;
    if (matched !== num(o.size_matched)) patch.size_matched = matched;
    if (state === "filled" && !o.filled_at) patch.filled_at = nowIso;
    if ((state === "cancelled" || state === "rejected") && !o.cancelled_at) patch.cancelled_at = nowIso;
    if (Object.keys(patch).length) { await db.update("grokpm_orders", `id=eq.${o.id}`, { ...patch, updated_at: nowIso }); settled++; }
    if (matched > 0 && Array.isArray(v.associate_trades)) {
      for (const id of v.associate_trades.map(String)) {
        const t = await venue.trade(id);
        const tr: PmTrade | undefined = t.ok ? (t.data?.data ?? []).find((x) => x.id === id) : undefined;
        if (!tr) { errors.push(`trade ${id} unread: ${t.status} ${t.error ?? "not in the reply"}`); continue; }
        const f = tradeFillOf(tr, { hash: o.hash, token: o.token, price: num(o.price) }), status = tradeStatus(tr.status);
        if (!f || !(f.size > 0) || !(f.price > 0 && f.price < 1) || !status) { errors.push(`trade ${id}: no fill of ${o.hash.slice(0, 12)}… in it`); continue; }
        await db.upsert("grokpm_fills", [{
          trade_id: id, hash: o.hash, cond: o.cond, token: o.token, side: o.side, price: f.price, size: f.size, taker: f.taker,
          fee_usd: r6(pmLiveFillFee(f.size, f.price, tr.trader_side, tr.fee_rate_bps)), status,
          match_time: Number(tr.match_time) > 0 ? iso(Number(tr.match_time) * 1000) : null, tx_hash: tr.transaction_hash ? String(tr.transaction_hash).toLowerCase() : null,
          detail: { trade: tr }, updated_at: nowIso,
        }], "trade_id,hash");
        fills++;
      }
    }
  }
  return { read, fills, settled };
}

/**
 * Everything a request decides on: the config and mode, the gates, the agent's own book at the mids read now, the day's
 * opening equity (the first reading of each UTC day, kept in `grokpm_exec_state`), and today's order count.
 */
export async function context(deps: ExecDeps, opts: { readGeo: boolean; sync: boolean }): Promise<ExecContext> {
  const { db, venue, now } = deps;
  const errors: string[] = [];
  const cfg = (await db.select<GrokConfig>("grokpm_config", `id=eq.1&select=${GROKPM_CONFIG_SELECT}`))[0];
  if (!cfg) throw new Error("grokpm_config has no row");
  const armed = cfg.dry_run === false && !!cfg.armed_at;
  const mode: "dry_run" | "live" = armed ? "live" : "dry_run";
  if (opts.sync) await syncOrders(deps, errors).catch((e) => { errors.push(`sync: ${(e as Error).message}`); });
  const st = (await db.select<{ state: Record<string, unknown> | null }>("grokpm_exec_state", "id=eq.1&select=state"))[0]?.state ?? {};
  const [orders, fills, risk, others, resolutions] = await Promise.all([
    db.select<GrokOrderRow>("grokpm_orders", `mode=eq.${mode}&select=*&order=id.asc&limit=1000`),
    db.select<GrokFillRow>("grokpm_fills", "select=*&order=trade_id.asc,hash.asc&limit=1000"),
    // Unreadable, the pause is taken as on: nothing is sent on a guess.
    db.select<{ global_pause: boolean }>("agent_risk", "id=eq.1&select=global_pause").catch(() => [{ global_pause: true }]),
    Promise.all(["pm_live_config", "pm_mid_config", "pm_lp_config"].map((t) => db.select<{ live_confirmed_at: string | null }>(t, "id=eq.1&select=live_confirmed_at")
      .then((r) => (r[0]?.live_confirmed_at ? t : null)).catch(() => t))),
    db.select<{ cond: string; tokens: unknown; payouts: unknown }>("grokpm_resolutions", "select=cond,tokens,payouts&order=cond.asc&limit=1000").catch(() => []),
  ]);
  if (orders.length >= 1000 || fills.length >= 1000) throw new Error("the agent's record is over 1,000 rows: refusing rather than reading part of it");
  const liveFills = mode === "live" ? fills : [];
  const payouts: Record<string, number> = {};
  for (const r of resolutions) {
    const t = Array.isArray(r.tokens) ? r.tokens.map(String) : [], p = Array.isArray(r.payouts) ? r.payouts.map(Number) : [];
    t.forEach((tok, i) => { if (Number.isFinite(p[i])) payouts[tok] = p[i]; });
  }
  // The mids of what the agent holds.
  const heldTokens = [...new Set(liveFills.map((f) => f.token))].filter((t) => payouts[t] === undefined);
  const mids: Record<string, number | null> = {};
  for (const t of heldTokens) {
    const b = await venue.book(t);
    mids[t] = b.ok ? bookOf(b.data)?.mid ?? null : null;
  }
  const funded = num(cfg.funded_usd);
  const ledger = ledgerOf({ fundedUsd: funded, orders, fills: liveFills, mids, payouts, nowMs: now });
  // The day's opening equity: the first reading of the UTC day (the start's own day opens at the budget).
  const today = iso(now).slice(0, 10);
  let dayOpen = (st.dayOpen ?? null) as { day: string; equityUsd: number } | null;
  if (!dayOpen || dayOpen.day !== today) {
    dayOpen = { day: today, equityUsd: cfg.started_at && cfg.started_at.slice(0, 10) === today ? funded : ledger.equityUsd };
    st.dayOpen = dayOpen;
  }
  // The geoblock from here: a good reading kept ten minutes, so a failed read does not stop a close.
  let geo = { ok: false, country: null as string | null, blocked: null as boolean | null };
  if (opts.readGeo) {
    const g = await venue.geoblock();
    if (g.ok) { geo = { ok: true, country: g.data?.country ?? null, blocked: g.data?.blocked ?? null }; st.geoGood = { at: iso(now), country: geo.country, blocked: geo.blocked }; }
    else {
      const last = st.geoGood as { at: string; country: string | null; blocked: boolean | null } | undefined;
      if (last && now - Date.parse(last.at) <= GROKPM_GEO_CACHE_MS) geo = { ok: true, country: last.country, blocked: last.blocked };
    }
  }
  let closedOnly: boolean | null = null;
  if (opts.readGeo && mode === "live") { const c = await venue.closedOnly(); closedOnly = c.ok ? c.data?.closed_only === true : null; }
  await db.update("grokpm_exec_state", "id=eq.1", { state: st, updated_at: iso(now), last_error: errors.length ? errors.join("; ").slice(0, 500) : null });
  const dayStart = Math.floor(now / DAY) * DAY;
  return {
    cfg, mode, ledger, dayOpenEquityUsd: dayOpen.equityUsd, dayPnlUsd: r6(ledger.equityUsd - dayOpen.equityUsd), orders, state: st, errors,
    ordersToday: orders.filter((o) => Date.parse(o.created_at) >= dayStart).length,
    gates: {
      region: deps.region, mode, armed, keyProblem: deps.signer && deps.account ? null : deps.keyProblem ?? "no signing key or account loaded",
      attestation: attestationCurrent({ ireland_attested_at: cfg.ireland_attested_at, ireland_until: cfg.ireland_until }, now), geo,
      globalPause: risk[0]?.global_pause === true, otherArmed: others.find((x) => x) ?? null, closedOnly,
    },
  };
}

/** The agent's view of its own book: what `GET ?action=account` answers. Nothing of the shared wallet's own holdings. */
export function accountView(c: ExecContext, nowMs: number) {
  const L = c.ledger, cfg = c.cfg;
  const dayLimit = num(cfg.daily_loss_usd), totalLimit = num(cfg.total_stop_usd);
  const nowS = Math.floor(nowMs / 1000);
  return {
    mode: c.mode, armed: c.gates.armed, started_at: cfg.started_at, region: c.gates.region,
    gates: {
      geoblock: c.gates.geo, attestation: c.gates.attestation, global_pause: c.gates.globalPause, closed_only: c.gates.closedOnly,
      other_path_armed: !!c.gates.otherArmed, key_loaded: !c.gates.keyProblem,
    },
    budget: {
      funded_usd: L.fundedUsd, cash_usd: L.cashUsd, resting_buys_usd: L.restingBuyUsd, free_cash_usd: L.freeCashUsd, cash_floor_usd: GROKPM_RULES.cashFloorUsd,
      spendable_usd: r6(Math.max(0, L.freeCashUsd - GROKPM_RULES.cashFloorUsd)), held_value_usd: L.heldValueUsd, equity_usd: L.equityUsd, fees_usd: L.feesUsd,
      total_pnl_usd: L.totalUsd, day_pnl_usd: c.dayPnlUsd, day_stop_usd: -dayLimit, total_stop_usd: -totalLimit,
      day_room_usd: r6(dayLimit + c.dayPnlUsd), total_room_usd: r6(totalLimit + L.totalUsd),
      can_open: L.totalUsd > -totalLimit && c.dayPnlUsd > -dayLimit, orders_today: c.ordersToday, max_orders_day: cfg.max_orders_day,
      markets_open: L.openConds.length, max_markets: GROKPM_RULES.maxPositions, market_cap_usd: GROKPM_RULES.marketCapUsd,
      theme_cap_usd: GROKPM_RULES.themeCapUsd, cost_by_theme: L.costByTheme, cost_by_market: L.costByCond,
    },
    positions: Object.entries(L.held).map(([token, h]) => ({
      market_id: h.cond, token_id: token, size: h.held, avg_price: h.avgCost, mark: h.mark, mark_from: h.markFrom,
      value_usd: r6(h.held * (h.mark ?? h.avgCost)), unrealised_usd: h.markFrom === "payout" ? 0 : r6(h.held * ((h.mark ?? h.avgCost) - h.avgCost)),
      resting_sell: r6(L.restingSell[token] ?? 0), theme: L.themeOf[h.cond] ?? null,
    })),
    open_orders: c.orders.filter(isOpen).map((o) => ({
      order_id: o.hash, decision_id: o.decision_id, market_id: o.cond, token_id: o.token, side: o.side, price: num(o.price), size: num(o.size),
      size_matched: num(o.size_matched), post_only: o.post_only, state: o.state, expires_at: iso((num(o.expiration) - PM_GTD_EARLY_S) * 1000),
      expires_in_s: Math.max(0, num(o.expiration) - PM_GTD_EARLY_S - nowS), theme: o.theme,
    })),
  };
}

/** A market's facts for the agent (`GET ?action=market`): its Gamma record, each outcome's book, and what the open rules say. */
export async function marketView(deps: ExecDeps, q: { cond?: string; token?: string }) {
  const g = await deps.venue.gamma(q);
  if (!g.ok) return { status: 502, body: { error: "Gamma unreadable", detail: g.error ?? String(g.status) } };
  const m = marketOf((g.data?.markets ?? [])[0]);
  if (!m) return { status: 404, body: { error: "no open market for that id" } };
  const books = await Promise.all(m.tokens.map(async (t, i) => {
    const r = await deps.venue.book(t);
    const b = r.ok ? bookOf(r.data) : null;
    return {
      token_id: t, outcome: m.outcomes[i] ?? null, best_bid: b?.bestBid ?? null, best_ask: b?.bestAsk ?? null, mid: b?.mid ?? null, spread: b?.spread ?? null,
      bid_depth_usd_5pt: b?.bidDepthUsd ?? 0, ask_depth_usd_5pt: b?.askDepthUsd ?? 0, tick: b?.tick ?? null, min_size: b?.minSize ?? null,
      thin: !b || !b.twoSided || (b.spread ?? 1) > GROKPM_RULES.thinSpread + 1e-9 || b.bidDepthUsd < GROKPM_RULES.thinDepthUsd,
    };
  }));
  const end = timeMs(m.endDate), now = deps.now, R = GROKPM_RULES;
  const blocks: string[] = [];
  if (!m.accepting) blocks.push("not accepting orders");
  if (end === null) blocks.push("no end date");
  else if (end > now + R.maxDaysToEnd * DAY) blocks.push("resolves more than 30 days out");
  const soon = (end !== null && end <= now + R.shortDays * DAY) || ((timeMs(m.gameStartTime) ?? Infinity) <= now + R.shortDays * DAY);
  if (m.sports && soon) blocks.push("sports within 7 days");
  if (m.crypto && end !== null && end <= now + R.shortDays * DAY) blocks.push("crypto price market within 7 days");
  return {
    status: 200, body: {
      market_id: m.cond, question: m.question, end_date: m.endDate, neg_risk: m.negRisk, accepting_orders: m.accepting, closed: m.closed,
      fee_type: m.feeType, tags: m.tags, sports: m.sports, crypto: m.crypto, game_start_time: m.gameStartTime, tick: m.tick, min_size: m.minSize,
      outcomes: books, open_blocked_by: blocks,
    },
  };
}

/**
 * One order, from its decision: the decision is validated as the journal validates it, every rule is checked, and only
 * then is the decision journalled and the order written and (armed) signed and sent. A decision id already used answers
 * the order it made (a resend is not a second order).
 */
export async function placeOrder(deps: ExecDeps, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const unknown = Object.keys(b).filter((k) => !["decision", "theme", "expires_at"].includes(k));
  const errors: string[] = unknown.map((k) => `${k}: unknown field`);
  const theme = b.theme === undefined || b.theme === null ? null : typeof b.theme === "string" && /^[\p{L}\p{N} ._:/-]{1,64}$/u.test(b.theme) ? b.theme : (errors.push("theme: 1–64 letters, digits, spaces or . _ : / -"), null);
  const expiresAt = b.expires_at === undefined || b.expires_at === null ? null
    : typeof b.expires_at === "string" && Number.isFinite(Date.parse(b.expires_at)) ? b.expires_at : (errors.push("expires_at: an ISO 8601 time"), null);
  const decision = decisionOf(b.decision, "decision", deps.now, errors);
  if (errors.length || !decision) return { status: 422, body: { error: "invalid", errors: errors.slice(0, 20) } };
  if (decision.action !== "open" && decision.action !== "close") return { status: 422, body: { error: "invalid", errors: ["decision.action: an order is an open or a close"] } };
  const { db, now } = deps;
  const done = (await db.select<GrokOrderRow>("grokpm_orders", `decision_id=eq.${encodeURIComponent(decision.id)}&select=*&limit=1`))[0];
  if (done) return { status: 200, body: { ok: true, duplicate: true, order: orderOut(done) } };
  const c = await context(deps, { readGeo: true, sync: true });
  const [g, bk] = await Promise.all([deps.venue.gamma({ cond: decision.market_id! }), deps.venue.book(decision.token_id!)]);
  const market = g.ok ? marketOf((g.data?.markets ?? []).find((x) => String(x.conditionId ?? "").toLowerCase() === decision.market_id)) : null;
  const book = bk.ok ? bookOf(bk.data) : null;
  const { refusals, plan } = orderRefusals({
    decision, theme, ledger: c.ledger, market, book, nowMs: now, dayPnlUsd: c.dayPnlUsd, dailyLossUsd: num(c.cfg.daily_loss_usd),
    totalStopUsd: num(c.cfg.total_stop_usd), ordersToday: c.ordersToday, maxOrdersDay: c.cfg.max_orders_day, expiresAt,
  });
  const gateRefusals = liveGateRefusals(c.gates, decision.side!);
  const all = [...gateRefusals, ...refusals];
  if (all.length || !plan) return { status: 422, body: { error: "refused", mode: c.mode, refusals: all.length ? all : [{ rule: "book", why: "no order could be built" }] } };
  const maker = deps.account?.maker ?? "0x0000000000000000000000000000000000000001", signerAddr = deps.account?.signer ?? "0x0000000000000000000000000000000000000002";
  const built = buildOrder({
    tokenId: plan.token, side: plan.side, price: plan.price, size: plan.size, tick: plan.tick, negRisk: plan.negRisk, maker, signer: signerAddr,
    salt: (deps.salt ?? newSalt)(), timestampMs: now, expiration: plan.expiration,
  });
  // Journal first (the decision as sent), then the order's claim, then the send.
  const raw = (b.decision ?? null) as unknown;
  await db.insert("grokpm_decisions", [{ ...decision, order_id: built.hash, raw }], false);
  const request = { ...built.order, exchange: built.exchange, orderType: "GTD", postOnly: plan.postOnly, maker: undefined, signer: undefined };
  const [row] = await db.insert<GrokOrderRow>("grokpm_orders", {
    mode: c.mode, created_at: iso(now), decision_id: decision.id, cond: plan.cond, token: plan.token, outcome: decision.outcome, side: plan.side, price: plan.price, size: plan.size,
    post_only: plan.postOnly, expiration: plan.expiration, neg_risk: plan.negRisk, hash: built.hash, theme: plan.side === "BUY" ? c.ledger.themeOf[plan.cond] ?? theme : theme,
    category: decision.category, state: "pending", request,
  }, true);
  if (c.mode === "dry_run") {
    await db.update("grokpm_orders", `id=eq.${row.id}`, { state: "live", response: { dryRun: true }, updated_at: iso(now) });
    return { status: 200, body: { ok: true, mode: "dry_run", sent: false, would_send: wouldSend(plan), order: orderOut({ ...row, state: "live" }) } };
  }
  let out: { state: "live" | "rejected" | "pending"; why: string };
  let response: Record<string, unknown>;
  try {
    const signature = deps.signer!.signDigest(built.hash);
    const reply = await deps.venue.postOrder({ ...built.order, signature }, "GTD", plan.postOnly);
    out = postOutcome(reply, built.hash);
    response = { status: reply.status, ok: reply.ok, data: reply.data ?? null, error: reply.error ?? null, refused: reply.refused ?? null, why: out.why };
  } catch (e) {
    out = { state: "pending", why: `no reply (${(e as Error).message.slice(0, 120)}): settled by read-back` };
    response = { why: out.why };
  }
  const patch = out.state === "rejected" ? { state: "rejected", cancelled_at: iso(now), response } : out.state === "live" ? { state: "live", response } : { response };
  await db.update("grokpm_orders", `id=eq.${row.id}`, { ...patch, updated_at: iso(now) });
  const final = { ...row, ...(patch as Partial<GrokOrderRow>) };
  return { status: out.state === "rejected" ? 409 : 200, body: { ok: out.state !== "rejected", mode: "live", sent: true, venue: out.why, order: orderOut(final) } };
}

const wouldSend = (p: OrderPlan) => ({ token_id: p.token, side: p.side, price: p.price, size: p.size, post_only: p.postOnly, order_type: "GTD", expires_at: iso((p.expiration - PM_GTD_EARLY_S) * 1000) });
function orderOut(o: GrokOrderRow) {
  return {
    order_id: o.hash, decision_id: o.decision_id, mode: o.mode, market_id: o.cond, token_id: o.token, side: o.side, price: num(o.price), size: num(o.size),
    post_only: o.post_only, state: o.state, size_matched: num(o.size_matched), expires_at: iso((num(o.expiration) - PM_GTD_EARLY_S) * 1000), theme: o.theme,
  };
}

/**
 * Cancel the agent's own open orders: one (`order_id`) or all of them, each by its own id, never the venue's cancel-all
 * (which would cancel every order of the shared account). An optional `decision` (action `cancel`) is journalled.
 */
export async function cancelOrders(deps: ExecDeps, body: unknown, all: boolean): Promise<{ status: number; body: Record<string, unknown> }> {
  const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const errors = Object.keys(b).filter((k) => !["order_id", "decision"].includes(k)).map((k) => `${k}: unknown field`);
  if (!all && !(typeof b.order_id === "string" && HASH.test(b.order_id))) errors.push("order_id: one of your order ids (0x and 64 hex digits)");
  const decision = b.decision === undefined ? null : decisionOf(b.decision, "decision", deps.now, errors);
  if (decision && decision.action !== "cancel") errors.push("decision.action: cancel");
  if (errors.length) return { status: 422, body: { error: "invalid", errors: errors.slice(0, 20) } };
  const { db, venue, now } = deps;
  const open = (await db.select<GrokOrderRow>("grokpm_orders", openOrdersQuery)).filter((o) => all || o.hash === b.order_id);
  if (!all && !open.length) return { status: 404, body: { error: "no open order of yours with that id" } };
  if (decision) await db.insert("grokpm_decisions", [{ ...decision, raw: b.decision }], false).catch(() => {});
  const out: Array<Record<string, unknown>> = [];
  for (const o of open) {
    await db.update("grokpm_orders", `id=eq.${o.id}`, { cancel_requested_at: iso(now), updated_at: iso(now) });
    if (o.mode === "dry_run") {
      await db.update("grokpm_orders", `id=eq.${o.id}`, { state: "cancelled", cancelled_at: iso(now), updated_at: iso(now) });
      out.push({ order_id: o.hash, state: "cancelled", sent: false });
      continue;
    }
    if (deps.region !== PM_ORDER_REGION) { out.push({ order_id: o.hash, state: o.state, error: `not ${PM_ORDER_REGION}` }); continue; }
    const c = await venue.cancelOrder(o.hash).catch((e) => ({ ok: false, status: 0, ms: 0, error: (e as Error).message } as PmReply));
    const r = await venue.order(o.hash);
    const state = r.ok && r.data ? stateOfStatus(r.data.status) : null;
    if (state && state !== o.state) await db.update("grokpm_orders", `id=eq.${o.id}`, { state, ...(state === "cancelled" ? { cancelled_at: iso(now) } : {}), updated_at: iso(now) });
    out.push({ order_id: o.hash, state: state ?? o.state, cancel_answer: c.ok ? "taken" : `${c.status} ${c.error ?? ""}`.trim(), sent: true });
  }
  return { status: 200, body: { ok: true, cancelled: out } };
}
