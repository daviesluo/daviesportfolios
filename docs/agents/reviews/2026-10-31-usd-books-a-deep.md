# USD-A-DEEP: MMCOMP's A on Revolut X's USD stablecoin books, priced leg by leg and replayed as it would trade (2026-10-31)

Davies, 2026-10-31: "第 2 名继续深度研究": rank 2 and 3 of `reviews/2026-10-31-maker-other-books.md` (MAKER-OTHER-BOOKS):
rest an order inside the touch on Revolut X's USDC-USD or USDT-USD, close the coins outside at par or at Coinbase, every
question that decides whether it is worth money, any route that works. The 1,000 orders a day are per account or
sub-account (one more sub-account of his own is a cost, not a wall). A separate study looks at the crypto books.

**Research only, not blind.** Every record was read. Nothing in production changed: no order, config, migration, executor
or frozen file. Public market data and public fee pages only, and read-only SQL. No balance of Davies' accounts appears;
every dollar below is a replay's (paper) or a public figure. Script `backtests/mmcomp/scripts/usd_a_deep.py`, result
`backtests/mmcomp/results/usd_a_deep.json`, inputs already committed (`data/other_usd_prints.txt.gz`, `data/cb30_*`,
`fair_price/data/book_USD*-USD.txt.gz`, `fair_price/data/fx.txt.gz`).

## 0. Answers first

**Verdict: not worth money as things stand.** The replay's earlier figures ($1–8 a day) were too high, for three reasons:
- **capital**: a day's bids use up the dollars put aside for them, and the dollars come back only once a day;
- **the queue**: behind the visible size, fills fall by two-thirds;
- **the route**: closing at par through Coinbase is not open to a UK account, and closing through Coinbase's pound books
  costs as much as it earns.

The one route that would pay is Revolut's own 1:1 USD↔stablecoin conversion. Whether a UK account has it is
**unconfirmed**, and the market itself suggests it does not (§1.3). Even with it, the strategy earns less per pound than
LIVE, and it needs Davies to move coins by hand every day.

| route to close the coins | book | £600 ($805) net a day | £1,200 ($1,610) net a day | what it needs | verdict |
|---|---|---|---|---|---|
| LIVE today, for scale (MAKER-ABSENT) | USDT-GBP | £0.90–1.06 with the maker there, £2.87 away | £1.52–1.86 there, £5.32 away | nothing new | the yardstick |
| **A. Revolut's 1:1 conversion in the app** | USDT-USD, bid only | **$1.02 (£0.76)** first in queue; $0.33 (£0.25) behind the queue | $1.48–1.96 (£1.10–1.46); ceiling about $2.9 (£2.2) at any capital | the 1:1 for a UK account; free moves between Revolut X and the app; a hand move every day | **not unless both are confirmed**, and even then below LIVE per pound |
| A. the same | USDC-USD, bid only | $0.27 (£0.20); $0.09 behind the queue | $0.36–0.50 (£0.27–0.37) | the same | no |
| B. Coinbase's pound book, pounds back to dollars in the Revolut app | USDT-USD, both sides | $0.23 gross; **−$0.07 to +$0.02 after transfers** ($2,000–5,000 batches) | $0.41 gross; −$0.48 to −$0.04 | £3 a withdrawal, a bank day each way, Revolut's exchange fee at 0 | no |
| B. the same | USDC-USD | $0.24 gross; +$0.01 to +$0.11 | $0.35 gross; −$0.10 to +$0.13 | the same | no |
| B. with a 5 bps exchange fee in the app | either | $0.10 gross, negative after transfers | | | no |
| C. Coinbase's USD book at par | either | not available to a UK Coinbase account (no USD wallet found) | | | no |
| D. Kraken as the close | either | 20 bps maker and taker on its stablecoin pairs, against 6–14 bps of edge | | | no |

Figures are dollars a day over 2026-09-27 → 10-29 (A) and 10-11 → 10-29 (B). "First in queue" is an order one tick inside
the touch; "behind the queue" is joining the touch behind every coin the snapshot shows. Every positive A row is positive on
29–32 of 32 days, and both halves of the window are positive (block-bootstrap P(mean ≤ 0) = 0.000 for each half). The
statistics are not the risk here; the route is.

**In five lines.**
1. On a UK account the coins can only be closed at par through Revolut's own 1:1 conversion. That route is unconfirmed, and
   a 14–18 bps USDT discount lasting weeks on Revolut X's UK book suggests it is closed or limited there.
2. Through Coinbase's pound books the edge is about 6.5 bps a fill, and the £3 withdrawal eats it unless coins move in
   batches of $10,000 or more.
