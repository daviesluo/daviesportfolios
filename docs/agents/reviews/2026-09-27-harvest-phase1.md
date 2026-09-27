# HARVEST phase 1: after a public source confirms the result, the other side of the book pays pennies, and the money is where the confirmation is contested (2026-09-27)

Davies, 2026-09-27 (translated): "Weren't we going to eat the orders that were placed to provide liquidity? It should
be harvesting after the result is essentially confirmed. How did it turn into competing with the market itself
head-on?" — "this applies to the temperature markets too" — "look at the latest Reward-quotes strategies and see
whether new markets can join the research".

So the one question here: **once a market's result is confirmed by a public, timestamped source anyone can read, how
much can be earned from the other side of the book, in which kinds of markets, and what does it cost?** Not
forecasting, not a race with private or keyed feeds.

Everything was read keylessly (Gamma, the data API, USGS, ALFRED/FRED, the Fed, the Bank of Canada, the Bank of
England, Polymarket's post tracker). Nothing was placed, no key was used, no Supabase connector or production table
was touched, and RW's tables were not read. Scripts, committed inputs and every result are in `backtests/harvest/`;
`scripts/run_all.py` re-runs every analysis twice from the committed files (byte-identical) and re-runs the five
confirmation steps offline from the committed source pulls (identical units).

## The answer

**Not worth money as a strategy, in any of the five categories; nothing is pre-registered.**

* **What a confirmed result leaves on the book is small, and most of it goes in seconds.**
  * After an economic release the stale side is taken 10–60 s after the release by the data API's stamps in March and
    April, and in the first 10 s by May (83 % of May's). Four per cent is left a minute after the release.
  * Where the result is uncontested, what trades later pays **0.1–0.5 ¢ a dollar**: a taker buying the confirmed
    winner at 99–99.9 ¢ (Mode A) makes 0.19–0.45 % a dollar, a maker bidding it (Mode B) 0.12–0.35 %.
* **The late money is where the market still doubts the source.** From C + 60 s, prints that value the confirmed winner
  under 95 ¢ earn 11–82 % a dollar, and a few market-days hold most of it:
  * the April FOMC dissent count: the statement listed four "against", the rules count one (96 % of the economic
    releases' Mode A pool at + 60 s);
  * New York's March 7 high: the reports' 49 °F, doubted for 21 hours (91 % of temperature's);
  * Elon Musk's March 3–10 week: 359 posts, the top of its bucket (53 % of the post counts');
  * a M6.5 off Japan on March 26, exactly at the 6.5 threshold (34 % of the earthquakes').
  * In each of these the source was right. Where it was not — a M5.7 that NEIC cut to 5.4 thirteen hours later,
    17 overturned mention proposals — the same flow loses nearly 100 % a dollar. That is the trap USLATE failed on,
    seen from the side that buys the source's outcome.
* **The uncontested harvest is a bet that traps are rarer than its margin.** At 0.12–0.45 % a dollar, one trap in
  roughly 220–830 markets erases it (a trap loses nearly the whole dollar).
  * The confirmed side lost on 1 of 136 earthquake markets, 31 of 4,700 temperature markets and, for a trader
    following UMA's first proposal, 17 of 4,133 mention markets (those 17 carried $52.3M of volume).
  * The economic releases (0 of 187) and the post counts (0 of 2,316 verifiable) had none. Those samples cannot show
    a rate below one in 60 and one in 770.
  * The post tracker's own history cannot reproduce 14 of 207 results (8 of 22 Trump weeks), and one week's first
    listing was closed without UMA, days before its window ended, at outcomes no count supports.
* **At a size this account could hold, it is dollars a day.** Take half of every late stale offer, $100 a market, from
  C + 60 s: $0.87–4.00 a day per category. A resting bid at 99 ¢: −$1.95 to +$3.04 a day. The ceiling for a maker
  first in the queue at every print, a tick better: $1.02–20.26 a day, and the $20.26 is 86 % one market-day.
* **Nothing clears the fp5 bar with the held-out months available.**
  * The one rule with a large z, FAST-A (take the stale side from the release + 3 s), is a race. The held-out months
    have about 14 release dates against the 25 the bar needs.
  * The mention rules are positive only with the disputed markets left out. Counted at their worst ($100 each), the
    17 overturned first proposals cost more than the rules made.

### Per category (exploration, 2026-03-01 → 05-31, 92 days)

"Pool" is every late print, whole, net of the market's taker fee and after traps: what one trader taking all of it
would have made (an upper bound; Mode A sees only what someone took, not what rested). "Rule" takes half of each Mode
A print at its own price with 1 ¢ or more of edge, $100 a market (USLATE's fill); "tick" is the Mode B ceiling above.

| | economic releases | post counts | mentions | earthquakes | temperature, after the day |
|---|---:|---:|---:|---:|---:|
| C from | publisher's release instant | tracker capture / window end + 10 min | UMA proposal (close − 2 h) | USGS as of C | local midnight + 10 min |
| events / markets | 28 / 187 | 191 / 2,316 | 175 / 4,104 | 21 / 136 | 765 / 4,700 |
| Mode A pool, a day, from C + 60 s | $218.59 | $42.74 | $60.33 | $45.90 | $172.12 |
| Mode A pool, a day, from C + 5 min | $169.91 | $35.32 | $49.82 | $30.75 | $163.89 |
| … without the top market-day (+60 s / +5 min) | $9.12 / $4.87 | — | — | — | $16.89 / $8.66 |
| Mode A rule, a day (+60 s / +5 min) | $4.00 / $1.08 | $3.07 / $2.90 | $2.57 / $2.22 | $1.20 / $0.90 | $0.87 / $0.29 |
| Mode B pool, a day, from C + 60 s | $363.99 | $111.71 | $166.48 | $33.98 | $368.04 |
| … without the top market-day (+60 s) | $42.74 | — | — | — | $54.76 |
| Mode B tick ceiling / bid at 0.99, a day | $20.26 / $0.12 | $1.39 / $0.23 | $15.01 / $3.04 | $1.02 / −$0.57 | $1.67 / −$1.95 |
| trap rate (markets) | 0 of 187 | 0 of 2,316 (+154 unverifiable) | 17 of 4,133 first proposals overturned | 1 of 136 | 31 of 4,700 |
| trap cost in the pools, from C | $0 | $0 | not measurable | −$456 A, −$950 B | −$8 A, −$62 B |
| capital lock, median C → close | 3.4 h | 3.2 h | 2.0 h (by construction) | 13.3 h | 3.3 h |
| best date's share of the pool at +60 s (A / B) | 96 % / 90 % | 53 % / 33 % | 12 % / 9 % | 34 % / 29 % | 91 % / 85 % |
| what binds | speed (a 10–60 s race), then reading the rules | the tracker's record; capital at 99.9 ¢ | proposals overturned | magnitude revisions; size | the source disagreeing on the days that pay |

The best-date share is over the pool. The fp5 bar asks that no date hold more than 40 %; the economic releases, the
post counts' Mode A and temperature fail it with their pools as they stand. Temperature has no held-out set (the
column "held-out dates" in the power table is empty for it): PMLATE read those months.

## What was read, and what was held out

* **The universe** (`inputs/universe_*.json.gz`): every closed Gamma event, read on 2026-09-27, under these tags:
  * economy, Fed rates, macro indicators, Fed, inflation, CPI, jobs report, GDP, unemployment, jobs and economic
    policy (100328, 100196, 102000, 159, 702, 101701, 102548, 370, 1624, 993, 101800);
  * tweet markets (972), mentions (100343), earthquakes (103038, 100184) and awards (18), with scheduled ends in
    2026-02-01 → 09-25;
  * daily temperature (103040) for 2026-02-28 → 06-02.
* **The split, fixed from that record before any print was read** (`inputs/split.json`, committed as `aa9cca32` ahead
  of every print pull):
  * an event is **exploration** when every market of it closed in [2026-03-01, 2026-06-01);
  * it is **held out** when every market closed in [2026-06-01, 2026-09-25);
  * it is neither when it straddles a boundary or closed later.
  * Held out, unread: 35 economic, 316 post-count, 420 mention and 39 earthquake events. No price, print or book of
    theirs was requested; their Gamma records were read for the power check.
* **Temperature has no held-out set.** PMLATE and USLATE read every US print of 2026-03 → 09. This study uses PMLATE's
  committed US input (the reports' states and each day's final extreme) and re-walked the same events' prints from
  local midnight − 50 minutes. The months are measurement, not a clean test (`inputs/split_temperature.json`).
* **Prints**: every taker print of each exploration event from C − 1 h (or the first confirmation − 1 h) to its close
  (`/v2/trades?event_id=`, cache-busted, each walk complete). Elon Musk's events were walked whole one in three; the
  other two were walked from their window's end.
* **Maker rows**: twenty markets per category, the ten with the largest late Mode B flow and ten by a fixed rule, read
  again with `taker_only=false` (`inputs/maker_sample.json.gz`).
* **Disclosed:**
  * The coordinator's three anecdotes are from 2026-09-25 and were not re-read, except two endpoint probes that
    returned one condition's first two prints and its resolution record: "Fumble", Falcons vs Packers, condition
    0x49f9…20ea.
  * PMLATE's committed results were read, among them `phase1_counts.json`, which lists Trump's September 18–25 week.
  * No held-out print and no market-day of 2026-09-25 or later was read.

## How it was measured

For every market, three facts, none of them from the market's own prices:

* **C**, the first instant a public, timestamped source confirms the market's outcome;
* **w**, the outcome that source confirms at C;
* **r**, the outcome the market resolved to. A market with w ≠ r is a **trap**.

A print is a taker's fill. The data API stamps it about 2 s after the match (`speed/results/print_time_lag.json`), so
"+1 s" is a stamp. In the terms of the confirmed winner W (`scripts/harvest.py`):

* **Mode A** — someone took a resting order that sold W below 1: a taker bought W at p, or sold the loser at p. The
  second is the same resting order: one book, a loser bid at q is a W ask at 1 − q.
  * Per share: 1 − p_W − the taker fee at p_W (the market's own `rate × (p(1 − p))^exponent`) if W won, and
    −(p_W + fee) if not.
  * Only what someone took is seen. It is a lower bound on what rested.
* **Mode B** — a resting maker bought W below 1 from a late taker: the taker sold W, or bought the loser.
  * Per share for the maker: 1 − b_W if W won, −b_W if not.
  * Makers pay no fee. The rebate (15–25 % of the fee-equivalent, from a daily pool) is reported apart, never added.
* **Delays.** For d = 0, 1, 2, 3, 5, 10, 60, 300 and 1800 s: the totals over prints at or after C + d. "Until the
  market closes" is d = 0.
* **Rules** (descriptive, no bar):
  * Mode A, USLATE's fill: half of each print with 1 ¢ or more of edge, at its own price, $100 a market.
  * Mode B, a resting bid at b0 from C + d, filled only by prints strictly through it, at b0.
  * Mode B ceiling: one tick above every print, whole prints, $100 a market.
  * Capital is each fill's cost from the fill to the close.
* **Bands.** From C + 60 s, a print that values W at 95 ¢ or more is *clean*: the market already agrees with the source.
  Below 95 ¢ it is *contested*.
* **Left out and counted:**
  * a market whose public record cannot reproduce its own result (`record_ok: false`);
  * a market resolved before its C: nothing to harvest, and no trap.

## 1. Economic releases

**C and w.**
* **C** is the release instant: the rules' date at the publisher's standard time. BLS (CPI, egg prices, payrolls,
  unemployment), BEA (GDP) and DOL (claims) release at 08:30 New York. The FOMC statement comes at 14:00 New York, the
  Bank of Canada at 09:45 New York, the Bank of England at 12:00 London and the ECB at 14:15 Frankfurt.
* **w** is the publisher's first release, read keylessly (`inputs/sources/pub`):
  * ALFRED vintages dated the release day: CPIAUCNS (annual CPI), CPIAUCSL (monthly CPI), APU0000708111 (eggs),
    PAYEMS, UNRATE, A191RL1Q225SBEA (GDP) and ICSA (claims);
  * FRED DFEDTARU and the Fed's statement;
  * the Bank of Canada's V39079, the Bank of England's IUDBEDR and FRED ECBDFR.
* 28 events, 187 markets and 16 release instants on 11 dates.

**Traps: 0 of 187.** Every market resolved as its publisher's first release said, with one condition.
* **The April FOMC dissent market needs the rules, not the headline.** The statement reads "Voting against this action
  were Stephen I. Miran …; and Beth M. Hammack, Neel Kashkari, and Lorie K. Logan, who supported maintaining the target
  range … but did not support inclusion of an easing bias". The markets count dissents "on the Fed Funds Rate
  decision", and resolved "1".
* A reader that counts the names buys "4+" and loses. That one market-day made the category's late pool:
  * it holds 48 % of Mode A and 84 % of Mode B from C;
  * it holds 96 % and 90 % of the pools from C + 60 s;
  * traders bought "4+" at up to 90 ¢ in the first minutes after 14:00, and kept buying it for half an hour.

**Mode A: gone in seconds, and faster each month.**

| | from C | +10 s | +60 s | +5 min | +30 min |
|---|---:|---:|---:|---:|---:|
| all 28 events | $40,400.59 | $38,376.49 | $20,110.38 | $15,631.37 | $1,199.64 |
| without the April dissent market | $21,128.91 | $19,104.81 | $838.70 | $448.29 | $432.07 |

* Of the stale side's net edge (dissent market left out), the share taken in the first 10 s of stamps was 4 % in
  March, 5 % in April and **83 % in May**. Most of the rest went at 10–60 s.
* The largest single moves: March unemployment ($1,806 in 10–20 s), GDP ($2,230 in 10–20 s), February's unemployment
  ($2,176).
* The coordinator's UMich anecdote (the NO bids hit at +2–3 s) is this pattern, by September.

**Mode B.**
* **From C:** $35,491.72; without the dissent market $5,788.86.
* **From C + 60 s:** $3,932.49 without it. Of that, $2,636 is clean: $2.2M of W bought at 95 ¢ or more, earning
  0.12 % a dollar.
* **Late takers:** 816 wallets from C + 60 s, the largest 15 %.
* **Makers:** in the maker sample, 91 % of the late maker fills sat at 99.9 ¢. There were 153 maker wallets, a median
  of 4 per market.

**What binds.** Speed first, then interpretation.
* The stale side is a race against bots that read the release. They take it in 10–60 s, and in 0–10 s by May.
* BLS answers this container's reads with 403, so a keyless 1 s reader would need another route to the numbers.
* After a minute, only interpretation contests pay: the dissent market.

**Verdict.** Worth money only as a race, which this study is not. The harvest after the race is $1.45 a day at $100 a
market (Mode A) and $0.10–2.73 a day (Mode B).

## 2. Post counts (Trump, Elon Musk, the smaller series)

**C and w.**
* The public tracker (xtracker.polymarket.com) is the rules' resolution source. It gives each post's `createdAt` and
  `importedAt`: the instant the counter moved.
* A bucket is **dead** at the capture that takes the count past its top (C = that capture, NO). "N or more" is
  **locked** at the capture that reaches N (C, YES).
* Every other bucket is decided at the window's end + 600 s, the tracker's p90 capture lag being 287 s: YES for the
  bucket holding the count, NO for the rest.
* **The settle matters.** At t1 + 0, 3 of 189 verifiable events had the winner outside the tracker's count; at + 60 s,
  2; at + 300 s, 1; at + 600 s, none.
* 214 events in exploration, $376M of volume. 207 have a window and tracker posts, and 191 were measured (2,316
  markets).

**The source's record is the problem.**
* **The tracker's API returns at most 100 posts a call** and honours no page parameter. `hcommon.xt_posts` pages by
  moving `startDate`.
* **PMLATE's `count_common.xt_posts` reads one page.** Every window with more than 100 posts was cut to its first 100
  there, which touches PMLATE phase 1's count basis and SPEED's post-count measurements (see the coordinator's
  section).
* **Even paged, the tracker's history cannot reproduce 14 of 207 results.** They carry $4.5M of volume, among them 8 of
  22 Trump weeks ($4.2M of the series' $7.4M). Trump's May 12–19 week holds 100 posts, none after May 17 12:30, and
  resolved "200+".
* **The first listing of the May 19–26 week was closed without UMA** on every series, days before its window ended:
  seven events on May 20 and Elon's weekly on May 25 ($238k). Elon's May 18–20 window ($48k) went the same way just
  after its end. Most closed at outcomes no tracker count supports. Replacement events for the same windows were
  listed on May 20 and resolved normally (Elon's weekly at 260–279, the tracker's 260).
* Those events are `record_ok: false`: left out, neither harvest nor trap. They are this category's real risk: the
  counter a harvester reads may not be the one the market settles on.

**Traps: 0 of 2,316 verifiable markets.**

| | from C | +10 s | +60 s | +5 min | +30 min |
|---|---:|---:|---:|---:|---:|
| Mode A | $4,976.93 | $4,497.06 | $3,931.66 | $3,249.85 | $1,206.78 |
| Mode B | $10,531.73 | $10,493.53 | $10,277.69 | $9,551.43 | $5,831.56 |

* **Window-end markets carry most of it:** A $3,287, B $8,405 at +60 s. Dead buckets carry A $501 and B $1,846.
* **Clean band from C + 60 s:**
  * Mode A: $2,491 on 184 markets and 59 dates, 0.24 % a dollar;
  * Mode B: $7,833 on 926 markets and 88 dates, 0.13 % a dollar. 5.9M shares were printed at 99.8 ¢ or more.
* **Contested band:** A $1,440 on 7 dates, B $2,445 on 10 dates. Elon's March 3–10 week holds 41 %/33 % of the pools.
  Its count ended at 359, the top of 340–359, and the two buckets traded at 5–95 ¢ from 10 to 40 minutes after the
  window.
* **Late takers:** 4,923 wallets, the largest 13 %. Prints are small: p50 20 shares, p90 1,000.
* **Makers:** 275 wallets in the sample, a median of 13 per market, the largest 16 %. 74 % of the maker fills sat at
  99.9 ¢.
* **The coordinator's Trump September 18–25 anecdote** is the same flow: late NO buyers at 0.5–0.7 ¢ paying a YES bid
  at 99.3 ¢, about $77. PMLATE's committed `phase1_counts.json` shows the tracker's count at that window's end was 94
  (80–99) against a resolution of 100–119. A harvester acting at the window's end on the counter would have bid the
  wrong bucket.

**What binds.** The source's reliability and capital.
* The clean Mode B pays 0.13 % a dollar held 3–20 hours, behind a crowd at 99.9 ¢.
* At $100 a market the rules make $0.23–3.07 a day.

**Verdict.** Not worth money.

## 3. Mentions ("what will X say during Z")

**C and w.**
* No keyless source dates these events' ends. The rules name a scheduled start at most, and the resolution source is
  the video.
* The one public, timestamped record that the result is known is the UMA proposal: on chain, and shown on the market
  as "proposed". Liveness is 2 h, so an undisputed market was proposed by its close − 2 h.
* **C = close − 7,200 s** is therefore an instant at which the outcome had been proposed. It is later than the event's
  end: a lower bound.
* w is the proposal standing at C.
* **YES outcomes are included**, which the brief allowed only with a public transcript. No keyless timestamped
  transcript exists, and the confirmation here is the proposal, not a transcript; YES and NO are reported apart.
* 175 events, 4,133 markets, 1,781 resolved YES.

**The trap is the dispute.**
* 29 markets were disputed. The data API's `/v2/resolutions` gives each first proposal against the result: **17 first
  proposals were overturned**, 13 YES-first and 4 NO-first. Those markets carried **$52.3M** of volume.
* Trump–Xi "Iran" ($28.3M), "Nuclear" ($12.1M) and "Strait/Hormuz" ($10.0M) were proposed YES, disputed three times,
  and resolved NO.
* A first proposal's instant is in no keyless record, so the disputed markets are left out of the pools
  (`record_ok: false`). Their worst case at $100 a market is −$1,700 (−$400 for a NO-only harvester).
* The mentions pools below are therefore after the last proposal, and they are an upper bound on what a proposal
  follower keeps.

| | from C | +10 s | +60 s | +5 min | +30 min |
|---|---:|---:|---:|---:|---:|
| Mode A | $6,272.73 | $5,874.82 | $5,550.29 | $4,583.46 | $3,105.87 |
| Mode B | $16,272.60 | $16,244.92 | $15,316.06 | $14,442.93 | $9,323.83 |

* **Spread thin:**
  * YES and NO markets carry about half each;
  * the best date holds 12 % (A) and 9 % (B);
  * 3,304 late takers, the largest 4 %;
  * in the maker sample, 200 maker wallets, a median of 14 per market.
* **Clean band from C + 60 s:**
  * Mode A: $4,350 on 2,021 markets, 0.24 % a dollar;
  * Mode B: $11,021 on 2,169 markets, 0.27 % a dollar.
* **Rules at $100 a market:** Mode A $2.57 a day; Mode B $3.04 a day at 99 ¢; the tick ceiling $15.01 a day. Those
  are before the 17 overturned proposals, and at $100 each they cost more than any of them made.

**What binds.** The confirmation itself: a public end time, a transcript, or a proposal that holds. The late flow is
real and unconcentrated, but the one timestamped confirmation history offers is the one that fails in the biggest
markets.

**Verdict.** Not testable on history, and at its best dollars a day.

## 4. Earthquake counts (USGS)

**C and w.**
* The window is the rules': the ET week, or market creation to a date. The count is USGS ComCat's, the rules' source,
  as it stood at C.
* Every event within 0.5 of the threshold was read with its superseded origin versions. At instant t, the latest
  version of the highest-weight authoritative solution counts (NEIC `us` 158, regional networks); a tsunami warning
  centre's first estimate (`pt`, weight 6) does not.
* **That rule changes the answer.** On 2026-03-20 the South Shetland Islands quake read M7.0 from `pt` for five
  minutes before NEIC's 6.6.
  * Counting `pt` would have "confirmed" the "another 7.0 by March 31" markets four days before Tonga's real 7.5, and
    more than doubled the category's pool.
* A bucket dies when a quake's publication (or upgrade) passes it; "more than N" and "by date" lock at the passing
  publication. The rest decide at the window's end + 600 s.
* 21 events, 136 markets, $2.2M of volume in three months.
* **Every result is reproduced** from the reconstructed catalog at each market's close.

**Traps: 1 of 136.** NEIC published a M5.7 near Severo-Kurilsk at 08:24 on May 17 and revised it to 5.4 at 21:09. The
count fell from 7 to 6, and "exactly 6" won. It cost −$456 of Mode A and −$950 of Mode B pool from C, against clean
bands of $1,929 and $860 at C + 60 s.

| | from C | +10 s | +60 s | +5 min | +30 min |
|---|---:|---:|---:|---:|---:|
| Mode A | $5,362.19 | $5,303.64 | $4,223.05 | $2,829.19 | $1,086.00 |
| Mode B | $3,231.98 | $3,231.98 | $3,126.03 | $2,650.46 | $1,954.48 |

* **Contested band** (from C + 60 s): A $2,294 and B $2,266, 16–17 dates. The best date holds 34 % (A) and 29 % (B).
* **Makers:** 275 wallets in the sample, a median of 18 per market. **Lock:** 13.3 h, because the rules hold the
  market 24 h for revisions.
* **Rules at $100 a market:** Mode A $1.20 a day; Mode B −$0.57 a day at 99 ¢. The one revision costs more than the
  bids earn.

**What binds.** Revisions and size. The rules keep the market open 24 h for magnitudes, and they move across
thresholds.

**Verdict.** Not worth money; a clean source for a market too small to matter.

## 5. Temperature, after the station's day has ended

**C and w.**
* C = the end of the target day in the station's local time + 600 s. The last routine report is observed at :51–:53,
  and AWC receives a US report within a p90 of 4–7 minutes at eleven of the twelve stations (an hour at KBKF,
  `pmlate/results/awc_receipt_lags.json`).
* w is the bucket holding the day's final extreme from the station's reports (PMLATE's input), NO for every other.
* US stations, target dates March–May: 765 market-days with markets still open at C. Of 10,369 markets, 5,669 had
  closed before C; dead buckets are resolved during the day.

**Traps: 31 of 4,700 markets, in 17 events.** Among them are the May 17–21 cluster PMLATE found and Denver's March 26
high: the reports said 70 °F, the result 76–77 °F. Their late flows were small: −$8 of Mode A and −$62 of Mode B
after C. The trapped markets had little trading after the day.

| | from C | +60 s | +5 min | +30 min |
|---|---:|---:|---:|---:|
| Mode A | $15,888.09 | $15,835.07 | $15,078.17 | $14,827.37 |
| Mode B | $33,859.74 | $33,860.11 | $33,680.52 | $32,007.99 |
| Mode A without NYC March 7 | $1,606.64 | $1,553.61 | $796.72 | $545.92 |
| Mode B without NYC March 7 | $5,037.14 | $5,037.51 | $4,858.13 | $3,188.83 |

* **One market-day is 91 % (A) and 85 % (B) of it:** New York's high of March 7, 2026.
  * The reports' maximum was 49 °F, which locked "48 °F or higher" and killed "46–47 °F".
  * For 21 hours after the day, traders valued "48+" at 5–95 ¢.
  * It resolved 48+, as the reports said. Mode A $14,281, Mode B $28,823.
  * This is PMLATE's pattern with the sign reversed. There, the late liquidity was mostly traps: September's 12 cost
    $36,316 against $8,271.
* Without that day, the late pool is **$16.89 a day (A) and $54.76 a day (B)** from C + 60 s:
  * Mode A clean: $749, 0.27 % a dollar;
  * Mode B clean: $2,775, 0.13 % a dollar;
  * 65 % of the sampled maker fills sat at 99.9 ¢.
* **Rules at $100 a market:** Mode A $0.87 a day. A bid at 99 ¢ loses $1.95 a day: two traps at $100 each.

**What binds.** The contest itself: the money is on the days the reports and the resolution source might disagree,
which is also where they do.

**Verdict.** Not worth money. After the day, the book either agrees with the reports (pennies) or doubts them for a
reason.

## Categories left out, and why

* **Award shows.** The Eurovision winner ($194M) and the NBA MVP ($95M) are large, but no keyless source timestamps
  the announcement to the minute. Skipped, as the brief allows.
* **Sports results and crypto fixings.** Optional. They were not run, to stay within five categories. ESPN's public
  summary gives an "End of Game" wall clock to the second: the Magic at the 76ers on 15 April 2026 (ET) ended at
  02:14:57 UTC on the 16th. Sports is the category to add next if a sixth is wanted.
* **The view counts** are VIEWS' (reference §3.40): $3,271 of stale edge after the deadline in 547 days.

## The power check (fp5's rule: first)

`scripts/power.py`, exploration only, $100 a market, every fill from a print that happened at its own price, the
market's own fees. It gives the calibration null (each fill's token pays 1 with probability its price; p95 by normal
approximation) and a date bootstrap drawn with replacement. The held-out projection scales by the category's
held-out/exploration events.

| rule | category | exploration total | dates | best date | z vs null | held-out dates | fp5 date count (≥ 25) |
|---|---|---:|---:|---:|---:|---:|---|
| FAST-A: from release + 3 s, half of each Mode A print | econ | +$1,378.40 | 11 | 25 % | 4.58 | 13.8 | fails |
| CLEAN-A: Mode A at 95–99.9 ¢ from C + 60 s | econ / counts / mentions / quakes / temp | +$32 / +$45 / +$270 / +$79 / +$32 | 10 / 43 / 83 / 31 / 30 | ≤ 25 % | 0.7–2.2 | 12–199 | econ fails |
| CONTEST-A: Mode A below 95 ¢ from C + 60 s | same order | +$377 / +$268 / +$106 / +$114 / +$78 | 5 / 7 / 19 / 16 / 8 | 23–76 % | 0.8–3.5 | 6–46 | econ, counts fail |
| PATIENT-B: a bid at 99 ¢ from C + 60 s | same order | +$11 / +$21 / +$279 / −$52 / −$180 | 8 / 20 / 80 / 30 / 20 | 6–29 % where positive | −4.6 to 1.9 | 10–192 | econ fails |
| TICK-B: a maker a tick above every late print | same order | +$1,864 / +$128 / +$1,381 / +$94 / +$154 | 10 / 41 / 86 / 32 / 48 | 14–87 % | 0.5–7.2 | 12–206 | econ fails |

**Why nothing is drafted.**

* **FAST-A** is the only rule with a large z and a positive worst-date. It is a race: the stale side goes in 10–60 s
  of stamps, in 0–10 s by May. It reads a publisher whose site refuses automated reads here. It has 14 held-out dates
  where fp5 needs 25.
* **The mention rules** (CLEAN-A $270, PATIENT-B $279, TICK-B $1,381 in 92 days) are the only ones spread over many
  dates.
  * They exist only with the 29 disputed markets left out. Their first proposals are the traps, and history has no
    keyless timestamp for them.
  * Counted at their worst ($100 each), the 17 overturned proposals cost more than any of the three rules made.
* **Every CONTEST rule** is a handful of dates with one market-day at 23–76 %. It is USLATE's failed shape.
* **Every CLEAN and PATIENT rule** makes cents to $3 a day. At 0.12–0.45 % a dollar the break-even trap rate is one
  in 220–830 markets; the measured rates are 1 in 136 (earthquakes), 1 in 152 (temperature) and 1 in 243 (mention
  first proposals).

## What this cannot show

* **The book.** Nobody archives it. Mode A sees only what someone took, so what rested and went untaken is unknown,
  and whose order would have been first is unknown.
* **A new maker's queue position.** The maker sample shows who filled the late flow: 4–18 makers per market, the
  largest 11–42 % of the shares, and 24–91 % of the fills at 99.9 ¢, where no one can step ahead. The tick-ahead
  ceiling assumes a newcomer is first a tick above every print; nothing shows that it would be.
* **The exact confirmation instant where no source times it:**
  * mentions (close − 2 h bounds the proposal);
  * the tracker's history, which is not the counter as it stood (14 events);
  * earthquakes' catalog before a version was superseded, reconstructed from the versions ComCat keeps.
* **The print stamps** trail the match by about 2 s: "+1 s" is not a match time.
* **Anything after May 2026.** The held-out months were not read, and the econ race had already sped up by May.

## What would need Davies' decision

1. **Nothing to approve for a test.** No rule is pre-registered.
   * The one lead is a forward measurement: record the UMA proposal instants and disputes on the harvest categories,
     and the book at C + 60 s. That would say what rests after confirmation and whether a proposal is safe to follow.
   * It reads public data only and places nothing. It is a recorder like the view-count one; whether to build it is
     his call.
2. **The econ release race** (FAST-A: $15 a day at $100 a market in March–May, faster every month) is a race against
   bots reading BLS. He said this study is not that. Pursuing it would need an approved route to BLS's numbers at
   08:30:00, and it is a PMLATE-shaped question.
3. **Any harvest opens a position.** Mode A takes; Mode B's resting bid opens a position when filled.
   * Either is allowed only from Ireland under his attestation. The UK is close-only, and no order path exists.
   * Both hold to resolution (2–13 h here), so a close-only stretch would stop new fills, not strand the book.
4. **For RW:** its same-day losses are Mode A seen from the other side. RW's resting quotes were the stale orders that
   informed takers took in the first seconds.
   * RW-E already removes those markets, and nothing here changes RW or RW-E.
   * As harvest targets, none of RW's newer market kinds joins: earthquakes are clean but small and revise, awards
     have no timestamped source, temperature is contested exactly where it pays.

## For the coordinator

* **Re-run:** `python3 docs/agents/backtests/harvest/scripts/run_all.py` from the repository root.
  * Every result twice, byte-identical, plus the five unit steps offline from `inputs/sources/`, identical to the
    committed inputs' units.
  * Result hashes are printed by the script. `MANIFEST.json` holds every committed file's sha256 and the raw pulls'
    digests; the raw pulls are 29.9 MB under `$HARVEST_DATA`, not committed.
* **Found, outside this study's question:**
  * **PMLATE's `count_common.xt_posts` reads one page of the tracker (100 posts).** Its phase-1 count basis
    (`results/phase1_counts.json`) and SPEED's post-count measurements (`speed/scripts/count_edge.py`, which imports it)
    truncated every window above 100 posts. That is every Elon window and Trump's busier weeks. `hcommon.xt_posts` is
    the paged reader.
  * **The tracker's history is not the counter as it stood:** 14 of 207 exploration windows cannot reproduce their
    results, among them the first listing of the May 19–26 week, closed without UMA at outcomes no count supports and
    replaced by new events. Any count study should check its record against each result, as `counts_units.py` does.
  * **A USGS `pt` first estimate is not a USGS magnitude:** any earthquake rule should count only authoritative
    solutions.
* **Numbers to recompute** if a later session widens the window: `results/summary.json` (the table above),
  `results/power.json`, and `results/<category>.json`, including the `_excl_` variants for the top market-day.
