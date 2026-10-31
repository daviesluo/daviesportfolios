# USD-GBP-LOOP: buy the coin under fair on Revolut X's USD book, sell it on its GBP book, change the pounds back in the app (2026-10-31)

Davies, 2026-10-31, proposed a loop in which every leg is a maker and the coins never leave Revolut X:
1. Rest bids under fair on USDT-USD (or USDC-USD), where the UK flow is mostly sellers.
2. Sell those coins with asks at or over fair on USDT-GBP (USDC-GBP), where buyers exist.
3. Move the pounds to the Revolut app, turn them into dollars there, and move the dollars back to refund the bids.

His facts: the plan is **Premium, with no FX allowance limit**; he is **not sure the app's rate is the best**; moving GBP
or USD between Revolut X and the app is **free and instant**; and the app step is by hand. The loop would run in a
sub-account of its own, never LIVE's (`_2`) or the USDC/GBP executor's.

**Research only, not blind.** Every record was read. Nothing in production changed. Public data, public fee pages, and
read-only SQL (LIVE's fill minutes, counted and not committed). No balance appears; every dollar below is a replay's.
Script `backtests/mmcomp/scripts/usd_gbp_loop.py`, results `results/usd_gbp_loop.json` and
`results/usd_gbp_loop_gbp_fills.txt`. Follows `reviews/2026-10-31-usd-books-a-deep.md` (USD-A-DEEP).

## 0. Answers first

**Verdict: not worth it.**
- **It does not lose.** At the rate Revolut says Premium gets on weekdays (no mark-up), it earns, positive on 19–26 of 32
  days.
- **It earns less than putting the same pounds into LIVE.** That would add more, with no hand step and no FX risk.
- **One unknown decides it, and it cuts the wrong way.** The app's real rate against interbank: the loop's whole margin is
  about 8 bps a round trip, so a 5 bps gap halves it and 10 bps removes it.

| | £600 ($805) a day | £1,200 ($1,610) a day | conversions | what it costs LIVE |
|---|---|---|---|---|
| LIVE today, for scale (MAKER-ABSENT replay) | £0.90 / £1.06 (the maker 5 / 12 ticks wide), £2.87 away | £1.52 / £1.86, £5.32 away | none | |
| **adding the same pounds to LIVE** | +£0.62 / +£0.80 a day, +£2.45 away (£600 → £1,200) | | none | none |
| **loop, USDT, forward, first in queue, app at interbank** | **$0.56 (£0.42)**; halves $0.32 / $0.80; P(≤ 0) 0.004 | $0.89 (£0.66); P 0.002 | one by hand every weekday (22 in 32 days, about $750 each) | about 1 in 10 of its pound-book fills fell within a minute of a LIVE sell fill |
| the same, app 5 bps worse than interbank | $0.31; P 0.07 | $0.47; P 0.08 | | |
| the same, 10 bps worse | $0.07; P 0.37 | $0.06; P 0.42 | | |
| the same, 25 bps worse | −$0.64 | −$1.13 | | |
| the same, behind the queue on both books | $0.23 (0 at 10 bps) | $0.22 | | |
| the same, two conversions a weekday | $0.65 | $0.87 | 42 in 32 days | |
| loop, USDT, reverse (bid on the GBP book, ask on the USD book) | $0.50; P 0.000 | $0.76 | 23 | none of its fills are pound-book sells |
| loop, USDC, forward / reverse | $0.28 / $0.38 | $0.39 / $0.54 | 22 / 23 | |

**The £120 tier** (Davies, 2026-10-31; $161, $40 orders): RXU, the USDC/GBP executor, runs at £120. The same replay at
that capital:

| | £120 ($161) a day | conversions | orders a day (max) |
|---|---|---|---|
| RXU's rules on USDC-GBP, the yardstick (MAKER-ABSENT replay) | £0.16 / £0.17 (the maker 5 / 12 ticks wide), £0.52 away | none | |
| LIVE's rules at £120, estimated (LIVE at £600 ÷ 5 ÷ 0.85, reference §3.52's size factor) | about £0.21–0.25, £0.68 away | none | |
| loop, USDT, forward, first in queue, app at interbank | **$0.13 (£0.10)**; halves $0.05 / $0.21; P(≤ 0) 0.002 (1st half 0.14) | 22, the whole $160 each weekday | 86 (353) |
| the same at an app gap of 5 / 10 / 25 bps | $0.08 / $0.03 / −$0.12 | | |
| the same, behind the queue | $0.07 (−$0.01 at 10 bps) | 21 | 143 (505) |
| the same, two conversions a weekday | $0.17 | 42 | 112 |
| loop, USDT, reverse | $0.11; P 0.000 (−$0.00 at 10 bps) | 23 | 58 (258) |
| loop, USDC, forward / reverse | $0.07 / $0.09 | 22 / 23 | 134 / 84 |

