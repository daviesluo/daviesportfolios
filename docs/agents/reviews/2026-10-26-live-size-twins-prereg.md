# Pre-registration: LIVE's rules at £300 and £600, "Stablecoin quotes LIVE twin" (`live300`) and "variant-1" (`live600`) (2026-10-26)

**Status: FROZEN** at the commit that adds migration `0141`. Any later change is a deviation, written in §7 with its date and
reason. Written from `TEMPLATE-variant-prereg.md`; its base is the £120 LIVE twin (`live`, `2026-10-21-live-twin-prereg.md`,
"Stablecoin quotes variant-2" since `0141`), whose pre-registration this does not change beyond its own deviation 1.

## 0. On whose word

Davies, 2026-10-26, answering the stablecoin quotes review of that day (`2026-10-26-stablecoin-quotes-review.md`, §2.4 and §3.4),
verbatim: "你验证没问题的话就都按你推荐的来，£300 和 £600在最新live的rules上建吧，live twin要改成300磅的， £600改为variant-1" (if it checks
out, do it as recommended: build £300 and £600 on LIVE's latest rules; the LIVE twin becomes £300, £600 becomes variant-1). On the
capital: "同意 之后加好了给你讲" (agreed; he will say when the money is in). LIVE itself is not changed by this file.

## 1. What differs from its base

| | `live` (£120, "variant-2") | `live300` | `live600` |
|---|---|---|---|
| engine, keys | PR5's paper engine, one key | the same | the same |
| capital | £120: £10 a rung | **£300: £25 a rung** | **£600: £50 a rung** |
| rules | `fill` "at" from 09-23 15:09; `weekend` from 10-30 21:00 (its deviation 1) | **`fill` "at" from 10-27 00:00; `weekend` from 10-30 21:00** | the same as `live300` |
| take | none | none: LIVE's `take_mode` is 'shadow', which sends nothing | none |
| start, record before | 09-23, LIVE's life replayed to 10-21 15:09 | **2026-10-27 00:00 UTC, flat, no backfill** | the same |

Page names "Stablecoin quotes LIVE twin" (`display_order` 11) and "Stablecoin quotes variant-1" (12), before variant-2 (15). Their
rows, as `0141` inserts them:

```json
{ "id": "live300", "display_name": "Stablecoin quotes LIVE twin", "display_order": 11, "engine": "pr5", "capital_gbp": 300, "gov": "account", "start": "2026-10-27T00:00:00Z", "table_prefix": "agent_quote_twin_live300", "lease": "quotes-twin-live300", "rules": { "fill": { "model": "at", "from": "2026-10-27T00:00:00Z" }, "weekend": { "from": "2026-10-30T21:00:00Z" } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-26-live-size-twins-prereg.md", "migration": "0141", "enabled": true }
```

```json
{ "id": "live600", "display_name": "Stablecoin quotes variant-1", "display_order": 12, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-27T00:00:00Z", "table_prefix": "agent_quote_twin_live600", "lease": "quotes-twin-live600", "rules": { "fill": { "model": "at", "from": "2026-10-27T00:00:00Z" }, "weekend": { "from": "2026-10-30T21:00:00Z" } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-26-live-size-twins-prereg.md", "migration": "0141", "enabled": true }
```

**What "LIVE's rules" means here, and where a twin still differs from LIVE.**
- **The same:** PR5's paper decisions carried out by the live executor's code (`quotes_live.ts` as it stands), LIVE's fill rule, and
  weekend quoting inside FX closures.
- **The weekend replica.** A twin's weekend is PR5-W's rule on its own replica, stepped all week (`rules.weekend`, variant-3's).
  LIVE's is a replica copied from PR5's engine in the hour before each closure. The live design's addendum of 2026-10-18 names
  this as its one deviation from the paper rows.
- **No take.** LIVE's take is in shadow, so neither twin takes. If Davies turns LIVE's take on, these twins do not follow it
  without a deviation here.

## 2. Why

The review of 2026-10-26 (§2) found returns per pound holding to about 0.95× at £25 a rung and 0.86–0.93× at £50, but only from
through-fill twins, the size study and an upper bound from LIVE's own prints. No twin had measured LIVE's own fill rule above
£120. LIVE is about to go to £300. These two measure LIVE's rule forward at £300 and £600, beside the £120 twin on the same minutes.
That is the evidence for any step beyond £300.

## 3. Window, reading and bar

- **Window**: 2026-10-28 00:00 → 2026-11-11 00:00 UTC (14 days, two closures). The day from their start is reported apart. If
  they first turn after 10-28 00:00, the window is the 14 days from the first 00:00 UTC after their first turn, and the
  reading says so.
- **Reading**: on or after the window's end. Each twin's realised by the page's own walk (`liveRungs`, `liveRungTrips`), the same
  for the £120 twin over the same minutes, and each marked to market at the paper engine's fair, as
  `backtests/scq_review/2026-10-26/scripts/series.ts` does.
- **Bar**: `live600`'s realised per pound of capital is at least 80 % of the £120 twin's over the window.
  - Pass: the evidence for LIVE at £600, Davies' call.
  - Miss: LIVE stays at £300 or less, and the reading names where the £600 twin lost: fills, exits, funds or stops.
- **Reported beside the bar, no bar of its own:**
  - `live300`'s ratio, the same way;
  - each twin's marked-to-market per pound;
  - entry fill rate, round trips, stops, and the share of each weekend.
- **Health only, until the reading**, daily:
  - each `_sim` row's `last_error`, its `paperCheck` mismatches and its mode;
  - its state's `updated_at` against PR5's call;
  - no `agents.quotes_twins` error in `ops_errors`.
  - Its record may be read at any time (no no-peek rule since 2026-10-04).

## 4. Its record before now

None: both start flat at 2026-10-27 00:00 UTC, as variant-3 started. At their first turn the operator's maker conversions put a
quarter of the capital into each coin.

## 5. Frozen files

| file | sha256 |
|---|---|
| `supabase/migrations/0141_quote_twins_relayout.sql` | 77f7b38292a4f0ae4cf03c2f11c8526a57dc5bf5793b682031da8fa6d40b0f37 |
| `supabase/functions/agents/quotes_twin.ts` | 36092d7f506565d5c89d11ea389d569e2106f738768d1a7450f4e3e39595c3d7 |
| `supabase/functions/agents/revx_sim.ts` | 7f05baba5a1a066166791e184ddac505bcd692865864dd219172d4c87569cc47 |
| `supabase/functions/agents/quotes_weekend.ts` | b811ca70b761f85ffa8c8ab00096cece8e06177763c64c2f8806985610d657a2 |

`src/live_size_twins.test.js` pins them. `agents/quotes_live.ts` is LIVE's executor and is not frozen here: the twins run it as it
stands, as LIVE does.

## 6. Disclosures before the freeze

- The review of 2026-10-26 read every twin's and LIVE's record to 2026-10-26 01:00 UTC. That is where the bar's 80 % comes from:
  the through-fill twins showed £100 a rung at 0.82× of £50, and LIVE's own prints bounded £50 at 0.86–0.93× of £10.
- Not blind.

## 7. Deviations

**Deviation 1 (2026-10-27): LIVE went to £600, so the £600 twin is the LIVE twin and the £300 twin stops (`0144`).** Davies,
2026-10-27: "我已经加到600了，你验证下并检查确保策略所有细节都没问题，然后把测试的Stablecoin quotes LIVE twin改为600，Stablecoin quotes variant-1改为
你仔细研究下下次加仓的目标仓位本金的测试，所有数据都可以看". LIVE's capital became £600 at 03:09 UTC that day, before this window opened.
- `live600` is renamed "Stablecoin quotes LIVE twin". Its capital, rules, start and record do not change, and §3's bar is read as
  written: it now checks a step Davies has taken, not one he is weighing.
- `live300` is renamed "Stablecoin quotes 300 twin" and switched off at `0144`; its ratio beside the bar is withdrawn. Its record
  (2026-10-27 00:00 to the migration) stays in its tables.
- "Stablecoin quotes variant-1" is a new twin at £1,200 (`live1200`), pre-registered on its own
  (`2026-10-27-live-next-size-prereg.md`). No twin was resized.

**Deviation 2 (2026-10-27): `quotes_twin.ts` gains PR5-OPT's rules; these twins do not change.** Davies, 2026-10-27: "…还有哪些可以值得研究和测试的地方（比如每个%不同的档挂单钱数不同？不同的档位%？不同的细分rules等等）". The
study (`2026-10-27-pr5-rules-optimisation.md`) recommended three twins on LIVE's rules, built by `0148`
(`2026-10-27-pr5-opt-twins-prereg.md`). For them `quotes_twin.ts` gains two rules, `weights` and `holdMin`, and sizes a twin's start
conversions by `convertCapGbp`, which is a quarter of the capital for every twin without `weights`; `quotes_live.ts` gains the two
instance options they set, absent on the live account's instance and on every twin before `0148`. **This test is not changed**:
its row names neither rule, so it runs the code path it ran (pinned in `quotes_live_instance.test.ts`: the executor with each
option absent, before its instant, and at its neutral setting is the frozen executor, turn by turn). Its window, reading and bar
are as written. Not blind.

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_twin.ts` | 015f3af08ba852c372e6b0a9f9d6815999731bd3322e03c8b5f944cdac8f4544 |

§5 keeps the hash the file was frozen at; this table names it from this deviation on (`src/live_size_twins.test.js`).

**Deviation 3 (2026-10-28): `quotes_twin.ts` turns no twin before the minute after its start; these twins do not change.** `2026-10-27-pr5-opt-twins-now-prereg.md`'s five twins, inserted by `0149` at 04:56 UTC on 10-27 for a 06:00 start, were
sent straight to forward turns, and their start conversions went out at 05:50, before their rules' instant, so unweighted (that
pre-registration's deviation 1, `0152`). `quotes_twin.ts` now turns no twin before the minute after its start, the minute a
catch-up's first turn stands in: a twin whose row lands early waits for it. **These twins are not changed**: it started before this change and is
past its start, where the driver runs the code path it ran (every test of a running twin in `quotes_twin.test.ts` is
unchanged). Its window, reading and bar are as written. Not blind.

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_twin.ts` | 2b84a1ebbdc1172375ff7c783a463ce39e266c490b2256314eae8893b5548e68 |

§5 and deviation 2 keep the hashes the file had before; this table names it from this deviation on (`src/live_size_twins.test.js`).
