// The programme factor (pm_prog.ts, 0115): the listing's readings out of an archived universe object as pm-rec writes it,
// the factor on a case worked by hand, the summary rescaled and then priced at the live R, and the job's cursor.
import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { gzipSync } from "node:zlib";
import { atProgramme, programmeFactor, progFx, rateAt, runPmProg, universeReads, type PmProgFactorRow } from "./pm_prog.ts";
import { atLiveR } from "./pm_lp_live_view.ts";
import { readFrames } from "./pm_book_rec.ts";
import { memDb } from "./testing.ts";

const FIELDS = ["id", "dt", "rate", "v", "min_size", "tick", "bb", "ba", "ab", "aa", "q1", "q2", "dv_bid", "dv_ask", "d10_bid", "d10_ask", "n_bid", "n_ask", "ltp", "min_order", "vol24h", "liquidity"];
const header = (minute: string, phase: number) => JSON.stringify({ v: 1, kind: "universe", minute, at: minute, fields: FIELDS, scale: { tick: 1e-4 }, n: 2, phase, phases: 15 });
const line = (id: number, rate: number, v: number, min: number) => JSON.stringify([id, 120, rate, v, min, 100, 4900, 5100, 4900, 5100, 1, 1, 10, 10, 20, 20, 2, 2, 0.5, 5, 1000, 500]);
// Two frames, each its own gzip member, concatenated: the archive object's shape (pm_book_rec.ts).
const FRAME_A = [header("2026-10-09T12:00:00.000Z", 0), line(30, 40, 4.5, 20), line(999, 7, 3, 5)].join("\n") + "\n";   // phase 0: id 30 listed, id 45 not
const FRAME_B = [header("2026-10-09T12:01:00.000Z", 1), line(31, 200, 6.5, 50)].join("\n") + "\n";                       // phase 1: id 31 listed
const OBJECT = new Uint8Array([...gzipSync(new TextEncoder().encode(FRAME_A)), ...gzipSync(new TextEncoder().encode(FRAME_B))]);

Deno.test("an archived universe object of concatenated gzip members is read whole, and a market of the frame's phase not listed reads no programme", async () => {
  const { gunzipSync } = await import("node:zlib");
  const text = new TextDecoder().decode(gunzipSync(OBJECT));
  // The recorder's own reader sees the same two frames.
  assertEquals(readFrames(text).map((f) => [f.header.minute, f.rows.length]), [["2026-10-09T12:00:00.000Z", 2], ["2026-10-09T12:01:00.000Z", 1]]);
  const wanted = new Map([[30, "0xa"], [45, "0xb"], [31, "0xc"], [46, "0xd"]]);
  assertEquals(universeReads(text, wanted), [
    { cond: "0xa", minute: "2026-10-09T12:00:00.000Z", rate: 40, max_spread: 4.5, min_size: 20 },
    { cond: "0xb", minute: "2026-10-09T12:00:00.000Z", rate: null, max_spread: null, min_size: null },
    { cond: "0xc", minute: "2026-10-09T12:01:00.000Z", rate: 200, max_spread: 6.5, min_size: 50 },
    { cond: "0xd", minute: "2026-10-09T12:01:00.000Z", rate: null, max_spread: null, min_size: null },
  ]);
  // The wanted lines agree with readFrames' parse of the same lines.
  const rec = readFrames(text)[0].rows.find((r) => r.id === 30) as Record<string, unknown>;
  assertEquals([rec.rate, rec.v, rec.min_size], [40, 4.5, 20]);
});

Deno.test("the factor on a case worked by hand: the rate then over the rate used, weighted by the formula", () => {
  const reads = [
    { minute: "2026-10-09T00:00:00.000Z", rate: 40 },
    { minute: "2026-10-09T00:15:00.000Z", rate: 3 },
    { minute: "2026-10-09T00:30:00.000Z", rate: null },   // the listing no longer shows it: 0
  ];
  assertEquals(rateAt(reads, Date.parse("2026-10-09T00:10:00Z")), 40);
  assertEquals(rateAt(reads, Date.parse("2026-10-09T00:20:00Z")), 3);
  assertEquals(rateAt(reads, Date.parse("2026-10-09T00:40:00Z")), 0);
  // Before the first reading: the first within 30 minutes after, else nothing covers it.
  assertEquals(rateAt(reads, Date.parse("2026-10-08T23:45:00Z")), 40);
  assertEquals(rateAt(reads, Date.parse("2026-10-08T23:20:00Z")), null);
  const f = programmeFactor([
    { minute: "2026-10-09T00:10:00.000Z", reward: 1, rateUsed: 40 },
    { minute: "2026-10-09T00:20:00.000Z", reward: 1, rateUsed: 40 },
    { minute: "2026-10-09T00:40:00.000Z", reward: 1, rateUsed: 40 },
    { minute: "2026-10-08T23:20:00.000Z", reward: 2, rateUsed: 40 },   // uncovered: keeps its formula
    { minute: "2026-10-09T00:50:00.000Z", reward: 0, rateUsed: 40 },   // no reward: no weight
  ], reads);
  // (1 x 40/40 + 1 x 3/40 + 1 x 0 + 2) / 5 = 3.075 / 5
  assertAlmostEquals(f.formulaTrue, 3.075, 1e-12);
  assertEquals([f.formula, f.uncovered], [5, 1]);
  assertAlmostEquals(f.factor, 0.615, 1e-12);
});

