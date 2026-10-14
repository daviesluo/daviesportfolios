# IG verification spec: CFD and spread-betting candidates, ready to run

Written 2026-10-14 for the engineer Davies hands this to (Grok Engineer). It verifies the candidate studies in
`docs/agents/reviews/2026-10-14-ig-deepdive.md` on IG's own account facts and quotes. Nothing here is a live
trading rule or permission to deal. **Your deliverable is evidence with a verdict per bar** — scripts, inputs,
results and one write-up — landed through the repository's gates. If a bar fails, the study is closed and you
say so; tuning a parameter after seeing its result and re-running is a new proposal to Davies, not verification.

Davies has said he is willing to bear some risk if a strategy is good enough. That changes nothing in this
spec: you do not choose his stake, fund an account, arm automation or place a trade. A passing study ends in a
risk decision packet for Davies, never in an order.

## Read first (in this order)

1. `.claude/CLAUDE.md` — repository rules: ledger, gates, commit identity, documentation.
2. `docs/agents/CLAUDE.md` — venue access, secrets and proof standards.
3. `docs/agents/reviews/2026-10-14-ig-deepdive.md` — the new FXW risk and volatility measurements.
4. `docs/agents/reviews/2026-10-09-ig-opportunities.md` — the platform, product, tax and terms screen, and
   the candidates already closed. Do not re-open a closed arm because a new gate looks plausible.
5. `docs/agents/backtests/ig_research/` — the earlier scripts, committed inputs and saved source pages.
6. `docs/agents/backtests/ig_deepdive/scripts/` and `results/` — the 2026-10-14 measurements you must
   reproduce from inputs, not copy.

## Starting condition

Do not begin an account-dependent step until Davies confirms all three:

- his IG application is approved and he can identify the contracting entity from his account documents;
- a demo account exists and he has placed its API credentials in the secret store he names;
- he has said, in the current conversation, that the demo read-only verification may start.

Never ask him to paste a password or API key into chat, a file, a URL or a commit. If the starting condition is
not met, run only G0 and G3, then report every IG-specific study as **not run, account access**.

## Hard rules

1. **Demo environment only.** Code must refuse to run unless the configured IG environment is exactly `demo`.
   Never call the live dealing host. Account facts from the live platform are supplied by Davies as redacted
   documents or screenshots; balances are neither needed nor recorded.
2. **Read-only dealing surface.** GET endpoints and streaming price subscriptions only, apart from the login
   and account-switch calls needed to establish a demo session. No order, working order, position, watchlist
   mutation, account application, funding, withdrawal, client-classification change or API-key creation.
3. **No production deployment in this spec.** Recorders run locally against demo. No migration, Edge Function,
   cron row or production table unless Davies separately asks for that build after reading your evidence.
4. **No latency-abuse or error-quote strategy.** IG's spread-betting terms were read as prohibiting unfair
   advantage from the way prices are constructed or conveyed, and as allowing obvious-error bets to be voided.
   Every hypothetical fill is at a quote whose market state is tradable. You never design a race against IG's
   quote using a faster feed.
5. **Actual account facts beat public regional pages.** UK, Irish and other regional product details are kept
   separate until the contracting entity is known. A spread bet does not silently become a CFD, and a public
   "from" spread does not become an opening spread.
6. **Parameters are frozen below.** Entry hours, thresholds, cost ladders, bootstrap seeds and bars are in
   your first commit before the pull that can answer them. Neighbours are reported whatever they say.
7. **Costs are executable-side costs.** Long entries use offer, short entries bid, exits the opposite side.
   Funding, guaranteed-stop premium, currency conversion and dividend adjustments are separate line items.
   A mid-price result is a diagnostic, never the headline.
8. **Secrets are never printed or committed.** Test log scrubbing for the API key, username, password, CST
   and security token before the first authenticated call. The site password and any fragment of it never
   appears; write `?pwd=…` if the site is mentioned.
9. **The ledger moves with the work.** Every landing commit carries its `docs/LEDGER.md` line and source
   header, identity `daviesluo <daviesluo@gmail.com>`, and is pushed only when `sh bin/gates.sh` ends with
   `all gates green`. Reports to Davies are in Chinese; committed text is English.

## Order of work and dependencies

