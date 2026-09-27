# VIEWS phase 1: Polymarket's YouTube view-count markets on history (2026-09-27)

Davies asked on 2026-09-27 whether the view-count strategy looks promising. This is phase 1 of finding out. It
covers every closed event under Gamma's YouTube tag (146), with the prints and minute book midpoints of the months
it explores, and the traders' own comments. Everything was read keylessly from Polymarket's public APIs. Nothing was
placed, no key was used, and YouTube itself was not read. The scripts, the committed inputs and every result are in
`backtests/views/`, listed with their hashes in `MANIFEST.json`. `scripts/run_all.py` re-runs every analysis from
the committed files, twice; the two runs are byte-identical.

**The answer, on what history can show: not promising as money.**

* **The price is sharp near the deadline.** On 92 exploration deadlines the winning bracket's midpoint had a median
  of 0.9625 six hours before the deadline and 0.9985 an hour before. Fifteen minutes before, the favourite was the
  winner on all 92; five minutes before, on 91.
* **Close calls are what is left.** Eight of the 92 deadlines (8.7 %) still had the winner under 0.95 fifteen
  minutes before.
* **After the count is fixed, the stale side is small and in one or two deadlines.** PMLATE's own fill, acting 1 s
  after the deadline, makes +$253.59 over 547 days. One date is 66.5 % of that, and that date was a contested
  resolution. Today's markets are nine times thinner per event than the months this was measured on.
* **Much of what is left late is resolution risk.** The counter freezes, jumps on YouTube's "sync" and loses
  removed bot views. Traders organise botting in close calls. The rules have named the wrong video and the wrong
  window, and one contested day-1 market closed five hours late.
* **No historical test is worth pre-registering.** The held-out months hold 64 deadlines, and a post-deadline taker
  would fill on about 7 of them. The fp5 bar needs at least 25 dates.
* **The forward record should run four to six weeks as a measurement, not as a test.** A formal forward test would
  need 15 to 30 weeks. At today's depth even a winner would make tens of dollars a month.

## What was read, and what was held out

* **Gamma's record of all 353 closed tag-146 events**, read on 2026-09-27: the rules, the brackets, the winners,
  volumes, fee schedules and UMA status histories (`inputs/universe.json.gz`).
* **The split was decided from that record before any price or print was read** (`inputs/split.json`, rule in
  `scripts/split.py`):
  * **Exploration: 125 view events** whose first market closed before 2026-06-01 02:00 UTC (deadlines 2023-12 →
    2026-05).
  * **Held out: 77 events**, deadlines 2026-06-01 → 2026-09-26. No price, print or book of theirs was requested by
    any script.
* **Read for exploration:**
  * 566,065 prints (`/v2/trades?event_id=`, every page cache-busted, each walk complete; one event's walk matched a
    per-market walk print for print);
  * the CLOB's minute midpoints (`/prices-history`, fidelity 1) from T − 7 h to T + 3 h for the 108 events with an
    estimated deadline;
  * the 14,576 public comments created before 2026-06-01. The 775 created later were dropped as they arrived,
    unread.
* **Disclosed:**
  * The held-out events' Gamma metadata (winners, brackets, volumes) was read for the universe table and the power
    check.
  * The brief quoted RW's −$25.43 of stress on MrBeast's September week-1 market, and the recorder's first 24
    minutes.
  * One comment of 2026-09-25 was printed while probing the comments endpoint.
  * main's reference §3.39 (the speed study, `c4aca991`) was read for the data API's print lag.

## 1. The universe

**353 closed events** carry the YouTube tag:

* **202 are view counts:** 201 count a video at its posting time + N hours, and 1 counts at a clock time.
* **151 are other kinds:** 19 on channel totals, 7 on "any video by a date", 4 on YouTube's music charts, and 121
  others (mentions, livestreams, challenges).

The per-event table (video, window, T, how T was dated, brackets, winner, volume, fees, UMA flags, split) is
`results/universe_table.json`.

