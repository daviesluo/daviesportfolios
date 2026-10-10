# LP-ALLOC: how much money live-prep should get, and how its rule should use it

Research only (2026-10-10, written 01:00–02:40 UTC). No live path, config or migration changed; every database read was a
read-only `select`; no order was placed or cancelled. Everything is in `docs/agents/backtests/lp_alloc/` (its
`MANIFEST.json` lists every script, input and output). Nothing here is applied: Davies decides money and rules. Every
record read here had been read before, so nothing here is blind.

Davies, 2026-10-10, verbatim:

> 如果我现在想补充资金你建议补多少并切策略如何改进，增加QUOTING TODAY的数量吗？你研究一下确保效果最好

In English: if he adds money now, how much does this suggest, and how should the strategy improve; should it quote more
markets each day? Research it so the result is the best.

## Verdict

- **Add nothing now.** On five days of the full rewarded universe, with the reward programme read as it stood each
  minute and fills modelled the way live-prep's first live day filled, no amount from +$100 to +$1,000 makes any
  setting reliably better. Today's knobs earn **less** with more money: −$3.34 a day at +$100, bootstrap
  [−7.23, −0.56], behind on 5 of 5 days. That is because a larger cap lets more inventory build. The recommended setting
  below earns the same at every cap (+$0.0005 a day for each extra dollar). Money stops paying at today's cap of about
  $330.
- **Do not quote more markets, and do not lift N ≤ 20.**
  - 15, 20 or 30 markets a day earn less at every cap.
  - Markets with a reward minimum of 50, 100 or 200 lose money at every cap, and trip the −$75 stop at $580.
  - Bigger orders (1.5–3 N) are mixed. Under strict fills they lose.
  - The market cap ($60–$300) and the first-quote budget change nothing on their own: the budget only sets how many
    markets fit.
- **The one change the record supports is leaving AI markets out.** Those are markets on model releases, model rankings
  and AI companies.
  - At $330 it earns +$3.95 a day, bootstrap [−5.89, +12.92], and is ahead on 4 of 5 days. Under the 2-hour reading of
    the listing it earns +$5.09 [−4.86, +14.42].
  - The worst day improves from −$57.93 to −$37.70, and the deepest fall from −$60.83 to −$37.70.
  - Filled shares fall from 1,295 a day to 790.
  - AI markets are the worst type for adverse selection on all three paper records.
  - It is drafted as an Addendum-11 proposal at the end. It is not applied.
- **Expected result with the recommended setting:** about **+$11 a day** at the point R. The range runs from +$6.4 at the
  stress R to +$13.7 at the top of the R band. The day-to-day spread is far larger: the five days were +$7.19, −$2.72,
  +$75.72, −$31.19 and +$8.17. Without 10-07's settlement windfall the mean is −$4.6 a day. Read honestly, the strategy
  is about break-even with a wide spread. That is a reason not to put more money at risk until live days say more.

### The table (at-price fills, the programme as read each minute, net $ a day over 10-05 → 10-09)

R here is in the simulator's units: R = 0.47 is live-prep's measured 0.81 (see "What R means here"). The band is
0.38–0.58, and 0.23 is the stress case.

