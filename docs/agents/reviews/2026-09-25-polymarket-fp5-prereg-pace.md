# Pre-registration PACE: the bracket a post-count pace points at, with 48 hours left (fp5, test PACE)

Written 2026-09-25 (UTC) before any pace, any shown price at this clock, or any return of this rule was
read. Frozen by the commit that adds this file.

`pace_test.py` is the rule. `pace_inputs.py` only assembles the inputs. The fill walk is
`post_test.walk_buys`.

## What was seen before the freeze (disclosed)

The tracker at `xtracker.polymarket.com` answers without a key. One request for `@elonmusk` returned post
rows with `createdAt` and `importedAt`, and no page field. A seven-day request returned in one body. The
user list names `@elonmusk` on X and `realDonaldTrump` on Truth Social. No count from those replies is an
input, and no price was read. POST's flat-open rule is a different clock and is not an input.

## Rule

Same events and brackets as POST: series 10000 (`elonmusk`, platform `x`) and series 11108
(`realDonaldTrump`, platform `truth_social`), `endDate` before 2026-09-11, title span in days.

The counting window ends at `endDate` and starts that many days earlier. Decision time `T_p = endDate − 48 h`.
A window shorter than that has no trade. Forty-eight hours is the lag. It is not moved after the result.

A post counts toward the final total when its `createdAt` is inside the window. It counts toward the live
total only when it was also `importedAt` at or before `T_p`. The live count is what the tracker had. A
response of 5,000 or more rows is incomplete, and one incomplete tracker means the test cannot pass.
Otherwise one response is the whole window, which is what the probe showed.

Priors are the same series and the same span, with `endDate` at or before `T_p`, at least eight. A prior's
remainder is its final count minus the live count at its own `T_p`. The forecast is this window's live
count plus the mean remainder. Buy the bracket that contains the forecast. None does → no trade. Two do →
the lower count.

The fair value is the fraction of those priors whose final count landed in the bought bracket. It has to
clear one tick through the shown price at `T_p`, after the fee. Hold to `outcomePrices`. No sale before
the end.

Shown price, fee, tick and the entry print in `(T_p, T_p + 60 min]` are the same objects as POST's entry.
Windows and the six conditions are POST's.

## Pin

`pace_test.py --self-check` must pass. Ten posts are imported before the cut and four after, so the live
count is 10 and the final count is 14. A post imported after the cut stays out of the live count. Eight
priors each leave a remainder of 4, so the forecast is 14, inside 12–16. A YES print at 0.10 floors to
0.201. Stake $10, payout 1, fee rate 0.05. P&L 39.351744.
