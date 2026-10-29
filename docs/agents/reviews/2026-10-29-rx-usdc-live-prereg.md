# Pre-registration: "Stablecoin quotes USDC/GBP LIVE twin" (2026-10-29, migration `0180`)

**Status: FROZEN** at the commit that adds this file, the migration `0180` and the code it names. Not blind: RX-USDC
(`reviews/2026-10-29-rx-usdc-live.md`) read every record (no no-peek rule since 2026-10-04).

## 0. On whose word

Davies, 2026-10-29 ~22:05 UTC: "…同时testing列表中Stablecoin quotes USDT/GBP LIVE twin底下也做一个usdc的twin".

## 1. What it is

`rxu120` "Stablecoin quotes USDC/GBP LIVE twin", right under the USDT/GBP LIVE twin on TESTING: the rules of "Stablecoin quotes
USDC/GBP" on Revolut X (`QUOTE_RXU_INSTANCE`) on a simulated account of £120 from 2026-10-30 00:00 UTC: PR5's paper engine's
decisions on USDC-GBP alone, £30 on each 0.1 % and 0.2 % rung a side and none on the 0.3 % rungs (`rules.weights`), every exit a
tick beyond fair (`rules.exitOffset`), LIVE's fill rule, the weekend rule and the £1 holding line. Its row exactly as the
migration inserts it:

```json
{ "id": "rxu120", "display_name": "Stablecoin quotes USDC/GBP LIVE twin", "display_order": 13, "engine": "pr5", "capital_gbp": 120, "gov": "account", "start": "2026-10-30T00:00:00Z", "table_prefix": "agent_quote_twin_rxu120", "lease": "quotes-twin-rxu120", "rules": { "fill": { "model": "at", "from": "2026-10-30T00:00:00Z" }, "weekend": { "from": "2026-10-30T00:00:00Z" }, "holdMin": { "from": "2026-10-30T00:00:00Z", "gbp": 1 }, "weights": { "from": "2026-10-30T00:00:00Z", "book": { "USDC-GBP": 1, "USDT-GBP": 0 }, "k": { "0.001": 1, "0.002": 1, "0.003": 0 } }, "exitOffset": { "from": "2026-10-30T00:00:00Z", "ticks": 1 } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-29-rx-usdc-live-prereg.md", "migration": "0180", "enabled": true, "hidden": false }
```

The twin quotes its weekend from its own replica's rule (`rules.weekend`), the live executor from LIVE's weekend replica; both
are PR5-W's rule on the same paper engine.

## 2. What to expect

RX-USDC's replay of these rules at £120: 36.3 % a year since 09-01 after the live haircut (80 % 28.4 to 44.6), 4.3 trips a day
under LIVE's rules on the book (the twin's rules shift trips to the inner rungs). In sample: the expectation, not evidence.

## 3. Window, reading and bar

- **Window:** the 28 days 2026-10-30 00:00 → 2026-11-27 00:00 UTC.
- **Its job is the yardstick of the live executor**, as the USDT/GBP LIVE twin is LIVE's: over the days both ran (from the live
  executor's first live order), each day's realised per pound of capital, live and twin.
- **Reading:** on or after 2026-11-28 00:00 UTC, by a script committed before 2026-11-27 00:00: the twin's % a year over the
  window; the live executor's over the days it ran; and the live executor's realised per pound over those days as a share of the
  twin's.
- **The bar (the live executor's, not the twin's): the share is 80 % or more.** Under it, the reading names where live fell
  short (fills, exits, stops, the start conversion) and it goes to Davies; nothing changes on its own.
- **Reported beside it, no bar:** each side's trips a day, bps a trip, stops, held share; the days before the live go.

## 4. Its record before now

None: it starts flat at 2026-10-30 00:00 UTC, its coin bought at its start as every twin's.

## 5. Frozen files

| file | sha256 |
|---|---|
| `supabase/migrations/0180_quotes_rx_usdc_live.sql` | 0f23442d6bde55359a9821d5432c077e5111e1450e992c28b58c8c37baa86829 |
| `supabase/functions/agents/quotes_twin.ts` | c14d9138ca27cf859d0efe586698b3cfce390d715810fe7338989f00ec6a8de5 |
| `supabase/functions/agents/quotes_live.ts` | d683bb5a4f1accf144c630a7d69bd565953a23879be847eade2ce2868d8bc86c |
| `supabase/functions/agents/revx_sim.ts` | 7f05baba5a1a066166791e184ddac505bcd692865864dd219172d4c87569cc47 |
| `supabase/functions/agents/quotes_weekend.ts` | b811ca70b761f85ffa8c8ab00096cece8e06177763c64c2f8806985610d657a2 |

A change to a frozen file after the freeze is a deviation: recorded apart, and in the ledger.
