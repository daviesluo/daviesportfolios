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

## Addendum 3 (2026-10-02, about 05:00 UTC): the path and the layer run as instances; the row is renamed small-pool

Written before the window it concerns. Davies, 2026-10-02, verbatim: "把目前Reward quotes live-prep改名为Reward quotes
small-pool，再做一个Reward quotes mid-pool只做10-50，同时也不打扰其他的Reward quotes，也是400美元funded测试", and, on
landing it: "我的意思是做完并验证好就直接上线，不管几点". What changes, and nothing else:

- **The name.** The row reads "Reward quotes small-pool" on the Agents page. Its tables, files, actions, this document
  and its checks keep their names.
- **The code.** `pm_live.ts` and `pm_prep.ts` take an instance, so that "Reward quotes mid-pool" (`0081`,
  `agents/pm_mid.ts`, its own pre-registration `2026-10-02-polymarket-mid-pool-prereg.md`) can run the same path and
  layer on its own tables. A turn given none runs `PM_LIVE_INSTANCE` / `PREP_INSTANCE`, which carry this test's names
  and behaviour. Their hashes move:
  - `pm_live.ts` sha256 `8ba7b915018c8f34bc9f57486f703e016770696947d3d6665fa1a0fc44f39653` (frozen:
    `fbdaca34bd7f0037fb88ea7f9782ecc31311f283b6b0fe7c7c1cd45b3c519b89`);
  - `pm_prep.ts` sha256 `8d7861ab263554fba73e2ee2ef6f80bbfa7c33c1fa1971e00822c97b94794dea` (frozen:
    `83fe596fe7cb9b0dfd4e0a88c4259bc6484e37d9a755d6d0bbc46c56525d7061`).
- **Why it is the same test.** `supabase/functions/agents/pm_instance.test.ts` runs the default instances, once left
  out and once named, beside the frozen files kept byte for byte as `pm_live_frozen.ts` and `pm_prep_frozen.ts` (their
  sha256 the frozen ones above, held to this document by `src/pm_prep_prereg.test.js`). Over 56 turns on three
  simulated UTC days, dry-run and live, every table, request and report is identical after every turn; every export
  but the five the build changed is identical in text and value; six counterfactuals each fail it.
- **The window does not move:** this lands before 2026-10-03 00:00 UTC. A deploy of `pm_live.ts`, `pm_prep.ts` or
  their tables inside 2026-10-03 00:00 → 10-04 00:00 UTC still ends the window as FAIL. `0081` creates only
  `pm_mid_*` and `pm_midprep_*`, two lease rows and two `edge_calls` rows, and reads `pm_live_config` once.
  `prep_check_addendum2.sql` is unchanged, and so is what happens: the check's rows are reported to Davies, and nothing
  arms the path.

## Addendum 4 (2026-10-02, about 15:00 UTC): the row is renamed mini-pool

Written before the window it concerns. Davies, 2026-10-02, verbatim: "Reward quotes small-pool“ - 另外把这个改成Reward
quotes mini-pool". What changes, and nothing else:

- **The name.** The row reads "Reward quotes mini-pool" on the Agents page. Its tables, files, actions, this document
  and its checks keep their names, as under Addendum 3; "small-pool" here and in mid-pool's pre-registration names the
  same row.
- **The code does not change.** The rename is the page's (`src/agents/agents.js`). `pm_live.ts` and `pm_prep.ts` keep
  the hashes Addendum 3 names, and with them the name their default instances carry ("Reward quotes small-pool"):
  nothing reads it, and changing it would move those hashes.
- **The window does not move:** `prep_check_addendum2.sql` is unchanged, its rows are reported to Davies, and nothing
  arms the path.

## Addendum 5 (2026-10-02, about 18:00 UTC): a trigger on the config, and the design's go-time statement checks more

Written before the window it concerns (2026-10-03 00:00 → 10-04 00:00 UTC), and landed and deployed before it. Davies,
2026-10-02 about 17:15 UTC, verbatim: "把mid-pool 的结构和路径也做成和mini-pool一样的真实下单路径，按上线规模跑 dry-run，之后更好对比，
现在就做不要等" (make mid-pool the same real order-placing path as mini-pool, in a dry-run at the go-live size, so the
two compare better later; now). What changes for this test, and nothing else:

