# PMPOST: the Polymarket reward strategies, a post-mortem, and whether any viable strategy exists

Research only (2026-10-15, read 15:10–15:40 UTC). Nothing was placed, cancelled, armed or changed:

- every database read was a read-only `select`;
- every Polymarket read was a keyless public GET (Gamma, the CLOB's sponsored listing, a public Polygon RPC);
- no config, code, migration or frozen file was touched.

SQL, data, scripts and outputs are in `docs/agents/backtests/pmpost/` (`MANIFEST.json`). Not blind: every record and
every earlier study was read first. Nothing here is applied: Davies decides.

Davies, 2026-10-15, verbatim:

> 深度复盘研究下polymarket reward的策略，以及研究到底有没有真正可行的策略

In English: a deep post-mortem of the Polymarket reward strategies, and research into whether any truly viable strategy
exists.

## The answer in plain words

- **No viable Polymarket strategy exists at this account's size on any evidence we have. Stop.**
- **Both live phases lost, and the loss was structural, not bad luck.**
  - S2, live-prep's busy books (10-09 → 10-12), lost **−$21.45 a quoting day** (market bootstrap 5–95 %
    [−44.47, +0.68]).
  - Q2, the quiet books (10-13 → 10-15), lost **−$10.89** [−19.96, −2.61].
  - In both, the taker who filled us knew more than we did:
    - in S2 the mid moved against 40 of the 42 filled markets within one minute (P ≈ 2 × 10⁻¹⁰ under a coin);
    - in Q2 the price walked away over hours, and 15 of 16 lots lost (P = 0.00026).
  - Polymarket paid 0.66 ¢ (S2) and 0.51 ¢ (Q2) of rewards a filled share. Breaking even needed 1.66 ¢ and 2.65 ¢,
    2.5 and 5.2 times what was paid.
  - **Bad luck** is about $19 of the $85: MrBeast wk1's one-day resolution path. Without it the account still lost
    $66.
- **The account.** $402.03 was deposited; it stands at **$316.55** at the marks, **−$85.48 (−21.3 %)**:
  - fills −$149.55: spread earned +$109.80, the first minute after each fill −$218.11, drift while held −$40.34,
    settlement jumps −$0.89;
  - rewards +$49.83, maker rebates +$14.29, fees $0.
  - It reconciles to 5 cents.
- **Why paper and the simulators were wrong.**
  - **S2:** paper's reward per filled share was 8 times too high. The cap was held by carried stock, and paper saw
    only half the fills. Polymarket's R was fine: 0.71 of the path's own formula.
  - **Q2:** the simulator, calibrated on busy books, missed how informed quiet-book takers are over hours: −2.83 ¢ a
    share live against its −0.43 ¢. It also saw only about a quarter of the fill volume.
- **No untried design clears zero.**
  - Each of these is negative or worth cents a day on LP-BEST's calibrated engine and on the live fills: quoting far
    from the touch, one-sided quotes, hedging fills at once (complements included), immediate exits, sponsored-only
    pools, and markets near resolution.
  - Far quotes need Polymarket to pay at least 0.54–0.71 in the engine's units. Live paid 0.42 in S2 and about 0.24 in
    Q2. Even with no friction at all, the best of them is worth about $0.18 a day at ten markets.
- **Beyond rewards, nothing on the closed lists was closed wrongly** in its verdict. One premise was wrong: dispute
  times are readable keylessly on-chain.
- **What is still untested, each closing on a FAIL.** These are paper-free historical tests and none is a strategy:
  - TOUCH-CAL and BUCKET-DIST (PMSTATARB);
  - a dispute-timing re-read (§5).
- **For Davies to decide:**
  - Let the remaining $15.5 of lots exit or settle; redeem the winners.
  - Leave the ~$300 idle or withdraw it.
  - Turn the reward recorder and the reserve call off once LPRESEL6 has read on 10-23.
  - Run no further Polymarket reward test, paper or live.

## 1. The live record, taken apart

### 1.1 By phase (`sql/decompose_phase.sql`, `results/decompose.txt`)