const ROWS: PmProgFactorRow[] = [
  { source: "rwc", day: "2026-10-08", cond: "a", formula: 20, formula_true: 10, uncovered: 0, read_through: "2026-10-08T23:59:00.000Z" },
  { source: "rwc", day: "2026-10-09", cond: "a", formula: 8, formula_true: 2, uncovered: 0, read_through: "2026-10-09T10:00:00.000Z" },
  { source: "midprep", day: "2026-10-09", cond: "a", formula: 1, formula_true: 1, uncovered: 0, read_through: null },
];
// deno-lint-ignore no-explicit-any
const SUMMARY: Record<string, any> = {
  startedAt: "2026-10-08T00:00:00.000Z", rewardUsd: 14, totalUsd: 20, realisedUsd: 15, stressUsd: 8, todayUsd: 6, todayStressUsd: 3, bestMarketUsd: 16,
  days: [{ day: "2026-10-08", rewardUsd: 10, totalUsd: 12, stressUsd: 5, runningUsd: 12 }],
  markets: [{ cond: "a", rewardUsd: 14, totalUsd: 16 }],
};

Deno.test("a summary rescaled to the programme as read: each day by its factor, today by today's, markets by theirs, and the totals with them", () => {
  const fx = progFx(ROWS, "rwc", "2026-10-08");
  const out = atProgramme(SUMMARY, fx, "2026-10-09");
  // Closed day: 10 x 0.5; today: (14 - 10) x 0.25; the total is their sum, 6, so 8 comes off the total and realised,
  // 4 (half) off the worst case, 3 off today, 1.5 off today's worst case.
  assertEquals(out.days[0], { day: "2026-10-08", rewardUsd: 5, totalUsd: 7, stressUsd: 2.5, runningUsd: 7, programmeFactor: 0.5 });
  assertEquals([out.rewardUsd, out.totalUsd, out.realisedUsd, out.stressUsd, out.todayUsd, out.todayStressUsd], [6, 12, 7, 4, 3, 1.5]);
  // The market over both days: 12 / 28 of its 14.
  assertEquals(out.markets[0], { cond: "a", rewardUsd: 6, totalUsd: 8, programmeFactor: 0.428571 });
  assertEquals(out.bestMarketUsd, 8);
  assertEquals(out.programmePricing, { factor: 0.428571, formulaUsd: 14, uncoveredDays: [], readThrough: "2026-10-09T10:00:00.000Z" });
  // Then the live R: the rescaled formula at 0.8, its worst case at the band's low.
  const priced = atLiveR(out, { point: 0.8, low: 0.65, high: 1, days: 1, basis: "live" });
  assertAlmostEquals(priced.rewardUsd, 4.8, 1e-9);
  assertAlmostEquals(priced.totalUsd, 12 - 0.2 * 6, 1e-9);
  assertAlmostEquals(priced.stressUsd, 4 - 0.5 * 6 + 0.65 * 6, 1e-9);
});

Deno.test("a day with no factor rows keeps its rewards and is named; no rows at all leave the summary as it was", () => {
  const out = atProgramme(SUMMARY, progFx(ROWS, "midprep", "2026-10-08"), "2026-10-09");
  assertEquals(out.days[0].rewardUsd, 10);
  assertEquals(out.programmePricing.uncoveredDays, ["2026-10-08"]);
  assertEquals(out.rewardUsd, 14);
  const none = atProgramme(SUMMARY, progFx([], "rwc", null), "2026-10-09");
  assertEquals([none.rewardUsd, none.totalUsd, none.todayUsd], [14, 20, 6]);
  assertEquals(none.programmePricing.uncoveredDays, ["2026-10-08", "2026-10-09"]);
});

