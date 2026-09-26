# Pre-registration fp6-H5 DELIST-S: short the perpetual of a coin Binance has just said it will delist

Written 2026-09-26 (UTC), before any return, funding payment or P&L of this rule was computed on any event. Frozen by
the commit that puts this file on `main`; nothing below may change after it, and any deviation is reported as a
deviation. It is hypothesis H5 of fp6's family of five (`2026-09-26-fp6-prereg-family.md`), Holm-corrected across the
five.

**Access comes first**: a short perpetual is a derivative; the sources and what they allow are in the family file.

## Why

fp3's DL bought a coin an hour after "Binance Will Delist …" and sold a day before its spot trading stopped: −$2,689.89
over 111 out-of-sample events of $100 (2023-01 → 2026-09), a median event −31 %, 10 of 111 positive, far below its
null (reference §3.29). Forced holders do not overshoot; the fall continues. A spot account could only lose on it. A
short perpetual is the other side of the same event. Who is wrong: holders who must leave a venue that will stop
trading their coin, and the market makers who withdraw. What could make it fail: the crowd already shorts these
contracts, so funding runs negative (the shorts pay, up to 2 % a settlement, hourly once capped); Binance may delist
the perpetual too (none of the 67 here stopped trading before its planned exit, on daily bars); and a delisted coin can
squeeze its shorts (ALPACA rose 852 % in DL's sample).

## What was seen before the freeze (disclosed)

* DL's result above, by event (fp3's `backtests/fp3/`), which covers the spot price leg of these events: **this test
  is not blind on the price leg.** What it adds is whether a perpetual existed to short, the perpetual's own price,
  what the short paid in funding, the squeeze stop, and a null of shorts on other coins on the same dates.
* In this session, counts only (`measurements.json` → `h5`): the tokens named in delisting announcements 2023-01 →
  2026-09, which had a live USDⓈ-M perpetual at the announcement, by year and half, and how many perpetuals stopped
  trading before the spot exit. No return, funding or P&L of any event or donor was computed.

## Data (`docs/agents/backtests/fp6/`, keyless, hashes in `manifest.json`)

`inputs/announcements.json.gz` (Binance's public CMS: every announcement in the Delisting catalogue, with its text),
`inputs/perp_1d.json.gz` (the daily klines of every perpetual, the events' and the donors'; archive zips checked
against their published sha256), `inputs/funding.json.gz`, `inputs/exchangeinfo_2026-09-26.json.gz`,
`inputs/books.json.gz`. The test runs on daily bars, events and donors alike.

## The rule (`rules.py` `delist_events`, `perp_for_token`, frozen with this file)

* **Events**: each token in the title of a "Binance Will Delist <tokens> on <date>" announcement published from
  2023-01-01 to 2026-09-24, with the spot cessation time its text states, whose USDⓈ-M USDT perpetual (XUSDT, else
  1000X / 1000000X / 1MX / 10000X) has daily bars on the announcement day and the next.
* **Entry**: short $100 of the perpetual at the open of the first UTC day after the announcement's publication day,
  1× (the $100 is its margin). DL entered an hour after the announcement; a daily loop enters 1–24 hours later and
  misses the first reaction, which is the conservative side.
* **Exit**: the open of the UTC day that contains (the spot cessation time − 24 hours), or of entry + 30 days if
  earlier; if the perpetual has no bar that day, the close of its last daily bar (Binance settles a delisted perpetual;
  its last price stands in for the settlement). **Stop**: the first day whose high reaches 1.5 × the entry price closes
  the short at max(1.5 × entry, that day's open).
* **Costs**: 0.05 % taker a fill plus a half-spread of 3.56 bp, the 90th percentile (sorted value at ⌊0.9 (n − 1)⌋)
  of the 525 crypto USDT perpetuals trading on 2026-09-26, each the median of its twenty samples (these contracts are
  gone and were thin), for events and donors alike.
* **Funding**: every settlement with bucket in (entry, exit] pays or receives q × that day's open × the rate.
* **Capital**: $100 an event; the peak number open at once × $100 is the capital the rule ties up.

## The null (for condition 2)

For each event a donor: a crypto USDT perpetual that had traded at least 180 days by the entry, has daily bars on the
entry and exit days, and was not named in a delisting announcement within 60 days either side; drawn uniformly with
replacement; shorted over exactly the event's days with the same costs, funding and stop. 2,000 draws, seed
`fp6-delist-short`. p = (1 + #{null sum ≥ rule sum}) / 2,001.

## The bar (a PASS needs every condition)

1. The summed P&L over all events is positive.
2. p clears its Holm step among the five.
3. Each half (by announcement, split at 2024-11-13) is positive.
4. Positive with every fee and half-spread doubled.
5. The best calendar month (by announcement) holds at most 40 % of the P&L, and the rest is positive.
6. Worth money: the P&L annualised on the peak capital over 2023-01-01 → 2026-09-25 is at least 8 %.
7. At least 30 events.

## Power check (`measurements.json` → `h5`)

* **Events**: 122 tokens named in 31 announcements (2023-01-19 → 2026-09-10); 67 had a live perpetual at entry
  (2023 3, 2024 12, 2025 17, 2026 35). The halves hold 12 and 55, so condition 3's first half rests on 12 events. The
  planned holds are 5–12 days (median 12); none of the 67 perpetuals stopped trading before its planned exit; at most 8
  are open at once, so the rule ties up $800.
* **Volatility** (no rule): established crypto perpetuals moved a median 5.97 % a day over the window, about 21 % over
  a 12-day hold.
* **The smallest effect the null test can see**: the null sum's standard deviation is about $100 × 0.207 × √67 ≈ $169,
  so at 80 % power and 0.05 / 5 one-sided the test sees events that beat established perpetuals by about $536 in all —
  about 8 % of each $100 short. DL's median event on spot was −31 %.
* **Worth money** (condition 6): 8 % a year on $800 over 3.73 years is $239 — about $3.60 an event.
* So the test can see an effect the size DL measured, if funding leaves most of it; its weak point is the first half's
  12 events and the concentration in 2026 (35 of 67).

## Determinism, and what it cannot show

`score_events.py` reads only `inputs/`, recomputes the event list and counts and stops on a difference, checks this
file's and `rules.py`'s sha256, writes `delist_short.json` byte-identically twice. It cannot show access; whether
Binance lowered these contracts' leverage or position limits after the announcement (it reserves the right to); a
settlement price that differs from the last hourly close; or a squeeze inside an hour.
