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
- **No strategy, engine, frozen file or pre-registration was touched.** Whether a faster X earns anything is the historical
  backtest's question and the comparison's (§4), not this note's.

## 6. Files

- `supabase/functions/agents/fx_rec.ts`, `fx_rec.test.ts`; the route in `agents/index.ts` (`startFxRecAction`);
  `supabase/migrations/0172_fx_ticks.sql`; its pin in `src/cron_jobs.test.js`.
- `docs/agents/backtests/fx_second/`: `fixtures/answers_2026-10-29.json` (TrueFX's and Kraken's answers as served, which the
  tests parse); `scripts/sampler.py` (the 1 Hz keyless sampler: `python3 -I scripts/sampler.py OUT.jsonl SECONDS`, with
  `FX_CA_BUNDLE` behind a proxy); `scripts/analyse.py` (`YAHOO=data/yahoo_2026-10-29.txt python3 -I scripts/analyse.py
  results/sample_2026-10-29.json data/sample_2026-10-29.jsonl.gz`); `scripts/cpu.ts` (one real minute of the recorder and
  its CPU); `data/` (the raw sample and Yahoo's stored bars); `results/sample_2026-10-29.json`.
