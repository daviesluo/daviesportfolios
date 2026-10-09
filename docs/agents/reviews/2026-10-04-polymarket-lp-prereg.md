# Reward quotes live-prep: the best reward-quoting strategy on the evidence, a day of paper, then live on Davies' word

Pre-registered 2026-10-04, frozen by the commit that adds it, before its window's first minute. It is the strategy's own
pre-registration; the earlier "live-prep" pre-registration (`2026-10-01-polymarket-live-prep-prereg.md`) is mini-pool's,
the name it carried until 2026-10-02, and nothing of it applies here.

## On whose word

Davies, 2026-10-04 (relayed by the coordinating session, about 16:00 UTC), verbatim:

> 让刚才那个study excluding count markets from x1的subagent继续深度研究这个问题：以现在知道的所有信息，选出来一个最佳的reward区间+市场+rules等一切最优的策略，不考虑其他一切因素，做出一个策略组合加到测试列表中叫它Reward quotes live-prep，然后你验证后确保一切都没问题后做上线准备

the same afternoon:

> “奖励池区间：$6–10、$10–50、RW 的 ≥$10，以及更大的池子；”不一定局限于这几个，可以flexable任意区间，最优就行，其他的criteria也同理

and, about 17:00 UTC:

> 验证没问题就直接落地TESTING STRATEGIES列表，把mini-pool的检验窗口全关了，目前上线live的最大candidate是这个live-prep策略

In English: with everything known now, choose the best reward band, markets and rules, everything optimal, considering
nothing else; make them one strategy, add it to the testing list as "Reward quotes live-prep", verify it, make sure
nothing is wrong, and prepare it to go live; the band and every other criterion are free, the optimum is what counts;
then: once verified, land it on TESTING STRATEGIES directly, close mini-pool's check windows (its pre-registration's
Addendum 7), and live-prep is now the lead candidate to go live. The no-peek rules were cancelled the same day
("所有不偷看条款全部取消，所有的数据都可用来达到最佳研究效果"), so every record was read; this test is not blind.

**RW's and RW-C's markets stay in its universe.** The basis is his "不考虑其他一切因素" (considering nothing else): the
question was the best strategy on the evidence, and leaving out the markets RW's rule takes would leave out the best
markets of the universe. What that does to RW-C's paper test once live-prep is live is said below ("What it does to the
other tests"), so that the choice is made knowing it.

## What is tested

The order path (`agents/pm_live.ts`) run as a third instance, "Reward quotes live-prep" (`agents/pm_lp.ts`,
`PM_LP_INSTANCE`; migration `0091_pm_lp.sql` sha256 `995412f756db592196c8be6d2115bee153a69bf0eebb970da7d3f75193c8c2e1`:
its nine tables `pm_lp_*`, lease `pm-lp`, `agents?action=pmlp&forceFunctionRegion=eu-west-1` every minute), and its
paper layer (`agents/pm_prep.ts`, `PREP_LP_INSTANCE`: `pm_lpprep_*`, `pm-lpprep`, `agents?action=pmlpprep` every
minute) filling the path's own dry-run orders from Polymarket's public prints. The code at the freeze:
`pm_live.ts` sha256 `23112a4f21e80313c5d0f74eb48d8107726f4b327642ed9804f64759186de5a9`,
`pm_prep.ts` sha256 `78c804ee19e16130a32cbdb8c576f09fa24e35a33b088bce38891e12e9898db6`,
`pm_lp.ts` sha256 `bfe38d1c94026641755ed6515b1ae0c91a00c11b4ea80dae3a2f6d6df4d7c3da`.
Every rule below that mini-pool and mid-pool lack is an instance option only live-prep sets (`PmLpOptions`); both of
them run beside the code they froze and make the same decisions (`pm_instance.test.ts`, `pm_mid_formula.test.ts`).

