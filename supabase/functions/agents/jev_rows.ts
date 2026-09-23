// Each paper row's own entry question (Davies, 2026-09-23: "jev的问题选c" and "每个策略的jev都可以有自己的设计").
//
// The v2 question (`jevQuestionsV2` in `_shared/agents_strategy.ts`) is one wording for every rule, with the rule's name
// swapped in. On the two paper rows it fails the bar (reference §4.21): on momentum-1d the model decides on the 4-hour
// words, and for trend-1h it is never told that every word named `_4h` is measured on 1-hour candles for that rule. Each
// wording here is written for one rulebook — what it checked, how long it holds, and what each word measures FOR IT —
// and was frozen, word for word, in `docs/agents/reviews/2026-09-23-jev-row-questions-prereg.md` before the model was
// asked it once. A row asks its own wording only when `params.jevQuestion` names it (a migration, after the wording is
// measured and priced); every other row keeps asking v2, so adding a wording here changes nothing the loop does.
//
// It lives beside the rulebook, not in it: `_shared/agents_strategy.ts` is pinned by the SHA-256 six committed results
// record, and a wording is a new input, not an edit to theirs.
import { jevQuestions, JEV_QUESTION_VERSION, JEV_QUESTION_VERSIONS, type CategoricalState, type JevQuestionVersion, type StrategyKind } from "../_shared/agents_strategy.ts";

/** The row-specific wordings. Each is written for one rulebook and is asked only on that rule's entries. */
export const ROW_QUESTION_VERSIONS = ["v3-momentum-1d", "v3-trend-1h"] as const;
export type RowQuestionVersion = typeof ROW_QUESTION_VERSIONS[number];
export type AnyQuestionVersion = JevQuestionVersion | RowQuestionVersion;
/** Every wording the measurement endpoint may ask. */
export const ALL_QUESTION_VERSIONS: readonly AnyQuestionVersion[] = [...JEV_QUESTION_VERSIONS, ...ROW_QUESTION_VERSIONS];
/** The rule each row wording describes: asked on another rule, it would describe the wrong rule. */
export const ROW_QUESTION_KIND: Record<RowQuestionVersion, StrategyKind> = { "v3-momentum-1d": "momentum-1d", "v3-trend-1h": "trend-1h" };

const ROW_ENTRY: Record<RowQuestionVersion, { instructions: string; criteria: { true: string; false: string } }> = {
  "v3-momentum-1d": {
    instructions:
      "The state describes one crypto pair at the moment a 30-day momentum rule wants to BUY it, because the daily close is above its close 30 days earlier and volatility is not extreme. The rule then holds for as long as the daily close stays above its close 30 days earlier, unless the price falls 8 % below what it paid: sometimes a day or two, sometimes weeks. Those checks are done and are not the question. The question is whether, over the days to weeks the rule would hold, this rise looks more likely to keep going than to reverse. Answer yes if continuing looks more likely, and no if reversing looks more likely. How to read the words: momentum_30d compares the daily close with the close 30 days earlier, and is positive here, which is why the rule is asking. The other words describe the recent past on 4-hour candles: trend_4h and trend_strength compare a short average of 4-hour closes, covering about the last three days, with a long one, covering about the last two and a half weeks — strength is weak when the two are close together and strong when they are far apart; breakout_4h says whether the last 4-hour close is above the range of about the last nine days, below the range of about the last three days, or inside; volatility says how large the 4-hour swings of the last week are (low, normal, high). When the words point in different directions, weigh them together; no single word decides the answer on its own.",
    criteria: {
      true: "Worth buying now: over the days to weeks ahead the 30-day rise looks more likely to continue than to reverse.",
      false: "Better skipped: a reversal of the 30-day rise looks more likely than a continuation.",
    },
  },
  "v3-trend-1h": {
    instructions:
      "The state describes one crypto pair at the moment a trend-following rule on 1-hour candles wants to BUY it, because the 1-hour trend is up, the close is above the highest price of the previous 55 hours, 30-day momentum is not negative and volatility is not extreme. The rule then holds for hours to a few days, and sells when the 1-hour trend turns down, the close falls below the lowest price of the previous 20 hours, or the price falls three average hourly ranges from its high or 8 % below what it paid. Those checks are done and are not the question. The question is whether, over the hours to days the rule would hold, this 1-hour breakout looks more likely to keep going than to fail and reverse. Answer yes if continuing looks more likely, and no if failing looks more likely. How to read the words: for this rule every word except momentum_30d is measured on 1-hour candles, although the names say 4h. trend_4h and trend_strength compare a short average of hourly closes, covering about the last day, with a long one, covering about the last four days — strength is weak when the two are close together, as they are when a move has only just begun, and strong when they are far apart; breakout_4h is above_range here, which is part of why the rule is asking; volatility says how large the hourly swings of the last two days are (low, normal, high); momentum_30d compares the daily close with the close 30 days earlier, and unknown means there are fewer than 30 days of daily history, which says nothing about the direction. When the words point in different directions, weigh them together; no single word decides the answer on its own.",
    criteria: {
      true: "Worth joining now: over the next hours to days the breakout looks more likely to continue than to fail.",
      false: "Better skipped: a failed breakout or a quick reversal looks more likely than a continuation.",
    },
  },
};

export const isRowQuestionVersion = (v: unknown): v is RowQuestionVersion => (ROW_QUESTION_VERSIONS as readonly unknown[]).includes(v);

/** A row wording's questions: its own entry question, and v2's caution and echo questions unchanged. */
export function rowQuestions(state: CategoricalState, version: RowQuestionVersion) {
  const base = jevQuestions(state, { kind: ROW_QUESTION_KIND[version], version: "v2" });
  // Replacing the key keeps its place: the model sees the three questions in the order it always has.
  return { ...base, healthy_trend: { type: "noul" as const, ...ROW_ENTRY[version] } };
}

/** The questions for any wording, as the measurement endpoint asks them. A row wording is only ever asked for its rule. */
export function questionsFor(state: CategoricalState, version: AnyQuestionVersion, kind: StrategyKind) {
  if (isRowQuestionVersion(version)) {
    if (ROW_QUESTION_KIND[version] !== kind) throw new Error(`${version} is written for ${ROW_QUESTION_KIND[version]}, not ${kind}`);
    return rowQuestions(state, version);
  }
  return jevQuestions(state, { kind, version });
}

/**
 * The wording a row asks on its entries, and the questions: its own when `params.jevQuestion` names a wording written for
 * its kind, v2 (`JEV_QUESTION_VERSION`) otherwise — an unknown name, or a wording for another rule, is never asked.
 */
export function questionsForRow(row: { kind: StrategyKind; params?: Record<string, unknown> | null }, state: CategoricalState): { version: AnyQuestionVersion; questions: ReturnType<typeof jevQuestions> } {
  const named = row.params?.jevQuestion;
  if (isRowQuestionVersion(named) && ROW_QUESTION_KIND[named] === row.kind) return { version: named, questions: rowQuestions(state, named) };
  return { version: JEV_QUESTION_VERSION, questions: jevQuestions(state, { kind: row.kind }) };
}
