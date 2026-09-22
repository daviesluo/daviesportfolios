// Pin tests for the agents function's own helpers in `index.ts`: the
// probe's symbol list, the env reader, the not-ready detector, the chart
// window, the Jev statistics and the cron-bearer half of `authorise`.
// `Deno.serve` sits behind `import.meta.main`, so importing binds nothing.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { authorise, chartWindow, envAny, isNotReady, jevStats, latestObservationQuery, probeSymbols, SYMBOLS, probeSummary, type ProbeSummaryRow } from "./index.ts";

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

Deno.test("latestObservationQuery — one pair, one row, never a window over all of them", () => {
  const q = latestObservationQuery("trend-4h", "AVAX/USD");
  assertEquals(q, "strategy_id=eq.trend-4h&symbol=eq.AVAX%2FUSD&select=strategy_id,symbol,ts,bar_start,state,numbers&order=ts.desc&limit=1");
  // The three properties that matter, stated rather than implied: it filters to the pair, it asks for ONE row,
  // and the slash in a symbol is encoded so PostgREST reads it as a value and not as a path.
  assert(q.includes("symbol=eq."));
  assert(q.endsWith("limit=1"));
  assert(!q.includes("AVAX/USD"));
  // A state that has been steady for hours must still be found: the query carries no time bound at all.
  assert(!q.includes("ts=gte") && !q.includes("limit=400"));
});

// ── the maker probes, read (migration 0042, reference §3.13) ───────────────────────────────
// A fill rate and an adverse-selection median are the only two numbers that answer "is 0 % maker
// free here?". The sign convention is the whole point: POSITIVE means the market moved against
// the fill, which is what makes resting expensive, and it is compared with §3.13's 10–20 bps band.

Deno.test("probeSummary: the adverse number is signed against the fill, and is null until a probe resolves", () => {
  const row = (over: Partial<ProbeSummaryRow> = {}): ProbeSummaryRow => ({
    venue: "revx", symbol: "BTC/USD", side: "buy", state: "filled",
    maker_price: 100, taker_price: 100.1, minutes_to_fill: 10, follow_up: {}, ...over,
  });
  const empty = probeSummary([]);
  assertEquals([empty.total, empty.fillRate, empty.medianMinutesToFill], [0, null, null]);
  assertEquals(empty.adverseBps, { m15: null, m60: null });

  // A resting probe is not yet evidence of anything.
  const resting = probeSummary([row({ state: "resting", minutes_to_fill: null, follow_up: {} })]);
  assertEquals([resting.resting, resting.filled, resting.fillRate], [1, 0, null]);

  // Two resolved, one filled → a 50 % fill rate.
  assertEquals(probeSummary([row(), row({ state: "expired", minutes_to_fill: null })]).fillRate, 0.5);

  // A BUY that filled at 100 and fell to 99 has moved 100 bps AGAINST the fill.
  assertEquals(probeSummary([row({ follow_up: { m15: 99 } })]).adverseBps.m15, 100);
  // A buy that filled and then ROSE is selection in your favour: negative.
  assertEquals(probeSummary([row({ follow_up: { m15: 101 } })]).adverseBps.m15, -100);
  // A SELL is the mirror: filled at 100, market rose to 101 → 100 bps against.
  assertEquals(probeSummary([row({ side: "sell", follow_up: { m15: 101 } })]).adverseBps.m15, 100);

  // The median, and per-symbol counts.
  const many = probeSummary([
    row({ follow_up: { m15: 99 } }), row({ follow_up: { m15: 99.5 } }), row({ symbol: "ETH/USD", follow_up: { m15: 98 } }),
  ]);
  assertEquals(many.adverseBps.m15, 100);                       // 100, 50, 200 → median 100
  assertEquals(many.bySymbol.map((b) => [b.symbol, b.total]), [["BTC/USD", 2], ["ETH/USD", 1]]);
});
