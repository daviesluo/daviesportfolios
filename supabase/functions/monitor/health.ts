// Is Supabase's minute loop alive? The read-only health reading the Cloudflare Worker (`workers/monitor`) asks for every
// minute, from outside Supabase's scheduler.
//
// Why these readings. On 2026-10-02 the database thrashed from about 13:00 to 14:20 UTC and nothing alerted: the
// GitHub health check asks for every 10 minutes and ran 9 times in 48 hours. What the stall looked like in the tables:
// between 12:51 and 14:12 UTC the tick's call started in 2 minutes of 81 and PR5's in 2 (`edge_call_beats`), and the
// tick's hourly decisions came 1 h 29 min apart where 1 h 00 min is the most in the three days around it. So:
//   * quotes    — PR5's live executor finished a turn (`agent_quote_live_state.updated_at`, written at its end). It is the
//                 loop's signal now: its call is a row of the same one-minute job (`edge_calls`), it runs every minute
//                 of every day (1,434 beats in the 24 h to 2026-10-29 00:12 UTC), and a turn that does not finish shows
//                 here within three minutes, whether pg_cron did not fire, the call's worker did not start, or the
//                 database stalled under it. The day PR5's call is switched off, another reading takes its place in
//                 the same commit, or the Worker pages three minutes later and has nothing left to watch the loop by.
//   * cbLive    — Coinbase's live executor, "Stablecoin quotes USDC/GBP" (`cb_live.ts`, armed 2026-10-29 21:45 UTC),
//                 finished a turn (`cb_live_state.updated_at`, the turn's clock, written at its end). It is a call of its
//                 own (`agents?action=cblive`) with no watchdog retry (0177), and no dead-man of ours: Coinbase ends its
//                 orders within 20 minutes by itself, but a stopped executor manages no fill, no exit and no 24-hour stop,
//                 and nothing paged on one (2026-10-31 audit). Five minutes, not three: without the retry its turn misses
//                 the minute whenever the function fails to boot (188 of 1,440 minutes on 10-30/31, at most four in a
//                 row since it was armed), and only a stop longer than that is news.
//   (tickBeat and tickTurn, the tick's newest beat and its lease, were read here from 2026-10-02 until 2026-10-29, when
//    the tick's call was switched off (`0160`): Davies retired its last strategy rows the day before (`0158`) and left
//    the tick to the session ("你来决定"). A call that no longer runs has no freshness to watch.)
//   (pmLp, live-prep's order path, was read here from 2026-10-08 until 2026-10-28, when Davies switched its calls off
//    after the 14-day readout failed: "这个关掉".)
//   (decisions, the newest strategy decision within 75 minutes, was read here from 2026-10-02 until 2026-10-28, when
//    Davies retired the crypto loop's three strategy rows: "把实盘的Trend 4h和测试的Trend 1h Trend 4h删了吧" (`0158`).)
// A reading is stale past three minutes, the dead-man's own line (`deadman.ts`). The Worker alerts only after two
// failing minutes in a row, so one slow minute never pages.
//
// Read-only: one small select with the service key, with its own timeout, which writes nothing.
//
// Beside it, the database's size (review F4, 0101: it grew about 120 MB a day): `size`, from `db_size_bytes()`, shown
// with it and never failing it, so a database grown large does not hold the loop's alert open and hide a stall
// behind it. Its own watch is SQL's: `db-size-watch` (0101) writes a `db.size` row to the errors box once a day while
// it is over `DB_SIZE_WATCH_BYTES`.

const iso = (ms: number) => new Date(ms).toISOString();
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

export const HEALTH_READ_TIMEOUT_MS = 5_000;
/** How old each reading may be, in seconds. */
export const HEALTH_LIMITS_S = { quotes: 180, cbLive: 300 } as const;
export type HealthName = keyof typeof HEALTH_LIMITS_S;
export const HEALTH_NAMES = Object.keys(HEALTH_LIMITS_S) as HealthName[];

/** What one reading found: a time (null: there is none), or why it could not be read. */
export type Reading = { ok: true; at: string | null } | { ok: false; error: string };
export type HealthCheck = { ok: boolean; at: string | null; ageS: number | null; limitS: number; error?: string };
export type HealthReport = { at: string; ok: boolean; checks: Record<HealthName, HealthCheck>; size?: SizeReading };

/** The size the daily watch (0101's `db-size-watch`) writes to the errors box past: 4 GB, half the plan's 8 GB disk. */
export const DB_SIZE_WATCH_BYTES = 4_000_000_000;
/** The database's size, or why it could not be read. */
export type SizeReading = { ok: true; bytes: number; limitBytes: number; over: boolean } | { ok: false; error: string };

/** Each reading against its limit. A time ahead of the clock is fresh. */
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

/** The select, as a PostgREST path, and the column the reading takes its time from. */
export const HEALTH_QUERIES: Record<HealthName, { path: string; column: string }> = {
  quotes: { path: "agent_quote_live_state?id=eq.1&select=updated_at", column: "updated_at" },
  cbLive: { path: "cb_live_state?id=eq.1&select=updated_at", column: "updated_at" },
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

/** The reading, judged, and the size beside it (outside `ok`), read at once. */
export async function runHealth(sbUrl: string, key: string, now: () => number, f: typeof fetch = fetch): Promise<HealthReport> {
  const [entries, size] = await Promise.all([
    Promise.all(HEALTH_NAMES.map(async (n) => [n, await readOne(sbUrl, key, HEALTH_QUERIES[n], f)] as const)),
    readDbSize(sbUrl, key, f),
  ]);
  return { ...judgeHealth(now(), Object.fromEntries(entries) as Record<HealthName, Reading>), size };
}
