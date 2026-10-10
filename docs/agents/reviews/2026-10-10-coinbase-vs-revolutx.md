# Revolut X against Coinbase for PR5's rule, and how to split the money (2026-10-10)

Davies, 2026-10-10: "先建起来吧，并且和Revolute X对比看哪个更好，投入的话资金该如何安排". This is the companion note to the
pre-registration (`2026-10-10-coinbase-paper-prereg.md`). It is history, in sample, and is not part of the bar.

- **Method.** Both venues run PR5's frozen `pr5_sim.simulate`, imported read-only, on the same interbank X, in pounds.
- **Revolut X UK.** USDC-GBP and USDT-GBP, from CJ5's paired book: Revolut X's UK prints, its own USD-book fair and
  PR5's stop cost. Each book runs from its listing (2025-11-26 and 2025-12-16).
- **Coinbase.** USDC-GBP, USDT-GBP, USDC-EUR and USDT-EUR, on SCQ-VENUES' minute bars, with Coinbase's stop cost, from
  2025-10-01.
- **Sources.** Scripts and results are in `backtests/cbpaper/`: `compare.py` → `compare.json` and `allocate.py` →
  `allocation.json`.
- **Nothing was traded.**
- **2026-10-10, later: €100 a rung on the EUR books.** The paper test now runs €100 a rung on its EUR books, not £100's
  worth of euros (its pre-registration's Deviation 1). This note's figures stay at £100 a rung: Coinbase's rate does not
  move with rung size (§4), so on £1,200 + €1,200 they change by at most 0.3 points a year (9.7 % → 9.8 % since 08-24,
  at EUR/GBP 0.8468), and nothing below changes its answer.

## 1. The answer

**Today, per pound at the size Davies runs, Revolut X is still the better venue.** Coinbase is the one that scales.

- **Since both venues' books tightened (2026-08-24, 46 days)**, at £100 a rung:
  - PR5 on Revolut X made **17.1 % a year** on £1,200;
  - Coinbase's four books made **9.7 % a year** on £2,400.
- **Coinbase USDC-GBP alone made 20.7 % a year, at any size up to £1,000 a rung.** It is the best single book on either
  venue since then.
- **Before 2026-08-24 Revolut X was far ahead.** Over the last 90 days it made 37.1 % against Coinbase's 6.0 %.
- **Revolut X's return falls as the size grows. Coinbase's does not.** Since 08-24:

  | rung | £10 | £100 | £300 | £1,000 |
  |---|---:|---:|---:|---:|
  | Revolut X | 21 % | 17 % | 14 % | 11 % |
  | Coinbase, all four books | 10 % | 10 % | 10 % | 10 % |

  Coinbase's books trade £37 m a day. At £1,000 a rung its fills are £6,000 a day: 0.02 % of the books.
- **The two do not move together.** Daily P&L correlation at £100 a rung:

  | window | daily | weekly |
  |---|---:|---:|
  | 2025-11-26 → 10-08 | 0.09 | −0.15 |
  | last 90 days | −0.11 | −0.56 |
  | since 08-24 | 0.09 | −0.07 |

**The split** (the robust split of §3):

| budget | Revolut X | Coinbase | £ a year since 08-24 | last 28 days | last 90 days |
|---:|---|---|---:|---:|---:|
| £500 | £360: USDT-GBP £50 a rung, USDC-GBP £10 | £120: USDC-GBP £20 | £107 (21 %) | £115 | £238 |
| £1,000 | £690: USDT-GBP £100, USDC-GBP £15 | £300: USDC-GBP £50 | £213 (21 %) | £235 | £422 |
| £2,000 | £1,200: USDT-GBP £200 | £780: USDC-GBP £100, USDC-EUR £30 | £401 (20 %) | £449 | £711 |
| £5,000 | £2,580: USDT-GBP £400, USDC-GBP £30 | £2,400: USDC-GBP £400 | £961 (19 %) | £1,180 | £1,297 |

- Up to about £1,000, most of the money belongs on Revolut X. Above it, the extra pounds go to Coinbase.
- Coinbase's USDT books are left out in every window's best split.
- Whether the forward weeks agree is what the paper test reads, before Coinbase is funded.

## 2. The two venues, window by window (£100 a rung)

| | last 12 months* | last 90 days | since 2026-08-24 | last 28 days |
|---|---:|---:|---:|---:|
| Revolut X, 2 books, £1,200 | £817 (68 %) | £445 (37 %) | £205 (17 %) | £201 (17 %) |
| Coinbase, 4 books, £2,400 | £193 (8.0 %) | £144 (6.0 %) | £233 (9.7 %) | £315 (13.1 %) |
| Coinbase USDC-GBP | £36 | £63 | £124 | £186 |
| Coinbase USDT-GBP | £99 | £34 | £6 | £7 |
| Coinbase USDC-EUR | £35 | £36 | £78 | £96 |
| Coinbase USDT-EUR | £22 | £11 | £25 | £27 |
| Revolut X USDC-GBP | £146 | £69 | £65 | £70 |
| Revolut X USDT-GBP | £670 | £376 | £140 | £130 |

- Each figure is £ a year, then % a year on the capital.
- *Revolut X's books start at their listing (317 and 297 days); each figure is annualised over its own days.
- **The regime shift of 2026-08-24 shows on both venues' USDT-GBP books.** Revolut X's fell from 376 to 140 a year;
  Coinbase's from 99 to 6.
- **Coinbase's USDC books rose after it**: USDC-GBP from 63 to 124, USDC-EUR from 36 to 78.

## 3. How the split was chosen

**The problem.** Each book's rung is chosen from a grid: £10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 300, 400, 500,
750 or 1,000, or the book is left out. A book's capital is six rungs.

**Each window's own best split** (`allocate.py`, dynamic programming over the six books) depends on which market it
trusts:

| window chosen on | £2,000 split | £5,000 split |
|---|---|---|
| last 12 months, last 90 days | all Revolut X | almost all Revolut X (USDT-GBP £750 a rung) |
| since 08-24, last 28 days | Coinbase USDC-GBP £300 a rung (£1,800) and Revolut X USDT-GBP £30 | Coinbase USDC-GBP £750 a rung (£4,500) and Revolut X USDT-GBP £75 |

Each loses badly in the other's market. At £2,000:

| split | 90-day rate | since-08-24 rate |
|---|---:|---:|
| the 90-day split | £871 | £374 |
| the since-08-24 split | £327 | £415 |

**The robust split** (§1's table) is the one whose worst shortfall against each window's own best is smallest. It is
searched over Revolut X's two books and Coinbase's USDC-GBP and USDC-EUR. It falls short of each window's best by at
most 21 % (£500), 22 % (£1,000), 25 % (£2,000) and 23 % (£5,000).

**The two venues as they run today** (PR5's LIVE account itself runs £10 a rung, £120):

| shape | 12 months | 90 days | since 08-24 | 28 days |
|---|---:|---:|---:|---:|
| the twin "Stablecoin quotes" (both Revolut X books at £100, £1,200) | £817 | £445 | £205 | £201 |
| Coinbase's paper test (four books at £100, £2,400) | £193 | £144 | £233 | £315 |

## 4. Where it stops scaling, and what each book absorbs

**Revolut X.** The UK books trade about £55k (USDC-GBP) and £80k (USDT-GBP) a day.

- The rule's fills since 08-24 run £122 and £245 a day at £100 a rung, and £803 and £1,558 a day at £1,000.
- Its return falls step by step as the size grows. Since 08-24, an extra £1,200 earns about:

  | step | extra a year |
  |---|---:|
  | from £100 to £200 a rung | 13.8 % |
  | from £200 to £300 a rung | 12.3 % |
  | from £500 to £1,000 a rung | 8.6 % |

- Past about £1,000–£1,500 on Revolut X, an extra pound on Coinbase's USDC-GBP earns more since 08-24: 20.7 % a year,
  against 12–16 % on Revolut X's best book, USDT-GBP.
- The robust split keeps more on Revolut X than that, because Revolut X was far ahead before 08-24.

**Coinbase.** Its books trade £7.3 m (USDC-GBP), £1.5 m (USDT-GBP), £22 m (USDC-EUR) and £6 m (USDT-EUR) a day over the
last 12 months.

- At £1,000 a rung the rule's fills are £400–£2,200 a day a book, under 0.03 % of the book.
- The yearly rate is the same at £10 and at £1,000 a rung in every window.
- History does not show where it stops: beyond £6,000 a book, no measurement here applies.

## 5. What a UK Coinbase Advanced account can trade and hold

**What the sources say.**

- **GBP books.** USDC-GBP and USDT-GBP are listed and online on Coinbase Exchange's public product list, flagged
  `fx_stablecoin` (read keyless 2026-10-09). Coinbase's UK entity, CB Payments Ltd, is on the FCA's cryptoasset register
  (ref 900635, since 2025-02).
- **EUR.** Coinbase's EMEA funding help page says: "UK customers have access to both a GBP and EUR balance within their
  Coinbase account, but the balances are funded using different payment methods". GBP is funded by Faster Payments,
  EUR by SEPA (help.coinbase.com/en-gb/coinbase/getting-started/add-a-payment-method/add-cash, as returned by search; the
  page refuses this machine).
- **USDT.** Coinbase's UK Tether page says Tether "is currently available on Coinbase's centralized exchange"
  (coinbase.com/en-gb/price/tether, as returned by search). Coinbase removed USDT for EEA users on 2024-12-30, under
  MiCA, and the UK is not in the EEA. USDT-GBP and USDT-EUR are listed and online on the public product list.

**What is not confirmed.** No source here says, from inside a UK account, that Advanced trades USDT-EUR, or that the EUR
balance trades on Advanced's EUR books. Davies' account will say on its first look.

**Which books remain if a part is missing.** Last-12-month and since-08-24 rates at £100 a rung:

| if missing | books that remain | 12 months | since 08-24 |
|---|---|---:|---:|
| the EUR books | USDC-GBP, USDT-GBP (£1,200) | £136 | £130 |
| USDT | USDC-GBP, USDC-EUR (£1,200) | £71 | £202 |
| both | USDC-GBP alone (£600) | £36 | £124 |

The robust split uses USDC-GBP above all, so it holds in every case. Its USDC-EUR slice, at £2,000, moves to USDC-GBP.

## 6. What was not done

- **No production read.** PR5 LIVE's own record was not read; the twin's and LIVE's forward figures are the
  pre-registration's comparison.
- **History only.** The paper engine has no forward days yet.
- **No grid finer than the one used, and no rung above £1,000.**
- **No regime model.** The split hedges between two windows; it does not forecast which market returns.
- **Coinbase's fill model.** The rule fills only on prints strictly through the quote. Whether a resting order on
  Coinbase's deep books fills like that is what the forward test and a live order would show.
