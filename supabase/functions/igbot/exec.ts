// IGBOT's order path: the outside Grok agent trades IG spread bets through THIS server, on IG's demo environment, and never
// holds a credential (the GROKPM design, docs/agents/reviews/2026-10-15-grokpm-prereg.md D2, carried to IG; this bot's
// research and draft pre-registration are docs/agents/reviews/2026-10-29-igbot-*.md).
//
// Every request that would change the account arrives with the journal decision that justifies it. The server reads the
// account and the market from IG, runs `rules.ts` over them, and refuses with every reason (HTTP 422, `refusals`) unless all
// pass. Then it journals the decision, writes the order row with its deal reference BEFORE the send, sends it (in mode
// 'demo'), reads IG's confirmation, and books what IG says. In mode 'dry_run' everything is checked and journalled and the
// answer says what would have been sent; nothing is sent.
//
// The book is the demo account's own: its equity as IG reports it (balance plus unrealised P&L), measured from the start
// and from each UTC day's first reading, so funding, the guaranteed-stop premiums and IG's fills are all in it. That needs
// the account to be the bot's alone: nobody deals in it by hand.
//
// One request at a time decides on the book: a lease on `igbot_exec_state` (60 s), taken by every action that sends and by
// the minute's sync; a second request meanwhile is answered 409 `busy`. A request holds it again just before it sends
// (`holdLease`): IG answers in up to 10 s a call and several are read first, so a lease that ran out meanwhile sends nothing.

import type { Db } from "../agents/db.ts";
import { type Decision, decisionOf, isObj } from "./ingest.ts";
import {
  amendRefusals, bookOf, type Book, closeLimitLevel, closeRefusals, type DealingRule, type Direction, gateRefusals, type Gates, IGBOT_RELEASE_MS, IGBOT_RULES,
  igGoodTill, type IgMarket, type IgPosition, type IgWorkingOrder, inWeekend, openRefusals, overdue, positionRisk, positionUpl, type Refusal, releaseAt,
  rulePoints, stopLatches, workingRisk,
} from "./rules.ts";

const iso = (ms: number) => new Date(ms).toISOString();
const num = (x: unknown): number | null => {
  const v = typeof x === "string" ? Number(x) : x;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};
const r2 = (x: number) => Math.round(x * 100) / 100;
export const IGBOT_LEASE_MS = 60_000;
const SLOT_MS = 5 * 60e3;
/** A position IG no longer lists, with no close in its history yet, stays open this long before it is booked closed `unknown`. */
export const IGBOT_MISSING_GRACE_MS = 15 * 60e3;
/** The server's own close of a position held five days is tried again at most this often after a refusal. */
export const IGBOT_AUTO_CLOSE_RETRY_MS = 10 * 60e3;
/** IG's HOUR bars kept for the reading (`igbot_bars`): each market at most once an hour, at most this many a sync. */
export const IGBOT_BARS_PER_SYNC = 2;
/** The deal references the server writes; IG keeps them on the position an open or a filled working order makes. */
export const IGBOT_REF_PREFIX = "IGB-";
const DEAL_REF_RE = /^[A-Za-z0-9_-]{1,30}$/;

// ── IG's answers, read ────────────────────────────────────────────────────────────────────────────────────────────

const ruleOf = (x: unknown): DealingRule => {
  if (!isObj(x)) return null;
  const v = num(x.value);
  return v === null ? null : { unit: x.unit === "PERCENTAGE" ? "PERCENTAGE" : "POINTS", value: v };
};
/**
 * A guaranteed-stop premium in points. IG states it as a dealing rule, `{value, unit}`; a PERCENTAGE premium is a share of
 * the level (until the 2026-10-29 audit its value was read as points whatever the unit, understating the risk).
 */
export const premiumOf = (x: unknown, level: number | null): number => {
  if (!isObj(x)) return num(x) ?? 0;
  const v = num(x.value);
  if (v === null) return 0;
  if (x.unit !== "PERCENTAGE") return v;
  return level === null ? Infinity : Math.round((v / 100) * level * 1e4) / 1e4;
};
const timeMs = (x: unknown): number | null => {
  if (typeof x !== "string" || !x) return null;
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(x) ? x : `${x.replace(" ", "T")}Z`);
  return Number.isFinite(t) ? t : null;
};

/** A market from `GET /markets/{epic}` (v3) or one item of `GET /markets?epics=` (v2): null when it names no epic. */
export function marketOf(raw: unknown): IgMarket | null {
  if (!isObj(raw)) return null;
  const ins = isObj(raw.instrument) ? raw.instrument : {}, dr = isObj(raw.dealingRules) ? raw.dealingRules : {}, sn = isObj(raw.snapshot) ? raw.snapshot : {};
  if (typeof ins.epic !== "string") return null;
  const ccys = Array.isArray(ins.currencies) ? ins.currencies : [];
  const bid = num(sn.bid), offer = num(sn.offer);
  return {
    epic: ins.epic, name: String(ins.name ?? ""), type: String(ins.type ?? ""), expiry: String(ins.expiry ?? ""), status: String(sn.marketStatus ?? "UNKNOWN"),
    bid, offer, minDealSize: (isObj(dr.minDealSize) ? num(dr.minDealSize.value) : null) ?? Infinity,
    minGsDistance: ruleOf(dr.minControlledRiskStopDistance), gsPremium: premiumOf(ins.limitedRiskPremium, offer ?? bid),
    gbp: ccys.some((c) => isObj(c) && c.code === "GBP"), updateTime: typeof sn.updateTime === "string" ? sn.updateTime : null,
    minLimitDistance: ruleOf(dr.minNormalStopOrLimitDistance), maxStopLimitDistance: ruleOf(dr.maxStopOrLimitDistance),
    dayHigh: num(sn.high), dayLow: num(sn.low),
  };
}

/** `GET /positions` (v2) as the rules read it. */
export function positionsOf(raw: unknown): IgPosition[] {
  const list = isObj(raw) && Array.isArray(raw.positions) ? raw.positions : [];
  const out: IgPosition[] = [];
  for (const it of list) {
    if (!isObj(it) || !isObj(it.position) || !isObj(it.market)) continue;
    const p = it.position, m = it.market;
    const size = num(p.size), level = num(p.level);
    if (typeof p.dealId !== "string" || typeof m.epic !== "string" || size === null || level === null || (p.direction !== "BUY" && p.direction !== "SELL")) continue;
    out.push({
      dealId: p.dealId, dealReference: typeof p.dealReference === "string" ? p.dealReference : null, epic: m.epic, direction: p.direction, size, level,
      stopLevel: num(p.stopLevel), limitLevel: num(p.limitLevel), guaranteed: p.controlledRisk === true, premium: premiumOf(p.limitedRiskPremium, level),
      createdMs: timeMs(p.createdDateUTC ?? p.createdDate), bid: num(m.bid), offer: num(m.offer),
      marketStatus: typeof m.marketStatus === "string" ? m.marketStatus : null,
    });
  }
  return out;
}

/** `GET /workingorders` (v2) as the rules read it. */
export function workingOf(raw: unknown): IgWorkingOrder[] {
  const list = isObj(raw) && Array.isArray(raw.workingOrders) ? raw.workingOrders : [];
  const out: IgWorkingOrder[] = [];
  for (const it of list) {
    if (!isObj(it) || !isObj(it.workingOrderData)) continue;
    const w = it.workingOrderData;
    const size = num(w.orderSize), level = num(w.orderLevel);
    if (typeof w.dealId !== "string" || typeof w.epic !== "string" || size === null || level === null || (w.direction !== "BUY" && w.direction !== "SELL")) continue;
    out.push({
      dealId: w.dealId, epic: w.epic, direction: w.direction, size, level, type: String(w.orderType ?? ""), goodTillMs: timeMs(w.goodTillDateISO ?? w.goodTillDate),
      guaranteed: w.guaranteedStop === true, stopDistance: num(w.stopDistance), limitDistance: num(w.limitDistance), premium: premiumOf(w.limitedRiskPremium, level),
      dealReference: typeof w.dealReference === "string" ? w.dealReference : null,
    });
  }
  return out;
}

