# MAKER-ABSENT: a watch on the other maker, and what to do while it is away (2026-10-30)

Davies, 2026-10-30 ~03:25 UTC, after hearing that the automated maker (one order of about 5,000 coins a side) had left both
Revolut X GBP books at 2026-10-29 21:16 UTC, and that LIVE's USDT-GBP fills since then were about 5-8 times the same hours of
the days before: "我们如何趁他不在时最大化收益？" and "我们能不能对他加个监控，实时观察和记录他的行为".

**Not blind, research only for part 2.** No order, executor config or frozen file was touched. Part 1 adds a watch: three new
tables (migration `0185`), filled inside the book recorder's existing call, and a line on the two Revolut X live pages.
Every pound in part 2 is a replay's (paper). LIVE's own fill prints are taken out of the tape by id, and that list is not
committed. Scripts and results: `docs/agents/backtests/mmcomp/` (`scripts/maker_history.ts`, `scripts/absent.py`,
`results/maker_history.json`, `results/absent.json`). Follows `reviews/2026-10-30-mmcomp-3.md`.

## 0. Answers first

**1. Can we watch it and record what it does? Yes, built.** `agents/maker_watch.ts` reads the book recorder's own snapshots
each minute (no new call, no venue read) and writes:
- `agent_maker_minutes`: a row per book per minute. It says whether the maker was there (both sides, one side, none, or
  unseen when the recorder missed the book), its prices and sizes, how far apart its bid and ask are in ticks, and each side's
  distance from LIVE's fair in bps.
- `agent_maker_events`: when it appeared or disappeared, and when its width or its size changed.
- `agent_maker_state`: what the page shows.

Its first runs fill the history from 09-26, because the recorder keeps 35 days. The two Revolut X live pages show one line
under the scoreboard, for example "Other maker: absent since 29 Oct 21:17 UK (5 h 33 min)", or "present since …, 12 ticks
wide, its bid 6.1 bps and ask 9.8 bps from fair".

**What the history says** (the watch's own code on the recorded books, 09-26 -> 10-30 03:00, `results/maker_history.json`):
- **Width.** 5 ticks to 10-12, 12 ticks from 10-13 (USDT-GBP 09:12 UTC, USDC-GBP 09:45). It narrowed again from 10-28 ~15:45
  (USDT-GBP 12 -> 6, USDC-GBP 12 -> 7 -> 4). There were short excursions inside the 12-tick regime (10-22 to 10-24 on
  USDT-GBP: 17-37 ticks).
- **Absences of 15 minutes or more.**
  - USDT-GBP: 32, 47.2 hours in all. The long ones were 09-27 15:11 (5.8 h), 10-07 15:57 (4.8 h), 10-12 19:42 (9.2 h),
    10-20 11:34 (5.0 h) and 10-29 21:17, still going at 03:00 (5.7 h).
  - USDC-GBP: 23, 37.9 hours. The long ones were 10-04 05:27 (2.4 h), 10-12 21:02 (7.3 h), 10-20 06:06 (10.5 h) and
    10-29 21:52, still going.
  - It came back after 10-12's absence 12 ticks wide. So a long absence has twice come before a change of how it quotes.
- **Size.** It drifts: USDT-GBP 5,000 -> 5,046 coins and back, USDC-GBP 4,954-5,000. The watch follows the drift.

**2. How do we make the most of its absence? Mostly by doing nothing different: today's rules already earn about three times
as much an hour while it is away. No change of rule did robustly better, so no twin is built. The one lever that clearly pays
while it is away is more capital.**

LIVE's rules replayed on USDT-GBP at £600, money from round trips entered in each regime, as a daily rate ('at' / 'through'):

| regime | hours | £ a day | trips a day | bps a trip | all bids holding |
|---|---|---|---|---|---|
| **maker absent** | 47.2 | **2.87 / 2.81** | 12.7 | 21.7 | **31 % of minutes** |
| maker there, 12 ticks | 323.4 | 1.06 / 0.77 | 7.8 | 15.6 | 0 % |
| maker there, 5 ticks | 429.9 | 0.90 / 0.70 | 6.0 | 17.0 | 9 % |

RX USDC/GBP's rules at £120: absent £0.52 / £0.43 a day, 12.7 trips, 14.3 bps; 12 ticks £0.17 / £0.12; 5 ticks £0.16 / £0.10.
Its bids were all holding on 27 % of absent minutes.

Each candidate, against today's rules, summed over the absences ('at' / 'through'; P is the share of 10,000 resamples of the
absences whose sum is ≤ 0):