| | events | volume (Gamma) |
|---|---:|---:|
| MrBeast | 164 | $99.3M |
| MrBeast Gaming | 9 | $0.9M |
| NFL (Bad Bunny's halftime show) | 3 | $5.4M |
| Rockstar Games (GTA VI) | 4 | $2.7M |
| New Heights, Stokes Twins, Sidemen, PewDiePie, Taylor Swift, Dream, MKBHD, Sabrina Carpenter | 22 | $4.7M |
| **all view events** | **202** | **$113.0M** |

* **Windows:** day 1 on 59 events, days 2–6 on 84, week 1 on 58, a clock time on 1.
  * The day-2 to day-6 events began in February 2026. Each MrBeast video now carries seven deadlines, one a day,
    plus "higher / lower / smaller strikes" twins.
* **Brackets:** a median of 7 per event.
  * MrBeast's narrowest bracket is 5M on day 1 (34 of 40 events), mostly 2–3M on day 2, mostly 1M on days 3–6 (2M
    on some day 3s, 0.5M on some day 5s and 6s), and 10M on week 1 (27 of 44; 0.5–1M on the smaller-strikes twins)
    (`universe_table.json`'s summary).
  * The rules say "if the reported value falls exactly between two brackets, … the higher range bracket".
* **Fees:** none on these markets until mid-April 2026. Since then the taker pays 0.05 × p(1 − p) a share
  (exponent 1, taker only, 92 events), 0.04 on one event, and nothing on the other 109.
* **Depth:** MrBeast and Gaming view volume peaked at $13–15M a month (2025-11, 2026-02). It has been
  $0.8–2.9M a month since June 2026, a mean of $104k an event in the held-out months against $935k in the
  exploration months (`results/power.json`; Gamma reports no volume on some 2026-03 events).
* **Deadlines:** since late 2025 MrBeast has mostly posted every other Saturday, so a week alternates one deadline
  (day 1) with six (days 2–6 and week 1). Gaming adds its own. That is 6–7 a week lately and 4.5 on average over the
  last eight ISO weeks.

**The deadline T is estimated everywhere; no T in this study is exact.**

* **MrBeast posts at 12:00 ET.** Summed over the 28 day-1 markets that dated a posting, prints ran 8.3 a minute
  from 11:50 to 11:59 ET, then 283 at 12:00 and 541 at 12:01 (`results/noon_check.json`). A trader on 2026-02-22:
  "MrBeast videos are always posted at 12:00:01 ET".
* **So P is taken as 12:00:10 ET on the posting day, and T = P + the window.** That is ±15 s if the upload came at
  12:00:00–12:00:25. The probe read MrBeast's two newest long videos at 16:00:01 UTC and Gaming's newest at 16:00:04
  (reference §6).
* **The posting day is the one after whose noon the day-1 market's prints jump most.** Every event created after its
  video went up takes the channel's latest posting before its creation (`scripts/posting.py`).
* **The check that needs no price:** UMA's liveness is two hours. Every high-confidence deadline's winning market
  closed 2.06–9.50 h after T (median 3.29 h; 2.76 h since April 2026), which fits a proposal minutes after T.
* **Confidence:** 92 exploration deadlines are high.
  * 16 are low: nine dated by a trading burst (other channels, and one MrBeast day 1 whose market woke mid-afternoon),
    and the seven events of the 2025-12-06, 2026-01-07 and 2026-05-30 videos, whose day-1 markets did not wake at
    noon.
  * 17 are undated: small channels with no burst.
  * Only the 92 enter any table where minutes matter.
* **Held-out T** comes from Gamma's metadata alone.

## 2. Where the price goes near T

For each deadline, `results/near_t.json` gives:

* the winner's book midpoint at each instant (the CLOB's minute history; on stable books it equals `/midpoint`,
  `results/probe_mid.txt`);
* whether the favourite (the highest midpoint) is the winner;
* the stale side in the following 15 minutes. The book is not archived, so this is what traded against it: a
  loser's YES sold to a resting bid, or the winner's YES bought from a resting ask, at an edge of at least 1¢.