Each of the 477 fills was a maker's at fee rate 0. Each is split exactly into four parts:

- **spread**: what we were paid against the others' mid when hit;
- **first minute**: the mid's move in the next minute;
- **drift**: from then to the end;
- **settlement**: the jump at the payout.

The mids are the others' raw touch midpoints from live-prep's own minute rows. A market's fills, rewards and rebates
go to the phase of its first live fill, so an S2 lot sold in the close-only spell counts as S2's.

| phase | fills | shares | spread | first minute | drift | settlement | fills P&L | rewards | rebates | fees | **net** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| S2 (busy books, 10-09 01:32 → stop 10-12 07:30) | 437 | 6,986 | +96.41 | −202.88 | −21.32 | −0.89 | −128.68 | 46.06 | 12.96 | 0 | **−69.66** |
| Q2 (quiet books, 10-13 13:25 → 10-15 00:08) | 40 | 738 | +13.39 | −15.23 | −19.02 | 0.00 | −20.86 | 3.76 | 1.33 | 0 | **−15.77** |
| all | 477 | 7,724 | +109.80 | −218.11 | −40.34 | −0.89 | −149.54 | 49.82 | 14.29 | 0 | **−85.43** |

Per filled share:

- S2: spread +1.38 ¢, first minute −2.90 ¢, held −0.32 ¢, rewards 0.66 ¢, rebates 0.19 ¢.
- Q2: spread +1.81 ¢, first minute −2.06 ¢, held −2.58 ¢, rewards 0.51 ¢, rebates 0.18 ¢.

### 1.2 By UTC day (`sql/decompose_day.sql`)

| day | phase | fills | spread | first min | drift | settle | fills P&L | rewards | rebates | **net** | held at mark, end |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10-09 | S2 from 01:32 | 77 | +13.29 | −22.44 | +25.31 | 0 | +16.17 | 6.52 | 1.98 | **+24.67** | 198.97 |
| 10-10 | S2 | 138 | +27.45 | −54.82 | −17.71 | −0.39 | −45.48 | 21.89 | 4.82 | **−18.77** | 242.47 |
| 10-11 | S2 | 130 | +36.34 | −81.99 | −10.79 | −0.42 | −56.86 | 9.68 | 3.23 | **−43.95** | 134.92 |
| 10-12 | S2 to 07:30, then exits | 91 | +18.71 | −43.79 | −18.50 | +0.01 | −43.57 | 7.96 | 2.94 | **−32.67** | 36.30 |
| 10-13 | exits; Q2 from 13:25 | 17 | +5.12 | −10.24 | +3.18 | −0.09 | −2.03 | 0.89 | 0.62 | **−0.52** | 82.71 |
| 10-14 | Q2 | 21 | +6.29 | −7.98 | −16.71 | 0 | −18.40 | 2.87 | 0.72 | **−14.81** | 24.27 |
| 10-15 | Q2 to 00:08, then exits | 3 | +2.60 | +3.15 | −5.13 | 0 | +0.62 | — | — | **+0.62** | 22.39 |

Notes on the day table:

- The first minute cost more than the spread earned on 6 of 7 days. The exception, 10-15, had 3 fills.
- The settlement column is near zero because each market's mid had already gone to its payout before Gamma closed it.
  The resolution losses (MrBeast wk1's above all) are in drift.
- 10-15's rewards for Q2's last 8 minutes arrive after 00:05 on 10-16.

### 1.3 Structural or bad luck (`scripts/phase_boot.py`, `scripts/signs.py`)

| | S2 | Q2 |
|---|---|---|
| net a quoting day | −21.45 [−44.47, +0.68], P(> 0) 0.056 | −10.89 [−19.96, −2.61], P(> 0) 0.014 |
| without its worst market | −15.50 a day (MrBeast wk1, −19.33) | −6.44 a day (0x7465aead, −6.44) |
| first minute negative | 40 of 42 markets (P ≈ 2 × 10⁻¹⁰) | 6 of 10 |
| market net negative | 28 of 42 (P 0.022) | 9 of 10 (P 0.011); 15 of 16 lots (P 0.00026) |
| rewards a filled share: paid / needed to break even | 0.66 ¢ / 1.66 ¢ (2.5×) | 0.51 ¢ / 2.65 ¢ (5.2×) |

**Structural, the mechanism repeated in every market:**

- **S2's busy books.** A taker hits our quote a tick inside the touch, and in the next minute the mid moves against
  us by twice the half-spread we earned:
  - LP-SPEED: one-shot takers did 97 % of the damage;
  - LP-ADVERSE: −$305 in the first hour against +$101 of half-spread.
- **Q2's quiet books.** There the first minute was smaller, and the price then walked away for hours (Q2-TRIPS: lots
  held a median 260 minutes). Q2 without its drift would have been +$3.25 over 1.45 days. That drift is the same
  informed flow on a slower clock, not chance: 15 of 16 lots lost.
