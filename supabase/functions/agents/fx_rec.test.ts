// The second-level FX recorder (fx_rec.ts, 0172): TrueFX's and Kraken's answers as they served them (2026-10-29 07:22 UTC),
// parsed to bid and ask, the read cadence by the market and the primary's health, the fallback taking over after three
// failed reads or a stale timestamp, the rows a minute keeps, and a fault reported when it lasts, not for one read.
// Nothing but GETs to the two public hosts, with no credential.

import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  FX_FAIL_READS, FX_LAST_READ_MS, FX_STALE_MS, fxDue, fxMarketOpen, fxRow, keepRead, KRAKEN_URL, micros, newBuf,
  nextHealth, parseKraken, parseTrueFx, runFxRec, TRUEFX_URL, type FxHealth, type FxRecReport, type FxRecState,
} from "./fx_rec.ts";
import { memDb, type Row } from "./testing.ts";
import { startFxRecAction } from "./index.ts";

import served from "../../../docs/agents/backtests/fx_second/fixtures/answers_2026-10-29.json" with { type: "json" };

const TRUEFX = served.truefx, KRAKEN = served.kraken;

Deno.test("the fixture is the two answers as served, from the two URLs the recorder reads", () => {
  assertEquals([served.truefx_url, served.kraken_url], [TRUEFX_URL, KRAKEN_URL]);
});

Deno.test("parseTrueFx reads the two pairs' lines as served: big figure and points joined, the line's own millisecond time", () => {
  const q = parseTrueFx(TRUEFX);
  assertEquals(q, [
    { pair: "EURUSD", srcMs: 1793258531512, bid: 1.11355, ask: 1.11360 },
    { pair: "GBPUSD", srcMs: 1793258534052, bid: 1.33135, ask: 1.33143 },
  ]);
  // A pair's unreadable line is left out and the other kept; neither readable is an error, as is an HTML refusal.
  const bad = TRUEFX.replace("GBP/USD,1793258534052,1.33,135,1.33,143", "GBP/USD,1793258534052,1.33,135,1.32,143");
  assertEquals(parseTrueFx(bad).map((x) => x.pair), ["EURUSD"]);
  assertThrows(() => parseTrueFx(bad.replace("EUR/USD,1793258531512", "EUR/USD,x")), Error, "no readable");
  assertThrows(() => parseTrueFx("<html>busy</html>"), Error, "no readable");
  // A JPY line's big figure "157." joins the same way and is ignored: only the two dollar pairs are kept.
  assert(!parseTrueFx(TRUEFX).some((x) => String(x.pair).includes("JPY")));
});

Deno.test("parseKraken reads both books' best bid and ask, with no timestamp of the source's own, and refuses an error", () => {
  const q = parseKraken(KRAKEN);
  const want = JSON.parse(KRAKEN).result;
  assertEquals(q.find((x) => x.pair === "GBPUSD"), { pair: "GBPUSD", srcMs: null, bid: Number(want.ZGBPZUSD.b[0]), ask: Number(want.ZGBPZUSD.a[0]) });
  assertEquals(q.find((x) => x.pair === "EURUSD"), { pair: "EURUSD", srcMs: null, bid: 1.11347, ask: 1.11349 });
  assertThrows(() => parseKraken('{"error":["EGeneral:Too many requests"]}'), Error, "Too many requests");
  assertThrows(() => parseKraken('{"error":[],"result":{}}'), Error, "no readable");
  assertThrows(() => parseKraken("<html>"), Error, "unreadable JSON");
});

