# A deviation of the Revolut X twins' compounding: a pound a rung each quotes, from 2026-11-01 00:00 UTC (migration `0189`)

Recorded apart from the pre-registrations it concerns, which are left as they were frozen, byte for byte, as the compounding itself
was (`reviews/2026-10-30-compounding-deviation.md`). No file a pre-registration froze changes.

## On whose word, and why

Davies, 2026-10-31 ~03:05 UTC, verbatim, on the agents audit's proposals: "a和b都改； c也改" (c: LIVE's compounding unit £12 → £6),
and before it: "live复利不仅是usdt吧，另外两个呢？" (LIVE's compounding is not only USDT, is it? what about the other two?).

The audit found LIVE moving its capital in whole £12, a pound a rung of the twelve it was built with, while it has quoted
USDT-GBP's six rungs alone since 2026-10-29 22:30 UTC: £2 a rung, where the rule (`reviews/2026-10-30-compounding.md`) says a pound
or a dollar a rung. The USDC/GBP executor (£4, four rungs) and Coinbase's (£6, six) were already a pound a rung. The twins on
LIVE's rules had copied LIVE's £12, or twice it.

## What changed

- **The rule's unit and step**, from 2026-11-01 00:00 UTC (`COMPOUND_UNIT_RUNGS_FROM`, `quotes_compound.ts`): £1 times the rungs
  the strategy quotes at the day's 00:00, counted from its own rungs and weights (`compoundUnitOf`: a book, side and distance
  whose weight is not 0 and that is not retired), the step equal to it. LIVE and the USDC/GBP executor from their instances,
  each twin from its own (`runTwinsCompound` is now passed each twin's instance by `twinsCompoundStep`, `index.ts`), Coinbase's
  executor from its paper arm's book (`cbLiveRungCount`, `cb_live.ts`). Derived, not stored, so a later change of rungs cannot
  leave a unit stale; `0189` sets the stored columns to the same values. Before the instant, the stored units decide, as they did.
- **Nothing else**: base, floor, cap, start, the realised it counts, the hysteresis rule, the capitals as they stand.

`quotes_compound.ts` as it is: sha256 `c6760356ddbf1c5266afec259388e7a10b189b5265c133509bd0824f1c92b6f1`.

## How every reading keeps its size

As the compounding deviation's rule: a reading in money reads each trip ÷ its day's multiplier (`agent_quote_twin_compound.days`),
so the unit only changes how soon the capital moves, never what a trip is read at. A paired reading reads both arms that way.

## Each pre-registration it touches

### `docs/agents/reviews/2026-10-26-live-size-twins-prereg.md`

`live600` (the USDT/GBP LIVE twin): unit and step £12 → £6, LIVE's own from the same instant, so they keep setting the same capital
from the same record.

### `docs/agents/reviews/2026-10-27-live-next-size-prereg.md`

`live1200` (variant-1): unit and step £24 → £6 (USDT-GBP's six rungs), and its yardstick `live600` £6.

### `docs/agents/reviews/2026-10-03-take-prereg.md`

`take50` (variant-2): unit and step £12 → £6 (USDT-GBP's six rungs).

### `docs/agents/reviews/2026-10-27-pr5-opt-twins-now-prereg.md`

`n600no03` (variant-3): unit and step £12 → £4 (USDT-GBP without its 0.3 % rung: four). `n600usdt` (variant-4) and the hidden
`n600usdt2` quote both books' twelve rungs: £12, unchanged.

### `docs/agents/reviews/2026-10-29-usdt-only-twins-prereg.md`

`n600nudge` (variant-5) and its control `n600usdt`: twelve rungs each, £12, unchanged; still like for like.

### `docs/agents/reviews/2026-10-29-rx-usdc-live-prereg.md`

`rxu120`: four rungs, £4, unchanged.