| 92 deadlines | winner's mid, median | p25 | p10 | winner < 0.8 | < 0.95 | < 0.99 | favourite wins | stale edge in the next 15 min (deadlines) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| T − 6 h | 0.9625 | 0.835 | 0.400 | 22.8 % | 47.8 % | 58.7 % | 88.0 % | $18,062 (51) |
| T − 1 h | 0.9985 | 0.9935 | 0.915 | 8.7 % | 14.1 % | 22.8 % | 96.7 % | $23,531 (21) |
| T − 15 min | 0.9995 | 0.996 | 0.975 | 1.1 % | 8.7 % | 16.3 % | 100 % | $17,520 (14) |
| T − 5 min | 0.9995 | 0.998 | 0.991 | 2.2 % | 3.3 % | 8.7 % | 98.9 % | $10,039 (9) |
| T | 0.9995 | 0.9995 | 0.9965 | 1.1 % | 1.1 % | 5.4 % | 100 % | $2,249 (4) |
| T + 2 min | 0.9995 | 0.9995 | 0.9985 | 0 | 1.1 % | 3.3 % | 100 % | $55 (3) |
| T + 5 min | 0.9995 | 0.9995 | 0.9995 | 0 | 0 | 3.3 % | 100 % | $23 (2) |
| T + 15 min | 0.9995 | 0.9995 | 0.9995 | 0 | 0 | 0 | 100 % | $7 (1) |

Before T, "stale" is hindsight: it counts trades against a winner nobody yet knew. After T it is not.

* **When the market has it.** The winner stayed at or above 0.95 from a median of 5.2 h before T, and at or above
  0.99 from 2.3 h before.
  * At 0.95: 9.9 % of deadlines were decided in the last 15 minutes, 4.4 % in the last 5, and 2.2 % after T.
* **Close calls** (the winner under 0.95 at T − 15 min): 8 of 92.
  * By window: day 1 4 of 28, days 2–6 3 of 38, week 1 0 of 25, the clock market 1 of 1.
* **Calibration** (`results/calibration.json`, 636 markets): no bias a rule could use.
  * One bin stands out: at T − 6 h the 0.95–0.98 bin paid 7 of 9 (z −3.0). The bins beside it pay more than their
    price, and one bin that far out is what chance gives across the 54 populated bins.
  * At T − 1 h the ≥ 0.98 bin paid 74 of 74, at a mean midpoint of 0.9973.
  * Brier: 0.0233 at T − 6 h, 0.0070 at T − 1 h, 0.00045 at T − 15 min.

## 3. The PMLATE question for views

### After the count is fixed

The count at T is the last batch the API published before it, up to five minutes early. History has no counter, so
the winner stands in for the count at T. That is exact where the resolution followed the counter, and the cases
where it may not are this section's third part.

* **What was left after T** (`results/stale_late.json`): $3,271.40 of gross stale-side edge on 179 prints, in 10
  of the 92 deadlines, over 547 days.
* **How fast it went:** still untaken at T + 2 s 95.2 %, + 10 s 92.8 %, + 30 s 52.1 %, + 60 s 37.9 %,
  + 120 s 32.9 %, + 300 s 31.8 %.
  * The third left after five minutes is mostly one contested resolution (below).
  * The data API stamps a print about 2 s after its match (reference §3.39).
* **PMLATE's fill** (USLATE's frozen model: half of each later stale print at its own price, $100 a market, each
  market's fee, held to the payout):

| act at | P&L | fills | deadlines | best date's share |
|---|---:|---:|---:|---:|
| T + 1 s | +$253.59 | 31 | 10 | 66.5 % (2026-03-08) |
| T + 10 s | +$241.63 | 29 | 9 | 69.8 % |
| T + 30 s | +$220.27 | 32 | 9 | 76.5 % |
| T + 60 s | +$200.50 | 27 | 9 | 84.1 % |
| T + 1 s, uncapped | +$1,635.70 | 179 | 10 | 68.2 % (one deadline) |

  * The T + 1 s arm ties up a $400 peak.
  * Without 2026-03-08 it makes +$85.00.
