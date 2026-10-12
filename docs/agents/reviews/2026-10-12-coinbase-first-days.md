# The Coinbase recorders and paper test, their first days (2026-10-12)

Davies, 2026-10-12: "coinbase上线后情况如何，有可以优化进步的地方吗". Read at 2026-10-12 23:20 UTC, from the production database
(select only), from Coinbase's public API (one trade-id check) and from the repository. Nothing was changed in production, no
order was placed, no key was read.

**This reading is not blind and gives no verdict.** No no-peek rule exists since 2026-10-04. The pre-registered reading
(`2026-10-10-coinbase-paper-prereg.md`, Deviation 1) still runs on 2026-11-08 from 00:30 UTC, by `cbpaper/scripts/replay.py`,
on the window 2026-10-11 00:00 → 11-08 00:00 UTC. Everything below is descriptive and in the window's first 47 hours, of which
the engine was lit for 24.

Queries: `docs/agents/backtests/cbreview/sql/`. Scripts, inputs and results: `docs/agents/backtests/cbreview/`.

## 0. In short

- **The recorders are healthy.** 107,864 prints in four books, trade ids continuous but for one print from before the window;
  4,308 decided minutes a book with no hole; the book recorder missed one minute; two errors in the box in 2.5 days, neither a
  recording loss; no rate-limit answer; the Edge region reaches Coinbase on every run.
- **The engine decides correctly, and the record the 11-08 reading replays is defective.** Eight round trips so far, every fill and
  exit checked by hand against `cb_trades`. But `cbMinuteRow` stored no lowest/highest price for a side that printed twice or
  more in a minute (`reduce(Math.min)` is NaN there): 56 % of the minutes with prints have no extremes, and `replay.py`, run on
  the first lit day, reproduces 3 of the engine's 8 trips and a loss, not 8 and the engine's P&L. Bar 1 would fail on a
  recording defect. Fixed in code with a pin test (counterfactual run); the stored minutes can be rebuilt from `cb_trades`
  until 2026-10-21 23:01 UTC, when the prune takes the first lit minute's prints. It needs a Deviation 2, because `cb_quotes.ts`
  is a frozen file.
- **The test is dark 29 % of the time by design** (the interbank closure, Friday ~22:00 → Sunday ~23:00 UTC), the same as PR5's
  paper engine. The window opened 23 hours dark. That is the rule, not a gap; it is the largest single candidate for an
  improvement (section 6).
- **Interim, one lit day:** 8 round trips, 6 won, +£0.49, all on the two EUR books; the two GBP books filled nothing. Flat at
  the moment. On Revolut X over the same hours: one round trip, +£0.10 on the £100 twin.

## 1. Health since the deploy

Ledger items 12 and 13, then the rest. `sql/health.sql`.

