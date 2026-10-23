# GROKPM after six days: are the rules too strict? (2026-10-23)

Davies, 2026-10-23: "Polymarket analyst这个策略一整周了一单都没下，你研究优化下看看是不是规则太严格了" — the Polymarket analyst
has placed no order in a week; study whether the rules are too strict, and if so propose the best change. This review
reads the record from the go (2026-10-17 02:39:14 UTC) to 2026-10-23 04:45 UTC, and above all the D7 shadow forecasts
from D7's start (2026-10-20 16:58 UTC, the zero-trades review's §10). Sources:
- read-only SQL over the `grokpm_*` tables (§9);
- the desk ledger (`GROKPM_LEDGER.md` on `grokpm-ledger`, read 04:4x UTC);
- keyless public Polymarket reads: Gamma, the data API's trade tape, the CLOB's price history.

The scripts, data and output are in `docs/agents/backtests/grokpm_rules/`. The frozen rules are
`reviews/2026-10-15-grokpm-prereg.md` (§2, D2–D9); the first review is `reviews/2026-10-20-grokpm-zero-trades.md`.
Nothing was ordered, armed, disarmed or written. **Not blind** (no-peek rules cancelled 2026-10-04): every row was read as
it stood. The only money figure here is the test's $100 budget; candidate P&L is in percent of it and per $1.

## 1. Headline

- **No rule I can price would have made a single filled trade this week.** Seven rule sets were run over every shadow
  forecast and the public tape: lower bars (A 6/B 10, A 5/B 8), thin books allowed for category A, thin books allowed at
  $2 or at $10 a market. They place 0 to 6 resting bids in 2.49 days, and **none of them is filled**, because no one
  sold through them before the market closed.
- **What stops the agent is not the bars.**
  - Every shadow forecast that cleared its bar (19 rows in 4 markets) was in a book §2 forbids as thin, and the server
    would have refused it (`thin`).
  - Those books were empty because the market had already settled. In the three that have resolved (Tesla, the
    21-October earthquake bracket, the 22-October gas price), the last trade before the agent's forecast was at 0.999,
    0.970 and 0.983.
  - Grok's "gap" of 33 to 43 points was to the midpoint of a stale bid and an ask at 0.99 or 1.00, not to a price anyone
    would sell at.
  - The market had priced each confirmation 25 minutes (Tesla) to 9 hours (gas) before the agent first looked.
- **Scores:** 4 shadow forecasts have resolved, all YES at p 0.93–0.98.
  - Against the agent's own m, Grok looks far better: Brier 0.0019 against 0.1270.
  - Against the market's last trade it is worse: 0.0019 against 0.0004.
  - D7's reading, as written, would credit Grok with an edge the market did not lack.
- **Recommendation: keep the rules.** Loosening them buys orders that do not fill, or (on the first review's evidence for
  B) trades at a negative edge.
  - Proposed **D10** adds no rule. D7's secondary reading also scores the market by its last trade, and marks thin-book
    forecasts.
  - A desk-ledger note (C-004) corrects three working habits that narrow the search, without touching a rule.
  - Expect 0–1 trades a week, as now. Both texts are in §7, for Davies' word only.

## 2. The record since the go

| | since the go (6.09 days) | since D7's start (2.49 days) |
|---|---:|---:|
| cycles (full / light) | 291 (37 / 254) | 120 (15 / 105) |
| decisions | 567, all `no_action` | 396, 276 with p and m (274 counted, D9 leaves out 2) |
| orders, fills | 0, 0 | 0, 0 |
| requests (200 / 422 / 403) | 710 (672 / 37 / 1) | 258 |

- No refused request was an order:
  - 35 malformed market reads;
  - 1 cycle stamped in the future;
  - 1 source list over 10;
  - 1 call from the wrong region.
- The recorder holds no entry and no resolution (`grokpm_entries`, `grokpm_resolutions`: 0 rows).
- The daily summaries agree: 0 trades on each of 10-17 to 10-22.

## 3. The funnel

