# CRYPTOBOOKS-2: the XRP/GBP maker's strategy, in depth (2026-10-31)

Davies, 2026-10-31 ~08:20 UTC: "出 XRP/GBP 每秒报价的架构方案并继续深度研究具体策略" (draw up the architecture for quoting
XRP/GBP every second, and keep studying the strategy itself, in depth). Another agent writes the architecture: where it runs,
Revolut X's private API, monitoring. This review is the strategy, and §5 states the requirements the architecture has to meet.
It follows CRYPTOBOOKS (`reviews/2026-10-31-crypto-books-deep.md`), whose §7 draft this one replaces (§8).

**Research only, not blind.** Every record was read. Nothing in production changed. Only public market data was used
(keyless GETs from Revolut X UK, Binance, Coinbase and Kraken), plus read-only SQL. No balance of Davies' appears: every pound
is a replay's (paper) or a public market figure. Scripts, inputs and results are in `docs/agents/backtests/cryptobooks/`:
`scripts/rule.py` is the rule's engine, and `scripts/show2.py` prints the tables below.

## 0. Answers first

**1. Regime.** The fast layer is not gone for good. It is these books' normal state, and it comes and goes.

- **A year of samples.** Across a year of 13:00–16:00 UTC samples, the effective spread was wide (16 bps or more) on:
  - 6 of 349 days on XRP-GBP;
  - 13 of 347 on SOL-GBP;
  - 4 of 283 on ETH-GBP.

  Each wide spell lasted one or two days. On every book the median day read 2.5–9 bps in every month but one (SOL-GBP, 2025-11:
  13.9; §1.1).
- **SOL-GBP and ETH-GBP today.** Their layer left at 01:00 UTC, two minutes after the GBP stablecoin maker left both of its
  books (00:58). It came back at 08:00, after that maker was back on USDT-GBP (07:18) and four minutes before it returned to
  USDC-GBP (08:04). From 09:10 to 11:05 the recorder read both books 4.8–4.9 bps wide. Their touch sat within 6 bps of the
  fair in 77–96 % of reads (§1.2–1.3).
- **XRP-GBP.** It has been wide since 10-28 16:00 UTC, the longest wide spell of the year, and still was at 11:05. It narrowed
  this morning: the touch now sits 12.6–12.8 bps from the fair, against 25–30 bps before 07:00.

**2. The edge does not stop the hour the layer returns. It shrinks.**
- Over 15 days the card earned £0.113 an hour in XRP-GBP's 271 tight hours (P = 0.0075) and £1.26 an hour in its 67 wide ones.
- The first hour after each wide-to-tight switch averaged £0.58 (§1.4).
- A regime gate that stops quoting in tight hours cost money on every setting tried (§3).
- So the signal is defined (§1.5) and used for the reading and for alerts, not as a stop.

**3. The rule card** (XRP-GBP, §2):
- quote 14 bps either side of Binance's second price, converted to pounds and corrected for the book's basis;
- re-price on a 5 bps move or after a fill;
- skew both quotes against the coin held, κ = 0.5;
- £200 a quote on £600 of capital, starting in pounds and selling only what was bought;
- a safety stop at 300 bps;
- data at most 1 s old;
- about 2,540 placements and the same number of cancels a day, on a sub-account of Davies' own.

**4. Robustness** (XRP-GBP, §3–4):
- **15 days to 11:00 UTC today:** £7.77 a day at £600, P(mean ≤ 0) = 0.000 by days and by hours. 10 of 15 days were
  positive; the worst hour was −£8.17, the worst day −£0.03, and every week was positive.
- **Plateau:** d 12–16 bps × θ 3–10 bps gives £1.3–3.3 a day in-sample and £10.4–13.2 out of sample.
- **Latency** (arbitrageur on): 1 s £7.77, 2 s £6.11, 5 s £3.16, 15 s −£0.09, 60 s −£9.49 a day.
- **Pessimistic fills:** £500 ahead of us in the queue £4.37 a day; a competitor stepping in front after 5 s £4.60.
- **Capital:** £120 earned £1.88, £600 £7.77, £1,200 £12.98 a day.
- **The year:** replayed in its sampled windows, the card earned £0.17 per 2.5-hour window (P = 0.042). Scaled to a day that
  is **about £1.8 a day**, and £1.5–2.2 on tight days. Two months of twelve lose (June, August).

**5. SOL-GBP is not a second judged arm.** It earned £1.57 a day over the 15 days (P = 0.13) and £0.04 a window over the year
(P = 0.35). It is reported beside XRP-GBP, not judged. ETH-GBP is about £0; dropped.

**6. Stale take (c).** With the money netted (one take at a time, £600) it earns £1.4–1.8 a day a book on SUI-GBP, SUI-USD
and NEAR-USD (P 0.02–0.07). It still pays at 15–30 s of latency. It ranks below the maker.

**Verdict, ranked.**
1. **The XRP-GBP maker.** Expect about £1.8 a day at £600 over a year, with £10–50 days when the layer is away. For scale,
   LIVE's rules replayed on USDT-GBP earn about £0.9–2.9 a day (MAKER-ABSENT, paper). It needs a 1 s loop, a sub-account
   and carried coin.
2. **The stale take on SUI and NEAR**, about £1.4–1.8 a day a book.
3. **SOL-GBP**, reported only.

The paper draft (§8) is updated: XRP-GBP alone is judged, the regime is reported, and a tight-hours condition is added.
Nothing is built, nothing is live.

## 1. The regime: how often the fast layer is away, and for how long

### 1.1 A year of Revolut X's own tape

`scripts/hist_pull.py` pulled the 13:00–16:00 UTC prints of every day from 2025-11-01 to 2026-10-30 (the public trade history
goes back at least to 2025-10-01). `scripts/regimes_hist.py` measures each day's effective spread without an outside price:
each taker buy against the median taker sell within 60 s of it. With the fast layer present this reads 4–8 bps; with it away,
25–60. A day reading 16 bps or more counts as wide.

