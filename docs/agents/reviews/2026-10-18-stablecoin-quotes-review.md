# Stablecoin quotes, LIVE and every test row; the testing rows ranked, LIVE's levers replayed, the weekend (2026-10-18)

Davies, 2026-10-18: "检查和评估下所有live和testing的stablecoin quotes策略，所有数据和订单簿都可以看，revolut的testings策略哪个表现最好？live的
策略可以进一步优化吗？我看coinbase周末表现不错要不要给revolut也加一个周末的策略测试", and later the same morning: "告诉代理也评估下目前的所有测试
策略有没有值得优化/修改/删除/新增的" (§6).

**Not blind, and no reading.** Every record was read for research (no no-peek rule since 2026-10-04). No pre-registered reading
was run or pre-empted: PR5's verdict (10-21), the twins' readouts (10-21, after 10-28), PR5V and rule D (10-28), QUEUE (11-02),
TAKE (window to 11-02, at most 11-30), "with Euros" (11-08), "with Euros - 2" (11-10) and PR5-W (11-25) run as written. Each result
file should name this review, with those of 10-09 and 10-14, as a further non-blind read; **PR5-W's above all: §5 replays its rule
on its first forward weekends** (10-03/04, 10-10/11) ahead of its reading. Nothing was changed in production, no order was placed or
cancelled, and no code, migration or frozen file was edited. Every change below is a proposal.

**Sources.** Production read 2026-10-18 03:27–03:50 UTC, SELECT only. Everything is in
`docs/agents/backtests/scq_review/2026-10-18/` (`MANIFEST.json`): the pulls (`sql/pull_orders.sql`, `sql/pull_replay.sql` → `data/`,
md5-checked), every aggregate with its output (`sql/aggregates.sql`, cited as [H1]…[E1]), the page's money by the page's own
functions (`scripts/page_pnl.ts` → `results/page_pnl.json`), the rows on one basis and ranked (`scripts/compare.py` →
`results/compare.json`), PR5's rule replayed with one change at a time (`scripts/replay.py`, `scripts/experiments.py` →
`results/replay_check.json`, `results/experiments.json`), the weekends (`scripts/weekends.py`, `scripts/weekend_books.py`). Bootstraps:
10,000 resamples of whole days, seed 20261018, 90 % intervals. "Now" is 2026-10-18 03:30 UTC, a Sunday.

