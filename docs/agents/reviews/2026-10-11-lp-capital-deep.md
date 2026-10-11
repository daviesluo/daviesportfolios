# LP-CAPDEEP: live-prep's $80 cash buffer, and refills the cash cannot fund

Research only (2026-10-11, read 01:19–01:40 UTC). No live path, config or migration changed. Every database read was a
read-only `select`; no order was placed or cancelled. SQL, a script and every output are in
`docs/agents/backtests/lpcapdeep/` (`MANIFEST.json`). Code read: `pm_live.ts` sha256 `a01c8560…778f` and `pm_lp.ts`
`82d1aa94…a850`, Addendum 17's bytes. Not blind: every record here had been read before. Nothing here is applied: Davies
decides.

Davies, 2026-10-11, verbatim:

> 这几项深度研究下并推荐我该怎么操作

In English: research these items in depth and recommend what he should do. Two items are answered here:

- **Item 1:** should the total cap release its $80 buffer (+$80 of buy budget)?
- **Item 2:** the refill tests its candidate against the $200 first-quote budget, not the cash.

## Verdict

| item | recommendation | $ a day at R 0.737 | risk it adds | verdict |
|---|---|---|---|---|
| 1. release the $80 | **keep the $80.** No $40, no ranks-1–5 budget, no held-stock condition. | +$80: **−$2.3** [−$5.5, +$0.6] (the simulator, re-priced); at most +$6 to +$14 if the cap bound all day and the extra buys never filled, which they do within 2–4 hours | about +$80 of held stock, about half of it in markets ending 10-13 to 10-16, the days Citigroup and Prologis already put $81 at risk against a stop with $70 of room | **keep. Read it again on 10-16**, after those settle and Addendum 17's three days are in |
| 2. refill budget test | **fund before you refill:** no refill in a turn whose free buy budget after its own funded buys, min(cap − committed, pUSD left), is under $20 | **+$0.5** [+$0.0, +$1.3] | none; it lowers risk (no market queued that cannot be funded, fewer near-end refills) | **change now**, by an addendum on Davies' word, with a pin test |

- **Why the studies disagree on item 1.** They measured different things.
  - LP-CAPINV's +$11.1 is rewards only. It held the record's fills and holdings fixed, priced the 20 minutes when the cap
    bound hardest, and measured against the slot-key order that Addendum 17 has since replaced.
  - LP-REFILL lets the extra budget fill. The extra $100 held $22–57 more stock at each close. It earned +$7.05 a day of
    formula and lost −$5.95 a day of fills.
  - So it breaks even only at a simulator R of 0.84, which is about 1.4 live. The live R is 0.737 (0.439 in simulator
    units).
- **What the $80 is.** It is $75 (the size of the total stop) plus a $5 margin. It was set when the cap was a fixed $320.
  - Its job then was to keep the strategy's cap below the venue's balance at the stop.
  - Since Addendum 8 the cap follows the equity, so that job is done whatever the buffer is. What is left is $80 of pUSD
    that is never committed.
  - It does not move the stop, which trips at −$75 on fills marked at the mids plus what was paid. It is not needed for
    exits (tokens back the sells), fees (makers pay none) or redemption.
  - What it does is limit how much stock can be held while carried inventory fills the cap. That brake is the one the
    simulators say is worth keeping.
- **Item 2 on the live record.** 2 of 11 refills were taken when the cash could not fund them at once.
  - The 10-11 one (`0x85b5135d`, rank 11) has rested no two-sided quote in 70 minutes. Under rank order a refill is
    funded last, so while the budget binds it rests nothing.
  - It used one of the ten refills a day.
  - It dropped `0x0386c36c` for the day. That market's programme flickers: its rate read 27 in 27 of its 70 minutes since.

## The live minutes since Addendum 17 (`results/alloc_extra.txt`)

From 00:51 to 01:27 UTC (37 minutes):

- **The money.** The cap is $322. Held at cost is $284.2, so the budget for buys is $37.53–37.86. The quoting
  markets wanted $105.40 of buys at 00:21 (`refill_audit.txt`); the day's picks need $205.60 of first quotes (LP-RULES).
