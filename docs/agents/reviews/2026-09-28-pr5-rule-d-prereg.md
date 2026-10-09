# Pre-registration: "Stablecoin quotes variant-2", PR5V's rule with rule D, on paper

Written 2026-09-28 (UTC), beside `2026-09-28-pr5-variant-prereg.md`, in that file's shape. Frozen by the commit that
adds it, which should land before 2026-09-29 00:00 UTC. A later freeze moves these dates, and no other, by the whole
number of days that puts the window's first day on the first UTC day that begins after the freeze: the window
(2026-09-29 → 10-26), E (2026-10-28 00:30), the null's bounds (2026-09-29 00:00 and 2026-10-27 00:00), the reading's
earliest instant (2026-10-28 01:00) and latest date (2026-11-04), and the reading script's deadline (2026-10-27 00:00).
The start, 2026-09-28 00:00, does not move, nor does any date of PR5V's file. Any change after the freeze is a
deviation and is reported as one.

It changes nothing that PR5V has already decided. PR5V's pre-registration forbids a change to its engine after it has
decided a minute: such a change re-decides every minute from its start and is a deviation. This file does not do that.
Rule D is a second instance of the same decision function, with its own state, tables, lease and cron row. PR5V's row
of `edge-calls-every-minute`, its tables, its `VARIANT_CODE_VERSION` and its page row's record are not rewritten. An
arm of this instance runs PR5V's own settings, so a drift in the shared function shows up here instead of inside
PR5V's record. PR5's paper engine, its dry-run, `stepMinute`, and the frozen files that read them (PR5-R, PR5-W,
QUEUE, PR5V) are untouched. No key is read, no signed call is made, no sub-account is opened and nothing is placed.
No Worker is deployed, and TrueFX is not registered as a data source of its own.

Davies, 2026-09-28: rule D goes on paper as variant-2; the row that was "Stablecoin quotes - variant" is variant-1;
the names in the table are two lines, so the first line is the whole of "Stablecoin quotes"; this class of strategy
reads its fair rate from TrueFX, and Yahoo only when that read fails. No new data source, no new sub-account, no
Worker. The timing stays PR5V's minute.

## 1. What was chosen before this file, and how

The fast-X study is `2026-09-28-pr5-fast-fx-study.md` (reference §4 item 46). It priced a faster GBP/USD and more keys
on the PR5V study's days and found neither earns much; rule D, declared before it ran, does most of what the extra
keys would. Its engine is `fastx_sim.simulate`
(sha256 f9562974fae8f60ff118f371af95b722318e4cb0f68c0df77948509d70bc6f17), which is `pr5v_sim.simulate`
(54ad41982d143758ece6ee8e5bb48d5a4aafe1dc0429ccc0af6d1c57282de27a) with two marked additions, a key per rung and a
re-price rule. With the rule unset it is the frozen engine.

**Recomputed on 2026-09-28, before this freeze, with those files and the study's own inputs** (`study.Runner`, REF
timing: a turn at the start of each minute, an order live the next minute). Not copied in from a note.

- The frozen engine, nine rungs, re-price 0.03 %, four keys, the governor: **$1.0540 a day** over the 28 days (563
  trips, $29.5129) and **$0.5088 a day** over the five fresh days (40 trips, $2.5438). `fastx_sim` with the rule unset
  matched those trips exactly. This is PR5V's reference timing (`ref_timing.json`: $1.054 and $0.509).
- The same call with rule D, `{"frac": 1/3, "away": null}`: **$1.0822 a day** over the 28 days (593 trips, $30.3004)
  and **$0.7484 a day** over the five fresh days (60 trips, $3.7420).
- Day by day, rule D minus the frozen minute configuration, `block_bootstrap` of `study.py`
  (4a5d077ef0f97060ee5613d9a5f1c75b6e404b15ed052d367c1fe67f6d8e7b50), 7-day blocks, 10,000 resamples, seed 20260928:
  mean **+$0.0281**, interval **−0.0040 to +0.0666**, share of means at or below 0 **0.0513**.
- POSTs a day, all four keys: 1,420.5 → 870.5, a cut of **38.7 %**. No key reached 600 POSTs on any of the 28 days
  (the busiest key-day 435) or on the five fresh days (the busiest 540). The governor withdrew nothing.