G0 and G3 may run before account access. Then G1 → G2 → G4. S1 needs G1-G4. S2 needs G1, G2 and G4. S3 needs
G3 plus a longer independent futures history. S4 needs G1 and its own quote sampler in G4. S5 runs only if S1
or S3 reaches its paper bar. Land each G-step separately so a later step never re-pulls what a manifest pins.

---

## G0 — Primary-source refresh (public, mechanical)

**Objective.** Replace every inherited platform number that your studies use with a dated primary source.

**Sources to re-read at source.** IG Labs API FAQ, getting-started, REST and streaming guides; the actual
entity's customer agreement, product details, charges, overnight funding, guaranteed stops, weekend trading,
margin close-out and negative-balance pages; the relevant regulator's CFD/spread-betting rules; HMRC and,
if Davies' residence makes it relevant, Irish Revenue material. Tax pages are evidence to put before an
adviser, not a tax conclusion by you.

**Output.** Raw page text or PDFs under `inputs/sources/`, plus `source_index.csv` with exactly:
`source_id, publisher, title, url_or_document, read_date, sha256, fact_ids`.

**Acceptance.**
- Every numeric, legal or product claim in your write-up carries a fact ID resolving to this index.
- Regional variants are separate rows; no table blends a UK spread, an Irish margin and a global minimum size.
- Anything unavailable is written `not found at source`, never supplied from memory or a search snippet.
- If the contracting entity is still unknown, UK facts are labelled `public UK route, applicability unproven`.

## G1 — Davies' actual account and product matrix

**Objective.** Establish what Davies can actually trade, in which wrapper, at what minimum size and margin.

**Davies-supplied facts (redacted; no balance).** Contracting legal entity, regulator, client classification,
account types/product codes available, base currency, demo availability, spread-bet availability, CFD
availability, negative-balance wording, margin close-out wording and whether API access is enabled.

**Demo GETs.** `/accounts`; market search and market details for AUD/USD, US 500 DFB, US 500 futures, Weekend
Wall Street, Weekend US Tech 100, Weekend UK 100, Weekend Germany 40, Weekend GBP/USD, Weekend EUR/USD,
Weekend USD/JPY, near-the-money daily/weekly/monthly US 500 calls and puts, and VIX only to close its product
facts. Read both spread-bet and CFD accounts where Davies has both; never switch a live account.

**Output columns (exactly).**
`epic, account_product, instrument_name, instrument_type, expiry, market_status, streaming_available,
point_definition, min_size, size_increment, margin_formula_or_tiers, min_stop_distance,
min_guaranteed_stop_distance, guaranteed_stop_premium, controlled_risk_available, trading_hours_uk,
funding_rule, dividend_rule, weekend_rollover, settlement_currency, source_id`

**Acceptance.**
- Every cell is a value or `not_found`; no blank means "probably".
- Five markets are cross-checked between API details and the visible demo platform details; discrepancies are
  a table, not resolved by choosing the convenient one.
- Convert each minimum size to notional in the account base currency at a timestamped underlying quote, and
  show the conversion. Do not copy the earlier £3,300 AUD/USD figure without recomputing it.
- State whether an option spread receives margin offset, from product terms or an indicative-cost response.
  If neither proves it, the answer is `not proven`.
- If spread betting is unavailable to Davies, stop and report the wrapper consequence before S1: CFD tax,
  loss-offset, contract size and funding are a different design, not a rename.

## G2 — IG price-history feasibility and allowance discipline

**Objective.** Prove what IG's demo `/prices` history actually returns before using a weekly allowance.

**Probe first.** One small HOUR request for AUD/USD and one for a weekend index epic. Save the raw JSON,
response field names, timestamp meaning, bid/ask/last field availability, `remainingAllowance` and
`allowanceExpiry`. If bid and offer are not separately present, price history is a mid diagnostic and cannot
support an executable backtest.

**Frozen pull windows (UK time; convert and state the API timestamps).**
- FXW: each of the latest 51 complete weekends, Friday 20:00 to Monday 22:00, AUD/USD HOUR.
- WKND: each of the latest 51 complete weekends, Saturday 08:00 to Sunday 23:10, the four weekend index epics
  and their weekday counterparts, HOUR.
- ESG context: the same Friday-to-Monday windows for weekday US 500, HOUR, only in a later allowance week if
  the budget would otherwise be exceeded.