Deno.test("the market may be open but for Friday 22:00 to Sunday 21:00 UTC and surely is but for Friday 21:00 to Sunday 22:00; the reads slow when closed; the fallback reads faster when needed", () => {
  const at = (s: string) => fxMarketOpen(Date.parse(s));
  assertEquals(
    [at("2026-10-30T21:59:59Z"), at("2026-10-30T22:00:00Z"), at("2026-10-31T12:00:00Z"), at("2026-11-01T20:59:59Z"), at("2026-11-01T21:00:00Z"), at("2026-10-29T03:00:00Z")],
    [true, false, false, false, true, true],
  );
  // Surely open (the staleness check and the faults): not from Friday 21:00, nor before Sunday 22:00 (summer and winter).
  const surely = (x: string) => fxMarketOpen(Date.parse(x), true);
  assertEquals(
    [surely("2026-10-30T20:59:59Z"), surely("2026-10-30T21:00:00Z"), surely("2026-11-01T21:59:59Z"), surely("2026-11-01T22:00:00Z")],
    [true, false, false, true],
  );
  // Open and healthy: TrueFX every second, Kraken every fifth. Unhealthy: Kraken every second second. Closed: 10 s / 30 s.
  assertEquals([0, 1, 2, 5].map((s) => fxDue(s, true, true)), [["truefx", "kraken"], ["truefx"], ["truefx"], ["truefx", "kraken"]]);
  assertEquals([1, 2, 3].map((s) => fxDue(s, true, false)), [["truefx"], ["truefx", "kraken"], ["truefx"]]);
  assertEquals([1, 10, 30].map((s) => fxDue(s, false, true)), [[], ["truefx"], ["truefx", "kraken"]]);
  const n = (open: boolean, healthy: boolean) => Array.from({ length: 59 }, (_, s) => fxDue(s, open, healthy)).flat().length;
  assertEquals([n(true, true), n(true, false), n(false, true)], [59 + 12, 59 + 30, 6 + 2]);
});

Deno.test("the primary is unhealthy after three failed reads in a row or a stale timestamp with the market open, healthy at its first good read", () => {
  const t = Date.parse("2026-10-29T08:00:00Z");
  const good = (age: number) => ({ ok: true as const, quotes: [{ pair: "GBPUSD" as const, srcMs: t - age, bid: 1, ask: 1 }, { pair: "EURUSD" as const, srcMs: t - 1, bid: 1, ask: 1 }] });
  let h: FxHealth = { failsInRow: 0, badSince: null };
  for (let i = 1; i < FX_FAIL_READS; i++) {
    h = nextHealth(h, t + i, { ok: false }, true);
    assertEquals(h, { failsInRow: i, badSince: null });
  }
  h = nextHealth(h, t + 3, { ok: false }, true);
  assertEquals(h, { failsInRow: 3, badSince: t + 3 });
  // Still failing: unhealthy since the first instant it was.
  assertEquals(nextHealth(h, t + 9, { ok: false }, true).badSince, t + 3);
  assertEquals(nextHealth(h, t, good(0), true), { failsInRow: 0, badSince: null });
  // Stale: GBP/USD's own time more than FX_STALE_MS behind, with the market open. Closed, staleness is the market's.
  assertEquals(nextHealth({ failsInRow: 0, badSince: null }, t, good(FX_STALE_MS), true).badSince, null);
  assertEquals(nextHealth({ failsInRow: 0, badSince: null }, t, good(FX_STALE_MS + 1), true).badSince, t);
  assertEquals(nextHealth({ failsInRow: 0, badSince: null }, t, good(FX_STALE_MS + 1), false).badSince, null);
  // A pair missing from a good read is unhealthy too.
  assertEquals(nextHealth({ failsInRow: 0, badSince: null }, t, { ok: true, quotes: good(0).quotes.slice(0, 1) }, true).badSince, t);
});

Deno.test("a minute's row keeps the first read and each that brought something new, in ms after the minute and millionths", () => {
  const m = Date.parse("2026-10-29T07:22:00Z");
  const b = newBuf();
  const q = { pair: "GBPUSD" as const, srcMs: m + 14_052, bid: 1.33135, ask: 1.33143 };
  assertEquals(keepRead(b, undefined, q, m + 14_300, m, false), true);
  assertEquals(keepRead(b, q, { ...q }, m + 15_300, m, false), false);
  assertEquals(keepRead(b, q, { ...q, srcMs: m + 15_100 }, m + 16_300, m, false), true);
  assertEquals(keepRead(b, q, { ...q, bid: 1.33136 }, m + 17_300, m, true), true);
  const row = fxRow("truefx", "GBPUSD", m, b);
  assertEquals(row, {
    source: "truefx", pair: "GBPUSD", minute: "2026-10-29T07:22:00.000Z",
    recv_ms: [14_300, 16_300, 17_300], src_ms: [14_052, 15_100, 14_052], bid: [1_331_350, 1_331_350, 1_331_360], ask: [1_331_430, 1_331_430, 1_331_430],
    mid: [1_331_390, 1_331_390, 1_331_395], fallback: [false, false, true], reads: 0, failed: 0, last_error: null,
  });
  assertEquals(micros(1.11349), 1_113_490);
  // A source with no time of its own stores no src_ms at all.
  const k = newBuf();
  keepRead(k, undefined, { pair: "EURUSD", srcMs: null, bid: 1.11347, ask: 1.11349 }, m + 100, m, false);
  assertEquals(fxRow("kraken", "EURUSD", m, k).src_ms, null);
});

