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
  pickPsFields, computePeg, compute3yCagrFromEstimates,
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

// --- FMP primary source (ADR-currency-safe) -------------------------
//
// FMP_API_KEY is read at module load time (`Deno.env.get(...)`), so
// these tests can't dynamically inject a key — they exercise the
// response-parsing logic by stubbing `fetch` to return a known FMP
// shape, and rely on the module having been loaded with the key
// present (CI sets it; locally `deno test --env FMP_API_KEY=...`).
// Without a key the function short-circuits and returns `{}`,
// which is itself pinned below as the "no-key" path.

import { fetchFmpQuoteBatched } from "./index.ts";

// FMP's `/v3/quote/<symbols>` response shape: a JSON array of rows
// with `symbol`, `pe`, `eps` (USD), plus a bunch of other fields we
// ignore. ADR rows like TSM come back already-USD-normalized because
// the ADR's price IS in USD on US exchanges and FMP computes its pe
// from that against the appropriately-converted EPS.
function stubFmpFetch(responseBody: unknown, opts: { ok?: boolean } = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = ((async () => {
    return {
      ok: opts.ok ?? true,
      json: async () => responseBody,
    } as any;
  }) as any);
  return () => { globalThis.fetch = original; };
}

Deno.test("fetchFmpQuoteBatched: empty input → empty object", async () => {
  // No symbols → no fetch fired, even before checking the API key.
  assertEquals(await fetchFmpQuoteBatched([]), {});
});

Deno.test("fetchFmpQuoteBatched: parses TSM/SFTBY/ASML ADR rows with USD-normalized pe/eps", async () => {
  if (!Deno.env.get("FMP_API_KEY")) return; // skip when no key
  const restore = stubFmpFetch([
    { symbol: "TSM",   pe: 30.5,  eps: 8.3 },
    { symbol: "SFTBY", pe: 15.2,  eps: 1.2 },
    { symbol: "ASML",  pe: 33.1,  eps: 26.4 },
  ]);
  try {
    const out = await fetchFmpQuoteBatched(["TSM", "SFTBY", "ASML"]);
    assertEquals(Object.keys(out).sort(), ["ASML", "SFTBY", "TSM"]);
    assertAlmostEquals(out.TSM.pe,   30.5, 1e-9);
    assertAlmostEquals(out.TSM.eps,   8.3, 1e-9);
    assertAlmostEquals(out.SFTBY.pe, 15.2, 1e-9);
    assertAlmostEquals(out.ASML.eps, 26.4, 1e-9);
  } finally { restore(); }
});

Deno.test("fetchFmpQuoteBatched: skips rows with missing / invalid pe or eps", async () => {
  if (!Deno.env.get("FMP_API_KEY")) return;
  const restore = stubFmpFetch([
    { symbol: "VALID",  pe: 25, eps: 5 },
    { symbol: "NEGPE",  pe: -3, eps: 5 },         // loss-maker pe — skip
    { symbol: "ZEROEPS", pe: 25, eps: 0 },         // skip
    { symbol: "NULLPE", pe: null, eps: 5 },        // skip
    { symbol: "NOEPS",  pe: 30 },                  // missing eps — skip
    { pe: 25, eps: 5 },                            // missing symbol — skip
  ]);
  try {
    const out = await fetchFmpQuoteBatched(["VALID", "NEGPE", "ZEROEPS", "NULLPE", "NOEPS"]);
    assertEquals(Object.keys(out), ["VALID"]);
    assertEquals(out.VALID.pe, 25);
  } finally { restore(); }
});

