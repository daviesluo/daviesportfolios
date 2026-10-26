# GROKPM, again: is the thin rule now what stops real edges? (2026-10-26)

Davies, 2026-10-26: "grok bot的live策略到现在还是一单没下，你再研究下策略需要优化吗？是不是规则还是太严了". The live strategy has still
placed no order: are the rules still too strict?

This reads the record from 2026-10-23 05:00 to 10-26 01:00 UTC (2.83 days). In that window:
- Grok has used `markets_far` since 10-25 00:05 (D11, C-005);
- the record keeps each forecast's last trade and book (0138, F2).

The sources:
- read-only SQL (§8);
- the public tape, the books and Gamma, read keylessly 10-26 01:00 UTC;
- the frozen rules (`reviews/2026-10-15-grokpm-prereg.md`, D1–D14).

**Not blind.** The only money figure is the test's $100 budget.

The scripts, data and output are in `docs/agents/backtests/grokpm_thin/`. The earlier studies are
`reviews/2026-10-20-grokpm-zero-trades.md`, `2026-10-23-grokpm-rules-study.md` and `2026-10-24-grokpm-optimisation.md`.

## 1. Headline

- **Yes, the thin rule is now the gate on real edges.** Unlike 10-23, 6 of the 9 cleared markets are open markets 3 to 8
  days from their end, with prices that still move.
  - 189 forecasts on 40 markets; 42 rows on 9 markets clear the bar on p − m.
  - Every one of the 42 is refused by `thin`, and nothing else.
- **What a small bid would have done is not yet known, because nothing it would have bought has resolved.**
  - A post-only bid at the price the edge rule allows, kept only while Grok's rows cleared the bar, fills in 2 of the 9
    markets: Vertiv and BanRep no-change, both open.
  - At today's mids, the rule's own size is −0.58 % (Vertiv) and +2.66 % (BanRep) of the budget.
  - The one thin clear that resolved after a bid could have filled is US gas $4.30. It went to 0, and the only sellers
    into a bid there came at the 14:00 UTC print that decided it: informed sellers.
- **The earlier evidence still says Grok's edge is unproven.**
  - Looser B bars in tradable books lost 5 of 5 (10-17 to 10-20).
  - On 19 resolved forecasts Grok's Brier equals the market's last trade: 0.0242 against 0.0241.
- **Recommendation: D15, a capped allowance for thin books in far B markets.**
  - The terms: at most $5 a market and 3 such markets at once (at most $15 at risk), only while the market ends 2 or more
    days out, with a two-sided book of spread 5 points or under, sized to a quarter of the visible depth.
  - Expected: about 12 bids and 5 fills a week; the worst week is the $15 at risk, inside the −$10 day and −$30 total
    stops.
  - It buys the test what it lacks: real fills to read. The record does not say it will make money.
  - The text is in §6, for Davies' word only. Keeping the rule as it is remains a defensible choice (§5).
- **Three fixes made here, no rule changed (§7):**
  - G1: a market read takes the agent's own names for the id, and an empty read says what it was sent.
  - G2: a future-stamped journal row is refused with by how much and what to stamp.
  - G3: the record keeps the book's depth (0139).

## 2. The funnel (10-23 05:00 → 10-26 01:00 UTC)

| step | count |
|---|---:|
| decisions | 325 |
| forecasts with p and m | 189 on 40 markets |
| rows clearing the bar on p − m (A 8, B 12) | 42 on 9 markets |
| …refused by `thin` | 42 (all) |
| …by any other gate (edge on max(bid, mid), favourite, longshot, horizon, caps, stops) | 0 |
| orders | 0 |
| B rows 8 to 12 points (under the bar) | 28 on 7 markets |

**The nine markets** (first clearing row; `results/study.txt`):

