# Pre-registration PR5-R: five readings of PR5's paper record, declared before its review

Drafted 2026-09-27 (UTC) and revised 2026-09-28 after an independent review of the draft (findings P1–P8), and again
after that review's second pass, before PR5's four weeks end. Frozen by the commit that adds this file, at that
commit's time. Any change after that is a deviation and is reported as one.

Davies, 2026-09-27, choosing what the TESTING review ranked: "PR5-R 等低优先级" (the review's §3.1 and §4; appendix B
§2.4 and §3).

## What this is, and what it is not

PR5's paper test runs 2026-09-23 15:09 → 2026-10-21 15:09 UTC. Its six conditions decide, exactly as its spec words
them (`2026-09-23-pr5-paper-test-spec.md`, "What decides, after four weeks"). **Nothing here changes them, and a miss
stays a miss.** These five readings are computed on the same record and reported beside the conditions at the review,
so that none of them is chosen after seeing the result. None can pass or fail the test. None changes the rule, the
paper engine or the executor.

Two kinds of reading:

- **Re-simulations**: (a), and (b) and (c) under (a). The frozen rule is run again with one part replaced, so its
  trips can differ from the record's. They are compared trip by trip, matched on the rung and the entry minute.
- **Re-readings** of the record as it stands: (b) and (c) under the frozen fill, and (e). (d) is the frozen rule run on
  the engine's own recorded inputs.

The record: `agent_quote_trips`, `agent_quote_events` (with the go-live books, `kind = 'book'`),
`agent_quote_prints`, `agent_quote_minutes`, `agent_quote_inputs`, and the dry-run executor's
`agent_quote_live_orders`, over the four weeks. Nothing needs building before the freeze: every field the readings
use is already recorded, the per-minute inputs from 2026-09-25 00:05 UTC and the dry-run orders from 2026-09-24.
Nothing is read from `agent_book_levels`, which QUEUE must freeze before anyone reads it.

## The readings

