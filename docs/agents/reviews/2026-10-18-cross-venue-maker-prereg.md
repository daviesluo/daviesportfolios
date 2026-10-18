# XV-1: a Revolut X maker hedged on Coinbase, read offline (pre-registration DRAFT, 2026-10-18)

**DRAFT, NOT FROZEN.** Nothing here runs, and no date in it binds, until Davies says to freeze it. §4's fees were read for him on
2026-10-18 and are to be confirmed on the first transfer; §4b recommends against freezing it as designed. Written from CBBOOKS-1 (`reviews/2026-10-18-coinbase-books-study.md` §4, rank 2), which
found the idea in sample on 2026-10-10 → 10-18 (not blind; that span is excluded from this window).

## 1. The question

Does a resting Revolut X order priced off Coinbase's touch, hedged at once on Coinbase, make money after both venues' fees AND the
cost of moving the coins it accumulates back, over four weeks it has not seen?

## 2. The rule (as `backtests/cbbooks/scripts/cross.py`, Q4 (ii), with m fixed)

- Inputs: Revolut X's prints and Coinbase's book reads only (no Coinbase prints are needed; `cb_print_minutes`, `0132`, is
  there for the fill checks).
- Books: USDC-GBP and USDT-GBP. At every Revolut X print (`agent_quote_prints`, side = the aggressor's), the standing Coinbase read
  (`cb_book_levels`, the latest row at or before the print, at most 3 minutes old) prices a Revolut X bid at
  floor(Coinbase best bid × (1 − 0.000045 − 0.0010), 0.0001) and an ask at ceil(Coinbase best ask × (1 + 0.000045 + 0.0010), 0.0001).
- A print strictly below the bid (a seller) fills the bid; strictly above the ask (a buyer) fills the ask; for min(£100, 10 % of that
  minute's Revolut X printed pounds); at most once a minute a side.
- The hedge: the coins are sold (bought) on Coinbase at the best bid (ask) of the first Coinbase read after the print, paying 0.0045 %.
- Transfers (proposed cadence, §4b): **every other Monday 00:00 UTC** from 2026-10-19 (10-19, 11-02; the window's last fortnight
  is charged at its end, 11-15) the fortnight's net coins of each book are withdrawn from Revolut X to Coinbase, each withdrawal
  charged £3 plus its network fee (§4); pounds go back from Coinbase daily at no charge. A fortnight with nothing to move costs nothing.
- Revolut X maker fee 0 %; Coinbase taker fee 0.0045 % (its stable-pair schedule, the same at every tier).

## 3. Window and reading

- Window: 2026-10-18 03:00 UTC → 2026-11-15 03:00 UTC (28 days, four weekends).
- Read on 2026-11-15 from 04:00 UTC and **before 2026-11-19 00:00 UTC**: `cb_book_levels` is kept 35 days (`0114`), so the window's
  first day is pruned from about 11-22. Pull with `backtests/cbbooks/sql/pull_books.sql` (two products, as many parts as needed) and
  `sql/pull_revx.sql` with the window's dates; run a copy of `cross.py`'s Q4 (ii) with m = 10 bps and §2's transfers, committed
  before the window ends.
- Void if either recorder misses more than 5 % of the window's minutes.

## 4. Costs (read 2026-10-18 06:22–06:28 BST by Davies' assistant from the venues' help pages and in-app quotes; to be confirmed on the first transfer)

| leg | coin / currency | network | fee | minimum | time to arrive | source |
|---|---|---|---|---|---|---|
| Revolut X withdrawal | USDC | Ethereum (help centre); Polygon (a Revolut spokesperson quoted by CoinDesk, and Polygon's blog; not the help centre); Solana, Base not listed: treated as unsupported | **£3 service fee a withdrawal** + the network fee quoted in the app before submitting (about $0.007 Ethereum, $0.002 Polygon on 10-18) | not read | Polygon seconds; Revolut may hold a withdrawal for a compliance review (length unknown) | Revolut help centre, in-app quote |
| Revolut X withdrawal | USDT | Ethereum, TRON (help centre); Polygon (as above) | £3 + network fee (as above) | not read | as above | as above |
| Coinbase deposit | USDC | multi-chain, Polygon included | free | — | minutes to credit | Coinbase help |
| Coinbase deposit | USDT | **ERC-20 (Ethereum) only**: USDT sent from TRON or Polygon is lost. UK unaffected by the EEA's MiCA delisting | free | — | minutes after Ethereum confirmations | Coinbase help |
| Coinbase withdrawal | GBP, Faster Payments | — | free on Coinbase Exchange's page; retail "may charge, see preview": likely £0 | — | 1–3 working days | Coinbase Exchange, retail help |
| Revolut X deposit | GBP from the Revolut main account | — | free | — | instant | Revolut help |
| Selling coins on Coinbase | USDC-GBP, USDT-GBP | Coinbase Advanced only (never "simple buy/sell" or Convert: a hidden spread plus about 1 %) | taker 0.0045 % (Exchange's stable-pair schedule; the retail tier to confirm after login); USDC-GBP touch about 1.3 bps | — | instant | Coinbase Exchange fees |

**Routes the rule charges:** USDC by Polygon (both venues support it; Ethereum if Polygon proves unsupported, the same £3);
**USDT by Ethereum only** (Coinbase accepts ERC-20 alone). Each withdrawal costs £3.0015 (USDC) and £3.0053 (USDT) at the quoted
network fees. The first real transfer should be a 10 USDC test (native USDC against bridged USDC.e on Polygon is unclear).

### 4b. The cadence (`backtests/cbbooks/scripts/xv1_cadence.py` → `results/xv1_cadence.json`)

On CBBOOKS-1's flows at m = 10 bps (net coins to move a day: USDC-GBP 651 train / 628 test, USDT-GBP 809 / 1,266; about £0.75 a
coin) and gross £1.11 (train) / £1.51 (test) a day for both books. Capital is the coins Coinbase sells from until the next transfer
lands (Revolut X piles up the same number, so the total is constant) plus the pounds Revolut X spends while Coinbase's pounds are 1–3
working days on their way back (taken as five calendar days), each with a day in hand; the Revolut compliance hold is not in it.

| cadence | transfer cost, bps of the flow moved (USDC / USDT; train, test) | passes the 5 bps test | transfers £ a year | net £ a year (train, test) | capital tied up (train, test) | of which coins (a USD position) | net % a year on capital |
|---|---|---|---|---|---|---|---|
| weekly | 8.8 / 7.1; 9.1 / 4.5 | **no** (USDC both halves, USDT train) | 313 | 93, 240 | £15.3k, £19.9k | £8.8k, £11.4k | 0.6, 1.2 |
| **fortnightly** | 4.4 / 3.5; 4.6 / 2.3 | **yes** | 157 | **249, 396** | **£23.0k, £29.8k** | £16.4k, £21.3k | **1.1, 1.3** |
| monthly | 2.1 / 1.7; 2.1 / 1.1 | yes | 73 | 333, 480 | £40.5k, £52.6k | £33.9k, £44.0k | 0.8, 0.9 |

The 5 bps test needs at least 12.3–12.8 days between USDC transfers and 6.3–9.9 days for USDT. If Ethereum's network fee for USDT
rose to $5 a transfer, fortnightly's net would fall to £152 / £299 a year (`net_gbp_a_year_by_eth_fee`).

**What it says.** Fortnightly is the cadence: it passes the 5 bps test on both books in both halves and earns the most per pound of
capital. But **the strategy cannot earn much on its capital whatever the cadence**: it makes about 10 bps on each pound it turns over
and needs about D + 7 days of turnover in hand, so its gross ceiling is about 0.001 × 365 / (D + 7): 2.6 % a year at weekly, 1.8 %
fortnightly. Net, about **1.1–1.3 % a year on £23–30k**, of which **£16–21k is an unhedged dollar position** (USDC and USDT against the
pound): a one-standard-deviation year of GBP/USD (about 7 %) moves it by £1.1–1.5k, three to six times the expected net. PR5's paper rows
make 12–17 % a year on their capital (the 2026-10-18 stablecoin review). A wider margin would raise the ceiling in proportion (20 bps:
about 3.6 % gross fortnightly) on fewer fills; CBBOOKS-1 measured nothing above 10 bps.

**Recommendation (Davies decides): do not freeze XV-1 now.** As designed it fails on capital and on the dollar exposure, not on the
fees: a pass of §5's bars could not make it worth funding. If he wants the out-of-sample read anyway (it is free: no key, no order,
no new call), freeze it with the fortnightly cadence above and add bar 5: **net return on the capital §4b ties up at least 5 % a year
over the window** (in sample it is 1.1–1.3 %, so it is expected to fail). Either way the status stays DRAFT until he says.

## 5. Bars (all must hold)

1. Pounds a day after transfers above 0, with the 90 % lower bound of a 2,000-draw bootstrap of whole UTC days (seed 20261115) above 0,
   both books summed.
2. At least one fill a day on average on each book.
3. No UTC day below −£1.
4. No single day more than 40 % of the window's total.

## 6. What a pass allows, and what it does not

A proposal to Davies, nothing more: a live version would need his Coinbase account and a key he makes himself, a hedging order path
that does not exist, and a decision on how it shares Revolut X's books with PR5's LIVE (it would quote ahead of LIVE's rungs). It is
never run in the loop's Revolut X account or in PR5's sub-account (key `_2`), and nobody trades by hand in either.

## 7. Known limits

The through rule is conservative where our order would have been Revolut X's best price; the hedge assumes the Coinbase touch holds
the size (it held thousands of coins in sample); a fill's own effect on later prints is not modelled; transfer times enter only the capital (§4b); a Revolut compliance hold is not modelled.
