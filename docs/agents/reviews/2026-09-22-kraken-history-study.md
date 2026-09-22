# The last Kraken avenue — the 84 coins §4.22 could not test

*Run 2026-09-22 by an independent agent as
`supabase/functions/agents/backtest_kraken3.ts`. Raw output:
`docs/agents/backtests/kraken3.json` (339 KB, byte-identical on a re-run;
no wall-clock field). Nothing here changes a rule, a row, a migration or
a balance. It is a measurement and a recommendation.*

---

## 0. What was asked, and the short answers

| | question | answer |
|---|---|---|
| **K1** | Of the 84 coins that passed §4.22's cost-and-book screen and could not be tested, does any clear §4.15's bar on Kraken's costs and book? | **No coin clears the bar as written.** 10 of the 84 have two windows of history. One of them, **TAO**, clears the four tests on both windows on both rulebooks. That is 2 passes against **0.70 expected by chance** (per rulebook P = 0.18 and 0.40). At coin level it is 1 coin against 0.60 (P = 0.46). TAO is also positive in only **2 of its 4 six-month folds**, and §4.22's written falsification needs 4. |
| **K2** | Does anything clear the bar anywhere on Kraken, or what is the closing number? | Across **every Kraken-advantaged coin that has two windows** (§4.22's 18 plus these 10), seeded, all four tests: **3 coins pass both windows against 3.26 expected by chance (P = 0.65)**. **0 of 3 passers** clear the fold test. Before any cost, the rule's edge on this study's coins is **+22 / −4 bps a round trip** (shipped rule, windows A / B). A Kraken round trip on them costs **97–105 bps**. |
| **K3** | Keep researching Kraken, or stop? | **Stop.** Every Kraken USD pair that clears the cost-and-book screens has now been priced wherever history exists. The answer is chance-level every time, and the pre-cost arithmetic says why. §4 lists what would reopen it: a fee change, or dated history milestones for TAO and KAS. |
| **K4** | Should the Kraken balance move? | **Yes, withdraw it. Keep the account and the key.** Nothing in the running system reads the balance. The design needs the Kraken **key** for three read-only things, and removing the key would put a permanent "Kraken fault" banner on the page. §5 has the code references. |

---

## 1. The data, and the proof the pipeline is the published one

**Source.** Kraken's quarterly OHLCVT bundle `Kraken_OHLCVT_Full_2026Q2.zip`
(parts 00–04, 8,972,380,104 bytes, 12,037 members, every pair from its first
trade to 2026-06-30). This is the file `backtest_windows.ts` built window C
from. An earlier session had downloaded it whole into the scratchpad
(2026-09-21), so nothing was downloaded again. **Only the 101 needed
240-minute members were extracted, byte for byte** (32.7 MB; CRC-32 checked
on read; size, CRC and SHA-256 of each recorded in `data.members`). Each was
spliced the way §3.14's data step did it: the bundle's bars strictly before
the keyless OHLC endpoint's first bar (last 720 four-hour candles, fetched
2026-09-22 18:31–18:33 UTC, forming row dropped), and the endpoint's bars
from there on. A 4-hour bar the CSV omits because nothing traded is
forward-filled flat. Every one of the 78 coins that exist in both sources
agrees on the overlap to **0.0000 bps median and p95**, against the declared
thresholds of 25 / 100 bps.

**Fidelity. Nothing is copied from `run`.** The script imports `run`,
`COSTS`, `SHIPPED_STOPS`, `stopsForKind`, `spreadOf` and `resample` and
calls `run` directly for every number. So the check is against PUBLISHED
work, run through this file's own pipeline (extraction, splice, fill, trim,
costs and index arithmetic):

| check | result |
|---|---|
| §4.22's 72 seeded cells (18 coins × 2 rulebooks × A/B; return, drawdown, trades, other-schedule return) | **72 / 72 exact** |
| §4.22's 216 fold returns and the live five's 120 (Revolut X and Kraken) | **336 / 336 exact** |
| the same two, re-run on §4.22's OWN tapes | 72 / 72 and 336 / 336 |
| §4.22's aggregates | 49/216 · 39/60 · 36/60 reproduced |
| this pipeline's tapes against §4.22's, aligned by timestamp, 23 coins | **151,128 shared bars, 0 price differences** |
| start-invariance: every seeded window cell re-run on a tape cut to begin exactly its warm-up before the window | **84 / 84 identical** |
| independent rebuild: TAO, KAS and EUL tapes written by separate Python code, cells re-run by a separate script | identical to the digit, including grid plateau counts |

