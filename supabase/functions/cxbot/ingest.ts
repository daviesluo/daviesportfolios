// CXBOT's request bodies, the pure half: what a journal row, an order's decision and a forecast answer must look like, and
// how much the agent may send. Modelled on IGBOT's (`igbot/ingest.ts`): every field the agent sends is untrusted data,
// checked for type, range and length; unknown fields are refused; free text is stored as text and never read as an
// instruction. A row carries the agent's own `id`, so a resend is a duplicate, never a second row.

import { COINS, type Coin, type Dir } from "./rules.ts";

export const CXBOT_MAX_BODY_BYTES = 65_536;
export const CXBOT_MAX_ROWS_PER_REQUEST = 50;
export const CXBOT_MAX_ROWS_PER_HOUR = 300;
/** Authenticated requests a rolling hour, refused ones included. */
export const CXBOT_MAX_REQUESTS_PER_HOUR = 600;
/** Actions that read a venue (markets, quote, order, close) a rolling minute: the venue's per-IP budget is shared. */
export const CXBOT_MAX_READS_PER_MINUTE = 10;
export const CXBOT_MAX_ANSWERS_PER_REQUEST = 20;
export const CXBOT_MIN_SECRET_CHARS = 32;
export const CXBOT_FUTURE_SKEW_MS = 10 * 60e3;
export const CXBOT_MAX_AGE_MS = 7 * 86400e3;
export const CXBOT_MAX_ERRORS = 20;

const ID = /^[A-Za-z0-9._:-]{1,64}$/;
const QID = /^[A-Za-z0-9._:-]{1,96}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

export const DECISION_ACTIONS = ["open", "close", "amend", "cancel", "no_action"] as const;
/** E a listed release ahead, R the reaction to one behind, N anything else; C a change to what is held. */
export const CATEGORIES = ["E", "N", "R", "C"] as const;
export const CYCLE_KINDS = ["full", "pm", "event", "light"] as const;

export type Decision = {
  id: string; ts: string; action: typeof DECISION_ACTIONS[number]; category: typeof CATEGORIES[number] | null; coin: Coin | null; direction: Dir | null;
  size: number | null; entry: number | null; stop: number | null; limit: number | null; p: number | null; event_at: string | null;
  position_id: number | null; sources: string[]; reason: string; invalidation: string | null;
};
export type Cycle = { id: string; ts: string; kind: typeof CYCLE_KINDS[number]; equity_usd: number; open_positions: number; open_risk_usd: number; answered: number; actions: number; notes: string | null };
export type Daily = { id: string; day: string; equity_usd: number; pnl_day_usd: number; pnl_total_usd: number; trades: number; summary: string; lessons: string | null };
export type Answer = { question_id: string; p: number; reason: string; sources: string[] };

const DECISION_KEYS = ["id", "ts", "action", "category", "coin", "direction", "size", "entry", "stop", "limit", "p", "event_at", "position_id", "sources", "reason", "invalidation"];
const CYCLE_KEYS = ["id", "ts", "kind", "equity_usd", "open_positions", "open_risk_usd", "answered", "actions", "notes"];
const DAILY_KEYS = ["id", "day", "equity_usd", "pnl_day_usd", "pnl_total_usd", "trades", "summary", "lessons"];
const ANSWER_KEYS = ["question_id", "p", "reason", "sources"];

type Obj = Record<string, unknown>;
export const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);

