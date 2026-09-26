# Pre-registration fp6-H6 LIST-S: short Binance's new crypto perpetuals for their first thirty days

Written 2026-09-26 (UTC), before any return, funding payment or P&L of this rule was computed on any event. Frozen by
the commit that puts this file on `main`; nothing below may change after it, and any deviation is reported as a
deviation. It is hypothesis H6 of fp6's family of five (`2026-09-26-fp6-prereg-family.md`), Holm-corrected across the
five.

**Access comes first**: a short perpetual is a derivative; the sources and what they allow are in the family file.

## Why

fp3 measured that Binance's new spot listings fall: from the first day's close, a median −4.8 % after one day, −15.0 %
after seven and −28.2 % after thirty, with 25 % positive (277 USDT listings, 2022-01 → 2026-08; `m_listing_drift.json`),
and closed the idea because a spot account cannot short (B5). Binance lists a USDⓈ-M perpetual for most new coins,
often before or with the spot pair, so the trade B5 could not make is one order here. Who is wrong: early buyers of a
new token pay for attention and airdrop supply that later sellers deliver. What could make it fail: the crowd already
knows, so new perpetuals' shorts pay heavy funding (up to 2 % a settlement, hourly when capped), and a new token can
squeeze shorts by multiples in a day.

## What was seen before the freeze (disclosed)

* fp3's B5 figures above (spot, from the first day's close; not the perpetuals, not funding), and DL (H5's cousin).
* In this session, counts only (`measurements.json` → `h6`): the events by year and half, how many had thirty days of
  bars, how many stopped trading sooner, the most open at once, and the median daily volatility of established crypto
  perpetuals over the window (no rule). No return, funding or P&L of any event, or of any donor, was computed.

## Data (`docs/agents/backtests/fp6/`, keyless, hashes in `manifest.json`)

`inputs/perp_1d.json.gz` (every USDⓈ-M perpetual's daily klines in the archive, delisted ones included; archive zips
checked against their published sha256; September 2026 by REST), `inputs/funding.json.gz` (their settlements),
`inputs/exchangeinfo_2026-09-26.json.gz` (contract types), `inputs/books.json.gz` (half-spreads).

## The rule (`rules.py` `listing_events`, frozen with this file)

* **Events**: every USDT perpetual whose first daily bar is in [2023-01-01, 2026-08-25), crypto (`rules.py`
  `crypto_contracts`: not a TradFi or index contract in the 2026-09-26 exchangeInfo), base not a stablecoin or index.
  The listing day L is its first bar's day.
* **Entry**: short $100 of the perpetual at the open of L + 1 (the listing day's close), 1× (the $100 is its margin).
* **Exit**: the open of L + 31 (thirty days), or the close of the perpetual's last daily bar if it stops trading
  sooner, or the **stop**: the first day whose high reaches 1.5 × the entry price closes the short at max(1.5 × entry,
  that day's open).
* **Costs**: 0.05 % taker a fill (USDⓈ-M regular tier) plus a half-spread of 3.56 bp, the 90th percentile (sorted
  value at ⌊0.9 (n − 1)⌋) of the 525 crypto USDT perpetuals trading on 2026-09-26, each the median of its twenty
  samples — for every event and every donor alike, since a contract's book in its first month is thinner than its book
  today.
* **Funding**: every settlement with bucket in (entry, exit] pays or receives q × the perpetual's open that day × the
  rate (a short receives positive funding, pays negative).
* **Capital**: $100 an event; the capital the rule ties up is the most events open at once × $100
  (`peakConcurrentEvents`), and the rule's P&L is annualised on it.

## The null (for condition 2)

For each event, a donor: a crypto USDT perpetual that had traded at least 180 days by L + 1 and has bars on the event's
entry and exit days, drawn uniformly with replacement; shorted over exactly the event's dates with the same costs,
funding and stop. 2,000 draws, seed `fp6-listing-short`. The statistic is the summed P&L over events;
p = (1 + #{null sum ≥ rule sum}) / 2,001. It asks whether new perpetuals fall more than established ones did over the
same days — a bear year makes every short pay, and the null carries that.

## The bar (a PASS needs every condition)

1. The summed P&L over all events is positive.
2. p clears its Holm step among the five (the smallest p at 0.05 / 5).
3. Each half (by entry day, split at 2024-11-13) is positive.
4. Positive with every fee and half-spread doubled.
5. The best calendar month (by entry) holds at most 40 % of the P&L, and the rest is positive.
6. Worth money: the P&L annualised on the peak capital (peak concurrent events × $100) over 2023-01-01 → 2026-09-25 is
   at least 8 %.
7. At least 100 events.

## Descriptive

The funding paid and received, the stops, each year, the events that stopped trading early, 7- and 14-day holds.

## Power check (`measurements.json` → `h6`)

* **Events**: 515 (2023 97, 2024 131, 2025 240, 2026 to 08-24 47 — most 2026 listings are TradFi contracts and are
  left out); 190 in the first half and 325 in the second. All 515 have thirty days of bars; none stopped trading
  within thirty days. At most 34 are open at once, so the rule ties up $3,400.
* **Volatility** (no rule): established crypto perpetuals moved a median 5.97 % a day over the window (608 contracts),
  about 33 % over a thirty-day hold.
* **The smallest effect the null test can see**: the null sum's standard deviation is about $100 × 0.327 × √515 ≈ $742,
  so at 80 % power and 0.05 / 5 one-sided the test sees events that beat established perpetuals over the same days by
  about $2,350 in all — about 4.6 % of each $100 short. fp3's spot figure for new listings (−28 % median at thirty days)
  is six times that, before funding and before the null's own drift.
* **Worth money** (condition 6): 8 % a year on $3,400 over 3.73 years is $1,016 — about $2 an event.
* So the test can see an effect the size B5 measured on spot, and much smaller; a failure would mean funding, squeezes
  or the established perpetuals' own fall took most of it.

## Determinism, and what it cannot show

`score_events.py` reads only `inputs/`, recomputes the event list and counts and stops on a difference, checks this
file's and `rules.py`'s sha256, writes `listing_short.json` byte-identically twice. It cannot show access; intraday
squeezes and liquidation before the daily high reads them (1× is liquidated only near +100 %, the stop fires at +50 %);
a new perpetual's own launch caps (lower leverage, Last Price Protection); or whether Binance would accept a new short
on every day (position limits on new contracts).
