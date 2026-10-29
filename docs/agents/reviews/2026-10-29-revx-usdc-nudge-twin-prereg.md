# Pre-registration: "Stablecoin quotes variant-7", USDC-GBP with its fair nudged by Coinbase (2026-10-29, migration `0169`)

**Status: FROZEN** at the commit that adds this file, the migration `0169` and the code it names. Not blind: the study
whose lead this tests read every record (no no-peek rule since 2026-10-04), and this reading says so.

## 0. On whose word

Davies, 2026-10-29: "“唯一的线索：只针对 USDC-GBP • 做法：用 Coinbase 的 USDC-GBP 中间价偏离程度，对合理价做半权重的微调。” 这个开testing
variant-7，在目前实盘的基础上做300美元funded" (the one lead, on USDC-GBP only: the fair adjusted at half weight by how far
Coinbase's USDC-GBP mid has moved; open it as testing variant-7, on LIVE's current rules, funded $300). The lead is REVX-FAIR's
(`docs/agents/reviews/2026-10-29-revx-fair-price-study.md` §5, its recommendation §6.2).

## 1. What it is, and its control

Two twins, the same in everything but the nudge:

| | `u300nudge` "Stablecoin quotes variant-7" | `u300ctl` "Stablecoin quotes USDC control from 10-30" |
|---|---|---|
| engine, keys | PR5's rule (`pr5`), the live account's one key | the same |
| rules | LIVE's fill rule and weekend from the start; USDC-GBP alone (`weights`: USDT-GBP 0) | the same |
| fair | **nudged** (`fairNudge`, below) | PR5's, unchanged |
| capital | £225.33 = $300 at GBP/USD 1.3314 (`usdCapital`; the page shows FUNDED $300) | the same, not on the page |
| rungs | six on USDC-GBP, £37.55 each (`rungGbpOf`: £225.33 ÷ 6, to the penny below; about $49.99) | the same |
| start | 2026-10-30 00:00 UTC, no backfill | the same |
| page | TESTING, after variant-6 | hidden (`hidden`: it runs, the page shows nothing of it) |

**The control is the comparison.** LIVE's £600 twin (`live600`) quotes USDC-GBP at £50 a rung beside USDT-GBP, so its USDC
book differs in size and in the fills a print can give; the control is variant-7 without the nudge, on the same capital,
rungs, fill rule and minutes, so the day-by-day difference is the nudge's alone.

**The nudge** (`supabase/functions/agents/quotes_nudge.ts`), §5's replay as written there, each minute t of USDC-GBP:
- f = fairU ÷ X as PR5's rule takes it (X held through a closure by the weekend rule);
- Coinbase's mid m: the latest touch of `cb_touch` (USDC-GBP) stamped at or before t − 1 ms and no more than 5 minutes before
  it; else the minute falls back to f ("stale");
- g = m ÷ f − 1; its EMA moves only on minutes with both, with a **24-hour half-life** (e ← e + (1 − 0.5^(Δ minutes ÷ 1,440))
  (g − e)), warmed on the 72 hours before the start;
- dev = g − e; at |dev| ≥ 50 bps the minute falls back to f ("cap"); else **f′ = f × (1 + 0.5 × dev)**;
- the replica's entries and exits price off f′ (its fairU becomes f′ × X), and so do the executor's exits, its stop's bound and
  its guards (`nudgedInputs`); every minute is recorded in `agent_quote_twin_nudge` (fair, mid, EMA, dev, f′, fallback).

Its rows exactly as the migration inserts them:

```json
{ "id": "u300nudge", "display_name": "Stablecoin quotes variant-7", "display_order": 51, "engine": "pr5", "capital_gbp": 225.33, "gov": "account", "start": "2026-10-30T00:00:00Z", "table_prefix": "agent_quote_twin_u300nudge", "lease": "quotes-twin-u300nudge", "rules": { "fill": { "model": "at", "from": "2026-10-30T00:00:00Z" }, "weekend": { "from": "2026-10-30T00:00:00Z" }, "weights": { "from": "2026-10-30T00:00:00Z", "book": { "USDC-GBP": 1, "USDT-GBP": 0 } }, "usdCapital": { "usd": 300, "gbpusd": 1.3314 }, "fairNudge": { "from": "2026-10-30T00:00:00Z", "book": "USDC-GBP", "w": 0.5, "halfLifeMin": 1440 } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-29-revx-usdc-nudge-twin-prereg.md", "migration": "0169", "enabled": true, "hidden": false }
```

```json
{ "id": "u300ctl", "display_name": "Stablecoin quotes USDC control from 10-30", "display_order": 52, "engine": "pr5", "capital_gbp": 225.33, "gov": "account", "start": "2026-10-30T00:00:00Z", "table_prefix": "agent_quote_twin_u300ctl", "lease": "quotes-twin-u300ctl", "rules": { "fill": { "model": "at", "from": "2026-10-30T00:00:00Z" }, "weekend": { "from": "2026-10-30T00:00:00Z" }, "weights": { "from": "2026-10-30T00:00:00Z", "book": { "USDC-GBP": 1, "USDT-GBP": 0 } }, "usdCapital": { "usd": 300, "gbpusd": 1.3314 } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-29-revx-usdc-nudge-twin-prereg.md", "migration": "0169", "enabled": true, "hidden": true }
```

