// Pins for `GET /igbot?action=fxw_watch` (fxw_watch.ts): its shape and size, the bearer required, the database only (IG's
// client and its secrets never built), account ids masked, and every problem the prompt names found where it should be.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { Db } from "../agents/db.ts";
import { handle } from "./index.ts";
import { FXW_WATCH_MAX_BYTES, FXW_WATCH_PROBLEMS, fxwWatchView, maskAccount, nextWindowStart, windowStart } from "./fxw_watch.ts";

const TOKEN = "t".repeat(40);
const T = (s: string) => Date.parse(s);
// Sunday 2026-11-01 21:30 UTC (GMT: UK time is UTC), half an hour after the open, inside the window.
const NOW = T("2026-11-01T21:30:00Z");

type Row = Record<string, unknown>;
/** A PostgREST double for the reads this action sends: eq, gte and the newest-first orders it uses. */
function fakeDb(tables: Record<string, Row[]>): Db & { reads: string[] } {
  const reads: string[] = [];
  const where = (table: string, query: string) => {
    reads.push(table);
    let rows = [...(tables[table] ?? [])];
    for (const [k, v] of new URLSearchParams(query)) {
      if (["select", "order", "limit"].includes(k)) continue;
      if (v.startsWith("eq.")) rows = rows.filter((r) => String(r[k]) === v.slice(3));
      if (v.startsWith("gte.")) rows = rows.filter((r) => Date.parse(String(r[k])) >= Date.parse(v.slice(4)));
      if (v.startsWith("gt.")) rows = rows.filter((r) => Date.parse(String(r[k])) > Date.parse(v.slice(3)));
    }
    const ord = /order=([a-z_]+)\.(asc|desc)/.exec(query);
    if (ord) rows.sort((a, b) => (String(a[ord[1]]) < String(b[ord[1]]) ? -1 : String(a[ord[1]]) > String(b[ord[1]]) ? 1 : 0) * (ord[2] === "asc" ? 1 : -1));
    const lim = /limit=(\d+)/.exec(query);
    return lim ? rows.slice(0, Number(lim[1])) : rows;
  };
  return {
    reads,
    select: <T>(table: string, query: string) => Promise.resolve(where(table, query) as T[]),
    selectAll: <T>(table: string, query: string) => Promise.resolve(where(table, query) as T[]),
    insert: <T>(table: string, rows: unknown) => { (tables[table] ??= []).push(...(Array.isArray(rows) ? rows : [rows]) as Row[]); return Promise.resolve([] as T[]); },
    upsert: () => Promise.reject(new Error("fxw_watch writes nothing but its request row")),
    update: () => Promise.reject(new Error("fxw_watch writes nothing but its request row")),
    claim: () => Promise.reject(new Error("fxw_watch claims nothing")),
  };
}

const run = (min: number, ok: boolean, env = "live") => ({ id: 1000 + min, ok, started_at: new Date(T("2026-11-01T21:00:00Z") + min * 60_000).toISOString(), environment: env, error: ok ? null : "sb: 401 error.security.account-token-invalid; switch to ABC123 refused" });

/** The fixture: an open long from Sunday's open, the recorder failing its last two runs, a login with no CFD account, the
 *  strategy's run silent for 15 minutes. */
function fixture(): Record<string, Row[]> {
  return {
    ig_fxw_state: [{ id: 1, last_run: "2026-11-01T21:15:00Z", last_error: null, name: "FXW-AUD weekend", funded_gbp: 1000, stake_gbp: 1.5, start_at: "2026-10-30T21:35:00Z" }],
    ig_fxw_weekends: [{
      friday: "2026-10-30", status: "open", reason: null, account_id: "ABC123",
      fri_ts: "2026-10-30T21:58:00Z", fri_bid: 0.6599, fri_offer: 0.6601, fri_mid: 0.66,
      dec_ts: "2026-11-01T21:00:05Z", dec_bid: 0.6578, dec_offer: 0.658, gap_bps: -31.87, side: "long",
      entry_ts: "2026-11-01T21:00:05Z", entry_price: 0.658, margin_gbp: 493.5, exit_ts: null, exit_bid: null, exit_offer: null, exit_price: null, exit_reason: null,
      mark_ts: "2026-11-01T21:14:30Z", mark_price: 0.659, net_gbp: 15, funding_gbp: 0,
    }],
    // The recorder: ok to 21:27, then two failures; a demo run (another environment) never counts.
    ig_quote_runs: [run(25, true), run(26, true), run(27, true), run(28, false), run(29, false), run(29.5, true, "demo")],
    ig_facts: [
      { id: 1, environment: "demo", account_kind: "sb", account_id: "Z6F18K", ok: true, selected: { fx_audusd: "CS.D.AUDUSD.TODAY.IP" }, at: "2026-10-15T16:00:00Z" },
      { id: 7, environment: "live", account_kind: "sb", account_id: "ABC123", ok: true, selected: { fx_audusd: "CS.D.AUDUSD.TODAY.IP" }, at: "2026-10-30T12:00:00Z" },
      { id: 8, environment: "live", account_kind: "cfd", account_id: null, ok: false, selected: {}, at: "2026-10-30T12:02:00Z" },
    ],
    edge_calls: [{ path: "ig?action=quotes", enabled: true }, { path: "ig?action=fxw", enabled: true }, { path: "igbot?action=sync", enabled: true }],
    edge_call_beats: [
      { minute: "2026-11-01T21:29:00Z", path: "ig?action=quotes", ts: "2026-11-01T21:29:01Z" },
      { minute: "2026-11-01T21:15:00Z", path: "ig?action=fxw", ts: "2026-11-01T21:15:01Z" },
    ],
    igbot_requests: [],
  };
}