The figures carried into this session ($1.082, $1.054, +$0.028, −0.004 to +0.067, $0.748 and $0.509, 39 %, the cap
not hit) are these at the precision they were stated: +0.0666 is +0.067 to three decimals, 38.7 % was said as 39 %,
$0.5088 as $0.509 and $0.7484 as $0.748. They were not written here until the recompute agreed.

Rule D is the arm that is judged. A faster bar and more keys are not: the study's own rule, written before its runs,
did not choose them, and this file does not either.

## 2. The rule

Arm **d**, the one judged. Everything is PR5V's arm `main` (its pre-registration's §2) except the entry re-price and
the rate the fair price is made from.

- **Books, rungs, size, cap, keys, governor, exits, stops, timing.** As PR5V's `main`: both books, k = 0.03, 0.05,
  0.075, 0.10, 0.125, 0.15, 0.20, 0.25 and 0.30 % ($3,600), the shared 10 % cap, four keys, 600 / 700, exits at fair
  re-priced at 0.03 %, the 24-hour taker stop, the turn at the start of minute t on data to t − 1, an order live from
  t + 1. One call a minute, the same cadence as PR5V.
- **Rule D, entries only.** An entry quote, or a refused entry quote being re-targeted, moves when fair has moved
  toward it by more than max(0.03 %, k/3), or away from it by more than that same step (`away` is unset, so the two
  directions share the step). Exits keep 0.03 %. This is `_steps` / `_moved` of `fastx_sim.py` at the hash above,
  with `rule = {"frac": 1/3, "away": null}` and `reprice = 0.0003`.
- **The fair rate.** f = fairU / X, as in PR5V. fairU is the one PR5's minute recorded. **X is TrueFX's keyless
  GBP/USD snapshot** (`https://webrates.truefx.com/rates/connect.html?f=csv`, the GBP/USD row, mid of the bid and the
  ask, the timestamp in the row), read once in the call, and only for a minute the call is deciding within three
  minutes of its own clock. A snapshot whose timestamp is more than 60 s behind that clock, or more than 5 s ahead of
  it, or that does not parse, is missing. **Yahoo is the fallback:** the GBP/USD bar PR5 stored for that minute, which
  is also the X of every minute the call is catching up from further back. The minute's record says which one it used.
  TrueFX is not stored as a series of its own, polled on no schedule of its own, and not read by a Worker.

Its reference is `fastx_sim.simulate` at the hash above, called as PR5V's `main` is
(`rungs` the nine, `reprice=0.0003`, `gov={"entry_at": 600, "stop_at": 700}`, `acct` the book and the side, REF
timing) with `rule={"frac": 1/3, "away": null}`. The reading script checks that hash, and `pr5v_sim.py`'s, before
anything else.

Arm **v1**, the deviation, never judged. PR5V's arm `main` exactly: the same rungs, the 0.03 % re-price on entries
and exits, and **PR5's stored X on every minute**, including a minute arm `d` read from TrueFX. It exists so the
shared decision function can be seen to still decide PR5V's minutes. Its days are the check in §5, not a result.

## 3. The engine and its data

- **The engine** is `agents/quotes_ruled.ts`, a call of its own, `agents?action=quotesd`, a row of its own in
  `edge-calls-every-minute` (every minute, all day, PR5's timeout), into tables of its own (`agent_quoted_state`,
  `_minutes`, `_events`, `_trips`, the view `_days`, the function `agent_quoted_reset()`, the lease `quotesd`). It
  decides a minute only once PR5's engine has (`agent_quote_state.last_minute`, the one column of PR5's state it
  reads) and reads the same stored minutes and prints PR5V reads. Of PR5V's tables it reads trips only, and only to
  compute the deviation check below; it writes none of them. It calls no venue. Both arms start flat at 2026-09-28
  00:00 UTC. Each call decides at most 120 minutes, in chunks of 30, and starts none after 10 s.
- **One decision function.** Both arms are a call of `stepVariantMinute`. An arm may set `entryBand(k)`; PR5V's arms
  do not, and neither does `v1`, so for them the comparison stays `reprice`. Arm `d` sets rule D's band. PR5V's
  `VARIANT_CODE_VERSION` is not bumped by that option. A change here that could change arm `d`'s or arm `v1`'s
  decisions bumps this instance's own version, wipes only its tables, and re-decides from 2026-09-28 00:00; that
  change is a deviation.
