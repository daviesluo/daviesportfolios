# A — The three crypto paper rows (TESTING STRATEGIES), studied 2026-09-27

> Appendix A of `2026-09-27-testing-portfolio-review.md`, written by a read-only research agent and kept as it
> reported. One thing changed after it: the defect in §4.1 was fixed the same evening (`0068`, reference §4 item 41),
> which re-dated probes 15 and 17 to 2 and 39 minutes. Probe 17's later fill changes the entries' row of §4.2's table
> at T = 15 and 30 minutes (1 of 2 filled, not 2 of 2); the review's §2.3 has the corrected figures. The scratch
> scripts it names were not kept; the SQL is in §8.

Read-only study. Production read at 2026-09-27 21:39–21:50 UTC (`select now()` = Sun 21:38:57 UTC). Nothing in the
repository was changed; no migration, deploy, order or write. The live row appears only as context, in prices and
basis points, never in dollars or balances.

---

## 1. Summary (ten lines)

1. Seven days of record (rows seeded 2026-09-20 18:23 UTC): trend-4h 210 bar decisions / 4 entries / 3 exits,
   trend-1h 510 / 5 / 4, momentum-1d 24 / 3 / 0. Recomputed from the stored numbers, **all 796 trend decisions derive
   their state and action exactly as the rulebook does, and all 7 exits are correct 3×ATR close-trail exits**; no floor
   stop fired; paired live/control decisions agree **76 of 76**.
2. Equal-slot sleeve results for the week: trend-4h **−0.78 %**, trend-1h **−0.57 %**, momentum-1d **+5.59 %** (open),
   against equal-weight buy-and-hold of their coins of +13.2 % / +6.7 % / +6.7 %. One week is ~1 SD of noise for these
   sleeves; it cannot confirm or contradict any backtest. Holds and turnover match the backtests' mechanics.
3. Things that look wrong, all small: (a) the maker-probe fill test credits the minute that began **before** the probe
   existed (2 of 11 probes); (b) momentum-1d's first two entries were taken 18.4 h after their bar closed (before
   `entryTooLate` existed), ≈ +0.5 points of its +5.6; (c) SUI's UK spread this week is **23.7 bps median** (1,815
   samples), not §3.20's 14.9; (d) the one live fill paid **+4.1 bps** more than its paper control's fill.
4. Jev shadow since `0059`: **1 entry (trend-1h SOL, P = 0.74), 0 would-veto**. The v2 gate is a deterministic
   function of the recorded state, so the shadow can only re-ask a question the four-window backtest already
   answered; deciding it forward needs ~5–50 years. Keep it as a drift monitor (4 of 4 v2 answers sit in their measured band).
5. Maker probes: 11 probes = **9 market events, 9 of 9 filled within 57 min (median 8)**, saving 10.1–13.1 bps a side
   when filled. `adverseBps` (m15 median 35, m60 12) is not the decision number for these orders (§4.3); the decision
   numbers favour resting, on 9 events, with 7 exits and only 2 entries.
6. Best candidate: **maker-first execution (post-only at the touch, 60-min TTL, then cross)** — never rejected (§3.13:
   "not adopted, and not rejected on its merits"), worth ~+4.7–8.5 points a year to trend-1h if the probes hold. Draft
   pre-registration in §6; it needs ~40 events per side (~12 weeks at average rates) and two small recording fixes first.
7. Set: **keep all three rows; retire, merge or add nothing.** Changes worth making are in measurement and execution,
   not rules.

---

## 2. Per-row record (production, 2026-09-20 18:23 → 2026-09-27 21:39 UTC, 7.1 days)

### 2.1 Checks that apply to every row

- **State and rule recomputed from each decision's stored `numbers`** (SQL Q5): trend word (SMA gap ±0.2 %), breakout
  (close vs prior 55-bar high / 20-bar low), volatility band, momentum sign, and the entry/exit rule. trend-4h 210,
  trend-1h 510, trend-4h-live 76 decisions: **0 mismatches, 0 wrong entries, 0 missed entries, 0 missed trend/range
  exits**. momentum-1d's 24 checked by eye: every long decision has `ret30d` > 0 and no exit was due.
