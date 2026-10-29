# Pre-registration: "Stablecoin quotes variant-8", LIVE's rules with every exit one tick beyond fair (2026-10-29, migration `0175`)

**Status: FROZEN** at the commit that adds this file and the migration `0175`. Not blind: the study whose one pass this tests
read every record (no no-peek rule since 2026-10-04), and this reading says so.

## 0. On whose word

Davies, 2026-10-29: "好的，建 variant-8，在实盘live的基础上" (good, build variant-8, on LIVE's live rules), answering REVX-LAG's
recommendation (`docs/agents/reviews/2026-10-29-revx-lag-study.md` §6): a paper twin of LIVE's rules with `exitOffset` one tick,
beside the LIVE twin, pre-registered.

## 1. What it is, and its control

Two twins, the same in everything but the offset:

| | `live600x1` "Stablecoin quotes variant-8" | `live600ctl` "Stablecoin quotes LIVE control from 10-29" |
|---|---|---|
| engine, keys | PR5's rule (`pr5`), the live account's one key | the same |
| rules | LIVE's as `live600` has them: its fill rule ("at") from the start, its weekend from the closure of 2026-10-30 21:00 UTC (`live600`'s own instant; no closure falls between the start and it), no take; LIVE's exits meeting the book (`exitTicksOnBook`, every instance since 2026-10-29 00:00, no rule key) | the same |
| exits | **one tick beyond the rule's, in the position's favour** (`rules.exitOffset` `{ticks: 1}` from the start), then met with the book as every exit is | the rule's, met with the book |
| capital | £600: twelve rungs of £50, both books, as `live600` | the same |
| start | 2026-10-29 19:00 UTC, flat, no backfill | the same |
| page | TESTING, after variant-7 | hidden (`hidden`: it runs, the page shows nothing of it) |

**The control is the comparison.** `live600`, the LIVE twin, has run since 2026-10-27 00:00: it enters the window holding
what it holds, with its own conversions settled and its own record, while variant-8 starts flat and buys its asks' coin at
its first turn. A same-day difference between them would carry that start. The control is variant-8 without the offset, from
the same minute, flat, on the same capital, rungs, fill rule and minutes, so the day-by-day difference is the offset's alone.
`live600` is reported beside it, with no bar.

**The offset** is the driver's rule `exitOffset` (`TWIN_RULES` in `quotes_twin.ts`) and the executor's option
`QuoteLiveInstance.exitOffset` (`quotes_live.ts`, `exitAt`), as they have been since `0108` (p50x1, withdrawn before its
window by `0109`) and unchanged since; this is the first row since `0109` to name it. From its instant each exit the executor
places or re-prices is `exitTicks(fair, side)` plus one tick on a long's sell, minus one on a short's buy-back. That price is
then the rule's price as `exitTicksOnBook` reads it: when the book the turn met shows it crossing, the exit rests one tick
inside the opposite best instead (never worse for us than its own price). The paper engine, the entries, the stops, the
guards and the re-price step are untouched. No code changes with this row.

Its rows exactly as the migration inserts them:

```json
{ "id": "live600x1", "display_name": "Stablecoin quotes variant-8", "display_order": 53, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-29T19:00:00Z", "table_prefix": "agent_quote_twin_live600x1", "lease": "quotes-twin-live600x1", "rules": { "fill": { "model": "at", "from": "2026-10-29T19:00:00Z" }, "weekend": { "from": "2026-10-30T21:00:00Z" }, "exitOffset": { "ticks": 1, "from": "2026-10-29T19:00:00Z" } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-29-revx-exit-tick-twin-prereg.md", "migration": "0175", "enabled": true, "hidden": false }
```

```json
{ "id": "live600ctl", "display_name": "Stablecoin quotes LIVE control from 10-29", "display_order": 54, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-29T19:00:00Z", "table_prefix": "agent_quote_twin_live600ctl", "lease": "quotes-twin-live600ctl", "rules": { "fill": { "model": "at", "from": "2026-10-29T19:00:00Z" }, "weekend": { "from": "2026-10-30T21:00:00Z" } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-29-revx-exit-tick-twin-prereg.md", "migration": "0175", "enabled": true, "hidden": true }
```

## 2. Why, and what to expect

REVX-LAG (§5) replayed LIVE's rules on the PR5-OPT engine over Revolut X's whole history (USDC-GBP from 2025-11-26, USDT-GBP
from 2025-12-16, to 2026-10-29), in sample to 2026-05-12, out of sample after. Of every way it tried of leaning on the book's
lag, one passed its bar on every row: every exit a tick beyond fair. For `live600`, out of sample: **+£26.2 a year
[+15.8, +36.6] (90 %), P(≤ 0) 0.000, 12 of 12 months positive**; in sample +£50.0. It held under every fill assumption tried
(through-only +£23.5; a quarter of each at-price print +£28.4). Trips 3,592 → 3,516, 24-hour stops 46 → 57, 16.22 → 17.30 bps a
trip. The mechanism: the book's prints scatter about ±20 bps around fair, and the same uninformed flow that fills an exit at
fair reaches one 1.33 bps further a few minutes later.

**In this pre-registration's terms** (`docs/agents/backtests/revx_lag/scripts/power.py` → `results/power.json`: the same pair
of runs, its daily difference in bps of £600, each 28-day window read with this bar at 2,000 resamples):
- out of sample, **+1.20 bps of capital a day** (standard deviation 3.51 a day, 167 days); in sample +2.28;
- **September–October only: +0.27 bps a day**;
- of the 140 out-of-sample 28-day windows, **94.3 % pass** this bar: 100 % of the 85 wholly in May–August, **85.5 % of the 55
  that end in September or October** (their median mean +0.41 bps a day).

