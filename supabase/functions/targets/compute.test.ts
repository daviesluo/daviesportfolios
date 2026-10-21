// Pins the analyst-target snapshots (compute.ts) with figures worked out by hand: what is read of a quoteSummary, a stock's
// consensus, the 30-day fresh window, an ETF's holdings-weighted target, bitcoin's hand-kept table, and the symbols tried
// for an Asian listing.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type Analyst, consensusSnapshot, freshTargets, holdingsSnapshot, parseAnalyst, strategistSnapshot, yahooSymbolCandidates } from "./compute.ts";
import { STRATEGIST_AS_OF, STRATEGIST_TARGETS } from "./strategists.ts";

const NOW = Date.parse("2026-10-21T13:30:00Z");
const sec = (iso: string) => Date.parse(iso) / 1000;

// A quoteSummary result trimmed from RKLB's of 2026-10-21 (its financialData as served; three history entries).
const RKLB = {
  financialData: {
    currentPrice: { raw: 53.39, fmt: "53.39" }, targetHighPrice: { raw: 150 }, targetLowPrice: { raw: 64 },
    targetMeanPrice: { raw: 102.15 }, recommendationMean: { raw: 1.619 }, numberOfAnalystOpinions: { raw: 20 },
  },
  price: { currency: "USD", regularMarketPrice: { raw: 53.4 } },
  upgradeDowngradeHistory: {
    history: [
      // Out of order on purpose: the newest action of a firm is the one kept.
      { epochGradeDate: sec("2026-08-01T12:00:00Z"), firm: "Citizens", action: "main", currentPriceTarget: 130, priorPriceTarget: 110 },
      { epochGradeDate: sec("2026-10-19T12:00:00Z"), firm: "Citizens", action: "main", priceTargetAction: "Lowers", currentPriceTarget: 90, priorPriceTarget: 130 },
      // A 0 is "no target given with this action": the firm's newest action that gives one (75, in August) stands.
      { epochGradeDate: sec("2026-10-10T12:00:00Z"), firm: "KeyBanc", action: "init", currentPriceTarget: 0 },
      { epochGradeDate: sec("2026-08-15T12:00:00Z"), firm: "KeyBanc", action: "main", currentPriceTarget: 75 },
      { epochGradeDate: sec("2026-10-01T12:00:00Z"), firm: "Cantor", action: "main", currentPriceTarget: 120 },
    ],
  },
};

Deno.test("parseAnalyst: the financialData figures, and each firm's newest action that carries a target", () => {
  const a = parseAnalyst(RKLB) as Analyst;
  assertEquals([a.currency, a.price, a.mean, a.low, a.high, a.rating, a.analysts], ["USD", 53.39, 102.15, 64, 150, 1.619, 20]);
  assertEquals(a.history, [
    { firm: "Citizens", target: 90, at: "2026-10-19T12:00:00.000Z" },
    { firm: "Cantor", target: 120, at: "2026-10-01T12:00:00.000Z" },
    { firm: "KeyBanc", target: 75, at: "2026-08-15T12:00:00.000Z" },
  ]);
  assertEquals(parseAnalyst(null), null);
  // An ETF's topHoldings, with Yahoo's fractions.
  const etf = parseAnalyst({ price: { currency: "USD", regularMarketPrice: { raw: 10.056 } }, topHoldings: { holdings: [{ symbol: "2330.TW", holdingPercent: { raw: 0.118 } }, { symbol: "", holdingPercent: { raw: 0.01 } }] } }) as Analyst;
  assertEquals([etf.price, etf.mean, etf.holdings], [10.056, null, [{ symbol: "2330.TW", weight: 0.118 }]]);
});

Deno.test("consensusSnapshot: Yahoo's figures; the targets list keeps the last 45 days; no mean, no row", () => {
  const s = consensusSnapshot("RKLB", parseAnalyst(RKLB), NOW)!;
  assertEquals([s.kind, s.currency, s.refPrice, s.mean, s.low, s.high, s.rating, s.analysts], ["consensus", "USD", 53.39, 102.15, 64, 150, 1.619, 20]);
  // 2026-08-15 is 67 days before NOW: out.
  assertEquals(s.targets.map((t) => t.firm), ["Citizens", "Cantor"]);
  assertEquals(consensusSnapshot("X", parseAnalyst({ price: { currency: "USD" } }), NOW), null);
});

Deno.test("consensusSnapshot: a mean under a fifth of the price, or over five times it, is taken for a unit mix-up", () => {
  const at = (price: number, mean: number) => parseAnalyst({ financialData: { currentPrice: { raw: price }, targetMeanPrice: { raw: mean } }, price: { currency: "GBp" } });
  assertEquals(consensusSnapshot("X.L", at(1000, 12), NOW), null);     // a price in pence, a target in pounds
  assertEquals(consensusSnapshot("X.L", at(10, 1200), NOW), null);     // the other way round
  assertEquals(consensusSnapshot("X.L", at(100, 20), NOW)?.mean, 20);  // the bounds themselves are kept
  assertEquals(consensusSnapshot("X.L", at(100, 500), NOW)?.mean, 500);
});

