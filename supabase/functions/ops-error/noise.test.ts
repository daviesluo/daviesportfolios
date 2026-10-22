// Pins the errors box's noise policy (noise.ts; Davies, 2026-10-20): what is always shown, what is noise, when noise
// persists into one line, and that identical messages are one line with a count. The cases are the shapes of the
// 2026-10-20 rows (878 in 24 h, 11 lines under this policy), with made-up ids and amounts.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { boxLines, cadenceMinutes, classify, normalizeMessage, type OpsRow, PERSIST_MINUTES, PERSIST_RUNS, persistentEpisodes } from "./noise.ts";

const T0 = Date.parse("2026-10-20T08:00:00Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const row = (kind: string, message: string, min: number, symbol: string | null = null): OpsRow => ({ kind, symbol, message, created_at: at(min) });
const HTML502 = ' → 502 \n<html><head>\n<title>502 Server Error</title>\n</head>\n<body><h1>Error: Server Error</h1>';

Deno.test("classify: always shown — monitor, code, auth and config, a live path's state, an unknown message", () => {
  const shown = (kind: string, message: string) => { const c = classify({ kind, message }); assertEquals(c.noise, false, `${kind}: ${message}`); return c.cls; };
  assertEquals(shown("monitor.alert", "Supabase's minute loop failing since 09:16 UTC"), "monitor");
  assertEquals(shown("monitor.recovered", "recovered at 11:36 UTC"), "monitor");
  assertEquals(shown("agents.cb_rec", 'db POST cb_quote_inputs → 500: {"code":"21000","message":"ON CONFLICT DO UPDATE command cannot affect row a second time"}'), "code");
  assertEquals(shown("render.crash", "TypeError: x.map is not a function"), "code");
  assertEquals(shown("agents.tick", "trend-4h: no code for its rule"), "code");
  assertEquals(shown("agents.quotes_live", "cancel could not be read back (403 This action is forbidden); the rung is FROZEN until it is"), "auth");
  assertEquals(shown("agents.tick", "kraken balance → 401 EAPI:Invalid key"), "auth");
  assertEquals(shown("t212.sync", "api-key-invalid"), "auth");
  // A live path that says what it did about an upstream failure: its state, not a transient.
  assertEquals(shown("agents.quotes_live", "order abc unreadable (500 Something went wrong!); left as it is"), "other");
  assertEquals(shown("agents.quotes_live", "cancel sent again (503 CIRCUIT_BREAKER_OPEN_ERROR), and the venue still shows it new; the rung is FROZEN"), "other");
  assertEquals(shown("grokpm.exec", "order refused: Signal timed out; it stays pending"), "other");
  assertEquals(shown("agents.quotes_live", "pending buy 0.1 USDT/GBP is neither among the venue's active orders nor in its history 548 min on"), "other");
  assertEquals(shown("agents.pm_lp", "no slot has quoted since 2026-10-20T06:50:00.856Z"), "other");
  // The IG recorder reports only when coverage is at risk, and says so: shown, its token words notwithstanding.
  assertEquals(shown("ig.quotes", "coverage at risk: 2 failed runs in a row: sb: 401 error.security.account-token-invalid"), "other");
});

Deno.test("classify: noise — transient upstream errors, IG's token churn, and a recorder's failed run", () => {
  const noise = (kind: string, message: string) => { const c = classify({ kind, message }); assertEquals(c.noise, true, `${kind}: ${message}`); return c.cls; };
  assertEquals(noise("agents.tick", "revx: quotes Signal timed out."), "transient");
  assertEquals(noise("agents.tick", "revx: quotes revx tickers" + HTML502), "transient");
  assertEquals(noise("agents.pm_lp_reserve", "db GET pm_lp_markets → 502: <html><head><title>502 Bad Gateway</title></head></html>"), "transient");
  assertEquals(noise("agents.cb_rec", "USDT-EUR prints: Signal timed out."), "transient");
  assertEquals(noise("agents.pm_lp", "books → 429 Too Many Requests"), "transient");
  assertEquals(noise("agents.grokpm_rec", "rpc → 504 Gateway Time-out"), "transient");
  // A live path's PURE transient (it read nothing, did nothing) is noise like any other.
  assertEquals(noise("agents.quotes_live", "pair config unreadable (pairs" + HTML502), "transient");
  // IG's known token churn, from before the recorder reported only on risk.
  assertEquals(noise("ig.quotes", "sb: 401 error.security.account-token-invalid; cfd: 401 error.security.account-token-invalid"), "recorder");
  assertEquals(noise("agents.pm_rec", "frame write failed: no rows"), "recorder");
});

Deno.test("dedupe: the same message, ids, numbers and times aside, is one line with its count and newest time", () => {
  const msg = (n: number, id: string) => `USDT-GBP|ask|0.001: pending buy 0.1${n} USDT/GBP (${id}) is neither among the venue's active orders nor in its history ${n} min on`;
  const rows = [0, 1, 2, 3].map((i) => row("agents.quotes_live", msg(540 + i, i % 2 ? "80bed3cd-0024-40a1-b57f-b45b132cdc5f" : "0f217a7e-badf-452b-bbfd-60293a9b60ac"), i));
  rows.push(row("agents.quotes_live", "something else entirely", 5));
  const b = boxLines(rows, Date.parse(at(6)));
  assertEquals(b.lines.map((l) => [l.count, l.latestAt, l.firstAt]), [[1, at(5), at(5)], [4, at(3), at(0)]]);
  assert(b.lines[1].message.includes("543 min on"), "the line shows its newest message");
  assertEquals([b.shownRows, b.hiddenRows], [5, 0]);
  assertEquals(normalizeMessage("order 08b4d98c-1764-e2ac-0040-3eea5f0712b7 at 2026-10-20T08:37:26.856+00:00 cost 0.14709 (0xabcdef12)"), "order <id> at <time> cost # (<hex>)");
  assertEquals(normalizeMessage("revx tickers" + HTML502), "revx tickers → # [# Server Error]");
});

Deno.test("persistence: a minute job's noise shows only after 15 consecutive failed minutes, as ONE line", () => {
  // 14 consecutive minutes: hidden. A 15th: one line, still failing.
  const run = (n: number, from = 0) => Array.from({ length: n }, (_, i) => row("agents.tick", "revx: quotes revx tickers" + HTML502, from + i));
  assertEquals(PERSIST_MINUTES, 15);
  let b = boxLines(run(14), Date.parse(at(14)));
  assertEquals([b.lines.length, b.hiddenRows], [0, 14]);
  b = boxLines(run(15), Date.parse(at(15)));
  assertEquals(b.lines.length, 1);
  assertEquals(b.lines[0].message, "upstream errors failing since 08:00 UTC, 15 times; latest: revx: quotes revx tickers → 502 [502 Server Error]");
  assertEquals([b.lines[0].count, b.lines[0].persistent, b.shownRows, b.hiddenRows], [15, { ongoing: true }, 15, 0]);
  // It stopped an hour ago: one line, "failed … – …".
  b = boxLines(run(20), Date.parse(at(80)));
  assertEquals(b.lines[0].message.slice(0, 50), "upstream errors failed 08:00–08:19 UTC, 20 times; ");
  assertEquals(b.lines[0].persistent, { ongoing: false });
  // A clean minute between failures breaks the run: 10 + 10 failures with a success between is not 15 in a row.
  const broken = [...run(10), ...run(10, 12)];
  assertEquals(boxLines(broken, Date.parse(at(22))).lines.length, 0);
  // One run in four failing (IG on 2026-10-19: every failure followed by a clean run): never a line.
  const quarter = Array.from({ length: 60 }, (_, i) => row("ig.quotes", "sb: 401 error.security.account-token-invalid", i * 4));
  const q = boxLines(quarter, Date.parse(at(240)));
  assertEquals([q.lines.length, q.hiddenRows], [0, 60]);
});

Deno.test("persistence: a slower job's noise shows after 3 consecutive failed runs of its cadence", () => {
  assertEquals([cadenceMinutes("agents.grokpm_rec"), cadenceMinutes("snapshot-record"), cadenceMinutes("t212.orders"), cadenceMinutes("agents.tick")], [5, 5, 10, 1]);
  const five = (n: number) => Array.from({ length: n }, (_, i) => row("agents.grokpm_rec", "activity: Signal timed out.", i * 5));
  assertEquals(PERSIST_RUNS, 3);
  assertEquals(boxLines(five(2), Date.parse(at(10))).lines.length, 0);
  assertEquals(boxLines(five(3), Date.parse(at(10))).lines.map((l) => l.count), [3]);
  assertEquals(persistentEpisodes(five(3), Date.parse(at(10)))[0].ongoing, true);
  assertEquals(persistentEpisodes(five(3), Date.parse(at(60)))[0].ongoing, false);
});

Deno.test("a single failed recorder run, or a lone transient, is hidden; the lines are newest first", () => {
  const rows = [
    row("agents.pm_rec", "db GET pm_rec_markets → 502: <html><head><title>502 Bad Gateway</title></head></html>", 1),
    row("agents.cb_rec", "USDT-EUR prints: Signal timed out.", 2),
    row("monitor.alert", "loop failing", 3, "loop"),
    row("agents.cb_rec", 'db POST cb_quote_inputs → 500: {"code":"21000"}', 4),
  ];
  const b = boxLines(rows, Date.parse(at(5)));
  assertEquals(b.lines.map((l) => [l.kind, l.cls]), [["agents.cb_rec", "code"], ["monitor.alert", "monitor"]]);
  assertEquals([b.shownRows, b.hiddenRows], [2, 2]);
  assertEquals(boxLines([], T0), { lines: [], shownRows: 0, hiddenRows: 0 });
});

// Audit 2026-10-20: the exact lines the live writers emit (quotes_live.ts placement and parking, liveAlerts' "[still, …]",
// the dead-man and loss-stop lines, monitor/deadman.ts, grokpm/index.ts), where the tests above use paraphrases: without
// these, a LIVE_STATE that drops "pending" hides "placement … has no reply …; left pending" and nothing notices.
const CID = "80bed3cd-0024-40a1-b57f-b45b132cdc5f";

Deno.test("classify: every live-order line PR5's executor writes is shown at once, in the words it writes them", () => {
  const live = [
    `USDT-GBP|bid|0.001: the venue answered 500 Something went wrong: outcome unknown; ${CID} stays pending for the next turn to reconcile`,
    `USDT-GBP|bid|0.001: the venue answered 502 Bad Gateway: outcome unknown; ${CID} stays pending for the next turn to reconcile`,
    `USDT-GBP|bid|0.001: the venue answered 503 CIRCUIT_BREAKER_OPEN_ERROR: outcome unknown; ${CID} stays pending for the next turn to reconcile`,
    `USDT-GBP|bid|0.001: placement of ${CID} has no reply (Signal timed out.); left pending for the next turn to reconcile by client id`,
    `USDT-GBP|ask|0.001: pending buy 0.14709 USDT/GBP (${CID}) is neither among the venue's active orders nor in its history 61 min on — outcome unknown; it stays pending for a person to settle, and the rung places nothing [still, since 2026-10-20T06:04:00.000Z, 61 turns]`,
    `USDT-GBP|bid|0.001: active orders unreadable (503 CIRCUIT_BREAKER_OPEN_ERROR); ${CID} stays pending`,
    "DEAD-MAN SWITCH NOT RUNNING: the dead-man switch has not run since 2026-10-20 05:50 UTC: no entries until it does; exits and the 24-hour stops stay armed. Check the monitor Worker (workers/monitor).",
    "LOSS STOP: today's P&L -0.51 GBP is past −0.5; no live entries until the next UTC day; exits and stops stay armed",
  ];
  for (const m of live) assertEquals(classify({ kind: "agents.quotes_live", message: m }).noise, false, m);
  assertEquals(classify({ kind: "monitor.deadman", message: "held: revx balances → 503 Service Unavailable" }).noise, false);
  assertEquals(classify({ kind: "grokpm.total_stop", message: "GROKPM's total stop was reached at 2026-10-20T10:00:00Z (book 80.00): close-only to the end, and the test ends as a FAIL" }).noise, false);
  // One such row, alone in the window, is a line of its own.
  assertEquals(boxLines([row("agents.quotes_live", live[3], 0)], T0 + 60_000).lines.length, 1);
});

// 7ed60689 hid or folded four live faults. Each test is one of them, and each fails on that code: classify() called the
// timeout a transient, and the counted-line rule then folded whatever was left. A neighbour that is still noise stays noise.

const CID2 = "0f217a7e-badf-452b-bbfd-60293a9b60ac";

Deno.test("trend-4h-live: an order whose outcome is unknown is its own line, even when the venue said 500", () => {
  const unknown = (id: string, status: string) =>
    `trend-4h-live|BTC/USD: revx answered ${status} — outcome unknown; ${id} stays pending for the next turn to reconcile`;
  const lost = (id: string) =>
    `trend-4h-live|BTC/USD: placement of ${id} has no reply (Signal timed out.); left pending for the next turn to reconcile`;
  assertEquals(classify({ kind: "agents.tick", message: unknown(CID, "500 Something went wrong") }).noise, false);
  assertEquals(classify({ kind: "agents.tick", message: lost(CID) }).noise, false);
  // Two orders, same words once the ids are gone: not one line with a count.
  const rows = [row("agents.tick", unknown(CID, "500 Something went wrong"), 0), row("agents.tick", unknown(CID2, "502 Bad Gateway"), 1)];
  const b = boxLines(rows, Date.parse(at(2)));
  assertEquals(b.lines.length, 2);
  assertEquals(b.lines.every((l) => l.count === 1), true);
  assertEquals([b.shownRows, b.hiddenRows], [2, 0]);
  // A known rejection still folds, and a tick timeout that is not this order is still noise.
  const rejected = (n: number) => `trend-4h-live|BTC/USD: revx rejected → 400 no fill, attempt ${n}`;
  assertEquals(boxLines([row("agents.tick", rejected(1), 0), row("agents.tick", rejected(2), 1)], Date.parse(at(2))).lines.map((l) => l.count), [2]);
  assertEquals(classify({ kind: "agents.tick", message: "revx: quotes Signal timed out." }).noise, true);
});

Deno.test("hourly guard: a fault reported once an hour is shown, and the next hour is not folded into it", () => {
  const beat = "the dead-man switch's beat is unreadable (Signal timed out.): entries go on this turn";
  const risk = "agent_risk unreadable (pairs" + HTML502 + "): no entries this turn, exits still run";
  const balances = "balances unreadable (Signal timed out.): no entries this turn; exits are not capped by the account";
  const lease = "LEASE CLAIM FAILED — agent_locks: Signal timed out.; nothing done this minute";
  const loss = "loss stop unreadable (Signal timed out.): no live entries this turn";
  for (const m of [beat, risk, balances, lease, loss]) assertEquals(classify({ kind: "agents.quotes_live", message: m }).noise, false, m);
  // One row an hour never makes 15 consecutive minutes, so the old rule hid it. Two hours are two lines.
  const hours = [row("agents.quotes_live", beat, 0), row("agents.quotes_live", beat, 60)];
  const b = boxLines(hours, Date.parse(at(61)));
  assertEquals(b.lines.length, 2);
  assertEquals([b.shownRows, b.hiddenRows], [2, 0]);
  // The hourly repeat of a guard that is already shown, differing by the clock and the turn count, stays two lines.
  const stop = (t: string, n: number) =>
    `LOSS STOP: today's P&L -0.51 GBP is past −0.5; no live entries until the next UTC day; exits and stops stay armed [still, since ${t}, ${n} turns]`;
  const repeats = boxLines([
    row("agents.quotes_live", stop("2026-10-20T08:00:00.000Z", 2), 0),
    row("agents.quotes_live", stop("2026-10-20T09:00:00.000Z", 3), 60),
  ], Date.parse(at(61)));
  assertEquals(repeats.lines.map((l) => l.count), [1, 1]);
  // A pure upstream error on the same path, with no guard in it, is still noise.
  assertEquals(classify({ kind: "agents.quotes_live", message: "pair config unreadable (pairs" + HTML502 }).noise, true);
});

Deno.test("grokpm.redeem: a failed redemption is shown at once, and the next hour is its own line", () => {
  const unread = "redeemable positions unread: Signal timed out.";
  const stalled = (hex: string) => `redemption ${hex} not final after two hours`;
  assertEquals(classify({ kind: "grokpm.redeem", message: unread }).noise, false);
  assertEquals(classify({ kind: "grokpm.redeem", message: "TypeError: x.map is not a function" }).cls, "code");
  const b = boxLines([
    row("grokpm.redeem", unread, 0),
    row("grokpm.redeem", unread, 60),
    row("grokpm.redeem", stalled("0xabcdef12"), 120),
    row("grokpm.redeem", stalled("0x1234abcd"), 180),
  ], Date.parse(at(181)));
  assertEquals(b.lines.length, 4);
  assertEquals(b.lines.every((l) => l.count === 1), true);
  assertEquals(b.hiddenRows, 0);
});

Deno.test("weekend replica: an intermittent fault is shown, and the same words an hour apart are not one count", () => {
  // Every other minute, so it never lasts 15 in a row. Each row is a line.
  const rows = [0, 2, 4, 6].map((m) => row("agents.quotes_weekend", "Signal timed out.", m));
  rows.push(row("agents.quotes_weekend", "fetch failed", 8));
  const b = boxLines(rows, Date.parse(at(9)));
  assertEquals(b.lines.length, 5);
  assertEquals(b.lines.every((l) => l.count === 1), true);
  assertEquals([b.shownRows, b.hiddenRows], [5, 0]);
  assertEquals(classify({ kind: "agents.quotes_weekend", message: "Signal timed out." }).noise, false);
  // A recorder's single failed run is still hidden.
  assertEquals(boxLines([row("agents.pm_rec", "Signal timed out.", 0)], Date.parse(at(1))).lines.length, 0);
});
