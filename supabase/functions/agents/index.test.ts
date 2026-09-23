// Pin tests for the agents function's own helpers in `index.ts`: the
// probe's symbol list, the env reader, the not-ready detector, the chart
// window, the Jev statistics and the cron-bearer half of `authorise`.
// `Deno.serve` sits behind `import.meta.main`, so importing binds nothing.
import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  authorise, chartBook, PAGE_VENUES, chartWindow, dayOpensFrom, envAny, isNotReady, jevStats, JEV_BATCH_MAX_CALLS, latestObservationQuery, mapPool, parseState, probeParts, probeSymbols, runJevBatch,
  STATE_VOCAB, strategyBooks, SYMBOLS, probeSummary, quotesDelayMs, quotesSummary, QUOTES_CAPITAL_USD, tickErrorReport, crashReport, type ProbeSummaryRow,
} from "./index.ts";
import type { OrderRow } from "./tick.ts";
import type { JevResult } from "../_shared/jev.ts";
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
    { book: "USDT-GBP", t_exit: new Date(dayStart + 3600e3).toISOString(), pnl_usd: 0.12, notional_usd: 60 },
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
  const stale = quotesSummary({ ...st, last_minute: new Date(now - 10 * 60e3).toISOString() }, [], [], null, now, dayStart)!;
  assertEquals(stale.running, false);                                  // ten minutes behind: it has stopped
  assertEquals(quotesSummary(null, [], [], null, now, dayStart), null);  // not built yet: off the page
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