type Served = { status: number; body: string } | "throw";
function world(serve: (url: string, n: number, at: number) => Served) {
  let t = 0;
  const calls: { url: string; method: string; headers: Record<string, string>; at: number }[] = [];
  const n: Record<string, number> = {};
  const fetchImpl = ((url: string, init?: RequestInit) => {
    n[url] = (n[url] ?? 0) + 1;
    calls.push({ url, method: init?.method ?? "GET", headers: Object.fromEntries(new Headers(init?.headers).entries()), at: t });
    const a = serve(url, n[url], t);
    t += 150; // each answer arrives 150 ms after it was asked (reads in a second run one after another here)
    if (a === "throw") return Promise.reject(new Error("connection reset"));
    return Promise.resolve(new Response(a.body, { status: a.status }));
  }) as typeof fetch;
  return { calls, fetchImpl, clock: () => t, pause: (ms: number) => { t += ms; return Promise.resolve(); }, reset: () => { t = 0; calls.length = 0; } };
}
/** TrueFX's fixture with both pairs' times moved to `at` and GBP/USD's bid moved by `k` points. */
const truefxAt = (at: number, k = 0) =>
  TRUEFX.replace(/^(EUR\/USD|GBP\/USD),\d+/gm, (_, p) => `${p},${at}`).replace("GBP/USD," + at + ",1.33,135", `GBP/USD,${at},1.33,${135 + k}`);

Deno.test("runFxRec: a healthy open minute reads TrueFX every second and Kraken every fifth, GETs only, and keeps four rows", async () => {
  const m = Date.parse("2026-10-29T08:00:00Z");
  const { db, tables } = memDb({ fx_rec_state: [{ id: 1, state: {} } as Row], fx_ticks: [] }, { now: () => m });
  // TrueFX's quote moves at two reads in three, and its time at every read; Kraken's never.
  const w = world((url, i, at) => url === TRUEFX_URL ? { status: 200, body: truefxAt(m + at - 300, i % 3) } : { status: 200, body: KRAKEN });
  const r = await runFxRec({ db, now: m + 400, clock: w.clock, fetchImpl: w.fetchImpl, pause: w.pause });
  assertEquals([r.reads, r.failed, r.fallbackReads, r.primaryHealthy, r.errors, r.report], [{ truefx: 59, kraken: 12 }, { truefx: 0, kraken: 0 }, 0, true, [], false]);
  // The first read at once (the call came 400 ms in), then at each whole second to 58 s.
  const tf = w.calls.filter((c) => c.url === TRUEFX_URL);
  assertEquals([tf.length, tf[0].at, tf[1].at + 400, w.calls.every((c) => c.method === "GET" && Object.keys(c.headers).join() === "user-agent")], [59, 0, 1000, true]);
  assert(w.calls.every((c) => c.url === TRUEFX_URL || c.url === KRAKEN_URL));
  assert(Math.max(...w.calls.map((c) => c.at)) + m + 400 <= m + FX_LAST_READ_MS + 400);
  const rows = tables.fx_ticks;
  assertEquals(rows.map((x) => `${x.source} ${x.pair}`).sort(), ["kraken EURUSD", "kraken GBPUSD", "truefx EURUSD", "truefx GBPUSD"]);
  const g = rows.find((x) => x.source === "truefx" && x.pair === "GBPUSD")!;
  // Every TrueFX read carries a new time of its own, so each is kept; Kraken's one quote is kept once a minute.
  assertEquals([(g.recv_ms as number[]).length, g.reads, g.failed, (g.fallback as boolean[]).some(Boolean)], [59, 59, 0, false]);
  // Each read's own time is before it arrived and moves on with every read.
  const src = g.src_ms as number[];
  assert((g.recv_ms as number[]).every((x, i) => x > src[i]) && src.every((x, i) => i === 0 || x > src[i - 1]));
  const k = rows.find((x) => x.source === "kraken" && x.pair === "GBPUSD")!;
  assertEquals([(k.recv_ms as number[]).length, k.reads, k.src_ms], [1, 12, null]);
  const st = tables.fx_rec_state[0];
  assertEquals([(st.state as FxRecState).health, st.last_error], [{ failsInRow: 0, badSince: null }, null]);
});

