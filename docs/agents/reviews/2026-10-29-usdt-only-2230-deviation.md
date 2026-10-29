# A deviation: the USDT-only switch at 2026-10-29 22:30 UTC, not 2026-10-30 00:00 (migration `0179`)

Recorded apart from the records it amends (`reviews/2026-10-29-usdt-only-deviation.md`, `reviews/2026-10-29-usdt-only-twins-prereg.md`),
which are left as they were committed. Where a pre-registration froze `quotes_live.ts`, its pin test reads the hashes named
before and the hash named here, under its own heading, for the file as it is.

## On whose word

Davies, 2026-10-29 21:59 UTC: "现在就生效吧 或者22:00生效" (make it take effect now, or at 22:00). 22:00 could not be reached with
CI, the migration and the Edge deploy; 22:30 UTC is the first half hour that could.

## What changed

- **LIVE** (`supabase/functions/agents/quotes_live.ts`): `QUOTE_LIVE_USDT_ONLY_FROM` and `QUOTE_LIVE_REBOOK_SINCE` are
  2026-10-29 22:30 UTC. LIVE quotes USDT-GBP alone from then; the coin rebook runs to 2026-11-01 22:30. Nothing else changed.
- **The twins** (`0179`): every instant `0178` set to 2026-10-30 00:00 moves to 22:30, guarded on the old value: the
  `weights.from` of `live600`, `live1200`, `take50`, `live600x1`, `live600ctl`, `n600no03` and `n600usdt`, and `n600nudge`'s
  start and its five rules' `from`. A twin reads its rules at each turn and turns forward from its last turn, so if `0179`
  applies after 22:30 a rule takes effect from the twin's next turn and no turn is redone; `n600nudge`, not yet turned, catches
  up from 22:30 on PR5's own record. `n600no03`'s 0.3 % rungs quote from `0178`'s apply to 22:30 at most, not to 00:00.
- **The window arithmetic** of `reviews/2026-10-29-usdt-only-deviation.md` moves by 1.5 hours: the LIVE twin's window has about
  1.9 days before the switch and 12.1 after; TAKE's has its last 3.06 days after it; the exit-tick twins 3.5 hours on both books.

## Each pre-registration it touches

### `docs/agents/reviews/2026-10-29-usdt-only-twins-prereg.md`

Variant-5 (`n600nudge`) starts at 2026-10-29 22:30. **Its window is the 28 days 2026-10-29 22:30 → 2026-11-26 22:30 UTC, each day
22:30 → 22:30** (whole days from its start, as PR5-OPT's five run 22:00 → 22:00); the reading on or after 2026-11-27 22:30, by a
script committed before 2026-11-26 22:30; the days from 2026-11-01 22:30, after the rebook, reported apart; the control's rebook
done by then. The statistic, seed, bar, expectation and everything else are as frozen. It froze the executor; the file as it is:

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | aa770ef6fc40301e4d7bbfbf4f9f2e66f6e7a8b010f4c4a8b5646cc1075d80cc |

### `docs/agents/reviews/2026-10-29-revx-usdc-nudge-twin-prereg.md`

Its twins are off since `0178`. It froze the executor; the file as it is:

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | aa770ef6fc40301e4d7bbfbf4f9f2e66f6e7a8b010f4c4a8b5646cc1075d80cc |

### `docs/agents/reviews/2026-10-29-revx-exit-tick-twin-prereg.md`

Both arms switch at 22:30 together. It froze the executor; the file as it is:

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | aa770ef6fc40301e4d7bbfbf4f9f2e66f6e7a8b010f4c4a8b5646cc1075d80cc |

The other pre-registrations of `reviews/2026-10-29-usdt-only-deviation.md` change only by the instant, both arms of every
paired test together.

For the record: the executor was `eb9790f61931636ca0ee58d7d4fbbb0d2d515fd2e2dc197303fd8f805d79136a` before this change.