Deno.test("fetchFmpQuoteBatched: !ok / non-array body / fetch throws → empty object (clean fall-through)", async () => {
  if (!Deno.env.get("FMP_API_KEY")) return;
  const cases: Array<[unknown, { ok?: boolean }]> = [
    [{}, { ok: true }],                  // non-array body
    [{ Error: "rate limit" }, { ok: true }], // FMP's error envelope
    [[], { ok: false }],                 // 401 / 429 — http error
  ];
  for (const [body, opts] of cases) {
    const restore = stubFmpFetch(body, opts);
    try {
      const out = await fetchFmpQuoteBatched(["AAPL"]);
      assertEquals(out, {});
    } finally { restore(); }
  }
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

// --- PEG (forward P/E ÷ forward 5y EPS-growth CAGR in %) -----------

Deno.test("computePeg: textbook MU shape", () => {
  // Forward P/E ~36, analyst-consensus 5y growth ~0.30 → 30 %.
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

// --- 3y forward EPS-CAGR from FMP analyst-estimates -----------------

// Full ISO timestamp (not date-only). The function parses with
// `new Date(e.date).getTime()` and divides by exactly-one-year to
// derive the CAGR's exponent — truncating to YYYY-MM-DD would
// round-trip through midnight UTC and skew `years` by up to ~0.001,
// which is enough to push Math.pow's result well past a 1e-6
// tolerance on the textbook case. Tests pin the actual math, not
// the date precision of the FMP feed.
const yearsFromNow = (years: number) => {
  return new Date(Date.now() + years * 365 * 86400_000).toISOString();
};

Deno.test("compute3yCagrFromEstimates: textbook MU shape", () => {
  // Current TTM EPS = 5; analysts call ~20% / yr → year+3 EPS ~8.64.
  // CAGR over 3 years should land on 0.20.
  const estimates = [
    { date: yearsFromNow(1), estimatedEpsAvg: 6.0 },
    { date: yearsFromNow(2), estimatedEpsAvg: 7.2 },
    { date: yearsFromNow(3), estimatedEpsAvg: 5 * Math.pow(1.20, 3) }, // ≈ 8.64
  ];
  const cagr = compute3yCagrFromEstimates(5, estimates);
  assertAlmostEquals(cagr!, 0.20, 1e-6);
});

Deno.test("compute3yCagrFromEstimates: picks the estimate closest to today + 3y when no exact match", () => {
  // AAPL-style fiscal Sep; the year+3 estimate might land at year+2.7
  // or year+3.3 calendar-wise. We pick whichever is closer and
  // compute the CAGR over the actual elapsed time so the math is
  // consistent across fiscal calendars.
  const estimates = [
    { date: yearsFromNow(0.7), estimatedEpsAvg: 6 },
    { date: yearsFromNow(2.8), estimatedEpsAvg: 9 },  // closest to 3y target
    { date: yearsFromNow(4.5), estimatedEpsAvg: 12 },
  ];
  const cagr = compute3yCagrFromEstimates(5, estimates);
  // (9/5)^(1/2.8) - 1
  assertAlmostEquals(cagr!, Math.pow(9 / 5, 1 / 2.8) - 1, 1e-6);
});

Deno.test("compute3yCagrFromEstimates: ignores historical / past-dated rows", () => {
  // FMP's analyst-estimates response sometimes includes the prior
  // fiscal year as a reference. Those shouldn't be picked as the
  // "year+3" target — confirm by feeding past-dated rows first.
  const estimates = [
    { date: yearsFromNow(-2), estimatedEpsAvg: 3 },
    { date: yearsFromNow(-1), estimatedEpsAvg: 4 },
    { date: yearsFromNow(3),  estimatedEpsAvg: 10 },
  ];
  const cagr = compute3yCagrFromEstimates(5, estimates);
  assertAlmostEquals(cagr!, Math.pow(10 / 5, 1 / 3) - 1, 1e-6);
});

Deno.test("compute3yCagrFromEstimates: rejects when current EPS is missing / non-positive (loss-maker)", () => {
  const estimates = [{ date: yearsFromNow(3), estimatedEpsAvg: 10 }];
  assertEquals(compute3yCagrFromEstimates(0, estimates), null);
  assertEquals(compute3yCagrFromEstimates(-1, estimates), null);
  assertEquals(compute3yCagrFromEstimates(NaN, estimates), null);
  assertEquals(compute3yCagrFromEstimates(null, estimates), null);
});

Deno.test("compute3yCagrFromEstimates: rejects when estimates are empty / invalid / all-past", () => {
  assertEquals(compute3yCagrFromEstimates(5, null), null);
  assertEquals(compute3yCagrFromEstimates(5, []), null);
  assertEquals(compute3yCagrFromEstimates(5, [
    { date: yearsFromNow(-1), estimatedEpsAvg: 4 },
  ]), null);
});

Deno.test("compute3yCagrFromEstimates: requires ≥ 1 year horizon (next-quarter estimate is not a CAGR)", () => {
  // A quarter-out estimate shouldn't be annualised as a 3y CAGR —
  // that would amplify quarterly noise. Skip when the closest
  // available row is less than a year away.
  const estimates = [
    { date: yearsFromNow(0.25), estimatedEpsAvg: 6 },
  ];
  assertEquals(compute3yCagrFromEstimates(5, estimates), null);
});

Deno.test("compute3yCagrFromEstimates: negative growth flows through (computePeg drops it)", () => {
  // Earnings expected to shrink. The CAGR is negative; computePeg's
  // own guard catches it. compute3yCagrFromEstimates stays
  // contract-pure and returns the raw rate.
  const estimates = [
    { date: yearsFromNow(3), estimatedEpsAvg: 3 },  // shrinks from 5 → 3
  ];
  const cagr = compute3yCagrFromEstimates(5, estimates);
  assertAlmostEquals(cagr!, Math.pow(3 / 5, 1 / 3) - 1, 1e-6);  // ≈ -0.156
  // Sanity: computePeg should refuse to coin a PEG out of it.
  assertEquals(computePeg(30, cagr), null);
});
