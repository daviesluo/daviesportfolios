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
