# Putting what the Stablecoin quotes earn back to work: the audit, the rule and the go (COMPOUND, 2026-10-30)

**Status: built, and on.** The three live executors were turned on at ~02:10 UTC on 2026-10-30, on Davies' word "打开", with
§6's three statements (each returned one row; `compound_from` 2026-10-31 00:00 UTC), so their first step can come at 2026-11-01
00:00. The OKX paper twins compound from the same instant since the same day (§1, on his "…你觉得需要做的话就做").

**As built.** The twins and the Coinbase paper arms compound from 2026-10-31 00:00 UTC. The three live executors have the rule
behind a switch each, **off**, until Davies turns it on in the conversation where he says so (§6).

## 0. On whose word

- Davies, 2026-10-30 ~01:35 UTC: "另外再确认一下目前所有的live和testing的Stablecoin quotes都能有效做到盈利金额再利用吗？如果不能请研究实现"
  (confirm whether every LIVE and TESTING Stablecoin quotes effectively reuses the profit it makes; if not, research and build it).
- The rule is LIVE's own, built on 2026-10-27 on his "你再研究下策略如何能够有效利用账户中赚的钱，我希望赚的钱也能利用起来，现在好像完全没用到"
  (`0146`, `reviews/2026-10-26-stablecoin-quotes-review.md` §9) and never turned on.

## 1. The audit: none of them reused its profit

Every strategy sizes its rungs from a fixed number. What it realises stays in the account (or the paper record) as idle pounds and
coin, and never sizes anything.

| strategy | rung size today | capital cap today | what happens to realised profit | what limits reuse |
|---|---|---|---|---|
| **LIVE "Stablecoin quotes USDT/GBP"** (Revolut X `_2`, `QUOTE_LIVE_INSTANCE`) | `capital_gbp` × the rung's weight share: £600 on USDT-GBP's six rungs, £100 each (`rungGbpOf`) | `agent_quote_live_config.capital_gbp`, a fixed £600 | idle in the account (GBP and USDT); `0146`'s rule built, **off** | inventory checks (a bid needs free GBP, an ask free coin); top-ups £5 a book a day (uncapped during the 72-hour rebook); holdMin £1; loss stop 1 % of capital; governor 900 / 950 POSTs; Revolut X minimums |
| **LIVE "Stablecoin quotes USDC/GBP"** (Revolut X, `QUOTE_RXU_INSTANCE`) | £120 × weights: four £30 rungs (0.1 % and 0.2 % of USDC-GBP) | `agent_quote_rxu_config.capital_gbp`, £120 | idle in the account; no rule at all | the same checks; top-ups £65 a day (`topUps`); holdMin £1; loss stop 1 %; governor |
| **LIVE Coinbase "Stablecoin quotes USDC/GBP"** (`cb_live.ts`) | `rung_gbp` £20, a fixed number | `capital_gbp` £120 (the loss stop's base; `rung_gbp × 6 ≤ capital_gbp`) | idle in the account; no rule | available balances (bids GBP, asks USDC); the start top-up ≤ £70 a UTC day; loss stop 1 %; governor 1,500 / 1,800 POSTs; Coinbase's 1 USDC minimum and 0.01 step |
| **Revolut X twins** (`agent_quote_twin_specs`: USDT/GBP LIVE twin `live600`, USDC/GBP LIVE twin `rxu120`, variant-1 `live1200`, -2 `take50`, -3 `n600no03`, -4 `n600usdt`, -5 `n600nudge`, hidden `n600usdt2`) | the live executor's own code on its twin config's `capital_gbp` | the spec row's capital, written once at the start | idle in the simulated account | the executor's own limits, as LIVE's; the simulated account's balances |
| **Coinbase paper arms** (USDC/GBP LIVE twin `coinbasenudge`, "with Euros - 1" `coinbaseusdc`, "- 2" `coinbasehold`) | PR5's frozen `stepMinute` rung (its 100) ÷ a fixed divisor: $50 | FUNDED $300 / $600 / $1,200, constants | in the paper record; never sizes anything | the engine's 10 % of a minute's printed value |

Not in the request's list at first: the OKX paper twins ("Stablecoin quotes USDG/EUR", "EURC/USDC", "USDG/EUR - 1",
`okx_quotes.ts`, `okx_basis.ts`; $100 a rung, fixed), and the base Coinbase test (`cb_quotes.ts`, the weekend reading's control, off
the page). Neither reused its profit. **The OKX twins compound from 2026-10-31 00:00 UTC too** (Davies, 2026-10-30: "…你觉得需要做的话就做";
`okx_compound.ts`: each book on its own record, the engine's `rungUsd` $100 × capital ÷ $600, $6 a unit, $300 to $1,200, the loss stop
on the capital; the deviation recorded apart, `reviews/2026-10-30-okx-compounding-deviation.md`). **The base Coinbase test stays
uncompounded**: a pre-registered control stays as it was frozen, and the weekend reading divides "- 2"'s trips by its day's multiplier.

## 2. The rule, for every one

Once a UTC day the capital is:

- **the base** (what was put in) **plus everything realised from the start to the day's 00:00 UTC**:
  - every round trip's realised P&L, fees and the 24-hour stop's cost included;
  - on Revolut X, what a conversion that sold coin realised against the coins it sold, first in, first out (`conversionSales`, the
    page's own REALIZED since 2026-10-30);
- **in whole units**, a pound or a dollar a rung (£12 for LIVE's twelve-rung build, £4 for the £120 USDC/GBP executor's four
  rungs, £6 for Coinbase's six, $6 / $12 / $24 for the Coinbase paper arms);
- **between half and twice the base** (LIVE's `0146` floor £300 and cap £1,200);
- **moved only when the target is a unit or more away**, so a day's pennies never resize every rung.

**Why realised, not the account's value.** About half of each account is dollar coin. Valued at fair, a 2 % GBP/USD move would
resize the rungs by 1 % for a reason that is not the strategy's. Realised P&L moves only with round trips.

**Why counted to 00:00.** A twin and its live strategy on the same rule from the same instant set the same capital from the same
record, whichever runs first in the day's first minute (`quotes_compound.test.ts` pins LIVE and its twin equal).

**Losses shrink it the same way**, a unit at a time, to half the base at most.

**Never more than the account holds.** The executors already refuse to rest what the account cannot cover: a bid needs free pounds,
an ask free coin, and one that cannot be covered is skipped. Compounded capital is the base plus what the account has made, so it is
what the account holds at cost. After a deposit or a withdrawal the base must be set again (§6); until then a withdrawal shows as
skipped entries, never as an order the account cannot pay for.

## 3. What follows the capital

| limit | how it moves |
|---|---|
| rung size | the capital × the rung's share (Revolut X `rungGbpOf`; Coinbase LIVE `rung_gbp` = capital ÷ 6, to the penny; Coinbase arms the engine's divisor ÷ capital / funded) |
| daily loss stop | 1 % of the capital: it moves with it (unchanged code) |
| a conversion's cap | Revolut X: a quarter of the capital, or the asks' share under weights (unchanged code); Coinbase LIVE: the £70 a day in proportion (£73.50 at £126) |
| top-ups a day | LIVE's £5 a book and the USDC/GBP executor's £65 are fixed (frozen in `quotes_live.ts`). A £12 step of LIVE needs about £3 more coin; the £65 binds only above about £130 of capital, and then a top-up finishes the next day |
| governor | a count of POSTs, not money: unchanged. Bigger rungs send no more orders |
| holdMin £1, venue minimums | unchanged; larger rungs only clear them more easily |

**A held rung across a change.** On Revolut X a resting order keeps its size until it is re-priced, as on any capital change. On
Coinbase paper the engine rescales a held rung so it keeps its coins (as the arms' $50 switches did).

**How a twin keeps mirroring its live strategy.** The twin's row has the live executor's settings (`live600`: £12 unit and step,
£300 floor, £1,200 cap; `rxu120`: £4, £60, £240) and the same start, 2026-10-31 00:00 UTC. Each live executor's go statement (§6)
sets that same start, so whenever Davies turns it on, LIVE sets the capital its twin has, from the same record. Until he does, the
live executor stays at its fixed capital and its twin compounds: they differ by the twin's growth (a step or two in the first
month).

## 4. What it would have changed (the replay)

`backtests/compound/scripts/replay.py` (inputs `backtests/compound/inputs/days.json`, output `backtests/compound/results.json`):

- **The model.** Each recorded paper day's realised P&L, as a share of the capital it ran on, applied to the compounding capital of
  that day, with each target's unit, step, floor and cap.
- **The series.** PR5's paper engine on Revolut X, 37 days from 09-23 at $1,200; the Coinbase weekend arm, 17 days from 10-13.
- **The year** repeats the recorded days to 365: a projection at the recorded rate, not a forecast.

| target | recorded days: fixed → compounded | a year: fixed → compounded | capital after a year |
|---|---|---|---|
| LIVE USDT/GBP (£600, £12) | +2.27 % → +2.27 % (first step on day 37) | +22.08 % → **+24.44 %** (+2.36 points) | £744 |
| USDC/GBP Revolut X (£120, £4) | +2.27 % → +2.27 % (no step) | +22.08 % → **+24.28 %** (+2.20) | £148 |
| USDC/GBP Coinbase (£120, £6) | +2.27 % → +2.27 % (no step) | +22.08 % → **+24.10 %** (+2.02) | £144 |
| variant-1 (£1,200, £24) | +2.27 % → +2.27 % | +22.08 % → **+24.44 %** (+2.36) | £1,488 |
| any of them, on the Coinbase weekend arm's 17 days | +0.47 % → +0.46–0.47 % (its losing second day steps it down a unit first) | +10.11 % → **+10.37–10.53 %** (+0.26 to +0.42) | 1.10 × the base |

The capital is floored to whole units, so a day that leaves the equity a penny under the capital steps it down a whole unit, and a
step up waits for a whole unit of profit: the rule leans to the smaller size, as `0146` was built.

**Small, as expected.** Inside a month nothing changes: the profit is about 0.06 % of the capital a day, so the first £12 step on
£600 takes about a month. Over a year it is about a tenth more profit on the Revolut X rule (2.4 points on 22), about 4 % more on
Coinbase's. The `0146` review's model (LIVE's own rate since 10-02) said +2.5 points in year 1, the same.

## 5. What landing changes (`0183`; the deviation `reviews/2026-10-30-compounding-deviation.md`)

- **Every enabled Revolut X twin** compounds from 2026-10-31 00:00 UTC (`agent_quote_twin_compound`, `runTwinsCompound`, run by the
  twins' call before their turns, only once a twin's simulated account has turned into the day). No twin driver file changed.
- **The Coinbase paper arms** (`cb_compound.ts`, called from `cb_usdc.ts` and `cb_hold.ts`) compound from the same instant; runs
  stop at 23:59 from 10-30 so each day's capital is set first.
- **The three live executors** get the rule with `compound_mode` 'off': nothing live changes.
- **Every pre-registered reading** keeps its size: a money or %-a-year bar reads each trip ÷ its day's multiplier (each day's
  capital is kept: `agent_quote_twin_compound.days`, the arm's `state.compound.days`); ratios are unchanged. The deviation records it
  under each pre-registration's own heading.
- **The page.** A twin's FUNDED is its config's capital (it shows the compounded capital); a Coinbase arm's FUNDED stays what was put
  in, its held rungs at the divisor now. LIVE's DAYS already reads each day over its own capital (`0145`).

## 6. The go and its undo (one statement each, only on Davies' word)

`compound_from` is the twins' instant, so a live executor and its twin set the same capital from the same record. If the statement
runs after 10-31, the first day it runs counts everything realised since 10-31 at once.

```sql
-- LIVE "Stablecoin quotes USDT/GBP" (Revolut X):
update public.agent_quote_live_config
   set compound_mode = 'realised', compound_base_gbp = 600, compound_from = '2026-10-31T00:00:00Z', updated_at = now()
 where id = 1 and compound_mode = 'off' and capital_gbp = 600
returning capital_gbp, compound_mode, compound_from;

-- "Stablecoin quotes USDC/GBP" (Revolut X):
update public.agent_quote_rxu_config
   set compound_mode = 'realised', compound_base_gbp = 120, compound_from = '2026-10-31T00:00:00Z', updated_at = now()
 where id = 1 and compound_mode = 'off' and capital_gbp = 120
returning capital_gbp, compound_mode, compound_from;

-- "Stablecoin quotes USDC/GBP" (Coinbase):
update public.cb_live_config
   set compound_mode = 'realised', compound_base_gbp = 120, compound_from = '2026-10-31T00:00:00Z', updated_at = now()
 where id = 1 and compound_mode = 'off' and capital_gbp = 120 and rung_gbp = 20
returning capital_gbp, rung_gbp, compound_mode, compound_from;
```

Each must return one row. **Off** (the capital stays where it is): the same table, `set compound_mode = 'off' where id = 1`. **After
a deposit or a withdrawal of £D**: `set compound_base_gbp = compound_base_gbp + D` (− for a withdrawal). A twin:
`update public.agent_quote_twin_compound set mode = 'off' where twin_id = '<id>'`.

**What to read afterwards.** `compound_last` on each config, and `agent_quote_twin_compound.last` for the twins, say the equity, the
target and why, each day.

## 7. Risks

- **A drawdown shrinks the rungs**, a unit at a time, to half the base. That is the intended response.
- **The cap (twice the base) is LIVE's size read's cliff** (`0146`). Raising it waits for variant-1's reading.
- **One writer at a time.** With the rule on, a capital changed by hand is overwritten at the next 00:00 unless the base is set
  again: turn it off first.
- **A twin rebuilt from its start** (a backfill or a replay) runs at its spec's capital and compounds only from the day the call
  next runs it in real time.

## 8. Files and pins

| file | what |
|---|---|
| `supabase/functions/agents/quotes_compound.ts` | the rule (`compoundPlan`), the realised it counts (`realisedSince`, `conversionSales`), LIVE's and the USDC/GBP executor's runs, the twins' |
| `supabase/functions/agents/cb_compound.ts` | the Coinbase paper arms' rule, divisor and day |
| `supabase/functions/agents/cb_live.ts` | Coinbase LIVE's compounding (`cbLiveRealisedSince`, `cbLiveCompoundSizes`), at the start of its turn |
| `supabase/migrations/0183_quotes_compound_all.sql` | the columns (off), the twins' table and rows |
| `docs/agents/backtests/compound/` | the replay |

Pins: `quotes_compound.test.ts` (the plan, the realised with a conversion's sale, the USDC/GBP executor, a twin and LIVE equal, off
as the counterfactual), `cb_compound.test.ts` (each arm's rule, the day, the rescale, the run cut at 23:59, the LIVE twin across a
midnight against the counterfactual before the start), `cb_live.test.ts` (off £20; on £21 from the day's realised).
