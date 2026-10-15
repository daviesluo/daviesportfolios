# The release blackout in both Coinbase tests: the exact calendar, and what was built (2026-10-15)

Davies, 2026-10-15, on the CBFAST study (`2026-10-15-coinbase-fast-move.md`): "目前的两个Coinbase 测试采用发布前后暂停的规则吧，你想办法找到准确的CPI
和非农等的历史发布日期，可以用网站本身的api和数据接口；另外revolut x的规则不需要加这个吗？" Three parts: the calendar (§1), the blackout in
both running tests (§2), Revolut X (§3, added by the third commit of this branch), and what was not checked (§4). Scripts and results are in `docs/agents/backtests/cbreview/`.

## 0. The answer

1. **The calendar is exact for the Fed, the ECB and the Bank of England, and not for the BLS.** FOMC (16 past, 2 to come), ECB (16, 2) and BoE
   (16, 2) are read from their own sites and agree with what had been recalled, date for date (0 disagreements). **bls.gov refused this machine
   (403) and FRED did not connect**, so the US CPI and NFP dates are still the published schedule as recalled, each checked against the market's move
   and NFP also against BLS's own rule; 7 NFP dates differ from the rule and all 7 are known holiday or shutdown delays. Yahoo's calendar
   (Davies' site's own source) answered 429 to the crumb from this container on every try, so it could not be pulled here (§1.3).
2. **The study does not change.** The exact calendar's 96 past events are the 96 the study used (same kind, day, instant and market check), and
   re-running the event-by-event stage reproduces +£25.96 and +£7.89 a year, to the penny.
3. **The blackout is built into both tests** (§2): `cb_releases.ts` holds the list; `cb_quotes.ts` and `cb_hold.ts` withhold the minute's fair
   from one minute before to five after each release; the stored `fair` is null in those minutes so the replays reproduce the engine. Deviation 3 of the
   base pre-registration and Deviation 2 of the "- 2" one say so. Not pushed; it needs the main session's landing and `agents` redeploy.
4. **Revolut X does not need it** (§3): over PR5's own books the blackout is worth −$1.40 to +$3.29 a year on a base of $750 to $1,060, ranges across zero, because the thin UK tape gives a release minute
   few and small fills (4 of 40 releases had any); the one release minute on record cost $0.20 on 10-14 and the live account took none of it. Verdict for LIVE: no change.

## 1. The calendar

### 1.1 What answered, and what refused (2026-10-15, from this container)

`release_calendar.py` logs every URL it tries (`inputs/release_calendar.json`, `source_log`).