- **Its test.** Before it is first deployed, and before every later change (`deno test` gates the deploy), a test
  shows: with no `entryBand`, a minute is PR5V's; with rule D's band, an outer rung does not re-price on a move the
  inner rung does; a TrueFX row parses to the mid the study's reader parses, and a stale or empty body is a miss.
  The record counts only if that test passed on the code that wrote it.
- **What it records.** For every book-minute: the X and fairU arm `v1` decided on (PR5's, or rebuilt the way PR5V
  rebuilds), the X arm `d` decided on and whether it was `truefx` or `yahoo`, and the print count. For each arm:
  every POST, withdrawal, fill, exit, stop and trip, as PR5V records them.
- **The deviation, kept as a scalar.** After the minutes of a call are written, the engine sums arm `v1`'s trips and
  PR5V's arm `main`'s trips by the UTC day of entry, over every day either has a trip, and stores the largest
  absolute difference (`checkMaxUsd`) and the number of days (`checkDays`). It does not store a per-market figure.
- **If PR5's record stops** before E, the window ends with it on PR5V's rule (its §3), and this window ends at that
  same day. With fewer than 21 days the test is reported and not judged.

## 4. The window and the reading

- **The window**: the 28 UTC days 2026-09-29 → 10-26. A trip belongs to the day of its entry. **E** = 2026-10-28
  00:30 UTC. The same days as PR5V, so the two pair.
- **The reading**: on or after 2026-10-28 01:00 UTC, when every trip entered in the window has closed and the engine
  has decided every minute before E; at the latest 2026-11-04, or, if it has not then, as soon as it has, reported as
  a deviation. The first session then with the database connector exports the inputs and both arms' records, and
  PR5V's arm `main` trips entered in the window, commits them under `docs/agents/backtests/pr5v/ruled/`, and runs the
  reading script, which is committed before 2026-10-27 00:00 UTC.

## 5. What decides

**The deviation, before any condition.** Arm `v1`'s trips entered in the window and PR5V's arm `main`'s: at least
95 % of each have a trip in the other with the same book, side, k, `t_entry` and entry price in ticks, and the P&L of
the two sets differs by at most 10 % of the absolute value of PR5V's. `checkMaxUsd` over the window's days is under
$0.01. If this fails, the shared function has drifted, the test is not judged, and the failure is the deviation.

**The replay.** The runs of `fastx_sim.simulate` in conditions 1 and 4 are on `Mkt` objects built from the exports,
as PR5V's reading builds them, except that minute t's X is the X arm `d` recorded for that minute. The replay starts
flat at 2026-09-28 00:00 and ends at E. Only trips entered in the window are scored. Before any window data are
opened, the reading script shows that the same call on the study's own markets reproduces §1's rule D runs, trip for
trip and POST for POST (593 trips, $30.3004; 60 trips, $3.7420).

Arm **d** passes when all five hold.

1. **Faithful.** The replay at §2's settings reproduces arm `d`'s trips entered in the window, by PR5V's own 95 % /
   95 % / 10 % rule (its condition 1). A miss caused by the engine's code may be fixed once, the engine then
   re-deciding from 2026-09-28 00:00, and condition 1 is read again; a second miss is a fail. The fix is a deviation.
2. **Above its null.** The window's P&L is above the p95 of `null_twins` of `study.py`, called as PR5V's condition 2
   is (`{"reprice": 0.0003}`, the nine rungs, arm `d`'s trips, the window's bounds, 2,000 draws, seed 20260923), each
   twin run to min(E, m + 2 days). Rule D does not change an exit's re-price, which is what the twin uses.
3. **Better than variant-1, day by day.** The daily difference, arm `d` minus PR5V's arm `main`, over the 28 days: in
   10,000 resamples of circular 7-day blocks (`block_bootstrap`, seed 20261028), the share of resampled means at or
   below 0 is under 0.05. On the study's own 28 days this share was 0.0513 (§1), so the bar is about what that window
   itself would have missed. It is not loosened.
4. **The stress arm above zero.** The replay with `stress=True`: the P&L of its trips entered in the window is above 0.
5. **The governor held.** In arm `d`'s record, every entry POST of a key had fewer than 600 POSTs of that key before
   it on that UTC day, and every other POST but a stop fewer than 700.

**Described, never judged:**