- **What rank order funds.** It funds 65.3 % of the quoting weight two-sided: ranks 1, 2 and 4 in full, and rank 5 in 23
  of 37 minutes. The live path rested both sides in 92 market-minutes, against 107 in the replay. The gap is the price
  one tick inside the touch, 5N and the touch itself.
- **Ranks 3 and 9** sit in one-tick books, and the skip rests nothing there whatever the budget. Rank 6 is the replaced
  market.
- **What more budget would fund.** Ranks 5, 7, 8, 10 and 11, in that order:

| budget for buys | share funded two-sided | extra selection formula a day | paid a day if the state held all day, rewards only (k 0.208 / 0.091) |
|---|---|---|---|
| as live (pUSD − $80) | 65.3 % | — | — |
| + $20 | 77.7 % | +32.5 | $4.98 / $2.18 |
| + $40 | 85.6 % | +53.2 | $8.16 / $3.57 |
| + $60 | 94.1 % | +75.6 | $11.59 / $5.07 |
| + $80 (buffer released) | 99.5 % | +89.8 | $13.77 / $6.02 |
| + $80 for ranks 1–5 only | 69.3 % | +10.5 | $1.61 / $0.70 |
| + $80 only while held < $150 or < $200 | 65.3 % | 0 | 0 (held is $284: never) |

**How to read k** (`results/realisation.txt`). k is the formula a two-sided minute scored, over the selection's formula
for that minute. It is used here because the extra budget only reaches ranks 5 and below.

- Ranks 4 and below: 0.208 on 10-10 over 2,638 minutes, and 0.091 on 10-11 over 53 minutes. Rank 4 has been two-sided
  for 36 minutes today and scored 0.
- Ranks 1–3: 0.694 on 10-10.
- That gap is why Addendum 17's rank order was worth having, and why the next $80 is worth less than LP-CAPINV's
  average.

**How to read the last column.** It is an upper bound, for two reasons (`results/turnover.txt`):

- A resting buy dollar filled 6.3 times a day on 10-09 and 13.6 on 10-10 (7.9 without MrBeast wk1).
- So an extra $80 of buys becomes held stock within about 2–4 hours, and the cap binds again. LP-REFILL's simulator
  showed exactly that.

## Item 1: why the two estimates disagree, re-priced at R 0.737

From `scripts/capital_reprice.py` and `results/capital_reprice.txt`. The live R is 0.737, band [0.70, 0.81]; that is
0.439 [0.415, 0.485] in LP-ALLOC/LP-REFILL's simulator units (LP-RULES).

| source | what it counts | as published | at R 0.737 [band] |
|---|---|---|---|
| LP-CAPINV (c2)/(d), +$80 against slot order | rewards only, fills and holdings as recorded, 10-11's first 20 minutes, R 0.807 | +$11.1 | +$10.14 [+9.63, +11.14] |
| LP-CAPINV, +$80 on top of rank order | the same, against Addendum 17's order | +$8.4 | +$7.67 [+7.29, +8.43] |
| this study, the 37 live minutes since Addendum 17 | rewards only, the state held all day, k 0.091–0.208 | — | +$6.02 to +$13.77 |
| the same, 10-10 whole (the cap bound 169 minutes) | LP-CAPINV's replay of 10-10 | — | +$1.02 |
| **LP-REFILL, $400 against $300**, the live setting (00:00 reserve, 10 refills a day, $10 guard) | fills and rewards; the extra budget buys | −$2.64 (R 0.47) | **−$2.86 [−6.81, +0.75] a day for +$100; −$2.29 [−5.45, +0.60] for +$80**; ahead 2 of 5 days |
| LP-REFILL, the same with no refill | fills and rewards | +$0.34 | +$0.15 for +$100 (the cap barely binds) |
| LP-ALLOC, AI out, no refill, +$100 | fills and rewards | +$0.05 | ≈ $0 |

**Four reasons they disagree, in order of size.**

