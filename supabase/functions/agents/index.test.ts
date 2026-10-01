// Pin tests for the agents function's own helpers in `index.ts`: the
// probe's symbol list, the env reader, the not-ready detector, the chart
// window, the Jev statistics and the cron-bearer half of `authorise`.
// `Deno.serve` sits behind `import.meta.main`, so importing binds nothing.
import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  authorise, chartBook, PAGE_VENUES, chartWindow, dayOpensFrom, envAny, FULL_HISTORY_LIMIT, isNotReady, jevStats, JEV_BATCH_MAX_CALLS, latestObservationQuery, mapPool, ordersBeyondChart, parseState, probeParts, probeSymbols, runJevBatch,
  STATE_VOCAB, strategyBooks, SYMBOLS, probeSummary, quotesDelayMs, quotesSummary, quoteDays, QUOTES_CAPITAL_USD, QUOTES_RECENT_TRIPS, tickErrorReport, crashReport, type ProbeSummaryRow,
  REVX_KEY_NAMES, REVX2_PROBE_SYMBOLS, runProbe, PROBE_PARTS, newestDecisions, quotesLiveSummary, type QuoteLiveOrderView, quotesVariantSummary, quotesRuledSummary,
  serveRequest, type ServeDeps, type Who,
  liveBookGbp, liveCoinBooks, liveConversionShares, liveIndexPrices, liveOrderReason, liveRestingBuysGbp, liveRungs, liveRungTrips, quotesLiveDetail, QUOTE_LIVE_ORDER_COLUMNS,
  QUOTE_TICKER_FRESH_MS,
  QUOTE_LIVE_REASON_COLUMNS, QUOTE_LIVE_SUMMARY_COLUMNS, QUOTES_LIVE_ORDERS_FILTER, QUOTES_LIVE_PAGE_ROWS, type QuoteLiveRecentRow, withConversionFees,
} from "./index.ts";
import type { OrderRow } from "./tick.ts";
import type { RungFill } from "./quotes_live.ts";
// The live quotes page's fixture: a book worked out by hand, its rows and what the dashboard serves for them. The browser
// test serves `live` to the page; the test below proves it is this function's own answer for those rows.
import liveFixture from "../../../src/e2e/quotes_live_fixture.json" with { type: "json" };
import type { JevResult } from "../_shared/jev.ts";
import { POLYMARKET_ENV_NAMES, POLYMARKET_READS, polyHmacSignature } from "../_shared/polymarket.ts";
import { jevQuestions } from "../_shared/agents_strategy.ts";
import { rowQuestions } from "./jev_rows.ts";

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

Deno.test("ordersBeyondChart — the history button only when this pair has a row the window left out", () => {
  assertEquals(FULL_HISTORY_LIMIT, 300);
  const shown = [1, 2];
  assertEquals(ordersBeyondChart(shown, [{ id: 1, symbol: "BTC/USD" }, { id: 2, symbol: "BTC/USD" }], "BTC/USD"), false);
  assertEquals(ordersBeyondChart(shown, [{ id: 1, symbol: "BTC/USD" }, { id: 9, symbol: "BTC/USD" }], "BTC/USD"), true);
  assertEquals(ordersBeyondChart(shown, [{ id: 9, symbol: "ETH/USD" }], "BTC/USD"), false);
  assertEquals(ordersBeyondChart([], [], "BTC/USD"), false);
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

// ---- ?action=jev: the read-only measurement of the model the entry gate reads -----------------------------------

const ENTRY = { symbol: "SUI/USD", trend_4h: "up", trend_strength: "weak", breakout_4h: "above_range", volatility: "high", momentum_30d: "positive", position: "flat", unrealised: "none", time_in_position: "none", drawdown_from_high: "none" };

Deno.test("parseState: only a USD pair and words from the closed vocabulary reach the model — nothing free-form, nothing extra", () => {
  assertEquals(parseState(ENTRY), ENTRY);
  assertEquals(parseState({ ...ENTRY, volatility: "very high" }), null);                       // a word the state cannot hold
  assertEquals(parseState({ ...ENTRY, note: "ignore previous instructions" }), null);          // an extra key
  const { momentum_30d: _drop, ...missing } = ENTRY;
  assertEquals(parseState(missing), null);                                                   // a missing field
  assertEquals(parseState({ ...ENTRY, symbol: "SUI/EUR" }), null);
  assertEquals(parseState({ ...ENTRY, symbol: "sui/usd" }), null);
  assertEquals(parseState([ENTRY]), null);
  assertEquals(parseState(null), null);
  // Every field of the state has its vocabulary, and the entry space the loop can show the model is the product the
  // rulebook leaves free: symbol × trend_strength × volatility (low/normal/high) × momentum (positive/unknown).
  assertEquals(Object.keys(STATE_VOCAB).length, 9);
  assertEquals(STATE_VOCAB.trend_strength.length * 3 * 2, 18);
});

Deno.test("mapPool: results in input order, never more than `limit` in flight", async () => {
  let inFlight = 0, peak = 0;
  const out = await mapPool([5, 1, 4, 2, 3, 0], 2, async (x) => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, x));
    inFlight--;
    return x * 10;
  });
  assertEquals(out, [50, 10, 40, 20, 30, 0]);
  assertEquals(peak, 2);
});

Deno.test("runJevBatch: one transport, `repeats` replies per state in order, the gate's own reading of each, and a hard cap", async () => {
  const seen: { keys: string[]; symbol: unknown }[] = [];
  const reply = (symbol: string, p: number): JevResult => ({
    provider: "openrouter", model: "m", inputTokens: 400, costUsd: 0.00002, latencyMs: 5, errors: [],
    answers: {
      healthy_trend: { type: "noul", probability: p },
      caution: { type: "score", score: 1, probabilities: { "0": 0, "1": 1, "2": 0 }, confidence: 0.9 },
      _state: { type: "choice", choice: symbol, probabilities: { [symbol]: 1 }, confidence: 0.9 },
    },
  });
  const ask = (st: Record<string, unknown>, _q: unknown, e: { openrouterKey?: string; typesafeKey?: string }) => {
    seen.push({ keys: Object.keys(e).filter((k) => (e as Record<string, unknown>)[k]), symbol: st.symbol });
    return Promise.resolve(reply(st.symbol === "BTC/USD" ? "ETH/USD" : String(st.symbol), 0.59));   // BTC's reply names the wrong symbol
  };
  const env = { openrouterKey: "or", typesafeKey: "ts" };
  const out = await runJevBatch({ states: [ENTRY, { ...ENTRY, symbol: "BTC/USD" }], repeats: 3 }, env, ask) as {
    transport: string; calls: number; costUsd: number; results: { state: { symbol: string }; replies: { healthy: number; echoOk: boolean }[] }[];
  };
  assertEquals([out.transport, out.calls, out.results.length], ["openrouter", 6, 2]);
  assertEquals(out.results.map((r) => [r.state.symbol, r.replies.length]), [["SUI/USD", 3], ["BTC/USD", 3]]);
  assertEquals(out.results[0].replies[0].healthy, 0.59);
  assertEquals(out.results[0].replies.every((r) => r.echoOk), true);
  assertEquals(out.results[1].replies.every((r) => !r.echoOk), true);                          // read exactly as the gate reads it
  assert(seen.every((c) => c.keys.length === 1 && c.keys[0] === "openrouterKey"));             // never both transports
  assertAlmostEquals(out.costUsd, 6 * 0.00002, 1e-12);

  const ts = await runJevBatch({ states: [ENTRY], transport: "typesafe" }, env, ask) as { transport: string };
  assertEquals(ts.transport, "typesafe");
  assertEquals(seen.at(-1)!.keys, ["typesafeKey"]);

  // Refusals: nothing reaches the model.
  const before = seen.length;
  assert(String((await runJevBatch({ states: [] }, env, ask)).error).includes("non-empty"));
  assert(String((await runJevBatch({ states: [ENTRY, { ...ENTRY, volatility: "wild" }] }, env, ask)).error).includes("states[1]"));
  const tooMany = Array.from({ length: JEV_BATCH_MAX_CALLS }, () => ENTRY);
  assert(String((await runJevBatch({ states: tooMany, repeats: 2 }, env, ask)).error).includes("split the batch"));
  assert(String((await runJevBatch({ states: [ENTRY] }, {}, ask)).error).includes("no openrouter key"));
  assertEquals(seen.length, before);
});

Deno.test("runJevBatch asks a row's own wording (jev_rows.ts) for that row's rule only, and says which it asked", async () => {
  const asked: { instructions: string; kind: string }[] = [];
  const ask = (st: Record<string, unknown>, q: unknown) => {
    asked.push({ instructions: (q as { healthy_trend: { instructions: string } }).healthy_trend.instructions, kind: "" });
    const sym = String(st.symbol);
    return Promise.resolve({
      provider: "openrouter", model: "m", inputTokens: 400, costUsd: 0.00002, latencyMs: 5, errors: [],
      answers: { healthy_trend: { type: "noul", probability: 0.5 }, caution: { type: "score", score: 0 }, _state: { type: "choice", choice: sym } },
    } as unknown as JevResult);
  };
  const env = { openrouterKey: "or" };
  const st = { ...ENTRY, symbol: "BTC/USD", trend_4h: "down", breakout_4h: "inside_range", volatility: "normal" };
  // The kind defaults to the one the wording is written for.
  const out = await runJevBatch({ states: [st], version: "v3-momentum-1d" }, env, ask) as { version: string; kind: string };
  assertEquals([out.version, out.kind], ["v3-momentum-1d", "momentum-1d"]);
  assertEquals(asked[0].instructions, rowQuestions(parseState(st)!, "v3-momentum-1d").healthy_trend.instructions);
  // Put to another rule it is refused before the model is called; v2 still asks exactly what it asked.
  const before = asked.length;
  assert(String((await runJevBatch({ states: [st], version: "v3-momentum-1d", kind: "trend-1h" }, env, ask)).error).includes("written for momentum-1d"));
  assert(String((await runJevBatch({ states: [st], version: "v4" }, env, ask)).error).includes("v3-trend-1h"));
  assertEquals(asked.length, before);
  await runJevBatch({ states: [st], version: "v2", kind: "momentum-1d" }, env, ask);
  assertEquals(asked.at(-1)!.instructions, jevQuestions(parseState(st)!, { kind: "momentum-1d", version: "v2" }).healthy_trend.instructions);
});

// ── the page's books, resolved by the tick's own rule (2026-09-22) ──────────────────────────────────
// Until 2026-09-22 none of this had a test: the page's book resolution was written a second time and the browser
// sweep reads a hand-made payload, so neither could see the page disagree with the loop.
const DAY = Date.parse("2026-09-23T00:00:00Z");
const fill = (id: number, mode: "paper" | "live", side: "buy" | "sell", base: number, price: number, at: number, symbol = "BTC/USD"): OrderRow => ({
  id, ts: new Date(at).toISOString(), strategy_id: "row", decision_id: id, venue: "revx", symbol, mode, side, price, base_size: base,
  client_order_id: `c${id}`, venue_order_id: null, state: "filled", filled_base: base, avg_fill_price: price, fee_usd: 0, requotes: 0, filled_at: new Date(at).toISOString(),
});
const row = (mode: string, retired_at: string | null = null) => ({ id: "row", mode, symbols: ["BTC/USD"], retired_at });

