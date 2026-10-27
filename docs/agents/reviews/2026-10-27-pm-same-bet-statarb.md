# PMSAMEBET: the same bet in two Polymarket markets, and Kalshi as a clock

Research only (2026-10-27, read 03:29–04:47 UTC). Nothing was placed, armed, built or deployed.

- Every read was a keyless public GET: Gamma, the CLOB's books, the data API's trades, Kalshi's public API, and one
  rules PDF on Polymarket's S3. No SQL, no key, no account.
- Scripts and summaries are in `docs/agents/backtests/pmsamebet/` (`MANIFEST.json`). The raw pulls stay in the scratch
  folder: the open-event pull alone is about 1 GB. `MANIFEST.json` records their sha256, sizes and line counts.
- They read live books and tapes, so a re-run reads later ones. Not blind: every earlier study was read first.

Davies, 2026-10-27, verbatim:

> 我们polymarket的研究有没有研究过本质同一赌注的不同问题/市场中的价差来做stat arb的？如果没有的话也请仔细研究下看看有没有机会

In English: has our Polymarket research looked at stat-arb on the price gap between different questions or markets
that are essentially the same bet? If not, study it carefully and see whether there is an opportunity.

## The answer in plain words

- **No, not before today.** The earlier work priced bets that are logically linked inside one structure:
  - YES against NO;
  - the outcomes of one negative-risk event;
  - strike and date ladders;
  - a touch market against a terminal market.

  It never matched the same outcome listed twice in different events. The one cross-listing it touched was another
  venue (Kalshi, Smarkets), and Davies cannot trade there.
- **The same bet is listed twice far more often than expected**, and the two prices do differ at the asks. One
  snapshot of 1,232 relations across seven families, built from the events' structure with each family's clauses
  read by hand:
  - the clean ones (no known way for both legs to lose) gave **123 relations with a positive locked edge**;
  - together they could absorb **$17,840** of capital for **$125.70** of profit, 0.70 %;
  - almost all of it is the US midterms, which resolve around 4 November;
  - Polymarket charges no taker fee on politics or the Fed (Gamma's fee schedule, rate 0).
- **At our size it is pennies, and mostly once.**
  - $300 spread over the best eight relations would lock **$12.21 (4.07 %)**; $100 would lock $5.62.
  - Both are one-off, for the week to the election and the days its markets take to resolve.
  - The gaps stood through the whole recorded hour (§3.2), because each is a few dollars deep. There is nothing to
    race for.
- **The moving gaps are smaller still.**
  - On the last 14 days of the tape, a rule that sees only past prints and fills each leg at a later print would have
    made **$18.08** at up to $100 a signal, or **$25.92** at up to $300: 21 filled trades out of 196 signals.
  - That is about $9–13 a week, before anyone else gets there first.
  - Someone else already does: on 10-26 a bot bought balance of power's two "D House" lines together in 5-share lots
    every few seconds, at 0.65 + 0.25 = 0.90, while House-D control traded at 0.91–0.92.
- **Kalshi does not lead Polymarket at the minute scale on the matched markets this week.**
  - Levels agree to a median 0.5–0.75 ¢.
  - Changes correlate at |r| ≤ 0.10 at every lag from −5 to +5 minutes (≤ 0.07 at all but one).
  - Kalshi's 1-cent minute moves are not followed.
  - A Polymarket-only rule trading after them lost 0.08–0.54 ¢ a share.
- **Verdict: nothing here is a strategy worth building.**
  - The real edges are clause-protected pennies: a few dollars on a few hundred, once per election cycle.
  - The apparent large gaps between two single markets are clause traps. Example: Manchester City "relegated" 0.41
    against 0.48. The second market also pays on an expulsion that is later overturned.
  - The 4–9 ¢ seat gaps are sets of 6–9 thin brackets, a few dollars deep each.
  - Every trade would need a new order path on the Ireland account. That account is GROKPM's, armed, and nobody may
    trade it by hand.
  - §6 has a spec only so the question can be closed for good. The recommendation is not to run it.

## 1. What the earlier work covered, and what this adds

| relation | where | covered? |
|---|---|---|
| YES + NO of one market | fp4 S1/M1 | yes: dead by construction |
| outcomes of one negative-risk event summing to ≠ 1 | fp4 M5, PMOPPS §1 | yes: clauses, $1.26 a day at $1,000 |
| strike / date ladders inside one event | fp4 M6, PMOPPS §1 | yes: 0.93 ¢ at most |
| touch against terminal at one strike | PMSTATARB §3.1, S1 | yes: no locked pair; TOUCH-CAL failed (1,178 trades, −11.4 %) |
| the same market on another venue | fp4 S5, STATARB §4.3 | levels only: no taker arb, Kalshi not a venue for this account |
| **the same question listed in two events** (duplicates) | — | **new here (DUP)** |
| **a seat's party winner against the same party's margin brackets** | — | **new (SEATMOV)** |
| **a chamber or state against the combination events that contain it** (balance of power, oil × Senate, the Texas–Michigan–Maine combo) | — | **new (COMBO)** |
| **Fed meeting markets against the path combos and the count of hikes** | — | **new (FED)** |
| **"by a date" against the dated event's "not by that date"** | — | **new (BYON)** |
| **implications across events** (president ⇒ nominee 2028; Oscar win ⇒ nomination) | — | **new (NOMWIN, OSCAR)** |
| **Kalshi's minute moves against Polymarket's** | PMSTATARB §4.3 proposed it | **measured here (§4)** |

Not covered here either:

- sports game markets against series or parlay legs (no such pair found among the open events);
- a crypto "above X" market against the same day's price buckets (PMSTATARB's BUCKET-DIST family; S2 was never run).