Deno.test("runFxRec: TrueFX down — Kraken every second second after three failures, marked; a fault only once it has lasted five minutes, then hourly", async () => {
  const m = Date.parse("2026-10-29T08:00:00Z");
  const { db, tables } = memDb({ fx_rec_state: [{ id: 1, state: {} } as Row], fx_ticks: [] }, { now: () => m });
  const w = world((url) => url === TRUEFX_URL ? { status: 503, body: "busy" } : { status: 200, body: KRAKEN });
  const run = (now: number) => { w.reset(); return runFxRec({ db, now, clock: w.clock, fetchImpl: w.fetchImpl, pause: w.pause }); };
  const r1 = await run(m);
  assertEquals([r1.primaryHealthy, r1.failed.truefx, r1.errors, r1.report], [false, 59, [], false]);
  // Kraken at second 0 (routine); the third failure is at second 2, so from second 4 every even second, those reads marked.
  const ks = w.calls.filter((c) => c.url === KRAKEN_URL).length;
  assertEquals([ks, r1.fallbackReads], [1 + 28, 28]);
  const k = tables.fx_ticks.find((x) => x.source === "kraken" && x.pair === "GBPUSD")!;
  assertEquals((k.fallback as boolean[])[0], false);
  const g = tables.fx_ticks.find((x) => x.source === "truefx" && x.pair === "GBPUSD")!;
  assertEquals([(g.recv_ms as number[]).length, g.failed, g.last_error], [0, 59, "503 busy"]);
  // Unhealthy since second 2 of the first minute: the fifth minute ends 4 min 56 s later, no fault; the sixth is past five
  // minutes and reported, the seventh not again, the same fault an hour later again.
  for (let i = 1; i <= 4; i++) assertEquals((await run(m + i * 60e3)).errors, []);
  const r6 = await run(m + 5 * 60e3);
  assert(r6.errors.length === 1 && r6.errors[0] === "truefx: unhealthy for 6 min (last error: 503 busy)", r6.errors.join());
  assertEquals(r6.report, true);
  assertEquals((await run(m + 6 * 60e3)).report, false);
  assertEquals((await run(m + 66 * 60e3)).report, true);
  // TrueFX back: healthy at its first good read, Kraken back to every fifth second, no fault.
  const back = world((url, _i, at) => url === TRUEFX_URL ? { status: 200, body: truefxAt(m + 67 * 60e3 + at) } : { status: 200, body: KRAKEN });
  const r = await runFxRec({ db, now: m + 67 * 60e3, clock: back.clock, fetchImpl: back.fetchImpl, pause: back.pause });
  // Second 0 still starts unhealthy (the state the last run left), so its Kraken read is the fallback's; none after.
  assertEquals([r.primaryHealthy, r.fallbackReads, r.errors, r.reads.kraken], [true, 1, [], 12]);
  assertEquals((tables.fx_rec_state[0].state as FxRecState).health, { failsInRow: 0, badSince: null });
});

