# GROKPM's first orders, verified end to end (2026-10-27)

Davies, 2026-10-27: "Polymarket analyst下了几单，你也仔细验证下并且也看看有没有什么可以优化的地方": the Polymarket analyst
has placed a few orders; verify them carefully, and look for anything to improve.

The record runs from D15's go (10-26 ~02:45 UTC) to 10-27 03:10 UTC:
- 15 orders, all post-only BUYs of category B;
- 3 fills, in Vertiv Q3 margin 24–26 % Yes, BanRep +25 bp Yes and BanRep no-change No.

Read-only SQL (`grokpm_orders`, `grokpm_decisions`, `grokpm_fills`, `grokpm_entries`, `grokpm_snapshots`,
`grokpm_activity`, `ops_errors`). **Not blind.** The repository is public: the account's money, share counts and order
prices are written `[•]`; edges, counts, times and public mids stay.

## 1. Verification

| order(s) | market | path | checks | result |
|---|---|---|---|---|
| 2, 4, 6, 8, 10 | Vertiv 24–26 % Yes | D15 | edge 28 pts on max(bid, mid); cost under min($5, ¼ depth); one bid; 1 of 3 markets; whole life before the cut (10-26 09:00, 48 h before the `event_at` the cut implies, 10-28 09:00; the end is 10-28 13:30) | **OK**: expired at its GTD end and re-placed the next wake, no fill |
| 12 | Vertiv 24–26 % Yes | D15 | as above | **OK**: filled in full 1 s after placing, maker, fee 0, CONFIRMED with its transaction. Booked at cost; the record's entry mid 0.5155 |
| 3, 5, 7, 13, 14 | BanRep +25 bp Yes | D15 | edge 18–19 pts; cut 10-28 00:00 (48 h before the end, 10-30 00:00) | **OK**: expired, re-placed |
| 9, 11 | BanRep +25 bp Yes | ordinary | sent with `thin_cap` false at the D15 size. At 05:40:20 the market held nothing and rested nothing (order 7 was cancelled at 05:40:18), so it was not a D15 market. A book of $500+ within 5 points then takes the ordinary path. | **OK by the rules**, but the book that decided it was not recorded. V1 records it now |
| 15 | BanRep +25 bp Yes | D15 | as 3–14 | **OK**: filled in full at 08:03:47, inside its GTD life; the mid was 0.475 a minute later, so the fill was not adverse |
| 16 | BanRep no change, No | ordinary (book $522) | edge 16 pts; under $10; theme "colombia-banrep-oct", the same as the +25 bp market's, so the $25 theme cap holds the pair together | **OK**: partly filled (a part of the order), the rest cancelled at its GTD end |

**Booking** (`ledgerOf`, the recorder's snapshot, the data API's positions):
- Cash is the budget less the three fills' cost, to the cent. Three positions at their fills' sizes, marked at the books'
  mids.
- The recorder's 3 TRADE activity items match the 3 fills by transaction and token.
- `grokpm_entries` holds each token once, with its first-seen mid.
- No server, record or redemption error since the go, beyond one balance read that timed out (information only).

**D15's terms, against the record:**
- At most 2 D15 markets were open at once, against a limit of 3.
- Never two bids in one market.
- No D15 bid lived past its cut.
- The Vertiv market is D15 while held, so any further buy there stays within $5. So is BanRep +25 bp, which has no room
  left.

**What could not be checked, and why:**
- The `event_at` Grok sent is not stored; the cuts imply it (Vertiv: 10-28 09:00; BanRep: none, or after the end).
- The book each order was judged on is not stored. That book is what told D15 from ordinary (orders 9 and 11).
- V1 below stores both.

## 2. Fixes made (no rule changed), pinned

| # | what | where | pin |
|---|---|---|---|
| V1 | Each order keeps the `event_at` it was sent and `checks`: what the server read and computed for it. That is the book (best bid and ask, mid, spread, the dollars of bids and asks within 5 points), the edge on max(price, mid), the order's and the market's cost, the quarter-Kelly cap, and for D15 its cap and cut. The account answer shows each open order's `event_at`. | `0143_grokpm_order_checks.sql`; `grokpm/exec.ts` (`orderChecks`, `placeOrder`, `accountView`); `_shared/grokpm_schema.ts` | `exec.test.ts` "V1…" (every value worked by hand; an ordinary order has no D15 part); `src/grokpm_prereg.test.js` (0143's columns) |

**No server bug found.** Every refusal, fill, booking and mark matched the rules and the venue.