**The replay is exact.** `replay.py` is `stepMinute` (agents/quotes.ts) line for line, with knobs. On PR5's own stored minutes and
prints it reproduces every one of the paper engine's 180 trips entered 2026-09-26 → 10-17 (same entry, same exit minute, +$12.2776
both, `results/replay_check.json`), and its order count of 2026-10-01 (714, the paper engine's own `agent_quote_days`). Every
counterfactual below changes one knob of that replay.

## 0. Answers first

1. **Best Revolut X testing row: variant-2 (`take50`, TAKE).** Per pound of capital per weekday over the 15 weekdays every row ran
   (09-28 → 10-16): variant-2 6.59 bps a day (17.2 % a year), variant-1 5.56, variant-3 4.84, "Stablecoin quotes" 4.61. Variant-2 is
   ahead of each: of variant-1 by +1.03 bps a day (90 % +0.23 to +2.02), of "Stablecoin quotes" by +1.98 (+1.11 to +2.89), of
   variant-3 by +1.76 (+0.23 to +3.28). It also held up best lately (+£0.98 in the last seven days, 8.4 % a year, where the other
   twins made 2 % or less). Its takes made +£0.83 on 9 trips (6 won); TAKE's own bar needs 15, so its reading is still weeks away.
2. **LIVE can be improved in two ways, and only two survived the replay.** (a) **Size**: £50 a rung earns about 4.3× the pounds of
   £10 at about 85 % of the rate per pound (its cost is the coins' GBP/USD exposure); Davies' call at the 10-21 verdict, as the 10-14
   review said. (b) **Weekends**: holding GBP/USD through the closure adds, at LIVE's £10 a rung, +£0.056 a day (90 % +0.018 to
   +0.105) on PR5's own record, about 80 % on top of the weekday rule there, 37 of 38 weekends positive on the nine-month tape. It is
   PR5-W's rule; PR5-W reads on 11-25. Nothing else helped: other rungs, either book alone, the stop, the re-price, exit offsets,
   time-of-day gating and inventory caps were all no better or worse on both records (§4).
3. **The Coinbase weekend Davies saw is not a weekend effect.** Saturday 10-17's +£0.80 in each Coinbase row is eight trips entered
   on **Friday**, seven of them closed by the 24-hour stop on Saturday; the row that does not trade at weekends ("with Euros") made the
   same +£0.80. The weekend arm's own weekend trades (five fills on Saturday) are all still open. One partial weekend: no evidence
   either way yet; its reading is 11-10.
4. **But a Revolut X weekend test is worth adding.** Revolut X's GBP books trade at weekends at about half the weekday pounds an
   hour, with wider touches and two to five times as many prints beyond 20 bps of fair; the replay finds the held rate positive in
   every weekend of every record (§5). Draft pre-registration: `reviews/2026-10-18-revx-weekend-prereg.md` (DRAFT, not frozen): PR5-W's
   rule as a forward paper row, "Stablecoin quotes weekend", read beside PR5-W on 11-25. It needs a small engine (like `cb_hold.ts`),
   no key, no money; Davies' word to build it.
5. **Every other test: keep to its date** (§6), with two retirements already proposed on 10-14 (`pr5` after 10-21, `d` after 10-28
   unless rule D passes, and rule D is now level with its control, 4 days ahead and 9 behind) and one decision for Davies (the
   Coinbase book recorder, which nothing reads).
6. **Alarming: IG's weekend recorder has failed two runs in three since Friday 20:52 UTC** (165 `ig.quotes` errors, "401
   error.security.account-token-invalid", about 190 logins an hour), on the weekend S1b's twelve Sundays begin. Everything else in the error box is network or gateway noise (§7).

## 1. Every stablecoin quotes row

### 1a. Revolut X: LIVE and the four twins (the page's own figures)

| row | since | capital, rung | realised | unrealised | fees | trips (> £1) | won | stops | entry fill rate (7 d) | markout 5 m / 60 m | max drawdown | % a year (all / last 7 d) | window |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **LIVE** | 10-01 16:29 | £120, £10 | **+£0.5793** | −£0.5941 | £0.0840 | 167 (95) | 85 % | 3 | 3.6 % (6.7 %) | +2.0 / +5.9 bps | £0.11 | 10.7 / 15.3 | none; 16.5 days |
| Stablecoin quotes (`pr5`) | 09-23 15:09 | £1,200, £100 | +£9.1502 | −£4.2066 | £0.2100 | 132 (104) | 70 % | 3 | 2.0 % (3.1 %) | +6.8 / +9.0 | £1.20 | 11.4 / 2.1 | readout 10-21 |
| variant-1 (`p50`) | 09-23 15:09 | £600, £50 | +£5.4855 | −£2.0165 | £0.1100 | 165 (127) | 67 % | 3 | 2.4 % (4.5 %) | +7.1 / +9.3 | £0.65 | 13.9 / 2.2 | readouts 10-21, after 10-28; TAKE's control |
| **variant-2 (`take50`, TAKE)** | 09-23 15:09 | £600, £50 | **+£6.4158** | −£2.0143 | £0.5250 | 174 (136) | 68 % | 3 | 2.5 % (4.7 %) | +6.5 / +9.4 | £0.68 | **16.2 / 8.4** | TAKE: 10-04 16:00 → 11-02 (13.5 of 28.3 days), 9 of 15 takes |
| variant-3 (`d`, rule D) | 09-28 00:00 | £1,800, £50 × 36 | +£12.6830 | −£6.5391 | £0.4717 | 693 (537) | 58 % | 11 | 3.8 % (6.1 %) | +2.0 / +5.3 | £2.02 | 13.0 / −0.1 | readout after rule D's 10-28 |

Realised, unrealised and fees are the page's (`results/page_pnl.json` `page`, by `liveRungs`/`liveCoinBooks`/`liveBookGbp` of
`agents/index.ts`); trips, win rate, drawdown (on realised, in exit order) and the year are from the page's trips
(`results/compare.json` `rows`); fill rates from the orders each row sent, refusals left out ([A2]). Markouts: the last UK print 5 and
60 minutes after each entry fill of £1 or more, against the fill price, signed for the rung, so **positive means the book came back
toward us: no adverse selection in any row**. Unrealised is the coins behind the asks marked at the index against their cost: the
pound has risen against the dollar since the rows bought them: −0.66 % to −0.97 % of each row's coin cost (LIVE −£0.59 on £61.26). LIVE is
−£0.015 all-in; the twins are +£4.94, +£3.47, +£4.40 and +£6.14.

LIVE's 72 trips under £1 are the £0.10 counterparty of the 10-14 review (§3d there), −£0.0144 in all. Its 0.3 % rungs have made
2 trips in 16 days; its 0.1 % rungs 149 of 167. Health: state 21 s old, no error, governor not binding; three "turn: Signal timed out"
errors on 10-15 16:59–17:18 and nothing on LIVE's path since ([H1], [H3]).

**By day since the last review (10-14 04:02):** LIVE +£0.2972 on 98 trips (91 % won; 22.7 % a year), variant-2 +£0.7288, "Stablecoin
quotes" +£0.5204, variant-1 +£0.2110, variant-3 −£0.4006 (−£0.54 on 10-14 and −£0.52 on 10-15). LIVE beat its twins over these days
because it fills at its own price and fills whole at £10; the twins' rule (a print strictly through, by its size) gives them fewer
and later fills, as F3 found.

### 1b. The paper engines behind the page ([P1], USD)