export type IgConfirm = { dealStatus: string; reason: string | null; dealId: string | null; level: number | null; size: number | null; status: string | null; profit: number | null };
/** `GET /confirms/{dealReference}`. */
export function confirmOf(raw: unknown): IgConfirm | null {
  if (!isObj(raw) || typeof raw.dealStatus !== "string") return null;
  return {
    dealStatus: raw.dealStatus, reason: typeof raw.reason === "string" ? raw.reason : null, dealId: typeof raw.dealId === "string" ? raw.dealId : null,
    level: num(raw.level), size: num(raw.size), status: typeof raw.status === "string" ? raw.status : null, profit: num(raw.profit),
  };
}

export type IgAccount = { equity: number; balance: number; upl: number; margin: number; available: number };
/** The configured account's figures from `GET /accounts`: equity is the balance plus the unrealised P&L. */
export function accountOf(raw: unknown, accountId: string): IgAccount | null {
  const list = isObj(raw) && Array.isArray(raw.accounts) ? raw.accounts : [];
  const a = list.find((x) => isObj(x) && x.accountId === accountId);
  if (!isObj(a) || !isObj(a.balance)) return null;
  const balance = num(a.balance.balance), upl = num(a.balance.profitLoss);
  if (balance === null || upl === null) return null;
  return { equity: r2(balance + upl), balance, upl, margin: num(a.balance.deposit) ?? 0, available: num(a.balance.available) ?? 0 };
}

/**
 * How a position closed, from `GET /history/activity` (v3, detailed): the activity whose actions name POSITION_CLOSED (or
 * a partial close) for the deal, its level, and who closed it. IG's own closes (its stop or limit) come on the SYSTEM
 * channel; the nearer of the position's stop and limit says which. Null when the history does not show it yet.
 */
export function closeOf(raw: unknown, pos: { dealId: string; stopLevel: number | null; limitLevel: number | null }): { level: number; atMs: number | null; how: "stop" | "limit" | "bot" | "unknown" } | null {
  const list = isObj(raw) && Array.isArray(raw.activities) ? raw.activities : [];
  const closes = (x: unknown) => isObj(x) && /^POSITION_(PARTIALLY_)?CLOSED$/.test(String(x.actionType));
  for (const a of list) {
    if (!isObj(a) || !isObj(a.details) || a.status === "REJECTED") continue;
    const acts = Array.isArray(a.details.actions) ? a.details.actions : [];
    // IG's reference lists `affectedDealId` beside the actions; it is read inside an action and on the details both, and an
    // activity that carries the position's own deal id with a close action counts too (which of them IG fills for a close
    // its own stop or limit made is to be confirmed on the first demo closes, research §9).
    const affected = (x: unknown) => isObj(x) && (x.affectedDealId === pos.dealId || (x.affectedDealId === undefined && (a.details as Record<string, unknown>).affectedDealId === pos.dealId));
    if (!acts.some((x) => closes(x) && (affected(x) || a.dealId === pos.dealId))) continue;
    const level = num(a.details.level);
    if (level === null) continue;
    let how: "stop" | "limit" | "bot" | "unknown" = "unknown";
    if (a.channel === "SYSTEM") {
      const ds = pos.stopLevel === null ? Infinity : Math.abs(level - pos.stopLevel), dl = pos.limitLevel === null ? Infinity : Math.abs(level - pos.limitLevel);
      how = ds === Infinity && dl === Infinity ? "unknown" : ds <= dl ? "stop" : "limit";
    } else if (typeof a.channel === "string" && /API/.test(a.channel)) how = "bot";
    return { level, atMs: timeMs(a.date), how };
  }
  return null;
}

/** A closed position's P&L in pounds from its levels (a spread bet: size × move), less the guaranteed-stop premium when its stop closed it. */
export function closedPnl(p: { direction: Direction; size: number; openLevel: number; closeLevel: number; guaranteed: boolean; premium: number; how: string }): number {
  const move = (p.direction === "BUY" ? 1 : -1) * (p.closeLevel - p.openLevel);
  return r2(p.size * move - (p.guaranteed && p.how === "stop" ? p.size * p.premium : 0));
}

// ── the venue, as this path asks it ───────────────────────────────────────────────────────────────────────────────

export type IgSend = { status: number; dealReference: string | null; error: string | null };
/** What the path asks IG. `index.ts` builds it on `IgbotClient`; the tests give a fake. */
export type IgApi = {
  accounts(): Promise<unknown>;
  market(epic: string): Promise<unknown>;
  markets(epics: string[]): Promise<unknown>;
  positions(): Promise<unknown>;
  working(): Promise<unknown>;
  confirm(ref: string): Promise<unknown>;
  /** `GET /history/activity` (v3, detailed) from a time; by the deal's id when given, else every activity since. */
  activity(q: { dealId?: string; fromIso: string }): Promise<unknown>;
  /** `GET /prices/{epic}` (v3): the market's last `max` HOUR bars, bid and ask. */
  prices(epic: string, max: number): Promise<unknown>;
  open(body: Record<string, unknown>): Promise<IgSend>;
  close(body: Record<string, unknown>): Promise<IgSend>;
  amend(dealId: string, body: Record<string, unknown>): Promise<IgSend>;
  placeWorking(body: Record<string, unknown>): Promise<IgSend>;
  deleteWorking(dealId: string): Promise<IgSend>;
};

export type IgbotConfig = {
  environment: string; mode: "dry_run" | "demo"; armed_at: string | null; started_at: string | null; budget_gbp: number | string; day_stop_gbp: number | string;
  total_stop_gbp: number | string; max_orders_day: number;
};
const CONFIG_SELECT = "environment,mode,armed_at,started_at,budget_gbp,day_stop_gbp,total_stop_gbp,max_orders_day";

export type ExecDeps = {
  db: Db; now: number;
  /** IG, or null when the demo credentials are not set (`credsProblem` says which are missing, by name). */
  ig: IgApi | null; credsProblem: string | null; accountId: string | null;
  /** A deal reference's random part (tests give a fixed one). */
  rand?: () => string;
  sleep?: (ms: number) => Promise<void>;
  /** The live clock, read when the lease is held again just before a send (`now` is the request's start). */
  clock?: () => number;
  /** IG requests this request has made so far, and how many it may make this minute (`index.ts`: the budget less others' use). */
  igCalls?: () => number;
  igBudget?: number;
};
/** Whether `n` more IG requests fit this request's share of the minute's budget. */
export const canCall = (deps: ExecDeps, n: number): boolean => (deps.igCalls?.() ?? 0) + n <= (deps.igBudget ?? Infinity);

export type OrderRow = {
  id: number; created_at: string; mode: "dry_run" | "demo"; decision_id: string; kind: string; epic: string; direction: Direction | null; size: number | string | null;
  level: number | string | null; stop_level: number | string | null; limit_level: number | string | null; entry: string | null; good_till: string | null;
  deal_reference: string; deal_id: string | null; state: string; reason: string | null;
};
export type PositionRow = {
  deal_id: string; epic: string; direction: Direction; size: number | string; open_level: number | string; stop_level: number | string | null;
  limit_level: number | string | null; guaranteed: boolean; premium: number | string; opened_at: string; order_id: number | null; decision_id: string | null; state: "open" | "closed";
};

export type Context = {
  cfg: IgbotConfig; mode: "dry_run" | "demo"; armed: boolean; state: Record<string, unknown>; whitelist: string[]; globalPause: boolean;
  account: IgAccount | null; positions: IgPosition[]; working: IgWorkingOrder[]; book: Book; gates: Gates; errors: string[];
  ordersToday: number; ordersLastMinute: number; dayStopAt: string | null; totalStopAt: string | null;
  /** What in the account the bot did not place (deal ids): it never touches them, and no open is taken while there are any. */
  foreign: string[];
  isBot: (p: Pick<IgPosition, "dealId" | "dealReference">) => boolean;
  isBotWorking: (w: Pick<IgWorkingOrder, "dealId" | "dealReference">) => boolean;
};