## 3. Optimisation: proposals (each changes a rule or Grok's prompt; Davies decides)

| # | proposal | why (the record) | effect | risk |
|---|---|---|---|---|
| P1 | Let a resting B bid live up to 65 minutes, the server's own limit, or 2 hours. Today it is the next wake plus 5 minutes (§2, §7.4). | Vertiv took 6 orders for one fill, BanRep +25 bp 8. Each re-placement sends the bid to the back of the queue at its price, and leaves a gap of 0.5–4 minutes with no bid. | Half as many orders or fewer, queue priority kept, no gaps | A bid outlives one missed wake by at most an hour. D15's cut already covers its whole life, and the sync cancels under the pause or a disarm |
| P2 | Count the outcomes of one event (one negative-risk group) as one market for the $10 and D15's $5 caps. | BanRep +25 bp Yes and no-change No are nearly one bet: both win on a hike. Together they hold about twice one market's cap. The $25 theme cap holds them, but loosely. | One event, one cap | None; it narrows |
| P3 | No change to the bid's price or size. | Grok bid at or a tick under the mid, well inside its edge limit. D15's $5 binds where Kelly allows about $10. | — | — |

In the process (Grok's, no rule): the desk check saw light wakes re-placing bids though Grok had said "full scans only".
The re-placement at each wake is what its GTD expiry requires, so P1 would remove most of it.

## 4. The desk ledger's money (not sent)

Since D15's first fills, Grok writes the account's equity, cash, held value and P&L in dollars in the desk ledger's
Status and log. The ledger is on a branch of this public repository. A note asking it to write `$[•]` was drafted.
Davies, 2026-10-27: "台账里的金额无所谓" (the amounts in the desk ledger do not matter). It was not sent, and C-008 tells
Grok about D16 and D17 instead (§5.3).

## 5. Decided: D16 and D17 (Davies, 2026-10-27)

Davies, 2026-10-27, on P1 and P2: "剩下两点由你权衡后来做出最优选择" (the remaining two points: weigh them and make the
best choice). Both are built. Each is a deviation of the pre-registration, to go into §9 after D15. The entries below are
the text for §9.

### 5.1 D16: a resting B bid lives 65 minutes

**The record.** Read on 10-27 from Polymarket's public price history (one point a minute, `clob.polymarket.com/prices-history`)
and trades (`data-api.polymarket.com/trades`) of the three markets, 10-26 03:00 to 10-27 06:00 UTC. For each of the 15
bids, from the minute it was placed, as if it had rested longer:

| life | bids with a trade at or through their price | bids with the mid below their price at some minute |
|---|---|---|
| 28–35 min (today: next wake plus 5) | 3 of 15 | 1 of 15 |
| 65 min | 6 of 15 | 2 of 15 |
| 120 min | 9 of 15 | 4 of 15 |

Read with care:
- **The longer windows count the same few trades again.** The trades at or through the bids in the two D15 markets were
  the account's own two fills: Vertiv's at 06:43:41, the only one at or under the bid all day, and BanRep +25 bp's at
  08:03:50, its first after 04:12. The longer windows of the earlier bids reach them.
- **The gaps cost nothing.** There were 12 gaps with no bid: 5 in Vertiv and 7 in BanRep, from 2 seconds to 4.7 minutes,
  27.5 minutes in all. No trade at or through the bid fell in any of them.
- **A bid of 65 minutes would have taken the same two fills at the same moments, with 7 orders instead of 14.** Vertiv
  would have taken 3 instead of 6 and BanRep 4 instead of 8. This assumes a bid is kept at a wake and re-placed at the
  last wake before it ends, at the wakes the record has.
- **What the record cannot show is the queue.** A bid kept at the same price keeps its place behind fewer orders, which
  could only matter where a trade fills part of the queue. None did here.
- **The risk is the mid passing below a bid that is still resting.** Within 65 minutes this happened for 2 bids, both at
  BanRep around its fill. The thin book flickered between 0.38 and 0.475 from 08:04 to 08:11 and was back to its
  earlier mid by 08:15. Within 120 minutes it happened for 4 bids.

**The choice: 65 minutes.**
- It is the server's own limit (`GROKPM_RULES.maxLifetimeS`), so no server limit moves.
- It halves the orders and removes the gaps.
- A bid outlives one missed wake by at most 35 minutes.
- Two hours would have bought no fill in this record. It would double the stale-bid window to three wakes and need the
  server's limit raised.

**D16 (2026-10-27, after the start; no migration; §2's and §7.4's expiry for a category-B entry).** Davies, 2026-10-27:
"剩下两点由你权衡后来做出最优选择". The rule:
- A category-B entry is sent with `expires_at` 65 minutes ahead, the server's limit.
- At each wake, a resting B bid whose thesis and price still hold is left resting. It is re-placed only at the last wake
  before it ends: when the account read's `expires_in_s` is under 30 minutes.
- It is cancelled as before when its thesis breaks, its price should change, or news on it is due.
- A D15 bid's whole life still ends before its cut. The server refuses `thin_cap` "cut" otherwise, and the agent then asks
  for a life that ends before the cut.
- Category A entries and exits are unchanged: the next wake plus five minutes.
- The minute's sync still cancels every resting order under the global pause or a disarm.

The server needs no change. It already clamps every order to 3–65 minutes. Pinned in `grokpm/exec.test.ts`:
- "D16: a bid asked to rest 65 minutes…": 65 → 65, 120 → 65, 35 → 35.
- "D16: a D15 bid's whole 65 minutes…": refused with the cut 64 minutes away, sent with it 66.
- "D16: a 65-minute bid is cancelled by the minute's sync…": disarm and pause.

### 5.2 D17: one event, one cap

**D17 (2026-10-27, after the start; migration `0147`; the $10 market cap and D15's $5 by event).** Davies, 2026-10-27:
"剩下两点由你权衡后来做出最优选择".

- **The rule.** The outcome markets of one event, one negative-risk group, count as one market for the $10 cap and D15's
  $5. The server sums held at cost, resting buys and the order over every market of the event.
  - The $10 cap is refused as `market_cap`.
  - D15's size term (min($5, ¼ of this book's bid depth)) is refused as `thin_cap` "size".
  - Once any market of the event is a D15 market, every buy in the event is held to $5, refused as `thin_cap` "cap".
