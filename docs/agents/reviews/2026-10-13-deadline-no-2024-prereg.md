# DEADLINE-NO: pre-registration of the 2024 test (frozen)

Frozen 2026-10-13, before any 2024 market of this universe was read. Every closed-market pull in the study's scratch
folder covers end dates 2025-01 → 2026-10 (`backtests/pmopps/scripts/pull_closed.py 2025-01 2026-10`), and the PMOPPS
review drew its rule from 2025 and read 2026 once. The hash and time of the commit that freezes this file go in the
report that reads it.

Davies, 2026-10-13, verbatim, on PMOPPS's two leads (`reviews/2026-10-13-polymarket-opportunities.md`):

> 好的 继续深度检验和验证这两个

In English: good, keep testing and verifying these two in depth. This file is the first of them, draft A of that
review, frozen as it stood with the details below added.

## The rule (exactly `theta.py`'s, only the year changes)

The script is `docs/agents/backtests/pmopps/scripts/deadline_no.py`, sha256
`a8d664e4c39e2d5514261f0caa0433bfdf54cc0aeeaae77b1338a982a9312cde`. Its data comes from `pull_closed.py` (sha256
`c5c15301…2fadc`) through `pmnet.py` (`49b832b4…6e02c`).

**Universe.** Every closed Polymarket market with $20,000 of volume or more and a scheduled end date in 2024 (Gamma's
`/markets/keyset`, month by month). It must have:
- a question with "by" or "before" as a word;
- no up/down series;
- no fee type starting `sports` or `crypto`;
- no sports market type and no game start;
- a 0 or 1 payout.

**Every market is read; there is no sample.** In 2024 almost no market carries a fee type, as in 2025 (1,274 of 1,276
deadline markets in 2025-01 → 06), so the fee-type exclusions remove little. That is how 2025 chose the rule.

**Entry.**
- Read the YES token's hourly price from CLOB `/prices-history`, fidelity 60, window T − 15 days to T − 2 days (T is
  Gamma's `endDate`).
- At T − 7 days, take the last point at or before that time, no older than 6 hours.
- When it is in [0.20, 0.50), buy NO at 1 − YES + 1 ¢ (half a spread) + the taker fee: rate × p × (1 − p), p the NO
  price, the rate from the market's own `feeType` as `theta.py` maps it.
- $1 a trade, held to the payout.

**Event.** The market's first Gamma event slug. Markets of one event resolve together.

**Reproduction before the freeze.** With `--sample-half` (theta.py's one-in-two sample and its end-date cut) and
theta.py's cached prices, the script gives theta.py's own lines to the fourth decimal:
- 2025: +0.1435 [+0.0275, +0.2574], 100 trades in 83 events.
- 2026: +0.0713 [−0.0400, +0.1697], 104 trades in 86 events.
- T − 14 days: +0.0154 and +0.1124.

## The bar (every part must hold)

1. At least 150 trades in at least 100 events.
2. The mean return per $1 > 0, and the 5th percentile of the event bootstrap > −0.02. That is 2,000 draws, seed
   20261013, resampling events with their trades, exactly as theta.py's rule lines did.
3. The mean > 0 in each half-year: end dates January–June and July–December.
4. No event over 25 % of the total: an event's summed return over the total summed return, when the total is > 0.

**PASS:** a forward paper-test pre-registration is drafted at $20 a trade, read after 90 trades. It is not frozen and
not built; Davies decides. **FAIL:** DEADLINE-NO is closed.

## Reported with the verdict, not in the bar

- **T − 14 days on the same band.** A sign check: does its mean stay at −0.05 or above?
- **Fills on the public tape.** For each trade, the data API's `/trades` 6 hours either side of the entry: the median
  price takers paid for NO (a NO buy, or 1 − a YES sell) against the 1 − YES the rule assumes, and the shares taken within
  2 ¢ of our price.
  - The CLOB keeps no historical book. These prints are as close to "depth at the ask" as history allows, and say what
    the 1 ¢ half-spread assumption was worth.
- **Today's taker rates.** The result with today's rates by the market's category (crypto 0.07, sports 0.05, politics
  and tech 0.04, geopolitics 0, other 0.05), since 2024's markets paid no fee.

## Reported apart, after the verdict (robustness; it changes nothing above)

- T − 5, 6, 8, 9 and 10 days on the same band.
- The YES bands 0.15–0.20 and 0.50–0.60.
- By category: politics, geo/war, crypto, sports, tech/AI, other.
- Realistic fills (the tape's price and size, and today's fees) on 2024, 2025 and 2026.
- How losses cluster inside one event.

These are read once, with their own number of tries stated, as description, never as a second chance at the bar.

## What it cannot show

- Fills at the real ask when no taker printed nearby.
- A market maker's response to a buyer who is there every week.
- Whether 2024's crowd, before fees and with a different user base, prices time as 2025's and 2026's did.
