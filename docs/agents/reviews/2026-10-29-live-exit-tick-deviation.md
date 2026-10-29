# A deviation of LIVE and of every running twin pre-registration: the exit a tick beyond fair for all from 2026-10-30 00:00 UTC, variant-6 adopted (migration `0181`)

Recorded apart from the pre-registrations it concerns, which are left as they were frozen, byte for byte. Where one froze
`supabase/functions/agents/quotes_live.ts`, its pin test reads the hashes named before and the hash named here, under its own
heading, for the file as it is.

## On whose word, and why

Davies, 2026-10-29 ~23:00 UTC, asked "要把这条加进 LIVE（Stablecoin quotes USDT/GBP）吗？": "加进 LIVE". The study,
`reviews/2026-10-29-usdt-no03.md` (RX-USDC's harness on LIVE as it now runs, USDT-GBP alone at £600): every exit a tick beyond
fair, alone, +1.49 % a year since 09-01 [80 % +0.34, +2.69], P(≤ 0) 0.048, 39 days ahead and 14 behind; out of sample +4.63
(P 0.000); the last 30 days +2.72 (P 0.002); at £1,200 +1.66 (P 0.065), +3.74 (P 0.000), +3.21 (P 0.009). Positive in every
window at both sizes. Variant-6's own record was 3 h 49 min long when the call was made (+£0.05 against its control): not
evidence either way, and not what the decision rests on.

## What changed

- **The rule** is variant-6's, not a new one: `exitOffset {ticks: 1}` (p50x1's, 0108; `TWIN_RULES.exitOffset`,
  `QuoteLiveInstance.exitOffset`): every exit, placed or re-priced, rests a tick beyond the rule's price in the position's favour
  (a long sells a tick over, a short buys back a tick under); the 24-hour stop is not moved. The offset price is the price
  `exitTicksOnBook` meets the book with (in force on every instance since 2026-10-29 00:00), so an exit the offset would put
  across the book still rests one tick inside the opposite best, never worse than the rule's price with the offset
  (`quotes_live.test.ts`, "exitOffset with the exits meeting the book (variant-8)", pins both cases).
- **LIVE** (`supabase/functions/agents/quotes_live.ts`): `QUOTE_LIVE_INSTANCE.exitOffset = { ticks: 1, from:
  QUOTE_LIVE_EXIT_OFFSET_FROM }`, `QUOTE_LIVE_EXIT_OFFSET_FROM` = 2026-10-30 00:00 UTC. Before the instant its exits are at the
  rule's price, as before; nothing else in the executor changed (two comments that said the live account has no offset now say
  it has). `quotes_live_frozen.ts` is untouched (sha256 `60d3f33f2bb8d328fe14693d570396afdffcc2cae9b75e05e2d4eed5ea459a52`),
  and `quotes_live_instance.test.ts` still runs the live instance beside it, turn for turn, on its fixtures (all before the
  instant). The live design's addendum of 2026-10-29 (23:00) records it (`reviews/2026-09-24-pr5-live-design.md`).
- **Every running twin on LIVE's rules** (`0181`): the rule `exitOffset {ticks: 1, from: 2026-10-30T00:00:00Z}` added, guarded on
  its absence, to `live600` (USDT/GBP LIVE twin), `live1200` (variant-1), `take50` (variant-2), `n600no03` (variant-3),
  `n600usdt2` (hidden), `n600usdt` (variant-4) and `n600nudge` (variant-5). No driver code changed (`quotes_twin.ts` is the bytes
  every record below names). The instant is LIVE's, so the twins keep mirroring LIVE. `rxu120` has had the rule from its start.
- **Variant-6** (`live600x1`) and its control (`live600ctl`) off; variant-6 hidden, named "Stablecoin quotes exit +1 tick from
  10-29". It was the last variant: no page name moves.

## Each pre-registration it touches

Every paired reading below has **both arms take the offset at the same minute**, so it stays like for like from 00:00; the days
before are as they were. Each reading reports the switch, and the days on each side of it apart where it can.

### `docs/agents/reviews/2026-10-26-live-size-twins-prereg.md`

`live600` (the LIVE twin) takes the offset from 00:00, as LIVE does. Its comparison is LIVE's own record: both change at the
same instant. No file it froze changed.

### `docs/agents/reviews/2026-10-27-live-next-size-prereg.md`

`live1200` (variant-1) and its yardstick `live600` both take the offset from 00:00. No file it froze changed.

### `docs/agents/reviews/2026-10-03-take-prereg.md`

`take50` (variant-2) takes the offset from 00:00. It froze `quotes_live.ts` at `425def7ed57f1b4e6157cadf7167e7d1711a06ec05fa552df25c35d2adf12e6b`
(changed by earlier sessions since, each recorded in its own deviations); the file as it is now:

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | b6bdbd8cc1947b0949923322988290b6928f679798f7042c100b1776ffbcc3a1 |

### `docs/agents/reviews/2026-10-27-pr5-opt-twins-now-prereg.md`

Variant-3 (`n600no03`) and the hidden USDT 2:1 twin (`n600usdt2`) take the offset from 00:00, as does their yardstick
`live600`, so each reading is still one change against LIVE's rules. No file it froze changed.

### `docs/agents/reviews/2026-10-29-usdt-only-twins-prereg.md`

Variant-5 (`n600nudge`) and its control variant-4 (`n600usdt`) take the offset at the same minute; the comparison stays the
nudge's alone. The window starts 2026-10-30 00:00, the offset's own instant. It froze the executor; the file as it is:

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | b6bdbd8cc1947b0949923322988290b6928f679798f7042c100b1776ffbcc3a1 |

### `docs/agents/reviews/2026-10-29-revx-usdc-nudge-twin-prereg.md`

Its twins (`u300nudge`, `u300ctl`) are off since `0178`. It froze the executor; the file as it is:

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | b6bdbd8cc1947b0949923322988290b6928f679798f7042c100b1776ffbcc3a1 |

### `docs/agents/reviews/2026-10-29-revx-exit-tick-twin-prereg.md`

**Closed early: adopted on Davies' word, 10-29.** Its question (does the exit a tick beyond fair beat LIVE's rules?) is answered
by the decision to run it on LIVE, from the study above, not by its own window (2026-10-29 19:00 → 2026-11-26 19:00), of which
it had run about four hours. With the rule on LIVE and on the LIVE twin, variant-6 is the LIVE twin and its control is LIVE's
rules of yesterday, so both stop (`0181`). Its 11-26 reading is not run; its record to the stop stays and may be reported for
what it is. It froze the executor; the file as it is:

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | b6bdbd8cc1947b0949923322988290b6928f679798f7042c100b1776ffbcc3a1 |

### `docs/agents/reviews/2026-10-29-rx-usdc-live-prereg.md`

`rxu120` already runs the offset from its start (2026-10-30 00:00) and is unchanged. It froze the executor; the file as it is:

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | b6bdbd8cc1947b0949923322988290b6928f679798f7042c100b1776ffbcc3a1 |

For the record: the executor was `d683bb5a4f1accf144c630a7d69bd565953a23879be847eade2ce2868d8bc86c` before this change.