* **Before T.** The last five minutes before T are where the last batch lands. They carried $7,807.57 of
  hindsight-stale edge on 8 deadlines, 94 % of it in one.
  * A reader who knew the final count five minutes early is a bound, not a rule: the count is fixed only after
    the last batch.
  * That bound makes +$1,544.91 at the $100 cap and +$5,538.96 uncapped, 84 % and 86 % from the same deadline.

### The one real flip: day 5 of the 2026-04-04 video, 2026-04-09

The brackets were 70–71M, which won, and 71–72M.

* **Before T** (30-second bins in `results/timeline_2026-04-09_day5.txt`). Ten minutes before T the winner traded at
  0.08–0.33. From T − 150 s both brackets traded heavily, and the winner went from 0.05 to 0.64 inside a minute. That
  may have been the last batch.
* **The flip.** The winner last traded under 0.5 at T + 17 s (`results/flips.json`).
* **The race after the flip:**
  * of its stale side, 0.6 % went in 2 s, 18 % in 10 s, 57 % in 15 s, 78 % in 30 s and 92 % in 60 s;
  * PMLATE's fill from flip + 1 s makes +$46.93, from + 5 s +$30.66, and from + 30 s +$14.30.
* **What traders wrote that afternoon** (`results/comments_evidence.json`):
  * at 14:38 UTC, "we can buy bot views to 71-72";
  * after T, "I have clear screenshots of the counter with timestamps", and "Nobody's disputing this. Do you really
    want to lose an additional $750?"

In the seven other close calls the winner never traded under 0.5 in the half hour around T. It settled above 0.95
between 3 s and 14 minutes before T.

### Resolution risk

**UMA's record.** 7 markets were disputed, all of them the lowest bracket ("<25M", "<60M", "<70M", "<30M", "<50M").

* Each went proposed → disputed → proposed.
* The rules say a market "may not resolve until the … hours are complete", so an early "No" on a bracket the count
  had already passed is disputed and proposed again. A trader asked on 2025-11-23: "why does less than 25 keep
  getting disputed".
* The five in dated deadlines were priced at 0.0005–0.001 from an hour before T, and paid nothing.

**Contested closes** (`results/resolution.json`):

* **2026-03-08, day 1 of the 03-07 video.** 25–30M and 30–35M resolved 5.2 h after the other brackets. From 7.4 h
  after T, 19 stale prints worth ≥ 5¢ traded, $645.49 of gross edge, with the winner's YES as low as 0.25.
  * Traders had argued all day that a YouTube "sync" could add millions: "it can go up with millions after the
    SYNC. I learned this by mistake in the past".
  * It resolved on the count at T, and that one deadline is 66.5 % of the post-T rule above.
* **2026-04-05** (day 1): the winner and "<25M" resolved 6.5 h after the rest.
* **2026-03-28** (week 1): the winner resolved 3.1 h after the rest.

**The rules' own errors:**

* "I Built 10 Schools" day 1 (2026-02-22) counted "the first 48 hours" in its rules and "day 1" in its title. Its
  winner closed 28.5 h after the posting, so it resolved on 24 hours.
* The 2026-03-21 video's day-3 and day-4 events named its title but linked the 03-07 video. They resolved on the
  03-21 video; their winners fit its day-2 53–56M and day-5 75–76M.

**The counter itself.** Of the 14,576 comments before June 2026:

* 22 describe the five-minute updates.
* 32 describe freezes: "counter is frozen due to bot checking"; "View freeze confirmed" three minutes before a close
  call's deadline; "Why the views still stuck on 41.9M?".
* 15 describe "sync" jumps.
* About 880 mention bots: organised botting near deadlines, and YouTube removing views.
* 36 ask what evidence a resolution rests on: "Which website is UMA using for the view count … at exactly 24
  hours?", and "A archive link at or after the timer ran out? Or API call at exactly the time?".
* 43 name API or live-counter tools: "I made a lil analyser … that pulls views from the YouTube API … every 5
  mins"; "I use my tool … 15 second per time".

