# The TESTING set, reviewed (2026-09-27)

Davies, 2026-09-27: "深度研究一下目前的TESTING STRATEGIES组合，看看有没有可以优化的地方或者是新增的testing" — study the
set of testing strategies in depth, and see what could be improved or added.

**Scope.** The nine rows of TESTING on 2026-09-27: the three crypto paper rows (`trend-4h`, the live row's control;
`trend-1h`; `momentum-1d`, shown as "Momentum 30d"), PR5's stablecoin quotes, and the reward-quote family on
Polymarket: RW and its four variants (variant-1 is RW-E, variants 2–4 are x1–x3).

**Method.** Three read-only studies, run in parallel by research agents and checked here; each is an appendix, kept
as it reported:

- A — `2026-09-27-testing-review-a-crypto-rows.md`: the crypto rows' record, Jev's shadow answers, the maker probes,
  the optimisations never tested.
- B — `2026-09-27-testing-review-b-quote-tests.md`: PR5's interim reading and its possible arms; where RW stands and
  what to fix before its verdict, from the data its rules allow.
- C — `2026-09-27-testing-review-c-new-tests.md`: new testing candidates, each checked against every family already
  rejected.

Production was read with SELECT only. No order, deploy or write came from the studies. The no-peek rules held: no RW
fill, minute, print or selection table was queried, only the aggregate columns of the day tables; `agent_book_levels`
was counted, never read. The live row appears in prices and basis points only.

## 1. The answer

- **The set is sound, and every row still does a job only it does.** Nothing is retired, merged or added as a
  strategy row. The week's returns sit about one standard deviation from what the backtests expect, so they neither
  confirm nor contradict anything.
- **One defect was found and is fixed.** The maker probes' fill test credited the minute in which a probe was
  written, so a print from before the probe existed could fill it. Two probes of eleven were resolved that way. It is
  fixed and the two are corrected (`0068`, reference §4 item 41).
- **Besides the defect, four things in the record were wrong or misleading**, and are corrected (§5).
- **What is worth adding is measurement, not new rules.** Every rule idea left has been priced and rejected (A §5,
  C §2). The best open question is how the rows' own orders are EXECUTED: resting at the touch at 0 % instead of
  crossing it at 9 bps. It has never been rejected on its merits, and the probes already measure it (§4, MX-1).
- **The two quote tests are healthy and cannot be read yet.** Both need their readings fixed before their verdicts,
  RW's before 2026-10-09 and PR5's before 2026-10-21 (§3, §4).

## 2. The crypto paper rows

### 2.1 The record (A §2)

Seven days, from the rows' seeding on 2026-09-20 18:23 UTC to 09-27 21:39.

- **Every decision recomputes.** From each decision's stored numbers: all 796 trend decisions (210 on `trend-4h`,
  510 on `trend-1h`, 76 on the live row) derive their state and action as the rulebook does. All 7 exits were the
  rule's 3×ATR close trail at the right bar. No floor stop fired. The live row and its control made 76 of 76 paired
  decisions identically.
- **The week, as a share of each row's capital, closed and open trades together:** `trend-4h` −0.78 %, `trend-1h`
  −0.57 %, `momentum-1d` +5.59 % (its three positions still open). Buy-and-hold of the same coins made +13.2 %,
  +6.7 % and +6.7 %. It was a strong bull week, the rows' holds match the backtests (`trend-4h` 2.5–3 days,
  `trend-1h` 0.85), and three losing trades in a row on `trend-4h` is roughly a one-in-five event.
