# Pre-registration: "Stablecoin quotes variant-5", the USDC-GBP nudge on USDC:USDT 1:1, against variant-4 (2026-10-29, migration `0178`)

**Status: FROZEN** at the commit that adds this file, the migration `0178` and the code it names. Not blind: the studies it
rests on read every record (no no-peek rule since 2026-10-04), and this reading says so.

## 0. On whose word

Davies, 2026-10-29: "…variant-6改为usdc和usdt 1:1作为两个币都做的对比（追踪usdt和usdc的年化比率，在它子页面的score board下加一行文字更新这个）",
and on the nudge twin: "原 variant-7 …这个在'原 variant-6…改成 USDC:USDT 1:1…'这个基础上做，也加那一行文字" (the old variant-7, REVX-FAIR's
USDC-GBP nudge, rebuilt on the old variant-6 made USDC:USDT 1:1, with the same line). The nudge is REVX-FAIR's lead
(`reviews/2026-10-29-revx-fair-price-study.md` §5–6), first run at $300 on USDC-GBP alone (`u300nudge`, `0169`), stopped by `0178`
(`reviews/2026-10-29-usdt-only-deviation.md`).

## 1. What it is, and its control

| | `n600nudge` "Stablecoin quotes variant-5" | `n600usdt` "Stablecoin quotes variant-4" (the control) |
|---|---|---|
| engine, keys | PR5's rule (`pr5`), the live account's one key | the same |
| rules from 2026-10-30 00:00 UTC | LIVE's fill rule ("at"), the weekend rule, the £1 holding line, USDC:USDT 1:1 (`weights`) | the same (its fill rule, weekend and line from earlier instants, all in force) |
| fair | **nudged on USDC-GBP** (`fairNudge`: w 0.5, a 24-hour half-life; `quotes_nudge.ts`, unchanged since `0169`) | PR5's, unchanged |
| capital, rungs | £600; twelve rungs of £50, both books | the same |
| start | 2026-10-30 00:00 UTC, flat, no backfill | running since 2026-10-28 22:00 (USDT-GBP alone until 00:00), its coin rebooked to 1:1 from 00:00 |
| page | TESTING, after variant-4, with the USDT/USDC line | TESTING, variant-4, with the USDT/USDC line |

**The control is the comparison.** The two differ by the nudge and by the control's past: it enters the window holding the
USDT-only book's inventory and positions, which its rebook (`rebookOn`, quotes_live.ts: maker orders only, for 72 hours from
00:00) sells and buys into 1:1, while variant-5 starts flat and buys its coin at its start. The days from 2026-11-02 00:00, after
the rebook, are reported apart for that reason.

**The nudge**, as `reviews/2026-10-29-revx-usdc-nudge-twin-prereg.md` §1 sets it out (each minute of USDC-GBP: Coinbase's mid at
most 5 minutes old, g = m ÷ f − 1, its EMA with a 24-hour half-life warmed on the 72 hours before the start, dev = g − e, a
fallback at |dev| ≥ 50 bps, f′ = f × (1 + 0.5 × dev)); USDT-GBP is priced off PR5's fair as the control's is.

Its row exactly as the migration inserts it:

```json
{ "id": "n600nudge", "display_name": "Stablecoin quotes variant-5", "display_order": 52, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-30T00:00:00Z", "table_prefix": "agent_quote_twin_n600nudge", "lease": "quotes-twin-n600nudge", "rules": { "fill": { "model": "at", "from": "2026-10-30T00:00:00Z" }, "weekend": { "from": "2026-10-30T00:00:00Z" }, "holdMin": { "from": "2026-10-30T00:00:00Z", "gbp": 1 }, "weights": { "from": "2026-10-30T00:00:00Z", "book": { "USDC-GBP": 1, "USDT-GBP": 1 } }, "fairNudge": { "from": "2026-10-30T00:00:00Z", "book": "USDC-GBP", "w": 0.5, "halfLifeMin": 1440 } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-29-usdt-only-twins-prereg.md", "migration": "0178", "enabled": true, "hidden": false }
```

## 2. Why, and what to expect

