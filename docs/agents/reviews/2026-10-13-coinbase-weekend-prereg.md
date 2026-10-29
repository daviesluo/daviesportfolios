# Pre-registration: "Stablecoin quotes with Euros - 2", the Coinbase paper test with the interbank rates held through a closure (2026-10-13)

**Frozen at the commit that adds this file.** Any later change is a deviation, written in §7 with its date and reason. The test
it varies is "Stablecoin quotes with Euros" (`2026-10-10-coinbase-paper-prereg.md`, its Deviations 1 and 2); that test, its
files and its reading on 2026-11-08 are not touched. This file does not depend on that reading and changes none of its bars.

## 0. On whose word

- Davies, 2026-10-12, on the first days of the Coinbase test: "coinbase上线后情况如何，有可以优化进步的地方吗". The review that
  answered (`2026-10-12-coinbase-first-days.md`, §6 item 3) ranked a weekend variant the largest candidate: hold the last
  interbank value through a closure instead of going dark.
- Davies, 2026-10-13: "周末变体写预注册然后上线paper trading 策略with Euros - 2" — write the pre-registration for the weekend
  variant, then put it on paper as the strategy "with Euros - 2". Its name is **"Stablecoin quotes with Euros - 2"**.
- This is a paper test. Nothing here trades, quotes on a venue or reads a key.

## 1. The one change, and everything else equal

PR5's rule asks for GBP/USD (and the Coinbase test, for a EUR book, EUR/USD too) and goes dark, quoting nothing and
withdrawing its rungs, when the newest rate bar started more than ten minutes before the minute. Yahoo has no bar from Friday
~22:00 to Sunday ~23:00 UTC, so the base test is dark for 29 % of its minutes (2,961 a week).

**The change: a rate bar is used for up to 60 hours after it started, not ten minutes.** That is all. `cbHoldBarAt` is `fxBarAt`
with `CB_HOLD_MS` = 60 h in place of `QUOTE_FX_LOOKBACK_MS` (`cb_hold.test.ts` pins that with ten minutes the two are the same
function, bar for bar). A new bar replaces the held one the minute it exists. Past 60 hours with no bar the minute is dark, as
the base test's.

| | "Stablecoin quotes with Euros" | "Stablecoin quotes with Euros - 2" |
|---|---|---|
| a rate bar is used for | 10 minutes | **60 hours** |
| books | USDC-GBP, USDT-GBP, USDC-EUR, USDT-EUR | the same |
| prints | `cb_trades` (the recorder's) | the same, read from the window's start |
| rule | PR5's `stepMinute`, unchanged | the same call, on the same inputs |
| sizing | £100 a rung on a GBP book, €100 on a EUR book, six a book; £1,200 + €1,200 | the same |
| fair hours, rungs, re-price, post-only refusal, exit at fair, 24-hour stop, 10 % volume cap | as frozen | the same |
| stop cost | Coinbase's 0.0045 % + half the touch, moved from PR5's after the fact (`cbStopExit`) | the same |
| pounds | each trip at the book's pounds per unit when it closes | the same |
| tables | `cb_quote_*` (0112) | `cb_hold_*` (0118): state, events, trips, minutes, days |
| call | `agents?action=cbrec` (the recorder, then the paper step) | `agents?action=cbhold`, its own row of `edge_calls`, `retry` true |
| window starts | 2026-10-11 00:00 UTC | the first 00:00 UTC after its first run (§3) |

Where it gets its inputs: the recorder's state row (`cb_rec_state`) and prints (`cb_trades`); PR5's stored GBP/USD and hourly
dollar-book closes (`agent_quote_inputs`); and Yahoo's EUR/USD **as the base test's call stores it** (`cb_quote_inputs`), which
this arm reads and does not fetch. So it stands on three things it does not run: the recorder, the base test's call and PR5's
paper engine. If any stops, this arm stops with it (its EUR books for the second). That is written down, and nothing is
substituted.

It is exactly the "wkend" arm of `docs/agents/backtests/cbreview/scripts/cbk.py` (the first-days review, §6 item 3), whose
closure rule is: the interbank series (GBP/USD and EUR/USD) filled minute by minute across every gap of more than ten minutes
and up to 60 hours with the last value before it. The live rule and that one agree on every gap of 60 hours or less, and the
history has none longer in the last 12 months (the longest is 51 hours); they differ on a longer gap (the GBP/USD series has four
of 72 hours, around Christmas and New Year in 2020 and 2023), where the history stays dark all through and this arm holds the first
60 hours and then goes dark.

## 2. Why

The review's in-sample figures (PR5's frozen simulator on Coinbase's minute bars, £100 a rung on the four books, £2,400; the same
run as the base arm in `cbreview/results/cbk.json`, which reproduces `compare.json`):