- **Rewards could not cover either.**
  - S2's R on the path's own formula was 0.711 and Q2's 0.715.
  - The formula each filled share earned was 0.93 ¢ in S2 and 0.71 ¢ in Q2, against the 1.66 ¢ and 2.65 ¢ needed.

**Bad luck (about $19 of the $85):**

- **MrBeast wk1** (`0x3090f7aa`, −$19.33 net with its own $13.21 of rewards and rebates) went from 0.17 to 1.00 in a
  day of view counts.
- **S2's 10-09.** S2 was positive on 10-09 (+$24.67, a drift of +$25.31). That was luck in the other direction.
- **Q2's 0x7465aead** (−$6.44). A Senate-odds bracket bought twice at 0.27 and 0.34 ran to 0.125.

Take MrBeast out and S2 is still −$15.50 a day; take 0x7465aead out and Q2 is still −$6.44.

### 1.4 The equity, reconciled (`sql/equity.sql`, `results/equity.txt`)

| | $ |
|---|---:|
| deposit (the path's first booking, 10-10 02:32) | 402.03 |
| fills' P&L to now (others' mid, or the payout) | −149.55 |
| rewards paid, 10-09 → 10-14 | +49.83 |
| maker rebates | +14.29 |
| fees | 0.00 |
| **expected equity at the marks** | **316.60** |
| actual: pUSD $300.48 (path read, 15:12 UTC) + open lots at the mid $16.07 | 316.55 |
| difference | −0.05 |

- **The cash side.** pUSD is $1.36 above the deposit less what the fills spent net, plus the redemption proceeds booked
  and what was paid. That is the $1.41 of winning tokens of MrBeast wk1 (0.618 YES) and `0x3c82c098` (0.789 YES),
  redeemed without a proceeds row.
- **The path's booked "deposit"** reads $403.39 now. It took four small bookings of ±$1.51 to ±$4.93 around
  redemptions and payout timing (10-13 18:18 and 18:20, 10-14 03:11, 10-15 14:05). Nothing on record says Davies moved
  money, so the deposit is taken as $402.03.
- **Fees.** All 477 fills were maker fills at fee rate 0. No taker order was ever sent.

## 2. Why the paper tests and the simulators overstated live (`results/gaps.txt`)

### 2.1 S2 against its own paper layer, then against the calibrated engine

LP-ADVERSE measured the paper layer at **+$91.2 a quoting day**. Live made **−$21.45**. Of the ~$112 gap, rewards are
$85 (76 %), fills $31 and rebates −$4.