**What history cannot say** is how often the resolution differs from the API's count at T. The resolution source is
the video page's counter as someone captured it, and a script may not read the page. The forward record measures the
agreement directly: the API's last batch before T against the resolved bracket, on every deadline.

## 4. Before T: can a trajectory beat the market?

**History lacks the one input a trajectory rule needs.**

* The Data API gives only the current count, and nobody archives the counter. The only historical counts are
  traders' comments.
* Third-party trackers (ViewStats, Social Blade) would need an account or scraping. Both are outside this study.
* So a trajectory rule can be tested only forward, on the recorder's data.

What history does say is against it. The market is calibrated at every horizon measured, the favourite wins 88 %
of the time six hours out and 97 % one hour out, and the traders already poll the API every 15 s to 5 minutes and
extrapolate.

**The forward test, if one is ever pre-registered.** It must be frozen before any of its deadlines is read.

* **It reads:**
  * `yt_video_reads` (each batch placed to the second);
  * `pm_view_books` at 1 s around each predicted batch;
  * the data API's prints, pulled after;
  * Gamma's results and fees;
  * T = the recorder's `published_at` + the window.
* **The model, frozen in advance:**
  * at each batch, the count at T = the current count + the last hour's batch increments, carried forward by the
    decay the earlier recorded videos of the same channel and window show;
  * its error distribution from those videos, rolled forward;
  * the bracket probabilities from both.
  * A freeze (no views change over two predicted batches while likes move) widens the error by the jumps seen after
    earlier freezes.
* **It acts 1 s after each batch lands:**
  * it buys a bracket whose probability beats the recorded ask + fee + 3¢ ($25 a decision, $100 a market);
  * it fills on later prints at or below that price, half each, under the fp5 rules;
  * the nulls are a calibration null and a date bootstrap, with Holm over the family.
* **Power** (`results/power.json`, at 4.5 deadlines a week and a one-sided z of 2.5):

| mean ÷ s.d. of P&L per deadline | deadlines needed | weeks |
|---|---:|---:|
| 0.5 | 25 | 5.6 |
| 0.3 | 70 | 15.6 |
| 0.2 | 157 | 34.9 |
| 0.1 | 625 | 138.9 |

  Against a calibrated market with API-driven competitors, 0.1–0.2 is the honest prior. That is not decidable in any
  horizon worth running, so the test is not pre-registered.
* **The last-batch taker is the variant that follows from §3.** It takes the stale side 1 s after the last batch
  before T, on the bracket that batch fixes.
  * Close calls come at 0.39 a week, so 6 take 15.3 weeks and 12 take 30.7 weeks.
  * History, at the $100 cap: +$62.07 at T + 1 s on the one close call that flipped after T, and nothing on the
    other seven. The five-minute bound gives $1,295.39 on that one, $46.31 on another and under $4 on the rest.
  * The measurement below decides whether it earns a pre-registration.

## 5. The recorder

**±15 s around each predicted batch fits for the hours before a deadline, if the phase holds.** Today's 16:00 UTC
window (MrBeast Gaming day 1) should measure the jitter of the batch landings. ±15 s is enough if the jitter's p99
stays under about 10 s. What is missing:

1. **Read every second from T − 6 min to T + 6 min, not T − 15 to T + 3.**
   * The last batch lands anywhere in the five minutes before T.
   * The first batch after T lands up to five minutes after it. That batch shows whether the count jumped right
     after T, which is the "sync" a resolution argues over.
   * The window ending at T + 3 min misses that batch about 40 % of the time.
2. **Freezes.** When a predicted batch brings no views change while likes and comments move, flag a freeze and read
   continuously until the next change, if it is inside the last hour. Decreases (removed views) are already in the
   change log and should be counted.
3. **The resolution.** After each T, read each view market's Gamma record once a minute until it closes:
   `umaResolutionStatus(es)`, `outcomePrices`, `closedTime`. That times the proposal and links it to the count at T.
   Gamma costs no YouTube quota.
