# LP-CAPINV: live-prep's total cap full of carried inventory

Research only (2026-10-11, read 00:05–00:25 UTC). No live path, config or migration changed; every database read was a
read-only `select`; no order was placed or cancelled. SQL in `docs/agents/backtests/lpcapinv/sql/`, each output in
`results/`. Not blind: every record read here had been read before. Nothing here is applied: Davies decides.

**The problem, as found at 00:03 UTC.** All BUYs of today's ten markets were withheld by `cap_total` ("321.13 USD would
pass the cap of 321"). Held inventory was about $250 across 16 markets, 15 of them not in today's selection. Code read:
`pm_live.ts` sha256 `59a1201a…a510` (Addendum 14) and `pm_lp.ts` `277baa7a…e8cb` (Addendum 15), both unchanged since.

## Verdict

- **The cap is a cash rule in disguise.** `committed` = held at cost + unredeemed + resting buys. The cap is
  floor(pUSD + held at cost + unredeemed − 80). The holdings sit on both sides, so the rule is: **resting buys ≤
  pUSD − $80**.
  - At 00:06 that left $69 of buys. At 00:15, after four more fills in today's markets, it left $36.
  - Counting holdings at mid instead of cost changes the budget by $1.33 (cost $251.11, mid $249.78).
  - Taking carried holdings out of the BUY cap, or raising the cap, can add **at most $80**. The collateral check
    (`usd > pusdLeft`) stops every buy at pUSD whatever the cap says.
- **96 % of the inventory is carried and earns nothing.** Carried means at cost $240.51 ($239.18 at mid) of $251.11.
  Polymarket paid $0.336 of 10-10's $21.89 to the markets carried from 10-09. Their one-sided sells score 0 on RW's
  formula and about nothing in fact.
- **The budget goes in condition-id order, not by rank.** The loop sorts the wanted buys by slot key
  (`pm_live.ts:2439`, `localeCompare`), funding each in turn until one does not fit.
  - At 00:15 it funded one two-sided market (rank 2) and single YES buys in ranks 8, 9 and 10. RW's formula scores
    those single buys 0, and they still carry the fill risk.
  - Rank 1 (rate 300) had both buys withheld at 00:06. At 00:15 it rested none; it had bought 40 YES at 00:13–00:14.
- **Carried inventory unwinds slowly, at about the mid.**
  - Of the $179.87 carried at the 10-10 day roll, 59 % was still held 24 hours later: a half-life of 31 h if
    exponential. The real shape is bimodal: three markets sold 43–94 %, four sold 0–16 %.
  - The 29 carried sells filled +1.56 ¢ a share over the mid, +0.04 ¢ at 60 minutes and −2.17 ¢ at 6 hours (16
    fills).
  - Two carried markets in one-tick books rest **no exit at all**, because TB1's skip empties the close-only rule.
    That is a defect.
- **Recommendation (one rule, below): fund whole markets in rank order.** It adds no dollar of exposure.
  - On today's first 20 minutes it funds 63.4 % of the formula weight two-sided, against 49.2 %.
  - Central estimate: about +$4 a day paid at R 0.807; about +$9 at 10-10's top-3 realisation.
  - It is not the big lever. The big levers (+$80 of budget, or selling carried stock across the spread) are each
    priced below, and neither is proposed now.

## 1. How `cap_total` counts

From the code (`pm_live.ts`, the caps after "the caps, on what would rest after this turn"):

- **Holdings, at average cost, in every market.** Every token the CONFIRMED fills hold is counted at held × average
  cost (`tokenBooks`), whether or not its market is selected today.
  - Unselected markets count in the total, with no per-market cap.
  - A token in today's markets held beyond what its fills explain is counted at $1 a share.
  - A settled market's unredeemed tokens are counted at their payout.
- **Resting buys' collateral.** These are counted:
  - every buy this turn cannot touch (pending, cancel asked, unread);
  - every live buy being cancelled or re-priced (`leaving`), until the cancel is read back;
  - each new wanted BUY, at price × size.
  Sells are not counted, because tokens back them.
- **The cap** is `lpCapital`: floor(equity at cost − $75 − $5), where equity = pUSD + held at cost + unredeemed. A
  fall applies at once; a rise needs two agreeing readings.