That is the expectation, not evidence, for four reasons the reading must name:
1. **The gain has faded.** By month for `live600`, £: Nov 0.44; Dec 2.73; Jan 3.53; Feb 3.29; Mar 5.75; Apr 5.74; May 2.55;
   Jun 3.31; Jul 3.90; Aug 2.75; **Sep 0.45; Oct 0.44**. The two months LIVE itself has traded are the weakest.
2. **LIVE's own fills are in the tape.** Since 10-01 the replay's prints include LIVE's own trades, so its last weeks partly
   replay LIVE against itself.
3. **The F3 replay of 2026-10-09 found the contrary.** The twins' own code over 09-23 → 10-09 (`backtests/scq_f3/`), its
   baseline equal to the twins' records to the penny, found one tick beyond fair losing on `p50` (−£0.198) when a print at the
   exit's price fills it, and winning only under the through-only rule; LIVE had filled 22 of its 44 maker exits with no
   print through them. That is why `p50x1` was withdrawn (`reviews/2026-10-09-p50x1-prereg.md` §7): it ran through-only, and
   could see only the side that favours the offset. **These twins run LIVE's "at" fill rule**, the side F3 found losing, so
   this window reads what p50x1's could not. Those 16 days fall in the replay's weakest stretch.
4. **`exitTicksOnBook` is not in the replay.** Since 2026-10-29 every instance rests an exit the book shows crossing one tick
   inside the opposite best instead of refusing it. Both twins run it. An exit a tick further from the touch crosses less
   often, so the rule moves fewer of variant-8's exits than the control's: that interaction is part of what this window
   measures, and is what LIVE would get. The reading counts, per twin, the exits it moved (`request.ruleTicks`).

## 3. Window, reading and bar

- **Window:** the 28 days 2026-10-29 19:00 → 2026-11-26 19:00 UTC, each day 19:00 → 19:00. If the migration applies after
  the start, both twins catch up from it on PR5's own record together, and the reading says so.
- **Reading:** on or after 2026-11-27 19:00 UTC (a day for the window's last trips to close), by a script committed before
  2026-11-26 19:00 that computes exactly what follows. It may be read beside variant-7's and PR5-OPT's readings; it waits on
  none of them.
- **What is read, for each twin:** its round trips as the page computes them (`liveRungTrips` over its filled orders, fees
  in), realised by the window day a trip closes, in pounds; a rung still holding at the window's end marked at the book's last
  print.
- **The statistic:** each day's difference d = (variant-8 − control) ÷ £600 × 10,000 (bps of capital); its mean over the 28
  days; a circular 3-day block bootstrap of that mean, 10,000 resamples, seed 20261127, and the share of resampled means at or
  below 0.
- **The bar: PASS when the mean is above 0 and the share at or below 0 is under 0.10.** Anything else is not a pass.
- **Reported beside it, no bar:** variant-8 − `live600` the same way; each twin's fills, round trips, bps a trip, 24-hour
  stops and median hold; the exits `exitTicksOnBook` moved, per twin; the two halves of the window; the weekdays and the
  closures apart.
- **What a pass means:** the offset is a candidate for LIVE's own instance (`QUOTE_LIVE_INSTANCE.exitOffset`), which is
  Davies' decision alone and its own change with its own record; nothing here moves money. A fail closes REVX-LAG's one lead.
- **Health, daily, until the reading:** each twin's `_sim` row's `last_error`, its `paperCheck` mismatches, its mode and
  state's `updated_at` against PR5's call, the twins call's beats, no `ops_errors` `agents.quotes_twins`.

## 4. Its record before now

None: both start flat at 2026-10-29 19:00 UTC, with the operator's maker conversions at their first turn.

## 5. Frozen files

| file | sha256 |
|---|---|
| `supabase/migrations/0175_quote_twin_exit_tick.sql` | 73868da145d4761e2c80e643ded609f3b781132c1189d38dbce8265fd77be4be |
| `supabase/functions/agents/quotes_twin.ts` | c14d9138ca27cf859d0efe586698b3cfce390d715810fe7338989f00ec6a8de5 |
| `supabase/functions/agents/quotes_live.ts` | 12e3dad7cc9058cedc7cd840fc4ac5d3396b955c842e39fd70f22f18cfad25eb |
| `supabase/functions/agents/revx_sim.ts` | 7f05baba5a1a066166791e184ddac505bcd692865864dd219172d4c87569cc47 |
| `supabase/functions/agents/quotes_weekend.ts` | b811ca70b761f85ffa8c8ab00096cece8e06177763c64c2f8806985610d657a2 |
| `docs/agents/backtests/revx_lag/scripts/power.py` | 48db11c32599ee7e13f369b8d290cfd4387328da86e5e9b9ab0c9fccbba282f9 |
| `docs/agents/backtests/revx_lag/results/power.json` | d40eb0237e288a0b60f509d7819781da8b5a3ef5becd7f4f1b53ed456d5d70bc |

The driver, the executor, the simulator and the weekend rule are the bytes variant-7's pre-registration froze
(`reviews/2026-10-29-revx-usdc-nudge-twin-prereg.md` §5) and its deviation record names: nothing of them changed for this row.
A change to a frozen file after the freeze is a deviation: reported here, in an addendum, and in the ledger.

## 6. Disclosures before the freeze

REVX-LAG's replays (§3–5 of its review) and this page's window replay were read in full before this was written; no forward
record of either twin exists. The replay's out-of-sample half ends on 2026-10-29, before this window starts. No frozen file
changed to add these rows.

## 7. Deviations

None yet.