Two harmless differences are recorded rather than waved through:

- 77 bars differ in **volume only**, by at most 2.4 × 10⁻¹⁴ relative. There
  are at most five per coin, all on the five splice-seam bars
  (2026-05-24 20:00 → 2026-05-25 12:00), whose volume comes from whichever
  source a day's fetch window started on. `run` never reads volume.
- §3.14's ENS tape starts five bars late (2023-09-23 12:00, its first trade
  after the cut). This pipeline forward-fills those five bars. §4.22's ENS
  cells reproduce either way.

---

## 2. Rules declared before any return was computed

- **Windows are §4.22's own cut, on the calendar.** The 6,571-bar grid,
  2023-09-22 16:00 → 2026-09-21 16:00 UTC:
  - A = last third, the bear year
  - B = middle third, the bull year
  - C = first third
  - D = the year before the grid, as `backtest_windows.ts` extended them

  A coin is scored on a window only when its tape holds the WHOLE window
  plus the warm-up before it. A window is never shortened to fit a coin.
- **Warm-up** is the grid's largest slow average + 21 bars, and never less
  than 32 days, so the 30-day momentum word is known on the first scored
  bar. That gives 192 bars for `trend-4h` and 321 for `trend-4h-wide`.
- **Continuity** is §3.14's rule: at most 2 % of a scored segment's bars
  (warm-up included) may have no trade. A bar counts as no-trade whether the
  CSV omits it or the endpoint returns it with zero volume, because the
  endpoint fills empty intervals itself.
- **Not assets, never scored:** §3.14's stablecoin/fiat and wrapped sets,
  plus USDe.
- **Rulebooks and parameters:**
  - The two §4.22 ran, at their SEEDED points: `trend-4h` = `DEFAULT_TREND`,
    and `trend-4h-wide` = slow 200 / breakout 100/36 / ATR 4.
  - Shipped stops: 8 % floor, no intra-bar trail, two-bar cooldown.
  - The 27- and 8-point grids exist only for the plateau test.
- **The bar** is §4.15's four tests from Kraken's side, as §4.16/§4.22 apply
  them:
  1. return > 0 on Kraken's costs (40 bps maker a side plus half the
     measured spread);
  2. drawdown < 35 %;
  3. at least half the grid positive;
  4. positive on the other schedule. For a Kraken-cheaper coin that is the
     REAL Revolut X UK cost; for a Kraken-only coin it is Revolut X's fees
     at Kraken's spread.

  All four must hold on both A and B, with a Kraken book ≥ $100k a day.
  §4.22's own seeded count used only tests 1, 2 and 4, so both counts are
  reported (§3).
- **The null.** For each rulebook, N·pA·pB, with N·p² beside it. The
  binomial P is computed at N and pA·pB.
- **Folds and falsification.** Folds are §4.22's six six-month folds,
  seeded. The falsification criterion is §4.22's written one: a two-window
  seeded pass AND ≥ 4 positive folds. Its three-year requirement is relaxed
  to "two windows", which is the only reason these coins can be tested at
  all.

---

## 3. Results

### 3.1 The funnel: why only 10 of 84 can be judged