/**
 * Everything a request decides on: the config, IG's account, positions and working orders (read now), the book, the
 * stops' latches (kept in `igbot_exec_state`), today's and this minute's orders, and which positions and working orders
 * are the bot's own. The start's equity is the first reading after the arm; each UTC day opens at its first reading.
 */
export async function context(deps: ExecDeps): Promise<Context> {
  const { db, now, ig } = deps;
  const errors: string[] = [];
  const cfg = (await db.select<IgbotConfig>("igbot_config", `id=eq.1&select=${CONFIG_SELECT}`))[0];
  if (!cfg) throw new Error("igbot_config has no row");
  const mode = cfg.mode === "demo" ? "demo" : "dry_run";
  const armed = mode === "demo" && !!cfg.armed_at;
  const dayStart = Math.floor(now / 86400e3) * 86400e3;
  const [st, instruments, risk, today] = await Promise.all([
    db.select<{ state: Record<string, unknown> | null }>("igbot_exec_state", "id=eq.1&select=state").then((r) => r[0]?.state ?? {}),
    db.select<{ epic: string }>("igbot_instruments", "enabled=is.true&select=epic&order=epic.asc"),
    // Unreadable, the pause is taken as on: nothing is sent on a guess.
    db.select<{ global_pause: boolean }>("agent_risk", "id=eq.1&select=global_pause").catch(() => [{ global_pause: true }]),
    db.select<{ created_at: string }>("igbot_orders", `created_at=gte.${iso(dayStart)}&kind=neq.auto_close&select=created_at&order=id.asc&limit=1000`),
  ]);
  let account: IgAccount | null = null, positions: IgPosition[] = [], working: IgWorkingOrder[] = [];
  if (ig && deps.accountId) {
    const [a, p, w] = await Promise.allSettled([ig.accounts(), ig.positions(), ig.working()]);
    if (a.status === "fulfilled") account = accountOf(a.value, deps.accountId);
    else errors.push(`accounts: ${(a.reason as Error).message}`.slice(0, 200));
    if (p.status === "fulfilled") positions = positionsOf(p.value);
    else errors.push(`positions: ${(p.reason as Error).message}`.slice(0, 200));
    if (w.status === "fulfilled") working = workingOf(w.value);
    else errors.push(`working orders: ${(w.reason as Error).message}`.slice(0, 200));
    if (p.status === "rejected" || w.status === "rejected") account = null; // a book read in part is no book: no open on it
  }
  // The bot's own: what carries its deal-reference prefix, or a reference or deal id an order it sent was answered with.
  // Everything else in the account is foreign (2026-10-29 audit: the sync booked, closed after five days and cancelled
  // whatever the account held, the owner's own deals included, and in dry-run too).
  const botRefs = new Set<string>(), botIds = new Set<string>();
  if (positions.length || working.length) {
    const [own, held] = await Promise.all([
      db.selectAll<{ deal_reference: string; deal_id: string | null }>("igbot_orders", "mode=eq.demo&select=deal_reference,deal_id&order=id.asc"),
      db.selectAll<{ deal_id: string }>("igbot_positions", "select=deal_id&order=deal_id.asc"),
    ]);
    for (const o of own) { botRefs.add(o.deal_reference); if (o.deal_id) botIds.add(o.deal_id); }
    for (const h of held) botIds.add(h.deal_id);
  }
  const ours = (ref: string | null | undefined) => !!ref && (ref.startsWith(IGBOT_REF_PREFIX) || botRefs.has(ref));
  const isBot = (p: Pick<IgPosition, "dealId" | "dealReference">) => ours(p.dealReference) || botIds.has(p.dealId);
  const isBotWorking = (w: Pick<IgWorkingOrder, "dealId" | "dealReference">) => ours(w.dealReference) || botIds.has(w.dealId);
  const foreign = [...positions.filter((p) => !isBot(p)).map((p) => p.dealId), ...working.filter((w) => !isBotWorking(w)).map((w) => w.dealId)];
  const equity = mode === "demo" ? account?.equity ?? null : null;
  const todayIso = iso(now).slice(0, 10);
  if (armed && equity !== null) {
    if (!st.startEquity) st.startEquity = { at: iso(now), equityGbp: equity };
    const d = st.dayOpen as { day: string } | undefined;
    if (!d || d.day !== todayIso) st.dayOpen = { day: todayIso, equityGbp: equity };
  }
  const budget = num(cfg.budget_gbp) ?? 0;
  const book = bookOf({
    budgetGbp: budget, equityGbp: equity,
    startEquityGbp: (st.startEquity as { equityGbp: number } | undefined)?.equityGbp ?? null,
    dayOpenEquityGbp: (st.dayOpen as { day: string; equityGbp: number } | undefined)?.day === todayIso ? (st.dayOpen as { equityGbp: number }).equityGbp : null,
    positions, working,
  });
  const latches = stopLatches({
    book, dayStopGbp: num(cfg.day_stop_gbp) ?? 0, totalStopGbp: num(cfg.total_stop_gbp) ?? 0, nowMs: now,
    state: armed ? { dayStop: st.dayStop as { day: string } | null, totalStop: st.totalStop as { at: string } | null } : {},
  });
  if (armed) { st.dayStop = latches.dayStop; st.totalStop = latches.totalStop; }
  await db.update("igbot_exec_state", "id=eq.1", { state: st, updated_at: iso(now), last_error: errors.length ? errors.join("; ").slice(0, 500) : null });
  const globalPause = risk[0]?.global_pause === true;
  return {
    cfg, mode, armed, state: st, whitelist: instruments.map((i) => i.epic), globalPause, account, positions, working, book, errors,
    ordersToday: today.length, ordersLastMinute: today.filter((o) => Date.parse(o.created_at) > now - 60e3).length,
    dayStopAt: latches.dayStopped ? latches.dayStop!.at : null, totalStopAt: latches.totalStop?.at ?? null, foreign, isBot, isBotWorking,
    gates: {
      mode, armed, globalPause, credsProblem: deps.credsProblem ?? (ig ? (errors.length && !account ? "IG could not be read" : null) : "IG is not configured"),
      equityRead: equity !== null, dayStopped: latches.dayStopped, totalStopped: latches.totalStopped,
      foreign: foreign.length
        ? `the account holds ${foreign.length} position(s) or working order(s) the bot did not place (${foreign.slice(0, 3).join(", ")}): its equity is not the bot's book, so no open until they are gone`
        : null,
    },
  };
}

/** The lease: one request at a time decides on the book. True when taken. */
export async function takeLease(db: Db, owner: string, now: number): Promise<boolean> {
  const rows = await db.claim("igbot_exec_state", `id=eq.1&or=(lease_until.is.null,lease_until.lt.${encodeURIComponent(iso(now))})`, {
    lease_until: iso(now + IGBOT_LEASE_MS), lease_owner: owner,
  });
  return rows.length === 1;
}
/**
 * The lease held again just before a send, on the live clock: true only while this owner still holds it. A request that
 * spent its lease reading IG (up to 10 s a call) sends nothing (2026-10-29 audit: the 20-second lease could run out before
 * the send, and the sync or another request could then decide on the same book).
 */
export async function holdLease(deps: ExecDeps, owner: string): Promise<boolean> {
  const t = (deps.clock ?? Date.now)();
  const rows = await deps.db.claim("igbot_exec_state", `id=eq.1&lease_owner=eq.${encodeURIComponent(owner)}&lease_until=gt.${encodeURIComponent(iso(t))}`, {
    lease_until: iso(t + IGBOT_LEASE_MS),
  });
  return rows.length === 1;
}
export async function releaseLease(db: Db, owner: string): Promise<void> {
  await db.update("igbot_exec_state", `id=eq.1&lease_owner=eq.${encodeURIComponent(owner)}`, { lease_until: null, lease_owner: null }).catch(() => {});
}
const LEASE_LOST: Out = { status: 409, body: { error: "busy", detail: "the server's lease ran out while it read IG; nothing was sent: send again in a few seconds" } };