- **Closed form.** Equity and committed share their holdings, so:
  - cap − committed = pUSD − 80 − (resting buys) − (the floor's cents).
  - Checked at 00:06: equity 402.574975 = pUSD 150.843737 + held 251.73; cap 321 (target 322); committed 316.53.
  - Resting buys were therefore $64.80, against a budget of $69.27.
- **How it moved** (`cap_minutes.sql`, `cap_hourly.sql`; the turn's withheld list is not stored per minute, so the
  cap is rebuilt from the deposit, realised P&L and the payouts, and a wanted BUY counts as withheld when committed +
  its cost passes the cap):

| day | minutes | minutes with a BUY capped | quote market-minutes capped | formula lost to the cap | lost to other missing sides | cap |
|---|---|---|---|---|---|---|
| 10-09 | 1,347 | 0 | 0 of 12,586 | $0 | $11.81 | 320–322 |
| 10-10 | 1,349 | 212 | 355 of 6,247 | $2.95 (×0.807 = $2.38) | $5.18 | 296–334 |
| 10-11 to 00:12 | 12 | 12 | 92 of 114 | $0.26 | — | 299–322 |

- **On 10-09 the cap never bound.** Mean headroom was $75.
- **On 10-10 it bound at 00:00–01:15**, with yesterday's ten plus the new ten, and again from 15:00 after the refill.
- **The budget for buys over 10-10:**
  - $95–170 through the day;
  - $99 at 15:00, $84 at 17:00, $56 at 19:00 and $50 at 20:00, as the refills' fills turned pUSD into held stock;
  - at 10-11 00:xx, $54 on average.
- **What the withholding cost.** 33 resting buys were cancelled for `cap_total` on 10-10, and 7 more by 00:15 on
  10-11. On 10-10 its formula cost was small, $2.95, because most slots were out by the reward check anyway. Today it
  binds from the first minute.

## 2. What happens to carried inventory

- **What rests.** A carried market is close-only. Its sell rests at RW's ask, one tick inside the best ask (or
  m + tick/2), for at most N = 20 shares (`closeOnly(rule(…))`).
  - At 00:15, eleven carried tokens had a sell resting (`holdings.txt`).
  - Anthropic's 111.53 YES offered 20 at 0.53 against a mid of 0.505. Citigroup's offered 20 at 0.84 against 0.83.
    PLD's NO offered 20 at 0.83 against 0.745.