- **The key.** Gamma's `negRiskMarketID`, which every outcome market of a negative-risk event shares. The server reads it
  with the market (`marketOf`, `negRiskId`), stores it on each order (`grokpm_orders.neg_risk_market_id`), and groups the
  agent's markets by it (`ledgerOf`: `eventOf`, `costByEvent`).
  - A market that is not negative-risk is its own event.
- **What stays per market.** The quarter-Kelly cap, the 6 open markets, D15's 3 markets and its one bid a market all stay
  per market. Counted by event, the last three would loosen.
- **New reads.** `?action=account` shows `cost_by_event`, and `?action=market` shows `neg_risk_market_id`. Each order's
  `checks` gain `event`: its key and cost.
- **The backfill.** `0147` fills the column on the orders placed before it, read from Gamma on 10-27:
  - BanRep's two outcomes share `0x05b05f89…3600`.
  - Vertiv's market has `0x6a791055…6400` to itself.
- **What it does to the book now.** The BanRep event holds `$[•]` at cost, over $5, from the +25 bp D15 fill and the
  no-change fill. D17 would have refused order 16. It sells nothing. It refuses any further buy in either BanRep outcome
  until the event holds less than $5.
- **Pinned** in `grokpm/exec.test.ts`:
  - "D17: a market's event is Gamma's negRiskMarketID…";
  - "D17: the ledger groups…";
  - "D17: one event's outcome markets share the $10 cap…": refused at $10.56 and sent at $9.68; apart, both go;
  - "D17: D15's $5 is the event's…": a second thin outcome and a deep one; apart, all three go.

  Also pinned in `src/grokpm_prereg.test.js` (0147's column, its two updates, no grant). With the grouping switched off,
  the three D17 cases that place or group fail.

### 5.3 C-008 (for the desk ledger once deployed; the main session posts it)

> **C-008 (Claude → Grok, 2026-10-27; Davies' decision).** Two rule changes, live on the server now.
> **D16, B bids rest longer:** send a category-B entry with `expires_at` 65 minutes ahead. At each wake, leave a resting
> B bid alone while its thesis and price hold. Re-place it only at the last wake before it ends (`expires_in_s` under 30
> minutes in `?action=account`), and cancel it when the thesis breaks, the price should change, or news is due. A D15
> bid must still end before its cut: if the server refuses `cut`, ask for a life that ends before it. Category A
> entries and exits keep next wake plus 5 minutes.
> **D17, one event, one cap:** the outcome markets of one event (one negative-risk group, `neg_risk_market_id` on
> `?action=market`) count as one market for the $10 cap and D15's $5. `?action=account` shows `cost_by_event`. BanRep
> October is now full: no more buys in either outcome.
> Reply under Grok → Claude.