## 2. Finding the pairs, and the clause check

### 2.1 The finder (`scripts/pull_open.py`, `compact.py`, `candidates.py`)

- **The pull.** Every open Gamma event: 22,764 events and 425,475 markets at 03:34 UTC.
- **The tradable slice.** 43,057 markets: active, accepting orders, ending after the pull, and with $1,000 or more of
  liquidity or $500 or more of 24-hour volume.
- **Text similarity.** TF-IDF over question words, scored only between markets of different events:
  - 4,375,682 pairs scored;
  - 600,297 at cosine ≥ 0.5;
  - 4,038 of those with identical word sets.
- **The noise.** Nearly all identical pairs are template questions in different games ("Games Total: O/U 2.5",
  "Exact Score: Any Other Score?"). Dropping sports templates and end dates more than a week apart leaves **26
  non-sports pairs**. They are:
  - true duplicates (§2.2);
  - "by a date" markets sitting in a dated event (BYON);
  - two district templates whose numbers happen to coincide.

  `results/candidates_summary.txt` lists the top pairs.
- **Rule parsing.** The structural families were built from event structure, not text (`scripts/relations.py`):
  - SEATMOV: 863 relations over 477 seat-winner events (441 House, 36 Senate) and 493 margin events. First-round
    margin events are left out, because a first round does not decide the winner.
  - OSCAR 274, NOMWIN 52, COMBO 16, FED 14, DUP 11, BYON 2.
  - 1,232 relations in all.
  - A seat whose margin event had an open bracket taking no orders would have been left out; there were none.

### 2.2 The resolution clauses, read by hand

Each relation is priced as **covers**: a set of legs bought at the asks that pays at least `floor` dollars a share in
every state the relation allows. A cover's **hole** is a state in which the two texts disagree and the cover pays less.