- **Two carried holdings rest nothing.**
  - `lpQuotes` returns no quote in a book one tick wide (TB1's skip), so `closeOnly` has nothing to turn into a sell.
  - `0x5fec6675` (40.27 YES, $18.73) was in a one-tick book for 1,430 of its 1,454 carried minutes, with a sell in only
    25. `0xd5734dd2` (20 YES) has rested nothing for 14 of 14 minutes.
  - Six tokens held under the 5-share minimum ($8.60 at mid) can never be sold by an order. They wait for
    resolution.
- **How fast it unwinds** (`carried_unwind.sql`). Take the 10-10 day-roll cohort (the 10-09 selection, $179.87 at
  mid):

| market | $ at mid at 10-10 00:00 | still held at 24 h |
|---|---|---|
| `0x045fdf4b` | $44.91 | 6 % |
| `0xa326c49f` | $17.93 | 11 % |
| `0x9235351e` | $33.81 | 57 % |
| `0x5b3350e2` (Anthropic) | $61.90 | 100 % (sell resting 1,294 minutes, mid falling) |
| `0x5fec6675` | $18.93 | 100 % (no sell: one-tick book) |
| `0xf0503539` | $0.46 | 100 % |
| `0xecc209a6` | $1.93 | 84 % |

  - Dollar-weighted, 59 % remains after 24 h: a 31 h half-life.
  - Some 10-10 markets taken out during the day went faster: `0xac42f143` was gone in 6 h, `0x0477b4ad` in 3 h and
    `0x31e2f3df` in 6 h.
- **What unwinding cost** (`fills_state.sql`, 219 fills):
  - Carried sells: 29 fills, 428 shares, $168.86, sold +1.56 ¢ a share above the mid. That is +$6.69 against the mid.
    The markout was +0.04 ¢ at 60 minutes and −2.17 ¢ at 6 h (16 fills).
  - So passive unwinding has cost nothing against the mid.
  - Selling everything carried now at the best bid would cost **$10.66** on the $230.82 that can be sold (4.6 %, 1.95 ¢
    a share, top of book only), plus $0.72 on the dust that cannot (`cross_cost.sql`).
- **Does the exit-on-fill study still apply?** That study (`backtests/rwexit/`, RW's 2,665 paper fills) found:
  - Selling a fill at once lost $1,644.69 against $568.72 for holding to the end: −3.3 ¢ a share, mostly the move just
    after the fill.
  - From 240 minutes on, holding gained only +$96.55 on 32,865 shares (+0.3 ¢ a share).
  - Carried inventory is past that window. Crossing it costs about the half-spread (1.95 ¢ now) against a +0.3 ¢
    expected recovery: the sign of the study holds, but the price is about 1.7 ¢ a share, not 3.3 ¢.
  - Unlike a fresh fill, carried stock earns no reward (above) and is binary risk with no hedge.
    - Citigroup (`0x225b0d56`, $51.18 at mid) and `0xbfb4f78b` resolve 10-13.
    - PLD (`0xc50683fa`, `0x89067ac9`) resolves 10-15.

## 3. The options, priced

**Method.** `alloc_replay.sql` replays every live minute's budget (cap − held at cost) against what today's markets in
'quote' wanted, at the minute's touch, with a side that can sell held stock costing nothing:

- The turn's order (slot key, each BUY funded if it fits) beside whole markets in rank order.
- At the live budget, and at +$80.
- The minute's real fills and holdings are kept as recorded. So this prices the allocation, not what it would then
  have bought.

The cap bound in 169 minutes of 10-10 and in all 20 of 10-11 so far. On 10-10 rank order changes little (99.06 → 100.04
of 106.70 weight).

**Converting today's weight into dollars.** Today's 20 minutes carry 5.16 of the selection's formula, 371.5 a day.

- On 10-10, the first day with the reward check, a quoting minute earned 0.170 of the selection's formula
  (`realisation.sql`). That is 0.378 for the top three ranks and 0.099 for the rest.
- On 10-10 after the refill, slots were in 'quote' about 55 % of the time (5.5 of 10 on average, 15:00–23:00).
- At the live R 0.807, everything funded all day is worth about $28.0 a day paid. The table scales from that. At the
  top-3 realisation every figure is about 2.2 times as large.

| option | budget for buys | today's weight funded two-sided | paid a day (central) | vs (a) | cost / risk it adds |
|---|---|---|---|---|---|
| (a) as is | pUSD − 80: $36–69 now | 49.2 % | $13.8 | — | — |
| (c1) carried at mid, not cost | +$1.33 | ≈49 % | $13.8 | ≈0 | none |
| (c2) carried out of the BUY cap, or (d) the cap raised to the equity | +$80, capped by pUSD | 88.8 % | $24.9 | +$11.1 | +$80 of resting buys and the fills that come with them; the $80 of pUSD kept free goes to $0; LP-REFILL / LP-ALLOC found more capital lowers the net on every refill setting ($400: $15.19 against $17.86 at $300), because it buys inventory, not reward |
| (c2)/(d) + rank order | +$80 | 93.0 % | $26.1 | +$12.3 | as above |
| (b) carried sold across the spread at the roll | +$231 | ≈100 % | $28.0 | +$14.2 | −$10.66 now, and about 4.6 % of each roll's carried stock; needs a marketable (not post-only) order path; cuts binary risk; net central about +$3.5 a day, and negative if the freed budget is spent on inventory as LP-REFILL predicts |
| (b′) carried sells as now, but resting in one-tick books too | slow | — | small | — | about 0 (sells at the touch filled +1.56 ¢ over the mid); fixes the 2 holdings with no exit |
| (e) fewer markets at 00:00 | — | about the rank-order row | — | about +$4 | fewer slots to refill; not measured apart |
| **(f) whole markets in rank order** | unchanged | **63.4 %** | **$17.7** | **+$3.9** | **none in dollars; no one-sided buys** |

## 4. Proposal (not applied): the cap funds whole markets in rank order

**The rule.** In a live-prep turn, the wanted BUYs are funded against `cap_total`, `cap_market` and the collateral
check in today's rank order:

- `pm_lp_markets.rank`: the 00:00 picks 1–10, refills by their reserve rank, 11–20. Ties go by condition id.
- A market's wanted BUYs (one or two) are funded together or not at all. If both do not fit, neither rests, and the
  next market in rank order is tried.
- Sells are unchanged, and so is every carried market.
- No number changes: the cap, the $80, the collateral check, N, 5N and the loss guard all stay.
- Mini-pool and mid-pool keep the slot-key order.

**What it adds.** No dollar of exposure: the same cap and the same pUSD. It concentrates the budget in the top ranks,
which on 10-10 earned 0.378 of their selection's formula against 0.099 for the rest. It removes one-sided buys: 25
market-minutes of 177 in today's first 20 minutes, and 37 on 10-10.

**What it is worth.** On today's first 20 minutes, 63.4 % of the formula weight funded against 49.2 %.

- About +$3.9 a day paid at the central realisation, and about +$9 at the top-3 one.
- The share falls through the day for every option, as today's fills turn pUSD into held stock.
- 20 minutes is a short sample. The 10-10 replay barely moves (+0.98 of 106.70), because the cap bound only 169
  minutes there.

**What it does not do.** It does not free the $239 carried. That needs either more budget, (c2)/(d), which the capital
studies say does not pay, or an exit priced to fill, (b), which pays about a half-spread a share for capital the
simulators say mostly buys more inventory. Both are Davies' call on risk, and neither is proposed on this record.

**Separately, a defect to fix with a pin test whatever he decides.** A carried market whose book is one tick wide rests
no sell, because TB1's skip runs before `closeOnly`. TB1 is a reward-quote rule. An exit at the touch in such a book is
what the carried path means to rest.

**Forward test, if taken.** Over the first three live days, from `pm_lp_minutes`:

- the share of today's formula weight quoted two-sided;
- the number of one-sided buy-minutes;
- the formula a day against 10-10's $30.34.

## Not checked

- Fills under each allocation. The replay keeps the recorded fills, so rank order's effect on what gets bought is not
  priced.
- Depth behind the best bid for the crossing cost, so $10.66 is a floor.
- Polymarket's own one-sided score, about a third of a two-sided one inside 0.10–0.90. RW's formula counts it 0, so
  what one-sided buys earned in fact is not credited here.
- Re-selecting carried markets whose programme still pays (`0x5e96323f` rate 88, `0x191e066d` 50, `0xd5734dd2` 47 on
  Gamma at about 23:30 on 10-10; $50 at mid of the $239). Quoting them would use held stock as the free side.
- Any simulator run. This is the live record, about 47 hours long, and today's 20 minutes are the only ones under the
  present state.
