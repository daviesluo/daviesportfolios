# A deviation of every pre-registration that froze LIVE's executor: the sub-accounts' governor (2026-10-31)

This is recorded apart from the pre-registrations it concerns, which stay byte for byte as they were frozen. Where one froze
`supabase/functions/agents/quotes_live.ts`, its pin test reads the hashes named before it and the hash named here, under its own
heading, for the file as it is. It follows the drain's deviation of the same day (`reviews/2026-10-31-live-twin-take-drain-deviation.md`).

## On whose word

Davies, 2026-10-31 ~10:00 UTC, verbatim: "那先把这两个live策略的的单日下单数量限制取消掉吧" ("then first remove the daily order limit
of these two live strategies"), after reading that Revolut X's developer docs say the 1,000 orders a day "does not apply to
sub-accounts" (the rate limits remain: place 10 a second, others 100 a second and 1,000 a minute, at most 300 active orders an
account). ~10:05 UTC, verbatim: "这两个都是sub accounts" ("both are sub-accounts"): LIVE's key (`_2`) and the USDC/GBP executor's
(`REVX_KEY_NAMES.revx`, the retired trend loop's).

## What changed

**The governor is an instance's** (`QuoteLiveInstance.governor`, `governorOf`; `governorLevel(posts, governor)`). An instance that
names none has QUOTE_LIVE_GOVERNOR, 900 / 950 as before: every twin, whose instance is built from its row (`specFromRow`) and can
name no such rule.

**LIVE and the USDC/GBP executor have QUOTE_LIVE_SUBACCOUNT_GOVERNOR**: entries withdrawn from 5,000 POSTs a UTC day, nothing
but the 24-hour stops from 5,500. Not a quota but a guard against a fault that sends in a loop. LIVE's POSTs by UTC day, read
from its order rows on 2026-10-31 (rows sent, a 429's resend counted twice): 950 on 10-07 (the old governor's stops-only level,
reached in that day's database stall), 693 on 10-15, 656 on 10-29 (the rebook's); the USDC/GBP executor's most, 150 on 10-30.
5,000 is over five times any day's and binds no working turn.

**And at most 600 POSTs in any minute** (`QuoteLiveInstance.minutePosts`, QUOTE_LIVE_MINUTE_POSTS, `minuteRoom`): an order past
it is not written and not sent this turn, and one is kept in hand for a 429's resend; the venue takes 1,000 a minute. A
second was already bounded: QUOTE_LIVE_POST_GAP_MS (125 ms) between the executor's POSTs, 8 a second, under the venue's 10.
Twins have no minute's limit.

**No twin changes.** Their instances keep 900 / 950 and no minute's limit, so every twin turns exactly as before. The six-hour
replays against the frozen executor run today's executor with that governor (`quotes_live_instance.test.ts`, `asTwins`).

As the drain's deviation left it, the executor was `99e6d8ef2d992434265b36219d4931f423a544129c87862d76af4348cc3cd1b2` before this change; it
is now the hash named under each heading below.

## Each pre-registration it touches

### `docs/agents/reviews/2026-10-03-take-prereg.md`

`take50` keeps 900 / 950: no change to what it does. The executor as it is:

| file | sha256 (the sub-accounts' governor, 2026-10-31) |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | f0fa845077e4dc629def12bc2276e70c31ae154f537c3a9d4b815bf5cb4aeebf |

### `docs/agents/reviews/2026-10-29-usdt-only-twins-prereg.md`

`n600usdt` and `n600nudge` keep 900 / 950. The executor as it is:

| file | sha256 (the sub-accounts' governor, 2026-10-31) |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | f0fa845077e4dc629def12bc2276e70c31ae154f537c3a9d4b815bf5cb4aeebf |

### `docs/agents/reviews/2026-10-29-revx-usdc-nudge-twin-prereg.md`

Its rows are off since `0181`; the executor as it is:

| file | sha256 (the sub-accounts' governor, 2026-10-31) |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | f0fa845077e4dc629def12bc2276e70c31ae154f537c3a9d4b815bf5cb4aeebf |

### `docs/agents/reviews/2026-10-29-revx-exit-tick-twin-prereg.md`

Its rows are off since `0181`; the executor as it is:

| file | sha256 (the sub-accounts' governor, 2026-10-31) |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | f0fa845077e4dc629def12bc2276e70c31ae154f537c3a9d4b815bf5cb4aeebf |

### `docs/agents/reviews/2026-10-29-rx-usdc-live-prereg.md`

The USDC/GBP executor it reads has the sub-accounts' governor; its twin `rxu120` keeps 900 / 950. Neither has come near 900 a
day. The executor as it is:

| file | sha256 (the sub-accounts' governor, 2026-10-31) |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | f0fa845077e4dc629def12bc2276e70c31ae154f537c3a9d4b815bf5cb4aeebf |
