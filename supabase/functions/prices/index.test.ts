// Pin tests for the prices Edge Function's pure helpers — UTC →
// exchange-local minute conversion, the outside-RTH predicate, and
// the day-pct formula. The Deno.serve entry point is guarded by
// `import.meta.main` so importing the helpers here does NOT bind a
// port.
//
// Run locally: `deno test --allow-env supabase/functions/prices/`

import { assertEquals, assertAlmostEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { localMinOfDay, isOutsideRth, pctChange } from "./index.ts";

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