## 2. Why, and what to expect

REVX-FAIR §5 replayed this nudge on LIVE's rules on 18 days (10-11 → 10-29, the days Coinbase's touch was recorded): on
USDC-GBP's £50 rungs it added +0.64 bps of £600 a day under LIVE's fill rule (90 % −0.16 to +1.46, P ≤ 0 0.09), +0.58 under
the stricter through-only rule, ahead in both halves; all 42 settings and fill rules checked were positive; trips 111 → 118 and
9.96 → 10.44 bps a trip. In this twin's own terms (its whole capital on USDC-GBP; a trip's P&L scales with its rung):
**about +1.28 bps of capital a day** (90 % about −0.32 to +2.92). The same nudge lost on USDT-GBP, which is why the twin
quotes USDC-GBP alone. That record is in sample: it is the expectation, not evidence.

## 3. Window, reading and bar

- **Window:** the 28 UTC days 2026-10-30 00:00 → 2026-11-27 00:00. If the migration applies after the start, both twins catch
  up from it on PR5's own record together, and the reading says so.
- **Reading:** on or after 2026-11-28 00:00 UTC (a day for the window's last trips to close), by a script committed before
  2026-11-27 00:00 that computes exactly what follows. It may be read beside the size twins' and PR5-OPT's readings; it waits on
  none of them.
- **What is read, for each twin:** its round trips as the page computes them (`liveRungTrips` over its filled orders, fees in),
  realised by the UTC day a trip closes, in pounds; a rung still holding at the window's end marked at the book's last print.
- **The statistic:** each day's difference d = (variant-7 − control) ÷ £225.33 × 10,000 (bps of capital); its mean over the 28
  days; a circular 3-day block bootstrap of that mean, 10,000 resamples, seed 20261127, and the share of resampled means at or
  below 0.
- **The bar: PASS when the mean is above 0 and the share at or below 0 is under 0.10.** Anything else is not a pass.
- **Reported beside it, no bar:** each twin's fills, round trips and bps a trip; the nudge's record over the window (minutes
  nudged, stale, capped; the median |dev|); the two halves of the window; the weekdays and the closures apart.
- **What a pass means:** the nudge is a candidate for LIVE's USDC-GBP book, which is Davies' decision alone; nothing here moves
  money. A fail closes the lead on Revolut X.
- **Health, daily, until the reading:** each twin's `_sim` row's `last_error`, its mode and state's `updated_at` against PR5's
  call, the twins call's beats, no `ops_errors` `agents.quotes_twins`; the nudge's record growing a row a minute with a
  `stale` share near the recorder's own gaps. A Coinbase recorder outage makes variant-7 its control for its length (every
  minute falls back); the reading counts such minutes.

## 4. Its record before now

None: both start flat at 2026-10-30 00:00 UTC. The nudge's EMA is warmed on the 72 hours before, from PR5's own record and the
recorded touches; nothing of that warm-up is a trade.

## 5. Frozen files

| file | sha256 |
|---|---|
| `supabase/migrations/0169_quote_twin_usdc_nudge.sql` | 66a945b556d8c772ea498c5344d546b53c6018a4f3432e5769773435758fc467 |
| `supabase/functions/agents/quotes_nudge.ts` | d3bd6c1ed80434f0c2443266fedbb32716f32cd6b696b1d60adfa1f0a2d16b73 |
| `supabase/functions/agents/quotes_twin.ts` | c14d9138ca27cf859d0efe586698b3cfce390d715810fe7338989f00ec6a8de5 |
| `supabase/functions/agents/quotes_live.ts` | 12e3dad7cc9058cedc7cd840fc4ac5d3396b955c842e39fd70f22f18cfad25eb |
| `supabase/functions/agents/revx_sim.ts` | 7f05baba5a1a066166791e184ddac505bcd692865864dd219172d4c87569cc47 |
| `supabase/functions/agents/quotes_weekend.ts` | b811ca70b761f85ffa8c8ab00096cece8e06177763c64c2f8806985610d657a2 |

A change to a frozen file after the freeze is a deviation: reported here, in an addendum, and in the ledger.

## 6. Disclosures before the freeze

REVX-FAIR's replays (§4–5 of its review, and its Coinbase mirror in §8) were read in full before this was written; no forward
record of either twin exists. The replay's window (10-11 → 10-29) ends before this window starts. Adding the rules to the
driver changed a file eight running pre-registrations freeze, recorded in
`docs/agents/reviews/2026-10-29-variant7-frozen-files-deviation.md` with the evidence that no twin without the rules changes.

## 7. Deviations

None.
