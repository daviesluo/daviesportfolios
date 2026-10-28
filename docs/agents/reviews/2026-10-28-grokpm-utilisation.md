# GROKPM: are the trades right, why so few, and should money be added? (2026-10-28)

Davies, 2026-10-28: "grok的polymarket策略最佳买卖都做了，你验证下确保都没问题，我感觉这个策略不错就是下的单太少了，用的钱也太少（大部分钱都没用），
你研究下是不是规则太严格了，另外可以补充资金追加投入吗": Grok has made its best buys and sells; check that all are right. The
strategy seems good but too few orders and too little of the money used; is it the rules, and can money be added?

The record runs from the go (2026-10-17 02:39:14 UTC) to 2026-10-28 ~21:30 UTC. Read-only SQL through the Supabase connector
(`grokpm_orders`, `grokpm_fills`, `grokpm_activity`, `grokpm_snapshots`, `grokpm_daily`, `grokpm_decisions`,
`grokpm_shadow_marks`, `grokpm_resolutions`, `grokpm_redeems`, `grokpm_config`), the pre-registration and its §9, the four
earlier GROKPM reviews, and the public tape. **Not blind.** The repository is public: the account's money, share counts,
order prices and its realised P&L are written `[•]`; edges, counts, times, public mids, strategy settings and paper
(replayed) results stay. A paper result that coincides with a real position is a replay of the same bid, not a ledger.

## 1. Headline

- **Every trade was correct.** 24 live orders, 5 fills, 3 positions, all closed or settled. Each obeyed every rule as it stood
  when it was sent; each fill is the venue's own record (same transaction, token, size, price; maker, fee 0); the books tie
  out to the cent; no breach, no stop reached. Nothing inconsistent was found beyond four cosmetic notes (§2.4).
- **Money used is small because there is little to buy, not because the bars are high.**
  - Time-weighted, about 2 % of the budget was deployed since the go and about 10 % since D15 went live (10-26 02:45 UTC);
    the peak was under 15 %, which is D15's own ceiling. None of the nine days before D15 held a position, and 87 % of
    the hours after it held at least one.
  - The agent forms a p on about 6 new markets a day. In 8 days of forecasts 14 markets cleared the category bar (A 8, B 12):
    3 were bought. Of the 11 left, 5 were category-A confirmations in books with no seller (all won, none could be bought) and 6
    were category B: **3 lost, 1 won, 2 are open**. Since D15 went live, every clearing market was bought, was already held
    at its cap, or was a thin 28-hour market that lost.
- **No looser rule is supported by the record.**
  - Bars: A's first forecasts are bimodal (4 over 8 points, none between 5 and 8): lowering A to 5 adds nothing. B's 5 to 8
    band is empty and 8 to 12 holds 7 markets, of which only 2 had a tradable book; replayed on the tape the bars from 12
    down to 5 add at most one open trade each and no resolved one (a 24-hour cut with B 8 adds one small resolved winner).
  - Size: a $10 D15 cap would double the dollars of the same two fills, not the evidence. Widening everything at once
    (B 8, $10, 6 markets, 24 h cut) would have held 2.5 times D15's ceiling at once and could lose more than the
    −$30 total stop.
  - **Recommendation: change no rule now.** The one change worth Davies' word later is a D15 cap of $7.50 in a market
    whose edge is 20 points or more, after BanRep and two more B entries resolve (§4.4).
- **Adding money: not now.** A deposit alone changes nothing (the agent's book is a notional $100 plus its own trades, and
  its caps are code constants). Raising the budget is a new pre-registration (§6 of the pre-registration), and with 3
  entries and 1 resolved it buys dollars, not evidence (§5).

## 2. Verification of every order and fill

### 2.1 What was sent

24 live orders (id 1 is the 10-16 dry-run rehearsal). All are post-only GTD; none was sent while a stop, the pause or the
Ireland check was against it.

