# C: new TESTING rows — what is left to test, and what is not (2026-09-27)

> Appendix C of `2026-09-27-testing-portfolio-review.md`, written by a read-only research agent and kept as it
> reported. Its measurement scripts and raw pulls (`c_meas/`) were not kept; §5 says how each was made. Its reading of
> the maker probes in §3 ("median +32.5 bps adverse at 15 min against a 9 bps fee") is the one the review corrects:
> see the review's §2.3.

Research note for the TESTING review. Read-only: no tracked file changed, nothing committed, no key used, nothing
placed. Production was read with SELECT only; `agent_book_levels` was counted, never read; no `pm_rw_*` table was
touched. Scripts and raw outputs of the measurements are in
`c_meas/` (not kept).

## 1. Summary

1. **One new test is worth pre-registering now: QUEUE** — PR6's par quotes on Revolut X's USD stablecoin books, and
   PR5's GBP quotes, re-scored with fills from queue position on the books `0057` is recording. Every earlier maker
   test on these books counted only prints strictly through a quote, the fill class that is rare and adverse on a
   pegged book. In the month before the recorder, prints AT PR6's rung prices were a ceiling of +$16.5 of extra entry
   edge (≈ $0.59 a day) against a bar of $0.263 a day; PR6's through-fills made $0.055 a day. Odds of a pass ≈ 20 %;
   the money is small ($0.25–0.6 a day on $1,200). **Deadline:** the recorder prunes after 35 days, so the
   pre-registration must be frozen before anyone reads the table and the run done by 2026-11-01 10:25 UTC.
2. **One frozen test waits on a build decision, not a draft: USLATE-FAST** (a 1 s `tgftp` recorder, 28 days). Odds
   ≈ 12 %; $7–13 a day before traps if it passes; Polymarket access limits apply.
