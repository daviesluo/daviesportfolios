# Pre-registration: "Crypto quotes XRP/GBP" (paper)

**Status: FROZEN** at the commit that adds this file, with the files of §10 at the sha256 it names. A change to any of them is a
deviation, recorded in §11 with its reason and the files' new sha256, before it is deployed.

On whose word. Davies, 2026-10-31 ~11:55 UTC: "好 再研究下确保策略一切最优后就开做然后上testing" (one more pass to make sure the strategy is
the best it can be, then build it and put it on TESTING). It replaces the draft in `2026-10-31-xrp-gbp-strategy.md` §8 (the
differences are in §12).

The studies: `2026-10-31-crypto-books-deep.md` (CRYPTOBOOKS), `2026-10-31-xrp-gbp-strategy.md` (CRYPTOBOOKS-2), and this file's §1
(CRYPTOBOOKS-3: `backtests/cryptobooks/scripts/final_opt.py`, `final_card.py`). The design is
`2026-10-31-one-second-loop-architecture.md` §4.4: paper is one call a minute that replays the closed minute second by second.

Nothing here is live. The paper arm holds no key and places, cancels or changes no order.

## 0. Answers first

- **The card stays as CRYPTOBOOKS-2 left it.** One more pass tested size, a two-sided inventory, the basis window, the skew,
  re-pricing, the stop and its cool-down, the regime as a size modifier, and SOL-GBP as a second book. No change beat the card on
  the 15 days and on the year's sample together (§1).
- **One change is to the fill model, not the rule, and it is the conservative one.** A quote is filled only from the second after
  it was placed (`rest_lag` 1). Before, the prints of the second it was placed in could fill it. That costs about 10 % on the 15
  days and about 40 % on the year's sample.
- **Expected at £600, under that fill model:**
  - about **£1.07 a day** on the year's sample (each 13:30–16:00 window × 10.6; P(mean ≤ 0) 0.124 over the windows);
  - £6.98 a day on the 15 days of full tape (10-17 → 10-31), which were the unusual ones.
  - £120: £0.24 a day (£1.67 on the 15 days). £1,200: £2.12 a day (£12.32).
- **The bar's power is modest.** If the year's sample is what the next 28 days look like, a 28-day test passes about 37 % of the
  time (a rough estimate, `final_card.py`). If the last two weeks' regime holds, it passes almost surely. A FAIL therefore says
  "not shown", not "no edge".
- **Its start: 2026-11-01 00:00 UTC**, if its recorder's first minute is by 2026-10-31 21:00 UTC. Otherwise it is the first 00:00 UTC
  with three hours of record before it (`mmStartFor`), which the arm's state keeps (`startAt`) and the page shows.

## 1. The last optimisation pass (CRYPTOBOOKS-3)

**Method.** `final_opt.py` changes one thing on the card at a time. `final_card.py` then reads each near-tie against the frozen
card (FINAL), paired. Each is read three ways:

- the 15 days of full tape, split into in-sample (10-17 → 10-23) and out-of-sample (10-24 → 10-30), with P(mean ≤ 0) from a circular
  3-day block bootstrap of days;
- the year's 363 sampled 13:30–16:00 windows (`hist_replay.py`'s), with P from 5-window blocks;
- for a near-tie, the paired gain against FINAL, day by day and window by window, with P(gain ≤ 0) from the same bootstraps.

A change is taken only if it wins on both samples, its neighbours do too (the plateau), and its paired P is under 0.10 on both.
Results are in `results/final_opt.json` and `results/final_card.json`. Figures are £ a day at £600 on the 15 days (in / out),
then £ a 2.5-hour window on the year, with its P.

