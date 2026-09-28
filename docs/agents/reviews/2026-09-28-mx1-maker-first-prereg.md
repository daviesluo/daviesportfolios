# Pre-registration MX-1: maker-first execution of the rules' own orders, read from the maker probes and the trade tape

Written 2026-09-28 (UTC), before any event it is judged on. Frozen by the commit that adds this file. The reading
quotes that commit's hash and committer time, and that instant starts the judged window. Any change after it is a
deviation and is reported as one.

Davies, 2026-09-27, choosing what the TESTING review ranked: "MX-1 挂单执行 (推荐), RW-NEXT + 建 RW-C, QUEUE 排队模型,
PR5-R 等低优先级". The review is `2026-09-27-testing-portfolio-review.md`; this is the draft in its appendix A §6,
made exact, and then corrected by an independent review of the draft (2026-09-28, findings M1–M11). Its constant C* was
then fixed by a measurement made before the freeze (§5). The power that constant left was put to Davies before the
freeze: at 60 events a side, with two hypotheses at 2.5 %, a true exit miss rate of 5.0 % would pass one time in five,
and entries almost never. He chose, on 2026-09-28, to judge exits only, with one test at 5 %, read at 150 exits
("MX-1和JEV-DRIFT按照你推荐的来"); entries are described beside. The file below is that design, with a second
independent review's fourteen findings applied before the freeze.

## 1. The question

Every order the crypto rows place on Revolut X crosses the touch: it buys at the ask or sells at the bid and pays the
9 bps taker fee. The venue charges 0 % to a maker. Would the rows do better to rest a post-only order at their own
side's touch (the bid for a buy, the ask for a sell), and cross only if it has not filled by a deadline?

§3.13 left this open ("not adopted, and not rejected on its merits"), because a backtest on synthetic bids cannot say
whether a resting order on the UK book fills. The maker probes (`0042`) mark the place: every marketable order also
writes down where a post-only order would have rested. Three recording changes came first:

- **R1** (`0068`, reference §4 item 41): the loop counts a probe filled only by a trade in a minute that began at or
  after the probe was written.
- **R2** (reference §4 item 42): every probe records the touch 15, 30 and 60 minutes after it was written, filled or
  not.
- **R3** (reference §4 item 44): every probe records the id of the order it shadows.

The loop's own fill test reads 1-minute candles, and the tape showed it wrong both ways on the probes before this file
(§8). So **MX-1 reads fills from the venue's public trade tape**, which keeps every print with its millisecond, and
keeps the loop's reading only as a check.

Protective (floor) stops are outside this question. They stay marketable whatever MX-1 finds: a resting stop is the
failure §3.13 warned of, a fall in which no bid comes back.

## 2. Data

**Probes.** `public.agent_maker_probes` on Revolut X (`venue = 'revx'`), paper and live rows alike. Each is read with
the order it names (`order_id`, R3) and that order's decision (`agent_orders.decision_id` → `agent_decisions`).

Before grouping, a probe is dropped, and counted, when:

- its `order_id` is null (void: R3 was live before the freeze, so this should not happen);
- its decision is protective: `(agent_decisions.numbers->>'kind') = 'protective'`;
- its order did not fill: `agent_orders.filled_base` is 0 or null, as for a live IOC that died unfilled.

**The trend rules only.** C* was measured on `trend-4h` and `trend-1h` decisions (§5), so only the probes of rows whose
rulebook (`agent_strategies.kind`) is `trend-4h` or `trend-1h` form the events MX-1 can judge: today `trend-4h`,
`trend-4h-live` and `trend-1h`. The probes of `momentum-1d`, and of any other rulebook, are grouped the same way among
themselves and described, never judged.

**Events.** One event is one market decision: a symbol, a side, and the close of the bar decided, which is the
decision's `bar_start` plus its rule's bar length (`decisionBarMs`: 4 hours for `trend-4h`, 1 hour for `trend-1h`, 1 day
for `momentum-1d`). Every remaining probe with that symbol, side and bar close belongs to the event, across rows. The
paper rows and the live row often decide the same bar, and an IOC retried on a later turn is the same decision.
**An event counts only if its bar close is at or after the freeze instant**, so every probe in it was written after
the freeze. An event whose bar closed before it is not MX-1's, even when a retried IOC's probe comes later.

**The event's prices** come from one probe and its order:

- the earliest probe in the event whose order is a filled **paper** order; if there is none, the earliest whose order is
  a filled **live** order;
