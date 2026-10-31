# A deviation of every pre-registration that froze LIVE's executor: the drain for good, and LIVE's twin taking as LIVE (2026-10-31)

This is recorded apart from the pre-registrations it concerns, which stay byte for byte as they were frozen. Where one froze
`supabase/functions/agents/quotes_live.ts`, its pin test reads the hashes named before it and the hash named here, under its own
heading, for the file as it is. It follows the closure deviation of the same day (`reviews/2026-10-31-take-closure-deviation.md`).

## On whose word

Davies, 2026-10-31 ~03:55 UTC, verbatim, on the agents audit's N1 and N2: "同意".

- **N2.** LIVE's coin rebook (`rebookOn`) was a 72-hour window from 2026-10-29 22:30 UTC: from 2026-11-01 22:30 nothing could sell
  surplus coin back to pounds, and the top-ups fall back to £5 a book a day, so LIVE's bids could starve as Coinbase LIVE's 0.3 %
  bid did from 2026-10-29 20:34 (`reviews/2026-10-29-cb-live-design.md` §12).
- **N1.** LIVE's take has been live since 2026-10-31 02:10:43 UTC; its twin `live600` had no take rule, so from LIVE's first live
  take it would stop mirroring LIVE.

## What changed

**The drain, for good** (`drainOn`, `drainBase`, `QUOTE_LIVE_DRAIN_FROM` 2026-10-31 08:00 UTC, `quotes_live.ts` step 6b″). For an
instance with weights in force, outside a rebook: when a live bid was skipped this turn for want of pounds (what it needed, less
the pounds left free) and no ask of the book lacks coin, the book's coin beyond its asks' need is sold by the rebook's own sale
(`planDrains`: post-only at the top of the asks, never under fair, the 2 % buffer over the asks' need kept), cut to what the bids
lack at the sale's price (rounded up a step, one step more) and to QUOTE_LIVE_DRAIN_DAY_SHARE (25 %) of the capital a book a UTC
day. A resting drain is cancelled the turn an ask of its book lacks coin or no bid lacks pounds; one unfilled after 30 minutes is
cancelled as before. Inside a rebook the rebook's rule runs unchanged. Client ids are written before the call (`placeOrder`), the
governor and the guards apply as to any conversion. It is in force from 08:00 UTC on 10-31, inside LIVE's rebook, so it takes over
the moment the rebook ends (11-01 22:30) with no gap.

**Whom it covers.** Every instance with weights in force: LIVE, the USDC/GBP executor (`QUOTE_RXU_INSTANCE`, which never had a
rebook: its weights predate the rebook's instant, so it could top its USDC up but never sell it back, the same one-way limit), and
every twin on their rules (`live600`, `live1200`, `take50`, `n600no03`, `n600usdt`, `n600nudge`, the hidden `n600usdt2`, `rxu120`),
since a twin runs the executor's own code and must keep mirroring its live strategy. No twin rule changed for it; no driver file
changed (`quotes_twin.ts`, `revx_sim.ts` as they were).

**Before the instant nothing differs**, and every pinned six-hour replay of the frozen executor (`quotes_live_instance.test.ts`,
September's hours) is unchanged. As the closure deviation left it,
the executor was `e70a8dd4733df4911bbac39c1767d0827f92e743599c27ac6adf336934277dd9` before this change; it is now the hash named
under each heading below.

**LIVE's twin takes as LIVE** (`0190`, N1). `live600`'s row gets variant-2's take rule (`rules.take`, the twin driver's option
since `0089`) from 2026-10-31 02:10:43 UTC, the minute LIVE's `take_mode` went 'live'. The shared take path then applies to the
twin exactly what governs LIVE's take: TAKE-DEPTH from 04:00 UTC (`takeDeep`), no take inside an FX closure (`takeClosed`), the
limit at k + the 0.09 % fee from fair. Nothing is replayed: from 02:10:43 to Sunday 2026-11-01 21:00 UTC is the weekend closure,
where neither LIVE nor its twin may take, so the twin's minutes since then are what they would have been with the rule. No code
changed for it.

**A reading in money** reads a twin's round trips as before; a drain is a conversion, not a rung's trip.

## Each pre-registration it touches

### `docs/agents/reviews/2026-10-03-take-prereg.md`

`take50` (variant-2): the drain as above. The executor as it is:

| file | sha256 (the drain, 2026-10-31) |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | 99e6d8ef2d992434265b36219d4931f423a544129c87862d76af4348cc3cd1b2 |

### `docs/agents/reviews/2026-10-29-usdt-only-twins-prereg.md`

`n600usdt` (variant-4) and `n600nudge` (variant-5), both arms together, so the paired reading stays like for like. The executor as it is:

| file | sha256 (the drain, 2026-10-31) |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | 99e6d8ef2d992434265b36219d4931f423a544129c87862d76af4348cc3cd1b2 |

### `docs/agents/reviews/2026-10-29-revx-usdc-nudge-twin-prereg.md`

Its rows are off since `0181`; the executor as it is:

| file | sha256 (the drain, 2026-10-31) |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | 99e6d8ef2d992434265b36219d4931f423a544129c87862d76af4348cc3cd1b2 |

### `docs/agents/reviews/2026-10-29-revx-exit-tick-twin-prereg.md`

Its rows are off since `0181`; the executor as it is:

| file | sha256 (the drain, 2026-10-31) |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | 99e6d8ef2d992434265b36219d4931f423a544129c87862d76af4348cc3cd1b2 |

### `docs/agents/reviews/2026-10-29-rx-usdc-live-prereg.md`

`rxu120` and the USDC/GBP executor it mirrors, from the same instant. The executor as it is:

| file | sha256 (the drain, 2026-10-31) |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | 99e6d8ef2d992434265b36219d4931f423a544129c87862d76af4348cc3cd1b2 |

### `docs/agents/reviews/2026-10-26-live-size-twins-prereg.md`

`live600`, LIVE's twin: the drain from the same instant as LIVE, and LIVE's take from 2026-10-31 02:10:43 UTC (`0190`), so it
keeps carrying out what LIVE carries out. Its first possible take is Sunday 2026-11-01 21:00 UTC, LIVE's too.

### `docs/agents/reviews/2026-10-27-live-next-size-prereg.md`

`live1200` and its yardstick `live600`, together.

### `docs/agents/reviews/2026-10-27-pr5-opt-twins-now-prereg.md`

`n600no03`, `n600usdt` and the hidden `n600usdt2`, together.