3. **No third candidate clears the four criteria.** Measured and dropped here: DISPUTE (fp4's untested B16) — 44
   Polymarket disputes in 37.5 h, median market $104, 24 of the 35 resolved overturned (M2's 21 months: 77 % kept),
   so there is no stable sign to bet on. Also dropped: LONGSHOT (FAV flipped: refused in fp5 as data-snooped, lives in
   weather); a resting twin of the trend rows (probes: median +32.5 bps adverse at 15 min against a 9 bps fee).

## 2. Rejected families checked against

Every candidate below was checked against these; none re-proposes one.

| family | where it was rejected |
|---|---|
| faster crypto rules: 1 h SMA, hourly RSI; 15 min / 1 h trend, RSI(2) pullback | §3.2, §3.6 |
| chart patterns: breakout + volume, Bollinger squeeze, double bottom | §3.5 |
| cross-venue dislocation / stale prints (dislocation-1m, retired `0038`) | §3.5, §2c, §4.10 |
| wider universes (27 coins), Kraken-only coins, TAO/KAS/POL | §3.7, §3.8, §3.12, §3.14 K1, §3.15 W3, §4 items 22–23 |
| rule ideas: BTC-regime gate, bare Donchian, 4 h pullback, stale-trend exit, weekly bars | §3.9; regime gate again §3.30 |
| rotation / dual momentum (rotation-1d, rotation-1w) | §3.4, §3.14 K2, §3.17 (retired, deleted `0044`) |
| sizing and allocation: inverse vol, equal risk, per-entry vol, return-weighted, concentrated | §3.10, §3.11, §3.19 A2, §3.21 H1 |
| slower rulebooks: daily/weekly trend, Donchian, 3/6/12-month momentum, monthly rebalance, 200-day hold, crash-stop hold, trend-4h-wide | §3.12, §3.14, §3.15 W4 |
| execution: maker-only entries, cooldown grid, scaling in/out, pyramiding, wider floor, time stops, stop surface | §3.13, §3.19 A3 |
| entry gates for the sideways year (33 arms), DVOL gate, funding gate | §3.17 S1, §3.21 H2/H3, §3.30 |
| moving the rows' venue (Kraken; Binance cost; the Kraken and Binance twins) | §3.12, §3.19 A4, §3.22, §4 items 22 and 29 |
| Jev gate wordings on the paper rows | §4 items 21, 28 (shadow since `0059`) |
| maker-only rules on Revolut X (RSI(2), lower band, ATR dip; 1 h, 4 h) | §3.23 |
| Binance cross-sectional momentum, reversal, low volatility | §3.24, §3.25 |
| first principles 1 (31 ideas: quoting majors' touch, deep quotes anchored to Binance, make-and-hedge, peg ping-pong at strictly-through fills, grid, pair rebalancing, GBP cycles, stable triangles, stale stable/GBP taker, listing and weekend premia, LSTs, WBTC, UK vs EEA, scheduled flow; PR1 void, PR2 below cash, PR4 fails) | §3.26; `reviews/2026-09-23-first-principles-study.md` §3 |
| fp2: quotes inside the resident maker's spread (T1), UK-sweep quotes 50 bps from Binance (T2), bids under LSTs (T3); 24/7 tokens of closed markets | §3.28 |
| fp3: cascade bids CB (pass at about cash, losing since the price-range rule), zero-fee stable quotes ZF, buy after a delisting notice DL, gold tokens | §3.29 |
| funding crowding as a BTC spot trade (UZERO, USOFR) | §3.34 |
| PR6: par quotes on the USD stablecoin books, strictly-through fills | §3.35 |
| fp6: ETH quarterly carry, altcoin carry, trend long/short on perps, delist short, new-perp short | §3.38 |
| fp5: ~500 Revolut X rules, ~355 Binance rules, 58 Polymarket taker rules, DRAWBASE → DRAW-X | fp5 review; §3.36 |
| Polymarket fp4: FAV (favourites), WX (weather model), hourly crypto up/down, negative-risk sets, ladders, taker tiers, UMA proposer race, holding rewards, maker rebates alone, B4–B15, B17–B18 | §3.33; fp4 study §3 |
| the sign flip of FAV (buy 0.05–0.10 longshots) | refused in fp5 (`round9-kills`, `round8-kills` TAIL) |
| PMLATE / USLATE (informed taker after a station report) | §3.37 |
| speed (1 s loop, Worker), post counts, view counts | §3.39, §3.40 |
| weather sources and models (FASTSRC withdrawn; HRRR, WeatherNext) | §3.41 |
| HARVEST (the book after a public confirmation), FAST-A (a race) | §3.42 |
| RW-E variant (a): a smaller inventory cap | ledger 2026-09-27 18:20 |
| Bitget; PR7 (USDC/EUR, not on the UK side) | venue survey §12; ledger 2026-09-26 17:53 |

## 3. Candidates, ranked

### C1. QUEUE — Revolut X's stablecoin quotes scored by queue position (pre-register now)

**Mechanism.** On a pegged book the price hardly moves, so a resting quote is filled when takers trade AT its price
and the orders ahead of it at that level are used up. It is not filled only when the price moves through it. A 0 %
maker at a pegged touch earns 1–3 ticks a round trip with little staleness. The fp5 review (item 5) named this as the
thing "no book history" had blocked; `0057` has recorded the books since 2026-09-26 18:16 UTC.

**Why earlier failures do not already answer it.**
* PR6 (§3.35) and first-principles idea 5 were scored with fills from prints strictly through the quote. That rule
  cannot count the fill class a queue model adds.
  * Idea 5's "a strictly-through fill at 1.0000 needs a print at 1.0001" is exactly this limitation.
  * PR6's result (+1.0 bp a dollar, 3.86 %/yr, stress −$8.41) describes only through-fills.
* The adverse selection that kills coin-book quoting (fp2's h/σ₁ₘ, the fp5 review, the maker probes) comes from a
  moving fair value. Here the fair value is par, or a slow reference.
* fp5's one "prints at our price count too" arm was on COIN books (BTC, ETH, SOL, XRP: −15 to −33 bp), where that
  adverse selection dominates. It says nothing about a pegged book.
* What is not fixed: PR6's real loss was one position in twenty stopped after a day of drift below par. Queue fills
  do not remove that risk, and the test must price it.

**Data and availability.**
* The recorder, `agent_book_levels`:
  * top five levels a side (price, quantity, orders) of USDC-USD, USDT-USD, USDC-GBP and USDT-GBP;
  * read about 40 s into each minute and stored when changed (`seen_until`, `reads`);
  * **pruned after 35 days** by a daily job at 10:25 UTC (`0057`).
  * Coverage (counted, not read), 2026-09-27 00:00 → 21:52 UTC: each book read 1,310 times in 1,312 minutes. Distinct
    stored books: USDC-USD 134, USDT-USD 299, USDC-GBP 816, USDT-GBP 622.
* The UK public tape (`/api/1.0/public/trades/all`): keyless and permanent, with ms timestamps and aggressor side.
  PR5's engine also stores the GBP books' prints and inputs.
* Kraken's hourly OHLC for USDT/USD and USDC/USD (keyless). It keeps only 720 bars, so pull it within two days of the
  window's end, or rebuild the hours from `Trades`.
* **No history can test it.** Before 2026-09-26 there are prints but no books, which is why the power check below
  gives a ceiling, not an estimate.

**Power check** (the committed PR6 prints for 2026-08-29 → 09-25, the month before the recorder; nothing of the test
window read):
* **Volume.** USDC-USD traded $30.3k a day (1,220 prints in 28 days); USDT-USD $52.5k a day (1,723 prints).
* **Prints AT PR6's rung prices.** 1,167 prints, $89.0k capped at $100 each, against $243.9k strictly through.
  * USDC-USD, rung 1: 118 sells at 0.9999 and 194 buys at 1.0001.
  * USDC-USD, rung 2: 156 sells and 326 buys.
  * USDT-USD traded below par (see Q2), so its par bids were mostly through, meaning refused as post-only.
* **Ceiling.** If every AT print had filled a $100 rung at the front of its queue, with no stop, the extra entry edge
  would be **+$16.49 in 28 days (≈ $0.59 a day)**.
* **Against the bar.** 8 %/yr on PR6's $1,200 is **$0.263 a day ($7.36 in 28 days)**. PR6's own through-fill result
  in those four weeks was +$1.54 ($0.055 a day).
* **So a pass needs more than a third of the ceiling after stops.** The answer is not fixed in advance: at the front of
  the queue it clears the bar about twice over; at the back it adds almost nothing.
* **Resolution.** The null (below) has 671 hourly shifts, which resolves p to about 0.0015, enough for Holm over two.

**Pre-registration sketch (≤ 3 hypotheses, Holm over the two with a bar):**
* **Window.** 2026-09-27 00:00 → 2026-10-25 00:00 UTC (28 days); halves of 14 days. Frozen on `main` before 10-25 and
  before any read of `agent_book_levels`.
* **Q1: PR6's frozen rule, unchanged** (par, rungs 1–3 ticks, $100, 24 h stop, post-only refusal, de-peg guard),
  scored with the queue fill below.
* **Q2: the same rungs about a moving fair.** The fair is Kraken's last closed hourly VWAP of the coin, rounded to the
  tick, instead of par.
  * Disclosed as seen: in 2026-08-29 → 09-25, Kraken's hourly USDT/USD VWAP had a median of 0.99972 and USDC/USD
    0.99980.
  * Revolut X's UK prints sat a median −1.2 bps from it on USDT (p10 −4.1, p90 +3.2) and +2.0 bps on USDC.
  * PR6 found four stops in five were longs from bids.
* **Q3 (descriptive, no bar).** PR5's frozen rule on the GBP books with the same queue fill, against PR5's own
  through-fills over the same days. It does not touch PR5's spec or its 2026-10-21 review.
* **The queue fill (pessimistic, frozen):**
  * **Queue at placement.** An order joins behind the level's recorded quantity in the last book at or before it goes
    live. It takes the next book's quantity if the level was empty before and filled after.
  * **Price improvement.** If our price improves on the best level, the queue ahead is zero.
  * **Fills at the level.** Prints at our price on our side (sell-aggressor for a bid) use up the queue ahead, then
    fill us at our limit, up to the print's size.
  * **Fills through the level.** Prints strictly through fill us as PR5's rule does (≤ $100, ≤ 10 % of the minute's
    volume).
  * **Cancellations** ahead never advance us.
  * **Beyond the book.** A level deeper than the five recorded fills only by prints strictly through it.
* **Fees.** 0 % maker. The 24 h stop pays 9 bps plus each book's half-spread, as in PR5 and PR6.
* **Null.** Circular shift of the order schedule against the prints by whole hours (671 shifts). p is the rank.
* **Bar (each of Q1 and Q2):**
  1. P&L > 0, and each half > 0.
  2. Above the null's p95, with Holm over Q1 and Q2 (0.025, then 0.05).
  3. Stress > 0. Stress means the queue ahead ×1.5, through-fills one tick further, and the stop cost doubled.
  4. At least 60 round trips; no day over 700 orders.
  5. No day over 40 % of the P&L.
  6. At least 8 %/yr on $1,200 over the 28 days, i.e. ≥ $7.36.
* **Descriptive arms.** Cancellations ahead advance the queue pro rata; markouts of queue fills against through-fills
  at +5 and +60 minutes; the queue-ahead distribution at placement; orders a day.

**Build cost.**
* **The study.** Offline Python beside `pr5_sim.py` and `pr6_sim.py`, plus a queue layer. It needs:
  * an export of about 50–60k recorder rows by SELECT;
  * a pull of about 3k UK prints (30 pages a book at one request a second);
  * the Kraken hours.
  No production change.
* **A pass makes a paper row, "Stablecoin quotes (USD)":**
  * a second configuration of `agents/quotes.ts`, whose fill reads `agent_book_levels`. The recorder already writes
    by :40, and PR5's engine decides one minute behind;
  * one row in `edge-calls-every-minute`, or a mode of the `quotes` call;
  * test-keyed `agent_quote_*` tables;
  * a few ms of CPU a minute, and two more public tape reads a minute placed after :45, off the tick's, PR5's and the
    recorder's;
  * about 61 orders a day, PR6's average, on a sub-account holding USD, USDC and USDT.

**Honest probability it passes:** ~20 % that Q1 or Q2 clears all six conditions. If one passes, it earns about
$0.25–0.6 a day on $1,200. Its larger value is the fill model: it says whether PR5's paper record, and PR5's live
decision after 10-21, rest on the right fills.

### C2. USLATE-FAST — not new; frozen, waiting on its recorder

**What it is.** USLATE's rule acted on the second NOAA's `tgftp` publishes a US station's report (+0.25 s), counting
only prints ≥ 3 s later. It is frozen by the speed study (`reviews/2026-09-27-speed-prereg-uslate-fast.md`, §3.39).

**Why it is not answered.** USLATE failed on one date's share (§3.37). At USLATE's own instant the source bound it,
not the loop. The fast instant has never been measured on real publication times.

**Data.** A 1 s recorder of `tgftp`'s METAR cycle files, not built. Everything else is keyless and already scripted.
There is no history: the test is 28 days forward, starting after 24 gap-free hours.

**Power** (the pre-registration's own, from September):
* ~60 bucket-deaths on ~15 dates in 28 days, for +$195–355, against USLATE's ~+$210 on the same days.
* Condition 8 (beat USLATE) is the likely failure.
* Traps run at 0.40 % of US market-days, about one every two weeks. A pass needs four weeks with at most one.

**Bar.** Eight conditions, including "each half > 0", "no date > 40 %" and "beats USLATE on the same days", as
frozen.

**Build cost.**
* One Edge action looping each second for ~55 s under a lease, as a row of `edge-calls-every-minute`. SPEED measured
  0.68 s reaction and ~99 ms of CPU a call, with a wall time like the view recorder's.
* A first-sighting table (station, observation minute, publication instant).
* About 95,000 byte-range reads a day to NOAA: the current hour's file every second and the previous hour's every
  10 s.
* Build it only on Davies' word.

**Honest probability it passes:** ~12 %. A pass buys a paper month, then a Polymarket live proposal that can open
positions only from Ireland under his attestation (and fp4 §0's Terms finding still stands).

### Considered, measured where cheap, and not proposed

* **DISPUTE (fp4 B16: buy the first-proposed outcome while a UMA dispute runs).**
  * **Measured.** UMA `DisputePrice` logs on both oracles Polymarket's four adapters use, from a public Polygon RPC,
    2026-09-26 13:47 → 09-27 21:13 UTC:
    * 44 disputes, 28.2 a day;
    * median market volume $104, and only 5 of 44 at $5k or more;
    * clustered: 12 on one college-football game's third-quarter markets;
    * mostly bot proposals on sports and esports props;
    * of the 35 resolved, 11 kept the disputed proposal and **24 overturned it**.
  * **Against M2's 21 months** of markets of $5k or more: 411 disputes, 77 % kept. The sign turns with the mix.
  * **Why not proposed.** Where the dispute is a correction the outcome is public, which is HARVEST's
    pennies-unless-contested case. Where it is genuinely argued (politics, mentions) the price is the crowd's reading
    of the vote, and there are about 20 a month. There is no mechanism for a systematic discount, and the books are
    tiny.
  * **For HARVEST's UMA lead:** a disputed proposal on a prop is wrong more often than right, so any
    "follow the proposal" rule must stop at a dispute.
* **LONGSHOT (rest asks on 0.90–0.97 favourites, i.e. bid the longshot, in the last day).**
  * **The numbers it rests on:** FAV found favourites overpriced (won 95.1 % at 96.3 ¢; last hour 92.5 % at 95.8 ¢).
  * **Why not proposed:**
    * It is FAV's sign flip, which fp5 refused as snooped.
    * 58 % of the effect is weather, whose 2026 prints PMLATE, HARVEST and WX have all read, so there is no clean
      history.
    * Outside weather it is absent: sports favourites made +$74.
    * Late favourite-buyers in temperature markets are the informed takers behind RW's same-day loss.
    * It is a forecasting bet, the drift Davies stopped on 09-27.
* **A resting-execution twin of the trend rows.**
  * `agent_maker_probes`: six distinct resolved probes with follow-ups (ids 4–17; 10, 12 and 14 are one minute on
    three rows). Adverse at +15 min: 29.9 / 35.2 / 26.1 / 105.3 / 35.0 / −57.3 bps (median +32.5); at +60 min, median
    +11.7.
  * That is against a 9 bps taker fee, the fp5 review's 26–35 bps again. The probes already are this measurement.
* **A taker into the GBP books' stale side after an FX release.** First-principles idea 14 prices the stale stable/GBP
  taker at about 7 bps of edge in the 5 % tail against about 9.7 bps of cost, with a 1.8–2.4-minute half-life. An
  event-only version sees a few releases a month, on books trading tens of thousands of dollars a day: cents.
* **Waiting on inputs, not draftable today.**
  * WXSRC Paris: Météo-France DPObs needs a working long-lived key, then a day's measurement. Its upper bound is about
    $11 a day before traps.
  * VIEWS last-batch taker: it needs the recorder's 4–6 weeks, and the phase-1 trigger is at least three close calls
    a batch behind by more than 2 s, each worth more than $20.
* **Binance.** Nothing new is structural after four searches. CB passed at about cash and has lost since the
  price-range rule. A Binance row can only be paper (`agent_strategies_binance_paper_only`).
* **Outside today's venues (Davies' call, not proposed).** A multi-asset UCITS-ETF trend rule in the Trading 212 ISA
  was the venue survey's "first step" for other asset classes (§5.1). It has a documented mechanism and decades of
  index history. But it is not a venue of the Agents, the benchmark (holding) is strong, and its odds against a
  timing null are low.

## 4. Recommended next step

1. **Draft QUEUE now** (Q1, Q2 with a bar, Q3 descriptive), by a session that has not read `agent_book_levels`.
   * **Freeze** it on `main` before 2026-10-25 00:00 UTC.
   * **Run window.** Between 10-25 and **11-01 10:25 UTC**, when the 35-day prune starts deleting 09-27. A migration
     that lengthens the prune, on Davies' word, removes the rush.
   * **Pull Kraken's hours** by about 10-26.
2. **No second pre-registration now.** USLATE-FAST's is already frozen. The only open decision is Davies': build its
   1 s recorder or not. At ~12 % and needing Polymarket access to be worth anything, it is optional.

## 5. What was measured, and how

* **The prints behind the power check and the Q2 disclosure.** The committed PR6 inputs
  (`docs/agents/backtests/pr6/inputs/*.jsonl.gz`), 2026-08-29 → 09-25: USD volume by price level and aggressor
  side, and the prints AT and strictly through each rung (inline Python in this session).
* **Kraken, against the tape.** Keyless `GET https://api.kraken.com/0/public/OHLC?pair=USDTUSD|USDCUSD&interval=60`,
  hours in 2026-08-29 → 09-25, set against the same prints (`c_meas/kr_*.json`).
* **Recorder coverage.** `select book, date_trunc('day', ts), count(*), min(ts), max(coalesce(seen_until, ts)),
  sum(reads) from agent_book_levels group by 1, 2`. Counts and times only; no bid or ask read. The prune is live:
  `cron.job` `agents-books-prune`, `25 10 * * *`, `delete … where ts < now() - interval '35 days'`, active.
* **Maker probes.** `select … from agent_maker_probes order by id`: 11 rows, 6 distinct events with follow-ups.
* **Disputes.**
  * **Pull.** `c_meas/keccak.py`, a pure-Python Keccak-256, checked against the empty-string hash. `eth_call
    optimisticOracle()` on the adapters 0x6A9D…, 0x6507…, 0x69c4… and 0x2F5e… gives the oracles 0xee3a… and
    0x2c03…. `eth_getLogs` for `DisputePrice` (topic 0x5165909c…) went back in 9,999-block windows on
    `polygon-bor-rpc.publicnode.com` until its history ran out (~37.5 h).
  * **Decoding.** The ancillary data's `market_id` was looked up on Gamma `/markets/{id}` for outcomes, prices, UMA
    statuses and volume. Kept or overturned was read against each ancillary text's own "p1 corresponds to …" mapping
    (`c_meas/recent_disputes*.json`).
  * **Limit.** The RPC keeps only ~1.5 days of logs, so M2-style history needs an archive source.
* **Taken from the repository, not re-measured.** The disputes and the 77 % (fp4 M2), the FAV calibration (fp4
  §FAV), the SPEED and USLATE-FAST figures (§3.39, frozen pre-registration), PR5's $0.42 a day (§3.27), and PR6's
  figures (`reviews/2026-09-26-pr6-study.md`).