const call = async (tables: Record<string, Row[]>, o: { auth?: string; method?: string } = {}) => {
  let execCalls = 0;
  const db = fakeDb(tables);
  const res = await handle(new Request("https://x.test/functions/v1/igbot?action=fxw_watch", { method: o.method ?? "GET", headers: { Authorization: o.auth ?? `Bearer ${TOKEN}` } }), {
    secret: TOKEN, db, now: () => NOW, cronSecret: "c".repeat(40),
    // IG's client and its secrets are built only through `exec`: this action never gets there.
    exec: () => { execCalls++; throw new Error("fxw_watch must not build IG's client"); },
    report: () => Promise.resolve(),
  });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text), execCalls, db };
};

Deno.test("fxw_watch: the bearer is required, GET only, and it never builds IG's client or reads an IG secret", async () => {
  assertEquals((await call(fixture(), { auth: "Bearer wrong" })).status, 401);
  assertEquals((await call(fixture(), { auth: "" })).status, 401);
  assertEquals((await call(fixture(), { method: "POST" })).status, 405);
  const r = await call(fixture());
  assertEquals([r.status, r.execCalls], [200, 0]);
  // It reads the database only, and writes only its own request row (IG calls 0).
  assertEquals([...new Set(r.db.reads)].sort(), ["edge_call_beats", "edge_calls", "ig_facts", "ig_fxw_state", "ig_fxw_weekends", "ig_quote_runs", "igbot_requests"]);
  // fxw_watch.ts' source holds no secret name, no client and no fetch: pinned in src/igbot.test.js (this run has no read permission).
});

Deno.test("fxw_watch: its shape, every account id masked, under 8 KB", async () => {
  const r = await call(fixture());
  const b = r.body;
  assertEquals(Object.keys(b), ["now", "strategy", "weekends", "recorder", "window", "facts", "calls", "problems"]);
  // The book: £1,000 at the start, an open long marked +£15.
  assertEquals([b.strategy.name, b.strategy.start_gbp, b.strategy.equity_gbp, b.strategy.change_gbp, b.strategy.status, b.strategy.last_run_age_min], ["FXW-AUD weekend", 1000, 1015, 15, "open", 15]);
  assertEquals(b.strategy.open_position, { friday: "2026-10-30", side: "long", entry: 0.658, entry_at: "2026-11-01T21:00:05Z", mark: 0.659, mark_at: "2026-11-01T21:14:30Z", net_gbp: 15, margin_gbp: 493.5 });
  assertEquals(b.strategy.next_step, "close at the first quote reaching Friday's mid 0.66, else at the first quote from 2026-11-02T21:00:05.000Z");
  // The weekend with the quotes each fill used.
  assertEquals(b.weekends[0].friday_mid, { mid: 0.66, bid: 0.6599, offer: 0.6601, at: "2026-10-30T21:58:00Z" });
  assertEquals(b.weekends[0].decision, { bid: 0.6578, offer: 0.658, at: "2026-11-01T21:00:05Z", gap_bps: -31.87 });
  assertEquals(b.weekends[0].entry, { price: 0.658, at: "2026-11-01T21:00:05Z" });
  // The recorder, live runs only: the window opened Saturday 07:40 UK; 3 ok and 2 failed in the last hour, the last two failed.
  assertEquals(b.recorder.window.from, "2026-10-31T07:40:00.000Z");
  assertEquals([b.recorder.last_hour, b.recorder.failed_streak, b.recorder.last_run_ok, b.recorder.missing_accounts], [{ ok: 3, failed: 2 }, 2, false, ["cfd"]]);
  assertEquals(b.recorder.last_error, "sb: 401 error.security.account-token-invalid; switch to …23 refused");
  assertEquals(b.window, { in_window: true, current_from: "2026-10-31T07:40:00.000Z", next_start: null });
  assertEquals(b.facts, {
    sb: { account: "…23", ok: true, fx_audusd_found: true, at: "2026-10-30T12:00:00Z" },
    cfd: { account: null, ok: false, fx_audusd_found: false, at: "2026-10-30T12:02:00Z" },
  });
  assertEquals(b.calls, { "ig?action=quotes": { enabled: true, last_beat_age_min: 1 }, "ig?action=fxw": { enabled: true, last_beat_age_min: 15 } });
  assertEquals(b.problems.map((p: { code: string }) => p.code), ["recorder_failing", "facts_not_ok", "missing_accounts", "no_beat"]);
  // No account id, no demo id, no balance anywhere; the whole answer under 8 KB.
  assert(!r.text.includes("ABC123") && !r.text.includes("Z6F18K") && !/balance|available|deposit/i.test(r.text), r.text);
  assert(r.text.length < FXW_WATCH_MAX_BYTES, `${r.text.length} bytes`);
});

