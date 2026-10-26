# Stablecoin quotes: LIVE's "+64.9 %", whether to add money, and every row (2026-10-26)

Davies, 2026-10-26: "Stablecoin quotes的live策略网页显示“7-day annualised +64.9%”，怎么这么高？是有问题吗？表现真这么好的话我要不要再加一些资金？
再仔细研究下这个策略和所有testing的Stablecoin quotes策略有任何需要调整/优化/删除/新增的吗，所有数据都可以看".

**Not blind, and no reading.** Every record was read for research (no no-peek rule since 2026-10-04). No pre-registered reading
was run or pre-empted: PR5V and rule D (10-28), the twins' readout after rule D's (10-28), QUEUE (11-02), TAKE (window to 11-02, at
most 11-30), "with Euros" (11-08), "with Euros - 2" (11-10), the LIVE twin (11-23) and PR5-W and variant-3 (11-25) run as written.
Each should name this review as a further non-blind read. Nothing was changed in production, no order was placed or cancelled,
and no engine, migration or frozen file was edited. The one change is the page's label (§1.4). Everything else is a proposal.

**Public repository.** LIVE's figures are given as a share of its capital (%, bps, per £100), never in pounds; LIVE's money is
written £[•]. The twins and paper rows are paper money and keep their pounds.

**Sources.** Production read 2026-10-26 00:59–01:06 UTC, SELECT only (`backtests/scq_review/2026-10-26/sql/pulls.sql`). The orders
are in `data/`. Every LIVE and twin figure comes from the page's own functions (`scripts/series.ts`: `liveRungs`, `liveRungTrips`,
`liveDays`, `liveCoinBooks`, `liveBookGbp` from `agents/index.ts`), turned into `results/summary.json` by `scripts/summary.py`.
`scripts/cashflow_check.py` recomputes the page's week without the page's code. The other reads are in `results/aggregates.json`.
Coins are marked at the paper engine's fair (fairU / X, `agent_quote_minutes`) at each UTC midnight and at the read
(`data/fairs.txt`). "Now" is 2026-10-26 00:58 UTC, a Monday, just after LIVE's first live weekend.

## 0. Answers first

1. **The +64.9 % is computed correctly, but it is not the account's return.** It is the round trips realised over the seven
   closed days 10-19 → 10-25 (1.245 % of the capital), times 365 / 7. Two independent recomputations give 64.91 % and 64.90 %.
   - **Half of it is one weekend.** The first live weekend (Fri 10-23 21:00 → Sun 10-25 21:00) made 70 round trips, all won,
     63 bps of the capital in 48 hours, 51 % of the week. That is five to seven times the backtest's mean weekend (9–13
     bps), though close to its best (64 bps, 09-26/27).
   - **It leaves out the coins' unrealised.** About half the capital is held as USDC and USDT, a dollar position. GBP/USD rose
     1.35 % since the go, and the coins have given back 0.75 % of the capital since then.
   - **Honest figures** (the whole capital, realised plus the coins marked to market):

     | window | realised, a year | marked to market, a year |
     |---|---|---|
     | 7 days | 64.5 % | **54.6 %** |
     | 14 days | 40.2 % | **25.1 %** |
     | since the go (24 days) | 26.5 % | **15.5 %** |
     | weekdays 10-19 → 10-22 | 32.7 % | 16.6 % |

   - **Daily P&L marked to market:** mean +4.3 bps of the capital, sd 17.3 bps, worst −18.6 bps, max drawdown −0.24 %.
   - **The edge is real:** realised t = 2.87 over 24 days, with 2 losing days. The marked-to-market t is only 1.18, because
     the coins' GBP/USD swing is three times the daily edge.
   - **The label is fixed** to "7-day realised, annualised", with a tooltip saying what it leaves out (§1.4).