function checker(path: string, row: Obj, errors: string[]) {
  const err = (f: string, what: string) => { errors.push(`${path}.${f}: ${what}`); return null; };
  const has = (f: string) => row[f] !== undefined && row[f] !== null;
  const text = (f: string, max: number, required: boolean): string | null => {
    if (!has(f)) return required ? err(f, "required") : null;
    const v = row[f];
    if (typeof v !== "string") return err(f, "must be a string");
    if (v.includes("\u0000")) return err(f, "must not contain NUL");
    if (v.length < 1 || v.length > max) return err(f, `must be 1–${max} characters`);
    return v;
  };
  const match = (f: string, re: RegExp, what: string, required: boolean): string | null => {
    if (!has(f)) return required ? err(f, "required") : null;
    return typeof row[f] === "string" && re.test(row[f] as string) ? row[f] as string : err(f, what);
  };
  const number = (f: string, lo: number, hi: number, required: boolean, open = false): number | null => {
    if (!has(f)) return required ? err(f, "required") : null;
    const v = row[f];
    if (typeof v !== "number" || !Number.isFinite(v)) return err(f, "must be a number");
    if (open ? !(v > lo && v < hi) : !(v >= lo && v <= hi)) return err(f, `must be ${open ? "strictly " : ""}between ${lo} and ${hi}`);
    return v;
  };
  const integer = (f: string, lo: number, hi: number, required = true): number | null => {
    const v = number(f, lo, hi, required);
    return v === null ? null : Number.isInteger(v) ? v : err(f, "must be a whole number");
  };
  const oneOf = <T extends string>(f: string, list: readonly T[], required: boolean): T | null => {
    if (!has(f)) return required ? err(f, "required") : null;
    return (list as readonly unknown[]).includes(row[f]) ? row[f] as T : err(f, `must be one of ${list.join(", ")}`);
  };
  const unknownKeys = (allowed: string[]) => { for (const k of Object.keys(row)) if (!allowed.includes(k)) err(k, "unknown field"); };
  return { err, has, text, match, number, integer, oneOf, unknownKeys };
}
type Checker = ReturnType<typeof checker>;

function stampOf(c: Checker, f: string, nowMs: number): string | null {
  const v = c.match(f, ISO, "must be an ISO 8601 time with a zone, e.g. 2026-11-06T13:25:00Z", true);
  if (v === null) return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return c.err(f, "is not a valid time");
  if (t > nowMs + CXBOT_FUTURE_SKEW_MS) return c.err(f, `is ${((t - nowMs) / 60e3).toFixed(1)} minutes ahead of the server's clock (${new Date(nowMs).toISOString()}): stamp the time the row is written`);
  if (t < nowMs - CXBOT_MAX_AGE_MS) return c.err(f, "is more than 7 days old");
  return new Date(t).toISOString();
}
function timeOf(c: Checker, f: string, required: boolean): string | null {
  const v = c.match(f, ISO, "must be an ISO 8601 time with a zone", required);
  if (v === null) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : c.err(f, "is not a valid time");
}

function sourcesOf(c: Checker, row: Obj, required: boolean): string[] {
  if (row.sources === undefined || row.sources === null) { if (required) c.err("sources", "at least one source is required for an open"); return []; }
  if (!Array.isArray(row.sources)) { c.err("sources", "must be an array of URLs"); return []; }
  if (row.sources.length > 10) { c.err("sources", "at most 10"); return []; }
  if (required && !row.sources.length) { c.err("sources", "at least one source is required for an open"); return []; }
  const out: string[] = [];
  row.sources.forEach((s, i) => {
    if (typeof s !== "string" || s.length > 500 || s.includes("\u0000")) { c.err(`sources[${i}]`, "must be a URL of at most 500 characters"); return; }
    let u: URL;
    try { u = new URL(s); } catch { c.err(`sources[${i}]`, "is not a URL"); return; }
    if (u.protocol !== "https:" && u.protocol !== "http:") { c.err(`sources[${i}]`, "must be http or https"); return; }
    out.push(s);
  });
  return out;
}

/**
 * A decision. What each action needs:
 *   open       category E/N/R, coin, direction, size (coins), entry, stop, limit, p, sources (≥ 1), reason, invalidation;
 *              event_at for E and R
 *   close      position_id, reason
 *   amend      position_id, reason, and stop and/or limit
 *   cancel     reason (the order's id travels beside the decision)
 *   no_action  reason; a shadow bracket also names coin, direction, entry, stop, limit and p
 */
