// Pins for the recorders' daily audit of each other: which buckets each owed (the calendar is the whole trick), when
// a shortfall is reported, and the paged read.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  auditFinding, auditRecorder, BUCKET_MS, isAuditCall, owedBuckets, readBuckets, WATCH_GRACE_MS,
} from "./recorder_watch.ts";
import { shouldRecord } from "./us_overnight_session.ts";

const ms = (iso: string) => Date.parse(iso);
const owedOvernight = (fromIso: string, toIso: string) => owedBuckets(ms(fromIso), ms(toIso), shouldRecord);

Deno.test("owedBuckets: the overnight recorder owes 96 buckets a weekday night, 20:00-04:00 ET", () => {
  const b = owedOvernight("2026-09-29T10:00:00Z", "2026-09-30T10:00:00Z");  // Tue night, EDT
  assertEquals(b.length, 96);
  assertEquals([b[0], b.at(-1)], ["2026-09-30T00:00:00.000Z", "2026-09-30T07:55:00.000Z"]);
  const est = owedOvernight("2026-11-30T10:00:00Z", "2026-12-01T10:00:00Z");  // Mon night, EST
  assertEquals([est.length, est[0], est.at(-1)], [96, "2026-12-01T01:00:00.000Z", "2026-12-01T08:55:00.000Z"]);
});

Deno.test("owedBuckets: nothing on a Friday night, 96 on a Sunday night, nothing into a holiday", () => {
  assertEquals(owedOvernight("2026-10-02T10:00:00Z", "2026-10-03T10:00:00Z").length, 0);   // Fri night: weekend
  assertEquals(owedOvernight("2026-10-03T10:00:00Z", "2026-10-04T10:00:00Z").length, 0);   // Sat night
  assertEquals(owedOvernight("2026-10-04T10:00:00Z", "2026-10-05T10:00:00Z").length, 96);  // Sun night: Monday's
  assertEquals(owedOvernight("2026-11-25T10:00:00Z", "2026-11-26T10:00:00Z").length, 0);   // into Thanksgiving
  assertEquals(owedOvernight("2026-11-26T10:00:00Z", "2026-11-27T10:00:00Z").length, 96);  // into the early close
});

Deno.test("owedBuckets: the snapshot recorder owes every bucket", () => {
  assertEquals(owedBuckets(ms("2026-09-29T09:20:00Z"), ms("2026-09-30T09:20:00Z")).length, 288);
  assertEquals(owedBuckets(ms("2026-09-29T09:21:00Z"), ms("2026-09-29T09:31:00Z")), [
    "2026-09-29T09:25:00.000Z", "2026-09-29T09:30:00.000Z",
  ]);
});

Deno.test("auditFinding: under 90 % is reported, with what was kept", () => {
  const owed = owedOvernight("2026-09-29T10:00:00Z", "2026-09-30T10:00:00Z");
  const written = owed.filter((_, i) => i % 3 !== 0).map((b) => b.replace(".000Z", "+00:00"));  // PostgREST's form
  const line = auditFinding("overnight-record", owed, written, "2026-09-30T09:50:00.000Z");
  assert(line != null && line.includes("wrote 64 of the 96") && line.includes("(67 %)"), String(line));
  assert(line.includes("the newest it wrote: 2026-09-30T07:55:00.000Z"), line);
  assert(!line.includes("none of the last"), line);
});

Deno.test("auditFinding: a recorder that stopped is reported even above 90 %", () => {
  const owed = owedBuckets(ms("2026-09-29T09:20:00Z"), ms("2026-09-30T09:20:00Z"));
  const line = auditFinding("snapshot-record", owed, owed.slice(0, -6), "2026-09-30T09:20:00.000Z");
  assert(line != null && line.includes("282 of the 288") && line.includes("none of the last 6"), String(line));
  assertEquals(auditFinding("snapshot-record", owed, owed.slice(0, -5), "t"), null);
});