**Allowance rule.** Before the first bulk request, commit a budget table of expected points by market and
week. Read the allowance from every response, stop before it is exhausted, and wait for its stated reset if
necessary. Never create another account or key to evade it. Missing weekends stay missing and are counted.

**Output.** Raw responses plus one normalized CSV per epic with:
`epic, bar_start_utc, bar_end_utc, bid_open, bid_high, bid_low, bid_close, ask_open, ask_high, ask_low,
ask_close, last_open, last_high, last_low, last_close, volume, source_file`.
A field absent from the raw response is null, never synthesized from another field.

**Acceptance.**
- Row counts and missing-bar counts by epic and weekend; no forward-filled bars.
- Ten bars checked against the demo platform chart or a second API read; timestamp start/end proven, not
  assumed from another broker's convention.
- The first tradable bar of each weekend is identified from market hours/details, not merely the first row in
  a file.
- `MANIFEST.json` regenerated; rerunning the parser from raw responses reproduces the CSVs byte-for-byte.

## G3 — Independent replication of the proxy history

**Objective.** Recompute the 2026-10-14 claims from committed inputs before spending effort on IG transfer.
Copying `results/fxw_risk.json` or `results/vol_gated.json` is failure.

**FXW frozen replication.** STATARB-2 E0 exactly: fade a Sunday gap with |g| at least 20 bps, target Friday's
mid, force close at +24 hours. Report AUD/USD, EUR/USD, GBP/USD and USD/JPY at assumed opening spreads 12,
20, 30 and 40 bps plus 2 bps exit/funding; era splits 2016-2018, 2019-2021, 2022-2024, 2025-2026; direction
splits; gap buckets 20-30, 30-50, 50-100 and at least 100 bps; 60- and 240-minute delay diagnostics; and the
24-hour adverse-excursion quantiles. Bootstrap whole trades, 10,000 draws, seed 20261014.

**Historical bar for AUD (all required).**
1. At least 80 trades.
2. At a 20 bp spread, mean at least +10 bps, t at least 3.4 and bootstrap 95% lower bound above 0.
3. Means at 12 and 30 bps have the same positive sign.
4. The 2022-2026 combined mean is positive, and all four era means are reported with intervals.
5. The headline remains both directions. A long-only result cannot rescue a failed two-sided bar.

**Volatility replication.** Reproduce the ungated daily/weekly straddle model at pricing ratios 0.8, 0.9 and
1.0, then the gates in `vol_gated.py`. Derive each tenor's historical breakeven pricing ratio by interpolation
and print it before S4 samples any IG option. A positive gated cell found by searching this grid is not a
pass; S4 is a quote audit only.

**Front-VX closure check.** Reproduce always-short and the three cycle-start gates at +30% and +50% modelled
stops. Report cycles stopped, worst drawdown and the warning that daily bars cannot prove an IG guaranteed
stop fill. No VX variant advances under this spec.

**ESG replication and source search.** Reproduce the Yahoo ES result exactly, then look for a longer,
lawfully reusable hourly ES history. Record provider, licence/access terms, contract-roll method, timezone and
an overlap audit against Yahoo on at least 100 weekends. If no source can support at least eight years and 60
qualifying trades at the 0.5% threshold, S3 is **not run, coverage**; do not splice incompatible series to
manufacture sample size.

## G4 — Demo quote recorders (local only, no orders)

**Objective.** Capture the quote an implementation could actually have acted on, including market state and
weekend token failures.

**FXW/WKND recorder.** One Lightstreamer connection only. Subscribe in DISTINCT mode to chart ticks for the
G1 epics and in MERGE mode to market state. Record Friday 21:50-22:05 UK, Saturday 07:55 to Monday 01:00 UK
for weekend indices, Sunday 20:50 to Monday 22:05 UK for AUD/USD and weekday US 500. Raw frames are gzip'd;
normalized rows are:
`received_utc, source_utc, epic, bid, offer, market_state, connection_id, sequence_gap`.

**Option sampler.** For 20 consecutive trading days named in your first commit, sample the daily-expiry pair
at 15:30 UK (headline) and 20:30 UK (diagnostic only; never pooled with the headline). For 12 consecutive
Fridays, sample at 15:30 UK the first listed weekly expiry 5-8 calendar days ahead, not the contract expiring
that day. At each snapshot record underlying US 500 bid/offer; the call and put strikes nearest the underlying
mid (lower strike on a tie); wing strikes nearest one and two gross straddle mid premiums away; and every
leg's bid/offer, expiry, minimum size and market state. State daylight-saving handling in UTC.