| relation | texts | verdict |
|---|---|---|
| MicroStrategy bankruptcy before 2027 (standalone vs "which companies") | wording only | **equivalent** |
| Anthropic / OpenAI acquired before 2027 (standalone vs list) | the OpenAI standalone also counts the nonprofit that controls OpenAI | equivalent / **near** |
| Trump meets Carney by Oct 31 (standalone vs "who will Trump meet") | the standalone defines a meeting more narrowly | **near** |
| Musk announces a run before 2027 (standalone vs list) | the standalone's window starts 2025-11-05 | **near** |
| Anthropic "not IPO by 2027", three closing-market-cap events | identical texts | **equivalent** |
| the same, against the IPO-valuation event | a direct listing is "No IPO" there, but a first trading day here | **not equivalent** |
| oil ≥ / < $80 and R Senate (standalone vs four-way event) | the standalone resolves 50-50 if Nov 2 is not a trading day; the event uses the prior day | **near** (Nov 2 is a Monday) |
| Manchester City relegated 2026-27 (list vs standalone) | the standalone also pays on an expulsion over the "115 charges" announced by 30 June, "regardless of whether it is later appealed or overturned" | **not equivalent**: the 7-point gap prices that state |
| seat winner (party) vs margin brackets (SEATMOV) | the winner market follows the party at the call and caucus intent; the margin market follows the D and R nominees' vote shares | **equivalent for "seat X NO + X's brackets YES"**; the reverse cover loses if a third party wins |
| Senate / House control vs balance of power | the same control rule; BoP adds an "Other" outcome | **equivalent** for "T.NO + S.YES" |
| Senate control vs oil 80 / oil 85 / Hormuz-and-oil-80 combos | the Senate component quotes the control market's rule word for word; Hormuz80's rules are a PDF (`urg.pdf`), read: the oil split is exhaustive | **equivalent** |
| TX / MI / ME winner vs the three-way combo | the combo resolves "Other" (listed, takes no orders) if a race is uncalled by 2027-03-31 or an independent wins | **equivalent** for "T.NO + S.YES" |
| Fed path combos (Sep–Oct–Dec) vs meeting markets | the combos ignore intermeeting moves; the meeting markets compare with the level before the meeting | **near** (implications) |
| "another hike in 2026" vs "how many hikes in 2026" ≥ 2 | the count stays open to Dec 31 and counts a 50 bp hike as two | **near**: a hike between Dec 10 and Dec 31 breaks it |
| Anthropic IPO by Nov 30 vs the IPO-date event's "not IPO by Nov 30" | "by" needs listing and trading; "date" uses the IPO launch | **equivalent for "both NO"** (that cover pays twice if pricing and listing straddle Nov 30) |
| next Fable model by Oct 31 vs "no release by Oct 31" | the same release definition | **equivalent** |
| president 2028 ⇒ nominee 2028; Oscar win ⇒ nomination | implications | **near** (an independent run; name variants) |

So the trap PMSTATARB named holds here too: the large gaps are clauses. The real ones are small.

## 3. The spread at tradable prices

Prices are the asks of the CLOB's live books (a NO leg at the NO book's ask), walked level by level with the same
shares on every leg. Each leg pays its market's taker fee, `rate × (p(1−p))^exponent` from Gamma's `feeSchedule`.
That is 0 on politics and Fed markets and 0.03 on the World Series.

### 3.1 One snapshot (`results/snapshot_summary.txt`, 04:21:05 UTC)

Every cover, holed or not; "capacity" and "profit" add up the relations whose best cover is positive.

| family | relations priced | best edge > 0 | ≥ 1 ¢ | ≥ 2 ¢ | median best edge | capacity | profit at capacity |
|---|---:|---:|---:|---:|---:|---:|---:|
| SEATMOV | 863 | 262 | 151 | 50 | −2.2 ¢ | $32,904 | $335.52 |
| COMBO | 16 | 7 | 0 | 0 | −0.7 ¢ | $7,887 | $38.99 |
| DUP | 11 | 5 | 1 | 1 | −0.4 ¢ | $1,169 | $8.05 (Man City $6.82, not equivalent) |
| BYON | 2 | 0 | 0 | 0 | −0.7 ¢ | — | — |
| FED | 14 | 0 | 0 | 0 | −6.1 ¢ | — | — |
| NOMWIN | 30 of 52 (22 had a leg with no ask) | 0 | 0 | 0 | −1.2 ¢ | — | — |
| OSCAR | 269 | 0 | 0 | 0 | −34.9 ¢ | — | — |