// ── the agent's views ─────────────────────────────────────────────────────────────────────────────────────────────

/** `GET ?action=account`: the mode, the gates, the budget and its room, what is open at its stops, and the calendar. */
export function accountView(c: Context, nowMs: number) {
  const b = c.book, cfg = c.cfg, R = IGBOT_RULES, budget = b.budgetGbp;
  const dayStop = num(cfg.day_stop_gbp) ?? 0, totalStop = num(cfg.total_stop_gbp) ?? 0;
  return {
    environment: "demo", mode: c.mode, armed: c.armed, started_at: cfg.started_at,
    gates: {
      global_pause: c.globalPause, credentials: c.gates.credsProblem ?? "ok", equity_read: c.gates.equityRead, weekend: inWeekend(nowMs), blackout_now: releaseAt(nowMs) !== null,
      foreign: c.gates.foreign ?? null,
    },
    budget: {
      budget_gbp: budget, bot_equity_gbp: r2(budget + (b.totalPnlGbp ?? 0)), account_equity_gbp: b.equityGbp, start_equity_gbp: b.startEquityGbp,
      total_pnl_gbp: b.totalPnlGbp, day_pnl_gbp: b.dayPnlGbp,
      day_stop_gbp: -dayStop, total_stop_gbp: -totalStop,
      day_room_gbp: b.dayPnlGbp === null ? null : r2(dayStop + b.dayPnlGbp), total_room_gbp: b.totalPnlGbp === null ? null : r2(totalStop + b.totalPnlGbp),
      day_stop_hit_at: c.dayStopAt, total_stop_hit_at: c.totalStopAt,
      can_open: !c.dayStopAt && !c.totalStopAt && !c.globalPause && !c.gates.foreign && (c.mode === "dry_run" || c.gates.equityRead),
      risk_per_trade_gbp: r2(R.riskPerTradeFrac * budget), open_risk_gbp: b.openRiskGbp, max_total_risk_gbp: r2(R.maxTotalRiskFrac * budget),
      notional_gbp: b.notionalGbp, max_notional_gbp: R.maxNotionalMult * budget, open_count: b.openCount, max_open: R.maxOpen,
      orders_today: c.ordersToday, max_orders_day: c.cfg.max_orders_day,
    },
    positions: c.positions.map((p) => ({
      deal_id: p.dealId, epic: p.epic, direction: p.direction, size: p.size, level: p.level, stop_level: p.stopLevel, limit_level: p.limitLevel,
      guaranteed: p.guaranteed, bid: p.bid, offer: p.offer, upl_gbp: positionUpl(p), risk_gbp: positionRisk(p),
      opened_at: p.createdMs === null ? null : iso(p.createdMs), server_closes_at: p.createdMs === null ? null : iso(p.createdMs + R.maxHoldMs), bots: c.isBot(p),
    })),
    working_orders: c.working.map((w) => ({
      deal_id: w.dealId, epic: w.epic, direction: w.direction, size: w.size, level: w.level, type: w.type, good_till: w.goodTillMs === null ? null : iso(w.goodTillMs),
      stop_distance: w.stopDistance, limit_distance: w.limitDistance, risk_gbp: workingRisk(w), bots: c.isBotWorking(w),
    })),
    instruments: c.whitelist,
    next_releases: IGBOT_RELEASE_MS.filter((t) => t > nowMs - IGBOT_RULES.blackoutTrailMs).slice(0, 5).map((t) => ({
      at: iso(t), no_open_from: iso(t - R.blackoutLeadMs), no_open_until: iso(t + R.blackoutTrailMs),
    })),
  };
}

/** One market as the agent reads it, with the dealing rules that bind a bracket and what blocks an open there now. */
export function marketOut(m: IgMarket, whitelist: string[], nowMs: number) {
  const ref = m.offer ?? m.bid ?? 0;
  const blocks: string[] = [];
  if (!whitelist.includes(m.epic)) blocks.push("not on the bot's list");
  if (m.status !== "TRADEABLE") blocks.push(`market ${m.status}`);
  if (m.expiry !== "DFB") blocks.push("not a daily funded bet");
  if (releaseAt(nowMs) !== null) blocks.push("release blackout");
  if (inWeekend(nowMs)) blocks.push("weekend window");
  return {
    epic: m.epic, name: m.name, type: m.type, expiry: m.expiry, status: m.status, bid: m.bid, offer: m.offer,
    spread: m.bid !== null && m.offer !== null ? Math.round((m.offer - m.bid) * 1e4) / 1e4 : null, min_size_gbp_per_point: m.minDealSize,
    min_guaranteed_stop_points: Math.round(rulePoints(m.minGsDistance, ref) * 1e4) / 1e4, guaranteed_stop_premium_points: m.gsPremium,
    min_limit_points: Math.round(rulePoints(m.minLimitDistance ?? null, ref) * 1e4) / 1e4,
    day_high: m.dayHigh ?? null, day_low: m.dayLow ?? null,
    update_time: m.updateTime, open_blocked_by: blocks,
  };
}

// ── the actions that change the account ───────────────────────────────────────────────────────────────────────────

type Out = { status: number; body: Record<string, unknown> };
const opposite = (d: Direction): Direction => (d === "BUY" ? "SELL" : "BUY");
const refOf = (deps: ExecDeps) => `${IGBOT_REF_PREFIX}${Math.floor(deps.now / 1000).toString(36)}-${(deps.rand ?? (() => crypto.randomUUID().replace(/-/g, "").slice(0, 8)))()}`.slice(0, 30);

/** The body's keys and its decision, validated; `action` is what the decision must be. */
function bodyOf(deps: ExecDeps, body: unknown, keys: string[], action: Decision["action"]): { b: Record<string, unknown>; d: Decision } | Out {
  const b = isObj(body) ? body : {};
  const errors = Object.keys(b).filter((k) => !keys.includes(k)).map((k) => `${k}: unknown field`);
  const d = decisionOf(b.decision, "decision", deps.now, errors);
  if (d && d.action !== action) errors.push(`decision.action: ${action}`);
  if (errors.length || !d) return { status: 422, body: { error: "invalid", errors: errors.slice(0, 20) } };
  return { b, d };
}

/** A decision id already used: the order it made (a resend is not a second order), or a refusal when it is a journal row. */
async function duplicateOf(db: Db, id: string): Promise<Out | null> {
  const done = (await db.select<OrderRow>("igbot_orders", `decision_id=eq.${encodeURIComponent(id)}&select=*&limit=1`))[0];
  if (done) return { status: 200, body: { ok: true, duplicate: true, order: orderOut(done) } };
  if ((await db.select<{ id: string }>("igbot_decisions", `id=eq.${encodeURIComponent(id)}&select=id&limit=1`)).length) {
    return { status: 422, body: { error: "invalid", errors: [`decision.id: ${id} is already a journal row; a new decision needs a new id`] } };
  }
  return null;
}

function orderOut(o: OrderRow) {
  return {
    order_id: o.id, decision_id: o.decision_id, mode: o.mode, kind: o.kind, epic: o.epic, direction: o.direction, size: num(o.size), level: num(o.level),
    stop_level: num(o.stop_level), limit_level: num(o.limit_level), entry: o.entry, good_till: o.good_till, deal_reference: o.deal_reference,
    deal_id: o.deal_id, state: o.state, reason: o.reason,
  };
}

async function confirmed(deps: ExecDeps, ref: string): Promise<IgConfirm | null> {
  for (let i = 0; i < 2; i++) {
    const c = await deps.ig!.confirm(ref).then(confirmOf).catch(() => null);
    if (c) return c;
    await (deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))))(400);
  }
  return null;
}

