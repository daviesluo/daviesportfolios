# Pre-registration: "Stablecoin quotes RX↔Coinbase hedge" and "… - 1", a real-time paper test in two arms (2026-10-30)

**Status: FROZEN** at the commit that adds this file, before the test has decided a minute (each arm starts at the first
00:00 UTC after its first run). A change after that is a deviation (§7).

Davies, 2026-10-30 ~02:15 UTC: "怎么实现自动化？如果真的可以实现的话就做成实时纸面测试加到testing里，然后解释下不调仓的话怎么运行的？"
(how is it automated? if it really can be, make it a real-time paper test on TESTING, and explain how it runs without
rebalancing). Then, ~02:35 UTC: "A 策略可以单独做吗还是只能做像你刚才说的和做市商抢生意的那个做法？" (can A be done on its own, or only
by competing with the maker?). The strategy is A of `reviews/2026-10-30-revx-mm-competition.md`, priced with its costs in
`reviews/2026-10-30-mmcomp-2.md` §1. The second arm's distance comes from `backtests/mmcomp/scripts/xhedge_a2.py`
(`results/xhedge_a2.json`).

## 1. What it tests

On Revolut X, rest one order a side, either one tick inside the other maker's quote (arm `inside`, "A1") or at a fixed
distance from Coinbase's mid and never better than Revolut X's own touch (arm `behind`, "A2"). Neither goes past Coinbase's
touch ± 2 bps. Hedge every fill at once as a Coinbase taker. No coin or pound ever moves between the venues.

The question: does the basis between the two venues (Revolut X's GBP stablecoin books trade about 5 bps under Coinbase's)
pay, after Coinbase's fee, when the inventory has to look after itself? And does it pay without competing with the maker?

## 2. The rule (`supabase/functions/agents/xhedge.ts`, migration `0184`)

- **Arms:** `inside` ("Stablecoin quotes RX↔Coinbase hedge") and `behind` ("Stablecoin quotes RX↔Coinbase hedge - 1"). Same
  engine, money, inputs and hedge; only the price of the Revolut X order differs. Each arm models its own Revolut X
  sub-account and its own Coinbase account, and neither sees the other's orders.
- **Books:** USDT-GBP and USDC-GBP, each on its own two simulated accounts an arm.
- **Money:** £600 a venue a book, half in pounds and half in coin at the opening mids. That is £1,200 a book and £2,400 an
  arm. £600 a venue is MMCOMP-2's best figure for its capital: £1,200 a book gave 32.8 % a year on USDT-GBP against 23.7 %
  at £5,000.
- **The turn,** every minute t, at t + 30 s:
  - Revolut X's book as the recorder last saw it (`agent_book_levels`; dark when unseen for 75 s);
  - Coinbase's touch (`cb_touch`; dark when over 60 s old). Dark: nothing rests.
- **The prices,** £100 of coin a side:
  - `inside`: bid = min(Revolut X bid + 0.0001, Revolut X ask − 0.0001, Coinbase bid × 0.9998 floored to 0.0001);
    ask = max(Revolut X ask − 0.0001, Revolut X bid + 0.0001, Coinbase ask × 1.0002 ceiled);
  - `behind`: bid = min(Coinbase mid × 0.999 floored, Revolut X bid, Revolut X ask − 0.0001, Coinbase bid × 0.9998
    floored); ask = max(Coinbase mid × 1.001 ceiled, Revolut X ask, Revolut X bid + 0.0001, Coinbase ask × 1.0002 ceiled).
    10 bps is LIVE's 0.1 % rung. Behind the maker, it was the best distance on USDC-GBP in the replay, and on USDT-GBP within
    £0.012 a day of 3 bps (§4).
- **Inventory, no rebalancing:**
  - A bid quotes only while Revolut X holds £100 of pounds and Coinbase £100 of coin beyond the hedges owed.
  - An ask quotes only while Revolut X holds £100 of coin and Coinbase £100 of pounds beyond them.
  - Otherwise that side is off. The minute is recorded with its reason (`rx-gbp`, `cb-coin`, `rx-coin`, `cb-gbp`).
  - The side comes back when fills on the other side refill the leg.
- **Fills,** by recorded Revolut X prints in [turn, turn + 60 s), each up to what is left of the order and of the inventory:
  - strictly inside the best level (first in its queue): at or through our price;
  - joining the level or behind it: strictly through our price. The `behind` arm is never inside, so it fills only through.
- **Hedge:**
  - Coinbase taker at the first Coinbase read at or after the fill + 30 s;
  - fee 0.45 bps (the dearest published stable-pair tier; the account's own tier is unread);
  - a side's fills under £1 wait together until they reach £1 (Coinbase's minimum order is £0.72).
- **Round trip:** one hedge and the fill(s) it closes. P&L = what Coinbase paid or took, less the fee, against what
  Revolut X took or paid.
- **Orders:**
  - a placement when a side starts, its price moves, or a fill emptied it;
  - counted a UTC day an arm for both books, with a governor of 2,400. A Revolut X sub-account has no daily order limit;
    the replay needs about 500 a book a day.