**(a) Strict fills, a re-simulation.** The frozen rule fills a whole entry on any print strictly through the quote,
sized min($100, 10 % of the minute's printed volume on both sides), and a whole exit on any such print. (a) runs the
frozen rule (`simulate()` in `pr5_sim.py`; `stepMinute` is its minute) with only its fill function replaced. The turn,
the re-price step, the go-live refusal, the 24-hour stop and the P&L are the frozen rule's. Its inputs are (d)'s, so
(d)'s replay is its baseline, and the fill function is the only difference between them. The replacement is made in a
copy of `pr5_sim.py`; the committed file (`docs/agents/scripts/pr5/pr5_sim.py`) stays byte-identical.

The fill function under (a):

- A print is **through on the taking side** of a live order when it is strictly through the order's price, as in the
  frozen rule, and its aggressor takes that side: a sell-aggressor print for a bid, a buy-aggressor print for an ask.
- **An entry** fills on the print the frozen rule would fill it on: the first print strictly through it while it is
  live. Its quantity is the frozen quantity, capped at the base quantity of the prints through on the taking side from
  that print to the end of that minute. A cap of zero is no fill on that print, as the frozen rule skips a print whose
  size is zero. The entry stays live, and each later print strictly through it is tried the same way. The rung moves
  to position on its first fill, as in the frozen rule, so a capped entry's remainder is dropped.
- **An exit** fills in parts. Each print through on the taking side, in time order, fills the smaller of its quantity
  and what is left, at the exit's price, over as many minutes as it takes. A re-price moves what is left to the new
  price from the minute the new price goes live. If the 24-hour stop comes first, it closes what is left at its own
  price. The rung quotes no entry until nothing is left, as in the frozen rule.
- **Each part converts at its own minute's X**, as the frozen rule converts a whole exit at its minute's X: a part's
  P&L is its quantity × (its price − the entry), signed by side, in GBP × that minute's X.
- **Each rung reads the prints on its own**, as in the frozen rule: a print's quantity is not shared out among our
  rungs.

Reported: round trips, P&L, and the difference from the baseline, trip by trip. Trips are matched on (book, side, k,
t_entry), the trips table's own key, and every trip with no match on the other side is listed. There will be some: a
slower exit keeps its rung in position, so later entries move or vanish.

Appendix B §2.4b priced only the entry half of this reading, on the committed history: 97.1 % of the primary window's
P&L and 99.9 % of the post-change window's survive the entry cap. The exit half was never priced.

**(b) The size ladder.** Under the frozen fill, size never changes a decision, only an entry's quantity: exits and
stops close whatever is held. So the engine's own trips are re-sized exactly, with $25, $300 and $1,000 a rung in
place of $100. Each trip's quantity and P&L are multiplied by min(S, 0.10 × `minuteGbp` × `x`) ÷ `usd`, all three from
the trip's fill event. Under (a), size does change decisions, because a larger position takes longer to exit. So (b)
under (a) is (a)'s re-simulation run at each size, reported against (d)'s replay re-sized the same way. Each size is
reported both ways.

**(c) The live path as configured on 2026-09-28.** The sub-account holds only GBP: the key's probe found that on
2026-09-24 01:43 UTC, and every dry-run ask since has been skipped for want of coin. `runQuotesConvert` has never sent
an order; it sends only while the executor is live and armed, which it has never been. So the executor quotes bids
only, at `rungGbp` = £50 ÷ 12 rungs = £4.17 a rung, and skips every ask.

The reading is the paper record restricted to the six bid rungs and re-sized as in (b) to £50 ÷ 12 a rung: under the
frozen fill each trip is multiplied by min(£50 ÷ 12, 0.10 × `minuteGbp`) × `x` ÷ `usd`, and under (a) it is (a)'s
re-simulation of the bid rungs at that size. Both are reported.

It is the paper rule at the live size, and nothing more. It leaves out the live path's own behaviour:

- the −1 % daily loss stop (£0.50 a day);
- the de-peg and stale-input guards;
- the order governor (entries withdrawn at 600 POSTs a day, only stops from 700);
- the 24-hour stop, an IOC bounded at fair ± 50 bps and tried again an hour later if it comes back unfilled;
- the placement lag of about 30 s, which (e) prices.

**(d) The replay on recorded inputs.** Condition 1 is read as the spec says: the frozen `pr5_sim.py` on the stored
prints, candles and FX. Beside it, the same simulator runs over the four weeks with only its inputs replaced, by the
engine's own wherever they are recorded: each minute's X and fairU as the engine recorded them
(`agent_quote_minutes.x` and `fair_u`, the fair being `fair_u` ÷ `x` as the simulator forms it), and that minute's
stored prints.

- **From 2026-09-25 00:05 UTC** the inputs are the engine's own. So once the replay's state matches the engine's, its
  events should match the engine's exactly. A minute with no record, or whose stored prints number other than its
  recorded `prints_n`, is listed: there it may not match.
- **Before that minute** (2026-09-23 15:09 → 2026-09-25 00:05) **the replay is approximate.** It uses the stored
  candles with the engine's one-candle lag. The engine fetches the hourly candles once, about 27 s into each hour,
  while the venue does not yet list the hour that has just closed, so the newest close arrives with the next hour's
  fetch. That fetch is made in the run that decides minute :59, before it decides it. So minutes :00 to :58 of each
  hour omit the newest close, and minute :59 has it. The lag was measured on minutes :01–:58 of the recorded span,
  where it held in every USDC-GBP minute and in all but 44 of 4,042 USDT-GBP ones (appendix B §2.4a). Minutes :00
  and :59 were not checked; their rule comes from the engine's code (`runQuotes` reads the hours before it decides).
- **The check.** Every place, re-price and replace records the fair and X it used (`detail.fair`, `detail.x`), and
  every fill its `fair` and `x`. The replay is compared with `agent_quote_events` event by event over the whole four
  weeks. Every order, refusal, withdrawal, fill, exit and stop where the replay's minute, rung, kind or ticks differ is
  listed, with the recorded and the replayed fair and X, and the minute of the first difference is named.

**(e) The live executor's timing.** The paper engine decides the turn at the start of minute t at about t+1:25, one
minute behind the clock, and counts that turn's orders live from t+1:00. The executor runs after it and carries each
decision out about 30 s into that minute: 28.8–33.4 s, median 30.6 s, over the 150 dry-run orders from the 2026-09-24
fix to when they were first counted on 2026-09-27 (156 by 2026-09-28 00:05 UTC). So a new order rests about 30 s
late. A re-priced order's old price also stays up until about t+1:30. The paper has nothing live on that rung during
minute t, since a re-priced order is pending for the turn's whole minute, and counts the new price from t+1:00. Two
numbers:

- **(e1)** The record without every entry fill (event `fill`) whose print came less than 34 s into the minute its
  order's current price went live: the minute after that order's latest `order` event (`place`, `reprice` or
  `replace`) before the fill. Those entries' trips are removed. It is a re-reading: it does not ask what the live
  order would have got after it arrived. Exit fills (event `exit`) in the same window are counted apart and not
  re-simulated.
- **(e2)** For every re-price, the prints strictly through the OLD price on the taking side in the 90 s from the
  turn's minute start, [t, t+1:30). The first such print, if any, is a fill the live order would have had.
  - It is sized as the rule sizes that leg: an entry at min($100, 10 % of the volume of that print's minute), an exit
    the whole position.
  - It is marked at the new fair: a fill that buys at p is worth its quantity × (new fair − p), one that sells its
    quantity × (p − new fair), in GBP × that minute's X.
  - Reported as a count and a P&L, entries and exits apart.

(e1) and (e2) are each reported twice: over all twelve rungs, and over the six bid rungs alone, the live path's
configuration as (c) describes it.

The dry-run shows placement only. Live, a replacement also waits until the cancel is read back, which the dry-run
cannot show, so the live lag can only be longer. The fills (e1) removes and (e2) adds are lower bounds on what the lag
does.

## What follows from them

- **Conditions 1–6 are read exactly as the spec words them. A miss stays a miss.** No reading here turns a fail into a
  pass. If condition 1 misses, (d) may explain the miss (input timing rather than the engine); the fail goes to Davies
  with that explanation beside it.
- A pass that depends on credits (a) removes is reported as such.
- **(b) and (c)** size the live test's expectation under the paper rule. At the live path's £4.17 rungs it is cents a
  day: its value is the measurement of real post-only fills, not income (review §3.1).
- **(e)** changes nothing before 2026-10-21 15:09 UTC. After it, a change to the executor's timing is proposed to
  Davies with (e)'s numbers, without changing the paper engine's decisions. The target is placement at the paper's
  `live_at`, t+1:00.
  - Acting sooner needs either the paper engine to decide earlier, which changes its inputs (the candle lag) and so its
    record, or the executor to compute the turn itself.
  - Orders placed at t+0:30 would go live 30 s before the paper counts them: today's gap in mirror.
  - PR5 goes live only on Davies' word, as before.

## Seen before the freeze (disclosed)

- **The record to 2026-09-27 21:38 UTC, as appendix B read it** (§2.1–§2.3): its 9 round trips (+$1.083, and +$0.964
  with (a)'s entry cap alone) and their split by book, side and rung; the interim value of each of the six conditions;
  and the health checks.
- **The fair's one-candle lag** (appendix B §2.4a), over the 4,176 decided minutes a book from 2026-09-25 00:05. The
  engine's fair took one hourly close fewer than the spec's in 4,066 of them. The fair differed by 0.5 bp in 7.0 %
  (USDC-GBP) and 11.3 % (USDT-GBP) of minutes. Of the 302 placements and re-prices, 13 used a different fair and 5 a
  price one tick away.
- **(a)'s entry half on the committed history** (appendix B §2.4b): 223 of 8,192 entries short in the primary window,
  1 of 102 after the change. One exit was checked by hand: the 22:45 exit of 09-24's three USDT-GBP longs would have
  completed at the same price by 00:05:52 on 09-25. In the post-change backtest, 22 of 101 maker exits had less
  through-volume in their minute than the position.
- **The one weekend's prints** (appendix B §3, 09-26/27), against a fair at Friday's GBP/USD close: USDT-GBP a median
  −4.6 bps from it, range −44 to +6; USDC-GBP a median −0.3, range −28 to +8.
- **The dry-run** (appendix B §2.3): order for order with the paper engine since the 2026-09-24 fix, bids only, 354
  asks skipped for want of coin. Its lags as in (e).
- **The 9 paper fills against the lag.** None of their prints came within 34 s of the start of its order's FIRST live
  minute; the nearest came at 41.9 s. They were not checked against the minute their current price went live, which
  is (e1)'s definition.
- **The 808 re-prices** to 2026-09-27 23:59 UTC, 3 of them exit legs. One had a print through its old price within
  90 s of its turn's minute start, in the 30–60 s part, and none within 30 s.
- **(e) is new.** It is not one of appendix B's four readings, (a)–(d). The lags, the fills' distance from their first
  live minute and the re-price count above had been seen when it was written, and its 34 s and 90 s were chosen from
  the lags.

No fill, trip or P&L of the record after 2026-09-27 21:38 UTC had been read when this was written.

Deviations are recorded in the review, the reference and the ledger.