| window | base £ a year (trips) | held £ a year (trips) | held % a year |
|---|---:|---:|---:|
| last 12 months | 192.95 (2,844) | 259.36 (3,539) | 10.8 |
| last 90 days | 143.96 (432) | 211.22 (576) | 8.8 |
| since 2026-08-24 | 232.79 (297) | 331.47 (386) | 13.8 |
| last 28 days | 315.24 (242) | 438.91 (312) | 18.3 |

- The 755 trips entered inside a closure in the last 12 months made +£74.15; of 52 weekends 47 were positive (median +£1.25,
  worst −£3.67, best +£7.11); 120 of those trips were stopped (stop P&L +£11.18, worst trip −£0.66); the maximum drawdown was
  £6.38 against the base's £5.69. The risk the history includes is the Sunday-open gap.
- What history cannot say: whether the engine, fed by the minute recorder, behaves as the simulator does across a closure, and
  whether the next four weekends look like the last 52. That is what this test reads.

## 3. Window, reading and bar

**Window.** 28 UTC days from `cb_hold_state.state.startedAt`, the first 00:00 UTC after the call's first run (`cbHoldStart`):
the record begins flat then and decides nothing before it. Where that falls decides how many whole weekends the window holds (a
weekend is a closure, Friday ~22:00 to Sunday ~23:00 UTC):

| first run before | window starts | window ends (read from 00:30 UTC) | whole weekends |
|---|---|---|---:|
| 2026-10-14 00:00 | 2026-10-14 | 2026-11-11 | 4 |
| 2026-10-15 00:00 | 2026-10-15 | 2026-11-12 | 4 |
| **2026-10-16 00:00** | **2026-10-16, the latest start that holds four** | 2026-11-13 | 4 |
| 2026-10-17 00:00 | 2026-10-17 | 2026-11-14 | 3 |

(The four whole weekends are those of 10-16/18, 10-23/25, 10-30/11-01 and 11-06/08.) If the first run is after 2026-10-16 00:00 UTC
the window starts at the next 00:00 anyway, and has three whole weekends or fewer: bar 6 counts the whole ones, and the report
says how many. The ledger holds the instant it started.

**Reading.** On the day after the window's 28th day, from 00:30 UTC, by `docs/agents/backtests/cbwk/scripts/replay_wk.py` on the
export below. It is not blind (§6); its report says so. The base test's own reading (2026-11-08) is separate and is not waited on.

**The export** (select only; one JSON, saved to a file):

```sql
with s as (select to_timestamp((state->>'startedAt')::bigint / 1000.0) as a from public.cb_hold_state where id = 1)
select json_build_object(
  'start', (select a from s),
  'minutes', (select json_agg(m order by book, minute) from public.cb_hold_minutes m, s where m.minute >= s.a and m.minute < s.a + interval '30 days'),
  'trips', (select json_agg(t) from public.cb_hold_trips t, s where t.t_entry >= s.a and t.t_entry < s.a + interval '28 days'),
  'base_trips', (select coalesce(json_agg(t), '[]'::json) from public.cb_quote_trips t, s where t.t_entry >= s.a and t.t_entry < s.a + interval '28 days'),
  'eur_gbp', (select x from public.cb_hold_minutes, s where book = 'USDC-EUR' and x is not null and minute < s.a + interval '28 days' order by minute desc limit 1));
```

plus `twin_days` and `twin_capital_gbp` added by hand from the page: the twin "Stablecoin quotes" (£1,200)'s DAYS (the dashboard
payload's `quotesTwins[0].detail.days`, `realisedGbp` by day).

