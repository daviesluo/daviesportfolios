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
