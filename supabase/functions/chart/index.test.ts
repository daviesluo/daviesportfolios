// Pin tests for the pure helpers exported by ./index.ts. The
// Deno.serve(...) entry point is guarded by `import.meta.main` so
// importing it here does NOT start the HTTP server — only the
// functions in this file run.
//
// Run locally: `deno test --allow-env supabase/functions/chart/`
// CI runs the same via the deploy workflow.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { rangeCutoffMs, trimToRange } from "./index.ts";

Deno.test("rangeCutoffMs: ytd anchors to Jan 1 of current year (minus 1-week buffer)", () => {
  const cutoff = rangeCutoffMs("ytd");
  const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();
  // Cutoff is yearStart − 7d, so the prior-year-end close is retained
  // (otherwise YTD's "since end of last year" math is off by a bar).
  assertEquals(cutoff, yearStart - 7 * 86_400_000);
});

Deno.test("rangeCutoffMs: 1y / 6mo / 3mo / 1mo map to rolling windows", () => {
  const now = Date.now();
  // Cutoffs use Date.now() so they shift slightly between calls — allow ±1s slack.
  const within = (a: number, b: number) => Math.abs(a - b) < 1000;
  assert(within(rangeCutoffMs("1y"),  now - 380 * 86_400_000));
  assert(within(rangeCutoffMs("1Y"),  now - 380 * 86_400_000));  // case insensitive
  assert(within(rangeCutoffMs("6mo"), now - 200 * 86_400_000));
  assert(within(rangeCutoffMs("3mo"), now - 100 * 86_400_000));
  assert(within(rangeCutoffMs("1mo"), now -  35 * 86_400_000));
});

Deno.test("rangeCutoffMs: unknown range = 0 (keep everything)", () => {
  assertEquals(rangeCutoffMs("max"), 0);
  assertEquals(rangeCutoffMs(""), 0);
});

Deno.test("trimToRange: filters out points older than the cutoff", () => {
  const today = new Date();
  const points = [
    { date: "2020-01-01", close: 1 },                                       // way before YTD
    { date: `${today.getFullYear() - 1}-12-30`, close: 2 },                  // inside YTD's 1-week buffer
    { date: `${today.getFullYear()}-01-15`,     close: 3 },                  // inside YTD
  ];
  const out = trimToRange(points, "ytd");
  // The 2020 point is dropped; the buffered prior-year and current-year points stay.
  assertEquals(out.length, 2);
  assertEquals(out[0].date, `${today.getFullYear() - 1}-12-30`);
  assertEquals(out[1].close, 3);
});

Deno.test("trimToRange: empty input or zero cutoff is a no-op", () => {
  assertEquals(trimToRange([], "ytd"), []);
  const all = [{ date: "1990-01-01", close: 1 }, { date: "2020-01-01", close: 2 }];
  assertEquals(trimToRange(all, "max"), all);
});

Deno.test("trimToRange: falls back to original points if filter removes everything", () => {
  // Pingzhongdata sometimes returns sparse history (e.g. only one
  // multi-year-old point). The function preserves it so the caller
  // can still render *something* rather than returning an empty
  // series and triggering "no data" in the UI.
  const ancient = [{ date: "2010-01-01", close: 1 }];
  assertEquals(trimToRange(ancient, "ytd"), ancient);
});