| capital (cap) | setting | R 0.23 | **R 0.47** | R 0.58 | strict 0.47 | in / out of sample | vs today at $330 [5–95 %], days ahead | worst day / deepest fall | capital used peak / mean, held at close | POSTs a day | −$75 stop |
|---|---|---:|---:|---:|---:|---|---|---|---|---:|---|
| today ~$410 ($330) | today's knobs (M10, k1, N ≤ 20, $100/market, $200 budget) | 0.13 | **7.48** | 10.85 | 10.76 | 28.52 / −24.08 | — | −57.93 / −60.83 | 330 / 228, 180 | 4,784 | no |
| | **recommended: today's knobs without AI markets** | 6.42 | **11.44** | 13.73 | 11.78 | 26.73 / −11.51 | +3.95 [−5.89, +12.92], 4/5 | −37.70 / −37.70 | 330 / 200, 157 | 4,278 | no |
| +$100 ($430) | today's knobs | −3.69 | 4.15 | 7.74 | 8.09 | 27.92 / −31.51 | −3.34 [−7.23, −0.56], 0/5 | −71.35 / −77.74 | 429 / 255, 200 | 5,096 | no |
| | recommended | 6.45 | 11.49 | 13.80 | 11.84 | 26.73 / −11.36 | +4.01 [−5.84, +12.98], 4/5 | −37.70 / −37.70 | 380 / 201, 157 | 4,282 | no |
| +$250 ($580) | today's knobs | −3.61 | 4.29 | 7.91 | 8.17 | 27.92 / −31.16 | −3.19 [−7.23, −0.42], 0/5 | −71.35 / −77.36 | 496 / 256, 200 | 5,129 | no |
| | recommended | 6.47 | 11.52 | 13.84 | 11.85 | 26.73 / −11.29 | +4.04 [−5.82, +13.01], 4/5 | −37.69 / −37.69 | 380 / 201, 157 | 4,310 | no |
| +$500 ($830) | recommended | 6.45 | 11.51 | 13.82 | 11.85 | 26.73 / −11.33 | +4.02 [−5.83, +12.99], 4/5 | −37.69 / −37.69 | 386 / 202, 157 | 4,352 | no |
| +$1,000 ($1,330; the code's ceiling is $1,000) | recommended | 6.49 | 11.56 | 13.89 | 11.85 | 26.73 / −11.19 | +4.08 [−5.78, +13.05], 4/5 | −37.69 / −37.69 | 423 / 204, 157 | 4,377 | no |
| any | the in-sample best at $1,330 (30 markets, N ≤ 100, $200/market) | −14.46 | 4.70 | 13.47 | −9.24 | 72.45 / −96.93 | −2.79 [−47.25, +45.73], 2/5 | −127.82 / −209.94 | 1,380 / 1,213, 1,080 | 11,212 | no |

How to read the table:

- In sample means 10-05 → 10-07, where a choice would be made; out of sample means 10-08 → 10-09.
- The bootstrap is a paired day bootstrap of the five days (seed 20261010, 2,000 draws).
- "Held at close" is the holdings at cost at the end of each day.
- POSTs are the simulator's counter × 1.8, which is LPCAP's live scaling.
- `results/analysis_lb0.txt` has every arm (150 at each cap). `results/analysis_lb120.txt` reads the listing's rate as
  the highest of the last two hours and agrees: the recommended setting is ahead at every cap, +$5.09 to +$5.34 a day.
- The in-sample "best" arm at each cap failed out of sample (−$96.93 a day at $1,330). Choosing knobs on three days
  overfits.

## What changed since LPCAP, and why its answer moved

LPCAP said more capital adds nothing at today's sizes. It priced rewards with each market's programme as it stood at
00:00. Two things measured since then change the picture.

1. **The programme changes inside the day, and Polymarket pays what is in force.**
   - On 10-09 Polymarket paid 0.807 of live-prep's own formula, read like for like, minute by minute at the listing's
     rate then (`lpcfg/results/rtrue.txt` on main: $6.5242 over $8.0819). It paid 0.042 of the formula at the 00:00
     programme.
   - Here every minute is scored on the programme the pm-rec record read then (`liveProg`). A market that has stopped
     paying (programme ended, rate under $10, or N over the ceiling) takes no entry; it rests close-only sells and earns
     nothing. That is the reward check now on main (0111, Addendum 9).
   - On today's rule this cuts the formula from $84.9 a day to $30.6, a fall of 64 %. The net at R = 0.47 falls from
     $27.23 to $7.48.
2. **Live fills are the at-price model, not the strict one.**
   - On 10-09, with live-prep's own selection imposed from 01:33, the at-price simulator filled 69 times for 1,216
     shares. Live filled 70 times for 1,219 shares on the same nine markets.
   - Strict fills gave 30 and 568.
   - The fills' P&L of the day was +$1.00 in the simulator against −$1.15 live, at 23:59's mids.
   - The formula at the 00:00 programme was $131.12 in the simulator against live's $145.86 (`results/calib_sim.txt`).

## What R means here

The reward side is R × the formula. The formula differs between the simulator and the live path, so R has to be stated
in each one's units.

- **Against the live path's own formula**, read like for like: **0.807** on 10-09. It runs from 0.73 to 1.00 per market
  where there are enough minutes, and is 0.825 on the nine markets the record holds. The coordinator's band is
  [0.65, 1.00], with 0.40 as the stress case.
- **Against this simulator's formula** on the same nine markets and minutes: **0.481** with at-price fills ($5.042 paid
  over $10.49) and 0.464 with strict fills. The simulator's formula is 1.72 times the path's. It quotes more minutes than
  live did, and live's inventory on 10-09 (111.5 YES on 0x5b3350e2) left sides one-sided.
