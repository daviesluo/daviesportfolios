# A second-level GBP/USD and EUR/USD beside Yahoo: the sources, the recorder, and the plan to compare (2026-10-29)

Davies, 2026-10-29: "并行记录秒级汇率 并研究下最佳数据源并且要有fallback" (record a second-level exchange rate in parallel,
research the best data source, and have a fallback). Every stablecoin quote row prices its fair on Yahoo's one-minute
GBPUSD=X or EURUSD=X bar, and the Coinbase/OKX fair-price study (`2026-10-29-cb-okx-fair-price-study.md` §2.6, §5) found about
40 % of a minute's move reaching Yahoo a bar late; its advice was to record a sub-minute feed beside Yahoo for 2–4 weeks
before deciding anything. This is that recorder, the sources behind it, and the plan for the comparison.

**What changes in production: one recorder, nothing else.** `agents/fx_rec.ts` (`agents?action=fxrec`, migration `0172`)
writes `fx_ticks`. No strategy reads it; every quote row keeps Yahoo's bar. No account, key or sign-up was made, and nothing
here needs one. Public data only; no figure of Davies' own accounts.

## 0. Answers first

1. **Primary: TrueFX's keyless snapshot, read every second.** Both pairs in one answer with a bid, an ask and the quote's
   own millisecond time. In 25 minutes of 1 s reads (07:15–07:40 UTC) nothing led it: Kraken, Bitstamp and Coinbase's
   implied rate were each 1–3 s behind, on both pairs. It steps every 2–3 s rather than every tick (its own time moved on
   41 % and 37 % of reads), and its keyless endpoint has no published licence, so it may change or go: hence the fallback.
2. **Fallback: Kraken's spot GBP/USD and EUR/USD**, one call for both, read every 5 s always and every 2 s, marked, while
   TrueFX fails or freezes. 2 s behind TrueFX, the closest follower of its changes (0.25 against Bitstamp's 0.12 on
   GBP/USD), level within 0.04 bps on GBP/USD and 1.3 bps under on EUR/USD. Bitstamp would be the next one.
3. **Kept out:** Yahoo (today's X; it is already stored every minute, and extra reads from the same egress could cost PR5
   its bars), Coinbase's implied rate (the coin's price, 1.1–1.3 bps steps, already recorded), Dukascopy (historical only; it
   is the comparison's reference), and every keyed source (§1). **Next if TrueFX disappoints:** Finnhub's websocket, whose key
   the function already holds; then OANDA's practice stream, which needs Davies.
4. **What Davies must do: nothing for this recorder.** Only if OANDA is wanted later: open a free OANDA fxTrade demo account,
   generate a personal access token under "Manage API Access", and store it as the Supabase secrets `OANDA_PRACTICE_TOKEN`
   and `OANDA_PRACTICE_ACCOUNT_ID` (nobody else may create them).
5. **Built: one call a minute that reads every second** (`agents?action=fxrec`, `0172`), answering at once and reading on to
   58 s under `waitUntil`; 160 ms of CPU a minute (measured, of the 2 s allowed), one invocation a minute, at most about
   5 MB a weekday, 42 days kept. A fault reaches `ops_errors` only when it lasts (§3).
6. **Two things the sample showed, for the comparison to confirm on weeks** (§2): Yahoo's GBP/USD bar holds about the price of
   10–20 s before the end of its minute; and Yahoo's EURUSD=X moves in 1.1 bps steps (it is the reciprocal of a 4-decimal
   USD/EUR) and sat +2.9 bps over TrueFX all morning, which would make Coinbase's and OKX's EUR books richer against
   interbank than the fair-price study measured against Yahoo.
7. **The plan** (§4): 14 days from the first full day, extended to 28 if coverage is short; coverage and outages, accuracy
   and lag against Dukascopy, Yahoo's bar timing, who leads whom against the books, and the engines replayed on the
   recorded X. The bar for proposing any switch is written there now, and the recorder goes off at the end unless it is
   met.
8. **What a faster X would have earned (the backtest, §7; Davies' addition).** The rows' engines replayed unchanged on their
   production windows, with X read from Exness's keyless ticks 2 s before each order goes live instead of Yahoo's bar:
   - **Revolut X (LIVE's rules, £600): nothing.** −0.27 bps of capital a day (−£6 a year) with LIVE's fill, 90 % band −£29
     to +£15; −£3 with PR5's. As the 09-28 and REVX-FAIR studies found.
   - **Coinbase "with Euros" (£2,400 on 19 days): +£66 a year** [+£10, +£149], trips 157 → 95, per trip better on all four
     books; most of it in the first half (+£117 a year, then +£9). The weekend arm "- 1": +£44 [−£56, +£162].
   - **OKX: too short to say.** EURC-USDC +€0.05 a day over 8 days; USDG-EUR one day.
   - **The Coinbase study's "+£38 look-ahead bound" is not look-ahead for orders that rest from t + 60 s.** Its history engine
     read Exness's close at t, and the bound was the price at t + 60, when the order goes live. Here, Yahoo → Exness at t is
     +£30 a year (Yahoo's bar is the price of about t − 32 s), t → t + 60 is +£43 (the study's +£38 again), and a feed read
     2 s before go-live gets +£66 of the +£73. The steps between reading 0, 2, 5 and 15 s early are inside the noise.
   - A real feed would capture about nine-tenths of the gap to the bound, on Coinbase only. This is 19 days of one paper
     arm. It earns nothing on Revolut X, and nothing changes before the recorder's comparison (§4) and a pre-registration.
9. **The long backtests (§8, §9).** Over two years a fast X passes on every Coinbase arm (§8). Over Revolut X's whole history
   (2025-11-26 → 2026-10-29) it passes on no Revolut X row: LIVE −£2.0 a year out of sample [−£13.2, +£9.3], the testing rows
   −£4.6 to +£4.0, and even the bound earns nothing (§9). The X error is the same small size on both venues. Coinbase's
   books carry a fifth of a rate move within the minute, so a stale quote gets picked off; Revolut X's carry 2 %, so it does
   not.

## 1. The candidates

What each offers for GBP/USD and EUR/USD at sub-minute speed, as of 2026-10-29. "Measured" means read from this container
(keyless, 1 Hz, §2); "documented" means read from the provider's own pages that day or from the 2026-09-28 fast-X study
(`2026-09-28-pr5-fast-fx-study.md`), which measured some of them against Dukascopy's ticks.

| source | what it gives | key or sign-up | limits | terms for recording | from Edge / a Worker | closed market | verdict |
|---|---|---|---|---|---|---|---|
| **TrueFX** keyless snapshot, `webrates.truefx.com/rates/connect.html?f=csv` | 10 pairs in one CSV, GBP/USD and EUR/USD among them: bid, ask, the quote's own ms time (Integral's aggregated interbank) | none | none published; the unauthenticated session is "a snapshot … for all currency pairs" (its old developer guide, quoted by the R `TFX` package) | no licence published for the keyless endpoint; the site today sells streaming plans ("Enquire") and links only a privacy policy. A legacy endpoint that may be withdrawn: hence the fallback | Edge: read in production 2026-09-28 → 09-30 (variant-2, reference §4 item 47). Worker: not tried | assumed frozen (its own time stops) | **primary**: measured, the fastest keyless rate (§2) |
| **Kraken** spot `GBPUSD`, `EURUSD`, `/0/public/Ticker?pair=GBPUSD,EURUSD` | a real exchange's FX books: best bid and ask of both pairs in one answer; no quote time | none | per-IP public limits, not re-read; one call every 2–5 s | Kraken's public market data | Edge: not yet shown (the recorder's first hour will). Worker: not tried | Kraken is a 24/7 venue; its book may move with no interbank behind it (not observed) | **fallback**: 2 s behind TrueFX, the best of the keyless rest on changes (§2) |
| Bitstamp `ticker/gbpusd`, `ticker/eurusd` | bid, ask, a `timestamp` that is the answer's time, not the quote's (GBP/USD: it moved on 72 % of 1 s reads while the quote moved on 16 %) | none | generous; one call a pair | public market data | not tried | as Kraken | a second fallback if Kraken fails: 1–2 s behind TrueFX, but its GBP/USD changes barely follow (§2) |
| Coinbase USDC-GBP / USDC-EUR books, inverted | the coin's price, not the currency's: a 0.0001 tick is 1.33 bps (GBP) and 1.11 bps (EUR), and the stablecoin's premium rides on it (+3.0 / +1.9 bps over TrueFX in §2) | none | 10 requests/s per IP | public | already recorded (`cb_touch`, `cb_trades`) | trades 24/7 | **not an FX source**; it is what the comparison measures against |
| Yahoo `v8/finance/chart/GBPUSD=X` (today's X) | one-minute bars; GBPUSD=X is the reciprocal of a 5-decimal USD/GBP (0.18 bps steps), EURUSD=X of a 4-decimal USD/EUR (**1.1 bps steps**: 1/0.8975 = 1.114206, 1/0.8976 = 1.114082; all 51 stored bars of §2's window fit; and EURUSD=X sat **+2.9 bps** over TrueFX, §2) | none | unofficial; 429 to this container on the one read of 2026-10-29 (and 311 of 316 on 09-28); production reads it every minute | Yahoo's terms forbid automated use | Edge: every minute in production. Worker: not tried | dark Friday ~21:30 → Sunday 23:00 UTC (09-28 study) | kept as the strategies' X; not read by the recorder (§3) |
| Dukascopy `datafeed.dukascopy.com/.../HHh_ticks.bi5` | historical ticks, ms times, ~200 ms apart in London hours; an hour's file appears after the hour | none | 429, then 503, to this container on 2026-10-29 | public, keyless | historical only | dark Friday 20:59 → Sunday 21:00 | **the reference** for the comparison and the backtest, fetched after the fact |
| OANDA v20 practice stream | streamed bid/ask, about four a second (09-28 study) | **a free fxTrade demo account and a personal access token** ("Manage API Access" after agreeing to the API licence) | per its own best-practice page, not re-read | its API licence, agreed at token creation | an HTTP stream a minute-long run can hold | closed | the best keyed candidate if TrueFX goes; needs Davies (§0) |
| Finnhub websocket `OANDA:GBP_USD` | trades of OANDA's feed, price and ms time (09-28 study; the docs page is rendered by script and could not be re-read) | **the key exists already** (`FINNHUB_API_KEY`, the economic calendar's) | free REST forex is "Premium Access Required" (09-28) | personal use | a websocket a minute-long run can hold; not tried | closed | next to try, with no action from Davies, if TrueFX disappoints |
| Twelve Data | real-time forex on the free plan | a free key | **8 requests a minute, 800 a day** (one read every 108 s over a day); websocket "8 trial" credits | "Internal non-display usage" | — | — | too slow on the free plan |
| Tiingo | "Real-time Data"; FX not named on the pricing page | a free key | **50 requests an hour, 1,000 a day** | "Internal Use Only … may not display or share the data" | — | — | too slow |
| Polygon / Massive | real-time currencies on a paid plan only (the pricing page read on 2026-10-29 listed no free currency plan) | a paid key | — | — | — | — | not without paying |
| Alpha Vantage, FCS | one rate per request | a free key | Alpha Vantage 25 requests a day; FCS a few hundred a month (their pages, not re-read) | — | — | — | too slow |
| ECB reference rates | one fixing a day, about 16:00 CET | none | — | public | — | — | not sub-minute |
| Trading 212 | no FX or quote endpoint; its API terms forbid monitoring or benchmarking (09-28) | — | — | forbidden | — | — | not a source |

## 2. What was measured

**How.** Six keyless reads, each once a second in its own thread, for 25 minutes, 2026-10-29 07:15:05 → 07:40:05 UTC
(a Thursday, London open): TrueFX's snapshot, Kraken's ticker (both pairs), Bitstamp's two tickers, Coinbase's USDC-GBP
and USDC-EUR tickers (inverted). Each read logs when it was sent and received (`scripts/sampler.py`; the raw log is
`data/sample_2026-10-29.jsonl.gz`). Yahoo's bars for the same minutes are the ones production stored (`data/yahoo_2026-10-29.txt`,
read from `agent_quote_inputs` and `cb_quote_inputs`). `scripts/analyse.py` → `results/sample_2026-10-29.json`.