2. **Add money: yes, a little, and in steps.** Recommended: **capital £120 → £300 (£25 a rung)**.
   - **Per extra £100:** about +£0.07 a day realised at £25 a rung (about £25 a year), before the coins' FX noise. That noise
     has mean zero but a daily sd of about £0.17 per £100.
   - **Where it stops scaling:** returns per pound hold to within about 5 % at £25 a rung. They fall about 10 % at £50 and
     25–30 % at £100.
   - **Beyond £300:** first a LIVE-rule twin at £600, then decide on it (§2).
   - The statements are in §2.4. Davies runs them; nothing here arms anything.
3. **Every row** (§3):
   - **LIVE** earns the most per pound of every row: weekdays £0.077 per £100 a day.
   - **Its twin** matches it on weekdays (£0.075), but not on the weekend, which the twin does not trade. Its 11-23 score
     will therefore fail on that alone unless a deviation fixes the comparison (§3.2).
   - **Keep:** LIVE, PR5's paper engine, the LIVE twin, variant-2, variant-3 and both "with Euros" rows.
   - **Retire after their 10-28 readouts:** the £1,200 "Stablecoin quotes" twin, variant-4 (rule D's twin), variant-1, and
     PR5V's and rule D's paper arms unless their readings pass.
   - **New:** LIVE-rule twins at £300 and £600.

## 1. The +64.9 %

### 1.1 What the page computes

`quoteDaysAnnualPct` (`src/agents/agents.js`) is called by `QuoteDaysTable` (`agents.jsx`) with the LIVE row's capital. The
capital is `agent_quote_live_config.capital_gbp`, £120, the whole capital the sub-account was funded with. The function takes:
- the seven calendar days before today (10-19 … 10-25 when read on 10-26), each day's `realisedGbp` from `liveDays`
  (`agents/index.ts`);
- realised = what the rungs' round trips realised that day, by the executor's own `rungBook`, with the conversion fees of the
  coins those trips sold;
- the sum over the capital, times 365 / 7.

It is **realised only** (no unrealised, no mark of the coins), **simple** (not compounded) and **over the whole capital** (not over
what is deployed).

### 1.2 Recomputed

- **By the page's own walk** (`scripts/series.ts`, `liveDays` on every live fill): 1.2449 % of the capital over the seven days,
  so **64.91 %**.
- **Without the page's code** (`scripts/cashflow_check.py`: each rung's fills as cash, a trip closed when the rung is back
  within its dust): 1.2447 %, so **64.90 %**.

The figure is what it says. The traps checked:

| trap | finding |
|---|---|
| denominator | the whole capital (£120), not what is deployed: correct, and conservative |
| stale or favourable mark | none: no mark is in it. Its fault is the opposite: the coins' loss is left out |
| one-off | **yes: the first live weekend is 50.9 % of the week** (70 trips, all won, 63.4 bps of the capital) |
| a top-up or conversion booked as P&L | no: conversions are their own leg, outside every rung; only their fees enter the trips |
| the 0.147 USDT remnant (10-20) | closed with its rung's trip; it is a few pence of notional and moves nothing |
| simple v compounded | simple; compounded weekly the same week would read 90.6 %, so simple is the lower of the two |
| short-window outlier | **yes: seven days, a weekend in them, annualised ×52** |

### 1.3 The honest numbers

All on the whole capital (`results/summary.json`, LIVE). Marked to market means realised plus the coins at fair, every UTC
midnight.

| window | days | realised, a year | marked to market, a year | round trips (won) | stops |
|---|---|---|---|---|---|
| 7 days, 10-19 → 10-26 00:58 | 7.0 | 64.5 % | **54.6 %** | 165 (160) | 2 |
| 14 days, 10-12 → | 14.0 | 40.2 % | **25.1 %** | 286 (269) | 2 |
| since 10-02 (the go was 10-01 16:29; LIVE has not run 28 days) | 24.0 | 26.5 % | **15.5 %** | 328 (299) | 5 |
| weekdays 10-19 → 10-22 | 4.0 | 32.7 % | 16.6 % | 66 (62) | 1 |

- **Daily, marked to market, 24 days:**
  - mean +4.27 bps of the capital, sd 17.27 bps;
  - worst −18.55 bps (10-20), best +48.4 bps (10-23);
  - max drawdown −0.24 % of the capital; t = 1.18.
