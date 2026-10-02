# Reward quotes live-prep: 24 hours of paper for Polymarket's order path, then go live (pre-registration)

Written 2026-10-01 (UTC), before its window's first minute. Frozen by the commit that adds this file, which lands
before 2026-10-02 00:00 UTC; nothing below may change after that, and any deviation is reported as one. The check is
one SQL statement, `docs/agents/backtests/pmlive/prep_check.sql`, frozen with this file:
`prep_check.sql` sha256 `be042433453ab4fe19e2812a4af7d80b00c4cbbead97543dcd0e8075be44261e` (`src/pm_prep_prereg.test.js` fails if the file changes).

## On whose word

Davies, 2026-10-01, about 18:15 UTC, verbatim:

> Polymarket的准备好的live策略是不是从来没有paper trading测试过？要不要先上线Reward quotes live-prep测试一下？有问题也及时修复，然后我们操作账户和转账问题，纸面测试24小时之后再验证一遍没问题自动上线？

In English: the prepared Polymarket live strategy has never been paper-traded; put a "Reward quotes live-prep" paper
test online first and fix problems promptly; then he funds the account; after 24 hours of paper testing, verify again,
and if there is no problem, go live automatically. This document is the "verify again": what is read, the bar, and
what happens either way, written before anything is read.

## What is tested

The order path as it will run live (`agents/pm_live.ts`, migrations `0074` and `0076`; the design and go-live
checklist `2026-10-01-polymarket-live-calibration.md`): every minute from `eu-west-1`, the UTC day's markets chosen
once by RW's ranking (rate $6 to under $10, N ≤ 20, the 48-hour horizon, RW-E's same-day rule, phase 1: two markets
and $40), RW's quotes as RW-E applies them, post-only GTD orders, its gates and its caps. It runs in dry-run: it
records every order it would send (`pm_live_orders`, mode `dry_run`) and each minute's book and formula reward
(`pm_live_minutes`). Its code at the freeze: `pm_live.ts` sha256 `fbdaca34bd7f0037fb88ea7f9782ecc31311f283b6b0fe7c7c1cd45b3c519b89`.

Beside it, **Reward quotes live-prep** (`agents/pm_prep.ts`, migration `0077`, `agents?action=pmprep` every minute)
paper-trades the path's OWN decisions, never a second implementation of them: two minutes behind the clock, for each
market-minute of the path's record it takes what the path had resting after that minute's turn and, where that is
RW's quote on the very row the path decided on, decides the minute with RW's `stepRw` (`agents/pmrw.ts`, frozen) on
that row and the market's public prints — RW's fills, RW's 3N inventory stop on the PAPER inventory, RW's reward line.
Fills are booked as the path books its own (`tokenBooks`, `bookPnl`, `settlementFills`), marked at the touch mid of the
book the path read; the path's loss stops act on paper as they act live (nothing opens after one trips; only
`closeOnly`'s sells of what is held rest); a held market that resolves is settled at Gamma's payout. It writes only
its own tables, so the path sends what it would send without it (pinned: `pm_prep.test.ts`, the path's dry-run the
same minute for minute with the layer on and off). Its code at the freeze: `pm_prep.ts` sha256 `83fe596fe7cb9b0dfd4e0a88c4259bc6484e37d9a755d6d0bbc46c56525d7061`.

## The window

**2026-10-02 00:00:00 → 2026-10-03 00:00:00 UTC**, one UTC day: the first selection by RW's ranking (00:00 UTC; the
day this was written still carries 0074's placeholder markets, which quote nothing) and every minute after it. Nothing
of the window is read before the check, except the health scalars a fault needs (`pm_live_state.last_error`,
`pm_prep_state.last_error`, `ops_errors`).

**A fix inside the window.** Davies asked for faults to be fixed promptly. A change to `pm_live.ts`, `pm_prep.ts` or
their tables deployed inside the window ends it as FAIL (the day no longer tests one version), and the check is run
again, unchanged except for its window, on the first full UTC day after the fix is deployed. That later window is
written into this file's addendum before it starts; nothing else here moves.

## The conditions

Every condition is read by `prep_check.sql` (its common table expression is named in brackets), once, at or after
2026-10-03 00:10 UTC: (a) to (e) and (g) on the window, (f) on the state at that moment. Each prints PASS or FAIL.

- **(a) The path and the layer ran.**
  - a1 [`a_turns`]: the path recorded a minute (`pm_live_minutes`, mode `dry_run`) in at least **1,426 of the 1,440**
    minutes (99 %).
  - a2 [`a_faults`]: at most **14 minutes** (1 %) carry an `ops_errors` row of kind `agents.pm_live` or
    `agents.pm_prep`, or an `agents.crash` row of the `pmlive` or `pmprep` action.
  - a3 [`a_prep`]: the layer decided through 23:59 (`pm_prep_state.last_minute`) and closed the day (one
    `pm_prep_days` row for 2026-10-02).
