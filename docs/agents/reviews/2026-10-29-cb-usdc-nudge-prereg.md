# Pre-registration: "Stablecoin quotes with Euros - 3", "- 2"'s rule on USDC-GBP with its fair nudged by Revolut X in FX closures (2026-10-29)

**Status: FROZEN** at the commit that adds migration `0168` and `agents/cb_nudge.ts`. Any later change is a deviation, written in
§7 with its date and reason. It changes no other test or reading: "- 2" ("with Euros - 2", `2026-10-26-cb-usdc-prereg.md`, $50 a
rung since its Deviation 2), the weekend variant and the base test run as their own pre-registrations say.

## 0. On whose word

Davies, 2026-10-29, verbatim:

> 建USDC 那个线索，在with euro-2的基础上开-3，只做300美元的USDC-GBP；另外把目前的-2数字*2做600美元funded

(open "- 3" on the USDC lead, built on "with Euros - 2", USDC-GBP alone at $300). Then, choosing between the nudge in every minute
and the nudge inside FX closures alone, after the replay of §2:

> -3 只在休市时用

(use it on "- 3" only while the market is closed).

## 1. What runs

- **The rule is "- 2"'s.** `runCbUsdcArm` (`cb_usdc.ts`) runs unchanged on the recorder's prints: PR5's `stepMinute`, the GBP/USD bar
  held through a closure up to 60 hours, the release blackout, Coinbase's stop cost, the pounds of a trip. It starts at the first
  00:00 UTC after its first run (`cbHoldStart`).
