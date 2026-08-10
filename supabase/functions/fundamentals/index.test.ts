// Pin tests for the fundamentals Edge Function's pure helpers — the
// ticker filter, the Finnhub raw-quarterly → TTM rolling-sum
// fallback, and the 3-year-average P/E computation. The Deno.serve
// entry point is guarded by `import.meta.main` so importing the
// helpers here does NOT bind a port.
//
// Run locally: `deno test --allow-env supabase/functions/fundamentals/`

import { assertEquals, assertAlmostEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isFundamentalsTicker, rollingTtmFromRawQuarterly, computePe3yAvg,
  normalizeEpsHistoryToUsd,
  pickPsFields, computeForwardGrowth, computePeg, fiscalQuarterLabel,
} from "./index.ts";

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

// computePe3yAvg is generic over the `{ period, v }` shape — Finnhub's
// `series.annual.ps` has the same structure, so the function backs the
// P/S 3-year-average reference line on the loss-maker P/S YTD view too.
// Pin that contract here so a future "let's make this PE-specific"
// refactor breaks the test instead of the P/S chart.
Deno.test("computePe3yAvg is reused for ps3yAvg — same shape, same math", () => {
  const psAnnual = [
    { period: "2021-12-31", v: 6.0 },
    { period: "2022-12-31", v: 8.0 },
    { period: "2023-12-31", v: 10.0 },
    { period: "2024-12-31", v: 12.0 },
  ];
  // 3 most recent: 12, 10, 8 → avg 10. Identical handling regardless
  // of which metric the caller is summarising.
  assertAlmostEquals(computePe3yAvg(psAnnual)!, 10, 1e-9);
});


// --- ADR currency normalization (TSM / SFTBY) -----------------------

Deno.test("normalizeEpsHistoryToUsd: TSM-shape scales TWD-denominated history to USD", () => {
  // TSM ADR price ~$220 USD, Yahoo quoteSummary trailingEps ~8.3 USD.
  // Yahoo fundamentals-timeseries returns trailingDilutedEPS in TWD,
  // latest ~150 TWD. Without scaling, the modal divides USD prices by
  // TWD EPS and produces P/E ratios of ~1.4 — the exact bug the user
  // reported. After scaling, each historical entry is in USD so the
  // P/E ratio is sensible.
  const historyTwd = [
    { date: "2025-09-30", eps: 130 },
    { date: "2025-12-31", eps: 140 },
    { date: "2026-03-31", eps: 150 },  // latest, used as the FX-anchor
  ];
  const out = normalizeEpsHistoryToUsd(historyTwd, 8.3);
  assertEquals(out.length, 3);
  // Ratio = 8.3 / 150 = 0.05533... so the latest scales to exactly
  // the authoritative USD value.
  assertAlmostEquals(out[2].eps, 8.3, 1e-9);
  // Earlier entries scaled by the same ratio — relative shape preserved.
  assertAlmostEquals(out[0].eps, 130 * (8.3 / 150), 1e-9);
  assertAlmostEquals(out[1].eps, 140 * (8.3 / 150), 1e-9);
});

Deno.test("normalizeEpsHistoryToUsd: SFTBY-shape (JPY → USD)", () => {
  // SoftBank ADR price ~$18.60 USD, Yahoo quoteSummary trailingEps
  // ~1.2 USD. fundamentals-timeseries trailingDilutedEPS in JPY,
  // latest ~180 JPY. Without scaling the P/E shows ~0.07.
  const historyJpy = [
    { date: "2025-09-30", eps: 160 },
    { date: "2026-03-31", eps: 180 },
  ];
  const out = normalizeEpsHistoryToUsd(historyJpy, 1.2);
  assertAlmostEquals(out[1].eps, 1.2, 1e-9);
  assertAlmostEquals(out[0].eps, 160 * (1.2 / 180), 1e-9);
});

Deno.test("normalizeEpsHistoryToUsd: same-currency history (NVDA) passes through unchanged", () => {
  // NVDA reports in USD already; Yahoo trailingEps ~5.0, history
  // entries ~5.0. Ratio ≈ 1.0 — within the ±20 % no-op band so
  // the function returns the input as-is (preserves identity).
  const historyUsd = [
    { date: "2025-09-30", eps: 4.5 },
    { date: "2026-03-31", eps: 5.0 },
  ];
  const out = normalizeEpsHistoryToUsd(historyUsd, 5.0);
  // Same reference (no unnecessary copy) — important so callers can
  // share the array between modal series + cache without aliasing
  // concerns.
  assertEquals(out, historyUsd);
});