/**
 * Send, then read the confirmation, then write what IG said on the order row. The confirmation is read under the deal
 * reference IG answered with: an open's and a working order's are the server's own, a close's, an amend's and a delete's
 * are IG's (a close takes no reference, IG's reference says so; until the 2026-10-29 audit a close carried the server's
 * and its confirmation was read under it). IG's reference replaces the row's so the sync reads the right one. A lost
 * answer stays `unknown` for the sync.
 */
async function sendAndBook(deps: ExecDeps, row: OrderRow, send: () => Promise<IgSend>): Promise<{ state: string; confirm: IgConfirm | null; why: string; ref: string }> {
  let s: IgSend;
  try {
    s = await send();
  } catch (e) {
    s = { status: 0, dealReference: null, error: (e as Error).message.slice(0, 200) };
  }
  const ref = s.dealReference && DEAL_REF_RE.test(s.dealReference) ? s.dealReference : row.deal_reference;
  const c = s.status === 200 ? await confirmed(deps, ref) : null;
  const state = c ? (c.dealStatus === "ACCEPTED" ? "accepted" : "rejected") : s.status === 200 || s.status === 0 ? "unknown" : "rejected";
  const why = c ? `${c.dealStatus}${c.reason && c.reason !== "SUCCESS" ? ` (${c.reason})` : ""}` : s.error ?? `IG answered ${s.status}`;
  await deps.db.update("igbot_orders", `id=eq.${row.id}`, {
    state, deal_id: c?.dealId ?? row.deal_id ?? null, reason: why.slice(0, 300), confirm: c, updated_at: iso(deps.now), ...(ref !== row.deal_reference ? { deal_reference: ref } : {}),
  });
  return { state, confirm: c, why, ref };
}

async function journal(deps: ExecDeps, d: Decision, raw: unknown, mBase: number | null = null) {
  await deps.db.insert("igbot_decisions", [{ ...d, m_base: mBase, raw }], false);
}

/** The markets where an open or working order of the bot still waits for IG's answer (`pendingBlockMs`). */
async function pendingEpics(deps: ExecDeps): Promise<string[]> {
  const rows = await deps.db.select<{ epic: string }>(
    "igbot_orders",
    `state=in.(pending,unknown)&kind=in.(open,working)&created_at=gte.${encodeURIComponent(iso(deps.now - IGBOT_RULES.pendingBlockMs))}&select=epic&order=id.asc&limit=100`,
  );
  return [...new Set(rows.map((r) => r.epic))];
}

/** `POST ?action=order`: one open from its decision, immediate (`entry` "market", the level its worst fill) or a working order. */
export async function placeOrder(deps: ExecDeps, body: unknown, owner: string): Promise<Out> {
  const v = bodyOf(deps, body, ["decision", "entry", "good_till"], "open");
  if ("status" in v) return v;
  const { b, d } = v;
  const entry = b.entry === undefined || b.entry === null ? "market" : b.entry;
  if (entry !== "market" && entry !== "limit" && entry !== "stop") return { status: 422, body: { error: "invalid", errors: ["entry: market, limit or stop"] } };
  const goodTillMs = typeof b.good_till === "string" && Number.isFinite(Date.parse(b.good_till)) ? Date.parse(b.good_till) : null;
  if (entry !== "market" && goodTillMs === null) return { status: 422, body: { error: "invalid", errors: ["good_till: a working order needs an ISO time"] } };
  const dup = await duplicateOf(deps.db, d.id);
  if (dup) return dup;
  if (!(await takeLease(deps.db, owner, deps.now))) return { status: 409, body: { error: "busy", detail: "another request is deciding on the book; send again in a few seconds" } };
  try {
    const c = await context(deps);
    const market = deps.ig ? await deps.ig.market(d.epic!).then(marketOf).catch(() => null) : null;
    const req = {
      category: d.category as "E" | "N" | "R", epic: d.epic!, direction: d.direction!, size: d.size!, level: d.level!, stopLevel: d.stop_level!, limitLevel: d.limit_level!,
      p: d.p_target!, eventAt: d.event_at, sources: d.sources, entry, goodTillMs,
    } as const;
    const { refusals, checks } = openRefusals({
      req, market, book: c.book, whitelist: c.whitelist, nowMs: deps.now, ordersToday: c.ordersToday, maxOrdersDay: c.cfg.max_orders_day, ordersLastMinute: c.ordersLastMinute,
      pendingEpics: await pendingEpics(deps),
    });
    const all: Refusal[] = [...gateRefusals(c.gates, "open"), ...refusals];
    if (all.length) return { status: 422, body: { error: "refused", mode: c.mode, refusals: all, checks } };
    if (!(await holdLease(deps, owner))) return LEASE_LOST;
    await journal(deps, d, b.decision, checks.m_base as number);
    const ref = refOf(deps);
    const premiumPts = market?.gsPremium ?? 0;
    const request = entry === "market"
      ? {
        epic: d.epic, expiry: "DFB", direction: d.direction, size: d.size, orderType: "LIMIT", level: d.level, timeInForce: "FILL_OR_KILL", guaranteedStop: true,
        stopLevel: d.stop_level, limitLevel: d.limit_level, forceOpen: true, currencyCode: "GBP", dealReference: ref,
      }
      : {
        epic: d.epic, expiry: "DFB", direction: d.direction, size: d.size, level: d.level, type: entry.toUpperCase(), timeInForce: "GOOD_TILL_DATE",
        goodTillDate: igGoodTill(goodTillMs!), guaranteedStop: true, stopDistance: checks.d_stop, limitDistance: checks.d_limit, forceOpen: true, currencyCode: "GBP", dealReference: ref,
      };
    const [row] = await deps.db.insert<OrderRow>("igbot_orders", {
      mode: c.mode, created_at: iso(deps.now), updated_at: iso(deps.now), decision_id: d.id, kind: entry === "market" ? "open" : "working", epic: d.epic, direction: d.direction,
      size: d.size, level: d.level, stop_level: d.stop_level, limit_level: d.limit_level, entry, good_till: goodTillMs === null ? null : iso(goodTillMs),
      deal_reference: ref, state: c.mode === "dry_run" ? "dry_run" : "pending", request, checks,
    }, true);
    if (c.mode === "dry_run") return { status: 200, body: { ok: true, mode: "dry_run", sent: false, would_send: request, checks, order: orderOut(row) } };
    const r = await sendAndBook(deps, row, () => (entry === "market" ? deps.ig!.open(request) : deps.ig!.placeWorking(request)));
    if (r.state === "accepted" && entry === "market" && r.confirm?.dealId) {
      await deps.db.upsert("igbot_positions", [{
        deal_id: r.confirm.dealId, epic: d.epic, direction: d.direction, size: r.confirm.size ?? d.size, open_level: r.confirm.level ?? d.level, stop_level: d.stop_level,
        limit_level: d.limit_level, guaranteed: true, premium: premiumPts, opened_at: iso(deps.now), order_id: row.id, decision_id: d.id, state: "open", updated_at: iso(deps.now),
      }], "deal_id");
    }
    return {
      status: r.state === "rejected" ? 409 : 200,
      body: { ok: r.state !== "rejected", mode: "demo", sent: true, ig: r.why, checks, order: orderOut({ ...row, state: r.state, deal_id: r.confirm?.dealId ?? null, reason: r.why, deal_reference: r.ref }) },
    };
  } finally {
    await releaseLease(deps.db, owner);
  }
}