- **Trailing-stop exits recomputed** (Q6): high-water = max(entry fill, every Kraken signal-bar high from the start of
  the fill's bar — `fromItsBar`), level = high-water − 3×ATR(14). All 7 exits had close < level; no long bar had
  close < level without an exit.
- **Bars**: trend-4h 44 of 44 bars decided; momentum-1d 8 of 8; trend-1h 170 of 172 (09-22 15:00 and 16:00, the
  documented 3-hour tick crash). Neither missing bar carried an entry signal (closes 86,403–86,449 / 2,743–2,746 /
  117.36–117.47 under prior 55-bar highs of 87,446.7 / 2,806.69 / 119.97; Q9).
- **Risk gate**: every decision `risk_allowed`; no refusal of any kind this week. `ops_errors` for the tick: the
  known 09-22 crash (188) and 09-23 timeouts (9); nothing since 09-24.
- **Paper fills** (Q7): every paper order with a recorded touch filled at exactly that touch (0.00 bps slip), read
  2.9–5.4 s before the order; the cost against the mid was 1.3–2.0 bps. A paper fill can sit a hair outside the next
  minute's traded range (order 35: 120.890 against a minute low of 120.899): the model fills at the quoted ask, not a
  print. That is the documented model, not a fault.

### 2.2 trend-4h (paper control; BTC/ETH/SOL/AVAX/SUI; v2 gate at 0.45)

| | entry (UTC, price) | exit (UTC, price, reason) | hold | gross | net of 2×9 bps |
|---|---|---|---|---|---|
| ETH | 09-21 04:01, 2,665.74 | 09-23 16:01, 2,655.55, 3×ATR trail | 60 h | −38.2 bps | −56.2 bps |
| BTC | 09-21 12:01, 84,848.67 | 09-24 04:01, 83,911.13, 3×ATR trail | 64 h | −110.5 | −128.5 |
| SOL | 09-21 12:01, 116.788 | 09-24 12:01, 113.260, 3×ATR trail | 72 h | −302.1 | −320.1 |
| SOL | 09-25 12:01, 120.890 | open (UK bid 122.521) | 57.7 h | +134.9 | +116.9 |

- Jev (v1 then v2): 0.94 / 0.95 / 0.61 (v1, SOL passed 0.60 by 0.01) / 0.59 (v2 ≥ 0.45). No veto.
- **AVAX**: no signal (−4.3 % over the week). **SUI**: three breakouts, each refused by the rulebook's own
  "volatility extreme" clause (42-bar realised vol 1.09 / 1.41 / 1.42 annualised, closes 1.016 / 1.139 / 1.264);
  SUI rose **+50.4 %** over the week. See candidate 5 for why this is not worth a test.
- Every trade gave its gain back: all three entries came in the 09-21 breakout, rose to highs of 87,446.7 / 2,806.69
  / 119.97 on 09-21/22, and were trailed out on the pullback before the second leg. The replay in
  `reviews/2026-09-24-trend4h-golive-validation.md` predicted the ETH exit on the 09-23 12:00 bar; production did
  exactly that. Its fill-price proxy was within 1.5–2.2 bps (ETH), −6.0 (SOL) and +9.7 bps (BTC) of the recorded fills.
- Sleeve (equal $200 slots): **−387.9 bps of a slot = −0.78 % of capital**. Recorded paper dollars: realised
  −$6.72, open +$2.52 after its buy fee, total −$4.20 (−0.42 %) — smaller because the first three trades ran on the
  old $13.33 slot scaled ×10 ($133). Fees $0.89. Deployment ~30 % of slot-time (backtest 8.8–17.3 %).

### 2.3 trend-1h (paper; BTC/ETH/SOL; v1 gate → v2 gate (`0047`) → shadow (`0059`))

| | entry | exit (all 3×ATR trail) | hold | gross | net |
|---|---|---|---|---|---|
| ETH | 09-21 01:01, 2,688.96 | 09-22 05:01, 2,729.03 | 28 h | +149.0 | +131.0 |
| BTC | 09-21 09:01, 83,765.44 | 09-22 04:01, 85,662.28 | 19 h | +226.4 | +208.4 |
| SOL | 09-21 21:01, 119.214 | 09-22 08:01, 116.288 | 11 h | −245.4 | −263.4 |
| SOL | 09-25 12:01, 120.890 | 09-26 10:01, 119.956 | 22 h | −77.3 | −95.3 |
| SOL | 09-27 08:01, 124.184 | open (bid 122.521) | 13.7 h | −133.9 | −151.9 |

- 7 rule entry signals; 2 vetoed by the v1 gate (SOL 09-21 08:00 and 13:00 bars, P = 0.59 < 0.60), 5 taken.
- Sleeve: **−171.2 bps of a slot = −0.57 %**. Recorded paper dollars −$0.64 realised, −$4.76 open, −$5.40 in all
  (−0.54 %); fees $2.70. Median closed hold 20.5 h = 0.85 d (backtest medians 0.77–0.92 d). 9 fills in 7.1 days,
  about twice the backtests' 46–56 per 90 days: a trend week.
- It did its measurement job: it produced 6 of the week's 9 maker-probe events.

### 2.4 momentum-1d (paper; BTC/ETH/SOL; decided once a day on the 00:00 UTC close)

| | entry | status | gross | net (exit fee assumed) |
|---|---|---|---|---|
| ETH | 09-20 18:25, 2,631.40 (09-19 bar) | open 171 h | +187.5 | +169.5 |
| SOL | 09-20 18:25, 110.054 (09-19 bar) | open 171 h | +1,132.8 | +1,114.8 |
| BTC | 09-21 00:01, 81,161.66 (09-20 bar) | open 166 h | +412.0 | +394.0 |

- 4 entry signals, 1 vetoed by v1 (BTC 09-19 bar, P = 0.15, weak trend); BTC entered the next day at 81,161.66,
  against a Kraken open of 81,129.9 at the time of the veto: the veto cost ≈ +4 bps.
- Sleeve **+559 bps = +5.59 %** (recorded +$56.84 = +5.68 %). 100 % deployed since 09-21 (backtest daily cadence
  39–56 %).
- **Record artefact**: ETH and SOL were decided at 18:24 on 09-20 for the daily bar that closed at 00:00 — 18.4 h
  late. Today's `entryTooLate` (a quarter of a bar, 6 h) would refuse them, and the rule would have entered at the
  09-21 00:00 decision, at a Kraken open of 2,644.67 and 111.15 instead of 2,631.40 and 110.054: the record is ≈ 0.5
  and 1.0 points better per slot than the rule as it runs now, ≈ +0.5 points of the sleeve.
- **The row's benchmark is not §3.17's table.** §3.17 (and `testingset.json`) price momentum-1d every 4 hours; the
  loop decides once a day. The daily-cadence rulebook is in `jev_v2_other.json` (primary evaluation, rulebook arm):
  **A −9.0 % (DD 42.4 %), B +70.1 %, C +104.4 %, D +5.8 %**, 30–55 entries a year, 39–56 % deployed — against the
  4-hour cadence's −8.1 / +62.4 / +106.2 / −7.2 %. That 13-point gap in D from decision timing alone is itself a
  finding about how path-dependent this row's paper record is (candidate 4).

### 2.5 For context only: trend-4h-live against its control

- **76 of 76 paired decisions identical** (rule, final action, full state, close) from the 09-24 16:00 bar on (Q10).
- One fill each, same bar (09-25 08:00): live SOL buy avg **120.94** (IOC, limit 121.02, re-read ask 120.899, fee
  9.04 bps in SOL); paper control **120.89** (ask read 5.4 s earlier). Live paid **+3.4 bps over the re-read ask and
  +4.1 bps over the paper fill**; against the mid, 5.71 bps live vs 2.03 paper. The committed book snapshot of 09-24
  00:12 UTC (`backtests/golive50/inputs/revx_books.json.gz`) shows ~$5,000 at SOL's top ask, so a $25 order does not
  walk that book: latency or a stale ticker is the likelier cause. One fill; it is candidate 2's first pair.
- Live since arming: SOL +130.7 bps gross at the bid (+112.7 net of both fees), one slot of four. Control over the
  same span: +134.9 / +116.9.
- **An expected divergence that has not happened yet**: `max_exposure_usd` is $25 = one slot, marked to market. While
  SOL is held (now above cost), the next coin to signal will be refused on the live row ("exposure … > max 25") and
  entered on the control. That is the documented cap, not a fault; read live against control per fill, not per total.

### 2.6 Against the backtests, for this period and market

- **Mechanics match**: every decision recomputes, exits are the rule's close trail, the go-live replay's prediction
  (ETH out on 09-23 12:00) came true, and holds sit where the backtests put them (trend-4h 2.5–3 d against 3.2–3.4;
  trend-1h 0.85 d against 0.77–0.92).
- **Returns cannot be compared.** The market was a strong bull week (BTC +4.6 %, ETH +2.7 %, SOL +12.8 %, AVAX −4.3 %,
  SUI +50.4 %, Kraken 4h, 09-20 16:00 → 09-27 20:00). Window C (the strong-bull year) implies ≈ +0.85 % / +0.64 % /
  +1.38 % a week for trend-4h / trend-1h / momentum-1d. The sleeves' weekly SD, estimated from coin volatility
  (6–9 % a week) × deployment (30 % / 18 % / ~100 %) × correlation ~0.7, is ~1.5–2 % / ~1–1.5 % / ~4–6 %. The
  week's −0.78 / −0.57 / +5.59 % sit about 1 SD from those means. That is an assumption-based scale, not a
  measurement: the backtests publish no weekly distribution.
- Three losing trades out of three on trend-4h is ordinary: §3.12 has the median trend-4h round trip negative and
  the 96 bps line crossed only at its 66th percentile. With P(loss) ≈ 0.6, three losers in a row is roughly a 1-in-5
  event.

---

## 3. Jev in shadow on trend-1h and momentum-1d (since `0059`, committed 2026-09-26 19:42 UTC)

**The record**: 1 shadow entry (trend-1h SOL, 09-27 07:00 bar, moderate·normal·positive, **P = 0.74, would not
veto**). momentum-1d has been long all three coins since 09-21, so it has asked nothing. **Would-veto entries: 0.
There is nothing to score.**

**Why the forward shadow cannot decide the question it seems to ask.** Under v2 at 0.45, the model's reply is
effectively a deterministic function of the recorded state (`jev_answers_v2_other.json`, 5 replies per state):

- trend-1h: 6 of 54 states are refused on every call — exactly weak trend + high volatility (P 0.37–0.41). The
  other 48 pass on every call. None is decided call by call.
- momentum-1d: 128 of 189 states are refused on every call (mostly 4-hour downtrends, flat trends and closes below
  the range), 54 pass, and 7 are call by call (below the 20-bar low inside an uptrend, 0.42–0.47).

So "would have vetoed" = "the state was X", which the four-window backtest already priced with many more entries
(`jev_v2_other.json`; §4 items 21 and 28: trend-1h's gate lowers the worst window in all four evaluations; the daily
momentum gate lowers it by 4–15 points). The forward record can only add one short window to that answer.

**Power** (one-sided α = 0.05, 80 % power, two-sample difference in mean per-trade return, would-veto vs rest):

| row | would-veto entries a year (A–D, backtest) | others | assumed per-trade SD | effect to detect | would-veto entries needed | years |
|---|---|---|---|---|---|---|
| trend-1h | 4 / 19 / 9 / 5 (mean ≈ 9) | ≈ 86 | 250 bps (the week's 4 closed trades: 215) | 100 bps | ≈ 43 | ≈ 4.6 |
| trend-1h | same | same | 400 bps | 100 bps | ≈ 109 | ≈ 12 |
| trend-1h | same | same | 250 bps | 50 bps | ≈ 170 | ≈ 18 |
| momentum-1d (daily) | 38 / 19 / 18 / 28 (≈ 26) | ≈ 15 | 800 bps | 300 bps | N ≈ 190 entries in all | ≈ 4.6 |
| momentum-1d (daily) | same | same | 1,500 bps | 300 bps | N ≈ 660 | ≈ 16 |

The per-trade SDs are assumptions, bracketed; the answer ("years") does not depend on where in the bracket the truth
lies. **Too little data, and it will stay too little.**

**What the shadow is good for: drift.** The live row and its control gate at 0.45 in a band where every state is
decided the same way on every call. A vendor update that moves replies by ~0.05 would flip decisions silently. Every
v2 answer recorded so far sits inside its measured band: trend-1h SOL weak·normal 0.56 (measured 0.55–0.57), moderate·
normal 0.74 (0.74–0.75); trend-4h SOL strong·high 0.59 (paper) and 0.58 (live) (0.58–0.61). See candidate 3.

For completeness, the three v1-era vetoes (threshold 0.60, retired by `0047`): momentum-1d BTC (P 0.15) cost ≈ +4 bps
(re-entered the next day). trend-1h SOL (P 0.59 twice) was followed by the rule's later entry at 119.214, trailed out
at 116.288. An entry at the 09-21 09:00 open (115.27) would have left at the same exit, ≈ +0.9 % gross against −2.5 %.
These are anecdotes, n = 3.

---

## 4. The maker probes (`agent_maker_probes`, §3.13, `tradedThrough` of §3.26 / `0050`)

### 4.1 The record

11 probes, but probes 10, 12 and 14 are one market event (the SOL buy of 09-25 12:00 on trend-1h, trend-4h and the
live row), so **9 unique events: 7 exits, 2 entries**; momentum-1d's orders predate `0042`. Probes 1–3 have no
follow-up marks (`0050` cleared them).

| event | row | side | minutes to fill | spread gap | saving if filled (gap + 9) | adverse m15 | adverse m60 |
|---|---|---|---|---|---|---|---|
| BTC 09-22 04:00 | trend-1h | sell | 8 | 1.60 | 10.60 | — | — |
| ETH 09-22 05:00 | trend-1h | sell | 43 | 3.41 | 12.41 | — | — |
| SOL 09-22 08:00 | trend-1h | sell | 7 | 2.67 | 11.67 | — | — |
| ETH 09-23 16:00 | trend-4h | sell | 10 | 1.09 | 10.09 | +29.9 | −16.2 |
| BTC 09-24 04:00 | trend-4h | sell | 57 | 2.60 | 11.60 | +35.2 | +11.0 |
| SOL 09-24 12:00 | trend-4h | sell | 8 | 3.88 | 12.88 | +26.1 | +78.4 |
| SOL 09-25 12:00 (×3) | 1h, 4h, live | buy | 7 | 4.05 (live: 8.2 vs its fill) | 13.05 (live 17.2) | +105.3 | +12.4 |
| SOL 09-26 10:00 | trend-1h | sell | 1 * | 3.00 | 12.00 | +35.0 | +41.3 |
| SOL 09-27 08:00 | trend-1h | buy | 1 * | 3.30 | 12.30 | −57.3 | −4.4 |

- **Fill rate 11/11 (9/9 events) within the 4-hour watch; median 8 min (unique events), max 57 min.** With 0 misses
  in 9, the one-sided 95 % upper bound on the miss rate is 28 %; it is not yet small.
- **Saving when filled**: 10.1–13.1 bps a side (mean 11.8) on the paper probes: the full spread plus the 9 bps fee.
- **\* Defect**: probes 15 and 17 were resolved on the 1-minute candle that **started before the probe was opened**
  (10:00:00 vs 10:00:04.6; 08:00:00 vs 08:00:04.7), so a trade in those first ~5 seconds could have "filled" an order
  that did not yet exist. `tradedThrough` runs on the execution venue's last closed minute with no check of the
  minute's start against the probe's (or a resting paper order's) creation. The fix: ignore a minute that starts
  before the probe or order existed. Pin it with a counterfactual (a through-print in the opening minute must not
  fill). Both events would probably still have filled within 15–60 min: the UK touch 15–60 min later was beyond the
  maker price in `agent_basis`.
- **Dashboard reading** (`probeSummary`, all probes, duplicates included): adverse m15 median **+35.1 bps**, m60
  **+12.4 bps**; on unique events +32.5 / +11.7.

### 4.2 What the probe data say about the decision

`probeSummary`'s docstring (index.ts L361–366) and §3.13 say: read `adverseBps` against §3.13's 10–20 bps band —
"above it, resting loses more to selection than the 9 bps taker fee costs". **That compares two different
quantities**:

- §3.13's 10–20 bps is a *fill-condition* dial: how far the market must trade **through** the resting price before
  the backtest credits a fill, standing in for the queue.
- `adverseBps` is the *post-fill drift*.

For the rules' own orders the post-fill drift cancels:

- **Entry.** The taker buys at the ask at t0. The maker buys at the bid, filled at t_k. From t_k on, both hold the same
  position. Whatever the market does after the fill, the maker is ahead by exactly (ask − bid) + 9 bps.
- **Exit.** The same holds in reverse: after a sell, both are flat.

So the decision quantities are:

- P(fill within the rule's tolerance T);
- the saving when filled (spread + fee);
- the chase cost when not filled (the touch at T against the touch at t0; both pay the fee then).

The probes' real-book fill test — a trade strictly through the price — is the stringent version of §3.13's dial,
and it passed 9/9. §3.13 wanted exactly that measurement ("rest a paper bid at the touch alongside the live taker
order … a quarter of that settles the question").

The mean per-event advantage of "rest, then cross at T", from the probes plus the UK touch in `agent_basis` at t0 + T
(Q13):

| T | exits (7) filled / mean advantage | entries (2) filled / mean advantage |
|---|---|---|
| 15 min | 5/7; the ETH and BTC exits chase +8.9 and +11.8 bps → **+5.2 bps** | 2/2 → +12.7 bps |
| 30 min | 5/7; chases +36.6 and +0.1 → **+2.9 bps** | 2/2 → +12.7 bps |
| 60 min | 7/7 → **+11.6 bps** | 2/2 → +12.7 bps |

**Reading.** On 9 events, resting at the same-side touch with a 60-minute limit would have beaten crossing on every
one. The exits' mechanism is visible: the rule's trail sells on a close that has just fallen 3 ATR, the price bounces
within the hour, and the resting ask fills on the bounce. All 4 exits with follow-ups were 26–35 bps higher at m15
(3 of 4 still higher at m60, up to +78), which also says the trail exits at local lows.

**What it does not say.**

- The entries are 2 events. A breakout that never comes back is exactly what a resting bid misses.
- No protective floor stop has fired, and a resting stop is the failure §3.13 warned about ("a fall in which no bid
  comes back"). Stops must stay marketable whatever this shows.

**The data cannot yet decide; candidate 1 says how many events would.**

Which row to move first, if it passes: **trend-1h** (paper, highest turnover, no control role), never the paper
`trend-4h` (it must keep the live row's execution to stay its control), and the live row only on Davies' word.

---

## 5. Ideas the reference already tested and rejected (do not re-propose)

| idea | where | verdict |
|---|---|---|
| Faster rules: SMA 10/50 on 1h, hourly RSI reversion, 15-min and 1-hour trend, RSI(2) pullback | §3.2, §3.6 | nothing below an hour survives the ~20 bps round trip |
| Rotation rulebook variants (filter off, 7-day hold, top 1/3, 60-day lookback, wider baskets) and the 8 % floor on it | §3.4, §3.7, §3.8, §3.11, §3.17 | fails both windows; rows retired (`0043`/`0044`) |
| Breakout + volume confirmation, Bollinger squeeze, double bottom | §3.5 | not adopted |
| 1-minute dislocation / illiquidity rule | §3.5, `0038` | stale prints; retired |
| Wider universe (XRP, DOGE, LINK, ADA, the top 20 + next tier); momentum or trend-1h taking any coin | §3.7, §3.8, §3.15, §3.19 A1 | only AVAX (two-window, seeded, shipped stop); POL book too thin and fails window C; nothing joins momentum or trend-1h |
| BTC-regime entry filter | §3.9 (1), §3.10 (6), §3.15, §3.17 S1, §3.30 | rejected: worsens the sideways year beyond chance |
| Bare Donchian; 4-hour pullback in an uptrend; stale-trend exit; weekly bars | §3.9 (2–5), §3.12 | rejected |
| Slow Kraken rulebooks (slow 200/300, breakout 100/200, ATR 4/6, daily/weekly trend, Donchian, 3/6/12-month momentum); any Kraken execution or fee tier | §3.12, §3.14, §3.19 A4, §4 items 22–23 | 12 passes against 14.6 by chance; Revolut X wins 18/18; no Kraken money |
| `trend-4h-wide`, regime-trend on LINK/NEAR, AAVE on Kraken | §3.14 K3, §3.15 W4, §3.17 S3 | two-window luck; window D kills it |
| Intra-bar ATR trail (duplicate of the close trail) | §3.13, §4.11 | removed 2026-09-21 |
| 10 % floor; stop surface / ATR multipliers; time stop (20 bars) | §3.10 (5), §3.13 Q3, §3.19 A3 | 8 % and 3× close trail stay; 0 of 42 arms beat the incumbent on every window |
| Re-entry cooldown 0–8 bars | §3.13 Q2, §3.19 A3 | flat plateau; 2 stays |
| Scaling out, scaling in, pyramiding | §3.13 Q4, §3.19 A3 | all-in / all-out stays |
| Capital per coin: inverse vol, equal risk, per-entry vol scaling, prior-return or window-count weights, concentration | §3.10 (8), §3.11, §3.19 A2, §3.21 H1 | equal slots stands |
| Sideways-year gates: efficiency ratio, ATR breakout margin, trend slope, volatility band, confirmation bars (33 arms) | §3.17 S1 | 0 of 33; Pearson(refusal, ΔC) = −0.85 |
| DVOL gate, funding gate | §3.21 H2, H3 | fail |
| Execution at Binance's cost; Binance twins | §3.22, §4 item 29 + addendum | no verdict changes; twins deleted (`0065`) |
| Signal venue moved to Revolut X | §3.16 T4 | would delete three of four windows |
| Maker-only **rules** (RSI(2), lower Bollinger, ATR dip; 1h and 4h) | §3.23 | none passes |
| Cross-sectional momentum, reversal, low volatility (Binance universe) | §3.24, §3.25 | none passes |
| First-principles searches (touch quoting on majors, GBP↔USD cycle, listing/weekend premia, LST wicks, UK-only sweeps, cascade bids, delisting, zero-fee quotes, funding crowding, derivatives) | §3.26, §3.28, §3.29, §3.34, §3.38 | only PR5 (stablecoins) and CB (≈ cash) passed anything; nothing for these rows |
| A faster loop than one minute for the crypto rows | §3.39 | nothing binds them; loop stays |
| Jev gate variants: v1 at 0.60, weak-trend clause as code, v2 at 0.63, v2 on the paper rows, per-row v3 wordings | §4 items 21, 28 | none passes; paper rows in shadow (`0059`) |
| Fixed $20 per-order cap | §4 item 26 | removed |

**Explicitly open, never rejected**: maker execution of the rules' own orders (§3.13 Q1: "not adopted, and not
rejected on its merits … measure instead"; §3.17 S3 §4.2: "read that table when it has data"). That is candidate 1.

---

## 6. Candidates, ranked

Costs used throughout (this week's UK medians from 1,815–1,962 five-minute `agent_basis` samples, Q11): spread BTC
1.60, ETH 1.83, SOL 3.47, AVAX 9.66, SUI **23.68** bps. A taker round trip = 18 bps + one spread: BTC 19.6, ETH 19.8,
SOL 21.5, AVAX 27.7, SUI **41.7** bps.

### Candidate 1 — MX-1: maker-first execution of the rules' own entries and rule exits (post-only at the same-side touch, cross at T = 60 min)

- **Mechanism.** Revolut X charges 0 % maker / 9 bps taker. A post-only order at the same-side touch saves the full
  spread + 9 bps when filled (10.6–12.5 bps a side on BTC/ETH/SOL, 18.7 on AVAX). The cost is the chase when it is not
  filled by T. The protective floor stays marketable, always.
- **Prior evidence.**
  - §3.13 Q1: +1.64 (A) / −0.19 (B) points on trend-4h after the stop fix, under a synthetic-bid model; break-even
    10–20 bps of trade-through; "not rejected on its merits".
  - §3.17 §4.2: +1.4 to +2.1 points a year for trend-4h at 0 % maker; "cannot be claimed" until the probes speak.
  - The probes: 9/9 events filled within 57 min, the advantage positive at every T (§4.2 here).
  - The trade-through question §3.13 could not answer is answered on the real book for these 9 events.
- **Expected effect, net.**
  - At an advantage of ~11 bps a side: trend-1h **+4.7 to +8.5 points a year**. That is 128–233 fills a year ÷ 3 slots
    × 11 bps; its cost sensitivity in `testingset.json` is 3.2 points per 5 bps a fill in window A.
  - That would take trend-1h's worst window (A, +3.8 %, 192 fills) to roughly +10.8 % — about +8.5 % if the net
    advantage is only 7.5 bps.
  - trend-4h / the live row: +1.4 to +3.2 points a year. At $100 live, a few dollars a year.
  - If the miss rate is ≥ 10 % with 100+ bps chases, the effect goes to zero or below (power table below).
- **How to test.** Forward, on the real book, from the probes — they are the only instrument that sees the UK queue.
  Plus an optional four-window pricing, calibrated from them. Draft pre-registration below.
- **Honest estimate.** H1 (exits): likely passes (~60–70 %); the bounce-after-trail mechanism shows on 7/7 exit
  events. H2 (entries): uncertain (~40 %); 2 events so far, and breakouts that run are what a bid misses.

### Candidate 2 — EX-GAP: the paper model's execution optimism, measured on the live row against its control

- **Mechanism.** Paper fills take the ticker's touch read 3–5 s earlier. The live order re-reads the touch and pays
  whatever the venue gives. The first pair shows +4.1 bps a fill (+3.4 over the re-read ask). At trend-1h's turnover
  a 4 bps a fill gap is ~2.6 points a year: the same size as the row's window-A return. The paper rows' dollar
  figures (now ×10 / ×25) inherit it.
- **Prior evidence**: 1 pair. The 09-24 book snapshot rules out depth at $25–$333 on BTC/ETH/SOL/AVAX (top level
  $5,000–$16,000); SUI's top ask was $324.
- **Expected effect**: a calibration, not a return. It decides how much to trust paper dollars, and what a live
  capital raise (Davies: "之后测试表现好的话我还会再加资金的") would really pay.
- **Test**: pairs only, no code. Draft below. **Estimate**: will produce a usable number; whether it is > 0 is unknown.

### Candidate 3 — JEV-DRIFT: a monitor, not a hypothesis

- **Mechanism.** The live gate's determinism rests on the replies not moving (0.45 sits in the deterministic band
  (0.41, 0.47]). A vendor update is invisible otherwise.
- **Rule.** For every decision that carries a Jev answer (gate or shadow), compare P(healthy) with the measured
  replies for its exact state (`jev_answers_v2.json`, `jev_answers_v2_other.json`). Flag an answer outside
  [min − 0.02, max + 0.02]. Any flag on a live-row state, or two in a week, triggers a read-only re-measure
  (`POST ?action=jev`) before the next live entry.
- **Evidence**: 4 of 4 v2 answers in band. Cost: a query. It replaces the idea that the shadow will "test" the gate
  (§3).

### Candidate 4 — MOM-TRANCHE: phase-diversified momentum-1d (low priority)

- **Mechanism.** The same rule, but each coin's slot is split into six tranches, each deciding once a day at a
  different 4-hour close (00, 04 … 20 UTC). The decision time's luck averages out.
- **Prior evidence**: the same rulebook decided daily at 00:00 against every 4 h differs by **13 points in window D**
  (+5.8 vs −7.2 %) and 7.7 in B (`jev_v2_other.json`). The paper record is path-dependent at a scale comparable to its
  edge.
- **Expected effect**: none on the mean; less dependence on one phase. Six times the orders (≤ 18 a day) at a sixth
  of the size ($55 at $333 slots; the venue minimum is $0.10).
- **Test**: windows A–D, four evaluations. Bar: beat the incumbent's worst window in all four, and beat the median of
  the six single-phase arms (the null: a lucky phase is not a pass).
- **Estimate**: ~30 %, and a pass would repair timing luck, not find an edge. Only if Davies wants the momentum row
  to be a cleaner measurement.

### Candidate 5 — the "volatility extreme" entry clause (do NOT test)

- **Why it came up**: SUI's +50 % week was refused three times by it.
- **Power check** (counts only, no returns; `count_extreme.py` on Kraken's public 4h tape, 619 bars, 2026-06-16 →
  09-27): bars meeting every other entry condition, and those the clause blocked —

  | coin | bars meeting the other conditions | blocked by the clause | bars with vol ≥ 1.0 |
  |---|---|---|---|
  | BTC | 16 | 0 | 0 |
  | ETH | 10 | 0 | 0 |
  | SOL | 14 | 0 | 0 |
  | AVAX | 14 | 1 | 44 |
  | SUI | 9 | 5 | 83 |

- The clause binds almost only on SUI, which does not go live and whose round trip is ~42 bps. A test could not move
  the live row, and SUI's evidence is already undecidable (§3.20). Not worth a round.

### Not proposed (priors too strong)

- A multi-timeframe entry gate for trend-1h. Every entry gate so far is a regime bet (§3.17 S1, §3.21, §3.30).
- Any stop, cooldown, sizing, coin or rulebook change (§5).

### Draft pre-registration — MX-1 (to be frozen on `main` before any event it is judged on)

**Title.** Maker-first execution of the rules' own orders on Revolut X's UK book, read from the maker probes.

**Before the freeze** (recording only; each pinned with a counterfactual in `tick.test.ts`):

- (R1) A probe resolves only on a minute that **starts at or after** its opening (§4.1's defect).
- (R2) Every probe records the UK touch at opening + 15 / 30 / 60 min (e.g. `follow_up.o15/o30/o60` = bid and ask),
  filled or not, so the chase price outlives `agent_basis`'s 30-day prune.
- The freeze commit's timestamp starts the judged window. The 9 events before it are disclosed here and never judged.

**Unit.** One market event = (symbol, side, decision minute) on Revolut X from any row. Duplicate probes of one event
(paper rows and the live row) count once, at the earliest paper probe's prices. Protective (floor) exits are excluded
— no probe is opened on them today, and they stay marketable in every arm.

**Per-event advantage A_T, in bps of notional** (positive favours resting):

- If a UK trade prints strictly through `maker_price` in a minute starting within [open, open + T):
  **A_T = gap + 9**, where gap = (taker − maker)/maker for a buy and (maker − taker)/maker for a sell.
- Otherwise: **A_T = −chase**, where chase = (ask_T − taker)/taker for a buy and (taker − bid_T)/taker for a sell,
  with the touch from (R2). The fee is paid in both arms and cancels.
- T = 60 min is primary. T = 15 and 30 are reported, not judged.

**Hypotheses** (family of two, Holm at α = 0.05, one-sided):

- H1: mean A_60 over **rule-exit** events > 0.
- H2: mean A_60 over **entry** events > 0.

**Statistic and null.** 10,000 bootstrap resamples of events with replacement, `random.Random(20261001)`. The
one-sided p is the share of resampled means ≤ 0. A hypothesis passes if its Holm-adjusted p < 0.05 **and** the
resampled 5th percentile > 0.

Secondary, descriptive only: a circular-shift diagnostic. Each event's decision minute is shifted by a uniformly
random multiple of 60 min within ±7 days, same symbol and side, and A_60 recomputed from the UK 1-minute candles
(pulled weekly, within the venue's 28-day retention). This reports whether the rules' decision minutes are worse
for resting than random minutes.

**Reading date.** When H1 has 40 events and H2 has 40, or on 2027-01-15, whichever comes first. With fewer than 20
events a hypothesis is reported "undecided", never passed.

**Power** (normal approximation to the bootstrap, 80 % power; saving if filled s = 11.8 bps exits / 12.7 entries; the
chase R when a probe misses):

| miss rate p | R | events needed |
|---|---|---|
| 2 % | 50 bps (exits) | ≈ 4 |
| 5 % | 50 bps | ≈ 15 |
| 10 % | 50 bps | ≈ 67 |
| 2 % | 150 bps (entries) | ≈ 36 |
| 5 % | 150 bps | ≈ 370 |
| ≥ 8–10 % | 150 bps | never (the mean is ≤ 0) |

At the backtests' average rates (~0.5 exit and ~0.5 entry events a day across the three rows), 40 events per
hypothesis is ~12 weeks; this week ran at twice that.

**Fills** are at the resting limit only. Fees follow Revolut X's schedule: maker 0 %, taker 9 bps.

**What a pass allows.**

- A paper execution switch on trend-1h only: post-only at the touch, re-quoted at most 5 times, crossing at 60 min;
  floor stops marketable.
- The switch is itself read against this pre-registration's A_60 for a further 8 weeks.
- A four-window pricing (A–D, four evaluations, the loop's fills, stops and cooldown) with the resting fill rule
  calibrated so the backtest's 60-minute fill rate matches the probes'. It must not lower trend-1h's worst window in
  any evaluation.
- The live row only on Davies' word.

**Deviations** are recorded in the review, the reference and the ledger, each with a pin that fails on the old code.

### Draft pre-registration — EX-GAP (short)

- **Unit.** A live fill with a paper `trend-4h` fill of the same symbol, side and decision bar.
- **Gap, bps (positive = live worse)**: side-signed (live avg − paper)/paper × 10⁴ + (live fee bps − 9).
- **Reading.** At 16 pairs or 2027-01-31: mean, and a bootstrap 90 % interval (10,000 draws with replacement, seed
  20261002).
- **Decision.**
  - If the interval's lower end is > 0, every paper-row reading and Davies' page note carry a paper-execution
    adjustment = mean gap × fills (a reading, never written into the book).
  - If it straddles 0, no adjustment.
- **Power.** At a gap SD of 4 bps, 16 pairs give ±1.6 bps. At the live row's pace (one open position at a time
  under its $25 cap), ~2–4 months.
- **Now**: 1 pair, +4.18 bps.

---

## 7. Is this the right crypto testing set?

**Keep all three; retire, merge or add nothing.** The week gives no reason to reopen §3.17 / §3.19's verdicts. Each
row still has a job only it does:

- **trend-4h (paper)** is the live row's control: 76/76 identical decisions, and the only way to price the live fill
  (+4.1 bps on the first pair) and to see the one-slot cap's cost once it binds. Its SUI slot stays (§3.20's
  addendum). It is harmless, but it barely measures anything:
  - the "volatility extreme" clause blocks most of SUI's signals (5 of 9 signal-bars in 103 days);
  - its UK book is 23.7 bps wide at the median (> 20 bps in 91 % of samples, > 50 bps in 5.7 %);
  - so its round trip is ~42 bps — §3.8's figure, not §3.20's ~33.
- **trend-1h** did its stated job: 9 fills in a week, 6 of 9 probe events. It is also the natural vehicle for MX-1,
  because it is paper, fast and nobody's control. Its return stays unread as evidence (§3.17).
- **momentum-1d** is the only different rulebook (0.46–0.63 with the live row). Hold it to its **daily-cadence**
  record (A −9.0 % with a 42 % drawdown, D +5.8 %), not §3.17's 4-hour figures.
- **Add**: nothing clears §4.15 or §3.17 S3, and MX-1 needs no new row — the probes are the forward test. A
  "maker twin" would repeat the Kraken and Binance twins' mistake: same decisions, measuring what the probes already
  measure.
- **Record corrections worth making** (for whoever edits the reference):
  1. SUI's UK spread (§3.20).
  2. momentum-1d's benchmark cadence (§3.17 / page).
  3. The `adverseBps` reading (§3.13, `probeSummary` docstring).
  4. The probe opening-minute defect.
  5. momentum-1d's 18.4-hour-late first entries.
  6. The live row will diverge from its control by design once a second coin signals.

---

## 8. What was run

All production reads were `SELECT` through `mcp__Supabase__execute_sql`, project `flmvxigozjuizpckllvk`.

```sql
-- Q0 clock
select now(), to_char(now(),'Dy');

-- Q1 rows
select id, kind, venue, signal_venue, name, symbols, mode, capital_usd, params, created_at, updated_at, retired_at
from agent_strategies order by created_at;

-- Q2 decision counts
select strategy_id, mode, count(*) n, min(ts), max(ts), min(bar_start), max(bar_start),
 count(*) filter (where rule_action='enter') rule_enter, count(*) filter (where rule_action='exit') rule_exit,
 count(*) filter (where final_action='enter') final_enter, count(*) filter (where final_action='exit') final_exit,
 count(*) filter (where risk_allowed) allowed
from agent_decisions group by 1,2 order by 1,2;

-- Q3 every non-hold decision, with Jev's answer and the state
select id, ts, strategy_id, symbol, mode, bar_start, rule_action, left(rule_reason,80), final_action,
 left(final_reason,160), risk_allowed, left(risk_reason,60), answers->'healthy_trend',
 state->>'trend_strength', state->>'volatility', state->>'momentum_30d'
from agent_decisions where rule_action <> 'hold' or final_action <> 'hold' order by ts;

-- Q4 reasons histogram; the 'volatility extreme' decisions
select strategy_id, left(rule_reason,60), left(regexp_replace(final_reason,'\[.*\]',''),90), count(*)
from agent_decisions group by 1,2,3 order by 1, 4 desc;
select id, strategy_id, symbol, bar_start, rule_reason, state->>'volatility', (numbers->>'vol')::numeric,
 (numbers->>'close')::numeric, (numbers->>'priorHigh')::numeric
from agent_decisions where rule_reason like 'volatility extreme%' order by bar_start;

-- Q5 state and rule recomputed from the stored numbers
with d as (select id, strategy_id, rule_action, rule_reason, state,
  (numbers->>'smaFast')::float8 f, (numbers->>'smaSlow')::float8 s, (numbers->>'close')::float8 c,
  (numbers->>'priorHigh')::float8 ph, (numbers->>'priorLow')::float8 pl, (numbers->>'vol')::float8 v,
  (numbers->>'ret30d')::float8 r
  from agent_decisions where strategy_id in ('trend-4h','trend-1h','trend-4h-live')),
x as (select *,
  case when f is null or s is null then 'flat' when (f-s)/s > 0.002 then 'up' when (f-s)/s < -0.002 then 'down' else 'flat' end tr_calc,
  case when ph is null then 'inside_range' when c > ph then 'above_range' when pl is not null and c < pl then 'below_range' else 'inside_range' end br_calc,
  case when v is null then 'normal' when v < 0.35 then 'low' when v < 0.65 then 'normal' when v < 1.0 then 'high' else 'extreme' end vol_calc,
  case when r is null then 'unknown' when r > 0 then 'positive' else 'negative' end mom_calc from d)
select strategy_id, count(*),
 count(*) filter (where tr_calc <> state->>'trend_4h'), count(*) filter (where br_calc <> state->>'breakout_4h'),
 count(*) filter (where vol_calc <> state->>'volatility'), count(*) filter (where mom_calc <> state->>'momentum_30d'),
 count(*) filter (where state->>'position'='flat' and rule_action='enter' and not (tr_calc='up' and br_calc='above_range' and mom_calc<>'negative' and vol_calc<>'extreme')),
 count(*) filter (where state->>'position'='flat' and rule_action<>'enter' and (tr_calc='up' and br_calc='above_range' and mom_calc<>'negative' and vol_calc<>'extreme')),
 count(*) filter (where state->>'position'='long' and rule_action='hold' and (tr_calc='down' or br_calc='below_range')),
 count(*) filter (where state->>'position'='long' and rule_action='exit' and not (tr_calc='down' or br_calc='below_range') and rule_reason not like 'ATR%')
from x group by 1;

-- Q6 trailing stops recomputed (high-water from the fill's bar on the Kraken signal tape)
with buys as (select strategy_id, symbol, filled_at, avg_fill_price,
   lead(filled_at) over (partition by strategy_id, symbol order by filled_at) next_buy
   from agent_orders where state='filled' and side='buy' and strategy_id in ('trend-4h','trend-1h','trend-4h-live')),
d as (select d.id, d.strategy_id, d.symbol, d.bar_start, d.rule_action, d.rule_reason,
   (d.numbers->>'close')::float8 c, (d.numbers->>'atr')::float8 atr, b.filled_at, b.avg_fill_price,
   case when d.strategy_id='trend-1h' then 60 else 240 end iv
   from agent_decisions d join buys b on b.strategy_id=d.strategy_id and b.symbol=d.symbol
    and d.ts > b.filled_at and (b.next_buy is null or d.ts < b.next_buy)
   where d.state->>'position'='long'),
h as (select d.*, (select max(c.high) from agent_candles c where c.venue='kraken' and c.symbol=d.symbol
   and c.interval_min=d.iv and c.start >= to_timestamp(floor(extract(epoch from d.filled_at)/(d.iv*60))*(d.iv*60))
   and c.start <= d.bar_start)::float8 hw_bars from d)
select strategy_id, symbol, bar_start, rule_action, c, greatest(hw_bars, avg_fill_price::float8) hw, atr,
 (c < greatest(hw_bars, avg_fill_price::float8) - 3*atr) trail_hit
from h where rule_action='exit' or (c < greatest(hw_bars, avg_fill_price::float8) - 3*atr) order by 1,3;

-- Q7 orders; the touch each paper order was filled at; the live/paper SOL pair's request and response
select o.*, d.bar_start from agent_orders o left join agent_decisions d on d.id=o.decision_id order by o.ts;
select id, strategy_id, side, price, avg_fill_price, (request->'touch'->>'bid')::numeric, (request->'touch'->>'ask')::numeric,
 (request->'touch'->>'ageMs')::int, request->'touch'->>'reread',
 (response->'paperFillCandle'->>'low')::numeric, (response->'paperFillCandle'->>'high')::numeric,
 (response->'paperFillCandle'->>'volume')::numeric
from agent_orders order by id;
select id, strategy_id, mode, request, response from agent_orders where id in (33,35,37);

-- Q8 round trips, P&L and holds (the live row reported in bps only)
with f as (select o.*, row_number() over (partition by strategy_id, symbol, side order by coalesce(filled_at, ts)) k
   from agent_orders o where state='filled'),
rt as (select b.strategy_id, b.symbol, b.mode, b.filled_at buy_at, b.avg_fill_price buy_px, b.filled_base qty, b.fee_usd buy_fee,
   s.filled_at sell_at, s.avg_fill_price sell_px, s.fee_usd sell_fee
   from f b left join f s on s.strategy_id=b.strategy_id and s.symbol=b.symbol and s.side='sell' and s.k=b.k where b.side='buy'),
marks as (select distinct on (symbol) symbol, revx_bid from agent_basis order by symbol, ts desc)
select rt.*, extract(epoch from (coalesce(sell_at, now()) - buy_at))/3600 hours,
 ((coalesce(sell_px, revx_bid)/buy_px) - 1)*1e4 gross_bps, ((coalesce(sell_px, revx_bid)/buy_px) - 1)*1e4 - 18 net_bps
from rt join marks using (symbol) order by strategy_id, buy_at;

-- Q9 gaps in decided bars; the two missing trend-1h bars' breakout check
select g from generate_series('2026-09-20 17:00+00'::timestamptz,'2026-09-27 20:00+00','1 hour') g
where not exists (select 1 from agent_decisions d where d.strategy_id='trend-1h' and d.bar_start=g);
-- (and the 55-bar-high / SMA-gap window query on agent_candles for 09-22 15:00 and 16:00)

-- Q10 the live row against its control
select count(*), count(*) filter (where p.rule_action=l.rule_action), count(*) filter (where p.final_action=l.final_action),
 count(*) filter (where p.state=l.state), count(*) filter (where (p.numbers->>'close')=(l.numbers->>'close'))
from agent_decisions p join agent_decisions l on l.strategy_id='trend-4h-live' and p.strategy_id='trend-4h'
 and l.symbol=p.symbol and l.bar_start=p.bar_start;

-- Q11 UK spreads and basis, this week
select symbol, count(*),
 percentile_cont(0.5) within group (order by (revx_ask-revx_bid)/((revx_ask+revx_bid)/2)*1e4),
 percentile_cont(0.9) within group (order by (revx_ask-revx_bid)/((revx_ask+revx_bid)/2)*1e4),
 max((revx_ask-revx_bid)/((revx_ask+revx_bid)/2)*1e4)
from agent_basis where ts > '2026-09-21 02:00+00' and revx_bid>0 and revx_ask>0 group by 1;
-- (and the share of SUI/AVAX samples over 20 and 50 bps, and SUI's median by day)

-- Q12 buy-and-hold for the week (Kraken 4h, 09-20 16:00 open → last close; and from 09-24 20:00)
-- Q12b momentum-1d / trend-1h prices at the vetoed and late-entry moments (agent_candles, kraken, 60)

-- Q13 probes: the record, per-event savings and adverse drift, fill minute against opening, chase cost at T
select id, strategy_id, symbol, side, mode, taker_price, maker_price, state, resolved_at, minutes_to_fill,
 mark_at_resolve, follow_up, fill_minute from agent_maker_probes order by id;
select id, ts, to_timestamp((fill_minute->>'start')::bigint/1000),
 (to_timestamp((fill_minute->>'start')::bigint/1000) < ts) starts_before_probe
from agent_maker_probes order by id;
with p as (select distinct on (symbol, side, date_trunc('minute', ts)) id, symbol, side, ts,
   taker_price::float8 tp, maker_price::float8 mp, minutes_to_fill
   from agent_maker_probes order by symbol, side, date_trunc('minute', ts), id),
t as (select p.*, off.m, (select b from agent_basis b where b.symbol=p.symbol
   and b.ts between p.ts + (off.m||' minutes')::interval - interval '150 seconds'
   and p.ts + (off.m||' minutes')::interval + interval '150 seconds'
   order by abs(extract(epoch from (b.ts - (p.ts + (off.m||' minutes')::interval)))) limit 1) bb
   from p cross join (values (15),(30),(60),(240)) off(m))
select id, symbol, side, minutes_to_fill, m, case when minutes_to_fill <= m then 'filled' else 'chase' end,
 (case when side='buy' then ((bb).revx_ask::float8 - tp)/tp else (tp - (bb).revx_bid::float8)/tp end)*1e4 chase_bps
from t order by id, m;

-- Q14 risk caps; ops_errors for the tick since 09-20
select global_pause, max_exposure_usd, paper_exposure_usd, daily_loss_limit_usd, paper_daily_loss_limit_usd,
 max_orders_per_day, (live_confirmed_at is not null) from agent_risk;
select kind, date_trunc('day', created_at), count(*), left(min(message),140) from ops_errors
where created_at > '2026-09-20' and (kind ilike '%agent%' or kind ilike '%tick%') group by 1,2 order by 2,1;
```

**Local, read-only commands** (no repository file changed):

- `grep` / `sed` over `docs/agents/reference.md`, `docs/LEDGER.md`, `docs/agents/reviews/*`,
  `supabase/functions/_shared/agents_strategy.ts`, `supabase/functions/agents/{tick,index}.ts` and the migrations.
- Python reads of the committed JSON:
  - `testingset.json`, `jev_v2_other.json` (configurations, refused signals), `jev_answers_v2*.json`;
  - `golive50/replay.json` and `golive50/inputs/revx_books.json.gz` (book-walk cost at $25–$1,000 from the
    09-24 snapshot).
- Keyless public GETs: 3 to Revolut X `/api/1.0/public/trades/all?symbol=BTC-USD` (one hour each on 2024-06-01,
  2025-10-01 and 2026-09-27). UK prints were 1, 60 and 6 in those hours (the last hour also had 72 EEA prints): the
  tape goes back at least to 2024-06, but UK prints are sparse, which favours the forward probes over a tape replay
  for MX-1.
- 10 Kraken public OHLC GETs for the extreme-volatility count, script
  `count_extreme.py` (not kept) (counts only, no returns).
- No order endpoint, no signed call, no write.
