# Pre-registration DRAW-X: DRAWBASE, unchanged, on four leagues it has never seen

Written 2026-09-26 (UTC), before any price of these four leagues' matches was looked at and before any draw rate of
theirs was computed. Frozen by the commit that adds this file. Nothing below may change after it, and any deviation is
reported as a deviation. It is research on public data: every read is a keyless GET, nothing is placed, and nothing
that runs changes.

## Why

fp5's DRAWBASE bought the Premier League draw an hour before kickoff whenever the league's draw rate so far cleared
the screen price plus one tick. Out of sample (January to September 2026) it made **+$361.59 on 100 trades**, above its
null's 95th percentile (+$322.06). It failed two of its six conditions: the halves (+$415.62 on 90 trades to May,
−$54.03 on 10 from August) and the month cap (January held 56 % of the profit). In sample (2025) it lost $102.84 on 58.
The fp5 review (`2026-09-26-fp5-review.md`) reads the profit as one season: in 2026 Premier League draws came 32–33 %
of the time against a price of about 24.5¢, and the reviewer puts 2025 at 22.6 %.

**The hypothesis.** Polymarket's pre-match draw prices are too low. Buying the draw about an hour before kickoff, as
DRAWBASE does, makes money across leagues, because the draw is the outcome retail bettors under-back. If the Premier
League result was one season's draw rate, it will not show on La Liga, the Bundesliga, Ligue 1 and Serie A.

This is the only hypothesis of this round, so nothing is corrected for multiple tests (Holm with one test is the plain
5 % level). The Premier League is not part of the test: it is where the hypothesis came from.

## What was seen before the freeze (disclosed)

* DRAWBASE's pre-registration, the ELO pre-registration it inherits, its scripts, its committed input and its result,
  on fp5's Polymarket branch (commit `31250cab`, not merged); the fp5 review on `main`.
* DRAWBASE re-run on its committed input: byte-identical to its result (sha256 `07df6a9f…af8c8`). From that Premier
  League data, already published: 171 of 410 matches selected (41.7 %); 158 of those filled (92.4 %), 13 under the $2
  minimum; fill prices averaging 21.0¢ (quartiles 20.0, 22.0 and 23.0¢); a median 43 taker prints in the hour on the
  draws it selected. Gamma's listing of its series (10188) shows five of its events with an `endDate` that is not
  their `startTime`. One of them was traded: Manchester City v Crystal Palace, listed for 21 March 2026 and played on
  13 May, bought on 21 March, −$10.23.
* For the four leagues, all on 2026-09-26:
  * Gamma's listing of every closed event of the four series: slugs, titles, `startTime`, `endDate`, the markets'
    questions, token and condition ids, `gameStartTime`, fee fields and tick sizes. The same pages carry each market's
    final `outcomePrices`, `lastTradePrice`, best bid and ask and volumes. They were stored with the rest; no script
    read, printed or counted them.
  * football-data.co.uk's `SP1`, `D1`, `F1` and `I1` files for 2024-25, 2025-26 and 2026-27: row counts, dates, kickoff
    times and club names, and each kickoff set against Gamma's `startTime`. No result was counted by outcome and no
    draw rate of these leagues was computed. The first six columns of four rows were printed to read their kickoff
    times; the sixth is the home side's goals.
  * An availability census of all 1,574 events. For each: how many one-minute points the CLOB's price history holds in
    the 30 minutes before the decision, and how old the last one is; how many taker prints the trade feed holds in the
    hour before kickoff, all sides together. No price, size or side was stored or printed. Before it, the same reads on
    twelve La Liga draws; on seven, the v1 and v2 trade feeds compared as sets of (second, side, outcome), again
    without prices.
  * A retention probe: the number of one-minute history points, not their values, on 42 markets of all kinds that
    ended between June 2023 and June 2026.
  * The power check below. It uses only those counts and the Premier League figures above.
* Nothing else of these markets was read for this study. fp4's FAV test (on `main`) bought any side priced 0.90–0.99 a
  day before its scheduled end, across Polymarket, which can include the NO side of some of these draws; its results
  were not opened. RW's paper engine, which may quote such markets, began on 2026-09-24, after the last match in the
  window.

## The rule: DRAWBASE, quoted

From fp5's Polymarket branch, commit `31250cab`. Paths are under `docs/agents/`; scripts are in
`backtests/polymarket/scripts/`.