- **The live row's first fill cost +4.1 bps more than its control's** (live SOL buy 120.94, paper 120.89, the same
  bar). The book was deep enough (about $5,000 at SOL's top ask in the committed snapshot of 09-24), so a stale ticker
  or latency is the likelier cause. It is one pair; §4's EX-GAP is how to read it.
- **The live row will part from its control by design.** Its exposure cap is one slot. While it holds one coin, a
  second coin's signal is refused on the live row and taken on the control. That is the cap working, so read live
  against control per fill, not by the total.

### 2.2 Jev's shadow on the two paper rows (A §3)

Since `0059` the paper rows ask Jev on every entry and enter whatever it says. One entry was asked (`trend-1h`, SOL,
P = 0.74), and there were no would-be vetoes. **The shadow cannot decide whether the gate helps.** Under v2 at 0.45
each state gets the same answer on every call, so "would have vetoed" only restates the state, which the four-window
backtest has already priced on far more entries. Deciding it forward would take about 5 to 18 years of entries. What
the shadow can do is watch for drift: all four v2 answers recorded so far sit inside their measured bands. JEV-DRIFT
(§4) makes that a check.

### 2.3 The maker probes, after the fix (A §4)

Eleven probes, which are nine market events (one SOL buy was probed on three rows): seven exits and two entries.
**All nine filled within 57 minutes, at a median of 8.** The median is the same before and after `0068`.

**How to read them — a correction.** `probeSummary`'s docstring and §3.13 said to read `adverseBps` (how far the
price moved against a filled probe 15 and 60 minutes later) against §3.13's 10–20 bps band, and C read the median
of +32.5 bps at 15 minutes as fatal against the 9 bps fee. That compares two different quantities.

- §3.13's band is a fill condition: how far a price must trade through before a backtest may credit the fill.
- `adverseBps` is the drift after the fill. For the rows' own orders that drift cancels out. Once a resting buy
  fills, it holds the same position the taker's buy has held since the decision, and so it gains or loses the same
  from then on. The same is true of a sell.

What decides it is three numbers:

- how often the resting order fills within the time the rule can wait;
- what it saves when it fills: the spread plus the 9 bps fee;
- what it costs when it does not: the touch it must cross at the deadline against the one at the decision.

`adverseBps` is the right number for a quote that holds inventory it did not want. It is the wrong one for a rule
that wants the position anyway.

The advantage of resting and then crossing at T, per event, in bps (positive favours resting). It uses the fixed fill
test and the UK touch recorded in `agent_basis` at the deadline; A's table, with probe 17 corrected:

| T | exits (7): filled, mean advantage | entries (2): filled, mean advantage |
|---|---|---|
| 15 min | 5 of 7, **+5.2** | 1 of 2, **+4.2** (was 2 of 2, +12.7) |
| 30 min | 5 of 7, **+2.9** | 1 of 2, **−3.5** (was 2 of 2, +12.7) |
| 60 min | 7 of 7, **+11.6** | 2 of 2, **+12.7** |

Probe 17, the SOL buy of 09-27 08:00, now fills at 08:38, not in its opening minute, so it misses at 15 and 30
minutes. Crossing then would have cost 4.7 and 20.1 bps. On this thin book the chase depends on the second: the UK
mid stood 50 bps higher at 08:16 than at 08:15. Nine events cannot decide the question. The exits' pattern is
visible, though: the trail sells on a close that has just fallen, and the price bounces within the hour. A
pre-registered forward reading can decide it (MX-1, §4).

### 2.4 Is this the right crypto set? (A §7)

Yes. Keep all three rows.

- **`trend-4h`** is the live row's control. It is the only way to price the live fills.
- **`trend-1h`** gives the fastest feedback. It produced six of the week's nine probe events, and it would carry any
  change to execution first, since it is paper and nobody's control.
- **`momentum-1d`** is the only other rulebook. Judge it against its daily-cadence figures (§5).

A resting-execution twin of any row would repeat the Kraken and Binance twins' mistake: the same decisions,
measuring what the probes already measure.

## 3. The quote tests

### 3.1 PR5, stablecoin quotes (B §2)

- **Healthy.** Every minute since the per-minute record began is decided, 4,176 of 4,176 on each book, a median 87 s
  after the minute starts. No engine error. At most 440 orders a day against the 700 limit.
- **All 9 paper fills would have been accepted as post-only at go-live.** Only 1 filled at the best price; the other
  8 rested behind the touch and filled on sweeps.
- **The regime it was planned on still holds:** a 3.98 bps buy−sell gap in week 39.
- **The record decides nothing yet.** It is 9 round trips from 6 distinct fill minutes, +$1.08 in 4.27 days, or
  $0.254 a calendar day against a plan of $0.42 and a bar of $0.26. That is 0.6 SD under plan.
