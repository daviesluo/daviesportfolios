// Pins for the recorders' Trading 212 positions read: a call the one-a-second limit refused is tried once more,
// after the window; nothing else is retried.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fetchT212Positions, T212_POSITIONS_URL, T212_RETRY_MS } from "./t212_positions.ts";

/** A T212 that answers each call from `statuses` in turn, and records what it was asked and how long was slept. */
function t212(statuses: number[]) {
  const calls: { url: string; auth: string | null }[] = [];
  const slept: number[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) => {
    calls.push({ url, auth: new Headers(init?.headers).get("Authorization") });
    const status = statuses[calls.length - 1] ?? 500;
    if (status < 0) return Promise.reject(new TypeError("network"));
    return Promise.resolve(
      status === 200
        ? new Response(JSON.stringify([{ ticker: "AAPL_US_EQ", currentPrice: 231.5 }]), { status })
        : new Response("{}", { status }),
    );
  }) as typeof fetch;
  const sleep = (ms: number) => { slept.push(ms); return Promise.resolve(); };
  return { calls, slept, fetchImpl, sleep };
}

Deno.test("fetchT212Positions: a call the rate limit refused is tried again after the window", async () => {
  const t = t212([429, 200]);
  const got = await fetchT212Positions("key", "", t.fetchImpl, t.sleep);
  assertEquals(got, [{ ticker: "AAPL_US_EQ", currentPrice: 231.5 }]);
  assertEquals(t.calls.length, 2);
  assertEquals(t.slept, [T212_RETRY_MS]);
  assertEquals(T212_RETRY_MS > 1_000, true);
});

Deno.test("fetchT212Positions: refused twice is null, after one retry only", async () => {
  const t = t212([429, 429, 200]);
  assertEquals(await fetchT212Positions("key", "", t.fetchImpl, t.sleep), null);
  assertEquals(t.calls.length, 2);
});

Deno.test("fetchT212Positions: any other failure is not retried", async () => {
  for (const status of [401, 403, 500, -1]) {
    const t = t212([status, 200]);
    assertEquals(await fetchT212Positions("key", "", t.fetchImpl, t.sleep), null, `status ${status}`);
    assertEquals(t.calls.length, 1, `status ${status}`);
    assertEquals(t.slept, [], `status ${status}`);
  }
});

Deno.test("fetchT212Positions: no key, no call; Basic auth with a secret, the raw key without", async () => {
  const none = t212([200]);
  assertEquals(await fetchT212Positions("", "", none.fetchImpl, none.sleep), null);
  assertEquals(none.calls.length, 0);
  const raw = t212([200]);
  await fetchT212Positions("key", "", raw.fetchImpl, raw.sleep);
  assertEquals(raw.calls, [{ url: T212_POSITIONS_URL, auth: "key" }]);
  const basic = t212([200]);
  await fetchT212Positions("key", "secret", basic.fetchImpl, basic.sleep);
  assertEquals(basic.calls[0].auth, `Basic ${btoa("key:secret")}`);
});
