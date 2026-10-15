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

## Addendum 6 (2026-10-09, about 01:55 UTC): 12,000 POSTs a day, live

This addendum was written while live-prep is live (armed by step 8lp at 01:32:21 UTC on 2026-10-09) and before the
deploy it records. Under "The window", a change to `pm_live.ts` deployed after d1 is a deviation an addendum records.
Davies, 2026-10-09, verbatim:

> 同意提到 12000

In English: agreed, raise it to 12,000. "It" is live-prep's daily governor on POSTs, which "The account" above gave as
6,000 a day.

**The evidence.** Live from 01:33:04 UTC, the path sent 98 POSTs by 01:48:05 UTC, about 392 an hour: 75 replacements
and 23 new orders. Most of its markets re-price in most minutes, and every order is refreshed before its GTD expiry.
At that rate a UTC day is about 9,100 to 9,400 POSTs. The 6,000 governor would have withheld every order from about
16:15 to 16:50 UTC, and with nothing refreshed every quote would have expired within ten minutes after. Polymarket's
own limits are per 10 seconds, 9,000 in 10 s on the CLOB (reference §2d), so 12,000 a day is far inside them.

**What changes.**

- `pm_live.ts` sha256 `8920e0c25306b85784a9255840bb2144045a78404020370a0d3e83ec4100466a`, where Addendum 5 named
  `a208878b…2703`. Live-prep's limits (`lpLimits`) take its own ceiling, `PM_LP_MAX_POSTS_DAY` = 12,000, in place of
  `PM_LIVE_MAX_POSTS_DAY` (6,000). Nothing else in the file changes.
- `0105_pm_lp_posts_12000.sql` lets `pm_lp_config.max_posts_day` reach 12,000 (its CHECK, 0091's 6,000) and sets
  live-prep's row to 12,000. It writes no other column. The turn uses the lower of the config and the code's ceiling,
  so either deploy alone leaves 6,000, and only both together raise it.
- `pm_lp.ts`, `pm_prep.ts`, 0091, `lp_check.sql` and `lp_readout.sql` are unchanged.

**In a live turn:** only the governor's threshold. A turn that has sent 6,000 POSTs that UTC day keeps placing and
replacing orders, up to 12,000, where the governor withholds every order as before. No rule, cap, stop, gate or quote
changes. **No dry-run decision changes** either: the dry-run never reached 6,000 (4,525 to 5,165 a day on 10-05 to
10-08), and its limits differ only in the threshold.

**Pinned:**

- `pm_lp.test.ts`: `lpLimits` gives 12,000 from a config of 12,000, never more, and every other field as before.
  An armed day that has sent 6,001 POSTs still posts with the config at 12,000, is withheld at 12,000, and is withheld
  at 6,000 with the config at 6,000.
- `pm_live.test.ts` and `pm_mid.test.ts`: mini-pool's and mid-pool's governors stop at 6,000.
- `src/pm_live_hash.test.js`: the bytes and the chain of addenda.

All `pm_*` and `polymarket*` Deno tests pass.

## Addendum 7 (2026-10-09, about 15:00 UTC): a limit on buying near-certain tokens, as a share of capital

This addendum was written while live-prep is live (armed at 01:32:21 UTC on 2026-10-09) and before the deploy it
records. Under "The window", a change to `pm_lp.ts` or `pm_live.ts` deployed after d1 is a deviation an addendum
records. Davies, 2026-10-09, verbatim:

> 加上，但你研究下这个最多买的数值最优的设定后再加，并且以持仓比例来算不是硬数值

In English: add it, but first research the best setting for the most it may buy, and make it a proportion, not a hard
number. "It" is EXPENSIVE-SIDE's recommendation (`backtests/rwc_opt/results/expensive_side.txt`): a limit on live-prep
buying a token priced 0.95 or more. Live had bought 80 NO at 0.971-0.972 on one market in 21 minutes (about $78, 24 % of
the $320), which a resolution against it would take in one jump.

**The change.** A BUY of a token whose price is 0.95 or more rests only while that token's holding in the market, at the
minute's mark (RW's adjusted mid of the book without our orders: YES at m, NO at 1 − m), plus the order at its price stays
within **8 % of the path's capital** (`PM_LP_NEAR_CERTAIN = { minPrice: 0.95, share: 0.08 }`, `nearCertainBuyOk`, in
`lpQuotes`). The capital is the total cap the turn's limits read (`lpLimits`' `capTotal`: `pm_lp_config.cap_total_usd`
under the code's ceiling), so the limit follows whatever raises or lowers it. At $320 it is $25.60.

- A sell is never limited. A buy under 0.95 is unchanged. Where the near-certain buy does not rest, the other side
  still rests as before (alone, it scores nothing outside [0.10, 0.90], as Polymarket's rules have it).
- With no readable capital, no near-certain buy rests.
- It applies to selected markets. A carried market rests only sells, as before.
- In dry-run the paper layer fills only what the path rests; a minute with one side resting is `matched`, as before.
- Mini-pool and mid-pool are unchanged. Their rule, `rwQuotes`, ignores the new input.

**The code it deploys:**

- `pm_lp.ts` sha256 `98c060072ebac964df345930122a045a06ec1191f57b094e2dfead928565762c`, where Addendum 2 named
  `c404d510…5eb4`.
- `pm_live.ts` sha256 `749bfcdb2b9170ddc455f18c4a5b691c89450c3bd9c8fd9784ada3d9ef2def09`, where Addendum 6 named
  `8920e0c2…466a`. The one change: the rule's input (`PmQuoteInput`) carries `capital`, the turn's `capTotal`, in both of
  the turn's calls of the rule. Nothing else in the file changes.
- `pm_prep.ts` (`a13ef03c…696a`), 0091, `lp_check.sql` and `lp_readout.sql` are unchanged.

**The evidence** (`backtests/rwc_opt/results/expensive_limit.txt`; scripts `explim_run.ts`, `explim_analyse.py`,
`sql/explim_paper.sql`). None of it is blind: every record had been read before.

- **Records.** EXPENSIVE-SIDE's simulator, unchanged, swept the share f (3 % to 25 %) and the threshold (0.93, 0.95,
  0.97). It ran on RW's record (14 days) and the full-universe record (4 days), under strict and at-price fills, at
  $320, and at $640, $1,000 and $2,000. L1, today's rule, reproduces EXPENSIVE-SIDE's day series exactly. Live-prep's
  own paper (10-04 → 10-09) was replayed to first order. The tail is EXPENSIVE-SIDE's calibration (5,766 markets, a
  year of hourly prices), also priced at the live path's own speed: 101.34 NO at 0.955-0.972 in 13.25 live hours.
- **The objective.** It is per 30 days at R = 0.40: E[P&L] − (1 + λ) × E[near-certain loss at the live speed] −
  λ × E[loss from single hits ≥ 5 % of capital]. λ = 1 counts a dollar lost in one hit twice, once as the loss and once
  as the room it takes of the −$75 stop. The best f moves with λ (0, 1, 3) and with the tail's rate (1.39 %, 2.65 %,
  3.35 % per 7-day holding). So the choice is the f least short of the best in any of those nine cases (minimax
  regret). That rule was picked after seeing that the cases disagree.
- **The answer: 8 % at 0.95.** Its largest shortfall is $1.85 a month, against 10 %'s $2.15, 12.5 %'s $5.50 and
  6.25 %'s $4.82.
- **Against L1, at R = 0.40 and $320:**

| record | result | 2,000-draw day bootstrap, index 100 |
|---|---|---|
| RW, strict fills | −$1.72 | −$7.65 |
| RW, at-price fills | +$1.36 | −$5.66 |
| full universe, strict | +$2.24 | −$0.03 |
| full universe, at-price | +$2.19 | −$0.05 |
| paper replay | $3.09 of $152.74 near-certain formula reward lost in 4.3 days | — |

- **What it saves.** At the live speed the expected near-certain loss is $1.43 a month against $5.41 with no limit, and
  one hit is at most 8 % of capital against 30 %.
- **The threshold.** 0.93 costs more at every share up to 10 %. 0.97 costs $7 to $12 on RW's record at every share up
  to 15 %.
- **Larger capital.** At $640 to $2,000 the 8 % costs nothing measurable; its worst case is −$1.28. It stops binding at
  about $1,250, where it passes the $100 a market cap. Below about $245, not even one order of 20 fits.
- **Confidence: moderate on the band, low on the point.** Every share from 8 % to 12.5 % is within $5.50 a month of the
  best in all nine cases. Those differences are inside the bootstrap's spread.
- **The known cost.** A partial fill of 7-19 shares of a 20-share near-certain bid leaves that side unable to rest. The
  buy is over the limit, and the sell needs N held. This lasts until the price leaves 0.95, the market is carried off,
  or the next selection. The paper replay counts that cost; live may meet it more often.

**In a live turn:** a near-certain buy past 8 % of the capital is not sent, and a resting one is cancelled when its slot
is no longer wanted (gate `rule`), as a 5N stop is. On the deploy, the market where live already holds near-certain NO (0xecc209a6)
keeps resting its sell of what it holds and rests no further NO buy until that holding, at the mark, plus 20 is within
$25.60. **Dry-run decisions** change only for near-certain buys, by the same rule.

**What it does to this file's checks:**

- The day-1 check (`lp_check.sql`, run on d1) stands as read. None of its conditions reads this rule.
- The live readout (`lp_readout.sql`, unchanged) and the stop read the path with this rule from its first deployed
  minute. Live minutes before it are the old rule's, and any comparison across the deploy says so.
- The readout at 14 live days names this deploy, at the time of the Edge deploy that carries it, as Addendum 7.

**Pinned:**

- `pm_lp.test.ts`, "the near-certain limit (Addendum 7)": with YES or NO the near-certain token, a buy past 8 % of $320
  is not sent where the old rule sent it; sells and the cheap side are untouched; with no capital no near-certain buy
  rests; at $640 the boundary moves with the capital.
- `pm_lp.test.ts`, "the near-certain limit on the path": a dry-run day at $100 and at $320 of the config's cap. The path
  reads its capital from the config. The paper buys only while the buy rests, and every minute is matched or dark.
- `src/pm_live_hash.test.js`: the bytes and the chain of addenda.

## Addendum 8 (2026-10-09, about 15:30 UTC): the total cap follows the equity, live

This addendum was written while live-prep is live and before the deploy it records. Under "The window", a change to
`pm_live.ts` deployed after d1 is a deviation an addendum records. Addendum 7 limits buys of tokens priced 0.95 and over
to 8 % of the path's capital, which the turn passes its rule (`capital`, the turn's `capTotal`); this addendum makes that
capital follow the equity, so the limit follows it too. It does not touch `pm_lp.ts`. Davies, 2026-10-09, verbatim:

> 每天的rewards受益payout之后立马运用资金进策略，你研究一下最好的方式，如果我补充资金的话也可以立马运用资金，另外也研究下不同本金的受益会有区别吗，最多能投入多少

In English: as soon as each day's reward payout arrives, put that money to work in the strategy; research the best way;
if he adds funds, use them at once too; and research whether returns differ with the capital, and the most that can be
put in.

**What changes.** "The account" above gave a total cap of $320, set once at the go (step 8lp: the pUSD then less the
$75 stop and $5). From this deploy, with `pm_lp_config.reinvest` on (migration `0106_pm_lp_reinvest.sql` adds it and
sets it on), a live turn computes the cap again every minute (`lpCapital`):

- **The equity at cost:** pUSD + what the CONFIRMED fills hold at cost + settled tokens not yet redeemed, at their
  payout. The venue's pUSD is gross of our resting buys. Checked on 2026-10-09 at 14:50 UTC: $235.44 of pUSD plus the
  $166.59 the CONFIRMED fills had spent net is the deposit, $402.03, to the cent, with $61.24 of buys resting.
- **The cap:** floor(equity − $75 − $5), the go-time statement's own figure, read every turn, at most
  `cap_ceiling_usd` (0106: $1,000, CHECK ≤ 1,000) and the code's `PM_LP_CAP_CEILING_USD` ($1,000), never below 0.
- **Down at once.** A withdrawal or a realised loss lowers the cap that turn. While holdings at cost and resting buys
  are over it, every buy is withheld (`cap_total`). The sells of what is held stay armed, so holdings stay inside the
  cap and shrink towards it.
- **Up on two readings.** A raise needs this turn's equity and the last turn's (at most five minutes apart), and takes
  the lower of the two. No fill may still be settling (MATCHED, MINED or RETRYING). So a payout or a deposit is used the
  turn after it is first read, about a minute later. A balance read once mid-settlement never raises the cap.
- **Unread holds.** An unread pUSD, or a token balance unread, holds the last turn's cap. It never raises it, and
  in a live turn an unread pUSD already sends no new buy (the collateral check).
- **Off, or in dry-run,** the cap is `cap_total_usd` ($320), as before. That is the fallback: `update
  public.pm_lp_config set reinvest = false where id = 1;` turns the rule off in one statement.

**What stays fixed, and why** (the capacity study, LPCAP, `docs/agents/backtests/lpcap/`):

- **The −$75 total stop** stays fixed in dollars. It is what Davies agreed to lose of the $400. The stop's basis
  counts what was paid, so a payout widens the room under it by itself. Scaling it with the equity would put more of
  his money at risk, and that is his call. The record cannot price it either way: L1's stop never trips there ("no
  stop" and "stop $50" are both +$0.00, LPSELF).
- **N, 5N, $100 a market, ten markets and $200 of first quotes** stay fixed. Each scale-up is priced below, and none
  pays at R = 0.4 on both records without a large rise in fills.
- **The $5 margin** stays fixed: it is the go-time statement's.

**The evidence.** The study first checks that a copy of LPSELF's simulator reproduces L1 byte for byte on both records
and both fill models. It then runs L1 at total caps of $320 to $10,000 in four ways (the stop scaled with the cap in
each). The records: RW's (14 days) and the full-universe one (4 days). The figures are per day, at R = 1 / 0.4, paper
fills:

| capital | the cap alone | more markets | bigger orders (k = s) | both (√s each) |
|---|---|---|---|---|
| $320 (L1), RW | $96.1 / $38.4 | — | — | — |
| $640, RW | $96.1 / $38.4 | $99.0 / $39.3 | $134.9 / $52.0 | $117.4 / $46.3 |
| $1,000, RW | $96.1 / $38.4 | $99.0 / $39.3 | $152.6 / $53.9 | $130.9 / $51.5 |
| $2,000, RW | $96.1 / $38.4 | $99.0 / $39.3 | $171.7 / $42.2 | $153.2 / $60.0 |
| $5,000, RW | $96.1 / $38.4 | $99.0 / $39.3 | $217.5 / $48.2 | $171.4 / $59.2 |
| $320 (L1), full universe | $81.5 / $28.7 | — | — | — |
| $640, full universe | $83.0 / $22.2 | $110.7 / $30.6 | $121.6 / $36.4 | $109.4 / $34.3 |
| $1,000, full universe | $83.0 / $22.2 | $133.3 / $31.7 | $142.1 / $33.1 | $135.9 / $26.5 |
| $2,000, full universe | $83.0 / $22.2 | $180.5 / $24.6 | $127.5 / −$34.9 | $214.8 / $41.4 |
| $5,000, full universe | $83.0 / $22.2 | $184.0 / $24.1 | $83.0 / −$198.1 | $203.4 / −$93.3 |

- **At today's sizes, more capital does nothing.** The rule holds at most $368 (RW) to $491 (full universe) in
  holdings at cost and resting buys, whatever the cap above that. Its return in dollars stays put, and its return on
  capital falls as 1 / capital: 12.0 % a day at R = 0.4 on $320, 6.0 % on $640, 1.9 % on $2,000 (RW).
- **Reinvesting the payouts at today's sizes is neutral.** L1 with its cap following its equity earned the same as L1
  on RW's record ($96.12 / $38.39 against $96.07 / $38.41): its cap reached $861 by the 14th day and was never used
  past $368. On the full universe's four days it earned −$1.1 at R = 1 and −$7.2 at 0.4 a day, because a cap that no
  longer binds also lets through fills the $320 had held back. Four days is too short to read that sign.
- **Bigger orders saturate the pools.** Our share of the pools we sat in went from 0.22 to 0.38 at three times the
  size (RW) and 0.74 at 31 times, while fills grow with the size.
- **More markets.** RW's record has only its own six a day. On the full universe, 20 markets at $640 earn +$29 a day at
  R = 1 but +$1.9 at R = 0.4 and −$7 at R = 0.2. About 20 markets is also where the 12,000 POSTs a day bind: the live
  path sent 229 an hour over ten markets today, about 550 a market-day.
- **The most that can be put to work** at a positive margin, with orders and markets both scaled by √(capital ÷ 320):
  - At R = 1, about $2,000, flattening after.
  - At R = 0.4, the records agree only up to $640. RW's 14 days gain up to $2,000 ($38 → $60 a day). The full universe's
    4 days gain at $640 ($29 → $34) and at $2,000 ($41), but not at $1,000 ($27). With every print at our price filling
    us, no arm there beats L1 by more than $5 a day but bigger orders at $1,000 ($18 → $39), the arm that loses most one
    step further ($2,000: −$60).
  - Past $2,000, every arm loses at R = 0.4 on the full universe.
  - At R = 0.2, nothing past $640 pays.
- **The rewarded universe:** 1,396 to 1,995 markets of $10 a day and over on the last three days' selections; 116 to 185
  of them clear the $2.50 formula floor; ten are taken.

**Recommendation, for Davies to decide (not applied):**

- Keep today's sizes until the first week of live R is read.
- If R holds at about 0.4 or better, the one step both records support is $640 with orders and markets both raised by
  √2: orders of 1.4 N, 14 markets, $400 of first quotes, $141 a market. On RW's record that is +$7.9 a day at R = 0.4;
  on the full universe +$5.6, and +$1.2 with at-price fills.
- That step needs new code for size multiples, and the POST governor checked: 14 markets is about 7,700 POSTs a day at
  today's rate.
- Past $640, wait for more record.
- The stop's size is his call either way.

**The code it deploys:** `pm_live.ts` sha256 `7e3e8c95823fa9ba3b8b7ca067aa745f41bde5340ed5686b661b4572b31709a3`, where Addendum 7 named `749bfcdb…ef09`
(`lpCapital`, `PM_LP_CAP_CEILING_USD`, `PM_LP_CAP_MARGIN_USD`, `PM_LP_EQUITY_FRESH_MS`; the turn computes the cap
before its quotes and writes it to its state as `lp.capital` and `limits.capTotal`). `0106_pm_lp_reinvest.sql` sha256
`6aa9b3f5f4c1d39ccc7223cd1d3638524c7fae4a88f5257075319701fe86309e`. `pm_lp.ts`, `pm_prep.ts`, 0091, `lp_check.sql` and `lp_readout.sql` are unchanged by it. The capital the
turn holds its buys to is `lim.capTotal`, set before its quotes, so Addendum 7's limit (`capital` in the rule's input)
reads the same figure: at a cap of $400 its 8 % is $32.

**In a live turn:** only the total cap, and through it Addendum 7's limit on near-certain buys (8 % of it). No other rule, and no stop, gate, quote, size, market or governor, changes. The first turn
after both deploys holds $320, because there is no earlier reading to agree with; the next sets it from the equity
(about $322 on today's figures). The first payout (after 2026-10-10 00:00 UTC) raises it the turn after it is read.
**No dry-run decision changes:** with reinvest off, or in dry-run, `lpCapital` returns the config's cap. Mini-pool and
mid-pool never call it, and their configs have no such column. `pm_instance.test.ts`, `pm_mid_formula.test.ts`,
`pm_payouts.test.ts`, `pm_lp.test.ts`, `pm_live.test.ts`, `pm_mid.test.ts`, `pm_prep.test.ts` and `pm_daystop.test.ts`
pass on it unchanged.

**Pinned** (`agents/pm_lp_capital.test.ts`, each failing on the code before):

- The rule by hand-worked cases.
- Armed turns on the fake venue: a payout raises the cap the turn after it is read, and a deposit likewise; off, the
  cap stays $320.
- An unread pUSD never raises it, nor does one high reading between two lower ones.
- A withdrawal lowers it at once, and no buy is sent while holdings and resting buys are over it, while the sell of
  what is held rests.
- A fill still settling holds a raise until it is CONFIRMED.
- `src/pm_live_hash.test.js`: the bytes and the chain of addenda.

## Addendum 9 (2026-10-10, about 01:00 UTC): the reward programme checked every minute

This addendum was written while live-prep is live and before the deploy it records. Under "The window", a change to
`pm_live.ts` deployed after d1 is a deviation an addendum records. Davies, 2026-10-10, verbatim:

> 策略每分钟读的时候都检查奖励配置，避免再次出现这种白挂了并且承担风险并且没奖励的事情

In English: on every minute's read, check the reward programme, so that we never again rest orders that carry the risk
and earn nothing.

**The defect.** The path read each market's reward programme (daily rate, maximum spread, minimum size) once, at the
00:00 UTC selection, and used it all day, to quote and to score each minute's formula (`minuteFormula`). Polymarket
changes programmes during the day, and on 2026-10-09, the first live day, it changed most of the ten. Each market's
programme through the day, as pm-rec's listing reads saw it every 15 minutes (`docs/agents/backtests/lpcfg/`,
`data/config_timeline.json`):

- `0x045fdf4b…` and `0xa326c49f…` ("Gemini 4.0 / Argon released by October 16"): selected at 200 a day, minimum 20;
  from 04:59 and 05:53, 50 a day at a minimum of 50. Our orders are 20 shares.
- `0xecc209a6…` (Iran, Trump voicemail): 200 a day; from 05:18, 20 a day at a minimum of 50; gone from the listing
  from 16:03.
- `0xf0503539…` ("Gemini Argon released on October 10", neg-risk): listed at 98 to 318 a day until 03:53, gone from
  04:08. Not one of its 1,182 two-sided minutes read scoring, yet it carried $84.14 of the day's $153.90 of formula.
- `0xfbd3437c…` (100 Thieves): minimum 50 from 05:49, then 1 to 28 a day, in and out of the listing, gone from 18:49.
- `0x9235351e…`: spread 4.5 → 6.5 from 10:11, 50 → 3 a day from 11:56. `0xeee73848…`: 50 → 5 a day from 14:00.
  `0xf6f3f159…`: minimum 50 from 23:19. `0x5b3350e2…`: 3 or 40 a day by turns all day (the CLOB's own read of it gave
  40 at 00:20 on 10-10 and 3 at 00:40). `0x5fec6675…`: 18 to 44 a day, never under $10.

The formula kept counting the morning's programme, and the path kept quoting markets that no longer paid us.