- **Compounding:** none to build. Every round trip's pounds stay in its accounts, so what it realises is used at once.

## 3. Window and reading date

- S is each arm's `agent_xhedge_state.state.startedAt`, the first 00:00 UTC after its first run (the two arms share it when
  they start in the same run).
- The window is S to S + 28 days.
- The reading runs on or after S + 28 days 01:00 UTC, and no later than S + 35 days.

## 4. What the studies expect (not the bar)

`xhedge_a2.py`, the replay on one model for both arms: 10-10 02:00 → 10-29 00:00 UTC, £600 a venue, no transfers, hedge at
+30 s, 0.45 bps, the £0.10 bot's prints left out.

| arm | book | fills a day | bps a fill | £ a day | days positive | bid off, min a day | ask off, min a day |
|---|---|---|---|---|---|---|---|
| inside | USDT-GBP | 23.6 | 6.22 | 0.996 | 15/19 | 885 | 235 |
| inside | USDC-GBP | 14.0 | 4.65 | 0.441 | 14/19 | 1,139 | 24 |
| behind 10 bps | USDT-GBP | 6.6 | 9.96 | 0.460 | 11/19 | 998 | 155 |
| behind 10 bps | USDC-GBP | 4.7 | 8.32 | 0.265 | 12/19 | 1,006 | 30 |

The earnings rose when the other maker widened from 5 to 12 ticks on 10-13. It was back at 5 ticks on 10-28/29, and was
absent from both books' touch at 02:20 UTC on 10-30.

## 5. The bar

Read per arm and book from `agent_xhedge_days`. Statement:
`select arm, book, day, realised_gbp, fills, trips, bid_blocked, ask_blocked, orders from public.agent_xhedge_days where day >= <S::date> and day < <S::date> + 28 order by arm, book, day;`
- Add a row of zeros for any day with none.
- Run `docs/agents/backtests/mmcomp/scripts/xhedge_reading.py` (its sha below) on that CSV.

**Each arm's USDT-GBP (primary) PASSES** when all three hold:
- its 28-day realised sum > 0;
- the circular 3-day block bootstrap of the daily mean (10,000 resamples, `random.Random(20261030)`) gives
  **P(mean ≤ 0) < 0.10**;
- it has **at least 300 fills** (`inside`) or **at least 100 fills** (`behind`).

USDC-GBP is judged the same way and reported apart. The two arms are judged apart; neither is the other's control. A pass
is the condition for proposing a live design to Davies; it does not arm anything.

**Also reported, not judged:**
- bps a round trip;
- the minutes each side was blocked;
- the other maker's width each day (from `agent_book_levels`, the 5,000-coin orders as MMCOMP measured them);
- Coinbase staleness;
- placements a day;
- the coin's mark (unrealised).

**Competing for the same prints.** The `inside` arm, and any future LIVE change that also rests inside the maker, compete
for the same takers on the same Revolut X book. LIVE runs USDT-GBP alone since 2026-10-29 22:30 UTC, and "Stablecoin quotes
USDC/GBP" (`0180`) rests on USDC-GBP. A paper arm's fills do not take a print from LIVE, but a live version of an arm would.
So the reading states, for each arm and book, which live strategies rested on that book in the window and whether any of
them rested inside the maker. A live design that follows a pass says which book it uses and what it does to the strategy
already on that book.

## 6. What would make the reading void

- The recorders (Revolut X's book and prints, Coinbase's touch) dark for more than 3 of the 28 days, counted as UTC days
  with under 1,200 decided minutes a book. The window is then extended day for day.
- A change to the files in §8 not recorded as a deviation.

## 7. Deviations

Any change to the rule, its numbers, its inputs or the reading is written here as "Deviation n", with:
- the date, the reason and Davies' word where it is his;
- a pin that fails on the old code;
- the files' new sha256.

A fix that only makes the code do what §2 says is a deviation too, with its effect measured on the minutes it touched.

Recorded apart in `2026-10-30-xhedge-deviation.md`: Deviation 1 (the window starts at 2026-10-30 04:20 UTC) and Deviation 2
(two hedges of one key settle as one trip, 2026-10-31; the new sha256 of `xhedge.ts` and `xhedge.test.ts`).

## 8. Frozen files

| file | sha256 |
|---|---|
| `supabase/functions/agents/xhedge.ts` | c62279eb50650e9901ba525c5a1e20379128c6c0d65f7561b1de210118c09d49 |
| `supabase/functions/agents/xhedge.test.ts` | a117703abf82c5da475121e459bdb5170365bd99d89af79a99819553cffaf7f0 |
| `supabase/migrations/0184_xhedge_paper.sql` | 10e73783dc2541c804e7cb8712794bb0aac4a0c8fb1d47a7bc02ef3413b1d1d1 |
| `docs/agents/backtests/mmcomp/scripts/xhedge_reading.py` | bc6509d064c7cb21a23c1e1c648cf2829b7af0f4b93055d0e95d83dda9a94fd2 |