**Acceptance.**
- A 15-minute weekday dry run proves secret scrubbing, one connection, re-login after a process restart,
  handling of an invalid-token response, rate-limit logging and no dealing endpoint in the binary/script.
- A usable weekend has at least 95% connection uptime over its scheduled window, no unexplained disconnect
  over five minutes, and captures the first `TRADEABLE` state. A minute with no tick is not a failed minute if
  connection health and the last quote are present. Weekend target is 12 consecutive weekends; skipped or
  failed weekends remain in the denominator.
- Clock offset against a named time source is logged at start and end. Source timestamps are never silently
  replaced by receive timestamps.
- If your seat cannot run the forward weekends, deliver and test the recorder, then mark the forward sections
  **not run, operator**. Do not simulate missing weekends from hourly bars and call them ticks.

---

## S1 — FXW-AUD-IG: does the FXCM rule transfer to IG's Sunday quote?

**Claim under test.** IG's first tradable Sunday AUD/USD quote preserves enough of the weekend gap, at a
spread an implementation can pay within minutes, for STATARB-2 E0 to remain the same trade rather than a
different one discovered on IG data.

### S1a — 360-day hourly transfer

For every complete weekend in G2:
- Friday reference mid is the close mid of the last tradable HOUR bar before the documented Friday close.
- Sunday gap is `ln(first tradable Sunday open mid / Friday reference mid)`.
- Opening spread is `(ask_open - bid_open) / mid` in bps on that first bar.
- Pair the same weekend with the committed FXCM table and, where available, Yahoo hourly AUD/USD already in
  the repository. State each feed's first timestamp; do not align by calendar date alone.
- Score an hourly approximation on executable sides: enter at the first bar's bid/offer open against the gap,
  target Friday's IG mid, force close on the exit side at +24 hours. Because an hourly bar does not order
  target and adverse extremes, report both a close-only result and a range-crossing result. Neither is a
  headline fill claim.

**Transfer bar (all required).**
1. At least 45 complete weekends.
2. Median IG opening spread at most 20 bps and 75th percentile at most 30 bps.
3. Correlation between IG and FXCM weekend gaps at least 0.50.
4. On weekends where the FXCM gap is at least 20 bps, the median ratio `|IG gap| / |FXCM gap|` is at least
   0.70, with the count printed. If there are fewer than five such weekends, verdict is **not run, coverage**
   for this condition, not a pass.
5. At least 80% of IG first tradable bars begin no later than 22:00 UK, and unexplained timestamp gaps are
   under 10% of weekends.

### S1b — Twelve forward weekends on recorded quotes

For each usable weekend, freeze Friday's last mid from the recorder. The theoretical decision quote is the
first quote with market state `TRADEABLE` and bid below offer at or after Sunday's documented open. Record
spread and gap at first quote and, using the last quote at or before each timestamp, at +1, +5, +10, +30,
+60 and +240 minutes. For every |gap| at least 20 bps:
- paper-enter against the gap at the executable side of the first decision quote;
- also report the +10-minute quote as an operational diagnostic, without replacing the headline;
- exit when the exit-side quote reaches Friday's mid, otherwise at the exit-side quote nearest +24 hours;
- charge the actual funding/swap read in G1 for the holding interval and account product;
- record maximum adverse excursion from the minute path and whether required margin from G1 would have fallen
  to the documented close-out threshold at hypothetical notionals in S5.

**Paper bar (all required to call S1 PASS-TO-PAPER).**
1. G3's historical bar and S1a's transfer bar both pass.
2. At least 10 of 12 weekends are usable.
3. On at least 80% of usable weekends, spread is at most 20 bps within 10 minutes of the first tradable quote.
4. Every eligible signal and every no-trade caused by market state is in the ledger; none is removed for
   moving too fast, being news-driven or having a wide spread.
5. If at least five paper trades occur, their cumulative net is not below `-36 bps × sqrt(n)` of notional
   (the pre-stated one-standard-deviation scale from the FXCM sample), and the +10-minute diagnostic is
   printed beside the headline. If fewer than five occur, P&L is descriptive.
6. No unexplained difference over 5 bps between the recorded quote and the paper fill price.