| engine | capital | trips | won | stops | P&L | window, reading |
|---|---|---|---|---|---|---|
| PR5's paper test | $1,200 | 189 | 177 | 3 | +$13.3605 | 09-23 → 10-21, its verdict (24.5 of 28 days); feeds LIVE |
| PR5V `main` = rule D `v1` | $3,600 | 975 | 826 | 3 | +$28.7566 | entries 09-29 → 10-26, read 10-28 (19 of 28 days) |
| PR5V `top5` | $2,000 | 666 | 583 | 3 | +$23.1711 | reported beside, never judged |
| rule D `d` | $3,600 | 1,057 | 894 | 3 | +$28.8880 | read 10-28: $0.13 ahead of `v1` now ($0.70 behind on 10-14) |

PR5's paper engine logged 611 and 645 orders on 10-14 and 10-15 ([P2]); the spec's condition 5 is "at most 700 on every day", and
10-01's 714 is still the only day over (the 10-14 review's point for 10-21).

### 1c. Coinbase ([C1])

| row | window | trips | won | stops | realised | % a year on £1,200 + €1,200 | by book |
|---|---|---|---|---|---|---|---|
| Stablecoin quotes with Euros | 10-11 → 11-08 (7.1 of 28 days) | 61 | 31 | 10 | +£1.2810 (stops +£1.3154) | about 3.0 % | USDC-EUR +1.56, USDC-GBP +0.30, USDT-EUR −0.38, USDT-GBP −0.19 |
| … with Euros - 2 | 10-13 → 11-10 (5.1 of 28 days; weekend 1 of 4 in progress) | 53 | 25 | 9 | +£0.5522 (stops +£1.1930) | about 1.8 % | USDC-EUR +0.93, USDC-GBP +0.03, USDT-EUR −0.24, USDT-GBP −0.16; five weekend entries open |

Both are well under every Revolut X row so far, per pound. Their unrealised marks were not computed here.

## 2. The Revolut X testing rows ranked

**Basis.** Each row's P&L by entry day over its capital, in basis points a weekday, over the 15 weekdays from 2026-09-28 (variant-3's
first day) to 10-16; these rows quote nothing at weekends. `results/compare.json` `ranking` and `pairs`.

| rank | row | bps a weekday (90 %) | % a year | daily Sharpe | first / second half | without its best day | days below 0 |
|---|---|---|---|---|---|---|---|
| 1 | **variant-2 (`take50`)** | **6.59 (3.54 to 10.51)** | 17.2 | 0.79 | 9.40 / 4.14 | 4.56 | 2 |
| 2 | variant-1 (`p50`) | 5.56 (2.05 to 9.70) | 14.5 | 0.61 | 9.40 / 2.20 | 3.45 | 2 |
| 3 | variant-3 (`d`) | 4.84 (1.85 to 8.04) | 12.6 | 0.66 | 8.05 / 2.02 | 3.34 | 3 |
| 4 | Stablecoin quotes (`pr5`) | 4.61 (1.76 to 7.96) | 12.0 | 0.63 | 7.36 / 2.21 | 2.92 | 2 |
| — | LIVE, for scale | 3.22 (1.01 to 5.66) | 8.4 | 0.58 | 1.50 / 4.72 | 2.25 | 4 |
| — | PR5V `top5` (paper, USD) | 7.72 (4.71 to 11.33) | 20.2 | 0.99 | 9.63 / 6.06 | 5.95 | 1 |
| — | PR5's paper test | 6.82 (3.61 to 11.53) | 17.8 | 0.72 | 9.47 / 4.50 | 4.38 | 1 |
| — | rule D `d` / PR5V `main` (paper) | 5.36 / 5.33 | 14.0 / 13.9 | 0.82 | 6.86 / 4.04 | 3.75 | 1 |

Every row's best day is 09-28 (the wide Monday the 10-14 review named). **Paired differences** (bps a weekday, 90 %, share of
resamples at or below zero, and the weekdays a difference of this size and spread would need to clear zero at 95 %):