REVX-FAIR §5 replayed the nudge on LIVE's rules on 18 days (10-11 → 10-29): on USDC-GBP's £50 rungs of a £600 book on both
books, this twin's own shape, **+0.64 bps of capital a day** under LIVE's fill rule (90 % −0.16 to +1.46, P(≤ 0) 0.09). That
record is in sample: it is the expectation, not evidence. Its interval spans 0, so a 28-day window may well miss the bar at that
effect; no power was computed for this pre-registration, and the reading says so.

## 3. Window, reading and bar

- **Window:** the 28 days 2026-10-30 00:00 → 2026-11-27 00:00 UTC, each day 00:00 → 00:00. If the migration applies after the
  start, variant-5 catches up from it on PR5's own record, and the reading says so.
- **Reading:** on or after 2026-11-28 00:00 UTC, by a script committed before 2026-11-27 00:00 that computes exactly what follows.
- **What is read, for each twin:** its round trips as the page computes them (`liveRungTrips` over its filled orders, fees in),
  realised by the day a trip closes, in pounds; a rung still holding at the window's end marked at the book's last print.
- **The statistic:** each day's difference d = (variant-5 − variant-4) ÷ £600 × 10,000 (bps of capital); its mean over the 28
  days; a circular 3-day block bootstrap of that mean, 10,000 resamples, seed 20261130, and the share of resampled means at or
  below 0.
- **The bar: PASS when the mean is above 0 and the share at or below 0 is under 0.10.** Anything else is not a pass.
- **Reported beside it, no bar:** the same on USDC-GBP's trips alone and on USDT-GBP's alone (the nudge acts on USDC-GBP; a
  USDT-GBP difference is the coin's and the start's); the days from 2026-11-02 00:00 apart; each twin's fills, trips and bps a
  trip; the nudge's record (minutes nudged, stale, capped; the median |dev|); **the USDT/USDC line of each twin**: each book's
  realised a year on its half since 00:00 and their ratio, as the page shows it (`twinBookRatio`), for the window's end.
- **What a pass means:** the nudge on USDC-GBP is a candidate for a book on both coins; LIVE quotes USDT-GBP alone from 00:00,
  so a pass reopens nothing by itself and goes to Davies. A fail closes the lead on Revolut X.
- **Health, daily, until the reading:** each twin's `_sim` row's `last_error`, its mode and state's `updated_at` against PR5's
  call, no `ops_errors` `agents.quotes_twins`; the nudge's record growing a row a minute; the control's rebook done (its coin
  within its asks' worth and the 2 % buffer on both books) by 2026-11-02 00:00.

## 4. Its record before now

None for variant-5. Variant-4's record from 2026-10-28 22:00 to 00:00 is on USDT-GBP alone (as `n600usdt`) and is not read.

## 5. Frozen files

| file | sha256 |
|---|---|
| `supabase/migrations/0178_quote_twins_usdt_only.sql` | e69c329ae926bbb9cd49da4c28db5c962de877204524616315fb6c875b3e9c98 |
| `supabase/functions/agents/quotes_nudge.ts` | d3bd6c1ed80434f0c2443266fedbb32716f32cd6b696b1d60adfa1f0a2d16b73 |
| `supabase/functions/agents/quotes_twin.ts` | c14d9138ca27cf859d0efe586698b3cfce390d715810fe7338989f00ec6a8de5 |
| `supabase/functions/agents/quotes_live.ts` | eb9790f61931636ca0ee58d7d4fbbb0d2d515fd2e2dc197303fd8f805d79136a |
| `supabase/functions/agents/revx_sim.ts` | 7f05baba5a1a066166791e184ddac505bcd692865864dd219172d4c87569cc47 |
| `supabase/functions/agents/quotes_weekend.ts` | b811ca70b761f85ffa8c8ab00096cece8e06177763c64c2f8806985610d657a2 |

A change to a frozen file after the freeze is a deviation: reported in a record of its own and in the ledger.

## 6. Disclosures before the freeze

The USDT-ONLY study (`reviews/2026-10-29-usdt-only.md`) and REVX-FAIR's replays were read in full before this was written;
`u300nudge`'s record (from 10-29 08:00, under a day) was not read for this. No forward record of variant-5 exists.