| source | answer | used for |
|---|---|---|
| federalreserve.gov/monetarypolicy/fomccalendars.htm | 200 | FOMC meetings 2024 to 2027 (the statement is the second day; 2025's "August 22 (notation vote)" is not a meeting) |
| ecb.europa.eu/press/govcdec/mopo/{2024,2025,2026}/html/index_include.en.html | 200 | every monetary-policy decision: the date is inside each press release's URL (`ecb.mpYYMMDD~…`) |
| ecb.europa.eu/press/calendars/mgcgc/html/index.en.html | 200 | the Governing Council's meetings still to come (29 Oct, 17 Dec) |
| bankofengland.co.uk, 16 "monetary policy summary and minutes" pages | 200 | the publication date of each MPC decision, Nov 2024 to Sep 2026 |
| bankofengland.co.uk/monetary-policy/upcoming-mpc-dates | 200 | 2026 and 2027 dates (5 Nov, 17 Dec to come) |
| www.bls.gov, download.bls.gov, stats.bls.gov (schedule pages, `.ics`, flat files) | **403 "Access Denied"** from the site's own edge | nothing |
| data.bls.gov | 301 for the schedule URLs (to www.bls.gov); 200 for its time-series pages, which hold values and no release dates | nothing |
| api.bls.gov | 200, but the data endpoints carry values and a month, never a release date (v2 answered that its daily threshold was reached) | nothing |
| fred.stlouisfed.org, alfred.stlouisfed.org | **no connection** | nothing |
| api.stlouisfed.org | 400: wants a registration key (none is used) | nothing |
| web.archive.org | tunnel reset; archive.org's availability API answers but points at web.archive.org | nothing |
| query1.finance.yahoo.com (Yahoo, via fc.yahoo.com's cookie and `getcrumb`) | **429** on the crumb, on every try, two user agents, query1 and query2 | see §1.3 |
| api.nasdaq.com economic-events | 200, but wrong: the FOMC statement of 2025-01-29 stands on 01-30 at 15:00, and 2025-01-15 has no US CPI | not used |
| tradingeconomics.com (not a first party) | 200 | only to see NFP 2026-11-06 and CPI 2026-10-14 scheduled |

**Finnhub and Alpha Vantage** (Davies: "能用就用"; the keys live only in Supabase secrets): a read-only `?action=econcal&from=&to=` (`agents/econcal.ts`, cron bearer only, the key used server side and never in an answer) is built and pinned in
`index.test.ts`, to be called from SQL once deployed; Finnhub marked its economic calendar Premium, so it may refuse, and the action returns the refusal verbatim. **Alpha Vantage has nothing usable**: its documentation offers an earnings calendar and an IPO
calendar, and its CPI, NONFARM_PAYROLL and FEDERAL_FUNDS_RATE series give a month and a value, with no release instant; it is not wired.

GitHub's code search is closed to this session by policy and was not tried further. A 403 is a finding, so none of the refused sites was worked
around.

### 1.2 The events, and how each is checked

All instants are UTC through `zoneinfo`: CPI and NFP 08:30 New York, FOMC 14:00 New York, ECB 14:15 Frankfurt, BoE 12:00 London, DST as it was
(ECB 13:15 or 12:15, FOMC 18:00 or 19:00; `cb_releases.test.ts` re-derives every listed clock time with `Intl`). Past 2024-10-01 → 2026-10-14: CPI 24, NFP 24, FOMC 16, ECB 16, BoE 16. To come
to 2026-12-31: FOMC 10-28 and 12-09, ECB 10-29 and 12-17, BoE 11-05 and 12-17, NFP 11-06 and 12-04, CPI 11-10 and 12-10.

* **First-party kinds** (FOMC, ECB, BoE): the fetched dates against the dates recalled before the fetch: **0 differences in 48**.
* **CPI and NFP**: recalled (bls.gov refused), so checked two ways. (a) The market: the largest 1-minute EUR/USD move within ±2 minutes of the
  instant against the same clock minutes of the ten weekdays either side (GBP/USD for the BoE; the exchange-implied EUR/USD after the screen's
  series ends). Stands out: **CPI 23 of 24, NFP 22 of 24, FOMC 16 of 16, BoE 16 of 16, ECB 12 of 16** (the ECB seldom moves EUR/USD at the minute).
  Not standing out: CPI 2024-12-11 (7.3 bp against a control 90th percentile of 9.95), NFP 2025-04-04 (6.1 against 6.64) and 2025-06-06 (13.3 against 13.7): quiet
  releases, kept; ECB 2025-01-30, 2025-04-17, 2025-07-24, 2026-02-05. (b) BLS's published rule for the Employment Situation (the third Friday after the end of the
  reference week): **7 of 24 NFP dates differ from it**, 2025-01-10 (rule: 01-03), 2025-07-03 (07-04), 2025-11-20 and 2025-12-16 (the shutdown),
  2026-01-09 (01-02), 2026-02-11 (02-06, the brief shutdown), 2026-07-02 (07-03): each a holiday or shutdown delay of the kind BLS announces, and all seven stand out in the market
  on the listed day. No date is dropped or altered on these grounds.
* The check caught one error earlier: CPI on 2026-02-11 sat on NFP's instant; 2026-02-13 08:30 stood out (17.5 bp). Fixed.
* 08:30 New York minutes with a large move on a day that is in neither list (25 largest, `unexplained_0830_spikes_bp_day`): the top ones are PPI days next to a CPI
  (2025-06-12, 2025-08-14, 2025-09-10, 2025-01-14), 2025-01-20 (the inauguration) and similar; none points to a CPI or NFP missing from the list.

**What this does not establish:** that the BLS dates are the BLS's. It is the recalled schedule, checked against the market and a rule, and the forward dates
(CPI 11-10 and 12-10, NFP 12-04) are marked UNCONFIRMED in `cb_releases.ts`. NFP 11-06 is also on tradingeconomics' calendar and is what the rule gives.

### 1.3 Yahoo, Davies' own site's source

The pull is in `release_calendar.py` (`fc.yahoo.com` cookie, `getcrumb`, then
`ws/screeners/v1/finance/calendar-events?modules=economicEvents&countPerDay=99`, US-filtered and unfiltered, a week at a time from 2026-09-01), and it cross-checks
every release inside Yahoo's coverage to the minute (a record whose `eventTime` equals ours, by event name and country). From this container the crumb answered **429** on
every try, so nothing was fetched; the script then reads `inputs/yahoo_calendar.json` (the raw records of a pull made elsewhere) when it exists. Reported by the main
session, from its own pull and not reproduced here: Yahoo has the CPI of 10-14 at 12:30, the NFP of 10-02 at 12:30 and the "Fed Funds Tgt Rate" of 10-28 at 18:00 UTC, which are our
three instants. Yahoo's coverage is dense only from late September to early November 2026, so it can check about 6 of the 106 events; the rest rest on the official sources. **Proposal (not
built): a weekly pull of Yahoo's calendar from the deployed network into a table, compared with `CB_RELEASES`**, so that a release BLS or a central bank reschedules is seen a
week or more before it, and the list can be extended by a deviation. It reads that one endpoint through the fundamentals function's cookie and crumb flow, writes
a table of `eventTime, event, country`, and raises an `ops_errors` row when a listed instant has no matching record within 5 minutes once Yahoo covers its day.

