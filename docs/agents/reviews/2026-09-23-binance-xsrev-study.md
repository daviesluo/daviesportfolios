# Cross-sectional reversal and low volatility on the Binance universe (2026-09-23)

**Answer: no.** None of the 6 pre-registered candidates clears the bar. Chance alone expects 0.009 passes, and 0.011 across both searches on this universe (13 candidates). All six lose money in window A.
- Reversal did worse than random picks in its worst window.
- Low volatility did better than random picks, because it holds the calmest coins, which are the large ones. BTC held alone beat it in B, C and D.

No Binance row is proposed, and nothing changes for the Revolut X row.

**Pre-registration.** `docs/agents/reviews/2026-09-23-binance-xsrev-prereg.md`, frozen at 08:07:52 UTC before any candidate arm ran, sha256 `46fb3074…`. The script's sha256 at the freeze was `d7c73631…`; it is the committed file, unchanged through every run.
- **No correction.** Nothing was appended after the freeze, and no decision rule moved.
- **Disclosure.** Before the freeze, `--stage data` ran once. It rebuilt only numbers already published in `xsmom.json`, `sui.json` and `set2.json`. It also confirmed that every universe member's signals exist on 79,140 member-days, without ranking, holding or pricing anything. Two more runs, fed doctored copies of `xsmom.json`, were refused by the gate.

**The reproduction gate, before any candidate.** 13 of 13 checks pass, each compared byte for byte as JSON with `xsmom.json`:
- the input hashes, spreads, IS_START, windows and excluded pairs;
- all 287 pairs ever in the universe (70 since delisted), with their spans and segments;
- the incumbent on four evaluations, and the simulator checks;
- the top-30 equal weight, BTC held and the four-coin control, in A–D.

The combination partner is the live row as it will go live: BTC/ETH/SOL/AVAX, four $25 slots, go-live draft `0049`. It is xsmom's incumbent run without SUI, and gives A +8.51 / B +25.05 / C +55.64 / D −7.81 %. That equals `sui.json` (A, B) and `set2.json` (C, D) on all four evaluations, worst |Δ| 0.

**The candidates.** Everything but the signal is xsmom's: the universe, weekly Monday fills, 10 bps plus half the spread, $100 and the $5 minimum. Each candidate holds k coins at 1/k of equity.
- **Reversal** holds the k coins with the lowest L-day return.
  - R1: k 5 · L 7.
  - R2: R1 with xsmom's BTC regime filter.
  - R3: (k, L) chosen in sample over k ∈ {3, 5, 10} × L ∈ {3, 7, 14}.
- **Low volatility** holds the k coins with the lowest standard deviation over their last 30 daily returns.
  - V1: k 5.
  - V2: V1 with the regime filter.
  - V3: k chosen in sample over {3, 5, 10}.
- The in-sample choice is xsmom C7's: best return / max(0.05, drawdown), on history from 2019-07-01. R3 took k 5 · L 14 in all four windows. V3 took k 3 in A, C and D, and k 5 in B.

**Results.** Out of sample, return % (max drawdown %). The null is random picks from the same 30 coins with the candidate's own cash weeks, slot counts and turnover, 1,000 draws.

| candidate | A | B | C | D | worst | null p95 | P(null ≥) |
|---|---|---|---|---|---|---|---|
| R1 reversal k5 · L7 | −78.0 (79) | −30.9 (75) | −35.7 (69) | −64.2 (67) | −78.0 | −62.7 | 0.926 |
| R2 R1 + BTC regime | −36.4 (52) | −54.4 (78) | −51.1 (74) | −39.2 (60) | −54.4 | −32.5 | 0.757 |
| R3 reversal, chosen | −78.4 (81) | −59.8 (77) | −21.8 (66) | −58.3 (62) | −78.4 | −60.6 | 0.934 |
| V1 low volatility k5 | −25.6 (52) | +88.0 (42) | +89.3 (40) | −5.1 (28) | −25.6 | −43.9 | 0.000 |
| V2 V1 + BTC regime | −4.8 (26) | +41.3 (40) | +30.8 (49) | −5.9 (28) | −5.9 | −24.4 | 0.000 |
| V3 low volatility, chosen | −20.8 (43) | +88.0 (42) | +30.2 (47) | +12.8 (24) | −20.8 | −38.2 | 0.007 |
| top-30 equal-weight | −71.0 (81) | +17.3 (65) | +15.6 (61) | −52.9 (55) | | | |
| BTC hold | −27.2 (53) | +88.5 (28) | +126.1 (26) | +21.3 (30) | | | |
| 4-coin (§3.4) control | −10.4 (29) | +122.4 (42) | +77.7 (42) | −19.1 (34) | | | |
| live row (4 × $25) | +8.51 (16) | +25.05 (11) | +55.64 (7) | −7.81 (16) | | | |

