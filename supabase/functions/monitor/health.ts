// Is Supabase's minute loop alive? The read-only health reading the Cloudflare Worker (`workers/monitor`) asks for every
// minute, from outside Supabase's scheduler.
//
// Why these readings. On 2026-10-02 the database thrashed from about 13:00 to 14:20 UTC and nothing alerted: the
// GitHub health check asks for every 10 minutes and ran 9 times in 48 hours. What the stall looked like in the tables:
// between 12:51 and 14:12 UTC the tick's call started in 2 minutes of 81 and PR5's in 2 (`edge_call_beats`), and the
// tick's hourly decisions came 1 h 29 min apart where 1 h 00 min is the most in the three days around it. So:
//   * tickBeat  — the newest beat of the tick's call: pg_cron fired the one-minute job and the call's worker started.
//   * tickTurn  — the tick's lease: released at the end of a turn with `lease_until` set to the turn's start, and held
//                 into the future while a turn runs. A turn that finished, or one in flight, is fresh.
//   * quotes    — PR5's live executor finished a turn (`agent_quote_live_state.updated_at`, written at its end).
//   * decisions — the newest strategy decision: one each hour at the least (trend-1h's three coins), so a tick that
//                 runs and decides nothing shows here. The day no hourly row runs any more, this limit moves to the
//                 slowest row's bar plus a quarter of an hour, or it alerts every hour.
//   * pmLp      — "Reward quotes live-prep"'s order path finished a turn (`pm_lp_state.updated_at`, written each minute
//                 from eu-west-1, in dry-run as armed). Added 2026-10-08 for its go (its pre-registration's P5 and
//                 Addendum 4, the design doc's step 8lp: "a freshness reading … is to be added before or with the go").
//                 Its orders are GTD of 600 s, so a path that stops leaves nothing resting past ten minutes; this reads
//                 the stop within three.
// A minute's reading is stale past three minutes, the dead-man's own line (`deadman.ts`); the hourly one past 75
// minutes. The Worker alerts only after two failing minutes in a row, so one slow minute never pages.
//
// Read-only: five small selects with the service key, each with its own timeout, none of which writes.
//
// Beside them, the database's size (review F4, 0101: it grew about 120 MB a day): `size`, from `db_size_bytes()`, shown
// with the five and never failing them, so a database grown large does not hold the loop's alert open and hide a stall
// behind it. Its own watch is SQL's: `db-size-watch` (0101) writes a `db.size` row to the errors box once a day while
// it is over `DB_SIZE_WATCH_BYTES`.

const iso = (ms: number) => new Date(ms).toISOString();
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

export const HEALTH_READ_TIMEOUT_MS = 5_000;
/** How old each reading may be, in seconds. */
export const HEALTH_LIMITS_S = { tickBeat: 180, tickTurn: 180, quotes: 180, decisions: 75 * 60, pmLp: 180 } as const;
export type HealthName = keyof typeof HEALTH_LIMITS_S;
export const HEALTH_NAMES = Object.keys(HEALTH_LIMITS_S) as HealthName[];
/** The beat key the tick's call writes (`_shared/beats.ts`: the function, and `?action=` with its action). */
export const TICK_BEAT_KEY = "agents?action=tick";

/** What one reading found: a time (null: there is none), or why it could not be read. */
export type Reading = { ok: true; at: string | null } | { ok: false; error: string };
export type HealthCheck = { ok: boolean; at: string | null; ageS: number | null; limitS: number; error?: string };
export type HealthReport = { at: string; ok: boolean; checks: Record<HealthName, HealthCheck>; size?: SizeReading };

/** The size the daily watch (0101's `db-size-watch`) writes to the errors box past: 4 GB, half the plan's 8 GB disk. */
export const DB_SIZE_WATCH_BYTES = 4_000_000_000;
/** The database's size, or why it could not be read. */
export type SizeReading = { ok: true; bytes: number; limitBytes: number; over: boolean } | { ok: false; error: string };

