// IGBOT's journal and request bodies, the pure half: what a row must look like and how much the agent may send. Modelled
// on GROKPM's (`grokpm/ingest.ts`): every field the agent sends is untrusted data, checked for type, range and length;
// unknown fields are refused, not kept; free text is stored and shown as text only and never read as an instruction. A
// row carries the agent's own `id`, so a resend is a duplicate, not a second row.

export const IGBOT_MAX_BODY_BYTES = 65_536;
export const IGBOT_MAX_ROWS_PER_REQUEST = 50;
export const IGBOT_MAX_ROWS_PER_HOUR = 200;
/** Authenticated requests a rolling hour, refused ones included. */
export const IGBOT_MAX_REQUESTS_PER_HOUR = 300;
/** Actions that read or trade at IG (everything but the ping and the journal) a rolling minute: IG's 30 a minute is shared. */
export const IGBOT_MAX_ACTIONS_PER_MINUTE = 4;
export const IGBOT_MIN_SECRET_CHARS = 32;
export const IGBOT_FUTURE_SKEW_MS = 10 * 60e3;
export const IGBOT_MAX_AGE_MS = 7 * 86400e3;
export const IGBOT_MAX_ERRORS = 20;

const ID = /^[A-Za-z0-9._:-]{1,64}$/;
export const EPIC_RE = /^[A-Za-z0-9._]{6,30}$/;
export const DEAL_RE = /^[A-Za-z0-9_-]{1,40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

export const DECISION_ACTIONS = ["open", "close", "amend", "cancel", "no_action"] as const;
/** E a scheduled event ahead, R the reaction to one just past, N unscheduled news; C a change to what is held. */
export const CATEGORIES = ["E", "N", "R", "C"] as const;
export const CYCLE_KINDS = ["light", "full", "event"] as const;

export type Decision = {
  id: string; ts: string; action: typeof DECISION_ACTIONS[number]; category: typeof CATEGORIES[number] | null; epic: string | null;
  direction: "BUY" | "SELL" | null; size: number | null; level: number | null; stop_level: number | null; limit_level: number | null;
  p_target: number | null; event_at: string | null; deal_id: string | null; sources: string[]; reason: string; invalidation: string | null;
};
export type Cycle = { id: string; ts: string; kind: typeof CYCLE_KINDS[number]; equity_gbp: number; open_positions: number; open_risk_gbp: number; actions: number; notes: string | null };
export type Daily = { id: string; day: string; equity_gbp: number; pnl_day_gbp: number; pnl_total_gbp: number; trades: number; summary: string; lessons: string | null };
export type Batch = { decisions: Decision[]; cycles: Cycle[]; daily: Daily[] };

const DECISION_KEYS = ["id", "ts", "action", "category", "epic", "direction", "size", "level", "stop_level", "limit_level", "p_target", "event_at", "deal_id", "sources", "reason", "invalidation"];
const CYCLE_KEYS = ["id", "ts", "kind", "equity_gbp", "open_positions", "open_risk_gbp", "actions", "notes"];
const DAILY_KEYS = ["id", "day", "equity_gbp", "pnl_day_gbp", "pnl_total_gbp", "trades", "summary", "lessons"];

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
  const integer = (f: string, lo: number, hi: number): number | null => {
    const v = number(f, lo, hi, true);
    return v === null ? null : Number.isInteger(v) ? v : err(f, "must be a whole number");
  };
  const oneOf = <T extends string>(f: string, list: readonly T[], required: boolean): T | null => {
    if (!has(f)) return required ? err(f, "required") : null;
    return (list as readonly unknown[]).includes(row[f]) ? row[f] as T : err(f, `must be one of ${list.join(", ")}`);
  };
  const unknownKeys = (allowed: string[]) => { for (const k of Object.keys(row)) if (!allowed.includes(k)) err(k, "unknown field"); };
  return { err, has, text, match, number, integer, oneOf, unknownKeys };
}