| change, LIVE | £ a day absent | absent sum vs today | P(≤ 0) | 12 ticks / 5 ticks, £ a day |
|---|---|---|---|---|
| today's rules | 2.87 / 2.81 | | | 1.06 / 0.90 |
| a 0.05 % rung in place of 0.3 % | 2.21 / 2.19 | -£1.30 / -£1.21 | 0.98 / 0.97 | 1.16 / 0.90 |
| four rungs, 0.05-0.3 %, £75 each | 2.40 / 2.35 | -£0.92 / -£0.90 | 1.00 / 1.00 | 1.15 / 0.89 |
| £200 on 0.1 %, £100 on 0.2 %, none on 0.3 % | 2.37 / 2.35 | -£0.99 / -£0.91 | 0.96 / 0.96 | 1.17 / 0.89 |
| £150 on 0.1 % and 0.2 % | 2.72 / 2.69 | -£0.29 / -£0.23 | 0.73 / 0.68 | 1.10 / 0.88 |
| exit at fair | 2.75 / 2.70 | -£0.23 / -£0.21 | 0.97 / 0.90 | 0.96 / 0.91 |
| exit 2 ticks beyond fair (always) | 2.95 / 2.93 | +£0.16 / +£0.23 | 0.22 / 0.07 | 0.97 / 0.87 |
| exit 3 ticks beyond fair (always) | 3.10 / 3.05 | +£0.44 / +£0.47 | 0.10 / 0.04 | 0.86 / 0.70 |
| **switch: 3 ticks while the watch says absent, 1 otherwise** | 2.99 / 2.92 | +£0.24 / +£0.22 | 0.28 / 0.36 | 1.06 / 0.90 |
| switch: 2 ticks while absent | 2.89 / 2.82 | +£0.04 / +£0.02 | 0.44 / 0.50 | 1.06 / 0.90 |
| switch: the 0.3 % rung's £100 on 0.05 % while absent | 2.39 / 2.37 | -£0.95 / -£0.87 | 0.97 / 0.97 | 1.06 / 0.90 |
| **£1,200 (every rung £200)** | **5.32 / 5.22** | **+£4.82 / +£4.75** | **0.005 / 0.005** | 1.86 / 1.52 |

Rows 2-7 apply all the time, so they also change the present regimes. The switches change only the absences, but they act
only from when the watch has called the absence (15 minutes in) to 3 minutes after it ends.

- **Nearer quotes earn less, not more.** When the maker is gone, today's 0.1 % rung is already the best price on the book
  most of the time. A 0.05 % rung doubles the trips in the present regimes but halves what each earns (16 -> 9 bps). In the
  absences it takes the fills the 0.1 % rung would have had at half the margin.
- **The exit is the only rule lever that points the right way, and it is not proven.** With the maker gone, the takers pay
  more, so an exit 2-3 ticks further out still fills.
  - Left on all the time, it costs in the present regimes: 3 ticks loses £0.20 a day at 5 ticks wide.
  - Switched on only in a known absence, it gains £0.22-0.24 over all 47 hours, with P 0.28-0.36.
  - On USDC-GBP, 3 ticks switched gains £0.05 (P 0.09 / 0.19).
  - So it is not robust.
- **Capital is the binding limit while it is away.**
  - LIVE's bids were all holding on 31 % of absent minutes, against 0-9 % otherwise. Takers sell to us, our bids fill and wait
    for their exits, and then there is nothing left to buy with.
  - At £1,200 the absences earn 1.85 times as much (£5.32 against £2.87 a day; 5 absences ahead, none behind, P 0.005). The
    present regimes earn about 1.7 times.
  - On USDC-GBP, £240 earns 2.0 times as much in the absences (P 0.001).
  - The next size is already under test as `live1200` ("variant-1", from 10-28). Raising LIVE is Davies' call alone.
- **How much evidence there is.** 47 hours of absence on USDT-GBP, but only five of the 32 absences had any round trip
  (nights and weekends are quiet). The current absence alone holds half of the absent money (£2.81 of £5.65). Every P above
  rests on five windows.

## 1. The watch (part 1)

- **Where it runs.**
  - Inside `agents?action=books`, the recorder's existing row of `edge_calls`, during the 40 s that call already waits before
    it reads, and at most until 32 s into the minute. So there is no new recurring call, and the watchdog and the beat are the
    recorder's.
  - It writes every whole minute since its last run, six hours a chunk, and at most six chunks a run, because an Edge request
    has 2 s of CPU.
  - Its first runs fill 09-26 -> now in about 50 minutes. Every later run writes the minute just gone.
  - A fault goes to `ops_errors` as `agents.maker_watch` and never touches the recorder's reads.