async function sha(bytes: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("the job reads the next archived hour for the selected markets, upserts its readings, and moves the cursor; a bad hash stops it", async () => {
  const now = Date.parse("2026-10-09T15:00:00Z");
  const seed = async (bytes: Uint8Array, hash?: string) => ({
    agent_locks: [{ name: "pm-prog", lease_until: "2026-01-01T00:00:00.000Z", holder: null }],
    pm_prog_state: [{ id: 1, state: { cursor: "2026-10-09T11:00:00.000Z" }, updated_at: null, last_error: null }],
    pm_rec_archive: [{ hour: "2026-10-09T12:00:00.000Z", kind: "universe", path: "universe/2026-10-09/12.jsonl.gz", frames: 2, lines: 3, bytes: bytes.length, first_minute: null, last_minute: null, sha256: hash ?? await sha(bytes), url: "https://example.invalid/signed?token=SECRET", url_expires: "2027-10-09T00:00:00.000Z", archived_at: "2026-10-09T13:05:00.000Z" }],
    pm_rwc_selection: [{ day: "2026-10-09", cond: "0xa" }], pm_live_markets: [], pm_mid_markets: [{ day: "2026-10-10", cond: "0xc" }], pm_lp_markets: [],
    pm_rec_markets: [{ id: 30, cond: "0xa" }, { id: 31, cond: "0xc" }],
    pm_prog_reads: [],
  });
  let asked = "";
  const fetchImpl = ((u: string) => { asked = u; return Promise.resolve(new Response(OBJECT)); }) as unknown as typeof fetch;
  const { db } = memDb(await seed(OBJECT), { now: () => now });
  const r = await runPmProg({ db, now, holder: "h", fetchImpl, clock: () => now });
  assertEquals(asked, "https://example.invalid/signed?token=SECRET");
  assertEquals([r.hours, r.reads, r.errors, r.cursor], [["2026-10-09T12:00:00.000Z"], 2, [], "2026-10-09T12:00:00.000Z"]);
  const reads = await db.select<Record<string, unknown>>("pm_prog_reads", "select=cond,minute,rate&order=cond.asc");
  assertEquals(reads, [{ cond: "0xa", minute: "2026-10-09T12:00:00.000Z", rate: 40 }, { cond: "0xc", minute: "2026-10-09T12:01:00.000Z", rate: 200 }]);
  const [st] = await db.select<{ state: Record<string, unknown>; last_error: string | null }>("pm_prog_state", "id=eq.1&select=state,last_error");
  assertEquals([st.state.cursor, st.last_error], ["2026-10-09T12:00:00.000Z", null]);

  // A hash that differs: nothing stored, the cursor stays, the fault is reported, and no URL is in it.
  const { db: bad } = memDb(await seed(OBJECT, "0".repeat(64)), { now: () => now });
  const r2 = await runPmProg({ db: bad, now, holder: "h", fetchImpl, clock: () => now });
  assertEquals([r2.reads, r2.cursor, r2.report], [0, "2026-10-09T11:00:00.000Z", true]);
  assert(r2.errors[0].includes("sha256"));
  assert(!JSON.stringify(r2).includes("SECRET"));
});

Deno.test("a gap in the archive waits until the hour is past being archived, then is stepped over as lost", async () => {
  const bytes = OBJECT, hash = await sha(OBJECT);
  const base = (now: number) => memDb({
    agent_locks: [{ name: "pm-prog", lease_until: "2026-01-01T00:00:00.000Z", holder: null }],
    pm_prog_state: [{ id: 1, state: { cursor: "2026-10-09T10:00:00.000Z" }, updated_at: null, last_error: null }],
    pm_rec_archive: [{ hour: "2026-10-09T12:00:00.000Z", kind: "universe", path: "p", frames: 2, lines: 3, bytes: bytes.length, first_minute: null, last_minute: null, sha256: hash, url: "https://example.invalid/x", url_expires: "2027-01-01T00:00:00.000Z", archived_at: "2026-10-09T13:05:00.000Z" }],
    pm_rwc_selection: [{ day: "2026-10-09", cond: "0xa" }], pm_live_markets: [], pm_mid_markets: [], pm_lp_markets: [], pm_rec_markets: [{ id: 30, cond: "0xa" }], pm_prog_reads: [],
  }, { now: () => now }).db;
  const fetchImpl = (() => Promise.resolve(new Response(OBJECT))) as unknown as typeof fetch;
  // 11:00 is missing; at 15:00 it may still come (pm-rec archives within six hours): wait.
  const early = Date.parse("2026-10-09T15:00:00Z");
  const r1 = await runPmProg({ db: base(early), now: early, holder: "h", fetchImpl, clock: () => early });
  assertEquals([r1.hours, r1.lost, r1.cursor], [[], [], "2026-10-09T10:00:00.000Z"]);
  // At 21:00 it is lost: stepped over and named.
  const late = Date.parse("2026-10-09T21:00:00Z");
  const r2 = await runPmProg({ db: base(late), now: late, holder: "h", fetchImpl, clock: () => late });
  assertEquals([r2.hours, r2.lost, r2.cursor], [["2026-10-09T12:00:00.000Z"], ["2026-10-09T11:00:00.000Z"], "2026-10-09T12:00:00.000Z"]);
});