export function decisionOf(row: unknown, path: string, nowMs: number, errors: string[]): Decision | null {
  if (!isObj(row)) { errors.push(`${path}: must be an object`); return null; }
  const before = errors.length;
  const c = checker(path, row, errors);
  c.unknownKeys(DECISION_KEYS);
  const id = c.match("id", ID, "must be 1–64 of A–Z a–z 0–9 . _ : -", true);
  const ts = stampOf(c, "ts", nowMs);
  const action = c.oneOf("action", DECISION_ACTIONS, true);
  const open = action === "open";
  const category = c.oneOf("category", CATEGORIES, open);
  if (open && category === "C") c.err("category", "an open is E, N or R; C is a change to a position already held");
  const coin = c.oneOf("coin", COINS, open);
  const direction = c.oneOf("direction", ["long", "short"] as const, open);
  const size = c.number("size", 0, 1e6, open, true);
  const entry = c.number("entry", 0, 1e9, open, true);
  const stop = c.number("stop", 0, 1e9, open, true);
  const limit = c.number("limit", 0, 1e9, open, true);
  const p = c.number("p", 0, 1, open, true);
  const eventAt = timeOf(c, "event_at", open && (category === "E" || category === "R"));
  const pos = c.integer("position_id", 1, 1e12, action === "close" || action === "amend");
  const sources = sourcesOf(c, row, open);
  const reason = c.text("reason", 2000, true);
  const invalidation = c.text("invalidation", 1000, open);
  if (action === "amend" && !c.has("stop") && !c.has("limit")) c.err("stop", "an amend names stop, limit or both");
  if (action === "no_action" && [coin, direction, entry, stop, limit, p].some((x) => x !== null) && [coin, direction, entry, stop, limit, p].some((x) => x === null)) {
    c.err("p", "a shadow bracket names coin, direction, entry, stop, limit and p together");
  }
  if (errors.length > before) return null;
  return {
    id: id!, ts: ts!, action: action!, category, coin, direction, size, entry, stop, limit, p, event_at: eventAt,
    position_id: pos, sources, reason: reason!, invalidation,
  };
}

export function cycleOf(row: unknown, path: string, nowMs: number, errors: string[]): Cycle | null {
  if (!isObj(row)) { errors.push(`${path}: must be an object`); return null; }
  const before = errors.length;
  const c = checker(path, row, errors);
  c.unknownKeys(CYCLE_KEYS);
  const id = c.match("id", ID, "must be 1–64 of A–Z a–z 0–9 . _ : -", true);
  const ts = stampOf(c, "ts", nowMs);
  const kind = c.oneOf("kind", CYCLE_KINDS, true);
  const equity = c.number("equity_usd", 0, 1e7, true);
  const open = c.integer("open_positions", 0, 100);
  const risk = c.number("open_risk_usd", 0, 1e6, true);
  const answered = c.integer("answered", 0, 100);
  const actions = c.integer("actions", 0, 100);
  const notes = c.text("notes", 1000, false);
  if (errors.length > before) return null;
  return { id: id!, ts: ts!, kind: kind!, equity_usd: equity!, open_positions: open!, open_risk_usd: risk!, answered: answered!, actions: actions!, notes };
}