**Lag against TrueFX.** Every series on a 1 s grid (the latest read received by then). A source shifted by s seconds is
compared with TrueFX: the s that minimises the mean |difference − median offset| ("levels"), and the s whose 1 s changes
correlate best with TrueFX's ("changes"). Positive s means the source is behind.

| GBP/USD | reads (failed) | round trip p50 / p95 ms | quote moved on | spread p50 bps | offset vs TrueFX, bps | behind TrueFX: levels / changes | best change correlation |
|---|---|---|---|---|---|---|---|
| TrueFX | 1,500 (0) | 190 / 419 | 36 % of reads | 0.34 | — | — | — |
| Kraken | 1,500 (0) | 188 / 532 | 26 % | 0.45 | −0.04 | 2 s / 2 s | 0.25 |
| Bitstamp | 1,500 (0) | 285 / 620 | 16 % | 1.13 | −0.23 | 2 s / 1 s | 0.12 |
| Coinbase USDC-GBP, inverted | 1,500 (0) | 380 / 546 | 6 % | 1.33 | +3.00 (USDC's premium) | 1 s / 0 s | 0.25 |

| EUR/USD | reads (failed) | round trip p50 / p95 ms | quote moved on | spread p50 bps | offset vs TrueFX, bps | behind TrueFX: levels / changes | best change correlation |
|---|---|---|---|---|---|---|---|
| TrueFX | (the same reads) | | 33 % | 0.36 | — | — | — |
| Kraken | (the same reads) | | 22 % | 0.27 | −1.26 | 3 s / 2 s | 0.27 |
| Bitstamp | 1,500 (0) | 234 / 684 | 18 % | 0.90 | −1.30 | 2 s / 1 s | 0.26 |
| Coinbase USDC-EUR, inverted | 1,500 (0) | 369 / 575 | 3 % | 1.11 | +1.94 | 1 s / 1 s | 0.25 |

- **Nothing led TrueFX.** Every other source's best shift is 1–3 s behind it, on both pairs and both measures; no shift
  below zero correlates above 0.05.
- **TrueFX updates every two to three seconds, not every tick.** Its own timestamp moved on 41 % (GBP/USD) and 37 % (EUR/USD)
  of one-second reads; the quote's age at arrival was 1.4 s / 1.6 s at the median and 7.8 s / 8.6 s at p95 (the container's
  clock; the minimum, 11–13 ms, says the clocks agree to well under a second). The 09-28 study's 0.5–0.6 s behind
  Dukascopy's ticks was at the moment a new quote appeared; the snapshot itself steps.
- **Kraken is the fallback** over Bitstamp: its changes follow TrueFX's twice as closely on GBP/USD (0.25 against 0.12), its
  spread is a third of Bitstamp's, and one call carries both pairs. Both sit 1.3 bps under TrueFX on EUR/USD; Kraken's level
  sits on TrueFX's for GBP/USD. A fallback marked as such can be corrected for its offset afterwards; its lag cannot.
- **Coinbase's implied rate moves on the venue's tick**, 1.1–1.3 bps a step and 3–6 % of seconds, and carries the coin's
  premium: it is the thing the strategies quote into, not an FX source.
- **Yahoo's bars** (22 GBP/USD and 22 EUR/USD bars with TrueFX on both sides):
  - GBP/USD: the bar labelled t matches TrueFX's mid best 40–50 s after t (mean |difference| 0.42 bps, against 0.54 at
    its end, t + 60 s, and 0.80 at t + 120 s), and sits +0.39 bps over it (the 09-28 study: +0.34 over Dukascopy). So the
    bar holds about the price of 10–20 s before its end, so the turn at t, which reads the bar of t − 1, prices on about
    the price of t − 15 s, plus however long after t the bar reaches the engine. One morning's 22 bars are an indication,
    not a measurement: the comparison (§4) measures it on weeks.
  - EUR/USD: every bar is 1/(a 4-decimal USD/EUR), so it moves in steps of 1.1 bps, and in this window it sat **+2.87 bps
    over TrueFX and +4.17 over Kraken** (median, bar against TrueFX 50 s in). The Coinbase study's "Coinbase's EUR books trade
    +1.7 / +3.8 bps rich against Yahoo's EUR/USD" (its §2.1) would be +4.6 / +6.7 against TrueFX if this held. That too is
    for the comparison to measure.
- **No read failed**, from any source, in 9,000 reads; the slowest answer took 3.7 s (Bitstamp), TrueFX's 1.7 s.

## 3. The recorder

**Design: one Edge call a minute that reads every second, not a Worker.** The one-minute job (`edge_calls`) calls
`agents?action=fxrec` at the top of each minute. The call answers at once and its run goes on under `EdgeRuntime.waitUntil`
(as `ig` and the selections do) to 58 s into its minute, so it holds none of the job's batch. The next minute's run starts
as it ends: the minute is covered but for about a second at its turn. Why not the alternatives:

- **pg_cron's floor is a minute for an Edge call worth its boot**, and pg_cron at 1–59 s (supported on the project) would be
  one HTTP call per read, sixty boots a minute, each through the batch the other calls share.
