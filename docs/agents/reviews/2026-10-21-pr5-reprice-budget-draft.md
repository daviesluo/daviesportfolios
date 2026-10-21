# DRAFT, not frozen, not in force: a re-price budget for PR5's rule (condition 5's finding)

Drafted 2026-10-21 for the main session, then Davies. **Nothing here changes PR5's paper engine, LIVE or any frozen
reading.** PR5's four-week review (`2026-10-21-pr5-paper-test-review.md`) found condition 5 missed: 714 orders on
2026-10-01, over the 700 a day the spec allows, "a finding to fix (for example a wider re-price step), not a pass". Davies,
2026-10-21, on that review: "A，引擎也继续运行，但要确保模拟的真实性和实盘策略完全一致，不一致的地方就直接改" (option A, LIVE stays at
£10 a rung; the engine keeps running; make the simulation faithful to the live strategy). The re-price step is PR5's rule
itself: the paper engine decides it (`quotes.ts` `stepMinute`) and LIVE carries the paper engine's decisions out, so a
change here changes LIVE's trading. That is not "making the simulation faithful", and it is put to the main session and
Davies before anything lands.

## What was replayed

The frozen simulator on the engine's own recorded inputs (PR5-R (d)'s replay, which is the engine event for event over
the four weeks), with only its re-price step replaced inside `simulate`, under the frozen fill and under PR5-R (a)'s
strict fill (`backtests/pr5_review/scripts/condition5.py`, `results/condition5.json`):

| variant | the step | trips | P&L, frozen fill | P&L, strict | orders | most in a day | days over 700 |
|---|---|---|---|---|---|---|---|
| frozen (the record) | 0.05 % | 247 | +$16.933 | +$15.251 | 8,959 | 714 (10-01) | 1 |
| const075 | 0.075 % | 272 | +$16.378 | +$13.315 | 4,765 | 350 | 0 |
| const100 | 0.10 % | 285 | +$15.843 | +$13.218 | 3,121 | 250 | 0 |
| **budget300** | 0.05 % until a book's UTC day has 300 orders, then 0.10 % to the day's end | 251 | **+$16.950** | **+$15.271** | 8,833 | **635** (10-01) | **0** |
| budget250 | the same from 250 | 253 | +$16.281 | +$15.061 | 8,512 | 563 | 0 |

A wider step on every day removes half the orders and costs 3–13 % of the P&L. **budget300** touches only the days that
spend their budget: it brings 10-01 from 714 to 635, and the P&L is the record's to within $0.02 under either fill.

## The draft rule (budget300)

- Each book counts its own orders in the UTC day (placements, re-prices and re-placements, the spec's count). While the
  count is under 300, the re-price step is 0.05 %, as frozen. From the 300th order on that book, to the day's end, it is
  0.10 %, for entries and exits alike. Nothing else changes.
- It is a throttle, not a cap: a book keeps re-pricing after its 300th order, at the wider step. On this record no day
  passed 635 orders across both books; a day more volatile than 10-01 could still pass 700.
- The live executor's governor (900/950 POSTs) stays as it is, as the account's last guard.

## What adopting it would take (not done)

1. Davies' word, since it changes LIVE's trading rule.
2. A pre-registered variant, or a deviation of PR5's rule, written before the change. Each frozen reading of PR5's engine
   names it: PR5V (`2026-09-28-pr5-variant-prereg.md`, reads to 2026-10-28), QUEUE (its freeze line, to the 11-02
   export), PR5-W (`2026-10-18-revx-weekend-prereg.md`, to 11-25), and the twins' pre-registration (every twin replays
   PR5's engine and checks its replica against it, `checkTwinPaper`).
3. The safest order: let it run first as a twin's rule extension (a new row), not in PR5's engine. LIVE keeps carrying
   out the frozen engine until the readings that depend on it are done (11-02 at the earliest).