- **Its book is USDC-GBP alone**, at $50 a rung (the engine's $100 ÷ 2), six rungs: **$300**. It has its own tables
  (`cb_nudge_*`), lease (`cb-nudge`) and call (`agents?action=cbnudge`, 0168).
- **The one difference is the fair** (`cb_nudge.ts`), the REVX-FAIR study's lead (`2026-10-29-revx-fair-price-study.md` §5)
  mirrored onto Coinbase, with the definitions its §8 replay used (`backtests/fair_price/scripts/cb_mirror.ts`):
  - **RX** is Revolut X's USDC-GBP mid, read from the Revolut X recorder's newest `agent_book_levels` snapshot stamped before the
    minute: its own best bid and best ask (LIVE's resting orders included), a touch no wider than 1 %. There is none when the
    minute is more than 5 minutes past the snapshot's `seen_until`.
  - **fair** is the minute's own book fair (fairU ÷ X) in a lit minute (not dark, not in a release blackout).
  - **g** = RX − fair. Its EMA has a **24-hour half-life**: each update moves it 1 − 0.5^(minutes since the last ÷ 1,440) of the
    way. It is updated with the minute's own g before use, wherever both exist, and kept in the state.
  - **d** = g − EMA.
  - **The fair quoted is fair + ½ × d**, only **inside PR5-W's FX closures** (`inQuoteClosure`: Friday 21:00 → Sunday 21:00 UTC,
    24 December 21:00 → 25 December 21:00, 31 December 21:00 → 1 January 21:00), and only while |d| < 50 bps of fair.
    `CB_NUDGE_SCOPE` = "closures" is the row's rule, on Davies' choice in §0.
  - Everywhere else it is fair as "- 2" quotes it. The EMA moves in every lit minute, in a closure or not.
- **Every quote, exit and stop is priced off that fair.** The minute record keeps the fair quoted (`fair`), the un-nudged one
  (`fair_raw`), RX and its snapshot's stamp, d, the EMA and whether d was applied (`nudged`).

## 2. Why, and what is in sample

- **§5 of the study (in sample, 10-11 → 10-29).** Nudging Revolut X's USDC-GBP fair by Coinbase's USDC-GBP gained +0.64 bps of
  capital a day ("at"), all 42 settings positive. §6 recommended it as a Revolut X twin.
- **§8, the mirror (in sample, the same 18 days, -2's own engine at $50 on USDC-GBP; it reproduces -2's trips exactly).**
  - Every minute: −0.14 bps of $300 a day (band −1.61 to +1.25, P ≤ 0 0.56). 13 of 16 settings are below the base.
  - **Inside closures alone: +0.21 bps a day (band +0.05 to +0.39, P ≤ 0 0.01), +0.23 and +0.20 in the two halves**, 66 trips,
    10.13 bps a trip.
  - The base (this rule without the nudge) made 5.57 bps a day, 64 trips, 10.21 bps a trip.
  - Over a weekend the held GBP/USD freezes Coinbase's fair, and Revolut X's book is the one live sterling price it can hear.
- **The expected gain is small**, about a twentieth of the base: about +0.2 bps of $300 a day. The scope was chosen on those 18
  days, so this is a forward test of a setting seen in sample.
- **This code is the replay's rule.** Run in the replay's own loop on its committed data (98d94c49), `rxMidAt` gives the replay's
  RX in all 27,360 minutes. `nudgeStep` gives its trips: 65 of 65 identical in closures (8,460 minutes nudged, as the replay's)
  and 67 of 67 in every minute. The ledger has the run.

## 3. Hypothesis

"- 3" makes more than "- 2"'s USDC-GBP book over the same days, at the same size, the nudge the only difference.

## 4. Window, reading and bar

- **Window:** 28 UTC days from "- 3"'s first decided minute (`cb_nudge_state.state.startedAt`, a 00:00 UTC).
- **Comparison:** "- 2"'s USDC-GBP book over the same 28 days (`cb_usdc_trips` where `book = 'USDC-GBP'`). It runs at $50 a rung
  from its Deviation 2's switch (2026-10-29 12:00 UTC or later, before "- 3" starts), on the same prints, rates and driver.
- **Reading:** on or after the window's end, with read-only SQL, by a script committed before the window ends. Trips are bucketed
  by their close's UTC day (`t_exit`), money in pounds as both tables keep it, in bps of $300 at the window's mean GBP/USD.
- **Bar:** the daily P&L difference, "- 3" minus "- 2"'s USDC-GBP book, over the 28 days.
  - A circular day-block bootstrap: blocks of 3 days, 10,000 resamples, `random.Random(20261126)`, of the mean daily difference.
  - **"- 3" passes if P(mean ≤ 0) < 0.10.**
- **Reported beside the bar:**
  - each arm's fills, round trips, P&L and bps a trip (P&L ÷ notional);
  - the difference in closures and on weekdays apart (trips by entry minute);
  - the minutes nudged, and the minutes with no fresh RX;
  - the stops;
  - the daily-difference series.
- **A pass** makes the closure nudge a candidate for the Coinbase arms; Davies decides. **A miss** retires "- 3".
- **Health**, daily:
  - `cb_nudge_state.last_error`;
  - `last_minute` within a few minutes of the recorder's coverage;
  - `agents?action=cbnudge` beating each minute;
  - no `agents.cb_nudge` in `ops_errors`;
  - RX fresh in most minutes (§8 found 0.56 % without).

## 5. Frozen files

| file | sha256 |
|---|---|
| `supabase/migrations/0168_cb_usdc_nudge.sql` | 60eab69942dfe88be5bc0bf0a4ff15672ca2356e33d2f4e18377aad469fad1ec |
| `supabase/functions/agents/cb_nudge.ts` | 1dfffcc92036dd1d12001c2eacffee848c500f1617b60260ec57391cdfa63b45 |
| `supabase/functions/agents/cb_nudge.test.ts` | 770c4c0a327371615b657e357adec8c4fef08a56601b215d9c721d679f0df033 |
| `supabase/functions/agents/cb_usdc.ts` | 0f54887c0e5b96941b697b76390214cfeea7045c96f7f41f41eca8d70d09d7b9 |
| `supabase/functions/agents/quotes_weekend.ts` | b811ca70b761f85ffa8c8ab00096cece8e06177763c64c2f8806985610d657a2 |
| `supabase/functions/agents/quotes.ts` | 0782ed8140a2e490f19b9e92fe7093c2cb9a6f205866180314f609537277f517 |

`src/cb_nudge_prereg.test.js` pins them.

## 6. Disclosures before the freeze

- The study's §5 and §8 were read in full. The scope ("closures") was chosen after §8's replay, on the same 18 days. In sample, not
  blind.
- §8's replay read Coinbase's prints from the recorder's minute summary (`cb_print_minutes`). The engine reads `cb_trades`. Where a
  second held several prints the two can differ by a minute or a tick (§8: -1's reproduction 48 of 56 trips identical).
- RX is the raw top of Revolut X's book, LIVE's own resting orders included, as the replay's headline. The clean mid did worse
  there (§8).

## 7. Deviations

- **Deviation 1 (2026-10-29, before the start; migration `0170`): the start moves to 2026-10-29 08:00 UTC.** Davies, 2026-10-29 about 07:20 UTC: "你新做好的两个测试策略现在就上线" (the two new test strategies go live now). The row's
  record had been opened at its first run (07:22 UTC) with `startedAt` the next 00:00; `0170` sets `startedAt` to 08:00 and
  `lastMinute` to 07:59, guarded on the old start, before any minute was decided (flat books, no EMA yet). Its 28 days run
  2026-10-29 08:00 → 2026-11-26 08:00 UTC, its days 08:00 → 08:00, compared with "- 2"'s USDC-GBP book over the same days;
  everything else (the scope, the statistic, the bar, the seed, the expectation) is as frozen above.

**Deviation 2 (2026-10-29): Coinbase's own coin price.** Davies, 2026-10-29, verbatim, after the CB/OKX fair-price study:

> 目前coinbase的测试策略全部直接改用coinbase自己的币价而不是revolutx的

(every Coinbase test strategy switches straight to Coinbase's own coin price instead of Revolut X's).

"- 3" runs "- 2"'s driver, and that switched with "- 2"'s Deviation 3 (the base test's Deviation 5). Its one book is USDC-GBP, so from
the switch its coin value is 1 under the de-peg guard, over the same FX bar:

- **The change.** From the switch the coin's dollar value (fairU) is the CB/OKX fair-price study's `cb_live`
  (`reviews/2026-10-29-cb-okx-fair-price-study.md` §3, `backtests/fair_price_cb_okx/scripts/prod.py` and `hist.py`), in place of
  the median of Revolut X UK's USDC-USD or USDT-USD hourly closes (F3). The FX bar, the rungs, the fill rule, the stop and the
  release blackout are unchanged; `stepMinute` (quotes.ts) is not touched, so Revolut X's rows are byte for byte as they were.
  - **USDC is 1** (Coinbase converts USDC to dollars 1:1 and lists no USDC-USD book).
  - **USDT is Coinbase USDT-USD's own price**: the close of the latest one-minute candle that started in [t − 10 min, t − 1 min]
    (`fxBarAt`, the study's `bar_at`). The base test's call fetches Coinbase's public candles each minute (keyless,
    `api.exchange.coinbase.com/products/USDT-USD/candles?granularity=60`, completed minutes only, `fetchCbUsdtUsd`). It stores them
    in `cb_quote_inputs` (kind `cb:USDT-USD`), and every Coinbase arm reads them there.
  - **Stale:** with no candle in those ten minutes, the USDT book's minute is dark, as the study's fair was None. No last value is
    held longer, even on the weekend arm, whose study replay also read USDT for ten minutes and held only the FX bar.
- **The de-peg guard (not in the study, which modelled no de-peg; its stated risk).** A coin value more than **50 bps** from an
  outside reference darkens the minute, and so does a missing reference (`cbCoinFair`, `CB_DEPEG`).
  - The reference is Revolut X's F3, the value the fair used before the switch.
  - A dark minute places no entry. A resting exit stays and can fill, a due exit waits for a lit minute, and the 24-hour stop
    runs, as in a release blackout.
  - USDC is guarded too: |1 ÷ F3 − 1| > 50 bps is a USDC de-peg.
  - F3 is a 24-hour median, so it survives an outage of PR5's paper inputs of up to about a day. Only then do the rows go dark,
    as they would have before.
  - On the study's own production inputs (2026-10-10 → 10-29, 27,360 minutes) the guard would never have fired: the largest gap
    was 13.5 bps for USDT and 14.0 for USDC. A USDT candle was within ten minutes in every minute. So on that record this rule is
    the study's `cb_live` exactly.
- **The instant.** The first minute each row decides at or after 2026-10-29 08:00 UTC (`CB_LIVE_NOT_BEFORE`): in practice the
  first minute after the deploy. It is written once into the row's state as `liveFrom` (`cbLiveSwitch`). There is no backfill: the
  record before it stays as it ran, and nothing on the page is rescaled (sizes did not change).
- **Why** (the study, in sample and out):
  - The fair had sat below the market on every book (weekday median of the touch mid over the fair: +2.2 bps USDC-GBP, +5.6
    USDT-GBP, +5.9 USDC-EUR, +8.9 USDT-EUR). 2 to 5 bps of that was Revolut X's dollar price, which traded under Coinbase's.
  - That is why 136 of 137 USDT fills were asks, and why 32 of 146 base trips ended at the stop.
  - `cb_live` on history out of sample: +£6.1 a year on £2,400 [−14.5, +27.5]; the weekend arm +£13.0 [−9.2, +36.4]. Stops fell
    60 → 7 and the worst day went −£3.10 → −£1.40. On the 19 production days: +£13.8 a year [−39, +73] and +£17.9 [−45, +90],
    stops 32 / 40 → 0 / 4.
  - None of these is significant. The case is the bias removed, the stops, and the rows no longer reading PR5's Revolut X inputs
    for their price.
- **The reading is read on the record as it ran.** The minute record's `fair` is the fair the minute was decided on (the new one
  from the switch). So the replay of bar 1 reproduces the engine without knowing the rule changed, and every threshold, window and
  seed is unchanged. The report says where the switch fell and what share of the window it covered.
- **The nudge keeps its definition.** g = RX − fair, its 24-hour half-life EMA, d, ½ d inside FX closures, the 50 bps and 5-minute
  rules. "fair" is now the new one, 1 ÷ GBP/USD, in place of Revolut X's USDC-USD F3 ÷ GBP/USD.
- **§2's expectation was measured on the old fair.** The §8 replay (+0.21 bps of $300 a day in closures) nudged a fair priced on
  Revolut X's USDC-USD F3, which traded about 2 bps under par in its window. On the new fair the EMA absorbs a steady gap, so d
  measures the same moves off it. Whether +0.21 holds on the new fair was not replayed. The reading compares "- 3" with "- 2"'s
  USDC-GBP book, which switched by the same rule at about the same minute, so the comparison stays like for like.
- **Its window starts at 2026-10-29 08:00 UTC** (Deviation 1), the same floor as this switch. Every minute "- 3" decides at or
  after its `liveFrom` is on the new fair. Minutes it decided before that (if the old code was still deployed when the window
  opened) stand as they ran on the old fair. The reading reports how many there were, and "- 2"'s book switched by the same rule
  at the same deploy.
- **Frozen bytes this deviation names** (`src/cb_nudge_prereg.test.js`, which holds the earlier ones as well):

| file | sha256 (Deviation 1) |
|---|---|
| `supabase/functions/agents/cb_usdc.ts` | 87e4b3bb832b072027ac53affee6716451d2933af06681dbf8aa8d6640ae2771 |
| `supabase/functions/agents/cb_quotes.ts` | 3d267f849a8aeec704c880dc9a7da20ac19b5653117778cedff828615b468a6c |

**Deviation 3 (2026-10-29): its display name.** Davies, 2026-10-29: "…-2和-3都减小一个数字". This arm's display name is
**"Stablecoin quotes with Euros - 2"** from today ("- 3" until then; `CB_NUDGE_PAGE_NAME` in cb_page.ts). Its comparison arm,
"- 2" in §3–§4, is now displayed as "- 1". Display only: ids (`coinbasenudge`, `coinbaseusdc`), tables, calls, rule and reading are
unchanged, and `cb_nudge.ts` keeps the name it was frozen with. No bytes named.

**Deviation 4 (2026-10-29): the rate at second resolution.** Davies, 2026-10-29, verbatim:

> coinbase的所有策略用更多秒级数据更长时间再深度回测验证下，如果还是正向优化的话把所有coinbase策略的汇率数据源从yahoo换为刚才研究的最佳秒级数据源+fallbacks

(backtest every Coinbase strategy again on more second-level data over a longer time; if it is still an improvement, switch every
Coinbase strategy's FX source from Yahoo to the best second-level source just studied, with its fallbacks).

This arm runs "- 1"'s driver ("- 2" in §3–§4), and that switches with "- 1"'s Deviation 5 (the base test's Deviation 7). Its
one book is USDC-GBP, so from the switch its GBP/USD is read at second resolution, the closure held as before:

- **The change.** From the switch, GBP/USD and EUR/USD at minute t are read from the second-level recorder's `fx_ticks` (0172)
  in place of Yahoo's one-minute bar (`agents/cb_fx.ts`, `cbRatesAt`, called by every Coinbase driver):
  - **The cap.** The newest read that ARRIVED at or before **t + 58 s** (`CB_FX_CUTOFF_MS`), two seconds before minute t's
    orders go live at t + 60 s. A read that arrived at t + 59 s is not used. The call decides minute t at about t + 120 s
    (§8.3: 08:26 decided at 08:28:00.5), so without the cap it would read quotes from after go-live.
  - **The source.** TrueFX's read; Kraken's read only where the recorder marked it `fallback` (TrueFX unhealthy with the market
    open, `fx_rec.ts`), and only when it is newer than TrueFX's newest. Kraken's routine, unmarked reads are never used.
  - **The level is raw.** The source's own mid, (bid + ask) / 2: nothing is carried over from Yahoo. §8.1 found raw against
    Yahoo-aligned a tie (£0.2–3.5 a year either way); raw drops the Yahoo dependency and Yahoo's +2.82 bps over the tick sources
    on EUR/USD. §8 gives no raw figure for this book alone; the level is the arm's driver's, as its comparison arm's.
  - **Fresh.** That read is used while it arrived no more than **120 s** before t + 58 s (`CB_FX_FRESH_MS`, the recorder's own
    `FX_STALE_MS`, after which it turns to Kraken).
  - **The fallback.** No fresh read for the pair: Yahoo's bar by today's rule (`fxBarAt`, the newest bar started in
    [t − 10 min, t − 1 min], bar t − 1 in practice). The call that fetches Yahoo's EUR/USD and Coinbase's USDT-USD each minute
    keeps fetching both, and PR5's paper engine keeps storing GBP/USD.
  - **Closures.** The held minutes are today's, exactly: where no fresh read and no Yahoo bar in ten minutes price a minute, it is
    lit wherever its held bar (`cbHoldBarAt`, 60 hours) is, as before. What it holds is the last fast read if that arrived no
    earlier than the held bar started (`held:truefx`, or `held:kraken`), else the bar itself (`held:yahoo`), as §8 held it.
- **Recorded.** Each minute's record says which source priced its book's own pair (`fx_src`, migration 0173: `truefx`,
  `kraken`, `yahoo`, `held:truefx`, `held:kraken`, `held:yahoo` or `dark`), and the state counts them (`fxCount`). `x_t` (and a
  EUR book's `eur_t`) is now the instant the read arrived, or the bar's start where Yahoo priced the minute.
- **The instant.** The first minute each row decides at or after **2026-10-29 10:00 UTC** (`CB_FX_NOT_BEFORE`): in practice
  the first minute after the deploy. It is written once into the row's state as `fxFrom` (`cbFxSwitch`). There is no backfill:
  the record before it stays as it ran, on Yahoo's bars.
- **Unchanged.** `stepMinute` (quotes.ts, sha256 `0782ed8140a2e490f19b9e92fe7093c2cb9a6f205866180314f609537277f517`) is not
  touched, so Revolut X's rows are byte for byte as they were; so are the coin value and its de-peg guard, the release
  blackout, the rungs, the stop and the pounds of a trip. Only the rate's source changes.
- **The nudge keeps its definition.** g = RX − fair, its 24-hour half-life EMA, d, ½ d inside FX closures, the 50 bps and
  5-minute rules. Inside a closure the fair it nudges is now 1 ÷ the last fast GBP/USD read held, in place of 1 ÷ Yahoo's last
  bar: about 0.3 bps apart in level, which the EMA absorbs as a steady gap.
- **Why** (§8.6): the nudge acts only inside FX closures, where every X is held, so a faster X changes this arm through its
  weekday fair alone. "- 1"'s USDC-GBP book is that: out of sample **+£3.2 a year [+0.3, +6.4], P(≤ 0) 0.032**, in sample
  +£7.3, **20 of 25 months positive** (§8.1). Of that book's gain, trips entered inside closures were −£0.2 a year in sample and
  −£0.1 out of sample. On the production record with its real nudge: +£6.0 a year [−7.3, +20.3], P 0.25 (§8.5).
- **What §8 does not show (§8.7).** TrueFX's history is Exness's ticks in the backtest, not TrueFX's own; L5 (3 s of source age)
  passes every arm too, so a feed up to about 3 s slower than modelled loses nothing measurable. The Kraken fallback was not
  modelled separately (2 s behind TrueFX, EUR/USD 1.3 bps under: inside L5's age and the level tie). The production weeks
  (§8.5) agree in sign and decide nothing alone.
- **The reading is read on the record as it ran.** The minute record's `fair` is the fair the minute was decided on (from the
  switch, on the fast rate). So the replay reproduces the engine without knowing the rule changed, and every threshold, window
  and seed is unchanged. The report says where the switch fell, what share of the window it covered, and how many minutes each
  source priced (`fx_src`).
- **The comparison** with "- 1"'s USDC-GBP book stays like for like: that book switches by the same rule at the same deploy.
- **Frozen bytes this deviation names** (`src/cb_nudge_prereg.test.js`, which holds the earlier ones as well, and
  `src/cb_fx_prereg.test.js`):

| file | sha256 (Deviation 4) |
|---|---|
| `supabase/functions/agents/cb_fx.ts` | c575baf137989e404dc1241303625fa827d6b8614b9fe5d802b057007ee3ab36 |
| `supabase/functions/agents/cb_fx.test.ts` | 3ad6920e4034521873593a156f24f4d84df9b84a69258565f484eaf7958d53f1 |
| `supabase/functions/agents/cb_usdc.ts` | c44e9261cdbaf0e745ac24a83e823a02f87f0be94c3ed98e21da0e320e582f9b |
| `supabase/functions/agents/cb_quotes.ts` | 63f9c34912f337ee4ce707068850cf4fb4f564dd53a14596af7734c1b487f9a6 |
| `supabase/migrations/0173_cb_fx_src.sql` | badcc26a09de690874f4bf6d65e2f202067335c70989abc94044bde8c4944e08 |