4. **Premieres.** Add `liveStreamingDetails` (scheduled and actual start) to `yt_videos`. It comes in the same
   `videos.list` call at no extra unit. "Posted" may mean a premiere's start.
5. **Quota.** The ±6-minute window costs 721 units a deadline, and six hours of ±15 s brackets about 2,232.
   * MrBeast's and Gaming's deadlines can fall at the same 16:00 UTC on different phases, and their brackets do not
     share calls.
   * Such a day spends about 8,200 units with the minute reads, under the 9,000 guard but close to it. On those days
     narrow the brackets to ±10 s or to the last three hours.
6. **What cannot be recorded:** the page counter the rules name, and the proposer's evidence. The count at T
   against the resolved bracket is the only check, so every deadline's pair should be written down.

## 6. Recommendation

* **A historical test now: none.**
  * The post-deadline taker on the held-out months would see 64 deadlines, about 7 with a fill, and about $20
    scaled to today's volume. The fp5 bar needs fills on at least 25 dates with none over 40 %.
  * A price-only rule is ruled out by the calibration.
* **The forward record: four to six weeks as measurement, then decide.** It should measure:
  * the batch cadence and its jitter;
  * freezes, sync jumps and removed views;
  * the market's move in the seconds after each batch;
  * the stale side at batch + 1 s in close calls;
  * the count at T against every resolution.
  * A last-batch taker earns a forward pre-registration only if, in at least three close calls, the market lags a
    batch by more than 2 s and the stale side at + 1 s would have paid more than $20 a close call at the $100 cap.
    Even then its test runs 15 weeks or more.
* **Worth money at these markets' depth: no.** The best historical reading is tens of dollars a close call, one or
  two close calls a month, in markets nine times thinner per event than a year ago.
  * Resolution risk (freezes, syncs, bots, contested evidence) sits exactly in those close calls.
  * Traders already act within seconds.
  * The account may open a position only from Ireland under Davies' attestation, and no order path exists.

## What this cannot show

* **The book.** No one archives it. Prints stand in for it, so the stale side is what traded against the book, not
  what rested there, and nothing says whose order would have been first.
* **The exact deadline.** Every T is an estimate: ±15 s on the 92 high-confidence deadlines if MrBeast uploaded at
  12:00:00–12:00:25 ET, and unknown on the other 33 exploration events.
* **The timing of prints and midpoints.**
  * The data API's timestamps run about 2 s behind the match.
  * The minute midpoints are the book's midpoint once a minute, and they lag a book that is moving.
* **The count at T**, and so how often the resolution followed it.
* **Choosing from what was seen.** Every close call here is exploration. A rule shaped by them is tested only on
  deadlines that have not happened.

## Pre-registrations

**None.** Section 6 gives why: the held-out months cannot carry a test of any post-deadline rule under the fp5 bar,
the calibration leaves no price-only rule, and every forward rule needs 15–35 weeks for power. The measurement plan
in §5 and §6 needs no freeze, because it tests nothing. A forward pre-registration, if the measurement earns one, is
frozen on `main` before its first deadline.

## For the coordinator

* **Exact publish times** (`results/publish_times_needed.json`):
  * `videos.list` on the 25 video ids the events name: 1 unit, parts `snippet,contentDetails,liveStreamingDetails`;
  * the uploads playlists (`playlistItems.list`, 1 unit a page of 50) of @MrBeast (2025-03-21 → 2026-09-26), and of
    @MrBeastGaming, @StokesTwins, @Sidemen, @mkbhd, @PewDiePie, @dream, @newheightshow and @RockstarGames over their
    events' spans;
  * with those, every T becomes exact and the 33 low-confidence or undated exploration events join the tables.
* **Numbers to recompute:**
  * the near-T table (`near_t.py`);
  * the post-T time profile and the T + 1 s arm (`stale_late.py`);
  * the close-call count;
  * the power table (`power.py`).
* **Re-run:** `python3 docs/agents/backtests/views/scripts/run_all.py` from the repository root. `resolution.py`
  and `comments_evidence.py` also need the comment pulls in `$VIEWS_DATA`, hashed in `MANIFEST.json`.
