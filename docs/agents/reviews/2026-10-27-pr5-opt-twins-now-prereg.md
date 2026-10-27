# Pre-registration: PR5-OPT's twins on LIVE's rules from 2026-10-27 06:00 UTC, "Stablecoin quotes variant-4" to "-8"

**Status: FROZEN** at the commit that adds migration `0149`. Any later change is a deviation, written in §7 with its date and reason.
Written from `TEMPLATE-variant-prereg.md`, with the same difference as `2026-10-27-pr5-opt-twins-prereg.md` (rules that need code,
built there). It carries that pre-registration's three twins over to new ids from 06:00 today (its deviation 1) and adds two, all
five on `live600` ("Stablecoin quotes LIVE twin", `2026-10-26-live-size-twins-prereg.md`), whose pre-registration it does not change.

## 0. On whose word

Davies, 2026-10-27, verbatim: "variant-4、5、6是在实盘rules的基础上建的吧？为啥要等到29？现在就开始…你再在实盘rules的基础上开variant-7和8测试这两个"
(variant-4, 5 and 6 are built on LIVE's rules, aren't they? Why wait until the 29th? Start them now… and open variant-7 and 8 on
LIVE's rules to test these two). "These two" are the two weightings the study's answer named beyond 2:1: USDT-GBP 3:1, and
USDT-GBP alone. Then, the same day: "做好后variant-4和5与5和6替换，这样的话usdt比例大的放一起" (once built, swap them so that the larger
USDT shares sit together), and his final numbering after it: no 0.3 % rung "variant-4", the £1 holding line "variant-5", and the
three USDT-GBP weightings "variant-6" to "-8" in rising order.

## 1. What differs from its base

Each is `live600` with one change, at the same £600, on the same engine (PR5's), one governed key, LIVE's fill rule and LIVE's
weekend from its start, no take, no backfill. Every rule is in force from the start.

| | `live600` (base) | `o600no03` "variant-4" | `o600hold1` "variant-5" | `o600usdt2` "variant-6" | `o600usdt3` "variant-7" | `o600usdt` "variant-8" |
|---|---|---|---|---|---|---|
| USDT-GBP rung | £50 | £75 (0.1 %, 0.2 %), none at 0.3 % | £50 | £66.66 | £75 | £100 |
| USDC-GBP rung | £50 | £75 (0.1 %, 0.2 %), none at 0.3 % | £50 | £33.33 | £25 | none |
| rule | — | `weights.k` 1, 1, 0 | `holdMin` £1 | `weights.book` 1 : 2 | `weights.book` 1 : 3 | `weights.book` 0 : 1 |
| start conversions (USDT / USDC) | £150 / £150 | £150 / £150 | £150 / £150 | £199.98 / £99.99 | £225 / £75 | £300 / none |

`weights` and `holdMin` are as `2026-10-27-pr5-opt-twins-prereg.md` §1 says, unchanged. What variant-8 (USDT-GBP alone) does
that no twin did before:
- **Rungs.** The six USDC-GBP rungs have weight 0: none quotes an entry, as a retired rung, and the capital is the six USDT-GBP
  rungs' alone, £100 each (three bids, three asks).
- **The asks' coin.** USDC-GBP's asks need nothing (`asksNeedOf` with no pounds), so the top-ups never buy USDC
  (`planTopUps`). The operator's conversion cap for USDC-GBP is 0 (`convertCapGbp`): from this commit `runQuotesConvert`
  answers a weighted book with a cap of 0 "the account already holds what USDC-GBP's asks need (0 …): nothing to convert", which
  marks the operator's book done. That is one executor error at its start and none after (`quotes_twin.test.ts`). The live
  account's instance has no weights, its cap is a quarter of the capital, and the answer cannot reach it. USDT-GBP's conversion
  is £300, three asks' worth, and its three bids come from the £300 left.
- **The de-peg guard** is each book's own, as on LIVE: USDT-GBP's stops its entries when USDT's USD book or its own last print
  is more than 50 bps off; USDC-GBP's has nothing to stop.
- **Concentration.** One coin and one book: up to the whole £600 in USDT (three asks' worth at the start, up to three longs on
  top), where LIVE's rules split it over two coins. A USDT de-peg, a USDT-GBP outage or a change in USDT-GBP's flow hits all of
  it; the guard stops entries, not exits, and a long that cannot exit at fair waits for the 24-hour stop. The reading reports its marked-to-market worst day beside the bar for this reason.
  Its replay's worst marked day was −24.8 bps on the long tape, against LIVE's rules' −7.8.

Their rows, as `0149` inserts them (after taking "variant-4" to "-6" from 0148's rows, which it switches off):

```json
{ "id": "o600no03", "display_name": "Stablecoin quotes variant-4", "display_order": 41, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-27T06:00:00Z", "table_prefix": "agent_quote_twin_o600no03", "lease": "quotes-twin-o600no03", "rules": { "fill": { "model": "at", "from": "2026-10-27T06:00:00Z" }, "weekend": { "from": "2026-10-27T06:00:00Z" }, "weights": { "from": "2026-10-27T06:00:00Z", "k": { "0.001": 1, "0.002": 1, "0.003": 0 } } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-27-pr5-opt-twins-now-prereg.md", "migration": "0149", "enabled": true }
```

```json
{ "id": "o600hold1", "display_name": "Stablecoin quotes variant-5", "display_order": 42, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-27T06:00:00Z", "table_prefix": "agent_quote_twin_o600hold1", "lease": "quotes-twin-o600hold1", "rules": { "fill": { "model": "at", "from": "2026-10-27T06:00:00Z" }, "weekend": { "from": "2026-10-27T06:00:00Z" }, "holdMin": { "from": "2026-10-27T06:00:00Z", "gbp": 1 } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-27-pr5-opt-twins-now-prereg.md", "migration": "0149", "enabled": true }
```

```json
{ "id": "o600usdt2", "display_name": "Stablecoin quotes variant-6", "display_order": 43, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-27T06:00:00Z", "table_prefix": "agent_quote_twin_o600usdt2", "lease": "quotes-twin-o600usdt2", "rules": { "fill": { "model": "at", "from": "2026-10-27T06:00:00Z" }, "weekend": { "from": "2026-10-27T06:00:00Z" }, "weights": { "from": "2026-10-27T06:00:00Z", "book": { "USDC-GBP": 1, "USDT-GBP": 2 } } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-27-pr5-opt-twins-now-prereg.md", "migration": "0149", "enabled": true }
```

```json
{ "id": "o600usdt3", "display_name": "Stablecoin quotes variant-7", "display_order": 44, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-27T06:00:00Z", "table_prefix": "agent_quote_twin_o600usdt3", "lease": "quotes-twin-o600usdt3", "rules": { "fill": { "model": "at", "from": "2026-10-27T06:00:00Z" }, "weekend": { "from": "2026-10-27T06:00:00Z" }, "weights": { "from": "2026-10-27T06:00:00Z", "book": { "USDC-GBP": 1, "USDT-GBP": 3 } } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-27-pr5-opt-twins-now-prereg.md", "migration": "0149", "enabled": true }
```

```json
{ "id": "o600usdt", "display_name": "Stablecoin quotes variant-8", "display_order": 45, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-27T06:00:00Z", "table_prefix": "agent_quote_twin_o600usdt", "lease": "quotes-twin-o600usdt", "rules": { "fill": { "model": "at", "from": "2026-10-27T06:00:00Z" }, "weekend": { "from": "2026-10-27T06:00:00Z" }, "weights": { "from": "2026-10-27T06:00:00Z", "book": { "USDC-GBP": 0, "USDT-GBP": 1 } } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-27-pr5-opt-twins-now-prereg.md", "migration": "0149", "enabled": true }
```

## 2. Why

The study (`2026-10-27-pr5-rules-optimisation.md`, `backtests/pr5_opt/`) replayed each at £600 against LIVE's rules, in bps of
capital a day, on PR5's record 09-26 → 10-27 under LIVE's "at" fill and the "through" fill, the tape 08-26 → 09-23 and the tape
01-01 → 09-23 (`results/usdt_weights.json` for the weightings, `results/experiments.json` for variant-4 and -5):

| | FWD at | FWD through | HIST | LONG | LONG weeks ahead |
|---|---|---|---|---|---|
| LIVE's rules (bps/day) | 12.98 | 10.27 | 6.64 | 33.70 | — |
| variant-4, no 0.3 % | +1.15 | +1.09 | +0.99 | +1.26 | 31 of 39 |
| variant-5, hold £1 | +0.48 | +0.05 | 0 | +0.04 | — |
| variant-6, USDT 2:1 | +1.24 (+9.6 %) | +1.22 (+11.9 %) | +0.51 (+7.6 %) | +5.03 (+14.9 %) | 39 of 39 |
| variant-7, USDT 3:1 | +1.64 (+12.6 %) | +1.77 (+17.2 %) | +0.73 (+11.0 %) | +7.21 (+21.4 %) | 38 of 39 |
| variant-8, USDT only | +2.38 (+18.3 %) | +3.02 (+29.4 %) | +1.10 (+16.5 %) | +12.43 (+36.9 %) | 38 of 39 |

The replay fills by each print's own quantity, shared best price first, and fills a rung in part: a £100 rung meets the same
prints as a £50 one, so its pounds per pound fall (the replay's own curve against £120 of capital: 0.85 at £50 rungs, 0.75 at
£100). That is steeper than the capacity study's queue-aware curve for LIVE (0.90 at £50, 0.82 at £100), so no further discount
is applied for size; what it does not model is a queue at the price (the "at" fill), bracketed by its "through" column.
The weightings' gains grow with USDT-GBP's share and so do their worst weeks (HIST: 2:1 −4.82, 3:1 −7.66, USDT only −16.83 bps).

## 3. Window, reading and bar

- **Window**: 2026-10-27 06:00 → 2026-11-24 06:00 UTC (28 days, four closures). If a twin first turns after 06:00, it catches
  up from 06:00 on PR5's record, as every twin with a start behind it does; if it cannot, its window is the 28 days from the first
  06:00 UTC after its first turn, and the reading says so.
- **Reading**: on or after the window's end, each twin against `live600` over the same days.
  - Each twin's realised by the page's own walk (`liveRungs`, `liveRungTrips`), a trip on the day it exits, a day being 06:00 →
    06:00 UTC, as a share of its capital.
  - d = (the twin's realised − `live600`'s realised) ÷ £600, in bps, by day, for each of the 28 days (a day with none is 0).
- **Bar**, for each twin on its own (five readings, each named with the other four beside it):
  - **B1**: the mean of d > 0;
  - **B2**: a circular 3-day block bootstrap of d (blocks of 3 consecutive days from a random start, wrapping; as many as cover 28
    days, cut to 28), Python `random.Random(20261128)`, 10,000 resamples, sorted: at most 10 % of the means at or below 0.
  - **Pass**: the change goes to Davies as a proposal for LIVE, his call. **Miss**: no proposal; the reading names where it lost.
  - variant-6, -7 and -8 are one question asked three ways (how much of the capital USDT-GBP should carry): their reading also
    names the best of the three that passed, and says that picking the best of three passes flatters it.
- **Reported beside the bar, no bar of its own:**
  - each twin's and `live600`'s marked-to-market per pound (coins at the paper engine's fair each 06:00), and the worst day;
  - trips, entry fills (count and sizes), stops, the share of d from closures and from the best day;
  - variant-4: the 0.3 % rungs' realised in `live600` over the window; variant-5: the USDT-GBP prints of £0.10 or less a day;
  - variant-8: the largest USDT holding against fair each day, and every de-peg guard minute of USDT-GBP;
  - power (`backtests/pr5_opt/results/power.json`, `power_usdt.json`: 28-day windows of the study's own daily differences, this
    bar): at the replay's effect variant-4 0.63, -5 0.97, -6 0.85, -7 0.81, -8 0.63; at half of it 0.41, 0.43, 0.45, 0.43,
    0.35; at none 0.19, 0.11, 0.11, 0.12, 0.13 (false passes).
- **Health only, until the reading**, daily: each `_sim` row's `last_error`, its `paperCheck` mismatches and mode; its state's
  `updated_at` against PR5's call; no `agents.quotes_twins` error in `ops_errors`; the start conversions as §1's table says.
  Its record may be read at any time (no no-peek rule since 2026-10-04).

## 4. Its record before now

None: each starts flat at 2026-10-27 06:00 UTC. At its first turn the operator's maker conversions put each book's asks' worth
into its coin. 0148's three rows (`live600usdt2`, `live600no03`, `live600hold1`) turned from 04:20 UTC with their start on 10-29:
inert minutes, no order. They are switched off and are not read.

## 5. Frozen files

| file | sha256 |
|---|---|
| `supabase/migrations/0149_quote_twins_pr5_opt_now.sql` | b49c0a86b86281e7e832703db8cb25f6bbfbf6fcc089f3aca4548c73f92ea094 |
| `supabase/functions/agents/quotes_twin.ts` | 015f3af08ba852c372e6b0a9f9d6815999731bd3322e03c8b5f944cdac8f4544 |
| `supabase/functions/agents/revx_sim.ts` | 7f05baba5a1a066166791e184ddac505bcd692865864dd219172d4c87569cc47 |
| `supabase/functions/agents/quotes_weekend.ts` | b811ca70b761f85ffa8c8ab00096cece8e06177763c64c2f8806985610d657a2 |

`src/pr5_opt_twins_now.test.js` pins them. `agents/quotes_live.ts` is LIVE's executor and is not frozen here: the twins run it as
it stands, as LIVE does. Its one change in this commit is §1's answer for a book whose asks have no pounds, unreachable from the
live account's instance; its six-hour counterfactuals (`quotes_live_instance.test.ts`) still match the frozen executor turn by
turn.

## 6. Disclosures before the freeze

- The two new weightings were chosen after the study and its 2:1 recommendation, reading every record to 2026-10-27, and Davies
  asked for them after seeing it. Not blind.
- `live600` started at 2026-10-27 00:00 UTC, six hours before these: on the window's first day it holds the coin and longs of
  its first six hours, and trips it opened before 06:00 count on the day they exit. The reading reports the first day's d beside
  the 28.
- The call's time (measured 2026-10-26 05:00 → 10-27 04:40 UTC from the function's own logs, 1,288 calls): it sleeps to :38 and
  then works a median of 5.7–10.6 s and a 90th percentile of 8–14 s by hour, at most 19.4 s, on seven twins, against a lease of
  55 s; two twins added at 10-27 00:00 moved nothing measurable. Twelve twins run from this commit (0148's three off, five on),
  and `pr5`, `p50` and `d` keep running to their 10-28 readouts. If the call cannot turn them all, the reading says which minutes
  each missed.

## 7. Deviations

None.