1. **Inventory.** LP-CAPINV kept the record's fills. In the simulator the extra $100 is bought into:
   - held at close +$25.0, +$22.3, +$57.4 and +$56.9 on 10-06..10-09, and +$94.7 on the partial 10-10;
   - capital in use +$34–74 a day.
   - Fills cost −$5.95 a day against +$7.05 a day of formula. At the live R that is −$2.86.
   - On the live record a buy marked −2.38 % of its notional 60 minutes later, MrBeast wk1 apart (`results/buy_markouts.txt`).
   - At 6 hours it marked +2.36 %, from 73 fills. That is too few to sign the cost. The simulator's −$5.95 is the central
     figure.
2. **Static against dynamic.** A static replay assumes the cap binds all day and the extra buys never fill. Both are
   wrong.
   - The cap bound in 169 minutes of 10-10 and in every minute of 10-11 so far.
   - The extra buys fill within hours (above).
3. **Funding order.** Addendum 17 already took the first +$3.6 a day that LP-CAPINV attributed to allocation. What is
   left goes to ranks 5–11, whose k is 0.09–0.21, against 0.69 for ranks 1–3.
4. **Units.** LP-CAPINV is paid $ at R 0.807. LP-REFILL is net $ at simulator R 0.47 (≡ 0.81 live). Re-pricing both at
   0.737 moves neither's sign. The difference is what each counts, not the R.

**The refill decides the sign.** Without a refill, the extra cap barely binds in the simulator and comes out at +$0.15.
With one (live has one), the reserve's markets fill the extra cap with stock. LP-REFILL's own finding: "more money buys
more inventory, not more reward."

## Item 1: what the $80 guards against

- **In the code.** `lpCapital`:
  - cap = floor(equity at cost − `loss_total_usd` (75) − `PM_LP_CAP_MARGIN_USD` (5));
  - its doc comment: "The total stop: the equity it may lose stays out of the cap".
  - The calibration review (`2026-10-01-polymarket-live-calibration.md`, "Total cap"): "Buys' collateral plus what is
    held at cost never pass it, so at the worst point the account still holds the cap and $5 more: the strategy's limits
    bind before the balance does."
- **That reason has lapsed.** It was written for a fixed $320 on a $400 deposit. Under Addendum 8 the cap is the equity
  less the buffer. So, for any buffer ≥ 0:
  - resting buys ≤ pUSD − buffer ≤ pUSD;
  - the collateral check never binds before the cap.
- **What it is not:**
  - not collateral for exits: tokens back the sells;
  - not fees: post-only makers pay none and earn rebates;
  - not redemption: redeeming is by hand and draws no pUSD;
  - not the stop: the stop trips on fills marked at the mids plus what was paid, at −$75 whatever the buffer.
- **What it does now.** It keeps $80 of the equity out of the market. While carried stock is high, that makes it the
  brake on how much stock today's lower ranks can add.
- **The risk it holds back** (`results/holdings_jump.txt`, at 01:19 UTC):
  - The stop's basis is fills −$32.99 plus paid $28.41, so −$4.58 is used and **$70.42 of room** is left.
  - **Already held:**
    - Citigroup Q3 provision, ending 10-13 13:30: 60 YES at 0.83 and 20 YES at 0.405, 8.14 NO.
    - Prologis Q3 FFO, ending 10-15: 39.73 NO at about 0.765.
  - **The worst plausible path as held:**
    - 10-13: both Citigroup lines NO, −$51.14;
    - 10-15: Prologis YES, −$30.37.
    - That is −$81.5 against $70 of room plus about two to four days of rewards: survivable on 10-10's ~$22 a day.
  - **What +$80 would fund now** (`alloc_extra.txt`): ranks 5, 7, 8, 10 and 11. Three of them end in the same window:
    - Riyadh airport, 10-16;
    - Bank of America Q3 provision, 10-14, an earnings jump at 0.40;
    - the refill `0x85b5135d`, 10-13 16:00, at 0.415.
  - **How much more could be lost.** Each can hold 5N = 100 shares a side, $28–60 at today's prices. MrBeast wk1 lost
    $32.54 in one market.
  - **The effect on the stop.** One or two such positions of about $40 against the book, on top of the path above, take
    the 10-13 → 10-15 loss from about −$81 to about −$120 to −$160. That is past the stop's room even with the rewards.
  - **The release adds no new kind of risk.** It makes a stop-tripping week out of one that is now survivable.