- **Daily, realised:** mean +7.26 bps, sd 12.38 bps, t = 2.87; 2 negative days of 24.
- **The coins.** At the read they were 50.4 % of the capital, marked 0.75 % of the capital below what they cost. GBP/USD was
  1.3204 at the go and 1.3383 at the read. The inventory is a dollar position the asks need. Its expected return is about
  zero, and it is most of the variance. It is why every row's marked figure sits below its realised one this month (§3).

**Reading.** On the evidence, the strategy earns about 25–30 % a year realised on weekdays at £10 a rung. Weekends add an
amount not yet measured beyond one weekend. The coins' GBP/USD moves come on top, in either direction. The +64.9 % is one strong
week, half of it a first weekend, annualised.

### 1.4 The page fix

The figure was labelled "7-day annualised", which reads as the account's return. It is now "**7-day realised, annualised**" on
every Stablecoin quotes page, with a tooltip:

> Round trips realised over the last seven closed UTC days, over the capital, times 365 / 7 (simple). The coins held are not
> marked into it (UNREALIZED G/L shows them), and one week is a short sample.

The details:
- The words are `QUOTE_DAYS_ANNUAL_LABEL` and `QUOTE_DAYS_ANNUAL_TITLE` (`src/agents/agents.js`).
- They are pinned in `agents.test.js` with this week's seven days, which give 64.91 %.
- The sweep reads the new words, and the guide says what the figure leaves out.
- The arithmetic is unchanged: it is what Davies asked for on 10-09, a seven-day rate, and the scoreboard shows the
  unrealised beside it.

## 2. Should he add money?

### 2.1 The evidence on size

| source | £10 a rung | £25 | £50 | £100 |
|---|---|---|---|---|
| size study (09-23 → 10-02, through fills; realised a year) | 28.9 % | 27.6 % (0.96×) | 25.7 % (0.89×) | 19.9 % (0.69×) |
| LIVE's own entries since 10-12: prints that met each order's price while it rested, capped at the size (an upper bound) | 1.00× (its fills 1.01× of it) | 0.96× | 0.93× | 0.86× |
| the same for LIVE's exits | 1.00× (fills 1.08×) | 0.93× | 0.86× | 0.77× |
| forward twins, through fills, weekdays 10-12 → 10-23, realised per £100 a day | — | — | £0.0388 (variant-1) | £0.0318 ("Stablecoin quotes"), 0.82× of £50 |

- **The capacity read fits LIVE.** LIVE's fills match the £10 cap within 1–8 %.
- **Its larger sizes are upper bounds.** They ignore orders queued ahead of ours. LIVE's filled entries took 54 % of their size
  on average (144 of 298 in part), and its exits 84 %, so a bigger rung fills a smaller share.
- **The books.** USDC-GBP printed £11k–£119k a day and USDT-GBP £30k–£108k (median USDT print £0.10). At £10 a rung LIVE's own
  fills are under 1 % of that.

### 2.2 What an extra £100 earns

- **Rates at £10 a rung:**
  - LIVE's realised since 10-02: **£0.0725 per £100 a day** (26.5 % a year);
  - on weekdays 10-12 → 10-23: £0.077 per £100 a calendar day;
  - marked to market since 10-02: £0.043.
- **At £25 a rung (×0.95):** about **£0.069 per extra £100 a day, £25 a year**, realised.
- **At £50 a rung (×0.89):** about £0.064 a day, £23 a year.
- **The coins' FX.** It adds noise with a daily sd of about £0.17 per £100 (LIVE's 17.3 bps), mean about zero. Over this
  month it cost about 0.75 % of the capital.
- **Weekends.** One live weekend made 63 bps of the capital. The backtest's mean weekend at £10 a rung is 9–13 bps of the
  capital (£0.056–£0.078 a day). Plan on the backtest.

### 2.3 Limits and risks

- **The governor does not bind.** LIVE sends about 283 orders a day (3,961 over 10-12 → 10-25) against 900. Size changes no
  order count.
