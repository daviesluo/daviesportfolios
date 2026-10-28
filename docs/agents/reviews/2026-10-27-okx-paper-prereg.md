# Pre-registration: "Stablecoin quotes OKX USDG" and "Stablecoin quotes OKX EURC", LIVE's rules on paper on OKX (2026-10-27)

**Status: FROZEN** at the commit that adds migration `0150`, `agents/okx_rec.ts` and `agents/okx_quotes.ts`. Any later
change is a deviation, written in §8 with its date and reason. It changes no other test, row or reading.

**Not blind.** OTHERVENUES (`2026-10-27-other-coins-venues.md`, reference §3.55) read both books' whole history with PR5's
simulator before this was written, and chose them on it. This test is the forward check of that choice.

## 0. On whose word

Davies, 2026-10-27, verbatim:

> 我已经有okx在英国的账户了，okx的这两个策略在这个账户上可以做吗？可以的话就加盘口记录器和开testings策略（目前live的rules？）

In English: he has an OKX account in the UK. Can the two strategies run on it? If so, add the book recorder and start the
testing strategies, on LIVE's current rules.

## 1. Can his UK account trade these books? Not settled from public sources

What public sources settle:

- **The books exist, and they are unified.** OKX's public instrument list (`/api/v5/public/instruments?instType=SPOT`, read
  2026-10-27; the same list from www, my and eea hosts) gives each spot book its `tradeQuoteCcyList`:
  - `USDG-EUR` is quoted in EUR or EURC: one euro book;
  - `EURC-USDC` is quoted in USDG, USD, USDC or RLUSD: one dollar book (OKX's "Unified USD Orderbook").
  - An API order still names `USDG-EUR` or `EURC-USDC`; the currency it settles in is chosen per order.
  - So both books are EUR/USD books. The recorder reads them under those ids, keyless.
- **OKX has a "Spot Stablecoins" fee group at 0.0000 % maker / 0.0500 % taker** (OKX's en-gb help notice moving USDT/USD
  into it, 2026-07-13). Its notice says "these pairs may not be available in all jurisdictions" and names no other pair.
  OKX's EEA notice gives the same rate to EEA spot-only accounts (2026-09-25).
- **The public API serves no region's list.** Whether a book is open to an account cannot be read without the account.

What they do not settle, and Davies reads in the app:

- **The entity.** One UK review (Cryptolounge, 2026) says UK customers are served by Aux Cayes FinTech Co Ltd (Seychelles),
  not an FCA-registered entity, and that "the UK range is restricted". Another (2026) lists the UK as restricted. OKX's own
  pages read here say neither.
- **The pairs.** Nothing public says a UK account lists `USDG-EUR`, `EURC-USDC`, EURC or USDG.
- **The fee.** Third parties quote 0.08 % maker / 0.10 % taker for UK regular spot. A 0.08 % maker fee on each leg is more
  than the whole edge OTHERVENUES measured (18–23 bps a round trip): the strategy needs the 0 % stablecoin group.

**The checks, in the OKX app, reading only** (no order, not even a small one):

1. Trade → Spot → search "USDG": is USDG/EUR (or USDG/EURC) listed and tradable for the account? Search "EURC": is EURC/USDC
   (or EURC/USD) listed?
2. Assets → Deposit: can the account hold EUR (a SEPA deposit), or only GBP? If only GBP, is EURC offered? USDG-EUR is
   traded against EUR or EURC.
3. Profile → Fee rates (or the fee shown on the pair's order panel): the maker and taker rate for each of the two pairs.
   Is there a "Stablecoins" row at 0 % maker?
4. The pair's order panel: is "Post only" offered on a limit order?
5. Profile → API: may this account create an API key? (Only look; create nothing.)
6. Profile → Verification / legal entity: which OKX entity serves the account.

If 1 or 3 fails (not listed, or maker above 0 %), this test still runs on public data, and its reading says the account
cannot carry it.

## 2. What runs

- **The recorder** (`agents/okx_rec.ts`, `agents?action=okxrec`, a row of `edge_calls` under the watchdog, its beat first):
  - every print of both books by trade id (OKX's `market/trades`; a gap paged back with `market/history-trades`), the
    taker's side kept as the aggressor;
  - the best five levels a side each minute.
  - Keyless and GET only, from the Edge region (eu-west-2). Prints kept 400 days, book reads 60.
- **The twins** (`agents/okx_quotes.ts`, the same call after the recorder): PR5's rule as LIVE carries it out, one record, two
  books, a page row each.

## 3. The rule (LIVE's, as of 2026-10-27)

Each book, each minute t, decided one minute behind the recorder's coverage:

| | this test | LIVE (Revolut X) |
|---|---|---|
| fair | USDG-EUR 1 / EUR/USD; EURC-USDC EUR/USD; coins at par | fairU (the USD book's 24-hour median) / GBP/USD |
| EUR/USD | the Coinbase test's stored minute (`cb_quote_inputs`), the latest bar in [t − 10, t − 1] | GBP/USD the same way |
| weekend | inside PR5-W's closures (Fri 21:00 → Sun 21:00 UTC, two holidays) a dark minute takes the last EUR/USD | the same (`weekend_mode` live) |
| rungs | 0.1 / 0.2 / 0.3 % a side, re-priced on a 0.05 % move of fair | the same |
| size | €50 a rung (on EURC-USDC €50 at the minute's EUR/USD), 6 a book, €600 = 12 × €50 | £50 a rung, £600 = 12 × £50 |
| grid | USDG-EUR 0.0001, EURC-USDC 0.001 | 0.0001 |
| post-only | refused when it would cross the recorder's last book read (≤ 2 min old); else the last print's touch | refused by the venue against its book |
| fill | a print through the price, or AT it from the other side, by the print's quantity, best price first ("at") | the same rule in its twins (`simFill` "at") |
| exit | at fair (long up, short down), for what is held, in parts | the same |
| stop | 24 hours, at the recorded best bid (ask) less (plus) 0.10 % | 24 hours, a taker |
| guards | no entry while dark; last print > 50 bps from fair; after the day's closed trips on both books lose 1 % of the capital | the same three |
| fees | maker 0 % | maker 0 % |

Money is in pounds: a trip's P&L in the quote currency at the minute's pounds per unit (EUR/USD ÷ GBP/USD for euros, 1 ÷
GBP/USD for dollars; GBP/USD PR5's stored minute). The capital is €600 at EUR/GBP.

What it leaves out, and why:

- **No conversions and no top-ups.** A paper record holds no coin of its own. LIVE needs its asks' coin, and so would OKX.
- **No dead-man, governor or stale-input guard.** They guard an account and its executor, and this test has neither.

## 4. Window

28 UTC days from its first decided minute (`startedAt` in `okx_quote_state`: the first 00:00 UTC after the first run). The
reading runs on or after the window's end + 1 day 00:30 UTC, so a trip entered on the last day has closed or been stopped.

## 5. The bar (all must hold)

Over trips **entered** in the window, from `okx_quote_trips`:

1. P&L in pounds > 0 on each book.
2. At least 150 round trips on USDG-EUR and at least 40 on EURC-USDC.
3. Stops (`how` = 'taker') at most 10 % of trips on each book.
4. The day bootstrap on both books together: 2,000 resamples of the 28 days' pounds (day = the entry's UTC day, a day with
   no trip counted 0), `random.Random(20261029)`; its 5th percentile of the total ≥ 0.
5. At least 5 bps of the capital a day on the two together: total pounds ÷ 28 ÷ (€600 × the window's mean pounds per euro)
   ≥ 0.0005. The pounds per euro is the mean of USDG-EUR's `gbp_per_quote` over the window's rows of `okx_quote_minutes` where
   it is not null.

**Void** if either book's record decided fewer than 95 % of the window's minutes (`okx_quote_minutes`), or if the stored
EUR/USD stopped (the Coinbase test's call is retired) for more than a day of the window. A void test is restarted, not read.

**The fee.** The bar is read at 0 % maker. The reading also reports each book's P&L at the maker fee Davies read in §1
(each trip's entry and exit notional × that fee). Going live on the UK account needs condition 1 to hold at that fee too.

## 6. The reading

```sql
select book,
       count(*) as trips,
       count(*) filter (where how = 'taker') as stops,
       sum(pnl_gbp) as pnl_gbp,
       sum(qty * entry) as entry_notional_quote,
       sum(qty * exit) as exit_notional_quote
from public.okx_quote_trips
where t_entry >= :start and t_entry < :start + interval '28 days'
group by book;

select (t_entry at time zone 'UTC')::date as day, sum(pnl_gbp) as pnl_gbp
from public.okx_quote_trips
where t_entry >= :start and t_entry < :start + interval '28 days'
group by 1 order by 1;
```

The bootstrap, on the 28 daily totals `v` (zeros for days with none):

```python
import random
rng = random.Random(20261029)
s = sorted(sum(rng.choice(v) for _ in range(len(v))) for _ in range(2000))
p05 = s[100]
```

## 7. Frozen files

| file | sha256 |
|---|---|
| `supabase/migrations/0150_okx_rec_paper.sql` | d35262ea429612cda1c7b39b4ff2de4fdcb973f8b53d4425c1b0425df5dda26b |
| `supabase/functions/agents/okx_rec.ts` | 9bdc2c9e186e32d15a2e8eee0727e54992183156afb717907c05a1ec6fa655ac |
| `supabase/functions/agents/okx_quotes.ts` | 67a2cc1f82afb6fc401ef397f0ce0eefec22d29aa9283bf7e3d217e2313bb1e2 |
| `supabase/functions/agents/okx_quotes.test.ts` | 5a0448688596160fbfee9bd555cd3266ee0c1cf7082d1b30a52bf85ca534a1b7 |
| `supabase/functions/agents/quotes.ts` | 0782ed8140a2e490f19b9e92fe7093c2cb9a6f205866180314f609537277f517 |

`src/okx_prereg.test.js` pins each.

## 8. Deviations

**Deviation 1 (2026-10-28, migration `0155`): the window starts at 2026-10-28 22:00 UTC, not 2026-10-29 00:00 UTC.** Davies,
2026-10-28, after PR5-OPT's five twins were moved to start at 22:00: "okx" (start these now, too). Nothing had been decided:
both books idle, `okx_quote_minutes` empty. `startedAt` and `lastMinute` in `okx_quote_state` move back two hours; the engine
catches up from 22:00 on the recorder's prints since 19:53. §4's 28 UTC days run 2026-10-28 22:00 → 2026-11-25 22:00 and §6's
`:start` is the new `startedAt`; the first and last UTC days are partial (2 h and 22 h), the daily loss stop still resets at
00:00 UTC. The rule, the bar and §7's files are unchanged.
