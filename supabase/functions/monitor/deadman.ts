// PR5's dead-man switch: when its live executor has stopped turning, nothing it left on the venue may stay there.
//
// On whose word. Davies, 2026-10-02: "加一个“掉线保护”：执行器连续几轮没跑时撤掉所有挂单，免得像今天卡死时那样旧挂单被成交。
// 这个加上" ("add a dead-man switch: when the executor misses several turns in a row, cancel every resting order, so that
// stale orders are not filled the way they were when it stalled today").
//
// Why. On 2026-10-02 the database thrashed from about 13:00 to 14:20 UTC. PR5's live executor (`agents/quotes_live.ts`,
// the Revolut X sub-account whose key is `_2`) runs inside the one-minute job, and between 12:51 and 14:12 UTC its call
// started in 2 minutes of 81 (`edge_call_beats`). Its post-only quotes stayed on the venue at the prices of before the
// stall, and stale bids were filled.
//
// What. The Cloudflare Worker (`workers/monitor`) calls this every minute from outside Supabase's scheduler, so it runs
// while pg_cron does not. It reads when the executor last finished a turn (`agent_quote_live_state.updated_at`, written
// at the end of every turn), with a short timeout and one retry:
//   * fresh, at most `DEADMAN_STALE_MS` old (three missed one-minute turns): it does nothing, and calls nothing at the venue;
//   * older, or not readable at all: it lists the sub-account's active orders and cancels every one, entries, exits and a
//     resting conversion alike ("all resting orders", Davies), and reads each back as the executor reads its own: an
//     order still open on its read-back is read again after the executor's own pauses, and only a read-back showing it
//     cancelled (or filled) counts it done. One the venue still shows open is reported open, and the next minute asks again.
// It never places an order: the venue it is given has no placement (`DeadmanVenue`).
//
// What it records. When it acted (or could not list the orders), one `agent_quote_live_events` row (kind `deadman`,
// migration 0086) and one `ops_errors` row (kind `monitor.deadman`), each best-effort with a short timeout: the
// database is the likeliest thing to be down when this fires. The full report always goes back to the Worker, which
// queues it for the errors box when the database did not take it.
//
// What happens next. The executor's next turn finds each of its orders cancelled on its own read-back, marks the row
// cancelled, and its rung quotes the paper engine's decision again; an exit goes out again for what the rung holds
// (pinned in `agents/quotes_live.test.ts`). Nothing here writes the executor's tables but the event row.

import { cancelOrder, getOrder, orderViewProblem, readOrder, revxFetch, toOrderView, type RevxEnv, type VenueOrder } from "../_shared/revx.ts";

/** Older than this, the executor has missed three one-minute turns: it finishes a turn about 26–35 s into each minute. */
export const DEADMAN_STALE_MS = 180_000;
/** Each read of the executor's state waits this long, and a failed read is tried once more after a short pause. */
export const DEADMAN_READ_TIMEOUT_MS = 4_000;
export const DEADMAN_READ_ATTEMPTS = 2;
export const DEADMAN_READ_RETRY_MS = 500;
/**
 * Revolut X carries a cancel out a moment after its 204: an order still open on its read-back is read again after these
 * pauses, as the executor does (`QUOTE_LIVE_CANCEL_REREAD_MS` in `agents/quotes_live.ts`; equal, pinned by the test). Not
 * imported from there: this function must not load the agents bundle, so a broken one cannot take it down.
 */
export const DEADMAN_CANCEL_REREAD_MS = [300, 700] as const;
/** A cancel the venue's rate limit turned away (429) is sent once more after this. */
export const DEADMAN_429_WAIT_MS = 1_000;
/** No cancel is started this long after the run began; the rest are left for the next minute, which asks again. */
export const DEADMAN_DEADLINE_MS = 40_000;
/** The active list is read at most this many pages deep (PR5 rests at most thirteen orders: twelve rungs and a conversion). */
export const DEADMAN_LIST_PAGES = 5;

