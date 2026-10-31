# A change to LIVE's take, recorded against every pre-registration that froze the executor: no take inside an FX closure, at once (2026-10-31)

This is recorded apart from the pre-registrations it concerns, which stay byte for byte as they were frozen. Where one froze
`supabase/functions/agents/quotes_live.ts`, its pin test reads the hashes named before it and the hash named here, under its own
heading, for the file as it is. It follows TAKE-DEPTH (`reviews/2026-10-31-take-depth-deviation.md`) on the same day.

## Why

The guard was found before Davies decides whether LIVE's take goes live (`take_mode` is 'shadow' and stays so).

**What happened before the guard.**
- Inside an FX closure, with `weekend_mode` 'live', LIVE's paper minute comes from its weekend replica, priced on a held GBP/USD.
- The take (`takeTurn`) and its shadow (`shadowTake`) ran whatever the minute's source was.
- So on a Saturday with the book through a rung's take limit, 'live' would have sent an IOC against the held X, and 'shadow' would
  have recorded one.

**Why that is not allowed.** Every piece of evidence for the take comes from weekdays:
- variant-2's 14 filled takes (USDT-GBP, Monday to Friday);
- LIVE's 2 shadow opportunities (Wednesday 10-28 and Thursday 10-29);
- the take pre-registration's study.

Variant-2 has no weekend rule. The one twin that had both a take and the weekend rule (`take50wk`, `reviews/2026-10-18-revx-weekend-prereg.md`)
has been off since `0141`, and its reading was withdrawn.

## What changed

**The rule.** When the paper minute is inside an FX closure (`inQuoteClosure(T)`), there is no take and no `take_shadow`. The
rung's weekend entry goes on as before (`takeClosed` in `runQuotesLive`, the shared take path). It is in force at once, with no
instant. No running pre-registration depends on a weekend take:
- Variant-2 never sees a closure minute with a fair, since without a weekend rule a closure minute is dark. Its turns are unchanged.
- No enabled twin has both `take` and `weekend` (`agent_quote_twin_specs`, read 2026-10-31).
- The USDC/GBP executor's `take_mode` was off; it is 'shadow' since 2026-10-31 02:00:12 UTC (Davies: "RX USDC/GBP开 shadow"),
  which records nothing inside a closure from this change on.

**The pin.** In `quotes_live_switches.test.ts`, "no take inside an FX closure": on a Saturday with `weekend_mode` 'live' and a read
500 deep through the 0.1 % bid's limit:
- 'live' sends no IOC, and 'shadow' records nothing.
- Both send exactly what take 'off' sends.
- On a weekday the same book takes, as `takeCase` shows.
- With the guard reverted, the closure minute sends one IOC and records one `take_shadow`, and the pin fails.

## Each pre-registration it touches

### `docs/agents/reviews/2026-10-03-take-prereg.md`

`take50` (variant-2) has no weekend rule, so no closure minute gives it a fair and no turn of its changes. It froze `quotes_live.ts`;
the file as it is:

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | e70a8dd4733df4911bbac39c1767d0827f92e743599c27ac6adf336934277dd9 |

### `docs/agents/reviews/2026-10-29-usdt-only-twins-prereg.md`

Its twins take no take, so their turns are unchanged. It froze the executor; the file as it is:

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | e70a8dd4733df4911bbac39c1767d0827f92e743599c27ac6adf336934277dd9 |

### `docs/agents/reviews/2026-10-29-revx-usdc-nudge-twin-prereg.md`

Its twins are off since `0178`, and neither takes. It froze the executor; the file as it is:

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | e70a8dd4733df4911bbac39c1767d0827f92e743599c27ac6adf336934277dd9 |

### `docs/agents/reviews/2026-10-29-revx-exit-tick-twin-prereg.md`

It was closed early and its twins are off. It froze the executor; the file as it is:

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | e70a8dd4733df4911bbac39c1767d0827f92e743599c27ac6adf336934277dd9 |

### `docs/agents/reviews/2026-10-29-rx-usdc-live-prereg.md`

`rxu120` takes no take; its executor's `take_mode` is 'shadow' since 2026-10-31 02:00:12 UTC, which sends nothing. It froze the executor; the file as it is:

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | e70a8dd4733df4911bbac39c1767d0827f92e743599c27ac6adf336934277dd9 |

For the record: the executor was `2ec5455b525f8f5d5d9996e994e9b512154cc0abfe4890df14dd33e786b06270` before this change.
