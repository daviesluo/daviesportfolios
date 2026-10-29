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

**Deviation 1 (2026-10-29, before the reading): $25 a rung, the record counted in dollars.** Davies, 2026-10-29, verbatim: first
"C，coinbase的也是改用美元", then, of the funded figures the page showed in dollars (this arm's was £150 + €150, about $367):

> Coinbase策略中funded数字怎么那么奇怪，都改成整数调整

- **Size.** From the switch, a rung is **$25** of the book's currency (`CB_USDC_RUNG_USD`): **$300 on the two books**.
  - $25, not $100, because this arm's design is the small rung: §1 makes it a quarter of the weekend variant's, and §2's case is what
    the small rung fills that £100 does not.
  - $25 keeps that quarter of the others' $100.
- **How.** `cb_usdc.ts` calls the base test's `cbUsdSwitch` and `cbMinuteInputs(…, usd)`. The engine's 100 becomes $100 and is
  still ÷ `CB_USDC_FACTOR` (4), so §1's construction holds unchanged in dollars.
- **The instant.** The arm's first minute at or after 2026-10-29 00:00 UTC with both rates known.
  - It is written to `cb_usdc_state.state` (`usdFrom`, `usdGbpusd`, `usdEurusd`, `usdFactor`).
  - The reading quotes them from there.
- **The factor.** $25 ÷ the old £25 / €25 rung's dollars at the instant: 1 / GBP/USD on USDC-GBP, 1 / EUR/USD on USDC-EUR.
  - At GBP/USD 1.3324 and EUR/USD 1.1151 (the last stored rates when this was written, 2026-10-29 04:06–04:07 UTC) that is 0.7505 and
    0.8968, and $300 ÷ $367.13 = **0.817** over the arm.
- **The assumption.** Fills and fees scale linearly with size. The page shows what was entered before the instant × its book's factor;
  prices, counts and percentages are not scaled; no row is rewritten.
- **The bar, read in dollars.**
  - A trip's dollars are its pounds (`cb_usdc_trips.pnl_gbp`) × the window's mean GBP/USD, × its book's factor if it was entered
    before the instant.
  - Bar 1 reads them.
  - Bar 2 is realised ÷ **$300** × 365 / 14 ≥ 8 %.
  - Bar 3 (bps a round trip, P&L ÷ notional) is a ratio and is unchanged.
  - The comparison with the weekend variant's USDC books is per pound and unaffected: that arm switches the same way (its Deviation 3).
- **Frozen bytes this deviation names** (§5 keeps the originals; `src/cb_usdc_prereg.test.js` holds both):

| file | sha256 (Deviation 1) |
|---|---|
| `supabase/functions/agents/cb_usdc.ts` | 4fdf89c16b92ac7279b9593ee7946a209276de2b1a44ad8ae1b91d0f89d704a2 |
| `supabase/functions/agents/cb_usdc.test.ts` | dfa42316993faec080a5bd8c9ab0fa5361e29c0351db47af1d04cb3a059fe2db |
| `supabase/functions/agents/cb_hold.ts` | ea081c57918d6c0e6500da7dced0c2a3c57ccd0e8a2e09d9c2cdc06c9aa34fd9 |
| `supabase/functions/agents/cb_quotes.ts` | fe88387e54abad68ff3fe5a02fb8f2a768a09ccea860b4ab4a46cbbdd262c465 |

**Deviation 2 (2026-10-29, before the reading): $50 a rung, $600, the record before shown × 2.** Davies, 2026-10-29, verbatim:

> 建USDC 那个线索，在with euro-2的基础上开-3，只做300美元的USDC-GBP；另外把目前的-2数字*2做600美元funded

(the second half: double "- 2"'s figures, $600 funded; the first half is "with Euros - 3", pre-registered in
`2026-10-29-cb-usdc-nudge-prereg.md`).

- **Size.** From the switch, a rung is **$50** (`CB_USDC_RUNG_USD_50`): **$600 on the two books**. The engine's $100 is divided by 2
  instead of 4 (`CB_USDC_FACTOR_50`, `cbUsdcFactorAt`). §1's construction holds unchanged at the new divisor.
- **The instant.** The first minute "- 2" decides at or after **2026-10-29 12:00 UTC** (`CB_USDC_50_NOT_BEFORE`), once Deviation 1
  has switched (`cbUsdc50Switch`).
  - It is written once into `cb_usdc_state.state` as `usd50From`, with `usd50Factor` = 2.
  - If the deploy lands after 12:00, it is the first minute decided after the deploy. The reading quotes it from the state.
- **A rung held across the switch** keeps the coins it holds: the engine keeps sizes × its divisor, so its size and notional
  are halved in the engine's units at the switch. Resting orders carry no size, since a fill sizes itself.
- **The record before the switch** is shown × 2 on the page: a trip by its entry, a held rung by its fill, in P&L, cost and size.
  - This stacks on Deviation 1's factor for what came before that switch.
  - Prices, counts and percentages are not scaled. No stored row is rewritten (no migration).
- **Where × 2 is not exact.** Linear scaling assumes each fill would have been twice the size. The engine caps a rung at 10 % of
  the minute's printed value, and that cap binds sooner at $50 than at $25.
  - Of the 15 entry fills to 2026-10-29 06:23 UTC, the cap bound on none at $25 (each filled a whole rung).
  - At $50 (£37.5 or €44.8 at the day's rates) it would have bound on **one**: USDC-GBP at 2026-10-28 01:03 UTC. That minute
    printed £261, so the rung would have filled £26.1, not £37.5. The scaled record overstates that trip by about 1.44×.
  - Fills between then and the switch are counted the same way at the reading: an entry fill whose minute's printed value
    × 10 % (`cb_usdc_events.detail.minuteGbp`, in the book's currency) is under the $50 rung in that currency.
  - From the switch the engine runs at $50 for real, cap included.
- **The bar, read on $600.**
  - Bar 2 is realised ÷ **$600** × 365 / 14 ≥ 8 %, on the record as the page shows it (× 2 before the switch, and Deviation 1's
    factor before that one).
  - Bar 1 (above zero) and bar 3 (bps a round trip, P&L ÷ notional, a ratio) are unchanged.
  - Bar 3 is read on the record as it ran, since the cap makes the scaled notional of the one trip above inexact.
  - The comparison with the weekend variant's USDC books is per pound and is unaffected.
- **"with Euros - 3" runs this file's driver** (`runCbUsdcArm`, the same steps; "- 2" is `CB_USDC_ARM`). `cb_usdc.test.ts` pins
  that "- 2"'s rows are as they were on every earlier world. `cb_nudge.test.ts` pins that with no Revolut X book, "- 3" writes
  exactly "- 2"'s USDC-GBP rows.
- **Frozen bytes this deviation names** (`src/cb_usdc_prereg.test.js`, which holds §5's and Deviation 1's as well):

| file | sha256 (Deviation 2) |
|---|---|
| `supabase/functions/agents/cb_usdc.ts` | 0f54887c0e5b96941b697b76390214cfeea7045c96f7f41f41eca8d70d09d7b9 |
| `supabase/functions/agents/cb_usdc.test.ts` | 80ce8b868077dd63a8d292999ddb6e571d32f7ffe4a1ce1153ce4a27c0dc1dc5 |