At £120 the loop earns about 60 % of what RXU's rules earn on the same pounds, and still needs the weekday conversion.

Notes on the table:
- "Forward" buys on the USD book and sells on the GBP book.
- P is a 3-day block bootstrap P(mean day ≤ 0), 10,000 resamples. Windows: 2026-09-27 → 10-29 (32 days).
- Days are marked to market: the coins at PR5's fairU, and the pounds waiting for the app at the minute's GBP/USD. So
  inventory and FX moves are in the daily figures.

**In five lines.**
1. The loop earns about 8 bps a round trip: 2.3–2.6 bps buying under fair on USDT-USD, plus 5.1–5.6 bps selling over fair
   on USDT-GBP. It needs a hand conversion in the app every weekday.
2. At the interbank rate Revolut says Premium gets, that is $0.13 a day on £120, $0.56 on £600 and $0.89 on £1,200, and it
   is positive in both halves of the window. Behind the queue instead of first in it, it is $0.07, $0.23 and $0.22. At
   £120 that is about 60 % of RXU's £0.16–0.17.
3. A 5 bps gap between the app's rate and interbank halves it, and 10 bps leaves nothing. Nobody has measured the app's
   rate against our recorded GBP/USD, so that is the first thing to check, not to assume.
4. The same £600 added to LIVE earns more (+£0.62 to +£0.80 a day, +£2.45 while the other maker is away), with no hand step
   and no pounds waiting overnight.
5. Its pound-book asks compete with LIVE's own asks for the same buyers. In about 1 in 10 of its fills a LIVE sell filled
   within a minute; quoting at fair it undercuts LIVE's exits by a tick. Not worth a paper test now.

## 1. The app's FX leg (the loop's main cost)

- **Revolut's fee schedule** (primary; "Personal Fees, All Plans", cdn.revolut.com, read 2026-10-31):
  - an exchange is "at the Revolut exchange rate", plus "an exchange fee", plus a fair-usage fee beyond the allowance;
  - **Premium: "No exchange limit", "No fair usage fee"**;
  - "The exchange rate and exchange fee are set out in the App". The page gives no figure for the rate's distance from
    interbank or for the exchange fee.
