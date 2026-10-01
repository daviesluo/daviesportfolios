// A cron call's beat: one row in `edge_call_beats` (migration 0075) for each call of the one-minute job that reached its
// function, written before anything else the call does.
//
// Why. In the 24 hours to 2026-10-01 15:00 UTC, 19 of the job's ~19,700 calls answered 503 `BOOT_ERROR` ("Function
// failed to start"), all on `agents` in eu-west-2, each 10.1–10.9 s after the request, with no execution id and no
// line in the function's logs: the platform did not start a worker for them at the top of the minute, when 13–17 calls
// boot together. Nothing of the function ran, so nothing of it could say so. A beat is the one thing every call that
// DID start writes first, so a call with no beat 13 s into its minute is a call whose worker never started, and the
// watchdog (`edge-watchdog`) runs it again, once.
//
// A beat is keyed by its minute and by the call's beat key. The minute is the database's (the column's default): the
// clock pg_cron fires the job by, so a beat written after its call was queued can only fall in that call's minute,
// whatever the function's own clock says. The key is the function's name, and `?action=<action>` when the request names
// one. Nothing else of the path the job sends is in it
// (`forceFunctionRegion=eu-west-1` on the order path's call is the platform's routing, not the function's), and the
// action is read with the same parser the router reads it with, so the key a function writes and the key the watchdog
// looks for come from one function each way (`beatKeyOfRequest`, `beatKeyOfPath`) and cannot drift apart.
//
// Writing one is a single small insert, 2 s at most, and it never throws: a beat that cannot be written costs at most
// one more run of a call that is safe to run twice in a minute (0075 lists which are, and why).

/** The table the beats go to (0075). */
export const BEAT_TABLE = "edge_call_beats";
/** A beat waits at most this long for the database before the call's own work begins without it. */
export const BEAT_TIMEOUT_MS = 2_000;
const MINUTE_MS = 60_000;

/** The start of the UTC minute an instant falls in. */
export const minuteOf = (ms: number): number => Math.floor(ms / MINUTE_MS) * MINUTE_MS;

/** A call's beat key: its function's name, and `?action=` with its action when it has one. */
export function beatKey(fn: string, action?: string | null): string {
  return action ? `${fn}?action=${action}` : fn;
}

/** The key a request to function `fn` writes: its action read from its own URL, as the router reads it. */
export function beatKeyOfRequest(fn: string, url: string): string {
  return beatKey(fn, new URL(url).searchParams.get("action"));
}

/** The key the call a list row names writes: the function before the `?`, and the `action` parameter after it. */
export function beatKeyOfPath(path: string): string {
  const q = path.indexOf("?");
  return q < 0 ? beatKey(path) : beatKey(path.slice(0, q), new URLSearchParams(path.slice(q + 1)).get("action"));
}

/**
 * Write the beat for the current minute; true when the database took it. The row is the key alone: the database stamps
 * the minute. A beat already there (a call the watchdog ran again, whose first run did write one after all) is left as
 * it is. Never throws.
 */
export async function writeBeat(key: string, o: {
  sbUrl?: string; serviceKey?: string; fetchImpl?: typeof fetch; timeoutMs?: number;
} = {}): Promise<boolean> {
  try {
    const sbUrl = o.sbUrl ?? Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = o.serviceKey ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!sbUrl || !serviceKey) return false;
    const res = await (o.fetchImpl ?? fetch)(`${sbUrl}/rest/v1/${BEAT_TABLE}?on_conflict=minute,path`, {
      method: "POST",
      headers: {
        apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify({ path: key }),
      signal: AbortSignal.timeout(o.timeoutMs ?? BEAT_TIMEOUT_MS),
    });
    await res.text();
    return res.ok;
  } catch {
    return false;
  }
}