## Item 1: intermediate settings and conditions

| setting | $ a day at R 0.737 | risk | why not |
|---|---|---|---|
| $80 released | −$2.29 [−5.45, +0.60] (simulator); ≤ +$6–14 rewards only (static) | +$80 of stock | above |
| $40 released (buffer $40) | −$1.1 [−2.7, +0.3] (linear); ≤ +$3.6–8.2 static | +$40 | the same sign, half the size |
| +$80 for ranks 1–5 only | ≈ $0 [−1, +1]: +$0.7–1.6 static, less the fills of about $19 more resting | about +$19 | ranks 1–4 are already funded or sit in one-tick books; it only completes rank 5 |
| only while carried stock < $150 / $200 | $0 now (held $284) | $0 | the cap binds only when held stock is high (10-09, held $170: never; 10-10, $202: 12 % of minutes; 10-11, $284: every minute). Below the threshold it releases nothing that binds |
| only while the day's selection is unfunded | the same as releasing it | the same | a release acts only when the budget binds, so this condition is always met when it matters |
| a buffer that scales | not priced | — | with the stop's room it would read about $75 today; with near-end exposure (held at mid in markets ending within 72 h) it would read about $90 today, stricter. A per-market or near-end rule bounds that risk more directly than the buffer |

**Recommendation for item 1: keep $80.** Read it again on 10-16 UTC, after Citigroup (10-13) and Prologis (10-15) settle
and Addendum 17's forward test (10-11 → 10-13) is in. Release $40, and only $40, if all three hold:

- (a) the buy budget is under half of the picks' first-quote capital in most minutes of 10-13 → 10-15;
- (b) the live buys of ranks 5 and below have not lost at 6 hours over those days (`sql/buy_markouts.sql` by rank);
- (c) the stop's room is at least $100.

The bigger lever on the same problem is still LP-CAPINV's carried stock ($105.80 carried from 10-09 and $133.60 from
10-10's refills at 00:49). Freeing that lowers exposure rather than adding to it.

## Item 2: refills the cash cannot fund (`results/refill_audit.txt`, `results/replaced_flicker.txt`)

**The test as written.** `pm_live.ts`, the refill's candidate check:

    usedCap + sc.x.cap > lim.budget

This is the selection's $200 first-quote budget: the day's other active markets' `capital` plus the candidate's. Nothing
in it reads `committed`, the cap or `pusdLeft`, all of which the turn has computed by then. A refill takes
`rank = max(today's ranks) + 1`, so under Addendum 17 it is funded last.

**On the record.** 11 refills.

- **Funded at once: 9.** These were 10-10's first eight (14:23–14:30) and the tenth (14:52). The budget was $117–170 and
  the quoting markets wanted $0–95. They rested two-sided for 6–394 minutes and scored 7.644 of formula in all (about
  $5.63 at R 0.737).
- **Not fundable at once: 2.**
  - 10-10 14:35, `0xbfb4f78b`. $6.67 was free against $17.80. It was funded later that day under the slot order then
    (240 two-sided minutes).
  - **10-11 00:21, `0x85b5135d`.** −$68.31 was free against $18.60. It has rested a two-sided quote in 0 of 70 minutes;
    the replay funds it only with ≥ $60 more budget.
- **Replaced markets back in the universe later that day:** 3 of the 10 not out for the AI rule.
  - `0x0477b4ad`: 3 h 33 min after it went out; its minimum fell back from 100.
  - `0xcc5dbca9`: 44 minutes after its programme ended.
  - `0x0386c36c`: 42 minutes after it went out, and flickering since. Its rate read 27 at 00:00–00:05, 2 from 00:06 to
    00:45, 27 from 00:48, 2 at 01:05–01:15 and 26 at 01:20. It was ≥ 10 in 27 of its 70 minutes since the refill.

**Harmful, neutral or helpful?** Mildly harmful, never helpful.

- **Exposure:** neutral. An unfunded refill rests no buy.
- **Reward:** zero while the budget binds. Being last in rank order means it waits behind every other market, so queuing
  it early gains nothing over taking it when it can be funded.