**Verdict language is fixed.** `PASS-TO-PAPER`, `FAIL`, or `NOT RUN` with one reason: account access,
coverage, operator, product unavailable or quote schema. This spec cannot produce `PASS-TO-LIVE`.

## S2 — WKND: are IG's weekend index quotes biased against the reopen?

**Measurement, no trading rule.** For Weekend Wall Street, US Tech 100, UK 100 and Germany 40 over the G2
weekends, use snapshot times Saturday 08:00, Saturday 20:00, Sunday 08:00, Sunday 20:00 and the last bar
before rollover. Sunday 20:00 UK is the headline; all five are reported.

For each market and weekend compute:
- Friday weekday reference mid, weekend snapshot bid/offer/mid and spread;
- first weekday bid/offer/mid after rollover, plus +1-hour and +4-hour weekday mids;
- forecast error `ln(weekday first mid / weekend snapshot mid)`;
- side-adjusted signed bias: if forecast error is non-negative, `ln(weekday first bid / weekend offer)`; if
  negative, `-ln(weekday first offer / weekend bid)`. This preserves the error's sign after crossing spreads;
- weekend move `ln(weekend snapshot mid / Friday reference mid)`;
- an executable-side diagnostic that crosses the weekend spread at the snapshot and the weekday spread at
  first reopen, in the direction implied only by a pre-stated sign rule: fade the weekend move. This is a
  measurement of one simple relation, not a search over rules;
- regression of reopen move on weekend move (intercept, slope, residual RMSE), mean and median signed error,
  mean absolute error, and accuracy against a no-change forecast from Friday.

Bootstrap whole weekends, keeping all four indices from a weekend together, 10,000 draws, seed 20261014.
Split first and second halves by date. Report each market separately and pooled. External ES/NQ futures may
validate the US weekday reopen timestamp, but IG's own weekday epic is the settlement-relevant price here.

**Outcome is one of two sentences.**
- "A systematic bias worth a forward-rule draft exists" only if, at Sunday 20:00: at least 40 complete
  weekends per market; the pooled side-adjusted signed bias has a bootstrap 95% interval wholly
  on one side of zero; the same sign appears in at least three of four markets and in both date halves; and
  no single weekend contributes over 25% of the pooled absolute result.
- Otherwise: "No systematic tradable bias measured — WKND closes at backfill."

A positive sentence authorises only a new forward pre-registration for Davies. It does not backtest a rule
chosen from the same backfill, and it does not paper-trade weekend positions under this spec.

## S3 — ESG-US500: extend the 18-trade Sunday futures-gap fade or close it

Run only if G3 finds the longer independent hourly ES source. The frozen rule is: if the Friday-last-bar to
Sunday-first-bar ES gap is at least 0.5% in absolute value, fade it at the first tradable quote and exit at
Monday 16:00 ET. Neighbours, all reported, are thresholds 0.25% and 0.75% and a Monday 10:00 ET exit. Charge
IG US 500 DFB spread and funding from G1 at both the documented in-hours and Sunday/out-of-hours spreads;
do not use ES mids as fills without that charge.

**Bar (all required for PASS-TO-PAPER).**
1. At least 60 trades over at least eight years at 0.5%.
2. Headline mean after costs above 0 with t at least 3.0 and a whole-trade bootstrap 95% lower bound above 0.
3. Both neighbouring thresholds and the 10:00 ET exit have the same sign.
4. First and second date halves are both positive; no calendar year contributes over 50% of total P&L.
5. Maximum adverse excursion and margin-close-out distances are reported from hourly highs/lows; a result
   whose p95 excursion exceeds the margin buffer in S5 cannot be called implementation-ready.

If the source, roll method or timestamp audit fails, the verdict is **not run, coverage**, and ESG remains
descriptive on 18 Yahoo trades.

## S4 — IG-VOL-K: what does IG actually bid for short-dated straddles?

**Quote audit, no option sale and no strategy verdict.** Use G4's 20-day sampler. For each snapshot and tenor:
- record time to expiry in years from the product's stated settlement instant, not from the calendar label;
- compute executable straddle sale proceeds as `call_bid + put_bid` in points and as a fraction of underlying;
- solve the Black implied volatility of that bid straddle with the underlying mid as forward, zero rates and
  dividends over the stated short horizon (print the approximation and solver tolerance);