- `t0` is that probe's `ts`; `P` its `maker_price` (the same side's touch at that moment); `K` its order's
  `avg_fill_price`, the price actually paid or received. Never `taker_price`: on a live order that is the IOC limit, the
  touch plus up to 50 bps;
- `Q` is that order's `base_size`.

**Exits and entries.** The rows are long-only. A sell is an exit and a buy an entry.

**Eligible and described.** An event is **eligible** when it is BTC/USD, ETH/USD or SOL/USD, of the trend rules, counts
(its bar close is at or after the freeze), its deadline (§3) has passed, and it is not void (§3). Eligible exit events
are judged (§4); eligible entry events are described. AVAX and SUI events are reported beside, never judged: their
spreads (SUI's median 23.7 bps) would move a small mean by several bps and say nothing about the rule a pass acts on.

**The tape.** `GET https://revx.revolut.com/api/1.0/public/trades/all?symbol={BASE}-USD&start_date={ms}&end_date={ms}&limit=100`,
following `metadata.next_cursor` until it is exhausted, keeping prints with `region = "UK"`. Each print carries `price`,
`quantity` and `timestamp` (ms). The prints for every event's window are pulled weekly and committed under
`docs/agents/backtests/mx1/tape/`, one gzipped JSON file per pull; the reading uses the committed files. A window whose
pull fails after five attempts, with a pause of 2, 4, 8 and 16 seconds, is retried at every later weekly pull (the tape
is permanent), and is void only if it still fails at the reading.

**Stand-in touches.** `agent_basis` keeps the Revolut X touch (`revx_bid`, `revx_ask`) every fifth minute and is pruned
at 30 days. For every event whose `o15` or `o60` is missing or null, the rows §3 would use as its stand-in are exported
weekly and committed under `docs/agents/backtests/mx1/basis/`.

## 3. The measure

For an event with `t0`, `P`, `K` and `Q`, and a deadline of T minutes:

- **The cross time** `c_T` is the probe's `follow_up.o{T}.at`, the turn at which a resting order would have crossed.
  When that mark is missing or null (R2 writes null when the loop reaches it more than 3 minutes late), `c_T` is
  `t0 + T` minutes.
- **Filled within T** if and only if the UK prints with `t0 < timestamp < c_T` that are strictly through `P` — price
  below `P` for a buy, above `P` for a sell — add up to at least `Q` in `quantity`. To trade through `P`, a buyer or
  seller must first take everything resting at `P`, so each such print fills a resting order at `P` by up to its own
  size. A partial fill counts as a miss.

The advantage of resting over crossing, in bps of notional, positive favouring the rest:

- **Filled within T:** `A_T = gap + 9`, where `gap = (K − P) / P × 10⁴` for a buy and `(P − K) / P × 10⁴` for a sell.
  The maker saves the spread it did not cross and the 9 bps fee it did not pay. From the fill on, both hold the same
  position, so nothing after the fill enters.
- **Not filled within T:** the order crosses at `c_T`, at the touch then: `A_T = −(ask_T − K) / K × 10⁴` for a buy and
  `−(K − bid_T) / K × 10⁴` for a sell. Both arms pay the 9 bps fee, so it cancels. `bid_T` and `ask_T` come from
  `follow_up.o{T}`; when that mark is missing or null, from the first exported `agent_basis` row of the symbol at or
  after `t0 + T` minutes and no more than 5 minutes after it.
- **A miss without a touch:** an event not filled within T with neither `o{T}` nor a stand-in row has no `A_T`. It
  still counts as a miss (x in §4) and is left out of the mean. Leaving it out of x as well would remove only misses, a
  bias toward a pass in one direction.
- **Void:** an event whose tape window cannot be read at the reading (§2). A filled event is never void for want of a
  touch, since its `A_T` does not use one. Void events are counted and listed, never judged.

**The deadlines.** Exits: T = 60, judged. Entries: T = 15, described; it is a quarter of `trend-1h`'s bar, the limit at
which the loop stops entering on a closed bar (`entryTooLate`). The other deadlines (15 and 30 for exits, 30 and 60 for
entries) are reported beside.

**The check.** The loop's own reading (`state`, `fill_minute`) is compared with the tape's for every event, and every
disagreement is listed: filled by one and not the other, or filled at different times.

## 4. Hypotheses

One hypothesis, at one-sided α = 0.05:

- **H1:** the mean of `A_60` over the eligible exit events is above 0.

Entries are not judged (below); the mean of `A_15` over the eligible entry events is described beside H1.

**Statistic.** The eligible exit events that have an `A_60` are sorted by `t0` (ties by symbol). 10,000 bootstrap
resamples, each `[rng.choice(ev) for _ in ev]` with Python's `random.Random(20261001)`; the means are sorted, and the
one-sided p is the share of resampled means at or below 0.

**A pass needs both:**

1. p < 0.05;
2. the rule sees misses it has not observed. With n eligible exit events and x misses, those without a touch included,
   `p_U` is the one-sided 95 % Clopper–Pearson upper bound on the miss rate, the 0.95 quantile of Beta(x + 1, n − x)
   (1 when x = n). `s_L` is the 5 % point of the bootstrap mean of `A_60` over the filled exit events only: 10,000
   resamples as above, with `random.Random(20261003)`, the sorted means' index 500. A pass needs
   `(1 − p_U) · s_L − p_U · C* > 0`, with **C* = 110 bps**, fixed now from a measurement made before the freeze (§5).
   H1 uses it for exits crossing at T = 60. The condition holds only if `p_U < s_L / (s_L + C*)`: 9.09 % at `s_L` =
   11 bps, and a little less when `s_L` is under 11.

Condition 2 exists because a sample with no miss passes the bootstrap whatever the true miss rate: when misses are rare
and large, the bootstrap alone passed a true mean of 0 in 14–52 % of simulated samples (the review's M2).

**Why entries are described, not judged.** On Binance's tape at the rules' own decision minutes (§5), entries crossing
at T = 15 missed 11.2 % of the time: above the 9.09 % at which C* = 110 and an 11 bps saving break even, pooled and on
BTC (15.7 %), under it on ETH (8.5 %) and SOL (8.1 %). Condition 2 needs the upper bound on the miss rate below that
line, so at that miss rate an entry hypothesis would pass with probability at most about 2 % at any sample size (§5),
and §5's caveat says the UK's miss rates are likely higher. Exits crossing at T = 60 missed 5.0 %, under the line. This
was known before the freeze and decided the design: one hypothesis, on exits.

**Descriptive, never judged:**

- entries at T = 15: the same bootstrap and condition 2, computed as for H1 with `random.Random(20261002)` and
  `random.Random(20261004)`, and reported without a verdict;
- the other deadlines, with the same bootstrap and without condition 2, since C* holds only for T = 60 on exits and
  T = 15 on entries;
- the fill rate within 15, 30 and 60 minutes, by symbol and side;
- the saving when filled and the chase when not, separately;
- AVAX and SUI events; `momentum-1d`'s events (§2); `trend-1h`'s own events; each row's;
- a UTC-day block bootstrap beside the one above (events cluster on a bar and a day): whole days resampled, 10,000
  times, `random.Random(20261005)`;
- the misses without a touch, listed;
- the check's disagreements.

Whether the rules' own decision minutes are worse for resting than a random minute is answered before the freeze, on
Binance's 1-minute prints, in the measurement that fixes C* (§5); it is not re-measured here.

## 5. When it is read, and the constant C*

**When.** H1 is read at the first weekly pull after which there are at least **150 eligible exit events**, on the first
150 of them by `t0` (ties by symbol). If fewer than 150 eligible exit events have `t0` before **2027-06-30 00:00 UTC**,
it is read after the first weekly pull after that instant, on every eligible exit event with `t0` before it. With fewer
than 60 of them it is "undecided", never passed. Entries are described at the same reading, on the eligible entry events
with `t0` no later than the last judged exit's.

**C* = 110 bps.** H1 uses it for exits crossing at T = 60. It also holds for entries crossing at T = 15, and for no
other deadline. Exits alone would have needed 100 over A–C (140 over A–D); 110 was kept, as fixed before the design
changed. It was measured on 2026-09-28, before the freeze ("C* for MX-1: the chase at the rules' own decision minutes":
its report, scripts and tables in `docs/agents/backtests/mx1/cstar/`, with the sha256 of every input it read). No
production data was read for it.

- **What was measured.** The chase: what a resting order that misses pays, in bps, when it crosses at the deadline
  instead of at once. Its bound is taken at the rules' own decision minutes, since those are where a resting order
  would be placed.
- **The decisions.** From the repository's own simulator: `runSplit` in `agents/backtest_fill.ts` (`run` plus a fill
  log), on `backtest_testingset.ts`'s series and windows, with seeded parameters, `COSTS.revx` and the shipped stops
  (the 8 % floor, no intra-bar trail, a two-bar cooldown), each window starting flat. All 24 cells (2 rules × 3 coins
  × windows A–D) match `testingset.json`'s trades, stops, return and drawdown to 4 dp. The seven protective-floor stops
  (all `trend-4h`, all in A–C) are left out. `trend-4h` and `trend-1h` share 16 entry minutes in A–C, which leaves 412
  entry events and 419 exit events on MX-1's unit: both rules pooled, one event per symbol, side and minute. The
  decisions were computed on Coinbase's tape, the published tables'; the loop decides on Kraken's candles.
  `momentum-1d` was not measured.
- **The event.** t0 is the decision bar's close, m0 the open of the Binance 1-minute kline that starts at t0, and
  h = 1 bp (s = 2 bps). A buy rests at P = m0(1 − h), against a taker price K = m0(1 + h). It is filled if a minute
  starting in [t0, t0 + T) has a low strictly under P. Otherwise its chase is (open(t0 + T)(1 + h) − K) / K × 10⁴. A
  sell mirrors it, with the high above P and a chase of (K − open(t0 + T)(1 − h)) / K × 10⁴.
- **The tape and the windows.** Binance's public 1-minute klines (`data-api.binance.vision`) from 2022-08-20 to
  2026-09-28, covering windows A–D; C* is taken from A–C, 2023-08-22 → 2026-09-20. One 80-minute gap, a Binance outage
  on 2023-03-24 12:40–13:59 UTC, is in window D and touches no decision minute. Hand checks of three decisions in plain
  Python match to 4 dp, and the event code reproduces the first measurement (`chase.py`) exactly.
- **The rule that gives 110.** For each coin, the 97.5 % bootstrap upper bound of the mean chase at each side's own
  deadline, over A–C, with decisions counted per rule and on MX-1's unit: 4,000 resamples, a fresh
  `random.Random(1)` per cell, `sorted(means)[int(0.975 × 4000)]`. C* is the smallest multiple of 10 at or above every
  such bound.
- **The binding cells.** Entries: `trend-4h` SOL at T = 15, 109.97 bps from 4 misses (all 4⁴ resamples enumerated:
  109.969). Exits alone would need 100: `trend-1h` ETH at T = 60, 95.91 from 5 misses. On MX-1's unit alone, 90 would
  do for both sides (entries SOL 80.36, exits ETH 84.92). 110 also covers the Student-t bounds of the pooled unit,
  whose largest is 99.61.
- **What 110 does not cover.**
  - Entries crossing at T = 60. They need 180 on MX-1's unit (SOL, 178.03 from 4 misses), or 210 per rule
    (`trend-4h` SOL, 207.79 from 2).
  - Window D, 2022-08-22 → 2023-08-21, for exits. Over A–D, MX-1's unit needs 140 (BTC 135.34) and `trend-1h` alone
    200 (BTC 195.47). Both come from one exit, `trend-1h` BTC at the 2023-03-22 19:00 UTC close: 218.7 bps at 15
    minutes, 484.9 at 60. Entries at T = 15 are unchanged by D (MX-1's unit 75.86, per rule 109.97).
  - `momentum-1d`'s exits. They were not in the measurement, and so are not judged (§2).
  - The next large hour. The binding cells rest on 4–6 misses, the largest chases come from single hours, and a
    constant from three years does not bound the next such hour.
- **The break-even miss rate.** At C* = 110 and a saving of 11 bps, a miss rate of 11/121 = 9.09 % gives a mean of
  zero. On Binance's tape at the decision minutes (A–C, MX-1's unit), exits at T = 60 miss 5.0 % (BTC 6.6, ETH 4.5,
  SOL 3.3), under it; entries at T = 15 miss 11.2 % (BTC 15.7, ETH 8.5, SOL 8.1), over it pooled and on BTC. At the
  measured mean chases, not the bound, the mean `A_T` per event is positive in every A–C cell: entries at T = 15
  +5.40 bps on MX-1's unit, exits at T = 60 +8.25 bps. The saving when filled was 11.0002 bps on every filled buy and
  10.9998 on every filled sell (1,881 filled events): 2h / (1 ∓ h) + 9.
- **Decision minutes against ordinary closes** (A–C, MX-1's unit against every hour's close). Entries at T = 15 miss
  more often (11.2 % against 8.0 %, z = +2.35) and chase further when they miss (39.1 against 25.4 bps, +13.7, 95 %
  bootstrap [+5.7, +23.7]). Exits do not chase further: at T = 60, 43.8 against 53.3 bps, −9.5 [−22.1, +4.2]; they
  miss 5.0 % against 4.0 % (z = +1.03). This is §4's question about decision minutes, answered here; it is not
  re-measured.
- **The caveat.** Binance is not Revolut X's UK book. The fill test is a strict trade-through on the deepest tape, so
  the UK's miss rates at these minutes are likely higher; the chase is a price move and should transfer. The
  measurement took s = 2 bps for every coin, where the UK medians are BTC 1.60, ETH 1.83 and SOL 3.47 bps.

**What a pass needs**, with a saving of about 11 bps when filled (spread plus fee; `s_L` a little under it) and
C* = 110, the same line the entries' description uses:

- Condition 2 holds only if `p_U` is under 9.09 % (a little less when `s_L` is under 11 bps). `p_U` is an upper
  bound, so the miss rate observed must be well under that.
- Against it, the miss rates Binance's tape gives at the decision minutes (A–C, MX-1's unit):

  | side | deadline | pooled | BTC | ETH | SOL | break-even at C* = 110 |
  |---|---|---|---|---|---|---|
  | exits | T = 60 | 5.0 % (21/419) | 6.6 % (11/167) | 4.5 % (6/132) | 3.3 % (4/120) | 9.09 % |
  | entries | T = 15 | 11.2 % (46/412) | 15.7 % (25/159) | 8.5 % (11/130) | 8.1 % (10/123) | 9.09 % |