| comparison | mean | 90 % | ≤ 0 | days ahead / behind | weekdays needed | a frozen reading that decides it |
|---|---|---|---|---|---|---|
| variant-2 − variant-1 | +1.03 | +0.23 to +2.02 | 0.009 | 7 / 3 | 11 | **TAKE's C4** (take trips over the window, at the window's end + 2 days, ≥ 11-04; 15 takes needed, 9 so far) |
| variant-1 − Stablecoin quotes | +0.95 | +0.05 to +1.92 | 0.039 | 10 / 5 | 15 | the twins' readout beside PR5's verdict, 10-21 (descriptive, no bar) |
| variant-2 − Stablecoin quotes | +1.98 | +1.11 to +2.89 | 0.000 | 13 / 2 | 3 | none |
| variant-3 − variant-2 | −1.76 | −3.28 to −0.23 | 0.971 | 5 / 10 | 11 | none (variant-3's readout after 10-28 is descriptive) |
| variant-3 − variant-1 | −0.72 | −2.20 to +0.67 | 0.794 | 8 / 7 | 58 | the same |
| rule D `d` − `v1` (paper) | +0.02 | −0.51 to +0.67 | 0.507 | 4 / 9 | thousands | **rule D's condition 3, 10-28** |
| PR5V `main` − PR5 paper | −1.49 | −3.27 to +0.11 | 0.936 | 7 / 8 | 19 | **PR5V's reading, 10-28** |
| PR5V `top5` − PR5 paper | +0.90 | −0.91 to +2.71 | 0.202 | 9 / 6 | 60 | none (`top5` is never judged) |

**So:** variant-2 is the best Revolut X testing row on every measure here: the most per pound, the best ratio of mean to spread, the
smallest fall from the first half to the second, the most left without its best day. Its edge over variant-1 is part TAKE's takes
(+£0.83 on 9; four of them since 10-14, +£0.54) and part the simulator's turn timing (the 10-14 review's S3); this review did not
take that gap apart again. The ranking is uncertain in the middle: variant-1, variant-3 and "Stablecoin quotes" are inside each
other's intervals, and rule D's arm is level with its control. Every row's second half is weaker than its first: the market was quieter
from 10-06, and the twins' worst week was 10-13/14 (a refused exit held for hours, the £0.10 prints' pennies).

## 3. LIVE against its twins, and what it costs to watch

- LIVE carries out PR5's paper decisions at £10 a rung. Its per-pound rate since 10-14 (22.7 % a year) is above every twin's, and
  its rate over its whole life (10.7 %) is below the twins' because of its first week (the go-live conversions, the 10-02 stall,
  as reported before). It fills whole and at its own price; the twins do neither, and the replay below prices both fill
  assumptions.
- Of LIVE's 4,930 entry orders sent, 175 filled (3.6 %); 29 were refused at the book and never sent. Its exits: 625 sent, 203 filled
  (a re-priced exit is a new order). Three 24-hour stops ever (10-08). No dead-man trip since 10-07.
- **The coins.** LIVE holds 40.8 USDC and 40.1 USDT (£61.26 at cost) behind its asks, −£0.59 against the pound now. At £50 a rung
  that exposure is about five times larger (±£1.5 for every 0.5 % GBP/USD moves). It is the one real risk of sizing up; the rule
  does not hedge it.

## 4. LIVE: one change at a time, replayed

`experiments.py` runs the replay over **FWD**, PR5's stored record 2026-09-26 → 10-18 (22 days, the base +£9.27, 17.0 % a year at
$100 a rung, through-fills), and **HIST**, the committed nine-month tape of Revolut X's UK prints from 2026-08-26 (the tightened
market) to 09-23 (28 days, +£8.76, 12.7 %), under PR5's fill rule ("through") and one closer to LIVE ("at": a print at our own price,
its aggressor on the other side, fills too; F3 found LIVE's exits fill that way). Each variant's daily P&L is paired with the
baseline's. A third record, the tape from 2026-01-01 (265 days, a much richer market, base 73.9 % a year), is a sign check only.