### 1.4 The study, re-run on the exact calendar

`events.json` was regenerated from the fetched calendar and compared with the one the study used: **96 events, identical in kind, day, instant and market check**. `cbfast_events.py` re-run:
base +£25.96 (2024-10-09 → 2025-10-09) and +£7.89 (2025-10-09 → 2026-10-09) a year, trips kept 97.4 % and 94.1 %, the same numbers. The result does not change, because the calendar the
study used was already the exact one.

## 2. The blackout in both tests

**The rule** (`agents/cb_releases.ts`): in the seven minutes that start from one minute before to five minutes after each release, the minute's `fairU` is null. Both drivers
(`cb_quotes.ts`, `cb_hold.ts`) do `fairU: cbInBlackout(t) ? null : io.fairU` and nothing else, so `stepMinute` (unchanged) does what it does in any dark minute:

* entry rungs are withdrawn and none is placed; the stored minute's `fair` is null (and `x` kept), so `replay.py` and `replay_wk.py` replay the engine without knowing about releases;
* **exits and stops, as the rule already does when the fair is null** (checked in `stepMinute`, quotes.ts): an exit order already resting stays and can fill; a rejected one goes live
  when the market leaves it; one that falls due in the window (the rung filled at T−2 or later) is placed at the first lit turn (T+6), so a held rung waits at most six minutes longer
  and **is never stranded**; the 24-hour stop does not read the fair and runs. The hand-worked pin shows all three.
* the first lit turn re-places the entries, which go live a minute later: fills resume no earlier than T+7.

**The list.** `CB_RELEASES`: 10 releases from 2026-10-28 to 2026-12-17 (the CPI of 2026-10-14 is over and not in it). Windows: the base test (to 2026-11-08) and "- 2" (to 2026-11-10) each hold four:
FOMC 10-28 18:00Z, ECB 10-29 13:15Z, BoE 11-05 12:00Z, NFP 11-06 13:30Z. The CPI of 11-10 (13:30Z) falls after "- 2"'s window ends at 00:00 UTC.

**The deviations.** Base pre-registration **Deviation 3**, weekend pre-registration **Deviation 2**, each quoting Davies' words, with: the rule; the list and its sources; **from the first minute
decided after the deploy** (a minute is judged by its own start; the first release is 2026-10-28 18:00 UTC, so nothing before 17:59 that day differs); **the reading's bars are read on the
record as it ran** (blackout minutes included, `replay.py` and `replay_wk.py` unchanged); **the paired comparison of the two arms is unaffected** (both get it from the same list; bar 5 of the base
test compares with a Revolut X twin that has none, and the report says so); and the sha256 of every changed file. The window and every threshold are unchanged. The cbwk `MANIFEST.json` holds a new
group, "the release blackout's, changed or added 2026-10-15" (`cb_quotes.ts` moved there), which `src/cb_hold_prereg.test.js` holds to the files.