- arm `v1`, beyond the check above;
- %/yr on $3,600, and the gain over variant-1 per extra dollar (rule D locks the same $3,600);
- how many of the window's minutes read TrueFX and how many fell back to Yahoo, and the paired gain on each set;
- trips, POSTs and P&L by book, by side and by rung;
- the key-days on which the governor withdrew entries;
- the minutes rebuilt from `agent_quote_inputs`.

**What §1 expects**, on the study's own rates, which are Yahoo's and Exness's minute bars and not TrueFX. The forward
record's X is TrueFX wherever the call was deciding a current minute, so these are the rule's numbers on the rates
the study had, not a forecast of the TrueFX path: $1.0822 a day against variant-1's $1.0540, paired +$0.0281
(−0.0040 to +0.0666); the fresh five days $0.7484 against $0.5088; POSTs down 38.7 %; no key at 600.

## 6. What a pass allows, and what it does not

- **A pass says** rule D made more dollars than variant-1 on the same days, on the rates this instance actually
  recorded. It does not say a faster bar, or a fifth key, would have done better. It does not by itself move any
  money: four funded sub-accounts and a live executor are PR5V's question, and Davies has deferred the £50 test.
- **Both arms stop at the reading, pass or fail, unless Davies says otherwise.** PR5 and PR5V are untouched either way.

## 7. What it cannot show

- **A queue, latency, and the venue's 1,000-a-day limit**, as in PR5V's §7. TrueFX does not shorten the minute the
  order waits: the turn is still once a minute, and an order is still live from the next minute.
- **That TrueFX was the rate in §1.** Those runs used the study's bars. A minute caught up after the fact, or a
  minute TrueFX did not answer, is Yahoo's bar, and the reading says how many of each the window held.
- **Another regime.** The books tightened in the week of 2026-08-24, as PR5V's file says.

## 8. Seen before the freeze

- The fast-X study's committed results, and §1's recompute, both on data that ends 2026-09-28 00:00, before the window.
- PR5V's reference timing, $1.0540 and $0.5088, reproduced again by the same recompute.
- The order of the choice. Rule D was declared in the fast-X study before any of its runs. Putting it on paper, at
  PR5V's minute rather than on a faster bar, was Davies' call after that study, and after §1 was recomputed. TrueFX
  was the study's fastest keyless source; this file uses it as the live rate and does not adopt the faster bar.
- The engine is built after the freeze. The rule is fixed by `fastx_sim.py` at its hash and by the test in §3, so
  nothing seen while building it can change a decision. PR5V's engine is not edited in order to re-decide its minutes.

## 9. Deviation 4 (2026-10-09): the 0.03 % rung leaves rule D's twin, not this test's arm

Deviations 1–3 are recorded in reference §4 item 47. Davies, 2026-10-09, after reading
`2026-10-09-stablecoin-quotes-review.md` (F7: in the twin, the 0.03 % rungs made 114 trips for +£0.26 to 10-09, about
0 bps a trip, and spent the POSTs that took it over one account's 1,000 a weekday), verbatim: "…"规则 D 最内层的档位基本不赚钱"
这个档删了" (delete the rung that makes about nothing).

**What changes.** Only rule D's realistic twin (`d`, the TESTING row, "Stablecoin quotes variant-4" from `0108`): from
2026-10-10 00:00 UTC it quotes no entry on the 0.03 % rungs; a holding there still exits (the twins'
pre-registration's deviation 4, its §15, says exactly what changed).

**What does not change, and why.** This file's engine: arms `d` and `v1` keep their nine rungs (`quotes_ruled.ts`
unedited, `RULED_CODE_VERSION` 4, nothing re-decided). Arm `d` is judged against `v1` (§5), and the two must differ by
rule D alone (deviation 2); a rung dropped from `d` would add a second difference and, by the rule above, re-decide the
whole record from 2026-09-28. So the 10-28 reading reads an arm unchanged through its window, by its script, bar and date;
it says it was not blind (the review read both arms' records) and names this deviation.

**Proposed, not run**, for what Davies asked about the rung: beside the reading, a descriptive line on arm `d` without its
0.03 % rungs (its trips there taken out over the whole window, both before and after 10-10, since the paper arm never
changed), and on the twin's two spans (nine rungs to 10-09 23:59, eight from 10-10) apart. Neither is a condition; a rule D
without that rung for a live executor would be a pre-registration of its own.
