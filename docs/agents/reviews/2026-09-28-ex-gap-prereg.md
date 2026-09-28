# Pre-registration EX-GAP: what a live fill costs against its paper control

Drafted 2026-09-27 (UTC) and revised 2026-09-28 after an independent review of the draft (findings E1–E8), and again
after that review's second pass. Frozen by the commit that adds this file, at that commit's time. Any change after that
is a deviation and is reported as one.

Davies, 2026-09-27, choosing what the TESTING review ranked (`2026-09-27-testing-portfolio-review.md` §4, appendix A
§6): "PR5-R 等低优先级" took EX-GAP in with the lower-priority readings.

Nothing needs building before the freeze. Every field below is already recorded on `agent_orders` and
`agent_decisions`, which are kept in full (reference §4 item 25).

## 1. The question

A paper fill is taken at the touch the loop read 3–5 s before the order, whatever its size. A live order re-reads the
touch as it is sent and gets whatever the venue gives. The first live fill (SOL buy, 2026-09-25, the 08:00 bar) paid
120.94 against its paper control's 120.89: +4.1 bps. At `trend-1h`'s turnover a gap of 4 bps a fill is about 2.6
points a year, about two-thirds of that row's window-A return (+3.8 %). The paper rows' dollar figures inherit the
gap, and a decision to raise the live capital would lean on it, though this reading cannot show how it grows with size
(§5). This reading says how large the gap is. It tests no hypothesis.

## 2. The unit

A **pair**: the fills of `trend-4h-live` and of its control `trend-4h` for one decision bar, with the same symbol, the
same side and the same `agent_decisions.bar_start` of each order's `decision_id`. Only marketable orders count
(`request.marketable`), which is every order both rows place today; if the live row's orders ever rest, its pairs end
there. Every pair from the first live fill on counts, including the one already seen.

- **The live side is every filled live order of the decision**: the `agent_orders` rows with its `decision_id` and a
  filled quantity above 0. An IOC that died unfilled is sent again on a later turn as a new row of the same decision,
  up to five attempts (`requotes` numbers them from 0), and one that filled in part is settled filled with the part.
  The live price is the average of the filled rows' `avg_fill_price`, weighted by their gross quantity (§3), and their
  fees are summed.
- **The pair's time** is the first live attempt's `ts`. It dates the pair.
- **The paper side** is the control's filled order of the same decision bar. A paper marketable order fills whole, at
  its own price, at once.
- **A protective exit** is paired only with a protective exit of the same symbol in the same minute. A protective
  decision's `bar_start` is one second into the minute it fired in, so they share a `bar_start`.
- **A fill with no twin is not a pair.** It is counted and listed, by row and by cause. Most will be control fills:
  while the live row holds a coin, its one-slot cap refuses a second coin's entry, the control takes it, and that
  entry and its later exit have no live twin. The other causes: the control's SUI, which the live row does not trade;
  a live decision whose IOCs all died unfilled; a floor exit on one row only, since each row judges the floor against
  its own cost; an entry a paper cap refused on the control.

## 3. The measure

For each pair, in bps, positive when the live fill is worse:

- **price gap**: `(live − paper) / paper × 10⁴` for a buy, `(paper − live) / paper × 10⁴` for a sell. `live` is the
  live price of §2; `paper` is the paper order's `avg_fill_price`.
- **fee gap**: the live fee in bps of the live gross notional, less the paper fee, 9 bps. The live fee is
  `Σ fee_usd / Σ (gross × avg_fill_price) × 10⁴` over the decision's filled live orders:
  - `gross` is the venue's gross filled quantity, as its recorded reply gives it: `response.filled_quantity`
    (`filled_size` where the reply uses that name; under `response.view` for an order settled by reconciliation).
  - `fee_usd` is the row's fee in dollars: the venue's `total_fee` in its `fee_currency`, a fee taken in the coin
    valued at the fill price.
  - Not `filled_base`. A live buy books its `filled_base` net of a fee taken in the coin, floored to the pair's step
    (go-live audit D4, D11). Over that smaller notional the fee reads higher, and buys would be measured differently
    from sells, whose fee is in dollars.
  - A fee the venue did not report is derived by the loop at the schedule's 9 bps (`response.feeDerived`, D8). Its fee
    gap is 0 by construction, not a measurement, and such pairs are marked.
- **gap = price gap + fee gap.** §4 decides on this and nothing else.

Reported beside each pair, never decided on:

- **The price gap in two parts.** Both come from `request.touch`, and each is in bps of the paper price, signed as the
  price gap, so that the two add up to it exactly:
  - staleness: the live order's re-read touch (the ask for a buy, the bid for a sell) against the paper price;
  - slippage: the live price against that re-read touch;
  - the re-read touch is the one on the attempt that filled (the last, if more than one did). A pair whose
    `request.touch` is null on either side, the paper order's or that live attempt's, is left out of the split and
    listed, and so is one whose live re-read failed (`request.touch.reread` false). A null paper touch also leaves the
    pair out of the time below, and it is listed the same way.
