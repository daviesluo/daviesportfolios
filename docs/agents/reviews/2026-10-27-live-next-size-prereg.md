# Pre-registration: LIVE's rules at £1,200, "Stablecoin quotes variant-1" (`live1200`) (2026-10-27)

**Status: FROZEN** at the commit that adds migration `0144`. Any later change is a deviation, written in §7 with its date and
reason. Written from `TEMPLATE-variant-prereg.md`. Its base is the £600 twin (`live600`, `2026-10-26-live-size-twins-prereg.md`),
"Stablecoin quotes LIVE twin" since `0144`. LIVE went to £600 on 2026-10-27 at 03:09 UTC.

## 0. On whose word

Davies, 2026-10-27, verbatim: "我已经加到600了，你验证下并检查确保策略所有细节都没问题，然后把测试的Stablecoin quotes LIVE twin改为600，Stablecoin
quotes variant-1改为你仔细研究下下次加仓的目标仓位本金的测试，所有数据都可以看" (I have added up to 600; check every detail of the strategy, then
make the LIVE twin in testing 600, and make variant-1 a test of the capital for the next step, researched with every record). The
research is `2026-10-26-stablecoin-quotes-review.md` §8.

## 1. What differs from its base

| | `live600` (£600, "LIVE twin") | `live1200` |
|---|---|---|
| engine, keys | PR5's paper engine, one key | the same |
| capital | £600: £50 a rung | **£1,200: £100 a rung** |
| rules | `fill` "at" from 10-27 00:00; `weekend` from 10-30 21:00 | **`fill` "at" from 10-28 00:00**; `weekend` from 10-30 21:00 |
| take | none | none |
| start, record before | 2026-10-27 00:00 UTC, flat | **2026-10-28 00:00 UTC, flat, no backfill** |

Page name "Stablecoin quotes variant-1" (`display_order` 13), after the LIVE twin (12) and before variant-2 (15). Its row, as `0144`
inserts it:

```json
{ "id": "live1200", "display_name": "Stablecoin quotes variant-1", "display_order": 13, "engine": "pr5", "capital_gbp": 1200, "gov": "account", "start": "2026-10-28T00:00:00Z", "table_prefix": "agent_quote_twin_live1200", "lease": "quotes-twin-live1200", "rules": { "fill": { "model": "at", "from": "2026-10-28T00:00:00Z" }, "weekend": { "from": "2026-10-30T21:00:00Z" } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-27-live-next-size-prereg.md", "migration": "0144", "enabled": true }
```

"LIVE's rules" means here what it means for its base (that file's §1): PR5's decisions carried out by `quotes_live.ts` as it stands,
LIVE's fill rule, PR5-W's weekend on the twin's own replica, and no take.

## 2. Why £1,200

LIVE's own orders since go-live, queue-aware (review §8, `backtests/scq_review/2026-10-27/`), fill per pound of order size,
against £10 a rung:

| rung | £10 | £50 | £75 | £100 | £125 | £150 | £200 |
|---|---|---|---|---|---|---|---|
| capital | £120 | £600 | £900 | £1,200 | £1,500 | £1,800 | £2,400 |
| entries and exits, mean | 1.00 | 0.90 | 0.85 | **0.82** | 0.78 | 0.76 | 0.71 |
| against £50 | 1.11 | 1.00 | 0.95 | **0.91** | 0.87 | 0.84 | 0.79 |

£1,200 is the largest step whose per-pound rate stays above 80 % of £120's on this read, and it doubles LIVE's capital. The size
study (09-23 → 10-02) is less hopeful, with £100 a rung at 0.69 of £10's (0.78 of £50's), and the through-fill twins measured
£100 at 0.82 of £50. So the bar below can fail, and a reading either way tells Davies something.

## 3. Window, reading and bar

- **Window**: 2026-10-28 00:00 → 2026-11-11 00:00 UTC (14 days, two closures), the window of its base's own reading. If it first
  turns after 10-28 00:00, the window is the 14 days from the first 00:00 UTC after its first turn, its base read over the same
  days, and the reading says so.
- **Reading**: on or after the window's end, beside its base's. Each twin's realised by the page's own walk (`liveRungs`,
  `liveRungTrips`), and each marked to market at the paper engine's fair, as
  `backtests/scq_review/2026-10-26/scripts/series.ts` does.
- **Bar**, both:
  1. `live1200`'s realised per pound of capital is at least 80 % of `live600`'s over the window;
  2. no day of the window on which `live1200`'s executor wrote a `loss_stop` event (its day's loss reached 1 % of its capital).
  - Pass: the evidence for LIVE at £1,200, Davies' call.
  - Miss: LIVE stays at £600, and the reading names where the £1,200 twin lost: fills, exits, funds or stops.