| status (on `trend-4h`'s warm-up) | coins | which |
|---|---|---|
| **two windows (A and B)** | **10** | CPOOL, JTO, NOS, PENDLE, SAGA, STRK, TAO, TRAC, TURBO, W |
| one window (A only) | 21 | AR, BABY, CAKE, DOG, DRV, ETHFI†, EUL†, FARTCOIN, FLUX†, KAITO, KAS, KTA, MNT†, MOG, NPC, PEAQ, PONKE, PROMPT, PUMP, S, USELESS |
| one window (B only), A fails continuity | 2 | BLUR, CLOUD |
| no full window: A fails continuity | 8 | AIOZ, G, LIT, MUBARAK, NIL, SWELL, TAC, ZETA |
| no full window: listed too late (after ~2025-08-21) | 28 | AKE, ARX, ASTER, AVA, CAP, CHIP, DCR, ESPORTS, EVAA, GENIUS, GWEI, KAT, MEGA, NIGHT, NOCK, OOB, PLAY, PROVE, PTB, RIVER, RLS, SHX, SKR, TRUST, UAI, ZBCN, ZIG, ZRC |
| listed after the bundle closed (< 120 days anywhere) | 6 | DGAI, LAPTOP, LIGHTER, SN64, SODA, TREAD |
| not an asset | 9 | AUD, AUSD, DAI, EUR, EURC, GBP, USDE, USDG (stable/fiat); WBTC (wrapped) |

† has the history for B, but B fails continuity (ETHFI 2.1 %, MNT 2.4 %,
EUL 5.3 %, FLUX 42.6 % of bars without a trade).

Half the 84 are **recent listings**. 36 of the 75 real coins listed on
Kraken in August 2025 or later, and only 17 have the history for two
windows at all. That is why §4.22 could not test them, and why no source
could: Kraken's bundle starts at each pair's first trade, and it is the
most complete history that exists for these pairs.

### 3.2 The two-window cohort (seeded, Kraken costs)

| coin | `trend-4h` A | `trend-4h` B | `wide` A | `wide` B |
|---|---|---|---|---|
| **TAO** | **+4.4 % ✓** (DD 22.7, plateau 89 %) | **+16.5 % ✓** (DD 22.0, 78 %) | **+6.5 % ✓** (DD 23.0, 100 %) | **+26.0 % ✓** (DD 14.8, 100 %) |
| NOS | −0.4 % | −9.2 % | +28.8 % ✓ | −9.2 % |
| PENDLE | +7.8 % (fails: Revolut X UK cost −5.8 %) | −21.4 % | −16.2 % | −11.6 % |
| CPOOL | −9.0 % | +9.3 % ✓ | −9.0 % | (no B: warm-up) |
| W | −8.6 % | −8.8 % | −12.8 % | +0.9 % ✓ |
| JTO | −22.3 % | −21.2 % | −36.3 % | −8.8 % |
| SAGA | −16.7 % | −8.8 % | −8.8 % | 0 trades |
| STRK | −8.7 % | −16.5 % | −8.8 % | −17.0 % |
| TRAC | −9.0 % | −6.0 % | −9.0 % | −22.3 % |
| TURBO | −8.2 % | 0 trades | −11.5 % | (no B: warm-up) |

**The null, then the count:**

| | N | pass A | pass B | expected N·pA·pB (N·p²) | observed | P(≥ observed) |
|---|---|---|---|---|---|---|
| `trend-4h`, four tests | 10 | 1 | 2 | **0.20** (0.22) | **1** (TAO) | 0.18 |
| `trend-4h-wide`, four tests | 8 | 2 | 2 | **0.50** (0.50) | **1** (TAO) | 0.40 |
| total | | | | **0.70** (0.72) | **2** | |
| coin level (either rulebook) | 10 | 2 | 3 | **0.60** | **1** (TAO) | **0.46** |
| three tests (§4.22's seeded definition) | | | | 0.70 | 2 (TAO, TAO) | |

TAO passing on both rulebooks is ONE coin. At coin level it is exactly
what chance produces about half the time.

**The fold test decides it.** These are seeded, Kraken costs, over the four
folds TAO's history reaches:

| | F3 (24-09→25-03) | F4 (25-03→25-09) | F5 (25-09→26-03) | F6 (26-03→26-09) | positive |
|---|---|---|---|---|---|
| `trend-4h` | −0.8 % | +17.5 % | +13.6 % | **−13.2 %** | **2 / 4** |
| `trend-4h-wide` | 0.0 % | +26.0 % | +7.6 % | **−6.6 %** | **2 / 4** |

§4.22's falsification needs ≥ 4 positive folds, so **TAO fails it on both
rulebooks.** Its most recent six months lost 13.2 % on the shipped rule.
Other facts about TAO:

- It has **2.24 years** of Kraken tape (listed 2024-06-25), not the three
  §4.22 asked for.
- It is on **neither** Revolut X book: `GET /1.0/public/configuration/pairs`,
  455 pairs, re-read at 18:53 UTC, lists no TAO.
- Its Kraken book is deep ($41.5M in the 24 h to 18:53 UTC; spread 4.1 bps).
- Its "other schedule" is Revolut X's fees at Kraken's spread (+8.0 % / +20.9 %).
  So nothing in TAO's numbers argues for **Kraken**; it only argues for a
  coin Kraken happens to carry.

The search arm (reported, counted nowhere) changes nothing. 36 of 82
searches had under 180 days of in-sample. Among the two-window coins, B
could be searched only for JTO and STRK, and both fail.

### 3.3 The closing count — every Kraken-advantaged coin with two windows

§4.22's 18 are re-scored here under the same declared rules: full tapes,
warm-up, continuity and all four tests. Their seeded count was 2 against
3.33, on three tests.

| | N | expected | observed | P | fold test |
|---|---|---|---|---|---|
| `trend-4h` | 26 | 0.96 | 2 (KSM, TAO) | 0.25 | KSM 2/6, TAO 2/4 |
| `trend-4h-wide` | 25 | 1.96 | 1 (TAO) | 0.87 | TAO 2/4 |
| **coin level** | **27** | **3.26** | **3** (KSM, TAO, XMR) | **0.65** | **0 of 3 per-rulebook passers clear it** |

Reconciliation with §4.22's published number, on the 6,571-bar grid (these
tapes are price-identical to §4.22's, §1):

- **Three tests:** KSM + XMR = **2 against 1.11 + 2.22 = 3.33.** Reproduced.
- **All four tests** (plateau restored): **1 (KSM) against 0.89 + 1.67 = 2.56.**
  XMR's `wide` B pass does not survive the plateau.

The published sentence therefore stands, and gets slightly stronger under
the bar as §4.15 writes it.

### 3.4 One-window coins, and windows C and D

- **A only (21 coins):** 7 pass on `trend-4h` (BABY, DOG, EUL, FARTCOIN,
  KAS, NPC, PEAQ) and 5 on `wide` (BABY, DRV, FARTCOIN, KAS, S). The
  per-window pass rate is 26 % / 24 %.
- **B only (2 coins):** CLOUD passes B on both rulebooks (+54.0 %).
- **Why none of these counts:** §3.15 measured that a one-window pass
  predicts nothing. In all four stop × parameter conditions, a coin that
  cleared A was *less* likely to clear B. They are listed so nothing is
  hidden. None is a candidate.
- **KAS** is the one worth naming. It passes A on both rulebooks (+13.7 % /
  +10.2 %) and is positive in 3 of the 3 folds it has. But it listed
  2024-11-19, so it has no calendar B until the windows roll forward (§4).
  It is on neither Revolut X book either.
- **Window C** reaches only BLUR, and BLUR fails it: `trend-4h` +5.8 % on a
  44 % plateau; `wide` +0.1 %, 25 % plateau, other schedule −0.7 %.
- **Window D** reaches **nobody.** The earliest listings (EUL, FLUX,
  2022-11-28) open after D's warm-up.

### 3.5 Folds, like for like

These are the same six calendar folds and the same history and continuity
rules, seeded, with positive / scored in each fold. The live five and
§4.22's 18 are re-scored on full tapes so every cohort's fold is the same
span.

| cohort · costs | F1 | F2 | F3 | F4 | F5 | F6 | total |
|---|---|---|---|---|---|---|---|
| live five · Revolut X (touch) | 8/10 | 4/10 | 8/10 | 7/10 | 2/10 | 8/10 | **37/60 (62 %)** |
| live five · Kraken | 8/10 | 4/10 | 7/10 | 6/10 | 1/10 | 8/10 | 34/60 (57 %) |
| §4.22's 18 · Kraken | 9/29 | 2/34 | 6/34 | 12/32 | 1/30 | 15/34 | 45/193 (23 %) |
| **this study's coins · Kraken** | 1/2 | 3/4 | 4/22 | 11/38 | 7/59 | 22/97 | **48/222 (22 %)** |

The coins where Kraken is the cheaper or the only venue sit at **a
third of the live five's rate, fold after fold**. That is §4.22's finding
again on a new population: the problem is the coins, not the venue.

### 3.6 The closing arithmetic: the edge before any venue charges it

These are the same seeded cells at **zero cost** (no fee, no spread). The
figure is the pooled log edge per round trip (trades / 2):

| cohort | `trend-4h` A | `trend-4h` B | `wide` A | `wide` B |
|---|---|---|---|---|
| **this study's coins** | **+22 bps** | **−4 bps** | −83 bps | −34 bps |
| §4.22's 18 | +73 | −67 | +225 | +54 |
| the live five | +112 | +183 | +254 | +264 |

The Kraken round trip on this study's coins is **97–105 bps** (80 bps of
fee plus the spread; medians over the scored cells). Revolut X's is
~20 bps on the majors.

The rule makes roughly nothing per round trip on these coins before costs.
No fee schedule, and no Kraken volume tier, can turn that into a return.
On the live five the edge is real, and Kraken's ≥ 80 bps takes **44–71 %**
of the shipped rule's gross edge, where Revolut X's ~20 bps takes 11–18 %.
That is the whole Kraken question in one line.

### 3.7 Sensitivities (all reported, none counted)

**Continuity waived.** All 30 A/B segments the 2 % rule dropped were scored
anyway, to check whether the rule threw a winner away.

- Only **EUL** becomes a two-window passer, on `trend-4h`, with its B window
  5.3 % empty. That makes 2 against 0.59, P = 0.12.
- EUL's six folds, with continuity waived for them too, are
  −12.9 / 0.0 / +19.5 / +7.6 / −7.5 / +19.0 %. That is **3 of 6, so it fails
  the fold test.**
- MNT's B (+66 %, 2.4 % empty) passes waived, but MNT fails A.

**§3.8's own-thirds split.** Each coin's own tape is cut in thirds, for the
17 coins with at least 540 days. KAS and TAO pass both windows on both
rulebooks: 2 against 0.94 per rulebook, P = 0.24. Same names, same
chance-level count.

**Warm-up.** LIT and MOG list 23 days before B opens, inside the 32-day
warm-up. MOG fails A regardless. LIT's A is 8.5 % empty and passes only
with continuity waived. Admitting LIT would take two relaxations at once,
which is what §4.15 says not to do.

---

## 4. Is further Kraken research worth doing?

**No. The question is closed at this account's fee tier.** The coverage is
now complete:

- §3.12 priced 27 core coins, and §3.14 priced 68 pairs with three years of
  history.
- §4.22 took the 18 coins where Kraken is cheaper or the only venue.
- This study took the remaining 84. Of those, 10 can be judged on two
  windows, 23 on one, and 51 on none: 28 listed too late, 8 have their only
  window fail continuity, 6 have under 120 days of tape anywhere, and 9 are
  not assets.

Every count is at chance. The fold rates are a third of the live five's.
The pre-cost edge on these coins is ~0. Another Kraken study on this data
would be another session spent confirming a null.

**What would reopen it.** Each item below is written so it can be checked
without an argument.

1. **Fee.** Kraken's maker fee at this account falls to ≤ 10 bps. That
   means the $10M/30-day tier or a schedule change; turnover cannot buy it.
   This is §4.22's trigger, unchanged.
2. **TAO reaches three years of Kraken tape on 2027-06-25.** Re-run this
   script with the grid moved forward. Reopen only if it again clears both
   windows seeded AND is positive in ≥ 4 of 6 folds.
3. **KAS gains a second full window from 2026-12-21** (three years on
   2027-11-19). Same test.
4. **Time, generally.** 17 of the 75 real coins have the history for two
   windows today. 41 will by 2027-09-21 and 72 by 2028-09-21. A re-run in
   September 2027 is the cheapest honest re-look, and it costs one command:
   the script, a fresh bundle, and the endpoint.
5. **Not a Kraken trigger:** if Revolut X lists TAO or KAS on the UK book,
   test them THERE (its cost, its book). That would be a Revolut X
   question.

---

## 5. The money: what the code needs from Kraken

Read from `supabase/functions/_shared/kraken.ts`, `agents/tick.ts`,
`agents/index.ts` and `src/agents.js`. No credential was used, no private
call was made and no balance was read.

| what | Kraken call | key? | funds? | where |
|---|---|---|---|---|
| signal candles (every row has `signal_venue = 'kraken'`) | `OHLC` (public) | no | no | `krakenVenue().candles` → `krakenPublic`; `tick.ts` `signalWanted` / `loadSeries` |
| quotes, marks, the basis (`agent_basis`) | `Ticker` (public) | no | no | `tick.ts` quotes loop for both venues; `krakenVenue().quotes` |
| pair config | `AssetPairs` (public) | no | no | only for a row that EXECUTES on Kraken (`execWanted` keys on `s.venue`), and there is none since `0046` |
| orders (place, cancel, read, reconcile) | `AddOrder` / `CancelOrder` / `QueryOrders` / `OpenOrders` / `Balance` | yes | **only for a live Kraken order** | reached only for rows or orders whose `venue` is `kraken`. `0046` deleted the last one, and `0047`'s draft live row is Revolut X |
| fee tier on the venue card | `TradeVolume` (private) | yes | no | `index.ts` `loadVenues` → `refreshFees`, once an hour per isolate. It worked on an **empty** account (reference §6, 2026-09-20) |
| "funded" line on the venue card | `Balance` (private) | yes | no | `index.ts` dashboard `balancesByVenue`; a zero balance shows "—" and raises no alert |
| the probe | `Balance`, `BalanceEx`, `TradeVolume`, `OpenOrders`, `ClosedOrders`, `AddOrder validate=true` | yes | no | `runProbe`. On 2026-09-20 every one of these answered 200 on an account holding USDC 0 / GBP 0, and `validate=true` returned the order description with no `txid` (reference §6) |

**Nothing in the running design needs a funded Kraken account.** The KEY
is needed only for the fee-tier read, the balance card and the probe.
**Do not delete the key:** `loadKraken()` would then return
"KRAKEN_PRO_API_KEY missing". That note goes into `venues[].note`, and
`agentsAlerts` (`src/agents.js`) turns any venue note into a
"**Kraken fault**" banner (tone `fault`), permanently. That is a false alarm the page
would need a code change to avoid.

**What withdrawing gives up, concretely:** only the ability to fund a LIVE
Kraken order without first depositing. No such order is possible today
anyway. There is no Kraken row, and any future one needs all of the
following first:

- a migration and a paper record;
- §4.18's nonce window set on the key;
- for any coin beyond BTC/ETH/SOL/XRP/AVAX/SUI, new entries in
  `KRAKEN_ALTNAME`, `KRAKEN_PAIR_ID` and `KRAKEN_ASSET`. `kraken.ts` throws
  on any other pair, on purpose, and TAO and KAS are not in it.

The fee tier depends on 30-day volume ($0), not on the balance.

**Withdrawing also shrinks the only Kraken risk the system carries.** The
key has trading permission; the probe's `validate=true` proves it. Per
§2b it must never carry withdrawal permission, which was not re-checked
here. On an empty account, the trading permission can do nothing.

**What reversing would cost:** a new bank deposit and its clearing time.
The strategies trade `*/USD`, so a GBP deposit also needs one GBP→USD
conversion; the reference records ≈ 0.20 % FX (≈ $0.20 on $100, §2b). No
code change is needed. Kraken's own withdrawal fee was NOT verified here;
the withdrawal screen shows it before confirming. If it is a meaningful
share of a small balance, leaving the money where it is costs nothing
either, because nothing reads it.

**Recommendation.** Withdraw the Kraken balance. Send it to Revolut X only
if the Revolut X sub-account holds less than the live row's $100 plus a
little headroom; otherwise send it to the bank. **Keep the Kraken account
and the API key as they are.** Kraken stays what `0046` made it: the
signal venue, read through public endpoints. The move is Davies' to make
at Kraken. The system cannot and should not do it: `kraken.ts` has no
withdraw method, and §2b requires the key never to carry withdrawal
permission.

---

## 6. What this study could not do

- **74 of the 84 cannot be judged on two windows, and 51 on none.** For
  the 34 short listings this is not a data-source problem: Kraken's bundle
  already is their full history. 28 listed too late for a full window A,
  and 6 have under 120 days of tape anywhere. Of the rest, 8 have their
  only window fail continuity and 9 are not assets.
- **Window D reaches no coin, and window C reaches only BLUR.**
- **TAO's and KAS's cases rest on 2.2 and 1.8 years of tape.** The fold
  test is the only extra evidence reachable, and it says no for TAO.
  For KAS it has only three folds to say anything with.
- **The book test uses §4.22's screen** (medians of nine snapshots on one
  afternoon). It was re-read fresh only for TAO, KAS, EUL and KSM.
- **The Kraken withdrawal fee and the account's balance were not read.**
  No credential was used.
- **Jev is not in any backtest**, as everywhere in this reference.