Deno.test("strategyBooks: real money made in a book the row no longer trades stays in the totals, under LIVE — never dropped by a relabel", () => {
  // Bought 0.04 for real at 400, sold at 450: +$2.00 realised, live. Then the row is relabelled.
  const fills = [fill(1, "live", "buy", 0.04, 400, DAY - 2 * 86400e3), fill(2, "live", "sell", 0.04, 450, DAY - 86400e3)];
  for (const mode of ["live", "paper", "paused"]) {
    const b = strategyBooks(row(mode), fills, { "BTC/USD": 393 }, {}, DAY);
    assertAlmostEquals(b.byMode.live.realisedUsd, 2, 1e-9, mode);
    assertAlmostEquals(b.agg.realisedUsd, 2, 1e-9, mode);
    assertEquals(b.byMode.paper.realisedUsd, 0, mode);
  }
  // Relabelled: the page draws the paper book the loop now trades, and lists the live one beside it rather than losing it.
  const p = strategyBooks(row("paper"), fills, { "BTC/USD": 393 }, {}, DAY);
  assertEquals([p.positions[0].book, p.otherBooks.map((o) => o.book)], ["paper", ["live"]]);
});

Deno.test("strategyBooks: windingDown is the tick's rule — a paused row holding, or a row relabelled away from REAL coins — not 'retired' alone", () => {
  const paper = [fill(1, "paper", "buy", 0.04, 400, DAY - 86400e3)];
  const live = [fill(1, "live", "buy", 0.04, 400, DAY - 86400e3)];
  assertEquals(strategyBooks(row("paused"), paper, {}, {}, DAY).windingDown, true);               // paused, not retired: the tick is covering it
  const demoted = strategyBooks(row("paper"), live, { "BTC/USD": 393 }, {}, DAY);
  assertEquals([demoted.windingDown, demoted.holdsLive, demoted.positions[0].book], [true, true, "live"]);
  assertAlmostEquals(demoted.byMode.live.valueUsd, 0.04 * 393, 1e-9);                            // billed to live whatever the label
  assertEquals(strategyBooks(row("live"), live, {}, {}, DAY).windingDown, false);                // a live row holding live coins is just trading
  assertEquals(strategyBooks(row("paused", "2026-09-22T00:00:00Z"), [], {}, {}, DAY).windingDown, false);   // retired and flat: nothing to wind down
  assertEquals(strategyBooks(row("paused", "2026-09-22T00:00:00Z"), paper, {}, {}, DAY).windingDown, true); // retired holding the book it resolves to
  // Retired under a LIVE label with only a stranded PAPER position: the tick resolves the row to its (flat) live book and
  // skips it, so the page must not claim its exits run — but it keeps the row on the page, position and all.
  const stranded = strategyBooks(row("live", "2026-09-22T00:00:00Z"), paper, {}, {}, DAY);
  assertEquals([stranded.windingDown, stranded.holdsAnything, stranded.otherBooks.map((o) => [o.book, o.base])], [false, true, [["paper", 0.04]]]);
});

Deno.test("strategyBooks: every book counts once — a paper position stranded under a live row is in the totals, not drawn twice or dropped", () => {
  const fills = [fill(1, "paper", "buy", 0.05, 300, DAY - 3 * 86400e3), fill(2, "live", "buy", 0.04, 400, DAY - 86400e3)];
  const b = strategyBooks(row("live"), fills, { "BTC/USD": 393 }, {}, DAY);
  assertEquals([b.positions.length, b.positions[0].book, b.positions[0].base], [1, "live", 0.04]);
  assertEquals(b.otherBooks.map((o) => [o.book, o.base]), [["paper", 0.05]]);
  assertAlmostEquals(b.agg.valueUsd, 0.09 * 393, 1e-9);
  assertAlmostEquals(b.byMode.paper.valueUsd + b.byMode.live.valueUsd, b.agg.valueUsd, 1e-9);
  // Today, per book, is the tick's own dayPnl over that book's fills: held since before today, marked from the day's open.
  const t = strategyBooks(row("live"), fills, { "BTC/USD": 393 }, { "BTC/USD": 380 }, DAY);
  assertAlmostEquals(t.todayByBook.live, 0.04 * (393 - 380), 1e-9);
  assertAlmostEquals(t.todayByBook.paper, 0.05 * (393 - 380), 1e-9);
  assertAlmostEquals(t.agg.todayUsd, 0.09 * (393 - 380), 1e-9);
});

Deno.test("chartBook: the detail chart's position is the book the loop manages — never a blend of the paper and live books", () => {
  const fills = [fill(1, "paper", "buy", 0.05, 300, DAY - 3 * 86400e3), fill(2, "live", "buy", 0.04, 400, DAY - 86400e3)];
  const c = chartBook("live", fills);
  assertEquals([c.book, c.position.base, c.position.avgCost], ["live", 0.04, 400]);             // not 0.09 @ 344.44
  assertEquals(chartBook("paper", fills.slice(0, 1)).position.base, 0.05);
});

Deno.test("dayOpensFrom: the page's day open is the tick's — today's candle, else yesterday's CLOSE (the page used to fall back to the mark)", () => {
  const y = { venue: "kraken", symbol: "BTC/USD", open: "370", close: "380", start: new Date(DAY - 86400e3).toISOString() };
  assertEquals(dayOpensFrom([y], DAY), { kraken: { "BTC/USD": 380 } });
  assertEquals(dayOpensFrom([y, { ...y, open: "381", close: "390", start: new Date(DAY).toISOString() }], DAY), { kraken: { "BTC/USD": 381 } });
});

Deno.test("a turn's errors all reach ops_errors: the message is cut to the column, the whole list rides in the context", () => {
  // Four long errors ahead of the one that names the refusing constraint: joined and cut at 500, the last was lost.
  const noise = Array.from({ length: 4 }, (_, i) => `trend-4h|SUI/USD: live buy c-${i} cannot be settled; the floor counts 0.1 as held until it is ${"(detail) ".repeat(12)}`);
  const last = 'trend-4h|BTC/USD: settle db PATCH agent_orders → 400: {"code":"23514","message":"new row for relation \\"agent_orders\\" violates check constraint \\"agent_orders_mode_check\\""}';
  const r = tickErrorReport({ errors: [...noise, last], at: "2026-09-22T23:59:00.000Z" });
  assert(r.message.length <= 500);
  assert(!r.message.includes("agent_orders_mode_check"));                 // the cut still happens in `message` …
  assertEquals(r.context.count, 5);
  assertEquals(r.context.errors.length, 5);
  assert(r.context.errors[4].includes("agent_orders_mode_check"));        // … and the list keeps every error whole
  assertEquals(r.context.at, "2026-09-22T23:59:00.000Z");
  // A runaway turn is still bounded: forty errors of at most 800 characters each.
  const flood = tickErrorReport({ errors: Array.from({ length: 100 }, () => "x".repeat(2000)), at: "t" });
  assertEquals([flood.context.errors.length, flood.context.errors[0].length, flood.context.count], [40, 800, 100]);
});

Deno.test("runJevBatch asks the wording and the rule it is told to — so a wording can be measured before the loop uses it", async () => {
  const asked: string[] = [];
  const ask = (_st: Record<string, unknown>, q: unknown) => {
    asked.push((q as { healthy_trend: { instructions: string } }).healthy_trend.instructions);
    return Promise.resolve({ provider: "openrouter", model: "m", inputTokens: 1, costUsd: 0, latencyMs: 1, errors: [], answers: {} } as JevResult);
  };
  const env = { openrouterKey: "or" };
  const v2 = await runJevBatch({ states: [ENTRY], version: "v2", kind: "trend-1h" }, env, ask) as { version: string; kind: string };
  assertEquals([v2.version, v2.kind], ["v2", "trend-1h"]);
  assert(asked[0].includes("1-hour candles") && !asked[0].includes("trend_strength is moderate or strong"), asked[0]);
  const v1 = await runJevBatch({ states: [ENTRY], version: "v1" }, env, ask) as { version: string; kind: string };
  assertEquals([v1.version, v1.kind], ["v1", "trend-4h"]);
  assert(asked[1].includes("trend_strength is moderate or strong"), asked[1]);
  assert(String((await runJevBatch({ states: [ENTRY], version: "v9" }, env, ask)).error).includes("version"));
  assert(String((await runJevBatch({ states: [ENTRY], kind: "dislocation-1m" }, env, ask)).error).includes("kind"));
  assertEquals(asked.length, 2);                                                               // refusals reach no model
});

Deno.test("probeParts: `?only=` picks the probe's parts by name, ignores unknown ones, and no list means every part", () => {
  assertEquals(probeParts(null), null);
  assertEquals(probeParts(""), null);
  assertEquals([...probeParts("binance,deribit")!], ["binance", "deribit"]);
  assertEquals([...probeParts(" Kraken , nonsense ")!], ["kraken"]);
  assertEquals(probeParts("nonsense"), null);   // nothing recognised is not "nothing to run": it is the whole probe
  assertEquals([...probeParts("revx2")!], ["revx2"]);
});

Deno.test("REVX_KEY_NAMES — the second account reads the secrets Davies created, and the first keeps its own", () => {
  assertEquals([...REVX_KEY_NAMES.revx2.apiKey], ["REVOLUT_X_API_KEY_2", "Revolut_X_API_kEY_2"]);
  assertEquals([...REVX_KEY_NAMES.revx2.priv], ["REVOLUT_X_PRIVATE_KEY_2", "Revolut_X_Private_Key_2"]);
  assert(REVX_KEY_NAMES.revx.apiKey.includes("Revolut_X_API_kEY"));
  assert(!REVX_KEY_NAMES.revx.apiKey.some((n) => n.endsWith("_2")));
});

Deno.test("runProbe(revx2) — reads the second account with GETs only, on PR5's books, and places nothing", async () => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const b64 = btoa(String.fromCharCode(...pkcs8));
  const names = ["REVOLUT_X_API_KEY_2", "Revolut_X_API_kEY_2", "REVOLUT_X_PRIVATE_KEY_2", "Revolut_X_Private_Key_2"];
  const saved = new Map(names.map((n) => [n, Deno.env.get(n)]));
  for (const n of names) Deno.env.delete(n);
  Deno.env.set("Revolut_X_API_kEY_2", "k".repeat(64));
  Deno.env.set("REVOLUT_X_PRIVATE_KEY_2", b64);
  const seen: Array<{ method: string; url: string }> = [];
  const stub = ((input: Request | URL | string, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    seen.push({ method: (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase(), url });
    const body = url.includes("/configuration/pairs") ? { "USDC/GBP": { base_step: "0.01" } }
      : url.includes("/balances") ? [{ currency: "GBP", available: "50" }]
      : { data: [] };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
  }) as typeof fetch;
  try {
    const out = await runProbe(new Set(["revx2"]), stub);
    assertEquals(out.revx, undefined);
    const r = out.revx2 as Record<string, any>;
    assert(r && !("error" in r), JSON.stringify(r));
    assertEquals(r.keyForm, "pkcs8-b64");
    assertEquals(r.balances.status, 200);
    assertEquals(Object.keys(r.pairs.config), [...REVX2_PROBE_SYMBOLS]);
    // The history a lost reply is reconciled from, on PR5's own book: its field names are what the live executor reads.
    assertEquals([r.historicalOrders.status, r.historicalOrders.symbol], [200, "USDC/GBP"]);
    assert(seen.some((c) => c.url.includes("/api/1.0/orders/historical?symbols=USDC-GBP&")), JSON.stringify(seen));
    assert(seen.length >= 5, `${seen.length} calls`);
    assert(seen.every((c) => c.method === "GET"), JSON.stringify(seen));
  } finally {
    for (const [n, v] of saved) v === undefined ? Deno.env.delete(n) : Deno.env.set(n, v);
  }
});

// ── the Polymarket part (`only=polymarket`, reference §2d) ─────────────────────────────────────────────────────────────