- **Its config gains a trigger** (`0084_pm_mid_order_path.sql`): `pm_live_config_one_armed`, fired after an insert or
  update that leaves the row armed (`live_confirmed_at` not null), refuses it while mid-pool's row (`pm_mid_config`) is
  armed, because from `0084` mid-pool is the same real order path on the same account, in its own dry-run. The path
  never writes its config; the trigger writes nothing; no column, value or other constraint of `pm_live_config`, and no
  other table of this test, changes. "A fix inside the window" names their tables: this lands before the window, which
  does not move.
- **The code does not change.** `pm_live.ts` and `pm_prep.ts` keep the hashes Addendum 3 names
  (`8ba7b915018c8f34bc9f57486f703e016770696947d3d6665fa1a0fc44f39653`,
  `8d7861ab263554fba73e2ee2ef6f80bbfa7c33c1fa1971e00822c97b94794dea`). The `agents` function redeploys before the
  window with mid-pool's action rewired (`runPmMidAction` in `agents/index.ts`); this path's action (`runPmLiveAction`)
  is unchanged.
- **The design's go-time statement** (step 8 of `2026-10-01-polymarket-live-calibration.md`), by which Addendum 2 says
  the path goes live, word for word, now also refuses, leaving the dry-run as an unread or stale balance always did, when
  the path's last turn did not load the key for the stored signer (`keyed`) or did not run from eu-west-1 (`sbRegion`),
  when Davies' Ireland attestation is not current, and while mid-pool is armed. The statement quoted under "What
  happens" is the one frozen on 2026-10-01; Addendum 2 replaced that automatic go-live with the design's statement, and
  the design's statement is now the longer one. Run against PGlite 16 with `0074` → `0084` applied, it refuses on each
  of those and arms on four balances as before (`backtests/pmlive/scripts/one_armed_check.mjs`, its output in
  `results/one_armed_check_out.txt`).
- **The check is unchanged.** `prep_check_addendum2.sql` reads `pm_live_config`'s values, not its triggers, and its
  (f) reads the facts the statement now checks (the region, the attestation, `keyed`, the balance). Its rows are
  reported to Davies, and nothing arms the path.

## Addendum 6 (2026-10-04, about 16:30 UTC): the formula as the venue holds our quotes, a book-quality rule for the selection, and the window moved to 2026-10-05

Written before the window it opens. Davies, 2026-10-04 about 14:10 UTC, verbatim:

> 把mini-pool现在就全部修复优化了，dry-run的问题如果影响mid-pool的话也都修复掉

In English: fix and optimise mini-pool completely now; any dry-run problem that also affects mid-pool, fix there too. And
about 14:45 UTC, verbatim: "所有不偷看条款全部取消，所有的数据都可用来达到最佳研究效果" (every no-peek clause is cancelled;
all data may be used for the best research). **From 2026-10-04 this test is not blind, on his word:** "nothing of the
window is read before the check" no longer binds, a read is not a deviation, and the check runs as frozen and says it
was not blind.

**Addendum 2's window, checked** at 00:17 UTC on 10-04 (`prep_check_addendum2.sql`, its hash verified): every row PASS
but (d), 8,193 of 11,520 market-minutes with a formula above zero (71.1 %, the bar 75 %), and (f), the account unfunded
(pUSD 0.036673). Its verdict stands: FAIL, and no go-live.

**Why (d) failed, minute by minute** (the path's own record, `pm_live_minutes` of mode `dry_run`, read after the
cancellation above; 10-03, eight markets, 1,440 minutes each, none missing):

| a minute with no formula reward | minutes | where in the code | live |
|---|---|---|---|
| the first minute after the 00:00 selection: nothing rested when the book was read | 8 | the formula scores what rested before the turn | the same |
| nothing rested: the minute before, one side of the rest of the book held no level of the reward minimum within 10 ¢ of its touch, so RW's rule quoted nothing and the path withdrew (0xc4cb61ab 457, 0x067a7888 292, 0xaab54954 78, the rest 9) | 836 | `rwQuotes` → `summarize`, `quote` | the same |
| two quotes rested and the rest of the book has no size-cutoff midpoint now | 30 | `minuteFormula` | 10 of them score |
| two quotes rested and do not score against the rest of the book's midpoint, but do with our quotes in the book (the dry-run's blind spot) | 498 | `minuteFormula` | they score |
| two quotes rested more than twice the maximum spread apart: placed a tick inside a book that wide, they cannot score with or without us (0x067a7888 836, 0x0eab98b4 391, 0xaab54954 190, 0xc4cb61ab 186, 0x7f789735 180, 0x67d66925 122, 0x9944434f 30) | 1,935 | the market's book | the same |
| another's level of the minimum inside our quotes, or the book through one | 20 | `minuteFormula` | the same |