**Pins** (all fail on today's code, and I ran the counterfactual: the dark line taken out of each driver):

| test | what it pins | with the line removed |
|---|---|---|
| `cb_quotes.test.ts` "cbInBlackout is seven minutes a release" | the edges: T−2 out, T−1 to T+5 in, T+6 out; ms edges; two releases; empty list | (the function, not the driver) |
| `cb_quotes.test.ts` "the blackout: nothing new rests …" | USDC-GBP around the 2026-10-28 FOMC worked by hand: fills 17:55, 17:58, 18:07 and none in 17:59–18:05; exits 18:00 (resting) and 18:07 (placed at the first lit turn); fair null in exactly the seven minutes, x kept; rungs withdrawn once at 17:59 and re-placed at 18:06 | **FAILED** (11 others pass) |
| `cb_quotes.test.ts` "with no release near …" | the same prints on a Monday fill what the unchanged rule fills (17:59 and 18:03 too), no null fair | passes (control) |
| `cb_hold.test.ts` "the release blackout …" | the same world through "- 2": the same fills and exits; and the two arms write the same trips, events and minutes | **FAILED** (8 others pass) |
| `cb_releases.test.ts` (4) | ascending and strictly so, whole minutes in `…:00Z` that parse back; every instant is its release's local clock time in its own city (DST); complete for both windows (four each); seven dark minutes per release | |
| `src/cb_blackout.test.js` (4) | `CB_RELEASES` is the fetched calendar's future, instant for instant; UNCONFIRMED marks exactly the non-first-party dates; both drivers use the one function on the fair alone; both deviations carry the words, the start, the record, the pairing and the sha256 of every file named | |

Docs: `docs/map.md` (new rows `cb_releases.ts`, `cb_blackout_world.ts`, the `cbreview` row), `docs/agents/reference.md` items 58 and 60, `docs/agents/CLAUDE.md`, `docs/guide.md`. `src/` does not change, so there is no `dist/`.
The Agents page and its browser fixtures are byte-identical (their worlds hold no release). No migration: no table, call or cron changes; the `agents` function redeploys on push.

## 3. Revolut X: PR5's rule does not need it

Davies asked whether Revolut X's rule should have the pause too. `cbfast_revx.py` prices the same blackout on PR5's rule over Revolut X (a proposal; no Revolut X file, no
config, no order touched). **Verdict for LIVE: not needed, and no change after the 10-21 verdict.** The history cannot see a loss around releases, the one release minute in the record cost
$0.20, and the live account did not take it.

**History** (PR5's own books, `pr5_sim.Book`, the pre-registered inputs: Revolut X UK prints, GBP/USD, the dollar books' hourly closes; USDC-GBP from 2025-11-26, USDT-GBP from 2025-12-16, to 2026-09-23; $100 a rung,
$1,200). `gsim` with no hook equals `pr5_sim.simulate` trip for trip, and the base arm's PRIMARY window is **$707.9028, `pr5_run1.json`'s figure, to four places**. Two spans of 140 and 141 days and the
week of 2026-08-24 on, in which the market tightened; $ a year (% on $1,200), Δ against the base in the same span with the paired day-bootstrap 5th and 95th percentile:

| | 2025-12-16 → 2026-05-05 | 2026-05-05 → 2026-09-23 | 2026-08-24 → 09-23 (tight) |
|---|---:|---:|---:|
| base | 1,062.08 (88.5 %) | 747.11 (62.3 %) | 191.20 (15.9 %) |
| blackout a1 b5, all five kinds (dark fair) | −1.40 [−5.5, +2.0] | +3.29 [+0.3, +6.8] | −1.15 [−5.1, +1.6] |
| US kinds and BoE | −0.17 [−4.0, +3.1] | +3.21 [+0.3, +6.6] | −1.96 [−5.9, 0.0] |
| US kinds only | −0.04 [−3.8, +3.1] | +2.66 [0.0, +6.0] | −1.96 [−5.9, 0.0] |
| entries only (a pause) | +0.98 [−0.1, +2.2] | +1.73 [−0.4, +4.3] | −1.96 [−5.9, 0.0] |
| a0 b2 / a1 b15 | −0.45 / −1.29 | +1.29 / +2.60 | −1.16 / −1.80 |
| a3 b60 | −12.84 [−24.4, −1.8] | −10.00 [−16.7, −4.2] | −11.75 [−21.6, −3.3] |
| trips kept (a1 b5, all) | 100.0 % | 99.9 % | 99.3 % |

Within ±$3 a year on a base of $750 to $1,060 (0.3 %), of both signs, with ranges across zero; only a long window (3 minutes before, 60 after) costs, $10 to $13 a year. Coinbase's was +$25.96 on £554.
**Why the difference:** Revolut X's UK tape is thin (the paper engine's record holds 7,555 prints in three weeks) and a rung fills at most 10 % of the minute's volume, so a release minute offers few fills and small ones.
Of the **40 releases** in the history (CPI 10, NFP 10, FOMC 6, ECB 7, BoE 7) the base arm entered a trip in the blackout window in only **4** (36 had none, against 26 of 94 on Coinbase); those four removed −$0.196 in all, a mean of −$0.005 a release against **+$0.026 for the same
clock minutes on the ten weekdays either side**: there is no release effect to take out. NFP −0.338 (2 lost, 8 none), BoE +0.090, CPI +0.052, FOMC and ECB nothing.