Deno.test("normalizeEpsHistoryToUsd: degenerate inputs (empty / NaN anchor / zero latest) → no scaling", () => {
  assertEquals(normalizeEpsHistoryToUsd([], 5), []);
  const input = [{ date: "2025-03-31", eps: 100 }];
  assertEquals(normalizeEpsHistoryToUsd(input, NaN), input);
  assertEquals(normalizeEpsHistoryToUsd(input, 0),   input);
  assertEquals(normalizeEpsHistoryToUsd([{ date: "2025-03-31", eps: 0 }], 5),
               [{ date: "2025-03-31", eps: 0 }]);
});

// --- ADR P/S currency-mismatch guard --------------------------------

Deno.test("pickPsFields: NVDA-shape (US-listed, sources agree) → trust Finnhub's 3Y avg", () => {
  // NVDA reports in USD; Yahoo and Finnhub agree on current P/S.
  // The 3Y average from Finnhub is in the same units and safe to use.
  const out = pickPsFields(28.0, 28.5, 24.3);
  assertEquals(out.ps, 28.0);
  assertEquals(out.ps3yAvg, 24.3);
});

Deno.test("pickPsFields: TSM-shape (ADR, Finnhub mixes USD price with TWD revenue) → drop 3Y avg", () => {
  // Yahoo's USD-USD P/S ~12. Finnhub divides USD market cap by TWD
  // revenue → ~360. Ratio ~30 — well outside (0.5, 2.0). The dashed
  // 3Y-AVG reference line would be off-scale by the same factor, so
  // we null it out rather than render a misleading marker.
  const out = pickPsFields(12.0, 360.0, 200.0);
  assertEquals(out.ps, 12.0);     // Yahoo's USD-USD value still wins
  assertEquals(out.ps3yAvg, null); // Finnhub's annual series dropped
});

Deno.test("pickPsFields: Finnhub absent → no annual cross-check possible, drop 3Y avg", () => {
  // Conservative default: without two sources to compare, we can't
  // tell whether Finnhub's annual series is in the same units as
  // the rendered P/S value. Safer to omit the reference line.
  const out = pickPsFields(28.0, 0, 24.0);
  assertEquals(out.ps, 28.0);
  assertEquals(out.ps3yAvg, null);
});

Deno.test("pickPsFields: Yahoo absent → fall back to Finnhub's psTTM, still drop 3Y avg", () => {
  // Yahoo doesn't always publish priceToSalesTrailing12Months for
  // brand-new IPOs. Use Finnhub as the fallback for the current
  // value but still don't render the reference line since the
  // cross-check can't run.
  const out = pickPsFields(0, 5.5, 4.2);
  assertEquals(out.ps, 5.5);
  assertEquals(out.ps3yAvg, null);
});

Deno.test("pickPsFields: both sources absent → ps:0, ps3yAvg:null", () => {
  assertEquals(pickPsFields(0, 0, 0),               { ps: 0, ps3yAvg: null });
  assertEquals(pickPsFields(undefined, null, null), { ps: 0, ps3yAvg: null });
  assertEquals(pickPsFields(NaN, NaN, NaN),         { ps: 0, ps3yAvg: null });
});

Deno.test("pickPsFields: boundary check — 2× exactly is treated as disagreement (strict <)", () => {
  // The window is the OPEN interval (0.5, 2.0) — values at exactly
  // 2× either way are NOT trusted. This keeps the rare borderline
  // case on the conservative side; if the cross-check ever fires
  // it should be on near-equal sources.
  const halfDisagree = pickPsFields(10.0, 20.0, 15.0);  // ratio exactly 0.5 (boundary)
  assertEquals(halfDisagree.ps3yAvg, null);
  const doubleDisagree = pickPsFields(20.0, 10.0, 15.0); // ratio exactly 2.0 (boundary)
  assertEquals(doubleDisagree.ps3yAvg, null);
  // Just inside the window — accepted.
  const slightlyInside = pickPsFields(19.0, 10.0, 15.0); // ratio 1.9
  assertEquals(slightlyInside.ps3yAvg, 15.0);
});