| orders | what | result |
|---|---|---|
| 2, 4, 6, 8, 10, 12 | Vertiv Q3 margin 24–26 % Yes, B, D15 | five lapsed at their GTD end (25–30 min), the sixth filled 1 s after placing |
| 3, 5, 7, 9, 11, 13, 14, 15 | BanRep 30 Oct +25 bp Yes, B (D15; 9 and 11 ordinary, §2.2) | seven lapsed, the eighth filled 08:03:47 |
| 16 | BanRep 30 Oct no change No, B, ordinary book | part-filled 12:21:37, the rest lapsed |
| 17 | take-profit SELL, BanRep No, C | filled 10-27 16:14:13, 49 s after placing |
| 18 to 24 | take-profit SELL, BanRep +25 bp Yes, C | seven lapsed at their GTD end, one wake each |
| 25 | the same sell | filled 10-28 16:48:19 |

Buys: 15 orders, 3 fills. Sells: 9 orders, 2 fills. The sells were re-placed at every wake (23–30 min lives; D16 leaves
exits at the next wake plus five). No B buy has been sent since D16 and D17 went live on 10-27, so **D16's 65-minute life has
not been exercised on a real order**.

### 2.2 Rule by rule

| rule | check | result |
|---|---|---|
| post-only, maker, fee | all 24 `post_only`; the 5 fills `taker` false, `fee_usd` 0, `CONFIRMED` | OK |
| fills against the venue | the 5 TRADE items in `grokpm_activity` match the 5 fills by transaction, token, side, size and price; the one REDEEM (Vertiv, 10-28 11:57:47) matches the resolution | OK |
| edge, A 8 / B 12 | on p less the dearer of the order's price and the mid: Vertiv 28 points, BanRep +25 bp 18–19, BanRep no change 16 (orders 2–16 predate V1, so recomputed from the journal row) | OK |
| ¼ Kelly of equity, cap $10 | order 16 sits on its cap to the cent (¼ × (0.65 − price) ÷ (1 − price) × equity = the order's cost); the others are under it | OK |
| price band | all buys between 0.05 and 0.90 | OK |
| D15 terms (11 orders `thin_cap`) | `cut_at` set on all (Vertiv 10-26 09:00 from an `event_at` of 10-28 09:00; BanRep 10-28 00:00 from the end); each bid's life ended before it; cost under min($5, ¼ of the bid depth within 5 points: ¼ of the recorded depth was over $7 in every case, so $5 bound); one bid a market; 2 D15 markets at most at once of 3; far under 100 orders a day (15 the busiest) | OK |
| orders 9 and 11 `thin_cap` false | sent when the market held and rested nothing and its book had $500+ of bids, so the ordinary path applied; the cost stayed at the D15 size | OK by the rules |
| one resting bid a market, ≤ 2 resting | no two orders of one market overlap in time; at most 2 orders rested at once (04:12 to 04:40 on 10-26) | OK |
| cancel-then-replace | every replacement was created after its predecessor's cancel or GTD end (for example 4 at 04:40:40 after 2 at 04:40:26) | OK |
| themes and caps | one theme per market pair (`colombia-banrep-oct`, `vertiv-q3-2026`), at most $25 each; at most 3 positions of 6; cash never near the $30 floor; the day and total stops never reached | OK |
| D17 (since 10-27) | both BanRep outcomes carry the same `neg_risk_market_id`; Vertiv has its own; `checks.event.cost_usd` on orders 17–25 reads the event's cost, so a further BanRep buy would be refused | OK, never triggered |
| journal | every open has p, m, category, sources, a reason and an invalidation; closes carry no p or invalidation, which a close does not need | OK |

### 2.3 Money

- **Positions.** Vertiv: bought, held to resolution, settled at 1 (10-28 11:57:38), redeemed on chain 9 seconds later. BanRep
  no change: bought, sold. BanRep +25 bp: bought, sold. All three closed in profit; the amounts are `[•]`. The agent's
  realised P&L equals its equity less the budget exactly, and equals the independent snapshots' (equity = cash + positions in
  all 3,376 five-minute rows).
- **Daily rows against the snapshots.** 10-17 to 10-25: 0 = 0. 10-26: the row was written from the 23:35 snapshot, 6 cents
  under the 23:55 one (marks moved; well inside the $1 test). 10-27: equal.