- **Reversal lost in sample too.** All 18 reversal grid points lost 51–92 % from 2019-07. Fourteen of them had fallen below k × $5, where the $5 minimum stops a $100 book opening a slot, before 2022-08, and sat in cash from then on. Out of sample, R1 crossed that line in window A on 2026-01-20.
- **Low volatility gained in sample**: +86 % to +887 % across its grid and windows.
- **Turnover and costs.** Reversal turned over 14–85× a year, paying $1.4–8.7 in fees plus $1.1–6.8 in spread per window on $100. Low volatility turned over 6–37× a year, paying $0.6–3.8 plus $0.1–0.9.

**The bar.**
- **No candidate is positive in both A and B.** All six lose in window A, by −4.8 % to −78.4 %.
- **Reversal:** every worst window (−54 % to −78 %) is below its null's 95th percentile (P 0.76–0.93). Buying last week's biggest losers picked coins that did worse than random picks with the same exposure. 39 of the 181 coins R1–R3 held have since been delisted.
- **Low volatility:** every worst window (−5.9 % to −25.6 %) is above its null's 95th percentile (P ≤ 0.007). That is the half of the bar momentum and reversal failed.
- **Why low volatility beats the null.** The null matches exposure and turnover, not volatility. BTC, BNB, TRX, ETH, XRP and LTC filled 71–98 % of the low-volatility books' slot-days, a lower bound because only each book's top eight coins are recorded. BTC held alone beat V1 in B, C and D; in A it lost −27.2 % against V1's −25.6 %.
- **§4.15's 35 % drawdown limit.** Every reversal candidate breaks it in all four windows. V1 and V3 break it in three windows, V2 in two (B 40 %, C 49 %).

**Chance count.**
- 0 passes against 0.009 expected (P(≥1) 0.009).
- This is the second search on this universe. Together with xsmom's seven candidates: 0 of 13 pass, against 0.011 expected.
- The 24 grid points as fixed arms: 0 pass, against 0.019 expected.
- Share of the grid positive: reversal A 0 / B 6 / C 11 / D 0 %; low volatility A 0 / B 100 / C 83 / D 33 %.

**Combination with the live row.** $50 in each, with no transfers between the accounts. The row alone on this calendar made +5.1 / +21.4 / +55.4 / −7.8 %, with drawdowns of 7–16 %.
- Daily correlation 0.23–0.35.
- Reversal: the half-each worst windows are −23.5 % to −36.7 %.
- V1: worst window −10.2 % (A). V3: −7.9 % (A), just below the row's −7.8 %.
- **V2: +0.2 / +31.4 / +43.1 / −6.9 %**, drawdowns 19–30 %.
  - Its worst window (−6.9 %) and its worst return/drawdown (−0.36 against −0.50) both beat the row alone.
  - Random picks combined with the row match or beat that worst window in 0.8 % of draws.
  - Those are the numbers the "adds" rule asks for. But V2 fails the bar, so by the pre-registered rule it adds nothing.
- With xsmom's five-coin incumbent in place of the live row, V3 also meets those numbers (−7.1 % against −7.8 %). No verdict changes.

**Robustness (descriptive).**
- BNB fees move a window by +0.1 to +1.6 points. Doubled spreads move one by −4.6 to −0.1 points. No window changes sign.
- **Rebalance weekday.** Reversal's worst window is −51 % or worse on all seven weekdays. V1 and V3 lose in window A on all seven. V2 is positive in all four windows on Thursday and Friday, and negative in A on the other five (Monday: −4.8 %).
- Adding the regime filter to R3's and V3's grids changes only window D's choice. Neither passes.

**What follows.**
- Neither weekly reversal nor low volatility clears the bar over Binance's top 30. There is no Binance row to propose, and nothing changes for the Revolut X row.
- Across both searches, both ends of last week's move lost to random picks: xsmom's winners and this study's losers. The calmest coins beat random picks. On this universe, what separated the coins was volatility, not direction, and the calmest coins are the large ones.