| question | tried | best of them | the card | taken? |
|---|---|---|---|---|
| size against capital | Q £100–£600 | £250: 8.42 (2.12 / 14.56); year 0.192, P 0.050 | £200: 7.77 (3.26 / 12.19); year 0.173, P 0.042 | no: in-sample worse, year within noise (paired P 0.35); £300+ raises P |
| two-sided around an inventory | 10 %, 25 %, 50 % held | 25 %: 8.12; year 0.215, P 0.086 | 7.77; 0.173, P 0.042 | no: in-sample worse (2.24), P doubles (price risk); paired P 0.40 |
| basis window | 1, 2, 3, 6, 12 h | 2 h: 7.39 (3.48 / 11.16) | 3 h: 7.77 | no: 6 h and 12 h break in-sample (1.16, −0.90) |
| skew κ | 0, 0.25, 0.5, 0.75, 1 | 0.25: 8.33 (4.02 / 12.61); year 0.192, P 0.056 | 0.5 | no: paired P 0.07 on the 15 days, 0.46 on the year |
| re-price on a move θ | 3, 4, 5, 6, 8 bps | 5 | 5 | kept: 3 and 8 fall on the year (0.121, 0.050) |
| re-price on a clock | every 5, 10, 30 s | none positive on the year (−0.19 to −1.80) | — | no |
| stop and cool-down | 100–500 bps × 10 min, 1 h, 4 h | 300 bps; the cool-down barely matters (year 0.170–0.175) | no stop | 300 bps / 1 h kept as insurance: never triggers on the 15 days, costs 0.003 a window |
| regime as a size modifier | × 0.5, 0.75, 1.5 while the fast layer is there (4 or 8 bps) | × 0.75 at 8 bps: 7.52; year 0.148 | 7.77; 0.173 | no: every one is worse on the year |
| SOL-GBP as a second book | £300 XRP + £300 SOL | 5.02 (1.61 / 7.75); year 0.113, P 0.073 | XRP £600 | no: SOL dilutes (SOL alone: year P 0.35) |

**Under the paper's fill timing (`rest_lag` 1), the d × θ plateau again** (paired against FINAL; £ a day on the 15 days, £ a window
on the year): d 12 (6.90; 0.060), d 13 (6.17; 0.109), d 15 (7.44; 0.052), d 16 (6.46; 0.074); θ 6 (6.38; 0.116), θ 8 (6.58; 0.045),
θ 10 (6.50; 0.046); d 12/16 with θ 8 or 10 all lower. FINAL (d 14, θ 5): 6.98; 0.101. The card's cell is still the best of its
neighbourhood on the year.

## 2. The rule (frozen)

`mm_core.ts`, a port of `rule.py`'s `sim` at `xrp_study.CARD` with `final_card.FINAL`. `mm_core.test.ts` pins it fill for fill on a
committed slice (`results/parity_XRP-GBP.json`: 2026-10-29 19:30 → 02:05 UTC, 142 fills under the card and 101 with a 30 bps stop,
6 of them stops). Per second s:

1. **The basis.** For each Revolut X UK print of second s, in the tape's order, take its deviation 1e4·ln(price / F(s − 1)).
   Before every tenth print, the centre of the trailing **3 hours**' deviations ((median of the buys' + median of the sells') / 2,
   at least five of each) becomes the basis, if it differs from the last. Quoting starts the second after the first centre.
2. **The fair.** F(s) = Binance's last XRPUSDT trade of second s × USDT/USD ÷ GBP/USD, with the rates of s's minute.
   - The fair it knows is F(s − 1)·e^(basis/1e4). The true fair, used by the arbitrageur and the stop, is F(s)·e^(basis/1e4).
   - A second with either missing is **stale**: nothing rests.
3. **The stop.** If the coin held is marked **300 bps** under its average cost, it is all sold as a taker at the true fair less 9
   bps (the taker fee) less 20 bps. Nothing is bid for **3,600 s**.
4. **Re-pricing.** It re-prices after a fill, when the fair it knows has moved more than **5 bps** from the price the quotes were
   set at, or when nothing rests.
   - Bid = ref·(1 − d − k), ask = ref·(1 + d − k), with **d = 14 bps** and k = **0.5**·d·(coin value ÷ capital).
   - The bid is £Q (or the pounds left), placed while pounds are left and the coin is worth less than the capital.
   - The ask sells only coin held, £Q of it at most. The arm starts in pounds.
   - A side whose price changed, or that a fill left short, is a cancel and a placement.
5. **Fills** (§3).
6. **The arbitrageur.** Any quote more than **10 bps** beyond the true fair is taken whole, at once, at our price.

The arms differ only in money: **£600 at Q £200 (judged, and the one on the page)**, £120 at £40, and £1,200 at £400.

## 3. The paper fill model (conservative)