| book | days sampled | wide days (≥ 16 bps, 13-16 UTC) | monthly median spread bps | wide runs (first, last) |
|---|---|---|---|---|
| ETH-GBP | 283 | 4 | {'2025-11': 7.2, '2025-12': 5.7, '2026-01': 4.8, '2026-02': 5.3, '2026-03': 4.0, '2026-04': 3.5, '2026-05': 3.2, '2026-06': 4.4, '2026-07': 4.3, '2026-08': 3.0, '2026-09': 2.5, '2026-10': 3.4} | [['2025-11-13', '2025-11-13'], ['2025-12-14', '2025-12-14'], ['2026-02-14', '2026-02-14'], ['2026-03-17', '2026-03-17']] |
| SOL-GBP | 347 | 13 | {'2025-11': 13.9, '2025-12': 7.5, '2026-01': 5.6, '2026-02': 7.5, '2026-03': 5.0, '2026-04': 5.1, '2026-05': 5.1, '2026-06': 4.9, '2026-07': 3.2, '2026-08': 4.8, '2026-09': 4.3, '2026-10': 4.7} | 13 one- or two-day runs, 11 of them in 2025-11 and 2025-12, the last 2026-08-18 |
| XRP-GBP | 349 | 6 | {'2025-11': 6.7, '2025-12': 6.0, '2026-01': 6.7, '2026-02': 9.1, '2026-03': 6.3, '2026-04': 6.5, '2026-05': 5.1, '2026-06': 6.9, '2026-07': 4.9, '2026-08': 5.7, '2026-09': 6.5, '2026-10': 6.5} | [['2026-02-14', '2026-02-15'], ['2026-02-17', '2026-02-17'], ['2026-05-24', '2026-05-24'], ['2026-10-29', '2026-10-30', 'open']] |

- **XRP-GBP's wide days:** 2026-02-14/15, 02-17, 05-24, then 10-29 and 10-30. Today's 13:00–16:00 window was not yet
  sampled when the pull ran.
- **SOL-GBP** had more wide days, in November–December 2025 (its monthly median was 13.9 bps in November).
- **ETH-GBP** had four single wide days.
- **Validation:** on the 14 October days the measure reads 4–8 bps, in line with tape.py's effective half-spread × 2
  (`results/regimes_hist.json` against `results/tape.json`).
- **How long a wide spell lasts:** one or two days in the year before this one. XRP-GBP's current spell is the exception:
  from 10-28 16:00 to at least today 11:05 UTC.

### 1.2 Today, and how today's switches line up with the GBP stablecoin maker

The same measure, hour by hour on 10-31 (`data/tape1031b_*`), set against the production watch's stablecoin maker
(`data/maker_events_1031.json`: both GBP books away from 00:58; back at 07:18 on USDT-GBP and 08:04 on USDC-GBP):

| book | 10-31 card £600 | £1,200 | £120 | lat 2 s | gate 6 | by hour (£, prints label, pair spread) |
|---|---|---|---|---|---|---|
| ETH-GBP | 0.07 | 0.07 | 0.02 | 0.07 | 0.0 | [['00', 0.0, 'tight', 4.8], ['01', 0.003, 'tight', 17.5], ['02', 0.002, 'tight', 16.3], ['03', -0.008, 'wide', 16.1], ['04', -0.0, 'tight', 15.3], ['05', 0.004, 'wide', 15.8], ['06', 0.004, 'wide', 16.0], ['07', -0.002, 'tight', 16.7], ['08', -0.002, 'tight', 4.1], ['09', 0.0, 'tight', 6.6], ['10', 0.074, 'tight', 5.1]] |
| SOL-GBP | 7.46 | 9.03 | 2.03 | 7.66 | 4.72 | [['00', 2.35, 'tight', 2.5], ['01', 0.579, 'wide', None], ['02', 1.256, 'tight', None], ['03', 0.113, 'tight', 31.9], ['04', -0.168, 'wide', 34.3], ['05', 1.387, 'tight', 34.6], ['06', 0.322, 'wide', 35.2], ['07', 1.005, 'tight', 33.3], ['08', 0.613, 'tight', 8.2], ['09', 0.0, 'tight', 5.2], ['10', 0.0, 'tight', 3.5]] |
| XRP-GBP | 7.86 | 12.19 | 2.15 | 7.84 | 7.14 | [['00', 1.075, 'wide', 48.1], ['01', 0.519, 'wide', 40.6], ['02', 0.046, 'wide', 51.4], ['03', -0.003, 'wide', 46.6], ['04', -0.312, 'wide', 49.1], ['05', 2.068, 'wide', 61.6], ['06', 0.815, 'wide', 51.7], ['07', 0.222, 'wide', 46.4], ['08', 1.247, 'wide', 55.1], ['09', 0.819, 'wide', 28.0], ['10', 1.369, 'wide', None]] |

How to read the labels: the hourly label "prints" is best.regimes, which measures paid-over-fair against the raw outside
price. On a weekend it misreads SOL-GBP, whose basis was −13 bps. The pair spread (the last column) is the label to read.

**The pair spread, hour by hour:**
- SOL-GBP: about 2.5 bps at 00:00, 32–35 bps 03:00–07:59, 8.2 at 08:00, 3.5–5.2 after.
- ETH-GBP: 4.8 at 00:00, 15–17.5 bps 01:00–07:59, 4.1–6.6 after.
- XRP-GBP: 40–62 bps all night, 28 at 09:00.

**The link to the stablecoin maker.** The production watch's stablecoin maker left both GBP books at 00:58, came back on
USDT-GBP at 07:18 and on USDC-GBP at 08:04. Today the crypto GBP books' layer left and came back with it, within minutes.
The link is real for the GBP books at least some of the time, but it does not explain everything:
- in October's 673 five-minute reads with that maker away, the USD books stayed tight (CRYPTOBOOKS §2.1);
- XRP-GBP widened on 10-28 16:00 without it.

### 1.3 The recorder

`scripts/record.py` read XRP-GBP, SOL-GBP and ETH-GBP every 4.5 s each (one public request every 1.5 s), next to Binance's
book ticker every second and Kraken's and Coinbase's tickers every 2 s (`data/rec1_*`; `scripts/rec_an.py` →
`results/rec1.json`):

**The books, 09:10 → 11:05 UTC** (1,532–1,533 reads each, no error):
- XRP-GBP: spread 25.8 bps, bid 12.6 and ask 12.8 bps from the fair, the layer never on.
- SOL-GBP: spread 4.9 bps, touch 2.4 bps from the fair, the layer on in 95.5 % of reads (on at 09:10:39 and stayed).
- ETH-GBP: spread 4.8 bps, touch 2.5 / 3.0 bps from the fair, the layer on in 77 % of reads.

**The fair's sources:**
- Binance leads Coinbase by about 2 s: the correlation of 2-second moves is 0.48–0.52 with Coinbase 2 s behind, against
  0.24–0.31 at the same instant.
- Coinbase's last trade is a median 2.8–3.0 s old (90th percentile 7.7–10 s).
- Kraken's GBP books sit 1.7–7.1 bps from Binance's converted price, a gap the basis term absorbs.
- Kraken's GBP/USD moved 1.5 bps in the two hours (a Saturday: the FX market is shut, Kraken still trades it).