**What does not follow.**
- **Not that low volatility works.** It clears the null's half of the bar by holding calmer coins through falling windows, which the null is not built to control. And it lost in window A.
- **V2's Thursday and Friday runs are not a result.** Picking a weekday after seeing the windows would be a third search, and V2 breaks the 35 % limit on its Monday run anyway.
- Nothing about short or market-neutral versions (closed to UK retail), about other signals, or about other universes.
- xsmom's caveats hold: spreads come from one night, and prices are in USDT.

**Checks.**
- **Determinism.** Two runs, both from the worktree root with repository paths, wrote byte-identical `xsrev.json`, sha256 `ffaf6e74…`. The main session ran it twice more from a clean checkout of `main` with the three new files copied in and the exchangeInfo gunzipped afresh from the committed file: the same bytes both times, and `verify_xsrev.py` on that output printed the same comparison and `VERIFIED`.
- **The gate refuses.** It refused two doctored copies of `xsmom.json`: one with a benchmark digit changed, one with a universe date changed.
- **Klines.** Every parsed kline file the run reads re-hashes to the manifest (`24cf84bd…`, xsmom's).
- **Independent re-implementation.** A pure-Python version, `docs/agents/scripts/xsmom/verify_xsrev.py`, was written from the pre-registration's text. It matches:
  - the universe (287 pairs, first and last dates and decision counts);
  - the three benchmarks: fills identical, worst |Δ| 5e-5, which is the JSON's rounding;
  - all 24 candidate-window daily equity paths: worst |Δ| $5e-7, the JSON's six decimals;
  - R3's and V3's in-sample choices;
  - the first ten null draws of every candidate window: 240 draws, worst |Δ| 5e-7.

  It shares two things with the TypeScript by necessity: xsmom's exclusion list, read from `xsmom.json`, and the null's sampling order, without which it could not draw the same random numbers. It was written by the same agent that wrote the TypeScript.
- **Pinned sources.** `backtest.ts`, `backtest_jev.ts`, `backtest_jev_other.ts`, `backtest_xsmom.ts`, `backtest_maker.ts` and `_shared/agents_strategy.ts` are byte-identical to `origin/main` (`c0c9230`). None of them changed on `main` through `f2182a5` either. CI's `deno check supabase/functions/` passes with the new file.

**Reproduce, from the repository root.**
- The klines come from Binance's keyless bulk archive through the xsmom scripts, which write under `$XSMOM_WORK`.
- The exchangeInfo snapshot is committed gzipped.
- The book samples are the Binance cost study's.
- `sui.json` and `xsmom.json` are read only to check the reproduction.
- Run it with Deno 1.x. `--stage data` runs only the gate.

```sh
export XSMOM_WORK=<an empty working directory>
python3 docs/agents/scripts/xsmom/list_symbols.py
python3 docs/agents/scripts/xsmom/fetch_klines.py            # --verify re-hashes against the manifest
gunzip -c docs/agents/backtests/inputs/binance_exchangeInfo_2026-09-23.json.gz > "$XSMOM_WORK/exchangeInfo.json"
deno run --allow-read --allow-write supabase/functions/agents/backtest_xsrev.ts \
  --klines "$XSMOM_WORK/binance_klines" --xinfo "$XSMOM_WORK/exchangeInfo.json" \
  --books docs/agents/backtests/inputs/binance_books_2026-09-23 \
  --data <dir with BTC-USD_1h_3y.json …> --ext <dir with BTC-USD_1h_kraken.json …> \
  --ktape <dir with BTC-USD_4h_kraken.json …> --set2 docs/agents/backtests/set2.json \
  --sui docs/agents/backtests/sui.json --xsmom docs/agents/backtests/xsmom.json \
  --prereg docs/agents/reviews/2026-09-23-binance-xsrev-prereg.md --out docs/agents/backtests
python3 docs/agents/scripts/xsmom/verify_xsrev.py
```

Keep `--prereg` exactly as written, because the string is copied into the output. The runs here used these repository paths for `--books`, `--set2`, `--sui`, `--xsmom`, `--prereg` and `--out`, and scratchpad copies of the klines, the exchangeInfo (sha256 `8fb2eab1…`, the committed file gunzipped) and the incumbent's tapes.