- So the band [0.65, 1.00] around 0.81 becomes **[0.38, 0.58] around 0.47** here, and the 0.40 stress becomes **0.23**.
  Applying 0.81 to the simulator's formula directly would count the 1.72 twice.
- The listing's rate flickers. 0x5b3350e2 read 40 or 3 from one 15-minute read to the next. Polymarket paid the low
  reading where it lasted: $0.268, which is 0.85 of the formula at 3 a day and 0.08 at 40. So the record is read as it
  stands (`LOOKBACK=0`), with the 2-hour maximum (`LOOKBACK=120`) as a sensitivity.

## Each knob, alone and with others (at $330, today's knobs as the base, at-price, R = 0.47)

| knob | net a day | vs base [5–95 %], days ahead | worst day / deepest fall (R 0.23) | held at close | what it does |
|---|---:|---|---|---:|---|
| base (today's knobs) | 7.48 | — | −57.93 / −60.83 | 180 | |
| more markets: 15 / 20 (17 fit the budget) | 4.23 / 1.63 | −3.25 / −5.85 | −60.36 / −52.25 | 225 / 244 | more fills, the same rewards |
| bigger orders k 1.5 / 2 / 3 (market cap × k) | 13.73 / 12.94 / −7.02 | +6.25 / +5.46 / −14.50 | −40.24 / −75.09 / −40.59 | 197 / 232 / 167 | under strict fills 5.55 / −1.71 / 7.59: the sign is not stable |
| N up to 50 / 100 / 200 (10 markets) | −2.49 / −7.70 / −5.71 | −9.97 / −15.18 / −13.19 | −65.71 / −91.06 / −82.81 | 222 / 220 / 234 | larger pools, worse fills; at $580 they trip the −$75 stop |
| market cap $60 / $150–$300 | 7.37 / 7.48 | −0.11 / 0 | | | does not bind |
| budget $300 / $400 / $600 (40 allowed) | 5.86 / 0.46 / 5.84 | −1.62 / −7.02 / −1.64 | | | only sets how many markets fit (15.6 / 20.8 / 31) |
| side cap 3N / 2N (RW-X's x5 / tighter) | −0.81 / −2.36 | −8.30 [−18.25, −1.44] 0/5 / −9.85 [−28.05, +7.06] 1/5 | −57.38 / −33.26 | 166 / 153 | costs more reward than it saves |
| drift stop 5 / 10 / 20 ¢ (no buy into a holding marked k ¢ under its cost) | −8.55 / 8.01 / 6.87 | −16.04 / +0.53 [−1.27, +3.00] / −0.61 | −46.42 / −55.74 / −58.00 | 159 / 180 / 181 | 10 ¢ is noise; 5 ¢ stops buys that would have earned |
| **leave AI markets out** | **11.44** | **+3.95 [−5.89, +12.92] 4/5** | **−37.70 / −37.70** | 157 | fewer, better fills |
| leave AI and count markets out (views, posts, streams) | −7.62 | −15.10 [−41.42, +9.46] | −34.95 / −70.55 | 181 | count markets carry too much of the reward |
| no BUY its own formula scores 0 (per side) | 6.34 | −1.14 [−3.25, +1.05] 2/5 | −61.98 / −69.02 | 183 | neutral (see below) |
| no BUY while the market's formula is 0 | 6.42 | −1.06 [−2.85, +0.99] 1/5 | −61.54 / −68.55 | 180 | neutral |
| refill a vacated place from a reserve of 10 after 15 / 60 min off | 6.14 / 2.71 | −1.34 [−15.89, +11.86] / −4.78 | −54.50 / −57.17 | 217 / 245 | 7.2 / 6.4 refills a day; mixed (+3.20 at $430) |
| refill 15 + no AI | 13.47 | +5.99 [−13.02, +22.11] 4/5 | −31.19 / −31.19 | 205 | |
| check the programme at selection (stable 3 h before, the CLOB check's stand-in) | 3.85 | −3.64 [−15.12, +7.85] | −68.29 / −70.15 | 199 | negative |
| choose again every 6 h | 30.73 | +23.25 [+1.84, +44.93] 4/5 | −20.26 / −20.26 | 306 | **not taken**: see below |
| 3N + drift 10 + refill 15 + no AI | 4.80 | −2.68 [−19.71, +13.51] | −29.92 / −29.92 | 184 | |

`results/analysis_lb0.txt` has the same knobs on the bases of 15 markets and of 1.5 N, at every cap. The signs hold for
no AI, 3N, 2N and drift 5. They are mixed for refill and the zero-score rule.

**Choosing again every 6 hours is not a gain to take.**

- Its rewards fall from $30.6 a day to $18.7, and to $0.3 by 10-09.
- Every market it drops leaves its inventory behind. The holdings fill the cap: $306 held at close against $180, and
  up to 7,308 buy-minutes a day withheld by the cap.
- Its +$22 a day of fills is what that carried inventory happened to settle at, mostly on 10-05 and 10-07.
- It is a directional bet, the "risk with no reward" Davies ruled out. LPRESEL6 reads this rule forward, as frozen, on
  10-23.

## Programmes ending or changing inside the day (`results/prog_stats.txt`)

The input is pm-rec's listing reads: each market every 15 minutes, over 10-05 → 10-09. The markets counted are those the
record kept that paid at 00:00 (rate ≥ $10, N ≤ 20).

| set | market-days | read off ≥ 30 min | no programme ≥ 60 min | minimum rose past 20 | share of the day's minutes off |
|---|---:|---:|---:|---:|---:|
| every kept market | 2,412 | 75 % | 13 % | 25 % | 38.4 % |
| the 00:00 slot's top 10 (the selection's order) | 48 | 77 % | 25 % | 40 % | 50.7 % |

The top of the ranking is where programmes are newest and most in flux. That is a winner's curse: the selection pays for
it with half of its minutes.

- The simulator's own counter agrees: 8.4 of each day's 10 chosen markets changed programme inside the day, and
  25–37 % of the chosen market-minutes were off.
- Refilling from a reserve gets some of those minutes back. On this record it gives back about what the refilled markets
  then cost in fills.
- A check at selection that requires a steady programme leaves out too much.

## Adverse selection by market type (`results/markouts.txt`, `sql/markouts.sql`)

The fills come from three records: RW's (4,242 fills), RW-C's (603) and live-prep's paper layer (504). Each fill is
marked at the path's own recorded mid 5, 30 and 120 minutes later. The table gives cents a share at 120 minutes, with
negative meaning adverse.

| type | RW | RW-C | LP paper |
|---|---:|---:|---:|
| AI (model releases, rankings, AI companies) | −2.80 | −3.28 | −2.99 |
| counts (views, posts, streams, sales) | −1.79 | −1.58 | −2.53 |
| macro / markets | −1.55 | −1.17 | −2.57 |
| politics / geopolitics | −0.15 | −1.88 | −1.05 |
| weather / nature (left out since x1) | −1.18 | −2.26 | — |
| all | −1.19 | −1.94 | −2.62 |

- AI markets are the worst type on every record, at 5 minutes (−1.48 to −2.94) as well as at 120.
- Count markets come second on two of the three. Leaving them out as well costs more reward than it saves (the knob
  table above).
- The type is a pattern on the question, the same list in `sql/markouts.sql` and in `alloc_run.ts` (`typeOf`).
- The coordinator's live examples fit the pattern: 0x5b3350e2, "Anthropic #1 AI model by Dec", was −$11.7 at 01:07 on
  10-10, and 0x3090f7aa, MrBeast views, was −$9.6.

## Quotes that rest while the formula scores them 0 (`results/zero_score.txt`, `sql/zero_score.sql`)

| record | minutes with a side resting | of which the formula is 0 |
|---|---:|---:|
| RW | 206,267 | 31 % |
| RW-C | 27,207 | 26 % |
| live-prep live | 10,977 | 30 % |
| live-prep dry-run | 76,166 | 54 % |

Per side, live, a bid's own score was 0 in 16 % of its resting minutes and an ask's in 19 %. 0x31e2f3df on 10-10 is the
case the coordinator named.

The fills in those minutes, in cents a share at 5 / 30 / 120 minutes:

| record | fills in score-0 minutes | fills in scoring minutes |
|---|---|---|
| RW (the market's formula 0) | +0.66 / +0.42 / +1.41 | −1.41 / −1.65 / −1.97 |
| RW-C (the market's formula 0) | −0.57 / −0.73 / +2.48 | −1.60 / −2.11 / −2.80 |
| live-prep paper (the filled side's own score 0) | −1.62 / −4.26 / −3.30 | −1.64 / −2.44 / −2.54 |

- On RW and RW-C those fills are better than the scoring ones. Many are the reducing side of a market whose other side
  had stopped at its inventory cap.
- On live-prep's paper they are a little worse.
- Priced in the simulator, withholding such buys costs −$1.14 a day per side, or −$1.06 when the whole market scores 0.
  Both are inside the noise.
- Davies' principle ("避免…白挂了并且承担风险并且没奖励") may still choose it, at about $1 a day. The record does not make it pay.

## What binds at each level

1. **The paying reward pool.** Selection-time programmes are off for half of the chosen minutes. Rewards under the
   programme as read are $20–$33 a day in the simulator, which is about $14 at the point R, at every cap.
   - The $10+ universe on 10-10's dump had 1,831 markets with N ≤ 20, 778 with N 21–50, 319 with N 51–100, 129 with
     N 101–200 and 301 with N over 200.
   - Live selections found 116–194 candidates with a formula of $2.50 or more.
   - Depth is not short. Paying, steady depth is.
2. **Adverse selection.** More markets and bigger orders add fills faster than rewards: about 1,300 filled shares a day
   on today's rule. Today's knobs lose $3.2–$3.3 a day as soon as the cap stops holding inventory back.
3. **Capital.** It binds today in the narrow sense: at 00:43 UTC on 10-10, four of today's ten markets had buys withheld
   by `cap_total`, because about $262 at cost was held from 10-09 against a cap of $329. Lifting that cap buys more
   inventory, not more reward. The recommended setting uses at most $330–$423 and holds $157 at close on average at
   every cap.
4. **The −$75 stop.** It is fixed in dollars. Settings that hold more trip it: every arm of N up to 50, 100 or 200 with
   ten markets at $580. The in-sample best at $1,330 (30 markets, N ≤ 100) did not trip it, but fell $209.94 from its
   peak in five days.
5. **POSTs.**
   - The governor allows 12,000 a day. Live-prep sent about 5,941 orders over 22.5 live hours on 10-09.
   - The simulator estimates 4,784 a day for today's rule, 9,754 for 20 markets at $580 and 10,984 for 30.
   - The governor binds at about 25–30 markets.
   - Polymarket's own limits are far above this: the CLOB allows 9,000 per 10 s, `/book` 1,500 per 10 s (reference
     §2d).
6. **Selection time.** The selections of 10-04 → 10-10 took 4.1–8.5 s of wall time over 776–1,397 books. The reward
   listing timed out twice (10-05 and 10-06, read again five minutes later). Lifting N to 200 would add about 1,200
   books, which is unmeasured.
7. **The minute's deadline.** Not measured: the state keeps no turn duration.
8. **One wallet.** Every holding, resting buy and unredeemed payout draws on the one pUSD balance, which is the cap's
   equity. Settled tokens that are not redeemed hold capital until Davies redeems them.

## Concentration against the −$75 stop

- **The arithmetic.** A market holds at most $100 at cost (`PM_LP_CAP_MARKET_USD`). At 5N = 100 shares bought at an
  average p, a resolution against it loses 100 × p:
  - $61 at 0x5b3350e2's 0.61;
  - $95 at 0.95. The near-certain limit (Addendum 7) holds a token at 0.95 or more to 8 % of capital, $26 at $330.
  - Two markets at their side cap resolving against the book exceed the stop.
- **On record.**
  - The worst single market over the five days was −$24.52 (recommended) and −$37.41 (refill 15).
  - The worst day was −$57.93 on today's knobs and −$37.70 on the recommended setting.
  - Live, two markets marked −$11.7 and −$9.6 within a day.
- **The side caps.** 3N and 2N cut the most a market can lose by 40 % and 60 %. They cost $8–$10 a day of reward on
  this record. The stop, the 8 % limit and leaving out the worst type are the cheaper protections.

## Uncertainty, and the split used

- **Five days.** In sample: 10-05 → 10-07. Out of sample: 10-08 → 10-09, the second being live-prep's first live day,
  with its own orders taken out of the books.
  - One day, 10-07, carries the five-day means: a fills windfall of +$47 on today's rule.
  - Without it, today's rule is −$6.3 a day and the recommended setting −$4.6.
  - The bootstrap intervals above are over five days, and they are wide.
- **R.** One live day, ten markets. The like-for-like R is 0.807, and 0.73–1.00 per market where minutes allow. In the
  simulator's units the band is 0.38–0.58. Every conclusion above holds across it, and at 0.23.
- **The listing's rate flickers.** As read (`LOOKBACK=0`, which Polymarket's payout supports) is the main reading, and
  the 2-hour maximum (`LOOKBACK=120`) the sensitivity. The recommended setting is ahead under both.
- **The universe.** On each day the record holds the best 60 markets of N ≤ 20 and the best 40 of N 21–200 of each
  2-hour slot (1,952 markets). Coverage was 1,440 minutes a day except 10-07 (1,223) and 10-08 (1,433).
- **Not blind.** The AI result was first seen in the markouts. Those records overlap this one's days (RW's ends 10-08,
  live-prep's paper 10-04 → 10-09). Its forward test would be live, or RW-C's days after 10-10.

## What could not be checked

- The minute's deadline under more markets.
- Selection time at N up to 200.
- The CLOB's per-market programme read at selection. The record has only the listing, so "stable for 3 h" stands in
  for it.
- Live fills over more than one day.
- Payouts per market beyond 10-09.
- Whether Polymarket pays the 1/3 single-sided score. Not modelled (RW's formula).
- RW-C's record through the simulator: its minutes are RW's selection only, so this study used the full-universe pm-rec
  record, and RW-C enters through its fills' markouts.
- The near-certain limit is modelled (Addendum 7, 8 % of the cap). The reward check's backstop (Polymarket's scoring
  verdict three minutes running) is not: the record has no scoring verdict.
- The reproduction check's own record and JSON were not kept, because the container's disk was full. The run's
  byte-for-byte lines are copied in `results/seedcheck.txt`.

## Addendum-11 PROPOSAL (draft, not applied; Davies decides)

This is not written into the frozen pre-registration. If Davies agrees, the proposal becomes Addendum 11 there.

> **Addendum 11 (proposed): AI markets out of live-prep's universe; no change to its capital.** A market whose question
> matches the AI pattern of LP-ALLOC (`backtests/lp_alloc/scripts/alloc_run.ts`, `typeOf`: model releases, model
> rankings, named AI companies and models) is not a candidate (`PM_LP_CANDIDATE`), as weather markets are not. Markets
> held from earlier days keep their close-only sells. Every other rule is unchanged: ten markets, $200 of first quotes,
> N ≤ 20, $100 a market, 5N, the −$75 stop, the equity cap (Addendum 8), the reward check (Addendum 9). Evidence:
> LP-ALLOC's five-day full-universe replay, +$3.95 a day [−5.89, +12.92] at R = 0.47 in the simulator's units (the live
> 0.81), 4 of 5 days ahead, worst day −$37.70 against −$57.93; AI markets the worst type at 120 minutes on RW's, RW-C's
> and live-prep's paper fills (−2.80, −3.28, −2.99 ¢ a share). Not blind. A pin test: a candidate list with one AI
> market and one other leaves the AI market out and changes nothing else. Its forward test: live-prep's live days after
> the deploy, AI-type markets' share of the fills and their markouts, against this file's figures.

Davies' word is still needed on the money: the recommendation is to add nothing. Read again after seven live days with
the reward check. If R holds at about 0.8, and the fills of those days cost no more per share than the paper's, the step
to price is +$100 with refill 15 and no AI ($430: +$9.84 a day on this record, against today's $7.48 at $330).

## How it was run (from `docs/agents/backtests/lp_alloc/`)

1. **The record.** `scripts/build.ts` is LPRESEL6's builder. It adds markets of N 21–200, each market's programme
   timeline, and live-prep's live orders taken out of the books. It was run on every pm-rec archive object from 10-04 19:00
   to 10-09 23:00, each checked by its sha256, giving 6,976 minutes, 1,952 markets, 3,470,430 rows and 60,608 prints
   (sha256 `69388814…f999`, not committed).
   - With LPSELF's programme seed (`LPSELF_SEED=1`), L1 on it reproduces LPSELF's `lp_pr.json` and
     `lp_pr_atprice.json` byte for byte (`results/seedcheck.txt`).
   - With LPRESEL6's seed it gives LPSELF's days 10-06 → 10-08 to the cent and LPRESEL6's 10-05.
2. **The simulator.** `scripts/alloc_sim.ts` is LPCAP's `cap_sim.ts`, with options for:
   - the programme in force (`liveProg`);
   - Addendum 7's limit, copied from EXPENSIVE-SIDE;
   - the drift stop;
   - the refill;
   - the zero-score buy;
   - counters.
   With none of these set, it is `cap_sim.ts` line for line. The formula and the fill model are RW's own functions
   (`pmrw.ts`); none was written again.
3. **The arms.** `scripts/alloc_run.ts` runs `check`, `grid`, `nmax`, `knobs`, `ideas`, `risk`, `zero` and `live`, at
   `LOOKBACK=0` and `120`, under both fill models.
4. **The tables.** `scripts/analyse.py` writes `results/analysis_lb*.txt`. The calibration is in `scripts/calib.py`,
   `calib_sim.py` and `live_fills.py`, and the programme statistics in `scripts/prog_stats.py`.
5. **The SQL.** The read-only statements are in `sql/`. Signed URLs were never written to any file here.