/** `POST ?action=close`: close a position the bot holds, whole or in part, at the market (IG's LIMIT fill-or-kill at the touch). */
export async function closePosition(deps: ExecDeps, body: unknown, owner: string): Promise<Out> {
  const v = bodyOf(deps, body, ["decision"], "close");
  if ("status" in v) return v;
  const { b, d } = v;
  const dup = await duplicateOf(deps.db, d.id);
  if (dup) return dup;
  if (!(await takeLease(deps.db, owner, deps.now))) return { status: 409, body: { error: "busy", detail: "send again in a few seconds" } };
  try {
    const c = await context(deps);
    const pos = c.positions.find((p) => p.dealId === d.deal_id && c.isBot(p)) ?? null;
    const all = [...gateRefusals(c.gates, "close"), ...closeRefusals(pos, d.size)];
    if (pos && pos.marketStatus && pos.marketStatus !== "TRADEABLE") all.push({ rule: "market", why: `the market is ${pos.marketStatus}, not TRADEABLE: the guaranteed stop and the limit stand` });
    if (all.length) return { status: 422, body: { error: "refused", mode: c.mode, refusals: all } };
    return await closeSend(deps, c, pos!, d, b.decision, "close", owner);
  } finally {
    await releaseLease(deps.db, owner);
  }
}

/**
 * A close: IG's LIMIT fill-or-kill on the position's deal id at `closeLimitLevel` (the exit touch less a tolerance), with
 * no deal reference (IG's close takes none). Until the 2026-10-29 audit it was a MARKET order, which IG may refuse on an
 * account whose market-order preference is off (all six markets read AVAILABLE_DEFAULT_OFF on the demo, `ig_facts` 3).
 */
async function closeSend(deps: ExecDeps, c: Context, pos: IgPosition, d: Decision, raw: unknown, kind: "close" | "auto_close", owner: string): Promise<Out> {
  const size = d.size ?? pos.size;
  const level = closeLimitLevel(pos);
  if (level === null) return { status: 422, body: { error: "refused", mode: c.mode, refusals: [{ rule: "market", why: "IG shows no two-sided price for this market: there is no level to close at" }] } };
  if (!(await holdLease(deps, owner))) return LEASE_LOST;
  await journal(deps, d, raw);
  const request = { dealId: pos.dealId, direction: opposite(pos.direction), size, orderType: "LIMIT", level, timeInForce: "FILL_OR_KILL" };
  const [row] = await deps.db.insert<OrderRow>("igbot_orders", {
    mode: c.mode, created_at: iso(deps.now), updated_at: iso(deps.now), decision_id: d.id, kind, epic: pos.epic, direction: opposite(pos.direction), size, level,
    deal_reference: refOf(deps), deal_id: pos.dealId, state: c.mode === "dry_run" ? "dry_run" : "pending", request,
  }, true);
  if (c.mode === "dry_run") return { status: 200, body: { ok: true, mode: "dry_run", sent: false, would_send: request, order: orderOut(row) } };
  const r = await sendAndBook(deps, row, () => deps.ig!.close(request));
  if (r.state === "accepted") {
    const whole = size >= pos.size - 1e-9;
    const closeLevel = r.confirm?.level ?? null;
    const how = kind === "auto_close" ? "server" : "bot";
    await deps.db.upsert("igbot_positions", [{
      deal_id: pos.dealId, epic: pos.epic, direction: pos.direction, size: whole ? pos.size : r2(pos.size - size), open_level: pos.level, stop_level: pos.stopLevel,
      limit_level: pos.limitLevel, guaranteed: pos.guaranteed, premium: pos.premium, opened_at: iso(pos.createdMs ?? deps.now), state: whole ? "closed" : "open",
      ...(whole ? { closed_at: iso(deps.now), close_level: closeLevel, close_how: how, pnl_gbp: r.confirm?.profit ?? (closeLevel === null ? null : closedPnl({ direction: pos.direction, size, openLevel: pos.level, closeLevel, guaranteed: pos.guaranteed, premium: pos.premium, how })) } : {}),
      updated_at: iso(deps.now),
    }], "deal_id");
  }
  return { status: r.state === "rejected" ? 409 : 200, body: { ok: r.state !== "rejected", mode: "demo", sent: true, ig: r.why, order: orderOut({ ...row, state: r.state, deal_id: r.confirm?.dealId ?? pos.dealId, reason: r.why, deal_reference: r.ref }) } };
}

/** `POST ?action=amend`: move a position's guaranteed stop toward the price, or its limit. Both levels are always sent (IG removes one left out). */
export async function amendPosition(deps: ExecDeps, body: unknown, owner: string): Promise<Out> {
  const v = bodyOf(deps, body, ["decision"], "amend");
  if ("status" in v) return v;
  const { b, d } = v;
  const dup = await duplicateOf(deps.db, d.id);
  if (dup) return dup;
  if (!(await takeLease(deps.db, owner, deps.now))) return { status: 409, body: { error: "busy", detail: "send again in a few seconds" } };
  try {
    const c = await context(deps);
    const pos = c.positions.find((p) => p.dealId === d.deal_id && c.isBot(p)) ?? null;
    if (!pos) return { status: 422, body: { error: "refused", mode: c.mode, refusals: [{ rule: "not_held", why: "no open position of the bot with that deal_id" }] } };
    const market = deps.ig ? await deps.ig.market(pos.epic).then(marketOf).catch(() => null) : null;
    const all = [...gateRefusals(c.gates, "amend"), ...amendRefusals({ pos, stopLevel: d.stop_level, limitLevel: d.limit_level, market })];
    if (all.length) return { status: 422, body: { error: "refused", mode: c.mode, refusals: all } };
    if (!(await holdLease(deps, owner))) return LEASE_LOST;
    await journal(deps, d, b.decision);
    const request = { stopLevel: d.stop_level ?? pos.stopLevel, limitLevel: d.limit_level ?? pos.limitLevel, guaranteedStop: true, trailingStop: false };
    const [row] = await deps.db.insert<OrderRow>("igbot_orders", {
      mode: c.mode, created_at: iso(deps.now), updated_at: iso(deps.now), decision_id: d.id, kind: "amend", epic: pos.epic, direction: pos.direction, size: pos.size,
      stop_level: request.stopLevel, limit_level: request.limitLevel, deal_reference: refOf(deps), deal_id: pos.dealId, state: c.mode === "dry_run" ? "dry_run" : "pending", request,
    }, true);
    if (c.mode === "dry_run") return { status: 200, body: { ok: true, mode: "dry_run", sent: false, would_send: request, order: orderOut(row) } };
    // An amend's answer carries the deal reference IG gave it; `sendAndBook` reads its confirmation under that reference.
    const r = await sendAndBook(deps, row, () => deps.ig!.amend(pos.dealId, request));
    return { status: r.state === "rejected" ? 409 : 200, body: { ok: r.state !== "rejected", mode: "demo", sent: true, ig: r.why, order: orderOut({ ...row, state: r.state, reason: r.why, deal_reference: r.ref }) } };
  } finally {
    await releaseLease(deps.db, owner);
  }
}

/** `POST ?action=cancel` (one working order, `deal_id`) or `cancel_all` (every one of the bot's); a decision is optional. */
export async function cancelOrders(deps: ExecDeps, body: unknown, all: boolean, owner: string): Promise<Out> {
  const b = isObj(body) ? body : {};
  const errors = Object.keys(b).filter((k) => !["deal_id", "decision"].includes(k)).map((k) => `${k}: unknown field`);
  if (!all && !(typeof b.deal_id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(b.deal_id))) errors.push("deal_id: one of the bot's working orders");
  const d = b.decision === undefined ? null : decisionOf(b.decision, "decision", deps.now, errors);
  if (d && d.action !== "cancel") errors.push("decision.action: cancel");
  if (errors.length) return { status: 422, body: { error: "invalid", errors: errors.slice(0, 20) } };
  if (!(await takeLease(deps.db, owner, deps.now))) return { status: 409, body: { error: "busy", detail: "send again in a few seconds" } };
  try {
    const c = await context(deps);
    const targets = c.working.filter((w) => c.isBotWorking(w) && (all || w.dealId === b.deal_id));
    if (!all && !targets.length) return { status: 404, body: { error: "no working order of the bot with that deal_id" } };
    const g = gateRefusals(c.gates, "cancel");
    if (g.length) return { status: 422, body: { error: "refused", mode: c.mode, refusals: g } };
    const out = await deleteWorking(deps, c, targets, d, b.decision, "the agent's cancel", c.mode === "demo", owner);
    if (out === null) return LEASE_LOST;
    return { status: 200, body: { ok: true, mode: c.mode, cancelled: out } };
  } finally {
    await releaseLease(deps.db, owner);
  }
}

