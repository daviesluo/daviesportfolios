# Pre-registration: "Stablecoin quotes USDG/EUR - 1", the USDG/EUR rule with its fair moved half-way to the book's basis (2026-10-29)

**Status: FROZEN** at the commit that adds migration `0171`, `agents/okx_basis.ts` and this file. Any later change is a deviation,
written in §7 with its date and reason. It changes no other test, row or reading: "Stablecoin quotes USDG/EUR" and "… EURC/USDC"
(`2026-10-27-okx-paper-prereg.md`, reading on or after 2026-11-25) run as frozen.

**Not blind.** The study that proposed it (`2026-10-29-cb-okx-fair-price-study.md`, §4 and its Addendum A1) read OKX's whole USDG-EUR
history on both PR5's simulator and the OKX twins' own engine before this was written. The setting (½, 24 hours) was fixed in that
study before its OKX-engine re-test ran.

## 0. On whose word

Davies, 2026-10-29, on the study's recommendation 2, verbatim: "okx usdg/eur可以按你说的做一个 -1" (make the OKX USDG/EUR one as you
proposed, as a "- 1"). Then, before the build: "…你先按okx的研究下，还成立的话再上线" (study it on OKX's own rules first; go live only if
it still holds). It held: the Addendum's A1 (§2 below).

## 1. What runs, and the one change

