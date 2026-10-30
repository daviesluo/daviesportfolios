# A deviation of every running Stablecoin quotes test: what it realises is put back to work from 2026-10-31 00:00 UTC (migration `0183`)

Recorded apart from the pre-registrations it concerns, which are left as they were frozen, byte for byte. Where one froze a file
this changes (`cb_usdc.ts`, `cb_hold.ts`), its pin test reads the hashes it named before and the hash named here, under its own
heading, for the file as it is. The design, the audit and the replay are `reviews/2026-10-30-compounding.md`.

## On whose word, and why

Davies, 2026-10-30 ~01:35 UTC, verbatim:

> 另外再确认一下目前所有的live和testing的Stablecoin quotes都能有效做到盈利金额再利用吗？如果不能请研究实现

(also confirm whether every LIVE and TESTING Stablecoin quotes can effectively reuse the profit it makes; if not, research and
build it). The audit (design §1): none of them did. Every executor and twin sizes its rungs from a fixed capital, every Coinbase arm
from a fixed divisor of PR5's frozen rung; LIVE's own rule (`0146`) was built and never turned on. On the recorded paper history the
rule adds about 2.4 points a year on ~22 % (Revolut X) and 0.4 on ~10 % (Coinbase), and nothing inside a month (design §4).

## What changed