Deno.test("auditFinding: healthy, or owed nothing, is not reported", () => {
  const owed = owedOvernight("2026-09-29T10:00:00Z", "2026-09-30T10:00:00Z");
  assertEquals(auditFinding("overnight-record", owed, owed.filter((_, i) => i % 12 !== 5), "t"), null);  // 88 of 96
  assertEquals(auditFinding("overnight-record", [], [], "t"), null);
});

Deno.test("isAuditCall: the one call whose bucket starts at the hour named", () => {
  assert(isAuditCall(new Date("2026-10-01T10:00:31Z"), 10, 0));
  assert(isAuditCall(new Date("2026-10-01T10:04:59Z"), 10, 0));
  assert(!isAuditCall(new Date("2026-10-01T10:05:00Z"), 10, 0));
  assert(!isAuditCall(new Date("2026-10-01T09:55:00Z"), 10, 0));
  assert(isAuditCall(new Date("2026-10-01T09:30:02Z"), 9, 30));
});

/** A PostgREST that serves `rows` for `limit`/`offset`, or answers `status`. */
function postgrest(rows: Record<string, string>[], status = 200) {
  const urls: string[] = [];
  const fetchImpl = ((url: string) => {
    urls.push(url);
    if (status !== 200) return Promise.resolve(new Response("{}", { status }));
    const u = new URL(url);
    const offset = Number(u.searchParams.get("offset")), limit = Number(u.searchParams.get("limit"));
    return Promise.resolve(new Response(JSON.stringify(rows.slice(offset, offset + limit))));
  }) as typeof fetch;
  return { urls, fetchImpl };
}

Deno.test("readBuckets: reads every page and keeps each bucket once", async () => {
  const buckets = owedOvernight("2026-09-29T10:00:00Z", "2026-09-30T10:00:00Z");
  const rows = buckets.flatMap((b) => ["AAPL", "MSTR", "NVDA", "TSLA", "ZZZZ", "AMD", "META", "GOOG", "AMZN", "MSFT", "PLTR"]
    .map(() => ({ bucket_time: b.replace(".000Z", "+00:00") })));  // 1,056 rows: two pages
  const pg = postgrest(rows);
  const got = await readBuckets("overnight_intraday_points", "bucket_time", "bucket_time.asc,ticker.asc",
    buckets[0], "2026-09-30T09:50:00.000Z", { sbUrl: "https://sb", serviceKey: "k", fetchImpl: pg.fetchImpl });
  assertEquals(got?.length, 96);
  assertEquals(pg.urls.length, 2);
  assert(pg.urls[0].includes("order=bucket_time.asc,ticker.asc&limit=1000&offset=0"), pg.urls[0]);
});

Deno.test("auditRecorder: reports a shortfall once, and a table it cannot read", async () => {
  const now = new Date("2026-09-30T10:00:20Z");
  const owed = owedBuckets(now.getTime() - WATCH_GRACE_MS - 24 * 3_600_000, now.getTime() - WATCH_GRACE_MS, shouldRecord);
  const reported: string[] = [];
  const report = (m: string) => { reported.push(m); return Promise.resolve(); };
  const half = postgrest(owed.slice(0, 48).map((b) => ({ bucket_time: b })));
  const line = await auditRecorder({
    recorder: "overnight-record", table: "overnight_intraday_points", column: "bucket_time",
    order: "bucket_time.asc,ticker.asc", now, owed: shouldRecord,
    env: { sbUrl: "https://sb", serviceKey: "k", fetchImpl: half.fetchImpl }, report,
  });
  assert(line?.includes("48 of the 96"), String(line));
  assertEquals(reported, [line]);
  const down = postgrest([], 503);
  await auditRecorder({
    recorder: "snapshot-record", table: "price_snapshots", column: "ts", order: "ts.asc", now,
    env: { sbUrl: "https://sb", serviceKey: "k", fetchImpl: down.fetchImpl }, report,
  });
  assertEquals(reported[1], "the audit of snapshot-record could not read price_snapshots.");
  assertEquals(BUCKET_MS, 300_000);
});
