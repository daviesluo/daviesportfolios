// Pins for each paper row's own entry question: the wording is the one frozen in the pre-registration, byte for byte;
// only the entry question changes, never the caution or echo question or their order; a wording is asked only on the
// rule it describes; and a row asks its own wording only when its params name one written for its kind.
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { jevQuestions, JEV_QUESTION_VERSION, type CategoricalState } from "../_shared/agents_strategy.ts";
import { ALL_QUESTION_VERSIONS, questionsFor, questionsForRow, ROW_QUESTION_KIND, ROW_QUESTION_VERSIONS, rowQuestions } from "./jev_rows.ts";

const STATE: CategoricalState = {
  symbol: "BTC/USD", trend_4h: "up", trend_strength: "weak", breakout_4h: "above_range", volatility: "low", momentum_30d: "positive",
  position: "flat", unrealised: "none", time_in_position: "none", drawdown_from_high: "none",
};

const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");

Deno.test("each row wording is the pre-registered text, byte for byte (docs/agents/reviews/2026-09-23-jev-row-questions-prereg.md §3)", async () => {
  // A wording measured and priced is only evidence for THAT wording: an edit, however small, is a new question.
  const frozen: Record<string, string> = {
    "v3-momentum-1d": "deef44765c96786a44aba3324c335dddfe0b072bceb8affc8a91695ab54a10de",
    "v3-trend-1h": "d313ea61738cd6246e10e7a99e33cd3230679c4bba6732a6ea617b685b7319a5",
  };
  for (const v of ROW_QUESTION_VERSIONS) {
    const h = rowQuestions(STATE, v).healthy_trend;
    assertEquals(await sha256(JSON.stringify({ instructions: h.instructions, criteria: h.criteria })), frozen[v], v);
  }
  assert(rowQuestions(STATE, "v3-trend-1h").healthy_trend.instructions.includes("every word except momentum_30d is measured on 1-hour candles, although the names say 4h"));
  assert(rowQuestions(STATE, "v3-momentum-1d").healthy_trend.instructions.includes("sometimes a day or two, sometimes weeks"));
});

Deno.test("a row wording changes the entry question only: caution and echo are v2's, in the order the model always saw", () => {
  for (const v of ROW_QUESTION_VERSIONS) {
    const q = rowQuestions(STATE, v), v2 = jevQuestions(STATE, { kind: ROW_QUESTION_KIND[v], version: "v2" });
    assertEquals(Object.keys(q), ["healthy_trend", "caution", "_state"]);
    assertEquals([q.caution, q._state], [v2.caution, v2._state]);
    assertEquals(q.healthy_trend.type, "noul");
    assert(q.healthy_trend.instructions !== v2.healthy_trend.instructions);
  }
});

Deno.test("questionsFor asks a row wording only for the rule it describes, and v1 / v2 exactly as before", () => {
  assertEquals(ALL_QUESTION_VERSIONS, ["v1", "v2", "v3-momentum-1d", "v3-trend-1h"]);
  assertEquals(questionsFor(STATE, "v3-momentum-1d", "momentum-1d"), rowQuestions(STATE, "v3-momentum-1d"));
  assertThrows(() => questionsFor(STATE, "v3-momentum-1d", "trend-4h"), Error, "written for momentum-1d");
  assertEquals(questionsFor(STATE, "v2", "trend-1h"), jevQuestions(STATE, { kind: "trend-1h", version: "v2" }));
  assertEquals(questionsFor(STATE, "v1", "trend-4h"), jevQuestions(STATE, { version: "v1" }));
});

Deno.test("questionsForRow: v2 unless params.jevQuestion names a wording written for the row's own kind", () => {
  const v2 = (kind: "momentum-1d" | "trend-1h" | "trend-4h") => ({ version: JEV_QUESTION_VERSION, questions: jevQuestions(STATE, { kind }) });
  assertEquals(questionsForRow({ kind: "momentum-1d", params: {} }, STATE), v2("momentum-1d"));
  assertEquals(questionsForRow({ kind: "momentum-1d", params: null }, STATE), v2("momentum-1d"));
  assertEquals(questionsForRow({ kind: "momentum-1d", params: { jevQuestion: "v3-momentum-1d" } }, STATE), { version: "v3-momentum-1d", questions: rowQuestions(STATE, "v3-momentum-1d") });
  assertEquals(questionsForRow({ kind: "trend-1h", params: { jevQuestion: "v3-trend-1h" } }, STATE).version, "v3-trend-1h");
  // A wording for another rule, or a name nobody wrote, is never asked: the row asks v2.
  assertEquals(questionsForRow({ kind: "trend-4h", params: { jevQuestion: "v3-trend-1h" } }, STATE), v2("trend-4h"));
  assertEquals(questionsForRow({ kind: "trend-1h", params: { jevQuestion: "v9" } }, STATE), v2("trend-1h"));
});