- **The time from the paper touch to the live fill.** The paper touch was read at the paper order's
  `ts − request.touch.ageMs`. The live fill time is the venue's `updated_date` (epoch ms, in the reply as above) on the
  decision's last filled live order. The row's `filled_at` is not the fill time: for a marketable order it equals the
  row's `ts` (`fillStamp`).

## 4. The reading

At **16 pairs**, or on **2027-01-31**, whichever comes first. The reading takes the first 16 pairs by the pair's time,
or every pair whose time falls before 2027-01-31 00:00 UTC.

- **On 2027-01-31 with fewer than 8 pairs, the reading is undecided and nothing follows.** The pairs are reported.
- Otherwise: **the mean gap, and a bootstrap 90 % interval.**
  - The pairs are listed in the order of the pair's time (§2), the time that also selects them, since it is always
    present; ties by the first live order's id.
  - Python's `random.Random(20261003)` draws 10,000 resamples. Each is n `choice`s from that list, with replacement,
    where n is the number of pairs.
  - The 10,000 resampled means are sorted. The interval is the value at index 500 (`int(0.05 × 10,000)`) and the
    value at index 9,500 (`int(0.95 × 10,000)`).
- **Reported beside it, never decided on.** Each interval below is drawn in the same way, from a fresh
  `random.Random(20261003)`:
  - the interval without the pair seen before the freeze, which prompted the question;
  - the pairs whose live side took more than one attempt, listed apart, and the interval without them;
  - the mean staleness, slippage and time of §3, and the marked pairs of §3;
  - if the live row's slot changes, the pairs by slot size.

**What follows from it:**

- **If the interval's lower end is above 0:** every reading of a paper row's dollars carries a paper-execution
  adjustment beside it. The adjustment is Σ over the row's marketable fills, both legs, of notional × mean gap / 10⁴,
  in USD, a fill's notional being its `filled_base × avg_fill_price`: what those fills would have paid more at the
  measured gap. The page's note for the paper rows carries it too, on Davies' word. It is a reading, never written into
  any book. It carries a gap measured on $25 `trend-4h-live` fills of BTC, ETH, SOL and AVAX at 4-hour closes to paper
  fills of $200–$333 on other rows, coins and bar times, and says so beside it (§5).
- **Otherwise** (the interval straddles 0, or lies below it): no adjustment.
- **In either case:** the price gap and the fee gap are reported apart, and so are §3's two parts and the time.

**Power.** At a gap SD of 4 bps, 16 pairs give an interval of about ±1.6 bps, and 8 pairs about ±2.3 bps. The live row
holds one position at a time under its one-slot cap, and a round trip is two pairs, so 16 pairs take about 2–4
months.

## 5. What it cannot show

- **Size.** Every live order is one $25 slot. The paper fills the adjustment would touch are $200 (`trend-4h`) and $333
  (`trend-1h`, `momentum-1d`), and a raised live capital would send larger orders. No book is recorded at any fill. The
  one committed snapshot of these books (UK, 2026-09-24 00:12 UTC, `backtests/golive50/inputs/revx_books.json.gz`)
  showed 43.46 SOL at SOL's top ask of 115.070, about $5,000. It was taken 36 hours before the first fill and cannot
  show the depth at any fill. So this reading cannot say what a larger order pays. At $200–$333 the adjustment is an
  assumption, not a measurement.
- **Other rows, coins and times.** It measures four coins at 4-hour closes, a few seconds after the close. It does not
  measure `trend-1h`'s hourly closes, `momentum-1d`'s daily close, or SUI, which only the control trades and whose UK
  book is 23.7 bps wide at the median.
- **The cause.** Without the book at the fill it cannot tell latency, a stale ticker and depth apart. The split of §3
  says only how much of the gap came before the live re-read and how much after it.
- **Resting orders.** Only marketable orders are paired. What a resting order would get is MX-1's question.
- **A fill the live row never got.** A decision whose IOCs all died is not a pair, so what a missed fill costs is
  outside the mean. Those decisions are in the unpaired list.

## 6. Seen before the freeze (disclosed)

One pair: the SOL buy of 2026-09-25, the 08:00 bar. Live 120.94, paper 120.89.

- Price gap +4.14 bps. The live fee was 9.04 bps of the gross notional, taken in SOL, so the fee gap is +0.04 and the
  gap **+4.18 bps**.
- The paper touch was read 5.4 s before the paper order. The live order re-read the ask at 120.899 and sent an IOC
  limited at 121.02, the re-read ask plus 10 bps. Staleness +0.74 bps, slippage +3.39 bps.
- The book snapshot of §5. The TESTING review's "latency or a stale ticker is the likelier cause" is a guess this
  record cannot check.
- The live row and its control made 76 of 76 paired decisions identically, to 2026-09-27 21:39 UTC (appendix A §2.5).

No other pair had been read when this was written. When the review's second pass read production, on 2026-09-28
before about 04:40 UTC, there was no other live order.

Deviations are recorded in the review, the reference and the ledger.