| market | cat | p | book then | why thin | days to end | outcome / mid now |
|---|---|---:|---|---|---:|---|
| US gas hits $4.30, week of 19 Oct | B | 0.50 | 0.06/0.61 | spread | 1.6 | **0 (lost)** |
| Biggest quake 23 Oct 5.7–5.8 | A | 0.96 | 0.74/0.87 | spread | 0.6 | 1 (won) |
| Biggest quake 24 Oct 6.1+ | A | 0.995 | 0.755/0.997 | spread | 1.2 | 1 (won) |
| SpaceX under 14 launches in Oct | B | 0.98 | 0.68/0.989 | spread | 7.8 | 0.797 |
| Canada GDP Aug 0.2–0.3 % MoM | B | 0.60 | 0.35/0.39 | depth | 6.0 | 0.405 |
| South Korea Q3 GDP 3.0–3.4 % | B | 0.40 | 0.26/0.27 | depth | 3.1 | 0.385 |
| Vertiv Q3 margin 24–26 % | B | 0.80 | 0.514/0.548 | depth (~$38–94) | 3.4 | 0.516 |
| BanRep +25 bp, 30 Oct | B | 0.60 | 0.30/0.33 | depth | 4.2 | 0.36 |
| BanRep no change, 30 Oct (No) | B | 0.65 | 0.42/0.45 | depth (~$40) | 4.2 | 0.565 |

**The thin rule in code** (`grokpm/exec.ts`):
- the constants: `GROKPM_RULES.thinSpread` 0.05, `thinDepthUsd` 500 and `depthBand` 0.05;
- `bookOf` counts `bidDepthUsd` as Σ price × size of the token's **bids** at or above mid − 5 points;
- an open is refused as `thin` when the book is one-sided, the spread is over 5 points, or that depth is under $500.

The prereg's words (§2) are "under $500 within 5 points of the mid on the side it would exit into". For a buy that side
is the bid, so the code is the text.

Against an order's needs:
- the largest open the rules allow is $10 a market;
- the depth bar is 50 times that;
- a B position is held to resolution unless its thesis breaks.

So the $500 is not an exit-capacity test. It is a market-quality filter: PMPOST's lesson that thin books are where
better-informed takers live. The spread half binds the near-resolution markets (gas, quakes, SpaceX). The depth half binds
every tight-spread far market Grok found (Vertiv, BanRep, Korea, Canada): their books carry $30 to $100 within the band.

## 3. What a small bid would have done

The bid:
- **Price:** the highest the edge rule allows, p − bar to the cent, one tick under the ask Grok saw.
- **Fills:** from the public taker tape after the row, queue ignored, so the fill counts are generous.
- **Sizes:** the venue's 5-share minimum makes $1 unplaceable everywhere and $2 placeable in 4 of 9.