/**
 * Delete working orders at IG, each by its own id, each with its journal row and order row. `send` false (dry-run) checks
 * and journals only. The sync's kill switch sends whatever the mode, and only ever the bot's own orders (`isBotWorking`):
 * a cancel only reduces what is at risk. Null when the lease ran out before anything was sent.
 */
async function deleteWorking(
  deps: ExecDeps, c: Context, targets: IgWorkingOrder[], d: Decision | null, raw: unknown, why: string, send: boolean, owner: string,
): Promise<Array<Record<string, unknown>> | null> {
  const out: Array<Record<string, unknown>> = [];
  if (targets.length && !(await holdLease(deps, owner))) return null;
  for (const [i, w] of targets.entries()) {
    const dec: Decision = d && i === 0 ? { ...d, deal_id: w.dealId } : {
      id: `srv-cancel-${w.dealId}-${Math.floor(deps.now / 1000)}`.slice(0, 64), ts: iso(deps.now), action: "cancel", category: null, epic: w.epic, direction: null, size: null,
      level: null, stop_level: null, limit_level: null, p_target: null, event_at: null, deal_id: w.dealId, sources: [], reason: why, invalidation: null,
    };
    if (await duplicateOf(deps.db, dec.id)) { out.push({ deal_id: w.dealId, state: "already" }); continue; }
    await journal(deps, dec, d && i === 0 ? raw : { server: true, reason: why });
    const [row] = await deps.db.insert<OrderRow>("igbot_orders", {
      mode: send ? "demo" : c.mode, created_at: iso(deps.now), updated_at: iso(deps.now), decision_id: dec.id, kind: "cancel", epic: w.epic, direction: w.direction, size: w.size,
      level: w.level, deal_reference: refOf(deps), deal_id: w.dealId, state: send ? "pending" : "dry_run", request: { dealId: w.dealId },
    }, true);
    if (!send) { out.push({ deal_id: w.dealId, sent: false }); continue; }
    let s: IgSend;
    try { s = await deps.ig!.deleteWorking(w.dealId); } catch (e) { s = { status: 0, dealReference: null, error: (e as Error).message.slice(0, 200) }; }
    const state = s.status === 200 ? "accepted" : s.status === 0 ? "unknown" : "rejected";
    await deps.db.update("igbot_orders", `id=eq.${row.id}`, { state, reason: s.error ?? `IG answered ${s.status}`, updated_at: iso(deps.now) });
    out.push({ deal_id: w.dealId, sent: true, state });
  }
  return out;
}

// ── the minute's sync ─────────────────────────────────────────────────────────────────────────────────────────────

/** One IG HOUR bar as `igbot_bars` keeps it, from `GET /prices/{epic}` (v3); only hours that have started by `nowMs`. */
export function barsOf(raw: unknown, epic: string, nowMs: number): Array<Record<string, unknown>> {
  const list = isObj(raw) && Array.isArray(raw.prices) ? raw.prices : [];
  const out: Array<Record<string, unknown>> = [];
  for (const b of list) {
    if (!isObj(b)) continue;
    const t = timeMs(b.snapshotTimeUTC);
    if (t === null || t > nowMs || t % 3600e3 !== 0) continue;
    const side = (k: string, s: "bid" | "ask") => (isObj(b[k]) ? num((b[k] as Record<string, unknown>)[s]) : null);
    const row = {
      epic, hour: iso(t), fetched_at: iso(nowMs),
      bid_open: side("openPrice", "bid"), bid_high: side("highPrice", "bid"), bid_low: side("lowPrice", "bid"), bid_close: side("closePrice", "bid"),
      ask_open: side("openPrice", "ask"), ask_high: side("highPrice", "ask"), ask_low: side("lowPrice", "ask"), ask_close: side("closePrice", "ask"),
    };
    if ([row.bid_high, row.bid_low, row.ask_high, row.ask_low].some((x) => x === null)) continue;
    out.push(row);
  }
  return out;
}

/**
 * The reading's prices (pre-registration §5: shadow brackets resolve on IG's own HOUR bars): each whitelisted market's last
 * two hours, once an hour each, at most `IGBOT_BARS_PER_SYNC` a minute, from two minutes past the hour. A bar fetched before
 * its hour ended is fetched again complete the next hour (`fetched_at` says which). Until the 2026-10-29 audit nothing
 * recorded IG's prices and the client could not read them, so the reading could not have been run.
 */
async function recordBars(deps: ExecDeps, c: Context): Promise<number> {
  const hour = Math.floor(deps.now / 3600e3) * 3600e3;
  if (deps.now - hour < 2 * 60e3) return 0;
  const tried = (isObj(c.state.bars) ? c.state.bars : {}) as Record<string, number>;
  c.state.bars = tried;
  let n = 0;
  for (const epic of c.whitelist) {
    if (n >= IGBOT_BARS_PER_SYNC || !canCall(deps, 1)) break;
    if ((tried[epic] ?? 0) >= hour) continue;
    tried[epic] = deps.now; // one attempt an hour, answered or not
    n++;
    const rows = barsOf(await deps.ig!.prices(epic, 2), epic, deps.now);
    if (rows.length) await deps.db.upsert("igbot_bars", rows, "epic,hour");
  }
  return n;
}

/**
 * The scheduler's minute: IG's lists read back into the book's tables; a pending deal's confirmation read again; a bot's
 * position IG no longer lists closed with its level and how from the activity history (or, with no history after
 * `IGBOT_MISSING_GRACE_MS`, closed `unknown`); a position older than five days closed by the server while its market
 * trades; the bot's working orders cancelled while the path is disarmed or paused; a snapshot each five-minute slot; IG's
 * hour bars. Nothing it does touches a deal the bot did not place. Returns what it did and every fault.
 */