/**
 * PR5's own sub-account's key, by the names the store holds it under, read as `agents/index.ts` reads them for its live
 * executor (`REVX_KEY_NAMES.revx2`; equal, pinned by the test).
 */
export const PR5_KEY_NAMES = {
  apiKey: ["REVOLUT_X_API_KEY_2", "Revolut_X_API_kEY_2"],
  priv: ["REVOLUT_X_PRIVATE_KEY_2", "Revolut_X_Private_Key_2"],
} as const;

const iso = (ms: number) => new Date(ms).toISOString();
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** What one read of the executor's state found: its `updated_at` (null with no row), or why it could not be read. */
export type StateRead = { ok: true; updatedAt: string | null } | { ok: false; error: string };
export type Verdict = { verdict: "fresh" | "stale" | "unreadable"; ageS: number | null; stateAt: string | null; why: string };

/** "4 min 12 s", "1 h 05 min", "35 s": an age a person reads. */
export function ago(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} min`;
}

/** Fresh, stale or unreadable, from one read of the state and the clock. A time ahead of the clock is fresh. */
export function judge(read: StateRead, now: number): Verdict {
  if (!read.ok) return { verdict: "unreadable", ageS: null, stateAt: null, why: `PR5's executor state could not be read (${read.error})` };
  const t = read.updatedAt == null ? NaN : Date.parse(read.updatedAt);
  if (!Number.isFinite(t)) {
    return {
      verdict: "unreadable", ageS: null, stateAt: read.updatedAt,
      why: read.updatedAt == null ? "PR5's executor has no state row" : `PR5's executor state has an unreadable time ${JSON.stringify(read.updatedAt).slice(0, 40)}`,
    };
  }
  const ageMs = now - t, ageS = Math.round(ageMs / 1000), stateAt = iso(t);
  if (ageMs > DEADMAN_STALE_MS) return { verdict: "stale", ageS, stateAt, why: `PR5's executor last finished a turn ${ago(ageS)} ago (${stateAt.slice(11, 19)} UTC)` };
  return { verdict: "fresh", ageS, stateAt, why: `PR5's executor finished a turn ${ago(Math.max(0, ageS))} ago` };
}

/** One order on the active list, as listed: enough to cancel it and to say which it was. */
export type ActiveOrder = {
  id: string; clientOrderId: string | null; symbol: string; side: string; price: string | null; quantity: string | null; filled: string | null; state: string | null;
};
/** An order read back: the executor's own view of it (`toOrderView`), or the venue's raw status when the view refuses it. */
export type ReadBack = { ok: true; state: string; filled: number; note?: string } | { ok: false; error: string };
/** The venue as the dead-man uses it: list, cancel, read. There is no way to place an order through it. */
export type DeadmanVenue = {
  listActive(): Promise<{ ok: true; orders: ActiveOrder[] } | { ok: false; error: string }>;
  cancel(id: string): Promise<{ ok: true } | { ok: false; status: number; error: string }>;
  read(id: string): Promise<ReadBack>;
};

/**
 * PR5's sub-account through the shared Revolut X client: the signed active list (every order on it, including one the
 * executor's settlement could not read, paged by the cursor its other lists use), DELETE /orders/{id}, and
 * GET /orders/{id} read as the executor reads it.
 */