// --- PEG (forward P/E ÷ blended forward EPS-growth rate in %) ------

Deno.test("computePeg: textbook MU shape", () => {
  // Forward P/E ~36, blended forward growth ~0.30 → 30 %.
  // PEG = 36 / 30 = 1.2 (slightly overvalued by the classic rule
  // of thumb that PEG≈1 is fair value).
  const peg = computePeg(36, 0.30);
  assertAlmostEquals(peg!, 1.2, 1e-9);
});

Deno.test("computePeg: NVDA-shape (high growth, low PEG)", () => {
  // Forward P/E ~40 with forward growth ~40 % → PEG = 1.0.
  const peg = computePeg(40, 0.40);
  assertAlmostEquals(peg!, 1.0, 1e-9);
});

Deno.test("computePeg: missing forwardPE → null", () => {
  assertEquals(computePeg(0,         0.25), null);
  assertEquals(computePeg(NaN,       0.25), null);
  assertEquals(computePeg(undefined, 0.25), null);
  assertEquals(computePeg(null,      0.25), null);
});

Deno.test("computePeg: missing growth → null", () => {
  assertEquals(computePeg(30, 0),         null);
  assertEquals(computePeg(30, NaN),       null);
  assertEquals(computePeg(30, undefined), null);
  assertEquals(computePeg(30, null),      null);
});

Deno.test("computePeg: negative growth → null (data vendors hide PEG in this case)", () => {
  // Negative expected growth means PEG itself comes out negative,
  // which makes no interpretive sense for a "fair-value at ~1"
  // metric. Better to omit the value than render -2.4 and let the
  // user puzzle over it.
  assertEquals(computePeg(30, -0.10), null);
});

Deno.test("computePeg: growth expressed as a decimal, not percentage", () => {
  // Sanity-pin the convention. Yahoo's earningsTrend.growth.raw is
  // a decimal (0.225 = 22.5 %); the implementation multiplies by
  // 100 internally. Two ways to express 22.5 % would diverge by
  // 100x otherwise.
  assertAlmostEquals(computePeg(30, 0.225)!, 30 / 22.5, 1e-9);
});

// --- computeForwardGrowth (blended 2y forward EPS growth) ----------
//
// The PEG denominator. Pins the shape of Yahoo's earningsTrend
// buckets after the May-2026 change that removed the '+5y'
// long-term-growth bucket — see the function doc. Cases use the real
// AVGO numbers from the prod probe so the regression target is
// concrete.

Deno.test("computeForwardGrowth: averages the 0y and +1y annual buckets", () => {
  // AVGO, May-2026 prod probe: 0y +67.53 %, +1y +58.57 %. Quarterly
  // buckets are present in the real payload but must be ignored —
  // their growth is quarter-over-year-ago-quarter, not annual.
  const trend = [
    { period: "0q",  growth: { raw: 0.513 } },
    { period: "+1q", growth: { raw: 0.91730005 } },
    { period: "0y",  growth: { raw: 0.6753 } },
    { period: "+1y", growth: { raw: 0.5857 } },
  ];
  assertAlmostEquals(computeForwardGrowth(trend)!, (0.6753 + 0.5857) / 2, 1e-9);
});

Deno.test("computeForwardGrowth: only one annual bucket present → use it alone", () => {
  assertAlmostEquals(
    computeForwardGrowth([{ period: "0y", growth: { raw: 0.30 } }])!, 0.30, 1e-9);
  assertAlmostEquals(
    computeForwardGrowth([{ period: "+1y", growth: { raw: 0.18 } }])!, 0.18, 1e-9);
});

Deno.test("computeForwardGrowth: non-positive buckets are dropped before averaging", () => {
  // +1y consensus calls for a down year — exclude it and fall back to
  // 0y alone rather than let the negative drag the blend into nonsense.
  assertAlmostEquals(
    computeForwardGrowth([
      { period: "0y",  growth: { raw: 0.40 } },
      { period: "+1y", growth: { raw: -0.05 } },
    ])!, 0.40, 1e-9);
});

