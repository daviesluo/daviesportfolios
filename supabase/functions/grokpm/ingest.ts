// GROKPM's journal ingest, the pure half: what a request must look like, and how much the agent may send.
//
// The agent is an outside Grok agent (Davies, 2026-10-15; docs/agents/reviews/2026-10-15-grokpm-prereg.md, whose appendix
// is the contract this file enforces). Everything it sends is untrusted data: every field is checked for its type, range and
// length, unknown fields are refused rather than kept, and free text is stored and shown as text only. Nothing here reads or
// runs what a field says.
//
// A request is one JSON object with up to three lists, `decisions`, `cycles` and `daily`, and at least one row in all. A row
// carries the agent's own `id`; a row sent again with an id already stored is a duplicate, not a second row, so the agent may
// retry a request whose answer it lost.

/** A request's body, at most. */
export const GROKPM_MAX_BODY_BYTES = 65_536;
/** Rows in one request, at most (the three lists together). */
export const GROKPM_MAX_ROWS_PER_REQUEST = 50;
/** Rows stored in any rolling hour, at most (the spec's "at most 200 rows an hour"). */
export const GROKPM_MAX_ROWS_PER_HOUR = 200;
/**
 * Authenticated requests in any rolling hour, at most, refused ones included: 120 for the journal alone, 600 since the
 * agent also reads its account and markets and sends its orders here (Deviation D2, 2026-10-16).
 */
export const GROKPM_MAX_REQUESTS_PER_HOUR = 600;
/** The bearer secret is refused as unset when shorter than this: a short secret could be guessed. */
export const GROKPM_MIN_SECRET_CHARS = 32;
/** A row's time may be this far ahead of the server's clock (the agent's clock drifts), and at most this old. */
export const GROKPM_FUTURE_SKEW_MS = 10 * 60e3;
export const GROKPM_MAX_AGE_MS = 7 * 86400e3;
/** Errors listed in a refusal, at most. */
export const GROKPM_MAX_ERRORS = 20;

const ID = /^[A-Za-z0-9._:-]{1,64}$/;
const COND = /^0x[0-9a-f]{64}$/;
const TOKEN = /^[0-9]{1,80}$/;
const ORDER_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

export const DECISION_ACTIONS = ["open", "close", "cancel", "no_action"] as const;
export const CYCLE_KINDS = ["light", "full", "event"] as const;
export const CATEGORIES = ["A", "B", "C"] as const;

export type Decision = {
  id: string; ts: string; action: typeof DECISION_ACTIONS[number]; market_id: string | null; token_id: string | null; outcome: string | null;
  side: "BUY" | "SELL" | null; price: number | null; size: number | null; p: number | null; m: number | null; category: "A" | "B" | "C" | null;
  sources: string[]; reason: string; invalidation: string | null; order_id: string | null;
};
export type Cycle = {
  id: string; ts: string; kind: typeof CYCLE_KINDS[number]; cash_usd: number; positions_value_usd: number; pnl_usd: number; open_positions: number;
  actions: number; notes: string | null;
};
export type Daily = {
  id: string; day: string; cash_usd: number; positions_value_usd: number; pnl_day_usd: number; pnl_total_usd: number; trades: number;
  summary: string; lessons: string | null;
};
export type Batch = { decisions: Decision[]; cycles: Cycle[]; daily: Daily[] };

const DECISION_KEYS = ["id", "ts", "action", "market_id", "token_id", "outcome", "side", "price", "size", "p", "m", "category", "sources", "reason", "invalidation", "order_id"];
const CYCLE_KEYS = ["id", "ts", "kind", "cash_usd", "positions_value_usd", "pnl_usd", "open_positions", "actions", "notes"];
const DAILY_KEYS = ["id", "day", "cash_usd", "positions_value_usd", "pnl_day_usd", "pnl_total_usd", "trades", "summary", "lessons"];

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);