/** An ISO time with a zone inside the window the server accepts around `nowMs` (a row's stamp). */
function stampOf(c: ReturnType<typeof checker>, f: string, nowMs: number): string | null {
  const v = c.match(f, ISO, "must be an ISO 8601 time with a zone, e.g. 2026-11-06T13:25:00Z", true);
  if (v === null) return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return c.err(f, "is not a valid time");
  if (t > nowMs + IGBOT_FUTURE_SKEW_MS) return c.err(f, `is ${((t - nowMs) / 60e3).toFixed(1)} minutes ahead of the server's clock (${new Date(nowMs).toISOString()}): stamp the time the row is written`);
  if (t < nowMs - IGBOT_MAX_AGE_MS) return c.err(f, "is more than 7 days old");
  return new Date(t).toISOString();
}
/** Any valid ISO time with a zone (an event's time may be days ahead). */
function timeOf(c: ReturnType<typeof checker>, f: string, required: boolean): string | null {
  const v = c.match(f, ISO, "must be an ISO 8601 time with a zone", required);
  if (v === null) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : c.err(f, "is not a valid time");
}

function sourcesOf(c: ReturnType<typeof checker>, row: Obj, required: boolean): string[] {
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
 *   open       category E/N/R, epic, direction, size (£ a point), level, stop_level, limit_level, p_target, sources (≥ 1),
 *              reason, invalidation; event_at for E and R
 *   close      deal_id, reason (size optional: the whole position when absent)
 *   amend      deal_id, reason, and stop_level and/or limit_level
 *   cancel     deal_id (a working order), reason
 *   no_action  reason; a shadow forecast also names epic, direction, level, stop_level, limit_level and p_target, and is
 *              scored later like an open (the prereg's §6.3), with no order behind it
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
  const epic = c.match("epic", EPIC_RE, "must be an IG epic (6–30 of A–Z a–z 0–9 . _)", open);
  const direction = c.oneOf("direction", ["BUY", "SELL"] as const, open);
  const size = c.number("size", 0, 1000, open, true);
  const level = c.number("level", 0, 1e9, open, true);
  const stop = c.number("stop_level", 0, 1e9, open, true);
  const limit = c.number("limit_level", 0, 1e9, open, true);
  const p = c.number("p_target", 0, 1, open, true);
  const eventAt = timeOf(c, "event_at", open && (category === "E" || category === "R"));
  const deal = c.match("deal_id", DEAL_RE, "must be an IG deal id (1–40 of A–Z a–z 0–9 _ -)", action === "close" || action === "amend" || action === "cancel");
  const sources = sourcesOf(c, row, open);
  const reason = c.text("reason", 2000, true);
  const invalidation = c.text("invalidation", 1000, open);
  if (action === "amend" && !c.has("stop_level") && !c.has("limit_level")) c.err("stop_level", "an amend names stop_level, limit_level or both");
  if (errors.length > before) return null;
  return {
    id: id!, ts: ts!, action: action!, category, epic, direction, size, level, stop_level: stop, limit_level: limit, p_target: p, event_at: eventAt,
    deal_id: deal, sources, reason: reason!, invalidation,
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
  const equity = c.number("equity_gbp", 0, 1e7, true);
  const open = c.integer("open_positions", 0, 100);
  const risk = c.number("open_risk_gbp", 0, 1e6, true);
  const actions = c.integer("actions", 0, 100);
  const notes = c.text("notes", 1000, false);
  if (errors.length > before) return null;
  return { id: id!, ts: ts!, kind: kind!, equity_gbp: equity!, open_positions: open!, open_risk_gbp: risk!, actions: actions!, notes };
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
    else if (t > nowMs + IGBOT_FUTURE_SKEW_MS) day = c.err("day", "is in the future");
    else if (t < nowMs - IGBOT_MAX_AGE_MS - 86400e3) day = c.err("day", "is more than 7 days old");
  }
  const equity = c.number("equity_gbp", 0, 1e7, true);
  const pd = c.number("pnl_day_gbp", -1e6, 1e6, true);
  const pt = c.number("pnl_total_gbp", -1e6, 1e6, true);
  const trades = c.integer("trades", 0, 1000);
  const summary = c.text("summary", 4000, true);
  const lessons = c.text("lessons", 2000, false);
  if (errors.length > before) return null;
  return { id: id!, day: day!, equity_gbp: equity!, pnl_day_gbp: pd!, pnl_total_gbp: pt!, trades: trades!, summary: summary!, lessons };
}

/**
 * The journal's body: up to three lists, at least one row, at most 50. All or nothing. A decision posted here is a
 * `no_action` only: opens, closes, amends and cancels are journalled by the action that carries them out.
 */
export function validateBatch(body: unknown, nowMs: number): { ok: true; batch: Batch; rows: number } | { ok: false; errors: string[] } {
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
  if (n > IGBOT_MAX_ROWS_PER_REQUEST) errors.push(`body: ${n} rows, at most ${IGBOT_MAX_ROWS_PER_REQUEST} a request`);
  if (errors.length) return { ok: false, errors: errors.slice(0, IGBOT_MAX_ERRORS) };
  const batch: Batch = {
    decisions: d.map((r, i) => decisionOf(r, `decisions[${i}]`, nowMs, errors)).filter((x): x is Decision => !!x),
    cycles: c.map((r, i) => cycleOf(r, `cycles[${i}]`, nowMs, errors)).filter((x): x is Cycle => !!x),
    daily: y.map((r, i) => dailyOf(r, `daily[${i}]`, nowMs, errors)).filter((x): x is Daily => !!x),
  };
  batch.decisions.forEach((x, i) => { if (x.action !== "no_action") errors.push(`decisions[${i}].action: the journal takes no_action only; an ${x.action} goes through ?action=${x.action === "open" ? "order" : x.action}`); });
  for (const [k, rows] of Object.entries(batch) as Array<[string, Array<{ id: string }>]>) {
    const seen = new Set<string>();
    for (const r of rows) { if (seen.has(r.id)) errors.push(`${k}: id ${r.id} appears twice`); seen.add(r.id); }
  }
  if (errors.length) return { ok: false, errors: errors.slice(0, IGBOT_MAX_ERRORS) };
  return { ok: true, batch, rows: n };
}

export type RequestRow = { at: string; status: number; rows: number; action: string | null };

/** Whether a request may be taken now: the hour's requests and rows, and for an action the minute's actions. */
export function rateVerdict(last: RequestRow[], rows: number, nowMs: number, isAction: boolean) {
  const hour = last.filter((r) => Date.parse(r.at) > nowMs - 3600e3);
  const minuteActions = hour.filter((r) => r.action && Date.parse(r.at) > nowMs - 60e3).length;
  const used = hour.reduce((s, r) => s + (Number(r.rows) || 0), 0);
  const oldest = hour.reduce((m, r) => Math.min(m, Date.parse(r.at)), Infinity);
  const retryAfterS = isAction && minuteActions >= IGBOT_MAX_ACTIONS_PER_MINUTE ? 60
    : Number.isFinite(oldest) ? Math.max(1, Math.ceil((oldest + 3600e3 - nowMs) / 1000)) : 1;
  const ok = hour.length < IGBOT_MAX_REQUESTS_PER_HOUR && used + rows <= IGBOT_MAX_ROWS_PER_HOUR && (!isAction || minuteActions < IGBOT_MAX_ACTIONS_PER_MINUTE);
  return { ok, rowsLeft: Math.max(0, IGBOT_MAX_ROWS_PER_HOUR - used), requests: hour.length, minuteActions, retryAfterS };
}

/** The bearer, compared in constant time as SHA-256 digests; a secret shorter than the minimum refuses everything. */
export async function isAuthorised(header: string | null, secret: string): Promise<boolean> {
  if (!secret || secret.length < IGBOT_MIN_SECRET_CHARS || !header) return false;
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