* `reviews/2026-09-25-polymarket-fp5-prereg-drawbase.md`, lines 14–16: "The decision, the fee, the fill, the windows
  and the six conditions are ELO's. Eight finished matches are required. Buy the draw when that rate clears the shown
  price plus one tick."
* `reviews/2026-09-25-polymarket-fp5-prereg-elo.md`, lines 11–12: "The price is the Polymarket screen one hour before
  kickoff. Prints stop at kickoff." Lines 16–17: "the three full-time markets. Decision is kickoff minus one hour. A
  score is known three hours after its kickoff." Lines 20–21: "One side per match. Hold to settlement. Stake $10."
* `draw_test.py`, lines 20–21: the rule's `choose` is `score.draw_quote(ev, scores, minimum=8)`.
* `epl_score.py`, lines 467–476 (`draw_quote`): the fair value is the share of draws among all the score file's
  matches that kicked off at least four hours before this kickoff (`priors`, lines 107–109; `cutoff`, lines 99–100,
  with `KNOW` 3 h and `LEAD` 1 h, lines 15–16); at least eight of them. Lines 152–178 (`best_side`, `only_side`): trade
  when `fair − px − rate × px × (1 − px) > 0` at `px` = shown price + one tick.
* `epl_inputs.py`, lines 4–5: "Shown prices are the last history point in the 30 minutes before the decision, which is
  one hour before kickoff." `post_inputs.py`, lines 98–110 (`shown_yes`): the CLOB's `/prices-history` for the YES
  token, `fidelity` 1, from `t − 1800` to `t`, the last point at or before `t`.
* `epl_pick.py`, lines 49–54, and `post_inputs.py`, lines 113–140 (`prints_of`): the draw market's taker prints in
  `(kickoff − 1 h, kickoff]` from the data API's `/trades` (`takerOnly=true`), up to six pages of 500; a full sixth page
  marks the tape "incomplete".
* `post_test.py`, lines 179–202 (`walk_buys`): walk the prints in time order. A YES buy at `p`, or a NO sell at `q` read
  as a YES buy at `1 − q`, fills at `max(p, shown + tick)`, at most that print's size, and only while the edge above is
  still positive at that price, until $10 is spent (`STAKE`, line 17). Less than $2 filled (`MIN_FILL`, line 18) is no
  trade.
* `post_test.py`, lines 54–59, and `post_inputs.py`, lines 143–156 (`rate_of`): the taker fee is `rate × p × (1 − p)`
  a share. `rate` is 0 unless the market has `feesEnabled`; then it is its `feeSchedule.rate` (exponent 1).
* `post_test.py`, lines 307–316 (`pnl_of`): held to settlement. The payout is Gamma's `outcomePrices` (`epl_inputs.py`,
  lines 165–176: 0.99 or more pays 1, 0.01 or less pays 0, anything else removes the event).
* `post_test.py`, lines 361–377 (`null_p95`, seed 20260925, 10,000 draws), 333–343 (`peak_capital`) and 405–413 (the
  six conditions).

In plain words: an hour before kickoff, read the draw's screen price. If the league's draw rate so far beats that price
plus a tick plus the fee, buy up to $10 of the draw during the next hour. Buy only from other takers' prints, never
below the screen price plus a tick, and only while each price still leaves an edge. Hold to the result. At most one
trade a match.

**Fills as a taker gets them.** Every fill copies a real taker's print on the market: the same second, that print's
price or worse, never more than its size. The screen history is a trigger and a floor, never a fill price; on the
hourly crypto markets fp4 found it lagging the book by 12¢. No resting order is assumed. This is what the fp5 review
asks of a taker rule, so the fill is kept as it is.

## The two fixes, and nothing else

1. **Kickoff is the event's `startTime`, not its `endDate`.** DRAWBASE took `endDate` (`epl_inputs.py`, lines 99, 133
   and 147). On these four leagues 25 of the 1,574 events carry an `endDate` that is not their kickoff; 18 of them are
   Serie A matches from the last two rounds of 2025-26, all given an `endDate` of 13:00 UTC whatever their kickoff.
2. **A match not played at its scheduled kickoff is excluded.** An event is kept only if (a) its league's score file
   has a row for the same two clubs, in either order, whose Date and Time, read as Europe/London time, equal
   `startTime` to the minute; and (b) the draw market's `gameStartTime` equals `startTime` to the minute. A different
   `gameStartTime` means the match was moved after it was listed. Everything else is dropped: postponed or moved
   matches, playoff matches that are not league matches, and a row where the score file itself may be wrong. No
   attempt is made to decide which record is right.