Source: `scripts/study.py` §1 (`results/study.txt`). The scans cover the markets Gamma lists:
- from 2,100 to 26,831 a full scan;
- since 10-21 04:10 UTC, mostly the earliest-ending, within 40 hours to 3 days ("Scanned 100 markets ending within 3
  days", "…600 markets ending within 40 h", "2,100 earliest-ending markets plus watch list");
- Gamma now caps a page at 100 (the 10-22 20:27 cycle note).

The agent priced 10 markets in 2.49 days:

| market | cat | rows | max p − m | rows over the bar | the server's gate on those rows | outcome |
|---|---|---:|---:|---:|---|---|
| Alberta: Remain by 40–60 % | A | 119 | 4.4 | 0 | edge | open (official 29 Oct) |
| Alberta: Leave wins a division | B | 119 | 4.5 | 0 | edge | open (29 Oct) |
| Bank of Israel holds (Oct) | A | 2 | −1.4 | 0 | edge | YES |
| **Tesla beats Q3 EPS** | A | 4 | 32.5 | 2 | **thin** (bid 0.31, no ask) | YES |
| **Biggest quake 21 Oct 5.3–5.4** | A | 20 | 43.5 | 15 | **thin** (0.012/0.99 … 0.51/0.99) | YES |
| **US gas 22 Oct $4.270–4.2799** | A | 1 | 34.4 | 1 | **thin** (0.258/0.995) | YES |
| **UMich Oct final 43.0–45.9** | B | 2 | 15.0 | 1 | **thin** (0.03/0.41) | open (23 Oct) |
| UMich Oct final 46.0–48.9 | B | 2 | 4.0 | 0 | edge | open (23 Oct) |
| HOOD low $95, week of 19 Oct | B | 2 | 11.0 | 0 | edge (and thin: 0.46/0.56) | open (23 Oct) |
| Biggest quake 22 Oct ≥ 6.1 | A | 3 | 4.0 | 0 | edge (and one-sided at 00:22) | open (23 Oct) |

**The funnel:**
- 274 forecasts in 10 markets.
- 19 rows in 4 markets clear their category's bar on p − m.
- All 19 are thin.
- 0 orders.
- Below the bar, every row with a gap of 5 points or more is thin too (HOOD's 11 at 16:13, UMich's 9 at 16:13). So
  **lowering the bars to anything from 5 points up adds no order while `thin` stands.**
- Of the other gates, none came into play: favourite, longshot, horizon, caps, cash floor, stops, Kelly, orders a day.

**The agent is stricter than the server in one way.**
- In 15 rows it measured p against the ask ("ask above p, no edge"; "6 points over ask, under B 12"; "ask leaves no
  8-point gap"); the server measures a post-only bid against the dearer of the bid and the mid.
- The server would have refused every one of those rows anyway (13 thin, 2 short of the bar on the mid), so no order was
  lost to it this week. In a book with a spread of 5 points or less it costs up to 2.5 points of bar.

**Where the forecasts went.** 238 of the 274 rows are the two Alberta markets, re-priced every 30 minutes for three days
at a gap of under 5 points. D9 counts each market's first forecast only, so they add one forecast each.

## 4. The gaps were empty books, and the market had already moved

Source: `scripts/study.py` §2; the data API's taker trades.
- **Bid**: the highest the D3 edge allows (p − 8 points for A), resting from the first row over the bar to the market's
  close.
- **First trade at 0.95+**: the first taker trade of the token at 0.95 or more.

| market | first trade at 0.95+ | agent's first row over the bar | book then | last trade before it | bid | taker fills after it |
|---|---|---|---|---:|---:|---:|
| Tesla beats Q3 EPS | 10-21 20:02 (0.966) | 20:27 | 0.31 / none | 0.999 | 0.90 | 0 |
| Biggest quake 21 Oct 5.3–5.4 (M5.3 at 21:38) | 10-22 01:27 (0.97) | 08:08 | 0.012 / 0.99 | 0.970 | 0.85 | 0 |
| US gas 22 Oct $4.270–4.2799 | 10-22 03:08 (0.956) | 12:14 | 0.258 / 0.995 | 0.983 | 0.89 | 0 |
| UMich 43.0–45.9 (B; not a confirmation) | — | 10-22 20:27 | 0.03 / 0.41 | 0.390 | 0.25 | 0 |

**What the tape shows:**
- After a confirmation, the sellers left within minutes:
  - Tesla's price went from 0.39 (last trade 18:26) to 0.966 at 20:02 and 0.999 at 20:08;
  - the 22-October quake's (M7.0 at 14:33) from 0.42 to 0.99 between 14:38 and 14:53.
- Later, only a stale bid and a 0.99–1.00 ask remained. The agent's m is the midpoint of the two.
- The one sale into bids after a confirmation came hours later: 110 shares of the 22-October quake's YES sold at
  0.90–0.92 at 22:06. The agent first priced that market at 00:22.
- A standing bid could have caught that sale: about 8 points on at most $10, once. That is buying from a careless or
  hurried seller, not trading on information.
- The A lag the rules aim at lasted minutes here. Grok's first forecast came 25 minutes to 9.5 hours after the first
  trade at 0.95 or more (four confirmations, the 22-October quake's included), on its 30-minute and 4-hour rhythm. That agrees with the cadence study (prereg §7.2) and the first review's §4: A is a speed game, and
  the bots win it.

## 5. Scores (D7's reading, early, and why it needs a second market column)

Source: `scripts/study.py` §3. Each resolved market at its first counted forecast (D9):

| market | p | m (agent) | last trade before | y |
|---|---:|---:|---:|---:|
| Bank of Israel holds | 0.960 | 0.9775 | 0.983 | 1 |
| Tesla beats Q3 EPS | 0.980 | 0.6550 | 0.999 | 1 |
| Biggest quake 21 Oct 5.3–5.4 | 0.930 | 0.5010 | 0.970 | 1 |
| US gas 22 Oct | 0.970 | 0.6265 | 0.983 | 1 |

| on 4 resolved | agent | market by m | market by last trade |
|---|---:|---:|---:|
| Brier | 0.0019 | 0.1270 | **0.0004** |
| log loss | 0.0410 | 0.4012 | **0.0165** |

- The CLOB's price history gives the same as m (0.1271): it is a mid series, so it is stale in the same books.
- Calibration cannot be read: every resolved forecast was a YES at p 0.93 or more. No B forecast and no forecast under
  0.9 has resolved in this window.
- Four forecasts, all of the same kind, all in emptied books: this supports no claim about Grok's skill either way. It
  does show a flaw in D7's reading as written. Where the book is empty, m is not the market's forecast, and scoring
  against it credits the agent with what the market already knew. Hence D10 (§7).

## 6. Candidate rule sets

Source: `scripts/study.py` §4, run on every shadow row; one order a market, at its first row that passes:
- **Sizing**: the server's quarter Kelly of $100 at p and the bid, at most $10 (or the thin cap).
- **Fills**: from the taker tape, either "rest" (re-placed every wake until the market closes) or "wake" (alive only
  while the agent's rows pass, plus one 35-minute GTD).
- **Fees**: maker fees are 0.

| candidate | orders (2.49 days) | a week | filled (rest / wake) | resolved, won | P&L | worst |
|---|---:|---:|---:|---:|---:|---:|
| K0 current: A 8, B 12, thin forbidden | 0 | 0 | 0 / 0 | 0, 0 | 0 | 0 |
| K1 A 6, B 10, thin forbidden | 0 | 0 | 0 / 0 | 0, 0 | 0 | 0 |
| K2 A 5, B 8, thin forbidden | 0 | 0 | 0 / 0 | 0, 0 | 0 | 0 |
| K3 A 8, B 12, thin allowed for A (held to payout) | 4 | 11.2 | 0 / 0 | 0, 0 | 0 | 0 |
| K4 A 8, B 12, thin allowed at $2 a market | 5 | 14.1 | 0 / 0 | 0, 0 | 0 | 0 |
| K5 A 5, B 8, thin allowed at $2 a market | 6 | 16.9 | 0 / 0 | 0, 0 | 0 | 0 |
| K6 A 5, B 8, no thin rule ($10) | 6 | 16.9 | 0 / 0 | 0, 0 | 0 | 0 |

**The first review's record** (`reviews/2026-10-20-grokpm-zero-trades.md` §3: 10-17 to 10-20, before D7) is the only
evidence on looser B bars. With thin books still forbidden:
- B 10: 2 trades, both lost, −7.49 % of the budget;
- B 8: 3 trades, all lost, −10.59 %;
- B 5: 6 trades, 1 won, −13.18 %.

The same review scored the agent's sub-threshold p at Brier 0.136 against the market's 0.106 on 9 resolved markets. One
of the losses, Alberta 20–40, rests on a count not official until 29 Oct. Over the six days that is 2 to 3 B-trades a
week at B 10 or B 8, every resolved one a loss.

**What the sample allows.**
- This window has 4 resolved forecasts and 0 fills under any candidate, so no P&L comparison between candidates exists.
- The conclusion is structural, not statistical: the books the gaps sat in had no sellers, and the confirmations were
  priced before Grok looked.
- On B, 5 resolved trades in the first review all lost under looser bars. That is too few to prove the agent has no
  edge, and enough to refuse to pay for one.
- No candidate was chosen for catching a winner. None would have.

## 7. Recommendation

**Keep every rule as frozen:** A 8, B 12, thin, favourite, longshot, the caps, the stops and the cadence.
- Expected trades: 0–1 a week, as now.
- Risk: none added.
- **What would change the count is speed and scope, not the bars:**
  - speed: wakes at the release times §7.5 lists, which Grok's scheduler may not allow;
  - scope: B research across the 30-day window §2 allows, which the note below asks for.

**Not recommended, unless Davies wants orders on the book rather than protection: K3.**
- The change: category A may rest a post-only bid in a thin book, held to payout.
- Expect about 11 resting orders a week and, on this week's tape, no fills.
- Its only fill is a seller who hits a bid under a confirmed outcome. That seller is either careless (22-Oct quake, 22:06)
  or knows the confirmation is contested, which is the adverse selection §2's thin rule exists for.
- If chosen: at most $5 a market, a confirmation from the market's own resolution source linked in `sources`, never sold
  before payout.

### D10 (proposed text for the pre-registration's §9, after D9; only on Davies' word)

> - **D10 (2026-10-2x, after the start; no migration; a reading's column added, no rule changed).** Davies, <date>:
>   "<his word>", on the rules study (`reviews/2026-10-23-grokpm-rules-study.md`). In its first six days the agent sent no
>   order. Every shadow forecast that cleared its category's bar on p − m (19 rows in 4 markets, 2026-10-20 16:58 to
>   10-23 04:45 UTC) stood in a book §2 forbids as thin. In the three of them that resolved, the market had last traded
>   at 0.97 or more before the forecast: the agent's m was the midpoint of an emptied book, not a price anyone would sell
>   at. On the 4 resolved forecasts, Brier against m was 0.0019 for the agent and 0.1270 for the market; against the
>   market's last trade, 0.0004. The rules stay as frozen. D7's secondary reading adds a second market reference beside
>   m: the market's last trade of the forecast token before each counted forecast (the data API's taker trades, keyless;
>   a trade of the other outcome at q counts as 1 − q). It is scored the same way (Brier, log loss, and §6.2's paired
>   bootstrap) and reported beside the m column, which stays as D7 defined it. Each counted forecast whose book was
>   one-sided or wider than 5 points is marked. It is not a bar: continuing still needs §6's two conditions on real
>   entries. Nothing about the categories, the rules, §6's reading, its bar or its end changes.

### The note for Grok (desk ledger "Claude → Grok", only after Davies says yes)

> **C-004 (from Davies, <date>; Deviation D10).** Nothing about your trading rules changes: A 8, B 12, thin books, caps
> and stops are exactly as before, and "no open" remains the right answer when nothing clears them. Three working notes
> from the rules study (`reviews/2026-10-23-grokpm-rules-study.md`):
> (1) An open is a post-only bid, and the server measures its edge against the dearer of your bid and the mid, not
> against the ask. "Ask above p" is not by itself a reason not to bid: check p − max(your bid, mid) against the bar, then
> the thin rule.
> (2) Since 10-21 your full scans have read mostly the earliest-ending markets (within 40 hours to 3 days). Category B allows markets
> resolving up to 30 days out, and a quiet market's price usually stands for hours (prereg §7.3). Spend part of every full
> scan on low-attention markets 3 to 30 days out; Gamma's /events with a tag filter gets past the 100-a-page cap.
> (3) Shadow rows: journal one per market at each full scan, and between scans only when your p changes or the market
> moves 3 points or more. Only each market's first forecast is scored, so re-journalling an unchanged p every 30 minutes
> (238 rows on the two Alberta markets) adds nothing.
> Reply under Grok → Claude when you have read this.

## 8. Limits

- **Small.**
  - 2.49 days of shadow forecasts, 10 markets, 4 resolved (all YES at p ≥ 0.93), and 0 fills under any candidate.
  - Six markets resolve from 23 to 29 Oct. Re-running `scripts/fetch.py` then `scripts/study.py` re-scores them; the
    committed output is the 10-23 04:48 UTC read.
- **The books are the agent's words.** Each row's bid and ask are copied by hand from its reason (`BOOKS` in the
  script). No depth is stated, so "thin" here is the spread test alone; the server's $500 depth test can only add rows.
- **Fills are a proxy.**
  - A bid is filled by a taker trade at or through it on the public tape (taker-only, the newest 1,000 trades a
    market).
  - The model ignores queue position, so it overstates fills. It still finds none.
  - A GTD bid re-placed every wake is assumed to have rested without a gap.
- **The A latency figures** take the first taker trade at 0.95 or more as the moment the market knew. The confirmation
  itself (USGS, AAA, Tesla's release) is not timestamped in the data.
- **The two Alberta markets** are summarised in `data/shadow.json`, not exported row by row. Their 238 rows never come
  within 5 points of a bar, so no candidate opens them.
- **The first review's B evidence** is copied from it, not re-derived, and its 10 open near misses resolve from 23 to 29
  Oct.

## 9. The SQL (read-only, 2026-10-23 04:4x UTC) and the public reads

```sql
select kind, count(*), min(ts), max(ts) from public.grokpm_cycles where ts >= '2026-10-17T02:39:14Z' group by 1;  -- full 37, light 254
select action || '/' || coalesce(category, '-') || '/' || (p is not null and m is not null), count(*)
  from public.grokpm_decisions where ts >= '2026-10-17T02:39:14Z' group by 1;  -- no_action/-/false 291, no_action/A/true 150, no_action/B/true 126
select mode || '/' || state, count(*) from public.grokpm_orders group by 1;      -- dry_run/expired 1 (10-16 rehearsal); nothing since the go
select count(*) from public.grokpm_fills;                                         -- 0
select status, count(*) from public.grokpm_requests where at >= '2026-10-17T02:39:14Z' group by 1;  -- 200 672, 422 37, 403 1
select left(error, 160), count(*) from public.grokpm_requests
 where at >= '2026-10-17T02:39:14Z' and status <> 200 group by 1;                -- no order among them
select count(*) from public.grokpm_entries; select count(*) from public.grokpm_resolutions;  -- 0, 0
select ts, notes from public.grokpm_cycles where kind = 'full' and ts >= '2026-10-20T12:00Z' order by ts;  -- the scans' scope
select day, trades, summary from public.grokpm_daily order by day;               -- 0 trades each day
-- the shadow forecasts: docs/agents/backtests/grokpm_rules/sql/shadow.sql → data/shadow.json
```

The public reads are in `scripts/fetch.py`, all keyless GETs:
- Gamma `/markets?condition_ids=` (closed and open);
- the data API's `/trades?market=` (`takerOnly` true and false);
- the CLOB's `/prices-history` (1 minute).

They were read 2026-10-23 04:48 UTC into `data/public.json.gz`.

## 10. Decision (Davies, 2026-10-23; nothing above is changed)

Davies, 2026-10-23: "同意，按你的建议做" (agreed, do as you recommend).
- Every rule is kept.
- D10 is agreed with §7's text, dated 2026-10-23, with these words as its quote. It goes into the pre-registration's §9
  after D8 (#245) and D9 (D7's sample rule, the zero-trades review's §10), so its sha chain stays one line.
- C-004 is posted on the desk ledger as §7 gives it.
- D7's end reading has no script yet (§6 of the pre-registration: written before the end). When it is written, it
  carries D10's last-trade column; until then D10's text is the change.