**What changes** (`PmLpOptions.rewardCheck`, set by live-prep's instance alone, `PM_LP_REWARD_CHECK`):

- **The check, every turn, before anything is posted or kept.** For every market quoted today the turn reads the CLOB's
  own programme (`GET /rewards/markets/{condition_id}`, keyless, a new route of the order path's client) and the
  sponsored listing (`/rewards/markets/current?sponsored=true`, read whole as the selection reads it), all at once. The
  rate is the larger of the native rates in force that UTC day and the sponsored listing's row, as `rewardListing`
  keeps it (`rewardConfigOf`). A market may take entries only while that programme keeps it in the universe the
  selection used (`inUniverse`: $10 a day or more, a maximum spread, N = max(minimum, 5) ≤ 20) (`lpRewardVerdict`).
- **A market that fails it** takes no entry that turn: its buys are withheld and cancelled (gate `reward`), and it is
  worked as a carried market, the sells of what it holds resting at the rule's prices on its selection's programme.
  The minute records why (`detail.lp.out`, `detail.reward`, and the condition text, so a `condition` event when it
  changes). It is judged again the next minute, so a programme that comes back is quoted again.
- **The formula uses the programme as read**: rate, spread and minimum, so `formula_usd` is what the programme pays (an
  ended programme scores 0; a minimum over our size scores 0). The rule quotes on the read spread and minimum too.
- **A read that fails** is never an end. The last good read stands for five minutes (`staleMs`), quietly; after that
  the market takes no entry until a read succeeds, and the turn says so in its errors.
- **The backstop: Polymarket's own verdict.** A live minute in which both of a market's sides read `scoring: false`
  while the formula scores both (`qBid`, `qAsk` > 0) adds one; either side scoring starts the count again; a minute
  that says neither leaves it (`scoringStreak`). At **M = 3** the market takes no entry for the rest of the UTC day.
- **R and today's estimate rest on the minutes Polymarket confirmed scoring** (`lpRewardEstimate`, `lpLiveSummary`):
  R is calibrated on the readout's `formula_scored_usd`, today is estimated from the scored formula by hour (0111 adds
  it to `pm_lp_live_hours`), and LIVE's R (ACTUAL) and DAYS read paid over the scored formula, the whole formula kept
  beside it (`formulaAllUsd`). The prior band (0.2 to 1) and its weight (two days) are unchanged: one live day does not
  say they are wrong. R itself is one exported function, `lpLiveR`, which the estimate calls, so anything else priced
  at the live R can read the same figure.

**Which read, and why the CLOB's.** Measured 2026-10-10 00:25–00:35 UTC on 109 markets (the 20 of 10-09 and 10-10, the
sponsored listing's 30, 60 more of $10 and over at random): the CLOB's per-market programme agreed with the listing's
native rate on 98, and the other 11 were rates that move minute to minute; Gamma's (`clobRewards`, one batched read)
disagreed with the listing on 22, and lags it (`0x3090f7aa…`: Gamma 238, the 00:00 figure, the CLOB 233; `0x1a01bf78…`
Gamma 1,000, the CLOB 923). Gamma is cached five minutes (`max-age=300`), the CLOB's read five seconds. All three agreed
on every minimum and spread, and neither the CLOB's per-market read nor Gamma carries a sponsored rate. So the check
reads the CLOB: one GET a quoted market (ten at most) and one of the sponsored listing, at once, within the turn's
deadline.

**M, from the record** (`results/replay.txt`). On the five markets whose programme kept paying (`0x9235351e…`,
`0x5b3350e2…`, `0x5fec6675…`, `0xeee73848…`, `0xf6f3f159…`) the longest run of the backstop's minutes was 2: M = 1
fires once (`0x5fec6675…` at 21:40), M = 2 and M = 3 never. M = 3 is the shortest that never fires there, with a
minute's margin; **0 false positives at M = 3**. It fires on `0xecc209a6…` at 03:34 (before the listing showed its
change), `0x045fdf4b…` at 04:40 (before the listing's 04:59 read) and `0xfbd3437c…` at 15:50.

**The replay of 10-09** (`scripts/replay.py`; the programme known only at pm-rec's 15-minute reads, so the live check,
every minute, would stop entries up to 15 minutes sooner than here):

| | recorded (selection's programme) | the fixed rules (M = 3) |
|---|---|---|
| formula, the day | $153.90 | $7.56 |
| formula over minutes both sides read scoring | $19.80 | $7.15 |
| market-minutes in markets that no longer paid | — | 8,150 of 13,362 (8,043 by the check, 107 by the backstop) |
| of them two-sided (a buy resting on each side) | — | 5,597 |
| buys filled in those minutes | — | 29 fills, 541.2 shares, $222.12 |
| sells filled in those minutes | — | 20 fills, 350.0 shares, $220.90 |
| R, on the $6.53 paid (the pUSD rise at 00:00) | 0.042 (whole), 0.330 (scored) | 0.864 (whole), 0.913 (scored) |

The 29 buys are inventory the fixed rules would not have taken: no buy rests in a market they have out. Where the
programme held, the fixed formula is the recorded one; the $0.40 of it in minutes whose spread had changed
(`0x9235351e…` from 10:11) keeps the recorded score and is approximate. `0x5b3350e2…` counts as out in the 852
minutes the listing read it at 3 a day; what Polymarket paid for it is the readout's, below.

**The readout of 10-09** (`pm_lp_reward_days`, written 2026-10-10 01:00:01 UTC; `data/readout_2026-10-09.json`): paid
$6.5242 over the ten markets (the account's day total 6.525988 USDC.e). R over the whole recorded formula is 0.042,
over its scored minutes 0.330, over the fixed rules' formula 0.863, and over their scored formula 0.912. By market, on
the fixed scored formula: `0x045fdf4b…` 0.98 and `0xa326c49f…` 1.00 (their scored minutes, all before the change),
`0x9235351e…` 0.94, `0xeee73848…` 0.90, `0xf6f3f159…` 0.87, `0x5fec6675…` 0.77 (a rate that moves all day),
`0xecc209a6…` 0.48, `0xf0503539…` nothing paid and nothing scored. `0x5b3350e2…` (3.3) and `0xfbd3437c…` (3.9) were paid
in minutes the replay has out: at 3 or 1 to 2 a day, under the floor but not nothing. On the programme Polymarket
actually ran, the formula and the payout agree to about 0.9.

**What it means for R now.** The readout's `formula_scored_usd` for 10-09 was scored on the selection's programme, so
the day enters the estimate at R ≈ 0.33 though the fixed formula reads about 0.9. The prior and its weight are kept as
they were (one day says little about them); whether 10-09 should count in R's calibration at all is Davies' call: the
rows themselves are the readout's and stay as written.

**Replacement is not built.** A slot freed during the day stays empty. Refilling it would run the selection again,
which reads the whole listing (38 pages), Gamma and about 1,400 books, inside a turn that also quotes; and the paper
layer and the page take a day's markets as chosen at 00:00. It is left for Davies.

**Deploy.** `0111_pm_lp_reward_check.sql` lets a live-prep minute record a rate under $10 (0091's CHECK `rate >= 10`
becomes `rate >= 0`) and adds the scored columns to `pm_lp_live_hours`. It must apply with or before the Edge deploy:
until it runs, a minute holding a market whose programme fell under $10 fails to record.

**The code it deploys:** `pm_live.ts` sha256 `e76d0234d1b3454d0a4e5b0cdbe7fc1c43f92425626a0d593b91f31035cc6809`, where Addendum 8 named `7e3e8c95…09a3`; `pm_lp.ts` sha256
`c7e3a7ec271b8e798dcc756c3f9d83da2421ddee03f3fede6e3e66a541d173c7`, where Addendum 7 named `98c06007…762c`; `0111_pm_lp_reward_check.sql` sha256 `647cf2ecdfc103eef3aa26c72ca58bc2edb64a7afd4fd3feec06a4a458aab354`;
`_shared/polymarket_orders.ts` (the route and `rewardMarket`) and `agents/pm_lp_live_view.ts` (`lpRewardEstimate` and
`lpLiveSummary` on the scored formula). `pm_prep.ts`, 0091, `lp_check.sql` and `lp_readout.sql` are unchanged.

**In a turn:** dry-run and live alike, the check (it is the rule's); live only, the backstop (a dry-run reads no
scoring). A market that passes is quoted exactly as before on the programme as read; mini-pool and mid-pool set no
`rewardCheck` and read no programme (`pm_instance.test.ts`, `pm_mid_formula.test.ts` and `pm_payouts.test.ts` pass on it
unchanged), and every earlier test of live-prep passes unchanged.

**Pinned** (`agents/pm_lp.test.ts`, `agents/pm_lp_live_view.test.ts`; the four turn pins fail with the check switched
off, and the estimator's on the code before):

- `rewardConfigOf` on the CLOB's reply of 10-10; `lpRewardVerdict` by hand; `scoringStreak` counts, resets and holds.
- Armed: a minimum past N seen in minute t stops the market's entries in minute t itself (its buy cancelled, gate
  `reward`, none sent) while its sell rests and the other markets quote on; the formula follows a rate change (30 / 12
  of the minute before); an ended programme and a rate under $10 stop it too; back in the universe it buys again.
- Dry-run: the same check stops the paper's buys the minute it is read.
- A failed read keeps the last good programme five minutes with no error, never as an end; the sixth minute stops
  entries and says so; a read again decides.
- The backstop fires at the third live minute both sides read not scoring and not at the second, holds for the day,
  and never fires while Polymarket reads us scoring.
- R and today's estimate on the scored formula (10-09's 6.53 over 19.80, not over 153.90).
- `src/pm_live_hash.test.js`, `src/pm_lp_prereg.test.js`: the bytes and the chain of addenda.

## Addendum 10 (2026-10-10, about 02:00 UTC): FUNDED, the payout read at once, R for 10-09, every paper row at the live R

This addendum was written while live-prep is live and before the deploy it records. Addendum 9 deployed at 01:14:15
UTC on 2026-10-10; until then 10-10 was quoted, from 00:00 to 01:15, on its 00:00 selection's programmes, as 10-09 was.
Five changes, in Davies' words where they are his, relayed by the main session the same night.

**1. FUNDED is the money put in.** Davies: "子页面中的FUNDED得显示我实际真实投入的钱（应该是402左右）" (the page's FUNDED must show the
money he actually put in, about 402). It showed the total cap. The path now reads it every live turn (`lpFunding`): pUSD +
what the CONFIRMED fills spent net − what redeemed settlements paid in − the rewards and maker rebates paid (the
readout's live rows). On 2026-10-10 at 01:17 UTC: 172.810385 + 237.718788 − 6.524180 − 1.976628 = **$402.028365**, the
$402.03 found on 10-09 at 14:50 UTC before any payout. The first live turn after 03:10 UTC books it; after that a move
of $1 or more, read alike (to a cent) on two turns at most five minutes apart, with no fill settling, after 03:10 UTC
and once yesterday's payout is read, is booked as a deposit or a withdrawal, each a `pm_lp_events` row of kind
`funding` (`0113_pm_lp_funding.sql` allows the kind; until it runs nothing is booked and the turn says so). The quiet
hours are evidence, not caution: on 2026-10-10 the rewards were in pUSD by 00:05 and the maker rebates ($1.976628)
landed between 00:27 and 01:17, so a residual read in between would have booked them as a deposit. LIVE's row and page
show it as FUNDED (`fundedUsd`), the cap until the path has booked it; today and realised percents are on it.

**2. The payout read at once.** Davies saw "rewards paid $0" and R (ACTUAL) unchanged after midnight: the readout ran
from 01:00 UTC. It now runs from 00:05 (`PM_LP_READOUT`). Before 03:00 yesterday is read every ten minutes while the
account's day total reads nothing, and once it reads a payout it is written (paid, rebates, R) and read again every ten
minutes without counting, since the rebates post later; the read that counts is the first after 03:00, which also
takes a zero as a zero. A day is still never read twice in one UTC day otherwise. Realised, paid and R (ACTUAL) move
within minutes of the payout.

**3. Every paper Reward quotes row at the live R.** Davies: "确保r更新后所有testing的策略都用这个最新的来算他们的r". The pages
showed RW-C's "Reward quotes" and its variants, and the three paper layers, with rewards at the formula (R = 1) and
their worst case at half. The dashboard now reads the live R once (`lpLiveR`, as LIVE's estimate uses it; the prior's
before a payout) and prices each of those rows at it (`atLiveR`): every reward is the formula's times R's point, the
worst case's half becomes R's band's low, in the total, today, realised, each day and each market; fills, holdings and
capital do not move, and each row carries the R it used (`rPricing`). Only what the pages show moves. **Every
pre-registered reading keeps the R it froze**: RW's and RW-C's verdicts, TB1, the RW-X tests, mid-pool's readout,
LPRESEL6 and RWC-OPT read their own tables and scripts, and the paper layers' stops still count closed days at
R = 0.40 (`PREP_R_BREAK_EVEN`); none of them reads the dashboard.

**4. R for 10-09: 0.807, like for like.** The readout's scored formula for 10-09 priced the minutes Polymarket scored at
the 00:00 selection's rates, which it had cut (R 0.33); the fixed rules' formula (Addendum 9's replay, 0.91) leaves out
minutes we quoted that Polymarket still paid at a cut rate (`0x5b3350e2…` reads 3.31 there). The like-for-like figure
is paid over the minutes both sides read scoring, each at its recorded formula times the rate the CLOB listing showed
at that minute over the selected rate (`backtests/lpcfg/scripts/rtrue.py`, `results/rtrue.txt`): **$6.524180 /
$8.081876 = 0.807**. `lpLiveR` reads 10-09 at that figure, market by market (`LP_R_DAY_CORRECTIONS`, pinned to the
script's output), and so do LIVE's R (ACTUAL) and DAYS; the readout's rows are never rewritten. Days from 10-10 on are
measured with the check in place and stand as read (10-10's first 75 minutes were not, as said above).

**5. Sponsored rewards are not why the selection read too high, and the rule is unchanged.** The three markets selected
above what the check then read, `0x5b3350e2…` (40, read 3 on 10-09), `0xa0ab5c59…` (40) and `0xd23c714e…` (47, both
taken out in the check's first minute on 10-10, native 3 and 2, sponsored 0), are in no sponsored listing: it held 30
rows on 10-10 at about 00:20 UTC, $0.001 to $34 a day of sponsors on other markets, and the per-market read folding
sponsors in (`sponsored=true`) gives the same 3 and 2. What moves is their NATIVE programme: pm-rec's 15-minute reads
show `0xa0ab5c59…` at 40 and 3 by turns through 10-09, `0xd23c714e…` at 2 to 8 until 20:22 and then 46 to 54 for two
hours, `0x5b3350e2…` at 3 and 40 by turns all day, and the CLOB's own read of `0xa0ab5c59…` gave 40 at 00:25 and 3 at
01:15. The selection took them at the moment their rate was high. Polymarket's docs say rewards are paid to maker
addresses daily at midnight UTC and the API keeps sponsored earnings as their own stream (`/rewards/user?sponsored=true`,
summed into `/rewards/user/total`), which the readout already reads; no live-prep market has had a sponsored rate, so
there is no record of one paid to this account either way (`actual_sponsored_usd` is 0 on every row of all three
paths). So nothing here shows sponsored rewards unpaid, and taking them out would not have changed 10-09 or 10-10: the
selection and the check keep the listing's total. What would change it is ranking on a rate that does not flip within
the hour (a recommendation for Davies, not built); the check, every minute, already takes such a market out the
minute its rate falls.

**The code it deploys:** `pm_live.ts` sha256 `c990ef3e3ad2700f5552c7a913e1376b7a1fc08368e7b39bd5589ad865a53616`, where Addendum 9 named `e76d0234…6809` (`lpFunding`,
`PM_LP_FUNDING`, `PmLpOptions.readout`, the readout's early read); `pm_lp.ts` sha256 `be8947b58517510dbf91b19ba167a183d6ec20d433a651771e1ba26a9d0356e2`, where Addendum 9 named
`c7e3a7ec…73c7` (`PM_LP_READOUT`); `0113_pm_lp_funding.sql` sha256 `eed1edbfdefb93112f834a51f5784849d93d9ee16add88afad9070a90437e49c`; `agents/pm_lp_live_view.ts`
(`fundedUsd`, `LP_R_DAY_CORRECTIONS`, `scoredFormulaOf`, `atLiveR`), `agents/index.ts` (one R for every paper row) and
the page (`src/agents/agents.js`: FUNDED is `fundedUsd`). Mini-pool and mid-pool set no `readout` and keep their 01:00
read; their paper rows on the page are priced at the live R like every other.

**Pinned** (`agents/pm_lp.test.ts`, `agents/pm_lp_live_view.test.ts`):

- `lpFunding` by hand: the 01:17 figures give 402.028365; the first reading books it; a $100 deposit books on the
  second agreeing reading and not the first; a withdrawal likewise; nothing in the quiet hours, before the payout is
  read, with a fill settling, or on a move under $1.
- Armed: the first reading is an event of kind `funding`; a deposit books after two turns; a payout the readout books is
  never a deposit.
- The early readout: nothing before 00:05; from 00:06 nothing written while the day total reads nothing; once paid,
  written and not counted; counted from 03:01; a zero taken from 03:01.
- 10-09 enters R at 0.807 from the readout's own rows and the pinned table; a later day stands as read.
- `atLiveR` by hand; at R = 1 and a low of 0.5 it leaves a summary as it was.
- `src/pm_live_hash.test.js`, `src/pm_lp_prereg.test.js`: the bytes and the chain of addenda.

## Addendum 11 (2026-10-10, about 02:30 UTC): FUNDED at once, and the paper row off TESTING

This addendum was written while live-prep is live and before the deploy it records. Addendum 10 deployed at 01:45 UTC.

**1. FUNDED shows the money put in at once.** Davies, at 02:18 UTC: "live的Reward quotes子页面中FUNDED还是显示的是$322，而不是我
实际投入的402左右，之前和你说过这事". `lpFunding` held its FIRST booking until 03:10 UTC like every later move, so at 02:18
`state.lp.funding` was null and the page fell back to the cap. The quiet hours exist so that a payout landing is never
booked as a deposit; the first booking books no move, and once yesterday's payout has been read (10-09's counted at
01:00, its rebates in pUSD by 01:17) the residual is the money put in. So the first booking now needs the residual
readable, no fill settling and yesterday's readout counted, and not the quiet hours; every later move keeps every guard.
And the page never shows the cap as FUNDED: the path writes each live turn's reading (`state.lp.fundingResidual`), which
the page shows until the first booking (`fundedBasis` "reading"), and a dash when there is neither.

**2. Its paper row is off TESTING.** Davies: "testing里Reward quotes live-prep这个可以删了". `paperTestRows` no longer lists
`LP_ROW_ID`; the dashboard still carries `prepLp` and adds nothing for it, as it carries mini-pool's since 0103. **Its
paper layer's calls stay on**, because two things still read it: LPRESEL6's frozen reading
(`reviews/2026-10-09-lp-reselect6h-prereg.md`, `backtests/lpresel6/scripts/bar.py`, `sql/aux.sql`) reports L1 against
`pm_lpprep_days` over its window of 10-09 → 10-22, read on or after 10-23; and the path's own dry-run decides on its
paper's holdings and stop (`PmLpOptions.paper`) whenever live-prep is disarmed. RWC-OPT's paper studies
(`exp_paper.sql`, `explim_paper.sql`, `tb1s_forward.sql`) read the record before 10-09 01:32 UTC, which stays; pm-rec
reads `pm_lpprep_minutes` only to know what to record, and the live stop reads none of it. No migration: the calls
can be turned off once LPRESEL6 has read its window.

**The code it deploys:** `pm_live.ts` sha256 `2ae0e7296fd2038fd90bcba61a3daae1e52546fd9f22146789acd5db4a600ca3`, where Addendum 10 named `c990ef3e…3616`; `pm_lp.ts`
and the migrations unchanged; `agents/pm_lp_live_view.ts` (`fundedUsd` from the booking or the reading, `fundedBasis`)
and the page (`src/agents/agents.js`, `agents.jsx`: FUNDED never the cap, a dash when unknown; no live-prep row on
TESTING).

**Pinned:** `lpFunding` books the first reading at 02:20 UTC once the payout is read, and a later move still waits out
the quiet hours; an armed turn at 02:20 with the readout counted books it, and one with the readout uncounted keeps the
reading for the page; the summary's FUNDED is the booking, else the reading, never the cap; `paperTestRows` lists no
live-prep row though `prepLp` is carried, and TESTING's scoreboard and cards are as without it (unit test and the
browser sweep).

## Addendum 12 (2026-10-10, about 03:00 UTC): AI markets out

This addendum was written while live-prep is live and before the deploy it records. It is LP-ALLOC's "Addendum 11"
proposal (`reviews/2026-10-10-lp-capital-allocation.md`), renumbered: Addendum 11 above is FUNDED. Davies left the call
to the main session, verbatim: "由你来决定吧，并且考虑rewards" (you decide, and take the rewards into account). It decided:
live-prep leaves AI markets out. Not blind.

**The rule.** A market whose question `lpMarketType` calls "AI" is not a candidate (`PM_LP_CANDIDATE.excludeQuestion`,
beside the weather fee type), so no 00:00 selection takes one. `lpMarketType` is LP-ALLOC's `typeOf`
(`backtests/lp_alloc/scripts/alloc_run.ts`) word for word, in its order: AI is model releases, model rankings, named AI
companies and models ("ai model", anthropic, openai, gemini, gpt, grok, claude, deepseek, mistral, llm, arena,
livebench, "meta muse", "fable model"), and a question an earlier type claims stays that type (OpenRouter's market
share or token counts are "counts"; "SpaceXAI" matches no keyword). A market of today's selection the rule now passes
over takes no entry from the next turn, worked exactly as the reward check's (Addendum 9): its buys cancelled (gate
`reward`), the sells of what it holds resting at the rule's prices, the reason in `detail.lp.out` and the condition
text. Carried markets keep their close-only sells. Nothing else changes: ten markets, $200 of first quotes, N ≤ 20,
$100 a market, 5N, the −$75 stop, the equity cap, the reward check.

**The hit lists** (`backtests/lpnoai/results/noai.txt`): 10-09's selection had four AI markets of ten (`0x045fdf4b…`
and `0xa326c49f…` "Gemini … by October 16", `0xf0503539…` "Gemini Argon … October 10", `0x5b3350e2…` "Anthropic … #1 AI
model"); 10-10's has one, `0xa0ab5c59…` "Claude Sonnet's output price" (rank 6, already out by the reward check, its
rate fallen to 3). 10-05 to 10-08 had 1, 3, 2 and 6.

**The evidence, rewards counted** (Davies asked for them):
- LP-ALLOC's five-day full-universe replay at $330 (at-price fills, R = 0.47 in its units, the live 0.81): without AI
  markets the rule gives up $48.64 of formula reward over the five days, 31.8 % of today's rule's $153.18 (net of the
  places other markets take), and saves $42.63 of fills' losses: at R that is $22.86 of reward for $42.63 of fills,
  **+$19.77 net, +$3.95 a day**, ahead on 4 of 5 days. By day: 10-05 +0.51, 10-06 −19.05 (it gave up $30.96 of
  reward, 68 % of that day's), 10-07 +13.15, 10-08 +17.56, 10-09 +7.59. With the listing read two hours late,
  +$5.09 a day. The worst day improves from −$57.93 to −$37.70.
- On live-prep's own paper record (its formula, R = 1), AI markets carried $183.44 of $521.18, 35.2 %: 0.6 % on 10-05,
  18.0 %, 12.3 %, 71.6 % on 10-08 and 57.5 % of 10-09's last 93 dry-run minutes.
- What Polymarket paid on 10-09, the one live day: $2.105 of $6.524 (32.3 %) for the four AI markets.
- AI markets are the worst type by markout at 120 minutes on RW's, RW-C's and live-prep's paper fills (−2.80, −3.28,
  −2.99 ¢ a share).
So about a third of the rewards go with them, and on this record their fills cost more than those rewards bring.

**Forward test:** live-prep's live days after the deploy: how the rewards and the fills' P&L compare with LP-ALLOC's
figures, and that no AI-type market is selected.

**The code it deploys:** `pm_live.ts` sha256 `062ee9160c77edafd3c48e36ba3cd4857aed512e4ecc6e0219483818b78d7a50`, where Addendum 11 named `2ae0e729…0ca3` (`PmCandidateRules.excludeQuestion`,
applied by `lpCandidateOf` and to today's markets in the turn); `pm_lp.ts` sha256 `de26be30aaa06feed4d55397b9d8ce1acafeb9db001f980173550fa1342fd1ed`, where Addendum 10 named
`be8947b5…56e2` (`lpMarketType`, `PM_LP_EXCLUDE_AI`, `PM_LP_CANDIDATE`). Mini-pool and mid-pool set no candidate rules
and are unchanged.

**Pinned** (`agents/pm_lp.test.ts`): `lpMarketType` on real questions (the Gemini, Anthropic #1 and Claude Sonnet price
markets, Mistral, the Arena leaderboard, Fable, Meta Muse, OpenAI, Vatican x Anthropic are AI; OpenRouter's market
share and tokens, SpaceXAI, Musk's net worth, MrBeast, UBS, Ethereum, Rotten Tomatoes are not); a candidate list with an
AI market and another leaves the AI market out and changes nothing else; the selection never takes one; one selected
before the rule takes no entry from the next turn while its sell rests and the other markets quote on.

## Addendum 13 (2026-10-10, about 14:00 UTC): the refill, from a live reserve

This addendum was written while live-prep is live and before the deploy it records. Not blind.

**Why.** Davies, 2026-10-10, verbatim: "现在就做补选吧，不然资金利用率太低了，研究出一套最合理的机制" (do the refill now,
or too little of the money works; work out the most reasonable mechanism), then, of the candidates it takes from:
"这个候补名单也要在当天中实时更新比如每分钟之类的" (the reserve must be kept up to date through the day, every minute or
so). On 10-10 the reward check (Addendum 9) and the AI rule (Addendum 12) took today's ten markets out one after another;
what the ten earned by the formula fell from $4.906 in the 00:00 hour to $0.022, $0.107, $0.015 and $0.160 in the hours
from 10:00 (`backtests/lprefill/results/today_formula.txt`, from `sql/today_formula.sql`; what still scored was mostly
the sells of what they hold). The cash of a market taken out sat idle until the next 00:00.

**The rule.** One constant holds every number, `PM_LP_REFILL` in `pm_lp.ts`:

    export const PM_LP_REFILL: LpRefillOptions = {
      afterMin: 15, afterMinAllOut: 0, maxPerDay: 10, perTurn: 1, triesPerTurn: 3, retryMin: 15, reserveSize: 30, refreshTop: 15, rerankEveryMin: 5, idleAlarmMin: 30,
    };

- **The live reserve** (`pm_lp_reserve.ts`, its own call `agents?action=pmlpreserve` every minute, its own lease
  `pm-lp-reserve` and row `pm_lp_reserve`, 0116). Every `rerankEveryMin` minutes, and on a new UTC day once the day's
  selection has landed, the full re-rank: `selectMarkets` itself (the reward listing whole, Gamma, every candidate's
  book, RW's `firstScore`, the formula floor, live-prep's candidate rules) with no market to choose and the next
  `reserveSize` kept in RW's order (`PmSelectOpts.reserve`), every market of today's rows excluded. Every minute, the
  light refresh: the CLOB's programme (`/rewards/markets/{id}` and the sponsored listing's first page, as the reward
  check reads them) of the first `refreshTop`, each marked in the universe or not. A run that cannot rank keeps the last
  reserve and says why (`agents.pm_lp_reserve`). The quoting turn only reads the stored row, so the heavy reads never
  delay a turn.
- **A slot is out** while today's market takes no entry: the reward check, the backstop, the AI rule, or gone from the
  book or the listing, or simply not quoting this turn. Its time out starts at the first turn it is out and resets when it quotes again.
- **The refill.** After the turn's orders, so it never delays a quote or an exit: a slot out `afterMin` minutes
  (`afterMinAllOut`, 0, once no slot quotes: never all idle) is refilled from the reserve in its order, the
  longest-out slot first. A candidate must pass at that minute: Gamma's market (open, accepting orders, live-prep's
  candidate rules: the AI rule, the weather fee type, not ending today), its programme now (the native rate or the
  sponsored one, whichever is higher) inside the N ≤ 20 universe, its book scored as the selection scores it (`scoreBook`,
  RW's `firstScore`, the formula floor), and its capital within $200 beside the other slots'. A candidate that fails is
  skipped, not consumed, and tried again after `retryMin`. Bounds: `perTurn` refills a turn, `triesPerTurn` candidates
  read a turn, `maxPerDay` a UTC day, none once the day's posts reach the 12,000 governor or the turn is past its
  sending deadline. A market of today's rows, replaced or not, is never taken again, and the replaced market takes no
  entry for the rest of the day (its sells rest as the reward check's do).
- **Records.** Each refill is an event of the new kind `refill` (0116: the slot, why it was out and since when, the
  market taken, its rank, its $/day per dollar, capital, formula $/day and rate, the tries, the day's count), written
  before its row of `pm_lp_markets` (`detail.refill`), so a refused event books nothing. The page, the paper layer and
  the readout read it as a market of the day. The 00:00 selection is the day's rows without `detail.refill`, which is what LPRESEL6's
  comparison with live-prep's own selection (`2026-10-09-lp-reselect6h-prereg.md`) should read. QUOTING TODAY counts today's markets less those out now
  (`state.lp.outNow`).
- **Health.** Zero slots quoting for `idleAlarmMin` minutes while the reserve holds a candidate in the universe is an
  error of `agents.pm_lp` (the site's errors box), once every `idleAlarmMin` while it lasts.

Nothing else changes: ten markets at 00:00, $200 of first quotes, N ≤ 20, $100 a market, 5N, the −$75 stop, the equity
cap, the reward check, the AI rule. The numbers are a first setting; a research pass may change them, by an addendum.

**Measured** (`backtests/lprefill/results/rerank_measure.txt`, `scripts/rerank_measure.ts`, against Polymarket from
this container, not from eu-west-1): one full re-rank took 10,019 ms cold and 1,819 ms warm, 102 requests each (48 GETs
of the reward listing, 40 of Gamma's keyset, 14 POSTs of `/books`); a universe of 1,978, 1,312 eligible, 185 and 189
scored, a reserve of 30. The light refresh is 16 GETs a minute. At one re-rank every 5 minutes that is about 20
requests a minute on average, all public reads, none of them a POST of an order.

**Forward test:** live-prep's live days after the deploy: the share of minutes with ten slots quoting, the formula
reward a day against 10-10's, the refills' fills' P&L against the markets they replaced, and that no market is taken
twice in a day.

**The code it deploys:** `pm_live.ts` sha256 `ef036c76a0cc75cf8a9f3bcec2de9e554f0bfb7f44a6b658b89c35aac477c480`, where Addendum 12 named `062ee916…7a50` (`scoreBook`,
`scoredRow`, `PmSelectOpts.reserve`, `LpRefillOptions`, the refill in a live-prep turn); `pm_lp.ts` sha256
`0a85f529d26a397a26ed3e709ab7477ff71a29531b32212fc3805c05e1a32b25`, where Addendum 12 named `de26be30…d1ed` (`PM_LP_REFILL`, the instance's `refill`); `pm_lp_reserve.ts`
(`runPmLpReserve`, new); `0116_pm_lp_refill.sql` sha256 `f30e7c47e82e57d8cd739a8ab9128f99f90c0a0ca507d2f4b37fdd5449a39698` (the reserve's table and lease,
the event kind `refill`, the call's `edge_calls` row). 0116 must apply with or before the Edge deploy: before it, the
refill finds no reserve and refills nothing. Mini-pool and mid-pool set no `lp` options and are unchanged.

**Pinned** (`agents/pm_lp.test.ts`): the reserve's run ranks past today's markets and marks a candidate whose programme
left the universe; a market out 15 minutes is replaced by the first candidate that passes at that minute while one
that fails is skipped and stays in the reserve, with the event and the row written and the replaced market never
taken again; the daily cap holds; once every slot is out the refill starts on the next turn; the alarm fires once after
30 minutes with no slot quoting. `agents/pm_lp_live_view.test.ts`: QUOTING TODAY leaves out the markets out now.

## Addendum 14 (2026-10-10, about 15:00 UTC): a per-market loss guard on buys

This addendum was written while live-prep is live and before the deploy it records. Not blind. Its scope is the guard
alone: the refill's numbers (Addendum 13, `PM_LP_REFILL`) are unchanged, `rerankEveryMin` among them, which waits on
Davies.

**Why.** LP-REFILL (`reviews/2026-10-10-lp-refill-and-guards.md`, its recommendation 2;
`backtests/lp_refill/results/analysis.txt`, stage `guards`) replayed the loss guards on live-prep's record. At $300, at-price fills, R 0.47, 10-05..10-09, on no refill:
- a $10 guard is free: $11.63 a day against $11.16 with none, +$0.47 [−0.61, +1.78]; worst day −$34.56 against −$37.94;
- on live-prep's own 10-09/10-10 selections, quoted as it quoted them, it cut MrBeast wk1 (`0x3090f7aa`) from −$36.91 to
  −$8.95 (its buys stopped after 1,071 shares) and the book's fills from −$44.31 to −$17.66, for $7.78 of formula
  ($200.83 → $193.05);
- on a refill carrier it is free too: under Addendum 13's rule $17.53 → $17.65 a day, worst day −$19.09 → −$15.80;
- below $10 it costs: $7.5 −$3.98 a day, $5 −$11.62.

**The rule.** `PM_LP_MARKET_LOSS = 10` in `pm_lp.ts` (`PmLpOptions.marketLoss`). No BUY rests in a market of today's
(selected at 00:00 or refilled) while its fills are marked $10 or more down: `lpMarketMark`, what its two tokens
realised plus what each holds at RW's adjusted mid of the rest of the book against its average cost (YES at m, NO at
1 − m), from the market's first fill, rewards not counted. A market so marked is worked exactly as the reward check's
`lpOut` is: its buys are cancelled (gate `loss`), the sells of what it holds rest at the rule's prices, its minute says
`carried` with the reason in `detail.lp.out` and the condition text. It is not latched: the turn the mark is above −$10
again, it buys again. A turn with no mark (no book, or a holding and no adjusted mid) keeps the last turn's verdict
(`state.lp.guard`). A market held back by the guard alone still holds its slot: the refill does not count it out, as
LP-REFILL's simulator did not; QUOTING TODAY leaves it out while it lasts, as it takes no entry. A market already out
for another reason keeps that reason.

Nothing else changes: ten markets at 00:00, $200 of first quotes, N ≤ 20, $100 a market, 5N, the −$75 stop, the equity
cap, the reward check, the AI rule, the refill and its numbers.

**Forward test** (LP-REFILL's): the guard's blocks on live-prep's live days, each with the market's mark a day later.

**The code it deploys:** `pm_live.ts` sha256 `59a1201a35b0ef2ccbdf16de933ea7b4469a1c4404146b252c481aa99068a510`, where Addendum 13 named `ef036c76…c480` (`lpMarketMark`,
`PmLpOptions.marketLoss`, the guard in a live-prep turn); `pm_lp.ts` sha256 `a745ca4f7f074a98a320514495f7747184310f300673be80ffb416041f41bc12`, where Addendum 13
named `0a85f529…2b25` (`PM_LP_MARKET_LOSS`, the instance's `marketLoss`). No migration. Mini-pool and mid-pool set no
`lp` options and are unchanged.

**Pinned** (`agents/pm_lp.test.ts`): `lpMarketMark` by hand (−10.01 and −9.99 realised, a NO holding at 1 − m, none
without a fill or without a mark for a holding); a market marked −$10.01 rests no BUY and says why while the other
market quotes on, its slot not out for the refill; at −$9.99 it buys; a further fill that brings the mark to −$9.99
lifts the guard the next turn; with 5 YES held, its buy is cancelled for the guard and the sell of the 5 keeps resting,
the mark counting the 5 at RW's adjusted mid, and the guard holds the next turn from the turn it started. Both turn
tests fail with `marketLoss` unset.

## Addendum 15 (2026-10-10, about 19:45 UTC): the reserve ranked once a day, at 00:00

This addendum was written while live-prep is live and before the deploy it records. Not blind. **It ships only on
Davies' word**, because he asked for the reserve to be kept up to date through the day ("这个候补名单也要在当天中实时更新比如每分钟之类的",
Addendum 13). His answer, 2026-10-10 23:59 UTC, verbatim: "同意" (agreed), given after the main session laid out LP-REFILL's evidence and the live hours above.

**The change.** One number of `PM_LP_REFILL` (Addendum 13): `rerankEveryMin` 5 → 1440.

    export const PM_LP_REFILL: LpRefillOptions = {
      afterMin: 15, afterMinAllOut: 0, maxPerDay: 10, perTurn: 1, triesPerTurn: 3, retryMin: 15, reserveSize: 30, refreshTop: 15, rerankEveryMin: 1440, idleAlarmMin: 30,
    };

The full re-rank (`selectMarkets`, the listing, Gamma, every book) runs once a UTC day, on the reserve's first run after
the 00:00 selection has landed; a run that cannot rank tries again the next minute. What stays live is the part of
"every minute" the record supports: every minute's run still reads the CLOB programme of the first `refreshTop` (15)
candidates and marks each in or out of the universe, and the refill still checks a candidate at the minute it takes it
(Gamma, the candidate rules, the programme, the book's score, the budget). Every other number, the loss guard
(Addendum 14) and the rest of the path are unchanged.

**Why: LP-REFILL** (`reviews/2026-10-10-lp-refill-and-guards.md`, recommendation 1; `backtests/lp_refill/results/analysis.txt`,
at $300, at-price fills, R 0.47 in its units, 10-05..10-09):
- Addendum 13 as deployed earns $17.53 a day, but its refills fill the cap with inventory and its reward then
  collapses: held at the day's close $253–$338 from the first evening, formula $76.5, $5.4, $19.3, $4.9, $0.0 a day
  (no refill: $23.9, $14.5, $24.4, $26.1, $12.7). All nine re-rank settings tested (every 5, 15 or 60 minutes) reach
  $0–$14 a day of formula by 10-08.
- A reserve ranked once at 00:00, its programmes still read every minute, keeps earning: net $16.26 a day, +$5.10
  [−3.97, +13.24] against no refill, ahead on 4 of 5 days; formula $25.9 a day ($20.4 on 10-06..10-09); held at close
  $157–$288; worst day −$27.18.

**Why now: live today** (`backtests/lprefill/sql/after_refill.sql`, `results/after_refill.txt`, read at 19:32 UTC).
The refill took ten markets between 14:23 and 14:52 UTC, the day's cap. The day's markets then earned by the formula
$1.111 in the 14:00 hour, then $1.619, $1.672, $0.852, $0.576 and $0.339 (19:00 to :31), while live-prep's holdings
grew to 18 positions and about $270 at cost (the main session's reading). That is LP-REFILL's own forward-test trigger
for this change: formula falling while holdings stay above $250. MrBeast wk1 (`0x3090f7aa`, the first market a refill
replaced) settled YES (`pm_lp_settlements`, 18:05 UTC); its 86 confirmed fills come to −$32.54 at the payout, rewards
not counted (its 49.94 NO left at 0).

**Forward test** (LP-REFILL's): the formula reward a day, holdings at the day's close, buys withheld by the cap, and
the refills' fills' P&L against the markets they replaced, over live-prep's first three live days after the deploy.

**The code it deploys:** `pm_lp.ts` sha256 `277baa7ad0fb7f79e10ef08c0426e873b4de105fbf9deb060f06a96fcd7de8cb`, where Addendum 14 named `a745ca4f…bc12` (`rerankEveryMin`
and its comment). `pm_live.ts` sha256 `59a1201a35b0ef2ccbdf16de933ea7b4469a1c4404146b252c481aa99068a510` is unchanged, as Addendum 14 named it, so mid-pool's
pre-registration takes no addendum. `pm_lp_reserve.ts` and the migrations are unchanged.

**Pinned** (`agents/pm_lp.test.ts`): the constant; after the day's ranking, runs six minutes and six hours later rank
nothing and read no listing, yet read the candidates' programmes each time and mark one that left the universe and one
that came back, `ranked_at` unchanged and `refreshed_at` moving. The refill's tests run unchanged on it.

## Addendum 16 (2026-10-11, about 00:45 UTC): a carried market in a one-tick book still rests its exit

This addendum was written while live-prep is live and before the deploy it records. Not blind. It is a defect fix: no
number of any rule changes.

**The defect.** LP-CAPINV (`reviews/2026-10-11-lp-cap-inventory.md`, `backtests/lpcapinv/results/carried_unwind.txt`)
found holdings with no exit at all. A market the path works close-only (carried from an earlier day, or taken out today
by the reward check, the backstop, the AI rule or the loss guard) rests the sells `closeOnly` makes of its rule's quote.
In a book whose raw touch is one tick wide, `lpQuotes` returns nothing (TB1's skip, Addendum 2), so `closeOnly` had
nothing to turn into a sell. Two cases:

- `0x5fec6675…` (40.27 YES, $18.73 at the mid) rested a sell in 25 of its 1,454 carried minutes on 10-10, its book one
  tick wide in 1,430 of them.
- `0xd5734dd2…` (20 YES) rested none in 14 of 14 minutes on 10-11.

TB1's skip is a rule about where a reward quote rests. It was never meant to leave a holding with no way out.

**The fix.** A new exit rule, `lpExitQuotes` in `pm_lp.ts` (`PmLpOptions.exitRule`). It is `lpQuotes` without TB1's
skip, through the same function (`lpQuotesOn`), so every other line of the rule is shared.

- **Where the turn uses it:**
  - a market worked close-only (carried, or taken out);
  - a quoting market while opening is stopped (`gates.open` false: the total stop, a gate).
  Only `closeOnly`'s sells of what is held come out of it, so it never rests a BUY.
- **Its price.** RW's `quote` already joins the touch on a one-tick book: its ask at the best ask, its bid at the best
  bid. So the exit is the existing price rule unchanged:
  - a YES held rests a SELL at the best ask;
  - a NO held rests a SELL at 1 − the best bid, NO's best ask.
  Each is post-only; neither crosses (the turn's `crosses` check stands).
- **Its size** is every exit's: N at a time, at most what is held, nothing under the market's minimum.
- **Everywhere else**, in a book two ticks or more wide, it is `lpQuotes` intent for intent, so those exits are as
  before.
- **A selected market still quoting is untouched.** While opening is allowed its rule is `lpQuotes`, TB1's skip
  included, buys and sells alike.
- **Mini-pool and mid-pool** set no `lp` options, and their exits are their rule's as before.

**What is left to settle.** Holdings under the market's 5-share minimum cannot be sold by any order: `closeOnly` drops a
sell under it, and so does the venue. They stay held until their market resolves and is redeemed. They count in the
cap at cost and in the equity, as today. On 10-11 at 00:15 UTC that was six tokens, 14.7 shares, $8.60 at the mid
(`backtests/lpcapinv/results/cross_cost.txt`).

**The code it deploys:** `pm_live.ts` sha256 `b002c55830e0104001eb13715cdabd8e9b83a52d82325bf98e4c10b546c6ba85`, where Addendum 14 named `59a1201a…a510` (`PmLpOptions.exitRule`, the turn's
`exitRule`); `pm_lp.ts` sha256 `2e5ca3ee27afa6875b899dcf4a163bcd0ce935c9cd8482ee4efa5ba278ad9e3c`, where Addendum 15 named `277baa7a…e8cb` (`lpExitQuotes`, `lpQuotesOn`, the instance's
`exitRule`). No migration.

**Pinned** (`agents/pm_lp.test.ts`):

- `lpExitQuotes` on one-tick books at ticks 0.01 and 0.001:
  - 12 YES held rests one SELL of 12 at the best ask, and 12 NO one SELL of NO at 1 − the best bid;
  - 40 held sells N = 20; 4.9 held sells nothing;
  - nothing held rests nothing, and no BUY ever leaves `closeOnly`;
  - on books two, three and five ticks wide it equals `lpQuotes`.
- Armed: a market taken out with 5 YES held, its book closing to 0.46 / 0.47, rests the SELL of 5 at 0.47 and no BUY.
  The same turns on the instance without `exitRule` (the code before) rest nothing. Run on the `pm_live.ts` before
  this addendum, the turn test fails.
- A selected market quoting in a one-tick book rests nothing, with or without the exit rule.
- `src/pm_live_hash.test.js`, `src/pm_lp_prereg.test.js`: the bytes and the chain of addenda.

## Addendum 17 (2026-10-11, about 01:00 UTC): the caps fund whole markets in the day's rank order

This addendum was written while live-prep is live and before the deploy it records. Not blind. **It ships only on
Davies' word**, because it changes which markets the money goes to. His answer, 2026-10-11 00:29 UTC, verbatim: "按照你推荐的来" (go with what you recommend), given after the main session laid out LP-CAPINV's options and recommended rank order.

**Why: LP-CAPINV** (`reviews/2026-10-11-lp-cap-inventory.md`, `backtests/lpcapinv/`).

- **The cap is a cash rule.** `cap_total` counts held stock at cost in every market, and the cap is the equity at cost
  less $80. The holdings cancel, so resting buys may use pUSD − $80, and today that is spent on carried stock: 96 % of
  holdings at 00:15 UTC 10-11.
- **The budget went out in the slot key's order.** Each wanted BUY was funded by condition id, then token id
  (`localeCompare`), if it still fit. At 00:15 that funded:
  - one market two-sided (rank 2);
  - single YES buys in ranks 8, 9 and 10, which RW's formula scores 0 and which still fill;
  - nothing in rank 1 (rate 300).
- **The replay** (`sql/alloc_replay.sql`) covers 10-11's first 20 minutes. Whole markets in rank order fund 63.4 % of
  the day's selection formula two-sided, against 49.2 %, and leave no single-sided buy (25 market-minutes of 177 under
  the slot order).
  - About +$3.9 a day paid at the central realisation (10-10's 0.170 of the selection's formula, 55 % of slot-time
    quoting, R 0.807), and about twice that at the top three ranks' 0.378.
  - No dollar of exposure is added: the cap, the $80, the collateral check and every other number are unchanged.

**The rule** (`PmLpOptions.fundByRank`, set by live-prep's instance alone):

- **The order.** A turn funds its wanted BUYs against `cap_total`, `cap_market` and the pUSD check market by market, in
  the day's `pm_lp_markets.rank`: the 00:00 picks 1–10, refills by their reserve rank 11–20, ties by condition id.
- **Whole markets.** A market's wanted BUYs (one or two) are funded together or not at all. If they do not all fit, none
  rests, each is withheld with the gate that stopped it and the words "its market's buys are funded together or not at
  all", and the next market is tried.
- **A side that sells what is held** is not a buy and needs no budget. Such a market needs only its one buy.
- **Unchanged:** sells, carried markets' exits (Addendum 16), every cap and stop, N, 5N, the near-certain limit, the
  loss guard, the reward check and the refill.
- **Mini-pool and mid-pool** set no `fundByRank`. Their buys are funded slot by slot in the slot key's order, exactly
  as before; the checks are now one function both paths call.

**Forward test**, over the first three live days, from `pm_lp_minutes`:

- the share of the day's selection formula quoted two-sided;
- minutes with a market resting one BUY and no sell;
- the formula a day against 10-10's $30.34.

**The code it deploys:** `pm_live.ts` sha256 `a01c8560ccba06356929baab7235ba74071831241426fa38531240cded03778f`, where Addendum 16 named `b002c558…ba85` (`PmLpOptions.fundByRank`, the
caps' `blocked`, `fund` and `costOf`, the rank-order funding); `pm_lp.ts` sha256 `82d1aa9403dbfd8bbfd4771571a88b53752d186063422d0b684f1934c3e5a850`, where Addendum 16 named
`2e5ca3ee…9e3c` (the instance's `fundByRank: true`). No migration.

**Pinned** (`agents/pm_lp.test.ts`):

- LP-CAPINV's 00:15 case on the fake venue: six markets selected, each pair of buys $4.90, the cap falling to $7.
  - Rank 1's pair rests and nothing else: rank 2's pair does not fit, so no market rests a side alone, and ten buys are
    withheld for `cap_total` with the words above.
  - The slot order before it rests rank 6's pair and rank 1's YES alone.
- A market holding 5 YES needs only its bid's $2.00: at a $9 cap, rank 1's pair and rank 2's one buy rest beside its
  sell, and nothing in ranks 3–6.
- Only live-prep's instance sets the flag.
- Both turn tests fail on the `pm_live.ts` Addendum 16 named.
- `src/pm_live_hash.test.js`, `src/pm_lp_prereg.test.js`: the bytes and the chain of addenda.

## Addendum 18 (2026-10-11, about 02:05 UTC): R's 10-09 in the end rule, the refill waits for cash, exits through a pause, the stop on the page's TOTAL

This addendum was written while live-prep is live and before the deploy it records. Not blind. **It ships only on
Davies' word**, because it changes the end rule's reading, the refill, the pause and the stop. His answer, 2026-10-11 01:41 UTC, verbatim: "同意，这些都按你推荐的来" (agreed, all of these as you recommend), given after the main session laid out LP-CAPDEEP's and LP-OBS-DEEP's recommendations.

The studies: LP-OBS-DEEP (`reviews/2026-10-11-lp-observations-deep.md`, `backtests/lpobsdeep/`) and LP-CAPDEEP
(`reviews/2026-10-11-lp-capital-deep.md`, `backtests/lpcapdeep/`). What Davies agreed to also keeps one number as it is:
**the total cap's $80 buffer stays** (LP-CAPDEEP item 1: keep it, and read it again on 10-16 UTC, after Citigroup and
Prologis settle and Addendum 17's three days are in). The display fix of LP-OBS-DEEP's defect 2 (TESTING's paper rows
priced at R over the whole formula, and the page's R labelled) needed no word and landed just before this addendum; it
moves no rule. Four changes:

**1. The end rule and the readouts read 10-09 like for like** (LP-OBS-DEEP defect 1; due before the 7-day read on or
after 2026-10-16 01:00 UTC).

- `lp_readout.sql` (above) divides by the readout's `formula_usd`, and 10-09's is the $153.90 the 00:00 selection's cut
  programmes gave. On the live record at 01:19 UTC it reads R = 28.4143 / 184.3913 = **0.1541**, under the end rule's
  0.20; at day 7 it would trip on a true R of 0.26–0.37 at $30–$10 of formula a day.
- The frozen script stays as it is. The end rule (R < 0.20 after 7 live days with ≥ 40 market-days) and the 14-day
  readout (R, its 90 % interval by the same day-block bootstrap, on these rows) read its corrected copy instead,
  `docs/agents/backtests/pmlp/lp_readout_a18.sql` sha256 `5ec9a030e3c8eeeea24b40de046c625becbc0d53b427c342a71090cd39af87b8`: 10-09 at its like-for-like
  formula, market by market, **$8.081876** in all (Addendum 10's `LP_R_DAY_CORRECTIONS`, `backtests/lpcfg/results/rtrue.txt`),
  every other day as read, R = paid ÷ formula on the whole formula; each row reports the scored formula and R over it
  beside.
- Run read-only on production at about 02:02 UTC (`backtests/pmlp/results/lp_readout_a18_2026-10-11.txt`): 10-09 0.8072,
  10-10 0.7179, **R 0.7366** over 38 market-days (scored 0.7633). Today's record no longer trips.

**2. The refill waits for the cash** (LP-CAPDEEP item 2).

- No refill is taken in a turn whose free buy budget, min(`cap_total` − committed, pUSD left) read after the turn's own
  funded buys (the cap alone in dry-run), is under **$20** (`PM_LP_REFILL.minFreeUsd`; $20 is the most a candidate's
  first pair of quotes can cost at N ≤ 20). It is checked before any candidate is read.
- Such a turn writes no `refill` event, tries no candidate, leaves the slot's `outSince` running and the day's count
  unused; `state.lp.refill.deferred` says since when and the free budget it read. The next turn tries again.
- Why: 2 of 11 live refills were taken when the cash could not fund them; under Addendum 17's rank order a refill is
  funded last, so it rests nothing, spends one of the day's ten and drops the replaced market for the day. About +$0.5
  a day [+$0.0, +$1.3], and less exposure. Every other number of `PM_LP_REFILL` stays.

**3. The pause withholds only in a market still quoting** (LP-OBS-DEEP item 3).

- In a market worked close-only (carried from an earlier day; taken out by the reward check, the backstop, the AI rule,
  the loss guard or a refill; or any while opening is stopped), the 15 ¢ / 60-minute pause withholds nothing: its exit
  (`lpExitQuotes` through `closeOnly`, Addendum 16) rests as in an unpaused minute. The pause is still judged and kept,
  and the minute says `exitThroughPause`.
- A selected market still quoting keeps x2's pause exactly as frozen: 15 ¢, 60 minutes, buys and sells alike.
- Why: the pre-registration's text puts the pause under the quotes of a selected market and lets a carried market rest
  its sells "until flat or selected again"; Phase A's S2 worked carried stock off before the pause and never paused it;
  and no holding should be left with no way out (Addendum 16's principle), above all after the total stop, when every
  market is close-only. On the record: 400 exit-able paused minutes, none with a through-fill; −$0.07 to +$0.19 a day.

**4. The total stop is the page's TOTAL** (LP-OBS-DEEP item 5).

- Live, the stop's basis is the fills marked at the mids plus the rewards paid **plus the maker rebates the readout
  booked, less the CONFIRMED fills' fees** (`pmLiveFillFee` on each trade record, as the page reads it): the page's
  TOTAL. It trips when that reaches −$75, so the stop caps the deposit's loss at $75, not $75 less the rebates ($6.79 on
  10-11). The `loss_stop_total` event names each part. In dry-run it is unchanged (the paper's closed days at R = 0.40).
- The live page shows the stop's room under the scoreboard: "total stop at −$75: $X of room (total $Y)".
- It trips later by the rebates booked, about $3.4 a live day so far; the room at 01:00 UTC was $71.37 without them.

Nothing else changes: ten markets, $200, N ≤ 20, $100 a market, 5N, the near-certain limit, TB1's skip, the reward
check, the AI rule, the loss guard, the refill's other numbers, the rank-order funding, the equity cap and its $80.

**Forward test:** over the first three live days after the deploy, the refills taken and deferred (and for how long),
each refill's two-sided minutes in its first hour, the exits filled in paused close-only markets with their markouts at
60 minutes and 6 hours, and the stop's room against the page's TOTAL each hour.

**The code it deploys:** `pm_live.ts` sha256 `ee96ba0e40e38ac9999f78028470cc8713584cf05c45539f265eca76c2d3667d`, where Addendum 17 named `a01c8560…778f` (`PmLpOptions.pauseQuotingOnly`,
`PmLpOptions.stopCountsRebates`, `LpRefillOptions.minFreeUsd`, the turn's `pauseSpares`, the stop's `rebates` and
`fees`, the refill's `freeUsd`); `pm_lp.ts` sha256 `53f7f788a47e93f52770f96410db9faf8f34cdd7dc2cf4ddbd877c9038d07278`, where Addendum 17 named `82d1aa94…a850`
(`minFreeUsd: 20`, the instance's `pauseQuotingOnly: true` and `stopCountsRebates: true`); `agents/pm_lp_live_view.ts`
(the stop's basis is the TOTAL, with `rebateUsd` and `feesUsd`) and the page (`src/agents/agents.js`'s `lpStopRoomText`).
No migration. Mini-pool and mid-pool set none of the three and are unchanged.

**Pinned:**

- `agents/pm_lp.test.ts`, each failing on the `pm_live.ts` Addendum 17 named:
  - a market taken out with 5 YES held, its book jumping 20 ¢, rests the SELL of its 5 at 0.67 through the pause, while
    BIG, selected and quoting, paused alike, rests nothing; without `pauseQuotingOnly` nothing rests in either;
  - LP-CAPINV's case on the fake venue: a slot out 16 minutes with $7.10 free takes no refill, tries no candidate, keeps
    its slot out and the count at 0; with $40.10 the next turn refills; without `minFreeUsd` it refilled on $7.10;
  - rewards $10 and rebates $5 trip the stop at fills −$90 (basis −$75) and not at −$85; a taker's fee takes −$89.50 past
    it; without `stopCountsRebates` −$85 tripped.
- `agents/pm_lp_live_view.test.ts`: the page's stop basis is its TOTAL (+3.05 on the hand-worked record, $78.05 of room).
- `src/pm_lp_prereg.test.js`: the corrected readout's bytes, its 10-09 figures equal to `LP_R_DAY_CORRECTIONS` ($8.081876),
  and on the live record of 10-11 01:19 UTC its arithmetic reads 0.7366, where the frozen script's reads 0.1541.
- `src/pm_live_hash.test.js`, `src/pm_lp_prereg.test.js`: the bytes and the chain of addenda.

## Addendum 19 (2026-10-13, about 03:30 UTC): quiet books, 2N, 90 % of the cap, and a −$25 stop from a restart; no dry-run day

This addendum was written while live-prep is stopped (its −$75 total stop tripped on 2026-10-12 07:30 UTC and latches) and
before the deploy it records. Not blind: every figure of LP-BEST was seen before it. **It ships only on Davies' word**,
which it has. His answer, 2026-10-13 about 01:40 UTC, verbatim: "做B，不用空跑吧 做好后验证没问题了直接上线吧？" (do B; no dry
run needed, is it? once it is built and verified, go straight live?), given after the main session laid out LP-BEST
(`reviews/2026-10-13-lp-best-strategy.md`, `backtests/lpbest/`): A was to end Polymarket rewards, B its §7 design under the
§8 test. **The dry-run day LP-BEST proposed is waived on his word.** "直接上线" is his go for once the build is verified: the
restart is still one statement, run in a conversation where he says go, after the checks below; nothing here runs it.

**The evidence.** LP-BEST's simulator, calibrated to live-prep's own orders and validated on its own rule and picks
(−$24.96 a day against live's −$21.77), found quoting a tick inside the touch losing across the reward universe, and one
positive design: quiet books. Chosen on 10-05 → 10-08 by the highest 5 % bound and read once on 10-09 → 10-12: **+$4.23 a
day [+$1.57, +$7.12] out of sample**, +$3.62 [+$1.38, +$6.02] over the eight days at $316 of equity, worst day −$10.34,
2.92 ¢ of rewards a filled share against live's 0.66 ¢. Not larger with more money. What it could not measure: R in quiet
books, the half of each day pm-rec did not record the picked markets, and other makers' answer (the review's "Not checked").

**What changes.**

1. **Quiet books only** (`PmCandidateRules.quiet`, `PM_LP_QUIET`). A candidate is taken only where its book without our
   orders has a touch of **at least 4 ¢** (`scoreBook`'s `narrow`), and only once **one read** of the data API's
   `/v2/trades` for its market (keyless, `_shared/polymarket_public.ts` `pmTakerShares`, 100 trades; on 2026-10-13 it gave
   the same 24-hour sums as the `/trades?takerOnly=true` LP-BEST read) shows **at most 50 taker shares in the 24 hours
   before the read** (`quietVerdict`). A read that fails, or a page of 100 trades all inside the 24 hours (a sum that may not
   be all of them; a quiet book held at most 9 a day on LP-BEST's 6,063 quiet market-days), is not quiet: **a market is
   never assumed quiet**. The day's markets are RW's `choose` over the quiet candidates (`quietChoose`): in RW's order, a
   candidate is read only while it could still be taken, ten at once, **150 reads at most** a selection (LP-BEST's walk read
   25 to 51 a day for its eleven picks), and a data API that answers nothing stops the walk after twenty failures; a
   selection that took nothing because its reads failed is tried again five minutes later, as any failed read of the
   selection is. The reserve (`pm_lp_reserve.ts`) is ranked the same way, quiet books only, and the refill takes a reserve
   candidate only if one more read shows it quiet at that minute and its touch is 4 ¢.
2. **The quote rests only on a 4 ¢ touch** (`PM_LP_TIGHT = { minTouchCents: 4 }`, in place of TB1's one-tick skip of
   Addendum 2): RW's price and N a side, as before, while the raw touch is at least 4 ¢; nothing that minute where it is
   narrower. The exit of a market worked close-only keeps no skip (Addendum 16).
3. **2N** (`PM_LP_INV_CAP` 5 → 2): a side stops at 2N of inventory its way.
4. **The day's markets inside 90 % of the total cap** (`PmLpOptions.selectShare`, `PM_LP_SELECT_SHARE`): the selection's
   budget of first quotes is 90 % of the cap the last turn held (the equity's, Addendum 8, less $80) and never over
   `select_budget_usd`; the refill's is 90 % of the turn's cap. `max_markets` goes to the code's 12 (the budget binds
   first: LP-BEST's eleven a day).
5. **A total stop of −$25 counted from a restart** (`PmLpOptions.restartable`; migration `0119_pm_lp_restart.sql`,
   `pm_lp_config.restarted_at` and `restart_loss_usd`):
   - The stop latches only on an event written from the restart's minute: the event of 10-12 07:30 UTC no longer holds the
     path once a restart is set; it stays in `pm_lp_events` as written.
   - Its basis from the restart: the fills' **change since then** (each holding at the restart from its mid then, read by
     the first turn after it and kept in `pm_lp_state.state.lp.stop.open`; `sinceOpenPnl`), plus the rewards paid and the
     maker rebates for the UTC days **from the restart's day**, less the fees of fills matched since it. A holding of the
     restart with no mark read yet (this turn's, the last turn's or a settlement's payout) leaves the stop unjudged: nothing
     opens that turn.
   - Its limit is `restart_loss_usd`, **$25**. `loss_total_usd` stays $75, because the cap is the equity less it and $5
     (Addendum 8), which is the cap LP-BEST priced.
   - On the restart's UTC day, the markets selected before it are no longer the day's (carried where they hold anything)
     and the day is **selected again at once** by these rules; its refill count starts again; the reserve is ranked again.
   - The live page's stop line reads "total stop at −$25 since <the restart> UTC: $X of room (since then $Y)" from the
     path's own reading (`state.lp.stop`).
6. **The stock carried into the restart** (about $32 at cost on 10-13 02:07 UTC, fifteen markets, most of it dust): it
   keeps its exits resting, close-only (`lpExitQuotes` through `closeOnly`, Addendum 16), and takes no buy unless a market
   of it is selected again by these rules; it counts in the new stop only by its moves from its mark at the restart. Its
   loss to the restart is the record's, not the test's.

**Nothing else changes**: the reward check and its backstop (Addendum 9), no AI market (12), the per-market loss guard
(14), the pause (x2's, and Addendum 18's exits through it), the near-certain limit (7), the caps in rank order (17), the
refill's cash check and its other numbers (13, 15, 18), $100 a market, N ≤ 20, the equity cap and its $80 (8, 18), the
governor of 12,000 POSTs, the region, the Ireland attestation, the CTF approvals, the payouts per path. The order path's
mini-pool and mid-pool are unchanged (mid-pool's deviation 19).

**The test: 14 live days from the restart.**

- The window: the first 14 full UTC days after `restarted_at`; the day of the restart is read beside them, not in the bar.
  A day-7 reading is descriptive only.
- **The bar, on day 14**, every condition, read from `pm_lp_*` (live rows) and the readout's payouts:
  1. the total from the restart (the stop's basis as the path keeps it: fills since the restart marked at the mids, plus
     the rewards paid and the rebates for the days from the restart's day, less fees) is **at least $0**;
  2. rewards paid are **at least 1.5 ¢ a filled share** over the window (live-prep was paid 0.66 ¢; LP-BEST's 2.92 ¢);
  3. **no UTC day below −$15**, and the −$25 stop not reached.
- **Meaning.** Pass, and Davies decides whether to keep it running at the same size (more money did not help in LP-BEST).
  Fail any condition, or the stop trips, and Polymarket rewards end: the path stays stopped, the result is recorded, and
  nothing is re-tuned on the test's own days.
- Read beside it, descriptive: R in quiet books (paid ÷ the whole formula, `lp_readout_a18.sql`'s way, over the window's
  market-days); quoting minutes; the fills' 60-minute markout; how many quiet books each 00:00 finds and how many reads it
  spent (the selection event's `quiet`).

**What the earlier readings now are.** None is dropped.

- **The 7-day end rule** (R < 0.20 after 7 live days with ≥ 40 market-days, read with `lp_readout_a18.sql` on or after
  2026-10-16 01:00 UTC) stays in force as written, over every live day: it can only stop the path. On the record of 10-09 to
  10-12 (R 0.74 on 10-11's reading) it does not trip. It is also read over the restart's own days, from their seventh with
  at least 40 market-days: R < 0.20 in quiet books stops the test. That second reading is this addendum's, the same script
  over `day >=` the restart's day.
- **The 10-16 re-read of the $80 buffer** (Addendum 18, LP-CAPDEEP item 1) is still made and reported, and changes nothing
  during the window: LP-BEST priced the cap at the equity less $80.
- **The 14-day readout** of the pre-registration (R with its 90 % interval, the P&L at the measured R, per market, capital,
  the fills per share) is read once, at the window's end, split by rule: 10-09 → 10-12 (Addendum 18's rule) and the
  restart's 14 days (this one's). The bar above decides; the readout reports.

**The go: one statement**, in the conversation where Davies says go, after the deploy and the migration (`0119`). It
restarts only if the path's state is fresh (a turn within five minutes), runs this addendum's code (`state.lp.addendum` 19),
holds the key for the stored signer in `eu-west-1`, the config is still armed, his attestation is current and neither other
path is armed; otherwise `restarted_at` stays null and the path stays stopped:

    update public.pm_lp_config c
       set restarted_at = case when s.at is null or s.at < now() - interval '5 minutes'
                                    or s.addendum is distinct from 19
                                    or s.keyed is not true or s.region is distinct from 'eu-west-1'
                                    or c.dry_run or c.live_confirmed_at is null
                                    or c.ireland_attested_at is null or c.ireland_attested_at > now()
                                    or (c.ireland_until is not null and c.ireland_until <= now())
                                    or exists (select 1 from public.pm_live_config o where o.live_confirmed_at is not null)
                                    or exists (select 1 from public.pm_mid_config o where o.live_confirmed_at is not null)
                               then null else now() end,
           restart_loss_usd = 25, max_markets = 12, select_budget_usd = 320, updated_at = now()
      from (select (state->>'at')::timestamptz as at, (state->'lp'->>'addendum')::int as addendum,
                   (state->>'keyed')::boolean as keyed, state->>'sbRegion' as region
              from public.pm_lp_state where id = 1) s
     where c.id = 1;

Read back: `select restarted_at, restart_loss_usd, max_markets, select_budget_usd, loss_total_usd, reinvest, dry_run,
live_confirmed_at from public.pm_lp_config;` A null `restarted_at` is a refusal (a check failed). **To undo it**, one
statement: `update public.pm_lp_config set restarted_at = null where id = 1;` the next turn latches the 10-12 stop again
(close-only, sells armed). A later restart is the same go statement again, on Davies' word.

**Before the go** (read-only): the deploy carries this addendum's bytes (`select state->'lp'->>'addendum',
state->>'openBlockedBy', updated_at from public.pm_lp_state;` reads 19, `loss_total`, within a minute); 0119 is applied
(`select restarted_at, restart_loss_usd from public.pm_lp_config;` answers, null and null); the error box holds nothing new
of `agents.pm_lp`. **In the first minutes after it**: the selection event (`select minute, detail->'picked',
detail->'quiet', detail->'narrow', detail->'budget', detail->'restart' from public.pm_lp_events where kind = 'selection'
order by minute desc limit 1;`) names the picks, its reads and failures; each pick's 24-hour taker shares, read keylessly
(`https://data-api.polymarket.com/v2/trades?condition=<cond>&limit=100`), are 50 or fewer; each pick's public book
(`https://clob.polymarket.com/book?token_id=<yes token>`) has a touch of 4 ¢ or more beside our own orders; `state.lp.stop`
shows the restart, $25, a basis near 0; and no BUY rests in a market that is not one of the picks. Anything else: undo
it, as above.

**The code it deploys:** `pm_live.ts` sha256 `28930ad918b0358c98e6bd6268715c6fd845b6092bcefcd1b44ffd45daf7f43d`, where Addendum 18 named `ee96ba0e…667d`
(`PmCandidateRules.quiet`, `quietVerdict`, `quietChoose`, `scoreBook`'s touch, `PmLpOptions.quietRead`, `selectShare` and
`restartable`, `lpSelectBudget`, `lpRestartOf`, `restartOpenMarks`, the turn's restart, its stop's basis and
`state.lp.stop`); `pm_lp.ts` sha256 `08be78270a160003b36ddc3b269072c0c0a37a6fe4b823f2b91d8fc73ad89ac9`, where Addendum 18 named `53f7f788…7278` (`PM_LP_QUIET`,
`PM_LP_TIGHT`'s 4 ¢, `PM_LP_INV_CAP` 2, `PM_LP_SELECT_SHARE`, `lpQuietRead`, `lpRulesOf`); `pm_lp_reserve.ts` (the restart,
the quiet reserve); `_shared/polymarket_public.ts` (`pmTakerShares`); `pm_lp_live_view.ts` (`restartStopOf`, today's rows
since the restart) and the page (`lpStopRoomText`); `0119_pm_lp_restart.sql` sha256 `88437a1920a974a7c33396eaa5e0bbe70b6d36e882d1b29318bdfbb7741a7836`.

**Pinned** (each against Addendum 18's instance, `LP_A18_INSTANCE` in `agents/testing.ts`, or code):

- `agents/pm_lp.test.ts`: the rule (nothing under a 4 ¢ touch where Addendum 18's quoted two and three cents; rwQuotes from
  4 ¢; 2N where 5N bought; the exit on any touch); `quietVerdict`; `quietChoose` equal to `choose` over the quiet
  candidates on 300 random worlds, reading only what could be taken and never more than its bound, a failed read never
  taken; `pmTakerShares` on the fake data API (the window, a full page not complete, a failure); the restart's pure
  functions; a day's selection taking two quiet books and passing over one that traded 60 shares (Addendum 18 took all
  three), nothing from two-cent books, $288 of budget at $320, nothing when the data API is down; and the restart, armed:
  the 10-04 stop no longer holding, $49 of carried loss not counted, a fall of $35 after it tripping the $25 stop from its
  minute, while without the restart the old stop holds; the day selected again at the restart.
- `agents/pm_lp_live_view.test.ts`: the page's stop from the path's reading, the old stop history, today's rows since the
  restart. `src/agents/agents.test.js`: the stop line from the restart.
- `src/pm_live_hash.test.js`, `src/pm_lp_prereg.test.js`: the bytes and the chain of addenda.

## Addendum 20 (2026-10-13, about 13:40 UTC): the restart's dust holdings

**On whose word.** Davies, 2026-10-13, on Addendum 19 going live: "B上线后盯着，每隔1-2小时查看一次有问题立马修复" (watch B after it
goes live and fix any problem at once).

**What went wrong.** Addendum 19's restart opened at 2026-10-13 13:25:32 UTC, and every turn after it wrote "the restart's
opening marks are not all read (3 token(s) …)": three holdings of the restart had no mark (4.2791 and 0.0031 shares in
0x0608b79b…, 0.0075 in 0x225b0d56…, both markets closed and not yet settled, so no book), and a holding with no opening
mark keeps the stop unjudged, so nothing opened.

**What changes.** A holding of the restart under the venue's 5-share minimum (`PM_RESTART_DUST_SHARES`; Addendum 16 leaves
such holdings to settle) with no mark opens at 1, the most a share can pay (`restartOpenMarks`' `dust`): it can then only
count as a loss, never a gain, here at most $4.29. A holding of 5 shares or more with no mark still holds every opening
back, as before. Nothing else changes: the selection, the quotes, the stop's limit and the restart's instant are Addendum
19's. Pinned in `pm_lp.test.ts` (it fails on Addendum 19's `restartOpenMarks`).

**The code it deploys:** `pm_live.ts` sha256 `9c4174f30523225520f92a0ecd50082d9490e88e43a686a737fdd6629f34a231`, where Addendum 19 named `28930ad9…f43d`.

## Addendum 21 (2026-10-13, about 15:40 UTC): the exit rests under the 4 ¢ touch

**On whose word.** Davies, 2026-10-13: "B上线后盯着，每隔1-2小时查看一次有问题立马修复".

**What went wrong.** The watch of 15:16 UTC found Q2's first fill (BUY 20 NO at 0.85 in 0xe612eb64…, 13:45:09) holding with
no sell: once that market's book narrowed under 4 ¢, Addendum 19's touch rule returned nothing for it, the exit of what it
held included, because it was still a quoting market (only close-only markets took `lpExitQuotes`, which has no skip).
The rule was meant to keep new buys out of narrow books, never to keep the path in a holding.

**What changes.** Under the touch rule a quoting market rests the sells of what it holds, at the price the rule without
the skip gives them, and nothing else (`lpQuotesOn`'s first `skip` line); from 4 ¢ it is Addendum 19's rule. Nothing else
changes. Pinned in `pm_lp.test.ts` (it fails with the line taken out).

Checked and left as it is: the same watch asked whether "Will Anthropic have the highest OpenRouter market share…" (selected
at 13:26) should have been out as an AI market. Addendum 12 keeps such questions in on purpose: `lpMarketType` types it
"counts" first, as LP-ALLOC's rule has it, and `pm_lp.test.ts` pins that choice.

**The code it deploys:** `pm_live.ts` sha256 `9c4174f30523225520f92a0ecd50082d9490e88e43a686a737fdd6629f34a231` (Addendum 20's, unchanged) and `pm_lp.ts` sha256 `9cc5a4430730f845333b948a6060746af280faeed84e0eb501f1702c1185bd48`, where Addendum 19
named `08be7827…9ac9`.

## Addendum 22 (2026-10-14, about 03:40 UTC): no refills

**On whose word.** Davies, 2026-10-14, verbatim: "同意 Addendum 22（取消补选）", on the day-1 post-mortem
(`reviews/2026-10-14-q2-day1-postmortem.md`).

**Why.** Over Q2's first 12.6 live hours (10-13 13:26 → 10-14 01:59 UTC) the path lost $8.51 against the engine's +$1.76
for the span. The largest single cause, −$4.80, was the refill, which LP-BEST never priced: a quiet book's programme dips
under the $10 floor on almost every day (89–98 % of market-days) for a median of 72–75 minutes and comes back, so the path
kept swapping dipped picks for fresh ones, never retaken, and 5 of the 7 markets that filled were refills (−$8.10 of the
fills' −$10.67). On 10-05 → 10-12, keeping the picks beats Q2-as-live on 8 of 8 days, +$2.27 a day [+1.59, +2.88]; calibrated
to live's day-1 rewards it reads +$1.47 a day [−0.65, +3.72], rewards 1.53 ¢ a filled share. Nothing else priced beat it.

**What changes.** `PM_LP_REFILL.maxPerDay` 10 → 0: a pick whose programme dips keeps its slot, takes no entry while it is
out, rests its exits, and quotes again when its rate is back, as Addendum 9's check already does minute by minute. The idle
alarm, which watched the refill, now needs six hours of no slot quoting (`idleAlarmMin` 30 → 360). The refill's mechanism
stays in `pm_live.ts` unchanged, and its tests run on Addendum 21's numbers. Not fixed by this: the adverse fills, x2's
pause in wide books (about $1.7 a day), R measured on one day. The 14-day bar of Addendum 19 is unchanged and is read over
the restart's whole window, the days before this addendum included and named.

**The code it deploys:** `pm_live.ts` sha256 `9c4174f30523225520f92a0ecd50082d9490e88e43a686a737fdd6629f34a231` (Addendum 20's, unchanged) and `pm_lp.ts` sha256 `82ae7a72724515ad49b059d9e00f98888c7f6cb44ea6d483f22b2602b4ae78bb`, where Addendum 21
named `9cc5a443…bd48`.


## Addendum 23 (2026-10-15, about 15:20 UTC): a part holding's exit under the 4 ¢ touch, and the restart's dust left to the record

**On whose word.** Davies, 2026-10-15, verbatim, as the main session relayed it: "Addendum 21和Addendum 20都修复了" (fix both Addendum 21 and
Addendum 20), on the two calls the evening audit of 2026-10-14 put to him (`docs/LEDGER.md` item 0c, points 1 and 2).
This is not the draft "Addendum 23" of `reviews/2026-10-14-q2-trips.md` (entries 4 ¢ from the adjusted mid), which was
never adopted.

**When.** Live-prep's Q2 has been closed to close-only since 2026-10-15 00:08 UTC (`restarted_at` null, `openBlockedBy`
`loss_total`, its held lots exiting). Neither fix changes a decision while it stays so: the first acts only in a market
still quoting while opening is allowed, the second only while a restart is set. They are for its exits if it quotes
again and for any later restart, which stays Davies' word.

**1. Addendum 21's exit gap.** Under the 4 ¢ touch a quoting market rested the sells of what it holds through the rule
without the skip, keeping its SELLs. That rule sells a holding only of N or more; for one between the venue's 5-share
minimum and N its side is a BUY, which the filter dropped, so the holding rested no exit: 0x3b162968…'s 9 shares (N = 20)
sat 32 minutes with none on 2026-10-14. The line now goes through `closeOnly`, as the close-only path's exit does: the BUY
on that side becomes the SELL of what is held at the same price, N at most; a SELL the rule already makes is unchanged,
and nothing under the 5-share minimum rests (Addendum 16). From 4 ¢ the quoting rule is Addendum 19's, unchanged.

**Checked, the close-only path that runs now** (`lpExitQuotes` through `closeOnly`): a holding between 5 and N has its exit
there, since `closeOnly` already turns the side's BUY into the sell. Three narrower cases rest no exit, on that path and
under the touch alike, because each depends on the rule making a BUY or a quote on that side; read from the code and
checked on hand-made books, not on the live record, and not changed here (no word asks for it):
- a part holding of the cheap token while the other is at 0.95 or more and its buy is refused by the near-certain limit
  (Addendum 7): 9 NO at 0.04 against YES 0.96 / 0.98 rests none at a $100 cap, and does at $1,000 (at most 19 shares at
  ≤ 5 ¢, under $1);
- a part holding of one token while the other is held 2N or more net (50 YES and 9 NO: the 9 NO rest none);
- a book with no level of the minimum on one side within the spread, where RW's quote is null: no exit at all, a full
  holding included (as Addendum 16 found for one-tick books before its fix).

**2. Addendum 20's dust.** Addendum 20 opened a restart holding under 5 shares with no mark at 1. If its closed market
then settles at 0 the restart's stop takes the whole share count as a loss: 0x0608b79b…'s 4.28 shares, up to $4.29 of
Q2's $25. That loss was decided before the restart, and §6 of Addendum 19 says the stock carried into a restart counts
only by its moves from its mark at the restart, its loss to the restart being the record's. Now such a holding opens at
no mark (`restartOpenMarks`' `pending`): it holds nothing back, as under Addendum 20, counts nothing while it has no
mark, and opens at the first value a turn reads for it, its book's mid or its settlement's payout, from which its moves
count as every carried holding's do. A settlement read this very turn (`newSettlements`) now gives that payout as well,
so a holding with no opening mark settled in the turn the path first sees it is not counted from cost. A holding of 5
shares or more with no mark still holds every opening back, as before. The state's `lp.stop.pending` counts them.

Nothing else changes: the selection, the quotes from 4 ¢, 2N, the 90 % budget, the $25 restart stop and its basis for
every marked holding, no refills, the restart's go statement (`state.lp.addendum` still reads 19), the pause, the caps.
Mini-pool and mid-pool set no `lp` options and are unchanged (mid-pool's deviation 21).

**The code it deploys:** `pm_live.ts` sha256 `175844206ce33a714db763139815525a61bb353388dd897eb9dc48c875d8324b`, where Addendum 20 named `9c4174f3…a231` (`restartOpenMarks`' `pending`,
the restart's `known` with this turn's settlements, `lp.stop.pending`); `pm_lp.ts` sha256 `8303fd97ec106535af9b5a5b1116941996c766e3f0acd5f564feafeb40da9f0c`, where Addendum 22 named
`82ae7a72…78bb` (`lpQuotesOn`'s exit under the touch through `closeOnly`). No migration.

**Pinned** (`agents/pm_lp.test.ts`):
- under 1, 2 and 3 ¢ a quoting market holding 9 NO, or 9 YES, of N = 20 rests the SELL of 9 at the price the full holding's
  sell takes; 9 YES and 25 NO rest a sell of each, 20 and 9; 4.9 rests nothing; at 4 ¢ the rule is Addendum 19's. It
  fails on Addendum 22's `pm_lp.ts`;
- `restartOpenMarks`: dust with no mark is pending, not missing and not at 1, and opens at a later turn's value;
- armed, a restart carrying 4.2791 YES (bought at 0.60) in a closed market with no book: nothing held back, none counted;
  once Gamma shows it resolved NO it settles at 0, opens at 0 and the stop's fills stay 0, its room the whole $25. With
  Addendum 20's opening at 1 the same fills gave −4.2791. Both fail on Addendum 20's `pm_live.ts`;
- `src/pm_live_hash.test.js`, `src/pm_lp_prereg.test.js`: the bytes and the chain of addenda.

## Addendum 24 (2026-10-15, about 16:15 UTC): liquidate what is held, at the bid

**On whose word.** Davies, 2026-10-15 about 16:05 UTC, verbatim, as the main session relayed it: "那目前的单都尽快卖出掉吧，还剩多少"
(sell the remaining positions as fast as possible; how much is left?). The account is to be clean for a separate
experiment, with live-prep's TOTAL and stop no longer moving.

**Where it starts.** Live-prep has been close-only since 2026-10-15 00:08 UTC (`restarted_at` null, `openBlockedBy`
`loss_total`, still armed so its exits work); pUSD $300.48 at 16:04 UTC. Holdings of 5 shares or more then, as relayed:
0x7465aead… 40 YES (book 0.12 / 0.13, its exit SELL 20 at 0.13), 0x76051f8c… 6 NO (YES's book 0.71 / 0.73, its exit SELL
6 NO at 0.29), 0xecc209a6… 80 YES (book 0.002 / 0.01, no exit resting). Everything else is dust under the 5-share
minimum, which no order can sell: it waits for settlement and redemption.

**What changes.**

1. **The switch:** `pm_lp_config.liquidate_at` (`0123_pm_lp_liquidate.sql`), set by that migration's one statement,
   which the same push applies: `update public.pm_lp_config set liquidate_at = now(), updated_at = now() where id = 1 and
   restarted_at is null and liquidate_at is null;`. A CHECK keeps a liquidation and a restart from ever both being set,
   so it does not apply while a restart is set, and no restart can be set while it liquidates. Undone by `update
   public.pm_lp_config set liquidate_at = null where id = 1;` (the exits rest at the ask again).
2. **Nothing opens** while it is set: a gate of its own, `liquidate` (`gates`' `liquidating`), stops every BUY whatever the
   other gates say, a restart included; sells are untouched by it.
3. **Each token held at the venue's minimum or more is sold whole at the best bid** (`lpLiquidation`): the whole holding
   (to the hundredth of a share), not N at a time; YES at YES's best bid of the book without our orders, NO at 1 − YES's
   best ask. The order is sent **not post-only** (a GTD limit at the bid, so it matches now; what the bid's depth leaves
   rests at that price), once a turn, and re-priced to the new bid on the next turn by the slot's usual replace.
4. **Never under 0.001 a share, fee-aware.** A taker pays rate × p × (1 − p) a share, rate × (1 − p) of the proceeds;
   the order carries no fee field, so the bound is the highest rate a fee type has (`PM_FEE_TYPES`, 7 %): a bid is hit
   only where p × (1 − 0.07 × (1 − p)) is at least 0.001. A token with no bid (none, or 0), or one under that floor,
   keeps its close-only exit at the ask, as now (`state` names why, `liquidateKept`). On 16:04's books: 40 YES at 0.12,
   6 NO at 0.27, 80 YES at 0.002 (0.00186 a share net at the worst rate).
5. **The same checks as every order that leaves.** A taker sell is sent only where a sell may be (`g.reduce`: no global
   pause, eu-west-1, the inventory read) and, as an order that opens would need, the geoblock reads Ireland and the Ireland
   attestation is current; otherwise the exits rest at the ask, post-only, and the turn says why. `PM_ORDER_SENDS_ENABLED`,
   the region rule of `pmOrderCall` and the dry-run are unchanged. **No buy can be a taker anywhere:** the venue client
   refuses a BUY not post-only before any request is built (`pmVenue`, `refused: "taker-buy"`), and 0123 changes
   `pm_lp_orders`' `check (post_only)` to `check (post_only or side = 'SELL')`; mini-pool's and mid-pool's tables keep
   theirs.
6. **Dust** under the 5-share minimum is untouched; it settles and is redeemed by hand.

The stop, the TOTAL and FUNDED count these fills as every fill (Addendum 18: their taker fees are taken off the TOTAL).
`state.lp.liquidate` records since when and whether the turn could send its taker sells. Nothing else changes.

**The code it deploys:** `pm_live.ts` sha256 `04556ab577502566f043bde3d3d5b062c2cd779bc5714d5e9495179a143b344c`, where Addendum 23 named `17584420…324b` (`PmLpOptions.liquidate`,
`lpLiquidateOf`, `lpLiquidation`, the gate `liquidate`, a want's `taker`, `postOnly` per order); `pm_lp.ts` sha256 `06b96257e5008dcb12b458f55266d2cc5ce60a99853b377c0cf15358dfe6cc6f`, where Addendum 23 named
`8303fd97…9f0c` (`PM_LP_LIQUIDATE`, the instance's `liquidate`); `_shared/polymarket_orders.ts` (`postOrder`'s `postOnly`
and the taker-buy refusal); `0123_pm_lp_liquidate.sql` sha256 `5171628d88bec6068b0dce7d3627b5233d39a66b492b19f6e4b66de7be244fea`.

**Pinned** (`agents/pm_lp.test.ts`):
- `lpLiquidation` on 16:04's three books (40 YES at 0.12, 6 NO at 0.27, 80 YES at 0.002); a bid of 0.001 kept for the fee;
  no bid kept; dust not named; the whole holding to the hundredth; 200 random books, never a BUY, never under the floor;
- `lpLiquidateOf`, and the gate: opening off on `liquidate`, sells on; absent, no verdict;
- armed, 10 YES held and the switch set: the SELL of 10 at the bid, post-only false in the row and the request, the 2
  the bid held matched, the 8 left re-priced to the next bid the turn after, no BUY sent and none resting. Without the
  instance's `liquidate` (the counterfactual) the exit rests at 0.48, post-only, and the buys rest on;
- outside Ireland, or with the attestation lapsed: no taker sell, the exit at the ask, no buy; a BUY not post-only refused
  by the client;
- `src/pm_live_hash.test.js`, `src/pm_lp_prereg.test.js`: the bytes, the migration and the chain of addenda.