export function dailyOf(row: unknown, path: string, nowMs: number, errors: string[]): Daily | null {
  if (!isObj(row)) { errors.push(`${path}: must be an object`); return null; }
  const before = errors.length;
  const c = checker(path, row, errors);
  c.unknownKeys(DAILY_KEYS);
  const id = c.match("id", ID, "must be 1–64 of A–Z a–z 0–9 . _ : -", true);
  let day = c.match("day", DAY, "must be a UTC date, YYYY-MM-DD", true);
  if (day !== null) {
    const t = Date.parse(`${day}T00:00:00Z`);
    if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== day) day = c.err("day", "is not a date");
    else if (t > nowMs + CXBOT_FUTURE_SKEW_MS) day = c.err("day", "is in the future");
    else if (t < nowMs - CXBOT_MAX_AGE_MS - 86400e3) day = c.err("day", "is more than 7 days old");
  }
  const equity = c.number("equity_usd", 0, 1e7, true);
  const pd = c.number("pnl_day_usd", -1e6, 1e6, true);
  const pt = c.number("pnl_total_usd", -1e6, 1e6, true);
  const trades = c.integer("trades", 0, 1000);
  const summary = c.text("summary", 4000, true);
  const lessons = c.text("lessons", 2000, false);
  if (errors.length > before) return null;
  return { id: id!, day: day!, equity_usd: equity!, pnl_day_usd: pd!, pnl_total_usd: pt!, trades: trades!, summary: summary!, lessons };
}

export function answerOf(row: unknown, path: string, errors: string[]): Answer | null {
  if (!isObj(row)) { errors.push(`${path}: must be an object`); return null; }
  const before = errors.length;
  const c = checker(path, row, errors);
  c.unknownKeys(ANSWER_KEYS);
  const q = c.match("question_id", QID, "must be a question's id from ?action=questions", true);
  const p = c.number("p", 0, 1, true, true);
  const reason = c.text("reason", 2000, true);
  const sources = sourcesOf(c, row, false);
  if (errors.length > before) return null;
  return { question_id: q!, p: p!, reason: reason!, sources };
}

/** The forecast body: `{"answers": [ … ]}`, 1 to 20 answers, all or nothing, no question twice. */
export function validateAnswers(body: unknown): { ok: true; answers: Answer[] } | { ok: false; errors: string[] } {
  if (!isObj(body) || !Array.isArray(body.answers)) return { ok: false, errors: ["body: must be {\"answers\": [ … ]}"] };
  const errors: string[] = [];
  for (const k of Object.keys(body)) if (k !== "answers") errors.push(`${k}: unknown field`);
  const list = body.answers as unknown[];
  if (!list.length || list.length > CXBOT_MAX_ANSWERS_PER_REQUEST) errors.push(`answers: 1 to ${CXBOT_MAX_ANSWERS_PER_REQUEST}`);
  const answers = list.slice(0, CXBOT_MAX_ANSWERS_PER_REQUEST).map((r, i) => answerOf(r, `answers[${i}]`, errors)).filter((x): x is Answer => !!x);
  const seen = new Set<string>();
  for (const a of answers) { if (seen.has(a.question_id)) errors.push(`answers: ${a.question_id} appears twice`); seen.add(a.question_id); }
  return errors.length ? { ok: false, errors: errors.slice(0, CXBOT_MAX_ERRORS) } : { ok: true, answers };
}