So Binance is the fair, Coinbase is a fallback only (2–3 s late), and Kraken's GBP book is a sanity check.

### 1.4 Does the edge disappear in the hour the layer returns?

`scripts/transitions.py` runs the card on the 14-day tape plus today, labelling each hour by its own pair spread:

| book | tight h | £/tight h | P | wide h | £/wide h | P | 1st h after wide->tight | 1st 3 h | 1st h after tight->wide | switches |
|---|---|---|---|---|---|---|---|---|---|---|
| ETH-GBP | 332 | 0.0076 | 0.4228 | 7 | 0.1045 | None | -1.2342 | 0.0252 | 0.1876 | 8 |
| SOL-GBP | 332 | 0.0664 | 0.1335 | 8 | 0.1189 | None | -1.2881 | 1.2575 | -0.9876 | 6 |
| XRP-GBP | 271 | 0.1134 | 0.0075 | 67 | 1.2613 | 0.0 | 0.5777 | 0.6004 | 0.6566 | 9 |

- **XRP-GBP:** its tight hours earn about a tenth of its wide ones but are positive (P = 0.0075). The first hour after a
  switch back to tight earns about what wide hours do, so the edge fades over hours rather than stopping at once.
- **SOL-GBP and ETH-GBP:** too few wide hours (8 and 7) to say.
- **A caveat:** hourly pair labels are noisy. XRP-GBP's switches include single tight hours inside its wide spell.

### 1.5 The regime signal

**The live regime signal**, read from the book itself with our own orders taken out:
- **On** (the fast layer present): the others' best bid and best ask are both within 6 bps of the basis-corrected fair for
  3 reads running.
- **Off:** 10 reads running without that.
- **How often to read:** every 4.5 s, as the recorder did, is enough. The layer's switches last hours, and the recorder's flips
  came within seconds of a switch.
- **A second input for the GBP books:** the production watch's state of the GBP stablecoin maker (`agent_maker_state`), which
  switched with the layer today.

**What the strategy does with it:** it records it, and the paper reading is split by it (§8). The quoting rule does not stop
on it, because every gate tried lowers P&L:
- XRP-GBP: gate4 £6.15, gate6 £5.35 and gate8 £5.15 a day, against the card's £7.77;
- SOL-GBP: gate6 £1.15 against £1.57.

The tight hours' small, positive edge is worth keeping. The signal is also the alert for the decay rule in §2: a month in the
tight regime with the tight-hours P&L at or below zero stops the strategy.

## 2. The rule in full (XRP-GBP)