- **Reported beside the bar, no bar of its own:** each twin's marked-to-market per pound, entry fill rate, round trips, stops, and
  the share of each weekend.
- **Health only, until the reading**, daily: its `_sim` row's `last_error`, `paperCheck` mismatches and mode; its state's
  `updated_at` against PR5's call; no `agents.quotes_twins` error. Its record may be read at any time.

## 4. Its record before now

None: it starts flat at 2026-10-28 00:00 UTC. At its first turn the operator's maker conversions put a quarter of the capital into
each coin.

## 5. Frozen files

| file | sha256 |
|---|---|
| `supabase/migrations/0144_quote_twins_live_at_600.sql` | ed3e1f7419b9ecdf26d71f2c69e35f85bb5fe1797ca15cb324ac15d5969a1e00 |
| `supabase/functions/agents/quotes_twin.ts` | 36092d7f506565d5c89d11ea389d569e2106f738768d1a7450f4e3e39595c3d7 |
| `supabase/functions/agents/revx_sim.ts` | 7f05baba5a1a066166791e184ddac505bcd692865864dd219172d4c87569cc47 |
| `supabase/functions/agents/quotes_weekend.ts` | b811ca70b761f85ffa8c8ab00096cece8e06177763c64c2f8806985610d657a2 |

`src/live_next_size.test.js` pins them. `agents/quotes_live.ts` is not frozen here: the twin runs it as it stands, as LIVE does.

## 6. Disclosures before the freeze

- The size was chosen from LIVE's whole record to 2026-10-27 03:00 UTC, the twins' to the same hour (the £300 and £600 twins had
  run three hours), and the size study. Not blind.
- PR5's paper engine sizes its own orders at $100 a rung (about £75), under this twin's £100: the paper decides when an exit goes
  out from its own fills, so a £100 rung may hold part of a position the paper has closed. LIVE carries the same mismatch the
  other way at £50. The twin measures it; nothing here corrects it.

## 7. Deviations

**Deviation 1 (2026-10-27): `quotes_twin.ts` gains PR5-OPT's rules; this twin does not change.** Davies, 2026-10-27: "…还有哪些可以值得研究和测试的地方（比如每个%不同的档挂单钱数不同？不同的档位%？不同的细分rules等等）". The
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

§5 keeps the hash the file was frozen at; this table names it from this deviation on (`src/live_next_size.test.js`).

**Deviation 2 (2026-10-28): `quotes_twin.ts` turns no twin before the minute after its start; this twin does not change.** `2026-10-27-pr5-opt-twins-now-prereg.md`'s five twins, inserted by `0149` at 04:56 UTC on 10-27 for a 06:00 start, were
sent straight to forward turns, and their start conversions went out at 05:50, before their rules' instant, so unweighted (that
pre-registration's deviation 1, `0152`). `quotes_twin.ts` now turns no twin before the minute after its start, the minute a
catch-up's first turn stands in: a twin whose row lands early waits for it. **This twin is not changed**: it started before this change and is
past its start, where the driver runs the code path it ran (every test of a running twin in `quotes_twin.test.ts` is
unchanged). Its window, reading and bar are as written. Not blind.

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_twin.ts` | 2b84a1ebbdc1172375ff7c783a463ce39e266c490b2256314eae8893b5548e68 |

§5 and deviation 1 keep the hashes the file had before; this table names it from this deviation on (`src/live_next_size.test.js`).

**Deviation 3 (2026-10-28): an exit that would cross the book rests inside it, from 10-29; this twin as LIVE.** `quotes_live.ts` (2026-10-28, on Davies' word that day about LIVE's exits "rejected — not sent: its price crossed the book"): from
2026-10-29 00:00 UTC every instance's exit whose rule price the book it meets shows crossing rests one tick inside the opposite
best (a buy at the best ask less a tick, a sell at the best bid plus one), always at least as good as the rule's price, instead
of a refused row that held the rung's next exit back a median 58 minutes on LIVE's record; a refused-for-crossing row from
before the instant holds nothing back after it. LIVE and every twin on its rules take it together, so the twins keep
mirroring LIVE. Where no exit crosses nothing changes (pinned in `quotes_live.test.ts` and `quotes_live_instance.test.ts`:
the same turns in force or not, and on each twin instance until the first crossing exit, which then rests inside). Entries
are unchanged. Window, reading and bar as written. Not blind.