- **(b) The day's selection** [`b`].
  - b1: it ran once (every market of the day has one `selected_at`), with at least one market, by **00:10 UTC**.
  - b2: every market is inside the rules: a reward rate of at least $6 and under $10 — RW's and RW-C's universe is $10
    and over, so no market of theirs (their tables are not read: no-peek) —, N = max(its reward minimum, 5) ≤ 20, a
    reward spread above 0, nothing ending or starting within 48 hours of the selection, and a first-round formula of
    at least $2.50 a day.
  - b3: phase 1: no more markets than `max_markets` (2) and first-quote capital within `select_budget_usd` ($40).
- **(c) Every would-be order of the window** (`pm_live_orders`, mode `dry_run`).
  - c1 [`c_post`]: post-only: none would cross the book it was decided on (`book_seen`: a BUY of YES under the best
    ask, a BUY of NO under 1 − the best bid, a sell above the best bid of its token), and at least one order exists.
  - c2 [`c_size`]: each at least its market's reward minimum (N) and the venue's minimum (`book_seen.minSize`).
  - c3 [`c_caps`]: at each order's placement, the resting buys' collateral is within `cap_market_usd` ($60) in its
    market and `cap_total_usd` ($320) in all.
- **(d) The quotes scored** [`d`]: at least **75 %** of the window's market-minutes of the path's record carry a
  formula reward above zero (`pm_live_minutes.formula_usd > 0`: both quotes rested, inside the spread, against the
  book without them). Most minutes, stated as three in four.
