# A deviation of eight twin pre-registrations: the driver and the executor gain variant-7's rules (2026-10-29, migration `0169`)

Recorded apart from the eight pre-registrations it concerns, which are left as they were frozen, byte for byte. Each one's
pin test (named below) reads its frozen text for the hashes it named and this record, under its own heading, for the
files as they are now; the chain is unbroken and any other bytes fail it, as each document's own deviations do.

## What changed

One frozen file changed, the driver, and with it the executor (which none of the eight freezes by hash; two of them read its
text for the rules their twins use, and those checks pass unchanged), for one new twin and its control ("Stablecoin quotes variant-7", `u300nudge`, and its hidden
control `u300ctl`; `0169`, `docs/agents/reviews/2026-10-29-revx-usdc-nudge-twin-prereg.md`):

- **`supabase/functions/agents/quotes_twin.ts`**, the twin driver:
  - two rule keys, `fairNudge` (REVX-FAIR's USDC-GBP nudge, `quotes_nudge.ts`) and `usdCapital` (a twin booked in pounds and
    shown in dollars), each read only from a spec row that names it;
  - the replica's step takes the nudge when the twin has it (`stepTwinPaper`'s last argument, `null` for every other twin):
    on the rule's book it moves the EMA, decides the minute on the nudged fair, writes the minute to `agent_quote_twin_nudge`,
    and leaves that book's minutes out of the replica's check against PR5's record (as the weekend rule already does);
  - `cb_touch` joins the tables a twin may read, and `agent_quote_twin_nudge` the tables a nudged twin writes.
- **`supabase/functions/agents/quotes_live.ts`**, the executor:
  - the instance options `fairNudge` and `usdCapital`, absent on the live account's instance and on every twin but the two;
  - `nudgedInputs`: in `paperView`, an instance WITH `fairNudge` prices its exits, its stop's bound and its guards off the
    fair its replica recorded for the minute carried out. Without the option the line is the inputs exactly as before.

The page's dollars (`twinInUsd`, `supabase/functions/agents/index.ts`) and the test double's paged keys (`db.ts`) are not
frozen files; they are named here for completeness.

## Why

Davies, 2026-10-29: "“唯一的线索：只针对 USDC-GBP • 做法：用 Coinbase 的 USDC-GBP 中间价偏离程度，对合理价做半权重的微调。” 这个开testing
variant-7，在目前实盘的基础上做300美元funded". The nudge must act where the twins decide (the driver, frozen) and where
they execute (the executor); it cannot be added without them.

## Why nothing changes for any twin these eight pre-registrations read

- **The live account's executor is unchanged:** `supabase/functions/agents/quotes_live_frozen.ts` is not touched (sha256
  `60d3f33f2bb8d328fe14693d570396afdffcc2cae9b75e05e2d4eed5ea459a52` before and after), and `quotes_live_instance.test.ts`,
  which runs the live instance beside it and finds every table, account and report the same, passes.
- **A twin without the rule is unchanged order for order:** `quotes_twin.test.ts` runs `p50` beside the nudged twin and
  alone, and its orders are equal field for field (the test "fairNudge (0169): … a twin without the rule unchanged beside
  it"). Every test of the twins' suite written before this change passes unchanged.
- **No row without the rule reads it:** the replica runs the nudge only when its spec has `fairNudge` (`stepTwinPaper`'s
  argument is `null` otherwise), the executor only when its instance has it (`inst.fairNudge`), and the page converts only
  a twin with `usdCapital`. No spec row of these eight pre-registrations names either key (`src/twin_specs.test.js`), and the
  live account's instance has neither (`quotes_twin.test.ts`, "fairNudge and usdCapital (0169)").

Nothing else in these documents changes: windows, bars, readings, scripts and rows are as frozen.

## The files as they are, by pre-registration

### `docs/agents/reviews/2026-10-02-pr5-realistic-twins-prereg.md`

Pin: `src/twins_prereg.test.js`. Its last named hash of the driver, `2b84a1ebbdc1172375ff7c783a463ce39e266c490b2256314eae8893b5548e68`, was the file before this change.

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_twin.ts` | c14d9138ca27cf859d0efe586698b3cfce390d715810fe7338989f00ec6a8de5 |

### `docs/agents/reviews/2026-10-03-pr5-size-twin-prereg.md`

Pin: `src/size_twin_prereg.test.js`.

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_twin.ts` | c14d9138ca27cf859d0efe586698b3cfce390d715810fe7338989f00ec6a8de5 |

### `docs/agents/reviews/2026-10-18-revx-weekend-prereg.md`

Pin: `src/weekend_twin.test.js`.

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_twin.ts` | c14d9138ca27cf859d0efe586698b3cfce390d715810fe7338989f00ec6a8de5 |

### `docs/agents/reviews/2026-10-21-live-twin-prereg.md`

Pin: `src/live_twin.test.js`.

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_twin.ts` | c14d9138ca27cf859d0efe586698b3cfce390d715810fe7338989f00ec6a8de5 |

### `docs/agents/reviews/2026-10-26-live-size-twins-prereg.md`

Pin: `src/live_size_twins.test.js`.

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_twin.ts` | c14d9138ca27cf859d0efe586698b3cfce390d715810fe7338989f00ec6a8de5 |

### `docs/agents/reviews/2026-10-27-live-next-size-prereg.md`

Pin: `src/live_next_size.test.js`.

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_twin.ts` | c14d9138ca27cf859d0efe586698b3cfce390d715810fe7338989f00ec6a8de5 |

### `docs/agents/reviews/2026-10-27-pr5-opt-twins-prereg.md`

Pin: `src/pr5_opt_twins.test.js` (it also reads the executor's text for its twins' rules, unchanged).

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_twin.ts` | c14d9138ca27cf859d0efe586698b3cfce390d715810fe7338989f00ec6a8de5 |

### `docs/agents/reviews/2026-10-27-pr5-opt-twins-now-prereg.md`

Pin: `src/pr5_opt_twins_now.test.js` (it also reads the executor's text for its twins' rules, unchanged).

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_twin.ts` | c14d9138ca27cf859d0efe586698b3cfce390d715810fe7338989f00ec6a8de5 |

For the record: the executor, `supabase/functions/agents/quotes_live.ts`, was `fb23d63985884bb5eec1bce4fd4b5b2625d62dfebe9847410768ffc80344a987`
before this change and is `12e3dad7cc9058cedc7cd840fc4ac5d3396b955c842e39fd70f22f18cfad25eb` after it; no pre-registration freezes it.

## Why recorded apart

The sessions before recorded such a change as a deviation inside each document. This one is recorded once, here, because
the session that made it works under a rule never to edit a frozen pre-registration; the record serves the same purpose (it
is in the repository and the ledger, it names each file as it is, and each pin test reads it).
