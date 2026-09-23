# Cross-sectional momentum on a broad Binance universe (2026-09-23)

**Answer: no, on both counts.** None of the 7 pre-registered candidates clears the bar (chance alone expects 0.002 passes). None adds to the Revolut X row: every half-and-half book's worst window is −36 % to −43 %, against the incumbent's −7.8 %.

**Pre-registration.** `docs/agents/reviews/2026-09-23-binance-xsmom-prereg.md`, frozen at 07:09:28 UTC before any arm ran. The frozen first 14,132 bytes hash to `543f009d…`; the whole file, with the correction below appended, to `01004ed5…`.
- **Correction 1**, appended at 07:13 UTC after the first run (its heading says 07:14): the pre-registered 7-day gap bridge had merged seven token redenominations into continuous price series (BNX ×0.01, BTCST ×0.1, COCOS ×1000, DREP ×100, QUICK ×0.001, STRAX ×0.1, SUN ×0.001). The bridge is now 0 days.
- No redenominated pair was in the universe within 100 days of its swap, so no candidate, null or benchmark number moved. One descriptive figure did (N = 50 equal-weight, D: −50.64 → −50.73 %). The first run's output was kept in the session that ran it (sha256 `08ac17d8…`), not in the repository.
- Disclosure: before the freeze, one self-check ran a family point internally. It printed no return.

**Reproduction.** The incumbent (`trend-4h`, BTC/ETH/SOL/AVAX/SUI, $20 slots) rebuilt from `backtest_jev.ts`'s exports gives A +8.03 / B +20.08 / C +55.64 / D −7.81 %. That equals `set2.json`'s `equal` row on all four evaluations, worst |Δ| 0.

**Universe.**
- Every USDT folder in Binance's bulk archive (735). Delisted pairs keep their folders, so listing the bucket that data.binance.vision reads finds them.
- 38,351 daily zips, each checked against its ETag (MD5): 734 series from 2017-08-17 to 2026-09-22, with a sha256 manifest.
- 145 excluded: 50 leveraged tokens, 29 stable or pegged tokens, 66 tokenised stocks.
- Rule, point in time: the top 30 by 30-day quote volume, among pairs with 30 straight days of klines and at least 100 days of age. In sample from 2019-07-01.
- 287 pairs pass through it. 70 are since delisted (all BREAK or absent in exchangeInfo); 40 of those were held by a candidate (FTM, MATIC, XMR, OM, TON…). Spans per pair: the manifest, and `inputs.everInUniverse` in the JSON.

**Results.** Out of sample, return % (max drawdown %). Weekly; 10 bps plus half the spread (unmeasured pairs charged the widest measured, 20.4 bps); $100; $5 minimum. The null is random picks from the same 30 with the candidate's own cash weeks, slot counts and turnover, 1,000 draws.

| candidate | A | B | C | D | worst | null p95 | P(null ≥) |
|---|---|---|---|---|---|---|---|
| C1 no filter | −79.1 (80) | +40.7 (67) | +22.2 (60) | −76.5 (77) | −79.1 | −64.8 | 0.973 |
| C2 BTC regime | −25.1 (33) | −10.7 (72) | −48.5 (71) | −65.3 (72) | −65.3 | −30.5 | 0.992 |
| C3 ret>0 | −78.9 (81) | +60.1 (61) | −19.6 (59) | −78.6 (79) | −78.9 | −56.4 | 0.965 |
| C4 ret>0 + regime | −7.0 (33) | −28.2 (75) | −39.8 (67) | −73.7 (82) | −73.7 | −39.5 | 0.998 |
| C5 >100d mean | −76.9 (78) | +100.2 (55) | +39.2 (58) | −75.3 (79) | −76.9 | −52.2 | 0.974 |
| C6 >100d + regime | −25.9 (34) | +25.3 (59) | +25.4 (59) | −64.2 (70) | −64.2 | −25.2 | 0.998 |
| C7 all 36 chosen | = C6 | | | | | | |
| top-30 equal-weight | −71.0 (81) | +17.3 (65) | +15.6 (61) | −52.9 (55) | | | |
| BTC hold | −27.2 (53) | +88.5 (28) | +126.1 (26) | +21.3 (30) | | | |
| 4-coin (§3.4) control | −10.4 (29) | +122.4 (42) | +77.7 (42) | −19.1 (34) | | | |
| incumbent | +8.03 (11) | +20.08 (10) | +55.64 (7) | −7.81 (16) | | | |

