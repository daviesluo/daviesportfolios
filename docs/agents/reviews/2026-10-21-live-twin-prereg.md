# Pre-registration: "Stablecoin quotes LIVE twin" (`live`), the simulation that mirrors LIVE (2026-10-21)

**Status: FROZEN** at the commit that adds migration `0136`. Any later change is a deviation, written in §7 with its date and
reason. Written from `TEMPLATE-variant-prereg.md`; it changes no other twin, test or reading.

## 0. On whose word

Davies, 2026-10-21, on PR5's four-week review, verbatim: "A，引擎也继续运行，但要确保模拟的真实性和实盘策略完全一致，不一致的地方就直接改"
(option A; keep the engine running; make sure the simulation is realistic and matches the live strategy exactly; fix what is
inconsistent directly). The audit (`2026-10-21-sim-vs-live-audit.md`) found the twins' fill rule the one large inconsistency,
added LIVE's own as the twin rule `fill`, and offered two places for it. The main session chose (a), a new row at LIVE's own size,
on Davies' word above.

## 1. What differs from its base

| | `pr5` ("Stablecoin quotes") | `live` |
|---|---|---|
| engine | PR5's paper engine | the same |
| capital | £1,200: £100 a rung | **£120: £10 a rung (LIVE's)** |
| governed keys | one (the account) | the same |
| rules | none | **`fill`: a print AT a resting order's price, from the other side, fills it (from the replica's first minute)** |
| start | 2026-09-23 15:09 | the same (the replica is PR5's engine event for event) |
| record before now | a backfill to 2026-10-02 21:05 | **a backfill of LIVE's life: no turn before LIVE's go-live, then LIVE's balances, conversions and operations, to 2026-10-21 15:09** |

Page name "Stablecoin quotes LIVE twin", at `display_order` 15 (after "Stablecoin quotes", before variant-1). Its row, as `0136`
inserts it:

```json
{ "id": "live", "display_name": "Stablecoin quotes LIVE twin", "display_order": 15, "engine": "pr5", "capital_gbp": 120, "gov": "account", "start": "2026-09-23T15:09:00Z", "table_prefix": "agent_quote_twin_live", "lease": "quotes-twin-live", "rules": { "fill": { "model": "at", "from": "2026-09-23T15:09:00Z" } }, "backfill": { "file": "docs/agents/backtests/twins/live.json.gz", "sha256": "930744a026c35f4ce8f092d53aae9ce02907efb1c7bf97db0a3fbcb3ee5fae9e", "until": "2026-10-21T15:09:00.000Z" }, "prereg": "docs/agents/reviews/2026-10-21-live-twin-prereg.md", "migration": "0136", "enabled": true }
```

## 2. Why

It is not a strategy of its own. It is the faithful mirror of LIVE: PR5's rule at LIVE's size, filled as LIVE is filled. Its use is
to show at any time what LIVE "should" have done, so that a gap between the two is a finding: a venue fault, an executor fault, or a
rule of the simulation that is no longer LIVE's. Over LIVE's life to 2026-10-21 (in sample, §4), this replay matched:
- LIVE's realised to within 10.5 % (£0.972 against £0.880);
- its round trips to within 6.4 % (204 against 218);
- 84.7 % of its orders;
- whether each filled, on the orders both placed: 92.1 % of the filled ones.

The through-only twins reached 20.3 % of LIVE's fills and £0.245.

## 3. Window, reading and bar

- **Window**: 2026-10-22 00:00 → 2026-11-22 00:00 UTC. Its record before 10-22, the backfill and the first catch-up, is reported
  apart.
- **Reading**: on or after 2026-11-23, beside LIVE's own record over the same window, by `backtests/livesim/scripts/compare.py` and
  `trips.ts` re-pointed at the window (a reading script committed before 11-22). It may be read at any time before then: no
  no-peek rule applies since 2026-10-04.
- **Bar, "the mirror holds"**: all three over the window.
  1. Realised: |twin − LIVE| ≤ the larger of 25 % of |LIVE's| and £0.10.
  2. Round trips: |twin − LIVE| ≤ 20 % of LIVE's.
  3. On the orders both placed (matched as `compare.py` matches them), at least 85 % of those either filled agree on filling.
  - A pass says the simulation stands for LIVE.
  - A miss reopens the audit: the difference is found and either fixed in the simulation or named as LIVE's (an outage, an
    executor fault). It never changes LIVE.
  - The forward twin meets no venue outage and no dead-man cancel of LIVE's (only its own), so a window with one of LIVE's is
    read with those minutes named.
- **Health**, daily: its `_sim` row's `last_error`, its `paperCheck` mismatches (46 by construction, all before 2026-09-24 18:13,
  as `pr5`'s), its mode, its state's `updated_at` against PR5's call, the call's beats, no `ops_errors` `agents.quotes_twins`.

## 4. Its record before now

A backfill, `docs/agents/backtests/livesim/scripts/backfill_live.ts`, run on `docs/agents/backtests/livesim/data/inputs.json.gz`
(PR5's prints, inputs, minutes and events to 2026-10-21 15:09) and `data/live_events.txt.gz` (LIVE's dead-man cancels). It is the
template's builder (`twins/scripts/backfill.ts`, unchanged) with the validation's replay of LIVE laid over its spec row:
- no turn until LIVE's go-live (2026-10-01 16:29:53);
- LIVE's £120.33 and its two go-live conversions at their instants;
- the dead-man from 2026-10-02 19:06;
- a turn every minute, 30 s in;
- the monitor's 48 cancels of 2026-10-07;
- the venue's outage of 2026-10-20.

