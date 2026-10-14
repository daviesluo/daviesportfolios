# PMSTATARB verification spec: four Polymarket statistical-arbitrage studies, ready to run

Written 2026-10-14 for the engineer Davies hands this to (Grok Engineer). It verifies the candidate studies of
`docs/agents/reviews/2026-10-14-pm-statarb-deepdive.md` (§4) on historical data. Nothing here is a trading rule, a
paper row or a deployment. **Your deliverable is evidence with a verdict per bar** — scripts, inputs, results and one
write-up — landed through the repository's gates. If a bar fails, the study is closed and you say so; tuning a
parameter after seeing its result and re-running is not verification, it is a new hypothesis for Davies.

## Read first (in this order)

1. `.claude/CLAUDE.md` — the repository's standing rules (ledger, gates, commit identity, docs).
2. `docs/agents/CLAUDE.md` — the agents' rules (venue access, secrets, proof standards).
3. `docs/agents/reviews/2026-10-14-pm-statarb-deepdive.md` — why these four, and what is already closed. Its §2
   lessons are requirements below, not background.
4. `docs/agents/reviews/2026-10-13-polymarket-opportunities.md` §3 and the frozen DEADLINE-NO test
   (`docs/agents/reviews/2026-10-13-deadline-no-2024-prereg.md`, its script
   `docs/agents/backtests/pmopps/scripts/deadline_no.py` and its result
   `docs/agents/reviews/2026-10-13-deadline-no-2024-result.md`) — the house shape for a historical test: frozen bar, prints-based fills,
   event bootstrap, an honest FAIL.
5. `docs/agents/backtests/pmopps/scripts/pull_closed.py` — the keyset pattern for resolved markets, to adapt in G1.

## Hard rules (each one has cost money or a day in this repository)

1. **Read-only against production.** Keyless public GETs (Gamma, CLOB, data-api, Kalshi public, spot exchanges) and,
   if your seat has it, read-only SQL selects. No database writes, no migrations, no config changes, no orders, no
   signing, on any venue, ever. Kalshi is a price reference only — no account, no trading there.
2. **No tradable price may come from `/prices-history` alone** (it lags the book by minutes). Every entry price is a
   print from the data API through your side, with the stated tick haircut. Prices-history may shortlist and may
   measure timing only where its lag is itself measured.
3. **Settlement texts decide windows, never end dates.** For every market family you trade in the study, read three
   sample descriptions end to end and quote the settling sentence in your results (G4). A pair or bucket whose clause
   you have not read is excluded, and the exclusion is counted.
4. **Fees at source, in every fill.** Polymarket taker fee per category from G4's table (crypto `0.07·p·(1−p)` of
   shares today — re-verify, do not copy this line). Maker arms state their adverse-selection evidence separately;
   no result may mix maker income with taker fills.
5. **Parameters are frozen in your first commit**, before the pull that can answer them: entry hours, deviation
   thresholds, stakes, seeds, bars. Neighbours of every tuned-looking number are computed and reported whatever
   they say.
6. **Secrets are never printed, committed or put in a URL.** The site password, and any fragment or masked specimen
   of it, never appears in any file or commit message; write `?pwd=…`.
7. **The ledger moves with the work** (`.claude/CLAUDE.md`): every landing commit carries its `docs/LEDGER.md` line
   with a source header, identity `daviesluo <daviesluo@gmail.com>`, pushed only on `all gates green` from
   `sh bin/gates.sh` on the exact tree. Davies is reported to in Chinese; everything committed is English.

## Order of work and dependencies

G1 → G2 → S1 and S2 (either order after G2) · G4 in parallel (S1/S2 need its fees and clause table) · G3 → S3 ·
S4 any time (needs only G4's sports fees and one busy game day). Land each G-step as its own commit so a later step
never re-pulls what a manifest already pins.

---

## G1 — The resolved universes (mechanical pull)

**Objective.** One CSV per family of every resolved BTC/ETH market in: daily and weekly **reach** (touch up),
**dip** (touch down), **above/below on a date** (terminal), and **price-on bucket partitions**, from 2024-01-01 to
2026-09-30, keylessly from Gamma.

**Method.** Adapt `pmopps/scripts/pull_closed.py` (Gamma keyset by `id` cursor over `closed=true`, ordered by id;
never `order=volume` with an offset — it trips the offset cap). Filter in code by question patterns. Parse from each
question: asset, strike, the window's start and end **dates from the title**, type (touch_up / touch_dn / above /
below / bucket with lower and upper bounds). Unparsed questions go to their own CSV, never dropped silently.