**Universe.** Every rewarded market with a total daily rate of at least $10 and no upper bound, a maximum spread above 0,
N = max(its reward minimum, 5) ≤ 20, accepting orders with two tokens; not on the UTC day its scheduled end falls in
(RW-E's rule, `rweSameDay`); no game starting within 48 hours; no market of Gamma's fee type `weather_fees` (RW-X's x1).
No 48-hour end-date horizon, no book-quality filter, no exclusion of RW's or RW-C's markets (`lpCandidateOf`).

**Selection.** Once a UTC day from 00:00: RW's `firstScore` on each candidate's book without our orders, a first-round
formula of at least $2.50 a day, RW's `choose` (whole markets by first-round reward per dollar), at most **10 markets
within $200** of first-quote capital. The candidates' books are read a hundred to a keyless POST (`bookReplies`).

**Quotes**, every minute, in each selected market (`lpQuotes`): RW's `summarize` and `quote` on the book without our
orders, size N; **a sell of what is held before a buy**: the bid (b in the one book) is a SELL of NO at 1 − b while NO
held ≥ N, else a BUY of YES at b; the ask (a) a SELL of YES at a while YES held ≥ N, else a BUY of NO at 1 − a (the same
prices either way); a side rests nothing while the inventory, YES held less NO held, is **5N** its way (RW's 3N); **x2's
pause**, frozen 2026-09-27 (`pauseAfterJump`, word for word `pmrw_x.ts`'s `armQuotes`): when the rest of the market's
adjusted mid moves 15 ¢ or more between two of the turns that read its book, nothing rests in it that minute and the 59
after, a further jump starting the pause again. Post-only GTD orders of 600 s, replaced only on a change or near expiry.

**A market held from an earlier day** and not selected today rests the rule's quote through `closeOnly`: the sells of
what it holds, at the rule's prices, until flat or selected again. Nothing is taken. Its minutes are recorded, and earn
nothing on paper.

**The account.** Caps $320 in all and **$100 a market** (`lpLimits`), on holdings at cost and resting buys (the path's
count). One loss stop: **−$75 in all on the fills' P&L (the path's book-keeping) plus what was paid**: live, what
Polymarket paid as the readout booked it (`pm_lp_reward_days`, live rows); in dry-run, its paper's closed days at
R = 0.40; until the first payout is read, the fills alone. Each mode's stop is its own: a stop the dry-run trips on paper
never holds the live path. **No day stop** (its config's `loss_day_usd` is null, and 0091's CHECK admits nothing else).
6,000 POSTs a day.

**In dry-run** the path decides each minute on its paper layer's holdings (`PmLpOptions.paper`): the paper's fills of the
orders the path rested, and the paper's settlements. So its sells, its 5N, its caps on what is held, its exits and its
stop are the live code's own decisions on the paper inventory. The layer decides a minute two minutes after it, so the
holdings a turn decides on are the paper's of about two minutes before: on paper a side can fill past 5N or past a cap
by the fills of those minutes (live, the account's holdings are current), and a sell the paper cannot cover fills no
further than it holds.

## Why this specification

The evidence is Phase A's study (2026-10-04), committed in `docs/agents/backtests/pmlp/` (its `MANIFEST.json` lists every
script, input and output). It replayed RW's stored record (2026-09-25 00:00 → 10-04 15:12 UTC, 9.6 days; the replay
reproduces RW's `pm_rw_days` and RW-X's x1 rows to the cent) at the live account's size, with RW's own functions and a
simulator that adds what an account adds (caps on holdings at cost and resting buys; sells first or buys only; loss
stops on the path's book-keeping; carried positions), over 15 rounds and about 290 arms, every one reported:

| One change from this specification (S2), on RW's record | Δ total at R = 1 | Δ at R = 0.40 | P(Δ > 0), day blocks |
|---|---:|---:|---:|
| buy-only orders (the path as mini-pool runs it) | −$643 | −$179 | 0.00 / 0.00 |
| the path's loss stops (fills alone, −$25 a day, −$75 in all) | −$750 | −$282 | 0.00 / 0.00 |
| hold carried positions (no close-only exits) | −$407 | −$132 | 0.01 / 0.08 |
| RW's 3N inventory cap | −$102 | −$54 | 0.00 / 0.00 |
| no pause after a jump (= S1) | −$50 | −$51 | 0.16 / 0.15 |
| the 48-hour end-date horizon | −$88 | −$33 | 0.09 / 0.24 |
| 8 markets / $160 (the path's) | −$28 | −$18 | 0.11 / 0.11 |
| a market cap of $60 | −$22 | −$13 | 0.00 / 0.09 |
| keep same-day markets | +$123 | −$83 | 0.92 / 0.13 |
| keep weather markets | +$16 | −$15 | 0.73 / 0.28 |
| on S1: a band of $10–$100 / ≥ $50 | −$687 / −$46 | −$193 / −$16 | 0.00 / 0.01; 0.01 / 0.14 |
| on S1: 7N / no inventory cap | +$9 / −$12 | +$3 / −$20 | 0.62 / 0.53; 0.41 / 0.33 |
| on S1: wide (x4) 0.9 / 0.6; lean (x5); 2N orders | −$9 / −$84; −$154; −$692 | −$5 / −$10; −$64; −$332 | ≤ 0.23 |
| on S1: taker exits at 00:05 instead of close-only sells | −$11 | −$13 | 0.35 / 0.33 |
| on S1: mid inside [0.10, 0.90] / touch ≤ 2v (selection filters) | −$184 / −$69 | −$88 / −$37 | 0.01 / 0.01 |
| on S1: a total cap of $250 / $400 with 12 markets | −$184 / +$26 | −$63 / +$5 | 0.00 / 0.00; 1.00 / 0.85 |
| sensitivity, not a choice: every print AT our price fills us | −$140 | −$87 | — |
| measurement, not a choice: the docs' one-sided third | +$135 | +$54 | — |

Each effect was also read on four splits of the days (the two halves, odd days, even days). Every split agrees in sign at
R = 1 and at R = 0.40 for buy-only, the path's stops, the 3N cap, lean, 2N orders, the $10–$100 band, a $250 cap and
8 markets / $160 (equal in the first half); at R = 1 only for holding carried positions, the 48-hour horizon and wide
0.6; at R = 0.40 only for same-day markets (kept out). Weather (kept out on RW-X's evidence: x1 above RW-E at R = 0.40),
the $100 market cap, 7N and wide 0.9 are inside the noise: the first two are kept as the better point estimates, not as
findings. The choices were read on the whole record with these split checks, so the record's figures below are not an
out-of-sample test: the dry-run and the live readout are.

The specification on the same record: **$1,049.91 at R = 1, $359.07 at R = 0.40, stress $387.13** (rewards $1,151.39 of
formula, fills −$101.49); per day $109 [77, 147] / $37 [23, 53] / $40 [24, 57] (day-block bootstrap of the run's sum,
mulberry32 seed 20261004, 2,000 draws, 5th–95th percentiles, per day); break-even R 0.09 at paper fills and 0.16 at the
stress arm's; with every print AT our price filling us too (an upper bound on live fills) $94 / $28 a day and break-even
0.14 / 0.27; the best market 7.8 % of the total; scoring in 84.3 % of its quoted minutes; worst day at R = 0.40 −$0.92
(−$13.65 at-price). The path as mini-pool runs it (S0), on the same universe: $234.48 / $125.36. Against S0: +$815.43
[452, 1,246] (P > 0 1.00) and +$233.71 [34, 440] (P > 0 0.975).

The pause was read on its whole plateau (8–25 ¢ × 15–120 minutes): positive at R = 0.40 in all 20 cells, at R = 1 in 17;
x2's frozen 15 ¢ / 60 minutes is positive on all four splits at both R and is taken as frozen, not the in-sample best
(15 ¢ / 30 minutes). Without the capital caps (RW-X's own setting) it is noise; its gain here comes through the cap:
fills avoided after a jump keep capital free.

The band: RW's ranking over every rate takes nothing under $20 (a fresh public read, 2026-10-04 15:21 UTC: the best ten
have rates of $34–$194); per dollar of first quotes RW's picks realise about $0.70 of formula a day against mid-pool's
$0.24 and mini-pool's $0.09; on their own records mini-pool earns $11.51 a day at R = 1 ($3.16 at 0.40), mid-pool $34.38
($12.57).

## The window

**d1 is the first full UTC day after `pm_lp_config.created_at`** (the moment 0091 made its config row), 00:00:00 →
24:00:00 UTC. Nothing of the window is read before the check except `pm_lp_state.last_error`, `pm_lpprep_state.last_error`,
`ops_errors` and whether the day's selection landed. A change to `pm_live.ts`, `pm_prep.ts`, `pm_lp.ts` or 0091's tables
deployed inside the window ends it as FAIL; the check then runs, unchanged but for its dates, on the first full UTC day
after the fix, by an addendum written before that day. A change deployed after d1 is a deviation an addendum records;
one is named in advance: the payouts-per-path patch (P3 below), which changes `pm_live.ts`'s readout and no dry-run
decision.

## The conditions

`docs/agents/backtests/pmlp/lp_check.sql` sha256 `7e94b0424dc687e7739853c35566df73b20f78da551b567473af138451ff0a57`, run
once, at or after d1 + 1 day 00:10 UTC: one read-only statement, one row per condition. It was run on PGlite 16 over
every migration and a simulated dry-run day of this code before the freeze (every condition but the clock's and (d)
passed on that day; (d) is the record's measure, and the simulated books are not the record's).

- **(a) It ran.** a1: the path recorded a minute in ≥ 1,426 of the 1,440 (99 %). a2: ≤ 14 minutes with an `ops_errors`
  row of `agents.pm_lp` or `agents.pm_lpprep` or a crash of either action. a3: the layer decided through 23:59 and closed
  the day.
- **(b) The selection.** b1: once (one `selected_at`), with ≥ 1 market, by 00:10 UTC. b2: every market inside the rules
  the tables record: rate ≥ $10, a reward spread, N ≤ 20, not ending on d1, no game within 48 h of the selection, a
  first-round formula ≥ $2.50 (the weather exclusion is Gamma's field, which the tables do not keep: `pm_lp.test.ts` pins
  it). b3: ≤ 10 markets and first-quote capital ≤ $200.
- **(c) Every would-be order**, each beside the minute of the turn that placed it and what that minute records of the
  decision (`detail.lp`). c1: post-only, none crossing the book it was decided on, ≥ 1 order. c2: every buy N, every sell
  at most N, none under the venue's minimum. c3: in every minute that placed a buy, holdings at cost and resting buys
  after the turn ≤ $100 in its market and ≤ $320 in all. c4: no sell larger than the holding of its token the turn
  decided on. c5: no buy on a side whose inventory the turn decided on was 5N its way. c6: a carried, paused or close-only
  minute places sells only.
- **(d) The quotes scored:** of the market-minutes quoted in full with something resting, ≥ **60 %** whose quotes score
  (the path's own figure of what rested, `detail.after.formula` > 0; the record: 84.3 % over 9.6 days, the worst day 70 %).
- **(e) The paper day:** its P&L at R = 0.40 above **−$25** (the record's worst day −$0.92, −$13.65 with at-price fills),
  and the path's stop never tripped in its dry-run.
- **(g) The paper is the path's:** ≤ 2 % of the decided market-minutes `diverged`.
- **(f) Ready, at that moment:** the path's last record from eu-west-1, its gates `region`, `geoblock`, `attestation` and
  `closed_only` true, the key loaded for the stored signer, a pUSD of at least $81 read within five minutes, and neither
  mini-pool's nor mid-pool's config armed. (f) reads the account: if it fails only because the account is not funded,
  the window's verdict on (a)–(e) and (g) stands, and (f) is read again at the go.

## What happens

- **Every condition PASS:** reported to Davies with every row. Live-prep goes live only in the conversation where he
  says go, by the go-time statement of the design doc's step 8lp, word for word, and its first-day reads. No session
  and no routine runs it.
- **Any FAIL:** no go-live; found, fixed, reported; a later window by an addendum.

**Before the go-time statement**, each of these holds, each read and reported:

- **P1** the day-1 check above passed.
- **P2** the funding: the same $400 account (Davies, 2026-10-01: "polymarket的策略我决定还是听你的转400美元进去追求最优效果"), a
  pUSD of at least **$81** read by the path itself within five minutes (the cap is the balance less the $75 stop and $5,
  at most $320; under $81 the statement refuses).
- **P3** what Polymarket pays told apart per path: `docs/agents/pending/2026-10-04-mid-pool-payouts-per-path.patch`,
  rebuilt on this code. Without it mini-pool's dry-run readout (which reads the account's payouts) books live-prep's
  payouts as its own live rows, and live-prep's R and stop count every payout of the account, which is right only while
  live-prep is the one path ever live. Applying it is Davies' call; an addendum records it (it changes the frozen
  `pm_live.ts`'s readout and no decision of any dry-run: `pm_payouts.test.ts`).
- **P4** mini-pool and mid-pool unarmed (`live_confirmed_at` null). The trigger of 0091 refuses arming any of the three
  configs while another is armed, and the statement refuses it too.
- **P5** the probe's read of the account's conditional-token allowances for both exchanges the order book uses (CTF
  Exchange, Neg Risk CTF Exchange; `GET /balance-allowance?asset_type=CONDITIONAL`): live-prep's sells of what it holds
  need them, and no Polymarket path has sold before.

## Live: what is read, and what ends it

- Every day after 01:00 UTC, the path's own readout (`pm_lp_reward_days`): R = paid ÷ formula over its own live
  market-days. `docs/agents/backtests/pmlp/lp_readout.sql` sha256
  `15e2dad389825a7e452f9e4802ce29fbd6bae096ac95b1f713fb580bcf0ff3ef` reads it, read-only.
- **It stops for good** when the total stop trips (−$75 on the fills plus what was paid), or, after 7 live days with
  at least 40 market-days, if R < 0.20 (between the record's break-even on the stress arm, 0.16, and the same with
  every print at our price filling us, 0.27; the paper's own is 0.09). Stopping is `live_confirmed_at = null` (its sells
  of what it holds stay armed), by the session that reads it, reported to Davies the same hour.
- **The readout at 14 live days**, reported to Davies: R with its 90 % interval (a day-block bootstrap over the live
  days' paid and formula sums: 2,000 draws, mulberry32 seed 20261004, the 5th and 95th percentiles of Σ paid ÷ Σ formula),
  the P&L at the measured R against the record's $109 (R = 1) and $37 (R = 0.40) a day, per market, the capital used, and
  the fills' P&L per filled share against the paper record's (−$0.0110 a share: −$101.49 over 9,243 quoted shares, the
  modelled exits' cost included).

## What it cannot show

- What the queue does: the paper fills a quote only on a print strictly through its price; live, a quote a tick inside
  the touch is alone at its level and is filled by any taker reaching it, so live fills may be more, and more adverse.
- The winner's curse is in the record (RW's picks earned 19 % of their selection-time formula) but other makers' answer
  to OUR quotes in their pools is not: the record's quotes were paper.
- R itself (the reason to go live), whether Polymarket pays single-sided quotes a third (the docs) or nothing (RW's
  formula), and whether the $1 minimum payout applies per market or per account.
- Re-selection inside the day: the record's reward per quoted minute falls from $0.027 in the selection's first hour to
  about $0.011 after six as other makers arrive, and a keyless tracking of the whole $10+ universe (2026-10-04, 15:37 →
  17:07 UTC, every 30 minutes, the rule's filters, `backtests/pmlp/results/track_an.txt`) saw the 15:37 top ten re-scored
  at 74 %, 59 % and 35 % of a fresh top ten's first-round formula 30, 60 and 90 minutes on, while the fresh top ten stood
  where the first had started ($237.91 a day at 15:37, $239.02 at 16:37). It is untested on fills (the record has no
  books for markets it did not pick) and is the next variant, not this one.

## What it does to the other tests (Davies: "不考虑其他一切因素")

- **RW (paper, to 10-09) and RW-C (paper, 10-09 → 10-23):** live-prep quotes RW's universe by RW's ranking, so once live
  its orders rest in the books they read and its fills are prints they count. Nothing changes in dry-run: nothing is
  placed.
- **Mini-pool and mid-pool** keep their dry-runs as comparisons; one account carries one armed path.
- **Mid-pool's exclusion of RW's picks** does not apply to live-prep.
- **Redemption:** settled markets' tokens hold capital under the cap until redeemed (by hand, Davies): on RW's record,
  redeemed daily it costs $5.63 at R = 1, every 72 hours $75.68, never $143.58.

## Addendum 1 (2026-10-07, about 21:40 UTC): the shared code's day stop changes; live-prep has none, and is unchanged

Written after d1 (2026-10-05), before the deploy it records: a change to `pm_live.ts` and `pm_prep.ts` deployed after d1
is a deviation an addendum records ("The window"). Davies, 2026-10-07, answering whether the day stop of mini-pool and
mid-pool should keep counting every holding's whole unrealised loss as the day's or count only the day's own change; the
option he chose, verbatim:

> 只算当天变化

In English: count only the day's change. What changes, and what it does here:

- **The change.** The day stop of mini-pool and mid-pool, the path's and the paper layer's, counts the day's change:
  what is held now at its marks, less what was held as the UTC day began at its marks then (bought that day: at its
  cost), plus the day's sells and settlements (`sinceOpenPnl`, `paperDayPnl`). Their total stop is unchanged.
- **Live-prep has no day stop** ("The account": its config's `loss_day_usd` is null, `lpLimits` gives no limit, and
  0091's CHECK admits nothing else), so none of its decisions changes. The code branches on it: the new figure, and the
  opening marks it needs, are taken only for an instance with a day limit; live-prep's path keeps `bookPnl`'s day in its
  report and state, and its layer keeps no stop of its own, as before. Its total stop (−$75 on the fills plus what was
  paid) is unchanged.
- **Pinned** (`agents/pm_lp.test.ts`, "live-prep has no day stop"): live-prep's path and layer as deployed beside the
  same on the frozen day stop (`dayStopOnCost`, which no action sets), over simulated days on which its paper holds 10 YES
  carried into the next UTC day below their cost and rests their sells, write every table, send every request and body
  and report every turn the same; no day stop and no opening marks appear in either.
- **The code it deploys**: `pm_live.ts` sha256 `4032d6c01e255f5e682eb916d8ffdbdb35e774a7859f8defccfb22afe9236706`,
  `pm_prep.ts` sha256 `a13ef03c870db2a17411456ffbfcb1b203ffe4654525d7792e6e38ed675b696a` (frozen above: `23112a4f…e5a9`
  and `78c804ee…8db6`); `pm_lp.ts` and `0091_pm_lp.sql` are unchanged. `lp_check.sql` (run on d1) and `lp_readout.sql`
  are unchanged.
- **The payouts patch (P3)** applies to `pm_live.ts` and is rebuilt on this code
  (`docs/agents/pending/2026-10-04-mid-pool-payouts-per-path.patch`); applying it is still Davies' call and its own
  addendum's.

## Addendum 2 (2026-10-08): TB1's skip on live-prep, on Davies' word

This addendum was written after d1 (2026-10-05) and before the deploy it records. Under "The window", a change to
`pm_lp.ts` deployed after d1 is a deviation that an addendum records.

Davies, 2026-10-08, verbatim:

> 给 live-prep 加上 TB1 的 variant-3 规则：盘口只差 1 tick 时不挂单 … live-prep 还是最好的吗不是和现有策略比，是和本身比（可以用所有策略和记录订单簿的所有数据inform），确保live-prep各方面都做到最好，然后最好上线准备

In English: give live-prep TB1's variant-3 rule, resting no order when the touch is only one tick wide; and make every
part of live-prep the best it can be, measured against itself, informed by all strategies and all recorded books, then
prepare it to go live. Arming is not part of this; only he arms, in the conversation where he says go.

**The change.** In a minute whose raw touch is at most one tick wide, nothing rests in that market: no buy and no sell.
The raw touch is the best ask less the best bid of the book without our orders, as RW's `summarize` reads it. The rule
is `PM_LP_TIGHT = { maxTicks: 1 }` in `lpQuotes`, judged by `pmrw_x.ts`'s own `isTight`. That is TB1's `tb1-skip`
(`2026-10-07-polymarket-rw-tb1-prereg.md`, page name "Reward quotes variant-3") at its frozen threshold.

- It applies to selected markets and to the close-only sells of carried markets.
- Every other minute is unchanged.
- In dry-run, the paper layer classes such a minute `dark`: nothing rested, no fill, no reward.
- Mini-pool and mid-pool carry no `lp` options, so they are unchanged.
- `pm_live.ts`, `pm_prep.ts` and 0091 are unchanged. The code it deploys: `pm_lp.ts` sha256
  `c404d510c0fdeea529c4edba7a314867d6943d18e4bc1e49e82842ef4fcf5eb4` (frozen above: `bfe38d1c…c3da`). `pm_live.ts` and
  `pm_prep.ts` are as Addendum 1 names them.
- **Pinned** in `agents/pm_lp.test.ts`, "TB1's skip (Addendum 2)": a one-tick book that `rwQuotes` quotes on both
  sides rests nothing under `lpQuotes`, with or without holdings, at both tick sizes, which fails on the old code. A
  two-tick book is RW's quote. Our own resting orders do not make a touch tight. Every world of the existing `lpQuotes`
  test with a one-tick touch rests nothing.

**The evidence** was read before this addendum and is not blind. It comes from RWC-OPT's search
(`2026-10-09-rwc-optimised-arms-prereg.md`, `docs/agents/backtests/rwc_opt/`). That search ran live-prep's own Phase A
simulator, plus TB1's option, on RW's record of 2026-09-25 00:00 → 10-08 23:10 UTC. On that record the simulator
reproduces RW's day rows to $1.6e-12.

The specification as frozen above (S2) against S2 with this rule:

| | S2 | S2 + TB1 skip | difference |
|---|---|---|---|
| R = 0.40, strict fills | $468.88 | $537.73 | +$68.85 (10 days of 14 ahead) |
| R = 0.40, a print at our price fills us too | $363.03 | $504.22 | +$141.19 (13 of 14) |
| R = 1, strict fills | $1,367.55 | $1,345.03 | −$22.51 |
| worst day at R = 0.40, strict / at-price | −$27.79 / −$55.31 | −$5.64 / −$37.52 | |

- The paired day bootstrap at R = 0.40 (`random.Random(20261023)`, 2,000 draws, index 100) is +$13.43 under strict
  fills and +$82.00 at-price.
- Across 35 changes to S2, the reality check of the best one over all of them gives p = 0.78 (strict) and 0.28
  (at-price) at R = 0.40. This rule is not significant after the correction.
- A walk-forward that picked each test day's change from the days before chose it on 6 of 8 days, +$42.26 over S2 on
  those 8 days.
- The rule trades about a tenth of the rewards for fewer adverse fills. It loses if Polymarket pays more than about
  0.85 of the formula (strict fills), and never under at-price fills.
- **Against it:** live-prep's own forward fills of 2026-10-04 → 10-08 (a wider universe than RW's) marked out at 60
  minutes better in one-tick minutes than in others: −1.56 cents a share against −2.24 (65 and 383 fills).

**What it does to this file's checks:**

- The day-1 check (`lp_check.sql`, run 2026-10-07 on d1) stands as read. It judged the rule as frozen, and its
  statement is unchanged.
- P2–P5, live-prep's go-time statement (step 8lp) and the live readout (`lp_readout.sql`, unchanged) read the path
  with this rule from its first deployed minute.
- The paper record before that minute is the old rule's. Any comparison across the deploy says so.
- The window's fourteen-day readout at 14 live days compares the measured fills and R with the record's figures above
  (the S2 + TB1 skip column), not with the frozen specification's.

**Its forward test:** RWC-OPT's C1 (S2 + TB1 skip against S2 on RW-C's fourteen days, read on or after 2026-10-23
00:05 UTC) is the out-of-sample measure of what this rule adds. Live-prep's own dry-run, and later its live path,
measure the rule as it runs.

## Addendum 3 (2026-10-08, about 23:55 UTC): live-prep against itself; no further change is adopted

This addendum answers the second half of Davies' word in Addendum 2: make every part of live-prep the best it can be,
judged against itself and informed by every record. It changes no rule. `pm_lp.ts` is the bytes Addendum 2 names.

**The study** is `docs/agents/backtests/lpself/`, run read-only. It used two records:

- **RW's record**, 2026-09-25 00:00 → 10-08 23:10 UTC (fourteen days, RW's own selection), through RWC-OPT's simulator.
- **A full-universe record** built from the pm-rec recorder's archive, 2026-10-05 00:00 → 10-08 22:59 UTC (5,476
  minutes).
  - Every two hours, every candidate live-prep's rules admit was scored by RW's `firstScore` on that minute's book: about
    100–470 candidates a slot, 1,373 markets kept in all.
  - The record holds 1.73 million book minutes and 26,192 prints.
  - On that record live-prep's selection is computed, its carried markets have books, and its exits are its own
    close-only quotes.
  - **Its check:** replaying the frozen rule, the simulator chose 2, 2, 9 and 7 of the ten markets live-prep's own path
    chose on 10-05 → 10-08 (`results/validate.txt`). The formula rewards came within about 15% of the paper's on the
    first three days, and were less than half on 10-08.

**The current rule (L1)** is S2 with TB1's skip.

| Record | R = 0.40, strict | R = 0.40, at-price |
|---|---|---|
| RW, 14 days | $537.73 | $504.22 |
| Full universe, 4 days | $114.81 | $71.05 |

The worst at-price day at R = 0.40 is −$37.52 on RW's record and −$72.46 on the full universe (10-08).

**The adoption rule, fixed before the results were read.** A change is adopted only if all of these hold:

- at R = 0.40 with at-price fills, it is ahead of L1 on RW's first seven days, where it would have been chosen;
- and on RW's last seven, out of sample;
- and on the full-universe days, out of sample;
- and its worst at-price day is no worse than L1's on either record.

**Nothing passes.** A walk-forward over every change at R = 0.40 with at-price fills chose arms that made $81.39 less
than L1 on RW's last eight days. The reality check of the best change over 35 gives p = 0.99 (at-price) and 0.89
(strict). Every change and its figures are in `results/lp_analysis.txt`.

Differences against L1 at R = 0.40 (at-price unless marked):

| change | RW, 14 days | RW h1 / h2 | full universe | why not adopted |
|---|---|---|---|---|
| 8N inventory cap | +29.99 | +2.46 / +27.53 | +51.44 | RW's worst day worse (−42.27) |
| skip at two ticks | +21.81 | −8.31 / +30.11 | +49.80 | behind on RW's first half; −$95.85 at R = 1 |
| re-select every 6 h | — | — | +57.06 (strict +56.30) | one record of four days; −$48.74 at R = 1; RW's record cannot test it |
| re-select every 2 h | — | — | −48.04 | behind |
| 12 / 15 / 20 markets | −2.24 | −2.24 / 0 | +9.78 / +6.68 / −3.25 | behind on RW's record |
| 6 / 8 markets | −66.98 / −20.53 | | −13.26 / −39.03 | behind |
| no TB1 (Addendum 2's rule removed) | −141.19 | −58.54 / −82.65 | +4.42 | behind on RW's record |
| fill cooldown 5 / 15 / 30 min | −24.84 / −52.59 / −126.40 | | +5.73 / +28.74 / +32.42 | behind on RW's record |
| book-imbalance filter .15–.85 / .25–.75 | −68.56 / −117.62 | | +29.57 / +32.22 | behind on RW's record |
| 3N cap; buy-only; size 2N | −94.84; −321.26; −194.50 | | −24.25; +29.13; +10.99 | behind |
| no pause; 8 ¢/30; 25 ¢/60 | −18.81; −29.51; −8.61 | | +8.06; −1.34; +0.33 | behind on RW's record |
| wide.9; lean; one tick back | −11.43; −95.71; −63.72 | | +23.70; +3.26; +0.10 | behind on RW's record |
| end horizon 48 h; rate ≥ $50; formula ≥ $5; mid .10–.90 | −123.69; −27.98; −12.84; −81.90 | | −75.16; −25.68; 0; −34.58 | behind |
| $60 a market; late cut 24 h | −21.06; −41.25 | | −6.96; +10.43 | behind |
| no change on either record | | | | rate ≥ $20; $150 a market; stop $50 or none; late cut 6 h; mid .05–.95 (within $3.53) |

**Reported, not rules:**

- **Exits.** On RW's record, close-only exits (the rule as it runs) against Phase A's passive model are −$86.82 strict
  and −$3.82 at-price. On the full universe, with every carried book recorded, the passive model is −$1.96 at-price.
- **The reward share.** R is not measured, and no record can measure it.
- **TB1 on the full universe:** +$17.87 at R = 0.40 with strict fills, −$4.42 at-price, and −$7.44 at R = 1. TB1's
  forward test is RWC-OPT's C1.

**Worth a forward test** (not adopted, and none needs anything before the go):

- **Re-selecting every six hours.** It is the only change ahead on its record under both fill models, with a better
  worst day, but there is one record of four days. A dry-run instance or a replay on RW-C's days would test it.
- **The 8N cap.**
- **The skip at two ticks.**

Any of them would be its own addendum on Davies' word.

## Addendum 4 (2026-10-08, about 00:05 UTC on 10-09): P3 is met, what Polymarket pays told apart per path

Davies, 2026-10-08, in Addendum 2's word: "确保live-prep各方面都做到最好，然后最好上线准备", that is, make live-prep the best it
can be, then prepare it to go live. Arming is not part of that. P3 ("what Polymarket pays told apart per path") is code,
and it is now applied. It is the change `docs/agents/pending/2026-10-04-mid-pool-payouts-per-path.patch` held since
2026-10-04, applied as it stood, its last rebuild on the day stop of 2026-10-07:

- `pm_live.ts` goes from `4032d6c0…6706` (Addendum 1) to sha256
  `57f4b1d74b89b76f30fe5060ab4c9431cbe9757f78e4a82cc8d3b9cb81821e40`, as the patch's README predicted.
- `pm_mid.ts`, `index.ts`, `pm_mid_formula.test.ts` and the new `pm_payouts.test.ts` change with it.

**What it does:**

- A path's readout (`pm_lp_reward_days` here) books a payout only for a market its own minutes show it quoting live
  that day.
- So live-prep's R and its −$75 stop (fills plus what was paid) count only live-prep's own markets.
- Mini-pool's dry-run readout no longer books live-prep's payouts as its own live rows.
- No dry-run decision of any path changes. `pm_payouts.test.ts` pins it, beside `pm_instance.test.ts`,
  `pm_mid_formula.test.ts`, `pm_lp.test.ts`, `pm_live.test.ts`, `pm_mid.test.ts`, `pm_prep.test.ts` and
  `pm_daystop.test.ts`, all passing on it.
- `pm_lp.ts` is Addendum 2's bytes.
- `lp_check.sql` and `lp_readout.sql` are unchanged.

**It reaches production with the push that lands it.** For mid-pool that push is its deviation 5 (mid-pool's
Addendum 5).

**What remains before the go-time statement:**

- **P2:** the funding, a pUSD of at least $81 read by the path itself.
- **P4:** mini-pool and mid-pool unarmed. Both are, and the trigger holds it.
- **P5:** the probe's read of the conditional-token allowances.
- The monitor's freshness reading for `pm_lp_state`.

The first three are Davies' to do or say. The design doc's step 8lp is unchanged, and only he arms, in the
conversation where he says go.

## Addendum 5 (2026-10-09, about 01:30 UTC): the order path's live turn, hardened before the go

This addendum was written after d1 and before the deploy it records. Under "The window", a change to `pm_live.ts`
deployed after d1 is a deviation an addendum records. Davies, 2026-10-09, after funding the account (pUSD $402.03 read
at 00:45 UTC), verbatim:

> 可以按原计划上线 … 期间你再验证一下所有系统和下单等所有上线会用到的细节都确保没有问题

In English: go live as planned, and meanwhile verify every system and every detail of the order path the go will use.
The verification (a read-only audit of the order path against Polymarket's current CLOB, its documentation and the
official client) found what is fixed below. Arming is not part of this: only he arms, by step 8lp.

**The code it deploys:** `pm_live.ts` sha256 `a208878b0f3b3c70fccee0fef34127ff28fa8fbd96c857e507bb494a88ed2703`.
Addendum 4 named `57f4b1d7…1e40`. `pm_lp.ts` is Addendum 2's bytes, `pm_prep.ts` Addendum 1's, and 0091,
`lp_check.sql` and `lp_readout.sql` are unchanged.

**Every change to `pm_live.ts` since `57f4b1d7…`, and what each changes in a live turn:**

- **A6** (review batch 5, deployed 2026-10-09 00:35 UTC, `e933f28c…` with A7): CONFIRMED fills matched in the same
  second are booked buy first. Live: a buy and the sell of it in one second no longer leave a phantom holding in the
  stop. It reads live fills only.
- **A7** (the same deploy): a live buy the turn cancels counts against the caps until its cancel is read back. Live: a
  cancel the venue never carries out no longer lets new buys pass the caps. It runs in live mode only.
- **F1, the outcome tokens' approvals (P5).** Live-prep's live turn reads the approvals its conditional-token reads
  already carry, and opens nothing while they list the CTF Exchange or the Neg Risk CTF Exchange as not approved (gate
  `ctf_approval`, reported once). A sell is never held back by it. With no approvals listed it stops nothing. The probe
  now reads the same approvals, so P5 can be met before the go.
- **F3, a POST the venue never took.** A live order the venue shows nowhere (404) once its expiration less the venue's
  minute has passed is closed as `expired`. Live: a 5xx, a 503 in cancel-only mode or a timeout no longer holds its slot
  and its buy's room under the caps for good, nor writes a fault every minute.
- **F4, a Polymarket Protocol V2 book.** A book naming a `version` is unquotable: the selection passes it over, and a
  selected market whose book turns V2 is withdrawn and recorded as a condition. A refusal "order_version_mismatch" is
  reported once an hour. Live: no order is signed for an exchange it cannot be valid on.
- **F5, the dry-run kill switch.** On the switch back to dry-run, a live order whose earlier cancel the venue never
  carried out is cancelled again, not left to its GTD expiry.
- **U1, the conditional balance.** Live-prep's live turn holds, per token, the balance plus our own resting sells when
  the CONFIRMED fills explain that much, else the balance (`heldFromBalance`). The docs imply the balance is the whole
  holding ("maxOrderSize = balance − Σ(openOrderSize − filledAmount)"), and then nothing changes. If it were net of
  our resting sells, the sell-first rule would otherwise flip a side to a buy the minute after its sell rested.

**Dry-run decisions are unchanged.** A6, A7, F1, F3, F5 and U1 run only in a live turn, or on live rows. F4 changes a
dry-run only for a book that names a protocol: none of 2026-10-09's ten selected books does (read keylessly at about
00:55 UTC), and the CLOB's `GET /version` answered 2. The evidence is the minute-by-minute comparisons of today's code
with the frozen code, which find every table, request and report the same: `pm_instance.test.ts`,
`pm_mid_formula.test.ts`, `pm_payouts.test.ts` and `pm_lp.test.ts` ("live-prep has no day stop"). All 217 tests of the
`pm_*` and `polymarket*` files pass on Deno 1.46.3. Each change has its own pin, and each pin fails on the code before
the change.

**What it does to this file's checks:** P1 stands as read. P2, P4 and the go-time statement are unchanged. P5 is now
read by the probe (`conditional.sellsApproved`), and the live turn enforces it. `lp_readout.sql` reads the path with
these changes from its first live minute.
