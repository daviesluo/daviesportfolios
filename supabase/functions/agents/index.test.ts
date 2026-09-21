// Pin tests for the agents function's own helpers in `index.ts`: the
// probe's symbol list, the env reader, the not-ready detector, the chart
// window, the Jev statistics and the cron-bearer half of `authorise`.
// `Deno.serve` sits behind `import.meta.main`, so importing binds nothing.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { authorise, chartWindow, envAny, isNotReady, jevStats, probeSymbols, SYMBOLS } from "./index.ts";

Deno.test("probeSymbols — every symbol on an active row, sorted and de-duplicated; the three majors when no row can be read", () => {
  assertEquals(probeSymbols([{ symbols: ["BTC/USD", "SOL/USD"] }, { symbols: ["ETH/USD", "BTC/USD", "SUI/USD"] }]), ["BTC/USD", "ETH/USD", "SOL/USD", "SUI/USD"]);
  assertEquals(probeSymbols([]), [...SYMBOLS]);
  assertEquals(probeSymbols([{ symbols: "BTC/USD" }, { symbols: [42, "x"] }]), [...SYMBOLS]);   // malformed rows carry no symbols
});

Deno.test("envAny — the first non-empty spelling wins, trimmed; none → empty string", () => {
  const read = (n: string) => ({ A: "  ", B: " kb " } as Record<string, string>)[n];
  assertEquals(envAny(["A", "B"], read), "kb");
  assertEquals(envAny(["Z"], read), "");
});

Deno.test("isNotReady — PostgREST's missing-table replies, and nothing else", () => {
  assert(isNotReady(new Error('db GET agent_strategies → 404: {"code":"PGRST205","message":"Could not find the table"}')));
  assert(isNotReady(new Error('relation "public.agent_orders" does not exist')));
  assert(!isNotReady(new Error("db GET agent_orders → 500: timeout")));
});

Deno.test("chartWindow — the detail page's candle size and span per rulebook", () => {
  const h = 3600e3, d = 86400e3;
  assertEquals(chartWindow("trend-1h"), { intervalMin: 60, spanMs: 7 * d });
  assertEquals(chartWindow("trend-4h"), { intervalMin: 240, spanMs: 30 * d });
  assertEquals(chartWindow("momentum-1d"), { intervalMin: 240, spanMs: 30 * d });
  assertEquals(chartWindow("dislocation-1m"), { intervalMin: 1, spanMs: 12 * h });
});

Deno.test("jevStats — calls, cost, mean latency over the answered ones, and a count per provider", () => {
  assertEquals(jevStats([]), { calls: 0, costUsd: 0, avgLatencyMs: null, providers: {} });
  assertEquals(
    jevStats([{ provider: "openrouter", cost_usd: 0.00002, latency_ms: 400 }, { provider: "openrouter", cost_usd: 0.00002, latency_ms: 600 }, { provider: "none", cost_usd: null, latency_ms: null }]),
    { calls: 3, costUsd: 0.00004, avgLatencyMs: 500, providers: { openrouter: 2, none: 1 } },
  );
});

Deno.test("authorise — the cron bearer is accepted in constant time and only when it matches; no token at all is nobody", async () => {
  assertEquals(await authorise(new Request("http://x/", { headers: { authorization: "Bearer s3cret" } }), "s3cret"), "cron");
  assertEquals(await authorise(new Request("http://x/", { headers: { authorization: "Bearer wrong" } }), "s3cret"), null);
  assertEquals(await authorise(new Request("http://x/"), "s3cret"), null);
  assertEquals(await authorise(new Request("http://x/", { headers: { authorization: "Bearer " } }), ""), null);   // an empty secret matches nothing
});