**Columns (exactly).** `conditionId, question, event_title, asset, type, strike, bound_lo, bound_hi, title_start,
title_end, endDate, closedTime, payout_yes (0/1 from outcomePrices of the resolved market), volume, clobTokenIds_yes`

**Acceptance.**
- Row counts printed by family × month; the unparsed list printed with its count.
- 10 rows spot-checked by hand against the live Gamma pages (strike, dates, payout) and the check noted in results.
- `data/` CSVs + regenerated `MANIFEST.json` (sha256 per file) committed; re-running the script reproduces the CSVs
  byte-for-byte except rows resolved since.

## G2 — Entry-window history and prints (mechanical pull)

**Objective.** For every G1 market: (a) CLOB `/prices-history` hourly from T−96 h to resolution (for shortlisting and
timing only); (b) data-api `/trades` prints in the windows the studies enter at (T−72 h, T−24 h, T−12 h, T−48 h —
pull T−96 h → resolution once and let the studies slice). Spot series for the settlement pairs (BTC/USDT, ETH/USDT)
at 1-minute from a keyless public read that works from your seat (Binance public klines if reachable; otherwise
state the substitute and its basis against Binance on an overlapping day — the settlement feed is Binance, and a
proxy feed is a stated approximation, never a silent one).

**Acceptance.**
- A coverage table per family: markets with ≥ 1 print within 1 h after each named entry hour, as counts and shares.
  This decides whether S1/S2's bars are reachable; if coverage cannot reach their minimum n (below), stop and
  report **not run, coverage** with the counts — do not widen windows to manufacture trades.
- Print files store raw rows (timestamp, price, size, side, token); no aggregation at pull time.
- Manifest updated; total committed data size stated in the commit message.

## G4 — Fees and settlement clauses at source (mechanical, do early)

**Objective.** One table: Polymarket's current taker fee rate per category relevant below (crypto daily/weekly price
markets, sports), the USDC merge/split and redemption costs if stated, Kalshi's candle/trade field definitions used
in G3 — every figure with its source URL and the date read. Plus, for each G1 family, the settling sentence quoted
from three sample markets' descriptions (which feed, which candle field — High/Low/Close — which instant or window,
which timezone).

**Acceptance.** Anything not found at source is written as "not found at source", never filled from memory.

## G3 — The Kalshi–Polymarket matched panel (mechanical pull + mapping)

**Objective.** Matched 1-minute series for market pairs that settle the same event on both venues: BTC hourly/daily
ranges and the Fed decision markets, 60 days back from the pull date. Kalshi: public candlesticks
(`GET /trade-api/v2/series/{series}/markets/{ticker}/candlesticks`, `period_interval=1`, `start_ts`/`end_ts`
required) and `/markets/trades`. Polymarket: data-api prints aggregated by you to 1-minute (last print and traded
mean per minute — both kept), **not** `/prices-history`.

**Mapping rule (state it before pulling).** Same underlying, same strike semantics after unit conversion, close
times within 2 h. Publish the pair table with both tickers, both close times, and the leftovers that matched
nothing on either side. No silent drops, no fuzzy title matching without the strike equality printed.

**Acceptance.** Per pair: minutes covered, prints counted per venue, the share of minutes with a print on both
sides. Pairs under 500 joint minutes are listed as thin, not deleted.

---

## S1 — TOUCH-CAL: are touch prices calibrated against the reflection relation?