Deno.test("computeForwardGrowth: no usable annual bucket → null", () => {
  // Quarterly-only trend (no 0y / +1y at all).
  assertEquals(computeForwardGrowth([
    { period: "0q",  growth: { raw: 0.5 } },
    { period: "+1q", growth: { raw: 0.6 } },
  ]), null);
  // Both annual buckets non-positive.
  assertEquals(computeForwardGrowth([
    { period: "0y",  growth: { raw: -0.1 } },
    { period: "+1y", growth: { raw: 0 } },
  ]), null);
  // Growth field missing / malformed.
  assertEquals(computeForwardGrowth([{ period: "0y" }]), null);
  assertEquals(computeForwardGrowth([{ period: "0y", growth: { raw: "junk" } }]), null);
});

Deno.test("computeForwardGrowth: non-array input → null", () => {
  assertEquals(computeForwardGrowth(null), null);
  assertEquals(computeForwardGrowth(undefined), null);
  assertEquals(computeForwardGrowth([]), null);
  assertEquals(computeForwardGrowth("nope"), null);
});

Deno.test("computeForwardGrowth → computePeg: AVGO end-to-end (May 2026 probe)", () => {
  // The whole PEG pipeline on real prod-probe numbers: forwardPE 23.0
  // ÷ blended 63.05 % ≈ 0.365. This is the regression target for the
  // '+5y'-bucket-removal fix — if Yahoo's bucket layout shifts again
  // or the blend math drifts, this breaks.
  const trend = [
    { period: "0y",  growth: { raw: 0.6753 } },
    { period: "+1y", growth: { raw: 0.5857 } },
  ];
  const g = computeForwardGrowth(trend);
  assert(g !== null);
  const peg = computePeg(23.0, g);
  assertAlmostEquals(peg!, 23.0 / (((0.6753 + 0.5857) / 2) * 100), 1e-9);
});

// ---------------- fiscalQuarterLabel ----------------
// Yahoo's own currentQuarterEstimateDate/Year are CALENDAR quarters, so
// they only agree with the company's own numbering for calendar-year
// filers. These four cases are real quoteSummary data (probed 2026-08)
// checked against what each company actually calls the quarter.
const secs = (iso: string) => Math.floor(Date.parse(iso + "T00:00:00Z") / 1000);

Deno.test("fiscalQuarterLabel: calendar-year filer (RKLB) — Jun-2026 quarter is FY26Q2", () => {
  assertEquals(fiscalQuarterLabel("2026-06-30", secs("2025-12-31")), "FY26Q2");
});

Deno.test("fiscalQuarterLabel: Jan year-end (NVDA) — Jul-2026 quarter is FY27Q2, not Yahoo's '2Q 2026'", () => {
  assertEquals(fiscalQuarterLabel("2026-07-31", secs("2026-01-25")), "FY27Q2");
  // …and its Apr-2026 quarter is Q1 of that same fiscal year.
  assertEquals(fiscalQuarterLabel("2026-04-26", secs("2026-01-25")), "FY27Q1");
});

Deno.test("fiscalQuarterLabel: Sep year-end (AAPL) — the year-end quarter itself is Q4", () => {
  assertEquals(fiscalQuarterLabel("2026-09-30", secs("2025-09-27")), "FY26Q4");
  // The June quarter of the same fiscal year is Q3.
  assertEquals(fiscalQuarterLabel("2026-06-27", secs("2025-09-27")), "FY26Q3");
});

Deno.test("fiscalQuarterLabel: Aug year-end (MU) — Aug-2026 quarter is FY26Q4", () => {
  assertEquals(fiscalQuarterLabel("2026-08-31", secs("2025-08-28")), "FY26Q4");
  // Nov-2026 starts the next fiscal year.
  assertEquals(fiscalQuarterLabel("2026-11-30", secs("2025-08-28")), "FY27Q1");
});

Deno.test("fiscalQuarterLabel: null on missing / unparseable inputs", () => {
  assertEquals(fiscalQuarterLabel(null, secs("2025-12-31")), null);
  assertEquals(fiscalQuarterLabel(undefined, secs("2025-12-31")), null);
  assertEquals(fiscalQuarterLabel("not-a-date", secs("2025-12-31")), null);
  assertEquals(fiscalQuarterLabel("2026-06-30", 0), null);
  assertEquals(fiscalQuarterLabel("2026-06-30", null), null);
});