**Bars.** Bars 1 to 5 are the base test's five, applied to this arm on its own window; bar 6 is new. All must hold for the hold to
be worth running instead of the base rule on Coinbase:

1. **Faithful.** `replay_wk.py` replays this arm's minute record (`cb_hold_minutes`) with PR5's frozen `pr5_sim.simulate`, through
   the base test's own `replay.py` (imported, unchanged), and must reproduce the arm's round trips (`cb_hold_trips`) to within
   5 % in number and 10 % in money over the four books, the export giving the money as Deviation 1 of the base test says.
2. **Positive.** Realised P&L in pounds is above zero, and so is the day bootstrap's index 100: `random.Random(20261113)`, 2,000
   draws of the window's days with replacement (trips by entry day), sums sorted, the 101st.
3. **Enough.** At least 6 % a year on £1,200 + €1,200 (the euros at EUR/GBP at the window's last minute with both rates), taken as
   realised P&L × 365 / 28 over that capital.
4. **Not one day.** The best day is at most 40 % of the total.
5. **Against Revolut X, the same days.** Its % a year is at least half the twin "Stablecoin quotes"'s (£100 a rung, £1,200) over the
   same 28 days.
6. **Against the base arm, the same window, paired by weekend.** The base arm is **the same minute record with every minute
   darkened whose rate bar started more than ten minutes before it** (`x` and `fair` null: the base test's rule), replayed by the
   same simulator: the arm and the base arm decide on the same prints and the same rates and differ only in the closure. It is
   cross-checked, not replaced, against the base test's own record (`cb_quote_trips`) over the days that record covers, and the
   gap reported. Then: this arm's realised P&L is above the base arm's, and for the whole weekends (a closure from its first minute
   to the Monday 00:00 UTC after it; a trip belongs to the weekend it ENTERED in) the arm's minus the base arm's P&L is positive in
   all but at most one (3 of 4, or 2 of 3), and its sum is above zero.

**Reported beside the bars, not part of them.** Each weekend's figures; each book's; the stops; the trips entered in a closure
and their stops; the largest loss of a weekend; how many minutes were held and how many dark; what the coins behind the asks moved
against the pound; the daily-P&L correlation with the base test and with PR5's twin and LIVE; and how many minutes the recorder
left a hole open.

**If it passes,** the hold is worth running in place of the base rule on Coinbase, and is a candidate for Revolut X beside PR5-W's
own reading (2026-11-25, which is PR5-W's and is not changed by this). **If bar 6 fails and bars 1 to 5 pass,** the base rule
stays and this arm is reported. **If any of bars 1 to 5 fails,** it is not funded. Funding is a separate decision of Davies'.

**Power.** Four weekends: bar 6 says little. If a weekend is positive with probability 0.9, as the last 52 were (47), three of
four hold with probability 0.95; if it is a coin toss, 0.31. The bar is the rule; the figures decide nothing alone.

**Until the reading, health only:** the call's beats (`agents?action=cbhold`), `cb_hold_state.last_error` and `last_minute`, and
`ops_errors` (`agents.cb_hold`), daily. No no-peek rule exists (Davies, 2026-10-04): the page shows the test as it runs; a look
before the reading is not blind and is reported so.

## 4. Its record before now

None: it starts flat at its window's first minute and reads no print from before it. The in-sample record is §2's, and is the
expectation, not evidence.

## 5. Frozen files

Their sha256 are in `docs/agents/backtests/cbwk/MANIFEST.json` (`frozen`), which `src/cb_hold_prereg.test.js` holds to the files.

- **This arm's:** `supabase/functions/agents/cb_hold.ts` and `cb_hold.test.ts`; `supabase/migrations/0118_cb_hold.sql`;
  `docs/agents/backtests/cbwk/scripts/replay_wk.py` (and the worked world `closure_world.ts` with its export and result).
- **The base test's, unchanged by this commit:** `cb_quotes.ts`, `cb_rec.ts`, `cb_view.ts` and their migration `0112`; `quotes.ts`
  (`stepMinute`, PR5-W's freeze line); `docs/agents/backtests/cbpaper/scripts/replay.py`. The base test's call (`cbrec`) and its
  page read are as they were: the page's read moved into `cb_page.ts` with the same queries, and the base's rows on the page and
  in the browser test's fixture are byte-identical (`cb_quotes.test.ts` still asserts the fixture).
- **Shared and not frozen:** `index.ts` (the new action and the page's second read), `db.ts` (the paged keys of the new tables),
  `testing.ts` (the browser test's fixture) and the page's code (`src/agents/`).

## 6. Disclosures before the freeze

- Every figure in §2 was seen: `cbk.py` was run on 2026-10-12, in sample, over data to 2026-10-09. The idea of holding the rates
  came from the weekend share of dark minutes (29 %) and from PR5-W (`2026-09-28-pr5-weekend-prereg.md`), whose Revolut X reading
  is 2026-11-25. Nothing of this arm has run.
- The first lit day and the first days of the base test were seen (the review). The bars 2, 3, 4 and 5 are the base test's; bar 6's
  thresholds ("all but at most one", a positive sum) were set after seeing that 47 of 52 historical weekends were positive.
- The reading is not blind.

## 7. Deviations

**Deviation 1 (2026-10-13, the window starts a day earlier).** On Davies' word the same evening — start "Stablecoin
quotes with Euros - 2" immediately, do not wait for 2026-10-14 00:00 UTC — §3's start moves one day earlier: the window
is **2026-10-13 00:00 → 2026-11-10 00:00 UTC**, read on **2026-11-10 from 00:30 UTC** (the reading script is frozen;
its bootstrap seed keeps its name, 20261113). Migration `0121` makes the move: one guarded update of the still-empty
state row (its first run was 01:07 UTC 2026-10-13; it had decided no minute), setting `startedAt`/`lastMinute` to
2026-10-13 00:00 and each book's fed floor to the newest trade id before it. No frozen file changes and no bar moves;
the four whole weekends of §3 (10-16/18, 10-23/25, 10-30/11-01, 11-06/08) all still lie inside. What the deviation
costs: the minutes of 2026-10-13 before `0121` landed are decided after the fact, each on the inputs its own minute
had (the recorder's prints, the rate bars that started before it, the hourly closes before it — the engine always
decides a minute from a completed record), at most 60 a run until the arm is current. The reading was already not
blind (§6); its report repeats this. A start at the minute of Davies' word instead was not taken: the frozen reading
buckets its days from a midnight start, and bar 5 compares whole UTC days against the twin.

**Deviation 2 (2026-10-15, before the reading): the same blackout around the scheduled releases as the base test's.** On Davies' word, 2026-10-15
(before 03:03 UTC; the message carries no clock): "目前的两个Coinbase 测试采用发布前后暂停的规则吧，你想办法找到准确的CPI 和非农等的历史发布日期，可以用网站本身的api和数据接口；另外revolut x的规则不需要加这个吗？" — both Coinbase tests take the pause. `cb_hold.ts` withholds the minute's
`fairU` in the seven minutes from one before to five after each release of `cb_releases.ts`, exactly as `cb_quotes.ts` does (Deviation 3 of the base
test's pre-registration, which has the rule, the list, its sources and its limits: the BLS dates are recalled, not fetched, and marked UNCONFIRMED).

- **From which minute.** From the first minute decided after the deploy of the commit that adds these bytes; the first listed release is
  2026-10-28 18:00 UTC, so no earlier minute differs from the rule as it ran. The window (2026-10-13 00:00 → 2026-11-10 00:00 UTC) and its four whole
  weekends are unchanged; it holds four releases (FOMC 10-28, ECB 10-29, BoE 11-05, NFP 11-06); the CPI of 11-10 falls after its end.
- **The reading is read on the record as it ran.** `replay_wk.py` is run unchanged on `cb_hold_minutes` and `cb_hold_trips` as the engine wrote them; the
  blackout minutes carry a null fair, as any dark minute, so bar 1 replays them. The base arm of bar 6 is the same minute record with every
  minute whose rate bar started more than ten minutes before it darkened, and the blackout minutes are dark in both, so nothing in the
  script changes.
- **The paired comparison of the two arms is unaffected.** Bar 6 pairs this arm with the base rule by weekend; the base test gets the same blackout
  from the same list, so the two differ only in the closure. `cb_hold.test.ts` pins that on a world with a release in it the two write the same
  trips, events and minutes.
- **Frozen bytes** (group "this arm's", and "the release blackout's" for the shared module; `src/cb_hold_prereg.test.js`):

| file | sha256 |
|---|---|
| `supabase/functions/agents/cb_hold.ts` | `3795b05c5c3b38b30065c13c6c907e6c684fafe195055d3792d3290b25d365f8` |
| `supabase/functions/agents/cb_hold.test.ts` | `e88b82a4f20ba92256d54278013bee83348d79ef3dc58cd1a95c62d31f3245b5` |
| `supabase/functions/agents/cb_releases.ts` | `fa882d0559d90828d9e4530bf4a640db3454a6be1be70b94ada42bd0ca0b5a63` |

**Deviation 3 (2026-10-29, before the reading): $100 a rung, the record counted in dollars, as the base test's.** Davies, 2026-10-29,
verbatim: first "C，coinbase的也是改用美元", then, of the funded figures the page showed in dollars:

> Coinbase策略中funded数字怎么那么奇怪，都改成整数调整

This arm takes the base test's Deviation 4 unchanged. That deviation has the rule, the factor and the assumption in full.
- **Size.** From the switch, a rung is **$100** of the book's currency: **$2,400 on the four books**.
- **How.** `cb_hold.ts` calls the same `cbUsdSwitch` and `cbMinuteInputs(…, usd)` from `cb_quotes.ts`, on the bars it decides its minute on
  (`cbHoldBarAt`, the rates held through a closure).
- **The instant.** This arm's own first minute at or after 2026-10-29 00:00 UTC with both rates known.
  - It is written to `cb_hold_state.state` (`usdFrom`, `usdGbpusd`, `usdEurusd`, `usdFactor`).
  - The reading quotes them from there.
- **The factor.** 1 / GBP/USD on a GBP book, 1 / EUR/USD on a EUR book, at the instant.
  - At GBP/USD 1.3324 and EUR/USD 1.1151 (the last stored rates when this was written, 2026-10-29 04:06–04:07 UTC) that is 0.7505 and
    0.8968, and $2,400 ÷ $2,937.02 = **0.817** over the arm.
- **The assumption.** Fills and fees scale linearly with size. The page shows what was entered before the instant × its book's factor;
  prices, counts and percentages are not scaled; no row is rewritten.
- **The reading, in dollars, as the base test's Deviation 4 reads its own.**
  - Bars 2 and 4 read a trip's pounds × the window's mean GBP/USD, × its book's factor before the instant.
  - Bar 3 is at least 6 % a year on **$2,400**.
  - Bars 1 and 6 compare `replay_wk.py`'s replay, which sizes a rung at 100 of the book's currency, with this arm's trips at that size:
    a trip entered from the instant ÷ its book's factor. Bar 6's weekend sums are read the same way.
  - Bar 5 and every threshold, the window and the seed are unchanged.
- **The paired comparison is unaffected.** Both arms switch by the same rule. `cb_hold.test.ts` pins that on a world after 2026-10-29
  the two write the same trips, events and minutes, each switching at its first minute.
- **Frozen bytes** (`docs/agents/backtests/cbwk/MANIFEST.json`, groups "this arm's" and "the release blackout's", which keep their names;
  `src/cb_hold_prereg.test.js`, `src/cb_usd_prereg.test.js`):

| file | sha256 |
|---|---|
| `supabase/functions/agents/cb_hold.ts` | `ea081c57918d6c0e6500da7dced0c2a3c57ccd0e8a2e09d9c2cdc06c9aa34fd9` |
| `supabase/functions/agents/cb_hold.test.ts` | `37fece912426eaf8e5af71d45f2c95c3980094d020044a7c991e0e3f8bee5bc8` |
| `supabase/functions/agents/cb_quotes.ts` | `fe88387e54abad68ff3fe5a02fb8f2a768a09ccea860b4ab4a46cbbdd262c465` |