- The in-sample choice was k = 5 in all 28 cells and L = 7 in 19. It was chosen on the 2019–21 bull (C7 in sample: +152 % to +582 %).
- Turnover 9–122× a year; fees $0.96–12.52 plus spread $0.72–8.16 per window on $100.

**The bar.**
- No candidate is positive in both A and B.
- Every worst window (−64 % to −79 %) is below its null's 95th percentile (P 0.965–0.998). In its worst window, momentum picked coins that did worse than random picks with the same exposure.
- All candidates break §4.15's 35 % drawdown limit in at least 3 windows.

**Chance count.** 0 passes against 0.002 expected. The 36 grid points as fixed arms: 0 against 0.033. Share of the grid positive: A 25 / B 67 / C 22 / D 0 %.

**Combination.** C7, $50 each, no transfers between accounts:
- Daily correlation 0.32 (0.09–0.40 by window).
- Half each: −9.7 / +22.1 / +40.4 / −36.0 %, drawdowns 16–43 %.
- Incumbent alone on the same calendar: +6.6 / +18.9 / +55.4 / −7.8 %, drawdowns 7–16 %.
- Random picks combined with the incumbent match or beat the worst window in 100 % of draws.

**Robustness (descriptive).**
- BNB fees move a window by −0.7 to +3.7 points; doubling spreads by −7.1 to +3.9.
- On all seven rebalance weekdays, every worst window is −54 % or worse. The weekday alone swings C7's window C from −44 % to +179 %.
- N = 20: C7 is positive in A and B but D is −54 %. N = 50: all four windows negative.

**What follows.**
- Breadth buys no long-only momentum edge on Binance. There is no Binance row to propose, and nothing changes for the Revolut X row.
- The universe is why. Equal-weighted, the top 30 lost 71 % (A) and 53 % (D). Weekly winners reversed. The four majors on the same engine beat every candidate in B, C and D.

**What does not follow.**
- Nothing about short or market-neutral versions (closed to UK retail).
- Nothing about other cross-sectional signals: reversal and low volatility are untested, and testing them is a new search.
- Spreads come from one night. Prices are in USDT (USDC/USDT within 23 bps, apart from USDC's own depeg in D).
- The weekday spread shows any one window is a noisy draw.

**Checks.**
- Two runs wrote byte-identical `xsmom.json` (sha256 `ef95d774…`); the committed file, written with the repository's paths, is `5b68bee9…` and differs only in those strings.
- The klines re-hash to the manifest: 0 mismatches.
- An independent Python re-implementation (`docs/agents/scripts/xsmom/verify_xsmom.py`) matches the universe, the benchmarks, all 28 candidate paths and C7's in-sample choice. Worst |Δ| 5e-5, which is the JSON's rounding.

**Reproduce, from the repository root.** The klines come from Binance's
keyless bulk archive through the scripts in `docs/agents/scripts/xsmom/`, which
write under `$XSMOM_WORK`; `xsmom.json` names the manifest by sha256
(`24cf84bd…`). The exchangeInfo snapshot the run read is committed gzipped,
and the book samples are the Binance cost study's.

```sh
export XSMOM_WORK=<an empty working directory>
python3 docs/agents/scripts/xsmom/list_symbols.py
python3 docs/agents/scripts/xsmom/fetch_klines.py            # --verify re-hashes against the manifest
gunzip -c docs/agents/backtests/inputs/binance_exchangeInfo_2026-09-23.json.gz > "$XSMOM_WORK/exchangeInfo.json"
python3 docs/agents/scripts/xsmom/qa_data.py                 # descriptive; computes no return
deno run --allow-read --allow-write supabase/functions/agents/backtest_xsmom.ts \
  --klines "$XSMOM_WORK/binance_klines" --xinfo "$XSMOM_WORK/exchangeInfo.json" \
  --books docs/agents/backtests/inputs/binance_books_2026-09-23 \
  --data <dir with BTC-USD_1h_3y.json …> --ext <dir with BTC-USD_1h_kraken.json …> \
  --ktape <dir with BTC-USD_4h_kraken.json …> --set2 docs/agents/backtests/set2.json \
  --prereg docs/agents/reviews/2026-09-23-binance-xsmom-prereg.md --out docs/agents/backtests
python3 docs/agents/scripts/xsmom/verify_xsmom.py
```

Keep `--prereg` exactly as written: the string is copied into the output. The
main session re-ran the study on a clean tree with the agent's bytes, then from
the repository with the paths above, which changed only the path strings and
the file's own hash in `xsmom.json`; `verify_xsmom.py`, run from its place in
the repository against the committed `xsmom.json`, agrees to 5e-5 (rounding).
Nothing in this study used a key, placed an order or wrote to the database.