- On the same tape, at the measured mean chases rather than the bound, the mean `A_T` per event was +8.25 bps for
  exits at T = 60 and +5.40 for entries at T = 15. Condition 1 asks the UK's exits to be above 0.
- **Power.** Condition 2 at `s_L` = 11 bps and C* = 110, by §4's 95 % Clopper–Pearson bound: the most misses x it
  allows in n eligible exits, and the chance of at most x misses at the exits' pooled miss rate above (exact binomial;
  arithmetic only, not in the C* measurement's files):

  | n eligible exits | most misses allowed | chance at a true 5.0 % |
  |---|---|---|
  | 32 | 0 | 0.19 |
  | 60 | 1 | 0.19 |
  | 100 | 4 | 0.44 |
  | 150 | 7 | 0.52 |
  | 200 | 11 | 0.70 |

  Under 32 exits even no miss cannot pass. The table holds for `s_L` from 10.8 to 11.2 bps; at 10.6 or less the chance
  at n = 100 falls to 0.26. At the entries' 11.2 % the same chance is at most about 0.02 at any n: 0.02 at 32, and
  about 0.01 or less at 60, 100, 150 and 200. With the mean `A_60` near the measured +8 bps, condition 1 lowers these
  chances little. These are the numbers put to Davies; two tests at 97.5 % had given 0.19, 0.26, 0.37 and 0.58 at 60,
  100, 150 and 200.