/** A checker for one row: each `need`/`opt` call records an error under the row's path and returns the value or null. */
function rowChecker(path: string, row: Obj, errors: string[]) {
  const err = (field: string, what: string) => { errors.push(`${path}.${field}: ${what}`); return null; };
  const has = (f: string) => row[f] !== undefined && row[f] !== null;
  const text = (f: string, max: number, required: boolean, min = 1): string | null => {
    if (!has(f)) return required ? err(f, "required") : null;
    const v = row[f];
    if (typeof v !== "string") return err(f, "must be a string");
    if (v.includes("\u0000")) return err(f, "must not contain NUL");
    if (v.length < min || v.length > max) return err(f, `must be ${min}–${max} characters`);
    return v;
  };
  const match = (f: string, re: RegExp, what: string, required: boolean): string | null => {
    if (!has(f)) return required ? err(f, "required") : null;
    const v = row[f];
    return typeof v === "string" && re.test(v) ? v : err(f, what);
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
  const unknownKeys = (allowed: string[]) => {
    for (const k of Object.keys(row)) if (!allowed.includes(k)) err(k, "unknown field");
  };
  return { err, has, text, match, number, integer, oneOf, unknownKeys };
}

/** An ISO time with a zone, inside the window the server accepts around `nowMs`. */
function timeOf(c: ReturnType<typeof rowChecker>, f: string, nowMs: number): string | null {
  const v = c.match(f, ISO, "must be an ISO 8601 time with a zone, e.g. 2026-10-16T09:30:00Z", true);
  if (v === null) return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return c.err(f, "is not a valid time");
  if (t > nowMs + GROKPM_FUTURE_SKEW_MS) return c.err(f, "is more than 10 minutes in the future");
  if (t < nowMs - GROKPM_MAX_AGE_MS) return c.err(f, "is more than 7 days old");
  return new Date(t).toISOString();
}

/** A source: an http(s) URL, as text. It is shown as a link's text and target, never fetched by the server. */
function sourcesOf(c: ReturnType<typeof rowChecker>, row: Obj, required: boolean): string[] {
  if (row.sources === undefined || row.sources === null) { if (required) c.err("sources", "at least one source is required for category A or B"); return []; }
  if (!Array.isArray(row.sources)) { c.err("sources", "must be an array of URLs"); return []; }
  if (row.sources.length > 10) { c.err("sources", "at most 10"); return []; }
  if (required && row.sources.length === 0) { c.err("sources", "at least one source is required for category A or B"); return []; }
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

export function decisionOf(row: unknown, path: string, nowMs: number, errors: string[]): Decision | null {
  if (!isObj(row)) { errors.push(`${path}: must be an object`); return null; }
  const before = errors.length;
  const c = rowChecker(path, row, errors);
  c.unknownKeys(DECISION_KEYS);
  const id = c.match("id", ID, "must be 1–64 of A–Z a–z 0–9 . _ : -", true);
  const ts = timeOf(c, "ts", nowMs);
  const action = c.oneOf("action", DECISION_ACTIONS, true);
  const trades = action === "open" || action === "close";
  const market_id = c.match("market_id", COND, "must be a condition id: 0x and 64 lower-case hex digits", action !== "no_action");
  const token_id = c.match("token_id", TOKEN, "must be the token id as a decimal string", trades);
  const outcome = c.text("outcome", 64, false);
  const side = c.oneOf("side", ["BUY", "SELL"] as const, trades);
  if (action === "open" && side === "SELL") c.err("side", "an open is a BUY of the outcome's token");
  if (action === "close" && side === "BUY") c.err("side", "a close is a SELL of the outcome's token");
  const price = c.number("price", 0, 1, trades, true);
  const size = c.number("size", 0, 100_000, trades, true);
  const p = c.number("p", 0, 1, action === "open");
  const m = c.number("m", 0, 1, action === "open");
  const category = c.oneOf("category", CATEGORIES, trades);
  const sources = sourcesOf(c, row, action === "open" && (category === "A" || category === "B"));
  const reason = c.text("reason", 2000, true);
  const invalidation = c.text("invalidation", 1000, action === "open");
  const order_id = c.match("order_id", ORDER_ID, "must be 1–128 of A–Z a–z 0–9 . _ : -", false);
  if (errors.length > before) return null;
  return {
    id: id!, ts: ts!, action: action!, market_id, token_id, outcome, side, price, size, p, m, category, sources, reason: reason!, invalidation, order_id,
  };
}

export function cycleOf(row: unknown, path: string, nowMs: number, errors: string[]): Cycle | null {
  if (!isObj(row)) { errors.push(`${path}: must be an object`); return null; }
  const before = errors.length;
  const c = rowChecker(path, row, errors);
  c.unknownKeys(CYCLE_KEYS);
  const id = c.match("id", ID, "must be 1–64 of A–Z a–z 0–9 . _ : -", true);
  const ts = timeOf(c, "ts", nowMs);
  const kind = c.oneOf("kind", CYCLE_KINDS, true);
  const cash = c.number("cash_usd", 0, 100_000, true);
  const pv = c.number("positions_value_usd", 0, 100_000, true);
  const pnl = c.number("pnl_usd", -100_000, 100_000, true);
  const open = c.integer("open_positions", 0, 100);
  const actions = c.integer("actions", 0, 100);
  const notes = c.text("notes", 1000, false);
  if (errors.length > before) return null;
  return { id: id!, ts: ts!, kind: kind!, cash_usd: cash!, positions_value_usd: pv!, pnl_usd: pnl!, open_positions: open!, actions: actions!, notes };
}

export function dailyOf(row: unknown, path: string, nowMs: number, errors: string[]): Daily | null {
  if (!isObj(row)) { errors.push(`${path}: must be an object`); return null; }
  const before = errors.length;
  const c = rowChecker(path, row, errors);
  c.unknownKeys(DAILY_KEYS);
  const id = c.match("id", ID, "must be 1–64 of A–Z a–z 0–9 . _ : -", true);
  let day = c.match("day", DAY, "must be a UTC date, YYYY-MM-DD", true);
  if (day !== null) {
    const t = Date.parse(`${day}T00:00:00Z`);
    if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== day) day = c.err("day", "is not a date");
    else if (t > nowMs + GROKPM_FUTURE_SKEW_MS) day = c.err("day", "is in the future");
    else if (t < nowMs - GROKPM_MAX_AGE_MS - 86400e3) day = c.err("day", "is more than 7 days old");
  }
  const cash = c.number("cash_usd", 0, 100_000, true);
  const pv = c.number("positions_value_usd", 0, 100_000, true);
  const pd = c.number("pnl_day_usd", -100_000, 100_000, true);
  const pt = c.number("pnl_total_usd", -100_000, 100_000, true);
  const trades = c.integer("trades", 0, 1000);
  const summary = c.text("summary", 4000, true);
  const lessons = c.text("lessons", 2000, false);
  if (errors.length > before) return null;
  return { id: id!, day: day!, cash_usd: cash!, positions_value_usd: pv!, pnl_day_usd: pd!, pnl_total_usd: pt!, trades: trades!, summary: summary!, lessons };
}

/**
 * A request's body as rows, or every reason it is refused (at most `GROKPM_MAX_ERRORS`). All or nothing: one bad row
 * refuses the request, so the agent never has to work out which half was stored.
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
  if (n > GROKPM_MAX_ROWS_PER_REQUEST) errors.push(`body: ${n} rows, at most ${GROKPM_MAX_ROWS_PER_REQUEST} a request`);
  if (errors.length) return { ok: false, errors: errors.slice(0, GROKPM_MAX_ERRORS) };
  const batch: Batch = {
    decisions: d.map((r, i) => decisionOf(r, `decisions[${i}]`, nowMs, errors)).filter((x): x is Decision => !!x),
    cycles: c.map((r, i) => cycleOf(r, `cycles[${i}]`, nowMs, errors)).filter((x): x is Cycle => !!x),
    daily: y.map((r, i) => dailyOf(r, `daily[${i}]`, nowMs, errors)).filter((x): x is Daily => !!x),
  };
  // An id twice in one request is the agent's mistake, not a retry: refuse it rather than keep whichever came first.
  for (const [k, rows] of Object.entries(batch) as Array<[string, Array<{ id: string }>]>) {
    const seen = new Set<string>();
    for (const r of rows) { if (seen.has(r.id)) errors.push(`${k}: id ${r.id} appears twice`); seen.add(r.id); }
  }
  if (errors.length) return { ok: false, errors: errors.slice(0, GROKPM_MAX_ERRORS) };
  return { ok: true, batch, rows: n };
}

/** The last hour's authenticated requests, as `grokpm_requests` holds them. */
export type RequestRow = { at: string; status: number; rows: number };

/**
 * Whether a request of `rows` rows may be taken now: refused while the hour holds `GROKPM_MAX_REQUESTS_PER_HOUR` requests,
 * or when its rows would take the hour's stored rows past `GROKPM_MAX_ROWS_PER_HOUR`. `retryAfterS` is when the oldest
 * request of the hour leaves it (the soonest anything frees up), at least a second.
 */
export function rateVerdict(last: RequestRow[], rows: number, nowMs: number): { ok: boolean; rowsUsed: number; rowsLeft: number; requests: number; retryAfterS: number } {
  const hour = last.filter((r) => Date.parse(r.at) > nowMs - 3600e3);
  const used = hour.reduce((s, r) => s + (Number(r.rows) || 0), 0);
  const oldest = hour.reduce((m, r) => Math.min(m, Date.parse(r.at)), Infinity);
  const retryAfterS = Number.isFinite(oldest) ? Math.max(1, Math.ceil((oldest + 3600e3 - nowMs) / 1000)) : 1;
  const ok = hour.length < GROKPM_MAX_REQUESTS_PER_HOUR && used + rows <= GROKPM_MAX_ROWS_PER_HOUR;
  return { ok, rowsUsed: used, rowsLeft: Math.max(0, GROKPM_MAX_ROWS_PER_HOUR - used), requests: hour.length, retryAfterS };
}

/**
 * The table rows a batch is stored as: its typed columns, and in `raw` the row exactly as the agent sent it (`body`, the
 * request's parsed JSON, whose lists `validateBatch` took whole: a refused request stores nothing, so row i is list item i).
 */
export function tableRows(batch: Batch, body: unknown) {
  const b = (isObj(body) ? body : {}) as Record<string, unknown[] | undefined>;
  const raw = (k: string, i: number) => (Array.isArray(b[k]) ? b[k]![i] : null);
  return {
    grokpm_decisions: batch.decisions.map((d, i) => ({ ...d, raw: raw("decisions", i) })),
    grokpm_cycles: batch.cycles.map((c, i) => ({ ...c, raw: raw("cycles", i) })),
    grokpm_daily: batch.daily.map((y, i) => ({ ...y, raw: raw("daily", i) })),
  };
}

/** The bearer secret, compared in constant time as SHA-256 digests; a secret shorter than the minimum refuses everything. */
export async function isAuthorised(header: string | null, secret: string): Promise<boolean> {
  if (!secret || secret.length < GROKPM_MIN_SECRET_CHARS || !header) return false;
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