- **The loss stop scales.** It is −1 % of the capital a day. The worst day so far is −0.19 %.
- **Stops:** 5 in 24 days, about nothing net.
- **De-peg guard:** fired on 10-20 (USDC at 50–52 bps from fair).
- **Frozen cancels.** On 10-20 six rungs' cancels froze for 6 h 25 min (08:37 → 15:02) in Revolut X's outage. A bigger rung
  rests more money through such an hour.
- **FX exposure grows with the capital.** At £300 about £150 is held in dollar stablecoins; a 1 % GBP/USD move is ±£1.50.
- **Not yet tested at size with LIVE's own fill rule.** The forward size twins (variant-1, "Stablecoin quotes") use the
  through-only fill, which misses about two in three of LIVE's fills (the 10-21 audit). Only the LIVE twin uses LIVE's rule,
  and only at £120.

### 2.4 The recommendation and its statements

**Capital £120 → £300 (£25 a rung).** Per pound it keeps about 95 % of today's rate on every measure above. It adds about +£0.12 a
day realised (about £45 a year) and about ±£0.31 a day of FX noise.

Go no further until two LIVE-rule twins have run two weeks:
- one at £300 and one at £600 (§3.4);
- they decide £600 if the £600 twin's realised per pound is at least 80 % of the £120 LIVE twin's over the same days.

Davies runs each step, in this order:

1. **Funds.** He tops the `_2` sub-account up to the new capital, with about £1 more for the penny holds (£[•]: the
   difference from its balance at the time). Never trade by hand in that account: its executor books the account's
   balances as its own.
2. **Capital.** Once the funds show in the executor's balances:
   ```sql
   update public.agent_quote_live_config set capital_gbp = 300, updated_at = now() where id = 1;
   ```
   The next turn sizes every rung at £25 and the loss stop at −£3 a day. The bids need £150 of free pounds.
3. **The asks' coin.** The asks need £75 of each coin (three £25 rungs). The account holds about a quarter of today's
   capital in each (£[•]). Two maker conversions at the bid make up the difference, `[•]` being £75 less the book's coin at
   the time (`quotes-convert`, operator, `send: true`):
   ```
   POST agents?action=quotes-convert {"book":"USDC-GBP","gbp":[•],"send":true}
   POST agents?action=quotes-convert {"book":"USDT-GBP","gbp":[•],"send":true}
   ```
   Until they fill, an ask without coin is skipped for want of it, as on any weekday. The executor's own top-up is £5 a book
   a day, too slow for this.
4. **Undo.** Set `capital_gbp = 120` again (the next turn sizes £10 a rung). The extra pounds and coins then stay in the
   account unused until they are withdrawn.

## 3. Every row

### 3.1 The table

Comparable basis:
- twins and LIVE: per £100 of capital, the page's own walk;
- paper engines: per $100 (PR5, PR5V, rule D) or per £100 (Coinbase) of their capital, their own days tables, with no coins
  held and so no FX;
- "weekdays" is 10-12 → 10-23 21:00 per calendar day (variant-3 from 10-19), when no row but variant-3 traded a weekend;
- marked to market is since 10-02;
- fill rate is entry orders filled over 10-12 → 10-25.