/** The official clients' published test key and its address (clob-client-v2 tests/signing/signer.test.ts), never the account's. */
const PM_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const PM_SIGNER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const PM_FUNDER = "0x00000000000000000000000000000000000000f1";
const PM_API_KEY = "0f0e0d0c-1111-4222-8333-444455556666";
const PM_SECRET = btoa("PLANTED-L2-SECRET-32-BYTES-LONG!").replace(/\+/g, "-").replace(/\//g, "_");
const PM_PASSPHRASE = "b7e1d3f9a2c4-0c1d2e3f-6a5b";   // no English in it: the report's own words must not look like a leak
/** Every planted secret, in each spelling a leak could take. The report may contain none of them. */
const PM_SECRETS = [PM_KEY, PM_KEY.slice(2), PM_KEY.slice(2).toUpperCase(), PM_SECRET, PM_SECRET.replace(/-/g, "+").replace(/_/g, "/"), PM_PASSPHRASE, PM_API_KEY];
const MAX_ALLOWANCE = (2n ** 256n - 1n).toString();

type PmCall = { method: string; url: URL; headers: Headers; redirect?: string; body: unknown };

/** Does any `window`-character stretch of a secret appear in `text`? A cut secret leaks its prefix, not its whole. */
function leaksPart(text: string, secrets: string[], window = 10): string | null {
  for (const s of secrets) for (let i = 0; i + window <= s.length; i++) if (text.includes(s.slice(i, i + window))) return s.slice(i, i + window);
  return null;
}

/**
 * A fake of every host the Polymarket part reads, as strict as the CLOB about L2: a private read without the planted
 * key, passphrase and signer, a fresh timestamp and the right signature over timestamp + GET + path is a 401. `hostile`
 * makes it as bad as a server can be: every reply a 401 whose body echoes the planted secrets and the request's
 * headers, the passphrase placed so that a 200-character cut falls inside it. The report's scrub is what is on trial,
 * and it has to run before the cut.
 */
function polymarketHosts(hostile = false) {
  const calls: PmCall[] = [];
  const L2 = ["/auth/api-keys", "/auth/ban-status/closed-only", "/balance-allowance", "/data/orders"];
  const fetchImpl = (async (input: Request | URL | string, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    calls.push({ method: (init?.method ?? "GET").toUpperCase(), url, headers, redirect: init?.redirect, body: init?.body });
    if (hostile) {
      const echo = [...headers].map(([k, v]) => `${k}=${v}`).join(" ");
      const error = `${"x".repeat(190)}${PM_PASSPHRASE} ${PM_KEY} ${PM_SECRET} ${PM_API_KEY} ${echo}`;
      return new Response(JSON.stringify({ error }), { status: 401 });
    }
    if (url.hostname === "clob.polymarket.com" && L2.includes(url.pathname)) {
      const ts = headers.get("POLY_TIMESTAMP") ?? "";
      const good = headers.get("POLY_API_KEY") === PM_API_KEY && headers.get("POLY_PASSPHRASE") === PM_PASSPHRASE && headers.get("POLY_ADDRESS") === PM_SIGNER &&
        Math.abs(Number(ts) - Date.now() / 1000) < 30 && headers.get("POLY_SIGNATURE") === await polyHmacSignature(PM_SECRET, ts, "GET", url.pathname);
      if (!good) return new Response(JSON.stringify({ error: "Unauthorized/Invalid api key" }), { status: 401 });
    }
    const p = `${url.hostname}${url.pathname}`;
    const body = p === "clob.polymarket.com/time" ? Math.floor(Date.now() / 1000)
      : p === "polymarket.com/api/geoblock" ? { blocked: true, ip: "203.0.113.9", country: "GB", region: "ENG" }
      : p === "clob.polymarket.com/auth/api-keys" ? { apiKeys: [PM_API_KEY, "another-key-of-the-account"] }
      : p === "clob.polymarket.com/auth/ban-status/closed-only" ? { closed_only: true }
      : p === "clob.polymarket.com/balance-allowance" ? { balance: "12345678", allowances: { "0xE111180000d2663C0091e4f400237545B87B996B": MAX_ALLOWANCE, "0xe3333700cA9d93003F00f0F71f8515005F6c00Aa": MAX_ALLOWANCE, "0x00000000000000000000000000000000000000aa": "5" } }
      : p === "clob.polymarket.com/data/orders"
      ? (url.searchParams.get("next_cursor") === "MA==" ? { limit: 100, count: 1, next_cursor: "MTAw", data: [{ id: "0x1" }] } : { limit: 100, count: 1, next_cursor: "LTE=", data: [{ id: "0x2" }] })
      : p === "gamma-api.polymarket.com/public-profile" ? { proxyWallet: PM_FUNDER, name: "someone", bio: "not for the report" }
      : p === "gamma-api.polymarket.com/markets/keyset"
      ? { markets: [{ id: "1", question: "Q?", slug: "q", conditionId: "0xc", enableOrderBook: true, acceptingOrders: true, clobTokenIds: '["777","888"]', outcomes: '["Yes","No"]', outcomePrices: '["0.4","0.6"]', feeSchedule: { rate: 0.05 } }], next_cursor: "x" }
      : p === "clob.polymarket.com/book"
      ? { market: "0xc", asset_id: url.searchParams.get("token_id"), timestamp: "1790216237628", bids: [{ price: "0.39", size: "10" }, { price: "0.40", size: "5" }], asks: [{ price: "0.42", size: "7" }, { price: "0.41", size: "3" }], tick_size: "0.01", min_order_size: "5", neg_risk: false, last_trade_price: "0.40" }
      : null;
    return body === null ? new Response("not found", { status: 404 }) : new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

async function withPolymarketEnv<T>(run: () => Promise<T>): Promise<T> {
  const names = Object.values(POLYMARKET_ENV_NAMES).flat();
  const saved = new Map(names.map((n) => [n, Deno.env.get(n)]));
  const planted: Record<string, string> = {
    POLYMARKET_PRIVATE_KEY: PM_KEY, POLYMARKET_CLOB_API_KEY: PM_API_KEY, POLYMARKET_API_KEY: PM_API_KEY, POLYMARKET_CLOB_SECRET: PM_SECRET,
    POLYMARKET_API_SECRET: PM_SECRET, POLYMARKET_CLOB_PASSPHRASE: PM_PASSPHRASE, POLYMARKET_API_PASSPHRASE: PM_PASSPHRASE,
    POLYMARKET_FUNDER_ADDRESS: PM_FUNDER, POLYMARKET_SIGNER_ADDRESS: PM_SIGNER, POLYMARKET_SIG_TYPE: "1", POLYMARKET_HOST: "https://clob.polymarket.com", POLYMARKET_CHAIN_ID: "137",
  };
  for (const n of names) Deno.env.delete(n);
  for (const [n, v] of Object.entries(planted)) Deno.env.set(n, v);
  try {
    return await run();
  } finally {
    for (const [n, v] of saved) v === undefined ? Deno.env.delete(n) : Deno.env.set(n, v);
  }
}

Deno.test("probeParts: `only=polymarket` runs the Polymarket part and nothing else", () => {
  assert((PROBE_PARTS as readonly string[]).includes("polymarket"));
  assertEquals([...probeParts("polymarket")!], ["polymarket"]);
});

Deno.test("runProbe(polymarket) — GETs to its listed reads only, L2 signed the documented way, and the key checked against the signer", async () => {
  const hosts = polymarketHosts();
  const out = await withPolymarketEnv(() => runProbe(new Set(["polymarket"]), hosts.fetchImpl));
  assertEquals(out.revx, undefined);
  const pm = out.polymarket as Record<string, any>;

  // Reads only: every request a GET with no body and no redirect followed, each to a listed URL, no secret in any URL.
  assert(hosts.calls.length >= 10, `${hosts.calls.length} calls`);
  for (const c of hosts.calls) {
    assertEquals([c.method, c.redirect, c.body ?? null], ["GET", "manual", null], c.url.href);
    assert(POLYMARKET_READS.includes(`${c.url.origin}${c.url.pathname}`), c.url.href);
    assertEquals(leaksPart(c.url.href, PM_SECRETS), null, `a secret in ${c.url.pathname}`);
    for (const [, v] of c.headers) for (const s of [PM_KEY, PM_KEY.slice(2), PM_SECRET]) assert(!v.includes(s), `the key or the L2 secret in a header of ${c.url.pathname}`);
  }
  // L2: the CLOB host only, as the signer, the signature over timestamp + GET + the path WITHOUT its query.
  const l2 = hosts.calls.filter((c) => c.headers.has("POLY_API_KEY"));
  assertEquals(l2.map((c) => c.url.pathname), ["/auth/api-keys", "/auth/ban-status/closed-only", "/balance-allowance", "/data/orders", "/data/orders"]);
  for (const c of l2) {
    assertEquals(c.url.origin, "https://clob.polymarket.com");
    assertEquals([c.headers.get("POLY_ADDRESS"), c.headers.get("POLY_API_KEY"), c.headers.get("POLY_PASSPHRASE")], [PM_SIGNER, PM_API_KEY, PM_PASSPHRASE]);
    assertEquals(c.headers.get("POLY_SIGNATURE"), await polyHmacSignature(PM_SECRET, c.headers.get("POLY_TIMESTAMP")!, "GET", c.url.pathname));
  }
  assert(hosts.calls.filter((c) => !c.headers.has("POLY_API_KEY")).every((c) => ![...c.headers.keys()].some((h) => h.toUpperCase().startsWith("POLY_"))));
  assertEquals(l2[2].url.searchParams.get("asset_type"), "COLLATERAL");
  assertEquals(l2[2].url.searchParams.get("signature_type"), "1");

  // What it reports.
  assertEquals(pm.signer, { derived: PM_SIGNER, stored: PM_SIGNER, matches: true });
  assertEquals(pm.config.funder, PM_FUNDER);
  assertEquals(pm.config.problems, []);
  assert(Math.abs(pm.clock.skewS) <= 1, JSON.stringify(pm.clock));
  assertEquals([pm.geoblock.blocked, pm.geoblock.country], [true, "GB"]);
  assertEquals(pm.apiKeys, { status: 200, count: 2, includesConfigured: true });
  assertEquals(pm.closedOnly, { status: 200, closedOnly: true });
  assertEquals([pm.collateral.pusd, pm.collateral.signatureType], [12.345678, 1]);
  assertEquals(pm.collateral.allowances, [
    { spender: "0xE111180000d2663C0091e4f400237545B87B996B", contract: "CTF Exchange", allowance: "max" },
    // The live account's fourth spender on 2026-09-24: Combos' Exchange v3, named rather than left for a person to look up.
    { spender: "0xe3333700cA9d93003F00f0F71f8515005F6c00Aa", contract: "Combos Exchange v3", allowance: "max" },
    { spender: "0x00000000000000000000000000000000000000aa", contract: null, allowance: "5" },
  ]);
  assertEquals(pm.openOrders, { status: 200, count: 2, pages: 2 });
  assertEquals(pm.funderProfile, { status: 200, proxyWallet: PM_FUNDER, matchesFunder: true });
  assertEquals([pm.book.market.question, pm.book.tokenId, pm.book.bestBid, pm.book.bestAsk], ["Q?", "777", { price: 0.4, size: 5 }, { price: 0.41, size: 3 }]);

  // And no part of any secret, nor the profile's personal fields, anywhere in the report.
  const text = JSON.stringify(out);
  assertEquals(leaksPart(text, PM_SECRETS), null, "a planted secret reached the report");
  assert(!text.includes("not for the report") && !text.includes("someone"));
});

Deno.test("runProbe(polymarket) — a server that echoes every header and secret back gets none of them into the report", async () => {
  const hosts = polymarketHosts(true);
  const out = await withPolymarketEnv(() => runProbe(new Set(["polymarket"]), hosts.fetchImpl));
  const pm = out.polymarket as Record<string, any>;
  assertEquals(pm.apiKeys.status, 401);
  assert(String(pm.apiKeys.error).includes("[redac"), pm.apiKeys.error);        // the echo arrived, and was scrubbed before the cut
  const text = JSON.stringify(out);
  assertEquals(leaksPart(text, PM_SECRETS), null, "a planted secret, or part of one, reached the report");
  assert(hosts.calls.every((c) => c.method === "GET"));
});

Deno.test("runProbe(polymarket) — without complete credentials it skips the L2 reads and still makes the public ones", async () => {
  const hosts = polymarketHosts();
  const out = await withPolymarketEnv(() => {
    Deno.env.delete("POLYMARKET_CLOB_PASSPHRASE");
    Deno.env.delete("POLYMARKET_API_PASSPHRASE");
    return runProbe(new Set(["polymarket"]), hosts.fetchImpl);
  });
  const pm = out.polymarket as Record<string, any>;
  assertEquals(pm.apiKeys, { skipped: "no complete L2 credentials" });
  assert(pm.config.problems.some((p: string) => p.includes("PASSPHRASE")));
  assert(!hosts.calls.some((c) => c.headers.has("POLY_API_KEY")), "no L2 request without the whole credential set");
  assertEquals(pm.signer.matches, true);
  assertEquals(pm.geoblock.country, "GB");
});

Deno.test("PAGE_VENUES — the page shows Revolut X and Binance, each with its own rows; Kraken is the signal venue only", () => {
  assertEquals([...PAGE_VENUES], ["revx", "binance"]);
});

Deno.test("quotesDelayMs: the paper quote run reads Revolut X 25 s into its minute, never before, and never waits past it", () => {
  const top = Date.UTC(2026, 8, 23, 15, 0, 0);
  assertEquals(quotesDelayMs(top), 25e3);                     // cron fires at the top of the minute, with the tick
  assertEquals(quotesDelayMs(top + 10e3), 15e3);
  assertEquals(quotesDelayMs(top + 25e3), 0);
  assertEquals(quotesDelayMs(top + 59e3), 0);                 // late already: go now, do not wait for the next minute
});

Deno.test("quotesSummary: P&L on the $1,200 the quotes lock, today's apart, what is held, and whether it keeps up", () => {
  const now = Date.UTC(2026, 8, 24, 12, 0, 30), dayStart = Date.UTC(2026, 8, 24);
  const st = {
    state: { books: {
      "USDC-GBP": { lastX: 1.33, rungs: [{ mode: "position", nq: 75 }, { mode: "quote" }, { mode: "idle" }] },
      "USDT-GBP": { lastX: 1.33, rungs: [{ mode: "quote" }] },
    } },
    last_minute: new Date(now - 90e3).toISOString(), updated_at: new Date(now).toISOString(), last_error: null,
  };
  const trips = [
    { book: "USDT-GBP", t_exit: new Date(dayStart + 3600e3).toISOString(), pnl_usd: 0.12, notional_usd: 60, qty: "79.4436" },
    { book: "USDC-GBP", t_exit: new Date(dayStart - 3600e3).toISOString(), pnl_usd: "0.30", notional_usd: 100 },
    { book: "USDC-GBP", t_exit: new Date(dayStart - 7200e3).toISOString(), pnl_usd: -0.02, notional_usd: 40 },
  ];
  const q = quotesSummary(st, trips, [{ kind: "order" }, { kind: "order" }, { kind: "fill" }], "2026-09-23T15:09:00Z", now, dayStart)!;
  assertAlmostEquals(q.realisedUsd, 0.40, 1e-12);
  assertAlmostEquals(q.realisedPct, 0.40 / QUOTES_CAPITAL_USD * 100, 1e-12);
  assertAlmostEquals(q.todayUsd, 0.12, 1e-12);                      // only what closed since midnight UTC
  assertEquals([q.trips, q.won, q.open, q.ordersToday, q.fillsToday], [3, 2, 1, 2, 1]);
  assertAlmostEquals(q.openUsd, 75 * 1.33, 1e-9);                     // a position is its GBP notional at the last rate
  assertEquals([q.lagMinutes, q.running], [2, true]);
  // In pounds: the trips stored without prices at the rate, the capital set in dollars at the rate, a position its notional.
  assertEquals(q.x, 1.33);
  assertAlmostEquals(q.realisedGbp, 0.40 / 1.33, 1e-12);
  assertAlmostEquals(q.todayGbp, 0.12 / 1.33, 1e-12);
  assertAlmostEquals(q.capitalGbp!, QUOTES_CAPITAL_USD / 1.33, 1e-9);
  assertEquals(q.openGbp, 75);
  // Deployed is what its quotes have at work: four rungs share the $1,200 ($300 each); two quote, one holds £75.
  assertAlmostEquals(q.deployedUsd, 75 * 1.33 + 2 * 300, 1e-9);
  assertAlmostEquals(q.deployedGbp!, 75 + 600 / 1.33, 1e-9);
  // Each trip carries its size in coins, for the page's size column; a trip stored without one says so.
  assertEquals(q.recent.map((t) => t.qty), [79.4436, null, null]);
  const stale = quotesSummary({ ...st, last_minute: new Date(now - 10 * 60e3).toISOString() }, [], [], null, now, dayStart)!;
  assertEquals(stale.running, false);                                  // ten minutes behind: it has stopped
  assertEquals(quotesSummary(null, [], [], null, now, dayStart), null);  // not built yet: off the page
});

Deno.test("quoteDays: the quote test's days, newest first, today marked, numbers as numbers; the summary carries them", () => {
  const dayStart = Date.UTC(2026, 8, 24);
  // As PostgREST returns `agent_quote_days` (`0070`): bigint counts may come as strings, numeric as a string.
  const rows = [
    { day: "2026-09-23", orders: "140", fills: 3, trips: 2, won: "1", realised_usd: "0.0935" },
    { day: "2026-09-24", orders: 61, fills: "2", trips: "1", won: 1, realised_usd: 0.12 },
    { day: "2026-09-22", orders: 0, fills: 0, trips: 1, won: 0, realised_usd: "-0.0400" },
  ];
  assertEquals(quoteDays(rows, dayStart), [
    { day: "2026-09-24", orders: 61, fills: 2, trips: 1, won: 1, realisedUsd: 0.12, realisedGbp: 0, today: true },
    { day: "2026-09-23", orders: 140, fills: 3, trips: 2, won: 1, realisedUsd: 0.0935, realisedGbp: 0, today: false },
    { day: "2026-09-22", orders: 0, fills: 0, trips: 1, won: 0, realisedUsd: -0.04, realisedGbp: 0, today: false },
  ]);
  // In pounds, each day is the trips that closed in it, priced as the engine priced them before its rate.
  const trips = [
    { book: "USDC-GBP", side: "bid", qty: 100, entry: 0.75, exit: 0.7508, t_exit: "2026-09-24T10:00:00Z", pnl_usd: 0.108, notional_usd: 101.25 },
    { book: "USDT-GBP", side: "ask", qty: "50", entry: "0.7600", exit: "0.7590", t_exit: "2026-09-24T11:00:00Z", pnl_usd: 0.0675, notional_usd: 51.3 },
    { book: "USDT-GBP", t_exit: "2026-09-23T09:00:00Z", pnl_usd: 0.0935, notional_usd: 50 },              // no prices: its dollars at the rate
  ];
  const withGbp = quoteDays(rows, dayStart, trips, 1.35);
  assertAlmostEquals(withGbp[0].realisedGbp, 100 * 0.0008 + 50 * 0.001, 1e-12);
  assertAlmostEquals(withGbp[1].realisedGbp, 0.0935 / 1.35, 1e-12);
  assertEquals(withGbp[2].realisedGbp, 0);
  assertEquals(quoteDays([], dayStart), []);
  // The summary passes them through; without the view (before `0070`) it has none, and the page says so.
  const now = dayStart + 12 * 3600e3;
  const st = { state: { books: {} }, last_minute: new Date(now - 60e3).toISOString(), updated_at: new Date(now).toISOString(), last_error: null };
  assertEquals(quotesSummary(st, [], [], null, now, dayStart, rows)!.days.map((d) => d.day), ["2026-09-24", "2026-09-23", "2026-09-22"]);
  assertEquals(quotesSummary(st, [], [], null, now, dayStart)!.days, []);
});

Deno.test("quotesSummary: each book's ladder for its page, held rungs marked at the last print, newest trips first", () => {
  const now = Date.UTC(2026, 8, 24, 12, 0, 30), dayStart = Date.UTC(2026, 8, 24);
  const tEntry = Date.UTC(2026, 8, 24, 11, 40);
  // USDC-GBP: bought 132.5 USDC at £0.7542 on the 0.1 % bid (nq = £99.93), the last print at £0.7550; the other five
  // rungs quote around a fair of £0.75505. USDT-GBP: sold 100 USDT at £0.7560 on the 0.2 % ask, last print £0.7548.
  const st = {
    state: { books: {
      "USDT-GBP": { lastX: 1.32, lastPrint: { ts: now - 60e3, ticks: 7548 }, rungs: [
        { side: "ask", k: 0.002, mode: "position", entry: 0.7560, qty: 100, nq: 75.6, tEntry, o: { ticks: 7548, fairAt: 0.7548 } },
        { side: "bid", k: 0.001, mode: "idle", o: null },
      ] },
      "USDC-GBP": { lastX: 1.32, lastPrint: { ts: now - 30e3, ticks: 7550 }, rungs: [
        { side: "bid", k: 0.001, mode: "position", entry: 0.7542, qty: 132.5, nq: 99.9315, tEntry, o: { ticks: 7550, fairAt: 0.75505 } },
        { side: "bid", k: 0.002, mode: "quote", o: { ticks: 7535, fairAt: 0.75505 } },
        { side: "ask", k: 0.001, mode: "quote", o: { ticks: 7559, fairAt: 0.75505 } },
      ] },
    } },
    last_minute: new Date(now - 60e3).toISOString(), updated_at: new Date(now).toISOString(), last_error: null,
  };
  const trips = Array.from({ length: 25 }, (_, i) => ({
    book: i % 2 ? "USDT-GBP" : "USDC-GBP", side: "bid", k: "0.001", t_entry: new Date(dayStart + i * 60e3).toISOString(),
    t_exit: new Date(dayStart + (i + 5) * 60e3).toISOString(), entry: "0.7540", exit: "0.7548", how: "maker", pnl_usd: i === 3 ? -0.01 : 0.02, notional_usd: 100,
  }));
  const q = quotesSummary(st, trips, [], null, now, dayStart)!;
  assertEquals(q.books.map((b) => b.book), ["USDC-GBP", "USDT-GBP"]);   // a fixed order, whatever the state's key order
  const [usdc, usdt] = q.books;
  assertEquals([usdc.quoting, usdc.held, usdt.quoting, usdt.held], [2, 1, 0, 1]);
  assertAlmostEquals(usdc.lastPrice!, 0.7550, 1e-12);
  assertAlmostEquals(usdc.fair!, 0.75505, 1e-12);
  assertAlmostEquals(usdc.rungs[1].price!, 0.7535, 1e-12);            // a quoting rung shows its order's price
  // Held rungs at the last print: a bid gains when the print is above its entry, an ask when it is below.
  assertAlmostEquals(usdc.unrealisedUsd!, 132.5 * (0.7550 - 0.7542) * 1.32, 1e-9);
  assertAlmostEquals(usdt.unrealisedUsd!, 100 * (0.7560 - 0.7548) * 1.32, 1e-9);
  assertAlmostEquals(q.unrealisedUsd!, usdc.unrealisedUsd! + usdt.unrealisedUsd!, 1e-12);
  assertAlmostEquals(q.openUsd, (99.9315 + 75.6) * 1.32, 1e-9);         // the same notional × rate the card always showed
  assertEquals([q.open, usdc.trips, usdt.trips, usdc.won, usdt.won], [2, 13, 12, 13, 11]);   // the one loss (i = 3) is USDT's
  assertEquals(usdc.rungs[0].heldSince, new Date(tEntry).toISOString());
  // The page lists the newest twenty, newest first, with their numbers as numbers.
  assertEquals(q.recent.length, QUOTES_RECENT_TRIPS);
  assertEquals(q.recent[0].tExit, trips[24].t_exit);
  assertEquals([q.recent[0].entry, q.recent[0].exit, q.recent[0].k], [0.754, 0.7548, 0.001]);
  // No print yet on a book that holds: its unrealised is unknown, not zero, and so is the total.
  const dark = quotesSummary({ ...st, state: { books: { "USDC-GBP": { ...st.state.books["USDC-GBP"], lastPrint: null } } } }, [], [], null, now, dayStart)!;
  assertEquals([dark.books[0].unrealisedUsd, dark.unrealisedUsd], [null, null]);
  // With a fresh index price, what is held is marked at it, as Revolut X values coins (Davies, 2026-10-01); the dark
  // book has a price again. The book says which index it used.
  const at = quotesSummary(st, [], [], null, now, dayStart, [], QUOTES_CAPITAL_USD, { "USDC-GBP": 0.7546 })!;
  assertEquals([at.books[0].index, at.books[1].index], [0.7546, null]);
  assertAlmostEquals(at.books[0].unrealisedGbp!, 132.5 * (0.7546 - 0.7542), 1e-12);
  assertAlmostEquals(at.books[1].unrealisedGbp!, 100 * (0.7560 - 0.7548), 1e-12);      // no index: the last print
  const darkAt = quotesSummary({ ...st, state: { books: { "USDC-GBP": { ...st.state.books["USDC-GBP"], lastPrint: null } } } }, [], [], null, now, dayStart, [], QUOTES_CAPITAL_USD, { "USDC-GBP": 0.7546 })!;
  assertAlmostEquals(darkAt.unrealisedGbp!, 132.5 * (0.7546 - 0.7542), 1e-12);
  // Deployed: the five rungs share the $1,200 ($240 each); two quote, two hold their notional.
  assertAlmostEquals(q.deployedUsd, (99.9315 + 75.6) * 1.32 + 2 * 240, 1e-9);
  assertAlmostEquals(q.deployedGbp!, 99.9315 + 75.6 + 480 / 1.32, 1e-9);
});

Deno.test("quotesVariantSummary: arm main in exactly the shape of PR5's quotes, on its $3,600, with the keys' POSTs today and top5's totals beside it", () => {
  const now = Date.UTC(2026, 9, 1, 12, 0, 30), dayStart = Date.UTC(2026, 9, 1), day = Math.floor(dayStart / 86400e3);
  const book = (lastX: number) => ({ lastX, lastPrint: { ts: now - 60e3, ticks: 7400 }, rungs: [
    { side: "bid", k: 0.0003, mode: "position", entry: 0.7396, qty: 100, nq: 73.96, tEntry: now - 600e3, o: { ticks: 7400, fairAt: 0.74 } },
    { side: "ask", k: 0.0003, mode: "quote", o: { ticks: 7403, fairAt: 0.74 } },
  ] });
  const state = {
    state: { arms: {
      main: { books: { "USDT-GBP": book(1.33), "USDC-GBP": book(1.33) }, gov: { day, counts: { "USDC-GBP/bid": 412, "USDT-GBP/ask": 601 } } },
      top5: { books: { "USDC-GBP": { lastX: 1.33, lastPrint: null, rungs: [{ side: "bid", k: 0.0005, mode: "idle", o: null }] } }, gov: { day, counts: {} } },
    } },
    last_minute: new Date(now - 120e3).toISOString(), updated_at: new Date(now - 30e3).toISOString(), last_error: null,
  };
  const trip = (arm: string, book: string, hoursAgo: number, pnl: number) => ({
    arm, book, side: "bid", k: 0.0003, t_entry: new Date(now - (hoursAgo + 1) * 3600e3).toISOString(), t_exit: new Date(now - hoursAgo * 3600e3).toISOString(),
    entry: 0.7396, exit: 0.74, how: "maker", pnl_usd: pnl, notional_usd: 100, qty: 135.2,
  });
  const trips = [trip("main", "USDC-GBP", 1, 0.05), trip("main", "USDT-GBP", 20, -0.01), trip("top5", "USDC-GBP", 2, 0.07)];
  const days = [
    { arm: "main", day: "2026-10-01", orders: 700, fills: 9, trips: 1, won: 1, realised_usd: 0.05 },
    { arm: "top5", day: "2026-10-01", orders: "350", fills: "4", trips: 1, won: 1, realised_usd: "0.07" },
    { arm: "main", day: "2026-09-30", orders: 1500, fills: 20, trips: 1, won: 0, realised_usd: -0.01 },
  ];
  const q = quotesVariantSummary({ state, trips, days, nowMs: now, dayStartMs: dayStart })!;
  // The same fields as PR5's `quotes` object, the live path's included (none here), and four of its own.
  const pr5 = quotesSummary({ state: { books: {} }, last_minute: state.last_minute, updated_at: state.updated_at, last_error: null }, [], [], null, now, dayStart);
  assertEquals(Object.keys(q).sort(), [...Object.keys(pr5!), "live", "arm", "postsToday", "governor", "top5"].sort());
  assertEquals([q.arm, q.live, q.capitalUsd, q.startedAt, q.lagMinutes, q.running], ["main", null, 3600, "2026-09-28T00:00:00.000Z", 2, true]);
  assertAlmostEquals(q.realisedUsd, 0.04, 1e-12);
  assertAlmostEquals(q.realisedPct, 0.04 / 3600 * 100, 1e-12);
  assertAlmostEquals(q.todayUsd, 0.05, 1e-12);                                  // only main's, only what closed since 00:00 UTC
  assertEquals([q.trips, q.won, q.open, q.ordersToday, q.fillsToday], [2, 1, 2, 700, 9]);   // orders and fills today from its days
  assertEquals(q.books.map((b) => b.book), ["USDC-GBP", "USDT-GBP"]);
  assertAlmostEquals(q.books[0].unrealisedUsd!, 100 * (0.74 - 0.7396) * 1.33, 1e-9);
  assertEquals(q.days.map((d) => [d.day, d.orders, d.today]), [["2026-10-01", 700, true], ["2026-09-30", 1500, false]]);
  assertEquals(q.recent.map((t) => t.book), ["USDC-GBP", "USDT-GBP"]);
  // Each key's POSTs today; a key that has sent none reads 0.
  assertEquals(q.postsToday, { "USDC-GBP/bid": 412, "USDC-GBP/ask": 0, "USDT-GBP/bid": 0, "USDT-GBP/ask": 601 });
  assertEquals(q.governor, { entryAt: 900, stopAt: 950 });
  // top5 on its own $2,000, from its own trips and days.
  assertEquals([q.top5.capitalUsd, q.top5.trips, q.top5.won, q.top5.open, q.top5.ordersToday, q.top5.fillsToday], [2000, 1, 1, 0, 350, 4]);
  assertAlmostEquals(q.top5.realisedPct, 0.07 / 2000 * 100, 1e-12);
  // Counts from a UTC day that is over are not today's; no state, no row.
  const late = quotesVariantSummary({ state, trips, days, nowMs: now + 86400e3, dayStartMs: dayStart + 86400e3 })!;
  assertEquals(Object.values(late.postsToday), [0, 0, 0, 0]);
  assertEquals([late.running, late.ordersToday], [false, 0]);
  assertEquals(quotesVariantSummary({ state: null, trips, days, nowMs: now, dayStartMs: dayStart }), null);
  // PR5's own summary is unchanged: its capital stays $1,200 when none is named.
  assertEquals(pr5!.capitalUsd, QUOTES_CAPITAL_USD);
});

Deno.test("quotesRuledSummary: arm d on its $3,600, with the deviation check and no top5", () => {
  const now = Date.UTC(2026, 9, 1, 12, 0, 30), dayStart = Date.UTC(2026, 9, 1), day = Math.floor(dayStart / 86400e3);
  const state = {
    state: {
      checkMaxUsd: 0.004, checkDays: 2,
      arms: { d: { books: { "USDC-GBP": { lastX: 1.33, lastPrint: { ts: now - 60e3, ticks: 7400 }, rungs: [] } }, gov: { day, counts: { "USDC-GBP/bid": 12 } } } },
    },
    last_minute: new Date(now - 60e3).toISOString(), updated_at: new Date(now - 30e3).toISOString(), last_error: null,
  };
  const trips = [{ arm: "d", book: "USDC-GBP", side: "bid", k: 0.0003, t_entry: new Date(now - 2 * 3600e3).toISOString(), t_exit: new Date(now - 3600e3).toISOString(), entry: 0.74, exit: 0.741, how: "maker", pnl_usd: 0.05, notional_usd: 100, qty: 1 }];
  const days = [{ arm: "d", day: "2026-10-01", orders: 40, fills: 1, trips: 1, won: 1, realised_usd: 0.05 }];
  const q = quotesRuledSummary({ state, trips, days, nowMs: now, dayStartMs: dayStart })!;
  const pr5 = quotesSummary({ state: { books: {} }, last_minute: state.last_minute, updated_at: state.updated_at, last_error: null }, [], [], null, now, dayStart);
  assertEquals(Object.keys(q).sort(), [...Object.keys(pr5!), "live", "arm", "postsToday", "governor", "checkMaxUsd", "checkDays"].sort());
  assertEquals([q.arm, q.live, q.capitalUsd, q.checkMaxUsd, q.checkDays, q.postsToday["USDC-GBP/bid"]], ["d", null, 3600, 0.004, 2, 12]);
  assertEquals(quotesRuledSummary({ state: null, trips, days, nowMs: now, dayStartMs: dayStart }), null);
});

Deno.test("crashReport — an agents.crash row names the action and the top of the stack, not the message alone", () => {
  const timeout = new DOMException("Signal timed out.", "TimeoutError");
  const r = crashReport("tick", timeout);
  assertEquals(r.message, "Signal timed out.");
  assertEquals(r.context.action, "tick");
  assertEquals(r.context.name, "TimeoutError");
  const deep = new Error("deep");
  deep.stack = ["Error: deep", ...Array.from({ length: 30 }, (_, i) => `    at frame${i} (index.ts:${i}:1)`)].join("\n");
  const lines = crashReport("dashboard", deep).context.stack!.split("\n");
  assertEquals(lines.length, 12);                       // the top of the stack, where the throw happened
  assertEquals(lines[1], "    at frame0 (index.ts:0:1)");
  assertEquals(crashReport("", "boom"), { message: "boom", context: { action: null, name: "string", stack: null } });
});

Deno.test("newestDecisions: a daily row keeps its midnight decision when the hourly rows fill the newest 120", async () => {
  // A day as production has it at 16:12: two hourly rows and three 4-hour rows since 04:00, the daily row once at 00:00.
  const day = Date.UTC(2026, 8, 26);
  const rows: Array<{ strategy_id: string; ts: string }> = [{ strategy_id: "momentum-1d", ts: new Date(day + 6e3).toISOString() }];
  for (let h = 0; h <= 16; h++) {
    for (const id of ["trend-1h", "trend-1h-binance"]) for (let k = 0; k < 3; k++) rows.push({ strategy_id: id, ts: new Date(day + h * 3600e3 + 4e3 + k).toISOString() });
    if (h % 4 === 0) for (const id of ["trend-4h", "trend-4h-binance", "trend-4h-live"]) for (let k = 0; k < 4; k++) rows.push({ strategy_id: id, ts: new Date(day + h * 3600e3 + 5e3 + k).toISOString() });
  }
  const byTs = (a: { ts: string }, b: { ts: string }) => b.ts.localeCompare(a.ts);
  // What the page read before: the 120 newest overall, and each row's first among them.
  const window = [...rows].sort(byTs).slice(0, 120);
  assertEquals(window.find((r) => r.strategy_id === "momentum-1d"), undefined);
  // Each row by its own query, as PostgREST answers `strategy_id=eq.X&order=ts.desc&limit=1`; a query that fails is skipped.
  const got = await newestDecisions(["momentum-1d", "trend-1h", "trend-4h-live", "gone"], async (id) => {
    if (id === "gone") throw new Error("503");
    return rows.filter((r) => r.strategy_id === id).sort(byTs).slice(0, 1);
  });
  assertEquals(got.get("momentum-1d")?.ts, "2026-09-26T00:00:06.000Z");
  assertEquals(got.get("trend-1h")?.ts, new Date(day + 16 * 3600e3 + 4e3 + 2).toISOString());
  assertEquals(got.get("trend-4h-live")?.ts, new Date(day + 16 * 3600e3 + 5e3 + 3).toISOString());
  assertEquals(got.has("gone"), false);
});

Deno.test("quotesLiveSummary: PR5's real-money book from its live fills, in USD at the paper books' rate; dry-run only says so", () => {
  const now = Date.UTC(2026, 9, 22, 12, 0), day = Date.UTC(2026, 9, 22), yesterday = day - 3600e3;
  const iso = (ms: number) => new Date(ms).toISOString();
  const o = (id: number, over: Partial<QuoteLiveOrderView>): QuoteLiveOrderView => ({
    id, ts: iso(now - 3600e3), mode: "live", book: "USDC-GBP", rung_side: "bid", k: 0.001, leg: "entry", state: "filled",
    filled_base: 0, avg_fill_price: null, price: 0.738, fee_gbp: 0, filled_at: null, ...over,
  });
  const orders = [
    o(1, { filled_base: 10, avg_fill_price: 0.738, filled_at: iso(yesterday) }),                                  // bought yesterday at 0.7380 …
    o(2, { leg: "exit", filled_base: 10, avg_fill_price: 0.739, filled_at: iso(now - 600e3) }),                   // … sold today at 0.7390: +£0.01
    o(3, { k: 0.002, filled_base: 5, avg_fill_price: 0.737, filled_at: iso(now - 300e3) }),                       // holds 5 from 0.7370
    o(4, { book: "USDT-GBP", rung_side: "ask", state: "pending", ts: iso(now - 5 * 60e3), price: 0.741 }),       // never heard back
    o(5, { mode: "dry_run", filled_base: 99, avg_fill_price: 0.5 }),                                                // not money
  ];
  const paper = { state: { books: { "USDC-GBP": { lastX: 1.35, lastPrint: { ticks: 7390 } }, "USDT-GBP": { lastX: 1.35, lastPrint: { ticks: 7400 } } } }, last_minute: iso(now), updated_at: iso(now), last_error: null };
  const cfg = { dry_run: false, live_confirmed_at: iso(now - 86400e3), capital_gbp: 50 };
  const st = { state: { entryBook: "live", why: "", posts: { dry_run: 0, live: 7 }, lossStopped: false }, updated_at: iso(now - 30e3), last_error: null };
  const r = quotesLiveSummary({ config: cfg, state: st, orders, paper, nowMs: now, dayStartMs: day })!;
  assertEquals([r.tradedLive, r.dryRun, r.armed, r.running, r.entryBook], [true, false, true, true, "live"]);
  assertEquals([r.fills, r.openOrders, r.heldRungs, r.pending.map((p) => p.id)], [3, 1, 1, [4]]);
  assertAlmostEquals(r.capitalUsd!, 67.5, 1e-9);
  assertEquals(r.lossStopGbp, -0.5);                                                    // 1 % of £50
  assertAlmostEquals(r.realisedUsd!, 0.01 * 1.35, 1e-12);
  assertAlmostEquals(r.unrealisedUsd!, 5 * (0.739 - 0.737) * 1.35, 1e-12);
  assertAlmostEquals(r.todayUsd!, (0.01 + 5 * (0.739 - 0.737)) * 1.35, 1e-12);        // the loss stop's own figure
  // No conversion and no balances read: the coins are the book's own count, the 5 the bid holds, at what they cost.
  assertAlmostEquals(r.costUsd!, 5 * 0.737 * 1.35, 1e-12);
  assertAlmostEquals(r.valueUsd!, 5 * 0.739 * 1.35, 1e-12);
  // In dry-run with nothing sent: no money, what it would have sent today, and whether it is keeping up.
  const dry = quotesLiveSummary({ config: { ...cfg, dry_run: true, live_confirmed_at: null }, state: { ...st, state: { entryBook: "dry_run", posts: { dry_run: 12, live: 0 } }, updated_at: iso(now - 10 * 60e3) }, orders: [], paper, nowMs: now, dayStartMs: day })!;
  assertEquals([dry.tradedLive, dry.dryRun, dry.armed, dry.postsToday.dryRun, dry.running, dry.lagMinutes], [false, true, false, 12, false, 10]);
  assertEquals(quotesLiveSummary({ config: null, state: null, orders: [], paper: null, nowMs: now, dayStartMs: day }), null);
});

/**
 * The dashboard's reads of the live tables, as PostgREST answers them, over the fixture's rows: each query's filter, order,
 * limit and columns (a column the query does not select is not in the row, so the page cannot read one by accident).
 */
function liveReads(f: typeof liveFixture) {
  type Row = Record<string, unknown>;
  const pick = (cols: string) => (r: Row) => Object.fromEntries(cols.split(",").map((c) => {
    if (!(c in r)) throw new Error(`fixture row ${r.id} has no ${c}`);
    return [c, r[c]];
  }));
  const live = (f.orders as Row[]).filter((r) => r.mode === "live");
  const asc = (a: Row, b: Row) => Number(a.id) - Number(b.id);
  return {
    orders: [...live].sort(asc).map(pick(QUOTE_LIVE_SUMMARY_COLUMNS)) as QuoteLiveOrderView[],
    open: live.filter((r) => ["pending", "new", "partially_filled"].includes(String(r.state))).sort(asc).map(pick(QUOTE_LIVE_ORDER_COLUMNS)) as QuoteLiveOrderView[],
    // `QUOTES_LIVE_ORDERS_FILTER`: a cancel that filled nothing is not read.
    recent: live.filter((r) => r.state !== "cancelled" || Number(r.filled_base) > 0).sort((a, b) => asc(b, a)).slice(0, QUOTES_LIVE_PAGE_ROWS)
      .map(pick(QUOTE_LIVE_REASON_COLUMNS)) as QuoteLiveRecentRow[],
  };
}

Deno.test("quotesLiveDetail: the live executor's own page, for a book worked out by hand, adds up to its LIVE row", () => {
  const f = liveFixture;
  const reads = liveReads(f);
  // deno-lint-ignore no-explicit-any
  const base: any = { config: f.config, state: f.state, orders: reads.orders, paper: f.paper, nowMs: f.nowMs, dayStartMs: f.dayStartMs, tickers: f.tickers };
  const row = quotesLiveSummary(base)!;
  const d = quotesLiveDetail({ ...base, open: reads.open, recent: reads.recent })!;
  const x = 1.32;
  // The book by hand, in pounds (the fixture's `about` names the five trips). The conversions bought 395.6436 coins each
  // net of their fee: USDT at 0.7570 (fee 0.2697948), USDC at 0.7574 (fee 0.26993736), £299.772 and £299.9304 paid.
  // D's ask sold 132 of the USDT conversion's coins, so D carries 132 / 395.6436 of its fee; B's ask sold 132 of the
  // USDC conversion's, and B is still open, so its share is in no trip yet.
  const shareD = 132 * 0.2697948 / 395.6436;
  const A = 0.1056, C = -0.168894, D = 0.1188 - shareD;
  assertAlmostEquals(row.realisedUsd!, (A + C + D) * x, 1e-12);
  assertAlmostEquals(row.todayUsd!, (A + C + 0.198 + 0.0924) * x, 1e-12);          // A, C's stop and both holdings: the stop's 0.227106
  assertAlmostEquals(row.todayUsd! / x, f.state.state.dayPnlGbp, 1e-12);
  assertAlmostEquals(row.feesUsd!, (0.089694 + shareD) * x, 1e-12);
  // What it holds is the account's coins against their cost: USDC 263.6436 (the conversion's less B's 132 short), cost
  // £299.9304 less what B sold for; USDT 527.6436 (the conversion's and E's 132), cost £299.772 less D's booked share plus
  // what E paid. Each valued at its ticker's index price, as Revolut X's account page values it: USDC £0.7575, USDT £0.7570.
  const usdcCost = 299.9304 - 132 * 0.7591, usdtCost = 299.772 - shareD + 132 * 0.7565;
  const usdcValue = 263.6436 * 0.7575, usdtValue = 527.6436 * 0.757;
  // Deployed is what its quotes have at work: the coins, and the pounds resting in its four buys (#111, #115–#117).
  const restingBuys = 132 * 0.7576 + 132.11784 * 0.7569 + 132.25763 * 0.7561 + 132.39772 * 0.7553;
  assertAlmostEquals(row.costUsd!, (usdcCost + usdtCost) * x, 1e-9);
  assertAlmostEquals(row.valueUsd!, (usdcValue + usdtValue + restingBuys) * x, 1e-9);
  assertAlmostEquals(row.valueGbp, 999.139418, 1e-6);                         // 83.26 % of the £1,200
  assertAlmostEquals(row.unrealisedUsd!, (usdcValue - usdcCost + usdtValue - usdtCost) * x, 1e-9);
  // …which is the rungs' marks and the conversions' own, all at the index: B 132 × (0.7591 − 0.7575) and the USDC
  // conversion 395.6436 × (0.7575 − 0.7574) less its fee; E 132 × (0.7570 − 0.7565) and the USDT conversion 395.6436 ×
  // (0.7570 − 0.7570) less the part of its fee D has not taken.
  assertAlmostEquals(row.unrealisedUsd! / x, 132 * 0.0016 + 395.6436 * 0.0001 - 0.26993736 + 132 * 0.0005 - (0.2697948 - shareD), 1e-9);
  // Realised and unrealised together are the account's value less its capital: £600.696306 and the coins, less £1,200.
  assertAlmostEquals((row.realisedUsd! + row.unrealisedUsd!) / x, 600.696306 + usdcValue + usdtValue - 1200, 1e-9);
  assertEquals([row.capitalUsd, row.lossStopGbp, row.openOrders, row.heldRungs, row.fills, row.postsToday.live, row.running], [1584, -12, 7, 2, 10, 18, true]);

  // The twelve rungs, in the walk's order, each with its one open order; the two holding rungs show their exits.
  assertEquals(d.rungs.map((r) => `${r.book}|${r.side}|${r.k}:${r.order ? `${r.order.leg}#${r.order.id}` : "-"}${r.held ? ":held" : ""}`), [
    "USDC-GBP|bid|0.001:entry#115", "USDC-GBP|bid|0.002:entry#116", "USDC-GBP|bid|0.003:entry#117",
    "USDC-GBP|ask|0.001:entry#118", "USDC-GBP|ask|0.002:exit#111:held", "USDC-GBP|ask|0.003:entry#119",
    "USDT-GBP|bid|0.001:exit#113:held", "USDT-GBP|bid|0.002:-", "USDT-GBP|bid|0.003:-",
    "USDT-GBP|ask|0.001:-", "USDT-GBP|ask|0.002:-", "USDT-GBP|ask|0.003:-",
  ]);
  assertEquals(d.rungs[0].order, { id: 115, leg: "entry", price: 0.7569, state: "new" });
  const b = d.rungs[4], e = d.rungs[6];
  assertEquals([b.held!.base, b.held!.avgEntry, b.held!.since, b.order!.price], [132, 0.7591, "2026-09-17T20:00:00.000Z", 0.7576]);
  // What each holding has made, at its book's index price as the coins are: B 132 × (0.7591 − 0.7575), E 132 × (0.7570 − 0.7565).
  assertAlmostEquals(b.held!.unrealisedUsd!, 132 * 0.0016 * x, 1e-12);
  assertAlmostEquals(e.held!.unrealisedUsd!, 132 * 0.0005 * x, 1e-12);
  assertAlmostEquals(b.realisedGbp, 0, 1e-15);                                 // B's share of the conversion waits for its close

  // Each book's card: last trade and fair from the paper engine, its own realised and trips; the books add up to the row.
  assertEquals(d.books.map((k) => [k.book, k.lastPrice, k.fair, k.index, k.trips, k.won]), [["USDC-GBP", 0.7576, 0.75766, 0.7575, 1, 1], ["USDT-GBP", 0.7572, 0.75727, 0.757, 2, 1]]);
  assertAlmostEquals(d.books[0].realisedUsd!, A * x, 1e-12);
  assertAlmostEquals(d.books[1].realisedUsd!, (C + D) * x, 1e-12);
  assertAlmostEquals(d.books[0].realisedUsd! + d.books[1].realisedUsd!, row.realisedUsd!, 1e-12);

  // Round trips, newest first; D's fees are its conversion share and its P&L carries it; no rung has exited in part, so
  // the trips add up to REALIZED.
  assertEquals(d.trips.map((t) => [t.book, t.side, t.k, t.how, t.entry, t.exit, t.qty, t.tExit]), [
    ["USDT-GBP", "bid", 0.003, "stop", 0.7556, 0.755, 132, "2026-09-17T20:00:30.000Z"],
    ["USDC-GBP", "bid", 0.001, "exit", 0.7568, 0.7576, 132, "2026-09-17T10:30:00.000Z"],
    ["USDT-GBP", "ask", 0.001, "exit", 0.758, 0.7571, 132, "2026-09-16T13:00:00.000Z"],
  ]);
  assertAlmostEquals(d.trips[0].pnlGbp, C, 1e-12);
  assertAlmostEquals(d.trips[0].feesUsd!, 0.089694 * x, 1e-12);
  assertAlmostEquals(d.trips[1].pnlGbp, A, 1e-12);
  assertAlmostEquals(d.trips[1].feesGbp, 0, 1e-15);                            // a bid buys before it sells: no conversion
  assertAlmostEquals(d.trips[2].feesGbp, shareD, 1e-12);
  assertAlmostEquals(d.trips[2].pnlGbp, D, 1e-12);
  assertAlmostEquals(d.trips.reduce((a, t) => a + t.pnlUsd!, 0), row.realisedUsd!, 1e-12);
  assertEquals([d.tripCount, d.tripsWon], [3, 2]);

  // DAYS, newest first: 18 orders sent today and 6 yesterday (the conversions among them), the entry fills of each day,
  // the trips that closed, and what was realised, which adds up to REALIZED.
  assertEquals(d.days.map((y) => [y.day, y.today, y.orders, y.fills, y.trips, y.won]), [["2026-09-17", true, 18, 3, 2, 1], ["2026-09-16", false, 6, 2, 1, 1]]);
  assertAlmostEquals(d.days[0].realisedGbp, A + C, 1e-12);
  assertAlmostEquals(d.days[1].realisedGbp, D, 1e-12);
  assertAlmostEquals(d.days.reduce((a, y) => a + y.realisedUsd!, 0), row.realisedUsd!, 1e-12);

  // The account as the executor read it: each coin at its book's last print, with its cost and unrealised; the coins add
  // up to the row's deployed and their unrealised to its UNREALIZED.
  const inv = d.inventory.assets!;
  assertEquals(inv.map((a) => [a.asset, a.amount]), [["GBP", 600.696306], ["USDC", 263.6436], ["USDT", 527.6436]]);
  assertAlmostEquals(inv[1].gbp!, usdcValue, 1e-9);
  assertAlmostEquals(inv[2].gbp!, usdtValue, 1e-9);
  assertAlmostEquals(inv[1].costGbp!, usdcCost, 1e-9);
  assertEquals(inv.map((a) => [a.price, a.priceFrom]), [[null, null], [0.7575, "index"], [0.757, "index"]]);
  assertAlmostEquals((inv[1].gbp! + inv[2].gbp! + restingBuys) * x, row.valueUsd!, 1e-9);
  assertAlmostEquals(inv[1].unrealisedUsd! + inv[2].unrealisedUsd!, row.unrealisedUsd!, 1e-12);
  assertEquals([inv[0].unrealisedGbp, inv[0].costGbp], [null, null]);

  // ORDERS: the 24 newest less the six cancels that filled nothing, newest first; the one refusal says why.
  assertEquals(d.orders.map((o) => o.id), [119, 118, 117, 116, 115, 114, 113, 112, 111, 110, 109, 108, 107, 105, 104, 103, 102, 101]);
  assertEquals(d.orders.filter((o) => o.reason).map((o) => [o.id, o.reason]), [[114, "refused by the venue: post-only order would cross the book"]]);
  assertEquals(QUOTES_LIVE_ORDERS_FILTER, "or=(state.neq.cancelled,filled_base.gt.0)");

  // What the browser test serves the page is exactly this function's answer for these rows.
  assertEquals<unknown>({ ...row, detail: d }, f.live);
  assertEquals(quotesLiveDetail({ ...base, config: null, open: [], recent: [] }), null);
});

Deno.test("liveConversionShares: an ask's coins come out of the conversions first in, first out, each carrying its fee per coin", () => {
  const day = Date.UTC(2026, 9, 1), h = 3600e3;
  const o = (id: number, over: Partial<QuoteLiveOrderView>): QuoteLiveOrderView => ({
    id, ts: new Date(day + id * h).toISOString(), mode: "live", book: "USDC-GBP", rung_side: "ask", k: 0.001, leg: "entry", state: "filled",
    filled_base: 0, avg_fill_price: 0.76, price: 0.76, fee_gbp: 0, filled_at: new Date(day + id * h).toISOString(), ...over,
  });
  const orders = [
    o(1, { rung_side: null, k: null, leg: "convert", filled_base: 10, fee_gbp: 0.01 }),         // £0.001 a coin
    o(2, { rung_side: null, k: null, leg: "convert", filled_base: 20, fee_gbp: 0.04 }),         // £0.002 a coin
    o(3, { filled_base: 6 }),                                                                   // 6 of the first
    o(4, { k: 0.002, filled_base: 8 }),                                                         // the first's 4, then 4 of the second
    o(5, { rung_side: "bid", filled_base: 50 }),                                                // a bid buys first: none
    o(6, { leg: "exit", filled_base: 6 }),                                                      // an exit buys back: none
    o(7, { k: 0.003, filled_base: 100 }),                                                       // what is left: 16 of the second
    o(8, { book: "USDT-GBP", filled_base: 5 }),                                                 // another book's coins: no conversion of its own
    o(9, { mode: "dry_run", rung_side: null, k: null, leg: "convert", filled_base: 99, fee_gbp: 9 }),
  ];
  const s = liveConversionShares(orders);
  assertEquals([...s.keys()], [3, 4, 7]);
  assertAlmostEquals(s.get(3)!, 6 * 0.001, 1e-15);
  assertAlmostEquals(s.get(4)!, 4 * 0.001 + 4 * 0.002, 1e-15);
  assertAlmostEquals(s.get(7)!, 16 * 0.002, 1e-15);
  assertAlmostEquals([...s.values()].reduce((a, v) => a + v, 0), 0.05, 1e-15);              // every coin sold: the fees, whole
  // A conversion bought after an ask's fill gave that fill nothing.
  const late = liveConversionShares([o(3, { filled_base: 6 }), o(4, { rung_side: null, k: null, leg: "convert", filled_base: 10, fee_gbp: 0.01 })]);
  assertEquals(late.size, 0);
});

Deno.test("withConversionFees: a trip's conversion fee goes on the fill that brings its rung back to flat, never on one still open", () => {
  const day = Date.UTC(2026, 9, 1), h = 3600e3;
  const fill = (id: number, leg: RungFill["leg"], base: number, price: number, at: number): RungFill => ({ id, ts: day + at * h, leg, base, price, feeGbp: 0 });
  const shares = new Map([[1, 0.03], [2, 0.01], [5, 0.02]]);
  // An ask rung: sold 10 and 5 (shares 0.03 and 0.01), bought back 15 in two exits, then sold 7 (share 0.02) and holds.
  const out = withConversionFees("ask", [fill(5, "entry", 7, 0.77, 9), fill(1, "entry", 10, 0.76, 1), fill(2, "entry", 5, 0.761, 2),
    fill(3, "exit", 8, 0.759, 3), fill(4, "exit", 7, 0.758, 4)], shares, day);
  assertEquals(out.map((f) => [f.id, f.feeGbp]), [[1, 0], [2, 0], [3, 0], [4, 0.04], [5, 0]]);
  const trips = liveRungTrips({ book: "USDC-GBP", side: "ask", k: 0.001, fills: out }, day);
  assertEquals(trips.length, 1);
  assertAlmostEquals(trips[0].feesGbp, 0.04, 1e-15);
});

Deno.test("liveIndexPrices and liveRestingBuysGbp: a fresh index prices the coins; the open buys' unfilled pounds are at work", () => {
  const now = Date.UTC(2026, 9, 1, 19, 40);
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();
  assertEquals(liveIndexPrices([
    { book: "USDC-GBP", index_price: "0.7575", ts: at(60e3) },
    { book: "USDT-GBP", index_price: 0.757, ts: at(QUOTE_TICKER_FRESH_MS) },        // at the limit: still fresh
    { book: "BTC-GBP", index_price: 60000, ts: at(0) },                             // not a quotes book
  ], now), { "USDC-GBP": 0.7575, "USDT-GBP": 0.757 });
  assertEquals(liveIndexPrices([{ book: "USDT-GBP", index_price: 0.757, ts: at(QUOTE_TICKER_FRESH_MS + 1) }], now), {});   // stale: the last trade instead
  assertEquals(liveIndexPrices([{ book: "USDT-GBP", index_price: 0, ts: at(0) }], now), {});
  const o = (id: number, over: Partial<QuoteLiveOrderView>): QuoteLiveOrderView => ({
    id, ts: at(0), mode: "live", book: "USDC-GBP", rung_side: "bid", k: 0.001, leg: "entry", side: "buy", state: "new",
    base_size: 132, filled_base: 0, avg_fill_price: null, price: 0.75, fee_gbp: 0, filled_at: null, ...over,
  });
  assertAlmostEquals(liveRestingBuysGbp([
    o(1, {}),                                                                        // £99
    o(2, { state: "partially_filled", filled_base: 32 }),                             // 100 left: £75
    o(3, { state: "pending" }),                                                       // sent, unanswered: £99
    o(4, { side: "sell" }), o(5, { state: "filled", filled_base: 132 }), o(6, { mode: "dry_run" }),
  ]), 132 * 0.75 + 100 * 0.75 + 132 * 0.75, 1e-12);
});

Deno.test("liveCoinBooks: the account's coins against what they cost; the book's own count where its balances went unread", () => {
  const day = Date.UTC(2026, 9, 1), h = 3600e3;
  const o = (id: number, over: Partial<QuoteLiveOrderView>): QuoteLiveOrderView => ({
    id, ts: new Date(day + id * h).toISOString(), mode: "live", book: "USDT-GBP", rung_side: null, k: null, leg: "convert", state: "filled",
    filled_base: 0, avg_fill_price: 0.76, price: 0.76, fee_gbp: 0, filled_at: new Date(day + id * h).toISOString(), ...over,
  });
  const orders = [
    o(1, { filled_base: 100, avg_fill_price: 0.76, fee_gbp: 0.0684 }),                         // £76.0684 for 100
    o(2, { rung_side: "ask", k: 0.001, leg: "entry", filled_base: 10, avg_fill_price: 0.762 }),
  ];
  const paper = { state: { books: { "USDC-GBP": { lastX: 1.3, lastPrint: { ticks: 7600 } }, "USDT-GBP": { lastX: 1.3, lastPrint: { ticks: 7550 } } } }, last_minute: null, updated_at: "", last_error: null };
  // deno-lint-ignore no-explicit-any
  const rungs = liveRungs(orders, paper as any, day);
  // Read: 90 USDT in the account. Cost: £76.0684 paid, less the £7.62 the open short sold for.
  const read = liveCoinBooks(orders, rungs, { GBP: 31.55, USDT: 90, USDC: 0 });
  const usdt = read.find((c) => c.coin === "USDT")!;
  assertEquals([usdt.coins, usdt.mark], [90, 0.755]);
  assertAlmostEquals(usdt.costGbp, 76.0684 - 7.62, 1e-12);
  assertAlmostEquals(usdt.unrealisedGbp!, 90 * 0.755 - (76.0684 - 7.62), 1e-12);
  // = the short's mark 10 × (0.762 − 0.755) and the conversion's 100 × (0.755 − 0.760) less its whole fee (no trip has closed).
  assertAlmostEquals(usdt.unrealisedGbp!, 10 * 0.007 + 100 * -0.005 - 0.0684, 1e-12);
  assertEquals(read.find((c) => c.coin === "USDC")!.unrealisedGbp, 0);
  // Unread: the book's own count, 100 bought less 10 sold.
  assertEquals(liveCoinBooks(orders, rungs, null).find((c) => c.coin === "USDT")!.coins, 90);
  // With a fresh index price, the coins are valued at it, as Revolut X's account page values them.
  const atIndex = liveCoinBooks(orders, rungs, { USDT: 90 }, { "USDT-GBP": 0.756 }).find((c) => c.coin === "USDT")!;
  assertEquals([atIndex.mark, atIndex.markFrom], [0.756, "index"]);
  assertAlmostEquals(atIndex.unrealisedGbp!, 90 * 0.756 - (76.0684 - 7.62), 1e-12);
  assertEquals(usdt.markFrom, "last trade");
  // No print: valued at its cost, its unrealised unknown, and counted unmarked.
  const dark = { ...paper, state: { books: { ...paper.state.books, "USDT-GBP": { lastX: 1.3, lastPrint: null } } } };
  // deno-lint-ignore no-explicit-any
  const r2 = liveRungs(orders, dark as any, day);
  const c2 = liveCoinBooks(orders, r2, { USDT: 90 });
  const u2 = c2.find((c) => c.coin === "USDT")!;
  assertEquals([u2.unrealisedGbp, u2.valueGbp], [null, u2.costGbp]);
  assertEquals(liveBookGbp(r2, c2).unmarked, 2);                                              // the short and the coins
});

Deno.test("liveRungs: the LIVE row's totals are its rungs', walked once; a rung with no print holds an unknown, not a zero", () => {
  const f = liveFixture;
  // deno-lint-ignore no-explicit-any
  const rungs = liveRungs(liveReads(f).orders, f.paper as any, f.dayStartMs);
  const t = liveBookGbp(rungs, liveCoinBooks(liveReads(f).orders, rungs, f.state.state.balances));
  assertEquals(rungs.length, 12);
  assertAlmostEquals(t.realised, rungs.reduce((a, r) => a + r.rb.realisedGbp, 0), 1e-15);
  assertEquals([t.heldRungs, t.unmarked], [2, 0]);
  // Without a print on USDT-GBP, its holding is valued at its entry, marked at nothing, and counted unmarked.
  const dark = { ...f.paper, state: { books: { ...f.paper.state.books, "USDT-GBP": { ...f.paper.state.books["USDT-GBP"], lastPrint: null } } } };
  // deno-lint-ignore no-explicit-any
  const r2 = liveRungs(liveReads(f).orders, dark as any, f.dayStartMs);
  const t2 = liveBookGbp(r2, liveCoinBooks(liveReads(f).orders, r2, f.state.state.balances));
  // The holding rung and the book's coins: two unknowns.
  assertEquals([t2.unmarked, r2[6].mark, r2[6].marked, r2[6].valueGbp], [2, null, 0, 132 * 0.7565]);
});

Deno.test("liveRungTrips: a trip runs from flat to flat, exits averaged, partial exits included; an open one is no trip yet", () => {
  const day = Date.UTC(2026, 9, 1), h = 3600e3;
  const fill = (id: number, leg: RungFill["leg"], base: number, price: number, at: number, feeGbp = 0): RungFill => ({ id, ts: day + at * h, leg, base, price, feeGbp });
  // A bid rung: bought 100 at 0.7500 and 100 more at 0.7490 (average 0.7495), sold 150 at 0.7510 and 50 at 0.7520, then
  // bought 100 at 0.7480 and still holds it.
  const trips = liveRungTrips({ book: "USDC-GBP", side: "bid", k: 0.001, fills: [
    fill(5, "entry", 100, 0.748, 9),
    fill(2, "entry", 100, 0.749, 2), fill(1, "entry", 100, 0.75, 1),          // out of order: the walk sorts by time, then id
    fill(3, "exit", 150, 0.751, 3), fill(4, "exit", 50, 0.752, 4, 0.01),
  ] }, day);
  assertEquals(trips.length, 1);
  const t = trips[0];
  assertEquals([t.tEntry, t.tExit, t.qty, t.how], [new Date(day + h).toISOString(), new Date(day + 4 * h).toISOString(), 200, "exit"]);
  assertAlmostEquals(t.entry, 0.7495, 1e-12);
  assertAlmostEquals(t.exit, (150 * 0.751 + 50 * 0.752) / 200, 1e-12);
  // 150 × (0.7510 − 0.7495) + 50 × (0.7520 − 0.7495) − the 0.01 fee = 0.225 + 0.125 − 0.01.
  assertAlmostEquals(t.pnlGbp, 0.34, 1e-12);
  assertAlmostEquals(t.feesGbp, 0.01, 1e-12);
  // An ask rung closed by its stop, then an exit with nothing held before it (no trip of its own).
  const ask = liveRungTrips({ book: "USDT-GBP", side: "ask", k: 0.002, fills: [fill(1, "entry", 10, 0.76, 1), fill(2, "stop", 10, 0.761, 25, 0.0068), fill(3, "exit", 5, 0.76, 26)] }, day);
  assertEquals(ask.map((x) => x.how), ["stop"]);
  assertAlmostEquals(ask[0].pnlGbp, 10 * (0.76 - 0.761) - 0.0068, 1e-12);
});

Deno.test("liveOrderReason: each says why, in the executor's own words where it wrote them", () => {
  const now = Date.UTC(2026, 9, 1, 12);
  const o = (over: Partial<QuoteLiveRecentRow>): QuoteLiveRecentRow => ({
    id: 1, ts: new Date(now - 30e3).toISOString(), mode: "live", book: "USDC-GBP", rung_side: "bid", k: 0.001, leg: "entry", state: "new",
    filled_base: 0, avg_fill_price: null, price: 0.75, fee_gbp: 0, filled_at: null, side: "buy", base_size: 10, cancel_requested_at: null,
    cancel_reason: null, cancelled_at: null, request: { marketable: false }, response: null, ...over,
  });
  assertEquals(liveOrderReason(o({}), now), null);                                                     // resting as sent
  assertEquals(liveOrderReason(o({ state: "pending" }), now), "sent; the venue's answer is read next turn");
  assertEquals(liveOrderReason(o({ state: "pending", ts: new Date(now - 5 * 60e3).toISOString() }), now), "never heard back, and the venue does not list it: a person settles it");
  assertEquals(liveOrderReason(o({ cancel_requested_at: new Date(now).toISOString(), cancel_reason: "the paper engine re-priced this rung" }), now),
    "cancel sent (the paper engine re-priced this rung); not confirmed yet");
  assertEquals(liveOrderReason(o({ state: "cancelled", cancel_reason: "the rule re-prices the exit" }), now), "the rule re-prices the exit");
  assertEquals(liveOrderReason(o({ state: "cancelled", leg: "stop", request: { marketable: true } }), now), "nothing filled at its limit");
  assertEquals(liveOrderReason(o({ state: "cancelled" }), now), "cancelled by the venue");
  assertEquals(liveOrderReason(o({ state: "rejected", response: { status: 429, error: "Too Many Requests" } }), now), "turned away by the venue's rate limit; sent again next turn");
  assertEquals(liveOrderReason(o({ state: "rejected", response: { status: 400 } }), now), "refused by the venue");
  assertEquals(liveOrderReason(o({ state: "filled", filled_base: 4, cancelled_at: new Date(now).toISOString() }), now), "filled in part; the rest was cancelled");
  assertEquals(liveOrderReason(o({ state: "filled", filled_base: 10, filled_at: new Date(now).toISOString() }), now), null);
});

Deno.test("serveRequest — a cron call writes its beat under its own key before its action runs; an app token's writes none (0075)", async () => {
  const order: string[] = [];
  const deps = (who: Who, beat: ServeDeps["beat"] = (key) => { order.push(`beat ${key}`); return Promise.resolve(true); }): ServeDeps => ({
    authorise: () => Promise.resolve(who),
    beat,
    route: (_req, _who, _url, action) => { order.push(`route ${action}`); return Promise.resolve(new Response("{}", { status: 200 })); },
    report: () => Promise.resolve(),
  });
  const edge = "https://flmvxigozjuizpckllvk.supabase.co/functions/v1/";
  const post = (p: string) => new Request(edge + p, { method: "POST", headers: { Authorization: "Bearer s" } });
  assertEquals((await serveRequest(post("agents?action=tick"), deps("cron"))).status, 200);
  assertEquals(order, ["beat agents?action=tick", "route tick"]);
  // The order path's call carries its region in its path; its beat is keyed by the action alone, as the watchdog's lookup is.
  order.length = 0;
  await serveRequest(post("agents?action=pmlive&forceFunctionRegion=eu-west-1"), deps("cron"));
  assertEquals(order, ["beat agents?action=pmlive", "route pmlive"]);
  // The page's reads and an operator's calls are not the job's: no beat.
  order.length = 0;
  await serveRequest(new Request(edge + "agents?action=dashboard"), deps("ro"));
  await serveRequest(post("agents?action=tick"), deps("admin"));
  assertEquals(order, ["route dashboard", "route tick"]);
  // Unauthorised: nothing at all. OPTIONS: nothing at all.
  order.length = 0;
  assertEquals((await serveRequest(post("agents?action=tick"), deps(null))).status, 401);
  assertEquals((await serveRequest(new Request(edge + "agents", { method: "OPTIONS" }), deps("cron"))).status, 200);
  assertEquals(order, []);
  // A beat that cannot be written stops nothing.
  const failed = await serveRequest(post("agents?action=quotes"), deps("cron", () => Promise.reject(new Error("db down"))));
  assertEquals([failed.status, order], [200, ["route quotes"]]);
});

Deno.test("serveRequest — an action that throws is an agents.crash row naming it, and a 500, as before the beat was added", async () => {
  const reports: { kind: string; context?: unknown }[] = [];
  const r = await serveRequest(new Request("https://h/functions/v1/agents?action=tick", { method: "POST" }), {
    authorise: () => Promise.resolve("cron"),
    beat: () => Promise.resolve(true),
    route: () => Promise.reject(new Error("Signal timed out.")),
    report: (kind, o) => { reports.push({ kind, context: o.context }); return Promise.resolve(); },
  });
  assertEquals(r.status, 500);
  assertEquals(reports.map((x) => [x.kind, (x.context as { action: string }).action]), [["agents.crash", "tick"]]);
});