export function revxDeadmanVenue(env: RevxEnv, f: typeof fetch = fetch): DeadmanVenue {
  return {
    async listActive() {
      const seen = new Map<string, ActiveOrder>();
      let cursor = "";
      for (let page = 0; page < DEADMAN_LIST_PAGES; page++) {
        const r = await revxFetch<{ data?: VenueOrder[]; metadata?: { next_cursor?: string } }>(
          env, "GET", `/api/1.0/orders/active${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, undefined, f);
        if (!r.ok) return { ok: false, error: `${r.status} ${r.error}` };
        const rows = r.data?.data;
        if (!Array.isArray(rows)) return { ok: false, error: "the active list's reply carries no data list" };
        let added = 0;
        for (const vo of rows) {
          const o = readOrder(vo);
          if (!o.id || seen.has(o.id)) continue;
          seen.set(o.id, {
            id: o.id, clientOrderId: vo.client_order_id ?? null, symbol: vo.symbol, side: vo.side, price: vo.price ?? null,
            quantity: vo.quantity ?? vo.base_size ?? null, filled: o.filled ?? null, state: o.state ?? null,
          });
          added++;
        }
        const next = r.data?.metadata?.next_cursor ?? "";
        if (!next || !added || next === cursor) break;
        cursor = next;
      }
      return { ok: true, orders: [...seen.values()] };
    },
    async cancel(id) {
      const r = await cancelOrder(env, id, f);
      return r.ok ? { ok: true } : { ok: false, status: r.status, error: r.error };
    },
    async read(id) {
      const r = await getOrder(env, id, f);
      if (!r.ok) return { ok: false, error: `${r.status} ${r.error}` };
      const vo = r.data?.data;
      if (!vo) return { ok: false, error: "empty order reply" };
      const problem = orderViewProblem(vo);
      if (!problem) { const v = toOrderView(vo); return { ok: true, state: v.state, filled: v.filledBase }; }
      // The settlement view refuses it (a fill's price or fee missing, say): whether it still rests is the venue's status.
      const o = readOrder(vo);
      if (!o.state) return { ok: false, error: problem };
      return { ok: true, state: o.state, filled: Number(o.filled ?? 0) || 0, note: problem.slice(0, 200) };
    },
  };
}

/** What became of one order: read back cancelled (or refused), filled, still open, unreadable, or not reached by the deadline. */
export type CancelOutcome = ActiveOrder & {
  outcome: "cancelled" | "filled" | "open" | "unread" | "skipped";
  readState: string | null; readFilled: number | null; cancelAnswer: string; detail?: string;
};
const OPEN = new Set(["new", "partially_filled", "pending_new"]);

/** Cancel every listed order and read each back, one after another; never more than one order at a time on the wire. */
export async function cancelEvery(v: DeadmanVenue, orders: ActiveOrder[], o: {
  pause: (ms: number) => Promise<void>; clock: () => number; deadline: number;
}): Promise<CancelOutcome[]> {
  const out: CancelOutcome[] = [];
  for (const a of orders) {
    if (o.clock() > o.deadline) {
      out.push({ ...a, outcome: "skipped", readState: null, readFilled: null, cancelAnswer: "not sent", detail: "past the run's deadline: the next minute asks again" });
      continue;
    }
    const send = () => v.cancel(a.id).catch((e) => ({ ok: false as const, status: 0, error: msg(e) }));
    let c = await send();
    if (!c.ok && c.status === 429) { await o.pause(DEADMAN_429_WAIT_MS); c = await send(); }
    const cancelAnswer = c.ok ? "204" : `${c.status || "no reply"} ${c.error}`.slice(0, 160);
    // Read back whatever the DELETE said: a 404 for an order that had just finished, a reply that never came, or a 204
    // the venue carries out a moment later all say less than the order itself does.
    const read = () => v.read(a.id).catch((e): ReadBack => ({ ok: false, error: msg(e) }));
    let r = await read();
    for (const ms of DEADMAN_CANCEL_REREAD_MS) {
      if (!r.ok || !OPEN.has(r.state)) break;
      await o.pause(ms);
      r = await read();
    }
    if (!r.ok) { out.push({ ...a, outcome: "unread", readState: null, readFilled: null, cancelAnswer, detail: r.error }); continue; }
    const outcome = OPEN.has(r.state) ? "open" : r.state === "filled" ? "filled" : "cancelled";
    out.push({ ...a, outcome, readState: r.state, readFilled: r.filled, cancelAnswer, ...(r.note ? { detail: r.note } : {}) });
  }
  return out;
}

export type DeadmanReport = Verdict & {
  at: string;
  /** True when it sent a cancel, or tried to and could not list the orders. */
  acted: boolean;
  listed: number | null;
  orders: CancelOutcome[];
  error: string | null;
  /** What the database took of its record (null: nothing to record). */
  recorded: { events: boolean; ops: boolean } | null;
};
export type DeadmanDeps = {
  now: () => number;
  readState: () => Promise<StateRead>;
  /**
   * PR5's sub-account, loaded only when there is something to cancel: null when its key does not load, with `note`
   * saying why (a secret's name, never its value).
   */
  venue: () => Promise<{ venue: DeadmanVenue | null; note: string | null }>;
  record: (r: DeadmanReport) => Promise<{ events: boolean; ops: boolean }>;
  pause: (ms: number) => Promise<void>;
};

/** A line for a person: what the dead-man found and did. */
export function summary(r: DeadmanReport): string {
  if (r.verdict === "fresh") return r.why;
  if (r.error) return `${r.why}; ${r.error}`;
  if (!r.listed) return `${r.why}; no order rested on the venue`;
  const n = (k: CancelOutcome["outcome"]) => r.orders.filter((o) => o.outcome === k).length;
  const parts = [`the dead-man cancelled ${n("cancelled")} of ${r.listed} resting orders`];
  if (n("filled")) parts.push(`${n("filled")} had filled`);
  if (n("open")) parts.push(`${n("open")} still open on the venue`);
  if (n("unread")) parts.push(`${n("unread")} not read back`);
  if (n("skipped")) parts.push(`${n("skipped")} left for the next minute`);
  return `${r.why}; ${parts.join(", ")}`;
}

/**
 * One minute of the dead-man. Fresh: nothing else happens. Stale or unreadable: every active order is cancelled and
 * read back, and what was done is recorded. It never throws for the venue's or the database's sake.
 */
export async function runDeadman(d: DeadmanDeps): Promise<DeadmanReport> {
  const t0 = d.now();
  const v = judge(await d.readState(), t0);
  const report: DeadmanReport = { ...v, at: iso(t0), acted: false, listed: null, orders: [], error: null, recorded: null };
  if (v.verdict === "fresh") return report;
  const { venue, note } = await d.venue().catch((e) => ({ venue: null, note: msg(e) }));
  if (!venue) {
    // Nothing can be cancelled, and saying so every minute would bury the errors box: the Worker alerts on it instead.
    report.error = `PR5's Revolut X key is not loaded (${note ?? "no key"}): nothing can be cancelled`;
    return report;
  }
  const list = await venue.listActive().catch((e) => ({ ok: false as const, error: msg(e) }));
  if (!list.ok) {
    report.acted = true;
    report.error = `the resting orders could not be listed (${list.error}): nothing was cancelled`;
    report.recorded = await d.record(report);
    return report;
  }
  report.listed = list.orders.length;
  if (!list.orders.length) return report;
  report.acted = true;
  report.orders = await cancelEvery(venue, list.orders, { pause: d.pause, clock: d.now, deadline: t0 + DEADMAN_DEADLINE_MS });
  report.recorded = await d.record(report);
  return report;
}

// ------------------------------------------------------------------------------------------------------------- I/O

const restHeaders = (key: string) => ({ apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" });

/** One read of `agent_quote_live_state.updated_at`, given up after `timeoutMs`. */
export async function readStateOnce(sbUrl: string, key: string, f: typeof fetch = fetch, timeoutMs = DEADMAN_READ_TIMEOUT_MS): Promise<StateRead> {
  if (!sbUrl || !key) return { ok: false, error: "the function has no database URL or service key" };
  try {
    const res = await f(`${sbUrl}/rest/v1/agent_quote_live_state?id=eq.1&select=updated_at`, { headers: restHeaders(key), signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `${res.status} ${text.slice(0, 160)}` };
    const rows = JSON.parse(text);
    if (!Array.isArray(rows)) return { ok: false, error: "the reply is not a list" };
    const at = rows[0]?.updated_at;
    return { ok: true, updatedAt: typeof at === "string" ? at : null };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/** The state, read up to `DEADMAN_READ_ATTEMPTS` times: one slow read is not yet "cannot be read at all". */
export async function readState(once: () => Promise<StateRead>, pause: (ms: number) => Promise<void>): Promise<StateRead> {
  let r = await once();
  for (let i = 1; i < DEADMAN_READ_ATTEMPTS && !r.ok; i++) { await pause(DEADMAN_READ_RETRY_MS); r = await once(); }
  return r;
}

/** The record rows, as the schema takes them: an `agent_quote_live_events` row (0052, kind `deadman` since 0086) and an `ops_errors` row. */
export function recordRows(r: DeadmanReport): { event: Record<string, unknown>; ops: Record<string, unknown> } {
  const minute = iso(Math.floor(Date.parse(r.at) / 60e3) * 60e3);
  const orders = r.orders.map((o) => ({
    id: o.id, clientOrderId: o.clientOrderId, symbol: o.symbol, side: o.side, price: o.price, quantity: o.quantity,
    outcome: o.outcome, readState: o.readState, readFilled: o.readFilled, cancelAnswer: o.cancelAnswer, ...(o.detail ? { detail: o.detail } : {}),
  }));
  const detail = { verdict: r.verdict, why: r.why, stateAt: r.stateAt, ageS: r.ageS, listed: r.listed, error: r.error, orders };
  const context = { verdict: r.verdict, stateAt: r.stateAt, ageS: r.ageS, listed: r.listed, outcomes: r.orders.map((o) => o.outcome) };
  return {
    event: { mode: "live", minute, book: "-", rung_side: "-", k: 0, kind: "deadman", detail },
    ops: { kind: "monitor.deadman", symbol: "pr5", message: summary(r).slice(0, 512), context, ip: "monitor" },
  };
}

/** Write the record, each row on its own and best-effort: what the database took. */
export async function writeRecord(r: DeadmanReport, sbUrl: string, key: string, f: typeof fetch = fetch, timeoutMs = DEADMAN_READ_TIMEOUT_MS): Promise<{ events: boolean; ops: boolean }> {
  if (!sbUrl || !key) return { events: false, ops: false };
  const { event, ops } = recordRows(r);
  const post = async (path: string, body: unknown, prefer: string) => {
    try {
      const res = await f(`${sbUrl}/rest/v1/${path}`, { method: "POST", headers: { ...restHeaders(key), Prefer: prefer }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
      await res.text();
      return res.ok;
    } catch {
      return false;
    }
  };
  const [events, opsOk] = await Promise.all([
    post("agent_quote_live_events?on_conflict=mode,minute,book,rung_side,k,kind", [event], "resolution=merge-duplicates,return=minimal"),
    post("ops_errors", ops, "return=minimal"),
  ]);
  return { events, ops: opsOk };
}

/** PR5's key from the store, by the executor's names and as `envAny` reads them: the first one set of each, trimmed. */
export function pr5KeyFrom(get: (name: string) => string | undefined): { apiKey: string; priv: string } | { error: string } {
  const first = (names: readonly string[]) => { for (const n of names) { const v = get(n); if (v && v.trim()) return v.trim(); } return ""; };
  const apiKey = first(PR5_KEY_NAMES.apiKey), priv = first(PR5_KEY_NAMES.priv);
  if (!apiKey) return { error: `${PR5_KEY_NAMES.apiKey[0]} missing` };
  if (!priv) return { error: `${PR5_KEY_NAMES.priv[0]} missing` };
  return { apiKey, priv };
}