- compute `k_bid = solved IV / matching Cboe index`, where daily uses VIX1D and weekly uses VIX9D from the
  latest Cboe close strictly before the snapshot;
- also compute `premium_ratio = bid premium / model premium at the Cboe index`, so a solver convention cannot
  hide the raw price;
- for the iron butterfly, net credit is short-leg bids minus wing-leg offers at the sampled strikes; maximum
  loss is wing width minus net credit, converted at G1's point value and minimum size. State if a required
  wing is not listed or not tradable.

**Screening outcome (fixed language).**
- "IG bids are rich enough to justify drafting a historical design" only if at least 18 of 20 daily headline
  snapshots, or at least 10 of 12 weekly Friday snapshots, are complete for the tenor being judged; that
  tenor's median `k_bid` is at least 0.05 above the breakeven ratio printed in G3,
  its lower quartile is at or above that breakeven, and the four-leg net credit and minimum-size maximum loss
  are both measurable from tradable quotes.
- Otherwise: "IG bids do not clear the model breakeven screen — short-dated IG option selling closes."

A rich screen is not a PASS. Any later design must use defined-risk structures, prove margin offsets, state
the minimum-size cash tail, and collect forward paper fills. Naked option sales are outside this spec's
recommendation surface regardless of the screen.

## S5 — Wrapper and risk packet (only after S1 or S3 PASS-TO-PAPER)

**Objective.** Give Davies a decision he can price, using G1's actual products rather than leverage labels.

Compare, where Davies' account offers them: spread bet versus CFD; DFB versus futures-dated contract; no
stop, ordinary stop, guaranteed stop and knock-out. For each wrapper report known spread, funding over 1, 7
and 30 days, minimum notional, margin, stop/knock-out premium and minimum distance, settlement currency and
conversion, dividend handling, weekend rollover, and the exact source fact IDs. An ordinary stop is never
described as a maximum loss across a gap. A guaranteed stop's maximum loss is computed only at a distance
the actual product accepts.

For hypothetical account sizes of 1,000, 5,000 and 20,000 units of the actual account base currency **only as
arithmetic examples**, and for the minimum tradable notional plus 10,000 and 33,000 base-currency units of
notional, tabulate:
- initial margin and the account equity at the documented margin close-out threshold;
- adverse move that reaches that threshold, solving the account-equity equation and stating any tier change;
- loss at the candidate's worst finished trade, p95 and maximum adverse excursion, and at 6% and 10% FX
  stress (or 5%, 10% and 20% index stress for S3);
- model expected annual P&L at the passing cost assumption, before tax, with trade count;
- maximum notional implied by `permitted stress loss / stress percentage` for stress-loss budgets Davies
  may choose, without recommending one.

**Required warnings in the packet.** Negative-balance protection is not position protection; margin is not
the amount at risk; demo fills are not live fills; IG is the quote provider and counterparty; automated live
dealing still needs IG's written consent if Term 9(12) or its current equivalent applies; and tax treatment is
unresolved until Davies has advice for his residence and contracting entity.

## Definition of done (all of it, or it is not landed)

- Scripts under `docs/agents/backtests/ig_deepdive/scripts/`, raw/source inputs under `inputs/`, normalized
  data under `data/`, outputs under `results/`, and `MANIFEST.json` regenerated with sha256 per file. Every
  number in the write-up traces to a results file reproduced from committed inputs.
- One write-up, `docs/agents/reviews/<date>-ig-verification.md`, with per-study verdict, the full bar table,
  neighbours, coverage and exclusions, account/product facts with source IDs, risk packet if triggered, and
  a Not checked section. Numbers read from earlier reviews are named as read unless G3 recomputed them.
- `docs/map.md` updated for new files or folders; `docs/LEDGER.md` updated in the same commit, including the
  what-remains list where a verdict changes it.
- `sh bin/gates.sh` ends `all gates green` on the exact pushed tree, and CI is checked after the push. An
  environmental gate failure is named as such; it is never converted into a green claim.
- **Report to Davies in Chinese**, per study in this order: 结论（通过至纸面 / 失败 / 未跑及原因）→ 关键
  数字（样本、实际 IG 点差、费后收益与 bootstrap 区间、最大不利波动）→ 证据文件 → 需要你决定的一句话.
  Any live-money implication is a numbered Davies decision. No order, funding or account change is taken.