- The OSCAR and NOMWIN implications hold with room to spare: a nomination trades far above the win.
- SEATMOV's largest raw rows are "seat favourite YES + the other party's margin lines". They lose if a third party
  wins.

What a budget can lock on the clean covers (`results/allocate.txt`):

- One relation per seat or chamber is kept (its R and D versions are one trade).
- Budgets are filled greedily by edge per dollar.
- The profit is pro rata, so it is an upper bound: the walked edge falls as a relation fills.

- **The pool.** 123 clean relations: $17,840 of capacity for $125.70 (0.70 %).
  - SEATMOV: 116 relations, $12,528, $103.08.
  - COMBO: 3 relations, $4,536, $21.39. Senate control against the Hormuz-and-oil-80 combos is $3,977 at 0.8 ¢.
  - DUP: 4 relations, $776, $1.23.
- **By budget:**
  - $100: $5.62 (5.62 %), 5 relations;
  - $300: $12.21 (4.07 %), 8 relations;
  - $1,000: $26.83 (2.68 %);
  - $5,000: $69.75 (1.40 %).
  - Every one of them ends with the 2026-11-04 resolution.

The best clean relations are a seat's long-shot party bought in the margin event plus that party's seat NO. VA-03 is
the example. The seat market pays 0.976 for "not Republican" (its R bid is 0.024). The margin event offers the
Republican-wins line at 0.002. 0.976 + 0.002 = 0.978, so the pair locks 2.2 ¢ a share until the race is called:

- if the Republican wins, the margin line pays;
- if anyone else wins, the seat NO pays.

A few seats show 4–9 ¢ (TX-27, IA-02, FL-07, OR-02). Those are the margin event's own brackets underpriced as a set:
6 to 9 legs, each a few dollars deep.

### 3.2 How long the gaps stay open (`results/record_summary.txt`)

Every relation within 2 ¢ of a positive edge in the 03:46:55 snapshot (465 relations) was priced again each minute for
59 minutes (03:47:37 → 04:45:37 UTC). It was planned for four hours and stopped after one: by then the answer was
plain.

On the clean covers:

| family | relations | relation-minutes positive | of them ≥ 1 ¢ | positive all hour | ever positive | stretches opened in the hour | their profit at the opening minute |
|---|---:|---:|---:|---:|---:|---:|---:|
| SEATMOV | 420 | 6,847 of 24,780 (27.6 %) | 3,062 | 103 | 133 | 107 | $12.72 |
| COMBO | 10 | 163 of 590 (27.6 %) | 1 | 2 | 3 | 0 | — |
| DUP | 8 | 236 of 472 (50.0 %) | 0 | 4 | 4 | 0 | — |
| NOMWIN | 22 | 32 of 1,298 | 0 | 0 | 1 | 1 | $0.01 |
| FED | 3 | 0 of 177 | 0 | 0 | 0 | 0 | — |

- **The gaps stand.** SEATMOV's positive stretches ran a median 24 minutes, and 103 relations were positive in all 59.
  The ones that opened during the hour were worth $12.72 together at their opening minute, at full capacity.
- **Nobody races for them** because there is nothing to race for: the median capacity while positive is $78 a relation.
- Counting the holed covers too, 62.1 % of SEATMOV's relation-minutes were positive. That extra is the third-party state
  being priced, not a gift.

### 3.3 The tape (`results/history_14d_summary.txt`, `results/history_strict.txt`)

- **The tapes.** Every market in the COMBO, DUP and FED relations, and in any relation within 0.5 ¢ of positive.
  That is 1,557 markets and their last 14 days of taker prints (10-13 → 10-27). No tape hit the API's offset cap.
- **Reading a print.** A taker BUY at p shows that token's ask at p. A taker SELL at p shows the other token's ask at
  1 − p.