- **Cost, part 1: one of the ten refills a day.** LP-REFILL's ten-a-day reserve was worth +$5.10 a day over none, about
  $0.51 a refill, and the cap of ten bound on every simulated day.
- **Cost, part 2: the replaced market is gone for the day.** Here that was about $0, because rank 6 would also have
  waited behind a partly funded rank 5. For a flickering market that is funded it would be up to about
  27 × 27/70 × 0.208 × 0.737 ≈ $1.6 a day.
- **Risk:** a refill taken early is funded when cash frees, which is often near its market's end. `0x85b5135d` ends
  10-13 and `0xbfb4f78b` ended 10-13.

**The options, priced.**

| option | on the record | $ a day | risk | verdict |
|---|---|---|---|---|
| **(a) fund before you refill:** no refill this turn while min(cap − committed, pUSD left), after the turn's funded buys, is under $20. The slot stays out, the day's count is unchanged, and it is tried again next turn | 2 of 11 refills wait (10-10 14:35 until cash frees; 10-11 00:21 until it frees); `0x0386c36c` stays eligible | +$0.5 [+$0.0, +$1.3]: a refill kept (~$0.51 on days the ten bind) plus a flickering market kept (up to ~$1.6 when funded) | lower: nothing queued unfunded, fewer near-end refills | **change now** |
| (b) a re-check window: `afterMin` 15 → 60 for programme outs | keeps 2 of 10 replaced markets (`0xcc5dbca9`, `0x0386c36c`); delays every other refill 45 minutes | ≈ $0: −$0.45 (10-10's refill formula, 45 of 570 minutes) against +$0.2–0.5; LP-REFILL's reserve00 off60 against off15 was +$0.37, noise | none | keep 15 |
| (c) count a refill only once it is funded | the 10-11 refill would not count | +$0.3 at most | none | superseded by (a): it still drops the replaced market |

**Why $20, and why before the candidates.**

- The universe takes N ≤ 20. A pair of first buys costs N × (best bid + 1 − best ask) < N, so $20 is the most any
  candidate's first quotes can cost.
- Checking before the reserve is read costs no Gamma, programme or book reads. A check against each candidate's own
  `capital` would spend the turn's three tries on reads that fail the same way.
- `committed` and `pusdLeft` are already final by the refill's place in the turn, after the orders.

**The rule, for an addendum (not applied).** In a live-prep turn, the refill (Addendum 13) takes no candidate while
min(`lim.capTotal` − `committed`, `pusdLeft`), read after the turn has funded its buys, is under $20
(`PM_LP_REFILL.minFreeUsd: 20`). Such a turn:

- writes no `refill` event;
- leaves `outSince` running;
- does not consume the reserve or the day's count.

Everything else in `PM_LP_REFILL` stays.

**Pin it:** LP-CAPINV's 00:15 case on the fake venue. A slot out 15 minutes with $7 free takes no refill and keeps its
market eligible. The same case with $40 free refills as before. On the `pm_live.ts` before it, the first assertion fails.

**Forward read.** Over the first three live days after the deploy:

- refills taken;
- refills deferred by the rule, and for how long;
- each refill's two-sided minutes in its first hour;
- replaced markets that come back into the universe later the same day.

## Not checked

- No new simulator run. The capital pair is LP-REFILL's committed per-day record (`lp_refill/results/raw/final2_atprice.json`)
  re-priced. It has five days, two of them identical at both caps, so its bootstrap is wide.
- The static replay keeps the recorded fills and holdings. What the extra buys would have filled, and at what markout,
  is the simulator's figure, not a live one.
- The +$4.82 of 10-10 maker rebates is taken as reaching pUSD at 00:30 UTC 10-11. With it, the rebuilt cap matches the
  state's 322.
- The buffer's effect on a stop overshoot is argued from the holdings and their end dates at their mids. No probability
  model of resolutions was fitted.
- The refill rule's value rests on one live day of a binding budget (10-11, from 00:00). How often the budget binds over
  the coming week is Addendum 17's forward test.
