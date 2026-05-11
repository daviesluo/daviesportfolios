// Pin tests for the fundamentals Edge Function's pure helpers — the
// ticker filter, the Finnhub raw-quarterly → TTM rolling-sum
// fallback, and the 3-year-average P/E computation. The Deno.serve
// entry point is guarded by `import.meta.main` so importing the
// helpers here does NOT bind a port.
//
// Run locally: `deno test --allow-env supabase/functions/fundamentals/`

import { assertEquals, assertAlmostEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isFundamentalsTicker, rollingTtmFromRawQuarterly, computePe3yAvg } from "./index.ts";

Deno.test("isFundamentalsTicker: keeps US equities", () => {
  for (const t of ["NVDA", "GOOG", "BRK-B", "AAPL"]) {
    assertEquals(isFundamentalsTicker(t), true);
  }
});

Deno.test("isFundamentalsTicker: drops CASH, .PVT placeholders, CN funds, futures, forex, crypto", () => {
  for (const t of ["CASH", "SPAX.PVT", "spax.pvt", "017731", "ES=F", "GBPUSD=X", "BTC-USD", "ETH-USD"]) {
    assertEquals(isFundamentalsTicker(t), false);
  }
});

Deno.test("isFundamentalsTicker: keeps the four ETF-proxied indices; drops others", () => {
  for (const t of ["^GSPC", "^NDX", "^RUT", "^SOX"]) {
    assertEquals(isFundamentalsTicker(t), true);
  }
  for (const t of ["^VIX", "^TNX", "^DJI"]) {
    assertEquals(isFundamentalsTicker(t), false);
  }
});

Deno.test("isFundamentalsTicker: rejects empty / whitespace input", () => {
  assertEquals(isFundamentalsTicker(""), false);
});

Deno.test("rollingTtmFromRawQuarterly: 5-quarter input produces 2 TTM points", () => {
  const raw = [
    { date: "2025-03-31", eps: 1.0 },
    { date: "2025-06-30", eps: 1.1 },
    { date: "2025-09-30", eps: 1.2 },
    { date: "2025-12-31", eps: 1.3 },  // first window closes here: sum = 4.6
    { date: "2026-03-31", eps: 1.4 },  // second window: 1.1 + 1.2 + 1.3 + 1.4 = 5.0
  ];
  const out = rollingTtmFromRawQuarterly(raw);
  assert(out !== null);
  assertEquals(out!.length, 2);
  assertEquals(out![0].date, "2025-12-31");
  assertAlmostEquals(out![0].eps, 4.6, 1e-9);
  assertEquals(out![1].date, "2026-03-31");
  assertAlmostEquals(out![1].eps, 5.0, 1e-9);
});

Deno.test("rollingTtmFromRawQuarterly: fewer than 4 quarters → null (can't form a TTM)", () => {
  const tooShort = [
    { date: "2025-12-31", eps: 1.0 },
    { date: "2026-03-31", eps: 1.1 },
    { date: "2026-06-30", eps: 1.2 },
  ];
  assertEquals(rollingTtmFromRawQuarterly(tooShort), null);
  assertEquals(rollingTtmFromRawQuarterly([]), null);
});

Deno.test("computePe3yAvg: averages the 3 most recent valid years", () => {
  const annual = [
    { period: "2021-12-31", v: 20 },
    { period: "2022-12-31", v: 25 },
    { period: "2023-12-31", v: 30 },
    { period: "2024-12-31", v: 35 },
  ];
  // Sorted desc → most recent 3: 35, 30, 25 → avg 30.
  assertAlmostEquals(computePe3yAvg(annual)!, 30, 1e-9);
});

Deno.test("computePe3yAvg: filters out non-positive / NaN values", () => {
  const annual = [
    { period: "2023-12-31", v: 30 },
    { period: "2024-12-31", v: 0 },     // zero — dropped
    { period: "2024-06-30", v: -5 },    // negative — dropped
    { period: "2022-12-31", v: "junk" }, // NaN — dropped
  ];
  // Only 2023's 30 survives → average = 30.
  assertAlmostEquals(computePe3yAvg(annual)!, 30, 1e-9);
});

Deno.test("computePe3yAvg: empty / non-array → null", () => {
  assertEquals(computePe3yAvg([]), null);
  // @ts-expect-error  testing wrong type explicitly
  assertEquals(computePe3yAvg(null), null);
});