- **The upper bound (`history.py`).** Each leg's cheapest print within ±2 minutes of an anchor print. This looks
  ahead and picks the best of many prints:
  - COMBO: 151 positive minutes;
  - FED: 85;
  - SEATMOV: 50 (one-off prints in 42 covers);
  - DUP: 23;
  - in all $410 at the full print size over 14 days. Most of FED's is "another hike" against the count of hikes:
    19 episodes, up to 6 ¢.
- **Without hindsight (`history_strict.py`).**
  - The signal: the latest ask print of every leg, all within 2 minutes, sums to more than 0.5 ¢ under the floor.
  - The fill: each leg at its first ask print 2 s to 2 minutes later. That still assumes our order would have come
    before the taker who printed.
  - 196 signals; in 21 every leg printed again in time, and 20 of those were still positive.
  - **$18.08 over 14 days at up to $100 a signal, and $25.92 at up to $300.**

| family | signals | every leg filled | fill edge > 0 | mean fill edge | P&L ≤ $100 a signal | ≤ $300 |
|---|---:|---:|---:|---:|---:|---:|
| COMBO | 79 | 8 | 8 | +1.31 ¢ | $7.49 | $15.32 |
| FED | 47 | 11 | 10 | +3.88 ¢ | $8.95 | $8.95 |
| DUP | 22 | 1 | 1 | +1.61 ¢ | $0.08 | $0.08 |
| SEATMOV | 48 | 1 | 1 | +1.58 ¢ | $1.57 | $1.57 |

The tape also shows who already takes the standing gaps. On 10-26 01:22:27–01:23:53 UTC, BoP "D Senate, D House" (at
0.65) and BoP "R Senate, D House" (at 0.25) printed taker buys of exactly 5 shares, at the same second, every 3–8
seconds: 15 pairs. That is "Democrats win the House" bought for 0.90 through balance of power while the House market's
D side traded at 0.91–0.92. It is a bot working this relation.

## 4. Kalshi as a clock (`results/kalshi_lead.txt`)

The matched pairs:

- the Fed's October decision (no change; +25 bp);
- Senate control (R);
- House control (R);
- the Texas Senate race (R).

Kalshi's rules were read only as far as their titles and settlement sources: the Federal Reserve for the decision,
the Library of Congress for chamber control. That is enough for a price reference, which is all Kalshi is here.

Seven days of joint minutes, 10-20 → 10-27 (about 10,100 a pair):

- Kalshi: 1-minute candles, mid = (yes bid close + yes ask close) / 2.
- Polymarket: the size-weighted price of each minute's prints, carried forward.

| pair | median \|K − P\| | hourly-change corr | 1-min corr, lags −5…+5 | 5-min corr, lags −3…+3 | Kalshi ≥ 1 ¢ minutes | Polymarket's share of the move by t+15 (median) | rule after them, t+15 |
|---|---:|---:|---|---|---:|---:|---|
| Fed Oct, no change | 0.50 ¢ | 0.25 | −0.013…0.023 | −0.015…0.067 | 22 | 0.00 | n 8, −0.54 ¢, 0 positive |
| Fed Oct, +25 bp | 0.50 ¢ | 0.42 | −0.012…0.056 | −0.027…0.064 | 31 | 0.00 | n 7, −0.08 ¢, 2 positive |
| Senate R | 0.50 ¢ | 0.13 | −0.028…0.023 | −0.018…0.036 | 22 | 0.00 | n 2, −0.25 ¢ |
| House R | 0.75 ¢ | 0.07 | −0.014…0.010 | −0.048…0.040 | 0 | — | — |
| Texas Senate R | 0.50 ¢ | 0.06 | −0.018…0.018 | −0.102…0.040 | 19 | 0.00 | none entered |

- **The levels agree**, as STATARB found on deeper books.
- **The minute changes are noise against each other.** The week was quiet: each market's range was 2–11 points over
  seven days.
- **Kalshi's 1-cent minute moves are not followed.** Polymarket made a median 0 % of them within 15 minutes, and
  moved first in 0–5 of them. Most look like Kalshi's own spread flickering.
