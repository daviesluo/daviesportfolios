# LP-RULES: every live rule of "Reward quotes live-prep", audited on all the data there is

Research only (2026-10-11, read 00:49–01:10 UTC). No live path, config or migration changed. Every database read was a
read-only `select`; no order was placed or cancelled. SQL, data, scripts and outputs are in
`docs/agents/backtests/lprules/` (`MANIFEST.json`). Code read: commit `7db0e575` (`pm_lp.ts` and `pm_live.ts` at Addendum
17's bytes). Not blind: every record here had been read before. Nothing here is applied: Davies decides.

Davies, 2026-10-11, verbatim:

> 确保根据目前最新的全部所有数据和经验目前的rules是最好的最佳效果的设定

In English: make sure that, on all the latest data and experience, the current rules are set for the best result.

## Verdict

- **No rule should change today.** On every rule, either the evidence favours the current setting, or the best
  alternative is inside the noise of two live days and five to fourteen replayed days. Each such alternative has a
  forward read with a date below.
- **The setting is not proven profitable.** Since the go (2026-10-09 01:32 UTC, 47.3 hours), live-prep made **+$0.92**:
  - fills −$34.28, marked at the mids;
  - rewards +$28.41;
  - maker rebates +$6.79.
  One market, MrBeast wk1, is −$19.33 of it. Without it the rest made about +$10 a day. Two days cannot tell those
  apart.
- **R is 0.737** (28.41 paid over 38.58 of like-for-like formula). The market-day bootstrap gives [0.696, 0.813]. The two
  days read 0.807 and 0.718.
- **Earlier decisions, re-priced at the live R, keep their sign.** The studies were priced in their own formula units.
  Polymarket cut programmes through the day, so the live 0.737 is about 0.44 in LP-ALLOC/LP-REFILL's simulator. On RW's
  record it is about 0.27, and at most 0.74.
  - At those R, no adopted rule's alternative crosses zero, with one exception, sign only: keeping same-day markets would
    be positive (+$3.51 a day) if Polymarket had not cut programmes. With the cut it is −$13.30 a day.
  - So the R = 0.40 the studies chose on was not too pessimistic for the live account (`results/reprice.txt`).
- **The largest open lever is capital, not a rule's number.** At 00:49 UTC 10-11:
  - $284 of stock is held at cost. $133.60 of it is from 10-10's refills, which mostly earn nothing now.
  - The cap leaves $37.53 for resting buys (pUSD − $80).
  - Today's picks need $205.60. In the ten minutes after Addendum 17 deployed, 74 of 100 quoting market-minutes rested
    nothing.
  - What to do about it is a risk decision, and the studies conflict on it. It is the first forward read below.
- **No defect found.** In every rule read, the code does what its rule and addenda say. Four observations are listed;
  none is a departure from a written rule.
- **The coordinator's case (a selected market in a one-tick book holding stock rests no exit)** is a rule question, not
  a defect. Addendum 16 left selected markets as they were, deliberately. Verdict: keep.
  - On the live record that state lasted 1,753 market-minutes in 15 markets, $13–26 held on average.
  - Holding gained +$21.24 at the mids, against the 0.47 ¢ a share an exit at the best ask would have taken over the mid.

## The live record (`results/day_pnl.txt`, `results/market_pnl.txt`)

| UTC day | fills, marked | rewards | rebates | net | formula (like for like) |
|---|---:|---:|---:|---:|---:|
| 10-09 (from 01:32) | +3.94 | 6.52 | 1.98 | **+12.44** | 8.08 (153.90 at the 00:00 programme) |
| 10-10 | −35.07 | 21.89 | 4.82 | **−8.37** | 30.49 |
| 10-11 (to 00:52) | −3.15 | — | — | −3.15 | — |
| total | −34.28 | 28.41 | 6.79 | **+0.92** | 38.58 |

By group (each market at its latest mark; MrBeast wk1 at its payout):
- **MrBeast wk1** (`0x3090f7aa`, 10-10's rank 1, ends 10-11 03:59 UTC, resolved YES 10-10 18:02): 1,394.8 shares filled.
  Its fills lost −$32.54; it was paid $10.50 in rewards (48 % of the day's) and $2.71 in rebates. Net **−$19.33**.
- **10-10's other nine picks:** +$1.80.
- **10-10's ten refills:** +$15.38. That is $6.24 of rewards, $0.69 of rebates and +$8.46 of fills, of which $8.66 is
  still unrealised on held stock.
- **AI markets** (four on 10-09, one on 10-10): −$4.76.
- **The ten 10-09 picks less AI:** +$6.38.

## R (`scripts/r_bootstrap.py`, `results/r_bootstrap.txt`)

- **Pooled: 0.7366.** That is 28.414 paid over 38.575 of formula. 10-09 is taken like for like (Addendum 10's
  `LP_R_DAY_CORRECTIONS`) and 10-10 on the whole formula, as the brief's 0.737.
  - Without MrBeast wk1 (R 0.688): 0.768.
  - The median of the 28 market-days with more than $0.05 of formula: 0.796.
- **Market-day bootstrap** (4,000 draws, seed 20261011): 5th/50th/95th percentiles 0.696 / 0.739 / 0.813. It cannot
  see a day-wide regime, so read the honest band as about 0.6–0.9.
- **Not in R:**
  - Maker rebates: $6.79, 0.176 of the formula. They come with fills, and no study counted them.
  - Polymarket paid $0.26 for one-sided carried sells that RW's formula scores 0.
- **The page's R reads the scored formula.** `lpLiveR` rests on `formula_scored_usd` (10-10: 29.14), which pooled gives
  0.763. The brief's 0.737 uses the whole formula. Both are defensible; this audit uses 0.737.

## The rules, one by one

$ a day is the change from the current rule, at R ≈ 0.74 live. That is ≈ 0.44 in LP-ALLOC/LP-REFILL units, and 0.27
(programme-cut) to 0.74 in RW-record units. "Confidence" is in the sign.

| rule | current | best alternative tested | $ a day of the alternative | confidence | verdict |
|---|---|---|---:|---|---|
| ranking | RW's first-round reward per dollar, formula ≥ $2.50 | steady-programme check at selection (LP-ALLOC) | −3.6 | moderate | **keep** |
| markets / budget | 10 / $200 | 8 / $160 (Phase A); 15 (LP-ALLOC) | −1.7 to −2.5; −3.3 | moderate | **keep** |
| AI markets | out (Addendum 12) | keep them (LP-ALLOC re-priced) | −4.25 [−4.49, −3.81] | moderate | **keep** |
| weather markets | out | keep them (Phase A) | −2.26 to +0.27 | low | **keep** |
| same-day rule | out the UTC day of the end | keep same-day (Phase A) | −13.30 to +3.51, R* 0.64 | low–moderate | **keep** |
| end horizon | none (RW-E's same-day only) | 48 h horizon (Phase A); no buy ≤ 24 h (LP-REFILL) | −2.2 to −6.7; −15.6 | low | **keep; read near-end inventory by 10-23** |
| game start | none within 48 h | — (no live sports market) | — | none | **keep** |
| refill | 00:00 reserve of 30, after 15 min, 10 a day, 1 a turn | no refill (LP-REFILL re-priced); A13's live re-rank | −4.93; +1.42 | low | **keep; read its next-day cost 10-11 → 10-13** |
| ranking time | once a day after 00:00 (Addendum 15) | every 5 min (A13) | +1.42, with formula collapsing | low | **keep** (Davies' word) |
| price rule | RW's: a tick inside the touch, at least half a tick off the mid | one tick back (LPSELF) | −4.6 | moderate | **keep** |
| TB1's skip | nothing rests in a one-tick book | remove it | −0.83 to +2.25 (live); −0.88 to −6.33 (studies) | low | **keep; C1 on 10-23** |
| selected one-tick market holding stock | rests nothing (Addendum 16 left it) | rest the exit sell at the best ask | ≈ −10 (holding gained $21.24 in 47 h) | low | **keep** (rule question, not a defect) |
| size | N = max(minimum, 5) ≤ 20 | N up to 50 (LP-ALLOC) | −9.97 | moderate | **keep** |
| side cap | 5N | 3N (Phase A, LP-ALLOC); 7N/8N (Phase A, LPSELF) | −4.5 to −8.5; +0.2 to +2.1 | low | **keep** |
| pause | 15 ¢ jump → 60 min | none (Phase A) | −5.3 at any R | moderate | **keep** |
| near-certain buys | ≥ 0.95 only within 8 % of capital | 10 %–12.5 % (EXPENSIVE-LIMIT) | within ±0.2 | low | **keep** |
| carried exits | close-only sells; in one-tick books too (Addendum 16) | hold carried (Phase A) | −7.5 to −30 | high | **keep** |
| total cap | floor(equity − $75 − $5), up on two readings | +$80 of buy budget (LP-CAPINV); $400 (LP-REFILL) | +11.1 central; −2.7 | conflicting | **needs data; Davies' risk call** |
| funding order | whole markets in rank order (Addendum 17) | slot-key order (before) | −3.9 central | moderate | **keep** |
| market cap | $100 | $60 (Phase A) | −1.2 to −1.9 | moderate | **keep** |
| total stop | −$75 on fills plus rewards paid; no day stop | the path's day stop (Phase A) | −19 to −57 | high (sign); size is Davies' | **keep** |
| loss guard | no BUY at a $10 marked loss (Addendum 14) | $7.5 / $5 / none (LP-REFILL) | −4.0 / −11.6 / −0.5 | moderate | **keep** |
| reward check | each minute; backstop at 3 minutes not scoring | at 00:00 only (as before Addendum 9) | 10-09's R 0.04 → 0.81 like for like | high | **keep** |
| settlement | booked at payout on Gamma's close; redeemed by hand | redeem every 72 h, not daily (Phase A) | −7 (at R 1) | moderate | **keep; redeem daily** |
| R estimate | prior 0.2–1, two days' weight, on the scored formula | — | 0.737 [0.696, 0.813] | — | measurement |

### Notes, with the evidence for each

- **Re-pricing the studies** (`scripts/reprice.py`). Each arm's difference is linear in R: Δ = ΔFills + R × ΔFormula.
  Two published R fix it. The results:
  - break-evens R*: buy-only 0.17, the day stop 0.04, holding carried 0.11, the 48-hour horizon 0.04, keeping same-day
    0.64, keeping weather 0.69, removing TB1 0.82–0.85, keeping AI 0.88 (simulator units), 3N and no pause never;
  - RW-record units at the live account are about 0.27. LP-ALLOC measured Polymarket's cut at 64 % of the formula on
    today's rule; with no cut they would be 0.74.
  - The same-day rule is the only arm whose sign depends on which of those holds.
- **Selection.** Rank predicts payment on the one day with the reward check: 10-10's top three realised 0.378 of their
  selection-time formula, the rest 0.099 (LP-CAPINV `realisation.txt`).
  - Programmes still flicker. `0x0386c36c` read 2 a day from 00:06 to 00:21 on 10-11 and was refilled. At 00:49 it read
    27, and as a replaced market it takes no entry for the rest of the day.
  - Ranking on a rate that does not flip remains Davies' open question (LP-ALLOC priced a 3-hour steadiness test at
    −$3.64 a day).
- **AI out.** Live, the AI markets came to −$4.76 with their rewards counted. The worst was Anthropic #1: 111.53 YES,
  −$12.80 on its fills.
- **End date.** Live-prep has no end horizon. RW-E's same-day rule is in UTC, so a market ending at 03:59 UTC on D + 1
  (US Eastern midnight) passes it on D. MrBeast wk1 was one such market.
  - Live, the 12–24-hour bucket was −$67.84 of fills against $7.00 of 10-10 formula (`results/end_horizon.txt`). It is
    that one market.
  - Live-prep's paper fills in the last 24 hours came to +$11.48 (33 buys among them).
  - LP-REFILL priced "no buy within 24 h" at −$15.6 a day.
  - So the record cannot price a near-end rule yet. Read it again by 10-23 on live markets only.
- **Refill.** On 10-10 the refill took ten markets between 14:23 and 14:52. They netted +$15.38, mostly unrealised. They
  left $133.60 of stock, which today holds the cap (below). LP-REFILL's simulator foresaw exactly this: its 00:00
  reserve held $157–$288 at each close. Its forward test (three live days) is the read.
- **TB1's skip** (`results/tb1_forgone.txt`). Selected markets sat in one-tick books with nothing resting for 2,713
  market-minutes on 10-09 and 2,442 on 10-10 (39 % of 10-10's quoting minutes).
  - Joining the touch there would have scored $7.34 of formula on 10-10, $5.41 at R.
  - The studies put the fills it saves at 0.43–0.85 of the formula it gives up, so removing it moves a day by −$0.83
    to +$2.25.
  - C1 reads it on RW-C's fourteen days after 10-23.
- **5N** (`results/inv_zone.txt`). 33 live buys filled with the inventory already past 3N its way, 569.5 shares.
  - At 60 minutes they marked −3.15 ¢ a share against −1.79 ¢ for buys under 3N: about $7.7 worse over 47 hours.
  - At 6 hours they marked +11.2 ¢, the MrBeast settlement swinging both.
  - On 10-10, 3N would have left one side alone in 425 quoting minutes that scored $8.68.
  - The live record cannot sign it. Every replay says 3N costs (Phase A −$4.5 to −$8.5 a day at the live R; LP-ALLOC
    −$8.30 [−18.25, −1.44], 0 of 5 days).
- **Pause** (`results/pause.txt`). 25 episodes. Most re-triggers are flicker in thin books: `0xa0ab5c59` six times,
  already out, and the next hour often undid the jump (−9.5 to −15.6 ¢).
  - What it gave up on 10-10 is at most $5.90 of formula ($4.35 paid).
  - It held MrBeast wk1 out of a 15 ¢ jump at 06:02 that went another 19 ¢ in the hour. 5N quoted into that is up to
    100 shares filled the wrong way.
  - Phase A's plateau was positive in 20 of 20 cells at R 0.40.
- **Capital** (`results/capital.txt`, LP-CAPINV). The cap reduces to "resting buys ≤ pUSD − $80". At 00:49 UTC:
  - equity $402.30; pUSD $117.53, so $37.53 for buys;
  - held at cost: $105.80 from 10-09 and before, $133.60 from 10-10's refills, $44.76 bought today.
  - In the ten minutes from 00:50, after Addendum 17's deploy, 26 of 100 quoting market-minutes are two-sided, and no
    market rests a lone buy (82 before it).
  - LP-CAPINV prices +$80 of budget at +$11.1 a day central. LP-REFILL/LP-ALLOC find more capital buys inventory, not
    reward (−$2.7 a day at $400 against $300). The record cannot settle it, and the margin is the stop's money.
- **Stop.** The basis now is −$33.33 (the path's fills) plus $28.41 paid, so −$4.92 of −$75 is used.
  - The worst live day was −$8.37.
  - The stop counts no rebates ($6.79), which errs on the safe side.
  - The largest market reached $97.14 at cost (10-09, the near-certain Iran NO), and under $80 since.
- **Loss guard and backstop.** Neither has fired live since its deploy (`results/rule_minutes.txt`).
  - LP-REFILL's replay of the live episode: the guard would have cut MrBeast wk1 from −$36.91 to −$8.95.
  - The reward check took 7,073 market-minutes out on programme cuts on 10-10 (rates to 2–6 a day, minimums 50–100,
    programmes ended).
  - MrBeast wk1 was out for an ended programme by 14:07 at the latest, about four hours before it resolved. From then
    the check stopped its buys.

## The coordinator's case: a selected market in a one-tick book that holds stock (`sql/tight_held.sql`)

At 01:00 UTC on 10-11, rank 3, `0x58dc3bc0` (book 0.51/0.52), held 65 YES (about $33) and rested nothing. TB1's skip
empties `lpQuotes`, sells included, and Addendum 16 changed only close-only markets: "A selected market still quoting is
untouched." So the code does what the addendum says.

**The state on the live record.** In 1,753 market-minutes, 15 markets:
- 10-09: 808 market-minutes, $26.32 mean held, $77.64 peak.
- 10-10: 887 market-minutes, $13.29 mean held.
- 10-11 to 01:03: 58 market-minutes, $23.33 mean held.

Beside it, 3,488 such minutes held nothing (rank 9's shape).

**What holding did.** Holding times the mid's move to the next minute, summed, was **+$21.24**.
- The two AI markets of 10-09 were +$14.99 of it. Without them it was +$6.25.
- `0x58dc3bc0` itself was +$3.45 in 38 minutes.
- An exit at the best ask would have asked 0.47 ¢ a share over the mid on average: about $0.09 a fill of 20.
- It fills when the price rises through it, the move holding earned.

**Verdict: a rule question, not a defect. Keep the rule as it is.** Extending Addendum 16's exit to selected markets:
- on this record would have given up the drift for a half-tick;
- frees $13–26 of budget on average while the cap binds.

Read it again with LP-CAPINV's forward test if the cap is still binding on 10-13. The capital it frees is then the
argument, not the price.

## Defects

None found. Where the code was read against its rule (selection, `lpCandidateOf`, the same-day rule, the pause, the loss
guard, the refill's out test and budget, the caps, `isTight`), it does what the pre-registration and Addenda 2–17 say.

Observations, not departures from a written rule (each Davies' call, none urgent):

1. **The pause also empties a close-only market's exit** (`pm_live.ts`, "Paused (live-prep): nothing rests in the market
   this minute"). It covered 401 paused market-minutes with stock held; 41 were in a market taken out that day.
   Addendum 16's exit rule does not reach a paused market.
2. **The refill's budget test is the $200 of first quotes, not cash.** At 00:21 on 10-11 it took `0x85b5135d` (rank 11)
   while $37.53 was left for buys. Under rank order a refill is funded last, so it can rest nothing. Meanwhile the
   market it replaced takes no entry all day.
3. **The page's R and the brief's R differ:** 0.763 on the scored formula, 0.737 on the whole one.
4. **The stop leaves out maker rebates**, $6.79 so far.

## Changes, ranked by value

None is proposed for today. In order of the money at stake, what would change a rule, and when it is read:

1. **Capital held by carried stock** (about +$4 to +$11 a day if solved; the sign of a bigger budget is disputed).
   - **Read:** Addendum 17's forward test, 10-11 → 10-13 (`pm_lp_minutes`).
   - **Trigger:** if the buy budget is under half of the picks' first-quote capital in most minutes and the day's
     formula stays under $20, put three options to Davies, none of them priced on a live record yet:
     - (a) the $5 + $75 margin cut to a smaller cash reserve, with the −$75 stop unchanged;
     - (b) no refill while held stock at cost passes about $150;
     - (c) carried stock crossed at the day's roll, about 4.6 % of it (LP-CAPINV: $10.66 on 10-11's $231).
2. **Re-selecting every 6 hours.** +$20 to −$0.7 a day across units; LP-ALLOC warns its gain was a fills windfall.
   LPRESEL6 reads it on or after 10-23 as frozen.
3. **TB1's skip.** −$0.8 to +$2.3 a day. C1 reads it after 10-23.
4. **A near-end rule** (no new inventory within about 24 hours of the end, or a smaller side cap there). One live
   market, −$19.33 net, against LP-REFILL's −$15.6 a day for a full ban. Re-read on live markets by 10-23.
5. **3N against 5N.** The live 60-minute and 6-hour markouts disagree. Re-read at 14 live days (10-23).

## Not checked

- No new simulator run. The pm-rec record was not rebuilt; every counterfactual here is closed-form on recorded minutes,
  or a re-pricing of a study's own published figures.
- What fills TB1's skip, the pause or a selected-market exit would have taken: the live record has no fills for
  minutes in which nothing rested.
- R in RW-record units is an estimate: LP-ALLOC's 64 % programme cut, applied whole.
- The 14-day readout of the pre-registration ("Live: what is read"), due at 14 live days (10-23).