Deno.test("freshTargets: set in the last 30 days, not in the future", () => {
  const t = (at: string) => ({ firm: at, target: 1, at });
  const list = [t("2026-10-21T13:31:00.000Z"), t("2026-10-21T13:30:00.000Z"), t("2026-09-21T13:30:00.000Z"), t("2026-09-21T13:29:59.000Z")];
  assertEquals(freshTargets(list, NOW).map((x) => x.at), ["2026-10-21T13:30:00.000Z", "2026-09-21T13:30:00.000Z"]);
  assertEquals(freshTargets(list, NOW, 7).length, 1);
});

/** A constituent as quoteSummary reads, for the weighted target. */
const firm = (price: number, mean: number, low: number, high: number, analysts: number | null, history: Array<[number, string]> = []): Analyst =>
  ({ currency: "USD", price, mean, low, high, rating: 2, analysts, holdings: [], history: history.map(([target, at], i) => ({ firm: `F${i}`, target, at })) });

Deno.test("holdingsSnapshot: ratios to each holding's price, weighted, put on the ETF's price (worked by hand)", () => {
  // A: 30 % of the ETF, priced 50: mean 60 (1.2×), low 40 (0.8×), high 80 (1.6×), 10 analysts; fresh targets 55 and 70
  //    (1.1× and 1.4×), one 40 days old (out). B: 20 %, priced 200: mean 220 (1.1×), low 180 (0.9×), high 300 (1.5×),
  //    20 analysts, nothing fresh. C: 10 %, no data (uncovered). D: 5 %, a mean 6× its price (refused).
  //   covered weight 0.5; mean 100 × (0.3·1.2 + 0.2·1.1) / 0.5 = 116; low 100 × (0.24 + 0.18) / 0.5 = 84;
  //   high 100 × (0.48 + 0.30) / 0.5 = 156; analysts median(10, 20) = 15;
  //   fresh over A alone: low 100 × 1.1 = 110, high 100 × 1.4 = 140, 2 targets.
  const data = new Map<string, Analyst | null>([
    ["A", firm(50, 60, 40, 80, 10, [[55, "2026-10-15T00:00:00.000Z"], [70, "2026-10-01T00:00:00.000Z"], [90, "2026-09-11T00:00:00.000Z"]])],
    ["B", firm(200, 220, 180, 300, 20)],
    ["C", null],
    ["D", firm(10, 60, 50, 70, 3)],
  ]);
  const s = holdingsSnapshot("SAEM.L", [{ symbol: "A", weight: 0.3 }, { symbol: "B", weight: 0.2 }, { symbol: "C", weight: 0.1 }, { symbol: "D", weight: 0.05 }], data, { price: 100, currency: "USD" }, NOW, "test")!;
  assertEquals([s.kind, s.currency, s.refPrice, s.mean, s.low, s.high, s.rating, s.analysts], ["holdings", "USD", 100, 116, 84, 156, null, 15]);
  assertEquals(s.fresh, { low: 110, high: 140, count: 2 });
  assertEquals(s.coverage, { weight: 0.5, names: 2, source: "test" });
  assertEquals(holdingsSnapshot("X", [{ symbol: "C", weight: 1 }], data, { price: 100, currency: "USD" }, NOW, "t"), null);
  assertEquals(holdingsSnapshot("X", [{ symbol: "A", weight: 1 }], data, { price: null, currency: "USD" }, NOW, "t"), null);
});

Deno.test("strategistSnapshot: bitcoin's table, as of its date — mean 110,666.67, low 82,000, high 150,000, 3 targets", () => {
  assertEquals(STRATEGIST_AS_OF, "2026-10-21");
  const s = strategistSnapshot("BTC-USD", STRATEGIST_TARGETS["BTC-USD"], null)!;
  // (100,000 + 82,000 + 150,000) / 3 = 332,000 / 3 = 110,666.666…
  assertEquals([s.kind, s.currency, s.mean, s.low, s.high, s.rating, s.analysts], ["strategist", "USD", 110666.6667, 82000, 150000, null, 3]);
  assertEquals(s.targets.map((t) => [t.firm, t.at.slice(0, 10)]), [["Bernstein", "2026-08-26"], ["Citi", "2026-07-01"], ["Standard Chartered", "2026-02-12"]]);
  // Every row is sourced and dated, none after the table's own date.
  for (const r of STRATEGIST_TARGETS["BTC-USD"]) {
    assert(/^https:\/\//.test(r.url) && r.horizon.length > 0 && r.date <= STRATEGIST_AS_OF, r.firm);
  }
  assertEquals(s.sources?.length, 3);
  assertEquals(strategistSnapshot("X", [], null), null);
});

Deno.test("yahooSymbolCandidates: Yahoo's top-holdings symbols for Asian listings, as its quoteSummary answers them", () => {
  assertEquals(yahooSymbolCandidates("005930.KQ"), ["005930.KQ", "005930.KS"]);
  assertEquals(yahooSymbolCandidates("005935"), ["005935.KS", "005935.KQ"]);
  assertEquals(yahooSymbolCandidates("00939"), ["0939.HK"]);
  assertEquals(yahooSymbolCandidates("2330.TW"), ["2330.TW"]);
  assertEquals(yahooSymbolCandidates(" aapl "), ["AAPL"]);
});