| market | bid | rule size | filled, alive while rows cleared | filled, re-placed to the close | mark (paid or mid now) | per $1 |
|---|---:|---:|---:|---:|---:|---:|
| US gas $4.30 | 0.38 | $4.84 | 0 | 696 sh (60 at 07:54, 636 at the 14:00 UTC print, at 0.001–0.06) | 0 | −1.00 |
| Quake 23 Oct 5.7–5.8 | 0.869 | $10 | 0 | 0 | 1 | +0.15 |
| Quake 24 Oct 6.1+ | 0.91 | $10 | 0 | 0 | 1 | +0.10 |
| SpaceX under 14 | 0.86 | $10 | 0 | 0 | 0.797 | −0.07 |
| Canada GDP Aug | 0.38 | $8.87 | 0 | 612 sh (10-25, after Grok's last row) | 0.405 | +0.07 |
| Korea Q3 GDP | 0.26 | $4.73 | 0 | 0 | 0.385 | +0.48 |
| Vertiv 24–26 % | 0.547 | $10 | 30 sh (two 15-share sells, 10:18 and 18:06) | 30 sh | 0.516 | −0.06 |
| BanRep +25 | 0.32 | $10 | 0 | 0 | 0.36 | +0.13 |
| BanRep no change (No) | 0.44 | $9.38 | 30.9 sh (22:57) | 30.9 sh | 0.565 | +0.28 |

**By size**, keeping the order alive only while Grok's rows still clear:
- $5 fills in 2 markets, +1.13 % of the budget at today's marks;
- the rule's size fills in the same 2, +2.09 %.

Re-placed to each market's close (generous), the gas loss joins: $5 −3.54 %, the rule's size −2.17 %.

**Scoring (when they resolve).** None of the filled bids has resolved. Nothing is concluded on them.
- South Korea Q3 GDP, 10-28 (the BOK's advance estimate).
- Vertiv, 10-28 (its Q3 report).
- Canada GDP, 10-30 (StatCan).
- BanRep, 10-30 (its meeting).
- SpaceX, 11-01.

Re-running `scripts/fetch.py` then `scripts/study.py` after 11-01 scores them.

**Who sells into a resting bid in a thin market** (the adverse-selection question):
- Gas: 60 shares at 0.06 that morning, then 636 shares between 14:00 and 14:56 UTC at 0.001–0.03, once the AAA print
  had decided it. A bid left resting into a
  market's deciding moment is filled by the people who know.
- Vertiv and BanRep: small sells (15, 15 and 31 shares) days before the event, with no news; BanRep's mid has since
  risen 13 points.
- The far-and-small fills look like liquidity. The near-the-event fill was information. That is the line D15 draws.

## 4. Grok's own process

- **Speed.**
  - Full scans start 12.3 minutes after their slot on average, light checks 7.0.
  - Cycle rows are stamped up to 9.4 minutes **ahead** of receipt; three batches were refused at over 10 minutes.
  - These are Grok's scheduler's; G2 makes the refusal say what to stamp.
- **Scope.** Fixed by C-005 and D11: the clears now include markets 3 to 8 days out.
- **Empty market reads.** 24 `?action=market` requests on 10-24/25 named neither `cond` nor `token`, in bursts at 22:40.
  - The table keeps no input, so what was sent is unknown. G1 reads `market_id`, `condition_id` and `token_id` as
    synonyms, and an empty read now names what it was sent.
- **Noise rows.**
  - SpaceX has 16 clearing rows: between-scan re-journals on "mid moved 3+ points" in a book whose spread is 26–44
    points. There the mid moves with every quote and carries no information.
  - C-007 asks Grok to re-journal in a thin book only when p changes.

## 5. Candidates

Per 2.83 days (×2.47 for a week), on this record.
- **Fills** are counted while Grok's rows clear.
- **Worst case** is the stake lost.
- **The stops stay:** day −$10, total −$30, $10 a market, $25 a theme, 6 markets.

| candidate | markets bid | fills (open) | worst case a market / a week | adverse selection |
|---|---:|---:|---|---|
| (a) keep `thin` as is | 0 | 0 | $0 / $0 | none. The test reads no fill: the end says "no entries" |
| (b) depth → size: a bid ≤ 25 % of the bid depth in the band (venue minimum floor, rule size cap); spread ≤ 5 and two-sided kept | 5 (Vertiv, BanRep ×2, Korea, Canada) | 2 | rule size ≈ $10 (25 % of $40–94 is $10–23) / ~$50 | low far out, high at the event: gas's kind is excluded only by its spread |
| (c) lower the depth bar (e.g. $100) | ~0 (Vertiv's $38–94 and BanRep's ~$40 still fail) | 0 | — | — |
| (d) thin allowed only ≥ 2–3 days to end (any spread), $5 a market | 6 (adds SpaceX) | 2 | $5 / $30 | lower: removes the near-event dumps (gas, the quakes) |
| **(e) D15: (b) ∩ (d), with caps**: B only; two-sided, spread ≤ 5; end ≥ 2 days out; size ≤ min(25 % of bid depth in the band, $5, rule size), at least the venue minimum; at most 3 such markets open; cancelled under 2 days | 5 → **~12 a week** | 2 → **~5 a week** | **$5 / $15 at risk at once**, then the day and total stops | the least of the five: no near-event resting, small stakes |

- **Expected value.** On the evidence, Grok's sub-bar B edges lost (5 of 5). Its resolved forecasts are no better than
  the last trade, and thin books are where informed takers live. So expect zero to slightly negative per fill. At $5 a
  fill that costs cents to a few dollars a week, and it produces what the test is for: real entries scored by §6.
- **What would change the call:**
  - if the D15 fills lose at a rate that reaches the day stop twice, Davies can revoke it with one line;
  - if they win, the reading shows it on real money.

## 6. Recommendation: D15 (for Davies' word only; not applied)

> - **D15 (2026-10-2x, after the start; no migration; §2's thin rule given a capped exception).** Davies, <date>:
>   "<his word>", on the thin-rule study (`reviews/2026-10-26-grokpm-thin-rule-study.md`). From 10-23 05:00 to 10-26
>   01:00 UTC every one of the 42 shadow forecasts that cleared its bar on p − m (9 markets) was refused only by `thin`.
>   Five of them were open markets 3 to 6 days from their end with spreads of 5 points or under and roughly $30 to $100
>   of bids within 5 points.
>   §2's $500 is fifty times the largest open the rules allow. An open of category B that `thin` would refuse only for
>   its depth is allowed when all of these hold:
>   1. the book is two-sided with a spread of 5 points or under;
>   2. the market ends 48 hours or more after the order;
>   3. the order is post-only at a price the `edge` rule allows;
>   4. its cost is at most the least of $5, a quarter of the bid depth within 5 points of the mid, and the quarter-Kelly
>      size, and at least the venue's minimum;
>   5. the agent then has at most 3 such markets open (held or resting).
>
>   A resting order of such a market is cancelled by the minute's sync once the market is under 48 hours from its end.
>   Category A, category C and every other rule, cap and stop are unchanged. The server refuses an order outside these
>   terms with the rule `thin`, naming the term it broke. Nothing about the categories, §6's reading, its bar or its end
>   changes. Every D15 entry is counted in §6.3's category B and marked in the reading.

**The note for Grok** (desk ledger, only after Davies says yes and the server carries D15):

> **C-007 (from Davies, <date>; Deviation D15).** A capped exception to the thin rule, live after the next deploy (the
> refusals then name `thin_cap`). In a category-B market whose book is two-sided with a spread of 5 points or under but
> under $500 of bids within 5 points, you may rest a post-only bid at a price the edge rule allows, sized at most $5 and
> at most a quarter of that bid depth, and at least the venue's minimum. This holds only while the market ends 48 hours or
> more away; the server cancels such bids inside 48 hours. At most 3 such markets at once. Everything else is unchanged.
> Two working notes:
> (1) In a book with a spread over 10 points the mid moves with every quote: re-journal a shadow row there only when your
> p changes.
> (2) Stamp each journal row with the time you write it, not the slot it belongs to (three batches were refused on 10-24/25
> for times 10+ minutes ahead).
>
> Reply under Grok → Claude.

**If Davies prefers no new risk:** keep (a), and send C-007's two working notes alone. The far-B clears then stay shadow
forecasts and are scored by D7, D10 and D13 at the end.

## 7. Fixes made here (no rule changed), each pinned

| # | what | where | pinned by |
|---|---|---|---|
| G1 | A market read takes `market_id` and `condition_id` for `cond`, and `token_id` for `token`; an empty read names the parameters it was sent. | `grokpm/index.ts` (`marketParam`, `marketQuery`) | `index.test.ts`: "marketQuery…" (synonyms, an empty `cond` beside a `condition_id`, the named parameters) |
| G2 | A row more than 10 minutes ahead is refused with how far ahead, the server's clock and what to stamp. The 10-minute window is unchanged. | `grokpm/ingest.ts` (`timeOf`) | `index.test.ts`: the refusal table's exact message |
| G3 | `grokpm_shadow_marks.bid_depth_usd` and `ask_depth_usd`: the dollars within 5 points of the mid, as `bookOf` counts them, from the same book read (within ten minutes of the forecast). | `0139_grokpm_shadow_depth.sql`; `agents/grokpm_rec.ts` (`touchOf`); `_shared/grokpm_schema.ts` | `grokpm_rec.test.ts` (by-hand depths 57.22 / 8 and 45 / 23.5; null without a two-sided book); `src/grokpm_prereg.test.js` (0139's columns) |

## 8. The SQL (read-only, 2026-10-26 ~01:00 UTC)

```sql
-- the funnel: 325 decisions, 189 forecasts on 40 markets, 42 clearing rows on 9 markets, 28 B rows of 8-12 points
select count(*) filter (where p is not null and m is not null), count(distinct market_id) filter (where p is not null and m is not null),
       count(*) filter (where (category = 'A' and p - m >= 0.08) or (category = 'B' and p - m >= 0.12))
  from public.grokpm_decisions where ts >= '2026-10-23T05:00Z';
select count(*) from public.grokpm_orders where created_at >= '2026-10-17T02:39:14Z';   -- 0
select status, left(error, 150), count(*) from public.grokpm_requests
 where at >= '2026-10-23T05:00Z' and status <> 200 group by 1, 2;  -- 24 empty market reads, 3 future-stamped batches, 1 region
select kind, count(*), max(extract(epoch from (received_at - ts)) / 60), min(extract(epoch from (received_at - ts)) / 60)
  from public.grokpm_cycles where ts >= '2026-10-23T05:00Z' group by 1;                -- rows up to 9.4 min ahead
-- the clears with their books and last trades: backtests/grokpm_thin/sql/clears.sql → data/clears.json
```