- **The prereg's reading** (§6) still has only one resolved entry (Vertiv, p 0.80 against an entry mid of 0.5155, won).

### 2.4 Notes (none is a trade error)

1. The redeem of Vertiv was not ours: no `grokpm_redeems` row since 10-18, and the REDEEM is 9 s after the close, before the
   hourly job. The pUSD arrived. The independent record keeps the redeemed holding as a position at its payout value and leaves
   `cash_usd` without it, by design (`grokpm_rec.ts`: cash is the budget plus TRADE flows); its equity is right and agrees
   with the agent's, so the page does not flag it, but its cash and position columns differ from the agent's by that amount.
2. BanRep +25 bp Yes and no change No are one bet (both win on a hike). Before D17 the agent held both at once, within the
   rules of the day; D17 now stops it.
3. The exit rule (a take-profit a few points under p) sold BanRep No early, and the market has since moved above the sale.
   BanRep resolves 10-30, so whether the exits cost or saved money is open.
4. The shared wallet holds other positions of Davies' own, including a buy of 10-17 03:35 UTC (56 minutes after the go) that
   no GROKPM fill matches. By D2.3 the record counts only the agent's fills, so it does not touch this test.

## 3. Why so few orders, and so little money used

### 3.1 How much was used

| | hours with a position | average cost held, % of the budget | peak |
|---|---|---|---|
| 10-17 to 10-25 | 0 % | 0 % | none |
| 10-26 (D15's first day) | most of it | 9 % | under 15 % |
| 10-27 | all of it | 13 % | under 15 % |
| 10-28 so far | most of it | 6 % | 9–10 % |
| since the go | 20 % | 2 % | under 15 % |
| since D15 | 87 % | 10 % | under 15 % |

The ceiling the rules leave is low by construction: D15 holds a thin B market to $5 and 3 of them at once, so $15 (15 %) is
all a thin book can ever take. The ordinary path ($10 a market, 6 markets, ¼ Kelly) has been used once, for part of one order.
The agent's cash is 85–100 % of its equity at every hour.

### 3.2 The funnel

Every row is a market the agent put a p on. "Clear" = p less m at or over the category's bar (A 8, B 12). "Book" = a
recorded book (kept from 10-24 08:12). "Tight" = two-sided, spread 5 points or under. "48 h" = D15's cut is still ahead.
"Deep" = $500 of bids within 5 points (the ordinary path). (`sql/funnel.sql`)

| UTC day | rows | markets | clear rows (markets) | with a book | tight | tight, B | tight, B, 48 h | deep | orders sent |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 10-20 | 26 | 2 | 0 | | | | | | 0 |
| 10-21 | 102 | 4 | 2 (1) | 0 | 0 | 0 | 0 | 0 | 0 |
| 10-22 | 123 | 7 | 17 (3) | 0 | 0 | 0 | 0 | 0 | 0 |
| 10-23 | 45 | 13 | 0 | | | | | | 0 |
| 10-24 | 85 | 17 | 27 (5) | 19 | 1 | 0 | 0 | 0 | 0 |
| 10-25 | 69 | 18 | 12 (5) | 12 | 8 | 8 | 8 | 0 | 0 (D15 not yet live) |
| 10-26 | 79 | 12 | 28 (3) | 25 | 21 | 21 | 19 | 2 | 15 (D15 live from 02:45) |
| 10-27 | 48 | 8 | 14 (4) | 14 | 8 | 8 | 2 | 0 | 2 (sells) |
| 10-28 | 42 | 9 | 3 (1) | 3 | 0 | 0 | 0 | 0 | 7 (sells) |

Reading it:
- **Before 10-24 no clearing row had a usable book.** They were the category-A confirmations (Tesla, two quake days, US gas) and
  B markets ending within two days. The books were empty or one-sided because the outcome was already known: the last
  trade before the agent looked was 0.97–0.999, and the "gap" of 33–43 points was to the midpoint of a stale bid and a 0.99
  ask. No one sells into that. (The 10-23 study found the same.)
- **10-25 had 8 tight B rows and no order**: D15 was not live yet (the thin-rule study of 10-26 led to it).
- **From 10-26 02:45 the funnel narrows to the candidate supply.** The three markets that cleared on 10-26 were all bid.
  On 10-27 the four that cleared were: the three markets already held (Vertiv at D15's $5; the two BanRep outcomes
  under D17's one event cap) and one thin 28-hour market (no one dissents at the FOMC: spread 6 points, $22 of bids; it resolved against the agent). On
  10-28 the one clearing market was Vertiv, settled that morning.
- **The server has refused no real order since the go.** The one order refusal in `grokpm_requests` is the 10-16 dry run's
  longshot; the 74 other non-200 answers are malformed reads, future-dated rows, two wrong regions and one duplicate id. The
  gates are applied by the agent before it sends, and checked against the server's rules it left no eligible row unbid: all 21
  tight B rows with 48 hours to the cut on 10-26 and 10-27 belong to the three markets it bid or already held.
- **So each gate is not the problem on its own; the fraction that gets through is.** About 6 markets a day get a p; about 30 %
  of them clear a bar at some row; most of those are confirmations in dead books (A) or short-dated.

### 3.3 The 14 markets that cleared a bar, and what stopped the 11 not bought

(first clearing row; outcome of the token the agent priced; `sql/rows.sql` and the tape)

| market | cat | first clear | book at the time | stopper | outcome |
|---|---|---|---|---|---|
| Tesla beats Q3 EPS | A | 10-21 20:18 | one-sided, last trade 0.999 | thin (emptied book) | won |
| Biggest quake 21 Oct 5.3–5.4 | A | 10-22 08:08 | 0.012 / 0.99 | thin | won |
| US gas 22 Oct bracket | A | 10-22 12:14 | 0.26 / 0.995 | thin | won |
| UMich Oct 43.0–45.9 | B | 10-22 20:21 | none recorded; ends in 17 h | D15's 48 h cut (not yet live) | **lost** |
| US gas hits $4.30 (week) | B | 10-24 00:13 | none then; 0.06 / 0.72 at 08:12 | thin (spread) | **lost** |
| Biggest quake 23 Oct | A | 10-24 03:08 | none; last trade 0.76 | thin | won |
| SpaceX under 14 launches | B | 10-24 08:44 | 0.68 / 0.99 | thin (spread) | open, the token is up since |
| Canada Aug GDP 0.2–0.3 % | B | 10-24 12:12 | none recorded | thin; Grok then re-assessed it down | open |
| Biggest quake 24 Oct | A | 10-24 14:13 | 0.73 / 0.998 | thin | won |
| South Korea Q3 GDP 3.0–3.4 % | B | 10-25 00:17 | **0.26 / 0.27** | D15 not live | **won** (the one miss) |
| Vertiv 24–26 % | B | 10-25 04:10 | 0.514 / 0.548 | bought 10-26 (D15 live) | won |
| BanRep +25 bp | B | 10-25 20:09 | 0.30 / 0.33 | bought 10-26 | open (sold) |
| BanRep no change | B | 10-25 20:09 | 0.42 / 0.45 | bought 10-26 | open (sold) |
| No one dissents at the FOMC | B | 10-27 12:19 | 0.10 / 0.16 | thin (spread 6) | **lost** |

Untraded category B: 3 lost, 1 won (Korea), 2 open. Bought at the mid and held to the end with $5 each, the four
resolved ones net to about −$1 on $20 (paper; a fill at the mid is what the tape rarely gave): **the thin and spread rule,
with D15's cut, kept out more losses than wins.** The A winners were real, but no one was selling.

## 4. Would looser rules have done better?

### 4.1 Method, and what it cannot say

- **Edge source.** Every candidate's p is Grok's own, formed before the price. The test is whether p adds to m, and it has
  few resolutions to say so (below).
- **Replay** (`scripts/study.py`; inputs `data/rows.txt` from `sql/rows.sql`, `data/public.json.gz` from `scripts/fetch.py`):
  at each journaled row, a rule set bids if the row passes its gates (edge on the book's mid, price band, a two-sided
  book of spread 5 points or under, D15's terms or the ordinary $500 depth, D17's event cap, at most N D15 markets, the cut);
  the bid sits at the mid rounded down to half a cent; size is ¼ Kelly of $100 within the cap and at least the venue's 5 shares;
  a fill is a public taker print at or through the bid (selling the token at it or under, or buying the other outcome at
  1 minus it or over); held to payout, else marked at Gamma's price at the read. Two lives: **wake** (one 65-minute bid: a
  floor, since the agent re-prices and re-places) and **rest** (the bid follows the agent's rows while its p still clears the bar, to
  the cut: close to what it did).
- **Validation.** Run as D15 ran (V0), the replay fills Vertiv and BanRep +25 bp within one minute of the real fills and
  within one share; it adds one bid the agent did not make (BanRep No at 04:13, part-filled). Where the depth was not kept
  (before 10-26 03:10) the replay assumes the cap is met, and it ignores the queue ahead of a bid: both err generous.
- **Window.** 10-24 08:12 UTC (the first recorded book) to now: 23 of the 47 forecast markets had a two-sided book of spread
  5 points or under at some row, and 5 of those cleared a bar on that row (4 B and one A whose m was stale). The replay holds
  the 12 markets whose p cleared 5 points over the book's mid on a tight row. Earlier rows have no book and cannot be replayed
  (the earlier studies did the 42 and the 19).

### 4.2 Is Grok's p good enough in the added band? (first forecast of each market; `sql/bands.sql`)

| edge p − m | markets | resolved | won | mean p / m (resolved) | Brier p / m | paper P&L per share at m |
|---|---:|---:|---:|---|---|---:|
| 12 points or more | 9 | 6 | 5 | 0.76 / 0.49 | 0.109 / 0.229 | +2.08 |
| 8 to 12 | 8 | 4 | 3 | 0.74 / 0.64 | 0.071 / 0.087 | +0.44 |
| 5 to 8 | 0 | | | | | |
| 0 to 5 | 13 | 7 | 7 | 0.86 / 0.84 | 0.040 / 0.051 | +1.15 |
| under 0 | 17 | 13 | 12 | 0.93 / 0.94 | 0.005 / 0.005 | −0.18 |

Category B alone: 12 points or more, 3 resolved of 6 (2 won), Brier 0.217 / 0.288; 8 to 12, 3 resolved of 7 (2 won), 0.094 / 0.110.
Category A: the four over 8 points all won; the 5-to-8 band is empty. **Reading:** in both bands the agent's p beat the market's
mid, and the winners outnumber the losers; but 3 resolved forecasts a band is not a calibration, the paper P&L assumes a fill
at the mid that the tape rarely gave, and the 8-to-12 band is mostly markets with no tradable book. The edge, if it exists, is
real money only where a bid can rest at the mid and be hit, which is the tape's question (§4.3).

### 4.3 Rule sets, replayed

"Fills" and "cost" are for the rest life; "added" is against K0r (the current rules, had they been live from 10-24).

| rule set | bids | fills | most held at once (% of budget) | what it adds over K0r | worst case if all lost |
|---|---:|---:|---:|---|---|
| K0 as run, D15 live 10-26 | 2 | 2 | 6 % | | 6 % |
| **K0r current rules from 10-24** | 3 | 2 | 11 % | (the base: Vertiv, BanRep +25 bp) | 11 % |
| K1 B 10 | 3 | 2 | 11 % | nothing | |
| K2 B 8 | 4 | 3 | 16 % | Core PCE No (open, about +0.4 on paper so far) | 16 % |
| K3 B 6 | 4 | 3 | 16 % | the same | 16 % |
| K4 B 5 | 4 | 3 | 14 % | Core PCE No and the Indonesia quake No (open, small paper gains); the 3-market cap then displaces BanRep +25 bp | 14 % |
| K5 D15 cap $10 | 3 | 2 | 23 % | the same two trades, twice the dollars | 23 % |
| K6 D15 markets 6 | 3 | 2 | 11 % | nothing | |
| K7 cut 24 h / K8 no cut | 3 | 2 | 11 % | nothing | |
| K9 B 8 + $10 + 6 markets + cut 24 h | 5 | 4 | **38 %** | the 13-quake count (won, about +1 on paper; only the 24 h cut admits it), Core PCE, and doubled sizes of the same trades | **38 % (past the 30 % total stop)** |

The "wake" life (one 65-minute bid) fills 0 or 1 in every set: a bid that is not re-placed at the market's new mid does not
get hit while the market moves toward p.

What the replay shows:
- **Bars.** B at 10, 8, 6 or 5 adds one open, unresolved trade at most, because the replayable books are few. The B 8–12 band's
  winners (HOOD, 13 quakes) had either no book recorded or a book that could not take a bid inside the 48 h cut (the 13-quake
  count ended in 40 hours); the loser (UMich 43–45.9) ended in 17 hours. **A at 5 adds nothing**: A's edges are over 8 points or under 5.
- **Korea 3.0–3.4 %**, the one tradable winner left out, is not recovered by any bar in the replay: a bid at the mid never
  traded, because the market moved toward p within hours. The only way to catch it is to bid at the ask (a taker), which the rules forbid.
- **Cap and markets.** More D15 markets or a longer window change nothing here: there were never more than two live
  candidates. A $10 cap doubles the same trades' dollars and their loss.
- **Concentration.** At B 8 with $10 and 6 markets the book would have held 38 % of the budget in four positions at once; had
  they lost together, the loss would have passed the −$30 total stop (30 %).

### 4.4 Recommendation

**No rule change is supported yet.** The evidence a change needs (resolved real entries, calibration in the added band) does
not exist: 1 resolved real entry; 3 to 4 resolved forecasts a band; the replay's added trades are 0 to 2, one of them resolved.
Specifically:
1. **Keep A 8 and B 12.** They are not what stops orders (A: bimodal edges; B: the 8–12 band's tradable markets are 2).
2. **Keep the thin and spread rule and D15's cut.** The untraded B markets it stopped: 3 lost to 1 won.
3. **Supply is the lever, and it needs no rule.** More forecasts on tight-book far B markets (5 to 30 days), chosen by title
   before the price (C-005, D11): 23 of the 47 markets had a tight book at some row, 5 cleared a bar, and 3 of those were
   bought. Nothing here is a rule.
4. **The one change to keep in mind, later:** a D15 cap of **$7.50** (from $5) when the edge is **20 points or more**, 3 markets
   at once, still $22.50 at the ceiling. Evidence so far: Vertiv (the only entry over 20 points: 28, ¼ Kelly about three times the
   cap) won, and the BanRep entries (16–19 points) were sold in profit, but all three are in-sample and one has resolved. Take it up after BanRep (10-30) and two more B
   entries resolve, and only if p still beats m on them.

## 5. Adding money

### 5.1 What the pre-registration says

- §0 and §2: the budget is **$100**; the day stop is −$10; the total stop is −$30 (a FAIL, close-only). The per-market $10,
  theme $25, cash floor $30 and D15's $5 are in the code (`GROKPM_RULES`), not in the config.
- §3: the test ends at the first of **28 days** (00:00 UTC on **11-14**), the **40th resolved position**, or the total stop. With
  3 entries in 12 days the 40 will not be reached: the end is 11-14.
- §6: "A continuation with more money is a new pre-registration." §8: "Deposits after the start: FUNDED is $100; a later deposit
  or withdrawal needs a migration moving `funded_usd`, and the reading names it."
- D2.3: the agent's equity is the **$100 budget plus its own trades' cash flows**. The shared wallet's pUSD, and Davies' other
  holdings in it, never count.

### 5.2 What money does and does not do here

- **A deposit into the wallet changes nothing by itself.** The agent's cash, Kelly, caps, stops and P&L read the notional book,
  not the wallet. The wallet already holds pUSD `[•]` above the agent's book, and none of the 1,982 requests since the first was refused for funds.
- **Raising `grokpm_config.funded_usd` does change things:** equity (and so ¼ Kelly's base), the cash the floor reads, and the
  baseline of P&L. The stops are absolute dollars in the same table (`daily_loss_usd`, `total_stop_usd`); the $10, $25, $30 and
  D15's $5 are constants, so a proportional scale-up needs a code change, its tests and a deploy, not just a migration.
- **It would not raise the number of orders.** Candidates, not dollars, are the limit (§3): at $200 with the caps left alone,
  the same 3 positions would be the same size and over 90 % of the money would be idle; with the caps doubled, the same 3
  positions are twice the dollars.
- **It does not speed the evidence.** Brier, the sign of P&L and the count of resolved entries do not depend on size.

### 5.3 How it would be a deviation, and how it changes the reading

Draft (only on Davies' word): **D18**, a new budget `B'` from a stated UTC time, a migration moving `funded_usd` (and, to keep
risk proportional, `daily_loss_usd` and `total_stop_usd`, and the code's caps scaled by the same factor). The reading then:
- is run as written on **return on capital, not on dollars**: P&L is the sum of positions' P&L; the sign test and Brier are
  unchanged;
- states the −$30 total stop as a share of the budget at each date (−30 % of $100, then −15 % of $200 unless scaled);
- marks which entries were opened before and after D18.

A scale-up part-way through is a change to the thing being tested (the stakes), and §6 says a continuation with more money is
a **new** pre-registration. The cleanest reading is to finish this one on 11-14 at $100 and register the next with the money.

### 5.4 Practical steps for Davies (we never move money)

1. Deposit into the same Polymarket account on polymarket.com himself. The account trades pUSD; if the deposit arrives as USDC
   or USDC.e, say so (the recorder reads all three balances). Nothing else changes, and no GROKPM setting reads the deposit.
2. Tell Claude the amount and the factor in the conversation. Claude records D18, writes the migration that moves
   `grokpm_config.funded_usd`, `daily_loss_usd` and `total_stop_usd`, scales the code constants, pins them in the Edge tests,
   lands them after `sh bin/gates.sh`, and posts the request to Grok on the desk ledger.
3. Grok sees the new numbers on `?action=account`; nothing is armed or disarmed by this.

### 5.5 Recommendation

**Do not add money now.** The binding limit is the supply of tradable edges (§3), so money would sit idle or be put to work
at larger sizes on 3 positions and one resolution. The strategy has paid, and the replay's looser rules would not have paid
more on this evidence. Add after the 11-14 reading, if both of the pre-registration's conditions hold (total P&L over 0 and
Brier_agent under Brier_market on the resolved positions) and if the resolved real entries have reached about 10: then
register a second test with **at most twice the budget** ($200), the caps and stops scaled by two, and the same bars. With
fewer than about 10 resolved the reading cannot carry the decision either way; extend the test at $100 instead. If Davies
wants to add sooner, do it as D18 above at a factor of 2, not more, and not before BanRep resolves on 10-30.

## 6. Limits

- Resolved real entries: 1 (Vertiv). Resolved forecasts: 30 of 47 markets, 4 to 7 a band. Every number above is small.
- The replay inherits Grok's p and the row cadence (a row only when p changes or the mid moves 3 points), the tape's 500 newest
  takers' prints a market back to 10-24, and the assumption that a taker print at or through a bid fills it for its size.
- Books are read at the minute of the forecast; the depth column exists from 10-26 03:10 only.
- The funnel's "usable book" counts rows, not independent opportunities; the 14 markets are the independent ones.
- Nothing here changes a rule, a config or the desk ledger.

## 7. The SQL and the files (read-only, 2026-10-28 ~21:30 UTC)

- `backtests/grokpm_util/sql/funnel.sql`, `bands.sql`, `rows.sql`: the three read-only queries (the order, fill, activity,
  snapshot, daily, resolution, redeem and config reads of §2 are one-line selects over the tables named at the top).
- `data/rows.txt` (the twelve markets' rows, copied by hand from `rows.sql`), `data/markets.json`, `data/public.json.gz`
  (`scripts/fetch.py`), `scripts/study.py`, `results/study.txt`; `MANIFEST.json` holds their sha256.