export async function syncAll(deps: ExecDeps, owner: string): Promise<{ ok: boolean; configured: boolean; busy?: boolean; did: Record<string, number>; errors: string[] }> {
  const did = { confirmed: 0, opened: 0, closed: 0, auto_closed: 0, cancelled: 0, snapshot: 0, bars: 0 };
  if (!deps.ig) return { ok: true, configured: false, did, errors: [] };
  if (!(await takeLease(deps.db, owner, deps.now))) return { ok: true, configured: true, busy: true, did, errors: [] };
  const errors: string[] = [];
  try {
    const c = await context(deps);
    errors.push(...c.errors);
    if (c.gates.foreign) errors.push(`foreign: ${c.gates.foreign}`);
    const { db, now } = deps;
    // Deals whose answer was lost: their confirmation read again under the reference IG knows, for two hours, five a minute
    // (a close's, an amend's and a delete's reference is IG's own; one IG never answered with cannot be confirmed).
    const pend = (await db.select<OrderRow>("igbot_orders", `state=in.(pending,unknown)&created_at=gte.${encodeURIComponent(iso(now - 2 * 3600e3))}&select=*&order=id.asc&limit=20`))
      .filter((o) => o.kind === "open" || o.kind === "working" || !o.deal_reference.startsWith(IGBOT_REF_PREFIX)).slice(0, 5);
    for (const o of pend) {
      if (!canCall(deps, 1)) break;
      const cf = await deps.ig.confirm(o.deal_reference).then(confirmOf).catch(() => null);
      if (!cf) continue;
      await db.update("igbot_orders", `id=eq.${o.id}`, { state: cf.dealStatus === "ACCEPTED" ? "accepted" : "rejected", deal_id: cf.dealId ?? o.deal_id, confirm: cf, reason: cf.dealStatus, updated_at: iso(now) });
      did.confirmed++;
    }
    const readOk = !c.errors.some((e) => /^(positions|working orders)/.test(e));
    if (readOk) {
      const known = await db.select<PositionRow>("igbot_positions", "state=eq.open&select=*&order=deal_id.asc&limit=200");
      const live = new Map(c.positions.map((p) => [p.dealId, p]));
      // New in IG's list and the bot's (a working order filled, or an open whose confirmation was lost): booked, tied to its
      // order by reference. A position the bot did not place is never booked (it is reported above).
      for (const p of c.positions) {
        if (!c.isBot(p) || known.some((k) => k.deal_id === p.dealId)) continue;
        const o = p.dealReference ? (await db.select<OrderRow>("igbot_orders", `deal_reference=eq.${encodeURIComponent(p.dealReference)}&select=*&limit=1`))[0] : undefined;
        await db.upsert("igbot_positions", [{
          deal_id: p.dealId, epic: p.epic, direction: p.direction, size: p.size, open_level: p.level, stop_level: p.stopLevel, limit_level: p.limitLevel, guaranteed: p.guaranteed,
          premium: p.premium, opened_at: iso(p.createdMs ?? now), order_id: o?.id ?? null, decision_id: o?.decision_id ?? null, state: "open", updated_at: iso(now),
        }], "deal_id");
        did.opened++;
      }
      // Gone from IG's list: closed by its stop, its limit or the bot; the history says at what level. IG's history can lag
      // its list, so a position with no close in it yet stays open for `IGBOT_MISSING_GRACE_MS` and is read again (until the
      // 2026-10-29 audit it was booked closed `unknown`, with no level or P&L, the first minute it was missing).
      const missing = (isObj(c.state.missing) ? { ...c.state.missing } : {}) as Record<string, number>;
      for (const id of Object.keys(missing)) if (!known.some((k) => k.deal_id === id)) delete missing[id];
      for (const k of known) {
        const p = live.get(k.deal_id);
        if (p) {
          delete missing[k.deal_id];
          if (num(k.stop_level) !== p.stopLevel || num(k.limit_level) !== p.limitLevel || num(k.size) !== p.size) {
            await db.update("igbot_positions", `deal_id=eq.${encodeURIComponent(k.deal_id)}`, { stop_level: p.stopLevel, limit_level: p.limitLevel, size: p.size, updated_at: iso(now) });
          }
          continue;
        }
        const pos = { dealId: k.deal_id, stopLevel: num(k.stop_level), limitLevel: num(k.limit_level) };
        let cl: ReturnType<typeof closeOf> = null;
        // By the deal's id first; IG's reference does not say whether that filter matches the closing activity, so every
        // activity since the open is read when it finds nothing.
        for (const q of [{ dealId: k.deal_id, fromIso: k.opened_at }, { fromIso: k.opened_at }]) {
          if (cl || !canCall(deps, 1)) break;
          const hist = await deps.ig.activity(q).catch((e) => { errors.push(`activity: ${(e as Error).message}`.slice(0, 200)); return null; });
          cl = hist === null ? null : closeOf(hist, pos);
        }
        const first = missing[k.deal_id] ?? now;
        if (!cl && now - first < IGBOT_MISSING_GRACE_MS) { missing[k.deal_id] = first; continue; }
        delete missing[k.deal_id];
        const patch: Record<string, unknown> = { state: "closed", closed_at: iso(cl?.atMs ?? now), close_level: cl?.level ?? null, close_how: cl?.how ?? "unknown", updated_at: iso(now) };
        if (cl) patch.pnl_gbp = closedPnl({ direction: k.direction, size: num(k.size)!, openLevel: num(k.open_level)!, closeLevel: cl.level, guaranteed: k.guaranteed, premium: num(k.premium) ?? 0, how: cl.how });
        await db.update("igbot_positions", `deal_id=eq.${encodeURIComponent(k.deal_id)}&state=eq.open`, patch);
        did.closed++;
      }
      c.state.missing = missing;
      // The server's own rules, armed only and outside the pause: the five-day limit, on the bot's positions, while their
      // market trades, tried again ten minutes after a refusal (until the 2026-10-29 audit one refusal, at a weekend say,
      // used up its decision id and the position was never closed).
      if (c.armed && !c.globalPause) {
        for (const p of overdue(c.positions.filter((x) => c.isBot(x)), now)) {
          if (p.marketStatus && p.marketStatus !== "TRADEABLE") continue;
          const prefix = `srv-maxhold-${p.dealId}-`;
          const prior = (await db.select<{ state: string; created_at: string }>("igbot_orders", `decision_id=like.${encodeURIComponent(prefix)}*&select=state,created_at&order=id.desc&limit=1`))[0];
          if (prior && (prior.state !== "rejected" || now - Date.parse(prior.created_at) < IGBOT_AUTO_CLOSE_RETRY_MS)) continue;
          if (!canCall(deps, 3)) break;
          const dec: Decision = {
            id: `${prefix}${Math.floor(now / 60e3).toString(36)}`.slice(0, 64), ts: iso(now), action: "close", category: "C", epic: p.epic, direction: opposite(p.direction), size: p.size, level: null,
            stop_level: null, limit_level: null, p_target: null, event_at: null, deal_id: p.dealId, sources: [], reason: "IGBOT_RULES.maxHoldMs: held five days", invalidation: null,
          };
          if (await duplicateOf(db, dec.id)) continue;
          const r = await closeSend(deps, c, p, dec, { server: true, reason: dec.reason }, "auto_close", owner);
          if (r.status === 200) did.auto_closed++;
          else errors.push(`max-hold close of ${p.dealId}: ${JSON.stringify(r.body).slice(0, 160)}`);
        }
      }
      // Disarmed or paused, nothing of the bot rests at IG: each of ITS working orders deleted by its own id, in any mode.
      const mine = c.working.filter((w) => c.isBotWorking(w));
      if ((c.globalPause || !c.armed) && mine.length) {
        const k = await deleteWorking(deps, c, mine, null, null, c.globalPause ? "the global pause is on" : "the path is disarmed", true, owner);
        if (k === null) errors.push("kill switch: the lease ran out before the working orders could be deleted");
        else did.cancelled = k.filter((x) => x.sent).length;
      }
    }
    // The record: one row a five-minute slot, IG's own figures.
    const slot = Math.floor(now / SLOT_MS) * SLOT_MS;
    await db.upsert("igbot_snapshots", [{
      slot: iso(slot), at: iso(now), ok: !!c.account && readOk, equity_gbp: c.account?.equity ?? null, balance_gbp: c.account?.balance ?? null, upl_gbp: c.account?.upl ?? null,
      margin_gbp: c.account?.margin ?? null, available_gbp: c.account?.available ?? null, open_risk_gbp: Number.isFinite(c.book.openRiskGbp) ? c.book.openRiskGbp : null,
      positions: c.positions.map((p) => ({ deal_id: p.dealId, epic: p.epic, direction: p.direction, size: p.size, level: p.level, stop: p.stopLevel, limit: p.limitLevel, bid: p.bid, offer: p.offer, upl: positionUpl(p), bots: c.isBot(p) })),
      working: c.working.map((w) => ({ deal_id: w.dealId, epic: w.epic, direction: w.direction, size: w.size, level: w.level, good_till: w.goodTillMs === null ? null : iso(w.goodTillMs), bots: c.isBotWorking(w) })),
      error: errors.length ? errors.join("; ").slice(0, 500) : null,
    }], "slot");
    did.snapshot = 1;
    // IG's hour bars for the reading: last, and on their own, so a fault there leaves everything above done.
    try {
      did.bars = await recordBars(deps, c);
    } catch (e) {
      errors.push(`bars: ${(e as Error).message}`.slice(0, 200));
    }
    await db.update("igbot_exec_state", "id=eq.1", { state: c.state });
    return { ok: errors.length === 0, configured: true, did, errors };
  } finally {
    await releaseLease(deps.db, owner);
  }
}