- **The 10-21 review will give a point estimate, not a verdict of worth.** If the plan rate holds, it passes with
  about 93 % probability; at exactly the bar rate, 50 %. Showing "better than cash" takes about 24 days of record, and
  "better than 8 %/yr" about 81.
- **The live path's dry-run matches the paper engine order for order** since its 09-24 fix. It quotes bids only,
  because the sub-account holds only GBP, and it never fills. So it has tested placement, not execution.

Two things the 10-21 review should expect. Neither is a reason to change the frozen rule.

1. **The fair value lags one hourly candle.** In the one hour observed, Revolut X left the hour that had just closed
   out of its candle list for about 3 minutes. The engine fetches once, about 27 s past the hour, and marks the hour
   done either way. So for 59 minutes of each hour its fair omits the newest close.
   - Effect: 0.5 bp in 7–11 % of minutes; 5 of 302 order prices were one tick off.
   - Condition 1's replay on stored candles will therefore differ a little. Replay also on the per-minute inputs the
     engine recorded, which should match exactly.
   - Any new or live code should re-fetch until the closed hour's candle is present.
2. **The size rule can credit a fill the tape does not prove.** One entry, an ask, was credited about $100 of USDC on
   a 0.26-USDC print.
   - Strictly read, the nine trips make +$0.964, not +$1.083.
   - In the committed history the effect is small: 97.1 % of the primary window's P&L survives it, and 99.9 % of the
     post-change window's.

### 3.2 RW and its variants (B §4)

- **All four replays are clean:** every consistency check is at $0.00.
- **RW after two closed days** is +$219.72, but its stress total is −$28.53, and its fills lost money on both days.
  Its verdict on 10-09 will turn on stress and on concentration in one market.
- **Variant-1 (RW-E) is judged from 09-27, variants 2–4 from 09-28.** Their rows before that equal RW's to the cent,
  as they should.
- **Nothing here reads a market-level figure.**

The 10-09 verdicts decide pass or fail for each arm. They cannot show:

- what Polymarket actually pays;
- the queue at our price, or how other makers answer our quotes;
- whether fourteen days generalise;
- whether this account may quote at all: fp4 §0 found the Terms of Use bar UK and Irish residents with no exceptions.

## 4. What to add, ranked

None of these is a new strategy row. The first four are recommended. Each pre-registration is drafted in its
appendix and must be frozen on `main` before any data it is judged on is read.

| # | name | what it is | why | cost | deadline / who |
|---|---|---|---|---|---|
| 1 | **MX-1** (A §6) | Maker-first execution of the rows' own entries and rule exits: rest post-only at the touch, cross at 60 min. Read forward from the probes; two hypotheses, exits and entries (Holm, bootstrap); floor stops stay marketable. | The one optimisation of these rows never rejected on its merits (§3.13, §3.17). If it holds, about +4.7–8.5 points a year to `trend-1h`, +1.4–3.2 to the live row. | One recording change first (R2: every probe records the UK touch at +15/30/60 min, so the chase outlives `agent_basis`'s 30-day prune), then the frozen draft. About 40 events a side, roughly 12 weeks. | No deadline; the window starts at the freeze. Paper measurement, no orders. A pass would move `trend-1h` to maker-first on paper only; the live row only on Davies' word. |
| 2 | **RW-NEXT** (B §4.3–4.4) | How the 10-09 verdicts are read together: a mechanical choice among the five overlapping arms (a variant replaces RW-E or RW only if it passes and beats it in a paired day bootstrap), fixed descriptive readings (live capital, fills AT our price, rebates, by category), and a stop if nothing passes. Plus RW-C: a 14-day forward confirmation, 10-09 → 10-23. | Five arms judged on the same days, with the variants picked from 24 configurations on two days: choosing the best after the fact is selection. | A document. RW-C needs a second engine instance with its own tables. | Freeze before 10-09 and before anyone reads a market-level figure. RW-C is a build, on Davies' word. |
| 3 | **QUEUE** (C §3) | PR6's par quotes on the USD stablecoin books and the same rungs about Kraken's hourly price (each with a bar), and PR5's GBP quotes (descriptive), re-scored with fills from queue position on the books `0057` records. | Every maker test on these books counted only prints strictly THROUGH a quote, the rare and adverse kind on a pegged book. At the front of the queue the ceiling is about twice the bar; at the back, nothing. About 20 % to pass. Its larger value is the fill model under PR5's record and its live decision. | An offline study; no production change unless it passes. | Freeze before anyone reads `agent_book_levels` and before 10-25; run by **2026-11-01 10:25 UTC**, when the 35-day prune starts deleting the window; pull Kraken's hours by about 10-26. |
| 4 | **PR5-R** (B §3) | Four readings of PR5's record declared before 10-21: strict fills, the size ladder by exact rescaling, the live path's bids-only configuration, the replay on recorded inputs. | Removes choice at the review; costs nothing. | Computed from existing tables. | Freeze before 10-21. |
| 5 | PR5-W (B §3) | PR5's frozen rule while FX is shut at weekends, priced at Friday's close; a replay on stored prints. | Weekend books trade at 67–79 % of weekday; the upside is about +30 % of PR5's P&L. The risk is the reopen gap (median 4.7 bps, p90 30.6, max 54). | No venue call, no new capital. | Optional; each weekend before its freeze is seen data. |
| 6 | EX-GAP (A §6) | The live fill against the paper control's fill of the same bar. | It decides how far paper dollars can be trusted, and what raising the live capital would really pay. | Pairs only; no code. | Read at 16 pairs, which at one slot takes about 2–4 months. |
| 7 | JEV-DRIFT (A §6) | Each recorded Jev answer checked against the measured band for its state (±0.02); a flag on a live-row state, or two in a week, triggers a read-only re-measure. | The live gate's determinism rests on the model's replies not moving. | A query. | Standing. |