- **The Polymarket-only rule** bought at the next ask print after such a minute, marked 15 and 60 minutes later. It
  never averaged above zero.
- **Not seen:** a news minute. The FOMC statement on 10-28 at 18:00 UTC falls after this read. On a minute like that,
  PMSC's lesson applies: both venues reprice inside a second, before any minute rule.

## 5. Verdict

- **Expected P&L at our size (tens to a few hundred dollars):**
  - **Standing gaps:** about **$12 on $300, once**, locked for one to four weeks until the midterm markets resolve.
    After 4 November the pool is nearly empty until the next large election.
  - **Moving gaps:** about **$9–13 a week** on the 14-day tape. That is generous: it assumes we are first to every
    print, and bots already work the deepest pair.
  - **Kalshi lag:** nothing to trade. No lead was found in a quiet week, and a news-driven lead would be sub-second.
- **Capacity:**
  - $18k of clean capacity in the whole snapshot, at 0.7 %;
  - the best relations are $8–$330 each;
  - legs at 0.002 are a few hundred shares deep.
- **The main risks:**
  - *Resolution mismatch*: the expulsion clause; IPO pricing against listing; Dec 10–31 hikes; "Other" outcomes that
    take no orders. Every gap over 3 ¢ between two single markets that was checked was one of these.
  - *One leg filled*: covers of 3–9 legs in books a few dollars deep; a miss leaves a naked long-shot or favourite.
  - *Oracle and timing*: margin markets wait for certified results, and UMA disputes on close races. Capital stays
    locked past the seat call.
  - *Access*: the Ireland order path is GROKPM's account, armed; a hand trade there is forbidden.
- **What it would take:** a new order path (a build), Davies' go and his attestation.
- **Plainly: no tradable same-bet stat-arb exists at our size.** There are pennies, real but tiny, and they have
  owners.

## 6. If Davies wants the question closed for good: a paper recorder (spec only, not built)

**SAMEBET-REC.** The recommendation is not to build it; it is written so the decision is explicit.

- **What it records.** Once a minute, keyless:
  - the CLOB books of every relation that `relations.py` builds from the open events, rebuilt daily (new events
    appear);
  - its covers priced as `books.walk` does;
  - no order.
- **Window.** 28 days from its start. That would take in the Fed's December meeting cycle and the midterm
  resolutions if it started before 4 November.
- **Paper fills.** A cover enters on paper only when:
  - its clean cover's touch edge is ≥ 1 ¢ for two consecutive minutes (the second minute is the fill, at that
    minute's walked asks);
  - $100 at most a relation;
  - $300 at most open at once;
  - it is held to resolution.

  The P&L is booked at resolution from Gamma's outcome prices.
- **Bar, fixed in advance.** Continue only if all three hold:
  - realised P&L ≥ $20 over the 28 days at those caps;
  - no relation's clause breaks (a cover paying under its floor);
  - ≥ 10 relations entered in ≥ 3 different families.

  Otherwise the family closes.
- **Cost.** One Edge call a minute and one table. Inputs, not conclusions, as the house rule says.

## Not checked

- **Fills against queue position.** The record prices the visible asks; a gap a few dollars deep can be gone before
  any order arrives (the 5-share bot).
- **The Fed's October decision itself** (Oct 28, 18:00 UTC). It is the one minute in the Kalshi pairs that would
  have moved by more than a cent. It falls after this read.
- **Sports.** No game, series or parlay pair was matched; the finder's sports hits were template questions.
- **Closed events** (a historical version of SEAT and COMBO in earlier elections). The data API's offset cap stops the
  tape of high-volume markets after the newest ~10,500 prints, so a long history of the Fed meeting markets is not
  keyless from it.
- **Crypto "above X" against the same day's buckets**: BUCKET-DIST's family, left to its spec.
- **Spain, Israel and other foreign-election winner markets** against their seat-count events: same shape as COMBO,
  not built.
- **Kalshi's own fees and depth**: irrelevant, since it is not a venue here.