| change | FWD through: £ a day vs base (90 %) | FWD at | HIST through | HIST at | from 01-01 | % a year at FWD through (base 17.0) | verdict |
|---|---|---|---|---|---|---|---|
| **weekend: GBP/USD held through the closure (PR5-W's rule)** | **+0.299 (+0.111 to +0.552)** | **+0.415 (+0.171 to +0.694)** | **+0.109 (+0.044 to +0.180)** | **+0.150 (+0.071 to +0.239)** | +0.418 | 29.2 | **better on every record, same capital** |
| … at LIVE's £10 a rung, against £10 a rung | +0.056 (+0.018 to +0.105) | +0.078 (+0.031 to +0.132) | +0.020 (+0.008 to +0.034) | +0.026 (+0.011 to +0.042) | +0.089 | 37.0 against 20.1 | the same, at LIVE's size |
| add a 0.05 % rung (4 rungs a side) | +0.158 (+0.062 to +0.256) | +0.233 (+0.129 to +0.344) | +0.146 | +0.221 | +0.394 | 17.6 | more pounds for a third more capital; per pound +0.14 bps a day (−0.70 to +0.94); drawdown £0.89 against £0.26. PR5V tests inner rungs (10-28) and is behind PR5 per pound |
| rungs 0.075 / 0.15 / 0.3 % | +0.041 (−0.022 to +0.107) | +0.095 (+0.033 to +0.161) | +0.033 | +0.057 | −0.113 | 18.7 | small, not on the long record |
| add a 0.4 % rung | +0.003 | +0.003 | +0.012 | +0.012 | +0.094 | 12.9 | idle capital |
| drop the 0.3 % rungs | −0.081 | −0.131 | −0.089 | −0.089 | −0.456 | 20.6 | more per pound, fewer pounds; the 0.3 % rungs are idle in quiet weeks (LIVE: 2 trips) and earn on wide days |
| 0.1 % rungs only | −0.220 | −0.315 | −0.174 | −0.203 | −1.201 | 24.4 | the most per pound, a third of the pounds |
| rungs 0.15 / 0.25 / 0.35 % | −0.091 | −0.147 | −0.070 | −0.086 | −0.214 | 13.4 | worse |
| USDC-GBP only / USDT-GBP only | −0.272 / −0.150 | −0.417 / −0.188 | −0.214 / −0.099 | −0.244 / −0.142 | −1.53 / −0.30 | 12.1 / 22.0 | both books |
| £10 / £50 / £200 a rung (vs $100) | −0.355 / −0.131 / +0.549 | −0.508 / −0.188 / +0.778 | −0.266 / −0.098 / +0.419 | −0.327 / −0.120 / +0.516 | | 20.1 / 17.6 / 14.8 | a smaller rung earns more per pound (fills fuller) |
| 24-hour stop at 12 h / 48 h / none | +0.001 / +0.028 / +0.028 | −0.002 / 0 / 0 | −0.011 / −0.003 / +0.001 | −0.007 / 0 / 0 | −0.042 / +0.008 / +0.010 | 17.1 / 18.2 | no effect worth a rule change |
| re-price at 0.03 % / 0.10 % | −0.022 / −0.021 | −0.155 / −0.141 | −0.047 / −0.082 | −0.011 / −0.079 | −0.098 / −0.013 | 16.1 / 16.2 | 0.05 % is best |
| exit a tick inside / beyond fair | +0.012 / −0.008 | −0.034 / −0.057 | −0.021 / +0.022 | −0.029 / +0.013 | −0.084 / +0.094 | 17.5 / 16.7 | signs flip between records (as F3 found) |
| at most 1 / 2 positions a book and side | −0.104 / −0.013 | −0.122 / −0.044 | −0.008 / 0 | −0.004 / −0.001 | −0.231 / −0.086 | 12.8 / 16.5 | an inventory cap only loses |
| no entries 21:00–24:00 / 00:00–07:00 / outside 07:00–17:00 UTC | −0.010 / −0.063 / −0.168 | −0.009 / −0.075 / −0.209 | −0.008 / −0.044 / −0.125 | −0.018 / −0.056 / −0.148 | −0.19 / −0.20 / −0.82 | 16.6 / 14.5 / 10.3 | no time gate helps |

**Ranked for LIVE** (each a change of what LIVE carries out, so each needs Davies' word; none is made here):

1. **Size, at the 10-21 verdict.** At £50 a rung the replay makes £0.42 a day where £10 makes £0.10 (at-fills; through-fills £0.29
   against £0.07): about 4.3× the pounds at about 86 % of the rate per pound. The cost is the coins' exposure (§3). A config change
   (`capital_gbp` and the rung) on his word, with the `_2` sub-account funded by him; never a trade by hand in it.
2. **Weekends, after PR5-W.** At £10 a rung, +£0.056 to +£0.078 a day over the 22 days, all of it on weekend days (seven of seven
   weekend days ahead on FWD, eight of eight on HIST, 75 of 76 from 01-01). Per weekend at £10 a rung: +£0.77, +£0.26, +£0.18 and
   +£0.01 on the four of FWD (the first, 09-26/27, before PR5-W's freeze; the last is one Saturday). It is a change to PR5's
   decisions, which `stepMinute` makes and PR5-W's freeze line holds until 11-25. The honest path: PR5-W's reading on 11-25, the
   forward paper row of §5 beside it, then a pre-registered change on his word, at £10 a rung for four weekends first.
3. **Nothing else.** The inner rung adds pounds at the same rate per pound with three times the drawdown, and is PR5V's question
   (10-28); every other knob is no better or worse. Fees are not a lever: every LIVE quote fill is a 0 % maker fill, and its only fees
   were the go-live conversions and three stops.

## 5. Weekends

### 5a. Coinbase: what the page showed

Each Coinbase row's DAYS list books a trip on its exit day (`cb_quote_days`, migration 0112). Saturday 10-17 reads +£0.8042 ("with Euros") and +£0.8019 ("- 2"), each the
row's best day after Thursday. **All sixteen of those trips were entered on Friday 10-16** (07:31–17:56 UTC). In "with Euros" all eight were closed by the
24-hour stop on Saturday, as a taker; in "- 2" seven were, and one by a maker exit at its held fair. The two USDC-EUR bids made
+£0.50 and +£0.41 after the book came back from a Friday dip ([C1]). "With Euros" quotes nothing at weekends and made the same. The weekend arm's own weekend
so far is five entry fills on Saturday afternoon and evening, all still open at 03:30 on Sunday. No trip has been entered on a
Saturday or Sunday in either row.

So the good weekend is the weekday rule's Friday positions settling on Saturday: real money, but not evidence about quoting at
weekends. That evidence starts when Euros - 2's first weekend closes (Monday) and is read on 11-10 over four weekends; in sample
(its pre-registration §2) 47 of 52 weekends were positive.

What the Coinbase books do at weekends ([B2], 10-11 → 10-17): per minute, 47 % of the weekday trades on USDC-EUR, 12 % on USDT-EUR,
79 % on USDC-GBP and 40 % on USDT-GBP, and 13 % to 58 % of the weekday volume; the same touch (1.1–1.7 bps either way, USDT-EUR 0.3);
and a third of the weekday volatility (the mid's minute-to-minute change, sd 0.3–0.5 bps against 0.9–1.0).

### 5b. Revolut X's books at weekends

| book | weekday (09-26 → 10-17) | weekend (Fri 21:00 → Sun 21:00) |
|---|---|---|
| USDC-GBP: prints of £1+ an hour, £ an hour | 2.44, £2,393 | 1.73, £1,041 |
| USDC-GBP: median distance from fair; beyond 20 bps | 4.3 bps; 2.9 % | 5.2 bps; 13.4 % |
| USDC-GBP: touch (mean, median), five-level depth bid / ask | 11.0, 6.6 bps; £667k / £442k | 13.3, 9.3 bps; £750k / £412k |
| USDT-GBP: prints of £1+ an hour, £ an hour | 6.20, £5,367 | 5.15, £3,043 |
| USDT-GBP: median distance from fair; beyond 20 bps | 5.3 bps; 8.7 % | 4.3 bps; 16.9 % |
| USDT-GBP: touch, depth | 5.3, 4.0 bps; £468k / £53k | 11.4, 5.3 bps; £632k / £42k |
| mid change between reads (sd), share of reads it moved | 1.46–1.70 bps; 36–52 % | 2.04 bps; 24–34 % |

(`results/weekend_books.json`, [B1]; fair at weekends is PR5's fair with the last live GBP/USD held, PR5-W's rule.) Unlike Coinbase,
Revolut X's weekend books are thinner, wider and jumpier: fewer prints, but many more of them far from fair, which is what PR5's
0.2 % and 0.3 % rungs are for.

### 5c. PR5's rule with the rate held, weekend by weekend (`results/weekends.json`)

The held arm less the dark arm (PR5 as it runs), over trips entered from each Friday 21:00 to the Monday 00:00 after it, so a weekend
position that met the reopen is in it:

| record | weekends | positive | sum | median | worst | best share | stops in weekend trips |
|---|---:|---:|---|---|---|---|---|
| tape, 01-01 → 09-23 ($100 a rung) | 38 | 37 | +£112.69 | +£2.69 | −£0.09 | 10 % | 51 of 2,105 |
| tape, 08-26 → 09-23 | 4 | 4 | +£3.05 | +£0.84 | +£0.18 | 39 % | 4 of 53 |
| PR5's record, 09-26 → 10-18, through | 4 | 4 | +£6.59 | +£1.28 | +£0.01 | 61 % | 0 of 106 |
| the same, at-fills | 4 | 4 | +£9.12 | +£2.46 | +£0.18 | 44 % | 0 |
| the same at £10 a rung | 4 | 4 | +£1.22 | +£0.22 | +£0.01 | 63 % | 0 |

FWD by weekend: 09-26/27 +£4.02 (before PR5-W's freeze, seen by it), 10-03/04 +£1.31, 10-10/11 +£1.25, 10-17 (Friday evening and
Saturday only) +£0.01. The recent weekends are smaller, and Saturday 10-17 was USDT-GBP's quietest day in the record (£30k).

**Is the Revolut X weekend effect real?** In the simulator, yes, as far as a replay can say: it is positive on every record, both fill
rules, every size, 37 of 38 weekends on the long tape. What a replay cannot show: whether a resting order at weekends is filled as
the simulator fills it (the weekend prints are fewer and larger), and a large Sunday gap (the worst on the tape was −£0.09 at $100 a
rung; PR5-W's committed series has gaps up to 54 bps). Those are what a forward test reads.

### 5d. Recommendation: add the Revolut X weekend test, as a paper row beside PR5-W

- **Yes, add it.** PR5-W already pre-registers the question offline, read on 11-25 over eight weekends with its own scripts and
  freeze line; it is not changed. What a forward paper row adds is the engine itself run minute by minute on the record as stored,
  on the page beside "Stablecoin quotes", so that a later change of LIVE carries out decisions an engine has already made rather than
  a replay's. Draft: **`docs/agents/reviews/2026-10-18-revx-weekend-prereg.md`** (DRAFT, not frozen): PR5-W's rule exactly, $1,200 on
  paper, window from the first Friday 21:00 after its deploy to 11-23, read on 11-25 after PR5-W, four bars (faithful; better than
  dark in all but one whole weekend, sum positive; no weekend below −$3; no weekend over 60 % of the sum). What a pass allows: a
  proposal that LIVE quotes at weekends at £10 a rung for four weekends, on Davies' word.
- **Code it needs** (not trivial enough to prototype here, so not built): `agents/quotes_weekend.ts` modelled on `cb_hold.ts`
  (179 lines), reading `agent_quote_minutes` and `agent_quote_prints` and calling `stepMinute` unchanged with the held X; its test
  (with no closure it writes PR5's trips exactly); one action; a migration (four tables, a view, a lease, the `edge_calls` row,
  `retry` true); the page's row and fixture; map rows and a reference item. It touches nothing QUEUE's or PR5-W's freeze lines name.
  Variants of the existing twins cannot do it: a twin carries out PR5's decisions, and PR5 decides nothing at weekends.
- **Cost and risk.** One call a minute of a few hundred milliseconds, a few MB a month, one agent session to build. No key, no order,
  no money. It depends on PR5's paper engine running to 11-23 (it already must run to 11-10 for the Coinbase tests).
- **Deploy by 2026-10-23** to hold four whole weekends before 11-23.

## 6. Every testing row: keep, optimise, modify, retire, or new (Davies' second question)

Freshness: every minute call beat 60 of 60 in the hour to 03:43 ([H2]); every engine's state is current with no error ([H5]). A
running test with a fixed reading date runs to it unless something is broken; nothing below is broken but IG's recorder.

| row (call) | evidence now | verdict | reading / date |
|---|---|---|---|
| PR5's paper test (`quotes`) | 189 trips, +$13.36; current; feeds LIVE, both Coinbase tests, PR5V, rule D, QUEUE, PR5-W | **KEEP** to its verdict and after it to 11-23 at least (the Coinbase tests read its GBP/USD to 11-10, PR5-W to 11-22, the draft row to 11-23) | 10-21 (frozen) |
| Stablecoin quotes (`pr5` twin, £100) | rank 4 of 4 per pound; its question (£100 against £50) answered | **KEEP to its 10-21 readout, then RETIRE** (as proposed 10-14): `update agent_quote_twin_specs set enabled = false where id = 'pr5'` with a deviation line | 10-21 (descriptive) |
| variant-1 (`p50`, £50) | rank 2; TAKE's control | **KEEP** | TAKE's C4 (≥ 11-04), `d`'s readout |
| variant-2 (`take50`, TAKE) | rank 1; 9 of 15 takes; 4 since 10-14 | **KEEP** to TAKE's reading; report C4 with and without the turn-timing trips (10-14's S3), as a descriptive line | window to 11-02, extended weekly to 11-30 until 15 takes |
| variant-3 (`d`, rule D twin) | rank 3; −£0.40 since 10-14; rule D level with `v1` (4 ahead, 9 behind) | **KEEP to 10-28, then RETIRE unless rule D passes** | after 10-28 (descriptive) |
| PR5V and rule D (`quotesv`, `quotesd`) | current; PR5V `main` 1.49 bps a day behind PR5 per pound | **KEEP**; their reading scripts are due before 2026-10-27 00:00 | 10-28 (frozen) |
| Stablecoin quotes with Euros (`cbrec`) | 61 trips, +£1.28, about 3 % a year; the GBP books near zero | **KEEP** | 11-08 (frozen) |
| … with Euros - 2 (`cbhold`) | 53 trips, +£0.55; first weekend's five entries open | **KEEP** | 11-10 (frozen) |
| Revolut X book recorder (`books`) | current | **KEEP** (QUEUE's and PR5-W's freeze lines) | QUEUE 11-02, PR5-W 11-25 |
| Coinbase book recorder (`cbbooks`, ten levels) | 28 MB in eight days (`cb_book_levels`); 10 timeouts in four days; nothing pre-registered reads it | **Davies decides by 11-08: RETIRE** unless a queue-model study of the Coinbase books is pre-registered by then (it was built for one, ledger item 13) | none |
| CoinJar recorder (`cjrec`, CJ5) | current; 2,880 book rows and 11 trades a day | **KEEP**; decide the drafted forward test (10-13 review's D4) by 10-21 | none until frozen |
| Polymarket recorders (`pmrec`, `pmrec-meta`, `views`) | current | **KEEP to 10-23**, then Davies' D5 (about 12 MB a day, nothing scheduled after) | LPRESEL6 10-23 |
| IG weekend recorder (`ig?action=quotes`, S1b) | **2 runs in 3 failing with "401 account-token-invalid" since 10-16 20:52 UTC, about 190 logins an hour** ([H4]) | **OPTIMISE now (a fix, not a rule change):** find why the session token is refused (a token expiring mid-weekend, or the login rate), with a pin; S1b's first of twelve Sundays is today | S1b's twelve Sundays from 10-18 |
| trend-4h (paper control) | no entry since 09-28 | **KEEP** (the live row's control) | none |
| trend-1h | 6 orders in 7 days | **KEEP** until MX-1 reads | MX-1 (weekly pulls) |
| momentum-1d | 5 orders in 7 days; nothing reads its record | **RETIRE** at the next cleanup (10-13's D3, still open) | none |
| MX-1, EX-GAP (scheduled pulls) | as the ledger has them | **KEEP** | weekly / monthly |

**New tests worth adding:**

| new | question | data that motivates it | cost | code |
|---|---|---|---|---|
| **N1. "Stablecoin quotes weekend"** (§5d) | does PR5's rule with the rate held earn at weekends on Revolut X, run forward? | §5c: positive on every weekend of every record; LIVE's best remaining lever | one minute call, a few MB a month, one build session | yes: a small engine (the draft pre-registration) |
| N2. Its realistic twin at £50 a rung | the same at LIVE's execution (whole pennies, fills by print size) | the twins' fill rule halves fills against LIVE's | a spec row, once N1 exists | a twin engine name reading N1's events; after N1 |
| N3. Revolut X around the scheduled releases (Davies asked on 10-15) | does withholding fair from a minute before to five after a CPI/NFP/FOMC/ECB/BoE release help on Revolut X too? | none yet: the release list starts 10-28, so no release lies in PR5's stored record | none: `replay.py` with a gate prices it once a few releases have passed | no (a measurement, then a pre-registration if it helps) |

Not proposed, because the replay found them no better: a time-of-day gate, an inventory cap, a different stop, a different re-price,
an exit offset, one book alone, a £10 twin.

## 7. Errors, stale recorders, mismatches

- **IG weekend recorder** (above): 165 errors since Friday evening, the rest of the error box is network and gateway noise ([H3]):
  `agents.cb_books` 10, `agents.pm_lp` 8, `agents.pm_rec` 8, `agents.quotes_twins` 7 (a 502 reading `agent_quote_prints`, last
  10-16 12:26), `agents.tick` 7, `agents.quotes` 5 (lease timeouts, last 10-16 20:08), `agents.cj_rec` 5, `agents.cb_rec` 5,
  `agents.quotes_live` 3 (10-15 16:59–17:18, "turn: Signal timed out"), `grokpm.redeem` 1 (an RPC 429).
- **No mismatch found** where one could be measured: the replay reproduces the paper engine's trips and its 714 orders; the page's
  figures were computed by the page's functions; K1 and the twins' checks were not re-run (see below).
- **Worth knowing for 10-21:** the paper engine came within 55–89 orders of the spec's 700 on 10-14 and 10-15; the twins' own order
  logs (`_sim.days`) read 874 (`pr5`) and 733 / 718 (`p50`) on single days, but those are the twins' POST counts, not the spec's.
- **Worth knowing for Coinbase's readings:** the engines keep a EUR book's prices on a scaled grid (a USDT-EUR position reads 8.894
  in `cb_hold_state` for 0.8894); the trip rows are scaled back. Not a fault; a reader of the raw state should know it.

## 8. What this review did not check

- LIVE's balances against the venue: LIVE's coins and pounds are the executor's state, not re-read from Revolut X.
- The twins' checks (K1, `paperCheck`) and the £0.10 prints' pennies were not re-run (the 10-14 review's S1 still applies to every twin).
- The weekend replay uses PR5's simulator: fills strictly through (or at the price), 10 % of the minute's volume, no queue. Weekend
  fills are rarer and larger, which is exactly where that model is least tested.
- The Coinbase rows' unrealised marks and their bar-by-bar health; the crypto paper rows' P&L (only their order counts were read).
- TAKE's gap to variant-1 was not taken apart again into takes and turn timing.
- The IG recorder's cause: only its runs and errors were read.

## 9. In plain words (for Davies)

- The best Revolut test is variant-2: it makes the most per pound (about 17 % a year), and held up best in the quiet last week.
- LIVE works and is doing better lately (about 23 % a year since Tuesday) than its paper twins, because the real exchange fills it
  more readily than the simulation fills them. Its trading has made +£0.58; the coins it holds are down £0.59 because the pound rose.
- Two things would make LIVE earn more. Bigger steps (£50 instead of £10): about four times the pounds, with more exposure to the
  dollar; your decision at the 10-21 verdict. And quoting at weekends: in every replay it adds money at no extra capital, about 80 %
  more at LIVE's size on the last three weeks. Everything else I tried (other rungs, one book, other stops, quiet hours, inventory
  limits) did not help.
- The Coinbase "good weekend" was Friday's positions being closed on Saturday; the version that does not trade at weekends made the
  same. Its real weekend test has only just started.
- Revolut's weekend markets are thinner but wider, which suits this strategy. I recommend a Revolut weekend paper test (draft
  attached), shown on the page and read on 25 November with the weekend study already registered.
- Keep the other tests to their dates; after 21 October "Stablecoin quotes" (£100) can go, after 28 October probably variant-3, and
  momentum-1d whenever convenient. Decide whether the Coinbase order-book recorder is still needed.
- One thing is broken: the IG weekend recorder has been failing two times in three since Friday night, on the weekend its twelve
  Sundays begin.