- **Recognising its order** (`mwSide`), on each side the best level that is:
  - 'one': one order within ±50 coins of its size. The size follows the median of its recent one-order sightings.
  - 'shared': several orders holding its size to 1,000 coins more, or up to 5,000 more at the very price it held the minute
    before.
  - 'partial': one order of at least 2,500 coins, no bigger than the order last seen on that side and at most 1,500 coins
    under it, within 20 ticks of its price, last seen under 30 minutes ago. This catches it part-filled and moving at a
    smaller size: 2026-10-27's night showed 3,733.7 coins at 0.7497, then 3,732.9 at 0.7487.
  - The recorder keeps five levels a side. On a crowded book its order can sit deeper for minutes, which the debounce absorbs.
- **The minute.** The newest snapshot stored before the minute's end, if a reading found it no more than a minute before the
  minute began; otherwise the minute is unseen and changes nothing.
- **The debounce.**
  - Disappeared after 15 seen minutes without it (3 gave 249 absences on USDT-GBP, most of them its order out of the top five).
  - Appeared after 3 minutes with it.
  - Width: the median of its last 60 two-sided minutes of full-size orders, and an event when that moves 3 ticks or more.
    Its 4-6 tick wobble is one regime, 5 to 12 another. The first versions, on any change of the mode or the median, gave
    205-463 width events in five weeks; this gives 29.
  - Size: the median of its last 30 one-order sightings, and an event when that moves 10 coins.
- **Tests** (`maker_watch.test.ts`, 8): recognition on stored books (5 ticks, 12 ticks, shared, gone, part-filled), the
  minute's snapshot, the distance from fair and the held X, the events of a regime change, no event for a flicker, and a watch
  cut into many runs writing exactly what one pass writes. Six counterfactuals each turn a test red:
  - disappeared after 3 minutes;
  - no part-fill chain;
  - `seen_until` ignored;
  - width events on any change;
  - widths kept through an absence;
  - no chunk cap.
- **Page:** `makerWatchLine` (`src/agents/agents.js`) and its test (`maker_watch_line.test.js`, 8). The browser sweep reads
  the line on LIVE's page (`pr5-page`, both viewports).
- **What it does not see:** a maker that comes back at another size altogether (10,000 coins) reads as absent. Each
  disappearance keeps the book's top two levels a side in its event, so a person can see what replaced it.

## 2. The replay (part 2)

- **Record.** REVX-FAIR's minutes and prints to 10-29 00:00, then 10-29 00:00 -> 10-30 03:00 pulled the same way
  (`sql/pull_1029.sql`, md5-checked). LIVE's own fill prints were taken out: 677 on USDT-GBP and 225 on USDC-GBP, from both
  lists.
- **Engine.** `scripts/run2.py`, PR5-OPT's executor with hooks. MMCOMP-3's `inside.py` now imports it from there; its results
  are byte for byte the same (md5 `50d0923b…`). The run used LIVE's rules: £1 holding line, an exit a tick beyond fair, fills
  'at' and 'through', the 24-hour stop.
- **Regimes** are the watch's: absent from its first minute gone to its return; 'wide' while its width is 10 ticks or more;
  'narrow' otherwise. A round trip counts in the regime of its entry.
- **Statistics.** Paired by absence window: each window's round trips under a variant against today's rules. 10,000
  resamples of the windows with replacement, seed 20261030.

## 3. What the replay cannot model

- The maker coming back because we quote nearer, or quoting differently when it does (it came back 12 ticks wide after
  10-12).
- Takers answering our prices: in an absence our quotes are the book, and a taker might wait instead of trading at them.
- The coins for the asks are assumed always there (the executor tops them up at £5 a book a day). In an absence that sells to
  us, it is the bids that run short, which the replay does see.
- 47 hours, five active windows, half the money in the current one.

## 4. What the watch needs to collect before a switch is worth a twin

- **Ten absences of an hour or more with round trips in them** (there are five), with the switch "3 ticks while absent" ahead
  in at least seven and P ≤ 0.10 on both fill rules.
- At the current pace (an absence of four or more hours about once a week) that is roughly two months. Re-run
  `scripts/absent.py` on a fresh pull then; the watch's tables give the windows directly.
- If Davies wants it measured forward meanwhile, the twin is LIVE's twin with `rules.exitOffset` 3 while
  `agent_maker_state` says absent. That needs the twin driver to read the watch, which is a new driver beside the frozen
  `quotes_twin.ts`. Not built.