| check | result |
|---|---|
| `cb_rec_state` | `reached` true, `last_error` null; last run 23:03:00, 590 ms; every book `hole` false, 1 page, 0 dropped |
| prints | USDC-EUR 59,818, USDC-GBP 13,633, USDT-EUR 21,019, USDT-GBP 13,394 (107,864), from each book's first page (2026-10-09 18:14 – 23:13 UTC) to now |
| trade-id continuity | 107,864 of the 107,865 ids in the four books' spans are present; the one missing is USDC-GBP **7321708**, 2026-10-10 17:41:56.29 UTC (a 2,345-coin print at £0.7561 beside id 7321709, same microsecond). Coinbase serves it today (checked). Before the window, no effect on a fill. Not explained; one print in 107,864 |
| silences | longest between two prints inside the window: USDT-EUR 37 min 18 s (25 gaps over 10 min), USDT-GBP 18 min, USDC-GBP 8 min 44 s, USDC-EUR 2 min 48 s. The ids are continuous across them: quiet books, not holes |
| `cb_quote_state` | `last_error` null; `last_minute` 23:01 at 23:03 (a lag of 2 min 24 s: the designed minute behind plus the run at :00); 4,308 minutes a book from 2026-10-09 23:14, 0 holes |
| `cb_book_state` | `recorded` 4, `reached` true, `last_error` null; levels: 4,090 / 3,972 / 4,059 / 3,835 rows (a row only when the book changed), reads 4,093 / 4,092 / 4,093 / 4,093 |
| `cb_book_levels`, `cb_touch` | one minute missing (2026-10-11 17:11, all four books) and USDC-GBP's 2026-10-10 22:32; `cb_touch` 4,164 rows a book, one 2-minute gap (17:11) |
| beats | `cbrec` and `cbbooks`: 3,628 of 3,629 minutes since 2026-10-10 10:36 (older beats are pruned); the one missing minute is **2026-10-11 17:11 for both**, and in that minute only the monitor's dead-man beat exists: the whole minute job did not run (every `agents` call lost it; `agents.quotes_twins` "Signal timed out" at 17:11:19). A platform stall, not Coinbase's |
| reruns (`edge_call_retries`) | since 2026-10-10 10:36 (the beats' span) `cbrec` 11 and `cbbooks` 5, every one `ok` (0.3 % and 0.1 % of minutes; 15 and 5 since the deploy); the same order as other calls (`pmrwc-x` 12, `pmlpprep` 11) |
| `ops_errors` | two Coinbase rows. 2026-10-10 22:32:31 `agents.cb_books`: USDC-GBP "error sending request" to PostgREST (a platform blip that minute: `edge-watchdog.unreadable` 22:32:13 and PR5's `agents.crash` 22:32:25 say the same). 2026-10-11 23:18:16 `agents.cb_rec`: "paper: Signal timed out." (the first lit hour; no minute is missing from `cb_quote_minutes`). Nothing else names Coinbase |
| rate limit | a minute is 12 requests usually (8 + 4) and 32 at most, against 10 a second per IP: no 429 recorded, `skipped` empty |
| region | `reached` true on every report; Coinbase also answers from this review's machine |
| size | the ten `cb_*` tables are 34 MB of 1,713 MB (2 %) |

**Recording gaps that would void or weaken the 11-08 reading: none in the window.** Prints are id-continuous from 2026-10-11 00:00,
the minute record has no hole, the recorder holds no open hole. What weakens it is not a recording gap (sections 2 and 3).

## 2. The defect in the minute record (bar 1)

`cb_quote_minutes` keeps, per decided minute, "all PR5's simulator reads of a minute", so that bar 1 can replay the test after the
prints are pruned. `cbMinuteRow` (`cb_quotes.ts`) took each aggressor side's lowest and highest price with
`xs.reduce(f)`, `f` being `Math.min` or `Math.max`. `reduce` calls `f(acc, cur, index, array)`; with two elements or more that is
`Math.min(a, b, 1, [a, b])`, which is NaN, and JSON stores NaN as null.

- **Measured:** a stored extreme is non-null exactly when its side printed once that minute: 12,728 decided minutes with prints, 0
  mismatches; every non-null one equals the prints' own; the 5,327 sell and 8,057 buy extremes of sides that printed twice or more
  are null (56 % of the minutes have all four null). Inside
  the window 3,784 of 8,625 minutes with prints have a wrong sell extreme and 5,554 a wrong buy one. The pin tests had only one
  print a side.
- **What it does not touch:** the engine's decisions. `stepMinute` reads the prints, not the record; the eight trips below are right.
- **What it does to bar 1:** `replay.py` turns a minute into at most five prints: the four extremes and the last. With the
  extremes null it sees the last print only. On the first lit day (2026-10-11 23:01 → 10-12 23:00, the export Deviation 1 describes,
  `scripts/replay_check.py`, `results/replay_check.json`):

  | record | replay trips | replay P&L | engine | within 5 % / 10 % |
  |---|---:|---:|---:|---|
  | as stored | 3 | −0.2924 | 8 trips, +0.5794 | no / no |
  | extremes restored from the prints | 8 | +0.5794 | 8 trips, +0.5794 | yes / yes, to four places |

  (P&L in the books' own currency, euros here, as Deviation 1 has the export give it.)
- **The fix** (`cb_quotes.ts`: `xs.reduce((a, b) => f(a, b))`) and its pin test (`cb_quotes.test.ts`, several prints a side on a
  GBP and a EUR book, one print, none): the test fails on the old code (run before the change) and passes after.
  **Not landed with this review:** `cb_quotes.ts` is frozen by the pre-registration's §5, so the fix and its pin wait for
  Davies' word on Deviation 2 (the main session, 2026-10-12); they are on the review's worktree commit `e6df4e0b`.
- **The repair** of the stored minutes: `sql/repair_minute_bars.sql` (an `update` from `cb_trades`, with a verify). Not run: this
  review's SQL is read-only. It must run after the fix is deployed and **before 2026-10-21 23:01 UTC**, when `cb-rec-prune`
  (prints kept 10 days) deletes the first lit minute's prints; later the prints can only be paged back from Coinbase by trade id
  (public, keyless; ids are continuous), which is slower but possible.
- **It is a deviation.** §5 of the pre-registration freezes `cb_quotes.ts` and its tests, and the repair changes the test's record.
  Proposed text for §7 (this file may not edit it):

  > **Deviation 2 (2026-10-12, before the reading).** `cbMinuteRow` stored null for a side's lowest and highest print whenever the
  > side printed more than once in a minute (`reduce(Math.min)`), so bar 1's replay saw only the last print of 56 % of the minutes
  > with prints. The function is fixed (`xs.reduce((a, b) => f(a, b))`, pinned in `cb_quotes.test.ts`) and the stored extremes of
  > the window's minutes are rebuilt from `cb_trades` by `docs/agents/backtests/cbreview/sql/repair_minute_bars.sql`. The engine's
  > decisions, `stepMinute`, `replay.py` and the bar are unchanged. Evidence: `cbreview/results/replay_check.json`.

## 3. Dark time

The engine decides only when GBP/USD (and for a EUR book EUR/USD) has a bar within ten minutes, as PR5's does. Yahoo has none from
Friday ~22:00 to Sunday ~23:00 UTC, so the window opened on a Sunday with **1,381 dark minutes (23 hours)**, and the first lit
minute is 2026-10-11 23:01. PR5's paper engine is dark 2,961 of 10,080 minutes a week (29.4 %, weeks of 09-28 and 10-05). The
window's 28 days hold about 11,800 dark minutes of 40,320 (29 %): the first 1,381, three full weekends of 2,961, and the last
weekend's from Friday 11-06 ~22:00.

- It is in the history figures the bar was set from (the simulator goes dark the same way) and in PR5's, so bars 3 and 5 compare
  like with like. The prereg reports the dark minutes beside the bar; this is the number to expect.
- Bar 3 asks for 6 % a year on £2,216 over the window's 28 days: **£10.20**. At the first lit day's £0.49, 20 lit days would give
  about £9.8. One day says nothing about that.
- Both interbank inputs are PR5's paper engine's (`agent_quote_inputs`: GBP/USD and the hourly dollar-book closes). They are
  complete: no dark minute inside a lit period, the GBP/USD bar at most 7 minutes old (8 minutes older than 3). **If PR5's paper
  engine is switched off at its 2026-10-21 review, this test goes dark with it**; the ledger should say so.

## 4. Interim results (not blind, descriptive)

Lit window 2026-10-11 23:01 → 10-12 23:03 UTC, about 24 hours. `sql/interim.sql`.

| book | prints | entry orders placed | fills = trips | won | P&L £ | mean hold | held now |
|---|---:|---:|---:|---:|---:|---:|---:|
| USDC-GBP | 4,989 | 120 | 0 | 0 | 0 | | 0 |
| USDT-GBP | 7,533 | 120 | 0 | 0 | 0 | | 0 |
| USDC-EUR | 29,495 | 115 | 6 | 5 | +0.6328 | 1.98 h | 0 |
| USDT-EUR | 15,880 | 121 | 2 | 1 | −0.1431 | 3.85 h | 0 |
| **all** | 57,897 | 476 | **8** | **6** | **+0.4897** | | **0** |

("Entry orders placed" counts each price a rung rested at, from its placement to the next one.) A EUR book's trips are €100 of
notional, £84.5, and their P&L is in pounds at the book's pounds per euro when the trip closed (Deviation 1). Seven of the eight
fills are asks (a coin sold into a rise), one a bid; no stop, no taker exit; the capital is £2,214 (£1,200 + €1,200 at 0.8451; £2,216 in the prereg at 0.8468).

| rung | trips | P&L £ |
|---|---:|---:|
| USDC-EUR ask 0.1 % | 3 | +0.0282 |
| USDC-EUR ask 0.2 % | 1 | +0.1132 |
| USDC-EUR ask 0.3 % | 1 | +0.1979 |
| USDC-EUR bid 0.1 % | 1 | +0.2934 |
| USDT-EUR ask 0.1 % | 2 | −0.1431 |

- **Fill rate:** 8 fills in 24 rungs in one lit day: 0.33 a rung-day, 0.67 on the EUR books and 0 on the GBP books. History
  (`cbpaper/results/compare.json`, last 28 days, calendar days) had 242 trips in 28 days across the four books, 8.6 a day, about
  12 a lit day: the first lit day is in line, with the GBP books' share (history: 112 of 242) missing so far. Trips cluster, so one
  quiet day on the GBP books is not a break.
- **Why the GBP books did not fill:** their prints stay close to the engine's fair. Against it, in bps over the lit day: USDC-GBP
  median +2.4, range −3.6 to +8.7; USDT-GBP +3.2, −2.6 to +8.7; USDT-EUR +4.7, +0.1 to +9.6; USDC-EUR +3.4, −14.7 to +43.5. A rung
  10 bps from fair needs a move of about 7 bps beyond a book's usual offset (and it can sit nearer, down to 5 bps, when fair has
  drifted without a re-price). The EUR fills came from USDC-EUR sweeps (one buyer swept three of its asks at 10:55:25) and from
  EUR/USD moving 61 bps from its low to its high over the day.
- **Against the pre-registration's expectation:** history at £100 a rung gave 13.1 % (last 28 days), 9.7 % (since 08-24), 6.0 % (90
  days) a year; bar 3 is 6 % on about £2,215 (£10.20 over the window). One lit day's +£0.49 is 8.1 % a year if every day were lit like
  it, and 4.0 % by the bar's own calendar formula over the two elapsed days. Neither is evidence.

**Against Revolut X over the same hours** (PR5's books are far thinner: 47 prints in USDC-GBP and 579 in USDT-GBP, against Coinbase's
4,989 and 7,533):

| | capital | entry fills | round trips | P&L | held now |
|---|---:|---:|---:|---:|---:|
| Coinbase, "Stablecoin quotes with Euros" (£/€100) | £2,214 | 8 | 8 | +£0.4897 | 0 |
| PR5's paper engine (up to $100, 10 % of the minute's volume) | | 5 | 1 | +$0.0259 on $21.79 | |
| twin "Stablecoin quotes" (£100) | £1,200 | 5 | 1 | +£0.10 (sold 119.26 at 0.75625, bought back at 0.75540) | 4 rungs |
| twin variant-1 (£50), variant-2 (£50) | £600 each | 5 | 1 | the same trip at half the size | 4 rungs |
| twin variant-3 (rule D, £50) | £1,800 | 14 | 3 exits | not worked out | |
| PR5 LIVE (£10 a rung) | £120 | 5 | 1 | about +£0.02 | 4 rungs, two of them £0.10 partial fills |

