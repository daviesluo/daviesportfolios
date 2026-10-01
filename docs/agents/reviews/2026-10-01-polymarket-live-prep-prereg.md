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