DRAWBASE's input already charged fees through `rate_of`; the early scripts that ignored `feesEnabled` were other
rules'. DRAW-X keeps `rate_of`.

Everything else is DRAWBASE's code. The field its code calls `end` holds the verified kickoff. Its Premier League name
map is replaced by the four maps in appendix A. Its calendar windows (2025 in sample, 2026 out of sample) and its six
conditions are replaced by the window and the bar below; no part of them that remains is changed.

## Data

* **Series**, checked on Gamma's `/series/{id}` on 2026-09-26: 10193 La Liga (`la-liga-2025`), 10194 Bundesliga
  (`bundesliga-2025`), 10195 Ligue 1 (`ligue-1-2025`), 10203 Serie A (`serie-a-2025`).
* **Events**: every closed event of those series whose slug has six parts, `<prefix>-<club>-<club>-YYYY-MM-DD`, with the
  prefix `lal`, `bun`, `fl1` or `sea` (DRAWBASE's was `epl`); titled "<home> vs. <away>"; with DRAWBASE's three
  full-time markets ("Will <club> win on <date>?" for each club, "Will <home> vs. <away> end in a draw?"); and whose
  `startTime` falls in **[2025-08-01 00:00, 2026-09-21 00:00) UTC**. At the freeze that is 1,574 events (450, 343, 352
  and 429), the first on 2025-08-15 and the last on 2026-09-20, each with one draw market; their sorted slugs, one per
  line, hash to sha256 `90bc93a55b5d685c5c152694466eb7ce072ac63aa42312142378d709bdcbf1a4`. The series list nothing
  between 2026-09-21 and 2026-10-08. Their "more markets", half-time, exact-score, corners and player events are not
  read.
* **Scores**: `https://www.football-data.co.uk/mmz4281/{2425,2526,2627}/{SP1,D1,F1,I1}.csv`, the same three seasons as
  DRAWBASE's `E0` file. Only Date, Time, HomeTeam, AwayTeam, FTHG and FTAG are read; the odds columns never are. A
  match's draw rate uses its own league's file only. The times are UK times: on 1,557 of the 1,574 events they equal
  `startTime` to the minute.
* **Screen price, prints, fee, tick, payout and closing time**: read as DRAWBASE reads them (above). If `/trades` stops
  answering before the pull, the same hour's taker rows from `/v2/trades?condition=…&taker_only=true` are used instead,
  and that is reported as a deviation. On seven La Liga draws the two feeds held the same rows.

## What the data allow, measured before the freeze

* **Kickoffs.** 1,554 of the 1,574 events are kept: La Liga 441, Bundesliga 339, Ligue 1 347, Serie A 427. Their
  sorted slugs hash to sha256 `0b270caef14143f7aa64bf9785e2699d49562c3aa88b50ea1ee16a1fd82b0a42`. The 20 dropped are
  in appendix B: 14 with a Polymarket time that differs from the score file (by 20 minutes to 66 days), 3 moved after
  listing, and 3 playoff matches.
* **Screen history.** The CLOB serves one-minute points for all 1,554, back to the first match on 2025-08-15: 28 to 30
  points in each 30-minute window, the last a median 51 s and at most 71 s before the decision. The limit fp4
  recorded (one-minute buckets kept for at least seven days) belongs to the data API's `/v2/prices-history`, not to
  the CLOB endpoint DRAWBASE reads. That endpoint still served one-minute points on markets that ended as early as
  June 2023. The probe's gaps (12 of 42 markets with no point in the window) are no more common on the oldest markets
  than on 2025's.
* **Prints.** Every tape is complete: at most 293 taker prints in an hour, where 3,000 would make one incomplete. A
  median 18 taker prints of any kind in the hour (10th percentile 3, 90th 61), against 43 on the Premier League draws
  DRAWBASE selected. 22 of the 1,554 matches had none.
* **Fees** (`rate_of`; exponent 1 on every schedule): none on 1,066 matches (kickoffs up to 15 March 2026 in Serie A,
  22 March in La Liga, 5 April in the Bundesliga and Ligue 1); 0.0175 on 11 (Serie A, 16–22 March 2026); 0.03 on 277
  (April–May 2026); 0.05 on 200 (August–September 2026). The tick is 0.001 on every draw market.

## Power check, from event counts only

Usable matches by league and month (kickoff, UTC):

| League | 25-08 | 25-09 | 25-10 | 25-11 | 25-12 | 26-01 | 26-02 | 26-03 | 26-04 | 26-05 | 26-08 | 26-09 | Total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| La Liga | 31 | 39 | 31 | 38 | 32 | 43 | 36 | 32 | 40 | 50 | 30 | 39 | 441 |
| Bundesliga | 18 | 27 | 28 | 35 | 27 | 40 | 35 | 30 | 36 | 27 | 9 | 27 | 339 |
| Ligue 1 | 27 | 26 | 34 | 36 | 18 | 31 | 35 | 31 | 35 | 29 | 18 | 27 | 347 |
| Serie A | 19 | 30 | 40 | 39 | 37 | 58 | 40 | 36 | 38 | 40 | 20 | 30 | 427 |
| All | 95 | 122 | 133 | 148 | 114 | 172 | 146 | 129 | 149 | 146 | 77 | 123 | 1,554 |

**Expected trades.** At DRAWBASE's Premier League rates (41.7 % selected, 92.4 % of those filled) the four leagues give
about **599 trades**: La Liga 170, Bundesliga 131, Ligue 1 134, Serie A 165. How often these draws sit under their
league's running rate depends on prices that were not read: at 25 % selected the count is about 359, at 60 % about
862. These draws also trade less than the Premier League's, so the fill rate may be lower: at 70 % filled the central
count is about 454. At the Premier League's fill rate, fewer than 20.9 % selected leaves fewer than 300 trades, and
condition 1 fails.

**The smallest edge the bar can see.** Simulated, 1,000 runs a cell (seed 20260926). Each usable match is traded at
those rates; its fill price is drawn from DRAWBASE's 158 Premier League fills (mean 21.0¢); its fee is its own rate;
$10 a trade; the draw comes with probability fill price + `e`, with `e` in points of probability (5 points: a draw
bought at 21¢ comes 26 % of the time). The null's 95th percentile is taken by a Cornish–Fisher approximation of
DRAWBASE's null, which gives +$318.64 on DRAWBASE's own 100 trades against its exact +$322.06. At about 600 trades the
total must beat about **+$752, 12.6 % of the ~$5,990 staked**.

Pass rate of the whole bar (conditions 1–7 and 9; condition 8 never binds). In brackets, without condition 7.
Simulation error is about ±1.6 percentage points where the pass rate is near 50 %.

| edge `e` (points) | 25 % selected (~359 trades) | 41.7 % (~599) | 60 % (~862) |
|---:|---:|---:|---:|
| 0 | 0.7 % (3.5 %) | 0.5 % (2.4 %) | 0.4 % (3.3 %) |
| 2 | 5.8 % (16.6 %) | 6.4 % (22.0 %) | 13.4 % (30.9 %) |
| 3 | 12.1 % (29.3 %) | 18.6 % (42.9 %) | 30.2 % (55.2 %) |
| 4 | 23.0 % (44.7 %) | 38.0 % (64.6 %) | 54.5 % (77.1 %) |
| 5 | 36.0 % (60.6 %) | 59.7 % (80.2 %) | 78.1 % (90.4 %) |
| 6 | 51.6 % (73.8 %) | 75.4 % (91.1 %) | 91.6 % (96.5 %) |
| 8 | 77.8 % (90.5 %) | 96.4 % (99.3 %) | 99.4 % (99.8 %) |

At the central rate the bar has **80 % power at about 6.4 points** (a draw bought at 21¢ that comes 27.4 % of the time,
about +30 % a dollar), and 50 % power at about 4.6. Without condition 7: 80 % at about 5.0 points and 50 % at about
3.3. With about 454 trades it needs about 7.3 points for 80 %. For scale, DRAWBASE's Premier League 2026 was about +7.6
points (+36 % a dollar), which the bar would see about 95 % of the time; the fp5 review put a plausible football
mispricing at 1–4 points, which it sees at most 38 % of the time (6 % at 2 points). **A fail does not show that no
small edge exists. A pass needs an edge of about five points or more, present in at least three leagues.**

Two alternatives the bar must reject, simulated the same way at 41.7 %:

* The Premier League's pattern in all four leagues (−3.8 points in 2025, +7.7 in 2026): the bar passes 11.1 % of the
  time (15.4 % without condition 7). The halves catch most of it. The rest is the one-season risk that the paper test
  after a pass is for.
* +8 points in one league and none in the others: 2.8–3.9 % (16.0–21.9 % without condition 7).

## The null

DRAWBASE's `null_p95`, unchanged: keep every trade's cash (cost and fee); redraw its payout as 1 with probability equal
to its own average fill price, else 0; do it 10,000 times with `random.Random(20260925)`; read the sorted totals at
index 9,500.

It is sound for this test, and it is kept. Each trade is a different match, so the payouts are separate events and no
holds overlap. Each redraw is independent, as sampling with replacement would be. It gives each draw the chance that
was paid for it, which is at least the screen price plus a tick, so it is if anything harder to beat than a null at
the market's midpoint. It holds the trades fixed, which is right: which matches are traded depends only on what was
known before each decision.

Its blind spot is a shock that moves many matches at once, such as a league's season-wide draw rate: that is how the
Premier League result arose, and the independent redraw does not widen for it. Conditions 3, 4, 5 and 7 are there for
that.

## The bar (all of, over every trade in the window)

Trades are ordered by their first fill, then by slug, as DRAWBASE orders them. The total is the sum of DRAWBASE's
`pnl_of` over them.

1. **At least 300 trades.**
2. **Total > 0, and above the null's 95th percentile.**
3. **Positive in at least three of the four leagues.** A league with no trade is not positive.
4. **Positive in both halves, split by trade count**: the first ⌊N/2⌋ trades, and the rest.
5. **Not one month**: no calendar month (UTC, of the first fill) holds more than 40 % of the total, and the total
   without its best month is > 0 (DRAWBASE's condition 5).
6. **Stress > 0**: every fill one tick worse and every fee doubled (DRAWBASE's `pnl_of(c, 1, 2.0)`).
7. **Not one league** (added here): the trades of the three leagues other than the one with the largest total, taken
   together, are above their own null's 95th percentile. The same function, seed and number of draws, on those trades
   only; a tie for the largest total goes to the first of La Liga, Bundesliga, Ligue 1, Serie A. Why: with condition 3
   alone, an effect that lives in one league passes 16–22 % of the time, which is the Premier League failure again.
   This cuts it to 3–4 %. Its cost is shown above: 80 % power moves from about 5.0 to about 6.4 points.
8. **Worth money** (DRAWBASE's condition 6): the total × 365 / 416 (the window's days), over the peak capital (each
   trade's cost, from its first fill until its market closes), is more than 4 % a year. It is kept because DRAWBASE had
   it. With $10 trades almost any positive total passes it, and it says nothing about scale.
9. **Every tape complete** (DRAWBASE's `passes` requires it).

## Validity checks (a failure voids the run, which is then reported as void)

* **The code is DRAWBASE's.** The scorer's copies of DRAWBASE's functions print DRAWBASE's own pin
  (`D 0.25 88.560401`). Run on DRAWBASE's committed input, read from commit `31250cab`, they reproduce
  `drawbase_run.json` byte for byte (sha256 `07df6a9fd911e6a2748f86112a96acef9f08fd67aff6735ef534557d9e8af8c8`).
* **Determinism.** The scorer, run twice on the committed input, writes byte-identical output.
* **Fills read again.** Twenty trades drawn with `random.Random(20260926).sample`. Every fill is found again in
  `/v2/trades?condition=…` at its second: a YES buy at or below the fill price, or a NO sell at or above one minus it,
  of at least the fill's size. Every payout is read again from Gamma. The P&L recomputed from them agrees within
  $0.00001.
* **Payouts against results.** On every traded match the draw's payout agrees with the score file: a draw pays 1,
  anything else 0. A disagreement is listed, and the trade keeps Polymarket's payout, which is what the money would
  get. More than two disagreements void the run, because the matching would then be wrong.
* **The same matches.** The pull applies the kickoff rule to what Gamma and football-data serve on the day it runs.
  Every difference from the 1,554 kept here is listed with its reason, as a deviation.

## Descriptive, not part of the bar

Trades, wins, cost, fees and P&L by league, by month and by fee rate. How often the traded draws came, against their
average fill price, by league. Over all 1,554 matches, traded or not: the screen price in five-cent buckets against how
often the draw came. That table says whether the draws DRAWBASE skips look any different. It is not a test.

## What it cannot show

* **A small edge.** See the power check.
* **Whether draws in general are underpriced.** DRAWBASE buys only draws priced under the league's running rate. Those
  tend to be matches with a clear favourite, where a draw is less likely than the league average, and the league's
  rate is not a fair value for such a match. A pass says the market underprices those draws, not all draws.
* **More than one season.** The four leagues cover the same thirteen months as DRAWBASE's Premier League run: all of
  2025-26 and the first five weeks of 2026-27. A draw-rate shift common to European football in that season would look
  like an edge here too. The halves and the month cap catch most of that, not all of it (see above).
* **Scale.** $10 a trade against prints that did trade. More would move the fills.
* **Whether a real taker gets those fills.** A fill copies another taker's print and its size. It needs a program
  watching the book through the hour, and it assumes that program would have been first.
* **Whether the account may trade.**

## What follows

**A pass leads to a paper test only.** There is no order path for Polymarket in this repository, and opening a
position is allowed only from Ireland, only while Davies' attestation that he is there is current (`eu-west-1` only;
reference §2d). Reference §3.33 also records that Polymarket's Terms of Use name Ireland; that is settled before any
order path is built, not here. The paper test would need its own pre-registration: the same rule, forward, on matches
not yet played.

A fail closes DRAWBASE: its Premier League profit was one season's or one league's, and it is reported as such.

## What phase 2 writes

Scripts in `docs/agents/backtests/polymarket/drawx/`: the pull, the scorer with its self-check, and the check that
reads fills again. They are written, and their sha256 taken, before the pull. The input goes to `drawx/inputs/`,
gzipped, holding only what the scorer reads, 20 MB at most. The result is `drawx/drawx.json`, which records the sha256
of this file, of the input and of every script. The write-up is `reviews/2026-09-26-draw-x-study.md`: the verdict on
each condition, the numbers, and every deviation from this text.

## Appendix A: the club names

Each line gives football-data's name, then Polymarket's spellings. A title name not listed is not a match, and the
questions' club names must map to the title's two clubs.

**La Liga (`SP1`).** Alaves: Alaves, Deportivo Alavés · Ath Bilbao: Athletic Club · Ath Madrid: Atletico Madrid, Club
Atlético de Madrid · Barcelona: Barcelona, FC Barcelona · Betis: Real Betis, Real Betis Balompié · Celta: Celta Vigo,
RC Celta de Vigo · Elche: Elche CF · Espanol: Espanyol, RCD Espanyol de Barcelona · Getafe: Getafe, Getafe CF ·
Girona: Girona, Girona FC · La Coruna: RC Deportivo A Coruña · Levante: Levante UD · Malaga: Málaga CF · Mallorca:
Mallorca, RCD Mallorca · Osasuna: CA Osasuna, Osasuna · Oviedo: Real Oviedo · Real Madrid: Real Madrid, Real Madrid CF ·
Santander: Real Racing Club · Sevilla: Sevilla, Sevilla FC · Sociedad: Real Sociedad, Real Sociedad de Fútbol ·
Valencia: Valencia, Valencia CF · Vallecano: Rayo Vallecano, Rayo Vallecano de Madrid · Villarreal: Villarreal,
Villarreal CF.

**Bundesliga (`D1`).** Augsburg: FC Augsburg · Bayern Munich: Bayern München, FC Bayern München · Dortmund: Borussia
Dortmund, BV Borussia 09 Dortmund · Ein Frankfurt: Eintracht Frankfurt · Elversberg: SV 07 Elversberg · FC Koln:
1\. FC Köln · Freiburg: SC Freiburg · Hamburg: Hamburger SV · Heidenheim: 1. FC Heidenheim, 1. FC Heidenheim 1846 ·
Hoffenheim: 1899 Hoffenheim, TSG 1899 Hoffenheim · Leverkusen: Bayer Leverkusen, Bayer 04 Leverkusen · M'gladbach:
Borussia Mönchengladbach · Mainz: FSV Mainz 05, 1. FSV Mainz 05 · Paderborn: Paderborn, SC Paderborn 07 · RB Leipzig:
RB Leipzig · Schalke 04: FC Schalke 04 · St Pauli: FC St. Pauli, FC St. Pauli 1910 · Stuttgart: VfB Stuttgart · Union
Berlin: Union Berlin, 1. FC Union Berlin · Werder Bremen: Werder Bremen, SV Werder Bremen · Wolfsburg: Wolfsburg, VfL
Wolfsburg.

**Ligue 1 (`F1`).** Angers: Angers SCO · Auxerre: AJ Auxerre · Brest: Stade Brestois 29 · Le Havre: Le Havre AC · Le
Mans: Le Mans FC · Lens: Racing Club de Lens · Lille: Lille OSC · Lorient: FC Lorient · Lyon: Olympique Lyonnais ·
Marseille: Olympique de Marseille · Metz: FC Metz · Monaco: AS Monaco FC · Nantes: FC Nantes · Nice: Nice, OGC Nice ·
Paris FC: Paris FC · Paris SG: Paris Saint-Germain FC · Rennes: Stade Rennais FC 1901 · St Etienne: Saint-Etienne ·
Strasbourg: RC Strasbourg Alsace · Toulouse: Toulouse FC · Troyes: ES Troyes AC.

**Serie A (`I1`).** Atalanta: Atalanta, Atalanta BC · Bologna: Bologna, Bologna FC 1909 · Cagliari: Cagliari, Cagliari
Calcio · Como: Como, Como 1907 · Cremonese: US Cremonese · Fiorentina: Fiorentina, ACF Fiorentina · Frosinone:
Frosinone Calcio · Genoa: Genoa, Genoa CFC · Inter: Inter, FC Internazionale Milano · Juventus: Juventus, Juventus FC ·
Lazio: Lazio, SS Lazio · Lecce: Lecce, US Lecce · Milan: AC Milan · Monza: AC Monza · Napoli: Napoli, SSC Napoli ·
Parma: Parma, Parma Calcio 1913 · Pisa: Pisa SC · Roma: AS Roma · Sassuolo: US Sassuolo Calcio · Torino: Torino,
Torino FC · Udinese: Udinese, Udinese Calcio · Venezia: Venezia FC · Verona: Verona, Hellas Verona FC.

## Appendix B: the 20 events dropped at the freeze

Times are UTC. "Listed" is Polymarket's `startTime`; "played" is the score file's kickoff.

* **La Liga (9).** `lal-val-ovi-2025-09-29`: listed 29 Sep 19:00, played 30 Sep 18:00 (a second event,
  `lal-val-ovi-2025-09-30`, has the right time and is kept). `lal-lev-vil-2025-12-14`: listed 14 Dec, played 18 Feb.
  `lal-sev-gir-2026-02-07`: listed 7 Feb 17:30, played 8 Feb 15:15. `lal-ray-mad-2026-02-14`: listed 14 Feb, played
  15 Feb. `lal-get-vil-2026-02-15`: listed 15 Feb, played 14 Feb. `lal-osa-mal-2026-03-06`: listed 6 Mar 20:00, played
  7 Mar 13:00. `lal-get-bet-2026-03-07`: listed 7 Mar 13:00, played 8 Mar 15:15. `lal-ray-ovi-2026-02-07`: moved to
  4 Mar; the event's time was updated, the market's `gameStartTime` still says 7 Feb. `lal-cel-rea-2026-03-07`: moved
  to 6 Mar 20:00; the market still says 7 Mar.
* **Bundesliga (4).** `bun-pau-lei-2026-01-10` and `bun-wer-hof-2026-01-10`: listed 10 Jan, played 27 Jan.
  `bun-hsv-b04-2026-01-13`: moved to 4 Mar; the market still says 13 Jan. `bun-pad-wol-2026-05-25`: a relegation
  playoff, not a league match (no score row).
* **Ligue 1 (5).** `fl1-olm-psg-2025-09-21`: listed 21 Sep, postponed. `fl1-olm-psg-2025-09-22`: Polymarket 18:00, the
  score file 21:00 (22:00 UK time); one of the two records is wrong. `fl1-asm-nan-2026-02-13`: Polymarket 19:45, the
  score file 20:05. `fl1-se-nic-2026-05-26` and `fl1-nic-se-2026-05-29`: the promotion and relegation playoff, not
  league matches.
* **Serie A (2).** `sea-lec-ata-2026-04-04`: listed 4 Apr, played 6 Apr. `sea-udi-com-2026-04-06`: Polymarket 13:00,
  the score file 10:30, so the decision would have fallen during the match.
