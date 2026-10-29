# A deviation of the pre-registrations that froze the executor: a second instance, an instance's top-up day, and the venue's balances in the state (2026-10-29, migration `0180`)

Recorded apart from the pre-registrations it concerns, which are left as they were frozen. Where one froze
`supabase/functions/agents/quotes_live.ts`, its pin test reads the hashes named before and the hash named here, under its own
heading, for the file as it is.

## On whose word

Davies, 2026-10-29 ~22:05 UTC, for "Stablecoin quotes USDC/GBP" on Revolut X (`reviews/2026-10-29-rx-usdc-live.md`,
`reviews/2026-10-29-rx-usdc-live-design.md`); and 22:20 UTC, the real venue balances on the LIVE pages ("revolut也一样").

## What changed in the executor, and what did not

- **`QUOTE_RXU_INSTANCE`**, a new instance constant (its own tables, lease, rules). No running instance names it.
- **`QuoteLiveInstance.topUps`**, a new option: an instance's own daily top-up cap, and with it a shortfall bought in part.
  No twin rule sets it (`TWIN_RULES` is unchanged); LIVE's instance has none, so its day stays £5 (its rebook's capital
  until 2026-11-01 22:30, as before).
- **`venueBalances`** in the state at the end of each turn that read the account's balances: what the venue said of GBP, USDC
  and USDT, available and on hold (`venueBalancesOf`; `Venue.balanceDetail`, kept by `revxVenue` from the read the turn already
  made, no call of its own). A write only: nothing the executor decides reads it. `quotes_live_instance.test.ts` runs every
  instance against `quotes_live_frozen.ts` (unchanged, `60d3f33f2bb8d328fe14693d570396afdffcc2cae9b75e05e2d4eed5ea459a52`) turn
  by turn with this one key left out of the comparison, and pins its shape on its own.

No twin's decisions change: a twin's state gains the same `venueBalances` from its simulated account.

## Each pre-registration it touches

### `docs/agents/reviews/2026-10-29-usdt-only-twins-prereg.md`

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | d683bb5a4f1accf144c630a7d69bd565953a23879be847eade2ce2868d8bc86c |

### `docs/agents/reviews/2026-10-29-revx-usdc-nudge-twin-prereg.md`

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | d683bb5a4f1accf144c630a7d69bd565953a23879be847eade2ce2868d8bc86c |

### `docs/agents/reviews/2026-10-29-revx-exit-tick-twin-prereg.md`

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | d683bb5a4f1accf144c630a7d69bd565953a23879be847eade2ce2868d8bc86c |

For the record: the executor was `aa770ef6fc40301e4d7bbfbf4f9f2e66f6e7a8b010f4c4a8b5646cc1075d80cc` before this change.