- Only the public taker orders fill us: the prints of one ms and side, each order's prints in the order the book filled them.
- **Only prints strictly through our price** fill us:
  - a buy fills our ask by the part of it priced above the ask (all of it when the ask was below its first price);
  - a sell fills our bid the same way round.
- **The queue ahead is the tape's own.** A print at exactly our price came from a maker already resting there, so it never fills us.
- **Size is limited by the print.** We never get more than the order's size, nor more than is left of our quote, and always at our
  price.
- **Not in the second it was placed.** A quote is filled only from the second after it was placed or re-priced (`restLagS` 1).
- **The arbitrageur is pessimistic.** It takes every quote 10 bps beyond the true fair at once, a loss the venue may not inflict.
- **No market impact or reaction.** Our quotes change nothing on the tape: no one reacts to them, and no print is moved by them.
  §3 of CRYPTOBOOKS-2 bounds what a reacting competitor costs (react 30 s: −7 %).

## 4. Inputs and how it runs

One call a minute, `agents?action=mm` (migration 0192): a row of `edge_calls` at second **12** of its minute, `retry` true, under the
watchdog, its beat first, waiting the 15 minutes `active_from` gives every new row. Each call does two things.

**1. It records, keyless.**

- Binance's one-second XRPUSDT klines for every minute closed since its cursor (`data-api.binance.vision`, the host `binance.ts`
  already reads).
- Revolut X's UK XRP-GBP prints from two minutes before what it last covered, each kept once by its id.
- Revolut X's XRP-GBP book, five levels a side, recorded and not used by the rule.
- Coinbase's USDT-USD price.

**2. It decides.** For each arm, it steps every second of the minutes from its last up to **two minutes behind the clock**. It goes
no further than Binance's seconds and Revolut X's prints are recorded.

- USDT/USD is the newest Coinbase read made by the minute's start, at most 30 minutes old.
- GBP/USD is the FX recorder's newest TrueFX read (or marked Kraken read) that arrived by the minute's start, at most 10 minutes
  old (`fx_ticks`, 0172).

**The start.** The arm records from its first minute (the basis warms on the prints). It quotes from `startAt`, the first 00:00 UTC
at or after 2026-11-01 with three hours of record before it.

**Tables.** It writes its own tables (`agent_mm_*`): each arm's minutes, fills and round trips, with each sale against the oldest
coin. Each day's P&L is marked at the fair (`agent_mm_days.pnl_gbp`).

## 5. The window

The **28 UTC days** from the £600 arm's `startAt`.

## 6. Void

The test is **VOID** in either of these cases:

- the arm had no fair for more than 10 % of the window's seconds (Binance, USDT/USD or GBP/USD missing);
- Revolut X printed nothing for 24 hours running (a halt, or the recorder down).

The window then restarts at the first 00:00 UTC after the cause is fixed, recorded in §11.

## 7. The bar (£600 arm, each day marked at the fair)

**PASS** when all four hold. Otherwise **FAIL**.

1. The 28 days' sum is **above 0**.
2. **P(mean ≤ 0) < 0.10**, from a circular block bootstrap of the 28 days: 3-day blocks, 10,000 resamples,
   `random.Random(20261031)` (`rule.boot`).
3. **The decay stop's test.** The P&L of the window's tight hours is **0 or more**. An hour is tight when the book's pair spread is
   under 16 bps (`regimes_hist.WIDE`); an hour with too few pairs to measure counts as tight. With fewer than 100 tight hours this
   condition counts as passed, and the reading says so.
4. **At least 100 fills.**

The decay stop also carries to any live version: 30 days with the tight hours' P&L ≤ 0 end it (CRYPTOBOOKS-2 §2).

## 8. Reported, not judged

- The £120 and £1,200 arms' sums, P and fills.
- The wide hours' P&L.
- Placements a day.
- Stale seconds.
- The arbitrageur's and the stop's fills.

The draft's markouts and the peak placements a second are not in the reading. Each fill keeps its true fair (`agent_mm_fills.fair`)
and each minute its placements, so they can be read later, apart from the verdict.

## 9. The reading

`scripts/paper_reading.py <export.json>`, run on one export made after the window's last day, with SELECT only:

```sql
-- a day of each arm
select arm, day, orders, fills, stale_s, pnl_gbp, trips, won, realised_gbp from agent_mm_days order by arm, day;
-- each arm's start
select arm, state->>'startAt' as start_ms from agent_mm_state where arm in ('p600', 'p120', 'p1200');
-- the £600 arm's equity at each hour's last minute
select date_trunc('hour', minute) as hour, (array_agg(equity order by minute desc))[1] as equity
  from agent_mm_minutes where arm = 'p600' group by 1 order by 1;
-- each fill's kind
select arm, ts, kind from agent_mm_fills order by arm, ts, seq;
-- the prints, for the pair spread
select (extract(epoch from ts) * 1000)::bigint as ms, price, qty, side from agent_mm_prints where book = 'XRP-GBP' order by ts, id;
```

These are shaped as the script's `read()` names: `{"arms": {arm: {"start", "days", "hours", "fills"}}, "prints"}`. The script
writes its verdict beside the export. The reading says the test was not blind: every record may be read at any time (Davies,
2026-10-04).

## 10. Frozen files

| file | sha256 |
|---|---|
| `supabase/functions/agents/mm_core.ts` | b87ca91c974676f64305425c92c88e94f99ba602099c02b4dfa159c2a019a9e5 |
| `supabase/functions/agents/mm_core.test.ts` | 508d6ce575c2b23cbc0567acac014e9639a8b3d4a222e0cc1e325dfb8363b515 |
| `supabase/functions/agents/mm_paper.ts` | 93b42cccdf65ee05112159fcd5b4e6174630814f76d657b5c27aaeed4d267f34 |
| `supabase/migrations/0192_mm_xrp_paper.sql` | 6821c4995ab59186e6330b64b0f6d4c3b4c6d633f110431beaeb853f857d7cf2 |
| `docs/agents/backtests/cryptobooks/scripts/rule.py` | db4f871ce80d9430ef148434d90ef6a9799e40927dbb2d66fd5aea3b87c2a4e9 |
| `docs/agents/backtests/cryptobooks/scripts/xrp_study.py` | b1895ff526ec6417be64054005818da39be1fc8e48112725b969ac55681cc2fa |
| `docs/agents/backtests/cryptobooks/scripts/final_card.py` | 9841fae205bebe8772f724d5185195ec597f3c07cca96f6610a6a01b38ff11ee |
| `docs/agents/backtests/cryptobooks/scripts/regimes_hist.py` | 8ebfbcfec68b1b91f1ce7d062536a4fae74054429825d9b84ca90d15fd3b44c4 |
| `docs/agents/backtests/cryptobooks/scripts/paper_reading.py` | a6ed9c7b57e1a7b5050fc39f313224a28fc41935c95a28b19fec0db71c465a4f |
| `docs/agents/backtests/cryptobooks/results/parity_XRP-GBP.json` | c46ba326bbea05c1f1339f0a44828e293ec360a2be83825b83d41758ed19a33d |

`src/xrp_paper_prereg.test.js` checks each file is the one named, and that the rule's numbers are the ones above.

## 11. Deviations

None at freezing.

## 12. Changes from the draft (CRYPTOBOOKS-2 §8)

- The fill timing: a quote waits a second before the tape can fill it (§3). The draft scored the card without it.
- The minimum fills is 100, not 300. The card had no fill at all in 198 of the year's 363 windows (CRYPTOBOOKS-2 §4), so 300 could
  fail a normal month on the count alone. 100 is the floor for a reading worth making.
- SOL-GBP is not run. It was to be reported and not judged; §1 found it dilutes the arm.
- The live regime signal is not recorded. The pair spread is computed from the recorded prints in the reading (§7.3). The book is
  recorded each minute instead.
- Two more money arms, £120 and £1,200, run beside the judged £600 arm on the same inputs.
- Void (§6) is measured from the arm's own stale seconds and the prints' gaps, which the tables keep.

## 13. Not checked

- How the paper's fills compare with a live loop's: a live loop has latency, a queue position and others' reactions.
- Whether Binance's data host and Revolut X's public endpoints answer the Edge region at second 12 as they answered this container
  (both answered here on 2026-10-31, keyless). The first calls' `last_error` and `ops_errors` (`agents.mm`) will say.
- The power estimate draws days as sums of ten year-windows. Real days are correlated, and it is rough.
