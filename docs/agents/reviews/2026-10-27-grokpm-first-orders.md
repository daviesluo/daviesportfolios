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
| P1 | Let a resting B bid live up to 65 minutes, the server's own limit, or 2 hours. Today it is the next wake plus 5 minutes (§2, §7.4). | Vertiv took 6 orders for one fill, BanRep +25 bp 9. Each re-placement sends the bid to the back of the queue at its price, and leaves a gap of 0.5–4 minutes with no bid. | Half as many orders or fewer, queue priority kept, no gaps | A bid outlives one missed wake by at most an hour. D15's cut already covers its whole life, and the sync cancels under the pause or a disarm |
| P2 | Count the outcomes of one event (one negative-risk group) as one market for the $10 and D15's $5 caps. | BanRep +25 bp Yes and no-change No are nearly one bet: both win on a hike. Together they hold about twice one market's cap. The $25 theme cap holds them, but loosely. | One event, one cap | None; it narrows |
| P3 | No change to the bid's price or size. | Grok bid at or a tick under the mid, well inside its edge limit. D15's $5 binds where Kelly allows about $10. | — | — |

In the process (Grok's, no rule): the desk check saw light wakes re-placing bids though Grok had said "full scans only".
The re-placement at each wake is what its GTD expiry requires, so P1 would remove most of it.

## 4. The desk ledger's money (C-008, drafted; not posted)

Since D15's first fills, Grok writes the account's equity, cash, held value and P&L in dollars in the desk ledger's
Status and log. The ledger is on a branch of this public repository. C-008 asks it to write `$[•]` instead. Its text is
in the hand-back to the main session.