**10-14 and the paper engine's own record** (`inputs/revx_paper_record.json.gz`, 2026-09-25 → 2026-10-15, its prints and minutes as it decided on them, `sql/export_revx_paper_record.sql`). The rule replayed on that record gives the engine's 2026-10-14 exactly:
**15 trips, 13 won, +$0.3605** (the engine's figure). In the 12:30 UTC minute it entered **two trips, USDC-GBP asks at .1 % and .2 %, on $18.21 each (the volume cap), losing $0.1979** between them: the same mechanism as Coinbase's, at a hundredth of the size. With the
blackout (a1 b5, all kinds or US and BoE) 10-14 is 14 trips and **+$0.5543**; the record's two releases (NFP 10-02, CPI 10-14) are the only ones in it, and the whole record goes from $11.35 to $11.54.
**The live executor** (`agent_quote_live_orders`, rows 12:30 to 12:39 on 10-14): its orders in the minute were exits cancelled unfilled at 12:30:29 and 12:30:30 and everything re-placed from 12:32; none of those rows has a fill, so the live sub-account (£10 a rung) took no part of the $0.20.

**Why "not needed".** (1) The history shows no cost to take out: −$0.20 over 40 releases, with the blackout's yearly effect inside ±$3. (2) The only release minute on record cost $0.20, about a tenth of one day's profit ($2 to $3 a day on the base). (3) The change would sit in `quotes.ts`'s driver, under PR5-W's freeze
line, and the live executor carries out the paper engine's decisions order for order; a pause is therefore a new paper variant with its own pre-registration (a spec row's `rules` would carry it), for an expected +$0 to +$3 a year on $1,200. **If Davies wants it anyway,** the form is the Coinbase one (the minute's fair
null from one minute before to five after, from the same `CB_RELEASES`, GBP kinds first: US and the BoE), as a twin variant read beside PR5 after the 10-21 verdict. I would not fund it.

## 4. Not checked

* **The BLS dates** (see §1.2): recalled, market- and rule-checked; the CPI of 11-10 and 12-10 and NFP of 12-04 are UNCONFIRMED. A wrong one costs only the blackout.
* **Yahoo** could not be pulled from this container (429). The cross-check is written and waits for a saved pull in `inputs/yahoo_calendar.json`.
* **Finnhub** and **Alpha Vantage** were not used in the calendar (see the econcal commit, if the main session has it).
* **Revolut X**: the tape is PR5's pre-registered one to 2026-09-23 and the paper engine's own record after; the live executor's 12:30 orders were read for 12:30 to 12:39 only (40 rows), not the whole day.
* That the engine **behaves** this way in production is proved on worlds (Deno) and not yet on live minutes: the first blackout is the FOMC at 2026-10-28 17:59 UTC, and the first thing to read after it is that
  `cb_quote_minutes` and `cb_hold_minutes` have `fair` null from 17:59 to 18:05 and that no entry fill is in them.
