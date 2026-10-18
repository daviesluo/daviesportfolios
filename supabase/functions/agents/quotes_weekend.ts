// PR5-W's weekend rule (docs/agents/reviews/2026-09-28-pr5-weekend-prereg.md, "The rule"), as a twin and an executor
// instance apply it: inside an FX closure, a minute whose GBP/USD is dark takes the last live GBP/USD before it, instead of
// going dark. "Stablecoin quotes variant-3" (`take50wk`, 0130; Davies, 2026-10-18: "加一个 Revolut 周末 paper 测试，在目前最好的
// variant-2基础上加，上线测试一下作为variant-3") is the first: variant-2 with this rule from its `weekend.from`,
// docs/agents/reviews/2026-10-18-revx-weekend-prereg.md.
//
// The rule, as PR5-W wrote it, for each minute t of a book:
//   1. X(t), when X(t) is live (PR5's own: the close of the latest GBP/USD bar that started in [t − 10 min, t − 1 min]);
//   2. when X(t) is dark and t lies inside a closure, the last X the engine took before t on that book (a stray live bar
//      inside a closure is live, and the dark minutes after it take its close);
//   3. dark otherwise, as in PR5.
// The closures are fixed in UTC: every week Friday 21:00 → Sunday 21:00; 24 December 21:00 → 25 December 21:00; 31 December
// 21:00 → 1 January 21:00. A closure ends at its end whether or not X is live: from Sunday 21:00 until a live bar the minute
// is dark, so no entry is quoted on Friday's rate into a reopened market.
//
// "The last X the engine took" is the book's `lastX` (`BookState`, quotes.ts): `stepMinute` sets it from every live X it is
// given and from nothing else, and a held X is that same value, so holding it never changes it. Nothing here changes
// `stepMinute` or PR5's record (QUEUE's and PR5-W's freeze lines): the rule decides only what X a replica hands it, and what
// fair an executor instance reads.

import type { BookInputs } from "./quotes_live.ts";

/** Is minute `t` (ms, UTC) inside one of PR5-W's FX closures? */
export function inQuoteClosure(t: number): boolean {
  const d = new Date(t);
  const wd = d.getUTCDay(), h = d.getUTCHours(), mo = d.getUTCMonth(), day = d.getUTCDate();
  if ((wd === 5 && h >= 21) || wd === 6 || (wd === 0 && h < 21)) return true;            // Friday 21:00 → Sunday 21:00
  if (mo === 11 && ((day === 24 && h >= 21) || (day === 25 && h < 21))) return true;      // 24 Dec 21:00 → 25 Dec 21:00
  if ((mo === 11 && day === 31 && h >= 21) || (mo === 0 && day === 1 && h < 21)) return true; // 31 Dec 21:00 → 1 Jan 21:00
  return false;
}

/** A weekend rule as an instance or a twin carries it: from `from` (ms) on. */
export type WeekendRule = { from: number };

/**
 * The X a minute is decided on under the rule: `x` when live; else, from `rule.from` and inside a closure, `lastX` (the last
 * X the book took); else none. With no rule, `x` exactly.
 */
export function weekendX(t: number, x: number | null, lastX: number | null, rule: WeekendRule | null | undefined): number | null {
  if (x) return x;
  if (!rule || t < rule.from || !inQuoteClosure(t) || !lastX) return x;
  return lastX;
}

/**
 * An executor's inputs for its paper engine's decided minute `T`, the rule applied: a dark GBP/USD inside a closure takes the
 * replica's `lastX`, and fair is the USD book's fair over it (`bookInputs`' own formula). Anything else is left as it is,
 * including every other guard's input (the USD book's hours, its de-peg).
 */
export function weekendInputs(i: BookInputs, T: number, lastX: number | null, rule: WeekendRule | null | undefined): BookInputs {
  const x = weekendX(T, i.x, lastX, rule);
  if (x === i.x || x == null) return i;
  return { ...i, x, f: i.fairU ? i.fairU / x : null };
}