/** The journal's body: decisions (no_action only), cycles and daily rows; at least one, at most 50; all or nothing. */
export function validateBatch(body: unknown, nowMs: number):
  { ok: true; batch: { decisions: Decision[]; cycles: Cycle[]; daily: Daily[] }; rows: number } | { ok: false; errors: string[] } {
  if (!isObj(body)) return { ok: false, errors: ["body: must be a JSON object with decisions, cycles and/or daily"] };
  const errors: string[] = [];
  for (const k of Object.keys(body)) if (!["decisions", "cycles", "daily"].includes(k)) errors.push(`${k}: unknown field`);
  const list = (k: string): unknown[] => {
    const v = body[k];
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) { errors.push(`${k}: must be an array`); return []; }
    return v;
  };
  const d = list("decisions"), c = list("cycles"), y = list("daily");
  const n = d.length + c.length + y.length;
  if (n === 0 && !errors.length) errors.push("body: no rows");
  if (n > CXBOT_MAX_ROWS_PER_REQUEST) errors.push(`body: ${n} rows, at most ${CXBOT_MAX_ROWS_PER_REQUEST} a request`);
  if (errors.length) return { ok: false, errors: errors.slice(0, CXBOT_MAX_ERRORS) };
  const batch = {
    decisions: d.map((r, i) => decisionOf(r, `decisions[${i}]`, nowMs, errors)).filter((x): x is Decision => !!x),
    cycles: c.map((r, i) => cycleOf(r, `cycles[${i}]`, nowMs, errors)).filter((x): x is Cycle => !!x),
    daily: y.map((r, i) => dailyOf(r, `daily[${i}]`, nowMs, errors)).filter((x): x is Daily => !!x),
  };
  batch.decisions.forEach((x, i) => { if (x.action !== "no_action") errors.push(`decisions[${i}].action: the journal takes no_action only; an ${x.action} goes through ?action=${x.action === "open" ? "order" : x.action}`); });
  for (const [k, rows] of Object.entries(batch) as Array<[string, Array<{ id: string }>]>) {
    const seen = new Set<string>();
    for (const r of rows) { if (seen.has(r.id)) errors.push(`${k}: id ${r.id} appears twice`); seen.add(r.id); }
  }
  if (errors.length) return { ok: false, errors: errors.slice(0, CXBOT_MAX_ERRORS) };
  return { ok: true, batch, rows: n };
}

export type RequestRow = { at: string; status: number; rows: number; action: string | null };
/** The actions that read a venue, counted against `CXBOT_MAX_READS_PER_MINUTE`. */
export const VENUE_ACTIONS = new Set(["markets", "quote", "order", "close"]);
/** The actions that trade (count against the rules' `maxOrdersPerMinute`). */
export const TRADING_ACTIONS = new Set(["order", "close", "amend", "cancel", "cancel_all"]);

/**
 * Whether a request may be taken now: the hour's requests and journal rows, and a venue read's minute. A request refused
 * 429 never counts, so an agent that retries is not locked out by its own refusals; the scheduler's rows never count.
 */
export function rateVerdict(last: RequestRow[], rows: number, nowMs: number, action: string | null) {
  const hour = last.filter((r) => Date.parse(r.at) > nowMs - 3600e3 && r.action !== "tick" && r.action !== "reach");
  const minuteReads = hour.filter((r) => r.action && VENUE_ACTIONS.has(r.action) && r.status !== 429 && Date.parse(r.at) > nowMs - 60e3).length;
  const used = hour.reduce((s, r) => s + (Number(r.rows) || 0), 0);
  const oldest = hour.reduce((m, r) => Math.min(m, Date.parse(r.at)), Infinity);
  const reading = !!action && VENUE_ACTIONS.has(action);
  const retryAfterS = reading && minuteReads >= CXBOT_MAX_READS_PER_MINUTE ? 60
    : Number.isFinite(oldest) ? Math.max(1, Math.ceil((oldest + 3600e3 - nowMs) / 1000)) : 1;
  const ok = hour.length < CXBOT_MAX_REQUESTS_PER_HOUR && used + rows <= CXBOT_MAX_ROWS_PER_HOUR && (!reading || minuteReads < CXBOT_MAX_READS_PER_MINUTE);
  return { ok, rowsLeft: Math.max(0, CXBOT_MAX_ROWS_PER_HOUR - used), requests: hour.length, retryAfterS };
}

/** The bearer, compared in constant time as SHA-256 digests; a secret shorter than the minimum refuses everything. */
export async function isAuthorised(header: string | null, secret: string): Promise<boolean> {
  if (!secret || secret.length < CXBOT_MIN_SECRET_CHARS || !header) return false;
  const m = /^Bearer (.+)$/.exec(header.trim());
  if (!m) return false;
  const enc = new TextEncoder();
  const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(m[1])), crypto.subtle.digest("SHA-256", enc.encode(secret))]);
  const x = hex(a), y = hex(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
