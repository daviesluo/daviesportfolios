# Pre-registration: resting quotes around the peg on Binance's USD-stablecoin pairs (PR2)

Written 2026-09-23, before any return of this rule was computed. Frozen by the sha256 in
`prereg_binance_stable_quotes.sha256` and the UTC time in `prereg_binance_stable_quotes.frozen_at`.

## What was already seen (disclosed)

* Daily klines of every USD-stablecoin pair since listing (`data/binance_stables/*_1d.json`), with
  the days whose low was under 0.99 or high over 1.01 printed — for the WHOLE history, i.e. including
  the out-of-sample half (e.g. USDEUSDT 0.9202 on 2026-09-22, USDPUSDT 0.9598 on 2026-08-19).
* IS-half counts of 1-minute events beyond k of the fair value defined below
  (`analysis/is_binance_stables_counts.py`), with the first few events per pair and k.
No P&L, fill-by-fill outcome or exit path of this rule has been computed on any window.

## Hypothesis

Binance lists a long tail of USD stablecoins against USDT. Their books are thin at moments, and
liquidations, fat fingers and de-peg scares print wicks of 0.5–35 % that recover within minutes to
hours. Resting post-only orders a fixed distance from the peg are filled only in those wicks and
earn the distance back as the price returns, net of Binance's 0.10 % a side. The claim tested: this
earns money after costs out of sample, more than the same trades at random times, and survives
doubled fees.

## Data (keyless, public)

Binance spot 1-minute klines from the bulk archive `data.binance.vision/data/spot/{monthly,daily}/klines/`
plus the `data-api.binance.vision/api/v3/klines` mirror for the last partial day:
`data/binance_year/<PAIR>_1m.json`, rows `[open_ms, o, h, l, c, base_vol, quote_vol, trades]`.
sha256 at freeze:
* USDCUSDT 4c20eb1d7546744fa7a3c1ce9843635c0d3bc6d65725e8251c44c36518ee4f6e
* FDUSDUSDT 53b3f3333eb0b46f3a8e52e045e7bc5cecce881d99778f0c6ee03003d09a6a3b
* TUSDUSDT 8fa597bcbfb3dc43d35e501789def1b72c5405deee42b479f553017c97848bf0
* USDPUSDT f04fd410530fe231cd23ea3c5d4f6b3d732a7d4e4d1db82c9fe21fe660411046
* USD1USDT a461bca891cc63b1af847c6401b66aaeb4e234176f8200b06e76cecd0099171d
* XUSDUSDT faa3b3fd27f4e07ab7091124cbdd2c8ced6be1c945cfcc3092ba32b9addab304
* BFUSDUSDT 25a04a6f15e54a470169322b05be40dfcbf2d988f6417a0fa4000c16ffeb24e1
* USDEUSDT e1a7e90767c3e55b44dccecd665ba6682eca28aa77b404d3cad74ee39fdefedd
* secondary: RLUSDUSDT d10774eb…, USDSUSDT 64a908e7…, USDCUSD e5d76778…, USDTUSD d2c4c054…,
  FDUSDUSDC f85b62e8…, USD1USDC 6ead3c8e…, USDEUSDC 1ed7c9c4…, BFUSDUSDC 6b7888e5…
* Tick sizes from `binance_exchangeInfo.json` (sha256 bb0a1b3a…).

## Pairs

* Primary (listed and trading the whole year, USDT-quoted): USDCUSDT, FDUSDUSDT, TUSDUSDT, USDPUSDT,
  USD1USDT, XUSDUSDT, BFUSDUSDT, USDEUSDT.
* Secondary (descriptive, no bar): RLUSDUSDT and USDSUSDT (listed during the year); USDCUSD and
  USDTUSD (permission group 016+ — whether a UK account may trade them is unknown without keys);
  FDUSDUSDC, USD1USDC, USDEUSDC, BFUSDUSDC.

## Windows

Same split as the Revolut X year: IS 2025-09-11 00:00 → 2026-03-18 00:00 UTC; OOS 2026-03-18 00:00
→ 2026-09-23 00:00 UTC. A position is counted in the window in which it was opened and followed to
its exit.

## Rule (evaluated minute by minute)

Fair value: at the start of every hour, `fair` = median of the 1-minute closes of that pair over
the previous 24 hours, minutes with volume > 0 only; at least 60 such minutes, else no quotes that
hour.

Rungs: on each pair, each side, one order per distance `k ∈ {0.25 %, 0.5 %, 1 %, 2 %}`: bid at
`fair·(1−k)` rounded down to tick, ask at `fair·(1+k)` rounded up, $100 notional each (ask rungs
sell stablecoin held as inventory).

Order life: a rung with no open position is repriced at the start of each hour if fair moved more
than 0.05 %; a (re)priced order is active from the NEXT minute (the loop places it during the
current one).

Fill (strictly through): a bid at `p` fills in a minute with volume > 0 and `low < p`; an ask if
`high > p`; at `p`, the full $100 (primary). A filled rung is inactive until its position closes,
then re-placed at the next hour start.

Exit: from the minute after the fill, a post-only order at the current fair (updated at each hour
start; asks rounded up, bids down), filling strictly through. If not filled within 24 hours, closed
at that minute's close as a taker: sell `close·(1 − 0.0010 − s/2)`, buy `close·(1 + 0.0010 + s/2)`,
`s` = the pair's median touch spread measured live 2026-09-23 10:41–11:10 UTC (USDCUSDT 0.10 bps,
FDUSDUSDT 1.00, TUSDUSDT 1.00, USDPUSDT 14.0, USD1USDT 0.10, XUSDUSDT 1.00, BFUSDUSDT 1.00,
USDEUSDT 1.00; secondary pairs: their measured value, 1 tick if unmeasured).

Fees: 0.10 % on every fill, maker or taker (the account's measured tier; no BNB discount).

P&L per round trip in USDT (≈ USD), notional $100; capital 8 pairs × 2 sides × 4 rungs × $100 = $6,400.

## Arms

1. Primary: as written, the eight primary pairs.
2. Stress (must stay > 0): every fee doubled to 0.20 % and the taker exit pays the full spread.
3. Capacity-limited: each fill `min($100, 10 % of the fill minute's quote volume)`.
4. Descriptive: per pair, per rung, IS vs OOS, the secondary pairs.

## Null

Random-time twin, as in PR1: each OOS round trip of the primary arm is replaced by an entry on the
same side and pair at the close of a uniformly drawn OOS minute with volume > 0 (paying the 0.10 %
maker fee), with the same exit rule; 2,000 draws, `random.Random(20260923)`; the primary OOS total
must exceed the 95th percentile.

## The bar (all four, OOS)

Primary > 0; primary > null p95; stress > 0; capacity-limited > 0 (capacity reported in $/day).

## Determinism

`analysis/pr2_binance_stable_quotes.py` run twice, byte-identical JSON (sha256 recorded).

## What this cannot show

A stablecoin that fails and does not return (UST, May 2022 — outside this year) would turn every
filled bid on it into a large loss; one year contains no such failure among these pairs. Whether a
UK account may hold or trade each of these stablecoins on Binance is not known without a signed
call (`GET /api/v3/account` → `permissions`).