- **(e) The paper day** [`e`]: the day row exists with matched minutes, its P&L with rewards at R = 0.40
  (`pnl_day_r40` = the path's `bookPnl` day figure of the paper fills + 0.40 × the formula rewards) is **above −$25**,
  and no paper loss stop tripped in the window (no `loss_stop_day` or `loss_stop_total` event; neither flag set).
- **(g) The paper is the path's** [`g`]: at most **2 %** of the day's decided market-minutes are `diverged` (the path
  rested something other than RW's quote on its own row). The paper's P&L is the path's only where the two agree.
- **(f) Ready to go live, at that moment** [`f`]: `pm_live_state` was written from `eu-west-1`; its gates `region`,
  `geoblock`, `attestation` and `closed_only` read true; `keyed` is true (the signing key is the stored signer's);
  and the pUSD balance the path read is at least **$81** (the go-time statement's own floor) and was read within the
  last five minutes. (f) is the only condition about the account rather than the window: if it fails only because
  the account is not funded yet, the window's verdict stands and (f) is read again when it is.

## What happens

- **Every condition PASS:** the main session runs the go-time statement of the design doc, word for word, on Davies'
  word above ("纸面测试24小时之后再验证一遍没问题自动上线"), and reads it back:

      update public.pm_live_config c
         set cap_total_usd = case when s.pusd is null or s.at < now() - interval '5 minutes' then null
                                  else least(320, floor(s.pusd - c.loss_total_usd - 5)) end,
             dry_run = false, live_confirmed_at = now(), updated_at = now()
        from (select (state->>'pusd')::numeric as pusd, (state->>'at')::timestamptz as at from public.pm_live_state where id = 1) s
       where c.id = 1;

  Then the design doc's "first day" reads (its items 9–13), and a ledger line with the check's output.
- **Any condition FAIL:** no go-live. The failure is found, fixed, and reported to Davies with the check's output; a
  later window follows the rule above.

## What this does not test

- **R, what Polymarket actually pays.** Only live orders can show it; the formula is the paper's reward, and R = 0.40
  (RW's break-even, the pre-study's) is a column, not a measurement.
- **Live-only behaviour:** the venue's replies, cancels landing a moment late, collateral, scoring durations, and the
  per-market cap where paper inventory would push the path's `cap_market_usd` check (the dry-run holds nothing, so its
  caps read only resting buys). The design doc's checklist and first-day reads cover these.
- **Fills against our own orders' presence in the book:** the dry-run's orders are in no book, so the paper's
  touch is the market's without us, as RW's paper was.
- **The minutes the path's turn did not run** quote nothing on paper (RW's convention), where live orders would rest
  until their GTD expiry; (a1) bounds them.

## Addendum 1 (2026-10-01, about 20:10 UTC): the test starts now, over the rest of today and all of tomorrow

Written before the window it opens. Davies, 2026-10-01 about 19:52 UTC, verbatim, answering the note that the path
would first quote after the 00:00 UTC selection:

> 改为现在就开始测试，可以测试今天剩余时间+明天一整天

In English: start the test now instead; it can test the rest of today and all of tomorrow. What changes, and nothing
else:

- **Today's markets are chosen now.** 2026-10-01's two rows of `pm_live_markets` are 0074's placeholders (no reward
  rate and no maximum spread, so RW's quote rests nothing on them and the path has quoted nothing since `0076`). They
  are taken out by one statement, on his word above, and the path's next turn chooses today's markets by RW's ranking
  exactly as it does at 00:00 (it chooses a day once, on the first turn that finds no row of the day). Its code and
  the layer's are unchanged, at the hashes above:

      delete from public.pm_live_markets where day = date '2026-10-01' and reward_rate is null and max_spread is null;

- **The window: from the first full UTC hour after 2026-10-01's selection to 2026-10-03 00:00:00 UTC**, two UTC days.
  The selection is the first `selected_at` of that day's rows with a reward rate. The minutes between it and the
  window are a run-in, read only through 2026-10-01's day row, which covers its whole day. As before, nothing of the
  window is read before the check except the health scalars named above and whether each day's selection landed. If
  2026-10-01 has no row with a reward rate when the check runs (the statement never ran), this addendum never took
  effect: the window and the check are the ones above, as frozen.
- **The check is `prep_check_addendum1.sql`**, sha256 `b49b9fc509fc78b12c3a9e115167e92df42cba29452a1ab57d423c1feb55205d`
  (`src/pm_prep_prereg.test.js` fails if the file changes). It asks what `prep_check.sql` asks, on this window: (a1)
  and (a2) the same shares of its minutes (a turn in at least 99 %, a fault in at most 1 %); (a3) the layer through
  2026-10-02 23:59 and both days closed; (b) each day's selection once, with a market, inside the rules and phase 1,
  2026-10-01's before the window opens and 2026-10-02's by 00:10; (c), (d) and (g) on the window's orders, minutes and
  market-minutes (g from `pm_prep_minutes`, so only the window's); (e) each day's P&L at R = 0.40 above −$25 with
  matched minutes, no stop flag on either day and no stop event in the window; (f) as before. `prep_check.sql` stays
  as frozen. Run read-only before the window, with the placeholders still in place, it parses and reads FAIL where it
  should (no window yet; 2026-10-01's two rows in two runs, outside the rules; no funding).
- **A fix inside the window** ends it as FAIL, as above. A fix deployed before 2026-10-02 00:00 UTC leaves 2026-10-02 as
  the first full UTC day after it: that day is then checked by `prep_check.sql` exactly as frozen, at the same time,
  and the go-live does not move. A fix deployed on 2026-10-02 moves the check to 2026-10-03, by a next addendum.
- **What happens** is unchanged: at or after 2026-10-03 00:10 UTC the check runs once; every row PASS → the go-time
  statement above, word for word; any FAIL → no go-live, found, fixed and reported.

## Addendum 2 (2026-10-02, about 02:20 UTC): full size now, the window moved to 2026-10-03, and no automatic go-live

Written before the window it opens. Two options were put to Davies at about 01:40 UTC: A, finish this window at two
markets and switch to the full size after its check; B, switch now, which by the rule above ends this window as FAIL
and moves the check to 2026-10-03. He chose B, verbatim (about 02:15 UTC):

> 现在就切 全功率320刀，并且什么时候上线我说了算不自动转了

In English: switch now, at full power, $320; and when it goes live is my call, it no longer goes live by itself. What
changes, and nothing else:

- **The size.** Migration `0080_pm_live_full_size.sql` sets the design's phase 2 on the dry-run row, eight markets a UTC
  day and $160 of first-quote capital (`max_markets = 8, select_budget_usd = 160`), under the total cap the row
  already holds, $320, and takes 2026-10-02's rows out of `pm_live_markets`, so the path's next turn chooses today's
  markets again at that size. Its code and the layer's are unchanged, at the hashes above.
- **Addendum 1's window ends as FAIL** by the rule "a fix inside the window": `0080` changes the path's tables inside
  it. Nothing of that window is checked, and nothing of it is read for a verdict.
- **The window: 2026-10-03 00:00:00 → 2026-10-04 00:00:00 UTC**, the first full UTC day after `0080`. The minutes
  between `0080`'s selection and the window are a run-in, read only through 2026-10-02's day row. As before, nothing
  of the window or the run-in is read before the check except the health scalars named above and whether each day's
  selection landed.
- **The check is `prep_check_addendum2.sql`**, sha256 `8b72a9d299c39a7b49a0d41c3b0c827afa72d92a2717dac380468d20ec3365f0`
  (`src/pm_prep_prereg.test.js` fails if the file changes): `prep_check.sql` as frozen, with its window's three date
  lines moved by one day and every bar the same. (b3) reads the row's own `max_markets` and `select_budget_usd`, eight
  and $160 from `0080`. Run read-only before `0080` and the window, it parses and reads FAIL where it should (no window
  yet; the row still at two markets and $40). `prep_check.sql` and `prep_check_addendum1.sql` stay as frozen.
- **What happens, on his word above:** at or after 2026-10-04 00:10 UTC the check runs once and its output, every row,
  is reported to Davies. No session and no routine runs the go-time statement: the path goes live only in the
  conversation where he says go, and then by the design's statement, word for word. His standing word for an
  automatic go-live ("纸面测试24小时之后再验证一遍没问题自动上线") is withdrawn by this one. Any FAIL is found, fixed and
  reported as before.
- **A fix inside this window** ends it as FAIL, as above, and the check moves to the first full UTC day after the fix,
  by a next addendum.
