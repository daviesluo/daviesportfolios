# Pre-registration: PR5-OPT's three twins on LIVE's rules, "Stablecoin quotes variant-4", "-5" and "-6" (2026-10-27)

**Status: FROZEN** at the commit that adds migration `0148`. Any later change is a deviation, written in §7 with its date and reason.
Written from `TEMPLATE-variant-prereg.md`, with one difference the template does not allow: these rows need code (two rule
extensions, §1), built in the same commit. Their base is the £600 LIVE twin (`live600`, "Stablecoin quotes LIVE twin",
`2026-10-26-live-size-twins-prereg.md`), whose pre-registration this does not change beyond its deviation 2.

## 0. On whose word

Davies, 2026-10-27, verbatim: "你在做一些策略优化的研究，看看目前live的策略是所有已知信息和推算所得出的最佳rules吗，还有没有哪些可以优化的地方，还有哪些可以值得
研究和测试的地方（比如每个%不同的档挂单钱数不同？不同的档位%？不同的细分rules等等）" (is LIVE's rule set the best known; what could be improved;
what is worth researching and testing: different pounds at each %, different distances, finer rules). The study
(`2026-10-27-pr5-rules-optimisation.md`, §4) recommended three single-change twins, and they were built the same day on that
recommendation.

## 1. What differs from its base