- **The rule** is LIVE's `0146` rule (`compoundPlan`, `quotes_compound.ts`), the same for every test: once a UTC day the capital is
  what was put in plus every round trip realised since **2026-10-31 00:00 UTC**, fees and the 24-hour stop's cost included (and,
  on Revolut X, what a conversion that sold coin realised against the coins it sold, first in, first out), up to the day's 00:00;
  in whole units (a pound or a dollar a rung of the strategy's own: £12 on £600, $6 on $300), between half and twice what was put
  in, moved only a unit or more away. FX marks of the held coin never move it.
- **The Revolut X twins** (`0183`, `agent_quote_twin_compound`, `runTwinsCompound` in `quotes_compound.ts`): each enabled twin's
  config capital, which its executor already sizes every rung, top-up and loss stop from, is set before its first turn of the day
  (once its simulated account has turned into the day). **No driver file changed**: `quotes_twin.ts`, `quotes_live.ts`,
  `revx_sim.ts`, `quotes_weekend.ts` and `quotes.ts` are the bytes every record below names. Each day's capital is kept in the
  row's `days`.
- **The Coinbase arms** (`cb_compound.ts`; `cb_usdc.ts`, `cb_hold.ts`): the engine's divisor ÷ capital over funded, set at a run's
  first minute when a new UTC day has begun; a run never decides past 23:59; a rung held across a change keeps its coins (its size
  and notional in the engine's units × the old multiplier over the new, as Deviation 2 and Deviation 7 did for their switches).
  `stepMinute` (quotes.ts, sha256 `0782ed8140a2e490f19b9e92fe7093c2cb9a6f205866180314f609537277f517`) is untouched. Each day's
  capital is kept in the arm's state (`compound.days`). The base test (`cb_quotes.ts`, the weekend reading's control) does not
  compound and is unchanged.
- **Before the instant nothing differs.** Every decision, size and row up to 2026-10-30 23:59 UTC is as it was (the arms' runs
  are cut at 23:59 from 10-30 on, which splits a catch-up and changes no decision; `cb_compound.test.ts` pins the counterfactual).
- **LIVE and the two live executors** compound only when Davies turns each on (`0183`'s header has the three statements). Their
  `compound_from` is this instant, so a live executor and its twin, whenever it is turned on, set the same capital from the same
  record (`quotes_compound.test.ts` pins LIVE and its twin equal).

## How every reading keeps its size

**The assumption** is the one every size change of these tests made: fills and fees scale linearly with size (a rung stays far
under the 10 % of a minute's printed value that caps a paper fill: £100–£200 against books printing thousands a minute).

- **A reading that is a ratio** (bps a round trip, a share of quoted minutes, a live-to-twin share, a P(≤ 0) of a paired
  difference read per pound) is unchanged.
- **A reading in money or in % a year on a fixed capital** reads each trip entered on a day ÷ that day's multiplier (the day's
  capital over what was put in: the twin's `agent_quote_twin_compound.days`, the arm's `state.compound.days`), so every trip is at
  the size the pre-registration fixed. A paired comparison reads both arms that way, so it stays like for like.
- **The report says so**, and gives the days from 2026-10-31 apart where it can.

## Each pre-registration it touches

### `docs/agents/reviews/2026-10-26-live-size-twins-prereg.md`

`live600` (the USDT/GBP LIVE twin) compounds from the instant: unit and step £12, floor £300, cap £1,200, LIVE's own `0146`
settings, so that LIVE, once Davies turns its rule on, sets the same capital. No file it froze changed.

### `docs/agents/reviews/2026-10-27-live-next-size-prereg.md`

`live1200` (variant-1) compounds from the instant (unit £24, floor £600, cap £2,400), and so does its yardstick `live600`; its
per-pound reading reads both at their funded sizes (the rule above). No file it froze changed.

### `docs/agents/reviews/2026-10-03-take-prereg.md`

`take50` (variant-2) compounds from the instant (unit £12, floor £300, cap £1,200). No file it froze changed since the exit-tick
deviation named it (`quotes_live.ts` b6bdbd8cc1947b0949923322988290b6928f679798f7042c100b1776ffbcc3a1).

### `docs/agents/reviews/2026-10-27-pr5-opt-twins-now-prereg.md`

`n600no03` (variant-3), `n600usdt` (variant-4) and the hidden `n600usdt2` compound from the instant (unit £12, floor £300, cap
£1,200), each by its own record. No file it froze changed.

### `docs/agents/reviews/2026-10-29-usdt-only-twins-prereg.md`

`n600nudge` (variant-5) and its control `n600usdt` compound from the same instant on the same settings, so the paired reading stays
like for like. No file it froze changed.

### `docs/agents/reviews/2026-10-29-rx-usdc-live-prereg.md`

`rxu120` (the USDC/GBP LIVE twin) compounds from the instant: unit and step £4 (a pound a rung of its four), floor £60, cap £240, the
settings `0183` gives the USDC/GBP executor's own rule. Its bar (the executor's share of the twin) is a ratio and stays as written;
read with the executor's rule off, the twin's rungs are larger by the day's multiplier, and the report says so. No file it froze
changed.

### `docs/agents/reviews/2026-10-13-coinbase-weekend-prereg.md`

"with Euros - 2" (`coinbasehold`) compounds from the instant: $1,200 funded, a dollar a rung (unit $24), floor $600, cap $2,400. Every
bar is read at Deviation 7's frozen size and then at Deviation 3's, as that deviation says, with each trip entered from the instant
÷ its day's multiplier first. The base test, bar 6's control, does not compound. The file as it is:

| file | sha256 (compounding, 2026-10-30) |
|---|---|
| `supabase/functions/agents/cb_hold.ts` | 5e4258a936fce4c51db6e18641fdd5d7d3bbf4cc1124581e938f25632666d850 |

The bytes before it, Deviation 7's: `a8ac3ecb3b3511f14dc7f5cfa7ae2b7bc636634a897951b1ca839c645a30a91c`.

### `docs/agents/reviews/2026-10-26-cb-usdc-prereg.md`

"with Euros - 1" (`coinbaseusdc`) compounds from the instant: $600 funded, unit $12, floor $300, cap $1,200. Bar 2 (realised ÷ $600 ×
365 / 14) reads each trip entered from the instant ÷ its day's multiplier. The files as they are:

| file | sha256 (compounding, 2026-10-30) |
|---|---|
| `supabase/functions/agents/cb_usdc.ts` | 3b4e14b5a54a1b4c0ae5b9ba8a8a8d89caad19ed452de88ee24bc6e25345386c |
| `supabase/functions/agents/cb_hold.ts` | 5e4258a936fce4c51db6e18641fdd5d7d3bbf4cc1124581e938f25632666d850 |

The bytes before it: `cb_usdc.ts` `c44e9261cdbaf0e745ac24a83e823a02f87f0be94c3ed98e21da0e320e582f9b`, `cb_hold.ts`
`a8ac3ecb3b3511f14dc7f5cfa7ae2b7bc636634a897951b1ca839c645a30a91c`.

### `docs/agents/reviews/2026-10-29-cb-usdc-nudge-prereg.md`

The USDC/GBP LIVE twin (`coinbasenudge`, the arm Coinbase LIVE follows) compounds from the instant: $300 funded, unit $6, floor $150,
cap $600; `cb_nudge.ts` is unchanged (its driver is `cb_usdc.ts`'). The Coinbase executor's own rule, once Davies turns it on, uses
its own £120 and £6 unit from the same instant (`0183`). The file as it is:

| file | sha256 (compounding, 2026-10-30) |
|---|---|
| `supabase/functions/agents/cb_usdc.ts` | 3b4e14b5a54a1b4c0ae5b9ba8a8a8d89caad19ed452de88ee24bc6e25345386c |

The bytes before it: `c44e9261cdbaf0e745ac24a83e823a02f87f0be94c3ed98e21da0e320e582f9b`.
