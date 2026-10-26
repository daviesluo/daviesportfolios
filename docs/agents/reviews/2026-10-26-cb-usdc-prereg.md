# Pre-registration: "Stablecoin quotes with Euros - 2", the weekend variant's rule on Coinbase's USDC books at 25 a rung (2026-10-26)

**Status: FROZEN** at the commit that adds migration `0142` and `agents/cb_usdc.ts`. Any later change is a deviation, written in
§7 with its date and reason. It changes no other test, row or reading: the base test ("with Euros", reading 11-08) and the
weekend variant ("with Euros - 1" since `0142`, "- 2" before; reading 11-10, `2026-10-13-coinbase-weekend-prereg.md`) run as
frozen.

## 0. On whose word

Davies, 2026-10-26, on the stablecoin quotes review of that day (`2026-10-26-stablecoin-quotes-review.md`, §6), verbatim: "目前的
Stablecoin quotes with Euros - 2改为-1，然后-2改为你说的这个新策略在-1（含周末）的基础上做" (rename the current "with Euros - 2" to "- 1",
and make "- 2" the new strategy proposed, built on "- 1", weekends included).

## 1. What differs from its base ("with Euros - 1", the weekend variant, `cb_hold.ts`)

| | the weekend variant | this arm |
|---|---|---|
| books | USDC-GBP, USDT-GBP, USDC-EUR, USDT-EUR | **USDC-GBP and USDC-EUR only** |
| rung | £100 (GBP book), €100 (EUR book), six a book | **£25 and €25**, six a book |
| capital | £1,200 + €1,200 | **£150 + €150, about £281 at 0.875 £/€** (`cbUsdcCapitalGbp`) |
| rule | PR5's (`stepMinute`), the rates held through a closure up to 60 h, the release blackout | the same, imported, unchanged |
| prints, rates, fair | the recorder's (`cb_trades`), PR5's stored GBP/USD, `cb_quote_inputs`' EUR/USD | the same tables |
| tables, lease, call | `cb_hold_*`, `cb-hold`, `agents?action=cbhold` | `cb_usdc_*`, `cb-usdc`, `agents?action=cbusdc` (`0142`) |
| start | 2026-10-13 00:00 | **the first 00:00 UTC after its first run** (flat, no backfill) |

**How 25 a rung is made without touching `stepMinute`** (quotes.ts, frozen: its rung is 100 of the book's currency, capped at
10 % of the minute's printed value):
- The engine is given every print's size × 4. Its cap min(100, 10 % × 4 × value) is then 4 × min(25, 10 % × value).
- Every size, notional and P&L it writes comes back ÷ 4.
- Its decisions (prices, re-prices, fills, exits, stops) are the weekend variant's minute for minute on the same prints. Only the
  size differs, and only where 10 % of the minute is under the rung.
- `cb_usdc.test.ts` pins this beside the weekend variant on one world.

## 2. Why, and what is in sample

- **The review's §6 (in sample, 10-11 → 10-25).** Coinbase's USDT books lost: USDT-EUR −1.1 bps a trip, USDT-GBP −2.5. Its USDC
  books earned as Revolut X's USDC book does: USDC-GBP +9.5 bps, USDC-EUR +9.4, about 10–12 % a year of their capital at £100 a
  rung. Over the weekend variant's days the USDC books made +10.8 bps (USDC-GBP, 45 trips) and +6.8 (USDC-EUR, 28 trips).
- **The selection was made with hindsight.** These books were chosen on those days' figures, so this test is the out-of-sample
  check of that choice.
- **What the smaller rung can and cannot change.** At 25 a rung the paper engine makes the same decisions, so per pound it can
  only match or beat £100 rungs. It does better where 10 % of a minute's prints is under £100. The comparison with the weekend
  variant's USDC books is therefore near mechanical, and is not the bar. The bar is whether the USDC books earn forward at all.

## 3. Window, reading and bar

- **Window**: the 14 UTC days from the arm's first decided minute (its `startedAt`, a 00:00 UTC), so two closures.
- **Reading**: on or after the window's end, with read-only SQL on `cb_usdc_trips` (round trips by their close `t_exit`) and,
  for the comparison, `cb_hold_trips` on the USDC books over the same days. A script is committed before the window ends.
- **Bar**: all three, over the window.
  1. Realised P&L above zero.
  2. Realised at least 8 % a year of its capital: realised ÷ £281 (at the window's last EUR/GBP) × 365 / 14. This is PR5's
     "worth more than cash" line, which in sample was 10–12 %.
  3. A mean of at least +5 bps a round trip (P&L ÷ notional), against the in-sample +9.5 and +6.8.
- **Reported beside the bar:**
  - its per-pound return against the weekend variant's USDC books, which it should match or beat by construction (a miss names a
    fault);
  - round trips a day, the stops, the weekends' share, and each book apart.
- **A pass** makes a USDC-only Coinbase arm a candidate beside the base test's own reading (11-08). **A miss** retires this arm.
- **Health**, daily:
  - its state row's `last_error`;
  - `last_minute` within a few minutes of the recorder's coverage;
  - `agents?action=cbusdc` beating each minute;
  - no `agents.cb_usdc` in `ops_errors`.

## 4. Its record before now

None. It starts flat at the first 00:00 UTC after its first run, as the weekend variant did, and reads no print from before it.

## 5. Frozen files

| file | sha256 |
|---|---|
| `supabase/migrations/0142_quote_twins_take50_cb_usdc.sql` | 109408cc8c3c3c96493508413d291df5f6b2f96b6ee7dca3f96d4a9032b1f0c7 |
| `supabase/functions/agents/cb_usdc.ts` | 3d48794f78f8e71f51a396e16ba5ed503145ae5ffa395805c2038fcbaf9567d3 |
| `supabase/functions/agents/cb_usdc.test.ts` | b3e2383ab6460986c3bce14bd7be15065483a0bd77a17701400844fcdbbc809e |
| `supabase/functions/agents/cb_hold.ts` | 3795b05c5c3b38b30065c13c6c907e6c684fafe195055d3792d3290b25d365f8 |
| `supabase/functions/agents/cb_quotes.ts` | 3929d8a9a47d0ac240d865fec3fd56c4b08e6912b10c72e6fe8d7ee31eebd808 |
| `supabase/functions/agents/quotes.ts` | 0782ed8140a2e490f19b9e92fe7093c2cb9a6f205866180314f609537277f517 |

`src/cb_usdc_prereg.test.js` pins them.

## 6. Disclosures before the freeze

- Every Coinbase trip to 2026-10-26 01:00 UTC was read (the review's §6). The books were chosen on those figures.
- The bar's 8 % and +5 bps were set after seeing the in-sample 10–12 % and +6.8 to +9.5 bps.
- Not blind.

## 7. Deviations

None.