Per pound of capital: Coinbase +0.022 %, the £100 twin +0.008 %, LIVE +0.017 % in the day. Every Revolut X fill sat in the two GBP
books; the USDC-GBP ask filled at 09:48 and its exit at 10:06 (twin and LIVE the same trip), the bids between 17:35 and 21:35. Coinbase's
paper fills are the full €100; PR5's paper engine's was $21.79 because of the volume cap. That is a difference in depth
(Coinbase's touch is a tick wide, 0.3 – 1.3 bps, with 10,000 – 48,000 coins on it), not in the rule.

## 5. The engine follows its rules (hand checks)

`sql/interim.sql`, "BY HAND".

- **Entries:** for each of the 8, the order's last placement at the fill's price was found in `cb_quote_events`; the first print of
  that book after it went live (the next minute) strictly through the price was found in `cb_trades`. It is the print the engine
  recorded, in all 8 (`19475345`, `29081797`, `29086024`, `29086349`, `29086357`, `29086340`, `19483243`, `29094798`).
- **Exits:** the same for the 8 exits (`29086023`, `29088092` three times, `19482166`, `29095416`, `29095638`, `19483873`): each is
  the first print strictly through the exit price after the entry fill and after the exit order went live.
- **Size:** every fill is the full €100 (`usd` 100 in the event; the 10 % cap is far above it: the fill minutes' volumes run from
  €24,682 to €480,931, a cap of at least €2,468). The prints through each price in the fill's minute were 598 to 168,170 coins
  against a rung of about 112 coins, so by-size filling would fill every one of them too, and a strict-through fill needs no
  queue position (everything resting at a worse price than the print is filled).
- **The post-only refusals** (4, 10:43 → 14:34) are all the exit ask of the USDC-EUR bid rung held from 10:41, each "the market
  already printed at or above the ask": last prints at 0.8942, 0.8944, 0.8943 and 0.8946 (a sell at the ask) against asks at
  0.8941, 0.8941, 0.8941 and 0.8946 (`blocks`). The ask rested after the last refusal and filled at 16:16 (0.8961).
- **A conservative bias in the rule:** a resting ask fills on a print above it whatever the aggressor's side. The 08:06 USDT-EUR
  ask (0.89221) was filled by a *sell* print at 0.89224: a seller printing above our ask means the bid had already passed it, so a
  real ask would have been lifted earlier. The rule counts only the first print strictly through, so a paper fill can come later
  than a real one. That is the rule as frozen (PR5's too); it does not favour Coinbase.
- **Where it is more generous than PR5's twins:** the paper engine fills any through print with the whole rung (up to the volume
  cap); PR5's *realistic twin*, the comparison in bar 5, fills by the print's size and the venue's pennies. On these 8 the
  difference is nil (thousands of coins through against a rung of 112), but on a thin book it is not, and bar 5 compares the two
  styles. Worth a sentence in the 11-08 report.

## 6. Optimisations, ranked by value

In-sample figures come from `scripts/cbk.py` (`results/cbk.json`): PR5's frozen simulator on the venue screen's Coinbase minute bars,
£100 a rung, one change at a time. Its base arm reproduces `compare.json` (£192.95 / £143.96 / £232.79 / £315.24 a year over 12 months,
90 days, since 08-24, 28 days). All of it is exploratory, in sample, a candidate and no more.

| # | what | value | needs |
|---|---|---|---|
| 1 | **Fix and repair the minute record** (section 2) | decides whether bar 1 can pass at all | Davies' word on Deviation 2; push the code (auto-deploys); run the repair before 2026-10-21 23:01 UTC; a ledger line |
| 2 | **Keep PR5's paper engine's inputs running to 11-08** | the test is dark without them | a ledger line at the 10-21 review; else Coinbase fetches its own GBP/USD and hourly closes (a deviation) |
| 3 | **A weekend variant**: hold the last interbank value through a closure up to 60 h instead of going dark | in sample, +34 % to +47 %: £259 a year vs £193 (12 months), £211 vs £144 (90 d), £331 vs £233 (since 08-24), £439 vs £315 (28 d), i.e. 10.8 / 8.8 / 13.8 / 18.3 % on £2,400. Of 52 weekends in the last year 47 are positive, the median +£1.25, the worst −£3.67, the best +£7.11; the 755 trips entered in a closure made +£74.15, 120 of them stopped (stop P&L +£11.18, worst trip −£0.66). Max drawdown £6.38 against £5.69. The risk is the Sunday-open gap, which the 52 weekends include | a one-page pre-registration from `TEMPLATE-variant-prereg.md`; an engine arm in `cb_quotes.ts` (`xGbp` held up to 60 h) and its own state and tables (the twins are Revolut X executors); PR5-W (`2026-09-28-pr5-weekend-prereg.md`, Revolut X, reads 2026-11-25) asks the same question on 8 forward weekends and should be read beside it. Four weekends (three whole) fall inside the paper window if it starts before 2026-10-16 22:00 |
| 4 | **Rung offsets: leave them** | none: the frozen 0.1 / 0.2 / 0.3 % is the best of those tried. Tighter rungs fill far more and earn less: 0.05 / 0.10 / 0.15 % made 4.6 % (12 months; 2.3 % in 90 days), 0.03 / 0.06 / 0.10 % lost 4.1 %. Wider (0.15 / 0.30 / 0.45 %) made 7.1 % (8.0 % base) with 2.4 times fewer trips (1,192 vs 2,844) and fewer stops (30 vs 52): about the same money, a quieter book. Moving the fair by each book's median basis (+0.5 to +1.6 bps over the record) made 7.6 % | nothing to build |
| 5 | **Stop rewriting a day of Yahoo bars every minute** | `cb_quote_inputs` took 1,506,459 row updates against 1,465 inserts since the deploy (PR5's `agent_quote_inputs`: 1,502,831 against 1,703): 99.9 % HOT, so no size growth, but about 1.5 million tuple versions and their WAL on every lit day, on a 1 GB instance. Ledger item 9 already plans it for PR5's after 10-21 | write only bars newer than the stored newest minus three; the file is frozen, so after the reading or as a deviation |
| 6 | **Cheaper storage** | the Coinbase tables are 2 % of the database (34 MB of 1,713 MB, about +11 MB a day: trades 5.0, book levels 3.5, touch 1.7, minutes 1.0). Steady state about 360 MB (trades 50 over 10 days, levels 123 over 35, touch 60 over 35, minutes 125 over 120). `cb_touch` carries the first level of `cb_book_levels`, which has been recorded since 2026-10-10 02:52, and costs 60 MB and 4 of the 12 requests a minute; the 29 % dark minute rows are not needed by the replay (missing minutes read as dark); minutes could be kept 60 days after the reading. The database's growth is elsewhere (`pm_rw_minutes` 317 MB, `pm_lp_minutes` 201, `pm_view_books` 178) | optional; `cb_rec.ts` is frozen; do it after 11-08 |
| 7 | **A trade-id continuity check** in the 11-08 prepare step | the recorder says "no gap" and one print is missing (section 1) | the continuity query in `health.sql`, run at the wake; a backfill by `after=id+1&limit=1` if one appears in the window |
| 8 | **A queue-model study**: not yet | 476 entry-order lifetimes in the lit day: 9 saw a print through their price (the fills), 3 saw only a print at it (1,945 USDC-EUR coins, 15,015 USDT-EUR, 79 USDT-GBP) while a rung 7 ticks off the touch had about 470 coins ahead (USDC-GBP asks at 0.7580: 46,785 hundredths-of-coins, i.e. 468 coins, against a rung of 132). So a queue model could add a few fills (a quarter at most on this day), and the tighter rungs where queue place matters lose money even when filled by sweeps (#4). The books are recorded once a minute at :30 and cost 3.5 MB a day, so nothing is lost by waiting | revisit after 11-08 with 28 days of books; pre-register it then (one `sonnet-high` task) |
| 9 | **A live Coinbase path**: not yet | Coinbase earns 6 – 13 % a year on £2,216 (£130 – £290) and the companion note's split puts the first ~£1,000 on Revolut X; Coinbase is the venue that scales above that | after 11-08, if bar 1 – 5 pass: Davies confirms his account trades the four books incl. USDT-EUR and the EUR balance (the note's §5 gap), makes a trade-only key with no withdrawal (his, never printed), a read-only probe of it first, then an executor adapter for `quotes_live.ts`, which is Revolut X-shaped. None of it before the reading |

## 7. What this review did not do

- It did not run `replay.py` on the whole stored window: the stored record cannot be replayed (section 2), and the repaired export
  was built for the first lit day only, from the prints (the engine's rungs start flat there, so the replay starts where the engine
  did).
- It did not read the Edge function logs (the logs tool was not usable here), the page as served, or Yahoo's EUR/USD against
  Coinbase's own EUR conversion.
- The Revolut X twins' and LIVE's P&L are worked out from their filled orders (two buys and sells each); variant-3's is not.
  Their open positions are not marked.
- It did not look into two oddities outside Coinbase: the twins' two USDT-GBP bids show a 0.13-coin fill at an average price of
  0.8296 against a limit of 0.7549 (a £0.10 partial fill rounded to £0.11 by the simulated venue's pennies, `revx_sim.ts`; about
  £0.01), and the 17:11 stall of the whole minute job.
- The cbk arms are in sample and share the venue screen's own simplifications (minute bars, the touch read once on 2026-10-09). A
  forward test is the only evidence that counts.
