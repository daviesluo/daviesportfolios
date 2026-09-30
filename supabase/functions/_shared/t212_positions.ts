// Trading 212's `/equity/positions`, as the two price recorders read it (`snapshot-record`, `overnight-record`).
//
// T212 allows one call a second per account (`trading212/index.ts` says so where it built a claim around it), and
// since `0063` the two recorders are queued by the same cron statement, so every five minutes they asked for the same
// two accounts within the same second and T212 refused one call of each pair. On the nights of 2026-09-29 and -30 the
// overnight recorder kept 68 % and 74 % of the session's 96 five-minute buckets and the snapshot recorder 31 % and
// 56 %; they shared only 15 and 29 of them, and on the second night every bucket had one or the other: one winner a
// window. The snapshot recorder writes nothing overnight without T212 (Yahoo's overnight quote is a frozen carry), so
// a refused call was a missing sample.
//
// A call the limit refused (429) is tried once more, a little over a second later. Any other failure is not retried:
// a key T212 refuses stays refused, and the next tick is five minutes away.

export const T212_POSITIONS_URL = "https://live.trading212.com/api/v0/equity/positions";

/** How long a refused call waits before its one retry: past the one-second window the refusal was for. */
export const T212_RETRY_MS = 1_100;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The positions of one account, or null when T212 did not give them. HTTP Basic when a secret is set (two-key
 * accounts), else the raw key, as the `trading212` function sends it.
 */
export async function fetchT212Positions(
  apiKey: string,
  apiSecret: string,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = wait,
): Promise<unknown> {
  if (!apiKey) return null;
  const authHeader = apiSecret ? `Basic ${btoa(`${apiKey}:${apiSecret}`)}` : apiKey;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetchImpl(T212_POSITIONS_URL, {
        headers: { Authorization: authHeader, Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) return await res.json();
      await res.body?.cancel();
      if (res.status !== 429 || attempt >= 2) return null;
    } catch {
      return null;
    }
    await sleep(T212_RETRY_MS);
  }
}