/** Each reading against its limit. A time ahead of the clock (a turn in flight holds its lease into the future) is fresh. */
export function judgeHealth(now: number, readings: Record<HealthName, Reading>): HealthReport {
  const checks = {} as Record<HealthName, HealthCheck>;
  for (const name of HEALTH_NAMES) {
    const r = readings[name], limitS = HEALTH_LIMITS_S[name];
    if (!r.ok) { checks[name] = { ok: false, at: null, ageS: null, limitS, error: r.error }; continue; }
    const t = r.at == null ? NaN : Date.parse(r.at);
    if (!Number.isFinite(t)) { checks[name] = { ok: false, at: r.at, ageS: null, limitS, error: r.at == null ? "nothing recorded" : "an unreadable time" }; continue; }
    const ageS = Math.round((now - t) / 1000);
    checks[name] = { ok: ageS <= limitS, at: iso(t), ageS, limitS };
  }
  return { at: iso(now), ok: HEALTH_NAMES.every((n) => checks[n].ok), checks };
}

/** The five selects, as PostgREST paths, and the column each reading takes its time from. */
export const HEALTH_QUERIES: Record<HealthName, { path: string; column: string }> = {
  tickBeat: { path: `edge_call_beats?path=eq.${encodeURIComponent(TICK_BEAT_KEY)}&select=minute&order=minute.desc&limit=1`, column: "minute" },
  tickTurn: { path: "agent_locks?name=eq.tick&select=lease_until", column: "lease_until" },
  quotes: { path: "agent_quote_live_state?id=eq.1&select=updated_at", column: "updated_at" },
  // By id, which only grows: the primary key answers at once, where `ts` has no index of its own.
  decisions: { path: "agent_decisions?select=ts&order=id.desc&limit=1", column: "ts" },
  pmLp: { path: "pm_lp_state?id=eq.1&select=updated_at", column: "updated_at" },
};

/** One reading over PostgREST with the service key. */
export async function readOne(sbUrl: string, key: string, q: { path: string; column: string }, f: typeof fetch = fetch, timeoutMs = HEALTH_READ_TIMEOUT_MS): Promise<Reading> {
  if (!sbUrl || !key) return { ok: false, error: "the function has no database URL or service key" };
  try {
    const res = await f(`${sbUrl}/rest/v1/${q.path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `${res.status} ${text.slice(0, 160)}` };
    const rows = JSON.parse(text);
    if (!Array.isArray(rows)) return { ok: false, error: "the reply is not a list" };
    const v = rows[0]?.[q.column];
    return { ok: true, at: typeof v === "string" ? v : null };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/** The database's size by `db_size_bytes()` (0101), a GET of a stable function, answered as a bare number. */
export const DB_SIZE_PATH = "rpc/db_size_bytes";
export async function readDbSize(sbUrl: string, key: string, f: typeof fetch = fetch, timeoutMs = HEALTH_READ_TIMEOUT_MS): Promise<SizeReading> {
  if (!sbUrl || !key) return { ok: false, error: "the function has no database URL or service key" };
  try {
    const res = await f(`${sbUrl}/rest/v1/${DB_SIZE_PATH}`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `${res.status} ${text.slice(0, 160)}` };
    const bytes = Number(JSON.parse(text));
    if (!Number.isFinite(bytes) || bytes < 0) return { ok: false, error: "the reply is not a size" };
    return { ok: true, bytes, limitBytes: DB_SIZE_WATCH_BYTES, over: bytes > DB_SIZE_WATCH_BYTES };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/** The five readings at once, judged, and the size beside them (outside `ok`). */
export async function runHealth(sbUrl: string, key: string, now: () => number, f: typeof fetch = fetch): Promise<HealthReport> {
  const [entries, size] = await Promise.all([
    Promise.all(HEALTH_NAMES.map(async (n) => [n, await readOne(sbUrl, key, HEALTH_QUERIES[n], f)] as const)),
    readDbSize(sbUrl, key, f),
  ]);
  return { ...judgeHealth(now(), Object.fromEntries(entries) as Record<HealthName, Reading>), size };
}