| row | what it is | capital | weekdays, realised per 100 a day | since 10-02, realised / marked, a year | trips (won) since 10-02 | entry fill rate | stops | max DD (daily, marked) | reads |
|---|---|---|---|---|---|---|---|---|---|
| **LIVE** | PR5's rule, real money, £10 a rung, weekends since 10-23 | £120 | **0.077** | 26.5 % / 15.5 % | 328 (91 %) | 9.2 % | 5 | −0.24 % | — (live) |
| LIVE twin (`live`) | LIVE's rule and fill rule on a simulated account, no weekends | £120 | 0.075 | 19.6 % / 8.5 % | 247 (80 %) | 6.2 % | 1 | −0.35 % | 11-23 |
| variant-2 (`take50`) | PR5 + TAKE, £50 a rung, through fills | £600 | 0.052 | 15.3 % / 3.8 % | 179 (64 %) | 4.6 % | 5 | −0.37 % | TAKE: 11-02, extending to 11-30 (11 takes, needs 15) |
| variant-3 (`take50wk`) | variant-2 + PR5-W's weekend, from 10-19 | £600 | 0.081 (from 10-19) | 7 days: 47.6 % / 37.8 % | 94 (77 %), from 10-19 | 7.6 % | 3 | −0.15 % | ≥ 11-25 |
| variant-1 (`p50`) | PR5's rule, £50 a rung, through fills | £600 | 0.039 | 12.4 % / 0.9 % | 165 (65 %) | 4.4 % | 5 | −0.49 % | after 10-28 (beside variant-4) |
| "Stablecoin quotes" (`pr5`) | PR5's rule, £100 a rung, through fills | £1,200 | 0.032 | 11.2 % / −0.3 % | 142 (66 %) | 3.6 % | 6 | −0.48 % | after 10-28 |
| variant-4 (`d`) | rule D's arm `d`, nine a side, £50 a rung, through fills | £1,800 | 0.018 | 8.5 % / −2.8 % | 724 (54 %) | 6.0 % | 30 | −0.58 % | after 10-28 |
| PR5 (paper engine) | the frozen rule, $100 a rung, paper; LIVE carries out its decisions | $1,200 | 14 days: 0.053 | 15.6 % (14 days 19.5 %) | 282 (94 %) all time | — | — | — | passed 10-21 (deviation 7) |
| PR5V `main` (paper) | nine a side, $100 a rung | $3,600 | 14 days: 0.046 | 11.9 % (16.8 %) | 1,434 (86 %) all time | — | — | — | 10-28 |
| PR5V `top5` (paper) | five a side | $2,000 | 14 days: 0.062 | 16.9 % (22.8 %) | 983 (89 %) | — | — | — | beside `main` |
| rule D `d` (paper) | `main` with rule D's re-price and TrueFX | $3,600 | 14 days: 0.050 | 12.8 % (18.2 %) | 1,532 (86 %) | — | — | — | 10-28 |
| rule D `v1` (paper) | PR5V `main` replayed: a check arm, equal to it | $3,600 | = `main` | = `main` | = `main` | — | — | — | its check |
| "with Euros" (Coinbase, paper) | PR5's rule on Coinbase's four books | ~£2,240 | 14 days: 0.014 | 14 days: 5.0 % | 107 (62 %) from 10-11 | — | — | worst day −£2.70 | 11-08 |
| "with Euros - 2" (Coinbase, paper) | the same, holding the rates through a closure | ~£2,240 | 14 days: 0.017 | 14 days: 6.0 % | 125 (64 %) from 10-13 | — | — | worst day −£2.55 | 11-10 |

QUEUE (11-02) and PR5-W (11-25) are offline replays of PR5's stored record, not rows.

**What it shows.**
- **Smaller rungs earn more per pound.** LIVE, at £10, earns the most of every row. Among the through-fill twins, £50 beats
  £100 by 22 %.
- **TAKE helps a little:** variant-2 beats variant-1 by about 33 % per pound at the same size.
- **Rule D's twin** is the worst per pound and the only row with 30 stops.
- **Every twin's marked figure sits well below its realised one.** The twins hold half their capital in coins, and GBP rose.
  The paper engines hold no coin, which is why they look steadier.
- **The weekend** (variant-3, and LIVE from 10-23) made 53–63 bps of capital in its first 48 hours. It is one weekend.

### 3.2 LIVE against its twin

- **On weekdays they agree.** Over 10-12 → 10-23 21:00, 215 trips against 192, realised per £100 0.0773 against 0.0750 (twin
  97 % of LIVE). The 10-21 audit's fill rule holds forward.
- **From 10-22, the twin's scoring window, they do not.** The twin has 48 % of LIVE's realised and 44 trips against 109. The
  reason is the weekend: LIVE has traded the closures since 10-23 21:00 (`weekend_mode` 'live'); the twin has no `rules.weekend`
  and sat dark.