- **A Cloudflare Worker** (the monitor's pattern) would need a cron (a minute at most) plus a Durable Object alarm each
  second to read faster; Workers Free allows 50 subrequests and 10 ms of CPU a run, and it would need a secret to write to the
  database. Davies' rule is that deploying there is his call, and nothing here needs sub-second reads.
- **Cost of this design, measured:** one full real minute of `runFxRec` against both hosts from this container (§6's
  `cpu.ts`, a stub database) took **160 ms of CPU** (130 user, 30 system) for 59 TrueFX and 12 Kraken reads; the platform
  allows 2 s a request. One invocation a minute is about 43,200 a month, inside the plan's included invocations. Storage:
  a full minute's row of 59 reads is **1,444 bytes** (`pg_column_size`, PostgreSQL 16 in PGlite), so at most about 4.3 MB a
  weekday for TrueFX's two pairs plus about 1 MB for Kraken's, a closed weekend almost nothing; 42 days kept is at most
  about 200 MB, likely half that, against a 2,607 MB database. About 8,600 small upserts a day (one per pair and source
  every 10 s).

**What it reads.** TrueFX every second with the market open, both pairs in one answer. Kraken every 5 s always (a check
the study can use, and proof the fallback works before it is needed), every 2 s while TrueFX is unhealthy, those reads
marked `fallback`. Market closed (Friday 22:00 → Sunday 21:00 UTC, the span closed in both summer and winter), TrueFX every
10 s and Kraken every 30 s. Each read times out after 1.5 s. Yahoo is not read: PR5's live executor needs Yahoo to keep
answering this egress, and the bars it already stores are what the comparison uses.

**Fallback.** TrueFX is unhealthy after 3 failed reads in a row, or, with the market surely open (not Friday 21:00 →
Sunday 22:00 UTC, the closure in summer or winter), while either pair's own timestamp is more than 120 s behind the read (a
frozen feed answers "200 OK" with an old price). Holidays (25 December, 1 January) are not modelled: a frozen TrueFX then
reads as unhealthy, Kraken records, and the fault is reported once an hour. The first good read makes
it healthy again. Health is kept in `fx_rec_state` across runs.

**Faults.** To `ops_errors` as `agents.fx_rec`, when a fault first appears and at most hourly while it lasts (the book
recorders' `faultKey`/`reportDue`): TrueFX unhealthy for 5 minutes with the market surely open; the fallback failing every read
of a minute in which it was needed; a write that fails. One failed read is not a fault.

**The table.** `fx_ticks`, a row per source, pair and minute: the minute's first read and every later one that brought a
new quote (or, for TrueFX, a new timestamp), as parallel arrays: arrival and the source's own time (ms after the minute;
Kraken gives none), bid, ask and mid in millionths, and whether it was a fallback read; with the minute's reads and failed
reads. The view `fx_tick_reads` unnests it, a row per read, with timestamps and prices. Kept 42 days. The call is a row of
`edge_calls` (`retry` true: a watchdog re-run happens only when the first never started, and then reads from 13 s on into
the same rows); its beat is the `agents` function's.

**Pinned** (`agents/fx_rec.test.ts`, 10 tests, on the two answers as served at 07:22 UTC): both parsers on the real answers
(TrueFX's big-figure-and-points join; a pair's bad line dropped, neither pair an error; Kraken's error array refused); the
closure (may be open, surely open) and the cadence; health after three failures, on a stale or missing pair, and not on a closed market's stale
quote; the rows' arrays; a healthy minute (59 + 12 GETs, nothing else, no credential); TrueFX down (Kraken every second
second from the third failure, marked; the fault only after five minutes, then hourly; healthy again at the first good
read); both down a fault at once; a failed write reported; the action answering before its run ends and reporting its
fault. `src/cron_jobs.test.js` pins the job's row, the prune and the tables' checks against the module's lists.

## 4. The plan for the comparison (2–4 weeks; no strategy change)

A description, not a test: nothing here decides a switch. Any change to a row's X comes afterwards, with a
pre-registration of its own, replayed on the row's engine as it runs.

**Window.** From the first full UTC day the recorder holds (the deploy plus `0172`'s 15-minute wait) for 14 days, extended to
28 when either pair has fewer than 8 weekdays with ≥ 99 % of open minutes covered. Read at the end of each week, every
record openly (no no-peek rule since 2026-10-04).

**Inputs**, all read-only: `fx_tick_reads` (TrueFX, Kraken); Yahoo's stored bars (`agent_quote_inputs` kind `fx` for GBP/USD,
`cb_quote_inputs` kind `fx:EURUSD`); Dukascopy's public ticks for the same hours, fetched after the fact (the reference: a
tick feed with millisecond times, ~200 ms apart in London hours, the 2026-09-28 study's truth); Coinbase's prints and
touch (`cb_trades`, `cb_touch`), Revolut X's prints and books (`agent_quote_prints`, `agent_book_levels`), OKX's
(`okx_trades`, `okx_books`).

**Questions and how each is measured.**

1. **Coverage and outages.** Share of open-market seconds with a TrueFX quote no more than 2 s old by its own timestamp;
   minutes on the fallback, their count, length and hour; failed reads; `agents.fx_rec` rows in `ops_errors`; Kraken's
   coverage the same way. Per hour of the UTC day, because TrueFX's update rate follows the market's.
2. **Accuracy against Dukascopy.** For TrueFX, Kraken and Yahoo: the level offset (median, p95 bps) and the lag, as in §2
   (the shift that minimises the mean |difference|, and the shift with the highest correlation of 1 s changes). TrueFX's
   own timestamp against Dukascopy's tick time gives its feed delay; arrival time against it gives what a reader here sees.
3. **Yahoo's bar timing.** For each bar, the instant in [t − 60 s, t + 180 s] at which Dukascopy's mid matches it best, and
   the share of each minute's move a bar late (the Coinbase study's 0.50 / 0.30 split, recomputed against a 1 s truth).
   And the quantity a strategy feels: at each decision instant of each row (the turn at t reads X to t − 1), |Yahoo's X −
   the fast X then| in bps, its distribution by hour and on the 30 largest one-minute moves.
4. **Who leads whom.** Correlation of 1 s changes of TrueFX's rate with Coinbase's implied rate (USDC-GBP and USDC-EUR
   prints and touch), at shifts from −10 to +30 s; the same at a minute for Revolut X's books (snapshotted once a minute)
   and OKX's. A venue that moves before the interbank rate is a fact about the venue, not about FX.
5. **What it would have been worth.** The rows' engines replayed on the recorded weeks with X from the recorder (TrueFX,
   the fallback where marked) at the same decision instants, against the same engines on Yahoo: P&L, fills, stops and bps a
   trip, day-block intervals. This is the historical backtest's question (Davies' addition of 2026-10-29) asked again on
   the live feed, and it is where the two must agree before anything is proposed.

**What would justify proposing a switch** (stated now, so the reading cannot choose it): coverage ≥ 99 % of open minutes
with the fallback, TrueFX's lag to Dukascopy under 2 s at the median, and, on the replay of question 5 together with the
historical backtest, a gain whose 5th percentile over day blocks is above zero on at least one row family. Short of that,
Yahoo stays and the recorder is switched off at the end of the window (`update public.edge_calls set enabled = false where
path = 'agents?action=fxrec';`).

## 5. What this did not do

- **No source needing a key or a sign-up was measured.** OANDA, Twelve Data, Polygon/Massive, Alpha Vantage, Tiingo and FCS
  are judged from their own pages (fetched 2026-10-29 where §1 says so) and the 2026-09-28 study. Finnhub's websocket was
  not opened: its key is the function's secret and is never read here.
