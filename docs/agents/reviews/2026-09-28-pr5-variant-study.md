# PR5v: denser rungs, re-pricing, cadence and accounts for "Stablecoin quotes - variant" (2026-09-28)

Davies asked (2026-09-28) for PR5's GBP stablecoin quotes to be tested with denser and other rungs (at least 0.05,
0.15, 0.25, 0.35 and 0.40 %), for how fast the loop can run under Revolut X's 1,000 orders a day per key, and for
roughly how much more it would earn. He can open more sub-accounts if faster or more orders pay. The best configuration
of this round runs forward on paper as a new TESTING row, "Stablecoin quotes - variant", beside the frozen PR5 test,
which does not change.

This is a descriptive search on public data. No key, no signed call, no order; nothing of PR5's paper record, its
dry-run, `agent_book_levels` or any production table was read. The frozen simulator, `quotes.ts` and every frozen
pre-registration are unchanged. No weekend quoting on a held X was computed (that is PR5-W's question): the variant is
dark whenever PR5 is. Every number below is in `backtests/pr5v/pr5v_study.json` unless another file is named.

## Answer first

* **Rungs.** Since the books tightened, the fills are all close in. On their own, rungs at 0.05–0.15 % earn 14–16 %/yr
  on the capital they lock; 0.20–0.30 % earn 9–10 %; 0.35 % earns 4.5 %, and 0.40, 0.50 and 0.60 % fill once in 28 days,
  all three on the same USDC/GBP print on 08-28 at 14:17 UTC. Davies' set {0.05, 0.15, 0.25, 0.35, 0.40} makes more dollars than the
  frozen set but less per dollar (8.4 % against 11.0 %/yr under the same cap), because two of its five rungs are dead.
* **The fastest cadence under 1,000 a day is 1 second, and it earns nothing.** Cadence does not spend the order budget:
  from 60 s to 1 s the frozen set sends 205–207 POSTs a day (busiest 441) in every case. Re-prices follow GBP/USD, which
  is a minute bar, and fairU, which is hourly; a faster loop sees neither sooner than the bar allows. P&L moves by −5 %
  to +1 % across cadences, and 1–2 s of latency changes nothing (A table below). What binds a faster loop is Revolut X's
  10 POSTs a second when many rungs re-price at once, not the day's 1,000.
* **How much more.** Per locked dollar, nothing reliable. In dollars, a lot, by locking more capital and using more keys.
  The configuration the rules chose makes **$1.03 a day on $3,600 (10.4 %/yr)** over the 28 tightened days, against
  the frozen rule's **$0.42 a day on $1,200 (12.7 %/yr)**: paired by day, +$0.61 a day (7-day block bootstrap 95 %
  interval +$0.48 to +$0.75). The extra $2,400 earns about 9.3 %/yr. At the frozen rule's $1,200 the same shape earns
  12.8 %/yr, the frozen rule's own rate. The single change that carries the dollars is **more rungs close in**
  (0.03–0.15 %); the finer re-price step adds a little on top and is what needs the extra keys.
* **What extra keys buy.** For the dense set, each key doubles the POSTs it may send, which allows a finer re-price
  step: 1 key $0.74 a day (7.5 %/yr on $3,600), 2 keys $0.89 (9.0 %), 4 keys $1.03 (10.4 %), over the 28 days with the
  600/700 governor simulated. The second key adds $0.14 a day, the third and fourth together another $0.14.
* **Honest limits.** The variant's return per dollar is at or below the frozen rule's on every check: in-sample,
  out-of-sample, the five fresh days (5.1 against 7.0 %/yr) and the wide market before 24 August (28.4 against
  82.0 %/yr, where its fine re-price step runs into the governor on 41–81 days a key). Its dollars beat the frozen
  rule's because it holds three times the capital.

## What was re-computed before any of this was believed