Deno.test("runFxRec: both down is a fault at once; one failed read is none; a stale TrueFX hands over too; a failed write is reported", async () => {
  const m = Date.parse("2026-10-29T08:00:00Z");
  const both = memDb({ fx_rec_state: [{ id: 1, state: {} } as Row], fx_ticks: [] }, { now: () => m });
  const w = world(() => "throw");
  const r = await runFxRec({ db: both.db, now: m, clock: w.clock, fetchImpl: w.fetchImpl, pause: w.pause });
  assertEquals([r.errors, r.report], [["kraken: every fallback read of the minute failed (connection reset)"], true]);

  const one = memDb({ fx_rec_state: [{ id: 1, state: {} } as Row], fx_ticks: [] }, { now: () => m });
  const w1 = world((url, i, at) => url === TRUEFX_URL && i === 7 ? "throw" : url === TRUEFX_URL ? { status: 200, body: truefxAt(m + at) } : { status: 200, body: KRAKEN });
  const r1 = await runFxRec({ db: one.db, now: m, clock: w1.clock, fetchImpl: w1.fetchImpl, pause: w1.pause });
  assertEquals([r1.failed.truefx, r1.fallbackReads, r1.errors, r1.report], [1, 0, [], false]);

  // TrueFX answering with a time three minutes old: unhealthy at once, Kraken reads as the fallback.
  const stale = memDb({ fx_rec_state: [{ id: 1, state: {} } as Row], fx_ticks: [] }, { now: () => m });
  const w2 = world((url) => url === TRUEFX_URL ? { status: 200, body: truefxAt(m - 3 * 60e3) } : { status: 200, body: KRAKEN });
  const r2 = await runFxRec({ db: stale.db, now: m, clock: w2.clock, fetchImpl: w2.fetchImpl, pause: w2.pause });
  assertEquals([r2.primaryHealthy, r2.fallbackReads > 0], [false, true]);
  // The stale quote is kept once (the minute's first read), not 59 times.
  assertEquals((stale.tables.fx_ticks.find((x) => x.source === "truefx" && x.pair === "GBPUSD")!.recv_ms as number[]).length, 1);
  // Closed: the same stale TrueFX is the market's, not a fault; reads at 10 s and 30 s steps.
  const sat = Date.parse("2026-10-31T12:00:00Z");
  const w3 = world((url) => url === TRUEFX_URL ? { status: 200, body: truefxAt(sat - 14 * 3600e3) } : { status: 200, body: KRAKEN });
  const r3 = await runFxRec({ db: stale.db, now: sat, clock: w3.clock, fetchImpl: w3.fetchImpl, pause: w3.pause });
  assertEquals([r3.primaryHealthy, r3.reads, r3.errors], [true, { truefx: 6, kraken: 2 }, []]);

  const broken = memDb({ fx_rec_state: [{ id: 1, state: {} } as Row], fx_ticks: [] }, { now: () => m });
  const failing = { ...broken.db, upsert: (t: string, rows: unknown, on: string) => t === "fx_ticks" ? Promise.reject(new Error("timeout")) : broken.db.upsert(t, rows, on) };
  const w4 = world((url, _i, at) => url === TRUEFX_URL ? { status: 200, body: truefxAt(m + at) } : { status: 200, body: KRAKEN });
  const r4 = await runFxRec({ db: failing, now: m, clock: w4.clock, fetchImpl: w4.fetchImpl, pause: w4.pause });
  assertEquals([r4.errors, r4.report], [["write: timeout"], true]);
});

Deno.test("the fxrec action answers at once, keeps the worker for its run, and reports a fault to ops_errors as agents.fx_rec", async () => {
  const kept: Promise<unknown>[] = [];
  const reported: { kind: string; message?: string }[] = [];
  const report = (kind: string, o?: { message?: string }) => { reported.push({ kind, message: o?.message }); return Promise.resolve(); };
  let finish: (r: FxRecReport) => void = () => {};
  const run = () => new Promise<FxRecReport>((res) => { finish = res; });
  const r = startFxRecAction({ run, keep: (p) => kept.push(p), report });
  // Answered while the run is still going: the worker is kept for it.
  assert(typeof r.started === "string");
  assertEquals([kept.length, reported.length], [1, 0]);
  finish({ at: "2026-10-29T08:00:00.000Z", errors: ["truefx: unhealthy for 5 min (last error: 503 busy)"], report: true } as FxRecReport);
  await kept[0];
  assertEquals(reported, [{ kind: "agents.fx_rec", message: "truefx: unhealthy for 5 min (last error: 503 busy)" }]);
  // A run that throws is reported too, and nothing escapes.
  startFxRecAction({ run: () => Promise.reject(new Error("boom")), keep: (p) => kept.push(p), report });
  await kept[1];
  assertEquals(reported.at(-1), { kind: "agents.fx_rec", message: "boom" });
  // A run with nothing to report reports nothing.
  startFxRecAction({ run: () => Promise.resolve({ at: "x", errors: [], report: false } as unknown as FxRecReport), keep: (p) => kept.push(p), report });
  await kept[2];
  assertEquals(reported.length, 2);
});