Deno.test("fxw_watch: a healthy weekend has no problem; a missed weekend, a run error and a dead fxw call each name theirs", () => {
  const base = (over: Partial<Parameters<typeof fxwWatchView>[0]> = {}) => fxwWatchView({
    state: { last_run: "2026-11-01T21:29:00Z", last_error: null, name: "FXW-AUD weekend", funded_gbp: 1000, stake_gbp: 1.5, start_at: "2026-10-30T21:35:00Z" },
    weekends: [], runs: [run(28, true), run(29, true)], lastRun: run(29, true),
    facts: { sb: { at: "x", account_kind: "sb", account_id: "ABC123", ok: true, selected: { fx_audusd: "E" } }, cfd: { at: "x", account_kind: "cfd", account_id: "DEF456", ok: true, selected: { fx_audusd: "F" } } },
    calls: [{ path: "ig?action=quotes", enabled: true }, { path: "ig?action=fxw", enabled: true }],
    beats: { "ig?action=quotes": "2026-11-01T21:29:01Z", "ig?action=fxw": "2026-11-01T21:25:01Z" }, windowFrom: windowStart(NOW), ...over,
  }, NOW);
  assertEquals(base().problems, []);
  assertEquals(base({ weekends: [{ friday: "2026-10-30", status: "missed", reason: "missed: no quote was recorded at 21:00 UK, so the first tradable quote after the open is not known" }] }).problems.map((p) => p.code), ["weekend_missed"]);
  assertEquals(base({ state: { last_run: "2026-11-01T21:29:00Z", last_error: "no live facts row names the spread-bet account's AUD/USD epic", name: "x", funded_gbp: 1000, stake_gbp: 1.5, start_at: "2026-10-30T21:35:00Z" } }).problems.map((p) => p.code), ["fxw_error"]);
  assertEquals(base({ beats: { "ig?action=quotes": "2026-11-01T21:29:01Z", "ig?action=fxw": null } }).problems.map((p) => p.code), ["no_beat"]);
  // Outside the window the recorder's call is off by design: its silence and its failures are no problem then.
  const tue = T("2026-11-03T12:00:00Z");
  const quiet = fxwWatchView({ ...{ state: null, weekends: [], runs: [run(28, false), run(29, false)], lastRun: run(29, false), facts: {}, calls: [{ path: "ig?action=quotes", enabled: false }, { path: "ig?action=fxw", enabled: true }], beats: { "ig?action=fxw": "2026-11-03T11:55:01Z" }, windowFrom: windowStart(tue) } }, tue);
  assertEquals(quiet.problems.map((p) => p.code), ["facts_not_ok", "facts_not_ok", "missing_accounts"]);
  assertEquals([quiet.window.in_window, quiet.window.next_start, quiet.strategy.status], [false, "2026-11-06T21:35:00.000Z", "no run yet"]);
  // The window's edges, UK time: Friday 21:35, Saturday 07:40 to Monday 22:20.
  assertEquals(new Date(nextWindowStart(T("2026-11-06T22:30:00Z"))).toISOString(), "2026-11-07T07:40:00.000Z");
  assertEquals(new Date(windowStart(T("2026-11-06T22:00:00Z"))).toISOString(), "2026-11-06T21:35:00.000Z");
  assertEquals([maskAccount("ABC123"), maskAccount(null)], ["…23", null]);
  assertEquals(Object.keys(FXW_WATCH_PROBLEMS).sort(), ["facts_not_ok", "fxw_error", "missing_accounts", "no_beat", "recorder_failing", "weekend_missed"]);
});
