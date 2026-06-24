// Pin tests for the prices Edge Function's pure helpers — UTC →
// exchange-local minute conversion, the outside-RTH predicate, and
// the day-pct formula. The Deno.serve entry point is guarded by
// `import.meta.main` so importing the helpers here does NOT bind a
// port.
//
// Run locally: `deno test --allow-env supabase/functions/prices/`

import { assertEquals, assertAlmostEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { localMinOfDay, isOutsideRth, pctChange, closeNearest24hAgo, localDayNumber, rthSessionCloses } from "./index.ts";

Deno.test("localMinOfDay: New York 09:30 ET (EDT, gmtoffset=-14400) at 13:30 UTC = 570 minutes", () => {
  // 2026-05-11 13:30:00 UTC → 09:30:00 EDT (gmtoffset -14400 s)
  const utcSec = Math.floor(new Date("2026-05-11T13:30:00Z").getTime() / 1000);
  assertEquals(localMinOfDay(utcSec, -14400), 9 * 60 + 30);
});

Deno.test("localMinOfDay: New York 16:00 ET (EST, gmtoffset=-18000) at 21:00 UTC = 960 minutes", () => {
  // 2026-01-15 21:00:00 UTC → 16:00:00 EST (gmtoffset -18000 s)
  const utcSec = Math.floor(new Date("2026-01-15T21:00:00Z").getTime() / 1000);
  assertEquals(localMinOfDay(utcSec, -18000), 16 * 60);
});

Deno.test("localMinOfDay: wraps day boundaries cleanly", () => {
  // 2026-05-11 00:00:00 UTC with offset +28800 (Asia/Hong Kong) →
  // local 08:00 same day, but with the prior-day-overflow modulo path.
  const utcSec = Math.floor(new Date("2026-05-11T00:00:00Z").getTime() / 1000);
  assertEquals(localMinOfDay(utcSec, 8 * 3600), 8 * 60);
  // 2026-05-11 23:30:00 UTC, exchange offset -18000 (NY EST) → 18:30 ET (1110 min)
  const utcSec2 = Math.floor(new Date("2026-05-11T23:30:00Z").getTime() / 1000);
  assertEquals(localMinOfDay(utcSec2, -18000), 18 * 60 + 30);
});

Deno.test("isOutsideRth: pre-market and after-hours = true", () => {
  assertEquals(isOutsideRth(8 * 60),       true);   // 08:00 pre-market
  assertEquals(isOutsideRth(9 * 60 + 29),  true);   // one minute before open
  assertEquals(isOutsideRth(16 * 60),      true);   // 16:00 is the close → first AH bar
  assertEquals(isOutsideRth(20 * 60),      true);   // 20:00 after-hours
});

Deno.test("isOutsideRth: regular session = false", () => {
  assertEquals(isOutsideRth(9 * 60 + 30),  false);  // 09:30 opening minute
  assertEquals(isOutsideRth(12 * 60),      false);  // 12:00 mid-session
  assertEquals(isOutsideRth(15 * 60 + 59), false);  // last regular-session minute
});

Deno.test("pctChange: positive / negative / no-change", () => {
  assertAlmostEquals(pctChange(110, 100),  10,   1e-9);
  assertAlmostEquals(pctChange( 90, 100), -10,   1e-9);
  assertAlmostEquals(pctChange(100, 100),   0,   1e-9);
});

Deno.test("pctChange: returns 0 when prevClose is missing / non-positive", () => {
  assertEquals(pctChange(100, 0),   0);
  assertEquals(pctChange(100, -1),  0);
  assertEquals(pctChange(100, NaN), 0);
});

Deno.test("closeNearest24hAgo: picks the candle closest to 24h ago", () => {
  const now = 1_700_000_000;        // fixed "now" in unix seconds
  const t24 = now - 86400;          // exactly 24h ago
  // 5-min candles straddling the 24h mark; closes encode their identity.
  const timestamps = [t24 - 600, t24 - 300, t24 + 120, t24 + 600];
  const closes     = [100,        101,       102,       103];
  // Offsets from t24 are [600, 300, 120, 600] → index 2 (102) is nearest.
  assertEquals(closeNearest24hAgo(timestamps, closes, now), 102);
});

Deno.test("closeNearest24hAgo: skips null / non-positive closes", () => {
  const now = 1_700_000_000;
  const t24 = now - 86400;
  const timestamps = [t24 - 60, t24, t24 + 60];
  const closes     = [50,       null, 0];   // exact-match bar is null; next is 0
  // Both nearer bars are unusable → falls back to the 50 candle.
  assertEquals(closeNearest24hAgo(timestamps, closes, now), 50);
});

Deno.test("closeNearest24hAgo: null when the window doesn't reach 24h back", () => {
  const now = 1_700_000_000;
  // Only the last ~40 min of candles (a calendar-day fetch just after the
  // UTC roll) — nothing within 6h of the 24h-ago mark, so the caller falls
  // back to the meta previous-close rather than anchoring on a 40-min-old bar.
  const timestamps = [now - 2400, now - 1200, now - 300];
  const closes     = [200,        201,        202];
  assertEquals(closeNearest24hAgo(timestamps, closes, now), null);
});

Deno.test("closeNearest24hAgo: null for empty or non-array input", () => {
  const now = 1_700_000_000;
  assertEquals(closeNearest24hAgo([], [], now), null);
  assertEquals(closeNearest24hAgo(null as unknown as number[], [], now), null);
});

const EDT = -14400; // America/New_York summer offset (seconds)
const tsOf = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

Deno.test("localDayNumber: same local day within RTH, +1 across local midnight", () => {
  // 09:30 and 16:00 ET on the same date → same day number.
  assertEquals(
    localDayNumber(tsOf("2026-06-15T09:30:00-04:00"), EDT),
    localDayNumber(tsOf("2026-06-15T16:00:00-04:00"), EDT),
  );
  // 23:00 ET → next-day 01:00 ET differ by exactly 1.
  assertEquals(
    localDayNumber(tsOf("2026-06-16T01:00:00-04:00"), EDT) -
    localDayNumber(tsOf("2026-06-15T23:00:00-04:00"), EDT),
    1,
  );
});

Deno.test("rthSessionCloses: real 16:00-ET close today + previous session close", () => {
  // Pre / post-market bars (bogus) must be skipped; a missing (null) 16:00
  // print falls back to the 15:55 close. Walk picks today's last in-session
  // close (`last`) and the prior local day's last in-session close (`prev`).
  const rows: Array<[string, number | null]> = [
    ["2026-06-12T15:50:00-04:00", 49],   // RTH (prev day)
    ["2026-06-12T15:55:00-04:00", 50],   // prev-day close ← prev
    ["2026-06-12T17:00:00-04:00", 99],   // post-market bogus (skip)
    ["2026-06-15T09:00:00-04:00", 98],   // pre-market bogus (skip)
    ["2026-06-15T15:50:00-04:00", 51],   // RTH (today)
    ["2026-06-15T15:55:00-04:00", 52],   // today close ← last
    ["2026-06-15T16:00:00-04:00", null], // missing close (skip → 15:55 wins)
    ["2026-06-15T18:00:00-04:00", 97],   // post-market bogus (skip)
  ];
  const timestamps = rows.map((r) => tsOf(r[0] as string));
  const closes = rows.map((r) => r[1]);
  assertEquals(rthSessionCloses(timestamps, closes, EDT), { last: 52, prev: 50 });
});

Deno.test("rthSessionCloses: prev null when only one session is present", () => {
  const timestamps = [tsOf("2026-06-15T15:50:00-04:00"), tsOf("2026-06-15T15:55:00-04:00")];
  assertEquals(rthSessionCloses(timestamps, [51, 52], EDT), { last: 52, prev: null });
});

Deno.test("rthSessionCloses: null/null when every candle is out of session", () => {
  const timestamps = [tsOf("2026-06-15T08:00:00-04:00"), tsOf("2026-06-15T18:00:00-04:00")];
  assertEquals(rthSessionCloses(timestamps, [10, 11], EDT), { last: null, prev: null });
  assertEquals(rthSessionCloses(null as unknown as number[], [], EDT), { last: null, prev: null });
});