| gap | measure | share of the gap |
|---|---|---|
| **R** (paid over the path's own formula) | 0.711 live against 0.75 assumed | about 5 % of the rewards gap. **Not the problem.** |
| **Formula realised per filled share** | paper 7.7 ¢, live 0.93 ¢ (8.3× lower) | almost all of the rewards gap |
| **Fill model** | paper filled only on a print through the quote: 0.077 shares a quoted minute against live's 0.140 (1.8×) | the volume of the fills gap |
| **Queue position** | improving the touch brought no extra takers, k = 0.81 [0.41, 2.25] | none |
| **Informed takers** | 97 % of the 60-minute markout from one-shot takers | already in paper's per-share markout |

- **Why the formula per filled share was 8.3× lower.**
  - Carried stock held the cap: 39.6 % of selected quoting minutes rested nothing, and 68 % of live market-minutes were
    exits.
  - Two-sided scoring minutes were 1,833 a day against paper's 7,920, and each was worth $0.0103 against $0.0162.
  - Live also filled more shares.
- **What the fill model got wrong.** Paper saw the adverse half of the fills: those with a print within 60 s lost
  4.86 ¢ a share, the rest 0.78 ¢. So per share paper and live lost alike, −2.92 ¢ against −2.85 ¢. Paper missed the
  volume, not the toxicity.
- **The calibrated engine got S2 right.** It was calibrated on live's orders: R 0.420 in its units, fill volume ×1.283.
  It reproduced S2: −$24.96 a quoting day against −$21.77 (LP-BEST), and out of sample in time −$78.02 against
  −$75.13.

### 2.2 Q2 against the calibrated engine

LP-BEST's Q2 was **+$3.62 a day [+1.38, +6.02]**. Live made **−$10.89**: a gap of −$14.51 a day.

| part | engine | live | gap a day |
|---|---:|---:|---:|
| rewards | 3.97 | 2.60 | −1.37 |
| fills | −0.58 (136 shares a day, −0.43 ¢ a share) | −14.43 (510 shares a day, −2.83 ¢ a share) | −13.85 |
| rebates | 0.23 | 0.92 | +0.69 |

- **Fill volume** (−$1.6 a day of the fills gap). It was 3.75× the engine's:
  - ×1.8 because pm-rec recorded the picked books about 56 % of each day, and the engine quotes only those minutes;
  - ×1.9 from the refills while they ran.
- **Fill quality** (−$12.2 a day).
  - Quiet-book takers were informed over hours: of Q2's lots' −$16.38, −$16.08 was drift while held (Q2-TRIPS).
  - The engine's tape rule, calibrated where takers act within the minute, missed it. It charged −1.96 ¢ a share
    where live lost −2.88 ¢ to the exits.
- **Rewards per filled share.** Live 0.51 ¢ against the engine's 2.92 ¢:
  - the fill volume rose;
  - the rewards fell to ×0.53–0.57 of the engine's, because x2's pause tripped 13× as often on flickering quiet books
    (380 minutes against 29), and because of rate dips and refills.

### 2.3 The lessons any future Polymarket test must build in

1. **Measure rewards per filled share against the adverse cost per filled share, from live-like fills.** Formula
   income is never the measurement.
2. **Fill from the maker-order trade tape, not from prints through the price.** Calibrate fill volume and markout on
   live orders before believing any arm.
3. **Mark at 1 minute, 1 hour, 4 hours and to the exit or the payout.** Informed flow in quiet books arrives over
   hours.
4. **Simulate the path's own mechanics.** That means refills, a pause judged on the real flickering mids, the cap held
   by carried stock, the programme read every minute, and the hours the recorder missed.
5. **Re-fit a calibration in every regime** (busy books, quiet books) before money.
6. **Read by market and by lot,** with a cluster bootstrap and a sign count. One market was 25 % of S2's loss.
7. **Freeze thresholds, then read unseen days.** Thresholds chosen on the days that judge them are flattered.
8. **Rule out sub-second edges.** Anything that needs sub-second reaction is out of reach.
9. **Only a minimum-size live pilot measures R and fill quality.** A paper layer cannot. Its stop must allow for the
   worst informed fills of a day: Q2's −$25 stop had $3.98 of room after 28 hours.

## 3. Is there any reward design with a positive expected value?

How each design is priced:

- the live fills themselves, for every design they can price (hedges, exits, ages);
- LP-BEST's calibrated engine, through closed-form arithmetic on its committed universe and ranking outputs;
- Q2-TRIPS' live calibration: rewards ×0.571, a further −0.918 ¢ a filled share.

The engine was **not** re-run here. Its working folder is not on this machine, and the disk has 2.6 GB free against
an archive of several. Every figure below says which source it rests on.

| design | priced on | $ a day at the account's size (range) | rewards a filled share vs cost | verdict |
|---|---|---|---|---|
| RW's quote, busy books (S2) | live | −21.45 [−44.47, +0.68] | 0.66 ¢ vs 1.66 ¢ | dead |
| Quiet books (Q2) | live | −10.89 [−19.96, −2.61] | 0.51 ¢ vs 2.65 ¢ | dead |
| Q2, best of 27 rules (entries 4 ¢ from the mid) | Q2-TRIPS calibrated | record +1.78 [−0.14, +3.87]; live window +0.33 [−3.77, +5.30] | 0.77 ¢ live (bar 1.5 ¢) | not distinguishable from 0 |
| **Far from the touch, near-zero fills** (1–3 ticks behind) | `scripts/frontier.py` on LP-BEST's universe | at 10 markets: −0.28, −0.33, −0.20 (R 0.42); −1.19 to −0.58 (Q2-calibrated); at most +0.18 with no friction at all | break-even R 0.54–0.66 at 60 min, 0.71–0.85 at 240 min, 0.72–0.95 with live's fill charge; live paid 0.42 (S2), ~0.24 (Q2) | dead: needs 1.3–2× the R ever measured, and is worth cents if it got it |
| One-sided quotes | LP-BEST calibration (99 live market-days); LP-ADVERSE; Q2-TRIPS (d) | LP-ADVERSE −9.30; Q2-TRIPS (d) −8.74 live calibrated | the one-sided third was paid 0.05 of its formula | dead: no reward, all the exposure |
| Hedge each fill at once (taker, or through negRisk complements) | `sql/hedge_at_once.sql` on the live entries | a minute after the fill −4.31 ¢ a share (S2), −6.96 ¢ (Q2): −47.6 and −18.7 a quoting day, against the fills' −39.6 and −14.4 | — | dead: locks the informed move in |
| Very short holds, immediate exits | LP-ADVERSE (taker exit 1/15/60 min); Q2-TRIPS (b) | S2: −15.6 to −20.9 a day worse than as run; Q2's live window, calibrated: −8.3 to −26.2 against −12.45 as run | — | dead: the move is in the first minute |
| Sponsored-only pools | `results/sponsored.txt` | 31 sponsored markets, $210.33 a day for all Polymarket, 3 without a native config at $15.00 a day | same books, same takers | dead on capacity: ≤ $1 a day at a realistic pool share |
| Markets near resolution (under 3 days to the end) | LP-BEST's universe | −$3.83 a market-day, the worst bucket | — | dead |
| Q2 plus a 3-day age filter | `results/q2_age.txt` | Q2 −15.75 → −14.83 live; markets 3 days and older −15.60 | — | dead: the loss was in old quiet election books |
| More money | LP-ALLOC, LP-BEST | not larger at $400 or $1,000 | — | no |
| Maker rebates alone | live | 0.19 ¢ a filled share | vs 2.8 ¢ adverse | dead |

**Viable only under conditions none of which this account controls:**

- **Polymarket pays far more for the same exposure.** Its programmes would have to pay at least about 1.3–2× (busy
  books) or 2–4× (quiet books) more per unit of fill risk than they did.
- **A filter that sees informed takers before they take.** That needs sub-second reaction, which is out of reach.
- **Knowing the outcome better than the takers.** Then it is not a reward strategy.

At this size the ceiling with every friction removed is cents to about $2 a day.

## 4. Beyond rewards: the closed lists re-checked

PMOPPS' and PMSTATARB's closed lists were re-read verdict by verdict against what is known now.

**Rightly closed:**

- negative-risk sets ($1.26 a day at $1,000, locked for weeks);
- date ladders;
- favourites (FAV, failed its pre-registration);
- weather;
- hourly crypto (speed);
- maker rebates alone;
- sponsored programmes (re-read today: $210 a day across all of Polymarket);
- new pools (the worst bucket);
- DEADLINE-NO (failed its frozen 2024 test; its neighbouring days are flat; real fills take the rest).

**One premise was wrong; the verdict probably stands.** PMOPPS closed "buy the proposed outcome during a dispute"
partly because dispute times "are not keyless".

- They are. A public Polygon RPC answers keylessly in 1,000-block windows (`polygon-bor-rpc.publicnode.com`, checked
  today).
- The trade still looks priced right: proposals survive 79 % and the market pays 0.74 a day before the close. Its one
  positive reading (+9.8 % six hours out, [−5.9 %, +28.5 %]) needed the close time.
- **Cheap first test, historical, closes on a FAIL:**
  - Confirm which UMA oracle contract Polymarket's adapter uses (the OptimisticOracleV2 address held one log in
    6,000 blocks).
  - Pull 2025's dispute events in 1,000-block windows, about 16,000 requests.
  - Price the proposed outcome at dispute + 1 h and + 6 h from the CLOB's prints.
  - Bar it as DEADLINE-NO was barred.

