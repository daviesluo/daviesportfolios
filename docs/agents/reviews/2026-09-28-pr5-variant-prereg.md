# Pre-registration PR5V: "Stablecoin quotes - variant", PR5's rule with nine rungs a side and four keys, on paper

Written 2026-09-28 (UTC) and revised the same day after an independent review, before the first day it is judged on.
Frozen by the commit that adds it, which should land before 2026-09-29 00:00 UTC. A later freeze moves these dates, and
no other, by the whole number of days that puts the window's first day on the first UTC day that begins after the
freeze: the window (2026-09-29 → 10-26), E (2026-10-28 00:30), the null's bounds (2026-09-29 00:00 and 2026-10-27
00:00), the reading's earliest instant (2026-10-28 01:00) and latest date (2026-11-04), and the reading script's
deadline (2026-10-27 00:00). The start, 2026-09-28 00:00, does not move, nor does `N1`, nor any date of another file.
Any change after the freeze is a deviation and is reported as one. It changes nothing that runs: PR5's paper engine, its
dry-run executor, their tables, `stepMinute`, PR5's spec and its 2026-10-21 verdict, and every frozen pre-registration
that reads them (PR5-R, PR5-W, QUEUE) are untouched. `quotes.ts` and `quotes.test.ts` are not edited (the engine imports
their exports), and no column, index, trigger or policy of PR5's tables changes. The engine's call is a row of its own,
never inside `quotes`, so PR5's executor keeps its timing (PR5-R's (e)). The reading reads no row of
`agent_book_levels`, no `agent_quote_events` of kind `book` and no `book_seen` (QUEUE's fence), and its exports are
written by script and never printed, so nothing of PR5-W's weekends is looked at before PR5-W's reading. No key is read,
no signed call is made and nothing is placed.

Davies, 2026-09-28: "稳定币报价（PR5）继续研究测试更密的档（0.05 / 0.15/ 0.25%/0.35%/0.4%和其他如果你觉得需要测试的），
并且在单日单api每天最多 1,000 单下测试下频率最高可以做到多少s？并且计算大约会多赚多少%？如果需要更快/更多单的话我还可以多建几个
子账户多拿几个api让策略收益最大化，本轮优化后的最优策略可以按Stablecoin quotes - variant上线paper testing；£50 实盘之后再说"
(keep studying denser rungs for PR5, and the fastest loop under 1,000 orders a day per key, and roughly how much more
it earns; he can open more sub-accounts for more keys; this round's best configuration goes on paper as "Stablecoin
quotes - variant"; the £50 live test later).

## 1. What was chosen before this file, and how

The study is `2026-09-28-pr5-variant-study.md` (committed `3c08f0b3`), a research agent's, on public data only: it read
none of PR5's paper record, its dry-run or any production table. Its simulator, `scripts/pr5v/pr5v_sim.py`, is PR5's
frozen `simulate()` with its fixed parts made parameters; at PR5's settings it reproduces the frozen simulator trip for
trip and order for order (`backtests/pr5v/check_repro.json`, PASS). Its rules 1–4 were written into `study.py` before it
ran; rule 5 (the key count) after stage E had printed, applied to the first half only (disclosed there). They chose:

- **nine rungs a side**, 0.03, 0.05, 0.075, 0.10, 0.125, 0.15, 0.20, 0.25 and 0.30 % from fair, on both books;
- **a 0.03 % re-price step** (PR5's is 0.05 %);
- **four keys**, one per book and side, each held to the live design's order governor;
- a turn every second.

This file runs that configuration at **PR5's own minute** instead of a turn a second. The study found that cadence buys
nothing (GBP/USD is a minute bar and fairU an hourly median, so a faster loop sees neither sooner; across cadences P&L
moved by about −5 % to +1 %). Priced at PR5's minute with the study's code and inputs unchanged
(`scripts/pr5v/ref_timing.py`, committed `73281c30`, after the study), the same configuration made $1.054 a day over the
study's 28 days against $1.029 at a turn a second, and $0.509 against $0.502 over its five fresh days. And a replay of
PR5's own stored minutes at PR5's own timing differs from PR5 in the configuration alone, so the day-by-day pairing
below compares only what was chosen. §8 discloses the order in which this was decided.

## 2. The rule

Arm **main**, the one judged:

- **Books.** Revolut X's USDC/GBP and USDT/GBP, the UK prints PR5's engine stores.
- **Rungs.** On each side of each book, a post-only quote k from fair f = fairU / X, at k = 0.03, 0.05, 0.075, 0.10,
  0.125, 0.15, 0.20, 0.25 and 0.30 %: 36 rungs of $100, **$3,600** in all.
- **Re-price.** A quote, or an exit, moves when f has moved more than **0.03 %** since it was priced.
- **The shared cap.** The entry quotes resting on one side of one book share one cap a minute, 10 % of the minute's
  printed volume (Σ qty × price over the book's prints of that minute, both aggressors, in GBP, times X), and share each
  print's own value (its qty × its price × X). A print strictly through several fills them nearest the market first (a
  bid's highest price first, an ask's lowest; ties by k), each by at most what the print and the minute's cap have left,
  and at most $100. An entry fills once, as in PR5: the rung takes a position of what it filled, however small, and the
  rest lapses; a quote nothing was left for stays and may fill on a later print. Prints are taken by `ts`, then `id` in
  code-point order. Exits are not in that queue and take nothing from it: an exit fills whole on any print strictly
  through it, as in PR5.
- **Four keys, each governed.** Every rung belongs to the key of its book and its own side (a bid rung's exit is sent on
  the bid key). Each key counts its POSTs per UTC day of the turn: every placement, re-price, re-placement, exit
  placement, exit re-price, exit re-placement and stop. When the turn reaches a rung whose key has sent 600 or more
  that day, its entry quote, resting, pending or refused, is withdrawn and none is placed. From 700 the key's rungs
  place, re-price and re-place nothing; resting exits stay and may fill, and only stops are sent. The count is read as
  the turn reaches each rung, POSTs earlier in the same turn included: bids before asks, each side by k.
- **Everything else is PR5's frozen rule**, at its own timing: the turn at the start of minute t on data to t − 1, an
  order live from the start of t + 1, a re-priced order withdrawn at the turn, the post-only refusal against the last
  print before an order goes live and its re-placement at the first turn whose last print is no longer through it,
  exits resting at fair, the 24-hour stop at the last print of its minute as a taker (0.09 % plus half the measured
  spread), dark when X or fairU is missing, and P&L in GBP times the latest X.

Its reference is `pr5v_sim.simulate` in `docs/agents/scripts/pr5v/pr5v_sim.py` (sha256
54ad41982d143758ece6ee8e5bb48d5a4aafe1dc0429ccc0af6d1c57282de27a, as committed in `3c08f0b3`), which imports
`pr5_sim.py` (56fbad85ee4df6292f596188d091ad064d030180f33cefe3bd09089d7e772a1a), with `default_cfg(rungs=[0.0003,
0.0005, 0.00075, 0.001, 0.00125, 0.0015, 0.002, 0.0025, 0.003], reprice=0.0003, size=100.0, vol_share=0.10,
cap="shared", exit_share=False, s_ms=60000, delta_ms=None, cancel_ms=0, lagx_ms=0, phase_ms=0, gov={"entry_at": 600,
"stop_at": 700}, acct=lambda book, side: f"{book}/{side}")`. §5 uses `null_twins`, `daily` and `block_bootstrap` of
`study.py` (4a5d077ef0f97060ee5613d9a5f1c75b6e404b15ed052d367c1fe67f6d8e7b50), unchanged but for condition 2's end. The
reading script checks the three hashes before anything else.

Arm **top5**, reported beside and never judged: the same with the study's first-half top five, k = 0.05, 0.075, 0.10,
0.125 and 0.15 % ($2,000). Its numbers at PR5's minute over the 28 days: $0.691 a day, 12.6 %/yr.

## 3. The engine and its data

- **The engine** is `agents/quotes_variant.ts`, a call of its own in `edge-calls-every-minute`, into tables of its own.
  It is a replay of PR5's stored record, which is never pruned, so it may first be deployed after the window's first
  day, and a late deploy moves no date. It reads `agent_quote_state.last_minute` and nothing else of PR5's state: PR5's
  engine has decided minute t once that is t or later. For each book and decided minute it takes the X and fairU PR5's
  `stepMinute` was given (`agent_quote_minutes`) and the minute's prints (`agent_quote_prints`); a book-minute still
  without a minute row is rebuilt from `agent_quote_inputs` by PR5's `fxBarAt`, `fairHours` and `median`, and marked. It
  calls no venue and reads none of PR5's trips, events or rungs. Its first run decides every minute from 2026-09-28
  00:00 UTC, flat, in order, with the last print before that minute, before any later one. Each call decides at most 120
  minutes and returns within about 20 s, so it never lengthens the minute's batch. Every count and day it keeps is the
  decided minute's UTC day.
- **Its test.** Before the engine's code is first deployed, and before every later change to it is deployed (`deno
  test` gates each deploy), a test replays golden windows from `pr5v_sim.py` at both arms' settings, trip for trip and
  POST for POST, including stretches where the governor binds, where one print fills several rungs, and where the
  24-hour stop fires. The engine's record counts only if the test passed on the code that wrote it. If the code changes
  after the engine has decided a minute, it re-decides every minute from 2026-09-28 00:00, flat, and the change is a
  deviation.
- **What it records.** For every book-minute, once for both arms (they share the inputs; both arms decide each minute
  in the same call): the X, fairU and print count it decided on, and whether they came from `agent_quote_minutes` or
  were rebuilt (marked). For each arm: every POST with its key, kind, rung and minute; every withdrawal with its reason
  (dark or governor); every fill, exit, stop and trip, as PR5's engine records them.
- **Its start.** Both arms start flat at 2026-09-28 00:00 UTC. A position lives at most 24 hours, so every position held
  at the window's start is one the variant opened in the normal way, as PR5's are.
- **What it depends on.** PR5's paper engine must decide and record every minute before E (§4) with `stepMinute`
  unchanged (a minute whose row it failed to write is rebuilt, as above, and is not its record stopping). QUEUE needs
  its record to 2026-11-02 and PR5-W to its reading, 2026-11-25 (2026-12-23 at the latest); at PR5's 2026-10-21 verdict,
  keeping it running is put to Davies with their needs and this one's. **If PR5's record stops, or `stepMinute` changes,
  before E**, the window ends at the last UTC day D for which PR5's engine decided every minute before D + 2 days 00:30
  with `stepMinute` unchanged, E becomes that instant, and every condition is read on the window's first day → D with
  the same thresholds. With fewer than 21 days the test is reported and not judged.

## 4. The window and the reading

- **The window**: the 28 UTC days 2026-09-29 → 10-26. A trip belongs to the day of its entry (`t_entry`), for both
  arms and for PR5 (`agent_quote_trips`). **E** = 2026-10-28 00:30 UTC.
- **The reading**: on or after 2026-10-28 01:00 UTC, when every trip entered in the window has closed (the 24-hour stop)
  and the engine has decided every minute before E; at the latest 2026-11-04, or, if the engine has not then decided
  every minute before E, as soon as it has, reported as a deviation. The first session then with the database connector
  exports the replay's inputs (below) and both arms' records, and PR5's trips entered in the window, commits them under
  `docs/agents/backtests/pr5v/forward/`, and runs the reading script, which is committed before 2026-10-27 00:00 UTC.

## 5. What decides

**The replay.** The runs of `pr5v_sim.simulate` in conditions 1, 2 and 4 are on `Mkt` objects, one a book (a dict keyed
by book for `null_twins`), built from the exports: `agent_quote_prints` from the last print before 2026-09-28 00:00 to
E, ordered by `ts`, then `id` compared as a string in code-point order; `X(t)` and `fairU(t)` of minute t are the values
the engine recorded for that book and minute, looked up by minute; and `change_instants` returns every minute of the
run, so that `simulate` turns every minute. The replay of conditions 1 and 4 starts flat at 2026-09-28 00:00 UTC and
ends at E; the null's twins run as condition 2 says. Only trips entered in the window are scored, and none may close at
a run's last step. Before any window data are opened, the reading script shows that such markets, built from the
study's own `Mkt` values over the study's spans, reproduce the study's runs of main on its stock markets (as
`ref_timing.py` makes them) over the 28 days and the fresh days, trip for trip and POST for POST, and with them
`ref_timing.json`'s numbers for main (563 trips, $29.5129; 40 trips, $2.5438).

The arm **main** passes when all five hold.

1. **Faithful.** The replay at §2's settings reproduces main's trips in the engine's record entered in the window: at
   least 95 % of the engine's trips have a replay trip with the same book, side, k, `t_entry` and entry price in ticks
   (the price ÷ 0.0001, rounded), and at least 95 % of the replay's have such an engine trip; and the P&L of the two
   sets differs by at most 10 % of the absolute value of the engine's. Minutes whose exported print count differs from
   the count the engine recorded are listed. Conditions 2 and 3 read the engine's record. A miss caused by the engine's
   code may be fixed once, the engine then re-deciding every minute from 2026-09-28 00:00 (§3), and condition 1 is read
   again on the new record; a second miss is a fail. The fix is reported as a deviation with the first run. Any other
   miss is a fail.
2. **Above its null.** The window's P&L (main's trips in the engine's record entered in the window) is above the p95 of
   the variant's own random-time null: `null_twins` of `study.py`, called as `null_twins(Runner(), markets, {"reprice":
   0.0003}, rungs, trips, 2026-09-29 00:00, 2026-10-27 00:00)`, 2,000 draws, seed 20260923, where `markets` are the
   replay's markets, `rungs` main's, `trips` main's trips in the engine's record, and each twin runs to min(E, m + 2
   days) in place of min(`N1`, m + 2 days). (`N1` is 2026-09-23 00:00; with it every later twin runs no step and
   returns 0.) With E set to `N1` the function is the study's, unchanged.
3. **Better than PR5, day by day.** The daily difference, main minus PR5 (each by UTC day of entry, `daily` of
   `study.py`), over the 28 days: in 10,000 resamples of circular 7-day blocks (`block_bootstrap` of `study.py`, seed
   20261027), the share of resampled means at or below 0 is under 0.05. (With four blocks a resample, this passes a true
   zero gain 5.5–8 % of the time on data shaped like the backtest's.)
4. **The stress arm above zero.** The replay at §2's settings with `stress=True` (a fill needs a print one tick further
   through; a stop pays twice the taker cost): the P&L of its trips entered in the window is above 0.
5. **The governor held.** In the engine's record, every entry POST of a key (placement, re-price, re-placement) had
   fewer than 600 POSTs of that key before it on that UTC day, and every other POST but a stop fewer than 700, stops
   counted in the tally.

**Described, never judged:**

- %/yr on $3,600, and the gain over PR5 per extra dollar against 8 %/yr on the $2,400 more that main locks ($0.53 a
  day). Four weeks cannot show that the extra capital beats that line (about 210 days at this timing; the study's 300
  were at a turn a second); it is reported;
- arm top5, every number above;
- trips, win rate, taker exits and P&L by book, by side and by rung; the fills per rung;
- the key-days on which the governor withdrew entries, and when; the POSTs a key a day; the most POSTs a key sent at one
  turn, stops included, against the venue's 10 a second;
- the minutes marked as rebuilt from `agent_quote_inputs`;
- if PR5's live path places a real order before E, its prints are on the tape both arms read: the days from its first
  live order are reported apart as well as within the window.

**What the study expects**, at PR5's minute (`ref_timing.json`). Over its 28 days, on Exness's GBP/USD: main $1.054 a
day, 10.7 %/yr; PR5's rule as it runs $0.417; paired by day +$0.637 (SD $0.655; 7-day blocks +$0.49 to +$0.81; better
on 22 of 28 days); stress $0.826; the governor withdrew entries on 14 of 112 key-days. Over the five fresh days, on
Yahoo's GBP/USD as the engine reads it: main $0.509 a day against PR5's rule's $0.230 (simulated; PR5's record was not
read), paired +$0.279; every key reached 600 POSTs on each of the three weekdays, from 14:49 UTC, and without the
governor main made $0.799. Condition 3's chance of passing in 28 days: about 100 % at the 28 days' gain, 82–100 % at
half of it, 73–98 % at the fresh days' gain, 36–60 % at a quarter, and 5.5–8 % at none.

## 6. What a pass allows, and what it does not

- **A pass says** the variant made more dollars than PR5 on the same days, as the study said it would. It does not say
  the extra $2,400 is worth locking.
- **Live money needs more than a pass**: four funded Revolut X sub-accounts (GBP on the bid keys, USDC and USDT on the
  ask keys), their keys verified read-only, a live executor for four keys (PR5's live path drives one), and Davies'
  word, with the first live order confirmed in the same conversation. Nothing here asks for it. PR5's own £50 live
  test is a separate question, deferred by Davies ("£50 实盘之后再说").
- **Both arms stop at the reading, pass or fail, unless Davies says otherwise.** PR5 is untouched either way.

## 7. What it cannot show

- **A queue.** A fill is a print strictly through the price, sized by a share of the minute's volume; nine rungs a side
  put more of the account's own size in the queue (QUEUE's question, frozen separately).
- **Latency.** An order is live from the next minute, as in PR5; a live executor's timing is its own.
- **The venue's limits.** Whether 1,000 orders a day is per key or per account is undocumented; four keys on one
  account may share one budget. The 10-a-second limit is modelled per key.
- **Another regime.** The books tightened in the week of 2026-08-24. The study found this shape worse per dollar when
  they were wide (28.4 against 82.0 %/yr before then).

## 8. Seen before the freeze

- The study's data: the committed tape and FX to 2026-09-23, and the fresh keyless pull of 2026-09-22 → 09-28 00:00
  (prints, USD-book hours, Yahoo's GBP/USD minutes). All before the window.
- `ref_timing.py`'s numbers above, computed on 2026-09-28 on the same data, and the review's own checks on those data
  (the fresh days' governor and paired figures in §5, and condition 3's pass chances).
- **The order of the choice.** The minute timing was chosen after `ref_timing.py`'s numbers were read. A replay of
  PR5's stored minutes runs most simply at PR5's own timing, and pairs minute for minute with PR5's decisions.
- The main session saw PR5's orders, fills, trips and realised P&L per day for 2026-09-23 → 09-28 on production while
  building its page's DAYS table (2026-09-28). Nothing here was chosen with them, and all fall before the window.
- The engine is built after the freeze, and its builder may see PR5's stored record for days of the window. The rule is
  fixed by `pr5v_sim.py` at its hash and by the golden test, so nothing seen then can change a decision.
