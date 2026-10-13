# PMOPPS: what else on Polymarket is worth a new paper test

Research only (2026-10-13, read 02:30–04:30 UTC). Nothing was placed, cancelled, armed or deployed, and no code,
migration or frozen file changed. Every Polymarket read was a keyless public GET. The one database read was a
read-only `select` on `pm_lp_reward_days`. pm-rec's archive (books and markets dumps, 2026-10-04 19:00 → 10-12 23:59
UTC) was already in the scratch folder, downloaded by LP-BEST with every object's sha256 checked. Scripts and outputs are
in `docs/agents/backtests/pmopps/` (`MANIFEST.json`, with the sha256 of every scratch input). Not blind. Nothing is
frozen and nothing is built: the drafts at the end wait for Davies.

Davies, 2026-10-13, verbatim:

> 你这边可以在研究下rewards市场或者polymarket其他地方还有什么机会可以值得新加测试的

In English: research what other opportunities in the rewards markets, or elsewhere on Polymarket, are worth adding as
new tests.

## The answer in plain words

- **Nothing new clears the bar for a paper test today.** Every candidate was either priced here and found too small,
  priced at about zero, or killed earlier with numbers.
- **One weak lead is worth a frozen historical test**, not a paper row: buying NO in "will X happen by <date>" markets
  a week before the deadline while YES trades at 0.20–0.50 (DEADLINE-NO).
  - Chosen on 2025, it read +7.1 % a trade on 2026, but with a range that includes zero (−4.0 % to +17.0 %).
  - Its three horizons disagree: three days before, the same trade loses.
  - It is worth $1–3 a day at $300–$1,000 if it is real.
  - 2024 has not been read, so it can serve as the unseen year a pre-registration needs (draft A).
- **One finding belongs to Q2, the quiet-books design being built, not to a new test.** Markets under three days old lose
  even in quiet books. The same books three days old and over made money in LP-BEST's own day table.
  - Under three days: −$123.81 over 1,326 market-days.
  - Three days and over: +$455.50 over 3,027 market-days.
  - It is a filter worth a line in Q2's addendum, or a paper twin beside it (draft B).
- **The rest is closed with numbers:**
  - Negative-risk sets and date ladders at minute resolution: about $1 a day at $1,000, locked for weeks.
  - Buying the proposed outcome during a dispute: priced right by the market.
  - New pools' first days: the worst place to quote.
  - Sponsored programmes: 0.1 % of the reward money.
  - Maker rebates alone: 0.18 ¢ a filled share against a 2.8 ¢ adverse move.
  - The catalogue's races: Combos, the UMA bounty and listing announcements.

## The ranked list

$ a day at the account's size ($300–$1,000), with what each would need.