3. Even with the 1:1 route, USDT-USD earns $1.0 a day on £600 if we are always first in the queue, $0.33 behind it, and
   about $3 a day at most at any size. The flow is there ($47,000 a day of takers selling at least 5 bps under par); our
   orders and our once-a-day hand move are the limit.
4. Fills carry no adverse selection worth the name (the book's mid 1 and 5 minutes later is a median 0.5 bps in our favour).
   USDC earns a third of USDT, because USDC sits nearer par.
5. Nothing to build now. The paper draft in §6 waits on two in-app checks by Davies.

## 1. Costs and routes, from the sources

### 1.1 Revolut X (primary: "Revolut X Fees", Revolut Ltd, 1 August 2025, cdn.revolut.com, read 2026-10-31)

- Trading: **0 % maker, 0.09 % taker.**
- External crypto withdrawal: a **£3 service fee** for USDC, USDT and every coin not on its £1 list (XRP, XLM, DOT, SOL, AVAX,
  XTZ, ALGO, ADA), **plus the network fee**, quoted in the app before sending. MMCOMP-2 used USDC on Solana at £0.05 and
  assumed £1 for USDT.
- No fee is listed for a deposit, or for a move to the Revolut app.
  - Revolut's transfer services policy (cdn.revolut.com, rdael_transfer_services_policy 1.1.1) describes the move to a
    Revolut account: Withdrawal → Crypto → the Revolut account.
  - No source states its fee. Unconfirmed.
- No withdrawal endpoint in the API (reference §2; MMCOMP-2). **Every move of coins or cash is by hand in the app.**
- The UK account holds and trades USD: the retired `trend-4h-live` row traded BTC-USD on it with dollars (agents CLAUDE.md).
  How dollars arrive: from the Revolut app, converted there.

### 1.2 Revolut app (primary: "Personal Fees, All Plans (Current)", cdn.revolut.com, read 2026-10-31)

- An exchange is made "at the Revolut exchange rate", plus "an exchange fee", plus a fair-usage fee beyond the allowance:
  - Standard: £1,000 a month, then 1 %;
  - Plus: £3,000 a month, then 0.5 %;
  - Premium, Metal, Ultra: no limit and no fair-usage fee.
- **"All exchange activity – across fiat currency, crypto, and commodities – counts toward your exchange limit."** The
  exchange fee itself is "set out in the App". It is not a number on the page, so it is unknown here.
- Weekend mark-ups: Revolut's help centre (as quoted by search) says Premium, Metal and Ultra pay none, Standard and Plus 1 %.
  Not read first-hand.
- **The 1:1 USD↔USDC/USDT conversion** (announced 2025-10-31; Revolut's blog and product page could not be fetched,
  403):
  - Cointelegraph 2025-10-31: no fees or spreads, both directions, USDC and USDT on six chains, up to **$578,630 per rolling
    30 days**, "provided the stablecoins maintain their pegs".
  - Search-quoted from Revolut's blog: a fee applies above the limit; in the app, Crypto → Trade.
  - **Which countries have it: not found.** The coverage ties it to Revolut's MiCA licence (EEA).

### 1.3 Does the 1:1 work for a UK account? The market says probably not

- If a UK Revolut X user could turn USDT into dollars 1:1 in the app, nobody with that route would sell USDT on Revolut X's
  UK book at 0.998.
- Yet takers sold **$50,026 a day** there (real prints of $1 or more), **$47,064 of it at 5 bps or more under par** and
  $38,435 at 10 bps or more (09-27 → 10-29, `usd_a_deep.json` "flow").
- The book's mid sat 3 bps under Coinbase's USDT-USD, which itself fell from 0.9997 to 0.9986 over the five weeks (weekly
  medians 0.99966, 0.99961, 0.99878, 0.99876, 0.99860).
- So either those sellers lack the route, or using it costs something (limits, a hand move, a fee) that a public page does
  not show.
- **Davies' check in the app decides it:**
  - Crypto → Trade → USDT and USDC: is a 1:1, no-spread conversion offered, both ways?
  - What does moving USDT from Revolut X to the app cost, and how long does it take?

### 1.4 Coinbase (reference §4 item 67; MMCOMP-2 §4)

- Stable pairs: **0 % maker; taker 0.10–0.45 bps by tier** (Coinbase's fee page as the probe reads it). The account's own
  stable-pair tier is not yet read: `cb_live_state.state.takeFee` was null at 05:02 UTC today, and Coinbase's take shadow
  reads it from Sunday 21:00.
- USDC withdrawals free; USDT 0.01 % (at most 20) plus the network fee (third-party tracker).
- **USD for a UK account: not found.**
  - The probe reads GBP, USDC and EUR balances only, and Coinbase's UK pages show USDC-GBP, not USD.
  - So Coinbase's 1:1 USDC→USD is taken as unavailable here: route C is closed until a USD wallet is shown.
- Pounds to a UK bank by Faster Payments free (reviews, MMCOMP-2).

### 1.5 Kraken and OKX

- Kraken's published schedule (kraken.com/features/fee-schedule, read 2026-10-31): "Stablecoin, Pegged Token & FX Pairs
  (e.g., USDT/USD, USDC/USD), $0+: Maker 0.20 %, Taker 0.20 %". That is 20 bps a side against 6–14 bps of edge, so dead.
- OKX: the account in reference §3.55 is Irish and EEA, its books in EUR and USDC. It has no USD close, and it was not
  checked further.

### 1.6 Each route's cycle, leg by leg

| route | legs | cost per cycle |
|---|---|---|
| A (1:1) | buy on Revolut X (0 %) → move coins to the app by hand (fee unknown) → 1:1 to USD (0 up to the limit) → move dollars back (fee unknown) | 0 + the two moves; capital idle until the daily move |
| B (Coinbase GBP) | buy on Revolut X (0 %) → withdraw (£3 + network) → sell on Coinbase USDC-GBP / USDT-GBP (taker 0.45 bp) → pounds to the bank (free, a day) → into Revolut (free) → GBP→USD in the app (the exchange fee; Standard 1 % beyond £1,000 a month) → dollars to Revolut X | £3 a batch, 20 bps of a $2,000 batch, 8–11 bps of $5,000, 2 bps of $20,000; plus the exchange fee; capital in transit up to the batch for 1–3 days |

## 2. The replay (`usd_a_deep.py`)

- **Decisions.** From the recorder's five-level snapshots of USDT-USD and USDC-USD, live 5 s after each read. A snapshot more
  than 75 s past its last confirming read leaves the side unquoted.
- **Order.** Q = $100 (also $250), one order a side, priced three ways:
  - "improve": a tick inside the touch when the spread allows, first in its queue;
  - "join": at the touch, behind every coin the snapshot shows there;
  - "through": filled only by a print strictly through it.
- **Price limit.** Never priced where the close would pay under m bps (0, 2, 5).
- **Fills.** Each public print of $1 or more whose taker sold at or under our bid (or bought at or over our ask) fills us at
  **our price** after the queue's share. Partial fills rest.
- **The bot.** Prints under $1 (the £0.10-style bot) fill nothing and are counted apart: on USDT-USD 92–181 a day touch our
  price, so live they would bring dust; the £1 holding line handles that.
- **Capital.** C dollars on Revolut X, split between the bid's dollars and the ask's coin (half each, or all on the bid),
  put back at 00:00 UTC (the hand move). A side whose leg is under Q is off until then.
- **Closing a fill.**
  - A: at exactly $1.
  - B: at Coinbase's pound touch at the first 30-second read 0, 30 or 90 s after the fill, × the minute's GBP/USD less 0 / 5
    / 20 bps of exchange fee. Transfers in $2,000 / $5,000 batches at 00:00, or none.
- **Markouts.** Revolut X's mid 1 and 5 minutes after (the book is recorded once a minute: **5- and 30-second markouts cannot
  be read**). For A they do not change P&L, since the close is fixed at par.
- **Statistics.** Daily P&L, worst day, drawdown; a 3-day block bootstrap (10,000 resamples, seed 20261031) of the mean day,
  whole window and each half.

### 2.1 Route A (1:1), 2026-09-27 → 10-29 (32 days)

| book | order | capital | fills a day | $ filled a day | bps a fill | $ a day (halves) | days > 0 | P(≤ 0) all / 1st / 2nd half | orders a day (max) |
|---|---|---|---|---|---|---|---|---|---|
| USDT-USD | improve, bid only, all dollars | $805 | 11.9 | 732 | 13.8 | **1.02** (0.56, 1.49) | 32 | 0.000 / 0.000 / 0.000 | 40 (187) |
| USDT-USD | the same | $1,610 | 17.7 | 1,125 | 13.2 | 1.48 (0.97, 2.00) | 32 | 0.000 | 61 (265) |
| USDT-USD | the same, Q $250 | $1,610 | 12.5 | 1,407 | 13.7 | 1.96 (1.07, 2.84) | 32 | 0.000 | 37 (186) |
| USDT-USD | the same, Q $250 | $4,025 / $8,050 | 18.5 / 19.2 | 2,222 / 2,292 | 13.0 | **2.91 / 2.95** (the ceiling) | 32 | 0.000 | 60 (285) |
| USDT-USD | join (behind the queue), all dollars | $805 | 3.2 | 269 | 11.9 | **0.33** (0.24, 0.42) | 29 | 0.000 | 60 (303) |
| USDT-USD | through only, half each side | $805 | 2.2 | 198 | 13.2 | 0.27 | 27 | 0.000 | 56 |
| USDT-USD | improve, half each side | $805 | 6.2 | 359 | 14.4 | 0.50 | 32 | 0.000 | 20 |
| USDC-USD | improve, bid only, all dollars | $805 | 6.8 | 445 | 5.7 | **0.27** (0.07, 0.46) | 30 | 0.000 | 19 (126) |
| USDC-USD | the same | $1,610 | 8.0 | 535 | 6.4 | 0.36 | 30 | 0.000 | 21 |
| USDC-USD | the same, Q $250 | $4,025 | 8.5 | 1,119 | 6.4 | 0.76 (the ceiling ~0.8) | 30 | 0.000 | 21 |
| USDC-USD | join, all dollars | $805 | 2.0 | 169 | 5.8 | 0.09 | 25 | 0.000 | 22 |

- **The asks hardly fill** (USDT: 1 sell in 32 days at m 2), because the books sit under par. So the strategy is a bid, and
  the dollars it needs every morning are the binding limit: $805 turns over 0.9× a day, $1,610 0.7×.
- **Worst day:** never below $0 on any A row: the close at par cannot lose unless a coin de-pegs while held, at most a day.
  **Drawdown 0.**
- **The maker:**
  - USDT-USD fills with the other maker there: 346 of 380 at 13.8 bps.
  - Quoting only while it is away: $0.12 a day.
  - Its presence is where the flow is; its absences are few hours.
- **Markouts** (book mid after the fill, + = ours): USDT 1 min 10th/50th/90th 0.0 / 0.5 / 4.0 bps, 5 min the same; USDC
  0.0 / 1.0 / 5.0. Takers who sell to us are not informed.

### 2.2 Route B (Coinbase pound book), 2026-10-11 → 10-29 (18 days; Coinbase's 30-second touch)

| book | capital | fills a day | bps a fill | $ a day before transfers | coins to move a day | net at $2,000 batches | net at $5,000 | orders a day (max) |
|---|---|---|---|---|---|---|---|---|
| USDT-USD | $805 | 5.7 | 6.5 | 0.23 | $195 | −0.07 | ≈ +0.02 | 285 (792) |
| USDT-USD | $1,610 | 8.7 | 6.9 | 0.41 | $422 | −0.48 | ≈ −0.04 | 297 (792) |
| USDC-USD | $805 | 4.8 | 6.5 | 0.24 | $158 | +0.01 | ≈ +0.11 | 307 (560) |
| USDC-USD | $1,610 | 7.3 | 6.7 | 0.35 | $273 | −0.10 | ≈ +0.13 | 326 (560) |
| either, exchange fee 5 bps | $805 | 2.7–3.8 | 4.2–4.8 | 0.10 | | negative | ≈ 0 | |
| either, exchange fee 20 bps | | 0 | | 0 | | | | |

Net at $5,000 batches is gross less the coins moved a day × (£3 + network) / $5,000 (USDT 10.6 bps, USDC 8.1 bps). The
18-day window never filled a $5,000 batch, so the replay's own row shows no cost there.

- The hedge's delay (0 / 30 / 90 s) moves nothing: −$0.07, −$0.07, −$0.06 at $805 on USDT.
- Behind the queue ("join"): $0.04–0.12 a day before transfers.

Route B is MMCOMP-2's finding again: a 6–7 bps basis cannot pay a £3 withdrawal below about $10,000 a batch, and it adds an
FX leg whose fee is not public.

### 2.3 Capacity

- The flow is not the limit. USDT-USD takers sold $50,000 a day, $47,000 of it ≥ 5 bps under par; USDC-USD $28,000, $16,000
  ≥ 5 bps. The replay's best row takes $2,300 a day.
- The limits are ours: one order of Q per print, the queue, and the once-a-day hand move. The median real print is $164
  (USDT) and $498 (USDC); 10 % of prints are over $3,500 / $2,400.
- About $3 a day is the ceiling on USDT-USD at Q $250, reached from about $4,000 of capital. More capital adds nothing; a
  larger Q, two hand moves a day, or a taker leg (USDT's ask sat about 13 bps under par in October, so a 9 bps taker keeps about
  4 bps) would add some.
- **The other maker can answer an order a tick in front of it.** Nothing here models that; the "join" rows are what is left
  if it simply outbids us.
- **Orders:** 20–65 a day on average, at most 303 (route A); 285–330, at most 842 (route B, re-pricing to Coinbase). Both fit
  one sub-account's 1,000; route B on both books would need two.

## 3. What would have to be true for this to be worth money

1. Davies' UK app offers the 1:1 USDT↔USD (and USDC) conversion, both ways, without a spread.
2. USDT moves from Revolut X to the app, and dollars back, free and within the day.
3. He is willing to do that move by hand once a day (Revolut X has no withdrawal API).
4. Even then: £0.76 a day on £600 if always first in the queue, £0.25 behind it, against LIVE's £0.9–1.1 (and £2.9 while the
   maker is away) on the same £600. It would be additive only as a separate sub-account with its own capital, and it is a
   USDT-discount trade: when USDT returns to par (it was 0.9997 on Coinbase in late September) the edge goes with it. The
   first half of the window earned a third to a half of the second.