Each is `live600` with one change, at the same £600, on the same engine (PR5's), one governed key, LIVE's fill rule and LIVE's
weekend from its start, no take, no backfill.

| | `live600` (base) | `live600usdt2` "variant-4" | `live600no03` "variant-5" | `live600hold1` "variant-6" |
|---|---|---|---|---|
| rung pounds | £50 each (capital ÷ 12) | USDT-GBP £66.66, USDC-GBP £33.33 (`weights.book` 2 : 1) | £75 on the 0.1 % and 0.2 % rungs, none on 0.3 % (`weights.k`) | £50 each |
| holding | over the venue's £0.10 | the same | the same | over £1 of coin (`holdMin`) |
| start | 2026-10-27 00:00 | **2026-10-29 00:00 UTC**, flat | the same | the same |

- **`weights`** (`QuoteLiveInstance.weights`, `TWIN_RULES.weights`): a rung's pounds are the capital × w(book) × w(side) × w(k) ÷
  the same summed over the twelve rungs, floored to the penny. A rung of weight 0 quotes no entry (as a retired rung) and its
  pounds go to the others. The asks' coin (`asksNeedOf`, `planTopUps`) and the operator's conversion cap (`convertCapGbp`) follow
  each book's own ask rungs, so the twin's start conversions buy £199.98 of USDT and £99.99 of USDC (variant-4), £150 of each
  (variant-5).
- **`holdMin`** (`QuoteLiveInstance.holdMin`, `TWIN_RULES.holdMin`): a rung counts as holding only above max(the venue's minimum,
  £1 of coin at fair). Under it the rung keeps carrying out its paper rung's entry and its coin is carried into the trip. Over it,
  one exit buys back or sells the whole holding, and once that exit rests the line is the venue's minimum again. The 24-hour stop
  counts from the fill that crossed the line.
- Neither is on the live account's instance (`QUOTE_LIVE_INSTANCE`). With each absent, before its instant, and at its neutral
  setting (equal weights; a £0.10 line), the executor is the frozen executor turn by turn (`quotes_live_instance.test.ts`).

Their rows, as `0148` inserts them (after renaming rule D's hidden twin "Stablecoin quotes rule-D twin", which frees "variant-4"):

```json
{ "id": "live600usdt2", "display_name": "Stablecoin quotes variant-4", "display_order": 31, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-29T00:00:00Z", "table_prefix": "agent_quote_twin_live600usdt2", "lease": "quotes-twin-live600usdt2", "rules": { "fill": { "model": "at", "from": "2026-10-29T00:00:00Z" }, "weekend": { "from": "2026-10-29T00:00:00Z" }, "weights": { "from": "2026-10-29T00:00:00Z", "book": { "USDC-GBP": 1, "USDT-GBP": 2 } } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-27-pr5-opt-twins-prereg.md", "migration": "0148", "enabled": true }
```

```json
{ "id": "live600no03", "display_name": "Stablecoin quotes variant-5", "display_order": 32, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-29T00:00:00Z", "table_prefix": "agent_quote_twin_live600no03", "lease": "quotes-twin-live600no03", "rules": { "fill": { "model": "at", "from": "2026-10-29T00:00:00Z" }, "weekend": { "from": "2026-10-29T00:00:00Z" }, "weights": { "from": "2026-10-29T00:00:00Z", "k": { "0.001": 1, "0.002": 1, "0.003": 0 } } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-27-pr5-opt-twins-prereg.md", "migration": "0148", "enabled": true }
```

```json
{ "id": "live600hold1", "display_name": "Stablecoin quotes variant-6", "display_order": 33, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-29T00:00:00Z", "table_prefix": "agent_quote_twin_live600hold1", "lease": "quotes-twin-live600hold1", "rules": { "fill": { "model": "at", "from": "2026-10-29T00:00:00Z" }, "weekend": { "from": "2026-10-29T00:00:00Z" }, "holdMin": { "from": "2026-10-29T00:00:00Z", "gbp": 1 } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-27-pr5-opt-twins-prereg.md", "migration": "0148", "enabled": true }
```

## 2. Why

The study replayed 55 changes to LIVE's rules LIVE-realistic at £600 (`backtests/pr5_opt/`). In bps of capital a day against LIVE's
rules (PR5's record 09-26 → 10-27 under LIVE's "at" fill and the "through" fill; the tape 08-26 → 09-23; the tape 01-01 → 09-23):
- **variant-4:** +1.24 (90 % +0.35 to +2.24) / +1.22; +0.51; +5.03, ahead in 39 of 39 weeks of the long tape;
- **variant-5:** +1.15 (−0.17 to +2.32) / +1.09; +0.99; +1.26, ahead in 31 of 39 weeks;
- **variant-6:** +0.48 (+0.14 to +0.90) / +0.05; 0; +0.04. It exists because of the £0.10 prints on USDT-GBP since 2026-10-08:
  142 of LIVE's 232 USDT-GBP entry fills from then to 10-26 were under £1.

## 3. Window, reading and bar

- **Window**: 2026-10-29 00:00 → 2026-11-26 00:00 UTC (28 days, four closures). If a twin first turns after 10-29 00:00, its window is
  the 28 days from the first 00:00 UTC after its first turn, and the reading says so.
- **Reading**: on or after the window's end, each twin against `live600` over the same days.
  - Each twin's realised by the page's own walk (`liveRungs`, `liveRungTrips`), a trip on its exit day, as a share of its capital.
  - d = (the twin's realised − `live600`'s realised) ÷ £600, in bps, by UTC day, for each of the 28 days (a day with none is 0).
- **Bar**, for each twin on its own (three readings, each named with the other two beside it):
  - **B1**: the mean of d > 0;
  - **B2**: a circular 3-day block bootstrap of d (blocks of 3 consecutive days from a random start, wrapping; as many as cover 28
    days, cut to 28), Python `random.Random(20261128)`, 10,000 resamples, sorted: at most 10 % of the means at or below 0.
  - **Pass**: the change goes to Davies as a proposal for LIVE, his call. **Miss**: no proposal; the reading names where it lost.
- **Reported beside the bar, no bar of its own:**
  - each twin's and `live600`'s marked-to-market per pound (coins at the paper engine's fair each midnight);
  - trips, entry fills (count and sizes), stops, the share of d from closures and from the best day;
  - variant-5: the 0.3 % rungs' realised in `live600` over the window (without a wide day the variant is flattered);
  - variant-6: the USDT-GBP prints of £0.10 or less a day (the effect lives as long as they do);
  - power (`backtests/pr5_opt/results/power.json`, 28-day windows of the study's own daily differences): at the replay's effect
    0.85 / 0.63 / 0.97, at half of it 0.45 / 0.41 / 0.43, at none 0.11 / 0.19 / 0.11 (false passes).
- **Health only, until the reading**, daily: each `_sim` row's `last_error`, its `paperCheck` mismatches and mode; its state's
  `updated_at` against PR5's call; no `agents.quotes_twins` error in `ops_errors`; the start conversions' sizes as §1 says. Its
  record may be read at any time (no no-peek rule since 2026-10-04).

## 4. Its record before now

None: each starts flat at 2026-10-29 00:00 UTC. At its first turn the operator's maker conversions put each book's asks' worth into
its coin.

## 5. Frozen files

| file | sha256 |
|---|---|
| `supabase/migrations/0148_quote_twins_pr5_opt.sql` | 61cf1ec457c0f877e027f323a76a7b4240e8e1ef0a184457e7e33b4741f0e2ce |
| `supabase/functions/agents/quotes_twin.ts` | 015f3af08ba852c372e6b0a9f9d6815999731bd3322e03c8b5f944cdac8f4544 |
| `supabase/functions/agents/revx_sim.ts` | 7f05baba5a1a066166791e184ddac505bcd692865864dd219172d4c87569cc47 |
| `supabase/functions/agents/quotes_weekend.ts` | b811ca70b761f85ffa8c8ab00096cece8e06177763c64c2f8806985610d657a2 |

`src/pr5_opt_twins.test.js` pins them. `agents/quotes_live.ts` is LIVE's executor and is not frozen here: the twins run it as it
stands, as LIVE does.

## 6. Disclosures before the freeze

- The three changes were chosen from 55 replayed on PR5's record and the committed tape, reading LIVE's and every record to
  2026-10-27 (the study). Not blind.
- The study's levels sit about 20 % above LIVE's on its clean days; the twins fill by LIVE's "at" rule, which the study's "at" runs
  model. Variant-6's effect is zero under the "through" fill and before 2026-10-08.
- Nine twins run in the call from 10-29 unless the 10-28 readouts switch `pr5`, `p50` and `d` off first; if the call cannot turn
  them all within its budget, the reading says which minutes each missed.

## 7. Deviations

**Deviation 1 (2026-10-27, before the start; migration `0149`): the three start at 2026-10-27 06:00 UTC, under new ids.** Davies,
2026-10-27, verbatim: "variant-4、5、6是在实盘rules的基础上建的吧？为啥要等到29？现在就开始…你再在实盘rules的基础上开variant-7和8测试这两个".
- 0148's rows turned from 04:20 UTC with their replicas built from the 10-29 start, so their start cannot move in place. `0149`
  switches `live600usdt2`, `live600no03` and `live600hold1` off (renamed "… from 10-29", their tables kept, no order in them)
  and inserts the same three rules as `o600usdt2`, `o600no03` and `o600hold1`, each from 2026-10-27 06:00 UTC, beside USDT-GBP
  3:1 and USDT-GBP alone. Their page names move so that the USDT weightings sit together (Davies, the same day:
  "做好后variant-4和5与5和6替换，这样的话usdt比例大的放一起", then his final numbering): no 0.3 % rung is "variant-4", the £1 holding
  line "variant-5", USDT 2:1 "variant-6", and USDT 3:1 and USDT alone "variant-7" and "-8".
- The window moves with them: 2026-10-27 06:00 → 2026-11-24 06:00 UTC, each day 06:00 → 06:00. The bar, the readings beside it
  and their power are this document's §3, unchanged, and are read under
  `2026-10-27-pr5-opt-twins-now-prereg.md`, which pre-registers all five together.
- §6's count of twins is that document's: twelve from `0149`, `pr5`, `p50` and `d` running to their 10-28 readouts.

**Deviation 2 (2026-10-28): `quotes_twin.ts` turns no twin before the minute after its start; the three are off.** `0149`'s
five, which carry this document's three rules from 2026-10-27 06:00 (deviation 1), converted before their rules' instant
because the driver sent a twin whose start was ahead straight to forward turns; `0152` restarts them from 2026-10-29 06:00 UTC
under new ids, and the driver now turns no twin before the minute after its start (`2026-10-27-pr5-opt-twins-now-prereg.md`
§7, deviation 1). This document's own rows have been off since `0149` and are not read. Not blind.

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_twin.ts` | 2b84a1ebbdc1172375ff7c783a463ce39e266c490b2256314eae8893b5548e68 |

§5 keeps the hash the file was frozen at; this table names it from this deviation on (`src/pr5_opt_twins.test.js`).
