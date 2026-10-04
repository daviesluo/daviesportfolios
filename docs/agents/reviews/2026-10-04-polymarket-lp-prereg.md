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
