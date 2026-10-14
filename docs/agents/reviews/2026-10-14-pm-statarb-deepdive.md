# PMSTATARB: Polymarket statistical arbitrage — what the earlier searches proved, and what is still open

Research only (2026-10-14, read 01:55–02:10 UTC). Nothing was placed, armed, built or deployed; no production table was
written and no live rule was read for changing. Every new read was a keyless public GET (Gamma, the CLOB and data APIs,
Kalshi's public API as a price reference, Coinbase Exchange for spot). Scripts and outputs are in
`docs/agents/backtests/pmstatarb/` (`MANIFEST.json`); they read live books, so a re-run reads a later book. Not blind.
Nothing is frozen: the candidates in §4 are designs for historical tests, each needing Davies' word before a
pre-registration, a recorder or a paper row.

Davies, 2026-10-14: study the Polymarket statistical-arbitrage research the earlier Claude and Cursor sessions did,
take its lessons, then look for new opportunities worth adding to testing; repetitive mechanical work may go to another
engineer. (No peer session was reachable from this session, so the mechanical work is packaged in §5 for handing over,
and the pulls behind §3 were done here.)

## The answer in plain words

- **The locked-arbitrage cupboard is bare, and tonight's re-scan keeps it bare.** The one structure not previously
  paired across market types — a touch ("reach $X") against a terminal ("above $X on <date>") at the same strike —
  gives 45 properly nested pairs today and **none locks its $1 minimum payoff for under $1** after fees (best 1.0079).
  Every cheaper-looking pair is a window mismatch, which is the clause trap fp4's M5 already named.
- **What is genuinely not yet measured is calibration, not cross-market identity**: whether touch prices and daily
  price-bucket partitions are systematically rich or cheap against a spot-and-volatility model, at tradable prints.
  FAV measured raw price bands on binary markets; nobody has measured the touch/terminal reflection relation or the
  bucket distribution's shape against a model, at prints, out of sample. Those are the two historical tests worth
  freezing (§4), in that order.
- **A third open measurement is a signal, not a strategy yet**: whether Kalshi's prices lead Polymarket's on matched
  markets at the minute scale. Both sides' minute data are keyless (verified tonight). Kalshi stays a reference only
  (Davies cannot open an account); a Polymarket-only rule would trade the lag if it is minutes, and is dead if it is
  seconds, as most such lags are.

## 1. What the earlier research already established (Polymarket only)

| family | where | verdict, in one line |
|---|---|---|
| YES+NO < $1 (merge/split) | fp4 S1, M1 | dead by construction: one book, 400 of 400 |
| Negative-risk sets ≠ 1 | fp4 M5 (3 sweeps, 7,104 events); PMOPPS §1 (every recorded minute, 8 days) | dead: the apparent edges are resolution clauses; minute-by-minute it is $1.26 a day at $1,000 locked 11–204 days |
| Strike/date ladders | fp4 M6 (896 ladders); PMOPPS §1 (149 date ladders at the minute) | dead: 16 violations, largest 0.93 ¢; $0.46 in eight days at the minute |
| Favourite–longshot (buy 0.90–0.99, hold) | fp4 FAV, pre-registered, out of sample | **fails**: −1.4 % a dollar on 2,282 trades; on Polymarket the favourites are the rich side (0.90–0.95 paid 0.888), longshots ~fair |
| Near-certain / known-winner buys | fp4 B3, B4; HARVEST | dead for a minute loop without a feed; the tail is oracle risk (1 overturn per ~3,700 markets) |
| Weather vs free forecast | fp4 WX; PMLATE, WXSRC | fails: the market out-forecasts the model (Brier 0.064 vs 0.075) |
| Hourly & 5/15-minute crypto up/down | fp4 M3/M3b; PMSC (prints + live book at 100 ms) | dead at our speed: the edge lives 0.1–0.25 s; every maker arm is picked off; the hedge notional is ~1,400× the stake |
| Disputes (buy the proposed outcome) | fp4 B16 untested; PMOPPS §2 | priced right (proposals survive 79 %, priced 0.74); dispute times are not keyless |
| Deadline time-decay (DEADLINE-NO) | PMOPPS §3 lead, then frozen 2024 test | **closed**: 2024 fails its bar (71 trades, bound −6.2 %); the 2026 edge halves on the full sample and vanishes at real fills |
| Cross-venue (Kalshi, Smarkets) | STATARB §4.3 | no taker arbitrage (crosses $1.007–$1.08); deep mids agree to ~0.5 ¢; Kalshi ruled out as a venue, kept as a reference; Smarkets dead on capacity |
| Subsidies as the trade (maker rebates, holding rewards, tiers, sponsored) | fp4 P2–P4; PMOPPS §5; live record | rebates pay 0.19 ¢ a filled share against a 2.8 ¢ adverse move; sponsored is 0.1 % of the money; the liquidity-reward line itself is Q2, running under Addendum 19's bar |

The two broader searches (STATARB, STATARB-2, 2026-10-09) add the generator the winners share — an anchor or a public
subsidy, a non-arbitraging crosser, a near-zero maker cost, a barrier, an account Davies can hold — and three venue
candidates still standing from them (PR5-EUR, CJ5, CBSWEEP) that are stablecoin-quote variants, not Polymarket
directional trades. CJ5's forward paper decision is already on Davies' list from tonight's testing review.

## 2. The lessons, as rules for anything new

1. **The price history is not a tradable price** (fp4 M3b: +10 ¢ against the history, −2.8 ¢ at the prints;
   DEADLINE-NO: real fills took +7 % to ~0). Entries are priced at prints strictly through, with a tick haircut.
2. **Apparent identity violations are clauses** (fp4 M5's "Other if unknown"; §3 below). A pair is nested only when
   the resolution texts, not the end dates, make it so.
3. **Half-samples and exact parameters are noise signatures** (DEADLINE-NO: half of 2026 +7.1 %, all of it +1.8 %;
   T−7 works, T−5/6/8/9/10 do not). A new test states its neighbours in advance and requires their sign.
4. **Anything under about a second is taken** (PMSC: competition p50 0.14–0.18 s; our lawful path 0.7–1 s plus
   Polymarket's 150 ms taker delay). Minute-scale or slower, or not at all.
5. **A subsidy is priced in adverse selection** (RW's live record: R ≈ 0.72 and fills still drove the −$75 stop).
   Formula income alone is never the measurement.
6. **Depth at the touch and lock-up decide the dollars** (sets: 4–5 % a year on capital locked for months). Every
   candidate states capacity at $20–$50 a trade and days locked, before its return.
7. **Access is part of the strategy** (fp4 §0): the UK is close-only; anything live on Polymarket runs only under
   Davies' Ireland attestation. Paper and historical tests need neither.
8. **Calibration here runs against the textbook direction** (FAV): on Polymarket the 0.90–0.99 side is rich, the
   0.05–0.10 side roughly fair. A new calibration claim states which side it sells and why that is not FAV again.

## 3. Tonight's new measurements (`backtests/pmstatarb/`, snapshots at ~02:00 UTC)

### 3.1 Touch against terminal, properly nested: no locked pair

A touch market ("reach $X on <date>", Binance 1-minute **High** over that ET day) nests a terminal market ("above
$X on <date>", the Binance 1-minute **Close at noon ET** of a day inside the touch window) in one direction: buying
touch YES + terminal NO pays at least $1 in every state, and $2 when the barrier is touched but noon closes on the
near side. Priced at Gamma's touch (crypto taker fee `0.07·p·(1−p)` a leg):

- **45 nested pairs** (same title day, or a weekly touch over a terminal day inside it): **none under $1**; the
  cheapest is 1.0079 (weekly BTC $94k). The sub-$1 pairs a naive date match produces (best 0.88) pair a one-day touch
  window with a terminal two days later — a 12-to-60-hour gap in which the "locked" pair pays $0. Window mismatch,
  not arbitrage: lesson 2 again, now in this family.
- The touch/terminal **mid ratio** over the 45 pairs: median 2.46, range 1.03–27.8. A driftless reflection benchmark
  for a same-expiry barrier is about 2, rising when the touch window outlives the terminal date, so the median is
  not self-evidently wrong. Whether the ratio is systematically rich or cheap once spot distance and time left are
  in the model is the historical question (§4, TOUCH-CAL) — a snapshot cannot answer it.

### 3.2 Daily price-bucket partitions: whole, at a spread

For the BTC/ETH "price on <date>" bucket events of the next week, YES mids sum to 0.99–1.07 — the partition is priced
whole at the mid (it is one negative-risk adapter book under the surface). Against a driftless lognormal at trailing
30-day realised volatility (BTC 38 %, ETH 45 %; Coinbase spot), the largest bucket deviations sit in the central
bucket (up to ~5 points, model-sensitive to drift and the hour of the snapshot), and the ±7 % tails read richer than
the model on ETH (0.105 of mid mass against 0.016 model on the October 16 event) while ~zero on same-day BTC. That is
a hint about distribution **shape**, not a measurement: mids on wide books at 02:00 UTC, one snapshot, no prints.
§4's BUCKET-DIST is the historical form.

### 3.3 Kalshi as a clock: both minute series are keyless

Kalshi's public API serves markets, 1-minute candlesticks (`/series/{series}/markets/{ticker}/candlesticks`) and
trades without a key (verified on `KXBTC` tonight); Polymarket's data API serves prints keylessly. So a matched
1-minute panel (BTC hourly/daily ranges, Fed decisions) can be built and the lead-lag measured without any account.
Nothing is claimed yet: STATARB measured the two venues' *levels* agree to ~0.5 ¢ on deep games, never which one
moves first. Lesson 1 applies in reverse — Polymarket's `/prices-history` is a lagged midpoint, so the panel must be
built from prints, or the "lag" measured will be the history endpoint's own.

## 4. The candidates worth a historical test, ranked

Both are historical-first (the DEADLINE-NO path, which cost a day and closed a lead honestly), not paper rows. Each
states its neighbours in advance (lesson 3), fills at prints with a tick haircut (lesson 1), and its lock-up
(lesson 6). Sizing language is $20–$50 a trade, the account's scale.

### 1. TOUCH-CAL — are touch prices calibrated against the reflection relation?

- **Mechanism.** For a barrier inside its window, model touch probability from spot and trailing realised volatility
  (driftless GBM one-touch; the settlement feeds are Binance 1-minute High/Low, which the model must use, not closes
  — PMSC's settlement lesson). Trade only where the market and the model disagree by more than the fee plus two
  ticks, in either direction, held to resolution.
- **Why it is not already closed.** M6 priced locked ladder pairs; nobody has priced the touch side *statistically*.
  The daily/weekly reach-and-dip ladders list every day, so the resolved universe is large and recurring.
- **Design sketch (for the freeze, not frozen).** Universe: resolved BTC/ETH daily and weekly reach/dip markets,
  2025-01 → 2026-09 (2024 left unseen if its coverage allows). Entries at T−72 h, T−24 h and T−12 h named in
  advance; the entry price is the first print at or after the hour through the model's side, floored a tick worse;
  stake $20. Bars in DEADLINE-NO's shape: ≥ 150 trades in ≥ 100 events; event-bootstrap 5 % bound above −2 %; no
  event over 25 % of the total; **both neighbouring horizons the same sign**; each year separately not worse than
  −5 %. A FAIL closes it.
- **Capacity and lock-up.** Dozens of strikes list a day; qualifying gaps are the unknown. Capital locks to the
  market's day or week. At $20 a trade this is a few dollars a day if real — the same order as DEADLINE-NO was.
- **Main risk.** Model risk dressed as edge (volatility clustering, jumps at data releases inside the window), and
  the High/Low settlement making touches likelier than a close-based model says — the model must be the settlement's
  own object or the test measures the model, not the market.

### 2. BUCKET-DIST — is the daily bucket distribution the wrong shape?

- **Mechanism.** Each daily BTC/ETH "price on <date>" partition is a full implied distribution. Against the same
  lognormal benchmark (spot and trailing vol at entry), trade the buckets it and the market disagree on by more than
  fees plus two ticks — in practice selling rich tails (buying their NO) and/or buying a cheap centre, one bucket a
  trade, held to resolution. The diversification is across days, not within a partition (one bucket wins per day).
- **Why it is not FAV again.** FAV sold nothing; it bought binary sides at 0.90–0.99 outright. Here the favourite is
  a 0.35–0.55 central bucket and the longshots are a *partition's* tails priced against a fitted distribution — the
  claim is about shape, and lesson 8's direction (rich favourites) predicts the centre is the rich side, which the
  rule must be free to find either way.
- **Design sketch.** Resolved daily bucket events 2025-01 → 2026-09; entries T−24 h (neighbours T−12 h, T−48 h);
  vol from the trailing 30 daily closes of the settlement pair; deviation threshold stated in probability points
  (e.g. ≥ 4) with its neighbours (3 and 5) reported; fills and bars as TOUCH-CAL's. One event-cluster bootstrap by
  day, since a day's buckets settle together.
- **Risk.** Jump days dominate the tail buckets' P&L; a lognormal benchmark underprices exactly the days the tails
  pay. The honest null is the market's own distribution reshuffled across days, which the freeze should state.

### 3. KALSHI-LEAD — a measurement before any design

Build the matched 1-minute panel (Kalshi candles/prints, Polymarket prints) for the overlapping BTC and Fed markets
of the last 30–60 days and measure the cross-correlation of minute returns at lags −5…+5 minutes, plus how often a
Kalshi move of ≥ 2 ¢ is followed by the same Polymarket move within 3 minutes at a post-fee profit. If the exploitable
lag is under a minute, it joins PMSC as speed-dead and closes; if it is minutes, a paper design can be drafted.
Kalshi is a reference only — Davies holds no account there and none is proposed.

### 4. SPORTS-XCHECK — same game, separate events (snapshot first)

Moneyline, spread and margin buckets for one game list as separate events, so their implied distributions can
disagree where a single neg-risk set cannot. fp4/PMOPPS priced sets *within* an event; nobody has priced the bounds
*across* a game's events. One snapshot scan on a busy game day (touch prices, fees in, walked a level) decides
whether a historical test is worth drafting. Multi-leg taker fees (~1.25 ¢ a leg at 50 ¢) set the bar the snapshot
must clear.

## 5. Mechanical work packages (for Grok Engineer, or whoever Davies hands them to)

Each is a pure pull or table-build: no judgement, no secrets, outputs under `docs/agents/backtests/pmstatarb/` with a
sha256 `MANIFEST.json` in the house style, scripts re-runnable from the committed inputs.

- **G1 — resolved touch/terminal/bucket universes.** Adapt `pmopps/scripts/pull_closed.py` to pull Gamma's closed
  BTC/ETH reach, dip, above/below and price-on markets, 2024-01 → 2026-09, one CSV per family with question, strike,
  window dates from the title, endDate, payout and volume. Acceptance: row counts by family and month printed; every
  strike parsed or listed unparsed.
- **G2 — entry-window prints.** For G1's markets, CLOB `/prices-history` (hourly, T−96 h → resolution) and data-api
  `/trades` over the entry hours the designs name. Acceptance: per-market coverage table (how many have a print
  within an hour of each entry), since that decides the feasible bar.
- **G3 — the Kalshi–Polymarket panel.** The matched-market table (BTC hourly/daily, Fed) with both tickers and close
  times, then 1-minute Kalshi candles and Polymarket prints for 60 days, aligned to a single CSV per pair.
  Acceptance: the matching rules printed with the unmatched leftovers, no silent drops.
- **G4 — fee and rule verification at source.** Polymarket's current fee rate per category for the families above and
  the daily markets' settlement texts (Binance High/Low vs noon Close), read from the docs and three sample markets,
  into one table. Acceptance: every figure with its URL and read date; anything not found at source named as such.

## 6. Decisions for Davies

1. Which historical tests to freeze first — the recommendation is **TOUCH-CAL, then BUCKET-DIST** (they share G1/G2's
   pull), each closing on a FAIL as DEADLINE-NO did. KALSHI-LEAD is a measurement, not a test; SPORTS-XCHECK is one
   snapshot before any design.
2. Whether the G1–G4 pulls go to Grok Engineer (no peer session was reachable from here) or wait for a Claude/Cursor
   session. Nothing else in this review needs a build, an account or a key.

## Not checked

- Depth and size at the touch for the §3.1 pairs (Gamma's best bid/ask only; no book was walked).
- Whether the daily touch markets' Binance High settlement can be reproduced tick-for-tick from a keyless Binance
  read in this repo's regions (G2/G4 answer it; Binance's public API refused this machine's location tonight, the
  Supabase regions already read it for the loop).
- Any resolved-market history: §4's candidates are designs against universes whose coverage G1/G2 have yet to count.
- Sports books at more than a snapshot, and any market family outside crypto price markets for the touch/bucket
  relations (equity-index and FX dailies exist and were not scanned).