It was built twice to the same bytes: 564,349, sha256 930744a0…. It is the audit's `at_ops` arm, order for order (6,295 orders). It
is in sample: the audit's figures were read before this was written, and they are the expectation, not evidence. From 2026-10-21
15:09 the production call catches it up from PR5's beats, which are kept about three days, so it must be deployed before 2026-10-24.

## 5. Frozen files

| file | sha256 |
|---|---|
| `supabase/migrations/0136_quote_twin_live.sql` | 629c087dde2d707b8376a9519999150a5e20af7052bd1d63b49e8a0d528156b5 |
| `docs/agents/backtests/twins/live.json.gz` | 930744a026c35f4ce8f092d53aae9ce02907efb1c7bf97db0a3fbcb3ee5fae9e |
| `docs/agents/backtests/livesim/scripts/backfill_live.ts` | 407830f83435ce65ef8c2d2ddd1148dc0c3599213b568147b82b3f6ffdba8c6d |
| `docs/agents/backtests/livesim/data/inputs.json.gz` | 12ae364939d7c6888396b3fb289b431db5cb0ff8dc889e68fbc9435cac426cf7 |
| `docs/agents/backtests/livesim/data/live_events.txt.gz` | e3f48daa2b74e0d5a30896d5aa84759403323f516bee9c9fe20eda50b7c1b629 |
| `supabase/functions/agents/quotes_twin.ts` | 36092d7f506565d5c89d11ea389d569e2106f738768d1a7450f4e3e39595c3d7 |
| `supabase/functions/agents/revx_sim.ts` | 7f05baba5a1a066166791e184ddac505bcd692865864dd219172d4c87569cc47 |

`src/live_twin.test.js` pins them. `agents/quotes_live.ts` is LIVE's executor and is not frozen here: the twin runs it as it stands,
which is the point.

## 6. Disclosures before the freeze

- LIVE's whole record to 2026-10-21 15:09 was read, and so was every arm of the audit (`backtests/livesim/results/`).
- The bar's three thresholds were set after seeing that the in-sample replay met them: 10.5 %, 6.4 %, 92.1 %.
- Not blind.

## 7. Deviations

**Deviation 1 (2026-10-26): LIVE trades the weekends, so its mirror does too, and the window leaves out the one closure it
did not. Also a new page name.**

Davies, 2026-10-26, on the stablecoin quotes review of that day (`2026-10-26-stablecoin-quotes-review.md`, §3.2), verbatim:
"你验证没问题的话就都按你推荐的来…目前的LIVE 模拟分身改为variant-2" (if it checks out, do it as recommended; the current LIVE twin
becomes variant-2).

- **Why.** LIVE has quoted inside FX closures since 2026-10-23 21:00 UTC (`weekend_mode` 'live', the live design's addendum).
  This twin had no weekend rule and sat dark. From 10-22 it therefore had 48 % of LIVE's realised, against 97 % on weekdays.
  §3's bar would have failed on that difference alone, which says nothing about the mirror.
- **The change, by `0141`.** The twin gains `rules.weekend` from **2026-10-30 21:00 UTC**, the next closure's first minute. Its
  weekend is PR5-W's rule on its own replica (variant-3's). LIVE's is a replica copied from PR5's engine in the hour before each
  closure: the live design's addendum names that difference.
- **The window and the bar.** The window keeps its dates (10-22 → 11-22) and its bar keeps its three thresholds. The minutes of
  the closure 2026-10-23 21:00 → 10-25 21:00 UTC are left out of both records: round trips that closed inside it, and LIVE's
  orders in it. That is the one closure LIVE traded and the twin could not. The reading names what that closure was for LIVE.
  - Later closures count for both.
  - A closure in which the two weekend replicas decided differently is read with those minutes named, as §3 reads an outage.
- **The page name.** It is now "Stablecoin quotes variant-2" (its id, tables, lease and record stay `live`). "Stablecoin quotes
  LIVE twin" is the £300 twin of the same rules (`live300`, `2026-10-26-live-size-twins-prereg.md`), the size LIVE is about to
  take. This file's row in §1 is as `0136` inserted it.

**Deviation 2 (2026-10-27): `quotes_twin.ts` gains PR5-OPT's rules; this twin does not change.** Davies, 2026-10-27: "…还有哪些可以值得研究和测试的地方（比如每个%不同的档挂单钱数不同？不同的档位%？不同的细分rules等等）". The
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

§5 keeps the hash the file was frozen at; this table names it from this deviation on (`src/live_twin.test.js`).

**Deviation 3 (2026-10-28): `quotes_twin.ts` turns no twin before the minute after its start; this twin does not change.** `2026-10-27-pr5-opt-twins-now-prereg.md`'s five twins, inserted by `0149` at 04:56 UTC on 10-27 for a 06:00 start, were
sent straight to forward turns, and their start conversions went out at 05:50, before their rules' instant, so unweighted (that
pre-registration's deviation 1, `0152`). `quotes_twin.ts` now turns no twin before the minute after its start, the minute a
catch-up's first turn stands in: a twin whose row lands early waits for it. **This twin is not changed**: it started before this change and is
past its start, where the driver runs the code path it ran (every test of a running twin in `quotes_twin.test.ts` is
unchanged). Its window, reading and bar are as written. Not blind.

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_twin.ts` | 2b84a1ebbdc1172375ff7c783a463ce39e266c490b2256314eae8893b5548e68 |

§5 and deviation 2 keep the hashes the file had before; this table names it from this deviation on (`src/live_twin.test.js`).