## 4. Variants tried

- Two-sided against bid-only: the asks hardly fill on these books, and two-sided halves the bid's dollars. Bid-only with all
  the capital is best.
- Size Q $100 / $250: $250 helps once the capital exceeds about 2Q × the day's fills.
- Margin m 0 / 2 / 5 bps: almost no effect on USDT (its fills are 13–14 bps from par). On USDC, m 5 halves the fills for
  10.6 bps each.
- An inventory cap is the capital split itself: a side stops when its leg is under Q.
- Only while the maker is there, or only while it is away: there carries all of it.
- USDT against USDC: USDT, three to four times.
- The hedge venue: Coinbase GBP (B), Coinbase USD (closed for UK), Kraken (20 bps), OKX (no USD close).

## 5. Not checked

- Whether the 1:1 conversion is open to Davies' UK account, and what moving between Revolut X and the app costs.
- Revolut's exchange fee on its rate (the fee page puts it in the app only).
- Coinbase's stable-pair taker tier for this account (`takeFee` appears after Sunday 21:00); a UK Coinbase USD wallet.
- Markouts under a minute; the other maker's answer to an order in front of it.
- A taker variant of route A (buy USDT at Revolut X's ask, 9 bps, and convert at par).

## 6. A paper test, only if §3's checks 1 and 2 come back yes (draft, nothing built)

- **Name and engine.** "USD-A-PAR", a keyless paper engine beside the twins: it reads `agent_book_levels` for USDT-USD and
  the public prints (a new `trades/all` read for USDT-USD, one call a minute) and carries out §2.1's "improve, bid only" rule.
  - $100 orders, $805 of dollars.
  - m 2 bps.
  - Coins valued at $1, the dollars restored at 00:00 UTC.
  - Prints under $1 counted apart.
  - The other maker's presence recorded per fill.
- **Arms.** "improve" (judged) and "join" (reported beside it, the floor if the maker outbids us).
- **Window.** 28 days from its first full UTC day.
- **Bar.**
  - The judged arm's mean daily dollars > 0 with a 3-day block bootstrap P(≤ 0) < 0.10.
  - **and** its mean daily dollars per pound ≥ 70 % of `live600`'s over the same days.
  - **and** "join" > 0.
- **Live only on Davies' word**, as a sub-account of his own, after he has done the daily move by hand at least three
  times and its cost is known.

## 7. Sources

- Revolut X Fees (cdn.revolut.com/terms_and_conditions/pdf/revolut_x_fees_e1faa627_1.0.3_1754040368_en.pdf), read 2026-10-31.
- Revolut Personal Fees, All Plans (cdn.revolut.com/terms_and_conditions/pdf/personal_fees_all_plans_current_97857c8a_1.0.0_1776943140_en.pdf).
- Revolut transfer services policy (cdn.revolut.com/terms_and_conditions/pdf/rdael_transfer_services_policy_776de298_1.1.1_1744126240_en.pdf), via search.
- Revolut's 1:1 stablecoin conversion: cointelegraph.com/news/revolut-launches-1-to-1-usd-to-stable-swaps (2025-10-31);
  revolut.com/blog/post/1-1-stablecoin-conversion and revolut.com/crypto/stablecoin-conversion (403 to this session; quoted by search).
- Kraken fee schedule: kraken.com/features/fee-schedule, read 2026-10-31.
- Coinbase: reference §4 item 67 and MMCOMP-2 §4 (stable-pair fees, withdrawals).
- Read-only SQL: `cb_live_state` (takeFee null at 05:02 UTC 2026-10-31).
