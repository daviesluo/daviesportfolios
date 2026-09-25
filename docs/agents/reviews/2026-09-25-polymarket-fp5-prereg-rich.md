# Pre-registration RICH: NO on the dearest post-count bracket (fp5, test RICH)

Written 2026-09-25 (UTC) before any return of this rule was computed, and before this rule's
input file was opened. Frozen by the commit that adds this file.

`rich_test.py` is the rule. `ladder_pick.py rich_test` only fetches the prints the rule names.

## Why this is not a rule already killed

TAIL buys NO on a rare YES bracket, which puts NO at 0.90–0.99, the favourite entry that failed.
RICH buys NO only on the dearest YES bracket, and only when that YES price is strictly inside
0.10 to 0.90, so neither token is in that favourite band. HITS buys YES on the largest edge.
This rule has one candidate and it is the NO token.

## Rule

Same events, priors and decision time as POST. The dearest bracket is the highest shown price;
a tie takes the lower count, then the condition id. Its fair NO probability is one minus the
fraction of priors inside it. Buy NO when that probability clears one minus the shown YES price,
plus one tick, after the fee. A YES print that sells, or a NO print that buys, is the NO token.
The fill is one tick through the NO price, the same stake, limit and $2 minimum as POST. Hold to
settlement: the NO payout is one minus the YES payout. Windows and the six conditions are POST's.
One incomplete tape means the test cannot pass.

## Pin

`rich_test.py --self-check` prints 14.638156. Two of eight priors land in 40–59, which is shown
at 0.60. NO fair is 0.75. A NO buy at 0.30 floors to 0.401. Fee 0.05, payout 1. A bracket shown
at 0.05 is not traded.