* **The generalised simulator reproduces the frozen one exactly.** At PR5's settings (a turn a minute, orders live the
  next minute, X read at the minute's end, cancels instant, each rung's own 10 % cap, exits whole) `pr5v_sim.py` gives
  the frozen `simulate()`'s trips field for field and its orders day for day, over both books' whole primary windows
  (1,940 and 6,352 trips) and the 28 tightened days (40 and 62), in the primary and the stress arms
  (`backtests/pr5v/check_repro.json`, `PASS`). It imports the frozen file for its loaders and helpers and checks its
  sha256 (`56fbad85…`).
* **The additions are pinned** (`scripts/pr5v/test_pr5v.py`): the random-time twin run through the new engine equals
  the frozen `exit_only` on 300 random twins; two bids a print goes through share its quantity and the minute's cap,
  nearest first; a 1 s loop places an exit one step after its fill; a re-priced bid stays fillable at its old price
  until its cancel lands, and its replacement is then never sent; the governor withdraws entries at its threshold.
* **The fresh data agree with the committed tape and FX.** Yahoo's GBP/USD against Exness on the 4,224 minutes both
  have (2026-09-17 23:00 → 09-22 23:59): median |difference| 0.43 bps, p95 1.48, max 5.22, Yahoo 0.34 bps higher at
  the median. Yahoo lacks 122 of Exness's minutes and has 59 Exness lacks. At weekends they differ most: on the one
  weekend the paper engine recorded, Yahoo went dark at 21:40 on Friday and came back at 23:01 on Sunday, where Exness
  typically goes dark at 21:09 and comes back 21:06–21:27 in summer (PR5-W's disclosure). Exness publishes September on 1 October,
  so the fresh days use Yahoo, the paper engine's own source.

## The model: what is new

`pr5v_sim.py` is `simulate()` with these made parameters. With their frozen values it is the frozen rule.

* **Rungs** per side, the **re-price step**, the **size** of a rung and the **share of a minute's volume** a fill may
  take (10 %, unchanged here).
* **Continuous time.** A turn every `s` seconds. An order goes live `δ` after the turn that placed it. A re-price is a
  cancel and then a new POST: the old price stays fillable until the cancel lands (`δ` after the turn) and the new one
  goes live `2δ` after it, as the live design's "cancel, read back, then replace" does. X for a turn is the latest
  GBP/USD minute bar that ended at least 5 s before it; fairU is the frozen hourly median. Fills are prints strictly
  through the price at or after the order's live instant; the exit is placed at the first turn after a fill.
  "Live timing" below means `δ` = 1 s (2 s as the check), X read 5 s after each bar, and turns 5 s past the minute.
* **A shared cap** (the primary number from here on). In the frozen rule each rung takes up to 10 % of the minute's
  volume on its own, so nine rungs a side could take 90 %. Here the orders on one side of one book share one 10 % cap a
  minute, and a print's own quantity is shared by the rungs it goes through, nearest the market first. It costs the
  frozen set 13 %: $0.361 a day against $0.417 (11.0 against 12.7 %/yr); sharing the minute cap alone gives $0.374.
  A stricter arm also puts exits in that queue and lets them fill in parts.
* **The order governor** per key and UTC day, as the live design has it: entries withdrawn from 600 POSTs, only stops
  from 700. POSTs count placements, re-prices, re-placements, exits and stops.

## Single rungs (today's timing, shared cap, $100 a rung, both books and sides: $400)

| k | IS 08-26 → 09-09 18:00 | OOS → 09-23 | 28 days | wide market, %/yr | fresh 09-23 → 09-28 |
|---|---|---|---|---|---|
| 0.03 % | 171 trips, $0.120/d, 11.0 % | 130, $0.117, 10.7 % | $0.119, 10.8 % | 34.1 % | 27 trips, $0.060/d |
| 0.05 % | 106, $0.150, 13.7 % | 96, $0.193, 17.6 % | $0.170, 15.5 % | 49.1 % | 21, $0.105 |
| 0.075 % | 52, $0.156, 14.2 % | 47, $0.159, 14.5 % | $0.158, 14.4 % | 65.8 % | 16, $0.196 |
| 0.10 % | 35, $0.141, 12.9 % | 35, $0.210, 19.2 % | $0.174, 15.9 % | 80.0 % | 10, $0.103 |
| 0.125 % | 25, $0.161, 14.7 % | 24, $0.151, 13.8 % | $0.156, 14.3 % | 90.5 % | 8, $0.132 |
| 0.15 % | 20, $0.174, 15.9 % | 19, $0.144, 13.1 % | $0.160, 14.6 % | 96.6 % | 5, $0.088 |
| 0.20 % | 9, $0.101, 9.2 % | 11, $0.124, 11.3 % | $0.112, 10.2 % | 97.8 % | 2, $0.023 |
| 0.25 % | 7, $0.104, 9.5 % | 6, $0.091, 8.4 % | $0.098, 9.0 % | 82.3 % | 2, $0.029 |
| 0.30 % | 8, $0.135, 12.4 % | 4, $0.090, 8.2 % | $0.114, 10.4 % | 59.3 % | 1, $0.036 |
| 0.35 % | 3, $0.061, 5.6 % | 1, $0.036, 3.3 % | $0.049, 4.5 % | 32.0 % | 1, $0.066 |
| 0.40 % | 1, $0.030, 2.8 % | 0 | $0.016, 1.5 % | 11.3 % | 0 |
| 0.50 % | 1, $0.038, 3.5 % | 0 | $0.020, 1.8 % | 1.6 % | 0 |
| 0.60 % | 1, $0.044, 4.1 % | 0 | $0.023, 2.1 % | 1.1 % | 0 |

The tight market and the wide one want different ladders: before 24 August the best rungs were 0.15–0.20 % (97–98 %/yr),
now they are 0.05–0.15 %. The frozen rule's own per-rung cap reads 0.1–1.7 points higher on the tight rungs, whose
fills are often small prints (`A_single_rungs`, `…/per_rung`).

## Sets (today's timing, shared cap, $100 a rung)

| set | rungs | capital | IS | OOS | 28 days | POSTs a day (mean / max) | wide market | fresh |
|---|---|---|---|---|---|---|---|---|
| frozen {0.1, 0.2, 0.3} | 12 | $1,200 | $0.362, 11.0 % | $0.359, 10.9 % | $0.361, 11.0 % | 205 / 441 | 71.2 % | $0.198, 6.0 % |
| frozen, per-rung cap (PR5 as it runs) | 12 | $1,200 | $0.406, 12.3 % | $0.429, 13.1 % | $0.417, 12.7 % | 205 / 441 | 82.0 % | $0.230, 7.0 % |
| Davies {0.05, 0.15, 0.25, 0.35, 0.40} | 20 | $2,000 | $0.506, 9.2 % | $0.406, 7.4 % | $0.459, 8.4 % | 348 / 743 | 46.4 % | $0.317, 5.8 % |
| union of the two | 32 | $3,200 | $0.840, 9.6 % | $0.738, 8.4 % | $0.792, 9.0 % | 552 / 1,184 | 46.8 % | $0.519, 5.9 % |
| IS top three singles {0.075, 0.125, 0.15} | 12 | $1,200 | $0.469, 14.3 % | $0.383, 11.6 % | $0.428, 13.0 % | 210 / 444 | 71.2 % | $0.432, 13.1 % |
| IS top five {0.05, 0.075, 0.1, 0.125, 0.15} | 20 | $2,000 | $0.705, 12.9 % | $0.679, 12.4 % | $0.693, 12.6 % | 357 / 747 | 55.2 % | $0.646, 11.8 % |
| every single at ≥ 8 %/yr in IS {0.03 … 0.30} | 36 | $3,600 | $1.050, 10.7 % | $0.944, 9.6 % | $1.000, 10.1 % | 642 / 1,328 | 44.8 % | $0.817, 8.3 % |

Rule 1 (written before it ran): the highest IS $/day among sets at ≥ 8 %/yr in IS. It chose the last row, nine rungs a
side. The two "IS top" rows are the only sets that beat the frozen set per dollar in both halves; both were built from
the IS singles, and the margin (0.7–3.2 points) is the size of one good week.

## The re-price step (today's timing, shared cap)

| step | frozen set: 28 days | POSTs a day (mean / max, days > 1,000) | nine-rung set: 28 days | POSTs a day |
|---|---|---|---|---|
| 0.02 % | $0.307, 9.3 % | 930 / 1,744, 17 | $1.012, 10.3 % | 2,744 / 5,147, 20 |
| 0.03 % | $0.311, 9.5 % | 483 / 965, 0 | $1.057, 10.7 % | 1,439 / 2,819, 20 |
| 0.05 % | $0.361, 11.0 % | 205 / 441, 0 | $1.000, 10.1 % | 642 / 1,328, 6 |
| 0.075 % | $0.295, 9.0 % | 103 / 265, 0 | $0.894, 9.1 % | 343 / 809, 0 |
| 0.10 % | $0.268, 8.2 % | 69 / 150, 0 | $0.772, 7.8 % | 239 / 485, 0 |

0.05 % stays the best step for the frozen set. The wide market sends about twice the POSTs (frozen at 0.05 %: 404 a day,
1,824 at most, 13 days over 1,000). Rule 2 (the best IS step whose busiest day stays under 600 on one key) chose
0.10 % for the nine-rung set, which then lost half its OOS money (5.4 %/yr). Rule 2 bound only on one key; stage E
below lifts it.

## Cadence and latency

The frozen set and the nine-rung set at 0.10 %, shared cap, live timing (`D_cadence`):

| loop | frozen set: IS / OOS $/day | POSTs a day | nine-rung set: IS / OOS $/day | POSTs a day |
|---|---|---|---|---|
| today's timing (orders live the next minute) | $0.362 / $0.359 | 205 | $0.988 / $0.532 | 239 |
| 60 s, δ 1 s | $0.363 / $0.362 | 205 | $0.982 / $0.532 | 241 |
| 30 s | $0.365 / $0.365 | 205 | $0.948 / $0.535 | 238 |
| 15 s | $0.352 / $0.367 | 206 | $0.952 / $0.516 | 238 |
| 10 s | $0.356 / $0.365 | 205 | $0.945 / $0.522 | 237 |
| 5 s | $0.356 / $0.333 | 206 | $0.963 / $0.530 | 237 |
| 2 s | $0.362 / $0.328 | 206 | $0.950 / $0.514 | 239 |
| 1 s | $0.354 / $0.328 | 207 | $0.949 / $0.509 | 239 |

`δ` = 2 s gives the same rows to within about $0.02 a day. **Where a gain could come from, and why none shows:**

* *Exits placed sooner* (from 60–120 s after a fill to 2 s): exits-only-fast gives $0.355 / $0.328 for the frozen set,
  the same as the full 1 s loop. An exit rests at fair; getting there sooner changes little when the next print through
  fair is minutes away (a book prints 150–300 times a day).
* *Orders live sooner:* they are, and they are refused a little more (145 against 143 on the frozen set) and filled
  sooner after a GBP/USD move, by prints that are still moving against them: OOS falls from $0.36 to $0.33 at 5 s and
  below.
* *Fewer stale quotes picked off:* none were. Not one print came in the 1–2 s between a re-price and its cancel
  landing, in any run. The stale window that matters is inside the GBP/USD minute bar itself, and no cadence can shorten
  it: X is a minute bar (Yahoo's history is one-minute; its chart also returns a live `regularMarketPrice` between bars,
  which has no history to test; Kraken's GBP/USD sits 1–2 bps under interbank and was rejected by PR5's study).
* *Re-prices sooner:* with turns 5 s past the minute, the X-driven re-price already happens at the first turn that can
  see the new bar, so the reprice-fast arm is identical to the full loop.

**Rule 3** (the fastest cadence unless a slower one is 5 % better on IS) chose 1 s. On paper that is free: the paper
engine can play 1 s steps from the minute's prints, which carry millisecond timestamps, so the public 1 token a second
does not bind it. A live engine reads its fills from the private API (100 a second, 1,000 a minute; one active-orders
read a turn is 60 a minute). **So the loop could run every second, and the evidence says to build it at a minute.** One
limit does bite a live engine that re-prices many rungs on one key at once: the frozen set sends 12 POSTs in one second
at a re-price, over the venue's 10 a second; with four keys the recommended configuration's busiest second is 9.

## Keys: the order budget under the governor (live timing at 1 s, shared cap, $100 a rung)

Rule 4: for 1, 2 and 4 keys, the configuration with the best IS $/day among six sets × four re-price steps, with the
600/700 governor simulated per key (`E_accounts`). Once a key reaches 600 its entries are withdrawn for the rest of the
UTC day, so a configuration that often reaches it loses most of its money: the nine-rung set at 0.02 % on one key makes
1.7 %/yr.

| keys | best by IS | capital | IS | OOS | 28 days | POSTs a key a day (mean / max) |
|---|---|---|---|---|---|---|
| 1 | nine rungs, 0.10 % | $3,600 | $0.949, 9.6 % | $0.509, 5.2 % | $0.741, 7.5 % | 239 / 497 |
| 2 (one per book) | nine rungs, 0.05 % | $3,600 ($1,800 a key) | $0.956, 9.7 % | $0.806, 8.2 % | $0.885, 9.0 % | 315–326 / 601–608 |
| 4 (one per book and side) | nine rungs, 0.03 % | $3,600 ($900 a key) | $1.102, 11.2 % | $0.948, 9.6 % | $1.029, 10.4 % | 346–369 / 600–632 |

A bid key holds GBP (nine $100 bids, about £680 at 1.32), an ask key holds the coin ($900 of USDC or USDT); positions
swap them. Rule 5, written after these lines had printed and applied to IS only (disclosed): the key count whose best
has the highest IS $/day, fewer keys within 5 %. It chose 4. Beside it, not chosen: the IS-top-five set at 0.03 % on 2
or 4 keys makes 12.5 %/yr on $2,000 ($0.69 a day) in both halves; picking it would be choosing on OOS.

## The recommended configuration, and its checks

**Nine rungs a side at 0.03, 0.05, 0.075, 0.10, 0.125, 0.15, 0.20, 0.25 and 0.30 %, on both books; $100 a rung
($3,600); re-priced when fair moves more than 0.03 %; a turn every second, orders live 1 s after it, a re-price's
cancel landing 1 s after it and its replacement 1 s later, X read 5 s after each minute bar; the shared cap; four keys
(one per book and side), each governed at 600/700 POSTs a UTC day.** Every other part is PR5's rule: exits at fair,
the post-only refusal, the 24-hour taker stop, dark when X is dark.

| | frozen rule as it runs ($1,200) | recommended ($3,600) |
|---|---|---|
| IS | 52 trips, $0.406/d, 12.3 % | 337 trips, $1.102/d, 11.2 % |
| OOS | 50 trips, $0.429/d, 13.1 % | 259 trips, $0.948/d, 9.6 % |
| 28 days | 102 trips, $11.67, $0.417/d, 12.7 % | 596 trips, $28.82, $1.029/d, 10.4 % |
| by book, 28 days | USDC $0.133/d (8.1 %), USDT $0.283/d (17.2 %) | USDC $0.436/d (8.8 %), USDT $0.593/d (12.0 %) |
| $ a trip; won; taker exits | $0.114; 94.1 %; 1 | $0.048; 83.7 %; 7 |
| worst trip; worst day; drawdown | −$0.13; −$0.13; $0.13 | −$0.35; $0.00; $1.06 |
| stress (one tick further through, double stop cost) | $0.326/d, 9.9 % (per-rung cap) | $0.851/d, 8.6 % |
| exits share the queue and fill in parts | $0.321/d, 9.8 % (shared cap) | $0.912/d, 9.3 % |
| at $1,200 ($33 a rung) | | $0.421/d, 12.8 % |
| $300 / $1,000 a rung | | $2.40/d, 8.1 % / $3.28/d, 3.3 % |
| same, a turn a minute | | $1.060/d, 10.8 % |
| fresh 09-23 → 09-28 (Yahoo X, 5 days with a weekend) | 13 trips, $0.230/d, 7.0 % | 45 trips, $0.502/d, 5.1 % |
| wide market to 08-24 | $2.77/d, 82.0 % | $2.86/d, 28.4 % (governor binds 41–81 days a key; without it 46.3 %) |
| POSTs a key a day | 205 on one key (max 441; 12 in one second) | 346–369 (max 600–632; 9 in one second; the day bucket never below 754) |

* **Against the frozen rule, paired by day** (28 days, `paired`): +$0.613 a day; better on 22 days, equal on 5. Day bootstrap 95 % interval +$0.40 to +$0.83; 7-day blocks +$0.48 to +$0.75; no resample at or below
  zero. Against the frozen rungs at the same live timing and cap: +$0.688 (+$0.54 to +$0.82).
* **Against PR5's random-time null** with the variant's own exits (2,000 draws, seed 20260923): 28 days $28.82 against
  a p95 of $2.42 (mean −$0.01); OOS $12.56 against $1.16. No draw reached either.
* **The dollars are the capital.** $0.61 a day on $2,400 more capital is 9.3 %/yr on that capital; at a fixed $1,200
  the variant earns what the frozen rule earns. Size does not scale: $300 rungs make 8.1 %/yr and $1,000 rungs 3.3 %.

**Selection.** 114 configurations were run (`configurations_run`). Rules 1–4 were written into `study.py` before it
ran; rule 5 after stage E printed. Every rule reads IS only, but OOS lines were on screen when rule 5 was written.
Rule 2 on one key picked a step that halved in OOS; the four-key pick held (IS 11.2 %, OOS 9.6 %).

## The forward paper test

Run the recommended configuration as "Stablecoin quotes - variant" on paper from its first day, on the same public
prints, Yahoo minutes and USD hours PR5's engine stores, and judge it paired by UTC day against PR5's frozen rule on the
same days.

* **What it can show in four weeks.** That it beats PR5 in dollars: with the backtest's daily gain ($0.61, SD $0.61)
  about 6 days give 80 % power at one-sided 5 %. Run at least 28 days, as PR5.
* **What it cannot show in four weeks.** That the extra $2,400 is worth locking: 8 %/yr on it is $0.53 a day, and the
  backtest's gain beats that by $0.09, which needs about 300 days to show. Per locked dollar it is expected to lose to
  PR5 (10.4 against 12.7 %/yr).
* **A bar to freeze before its first day** (a proposal): P&L above the variant's own random-time null p95; the paired
  gain over PR5 positive on a 7-day block bootstrap; the stress arm above zero; no key over 700 POSTs on any day and
  none over 10 in a second; and, reported beside it, the gain per extra dollar against 8 %/yr, the IS-top-five set at
  0.03 % as a second arm, and the same configuration at a turn a minute.
* **It is paper.** A live version would need four funded sub-accounts ($900 each, GBP in the bid keys and USDC or USDT in
  the ask keys), a live executor that runs every second or at least within a second of each minute bar, and Davies'
  word. Nothing here asks for that.

## What this cannot show

* 28 days of one regime for the choice, 13 out of sample, and 5 fresh days with a weekend. The wide market says this
  shape was worse per dollar when the books were wide.
* Fills are prints through the price, sized by a share of the minute's volume. The queue ahead of a resting order is not
  modelled (QUEUE's pre-registered question); nine rungs a side put more of the account's own size in that queue.
* Latency is assumed (1–2 s a call); no live order was sent. The 10-a-second limit is per key in this model.
* Whether the 1,000 a day is per key or per account is undocumented; four keys on one account may share one budget.

## Files

* `docs/agents/scripts/pr5v/`: `pr5v_sim.py` (the generalised rule), `check_repro.py`, `test_pr5v.py`,
  `pull_fresh.py` (the keyless pull), `study.py` (every table here).
* `docs/agents/backtests/pr5v/`: `check_repro.json` (the reproduction, `PASS`), `pr5v_study.json` (every stage, with
  the sha256 of the scripts and of every input).
* `docs/agents/backtests/inputs/pr5v_2026-09-28/`: the UK prints of both books 2026-09-22 → 09-28 (312 and 861), the
  USD books' hours 09-20 → 09-28, Yahoo's GBP/USD minutes (range 7d, pulled 2026-09-28 11:38 UTC), the request log and
  `SHA256SUMS`.
