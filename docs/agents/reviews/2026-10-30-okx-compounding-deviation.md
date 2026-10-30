# A deviation of the OKX paper twins' two pre-registrations: what each book realises is put back to work from 2026-10-31 00:00 UTC

Recorded apart from the pre-registrations it concerns, which are left as they were frozen, byte for byte. Where one froze a file
this changes (`okx_quotes.ts`, `okx_basis.ts`), its pin test reads the hashes it named before and the hash named here, under its own
heading, for the file as it is. It extends the compounding of every other Stablecoin quotes test (`0183`;
`reviews/2026-10-30-compounding.md`, `reviews/2026-10-30-compounding-deviation.md`) to the three OKX rows, which that audit left out
(§1).

## On whose word, and why

Davies, 2026-10-30 (~02:15 UTC), told that the OKX twins did not reuse their profit either and asked whether to add it, verbatim:

> …你觉得需要做的话就做

(…if you think it needs doing, do it). It does: every other Stablecoin quotes test compounds from 2026-10-31 00:00 UTC, and the OKX
rows run LIVE's rules, so they compound on the same rule from the same instant. The base Coinbase test (`cb_quotes.ts`) is the
weekend reading's pre-registered control and stays as it is.

## What changed

- **The rule** is LIVE's `0146` rule (`compoundPlan`, `quotes_compound.ts`), as every other test's: each book (each row of the page)
  on its own record. At the first minute of each UTC day its capital is its funded **$600** plus every round trip it has closed since
  **2026-10-31 00:00 UTC**, in dollars (a trip's quote-currency P&L at the minute's EUR/USD on a euro book, as it is on a USDC book),
  in whole **$6** (a dollar a rung), between **$300** and **$1,200**, moved only $6 or more away (`okx_compound.ts`).
- **How.** The engine (`stepOkxMinute`, unchanged) sizes each entry from the dollars a rung it is given, `rungUsd`, and holds a
  position in real coin. From the instant each book is given **$100 × its capital ÷ $600**, so nothing held is rescaled; an entry
  resting at the old size keeps it until it is re-priced, as a Revolut X order does on a capital change. The daily loss stop counts
  against the capital the same way (both books' on the twins' account, the basis row's own).
- **Before the instant nothing differs**: the multiplier is 1 and every number is the one the frozen code gave
  (`okx_quotes.test.ts` and `okx_basis.test.ts` pass unchanged; `okx_compound.test.ts` pins the counterfactual).
- **Each day's capital is kept** in the state (`compound[book].days`).
- **The page** shows FUNDED as put in ($600 a book); held coin is real coin.

## How every reading keeps its size

The assumption every size change of these tests made: fills and fees scale linearly with size.

- **A reading in money or in % on the fixed capital** reads each trip entered on a day ÷ that day's multiplier (the day's capital
  over $600, from `days`), so every trip is at the size the pre-registration fixed. A paired comparison reads both rows that way, so
  it stays like for like.
- **A ratio** (bps a round trip, a share, P(≤ 0) of a paired difference per dollar) is unchanged.
- **The report says so**, and gives the days from 2026-10-31 apart where it can.

## Each pre-registration it touches

### `docs/agents/reviews/2026-10-27-okx-paper-prereg.md`

"Stablecoin quotes USDG/EUR" and "Stablecoin quotes EURC/USDC" compound from the instant, each book on its own record. The bar
(total dollars ÷ 28 ÷ $1,200 ≥ 0.0005) reads each trip ÷ its day's multiplier. The file as it is:

| file | sha256 (compounding, 2026-10-30) |
|---|---|
| `supabase/functions/agents/okx_quotes.ts` | 2d59ba85defb1f6fa3d7a4ec61b42fd4b6a73083626d79040c7a0d3ebfde3a62 |

The bytes before it, Deviation 2's: `257e8ccb4d302ce5b26c51f5ca8d9bdcee11a52e0c8253d467fda3df57f832e7`.

### `docs/agents/reviews/2026-10-29-okx-usdg-basis-prereg.md`

"Stablecoin quotes USDG/EUR - 1" compounds from the instant on its own record, as does the USDG/EUR row it is compared with; its
paired reading reads both at $600 (each trip ÷ its day's multiplier). The files as they are:

| file | sha256 (compounding, 2026-10-30) |
|---|---|
| `supabase/functions/agents/okx_basis.ts` | 43df4b054634fbc302e6259312cbf6dde6df88630c48fda99d7c403589e13529 |
| `supabase/functions/agents/okx_quotes.ts` | 2d59ba85defb1f6fa3d7a4ec61b42fd4b6a73083626d79040c7a0d3ebfde3a62 |

The bytes before it: `okx_basis.ts` `1a35cfcf00fdfdae2159c61f251e3a748f392ef81d7afd5e3892cb02ae307659`, `okx_quotes.ts`
`257e8ccb4d302ce5b26c51f5ca8d9bdcee11a52e0c8253d467fda3df57f832e7`.