- **What that does on 11-23.** The pre-registration's bar (realised within max(25 %, £0.10), round trips within 20 %) will
  fail on that difference alone, unless a recorded deviation either:
  - (a) scores only the minutes outside FX closures; or
  - (b) adds `rules.weekend` to the `live` spec from the next closure (10-30 21:00 UTC) and scores weekdays plus the
    closures the twin traded.

  (a) needs no code. Either is Davies' call, before 11-22.

### 3.3 Keep, adjust, delete

**Keep, unchanged:**
- **LIVE** (with §2's step if Davies agrees). Take stays in shadow per the 10-23 read: 0 events in five weekdays; next read 10-30.
- **PR5's paper engine.** LIVE carries out its decisions; PR5V, rule D, QUEUE, PR5-W, variant-3's replica and the twins read it.
- **The LIVE twin**, with §3.2's deviation.
- **Variant-2 (TAKE).** 11 takes so far; its window extends a week at a time to 11-30 until 15 have closed.
- **Variant-3** (to 11-25), the weekend rule's forward test beside LIVE's weekends.
- **"With Euros" and "with Euros - 2"** until their readings (11-08, 11-10). They earn the least (5–6 % a year) but run
  their own venue, and their readings are two weeks away. The case for keeping them after is diversification, not return.

**Adjust:**
- **The DAYS heading's label** (§1.4): done here.
- **The LIVE twin's comparison** (§3.2): a deviation, Davies' word.
- **No rule change** is proposed for LIVE. The 10-18 review's replay found only the weekend and size worth having, and both
  are now in hand.

**Retire once their last reading is written** (each is safe, since nothing else reads it):
- **"Stablecoin quotes" twin (`pr5`, £1,200).** Its last readout is after 10-28. The LIVE twin replaced its purpose with
  LIVE's fill rule, and at £100 a rung it is the second-worst per pound.
- **Variant-4 (`d`, rule D's twin, £1,800).** Worst per pound (0.018, marked −2.8 % a year), 30 stops, about 980 simulated
  orders a day. Retire it after rule D's reading and the twins' 10-28 comparison, whatever rule D's result: a pass would go
  live through rule D's own pre-registration, not through this twin.
- **Variant-1 (`p50`).** Its size readout (beside variant-4, after 10-28) is the last thing it is for. §3.4's LIVE-rule size
  twins replace it.
- **PR5V `main` and `top5`, and rule D `d` and `v1` (paper).** Their readings are on 10-28. If they do not pass, switch off
  their calls (`quotesv`, `quotesd`) and keep their tables. The `v1` arm exists only to check `main` and goes with it.

Each retirement is a migration in the shape of 0103/0120 (calls off, rows kept), on Davies' word. No pre-registered reading is
lost by retiring a row after its reading.

### 3.4 New: LIVE-rule twins at £300 and £600

The open question for adding money is how LIVE's own rule fills at a larger rung. Two rows answer it:
- **What they are.** Each is PR5's engine with LIVE's fill rule (`rules.fill` "at") and LIVE's weekend
  (`rules.weekend`), at £300 and at £600.
- **How they are added.** Each takes two statements in the shape of `0136`: a row of `agent_quote_twin_specs`, then
  `select public.create_quote_twin_tables('<id>')`.
- **Their pre-registration.** One page from `reviews/TEMPLATE-variant-prereg.md`, frozen before their start:
  - a window of two weeks from the next 00:00 after they deploy;
  - the bar: realised per pound at least 80 % of the £120 LIVE twin's over the same minutes, and no new failure in the
    executor's report;
  - read beside the LIVE twin.

A pass is the evidence for the step to £600. They cost database rows and nothing at the venue.

## 4. What this review did not do

- It did not change any rule, engine, switch or config row, and did not run any pre-registered reading.
- It did not mark the coins at Revolut X's index for past days. Only the latest index was stored, so the paper engine's fair
  stands in for it. At the read the two differ by under 0.1 %.
- It did not run the browser sweep. This container has no Chromium. The sweep's three expectations were changed to the new
  label, and the main session's full gates run it.