**Untested, each with a cheap first test** (PMSTATARB §4; none is a strategy, all are historical first):

- **TOUCH-CAL.** Are touch prices calibrated against a barrier model on Binance's 1-minute High/Low? Its G1/G2 pulls
  come first.
- **BUCKET-DIST.** Is the daily price-bucket distribution the wrong shape? It shares the same pulls.
- **KALSHI-LEAD.** A measurement only: does Kalshi lead Polymarket by minutes? If the lead is under a minute it closes
  with PMSC.

The priors are low. Polymarket has priced every family tested so far about right.

## 5. Verdict, and what to do (Davies decides each)

- **Rewards: not viable.** Two live phases and two calibrated simulators agree that informed takers cost 2.5–5× what
  Polymarket's rewards pay per filled share. No placement, filter, hedge or exit tried or priced changes the sign at a
  confidence that justifies money.
- **Beyond rewards: nothing viable found.** Three historical measurements and one re-read remain open, at no risk.
- **The held lots** (about $15.5 at the mid, `results/equity.txt`). Let them exit or settle. Nothing to sell by hand.
  - **Sells resting:** 0x7465aead (40 YES, ends 10-16 16:00) and 0x76051f8c (6 NO).
  - **Waiting for their payouts:** the lots under the 5-share minimum (0x0608b79b 4.28 NO, 0x89067ac9 3.57 NO,
    0x3c5391bb, 0x9beb023f) and Iran's 80 YES.
  - Redeem the winners after resolution, as before.