| # | candidate | mechanism | $ a day (range) | capacity | risk | data a test needs | verdict |
|---|---|---|---|---|---|---|---|
| 1 | **DEADLINE-NO**: NO at T − 7 d when YES is 0.20–0.50, held to resolution | YES in deadline markets decays too slowly in the middle of the range (time value overpaid) | +$1.1 at $20 a trade, +$2.7 at $50 (2026's range at $50: −$1.5 to +$6.4) | ~0.75 trades a day; $260 locked at $50 | a trade loses its whole stake when the event happens (27 % did); events cluster | CLOB `/prices-history` and Gamma, keyless, back to 2024 | **historical pre-registered test first (draft A)**; no paper row yet |
| 2 | **Q2 + age ≥ 3 days** | new markets carry the informed flow; quiet AND settled books do not | Q2's own (LP-BEST: +$3.6 a day) plus the share of its loss from new markets | Q2's | Q2's | LP-BEST's engine, a `createdAt` per candidate (one Gamma read) | **a filter for Q2's addendum, or a paper twin (draft B)** |
| 3 | Negative-risk sets, minute by minute | sum of asks < 1 (or bids > 1) after taker fees | **$1.26 a day** with $1,000 a time; 7 after-fee episodes in 8 days, 3 of them one event | the book's size at the touch | capital locked 20–200 days; resolution clauses (M5) | pm-rec books (done) | **no-go**: about 4–5 % a year on locked capital |
| 4 | Date ladders ("by Oct 16" ≤ "by Oct 31") | the earlier bid above the later ask | **$0.06 a day**; 4 after-fee episodes | — | locked to the later date | pm-rec books (done) | **no-go** (M6 again, at the minute) |
| 5 | Buy the proposed outcome during a dispute (fp4's B16) | the market discounts a proposal that survives 79 % of the time | −2 % to −14 % a trade at 24–48 h before close; +10 % at 6 h, range −6 % to +29 % | ~50 disputes a month | the whole stake on an overturn | `/v2/resolutions` has no dispute time; UMA's own events would be needed | **no-go**: priced right, timing unknowable keylessly |
| 6 | New pools' first days (POOLAGE) | makers arrive late, so early pools pay more | **worst bucket**: −$1.02 a market-day at RW's price under 1 day old, against −$0.00 at 30 days | — | — | LP-BEST's day table + `createdAt` (done) | **no-go** (closes ledger item 6b's POOLAGE) |
| 7 | Sponsored programmes | sponsors pay where natives do not | $229 a day across all of Polymarket, 22 markets, 2 of them sponsored only ($7 a day) | — | — | the reward listing (done) | **no-go**: 0.1 % of the reward money |
| 8 | Maker rebates without rewards | 25 % of the taker fee a filled share | at most 0.31 ¢ a share (0.05 × 0.25 × 0.25); live paid 0.19 ¢ against −2.8 ¢ at 60 min | — | — | the live record | **no-go** (fp4's P2, confirmed live) |
| 9 | Combos maker, UMA disputer bounty, listing announcements | an RFQ socket with 400 ms quotes; first-come bounties | — | — | — | — | **out**: sub-second races (research round, §3.44) |
| 10 | Near-resolution buys, favourites, weather, view counts, mentions, sports and crypto in play, cross-venue, taker tiers, holding rewards | — | — | — | — | — | **out**: FAV, WX, HARVEST, PMLATE, VIEWS, SPEED, fp4's table; cross-venue has no venue this account may use |

## 1. Negative-risk sets and date ladders, minute by minute (`sets_scan.py`, `sets_summary.py`, `results/sets.txt`)

fp4's M5 and M6 read three snapshots. This reads every recorded minute of pm-rec's books: 11,584 minutes, 8.0 days.

- **The events read.**
  - 347 negative-risk events are complete: every market Gamma lists for the event has a book that minute, and the
    event is not augmented with an unnamed "Other". They give 97,384 complete event-minutes.
  - 149 date ladders give 336,788 event-minutes.
- **The test.** Every leg is a taker at the recorded touch, walked down the recorded levels while the next set still
  pays after the category's taker fee.
- **Negative-risk sets.**
  - 91 episodes had a gross edge; 7 had an edge after fees, with a median duration of 4 minutes.
  - Taken in full they made $71.90 over the record. $55 of that is one 3-leg event at 0.27 ¢ a set over 20,618 sets,
    locked 23 days.
  - At $1,000 a time: **$10.15 over the record, $1.26 a day**, all locked to the event's end (11–204 days). That is
    about 4–5 % a year on the capital it locks.
- **Date ladders.** 15 gross episodes, 4 after fees, **$0.46 over the record**.
- The book keeps these sets whole to within the fee. M5's and M6's verdict holds at the minute.

## 2. Disputes: buy the proposed outcome (`disputes.py`, `results/disputes.txt`)

**The universe.** Gamma's closed markets with $20,000 of volume or more and an end date from 2025-01 to 2026-10:
314,754 markets (`pull_closed.py`). Of them, 1,187 show "disputed" in their UMA statuses, up/down series excluded.
1,062 had a 0/1 first proposal and payout. **The first proposal was kept in 79.2 %.**

**The trade.** No keyless record read here gives the dispute's time, so the entry is placed against the close (6, 24 and
48 h before, and never earlier than 2 h after the scheduled end). That uses one thing a trader would not know: when
resolution comes.

| entry | markets | price of the proposed outcome | won | return per $1 (5–95 %) |
|---|---:|---:|---:|---:|
| close − 6 h | 534 | 0.740 | 77.0 % | +0.098 [−0.059, +0.285] |
| close − 24 h | 413 | 0.743 | 76.5 % | −0.021 [−0.158, +0.172] |
| close − 48 h | 319 | 0.772 | 78.4 % | −0.137 [−0.194, −0.078] |

- **The market prices the proposal about at its survival rate.** The positive reading needs the trader to know the
  market will close within six hours.
- The disputer's side loses more: −60 % to −70 % a $1, at 0.23–0.26 for a 22 % win rate, with a cent of spread on cheap
  prices.
- **No-go.** Re-reading this would need UMA's dispute events from the chain: a new data source for an edge that is not
  there at 24 and 48 hours.

## 3. Time decay on deadline markets (`theta.py`, `results/theta.txt`)

**The universe.** Questions saying "by" or "before" a date, not sports, crypto or up/down, with a 0/1 payout, end date
2025-01 → 2026-09, sampled one in two by the condition id: 3,216 markets.

**The prices.** The YES token's hourly price at T − 14, 7 and 3 days. NO is bought at 1 − YES + 1 ¢ of half-spread +
the taker fee. **2025 is exploration; 2026 is held out and read once.** The ranges are resampled by event, because an
event's markets resolve together.

| rule: buy NO when YES is in | at T − d | 2025 return per $1 | 2026 return per $1 |
|---|---|---|---|
| [0.20, 0.50) | 7 days | **+0.144 [+0.028, +0.257]**, 100 trades | **+0.071 [−0.040, +0.170]**, 104 trades in 86 events |
| [0.20, 0.50) | 14 days | +0.015 [−0.095, +0.124] | +0.112 [+0.032, +0.192] |
| [0.20, 0.50) | 3 days | −0.048 [−0.192, +0.094] | −0.162 [−0.281, −0.049] |
| [0.10, 0.50) | 7 days | +0.072 [−0.003, +0.148] | +0.004 [−0.064, +0.065] |
| [0.05, 0.20) | 7 days | −0.032 [−0.082, +0.013] | −0.030 [−0.070, +0.008] |

- **The longshots are priced right or a little cheap.** YES under 0.20 loses 2–3 % a $1 to sell. So the classic
  "sell the longshot" is not here, and FAV found the favourites overpriced.
- **The middle of the range is where YES looks rich a week or two out.** The 2025 rule carries its sign into 2026 at
  half the size, without significance.
- **Three days out it reverses**, which no clean theta story predicts. That is the reason this is a lead to test on an
  unseen year, not a strategy.
- **What it would be worth.** About 0.75 qualifying trades a day over the whole universe. +$1.1 a day at $20 a trade,
  +$2.7 a day at $50. 2026's range is −$1.5 to +$6.4 a day at $50, with up to about $260 locked for a week.
- **What the history cannot show.** Fills at the real ask: the hourly price is not the ask, hence the 1 ¢ haircut.
  Book depth at $50 is unmeasured.

## 4. Pool age and the quiet books (`pool_age.py`, `results/pool_age.txt`)

LP-BEST's day table quotes every market-day of live-prep's universe statelessly at five places. Its scripts are on
`main` and its output is read here by sha256. Each market-day gets its market's age at 00:00, from Gamma's `createdAt`.
Net = 0.42 × formula + 60-minute markout.

| age at 00:00 | every market-day, at RW's price ($ a market-day) | quiet books, at RW's price | quiet books, 1 tick behind |
|---|---:|---:|---:|
| under 1 day | −1.019 (2,432) | −0.129 (752) | +0.077 |
| 1–3 days | −0.867 (2,308) | −0.047 (574) | −0.032 |
| 3–7 days | −0.343 (2,321) | **+0.395** (758) | −0.011 |
| 7–30 days | −0.345 (3,924) | +0.061 (923) | +0.059 |
| 30 days and over | −0.001 (6,967) | +0.074 (1,346) | +0.066 |

- **POOLAGE is answered, the other way round.** New markets are where quoting loses most. They also have the most
  taker volume: 1,696–2,350 shares a market-day against 1,440 at 30 days. The makers who arrive late are not the
  problem; the informed takers who arrive early are.
- **For Q2.**
  - Quiet books under three days old lost $123.81 over 1,326 market-days at RW's price.
  - Three days and over made $455.50 over 3,027.
  - This is in-sample on LP-BEST's eight days and universe-wide, not through its capped engine. It is a candidate
    filter with a mechanism, to be priced in that engine before it goes into Addendum 19.

## 5. The rest, briefly

- **Sponsored programmes** (`sponsored.py`, a snapshot at 02:48 UTC):
  - 17,670 rewarded markets, $255,395 a day; sponsored $229, 0.1 %.
  - 22 markets carry a sponsored rate; 2 have no native rate, at $7 a day between them.
  - Live-prep was paid $0.00 of sponsored rewards over its live days (`pm_lp_reward_days`).
- **Maker rebates alone.** On the live record they paid 0.19 ¢ a filled share. The fills lost 2.8 ¢ at 60 minutes
  (LP-ADVERSE, LP-BEST). The best case is 0.31 ¢ a share.
- **Combos, the UMA disputer's bounty, listing announcements.** Sub-second races (§3.44, the research round), unchanged.
  A UMA proposer earns $0.80 on a $250 bond (fp4).
- **Already decided, not redone:**
  - near-resolution and favourites (FAV, B3, B4, HARVEST);
  - weather (WX, PMLATE, WXSRC);
  - view counts (VIEWS);
  - post counts and mentions (SPEED, HARVEST);
  - hourly crypto (M3b);
  - sports in play (taker delay);
  - taker tiers and holding rewards (fp4);
  - cross-venue pairs, which have no venue this account may use (survey).
- **Ruled out by the brief's own terms.** Anything below a second (Combos, listings, in-play), anything that needs a UK
  position, and anything without keyless data (bookmaker odds, FedWatch).

## Not checked

- **Dispute times.** Not read from the chain (UMA's OptimisticOracle events); the dispute entry is anchored to the close.
- **2024 deadline markets.** Left unread on purpose, so draft A has an unseen year.
- **Depth at the ask** for DEADLINE-NO's trades.
- **Q2 + age in LP-BEST's engine.** The age split is from its stateless day table; the capped run was not done here.
- **The sponsored snapshot** is one moment.

---

## Draft A (not frozen): DEADLINE-NO on the unseen year

- **What is tested.** In every closed market whose question says "by" or "before" a date, with these out: sports,
  crypto, up/down, any fee type starting `sports` or `crypto`, a game start, and anything not paying 0/1.
  - At T − 7 days (T = Gamma's `endDate`) take the YES token's last hourly price at or before it, within 6 hours.
  - If it is in [0.20, 0.50), buy NO at 1 − YES + 1 ¢ + the category's taker fee, $1 a trade, held to the payout.
- **Data.** End dates 2024-01-01 → 2024-12-31, never read before the freeze: Gamma's keyset with $20,000 of volume or
  more, and CLOB `/prices-history` at fidelity 60. Every market, not a sample. The script is `theta.py` with the year
  as its only argument changed.
- **Bar (all must hold).**
  1. At least 150 trades in at least 100 events.
  2. Mean return per $1 > 0, with the 5 % bound of the event bootstrap (2,000 draws, seed 20261013) > −0.02.
  3. Each half-year > 0.
  4. No single event over 25 % of the total.
  5. The same at T − 14 d is not below −0.05; a sign check, not a bar.
- **Then.**
  - A PASS earns a forward paper row: $20 a trade, ~0.75 trades a day.
  - It is read after 90 trades on the same bar, and depth at the ask is recorded at each entry.
  - A FAIL closes it.
- **Reported either way:** T − 3 d's reversal on 2024, and the 2025 + 2026 + 2024 pooled figure.
- **Why it might be real.** Retail "will it happen" YES buyers pay for time a week out. **Why it might not:** the three
  horizons disagree, and one year chose the band.

## Draft B (not frozen): Q2-AGE, a paper twin of the quiet-books rule

- **What is tested.** Q2 exactly as Addendum 19 builds it, with one difference: a candidate must be at least 3 days old
  at 00:00 by Gamma's `createdAt` (one keyless read a candidate).
- **How it runs.** A paper twin beside Q2, not a second live path: the same engine and books, its own tables, the
  same R as Q2's live.
- **Window.** The same 14 days as Q2's live test.
- **Bar.** Total ≥ Q2's own over the same days, and no day worse than Q2's worst.
- **Before freezing.** Price it in LP-BEST's engine (`engine.py` with the age filter) on 10-05 → 10-12. Drop it if it
  does not beat Q2 there on both TRAIN and TEST.
- **Why.** Markets under three days old lost even in quiet books (section 4). They carry the most taker volume, the
  flow that did 97 % of live-prep's damage.