| element | rule | evidence |
|---|---|---|
| fair | Binance XRPUSDT mid every second (book ticker; the replay uses the second's last trade) × USDT/USD ÷ GBP/USD × exp(basis) | Binance leads Coinbase by ~2 s (§1.3) |
| GBP/USD | the production FX recorder's second-level read (TrueFX, Kraken fallback, `cb_fx.ts`), Kraken's 24/7 GBPUSD at weekends; no quote while it is more than 120 s old | GBP/USD held constant: £4.60 a day instead of £7.77, P 0.010: the FX source matters |
| basis | the trailing 3 hours' centre of XRP-GBP's own taker prints against that fair ((median buy dev + median sell dev) / 2), from prints before now | `replay.basis_steps`; GBP books sit −13 to +4 bps off the converted price |
| distance | d = 14 bps either side, fixed | plateau §3: d 12–16 all positive; vol-adaptive d (1–2 × σ60) earns less (£5.07–7.14) |
| skew | both quotes moved down by 0.5 · d · (coin value ÷ capital) | κ 0.5 is the plateau's best row; κ 1 earns less, κ 0 similar out of sample |
| re-price | when the fair has moved 5 bps from the price the quote was set at, or after a fill (cancel + place) | θ 3–10 all on the plateau; θ 10 cuts placements to 881 a day for £6.63 |
| size | £200 a quote at £600 (a third of the capital); £40 at £120; £400 at £1,200 | size at £600: £50 → £2.88, £100 → £5.25, £200 → £7.77, £300 → £9.03 a day |
| sides | start in pounds; a bid while the coin is worth less than the capital and pounds are left; an ask only for coin held | holding half the capital in coin (CRYPTOBOOKS' target 0.5) earned less and carries the coin all day |
| cap | coin ≤ the capital (the bid stops) | inventory mean £135, max £637 at £600 |
| stop | sell all held coin as a taker (9 bps + 20 bps slippage allowed) if it is marked 300 bps under its cost; no bids for an hour | never triggered in 15 days; a 100 bps stop triggered twice and cost £0.18 a day; a stop is insurance, not edge |
| staleness | no quote while Binance's feed is more than 3 s old, GBP/USD as above, or Revolut X is halted | Binance's last trade is 10 s or more old 250 times a day on XRP, and the replay's guard on trades (stale10) costs £0.45 a day: guard on the book ticker's update time, not trades |
| regime | recorded, not a stop (§1.5); the decay stop: 30 days with the tight-hours P&L ≤ 0 ends it | §1.4 |
| latency | data to order ≤ 1 s | §3: 2 s −21 %, 5 s −59 %, 15 s below zero |
| orders | ~2,540 placements and ~2,540 cancels a day, at most 2 a second and 76 a minute | a sub-account (no daily limit); on a main account (1,000 placements a day) θ 10 with a 950 budget earns £3.44 |
| arbitrage | assume any quote 10 bps beyond the true fair is taken at once | the card is scored with it on |

## 3. Robustness (Q3)

| d | θ 3 | θ 5 | θ 10 | θ 15 |
|---|---|---|---|---|
| 6 | 1.619 / 5.273 | 2.627 / 6.676 | 0.954 / 3.474 | -13.431 / -15.129 |
| 8 | 2.08 / 8.654 | 1.145 / 9.406 | 1.257 / 5.908 | -3.119 / 2.548 |
| 10 | 0.669 / 10.91 | 1.349 / 10.406 | 1.473 / 9.891 | -1.277 / 6.636 |
| 12 | 1.866 / 12.049 | 1.474 / 13.223 | 1.563 / 11.12 | 0.633 / 10.116 |
| 14 | 2.232 / 11.759 | 3.257 / 12.185 | 1.931 / 11.073 | 1.276 / 10.268 |
| 16 | 2.057 / 11.134 | 2.055 / 12.045 | 1.303 / 12.204 | 0.853 / 11.077 |
| 20 | 0.033 / 8.51 | 0.826 / 8.893 | 0.587 / 9.11 | 0.386 / 7.836 |

Rows d bps, columns θ: in-week / out-week £ a day at £600, κ 0.5 (`results/rule_XRP-GBP1031b.json`, `plateau`, to 10-30). The card and its variants, below, run 10-17 → 10-31 11:00 UTC.

| variant | £/day | in wk | out wk | 10-31 | P days | P hours | days > 0 | tight £/day | wide £/h | fills/day | placed/day | max/s | max/min | worst h / d / wk | inv mean / max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ahead100 | 5.67 | 2.554 | 8.759 | 5.59 | 0.0 | 0.0003 | 13/15 | 2.231 | 0.849 | 24.7 | 2660.3 | 2 | 76 | -6.36 / 0.0 / 6.59 | 122.4 / 650.9 |
| ahead2000 | 2.845 | 3.595 | 2.157 | 2.28 | 0.0712 | 0.0725 | 9/15 | 1.97 | 0.274 | 7.6 | 2805.3 | 2 | 76 | -19.13 / -18.53 / 6.06 | 153.0 / 620.7 |
| ahead500 | 4.367 | 3.747 | 4.971 | 4.28 | 0.0013 | 0.005 | 9/15 | 2.196 | 0.569 | 15.4 | 2824.3 | 2 | 76 | -11.29 / -1.09 / 7.11 | 157.3 / 656.3 |
| arb5 | 6.445 | 0.834 | 11.776 | 8.1 | 0.0 | 0.0 | 9/15 | 1.363 | 1.174 | 64.0 | 2339.4 | 2 | 74 | -3.78 / -0.37 / 4.16 | 88.0 / 621.6 |
| cap120 | 1.878 | 0.501 | 3.198 | 2.19 | 0.0 | 0.0 | 12/15 | 0.484 | 0.327 | 56.0 | 2345.2 | 2 | 70 | -1.27 / 0.0 / 1.26 | 21.7 / 136.7 |
| cap1200 | 12.979 | 5.1 | 20.828 | 12.59 | 0.0 | 0.0 | 12/15 | 4.58 | 2.037 | 66.9 | 2722.8 | 2 | 76 | -12.67 / -0.9 / 13.13 | 239.5 / 1261.4 |
| card | 7.771 | 3.257 | 12.185 | 8.1 | 0.0 | 0.0 | 10/15 | 2.762 | 1.216 | 63.5 | 2536.4 | 2 | 76 | -8.17 / -0.03 / 5.96 | 135.2 / 636.8 |
| d12 | 7.383 | 1.474 | 13.223 | 7.53 | 0.0005 | 0.0 | 13/15 | 1.961 | 1.274 | 77.9 | 2690.8 | 2 | 76 | -5.57 / -6.03 / 8.34 | 129.5 / 633.4 |
| d16 | 7.155 | 2.055 | 12.045 | 8.29 | 0.0 | 0.0003 | 10/15 | 2.167 | 1.187 | 50.4 | 2982.0 | 2 | 65 | -6.36 / -0.8 / 4.76 | 122.4 / 692.1 |
| fx_const | 4.599 | 0.895 | 7.772 | 8.1 | 0.01 | 0.006 | 12/15 | 1.518 | 0.741 | 59.5 | 2521.5 | 2 | 68 | -13.91 / -9.45 / 6.3 | 103.2 / 637.2 |
| gate4 | 6.147 | 0.204 | 11.771 | 8.1 | 0.0067 | 0.0 | 6/15 | 0.974 | 1.178 | 59.8 | 1295.4 | 2 | 76 | -2.69 / -0.03 / 1.43 | 49.0 / 614.9 |
| gate6 | 5.348 | 0.0 | 10.267 | 8.1 | 0.0808 | 0.0005 | 4/15 | 0.176 | 1.145 | 56.6 | 764.4 | 2 | 76 | -1.15 / 0.0 / 0.0 | 27.0 / 605.6 |
| gate8 | 5.148 | 0.0 | 9.841 | 8.1 | 0.0808 | 0.0005 | 4/15 | 0.173 | 1.101 | 54.9 | 711.1 | 2 | 76 | -1.76 / 0.0 / 0.0 | 26.4 / 605.5 |
| lat15 | -0.094 | -1.782 | 0.459 | 7.86 | 0.5793 | 0.4855 | 8/15 | -0.949 | 0.149 | 92.8 | 2573.6 | 2 | 61 | -25.44 / -10.53 / -5.72 | 91.3 / 595.0 |
| lat15_noarb | 5.832 | 2.398 | 8.959 | 7.71 | 0.0005 | 0.0005 | 13/15 | 1.729 | 0.974 | 75.9 | 2837.5 | 2 | 71 | -4.13 / -6.28 / 5.67 | 119.4 / 684.0 |
| lat2 | 6.11 | 1.502 | 10.395 | 8.08 | 0.0 | 0.0 | 11/15 | 1.467 | 1.082 | 65.9 | 2588.5 | 2 | 74 | -4.6 / -0.83 / 6.41 | 110.3 / 625.0 |
| lat2_noarb | 7.219 | 2.712 | 11.556 | 8.08 | 0.0 | 0.0 | 12/15 | 2.293 | 1.179 | 63.7 | 2830.1 | 2 | 74 | -4.61 / -0.83 / 6.43 | 141.9 / 634.9 |
| lat5 | 3.156 | -0.505 | 6.104 | 8.0 | 0.0707 | 0.0455 | 12/15 | 0.385 | 0.625 | 74.5 | 2685.8 | 2 | 72 | -12.8 / -13.62 / -3.29 | 130.9 / 606.5 |
| lat5_noarb | 6.101 | 1.063 | 10.828 | 8.0 | 0.0335 | 0.0047 | 13/15 | 1.05 | 1.154 | 67.7 | 2984.8 | 2 | 76 | -3.62 / -13.62 / -1.19 | 167.4 / 608.5 |
| lat60 | -9.493 | -11.131 | -10.276 | 7.89 | 1.0 | 1.0 | 1/15 | -8.769 | -0.524 | 150.0 | 2530.3 | 2 | 61 | -20.85 / -28.1 / -69.5 | 90.0 / 580.1 |
| loop15 | 4.23 | 2.028 | 5.867 | 7.99 | 0.018 | 0.006 | 11/15 | 1.138 | 0.727 | 75.6 | 1736.2 | 2 | 18 | -8.12 / -6.49 / 3.98 | 105.5 / 659.6 |
| loop2 | 6.495 | 2.255 | 10.46 | 8.12 | 0.0 | 0.0 | 11/15 | 1.621 | 1.139 | 63.3 | 2236.2 | 2 | 42 | -5.66 / -0.01 / 6.4 | 85.6 / 621.6 |
| loop5 | 6.169 | 0.757 | 11.356 | 7.46 | 0.001 | 0.001 | 13/15 | 1.279 | 1.129 | 67.9 | 2370.7 | 2 | 32 | -3.31 / -6.2 / 2.7 | 129.4 / 677.8 |
| loop60 | 0.231 | -2.847 | 2.275 | 7.46 | 0.4763 | 0.4497 | 7/15 | -2.024 | 0.412 | 94.2 | 2118.4 | 2 | 12 | -15.91 / -9.7 / -25.59 | 80.3 / 599.5 |
| main_account_950 | 3.435 | 1.931 | 4.254 | 8.07 | 0.0 | 0.0 | 12/15 | 1.703 | 0.452 | 37.2 | 701.4 | 2 | 38 | -2.57 / -0.23 / 6.84 | 76.8 / 619.9 |
| no_arb | 6.988 | 2.001 | 11.77 | 8.1 | 0.0 | 0.0008 | 11/15 | 2.021 | 1.176 | 62.5 | 2887.8 | 2 | 76 | -8.17 / -5.9 / 6.24 | 169.1 / 627.9 |
| penny | 7.286 | 2.25 | 12.308 | 7.04 | 0.0 | 0.0 | 10/15 | 2.18 | 1.213 | 60.5 | 2547.1 | 2 | 70 | -6.35 / -0.17 / 5.03 | 111.1 / 634.1 |
| penny_d10 | 6.178 | 1.376 | 10.936 | 6.2 | 0.012 | 0.0013 | 13/15 | 1.241 | 1.137 | 83.8 | 2710.9 | 2 | 76 | -3.5 / -6.31 / 1.77 | 122.4 / 609.7 |
| penny_d18 | 5.262 | 0.785 | 9.224 | 8.62 | 0.001 | 0.0005 | 8/15 | 0.551 | 1.059 | 38.9 | 2299.5 | 2 | 76 | -3.23 / -0.08 / 2.65 | 50.4 / 570.9 |
| penny_no_arb | 6.697 | 1.442 | 11.858 | 7.04 | 0.0045 | 0.0027 | 11/15 | 1.631 | 1.182 | 59.4 | 2893.1 | 2 | 76 | -6.35 / -9.45 / 5.31 | 163.9 / 627.5 |
| react30_200 | 7.225 | 3.103 | 11.602 | 5.1 | 0.0 | 0.0003 | 11/15 | 2.725 | 1.103 | 45.9 | 2686.2 | 2 | 76 | -7.91 / -0.34 / 5.96 | 151.0 / 607.1 |
| react30_5000 | 6.07 | 3.103 | 9.54 | 2.28 | 0.0 | 0.0003 | 10/15 | 2.828 | 0.831 | 40.7 | 2778.7 | 2 | 76 | -7.91 / -0.67 / 5.96 | 148.6 / 563.5 |
| react5_1000 | 4.603 | 3.602 | 5.926 | 2.12 | 0.0 | 0.007 | 10/15 | 2.832 | 0.507 | 21.4 | 2846.3 | 2 | 76 | -9.41 / -2.23 / 6.1 | 200.4 / 619.7 |
| stale10 | 7.322 | 2.707 | 11.86 | 7.52 | 0.0 | 0.0 | 10/15 | 2.405 | 1.181 | 61.9 | 2706.3 | 2 | 76 | -7.71 / -0.03 / 5.96 | 125.7 / 631.1 |
| stale30 | 7.771 | 3.257 | 12.185 | 8.1 | 0.0 | 0.0 | 10/15 | 2.762 | 1.216 | 63.5 | 2538.5 | 2 | 76 | -8.17 / -0.03 / 5.96 | 135.2 / 636.8 |
| stop100 | 7.596 | 3.256 | 11.815 | 8.1 | 0.0 | 0.0 | 10/15 | 2.761 | 1.178 | 61.6 | 2456.2 | 2 | 51 | -8.17 / -0.03 / 5.95 | 135.1 / 636.8 |
| stop200 | 7.771 | 3.257 | 12.185 | 8.1 | 0.0 | 0.0 | 10/15 | 2.762 | 1.216 | 63.5 | 2536.4 | 2 | 76 | -8.17 / -0.03 / 5.96 | 135.2 / 636.8 |
| stop300 | 7.771 | 3.257 | 12.185 | 8.1 | 0.0 | 0.0 | 10/15 | 2.762 | 1.216 | 63.5 | 2536.4 | 2 | 76 | -8.17 / -0.03 / 5.96 | 135.2 / 636.8 |
| theta10 | 6.626 | 1.931 | 11.073 | 8.05 | 0.0 | 0.0 | 12/15 | 1.841 | 1.129 | 67.6 | 880.9 | 2 | 38 | -2.57 / -0.23 / 6.84 | 80.4 / 619.9 |
| vol1 | 7.139 | 3.159 | 10.934 | 8.1 | 0.0 | 0.0 | 9/15 | 2.154 | 1.186 | 59.4 | 2459.3 | 2 | 76 | -8.19 / -0.16 / 5.24 | 118.4 / 630.4 |
| vol1.5 | 6.003 | 2.32 | 9.346 | 8.1 | 0.0 | 0.0 | 9/15 | 1.542 | 1.045 | 54.1 | 2311.3 | 2 | 48 | -6.31 / 0.0 / 5.01 | 92.4 / 623.3 |
| vol1.5_d8 | 5.128 | 0.322 | 9.884 | 5.24 | 0.0125 | 0.0013 | 11/15 | 0.588 | 1.023 | 86.3 | 2585.2 | 2 | 48 | -3.01 / -3.56 / 1.81 | 87.9 / 619.6 |
| vol2 | 5.069 | 1.959 | 7.713 | 8.11 | 0.0 | 0.0 | 8/15 | 1.249 | 0.892 | 46.1 | 2316.9 | 2 | 42 | -6.34 / -0.16 / 2.91 | 88.8 / 621.3 |

**Out of sample by week, day and regime.**
- In-week (10-17 → 10-23): £3.26 a day. Out-week (10-24 → 10-30): £12.19 a day. 10-31 to 11:00 UTC: £8.10.
- Its days: +1.45, +4.51, −0.02, +8.84, +8.02, 0.00, 0.00 | +8.05, −0.03, 0.00, +0.34, +5.36, +23.79, +47.78 | +8.10.
- By regime: tight hours £2.76 a day (P = 0.0135), wide hours £1.22 an hour (§1.4).

**Pessimistic fills.**
- A competitor resting at our price ahead of us: £100 ahead → £5.67, £500 → £4.37, £2,000 → £2.85 (P 0.071).
- A competitor stepping a tick in front once our quote has rested r s, after which only the part beyond its size reaches us:
  30 s and £200 → £7.23, 5 s and £1,000 → £4.60, 30 s and £5,000 → £6.07.
- The ladders re-pricing against us would look like these.

**Latency.**

| data age | arbitrageur on | arbitrageur off |
|---|---|---|
| 1 s | £7.77 | £6.99 |
| 2 s | £6.11 | £7.22 |
| 5 s | £3.16 | £6.10 |
| 15 s | −£0.09 | £5.83 |
| 60 s | −£9.49 | |

- A loop that checks every U s: 2 s £6.50, 5 s £6.17, 15 s £4.23, 60 s £0.23.
- The arbitrageur is what makes speed matter.

**Orders and cancels.**
- **What the documentation says** (reference §2: the developer page as read 2026-09-20 and 2026-10-30):
  - `POST /orders`: 10 a second and 1,000 a day per account.
  - "The daily limit does not apply to sub-accounts"; each sub-account has its own limits.
  - At most 300 orders active per account.
  - A cancel is another endpoint, under the general 1,000 a minute and 100 a second, so it does not count toward the 1,000 a day.
- **What the card needs:** 2,536 placements a day (max 2 a second, 76 a minute) on one sub-account.
- **On a main account:** θ 10 with a budget of 950 placements earns £3.44 (701 placements); θ 10 without a budget earns £6.63
  (881 placements).
- **If cancels did count:** a main account would need about five times its budget for the card. One sub-account of Davies'
  own covers it either way.

**Worst.**
- Worst hour −£8.17, worst day −£0.03, worst ISO week +£5.96 (over three weeks).
- The coin's own worst rolling hour in these weeks was −4.3 %, £26 on a full £600 of XRP (CRYPTOBOOKS §3).

**P(mean ≤ 0).** 0.000 by 3-day blocks of days and by 12-hour blocks of hours (4,000 resamples, seed 20261031). It is under
0.01 for 31 of the 43 variants. The ones above 0.05 are: data 5 s or more late with the arbitrageur on, a 60 s loop, the
gates at 6 and 8 bps, and £2,000 of queue ahead of us.

**£ a day by capital.**
- Over these 15 days: £120 → £1.88, £600 → £7.77, £1,200 → £12.98.
- Over the year (§4): about £0.5, £1.8 and £3.3.

## 4. The year, replayed in its sampled windows

**Method.** `scripts/hist_fair.py` fetched, for every sampled day, Binance's one-second klines and Coinbase's one-minute BTC-USD,
BTC-GBP and USDT-USD candles (the BTC-USD / BTC-GBP ratio is GBP/USD). `scripts/hist_replay.py` runs the card in each
13:30–16:00 window. The first half hour warms the basis; each window starts in pounds and ends marked at the fair
(`results/hist_replay.json`).

| book | windows | £ a window mean (median) | P(mean ≤ 0) | windows > 0 | tight windows mean (P) | wide windows mean (n) | worst / best |
|---|---|---|---|---|---|---|---|
| XRP-GBP | 363 | 0.173 (0.00) | 0.042 | 103 | 0.137 (0.079) | 2.31 (6) | −12.27 / +16.54 |
| SOL-GBP | 363 | 0.039 (0.00) | 0.35 | 88 | 0.033 (0.38) | 0.19 (13) | −15.41 / +13.89 |

**XRP-GBP by month** (£ over the month's windows):

| 2025-11 | 2025-12 | 2026-01 | 2026-02 | 2026-03 | 2026-04 | 2026-05 | 2026-06 | 2026-07 | 2026-08 | 2026-09 | 2026-10 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| +9.61 | +16.57 | +8.26 | +7.53 | +12.98 | +0.60 | +1.19 | −7.03 | +3.05 | −13.64 | +5.77 | +17.93 |

In 198 of the 363 windows the card had no fill at all: on most normal days no taker pays 14 bps over the fair.

**From a window to a day.**
- On the 14 October days both replays cover, the full day earned 10.6 times the window (£108.10 against £10.23).
- On the tight days 10-17 → 10-27 the ratio was 16 (£31.16 against £1.96).
- So the year's windows imply **about £1.8 a day at £600** (0.173 × 10.6), and £1.5–2.2 on tight days.

This is the sober expectation; the last two weeks (£7.8 a day) were the unusual ones.

## 5. What the architecture has to meet

What the strategy needs, whatever runs it:

- **Fair feed:** Binance XRPUSDT best bid/ask (book ticker) at least once a second, at most 1 s old when used (2 s old costs
  about a fifth of the P&L, 5 s about three fifths). Fallback: Coinbase XRP-USD, which is 2–3 s late, so quote wider or stop
  while on it.
- **GBP/USD:** a second-level source no more than 120 s old (TrueFX; Kraken's GBPUSD at weekends). USDT/USD each minute.
- **Revolut X, private:**
  - place, cancel, and read our own orders and fills;
  - about 2,540 placements and 2,540 cancels a day, peaks of 2 a second and 76 a minute (the limit is 10 a second);
  - at most 2 orders resting at once;
  - a sub-account of Davies' own for this strategy alone (never the loop's, never PR5's `_2`);
  - fills read within a second or two, because a fill triggers the re-quote of both sides.
- **Revolut X, public:**
  - the book every few seconds for the regime signal (the others' touch, with our orders removed);
  - its trades once a minute for the basis.

  The public bucket is about one token a second per address, and on Supabase it is shared with the recorder and PR5. A 1 s
  reader there would starve them. So read the book through the private API if it serves one, or from another address.
- **State:**
  - coin held and its cost; pounds held;
  - each resting order's id, side, price, size and time placed;
  - the quote's reference fair;
  - the basis (3 hours of prints) and the regime signal's run counts;
  - the day's placements, the stop's cool-down, and the decay stop's 30-day tight-hours P&L;
  - the age of each feed.
- **Kill paths:** the stop (300 bps); the feed guards; a dead-man that cancels both orders when the loop misses 3 seconds;
  and Davies' switch.

## 6. SOL-GBP as the second arm; ETH-GBP

| d | θ 3 | θ 5 | θ 10 | θ 15 |
|---|---|---|---|---|
| 6 | 1.606 / -4.069 | 1.322 / -2.979 | 0.008 / -6.041 | -12.885 / -23.275 |
| 8 | 1.999 / -0.023 | 0.968 / -0.308 | 0.258 / -3.771 | -3.102 / -9.615 |
| 10 | 1.383 / 0.797 | 1.6 / 1.737 | 1.65 / -1.423 | 0.756 / -4.337 |
| 12 | 0.501 / -0.049 | 2.217 / 1.37 | 1.932 / 0.277 | 0.666 / -2.546 |
| 14 | 0.794 / 0.093 | 0.719 / 1.537 | 1.015 / 0.343 | 0.288 / -1.262 |
| 16 | 0.804 / 1.788 | 0.523 / 2.258 | 0.904 / 0.425 | 1.319 / -0.361 |
| 20 | 0.0 / 1.301 | 0.0 / 1.983 | 0.779 / 0.391 | 1.444 / -0.87 |

| variant | £/day | in wk | out wk | 10-31 | P days | P hours | days > 0 | tight £/day | wide £/h | fills/day | placed/day | max/s | max/min | worst h / d / wk | inv mean / max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ahead500 | 1.253 | 0.719 | 1.862 | 0.69 | 0.1232 | 0.115 | 8/15 | 1.412 | -0.162 | 2.7 | 3061.6 | 2 | 74 | -7.63 / -10.0 / 1.33 | 70.9 / 621.1 |
| cap120 | 0.355 | 0.144 | 0.316 | 2.1 | 0.1285 | 0.1278 | 8/15 | 0.318 | 0.063 | 9.4 | 3103.3 | 2 | 76 | -1.75 / -3.06 / 0.27 | 13.0 / 123.8 |
| cap1200 | 1.885 | 1.438 | 1.226 | 9.56 | 0.2367 | 0.2727 | 8/15 | 1.858 | 0.108 | 13.6 | 3145.0 | 2 | 76 | -24.63 / -39.3 / 2.65 | 143.8 / 1224.3 |
| card | 1.566 | 0.719 | 1.537 | 7.65 | 0.1303 | 0.138 | 8/15 | 1.474 | 0.182 | 12.0 | 3127.9 | 2 | 76 | -8.8 / -14.11 / 1.33 | 65.5 / 618.6 |
| d12 | 2.224 | 2.217 | 1.37 | 8.18 | 0.0512 | 0.076 | 6/15 | 2.106 | 0.242 | 15.4 | 2354.0 | 2 | 76 | -10.35 / -11.0 / 4.53 | 108.6 / 628.1 |
| d16 | 1.764 | 0.523 | 2.258 | 6.93 | 0.09 | 0.0897 | 7/15 | 1.672 | 0.19 | 8.9 | 3090.8 | 2 | 70 | -6.7 / -8.12 / -0.08 | 63.2 / 613.4 |
| fx_const | 0.221 | 0.711 | -1.366 | 7.9 | 0.4475 | 0.4183 | 8/15 | 0.064 | 0.217 | 18.6 | 2330.9 | 2 | 76 | -12.02 / -28.61 / -1.67 | 90.2 / 611.5 |
| gate6 | 1.151 | 0.0 | 1.788 | 4.71 | 0.2175 | 0.0243 | 2/15 | 1.057 | 0.17 | 8.0 | 205.6 | 2 | 28 | -1.97 / 0.0 / 0.0 | 6.1 / 230.5 |
| lat2 | 1.81 | 0.694 | 2.036 | 7.98 | 0.0725 | 0.173 | 9/15 | 1.698 | 0.217 | 15.9 | 2776.4 | 2 | 76 | -11.8 / -17.68 / 1.88 | 111.8 / 622.1 |
| loop2 | 1.405 | 1.348 | 0.637 | 7.14 | 0.075 | 0.2117 | 10/15 | 1.315 | 0.173 | 12.6 | 2872.7 | 2 | 44 | -10.94 / -15.04 / 2.96 | 108.5 / 616.7 |
| loop5 | 1.368 | 1.92 | -0.139 | 8.01 | 0.1575 | 0.2625 | 12/15 | 1.2 | 0.275 | 18.4 | 2372.9 | 2 | 28 | -15.02 / -21.43 / 4.43 | 130.8 / 615.3 |
| main_account_950 | 1.767 | 1.015 | 1.731 | 7.22 | 0.0 | 0.0115 | 11/15 | 1.676 | 0.189 | 12.2 | 710.2 | 2 | 42 | -3.77 / -0.4 / 2.76 | 77.0 / 602.5 |
| react5_1000 | 0.975 | 0.719 | 1.119 | 1.72 | 0.2208 | 0.2442 | 8/15 | 1.109 | -0.139 | 3.5 | 3099.1 | 2 | 76 | -9.39 / -18.07 / 1.33 | 82.5 / 615.5 |
| stop100 | 1.729 | 0.419 | 2.183 | 7.66 | 0.113 | 0.0772 | 6/15 | 1.642 | 0.182 | 11.2 | 2437.1 | 2 | 38 | -9.84 / -9.96 / -0.73 | 57.4 / 621.0 |
| theta10 | 1.099 | 1.015 | 0.343 | 6.94 | 0.0123 | 0.1822 | 10/15 | 0.949 | 0.241 | 16.9 | 890.4 | 2 | 42 | -11.14 / -5.67 / 2.76 | 76.2 / 607.6 |
| vol1.5_d8 | 2.604 | 1.344 | 3.224 | 7.01 | 0.0107 | 0.0163 | 9/15 | 2.525 | 0.205 | 18.9 | 2519.9 | 2 | 76 | -4.72 / -4.12 / 4.69 | 72.3 / 604.7 |

**SOL-GBP:**
- The card: £1.57 a day, P 0.13, 8 of 15 days positive, worst day −£14.11.
- The year: £0.04 a window, P 0.35, five losing months.
- Its best cells (d 12: £2.22, P 0.05; vol 1.5 with d 8: £2.60, P 0.011) are found after the fact, so they are not evidence.
- Today: £7.46 while its layer was away, nothing since 08:00.

Its wide regime is shorter and narrower than XRP-GBP's (34 bps away against XRP-GBP's 50). It earns when the layer is away and
little otherwise. Run it beside XRP-GBP on the same engine and report it; judge only XRP-GBP.

**ETH-GBP:** the card £0.25 a day (P 0.23), d 12 −£1.18, today £0.07. Dropped.

## 7. Taking stale quotes (method c): a short study

| book | takes/day | taker exit £/day | RX-mid exit £/day | P days | wk1 / wk2 £/day | 10-31 £ | L 1 / 2 / 5 / 15 / 30 / 60 s (taker exit) | IOC triggers/day (T 15) |
|---|---|---|---|---|---|---|---|---|
| NEAR-USD1031b | 7.33 | 1.8 | 2.197 | 0.065 | 2.272 / 1.584 | -0.0 | 1.8 / 3.015 / 3.317 / 3.302 / 0.877 / 0.667 | 1814.2 |
| SUI-GBP1031b | 7.8 | 1.417 | 1.001 | 0.074 | 0.834 / 2.202 | 0.0 | 1.417 / 1.061 / 0.887 / 1.222 / 1.48 / 1.214 | 809.6 |
| SUI-USD1031b | 7.53 | 1.8 | 1.926 | 0.022 | 1.265 / 2.531 | 0.425 | 1.8 / 1.557 / 0.752 / 0.973 / 0.427 / 0.395 | 807.0 |
| XRP-GBP1031b | 2.87 | 0.415 | 1.36 | 0.2365 | 0.0 / 0.891 | -0.007 | 0.415 / 0.568 / 0.383 / 0.093 / 0.04 / 0.091 | 370.2 |

**Method.** `scripts/stale2.py` keeps stale.py's evidence rule and adds:
- one take open at a time per book (£600, closed after 5 minutes);
- daily P&L and its bootstrap;
- a latency curve;
- an upper bound on the IOCs a live version would send (the seconds in which the outside price had moved 15 bps over 60 s).

**Results:**
- SUI-GBP, SUI-USD and NEAR-USD earn £1.4–1.8 a day each by the taker exit (P 0.02–0.07), with 9–11 of 15 days positive and
  worst days of −£3.6 to −£7.4.
- Unlike the maker, they keep earning at 15–30 s of latency (NEAR-USD £3.3 a day at 15 s): the ladders' pickers wait 90 s.
- XRP-GBP's take is weak: £0.42 a day, P 0.24.
- A live version needs an IOC each time a quote may be stale: up to 800–1,800 a day per book, so a sub-account.

It ranks below the maker. It deserves its own pre-registration later, not now.

## 8. Pre-registration draft: "Crypto quotes XRP/GBP" (paper)

**Status: DRAFT, superseded** by the frozen `2026-10-31-xrp-gbp-paper-prereg.md` (its §12 lists the differences). It replaced
CRYPTOBOOKS §7.

1. **What it tests.** Whether the card (§2) earns on XRP-GBP, in both regimes, on data it has not seen. SOL-GBP runs on the same
   engine and is reported, not judged.
2. **The rule.** `backtests/cryptobooks/scripts/rule.py`'s `sim` with `xrp_study.CARD`, at the sha in `MANIFEST.json`:
   - d 14 bps, θ 5, κ 0.5, £200 a quote, £600, starting in pounds;
   - the arbitrageur on at 10 bps;
   - `stop` 300 bps;
   - fair: Binance's one-second klines × USDT/USD ÷ GBP/USD (the FX recorder's TrueFX minute; Kraken's at weekends) × the
     trailing 3-hour basis.
3. **How it runs.** One call a minute (a row of `edge_calls`, under the watchdog). Each call:
   - reads XRP-GBP's and SOL-GBP's public trades since its last read (one request per book);
   - reads Binance's one-second klines for the last 120 s (one request per coin);
   - reads the XRP-GBP book once, for the regime column;
   - steps the engine through the closed minute, second by second, writing to its own tables.

   It is the replay on live data. It does not test queue position, latency or anyone's reaction; a live design would.
4. **Window.** 28 days from the first 00:00 UTC after it first runs.
5. **The bar.** XRP-GBP PASSES when all four hold:
   - the 28-day sum is above 0;
   - the circular 3-day block bootstrap of the daily mean (10,000 resamples, `random.Random(20261031)`) gives
     P(mean ≤ 0) < 0.10;
   - there are at least 300 fills;
   - the sum over the window's tight hours (pair spread < 16 bps) is 0 or more. If there are fewer than 100 tight hours, this
     condition counts as passed and the reading says so.
6. **Regime.** Each hour is labelled by its pair spread and by the live signal (§1.5). The reading reports P&L, fills and hours
   per regime, and the stablecoin maker's hours. Nothing in the test stops on the regime.
7. **Also reported, not judged:**
   - placements and cancels a day, and the peak per second and per minute;
   - inventory mean and max;
   - markouts at 1, 5, 30 and 300 s;
   - arbitrage fills;
   - the £120 and £1,200 sizes;
   - SOL-GBP;
   - the decay rule's 30-day tight-hours P&L.
8. **Void** if Binance's or Revolut X's public data is missing for more than 10 % of the window's minutes, or if Revolut X halts
   for more than a day. The window then restarts.
9. **What a pass leads to.** A live design for Davies on the requirements of §5: a 1 s loop or a Worker, a sub-account of his
   own, post-only orders, the stop, the feed guards and a dead-man. Nothing goes live without his word.

## 9. Not checked

- Whether Revolut X's private API serves an order book (that would keep the regime signal off the public bucket), and the real
  latency from wherever the architecture runs.
- How the slow ladders and the fast layer react to a quote inside them. The queue and reaction models in §3 are assumptions,
  not measurements.
- Whether the paper's minute-batched engine and a live 1 s loop give the same fills. They cannot: the live one also has
  latency and a queue.
- The year's windows cover 13:30–16:00 only, and the 10.6 scale comes from 14 October days, two of them wide.
- PENNY (one tick inside the others' touch, estimated from their prints) earned less than the fixed 14 bps (£7.29 a day). A
  version that reads the real book could not be tested on the tape.
- The stale take with a real book read, and overlapping takes across books against one capital.

## 10. Sources

- **Revolut X, keyless public endpoints:**
  - `/api/1.0/public/trades/all`: the 14-day tape, today's to 11:06 (`data/tape1031b_*`), and a year of 13:00–16:00 windows
    (`data/hist_*`);
  - `/api/2.0/public/order-book/{SYM}?region=UK&limit=20` (`data/rec1_rx.jsonl.gz`, 09:10 → 11:05 UTC).
- **Binance:** `data.binance.vision` one-second zips and `data-api.binance.vision/api/v3/klines?interval=1s` (not committed:
  `binance_1s.py` and `hist_fair.py` rebuild them); the book ticker (`data/rec1_ext.jsonl.gz`).
- **Coinbase:** Exchange `/products/{P}/ticker` and `/candles?granularity=60`.
- **Kraken:** `/0/public/Ticker`.
- **SQL** (read-only, Supabase flmvxigozjuizpckllvk, 2026-10-31), into `data/maker_events_1031.json`:
  `select book, kind, to_char(ts at time zone 'UTC','MM-DD HH24:MI') from agent_maker_events where ts >= '2026-10-30 18:00' and kind in ('appeared','disappeared') order by ts`
- **Reference §2** for Revolut X's limits.
- **Results:** `results/rule_XRP-GBP1031b.json`, `rule_SOL-GBP1031b.json`, `rule_ETH-GBP1031b.json`, `today2.json`,
  `transitions.json`, `stale2.json`, `regimes_hist.json`, `hist_replay.json`, `rec1.json`.