- **Weekdays.** Third-party pages read 2026-10-31 (poundsterlinglive.com's Revolut page, "indicative") put Premium's
  weekday GBP/USD at 0 bps from interbank.
- **Weekends.** A Revolut press release reported by search (finextra, "Revolut extends fee-free currency exchange to the
  weekend for Premium customers", April 2025) removed the weekend mark-up for Premium, Metal and Ultra. The finextra page
  answered 403 to this session. One 2026 travel guide says the opposite. Not read first-hand.
- **Not measured: the app's rate against our recorded GBP/USD.** The app has no API, and no conversion of Davies' is on
  record. The check is cheap: for a week, at each conversion, Davies notes the app's quoted rate and the minute, and a
  session compares it with `fx_ticks` (the second-level recorder Coinbase's arms use) at that minute.
- **What the replay assumes.** Weekday conversions at our minute GBP/USD × (1 − fx bps) for fx = 0, 5, 10, 25. The
  "daily_incl_weekend" rows convert on weekends too, at the last held rate and no mark-up (Premium).

## 2. The replay (`usd_gbp_loop.py`)

- **Books and prints.**
  - USD books: the recorder's snapshots (`fair_price/data/book_USD*-USD.txt.gz`) and the public prints
    (`data/other_usd_prints.txt.gz`).
  - GBP books: the snapshots and prints REVX-FAIR stored (`fair_price/data/book_USD*-GBP.txt.gz`, `prints.txt.gz`). These
    **include LIVE's own fills**, so a taker the loop fills there may be one LIVE filled.
- **Fair.** PR5's own: fairU on the USD book, fairU / X on the GBP book (X the minute's GBP/USD, held through FX closures as
  LIVE's weekend rule holds it).
- **Orders.** One post-only order a leg ($40 at £120's $161, $100 at £600 and £1,200), live 5 s after each snapshot, either "improve" (a tick inside the touch
  when the spread allows) or "join" (at the touch behind the shown size).
  - Bids never over fair (or fair less 2 bps, "mb2").
  - Asks never under fair rounded up (or two ticks over, "ask_live_exit_plus1", above LIVE's exit at fair + 1 tick).
  - The ask sells only coin held; a bid stops while the coin held is worth the capital.
- **Fills.** USD-A-DEEP's rule: at our price, after the queue's share; partial fills rest. Prints under 1 of the quote
  currency (the 0.10 bot) fill nothing: 2,659–4,571 such prints touched our price in 32 days, which live would be dust for
  the £1 holding line.
- **The app.** At 08:00 UTC each weekday (or twice, daily, weekly), every pound on Revolut X becomes dollars at X × (1 − fx).
  The reverse loop changes dollars into pounds the same way.
- **Equity.** Each UTC midnight: dollars + coins × fairU + pounds × X. A day's P&L is its change.

### 2.1 USDT, forward (buy on USDT-USD, sell on USDT-GBP), daily weekday conversion

| capital | order | app fx | fills a day (bid / ask) | $ through a day | edge vs fair, bps (bid / ask) | $ a day (halves) | days > 0 | worst day | max drawdown | P(≤ 0) all / 1st / 2nd | orders a day |
|---|---|---|---|---|---|---|---|---|---|---|---|
| $805 | improve | 0 | 8.0 / 8.9 | 506 | 2.6 / 5.6 | **0.56** (0.32, 0.80) | 19 | −1.45 | −1.64 | 0.004 / 0.056 / 0.016 | 138 |
| $805 | improve | 5 | | | | 0.31 | 18 | −1.83 | −2.91 | 0.072 | |
| $805 | improve | 10 | | | | 0.07 | 18 | −2.21 | −4.32 | 0.373 | |
| $805 | improve | 25 | | | | −0.64 | 14 | | −20.35 | 0.999 | |
| $805 | join | 0 / 10 | 2.7 / 3.2 | | 2.4 / 5.3 | 0.23 / 0.00 | 23 / 22 | | | 0.003 / 0.47 | 184 |
| $805 | improve, ask over LIVE's exit | 0 | 8.0 / 8.4 | | 2.6 / 7.2 | 0.60 | 19 | −1.45 | −1.50 | 0.002 | 166 |
| $805 | improve, bid 2 bps under fair | 0 | 5.6 / 6.6 | | 3.8 / 5.1 | 0.33 | 19 | | | 0.050 | |
| $805 | improve, twice a weekday | 0 | 11.0 / 12.6 | | 2.1 / 5.7 | 0.65 | 23 | −1.23 | | 0.000 | 171 |
| $805 | improve, every day incl. weekends | 0 | 10.9 / 12.1 | | 2.3 / 5.2 | 0.67 | 22 | | | 0.001 | |
| $805 | improve, weekly | 0 | 2.0 / 2.0 | | | 0.23 | 16 | −3.86 | | 0.166 | 36 |
| $1,610 | improve | 0 / 5 / 10 | 13.1 / 14.4 | 841 | 2.3 / 5.6 | **0.89** / 0.47 / 0.06 | 22 | −2.89 | −2.89 | 0.002 / 0.075 / 0.415 | 188 |
| $1,610 | join | 0 | 2.8 / 3.3 | | | 0.22 | 23 | | | 0.004 | |

- **Where the money comes from.** The bid buys a median 2.3–2.6 bps under fairU. The USD book's sellers sit only a few bps
  under its own fair; the 14–18 bps "under par" of USD-A-DEEP is USDT's discount to $1, which fairU already includes. The
  pound-book ask sells 5.1–5.6 bps over fairU / X. The whole margin is about 8 bps of the dollars that go round, and the app
  takes its fx bps of the same dollars.
- **Conversions.** One every weekday: 22 in 32 days, a median of about $160 at $161 (the whole capital), $750 at $805 and
  $1,380 at $1,610. Weekly
  conversions starve the bids: $0.23 a day, and the worst day is −$3.86 because the pounds wait a week against GBP/USD.
- **Inventory.** At most the capital is held as coin ($790 at $805), marked at fairU. The pounds waiting for the app peaked
  at $802. The worst days (−$1.45 to −$2.89) are the pounds' and the coin's moves on a busy day, not a loss of edge. The
  best day was +$3.19 at $805.
- **Orders:** 138–188 a day on average. Each re-price of either leg is an order, inside one sub-account's 1,000.

### 2.2 The reverse loop and USDC

| loop | capital | fills a day (bid / ask) | edge vs fair, bps (bid / ask) | $ a day at fx 0 / 5 / 10 | P(≤ 0) at fx 0 | conversions |
|---|---|---|---|---|---|---|
| USDT reverse (buy on USDT-GBP, sell on USDT-USD) | $805 | 8.1 / 9.4 | 8.0 / 1.1 | 0.50 / 0.23 / −0.02 | 0.000 | 23 |
| USDT reverse | $1,610 | 13.0 / 14.5 | 8.4 / 1.6 | 0.76 / 0.33 / −0.11 | 0.004 | 23 |
| USDT reverse, twice a weekday | $805 / $1,610 | | | 0.75 / 1.01 (fx 0) | 0.000 / 0.002 | 44 |
| USDC forward | $805 / $1,610 | 6.6 / 8.4 | 2.2 / 3.1 | 0.28 / 0.05 / −0.17 (at $805) | 0.086 | 22 |
| USDC reverse | $805 / $1,610 | 6.6 / 7.7 | 6.5 / 0.8 | 0.38 / 0.14 / −0.11 (at $805) | 0.008 | 23 |

- The reverse loop buys on the pound book. That is where LIVE's bids rest, so it competes with LIVE's entries instead of
  its exits. It earns about the same as forward, and dies at the same 10 bps.
- USDC earns half to two-thirds of USDT.
- Not tried: running forward and reverse at once on one account. Their conversions would net against each other, but it is
  then LIVE's own two-book quoting with an FX leg added.

## 3. Against LIVE

- **Competition for the same buyers.** LIVE sold on USDT-GBP 291 times in the window (106 of them exits, LIVE's live order
  record, read-only). The forward loop's 286 pound-book fills fell in 258 minutes; in **26 of them (10 %) LIVE sold within a
  minute**, 9 of them an exit.
  - Quoting at fair rounded up, the loop rests a tick under LIVE's exits (fair + 1 tick), so it would take those buyers
    first.
  - Quoting two ticks over fair, it stays behind LIVE's exits, earns about the same ($0.60), but still sits in front of
    LIVE's 0.1 % asks (fair + about 7 ticks).
  - The replay cannot say how much of LIVE's money the loop would take, since both answer the same takers. Either way the
    loop's pound-book side adds no new buyers to the account's total.
- **Same capital.** £600 more in LIVE (£600 → £1,200, MAKER-ABSENT's replay) adds £0.62–0.80 a day with the other maker
  there and £2.45 while it is away. The loop on that £600 earns £0.42 at best (fx 0), £0.23 at 5 bps, about 0 at 10 bps. It
  needs a hand conversion every weekday, and it leaves pounds waiting overnight against GBP/USD.

## 4. Verdict, and what would change it

**Not worth it, and no paper test proposed.** It would be worth revisiting only if all three held:
1. Davies' conversions over a week land within about 2 bps of our recorded GBP/USD (`fx_ticks`) at the same minute.
2. LIVE has no more capital to take: LIVE's own next step, `live1200`, is still under test.
3. The loop's pound-book asks are set two ticks over fair, so they never sit in front of LIVE's exits.

If that happens, the paper draft is short:
- **Engine.** `usd_gbp_loop.py`'s forward rule on USDT, on the recorded books and prints: $805, $100 orders, improve, asks
  at fair + 2 ticks, a 08:00 UTC weekday conversion at `fx_ticks` less the measured gap.
- **Bar.** 28 days; mean daily dollars > 0 with P(≤ 0) < 0.10, **and** above what `live1200` adds over `live600` per pound
  over the same days.
- **The routine Davies would do, once each weekday at about 08:00 UK:**
  1. Revolut X: withdraw all GBP to the Revolut account (free, instant).
  2. App: exchange GBP → USD, and note the rate and the minute.
  3. App: send the USD to Revolut X (free, instant).
  The loop's account, its own sub-account, is never traded by hand otherwise.

## 5. Not checked

- The app's actual GBP/USD against interbank: no conversion is on record.
- The weekend mark-up for Premium, first-hand.
- Fills under a minute's resolution on the books (the snapshots are once a minute).
- LIVE's loss from the competition, which the prints cannot separate.
- Forward and reverse together.

## 6. Sources

- Revolut Personal Fees, All Plans (cdn.revolut.com/terms_and_conditions/pdf/personal_fees_all_plans_current_97857c8a_1.0.0_1776943140_en.pdf), read 2026-10-31.
- poundsterlinglive.com/best-exchange-rates/providers/revolut (indicative plan table, read 2026-10-31).
- Revolut weekend fee removal for Premium (finextra.com/pressarticle/105319, 403 here; reported by search).
- Read-only SQL on `agent_quote_live_orders` (LIVE's USDT-GBP sell fills 09-27 → 10-29, counted by minute; nothing committed).
- `results/absent.json` (MAKER-ABSENT) for LIVE at £600 and £1,200.