**Not proposed:**

- MOM-TRANCHE: `momentum-1d` decided at six times of day. It would repair timing luck, not find an edge.
- The "volatility extreme" clause: it binds almost only on SUI, which does not go live.
- DISPUTE: buying the proposed outcome during a UMA dispute. 24 of 35 recent disputes were overturned, so no sign is
  stable.
- LONGSHOT: FAV's sign flip, already refused as snooped.
- A resting twin row: the probes already are that measurement.

USLATE-FAST is frozen already. Its 1 s recorder is Davies' call: about a 12 % chance to pass, and a pass needs
Polymarket access.

## 5. Corrections made to the record

1. **The probes' opening minute** — fixed and corrected, `0068`, reference §4 item 41.
2. **How to read `adverseBps`** (§2.3) — reference §3.13 and `probeSummary`'s docstring in `agents/index.ts`.
3. **SUI's UK spread.** Over 1,815 five-minute samples of 2026-09-20 → 27, the median is 23.7 bps. It is wider than
   20 bps in 91 % of samples and wider than 50 bps in 5.7 %. So SUI's taker round trip is about 42 bps, §3.8's figure,
   not the ~33 bps §3.20 found in 60 samples. Reference §3.20 and `.claude/CLAUDE.md`. It changes no decision: SUI is
   paper only.
4. **`momentum-1d`'s benchmark.** §3.17's table prices it deciding every 4 hours; the loop decides once a day. Its
   daily-cadence figures (`jev_v2_other.json`, the rulebook) are A −9.0 % (drawdown 42.4 %), B +70.1 %, C +104.4 %,
   D +5.8 %, against the 4-hour −8.1 / +62.4 / +106.2 / −7.2 %. Reference §3.17.
5. **`momentum-1d`'s first two entries** (ETH and SOL, 09-20 18:24) were taken 18.4 h after their daily bar closed,
   before `entryTooLate` existed. The rule as it runs now would have entered at the next day's open. The record is
   about +0.5 points of the sleeve better than the rule. Reference §3.43.

## 6. What this review did not do

- It froze no pre-registration. The drafts are in the appendices: A §6 (MX-1, EX-GAP) and B §4.4 (RW-NEXT); QUEUE is
  sketched in C §3.
- It added no row, changed no rule, and placed nothing.
- It read no market-level RW figure and no recorded book.
- The research scripts were scratch work and were not kept; each appendix gives its SQL and method.