**Claim under test.** At fixed hours before expiry, daily/weekly reach/dip markets deviate from a driftless-GBM
one-touch price (spot and trailing realised volatility at entry, computed on the settlement feed's own closes) by
more than taker fees plus a tick, systematically enough that buying the cheap side held to resolution clears the bar.

**Frozen inputs (commit these before the first result).** Universe G1 touch_up/touch_dn, 2025-01-01 → 2026-09-30
(2024 reported beside it if G1's coverage holds, never tuned on). Entries at T−72 h, T−24 h, T−12 h before the
window's end (all three reported; T−24 h is the headline). Volatility: stdev of daily log closes, trailing 30 days,
× √365, closes strictly before entry. Model: closed-form driftless-GBM one-touch with continuous monitoring **and**
the Broadie–Glasserman–Kou discrete-monitoring correction for 1-minute candles; the verdict uses the corrected
figure, both printed. Trade when `|market − model| ≥ max(0.04, fee + 2 ticks)` at the fill price (neighbours 0.03
and 0.05 reported). Fill: first print at/after the entry hour on your side, one tick worse, stake $20 notional
($50 reported beside). One trade per market per horizon.

**Bar (PASS requires all).**
1. ≥ 150 trades across ≥ 100 distinct markets at the headline horizon.
2. Mean ROI on stakes, after fees, > 0, and the 5 % bound of a 10,000-draw bootstrap resampling whole markets
   (seed 20261014) above −2 %.
3. Both neighbouring horizons and both neighbouring thresholds have the same sign of mean ROI.
4. No single market contributes over 25 % of total P&L; no single calendar month over 50 %.
5. Each calendar year separately no worse than −5 % mean ROI.

**Also report, whatever the verdict.** Calibration table by model-probability decile (predicted vs realised touch
rate); the touch/terminal mid ratio against the model's ratio for same-window pairs; how the result moves if fills
are priced off `/prices-history` instead (the fp4 gap, for scale). **A FAIL closes TOUCH-CAL**; a follow-on with
different parameters is a new proposal to Davies, not a re-run.

## S2 — BUCKET-DIST: is the daily bucket distribution the wrong shape?

**Claim under test.** In daily BTC/ETH price-bucket partitions, buckets whose market price deviates from the same
lognormal benchmark (spot, trailing-30-day realised vol, driftless) by ≥ 4 probability points at entry earn their
deviation back by resolution, net of fees, whichever side is rich — centre or tails.

**Frozen inputs.** Universe G1 bucket partitions with ≥ 7 buckets, 2025-01-01 → 2026-09-30. Entries T−24 h
(headline), T−12 h and T−48 h neighbours. Threshold 4 points (neighbours 3 and 5). One trade per bucket per horizon;
$20 stake ($50 beside); fills from prints as S1. The model's vol is trailing and close-based as S1; the benchmark's
own calibration on the same days (market sum of mids per partition) is printed beside.

**Bar.** S1's five conditions with the bootstrap resampling **whole days** (a partition settles together), plus:
the result must not be carried by one side alone — report centre-bought and tail-sold (and their reverses)
separately, and if only one side earns, the verdict names it a one-sided result for Davies to judge, not a PASS.

## S3 — KALSHI-LEAD: does Kalshi move first, by minutes or by seconds?

**Measurement, no trading rule.** On G3's panel: cross-correlation of 1-minute mid/print returns at lags −5…+5
minutes per pair and pooled; and the event study: every Kalshi 1-minute move ≥ 2 ¢, Polymarket's same-direction
move over the next 1/2/3/5 minutes net of Polymarket's taker fee, entered at the first Polymarket print after the
Kalshi minute closes. Report counts, hit rate, mean and the bootstrap bound (resampling pair-days, seed 20261014).
**Verdict language is fixed**: "exploitable at a 1-minute loop" only if the 2-minute-ahead net mean is positive with
its bound above 0 over ≥ 200 events; otherwise "speed-dead or absent — closed". State Kalshi's role in one line: a
reference feed only; Davies holds no account there.

## S4 — SPORTS-XCHECK: one game, separate events, one snapshot

**Snapshot, no history.** On one busy game day (name it in advance in your first commit), for every game listing a
moneyline, a spread and margin/total buckets as separate events: compute the model-free bounds (moneyline =
Σ home-margin buckets; spread vs buckets' median), price any violation at the touch walked one level for $20 a leg
with G4's sports fees, and read the settlement clause of the five largest apparent violations end to end.
**Outcome is one of two sentences**: "violations net of fees exist at size — a historical design is worth drafting",
with the table; or "none clears fees at the touch — closed at snapshot". No second snapshot day to go looking.

## Definition of done (all of it, or it is not landed)

- Scripts under `docs/agents/backtests/pmstatarb/scripts/`, inputs under `data/`, outputs under `results/`,
  `MANIFEST.json` regenerated (sha256 per file), every number in the write-up traceable to a results file a re-run
  from committed inputs reproduces.
- One write-up, `docs/agents/reviews/<date>-pm-statarb-verification.md`: per study — verdict (PASS / FAIL / not run,
  coverage), the bar table with every condition's figure, neighbours, coverage, and a Not checked section. Numbers
  you did not recompute are named as read, not measured.
- `docs/map.md` rows updated for any new folder or file; `docs/LEDGER.md` history section in the same commit(s),
  with what remains list updated where your verdicts change it.
- `sh bin/gates.sh` ends `all gates green` on the exact tree you push; CI green after the push is checked, not
  assumed. If a gate fails for an environmental reason at your seat, the report names it instead of claiming green.
- **The report to Davies is in Chinese**, in this shape per study: 结论（通过 / 失败 / 未跑-覆盖不足）→ 关键数字
  （样本数、费后收益与 bootstrap 下界、相邻参数符号）→ 证据文件路径 → 需要你决定的一句话. Verdict first; any
  live-money implication is a numbered decision for Davies, never an action taken.