- **The balance** (pUSD $300.48). Withdrawing it, or leaving it idle, is Davies' call. Nothing tested earns on it
  there; Polymarket's 4 % holding reward applies only to positions held in some markets ($0.03 a day at this size).
- **Calls still running** (`edge_calls`): `pmlp` (close-only, needed until the lots are gone), `pmlpreserve` (no use
  with no refills and Q2 closed), `pmrec` and `pmrec-meta`.
  - **Proposal:** `pmlpreserve` off now.
  - `pmrec`/`pmrec-meta` off after LPRESEL6 reads its window on 10-23. None of the open historical tests needs them.
  - Then disarm live-prep (`dry_run` true, `live_confirmed_at` null) once its lots are gone.
  - Each step needs Davies' word.
- **Tests.** No Polymarket reward test, paper or live, should continue or restart. If Davies wants anything more on
  Polymarket, it is TOUCH-CAL's historical pull first, under DEADLINE-NO's rules.

## What this did not check

- **LP-BEST's engine was not re-run.** Its outputs were used as committed. A new universe table (deeper placements,
  one-sided pricing) would need the full pm-rec archive, which this machine has no disk for (2.6 GB free).
- **10-15's payout** (Q2's last 8 minutes) and the open lots' resolutions.
- **The $1.41 redemption** is inferred from the cash identity, not read from the chain.
- **The dispute re-test's contract** (only reachability was checked).
- **Taker fees** on the hedge rows: the hedges are gross, and a fee-enabled market makes them worse.