At the pace of the week before this file (nine exits in six days, all BTC, ETH or SOL from the trend rules), 150
eligible exits take about 14 weeks. At the backtests' pace for the same rules and coins (419 exit events in A–C's 161
weeks, about 2.6 a week), they take about 57, so 2027-06-30 likely comes first, at about 100 exits (102 at that pace).
Around that count the chance at a true 5.0 % is 0.27–0.45, by where the count falls on the steps of the table (0.41 at
102).

## 6. What a pass allows, and what it does not

- **H1 passes:** `trend-1h` alone (paper; the fastest row and nobody's control) moves to maker-first exits, exactly as
  measured: a post-only sell at the ask, placed when the rule decides, never re-quoted, crossed marketable at the first
  turn at or after 60 minutes if it has not filled. Floor stops stay marketable. The paper `trend-4h` keeps the live
  row's execution, because it is the live row's control.
- **Entries do not switch**, whatever their description shows. A maker-first entry needs its own pre-registration,
  judged only on entry events after its own freeze.
- **Before the switch**, all of:
  1. `trend-1h`'s own eligible exit events, those with a `trend-1h` probe, have a positive mean `A_60`, with `A_60` as
     §3 computes it for the event;
  2. a four-window pricing (windows A–D, four evaluations, the loop's own fills, stops and cooldown) with one
     calibration dial: a resting exit fills in the pricing only in a minute whose high is more than m bps above `P`,
     where m is the smallest whole number, 0 or more, at which `trend-1h`'s exit fill rate within 60 minutes over A–C
     in the pricing is at or below the fill rate within 60 minutes of all the eligible exit events read for H1. The
     switch goes ahead only if it does not lower `trend-1h`'s worst-window return in any of the four evaluations;
  3. a test pins that the live row's order path is unchanged by the code that makes the switch;
  4. a paper resting order is filled the way §3 reads a fill, from the UK tape with its quantities, not from 1-minute
     candles, which erred both ways on the probes (§8);
  5. the post-only order records `request.touch` when it is placed, as a marketable order does today; a post-only
     order records none.
- **After a switch**, eight weeks are read, and at least 10 orders: each maker-first order's realised `A` is computed
  as in §3 from its own record, with `K` the far side of the touch it recorded when placed (`request.touch`, item 5).
  If the mean is at or below 0, `trend-1h` goes back to crossing. With fewer than 10 orders in eight weeks, the read
  waits for the tenth.
- **The live row changes only on Davies' word.**
- **A failed or undecided H1 changes nothing.** The probes keep recording.

## 7. What it cannot show

- **A queue.** Prints at `P` are not counted: a real order at the front of the queue at `P` could fill on them. That
  bias is pessimistic. The tape removes the optimistic one the candles had, a minute's extreme that was a quote.
- **Its own effect.** It cannot show how other traders would respond to a resting order of the rows' size. The paper
  rows are $1,000 each, so a slot is $200–$333; the live row's slot is $25.
- **A resting protective stop.**
- **Another market.** It measures the rules as they run, in the market of the window.

## 8. Seen before the freeze

Every probe written before 11:25 UTC on 2026-09-28, with the loop's reading and the tape's (UK prints strictly through
`P` after `t0`; the tape column is the review's, 2026-09-28, and probes 1 and 17 were re-read by the main session).
Minutes after `t0`. None of these is judged: each belongs to a bar that closed before the freeze (§2).

| probe | row | side | loop: fill minute starts | UK tape: first print through P |
|---|---|---|---|---|
| 1 BTC 09-22 04:00 | trend-1h | sell | 6.92 | none within 61 min, nor within 4 h |
| 2 ETH 09-22 05:00 | trend-1h | sell | 41.96 | 42.73 |
| 3 SOL 09-22 08:00 | trend-1h | sell | 5.93 | 6.23 |
| 4 ETH 09-23 16:00 | trend-4h | sell | 8.90 | 8.93 |
| 8 BTC 09-24 04:00 | trend-4h | sell | 55.92 | 56.39 |
| 9 SOL 09-24 12:00 | trend-4h | sell | 6.92 | 7.81 |
| 10, 12, 14 SOL 09-25 12:00 | trend-1h, trend-4h, live | buy | 5.91 | 5.97 |
| 15 SOL 09-26 10:00 | trend-1h | sell | 0.92 (after `0068`) | 0.68 |
| 17 SOL 09-27 08:00 | trend-1h | buy | 37.92 (after `0068`) | 0.84 |
| 19 SOL 09-27 23:00 | trend-1h | sell | 2.92 | 3.46 |
| 20, 21 SOL 09-28 08:00 | trend-4h, live | sell | 1.93 | 0.90 |

Probes 20 and 21 were read on 2026-09-28 by the main session (counted at 11:25 UTC, read in full minutes later). They
are the last as of 11:25 UTC; any written between then and the freeze commit is named in that commit's message, and
none is judged. t0 08:00:04.099, P = 118.032, the paper order's K = 118 and Q = 1.65439. The UK prints through P
reached the live order's quantity 2.59 minutes after t0 and the paper order's 3.45, so the event filled within 60
minutes by §3's rule too, and its `A_60` is +11.71 bps. The first print after t0, 0.01 minutes later, was the live
row's own sale: 0.206612 SOL at 118.

**R3 seen working.** Probes 20 and 21 are the first written after R3's deploy, and both name their orders: probe 20
order 43 (`trend-4h`, paper) and probe 21 order 44 (`trend-4h-live`, live), each of the same row, symbol, side and
mode, placed 0.04 and 0.15 seconds before its probe. No probe written since the deploy has a null `order_id`.

Read from the tape, 9 of the first 10 events filled within 60 minutes. Exits: the seven before probe 19 had a mean
`A_60` of about +5.4 to +6.2 bps, six of them filled (probe 1 would have crossed about 27–33 bps worse), and probe 19
was traded through 3.46 minutes after its `t0`. Entries: +12.7 bps at every deadline (both filled within 6 minutes).
The sizes were not checked against the prints' quantities, which §3 now requires. The eleventh event, probes 20 and 21,
filled by quantity as above: of the nine exits before the freeze, eight were traded through within 60 minutes.

Deviations are recorded in the review, the reference and the ledger, each with a pin that fails on the old code.