- **Nothing was measured from Supabase's Edge or a Cloudflare Worker.** The 25-minute sample and the CPU minute ran from
  this container (its proxy adds its own delay to every read). That Edge reaches TrueFX is known from production
  (variant-2's code version 2 read it, 2026-09-28 → 09-30, reference §4 item 47); Kraken from Edge is not yet shown, and the
  recorder's first hour will show both (`fx_rec_state.last_report`, `fx_ticks.failed`).
- **Dukascopy, the reference, was not read**: it answered 429 and then 503 to this container on 2026-10-29. The 2026-09-28
  study's figures (TrueFX 0.5–0.6 s behind its ticks at one read a second) stand in for it here, and the comparison
  fetches it after the fact.
- **Weekend and overnight behaviour were not observed**: the sample is 25 minutes of a Thursday morning in London. What
  TrueFX and Kraken do while the market is closed is assumed (§1), and the recorder slows its reads then rather than
  relying on it.
- **No strategy, engine, frozen file or pre-registration was touched.** Whether a faster X earns anything is §7's backtest
  (on Exness's ticks) and, on the live feed, the comparison's (§4).

## 6. Files

- `supabase/functions/agents/fx_rec.ts`, `fx_rec.test.ts`; the route in `agents/index.ts` (`startFxRecAction`);
  `supabase/migrations/0172_fx_ticks.sql`; its pin in `src/cron_jobs.test.js`.
- `docs/agents/backtests/fx_second/`: `fixtures/answers_2026-10-29.json` (TrueFX's and Kraken's answers as served, which the
  tests parse); `scripts/sampler.py` (the 1 Hz keyless sampler: `python3 -I scripts/sampler.py OUT.jsonl SECONDS`, with
  `FX_CA_BUNDLE` behind a proxy); `scripts/analyse.py` (`YAHOO=data/yahoo_2026-10-29.txt python3 -I scripts/analyse.py
  results/sample_2026-10-29.json data/sample_2026-10-29.jsonl.gz`); `scripts/cpu.ts` (one real minute of the recorder and
  its CPU); `data/` (the raw sample and Yahoo's stored bars); `results/sample_2026-10-29.json`.
- `docs/agents/backtests/fx_speed/`: the backtest of §7 (its files are listed in §7.8).

## 7. The backtest: what a faster X would have earned (FX-SPEED)

Davies, 2026-10-29: "秒级汇率你研究好后，开始记录的同时也用历史数据仔细审读回测下目前我们用的yahoo来判断对我们的策略回报能提升多少" (alongside
the recording, backtest carefully on history how much better our strategies would do than with Yahoo).

### 7.1 The data

- **Keyless sub-second history for the production windows.** Dukascopy reset the connection to two plain, paced requests
  (07:53 and 08:04 UTC); its headers were not changed to get round that. Exness's public tick archives (`ticks.ex2archive.com`)
  have no login. Their October file is rewritten nightly and held every tick to 2026-10-28 23:59:59.
  - GBPUSD: 1,200,423 ticks in September and 1,149,677 in October; EURUSD: 822,037 and 928,924. Millisecond stamps, about one
    tick every 2 s in London hours.
  - The four zips' sha256 are in `backtests/fx_speed/MANIFEST.json`. The replays read one committed file derived from them:
    the last tick's mid at nine instants of every minute (`data/exness_offsets.txt.gz`, `scripts/exness.py`).
- **Yahoo, as the engines stored it**: `fair_price_cb_okx/inputs/prod/fx.txt.gz` (10-08 → 10-28), and for GBP/USD before
  that, PR5's own minute record.
- Our own `fx_ticks` starts today and is not used here.

### 7.2 Where Yahoo's bar sits in time (`scripts/yahoo_timing.py`, 21,126 GBP/USD and 19,761 EUR/USD weekday bars)

| bar labelled t against Exness at | t − 60 s | t | t + 15 | **t + 28** | t + 45 | t + 60 (its end) | t + 90 |
|---|---|---|---|---|---|---|---|
| GBP/USD, mean abs difference (bps) | 0.80 | 0.53 | 0.41 | **0.29** | 0.34 | 0.44 | 0.63 |
| EUR/USD, mean abs difference (bps) | 0.84 | 0.58 | 0.48 | **0.39** | 0.44 | 0.52 | 0.69 |

- **The bar is the price of the middle of its minute, not its close.** Yahoo's minute change correlates 0.56 (GBP) / 0.51
  (EUR) with Exness's change over the same minute and 0.33 / 0.34 with the minute before. That is the Coinbase study's
  0.50 / 0.30 split (its §2.6), from a mid-minute stamp.
- **Level offsets: GBPUSD=X sits +0.33 bps over Exness, EURUSD=X +2.82 bps**, steady over three weeks. That is the 25-minute
  sample's +2.87 over TrueFX (§2), so it is Yahoo's level, not either source's.

### 7.3 The method

- **The engines, each imported unchanged**, as the 2026-10-29 studies ran them:
  - Revolut X: PR5-OPT's LIVE-realistic replay, through REVX-FAIR's runner (`fair_price/scripts/replay.py`).
  - Coinbase: PR5's frozen `pr5_sim.simulate` on each book's minute record, through the CB/OKX study's `prod.py`.
  - OKX: `stepOkxMinute`, through the study's `okx_replay.ts`.
- **One thing changes: X.** Fair = coin value / X. On Coinbase the coin is valued at `cb_live`, which every Coinbase arm uses
  from 10-29; that run reproduces the study's committed `cb_live` run trip for trip on all eight arm-book pairs.
  - Outside FX closures only. Inside one, the held Yahoo X stays (Exness has no closure ticks).
  - Dark minutes and release blackouts stay the engine's own.
- **Timing, without look-ahead.** Each engine prices minute t's orders on data before t, and those orders go live later:
  - the PR5-OPT executor at t + 90 s (its turn 30 s into the next minute);
  - PR5's simulator and the OKX engine at t + 60 s.
  - Yahoo's X for minute t is the bar labelled t − 1, about the price of t − 32 s (§7.2).
  - The candidate **L2** is Exness's last tick at or before go-live − 2 s. That is what the recorder's TrueFX gives a reader
    (its quote is a median 1.4 s old on arrival, §2). L2 was named the primary before any run, and nothing was fitted.
  - L60, L30, L15, L5 and L0 show the shape. L0 is the price at go-live, the bound for an order resting from then.
  - `ex_ytime` is Exness at Yahoo's own timing (t − 32 s), the control for the source.
- **`aligned`**: Exness × (1 + the trailing 1,440-minute median of Yahoo / Exness-at-Yahoo's-timing − 1). It is causal and
  carries Yahoo's level, so it differs in timing alone; `raw` takes Exness's level too.
- **Scoring:** paired with Yahoo by UTC day; 3-day circular block bootstrap, 10,000 draws, seed 20261029, 90 % band and the
  share at or below zero, as REVX-FAIR. Halves at 10-12 (Revolut X) and 10-20 (Coinbase).

### 7.4 Revolut X: LIVE's rules at £600, 2026-09-26 → 10-29 (33 days; `results/revx.json`)

| X | 'at' bps/day | Δ vs Yahoo, bps/day [90 %], P(≤0) | £/yr | halves | trips, stops, bps/trip | 'through' Δ |
|---|---|---|---|---|---|---|
| Yahoo (today) | 13.25 | — | — | — | 541, 3, 14.48 | (10.52 bps/day) |
| Exness at Yahoo's timing | 12.55 | −0.71 [−1.73, +0.25], 0.88 | −£15 | −1.27 / −0.18 | 504, 4, 13.64 | +0.39 |
| L60 | 12.88 | −0.38 [−0.98, +0.27], 0.84 | −£8 | −0.23 / −0.51 | 511, 5, 14.17 | +0.25 |
| L15 | 13.52 | +0.27 [−0.36, +0.93], 0.25 | +£6 | +0.57 / −0.02 | 508, 4, 14.94 | +0.61 |
| L5 | 13.10 | −0.15 [−0.70, +0.39], 0.66 | −£3 | −0.45 / +0.14 | 501, 4, 14.69 | +0.05 |
| **L2 (primary)** | 12.98 | **−0.27 [−1.34, +0.66], 0.64** | **−£6** | −0.69 / +0.11 | 495, 4, 14.44 | −0.15 [−0.79, +0.51] |
| L0 (the bound) | 12.92 | −0.33 [−1.01, +0.36], 0.79 | −£7 | −0.41 / −0.25 | 491, 5, 14.31 | −0.08 |

- **A faster X earns nothing on Revolut X**, on either fill rule. Changing the source alone, at the same timing, moves the
  result as much as any timing does. Passing the stored X back through the hook gives the base trip for trip
  (`yahoo_adj`).
- **This matches** the 09-28 fast-X study (on PR5V's rule a faster X was worth −$0.003 to +$0.065 a day ungoverned, no
  interval clear of zero) and REVX-FAIR's `fx_extrapolate` (no gain).

### 7.5 Coinbase: "with Euros" and "- 1", 2026-10-10 (10-13) → 10-29, £/€100 a rung, cb_live (`results/cb.json`)

| X | "with Euros" (19 days): £/yr [90 %], P(≤0) | halves £/yr | trips, stops | "- 1" (16 days): £/yr [90 %] |
|---|---|---|---|---|
| Yahoo (today) | — (£7.65 in the window) | — | 157, 0 | — (£8.92; 171, 4) |
| Exness at Yahoo's timing, aligned / raw | +9 [−12, +30] / −13 [−34, +5] | −6 / +25 | 151, 0 | −25 [−88, +29] / −61 [−127, −12] |
| L60 (the history engine's timing) | +30 [+1, +67], 0.045 | +41 / +18 | 143, 0 | +9 [−69, +82] |
| L30 | +46 [+2, +107] | +75 / +13 | 100, 0 | +26 [−46, +102] |
| L15 | +73 [+13, +158] | +114 / +27 | 97, 0 | +64 [−26, +174] |
| L5 | +33 [−17, +102] | +75 / −13 | 87, 0 | +27 [−48, +116] |
| **L2 (primary), aligned** | **+66 [+10, +149], 0.0001** | +117 / +9 | 95, 0 | **+44 [−56, +162]**, 0.28 |
| L2, raw (Exness's EUR level) | +31 [−22, +103] | +83 / −27 | 75, 0 | −1 [−78, +92] |
| L0 (the bound) | +73 [+10, +163] | +124 / +17 | 95, 0 | +57 [−35, +170] |

- **By book, L2 aligned on "with Euros"**, £/yr: USDC-GBP +25 [+5, +50]; USDT-GBP +7; USDC-EUR +13 [+0.2, +33];
  USDT-EUR +21.
  - Per trip on the four books: 9.9 / −0.1 / 7.5 / 0.6 bps with Yahoo, 14.0 / 11.5 / 15.7 / 8.8 with L2.
  - The faster fair is filled less often and better. The 62 trips it does not make were the ones the stale fair gave away.
- **Caveats.**
  - 19 and 16 days. The gain is mostly the first half's.
  - The source alone moves the weekend arm by −£25 to −£61. With Exness's own EUR level (`raw`), half the base arm's gain
    goes, because EURUSD=X sits 2.8 bps over Exness and every EUR book's fair moves with it. Which level is right is the
    recorder's comparison's question (§4: against Dukascopy and TrueFX).

### 7.6 OKX, the twins' engine (`results/okx_summary.json`)

- **EURC-USDC** (2026-10-21 → 10-29 after a warm-up day; €50 a rung; its 0.001 step is about 9 bps): par (Yahoo) 44 trips
  €3.78.
  - L2 aligned: 46 trips, €4.15, +€0.046 a day (day bootstrap 5 %–95 % +€0.001 to +€0.103).
  - L0: +€0.001 a day. L60: +€0.061 a day.
  - No shape: the grid is wider than any FX timing.
- **USDG-EUR**: one day after warm-up (5 trips). Nothing can be read.

### 7.7 Reconciled with the earlier findings

- **Revolut X: a faster X is worth about nothing.** The 2026-09-28 fast-X study and REVX-FAIR said so; this says so again,
  with LIVE's own engine and a 2 s feed.
- **Coinbase: the "bounds" were one ladder, and Yahoo sits below its first rung.** The CB/OKX study's history engine read
  Exness's minute close at t (L60 here). Its "a minute staler" (−£11) and "FX of minute t, look-ahead" (+£38) were the
  steps either side of that. On the production window:
  - Yahoo → L60 is **+£30 a year**: Yahoo's bar is the price of about t − 32 s, not the close.
  - L60 → L0 is **+£43**: the study's +£38 again, out of sample.
  - The +£38 was look-ahead only against the paper rule's "data to t − 1". For an order that rests from t + 60 s it is the
    price at go-live, which a feed read at placement can have.
  - L2, a feed read 2 s before, makes **+£66 of the +£73** (90 %). Its share of the L60 → L0 step is 83 %.
  - The differences among L0, L2, L5 and L15 are inside the noise (L5 +£33, L15 +£73). The defensible statement: a feed
    read within about 15 s of placement captures most of the bound, and one read at Yahoo's timing captures none of it.
- **To capture it, the rule would change, not only the source.** The engines decide minute t on data to t − 1 by their
  pre-registrations; the gain needs X read at placement. The Coinbase paper engines run a minute behind on recorded data, so
  they could read the recorder's `fx_ticks` at t + 58 s. That is a rule change: a pre-registration, Davies' word, and the
  recorder's §4 comparison first.

### 7.8 Files

`backtests/fx_speed/`, all keyless and read-only:
- `scripts/exness.py` (the archives → `data/exness_offsets.txt.gz`) and `scripts/manifest.py` (→ `MANIFEST.json`);
- `scripts/fast.py` (the candidates' X);
- `scripts/yahoo_timing.py` → `results/yahoo_timing.json`;
- `scripts/revx.py` → `results/revx.json` (about a minute);
- `scripts/cb.py` → `results/cb.json`;
- `scripts/okx_prep.py`, which takes `fair_price_cb_okx/scripts/okx_replay_prep.py`'s output, then `okx_replay.ts` and
  `okx_replay_summary.py` → `results/okx_runs.json`, `results/okx_summary.json`.

No production table was read for this part beyond the studies' committed pulls. Paper money only.

## 8. The long backtest: every Coinbase arm, two years of ticks (FX-SPEED-LONG)

Davies, 2026-10-29: "coinbase的所有策略用更多秒级数据更长时间再深度回测验证下，如果还是正向优化的话把所有coinbase策略的汇率数据源从yahoo换为刚才研究的最佳秒级数据源+fallbacks"
(backtest every Coinbase strategy again on more second-level data over a longer time; if it is still an improvement, switch every
Coinbase strategy's FX source from Yahoo to the second-level source with its fallbacks). §7.5 had 19 and 16 days. This is two
years, every arm as it runs from 2026-10-29, and the rule a switch could actually run. No engine was changed: the switch is a
separate build.

### 8.1 Answers first

**A switch passes on every Coinbase arm.** The rule (b): read the newest `fx_ticks` quote received by t + 58 s, modelled with
1 s of source age (L3). Compared with today's Yahoo-timed X (a), on 738 days of history:

| arm | in sample, 2024-10-01 → 2025-11-20 (416 days) | **out of sample, 2025-11-21 → 2026-10-08 (322 days)**, £/yr [90 %], P(≤ 0) | months positive | verdict |
|---|---|---|---|---|
| "with Euros" (base, 4 books, $100 a rung) | +£70.5 [+47.2, +95.6] | **+£25.5 [+12.9, +40.3], 0.0000** | 23 of 25 | **switch** |
| "- 1" (weekend hold, 4 books, $100) | +£77.9 [+52.1, +105.8] | **+£31.3 [+17.9, +46.8], 0.0000** | 23 of 25 | **switch** |
| "- 2" (USDC books, $50) | +£19.5 [+11.6, +27.7] | **+£5.9 [+2.2, +10.1], 0.0029** | 23 of 25 | **switch** |
| "- 3" (nudge, USDC-GBP, $50) | +£7.3 [+2.4, +12.4] | **+£3.2 [+0.3, +6.4], 0.032** ("- 2"'s USDC-GBP, §8.6) | 20 of 25 | **switch** (by proxy) |

- **The bar was fixed before any run was read** (`cb_long_stats.py`'s docstring): L3 beats (a) out of sample with P(≤ 0) < 0.10,
  its mean is above zero in sample too, and at least two thirds of the calendar months are positive. All four arms clear it.
  So do L5 (3 s of source age), L2, L0 and L3 at TrueFX's own level, on every arm (§8.4).
- **The size of it.** On the base arm the fast X adds about a fifth: the arm made £129 a year out of sample on (a) and
  £155 on L3 (£405 and £476 in sample). It fills less often and better: 3,325 → 1,862 trips out of sample, 4.8 → 10.3 bps a trip.
- **It is not front-loaded over two years.** The monthly gain is positive in 23 of 25 months on the base arm. It is largest in
  volatile months (April 2025, +£23.7 in the month) and small since December 2025 (+£0.3 to +£8.3 a month, one month
  −£0.32). The 19-day window of §7.5 sat at the small end, and production confirms only the sign (§8.5).
- **The level is a tie.** Exness's level (TrueFX's, what `fx_ticks` brings as it is) and Yahoo's (+2.82 bps on EUR/USD) differ
  by £0.2–3.5 a year in sample: base raw +£73.0 against aligned +£70.5; "- 1" aligned +£77.9 against +£74.4; "- 2" +£19.5
  against +£19.3. The stated rule reads the level on the in-sample half alone. Aligned wins two arms of three, by too little to
  matter. Raw drops Yahoo altogether and passes every arm too (§8.4).

### 8.2 The data (all keyless, read-only)

- **Exness's tick archives, GBPUSD and EURUSD, 2024-09 → 2026-10**: 52 monthly zips, 491 MB, 72,847,426 ticks, none with its ask
  under its bid (`MANIFEST_long.json` has each URL, sha256, size and count).
  - Plain GETs, no headers changed. The September and October 2026 files are §7's, with the same sha256.
  - `scripts/exness_long.py build` turns the zips into one per-minute file (17.9 MB, not committed; its uncompressed sha256 is in
    the manifest). For each minute it holds the tick count and the last mid at 0, 28, 30, 45, 55, 57 and 58 s, '-' past ten
    minutes old.
- **Coinbase USDT-USD one-minute closes** for `cb_live`, 2024-09-29 → 2025-11-19: 596,584 minutes, through the CB/OKX study's
  `fetch_cb_usdt.py` (`data/cb_usdtusd_1m_2024-09-29_2025-11-19.json.gz`). Its two committed files continue them to 10-29.
- **Coinbase's four books**: SCQ-VENUES' minute bars, 2024-10-01 → 10-08, proven to replay as the prints do. **The production
  record** 10-10 → 10-28: the CB/OKX study's pulls.
- **The release calendar**: `cbreview/inputs/release_calendar.json`, 2024-10 → 2026-12, the list `cb_releases.ts` was cut from.
- **Revolut X's USDC-GBP book** for "- 3": REVX-FAIR's `rx_mid_USDC-GBP.txt.gz`. It is recorded only from 2026-10-09.
- **Yahoo** answered this machine 429, so its history was not read. The request was not repeated.

### 8.3 What the engine reads, and when (the timing, exactly)

- **When minute t is decided.** `stepMinute` prices minute t's orders on data before t. They go live at t + 60 s (`live: t + M`),
  where they face minute t + 1's prints. The paper call decides minute t only once the recorder has covered it.
  `cb_quote_state` showed minute 08:26 decided at 08:28:00.5 UTC on 2026-10-29: t + 120.5 s.
- **(a) Today.** `fxBarAt` reads Yahoo's newest bar that started in [t − 10 min, t − 1 min]: bar t − 1 in 18,158 of 18,573 lit
  USDC-GBP minutes of 10-10 → 10-28, an older bar in the rest (`cb_quote_minutes.x_t`). That bar is the price of about t − 32 s
  (§7.2).
  - **Reconstruction:** Exness at (t − 1 min) + 28 s, × (1 + 0.33 bps) for GBP/USD and × (1 + 2.82 bps) for EUR/USD. These are
    §7.2's levels, taken as constant over the two years because Yahoo's older bars could not be read.
  - A bar exists when Exness has a tick in its minute. The base arm goes dark ten minutes after the newest bar; the held arms
    hold it up to 60 hours.
  - **The reconstruction against the real bars, 10-10 → 10-28:** 0.36 bps mean absolute on GBP/USD (p95 0.99) and 0.69 on
    EUR/USD (p95 1.12; Yahoo moves EUR/USD in 1.1 bps steps). Mean error −0.04 and −0.10 bps.
  - The reconstruction against the real bars in P&L (§8.5): base +£5.4 a year [−£13.4, +£24.3], "- 1" −£20.5 [−£72.0, +£24.7].
    Unbiased within noise.
- **(b) The switch, as it could run.** The paper call runs after t + 60 s, so `fx_ticks` then already holds quotes from after
  go-live. Reading the newest row would look ahead into the prints the orders face. The implementable rule therefore caps what
  it reads: the newest TrueFX (or marked fallback) read **received at or before t + 58 s**.
  - That read carries its source's age: TrueFX's quote was a median 1.4 s old on arrival, and it steps every 2–3 s (§2).
  - Modelled on Exness's ticks (about one every 2 s in London hours, so every instant already carries a tick's age):
    - **L3**: Exness's last tick at or before t + 57 s, the rule with 1 s of age. This is (b).
    - **L5**: at t + 55 s, 3 s of age, the slow edge.
    - **L2**: at t + 58 s, §7's primary, no age.
  - A missing value (no tick for ten minutes) is the last one known. Inside a closure every X is held as its arm holds it.
- **(c) The bound, L0**: Exness at t + 60 s, the price as the orders go live.
- **L60**: Exness at t. This is what the CB/OKX study's history engine read (its minute close of bar t − 1).
- **Levels.** "Aligned" carries Yahoo's level (the constants above). "Raw" (`L3_raw`, `L2_raw`, `L0_raw`) is Exness's level,
  which is TrueFX's (§2: EURUSD=X +2.87 bps over TrueFX, +2.82 over Exness): what `fx_ticks` brings with nothing carried over.

### 8.4 Method and results

- **The engine: PR5's frozen `pr5_sim.simulate`, imported unchanged**, through SCQ-VENUES' `BarBook` on the history and the
  faithfulness check's `MinuteBook` on the production record.
  - **Anchor:** on the CB/OKX study's terms (£/€100 a rung, Yahoo, `cb_live`), the production replay reproduces its committed
    runs trip for trip on all eight arm-book pairs.
- **The arms as they run from 2026-10-29.**
  - A rung in dollars: $100 on the base and "- 1", $50 on "- 2" and "- 3". The sizing X is the currency's dollar rate,
    Exness at the minute's start, the same for every candidate.
  - **The coin:** `cb_live`, with the 50 bps de-peg guard against Revolut X's F3 from 2025-11-22. Before that there is no
    reference, so no guard. Over the two years, 852 USDT minutes had no coin value: no candle in ten minutes, or the guard.
  - **The releases:** the [T − 1, T + 5] blackout around every listed release, 665 minutes.
  - Coinbase's taker plus half the touch on a stop. P&L in pounds at the exit minute's GBP/USD.
  - Only F, the fair, differs between candidates. Each arm's dark minutes are the same for all of them.
- **Scoring.**
  - Paired with (a) by the UTC day of each trip's exit, a day with no trip counting zero. Bootstrap: 3-day circular blocks,
    10,000 draws, seed 20261029.
  - **In sample** is 2024-10-01 → 2025-11-20; nothing was chosen on it but the level (§8.1). **Out of sample** is 2025-11-21 →
    2026-10-08, the CB/OKX study's history window, which no FX-timing choice here had read.
  - The windows were fixed in `cb_long.py` before any run.
- **Runs.** 100 runs on the history (1,062,720 minutes a book) and 121 on the production record, plus the 8 anchors. About six minutes on four cores.

**All books, £/yr against (a), out of sample [90 %] and P(≤ 0)** (in sample in brackets after):

| candidate | base | "- 1" | "- 2" |
|---|---|---|---|
| a_raw (timing of (a), Exness's level) | +11.8 [+2.9, +21.2] 0.012 (IS +7.0) | — | — |
| L60 (Exness at t) | +13.1 [+2.8, +23.5] 0.016 (IS +21.6) | — | — |
| **L3 = (b)** | **+25.5 [+12.9, +40.3] 0.0000 (IS +70.5)** | **+31.3 [+17.9, +46.8] 0.0000 (IS +77.9)** | **+5.9 [+2.2, +10.1] 0.003 (IS +19.5)** |
| L5 (3 s of age) | +30.8 [+18.5, +45.3] 0.0000 (IS +76.3) | +37.1 [+23.9, +52.2] 0.0000 (IS +80.9) | +7.3 [+3.2, +11.7] 0.0004 (IS +21.8) |
| L2 | +27.8 [+14.5, +42.9] 0.0001 (IS +85.4) | +32.9 [+18.9, +48.4] 0.0000 (IS +92.5) | +6.3 [+2.2, +10.8] 0.004 (IS +23.1) |
| L0, the bound (c) | +24.1 [+10.9, +39.9] 0.0001 (IS +77.8) | +29.8 [+15.9, +46.2] 0.0000 (IS +83.6) | +3.9 [+0.2, +8.4] 0.042 (IS +18.7) |
| L3_raw (TrueFX's level) | +26.8 [+12.9, +42.6] 0.0001 (IS +73.0) | +28.0 [+12.4, +45.5] 0.0005 (IS +74.4) | +4.5 [+0.0, +9.4] 0.049 (IS +19.3) |

- **L0, L2, L3 and L5 are one plateau.** Their differences are inside the noise: L5 above L0 is not a real effect. As in §7.7,
  a quote read within a few seconds of go-live captures the bound. A mid-minute bar (Yahoo's) and a minute close (L60) capture
  much less of it.
- **The CB/OKX study's history engine read L60.** Its absolute figures were therefore about £13–22 a year better than
  production's real timing on the base arm. Its comparisons between fairs are unaffected: every fair there shared the same X.

**Each arm's own record** (L3 against (a); out of sample, then in sample):

| arm | (a): £, trips, stops, bps a trip, worst day | L3: £, trips, stops, bps a trip, worst day |
|---|---|---|
| base, OOS | £114.03, 3,325, 82, 4.80, −£4.76 | £136.54, 1,862, 95, 10.31, −£0.76 |
| base, IS | £461.51, 9,402, 200, 6.51, −£4.31 | £541.86, 5,837, 219, 12.21, −£4.27 |
| "- 1", OOS | £154.72, 3,977, 215, 5.46, −£4.76 | £182.35, 2,489, 230, 10.38, −£2.00 |
| "- 1", IS | £552.35, 10,440, 425, 7.03, −£4.04 | £641.14, 6,829, 454, 12.40, −£3.47 |
| "- 2", OOS | £26.04, 1,434, 85, 4.95, −£1.34 | £31.22, 773, 91, 11.01, −£0.50 |
| "- 2", IS | £106.19, 4,302, 222, 6.52, −£0.95 | £128.43, 2,697, 227, 12.56, −£0.97 |

- Stops rise slightly, by 2 to 16 %. Their cost is inside the figures above.

**By book, L3 against (a), £/yr out of sample [90 %], P(≤ 0); months positive of 25:**

| book | base | "- 1" | "- 2" |
|---|---|---|---|
| USDC-GBP | +7.2 [+1.7, +13.4] 0.013; 20 | +6.4 [+0.5, +12.8] 0.035; 20 | +3.2 [+0.3, +6.4] 0.032; 20 |
| USDT-GBP | +5.2 [−0.4, +11.3] 0.064; 16 | +8.5 [+2.3, +15.0] 0.012; 18 | — |
| USDC-EUR | +4.3 [+0.9, +8.2] 0.015; 19 | +5.2 [+1.5, +9.4] 0.010; 20 | +2.6 [+0.7, +4.7] 0.010; 20 |
| USDT-EUR | +8.8 [+4.0, +13.7] 0.0005; 19 | +11.2 [+6.1, +16.5] 0.0000; 20 | — |

- Every book is positive in both halves. The weakest is the base arm's USDT-GBP: 16 of 25 months, just short of two thirds,
  and P 0.064.
- The level matters most on USDT-EUR. Its 0.00001 step resolves Yahoo's 2.82 bps: today's level alone (`a_raw`) is +£9.1 a year
  out of sample there.

**By month, L3 against (a), base arm, £:**
- 2024-10 −0.43, 11 +2.23, 12 +2.26.
- 2025-01 +12.44, 02 +8.69, 03 +3.36, 04 +23.71, 05 +6.61, 06 +3.51, 07 +4.78, 08 +6.47, 09 +2.34, 10 +2.07, 11 +3.21,
  12 +0.70.
- 2026-01 +0.35, 02 +0.80, 03 +8.27, 04 +3.62, 05 +0.62, 06 +2.32, 07 −0.32, 08 +0.62, 09 +3.59, 10 (to 10-08) +1.04.

"- 1" has the same shape: negative in 2024-10 and 2026-07 only. "- 2" is negative in 2024-11 and 2026-02. The gain scales with
how much GBP/USD and EUR/USD move inside a minute, and with what the arm earns at all. Both fell from 2025 to 2026.

### 8.5 The production record, 2026-10-10 (10-13) → 10-28, against Yahoo's real bars

| arm | (a) reconstructed vs Yahoo | L3 vs Yahoo, £/yr [90 %], P(≤ 0) | L0 vs Yahoo | Yahoo's own record |
|---|---|---|---|---|
| base (19 days) | +5.4 [−13.4, +24.3] | +32.4 [−12.4, +94.2], 0.19 | +64.7 [+15.7, +136.1], 0.0000 | £6.41, 159 trips |
| "- 1" (16 days) | −20.5 [−72.0, +24.7] | +15.0 [−60.4, +101.1], 0.41 | +51.2 [−28.7, +143.3], 0.18 | £7.29, 173 trips |
| "- 2" (16 days) | +2.0 [−17.1, +20.8] | +5.7 [−17.8, +30.1], 0.36 | +15.5 [−6.6, +38.0], 0.14 | £3.29, 100 trips |
| "- 3" (16 days, real nudge) | +3.3 [−3.5, +10.6] | +6.0 [−7.3, +20.3], 0.25 | +11.4 [+1.4, +22.5], 0.024 | £2.69, 66 trips |

- **The signs agree with the history; the production weeks alone decide nothing.**
- §7.5's +£66 on the base arm was L2 with a trailing Yahoo offset and £/€ rungs. Here L2 is +£12.6 on USDC-GBP and +£11.5 on
  USDC-EUR. The differences between the two runs are the dollar rungs, the guard and the offset.

### 8.6 "- 3", the nudge arm

- **"- 3" is "- 2"'s USDC-GBP outside FX closures.** Its nudge acts only inside them, where every X is held, so a faster X
  changes "- 3" only through its weekday fair.
- **The nudge could not be replayed on the history.** Revolut X's book starts 2026-10-09; its prints, 45 a day, are not its mid.
- **How much of "- 2"'s USDC-GBP gain falls inside closures:** for trips entered in a closure, −£0.2 a year in sample and −£0.1 out
  of sample. For trips entered outside, +£7.4 and +£3.4.
  - So "- 3"'s history verdict is "- 2"'s USDC-GBP: +£7.3 in sample, +£3.2 out of sample [+0.3, +6.4], P 0.032, 20 of 25 months.
  - On the production record with its real nudge: +£6.0 against Yahoo [−£7.3, +£20.3], P 0.25.

### 8.7 What this does not show, and what a build needs

- **TrueFX's history is not Exness's.** The recorder's §4 comparison measures TrueFX's lag and coverage, and Kraken's, against a
  tick reference. L5 (3 s of age) still passes every arm, so a feed up to about 3 s slower than modelled loses nothing
  measurable.
  - The fallback (Kraken, 2 s behind TrueFX, EUR/USD 1.3 bps under) was not modelled separately. It sits inside L5's age; its
    level offset is smaller than the tie in §8.1.
- **Yahoo's level before September 2026 is assumed.** 0.33 and 2.82 bps were measured on 09-20 → 10-28. The comparison on raw
  levels (L3_raw against a_raw: the same level on both sides) is not exposed to that assumption, and it passes too.
- **The history is minute bars,** proven equal to the prints for this simulator. The one-minute rule and the 24-hour stop are
  the engine's. No queue, latency or fee change was modelled beyond §8.3's timing.
- **The switch is a rule change for each arm's pre-registration.**
  - X at t + 58 s by arrival, rather than Yahoo's bar t − 1.
  - Darkness from `fx_ticks`' freshness: TrueFX healthy or Kraken marked.
  - Yahoo kept, or not, for the level.
  - It is a deviation for every Coinbase arm, a migration and an engine change. Here, nothing was changed.

### 8.8 Files

`backtests/fx_speed/`:
- `scripts/exness_long.py`: fetch, build, manifest. Writes `MANIFEST_long.json`, the 52 zips' sha256 and the derived file's.
- `scripts/cb_long.py`: the runs. Its output (4.1 MB) is not committed.
- `scripts/cb_long_stats.py` → `results/cb_long.json`: every pairing, record, month and verdict, and the anchor.
- `data/cb_usdtusd_1m_2024-09-29_2025-11-19.json.gz`.

To run it again: `python3 -I scripts/exness_long.py fetch <dir>`, then `build <dir> X.txt.gz`, then
`python3 -I scripts/cb_long.py X.txt.gz runs.json.gz`, then `python3 -I scripts/cb_long_stats.py runs.json.gz results/cb_long.json`.

One production read was used: `cb_quote_minutes.x_t` and `cb_quote_state`, for §8.3's timing. Paper money only.

## 9. The long backtest on Revolut X: LIVE and four testing rows (FX-SPEED-RX)

Davies, 2026-10-29: "同样的长期回测在revolut x的live和几个有代表性的testing策略也测一遍，看看有没有优化，有的话也全面改，没有的话解释下为什么"
(run the same long backtest on Revolut X's LIVE and a few representative testing strategies; if it improves them, change them
all, and if not, explain why).

### 9.1 Answers first

**No Revolut X row passes, and nothing is changed.** For the rule as it could run (b), the change against today's X (a) is
inside ±£8 a year on every row, out of sample and in sample alike:

| row | in sample, 2025-11-26 → 2026-05-12 | **out of sample, 2026-05-12 → 10-29**, £/yr [90 %], P(≤ 0) | months positive | verdict |
|---|---|---|---|---|
| LIVE's rules, £600 (`live600`) | +£1.5 | **−£2.0 [−13.2, +9.3], 0.61** | 4 of 12 | no |
| variant-1, £1,200 (`live1200`) | +£2.2 | **−£4.6 [−26.5, +17.8], 0.64** | 4 of 12 | no |
| variant-2, TAKE's maker side (`take50`) | −£7.5 | **−£1.8 [−8.2, +4.6], 0.68** | 4 of 12 | no |
| variant-5, USDT 3:1 (`n600usdt3`) | +£2.8 | **+£4.0 [−10.3, +18.5], 0.33** | 7 of 12 | no |
| variant-7, the Coinbase nudge (`u300nudge`), 10-14 → 10-29 only | — | −£0.9 [−10.1, +8.8], 0.57 (15 days) | — | no evidence |

- **Even the bound earns nothing.** L0, the price as the orders go live (c), gives LIVE −£1.2 a year out of sample
  [−13.1, +10.9]. No feed, however fast, can beat that.
- **Nothing else passes either.** The other timings run, by row out of sample: (b) at TrueFX's level, 3 s of age, the
  executor's own turn, and a minute close. They range from −£6.4 to +£7.2 a year, and every P(≤ 0) is 0.14 or more, so
  none clears the bar.
- **The scale.** LIVE's rules made £370 in sample and £250 out of sample on (a) in this replay. The fast X moves that by
  under 1 %.
- **Its own record barely moves.** LIVE in sample: 4,951 → 4,923 trips, 16.61 → 16.77 bps a trip, stops 53 → 53. On
  Coinbase the same switch cut trips by 44 % and doubled the bps a trip (§8.4).
- **Why Coinbase gains and Revolut X does not** (§9.4): the X error is equally small on both venues (median 0.6–0.7 bps),
  but on Coinbase the counterparties trade on that error and on Revolut X they do not.
  - Coinbase's GBP books carry a fifth of a GBP/USD move within the minute and print 3,300–4,300 times a day, so a stale
    quote is picked off.
  - Revolut X's carry 2 % in the first minute and 7–16 % in two. They print 79 (USDC-GBP) and 587 (USDT-GBP) times a day,
    and their fills do not follow the minute's FX move.

### 9.2 The history and how it is filled

- **Revolut X UK's every public print**, read keylessly from `/api/1.0/public/trades/all`. It is the committed nine-month tape
  (`inputs/pr5_2026-09-23`: prints from 2025-10-01; scored from the listings, USDC-GBP 2025-11-26 and USDT-GBP 2025-12-16,
  to 2026-09-23).
- **Then the recorded minute record and prints of 2026-09-26 → 10-29** (REVX-FAIR's `fair_price/data`). Two days,
  09-23 → 09-26, are missing between them. There is nothing before the listings.
- **No candle is used.** Revolut X's minute candles move on quotes while nothing trades. Every fill here is a public print
  through a resting price (or at it, LIVE's "at"), by the print's own size, as the PR5-OPT engine fills.
  - What the tape lacks is the book. A post-only refusal is judged against the last print, not a recorded touch.
  - TAKE's taker leg cannot be replayed at all: 13 IOCs in 36 days, each needing a recorded book. Only its maker side is
    here.
- **fairU** is the USD books' 24-hour median of hourly closes: the tape's candles, then the minute record's.
- **GBP/USD** is Exness's ticks, the same archives as §8 (`MANIFEST_rx.json`): 16.4 M GBPUSD ticks, 2025-11 → 2026-10.

### 9.3 What LIVE reads, and when

- **The paper turn of minute t** uses data to t − 1. The paper call decides it 25 s into the next minute, at t + 85 s
  (`QUOTES_START_MS`).
- **LIVE's executor sends the orders about 30 s into that minute.** In production, 1,584 live orders in the 7 days to
  2026-10-29 went a median 32.4 s after `paper_live` (= t + 60 s), 5 %–95 % 29.5–91 s. The replay rests them at t + 90 s.
- **(a) today:** Yahoo's bar of t − 1, the price of about t − 32 s (§7.2), × (1 + 0.33 bps). That is 122 s before the order
  rests.
  - Checked against the real bars on the recorded window: the real Yahoo X made LIVE £19 a year more than the reconstruction
    [−£1, +£41] over 33 days. The other rows: +£33, +£10, −£12. So the reconstruction is unbiased only to within ±£20 a year
    over five weeks. That is about the size of everything below, so the recorded window cannot settle anything alone.
- **(b) the switch as it could run:** the newest `fx_ticks` read received by the decision at t + 85 s, with 1 s of TrueFX's
  age: Exness at t + 84 s, at Yahoo's level. This is the primary, named before any run.
  - Also run: b_raw (TrueFX's level), b_slow (t + 82 s, 3 s of age), b_turn (t + 87 s, read at the executor's own turn).
- **(c) the bound:** t + 90 s, as the orders go live. **x60**: t + 60 s, a minute close read at the paper turn.
- **The bar, written before any run** (`scripts/revx_long.py`, as §8's):
  - out of sample, mean > 0 and P(≤ 0) < 0.10 (3-day circular blocks, 10,000 draws, seed 20261029);
  - in sample, mean > 0;
  - at least two thirds of the calendar months positive.
- **The rows, as `agent_quote_twin_specs` has them:**
  - `live600`: LIVE's rules, £600, "at", the weekend on the held X.
  - `live1200`: the same at £1,200.
  - `take50`: PR5's paper rules at £600, fill through only, no weekend.
  - `n600usdt3`: LIVE's rules, USDT-GBP £75 a rung, USDC-GBP £25.
  - `u300nudge`: LIVE's rules on USDC-GBP alone at £37.555 a rung, with REVX-FAIR's Coinbase nudge on top of each
    candidate's fair. Coinbase's touch exists only from 10-10, so it runs 10-14 → 10-29 after 72 h of warm-up, and no bar
    applies.

### 9.4 Why: the numbers (`scripts/why.py` → `results/revx_why.json`)

- **What moves with X.** Fair = fairU / X.
  - fairU is a 24-hour median of hourly closes: it changes at most once an hour and by fractions of a bp.
  - X is the only fast part, so the whole difference between (a) and (b) is X's change between t − 32 s and t + 84–90 s.
- **That change is small, and the same size on both venues.** Over 318,822 weekday minutes:
  - Yahoo's timing against go-live is a median 0.67 bps for Revolut X (t + 90) and 0.60 for Coinbase (t + 60).
  - p90 2.3 / 2.0, p99 5.1 / 4.5 bps.
  - It passes the 5 bps re-price step (0.05 %) in 1.1 % of minutes and the nearest rung, 10 bps, in 0.10 %.
  - The book's step is 1.33 bps. Most minutes the faster X leaves every resting order where it was, on either venue.
- **What differs is who trades against the quote.** The share of a GBP/USD move of 2 bps or more carried by the book's
  prints, 2026-10-10 → 10-28 (slope of the coin's pound price on −ΔX):

| after | 1 min | 2 min | 5 min | 15 min | 60 min |
|---|---|---|---|---|---|
| Revolut X USDC-GBP | 0.02 | 0.07 | 0.18 | 0.34 | 1.23 |
| Revolut X USDT-GBP | 0.02 | 0.16 | 0.41 | 0.60 | 0.87 |
| Coinbase USDC-GBP | 0.20 | 0.22 | 0.30 | 0.34 | 0.46 |
| Coinbase USDT-GBP | 0.24 | 0.27 | 0.39 | 0.40 | 0.54 |

  - Over Revolut X's whole tape (16,500–17,900 moves): 0.02 / 0.04 at one minute and 0.11 / 0.15 at five.
  - Coinbase's minute record stamps each minute's last print at the minute's end. Its one-minute figure is therefore if
    anything late, not early.
  - **Prints a day** (10-10 → 10-28): Revolut X 79 (USDC-GBP; a print in 43 minutes of the day) and 587 (USDT-GBP; 351
    minutes); Coinbase 4,332 and 3,340 (1,236 and 946 minutes).
- **So on Coinbase a stale quote is picked off.** When interbank moves, Coinbase's arbitrageurs carry a fifth of it into the
  book within the minute. They take the quote the move has made cheap. The fresh X moves that quote first: −44 % of trips,
  +5.5 bps each (§8.4).
- **On Revolut X nobody races the rate.** Its prints arrive a few dozen times an hour, from flow that follows GBP/USD over
  quarter-hours, not the minute. A quote a bp stale is filled no more often, and no worse, than a fresh one: trips −0.6 %,
  +0.16 bps a trip. The gain the fast X could have is the size of the noise, and it does not show.
- **The 09-28 fast-X study and REVX-FAIR found the same** (§7.7): a faster X worth about nothing on Revolut X.

### 9.5 Per book

| row: (b) out of sample, £/yr [90 %], P(≤ 0); months | USDC-GBP | USDT-GBP |
|---|---|---|
| live600 | −0.6 [−6.9, +6.1], 0.57; 6 of 12 | −1.4 [−11.7, +8.9], 0.59; 5 of 11 |
| live1200 | −2.3 [−14.6, +9.9], 0.63; 5 of 12 | −2.3 [−21.4, +17.2], 0.58; 5 of 11 |
| take50 | −3.4 [−7.9, +0.9], 0.90; 2 of 12 | +1.6 [−4.5, +7.7], 0.33; 5 of 11 |
| n600usdt3 | +1.5 [−2.4, +5.5], 0.28; 6 of 12 | +2.5 [−11.3, +16.5], 0.39; 5 of 11 |

### 9.6 What it means for a build

- **Nothing is built for Revolut X.** LIVE and its twins keep Yahoo's bar.
  - The recorder (§3) goes on recording, and its comparison (§4) still runs: it is what tells the Coinbase switch whether
    TrueFX's live behaviour matches §8's model.
  - On Revolut X, a faster X is one more source to keep alive for nothing.
- **If anything on Revolut X is to price faster, it is not the FX rate.** The pass-through table says Revolut X's GBP books
  lag interbank by minutes. That is a different question, the venue's own lag against the fair, and the REVX-FAIR study
  (`2026-10-29-revx-fair-price-study.md`) priced the candidates for it.

### 9.7 Files

`backtests/fx_speed/`:
- `scripts/revx_long_ex.py`: the GBPUSD instants from §8's archives. `MANIFEST_rx.json` holds the derived file's sha256; the
  file itself is not committed.
- `scripts/revx_long.py` → `results/revx_long.json`: every run, pairing, month, book, record and verdict. About 4.5 minutes
  on four cores.
- `scripts/why.py` → `results/revx_why.json`: the pass-through, prints and X error.

To run it again: `python3 -I scripts/revx_long_ex.py <zips> rx_ex.txt.gz`, then
`RX_EX=rx_ex.txt.gz python3 -I scripts/revx_long.py results/revx_long.json` and
`RX_EX=rx_ex.txt.gz python3 -I scripts/why.py results/revx_why.json`.

One production read: `agent_quote_live_orders` (`ts`, `paper_live`) and `agent_quote_twin_specs`, for §9.3. Paper money only.