The first estimate of the blind spot, 153 minutes, missed most of it: it is 508 (4.4 %), and on 0x67d66925, whose
midpoint sat near 0.065, 335 of its 462 minutes with no formula score once our quotes are in the book (rest of the book
0.02 / 0.13, our 0.03 / 0.10: the rest's midpoint 0.075 puts our bid 4.5 ¢ out, exactly the spread; ours, 0.065, puts
both 3.5 ¢ out). With it, (d) on 10-03 reads 8,701 of 11,520, 75.5 %, and on 10-02 77.0 %, on 10-04's first 7,160
minutes 71.5 %: the rest, 2,811 minutes on 10-03 besides the 8 first minutes, is the pools' books, and the fix alone
does not clear the bar.

**The fix, in the path and the layer mid-pool shares** (mid-pool's pre-registration, Addendum 2, names it as its
deviation 2):

- **The formula scores our quotes against the book as the venue holds them** (`minuteFormula`): Polymarket scores every
  order "vs the size-cutoff-adjusted midpoint" of the market's one book (docs.polymarket.com, liquidity rewards, read
  2026-10-04), one midpoint for every maker, and our orders, at N ≥ the reward minimum, are in that book. The rest of the
  market is the book as read less our orders in it (live: those resting at the venue; a dry-run's: none), RW's row and
  the others' scores as before; the venue's book is the rest plus our resting quotes, so a live book that already holds
  them is never counted twice; the midpoint is the venue's book's (`withOwnLevels`, `summarize`); the others' scores are
  taken at it (`scoresAt`, `summarize`'s own sums); a quote the rest of the book has crossed since it was placed is not
  resting (the venue would have matched it). Where our quotes leave the midpoint where the rest of the book put it, every
  figure is the old one, digit for digit.
- **Each minute also records what rests after its turn** (`detail.after`): the same formula of the quotes the turn leaves
  resting, against the book it read with them in it. The next minute's formula of those quotes on an unchanged book is
  that figure.
- **The paper layer pays a matched minute that figure** (`decideMinute`, `afterFormula`): the reward of the very quotes
  it fills, with both sides quoted on paper (a side its inventory stops earns nothing, as before), in place of stepRw's
  line, which put the midpoint at the rest of the book's alone; RW's line stays beside it in the minute's `detail`, and a
  minute recorded before the path kept the figure is paid RW's line. Its fills, inventory, stops and settlements are
  stepRw's and the path's as before. At placement our quotes move the venue's midpoint from RW's in 2,130 of 10-03's
  10,683 matched minutes (20 %): those minutes' paper reward changes.
- **No decision changes**: the rule still reads the rest of the book (RW's quotes, so it never chases itself), and the
  post-only check, the caps, the stops and the readout's reads are untouched; nothing reads the formula but the record,
  the readout's sums and the paper's reward. `pm_instance.test.ts` runs the default instance beside the code this
  document froze (`pm_live_frozen.ts`, `pm_prep_frozen.ts`) over three simulated days, minute by minute, dry-run and live,
  and finds every table, request, body and report the same but the fields the formula makes (each minute's `ours`,
  `others`, `formula_usd` and `detail`; the readout's `formula_usd`, `formula_scored_usd` and `minutes_two_sided` and its
  event's sums; the state's copy of the minutes; the paper minutes' `reward` and `detail`, its days' `reward`,
  `reward_r40` and `pnl_day_r40`, its accounts' running reward), and those exactly: where the venue's midpoint is RW's,
  the frozen figure; a matched minute paid the path's `after`, its `detail.rw` the frozen layer's reward.
- **A missing token book is not derived from its mirror.** The path reads the YES book only; the NO book is its mirror
  (NO's bids at 1 − YES's asks, size for size: of 2,682 pairs the sample below read in one request, 2,677 were exact
  mirrors, and the 5 others had the same touch and differed behind it, two snapshots at most 3 ms apart). A minute with
  no size-cutoff midpoint is the minimum's absence on one side of the one book (07:42 on 0x067a7888: 0.63 / 0.81 with no
  level of 20 within 10 ¢), not a book missing: nothing to derive, and RW's rule rightly quotes nothing on it.

**Mini-pool's rule: books with depth first** (`PM_MINI_INSTANCE`, the default instance with `PM_MINI_QUALITY`;
mid-pool's instance has none). At the 00:00 selection RW's first round scores every candidate and drops any under $2.50
a day, as before. A candidate whose book (the rest of the market's, as read at the selection) holds at least **two
levels of the reward minimum within 10 ¢ of the touch on each side**, RW's own window and size cutoff, ranks first
(`bookQualityOf`); the others come back, in RW's order, only for the slots and the budget those leave (`selectMarkets`).
The day still takes at most eight markets and $160, and a day with too few deep books still quotes thin ones. The
selection's event records how many it passed over, why, and how many came back. The rule aims at what the fix leaves: a
side with one level of the minimum loses its size-cutoff touch when that order goes, and RW's rule then rests nothing
(836 of 10-03's minutes) or a tick inside a touch that has widened past twice the maximum spread (1,935).

- **Chosen on a sample, because the record cannot test it.** `pm_live_minutes` keeps each minute's touch and
  size-cutoff touch, never the levels behind them. `backtests/pmlive/scripts/mini_books.ts` read the book of every
  market of mini-pool's universe that passed its rules (298 markets) once a minute for two hours, keyless (121 reads,
  2026-10-04 14:19 → 16:19 UTC), and `mini_books_read.ts` replays them through the path's own code: each market's
  minutes as the dry-run records them under this addendum's formula, and a selection every five minutes, its picks
  scored over the next hour (13 selections) and over the next half hour (19; `results/mini_books_out.txt`).
- **What it buys.** Without the rule the picks score in 72.5 % of their minutes over the next hour and 80.0 % over the
  next half hour (the record with the fix: 75.5 % on 10-03, 77.0 % on 10-02, 71.5 % on 10-04's first 7,160 minutes);
  with it, 93.6 % and 93.2 %. Of the 22 markets the ranking scored at the first read, the 7 whose books pass score in
  99.9 % of the sample's minutes, the 15 that fail in 67.9 %; an hour and more after that read, 100 % against 74.6 %.
- **What it costs.** The picks earn 104 % of the unruled picks' formula over the next hour and 89 % over the next half
  hour. RW's own first-round estimate of them is 82 % and 79 % of the unruled picks' (a deeper book shares its pool with
  more of the others' size), and their minutes scoring more often gives most of it back. The rule passes over 67 % of
  the candidates; at 21 of the 121 reads fewer than eight books pass (at the fewest 5), and the rest of the ranking
  fills the slots.
- **Weighed and not taken**, each run through the same function on the same sample (the picks' share of minutes with a
  formula, and their formula against the unruled picks', over the next hour and the next half hour):

  | candidate | share, 1 h | formula, 1 h | share, 30 min | formula, 30 min |
  |---|---|---|---|---|
  | none (the path as frozen) | 72.5 % | 100 % | 80.0 % | 100 % |
  | **the rule: two levels a side first, the rest for what is left** | **93.6 %** | **104 %** | **93.2 %** | **89 %** |
  | two levels a side, the rest never | 95.5 % | 98 % | 94.0 % | 85 % |
  | two levels a side and a spread behind the best ≤ 3 v first | 94.7 % | 99 % | 94.4 % | 82 % |
  | two levels a side and a midpoint in [0.05, 0.95] first | 92.6 % | 104 % | 93.2 % | 89 % |
  | three levels a side first | 83.6 % | 98 % | 88.3 % | 84 % |
  | a midpoint in [0.05, 0.95] | 78.5 % | 106 % | 84.7 % | 99 % |
  | a midpoint in [0.10, 0.90] | 77.0 % | 89 % | 82.3 % | 84 % |
  | Gamma's liquidity ≥ 500 | 87.9 % | 104 % | 89.2 % | 96 % |
  | Gamma's 24-hour volume ≥ 100 | 88.0 % | 92 % | 90.6 % | 79 % |
  | a size-cutoff spread ≤ 1 v | 83.3 % | 75 % | 85.3 % | 63 % |
  | a touch spread ≤ 1.5 v | 76.2 % | 84 % | 81.3 % | 77 % |

  The strict rule earns less and quotes fewer markets on a day short of deep books. The midpoint band [0.05, 0.95]
  keeps the formula but lifts the share only to 78.5 % and 84.7 %, and on mini-pool's own record it would have changed
  no selection, so 10-04's 71.5 % would stand. Gamma's liquidity figure keeps more of the formula over the half hour
  and less of the share, and it is a number Gamma computes, not the book the formula reads.
- **The record, where it can speak.** On mid-pool's, the 6 of 24 market-days whose midpoint lay outside [0.10, 0.90]
  at the selection scored 43.4 %, the rest 81.4 %; mini-pool quoted none outside [0.05, 0.95], so its own record cannot
  weigh the band. Of the 26 market-days mini-pool quoted from 10-01, three markets are still in its universe: the two
  whose books pass at most of the sample's reads scored 72.8 % and 98.9 % on their days, the one that fails at most
  reads 69.2 % (`results/mini_history_days.json`, from `scripts/mini_history_days.sql`): too few to weigh, and not
  against it.

**Dropping a chosen market during the day: not adopted.** A market gone dark earns nothing whether it stays or goes;
the selection stays once a UTC day ((b1) counts one run), so a market dropped could not be replaced; and in the sample,
of the 22 markets the ranking scored at the first read, 8 went 15 minutes without a formula and then scored in 52.0 %
of their later minutes, and 4 went 30 minutes and then scored in 53.6 %. A drop would give back what comes back and add
nothing.

**What does not change:** RW's quotes and N, the band, the 48-hour horizon, RW-E's rule, the $2.50 formula floor, RW's
ranking within each of the rule's two tiers, the sizes (at most eight markets, $160 of first quotes, $320 in all, $60 a
market, GTD 600 s), the stops (−$25 a day, −$75 in all), the gates, the go-time statement (the design doc's step 8, as
Addendum 5 has it) and every bar of the check.

**The window: 2026-10-05 00:00:00 → 2026-10-06 00:00:00 UTC**, the first full UTC day after the deploy, which lands before
2026-10-05 00:00 UTC; the selection at 00:00 is the first under the rule. If it lands later, the window is the first full
UTC day after it, by a next addendum whose check moves only its dates. The minutes between the deploy and the window are
a run-in.

**The check is `prep_check_addendum6.sql`**, sha256 `6b839a0fb917da8e124e4af1e67e913b9c852cf96da489f67150a0834204b5c9`
(`src/pm_prep_prereg.test.js` fails if the file changes): `prep_check.sql` as frozen, line for line, with its window's
date lines moved to 2026-10-05 → 10-06 and every bar the same. Run read-only before the window (2026-10-04, about 14:50
UTC), it parses and reads FAIL where it should: no minute, selection, order, day row or paper decision in the window yet,
and (f) the account unfunded (pUSD 0.036673). `prep_check.sql` and the checks of Addenda 1 and 2 stay as frozen.

**The code it deploys**: `pm_live.ts` sha256 `effd6351652944acfceaaa7525b4aa081367115d9cc228397090987ec5711617`, `pm_prep.ts` sha256 `ea3ee5b1eb2608cf240b40bbce0a1d57641c66a90ed682763506b5f1aab46dc9` (`agents/index.ts` runs
mini-pool's action on `PM_MINI_INSTANCE`).

**What happens**, as under Addendum 2: at or after 2026-10-06 00:10 UTC the check runs once and its output, every row, is
reported to Davies; no session and no routine runs the go-time statement, and the path goes live only in the
conversation where he says go. (f) reads the account: if it fails only because the account is not funded, the window's
verdict stands. A fix inside this window ends it as FAIL, as above.

## Addendum 7 (2026-10-04, about 17:00 UTC): every check window closed, on Davies' word

Davies, 2026-10-04: "验证没问题就直接落地TESTING STRATEGIES列表，把mini-pool 的检验窗口全关了，目前上线live的最大candidate是这个live-prep策略".
Mini-pool's check windows are closed. Addendum 6's window (2026-10-05 00:00 → 10-06 00:00 UTC) is withdrawn before
its first minute, and `prep_check_addendum6.sql` is never run. No window of this pre-registration reached a passing
check: Addendum 2's failed (d) and (f). Mini-pool is therefore not a go-live candidate. The lead candidate is "Reward
quotes live-prep", under its own pre-registration. The path and its paper layer keep running in dry-run as a
comparison until Davies says otherwise. They arm nothing: the config stays `dry_run` true with `live_confirmed_at` null,
and arming mini-pool would need a new pre-registration and his word. The files of the earlier addenda stay as they
were written.

## Addendum 8 (2026-10-07, about 21:40 UTC): the day stop counts only the day's change; mini-pool is a comparison only

Davies, 2026-10-07, answering whether the day stop of mini-pool and mid-pool should keep counting every holding's whole
unrealised loss as the day's or count only the day's own change; the option he chose, verbatim:

> 只算当天变化

In English: count only the day's change. Mini-pool's check windows were closed by Addendum 7, so nothing of this
pre-registration is read again: mini-pool is a dry-run kept as a comparison, and this addendum records what changes in
the code it runs. What changes, and nothing else:

- **The day stop's figure.** Until now the path's day (`bookPnl` in `pm_live.ts`, "all of it counts today: stricter")
  was the day's realised trades plus every holding's whole unrealised P&L against its cost, so a holding carried from an
  earlier day counted its whole loss again each day. It is now the day's change: what the book holds now at its marks,
  less what it held as the UTC day began at its marks then (a holding bought today at its cost), plus the day's sells and
  settlements (`sinceOpenPnl`). The path keeps the opening marks in its state (`dayOpen`: the last marks read before
  00:00, kept with each turn's `marks` and `marksAt`; a token neither has starts at its cost, which counts as before).
  The paper layer does the same on paper (`paperDayPnl`): its opening marks are the marks it held as the day began, the
  ones the day before closed on (`state.open`). The limit is unchanged, −$25 a day, and acts as before: nothing opens
  until the next UTC day, and sells of what is held stay armed.
- **The total stop does not change**: −$75 in all, every holding from its cost, a carried loss included.
- **What the record gains:** a day stop's event keeps the figure on cost beside its own and when its day began
  (`detail.onCost`, `detail.since`); the paper's state its opening marks (`open`) and in `pnl.day` the stop's figure; a
  closed paper day `detail.dayChange`. `pm_prep_days.fills_pnl_day` and `pnl_day_r40` keep the figure on cost, as
  `prep_check.sql` and its addenda read them; the state's `pnl.day`, which the page does not read, is the stop's figure.
- **Pinned.** `agents/pm_daystop.test.ts` works it by hand, on the path and on the paper layer: 100 YES carried from
  the day before at a $40 loss at the day's opening mark do not trip the $25 day stop at 00:00 or 00:01; a fresh $26 loss
  within the day does; the total stop trips past −$75 on the carried loss; on the frozen rule the same turns trip the day
  stop at 00:00 (and with the new rule switched off, the first assertion fails: −40 for 0). `pm_instance.test.ts` runs
  today's default instances on the frozen rule (`dayStopOnCost`, which no action sets, as Addendum 6's comparison ran the
  default without the book-quality rule) beside `pm_live_frozen.ts` and `pm_prep_frozen.ts`, byte for byte, and finds
  every table, request, body and report the same but the formula's fields, as before; its last test runs the default as
  deployed beside that over the same simulated days and finds the two the same until a holding is carried across 00:00
  (B's 20 YES at 0.201, marked 0.115 as 10-04 began): the frozen rule stops the day at 00:01 on the carried −1.72, the
  deployed one opens and stops at 06:01 on the settlement's −2.30 that day (−4.02 in all).
- **The code it deploys**: `pm_live.ts` sha256 `4032d6c01e255f5e682eb916d8ffdbdb35e774a7859f8defccfb22afe9236706`,
  `pm_prep.ts` sha256 `a13ef03c870db2a17411456ffbfcb1b203ffe4654525d7792e6e38ed675b696a` (before it, on `main`:
  `23112a4f…e5a9` and `78c804ee…8db6`). `pm_live_frozen.ts` and `pm_prep_frozen.ts` stay the bytes frozen above.
- **When it counts:** from the first 00:00 UTC after the deploy. Neither the path nor the layer has opening marks for
  the deploy's own day (`agents/pm_daystop.test.ts` pins the path's), so the rest of that day counts as before.