`agents/okx_basis.ts` calls `stepOkxMinute` (`okx_quotes.ts`, the USDG/EUR row's engine, imported unchanged) on USDG-EUR alone,
from the OKX recorder's prints and books, one minute behind its coverage.

| | "Stablecoin quotes USDG/EUR" | "Stablecoin quotes USDG/EUR - 1" |
|---|---|---|
| fair | par: 1 / EUR/USD euros a USDG | **par × (1 + ½ × b)** |
| rung, book | $100 in euros at the minute's EUR/USD, six, $600 | the same euros, six, $600 |
| rungs, re-price, post-only, "at" fill, exit at fair, 24-hour stop | LIVE's | the same |
| closure | the last EUR/USD held | the last x' held (the last basis fair) |
| dark and de-peg guards | against its fair | against its fair (this fair) |
| daily loss stop | the account's: both OKX books' trips, −1 % of $1,200 | this book's trips, −1 % of its $600 |
| tables, lease, call | `okx_quote_*`, `okx-quotes`, `agents?action=okxrec` | `okx_basis_*`, `okx-basis`, `agents?action=okxbasis` (`0171`) |
| start | 2026-10-28 22:00 | **the first 00:00 UTC after its first run** (`okx_basis_state.state.startedAt`), flat, no backfill |

**The basis b(t)**, known at the start of minute t (`okxBasisAt`):
- **The window.** The minutes j in [t − 24 h, t − 1 min] in which USDG-EUR printed (OKX's prints as the recorder keeps them).
- **One value a minute.** (the minute's last print ÷ par(j) − 1), whatever the prints' sizes or count. The last print is the one
  with the latest time, then the highest trade id.
- **Par of a past minute.** par(j) = 1 / the newest stored EUR/USD bar (`cb_quote_inputs`) that started at or before j − 1 min,
  of any age, so a closure holds the last.
- **The median** of those values.
- **Fewer than five such minutes**, and b = 0: the fair is par. The study's replay carried the last median instead; on OKX's
  own engine the two gave the same later half to the cent (Addendum A1).

**How the engine is given it** (`okxBasisInputs`):
- A lit minute passes x' = EUR/USD ÷ (1 + ½ b) as the engine's `eurusd`, and $100 ÷ (1 + ½ b) as its rung. The engine then quotes
  round par × (1 + ½ b) with the USDG/EUR row's euros a rung.
- A dark minute passes no rate (inside a closure the engine holds its last x'), and the rung at the last lit minute's b.
- **What follows.** The engine's pounds per euro, and so `okx_basis_trips.pnl_gbp`, carry the factor 1 / (1 + ½ b), a few bps of
  the P&L. The reading uses `pnl_quote`, in euros.

## 2. Why, and what is expected

| source | fill model | out of sample | gain on par |
|---|---|---|---|
| the study's §4.2: PR5's simulator on OTHERVENUES' bars, 07-01 → 10-27 | through the quote, 10 % of the minute, £50 a rung | +£0.070 a day on a £300 book [+0.039, +0.102] | +13 % |
| **the Addendum's A1: the OKX twins' own engine on OKX's archived prints, 07-01 → 10-29** | LIVE's "at" fill by print size, $100 a rung | **+€0.168 a day [+0.099, +0.234], P(≤ 0) 0.000** | **+26 %** |

- **The expectation is A1's.** Over its 121 days the daily difference had a mean of +€0.168 and a standard deviation of €0.45.
- **Power.** At that rate a 28-day window passes the bar below about 84 % of the time when its days are drawn at random from those
  121. Of the 94 contiguous 28-day windows inside them, 58 passed (62 %): the days cluster.
- **A miss is therefore not proof of no effect.** A pass is not proof of the +26 % either.
- **How A1's basis came out.** It was +6.8 bps at the median: USDG traded above par almost all the time. The basis fair lets the
  bids fill where par sold USDG into that premium (525 bids against 276), earns more a trip (16.9 against 16.1 bps) and stops less
  (7 against 22).

## 3. Window, reading and bar

- **Window.** 28 UTC days from `okx_basis_state.state.startedAt` (a 00:00 UTC).
- **Reading.** On or after the window's end + 1 day, 00:30 UTC, so a trip entered on the last day has closed or been stopped.
- **The comparison.** The trips entered in the window, by their entry minute, of this row (`okx_basis_trips`) and of the USDG/EUR
  row's USDG-EUR book (`okx_quote_trips`, `book = 'USDG-EUR'`). Both are at $100 a rung through the window: the USDG/EUR row's
  Deviation 2 switched it on 2026-10-29.
- **The daily difference.** For each of the 28 UTC days, this row's `pnl_quote` summed less the USDG/EUR row's (euros; a day with
  no trip counts 0).
- **Bar** (one condition): the day-block bootstrap of the mean daily difference, 2,000 draws of the 28 days with replacement,
  `random.Random(20261029)`: **P(mean ≤ 0) < 0.10**, the share of draws whose mean is at or below zero.
- **Reported beside the bar, not part of it:**
  - both rows' trips, bids and asks, euros, bps a trip (P&L ÷ entry notional), stops, worst day;
  - the gain as a share of the USDG/EUR row's P&L;
  - the basis's median and range over the window (`okx_basis_minutes.basis`);
  - the minutes with fewer than five (b = 0);
  - any day this row's loss stop fired.
- **Void** if this row decided fewer than 95 % of the window's minutes (`okx_basis_minutes`), or if the stored EUR/USD stopped
  (the Coinbase test's call is retired) for more than a day of the window. A void test is restarted, not read.
- **If it passes:** USDG/EUR's fair can take the basis term in whatever OKX row is funded; that is Davies' call, as is any live
  use. **If it fails:** the row is retired and the USDG/EUR rule stays at par.
- **The account question is unchanged.** Whether a UK account may trade USDG-EUR at 0 % maker is still the OKX
  pre-registration's §1, Davies' in-app check.

```sql
select 'basis' as arm, (t_entry at time zone 'UTC')::date as day, sum(pnl_quote) as eur, count(*) as trips
from public.okx_basis_trips where t_entry >= :start and t_entry < :start + interval '28 days' group by 1, 2
union all
select 'par', (t_entry at time zone 'UTC')::date, sum(pnl_quote), count(*)
from public.okx_quote_trips where book = 'USDG-EUR' and t_entry >= :start and t_entry < :start + interval '28 days' group by 1, 2
order by 2, 1;
```

```python
import random
# d: the 28 daily differences (basis − par, euros), in day order, 0 for a day with no trip in either
rng = random.Random(20261029)
s = [sum(rng.choice(d) for _ in range(28)) / 28 for _ in range(2000)]
p_le_0 = sum(1 for x in s if x <= 0) / 2000      # the bar: < 0.10
```

## 4. Its record before now

None. It starts flat at the first 00:00 UTC after its first run and decides no minute before it.

## 5. Frozen files

| file | sha256 |
|---|---|
| `supabase/functions/agents/okx_basis.ts` | 1a35cfcf00fdfdae2159c61f251e3a748f392ef81d7afd5e3892cb02ae307659 |
| `supabase/functions/agents/okx_basis.test.ts` | 20cd2925be4c20d04f51f76472b5bcc48acfef97a04c93e9dda98af337b0fe2b |
| `supabase/migrations/0171_okx_usdg_basis.sql` | bb70c8642ce1445cc64c9d1ef8788d440cad548c13ca02b562a4c505aad0c78b |

**What it leaves as it was.** The USDG/EUR and EURC/USDC rows' frozen files, byte for byte. `src/okx_basis_prereg.test.js`
checks each against the sha256 the OKX pre-registration names for it:

| file | sha256 |
|---|---|
| `supabase/functions/agents/okx_quotes.ts` | 257e8ccb4d302ce5b26c51f5ca8d9bdcee11a52e0c8253d467fda3df57f832e7 |
| `supabase/functions/agents/okx_rec.ts` | 9bdc2c9e186e32d15a2e8eee0727e54992183156afb717907c05a1ec6fa655ac |
| `supabase/functions/agents/quotes.ts` | 0782ed8140a2e490f19b9e92fe7093c2cb9a6f205866180314f609537277f517 |
| `supabase/migrations/0150_okx_rec_paper.sql` | d35262ea429612cda1c7b39b4ff2de4fdcb973f8b53d4425c1b0425df5dda26b |

`okx_basis.test.ts` pins two more things:
- with b = 0 the new row's engine is the USDG/EUR row's, minute for minute;
- a run writes nothing to `okx_quote_*` and never takes their lease.

## 6. Disclosures

- Every figure in §2 was seen before this was written: the study's §4.2 and Addendum A1, on data to 2026-10-29 05:30 UTC.
- The bar was set after seeing them. It is the one the main session's brief of 2026-10-29 named ("P(≤0) < 0.10").

## 7. Deviations

None.
