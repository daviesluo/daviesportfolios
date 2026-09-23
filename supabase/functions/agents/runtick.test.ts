// `runTick` against a Kraken outage. Kraken is a signal venue only since `0046`, yet `loadVenues` used to await its
// private fee-tier call with no catch: a network-level failure (production's `agents.crash` rows "Signal timed out.",
// 2026-09-22/23) threw out of `runTick` before `tick()` began — no lease, no reconcile, no floor on any Revolut X
// position — and, the fee cache staying cold, did so again every minute of the outage (go-live audit D1). Its own file
// because it stubs `fetch` and the environment, and puts both back.
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runTick } from "./index.ts";

const ENV = {
  KRAKEN_PRO_API_KEY: "k",
  KRAKEN_PRO_PRIVATE_KEY: btoa("x".repeat(64)),
  SUPABASE_URL: "https://db.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "s",
};

Deno.test("runTick — a Kraken fee-tier timeout no longer stops the tick, and is not retried every minute", async () => {
  const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, Deno.env.get(k)]));
  for (const [k, v] of Object.entries(ENV)) Deno.env.set(k, v);
  const seen: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    seen.push(url);
    if (url.includes("api.kraken.com/0/private/")) return Promise.reject(new DOMException("Signal timed out.", "TimeoutError"));
    if (url.startsWith("https://db.invalid/rest/v1/")) return Promise.reject(new Error("database unreachable in this test"));
    return Promise.reject(new Error(`unexpected call ${url}`));
  }) as typeof fetch;
  try {
    // The tick now begins: the first thing it does is claim its lease, and that is where this stub's database fails.
    await assertRejects(() => runTick(Date.parse("2026-09-23T12:00:00Z")), Error, "database unreachable in this test");
    assertEquals(seen.filter((u) => u.includes("/0/private/TradeVolume")).length, 1);
    // The next minute reads the note left in the cache instead of calling Kraken again.
    await assertRejects(() => runTick(Date.parse("2026-09-23T12:01:00Z")), Error, "database unreachable in this test");
    assertEquals(seen.filter((u) => u.includes("/0/private/TradeVolume")).length, 1);
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(before)) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
  }
});
