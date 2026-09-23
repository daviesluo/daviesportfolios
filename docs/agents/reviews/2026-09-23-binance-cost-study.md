# The Binance-cost study — results

*Written 2026-09-23 (UTC, read from `date -u`) by the session that resumed the study after a usage limit cut off its
final runs. It finishes the study exactly as pre-registered in [`2026-09-23-binance-cost-prereg.md`](2026-09-23-binance-cost-prereg.md): frozen, sha256
`ce27276bf04ae99a88f8ad29c004d519b4742f18b15d55e51e588d7671c8723c` (the file with its 03:14:36 UTC addendum), and
neither edited nor corrected by this session, because nothing in it turned out wrong. The script is the one the
pre-registration names, `supabase/functions/agents/backtest_binance.ts` (sha256 `80f5b1bd…`), run unchanged. Every
study number below is read from the full run's `binance.json` (in §2.2, from the separate reproduction's) by
a report tool (kept outside the repository). That tool fills each figure from a JSON field path and refuses to finish on any path it cannot
resolve. Every table names the field it prints. The few figures that are not in the JSON are labelled with the file
they come from: the two diagnostics (§4.1, §8), and the hashes, sizes and wall times of the run directories (§2).*


*Names like `bc2_full1/` or `bc2_repro/` are the study session's run directories (logs, commands, input
hashes); they are kept outside the repository, and the files they produced that matter are committed.*

## The answer first

- **The reproduction holds, and the run is deterministic.** The Revolut X–only run and the Revolut X arm inside the
  full run re-derive every published cell they are checked against, with 0 differences: `tape.json` 744 cells / 9,672
  fields, `set2.json` 96 fields and `sui.json` 509 fields. The full run, made twice as two processes, wrote
  byte-identical files, sha256 `b7e4fb4f4d77e94f9ffc9de265568c51c731cc2a85160e13e64e22381ac4c4dc`.
- **Part 1: the cost is worth tenths of a point, and the sleeve's worst window does not move.** Binance's fee is 1 bp
  a side more than Revolut X's taker fee and its books are tighter, so on the majors the two cancel. The saving is the
  spread on AVAX and SUI. The live sleeve's worst window is D under every arm: ret÷DD -0.50 at `revx`, -0.50 at
  `binance`, and -0.48 with the BNB discount. One large difference, window A on the Coinbase tape (+5.61 points), **is
  not the cost**: +5.56 of it is SUI's slot, where one 8 % floor fired at Revolut X's spread and missed by 3 bps at
  Binance's, just before SUI's file ends on a rally the other coins' files do not contain. On Kraken's tape, where
  both arms take the same trades, window A moves +0.29.
- **Part 2: SUI's seat is undecided under every arm.** At `binance`, p(worse) is 0.1942 (Coinbase tape) and 0.2557
  (Kraken tape), and p(better) is 0.8395 / 0.8218. At `binanceBnb` p(worse) is 0.1782 / 0.2557. SUI is still last of
  the five by whole-span slot P&L, on both tapes, under every arm.
- **Part 3: nothing clears at Binance cost that chance would not give.** At the headline (shipped stop, seeded
  parameters, both tapes agreeing), 1 coin clears both windows under each Binance arm (AVAX), where §3.12's control
  expects 4.17 and the exact P(≥ 1) is 0.9997. No coin is new at Binance cost. The reading rule finds something in 0
  of the 48 condition × venue cells. Every headline difference from Revolut X is the book leg: the four tests
  themselves agree in 91 of 91 coin-windows.
- **So:** at this account's tier, executing the row on Binance changes no verdict the project has reached. It does not
  move the worst window, it does not decide SUI's seat, and it admits no coin.

## 1. What was asked

Davies holds a Binance spot account (UK retail, unfunded) at 0.10 % maker and 0.10 % taker, 0.075 % with the BNB
discount; Revolut X charges 0 % maker / 0.09 % taker and the loop takes the touch there (`ownersQuestion`). The study
asks what three existing results become if the same orders paid Binance's cost. The rule (`trend-4h`), windows A–D,
tapes, stop rules, parameter grid and evaluations all stay the same. ONLY the `Costs` object handed to `backtest.ts`'s
`run` changes (`study`):

1. **Part 1**: each live coin (BTC, ETH, SOL, AVAX, SUI) and the live sleeve (five $20 slots), window by window.
   Descriptive; no pass/fail rule.
2. **Part 2**: SUI's seat. §3.20's pre-registered rank test, re-run with the whole row priced at each arm's cost. Drop
   only if p(worse) < 0.05 on BOTH tapes. Supported only if p(better) < 0.05 on both. Otherwise undecided.
3. **Part 3**: §3.8's two-window screen and §4.15's bar over the 27-coin universe at Binance cost, with a Binance book
   leg, against the chance count. A venue's screen has found something only if the number of coins clearing both
   windows exceeds §3.12's expectation AND the exact P(≥ k) is under 0.05.

Whether Binance may serve this UK account, custody and funding are not this study's question (pre-registration §9).

## 2. How it was run, and what reproduces

### 2.1 The script, unchanged, on origin/main

- The run used a detached worktree at origin/main `a626c79`, with `backtest_binance.ts` copied in byte for byte
  (sha256 `80f5b1bd348bb740…`). These are the same bytes as the backup at `wip/2026-09-23-studies/binance_cost/` on
  `claude/repo-audit-restore-uverhn`, and as the earlier session's final runs. `deno check` passes; Deno 1.46.3.
- `backtest.ts` hashes to `31d27c7d82f8a94c1a8d71248ace8e5ded611190a77d06043460b469ccae845a` on main. The run hashed
  it at its start and its end (`sourceIntegrity.backtestTsSha256`, `stableAcrossRun: true`). The script's whole import
  closure is `backtest.ts` and `_shared/agents_strategy.ts`, which imports nothing. Neither changed between the commit
  the script was written against (`8288c82`) and `a626c79`. Nor did `tape.json`, `set2.json` or `sui.json`, the
  published files it is checked against.
- `backtest_jev.ts` changed in `a626c79` and now exports machinery that `backtest_binance.ts` carries its own verbatim
  copies of: `dailyMarks`, `dailyReturns`, `combine`, `score`, `iso`, `toCandles`, `indexAtOrAfter`, `windowsOn`,
  `r3`, `r4`, and local equivalents of `stopsOf` and `CONDITIONS`. The script does not import `backtest_jev.ts`. The
  copies were left alone, because this is a pre-registered script.
- Inputs: 81 price files (27 coins × Coinbase hourly, Kraken's hourly extension, Kraken's own 4 h tape), each
  sha256-identical to what the earlier session's runs recorded (`data.perSymbol[].files`). The book samples match the
  hashes the pre-registration names (`paired_samples.jsonl` `2c96e486…`, `binance_cost_bookticker_samples.jsonl`
  `c520f902…`) and are re-derived from the raw samples inside the run (`fidelity.bookConstants`).

### 2.2 The Revolut X–only reproduction (`--arms revx`, `bc2_repro/`)

| check | this session (`bc2_repro/binance.json`) | the earlier session's log (`bc_repro/run.log`) |
|---|---|---|
| `fidelity.vsTape`: every §4.15 cell of `tape.json` | 744 cells, 9,672 fields, 0 differences | 744 cells, 9,672 fields, 0 |
| `fidelity.vsSet2`: the live sleeve, four windows × four conditions | 96 fields, 0 differences | 96, 0 |
| `fidelity.vsSui`: §3.20's folds, primary test and span | 509 fields, 0 differences | 509, 0 |
| `fidelity.vsSuiS5`: `sui.json`'s S5 `assumed` arm | 84 fields, 0 differences | (not in the earlier script) |
| `fidelity.bookConstants`: every book constant from the raw samples | 263 fields, 0 differences | (not run) |
| `fidelity.runDaily`: daily marks against `run`'s own curve | 232 cells, 1,392 checks, worst 5e-06 (tolerance 5e-06) | — |

It reproduces the published cells again, with the same counts as before. Beyond the counts, every value the two
reproductions share is identical: Part 1, Part 3, the data provenance, the `reproduction` block and Part 2. The only
exceptions are two fields the final script added (`windowsSuiHas` and `spanWhereAllFiveExist[*].sleeveStats`), which
the earlier version did not write. Wall time 892 s (`bc2_repro/run.log`).

### 2.3 The reproduction inside the full run (pre-registration §7), read before any Binance number

- `preRegistration`: {"file": "prereg_binance_cost.md", "sha256":
  "ce27276bf04ae99a88f8ad29c004d519b4742f18b15d55e51e588d7671c8723c"}
- `sourceIntegrity.backtestTsSha256`: `31d27c7d82f8a94c1a8d71248ace8e5ded611190a77d06043460b469ccae845a`
  (stableAcrossRun: True)
- `costArms.armsPriced`: ['revx', 'revxMedian', 'binance', 'binanceBnb']
- `data.symbols`: 27 accepted

| check (`fidelity.*`) | compared | differences |
|---|---|---|
| `vsTape` | 744 cells / 9672 fields | 0 |
| `vsSet2` | 96 fields | 0 |
| `vsSui` | 509 fields | 0 |
| `vsSuiS5` | 168 fields | 0 |
| `bookConstants` | 263 fields | 0 |
| `runDaily` (marks vs `run`'s own curve) | 736 cells / 4416 checks | worst 5e-06 (tolerance 5e-06; pass True) |

`reproduction` (the published numbers the revx arm must re-derive, pre-registration §7):

| item | this run | published |
|---|---|---|
| §3.20 primary test, shipped·coinbase: mean rank / p(worse) | 3.571 / 0.1782 | 3.571 / 0.1782 |
| §3.20 primary test, shipped·kraken: mean rank / p(worse) | 3.429 / 0.2557 | 3.429 / 0.2557 |
| live sleeve shipped·coinbase window A: ret / DD / ret÷DD | +8.03 % / 11.28 % / 0.71 | (checked field by field in `fidelity.vsSet2`) |
| live sleeve shipped·coinbase window B: ret / DD / ret÷DD | +20.08 % / 10.47 % / 1.92 | (checked field by field in `fidelity.vsSet2`) |
| live sleeve shipped·coinbase window C: ret / DD / ret÷DD | +55.64 % / 7.35 % / 7.57 | (checked field by field in `fidelity.vsSet2`) |
| live sleeve shipped·coinbase window D: ret / DD / ret÷DD | -7.81 % / 15.52 % / -0.5 | (checked field by field in `fidelity.vsSet2`) |
| §4.15 base rate: clear / priced coin-windows, rate, expected, coins with A and B | 26 / 93, 0.28, 1.8, 23 | 26 / 93, 0.28, 1.8, 23 |

Every §7 item holds: 0 differences against `tape.json`, `set2.json` and `sui.json`, the primary test's 3.571 / 3.429
and 0.1782 / 0.2557, and the base rate 26 of 93. Two independent re-derivations from the JSON agree with it.
`bc2_tables.py` enumerates all 5^7 rank vectors for every primary test, recomputes (a) and (b) of every chance count
from the membership lists, and checks the charged round trips against the pre-registered table and each verdict
against its own p-values; all its checks pass. The earlier session's `binance_cost_checks.py`, written before any
Binance number existed, agrees on 16 of 16 rank tests, 48 of 48 chance counts and every round trip
(`bc2_full1/earlier_checks.out`). So every Binance cell below differs from its Revolut X twin by the cost alone. With
`revxMedian` priced, `vsSuiS5` also checks the descriptive arm against `sui.json`'s S5 `sampled` arm (§3.20's measured
SUI median, 14.877 bps).

### 2.4 Determinism (pre-registration §8)

The full run was made twice, as two concurrent processes writing to separate directories, with identical arguments
(`bc2_full1/cmd.txt`, `bc2_full2/cmd.txt`; wall time 2,247 s and 2,374 s):

| file | sha256 |
|---|---|
| `bc2_full1/binance.json` | `b7e4fb4f4d77e94f9ffc9de265568c51c731cc2a85160e13e64e22381ac4c4dc` |
| `bc2_full2/binance.json` | `b7e4fb4f4d77e94f9ffc9de265568c51c731cc2a85160e13e64e22381ac4c4dc` |

`cmp` finds them byte-identical (1,706,559 bytes each). The reproduction-only file is a different run with one arm, so
its hash differs (`bc2_repro/binance.json`, `73cb2dff…`).

## 3. The cost model per arm

A fill pays the fee plus the half-spread. An entry fills at the next open × (1 + half-spread), a rule exit at the next
open × (1 − half-spread), and a stop at min(level, open) × (1 − half-spread). Each pays the arm's `fillFee` on the
notional (`backtest.ts`, `run`). A round trip is therefore 2 × fee + the full spread.

| arm (`costArms.*`) | makerBps | takerBps | fillFee | half-spread |
|---|---|---|---|---|
| `revx` | 0 | 9 | taker | `COSTS.revx.halfSpread`, untouched |
| `revxMedian` | 0 | 9 | taker | SUI 7.4385 bps a side (14.877 full); others = revx |
| `binance` | 10 | 10 | taker | per coin, below |
| `binanceBnb` | 7.5 | 7.5 | taker | per coin, below |
| `kraken` | 40 | 80 | maker | `COSTS.kraken.halfSpread`, untouched |

Round trip per coin, bps = 2 × fee + full spread (`books.roundTripBps`), the Binance half-spread charged per side and
its source (`books.halfSpreadCharged`), and the pre-registration's table beside it:

| coin | revx | kraken | binance | binanceBnb | Binance half-spread bps (source) | matches the pre-registration's table |
|---|---|---|---|---|---|---|
| AAVE | 22.93 | 88.19 | 20.68 | 15.68 | 0.338 (this study's sampler) | yes |
| ADA | 26.5 | 84.1 | 23.92 | 18.92 | 1.958 (this study's sampler) | yes |
| ALGO | 34.51 | 87.02 | 28.85 | 23.85 | 4.423 (this study's sampler) | yes |
| ATOM | 39.84 | 90.62 | 25.44 | 20.44 | 2.718 (this study's sampler) | yes |
| AVAX | 27.6 | 81.7 | 20.9 | 15.9 | 0.449 (paired sampler) | yes |
| BCH | 38.69 | 88.22 | 22.93 | 17.93 | 1.466 (this study's sampler) | yes |
| BNB | 28.49 | 81.39 | 20.13 | 15.13 | 0.063 (this study's sampler) | yes |
| BTC | 19.5 | 80.01 | 20 | 15 | 0.001 (paired sampler) | yes |
| DOGE | 24.4 | 84.4 | 20.98 | 15.98 | 0.488 (this study's sampler) | yes |
| DOT | 34.18 | 86.77 | 28.28 | 23.28 | 4.141 (this study's sampler) | yes |
| ETC | 52.25 | 97.11 | 30.52 | 25.52 | 5.261 (this study's sampler) | yes |
| ETH | 20.1 | 80.04 | 20.04 | 15.04 | 0.018 (paired sampler) | yes |
| HBAR | 29.22 | 86.6 | 21 | 16 | 0.498 (this study's sampler) | yes |
| HYPE | 42.64 | 83.17 | — | — | not priced | yes |
| ICP | 52.07 | 86.8 | 23.33 | 18.33 | 1.666 (this study's sampler) | yes |
| LINK | 26.4 | 83.03 | 20.77 | 15.77 | 0.383 (this study's sampler) | yes |
| LTC | 28.21 | 84.79 | 21.59 | 16.59 | 0.796 (this study's sampler) | yes |
| NEAR | 43.42 | 84.56 | 22.31 | 17.31 | 1.157 (this study's sampler) | yes |
| PEPE | 32.22 | 84.7 | 40.43 | 35.43 | 10.214 (this study's sampler) | yes |
| POL | 53.52 | 95.93 | 20.91 | 15.91 | 0.457 (this study's sampler) | yes |
| SHIB | 29.35 | 83.52 | 36.27 | 31.27 | 8.136 (this study's sampler) | yes |
| SOL | 21.1 | 80.92 | 20.84 | 15.84 | 0.422 (paired sampler) | yes |
| SUI | 41.94 · revxMedian 32.88 | 83.82 | 20.98 | 15.98 | 0.489 (paired sampler) | yes |
| TON | 53.77 | 87.04 | — | — | not priced | yes |
| UNI | 26.23 | 86.59 | 20.94 | 15.94 | 0.469 (this study's sampler) | yes |
| XLM | 31.59 | 83.23 | 24.58 | 19.58 | 2.289 (this study's sampler) | yes |
| XRP | 23.8 | 81 | 20.63 | 15.63 | 0.314 (this study's sampler) | yes |

27 of 27 coins match the pre-registered table (tolerance 0.011 bps on a round trip, 0.0006 on a half-spread: the table
rounds to 2 and 4 dp).

The five live coins on Revolut X's UK book — what `COSTS.revx` charges against the paired sample's median tonight
(`books.liveFiveRevolutXCompared`), with Binance's round trip:

| coin | COSTS.revx full spread / round trip | paired UK median tonight: full spread / round trip | binance round trip | binanceBnb round trip |
|---|---|---|---|---|
| BTC | 1.5 / 19.5 | 1.628 / 19.63 | 20 | 15 |
| ETH | 2.1 / 20.1 | 1.758 / 19.76 | 20.04 | 15.04 |
| SOL | 3.1 / 21.1 | 3.632 / 21.63 | 20.84 | 15.84 |
| AVAX | 9.6 / 27.6 | 8.988 / 26.99 | 20.9 | 15.9 |
| SUI | 23.94 / 41.94 | 23.561 / 41.56 | 20.98 | 15.98 |

The Binance spreads charged are medians of keyless `bookTicker` samples. The five live coins come from the paired
sampler, 2026-09-23 02:21:32 → 02:31:10 UTC (20 samples). The rest come from this study's own sampler, 2026-09-23
02:44:08 → 03:08:08 UTC (25 samples) (`books.pairedFive`, `books.binanceOwnSample`). HYPE has no Binance spot pair,
and TON's pair was in status BREAK with an empty book, so neither is priced in a Binance arm or counted in a Binance
population. The Revolut X spreads are `COSTS.revx`, untouched; `revxMedian` changes SUI's alone, to §3.20's measured
median. The `binance` fee of 10 bps is what the read-only probe returned for this account at 02:24 UTC (reference §6,
"Binance and Deribit keys": "commission 0.10 % maker and 0.10 % taker at this tier"). The `binanceBnb` 7.5 bps is the
discount as stated for the study; no probe measured it.

**What the arms change, in round trips (`books.roundTripBps`).** Against Revolut X, Binance's fee is 1 bp a side
dearer and its books are tighter, so on the three majors the two cancel. BTC goes 19.50 → 20.00 bps, ETH 20.10 →
20.04, and SOL 21.10 → 20.84. The saving is the spread on the thinner UK books: AVAX 27.60 → 20.90, SUI 41.94 → 20.98.
SUI costs 32.88 at §3.20's measured median UK spread (`revxMedian`). The BNB discount takes another 5 bps off every
round trip.

## 4. Part 1: the five live coins and the live sleeve

**Per coin** (seeded parameters, shipped stop; tables below). Against `revx`, `binance` moves each coin's
out-of-sample return over its window × tape cells as follows (the arm's return minus revx's, in points):

- BTC -0.11 to -0.06
- ETH -0.01 to +0.01
- SOL +0.00 to +0.03
- AVAX +0.30 to +1.48

With the BNB discount the range is BTC +0.52 to +1.03, ETH +0.51 to +0.96, SOL +0.10 to +1.05, and AVAX +0.52 to
+2.68.

SUI, the coin the saving is largest on, moves by 1.3 to 1.6 points in three of its four cells:

- window A, Kraken tape: +29.09 → +30.71 %
- window B, Coinbase tape: -2.53 → -1.23 %
- window B, Kraken tape: -2.72 → -1.42 %

Its fourth cell, window A on the Coinbase tape, reads +1.36 % at `revx` and +32.46 % at `binance`. That gap is not a
cost effect (§4.1). The descriptive `revxMedian` arm (SUI at 32.88 bps a round trip) sits beside `revx`: it moves
SUI's four cells by a fraction of a point, and the sleeve's A and B by +0.09 and +0.06 points (Coinbase tape).

**The sleeve** (five $20 slots; C and D are four-coin sleeves because SUI has no C or D). The worst window is D under
every arm and in every condition. Shipped stop, Coinbase tape:

| arm | D return | D ret÷DD |
|---|---|---|
| `revx` | -7.81 % | -0.50 |
| `binance` | -7.71 % | -0.50 |
| `binanceBnb` | -7.32 % | -0.48 |

At `binance`, windows B, C and D gain +0.36, +0.13 and +0.10 points. On Kraken's tape they gain +0.37, +0.12 and
+0.10. Window A gains +0.29 on Kraken's tape and +5.61 on the Coinbase tape. Of that last figure, +5.56 points is
SUI's $20 slot, which is the cell of §4.1.

**shipped·coinbase, seeded** — out-of-sample return % (drawdown %, trades) from
`part1_theLiveCoins.perCoin["shipped·coinbase"][coin][window][arm].seeded.{ret,maxDD,trades}`:

| coin | arm | A | B | C | D |
|---|---|---|---|---|---|
| BTC | revx | -10.7 (18.8, 28) | +12.4 (17.1, 36) | +0.3 (26.4, 34) | +14.5 (8.9, 20) |
| BTC | kraken | -17.9 (23.8, 28) | +0.8 (20.1, 36) | -9.5 (29.3, 34) | +7.8 (10.5, 20) |
| BTC | binance | -10.8 (18.8, 28) | +12.2 (17.1, 36) | +0.2 (26.5, 34) | +14.5 (8.9, 20) |
| BTC | binanceBnb | -10.1 (18.4, 28) | +13.3 (16.9, 36) | +1.1 (26.2, 34) | +15.1 (8.8, 20) |
| ETH | revx | -8.0 (20.3, 22) | +80.2 (19.0, 20) | +81.5 (13.0, 16) | -6.3 (28.3, 24) |
| ETH | kraken | -13.9 (24.2, 22) | +69.7 (20.2, 20) | +73.0 (13.5, 16) | -12.8 (32.3, 24) |
| ETH | binance | -8.0 (20.3, 22) | +80.1 (19.0, 20) | +81.5 (13.0, 16) | -6.3 (28.3, 24) |
| ETH | binanceBnb | -7.5 (20.0, 22) | +81.0 (18.9, 20) | +82.2 (12.9, 16) | -5.7 (28.0, 24) |
| SOL | revx | +17.6 (23.4, 14) | +3.0 (29.1, 29) | +69.8 (22.0, 24) | -8.3 (12.6, 4) |
| SOL | kraken | +12.7 (25.7, 14) | -5.6 (32.1, 29) | +58.0 (23.3, 24) | -9.4 (13.4, 4) |
| SOL | binance | +17.6 (23.4, 14) | +3.0 (29.1, 29) | +69.8 (21.9, 24) | -8.3 (12.6, 4) |
| SOL | binanceBnb | +18.0 (23.2, 14) | +3.7 (28.9, 29) | +70.8 (21.9, 24) | -8.2 (12.5, 4) |
| AVAX | revx | +34.1 (8.7, 9) | +6.8 (24.7, 20) | +126.7 (29.7, 19) | -29.5 (33.1, 16) |
| AVAX | kraken | +30.8 (8.7, 9) | +1.1 (25.9, 20) | +115.3 (32.1, 19) | -32.6 (35.8, 16) |
| AVAX | binance | +34.5 (8.7, 9) | +7.5 (24.5, 20) | +128.1 (29.4, 19) | -29.2 (32.8, 16) |
| AVAX | binanceBnb | +34.8 (8.7, 9) | +8.0 (24.4, 20) | +129.2 (29.2, 19) | -28.9 (32.6, 16) |
| SUI | revx | +1.4 (28.9, 12) | -2.5 (31.3, 10) | — | — |
| SUI | revxMedian | +1.8 (28.8, 12) | -2.2 (31.1, 10) | — | — |
| SUI | kraken | +28.0 (28.9, 11) | -4.3 (32.4, 10) | — | — |
| SUI | binance | +32.5 (27.5, 11) | -1.2 (30.5, 10) | — | — |
| SUI | binanceBnb | +32.8 (27.4, 11) | -1.0 (30.3, 10) | — | — |

**shipped·kraken, seeded** — out-of-sample return % (drawdown %, trades) from
`part1_theLiveCoins.perCoin["shipped·kraken"][coin][window][arm].seeded.{ret,maxDD,trades}`:

| coin | arm | A | B | C | D |
|---|---|---|---|---|---|
| BTC | revx | -10.1 (17.9, 28) | +25.8 (9.4, 36) | -6.2 (28.1, 34) | +14.5 (8.9, 20) |
| BTC | kraken | -17.4 (23.0, 28) | +12.8 (11.8, 36) | -15.3 (30.9, 34) | +7.8 (10.5, 20) |
| BTC | binance | -10.2 (18.0, 28) | +25.7 (9.4, 36) | -6.3 (28.1, 34) | +14.5 (8.9, 20) |
| BTC | binanceBnb | -9.6 (17.5, 28) | +26.9 (9.3, 36) | -5.5 (27.9, 34) | +15.1 (8.8, 20) |
| ETH | revx | -6.8 (19.2, 22) | +74.9 (18.9, 22) | +55.6 (20.5, 18) | -6.3 (28.3, 24) |
| ETH | kraken | -12.7 (23.3, 22) | +63.7 (20.2, 22) | +47.4 (21.5, 18) | -12.8 (32.3, 24) |
| ETH | binance | -6.8 (19.2, 22) | +74.9 (18.9, 22) | +55.6 (20.5, 18) | -6.3 (28.3, 24) |
| ETH | binanceBnb | -6.2 (18.9, 22) | +75.8 (18.9, 22) | +56.3 (20.5, 18) | -5.7 (28.0, 24) |
| SOL | revx | +13.2 (26.4, 16) | -0.2 (29.2, 31) | +57.7 (22.7, 24) | -8.3 (12.6, 4) |
| SOL | kraken | +7.9 (29.0, 16) | -9.1 (32.1, 31) | +46.7 (24.3, 24) | -9.4 (13.4, 4) |
| SOL | binance | +13.2 (26.4, 16) | -0.2 (29.2, 31) | +57.7 (22.7, 24) | -8.3 (12.6, 4) |
| SOL | binanceBnb | +13.6 (26.2, 16) | +0.5 (28.9, 31) | +58.6 (22.5, 24) | -8.2 (12.5, 4) |
| AVAX | revx | +12.6 (9.0, 8) | +15.2 (22.4, 20) | +149.8 (23.8, 19) | -29.5 (33.1, 16) |
| AVAX | kraken | +10.2 (9.5, 8) | +9.2 (23.7, 20) | +137.2 (25.9, 19) | -32.6 (35.8, 16) |
| AVAX | binance | +12.9 (8.9, 8) | +16.0 (22.3, 20) | +151.2 (23.6, 19) | -29.2 (32.8, 16) |
| AVAX | binanceBnb | +13.1 (8.9, 8) | +16.6 (22.1, 20) | +152.4 (23.4, 19) | -28.9 (32.6, 16) |
| SUI | revx | +29.1 (20.8, 13) | -2.7 (31.4, 10) | — | — |
| SUI | revxMedian | +29.8 (20.8, 13) | -1.9 (30.8, 10) | — | — |
| SUI | kraken | +25.5 (21.2, 13) | -4.4 (32.5, 10) | — | — |
| SUI | binance | +30.7 (20.8, 13) | -1.4 (30.5, 10) | — | — |
| SUI | binanceBnb | +31.1 (20.7, 13) | -1.2 (30.4, 10) | — | — |

**shipped·coinbase** — the live sleeve, ret % / drawdown % / ret÷DD per window
(`part1_theLiveCoins.sleeve["shipped·coinbase"][arm].perWindow[w]`), and the worst window by ret÷DD (`…worstOfFour`):

| arm | A | B | C (4 coins) | D (4 coins) | worst window |
|---|---|---|---|---|---|
| revx | +8.03 / 11.28 / 0.71 | +20.08 / 10.47 / 1.92 | +55.64 / 7.35 / 7.57 | -7.81 / 15.52 / -0.50 | D (-0.50, -7.81 %) |
| revxMedian | +8.12 / 11.24 / 0.72 | +20.14 / 10.47 / 1.92 | +55.64 / 7.35 / 7.57 | -7.81 / 15.52 / -0.50 | D (-0.50, -7.81 %) |
| binance | +13.64 / 11.19 / 1.22 | +20.44 / 10.45 / 1.96 | +55.77 / 7.34 / 7.60 | -7.71 / 15.45 / -0.50 | D (-0.50, -7.71 %) |
| binanceBnb | +14.06 / 11.00 / 1.28 | +21.01 / 10.35 / 2.03 | +56.35 / 7.26 / 7.76 | -7.32 / 15.16 / -0.48 | D (-0.48, -7.32 %) |

**shipped·kraken** — the live sleeve, ret % / drawdown % / ret÷DD per window
(`part1_theLiveCoins.sleeve["shipped·kraken"][arm].perWindow[w]`), and the worst window by ret÷DD (`…worstOfFour`):

| arm | A | B | C (4 coins) | D (4 coins) | worst window |
|---|---|---|---|---|---|
| revx | +9.16 / 10.92 / 0.84 | +22.49 / 10.00 / 2.25 | +50.95 / 7.74 / 6.58 | -7.81 / 15.52 / -0.50 | D (-0.50, -7.81 %) |
| revxMedian | +9.26 / 10.87 / 0.85 | +22.66 / 9.99 / 2.27 | +50.95 / 7.74 / 6.58 | -7.81 / 15.52 / -0.50 | D (-0.50, -7.81 %) |
| binance | +9.45 / 10.80 / 0.87 | +22.86 / 9.97 / 2.29 | +51.07 / 7.73 / 6.61 | -7.71 / 15.45 / -0.50 | D (-0.50, -7.71 %) |
| binanceBnb | +9.88 / 10.54 / 0.94 | +23.45 / 9.88 / 2.37 | +51.66 / 7.64 / 6.76 | -7.32 / 15.16 / -0.48 | D (-0.48, -7.32 %) |

**trail·coinbase** — the live sleeve, ret % / drawdown % / ret÷DD per window
(`part1_theLiveCoins.sleeve["trail·coinbase"][arm].perWindow[w]`), and the worst window by ret÷DD (`…worstOfFour`):

| arm | A | B | C (4 coins) | D (4 coins) | worst window |
|---|---|---|---|---|---|
| revx | -0.33 / 11.75 / -0.03 | +12.64 / 10.18 / 1.24 | +47.07 / 5.78 / 8.14 | -3.20 / 11.13 / -0.29 | D (-0.29, -3.20 %) |
| revxMedian | -0.20 / 11.69 / -0.02 | +12.72 / 10.18 / 1.25 | +47.07 / 5.78 / 8.14 | -3.20 / 11.13 / -0.29 | D (-0.29, -3.20 %) |
| binance | +5.39 / 11.60 / 0.46 | +12.97 / 10.16 / 1.28 | +47.21 / 5.78 / 8.17 | -3.10 / 11.06 / -0.28 | D (-0.28, -3.10 %) |
| binanceBnb | +5.87 / 11.38 / 0.52 | +13.65 / 10.04 / 1.36 | +47.84 / 5.73 / 8.35 | -2.69 / 10.77 / -0.25 | D (-0.25, -2.69 %) |

**trail·kraken** — the live sleeve, ret % / drawdown % / ret÷DD per window
(`part1_theLiveCoins.sleeve["trail·kraken"][arm].perWindow[w]`), and the worst window by ret÷DD (`…worstOfFour`):

| arm | A | B | C (4 coins) | D (4 coins) | worst window |
|---|---|---|---|---|---|
| revx | +6.54 / 11.64 / 0.56 | +13.77 / 9.43 / 1.46 | +38.29 / 5.96 / 6.43 | -3.20 / 11.13 / -0.29 | D (-0.29, -3.20 %) |
| revxMedian | +6.67 / 11.58 / 0.58 | +13.85 / 9.43 / 1.47 | +38.29 / 5.96 / 6.43 | -3.20 / 11.13 / -0.29 | D (-0.29, -3.20 %) |
| binance | +6.89 / 11.50 / 0.60 | +14.10 / 9.41 / 1.50 | +38.43 / 5.94 / 6.47 | -3.10 / 11.06 / -0.28 | D (-0.28, -3.10 %) |
| binanceBnb | +7.39 / 11.29 / 0.65 | +14.79 / 9.30 / 1.59 | +39.12 / 5.87 / 6.66 | -2.69 / 10.77 / -0.25 | D (-0.25, -2.69 %) |

### 4.1 The one large number is a stop, not a cost

SUI's window A on the Coinbase-spliced tape (shipped stop, seeded) reads +1.36 % on 12 trades at `revx`, and +32.46 %
on 11 at `binance`. A round trip about 21 bps cheaper, over the six round trips `revx` makes here, is worth about 21 ×
6 ≈ 126 bps, or 1.3 points. That is the size of SUI's other three cells, not thirty. The trade count says the path
changed. The diagnostic `bc2_sui_stop_diag.ts` shows how. It calls `run` unchanged and first reproduces both cells
exactly (+1.36 % / 12 trades, +32.46 % / 11). It then finds the two paths identical for eleven fills
(`bc2_sui_stop_diag.out`):

- The eleventh fill is an entry at the open of the 2026-09-19T20:00Z bar (0.8748).
- The next 4-hour bar starts 2026-09-20T00:00Z. Its low is 0.8051, printed at 03:00.
- That low is **8.44 bps under `revx`'s 8 % floor** (0.805779) and **3.04 bps above `binance`'s** (0.804855).
- The floor is 8 % under the entry FILL, and the fill includes the half-spread. In `applyFill`, `avgCost` is the fill
  price; the fee stays outside it. The two floors are therefore 11.48 bps apart: `revx` charges SUI 11.97 bps a side
  (`costArms.revx.halfSpread`), `binance` 0.49.

`revx` is stopped out. `binance` holds from there to the end of SUI's file. SUI closed at 0.826 at 2026-09-20T03:00Z
and at 1.040 at 2026-09-21T13:00Z, the file's last hour (+25.9 %). Those hours exist only in the SUI and AVAX files:
BTC, ETH and SOL's Coinbase files end at 2026-09-20T03:00Z, AVAX's at 2026-09-21T12:00Z and SUI's at 2026-09-21T13:00Z
(all in `bc2_sui_stop_diag.out`). §3.20 saw the same thing from the other side: "most of what SUI earned in window A
sits in the last 36 hours of data". The arms group by half-spread exactly as the floor predicts:

| arm | SUI half-spread (bps a side) | path | window A |
|---|---|---|---|
| `kraken` | 1.91 | `binance`'s | +27.98 % on 11 trades |
| `revxMedian` | 7.44 | `revx`'s | +1.82 % on 12 |

It is the only path change of its kind. The trade count differs between `revx` and `binance` in 2 of 364 seeded coin ×
window × tape × stop cells, and both are this cell (shipped and trail). Every other Binance cell takes the same trades
as its Revolut X twin at a different price. `binanceBnb` earns at least as much as `binance` in 364 of 364 seeded
cells, on the same trades in 364. On chosen parameters the cost also moves the in-sample choice: for SUI's window A,
`revx` picks 20/50/3 and `binance` 20/50/2 (Appendix A). So chosen-parameter comparisons across arms mix a parameter
change with the cost.

## 5. Part 2: SUI's seat

The pre-registered rule, applied per arm on the shipped stop and both tapes, reads **undecided under every arm**:

| arm | p(worse), Coinbase / Kraken tape | p(better), Coinbase / Kraken tape | verdict |
|---|---|---|---|
| `revx` | 0.1782 / 0.2557 | 0.8831 / 0.8218 | undecided (reproduces §3.20) |
| `binance` | 0.1942 / 0.2557 | 0.8395 / 0.8218 | undecided |
| `binanceBnb` | 0.1782 / 0.2557 | 0.8831 / 0.8218 | undecided |

The descriptive `revxMedian` arm has the same fold ranks as `revx` and carries no verdict. Under the `trail` stop,
reported beside and never read, SUI's mean rank is 2.79–3.00 under every arm.

**Last of five.** SUI's whole-span slot P&L per dollar (2023-05-20 → 2026-09-20, 3.34 years, shipped;
`spanWhereAllFiveExist["shipped·<tape>"]`) is the lowest of the five on both tapes under every arm. By arm, Coinbase
tape / Kraken tape:

| arm | SUI's slot P&L per $ | SUI last of five |
|---|---|---|
| `revx` | -5.8 / -1.1 % | yes / yes |
| `revxMedian` | -4.8 / +0.6 % | yes / yes |
| `binance` | -0.4 / +2.2 % | yes / yes |
| `binanceBnb` | +0.3 / +2.9 % | yes / yes |

The order at `binance` is ETH > AVAX > SOL > BTC > SUI (Coinbase tape). At Binance's cost SUI's slot about breaks even
over the span, while the next-weakest, BTC, makes +8.8 / +13.5 %. So the cost of SUI's wide UK book is not what leaves
its seat undecided. Priced at Binance's 0.49 bps half-spread, its rank on the removal cost barely moves, and it is
still the weakest earner. One secondary reading dips under 0.05. The dollar-drawdown rank test's p(better) is 0.0407
on Kraken's tape under both Binance arms, against 0.1782 on the Coinbase tape. It is one secondary test on one tape,
and the rule reads only the primary test on both. The t-test on the return delta that §3.20 found at 0.0488 / 0.0507
reads 0.0627 / 0.0586 at `binance`.

Span `part2_suiSeat.span`: 2023-05-20T08:00Z → 2026-09-20T04:00Z, 3.34 years, 7 folds of 174.12 days.

Primary test, shipped stop (`part2_suiSeat.perArm[arm].primaryPerTape[tape]`), verdict (`…verdict`):

| arm | SUI round trip bps | Coinbase tape: mean rank (null) / p(worse) / p(better) / fold ranks | Kraken tape: mean rank (null) / p(worse) / p(better) / fold ranks | verdict |
|---|---|---|---|---|
| revx | 41.94 | 3.571 (3) / 0.1782 / 0.8831 / [5, 3, 4, 4, 4, 1, 4] | 3.429 (3) / 0.2557 / 0.8218 / [4, 3, 4, 5, 4, 1, 3] | undecided — the pre-registered test cannot tell SUI's seat from any other member's |
| revxMedian | 32.88 | 3.571 (3) / 0.1782 / 0.8831 / [5, 3, 4, 4, 4, 1, 4] | 3.429 (3) / 0.2557 / 0.8218 / [4, 3, 4, 5, 4, 1, 3] | descriptive only — the pre-registration's addendum: this arm decides nothing |
| binance | 20.98 | 3.500 (3) / 0.1942 / 0.8395 / [5, 3, 4, 4, 3.5, 1, 4] | 3.429 (3) / 0.2557 / 0.8218 / [4, 3, 4, 5, 4, 1, 3] | undecided — the pre-registered test cannot tell SUI's seat from any other member's |
| binanceBnb | 15.98 | 3.571 (3) / 0.1782 / 0.8831 / [5, 3, 4, 4, 4, 1, 4] | 3.429 (3) / 0.2557 / 0.8218 / [4, 3, 4, 5, 4, 1, 3] | undecided — the pre-registered test cannot tell SUI's seat from any other member's |

The same test under the `trail` stop, reported beside and never read for the verdict
(`…folds["trail·<tape>"].summary.primary_exchangeability_looDeltaRetOverDD`):

| arm | trail·coinbase: mean rank / p(worse) / p(better) | trail·kraken: mean rank / p(worse) / p(better) |
|---|---|---|
| revx | 3.000 / 0.5297 / 0.5305 | 3.000 / 0.5521 / 0.5521 |
| revxMedian | 2.786 / 0.6771 / 0.371 | 3.000 / 0.5521 / 0.5521 |
| binance | 2.857 / 0.6294 / 0.4216 | 3.000 / 0.5521 / 0.5521 |
| binanceBnb | 2.929 / 0.5772 / 0.4726 | 3.000 / 0.5521 / 0.5521 |

"Last of five": S2's whole-span slot P&L per dollar, shipped
(`…spanWhereAllFiveExist["shipped·<tape>"].{slotPnlPerDollar,contributionOrder,suiLastOfFive,suiRank.contribution}`),
and the five-slot account over the span (`….five`):

| arm | tape | slot P&L per $: BTC / ETH / SOL / AVAX / SUI | order, best → worst | SUI last of five | SUI contribution rank | the $100 account: ret / DD / ret÷DD |
|---|---|---|---|---|---|---|
| revx | coinbase | +9.1 % / +113.5 % / +92.8 % / +111.7 % / -5.8 % | ETH > AVAX > SOL > BTC > SUI | yes | 5 | +64.24 % / 10.83 % / 5.93 |
| revx | kraken | +13.8 % / +97.7 % / +78.7 % / +129.9 % / -1.1 % | AVAX > ETH > SOL > BTC > SUI | yes | 5 | +63.80 % / 10.58 % / 6.03 |
| revxMedian | coinbase | +9.1 % / +113.5 % / +92.8 % / +111.7 % / -4.8 % | ETH > AVAX > SOL > BTC > SUI | yes | 5 | +64.45 % / 10.79 % / 5.97 |
| revxMedian | kraken | +13.8 % / +97.7 % / +78.7 % / +129.9 % / +0.6 % | AVAX > ETH > SOL > BTC > SUI | yes | 5 | +64.14 % / 10.47 % / 6.12 |
| binance | coinbase | +8.8 % / +113.5 % / +92.8 % / +113.3 % / -0.4 % | ETH > AVAX > SOL > BTC > SUI | yes | 5 | +65.61 % / 10.62 % / 6.18 |
| binance | kraken | +13.5 % / +97.7 % / +78.8 % / +131.5 % / +2.2 % | AVAX > ETH > SOL > BTC > SUI | yes | 5 | +64.72 % / 10.36 % / 6.25 |
| binanceBnb | coinbase | +11.3 % / +115.1 % / +94.4 % / +114.6 % / +0.3 % | ETH > AVAX > SOL > BTC > SUI | yes | 5 | +67.15 % / 10.32 % / 6.51 |
| binanceBnb | kraken | +16.0 % / +99.4 % / +80.5 % / +132.8 % / +2.9 % | AVAX > ETH > SOL > BTC > SUI | yes | 5 | +66.31 % / 10.05 % / 6.59 |

Secondary readings per arm, shipped (`…folds["shipped·<tape>"].summary`): contribution and dollar-drawdown rank tests,
the sign tests on dropping SUI, the t-test on the return delta, and the worst-fold rule:

| arm | tape | contribution: mean rank / p(worse) | marginal $DD: mean rank / p(better) | drop SUI raises return (sign test) | drop SUI raises ret÷DD (sign test) | mean Δret without SUI / t / p | worst fold: five → without SUI |
|---|---|---|---|---|---|---|---|
| revx | coinbase | 3.857 / 0.07162 | 2.429 / 0.1782 | 6 of 7 (p 0.125) | 5 of 7 (p 0.453) | +2.39 pts / 2.46 / 0.0488 | -0.85 → -1 |
| revx | kraken | 3.714 / 0.1169 | 2.143 / 0.07162 | 6 of 7 (p 0.125) | 5 of 7 (p 0.453) | +2.23 pts / 2.44 / 0.0507 | -0.82 → -1 |
| revxMedian | coinbase | 3.857 / 0.07162 | 2.429 / 0.1782 | 6 of 7 (p 0.125) | 5 of 7 (p 0.453) | +2.36 pts / 2.43 / 0.0512 | -0.85 → -1 |
| revxMedian | kraken | 3.714 / 0.1169 | 2.143 / 0.07162 | 6 of 7 (p 0.125) | 5 of 7 (p 0.453) | +2.18 pts / 2.38 / 0.0548 | -0.82 → -1 |
| binance | coinbase | 3.714 / 0.1169 | 2.429 / 0.1782 | 6 of 7 (p 0.125) | 5 of 7 (p 0.453) | +2.24 pts / 2.28 / 0.0627 | -0.84 → -1 |
| binance | kraken | 3.714 / 0.1169 | 2.000 / 0.0407 | 6 of 7 (p 0.125) | 5 of 7 (p 0.453) | +2.15 pts / 2.33 / 0.0586 | -0.82 → -1 |
| binanceBnb | coinbase | 3.714 / 0.1169 | 2.429 / 0.1782 | 6 of 7 (p 0.125) | 5 of 7 (p 0.453) | +2.27 pts / 2.3 / 0.061 | -0.84 → -1 |
| binanceBnb | kraken | 3.714 / 0.1169 | 2.000 / 0.0407 | 6 of 7 (p 0.125) | 5 of 7 (p 0.453) | +2.17 pts / 2.35 / 0.0569 | -0.81 → -1 |

SUI on the windows it has (`…windowsSuiHas["shipped·<tape>"][A|B]`): the five-slot sleeve, SUI's own run, and removing
SUI (capital rescaled):

| arm | tape | window | five: ret % / ret÷DD | SUI own: ret % (DD %, trades) | without SUI: Δret pts / Δret÷DD | SUI removal-cost rank |
|---|---|---|---|---|---|---|
| revx | coinbase | A | +8.03 / 0.71 | +1.36 (28.9, 12) | +0.48 / -0.17 | 3 |
| revx | coinbase | B | +20.08 / 1.92 | -2.53 (31.3, 10) | +4.97 / +0.27 | 4 |
| revx | kraken | A | +9.16 / 0.84 | +29.09 (20.8, 13) | -5.60 / -0.60 | 1 |
| revx | kraken | B | +22.49 / 2.25 | -2.72 (31.4, 10) | +5.62 / +0.35 | 4 |
| revxMedian | coinbase | A | +8.12 / 0.72 | +1.82 (28.8, 12) | +0.39 / -0.18 | 2.5 |
| revxMedian | coinbase | B | +20.14 / 1.92 | -2.22 (31.1, 10) | +4.91 / +0.27 | 4 |
| revxMedian | kraken | A | +9.26 / 0.85 | +29.80 (20.8, 13) | -5.70 / -0.61 | 1 |
| revxMedian | kraken | B | +22.66 / 2.27 | -1.87 (30.8, 10) | +5.45 / +0.33 | 4 |
| binance | coinbase | A | +13.64 / 1.22 | +32.46 (27.5, 11) | -5.07 / -0.68 | 1 |
| binance | coinbase | B | +20.44 / 1.96 | -1.23 (30.5, 10) | +4.74 / +0.24 | 4 |
| binance | kraken | A | +9.45 / 0.87 | +30.71 (20.8, 13) | -5.84 / -0.63 | 1 |
| binance | kraken | B | +22.86 / 2.29 | -1.42 (30.5, 10) | +5.39 / +0.32 | 4 |
| binanceBnb | coinbase | A | +14.06 / 1.28 | +32.83 (27.4, 11) | -5.03 / -0.69 | 1 |
| binanceBnb | coinbase | B | +21.01 / 2.03 | -0.99 (30.3, 10) | +4.82 / +0.26 | 4 |
| binanceBnb | kraken | A | +9.88 / 0.94 | +31.14 (20.7, 13) | -5.81 / -0.66 | 1 |
| binanceBnb | kraken | B | +23.45 / 2.37 | -1.17 (30.4, 10) | +5.48 / +0.33 | 4 |

Brute-force check: every primary rank test (16 arm × condition cells) re-derived by enumerating all 5^folds rank
vectors from each fold's own five ranks (`…folds[cond].folds[i].removalCostRanksOfAllFive`): all match.

## 6. Part 3: the screen at Binance cost

**The headline** (shipped stop · seeded parameters · both tapes agreeing; §4.15's four tests on both windows, plus the
running venue's book) against the three chance counts of pre-registration §6:

| venue | clear both / coins with A and B | (a) §3.12 expected | (b) exact P(≥ k) | (c) §4.15 pooled expected |
|---|---|---|---|---|
| `revx` | 1 (AVAX) / 23 | 2.61 | 0.983 | 1.8 |
| `kraken` | 1 (AVAX) / 23 | 3.83 | 0.999 | 2.72 |
| `binance` | 1 (AVAX) / 23 | 4.17 | 0.9997 | 3.21 |
| `binanceBnb` | 1 (AVAX) / 23 | 4.17 | 0.9997 | 3.21 |

Under each Binance arm, 8 coins clear window A and 12 clear window B. One clears both, fewer than every chance count
gives, so by the reading rule the screen has found nothing. The coins that clear at Binance cost and at neither
Revolut X's nor Kraken's are none at `binance` and none at `binanceBnb`. §3.8's own regime, the continuity row (trail
· chosen · Coinbase tape), gives 2 (POL, SUI) at `binance` against 3.96 expected (P 0.9884). These are the same two
coins Kraken's costs clear there. Over all twelve conditions and four venues, the reading rule holds in 0 of 48 cells.

**Why the Binance screen differs from Revolut X's at all: the book leg, not the cost.** Five headline coin-windows
change verdict between `revx` and `binance`: AAVE, BNB and POL in window A, ETC and LTC in window B. Every one passes
the four tests at BOTH costs and fails only Revolut X's $100k-a-day UK book (the table "every coin-window whose
verdict differs between revx and binance" below). Taken alone, the four tests agree between the two costs in 91 of 91
coin-windows (A–D). Binance's books let these coins be judged, and none clears both windows: AAVE and POL fail window
B, ETC and LTC fail window A, and BNB has no window B priced at all. The coins new at Binance cost in the minor
conditions follow the same pattern. POL, AAVE and SHIB fail only the Revolut X book there, and one window's plateau on
Kraken's costs. SUI under trail · seeded is §4.1's stop.

**The book leg itself** (`books.binanceBookLeg`): 25 of 27 `<COIN>USDT` pairs are TRADING with at least $100k of 24 h
quote volume at the start reading. The thinnest is ALGO at $3,978,169. HYPE is not listed and TON is in BREAK. The end
reading changes no coin's book verdict (0 flips). **Secondary, never promoted:** with test 4 priced on Revolut X's
costs instead of Kraken's, the headline passes 3 (AVAX, LINK, POL) against 5.87 expected (P 0.999). That is also
inside chance. Grid points evaluated: 79,920.

**shipped·seeded·both** (`part3_theScreen.perCondition["shipped·seeded·both"].perVenue[venue]`):

| venue | n (coins with A and B) | clear A | clear B | clear BOTH (k) | (a) §3.12 expected | (b) exact P(≥ k) | (c) §4.15 pooled: clear / priced = rate → expected | found something? (k > (a) AND (b) < 0.05) |
|---|---|---|---|---|---|---|---|---|
| revx | 23 | 6 | 10 | 1 (AVAX) | 2.61 | 0.983 | 26 / 93 = 0.28 → 1.8 | no |
| kraken | 23 | 8 | 11 | 1 (AVAX) | 3.83 | 0.999 | 32 / 93 = 0.344 → 2.72 | no |
| binance | 23 | 8 | 12 | 1 (AVAX) | 4.17 | 0.9997 | 34 / 91 = 0.374 → 3.21 | no |
| binanceBnb | 23 | 8 | 12 | 1 (AVAX) | 4.17 | 0.9997 | 34 / 91 = 0.374 → 3.21 | no |

Coins that clear under a Binance arm and under neither revx nor kraken, same condition (`…newAtBinanceCost`):
{"binance": [], "binanceBnb": []}

One-window clearers, headline (`…perVenue[venue].oneWindowA / oneWindowB`), and coins outside the population
(`…notScored`):

| venue | clear A only | clear B only | not in the population |
|---|---|---|---|
| revx | DOT, ICP, SOL, SUI, UNI | ADA, ALGO, BTC, ETH, LINK, NEAR, PEPE, XLM, XRP | BNB, HBAR, HYPE, TON |
| kraken | AAVE, DOT, ICP, POL, SOL, SUI, UNI | ADA, ALGO, BTC, ETC, ETH, LINK, NEAR, PEPE, XLM, XRP | BNB, HBAR, HYPE, TON |
| binance | AAVE, DOT, ICP, POL, SOL, SUI, UNI | ADA, ALGO, BTC, ETC, ETH, LINK, LTC, NEAR, PEPE, XLM, XRP | BNB, HBAR, HYPE, TON |
| binanceBnb | AAVE, DOT, ICP, POL, SOL, SUI, UNI | ADA, ALGO, BTC, ETC, ETH, LINK, LTC, NEAR, PEPE, XLM, XRP | BNB, HBAR, HYPE, TON |

**trail·chosen·coinbase** (`part3_theScreen.perCondition["trail·chosen·coinbase"].perVenue[venue]`):

| venue | n (coins with A and B) | clear A | clear B | clear BOTH (k) | (a) §3.12 expected | (b) exact P(≥ k) | (c) §4.15 pooled: clear / priced = rate → expected | found something? (k > (a) AND (b) < 0.05) |
|---|---|---|---|---|---|---|---|---|
| revx | 23 | 5 | 9 | 1 (SUI) | 1.96 | 0.9405 | 22 / 93 = 0.237 → 1.29 | no |
| kraken | 23 | 7 | 13 | 2 (POL, SUI) | 3.96 | 0.9884 | 28 / 93 = 0.301 → 2.08 | no |
| binance | 23 | 7 | 13 | 2 (POL, SUI) | 3.96 | 0.9884 | 28 / 91 = 0.308 → 2.18 | no |
| binanceBnb | 23 | 7 | 13 | 2 (POL, SUI) | 3.96 | 0.9884 | 27 / 91 = 0.297 → 2.02 | no |

All twelve conditions — per venue: k clear both (names) · (a) · (b)
(`part3_theScreen.perCondition[cond].perVenue[venue]`), and coins new at Binance cost (`…newAtBinanceCost`):

| condition | revx | kraken | binance | binanceBnb | new at binance | new at binanceBnb |
|---|---|---|---|---|---|---|
| shipped·seeded·both | 1 (AVAX) · 2.61 · 0.983 | 1 (AVAX) · 3.83 · 0.999 | 1 (AVAX) · 4.17 · 0.9997 | 1 (AVAX) · 4.17 · 0.9997 | — | — |
| shipped·seeded·coinbase | 1 (AVAX) · 2.87 · 0.9908 | 1 (AVAX) · 4.52 · 0.9999 | 2 (AVAX,POL) · 4.87 · 0.999 | 2 (AVAX,POL) · 4.87 · 0.999 | POL | POL |
| shipped·seeded·kraken | 1 (AVAX) · 2.61 · 0.983 | 1 (AVAX) · 3.83 · 0.999 | 2 (AAVE,AVAX) · 4.52 · 0.9967 | 2 (AAVE,AVAX) · 4.52 · 0.9967 | AAVE | AAVE |
| shipped·chosen·both | 0 · 1.74 · 1 | 0 · 3.04 · 1 | 0 · 2.61 · 1 | 0 · 2.61 · 1 | — | — |
| shipped·chosen·coinbase | 1 (SOL) · 2.17 · 0.9618 | 0 · 3.65 · 1 | 1 (SOL) · 3.39 · 0.9979 | 1 (SOL) · 3.39 · 0.9979 | — | — |
| shipped·chosen·kraken | 2 (AVAX,PEPE) · 3.04 · 0.923 | 2 (AVAX,POL) · 4.52 · 0.9967 | 5 (AAVE,AVAX,PEPE,POL,SHIB) · 6.09 · 0.9143 | 5 (AAVE,AVAX,PEPE,POL,SHIB) · 6.09 · 0.9143 | AAVE, SHIB | AAVE, SHIB |
| trail·seeded·both | 0 · 2.17 · 1 | 0 · 2.87 · 1 | 1 (SUI) · 3.35 · 0.9968 | 1 (SUI) · 3.35 · 0.9968 | SUI | SUI |
| trail·seeded·coinbase | 0 · 2.17 · 1 | 0 · 3.35 · 1 | 1 (SUI) · 3.83 · 0.999 | 1 (SUI) · 3.83 · 0.999 | SUI | SUI |
| trail·seeded·kraken | 1 (SUI) · 2.87 · 0.9908 | 1 (SUI) · 4.17 · 0.9997 | 1 (SUI) · 4.17 · 0.9997 | 1 (SUI) · 4.17 · 0.9997 | — | — |
| trail·chosen·both | 1 (SUI) · 1.52 · 0.8702 | 2 (POL,SUI) · 2.74 · 0.8758 | 1 (SUI) · 2.61 · 0.983 | 1 (SUI) · 2.61 · 0.983 | — | — |
| trail·chosen·coinbase | 1 (SUI) · 1.96 · 0.9405 | 2 (POL,SUI) · 3.96 · 0.9884 | 2 (POL,SUI) · 3.96 · 0.9884 | 2 (POL,SUI) · 3.96 · 0.9884 | — | — |
| trail·chosen·kraken | 1 (SUI) · 2.35 · 0.9703 | 2 (POL,SUI) · 3.83 · 0.9812 | 1 (SUI) · 3.65 · 0.9987 | 1 (SUI) · 3.65 · 0.9987 | — | — |

Cells (condition × venue) where the reading rule says the screen found something: none.

SECONDARY, never promoted — test 4 priced on Revolut X's costs instead of Kraken's
(`…secondary_test4OnRevolutXCosts[arm]`): k (names) · (a) · (b), and new vs revx or kraken:

| condition | binance | binanceBnb | new (binance) | new (binanceBnb) |
|---|---|---|---|---|
| shipped·seeded·both | 3 (AVAX,LINK,POL) · 5.87 · 0.999 | 3 (AVAX,LINK,POL) · 5.87 · 0.999 | LINK, POL | LINK, POL |
| shipped·seeded·coinbase | 4 (AVAX,LINK,POL,SOL) · 6.26 · 0.9951 | 4 (AVAX,LINK,POL,SOL) · 6.26 · 0.9951 | LINK, POL, SOL | LINK, POL, SOL |
| shipped·seeded·kraken | 4 (AAVE,AVAX,LINK,POL) · 6.26 · 0.9951 | 4 (AAVE,AVAX,LINK,POL) · 6.26 · 0.9951 | AAVE, LINK, POL | AAVE, LINK, POL |
| shipped·chosen·both | 3 (AVAX,LINK,POL) · 4.26 · 0.9483 | 3 (AVAX,LINK,POL) · 4.26 · 0.9483 | AVAX, LINK, POL | AVAX, LINK, POL |
| shipped·chosen·coinbase | 4 (AVAX,LINK,POL,SOL) · 4.57 · 0.8444 | 4 (AVAX,LINK,POL,SOL) · 4.57 · 0.8444 | AVAX, LINK, POL | AVAX, LINK, POL |
| shipped·chosen·kraken | 6 (AAVE,AVAX,LINK,PEPE,POL,SHIB) · 8.35 · 0.9968 | 6 (AAVE,AVAX,LINK,PEPE,POL,SHIB) · 8.35 · 0.9968 | AAVE, LINK, SHIB | AAVE, LINK, SHIB |
| trail·seeded·both | 1 (LINK) · 3.65 · 0.9987 | 1 (LINK) · 3.65 · 0.9987 | LINK | LINK |
| trail·seeded·coinbase | 1 (LINK) · 4.17 · 0.9997 | 1 (LINK) · 4.17 · 0.9997 | LINK | LINK |
| trail·seeded·kraken | 3 (LINK,POL,SUI) · 5.09 · 0.9878 | 3 (LINK,POL,SUI) · 5.09 · 0.9878 | LINK, POL | LINK, POL |
| trail·chosen·both | 3 (LINK,POL,SUI) · 4.87 · 0.9834 | 3 (LINK,POL,SUI) · 4.87 · 0.9834 | LINK | LINK |
| trail·chosen·coinbase | 3 (LINK,POL,SUI) · 5.22 · 0.9938 | 3 (LINK,POL,SUI) · 5.22 · 0.9938 | LINK | LINK |
| trail·chosen·kraken | 3 (LINK,POL,SUI) · 5.48 · 0.9958 | 3 (LINK,POL,SUI) · 5.48 · 0.9958 | LINK | LINK |

Chance-count check: (a) and (b) re-derived from n, kA, kB, k for all 48 condition × venue cells in Python (math.comb):
0 differences.

Why each coin-window fails at Binance cost, headline condition
(`part3_theScreen.perCoinVerdicts.shipped[coin][A|B].binance[tape].seededFailed`, Coinbase tape / Kraken tape; ✓ =
passes the four tests on that tape):

| coin | A: coinbase | A: kraken | B: coinbase | B: kraken |
|---|---|---|---|---|
| AAVE | ✓ | ✓ | own-venue return not positive; plateau < 50 %; other-venue return not positive | ✓ |
| ADA | own-venue return not positive; plateau < 50 %; other-venue return not positive | own-venue return not positive; plateau < 50 %; other-venue return not positive | ✓ | ✓ |
| ALGO | own-venue return not positive; plateau < 50 %; other-venue return not positive | own-venue return not positive; plateau < 50 %; other-venue return not positive | ✓ | ✓ |
| ATOM | own-venue return not positive; plateau < 50 %; other-venue return not positive | own-venue return not positive; other-venue return not positive | own-venue return not positive; plateau < 50 %; other-venue return not positive | own-venue return not positive; plateau < 50 %; other-venue return not positive |
| AVAX | ✓ | ✓ | ✓ | ✓ |
| BCH | own-venue return not positive; plateau < 50 %; other-venue return not positive | own-venue return not positive; plateau < 50 %; other-venue return not positive | own-venue return not positive; drawdown ≥ 35 %; plateau < 50 %; other-venue return not positive | own-venue return not positive; drawdown ≥ 35 %; plateau < 50 %; other-venue return not positive |
| BNB | ✓ | ✓ | — | — |
| BTC | own-venue return not positive; plateau < 50 %; other-venue return not positive | own-venue return not positive; plateau < 50 %; other-venue return not positive | ✓ | ✓ |
| DOGE | plateau < 50 %; other-venue return not positive | plateau < 50 % | ✓ | other-venue return not positive |
| DOT | ✓ | ✓ | own-venue return not positive; plateau < 50 %; other-venue return not positive | own-venue return not positive; plateau < 50 %; other-venue return not positive |
| ETC | own-venue return not positive; plateau < 50 %; other-venue return not positive | own-venue return not positive; plateau < 50 %; other-venue return not positive | ✓ | ✓ |
| ETH | own-venue return not positive; plateau < 50 %; other-venue return not positive | own-venue return not positive; plateau < 50 %; other-venue return not positive | ✓ | ✓ |
| ICP | ✓ | ✓ | own-venue return not positive; plateau < 50 %; other-venue return not positive | own-venue return not positive; plateau < 50 %; other-venue return not positive |
| LINK | other-venue return not positive | other-venue return not positive | ✓ | ✓ |
| LTC | own-venue return not positive; plateau < 50 %; other-venue return not positive | own-venue return not positive; plateau < 50 %; other-venue return not positive | ✓ | ✓ |
| NEAR | own-venue return not positive; plateau < 50 %; other-venue return not positive | own-venue return not positive; plateau < 50 %; other-venue return not positive | ✓ | ✓ |
| PEPE | own-venue return not positive; plateau < 50 %; other-venue return not positive | own-venue return not positive; other-venue return not positive | ✓ | ✓ |
| POL | ✓ | ✓ | ✓ | other-venue return not positive |
| SHIB | own-venue return not positive; plateau < 50 %; other-venue return not positive | own-venue return not positive; other-venue return not positive | other-venue return not positive | other-venue return not positive |
| SOL | ✓ | ✓ | other-venue return not positive | own-venue return not positive; other-venue return not positive |
| SUI | ✓ | ✓ | own-venue return not positive; plateau < 50 %; other-venue return not positive | own-venue return not positive; plateau < 50 %; other-venue return not positive |
| UNI | ✓ | ✓ | own-venue return not positive; plateau < 50 %; other-venue return not positive | own-venue return not positive; plateau < 50 %; other-venue return not positive |
| XLM | own-venue return not positive; plateau < 50 %; other-venue return not positive | own-venue return not positive; plateau < 50 %; other-venue return not positive | ✓ | ✓ |
| XRP | own-venue return not positive; plateau < 50 %; other-venue return not positive | own-venue return not positive; plateau < 50 %; other-venue return not positive | ✓ | ✓ |

The book leg on Binance (`books.binanceBookLeg`): status, 24 h quote volume at the START reading (the leg) and the END
reading (the check):

| coin | status | start USD | end USD | passes at start | passes at end | verdict differs |
|---|---|---|---|---|---|---|
| AAVE | TRADING | 20,618,180 | 20,745,314 | True | True | — |
| ADA | TRADING | 72,797,370 | 72,272,829 | True | True | — |
| ALGO | TRADING | 3,978,169 | 3,916,596 | True | True | — |
| ATOM | TRADING | 4,185,642 | 4,226,278 | True | True | — |
| AVAX | TRADING | 60,570,318 | 60,547,384 | True | True | — |
| BCH | TRADING | 115,660,521 | 116,781,682 | True | True | — |
| BNB | TRADING | 125,490,422 | 124,153,430 | True | True | — |
| BTC | TRADING | 1,761,789,889 | 1,748,607,131 | True | True | — |
| DOGE | TRADING | 203,173,266 | 206,366,592 | True | True | — |
| DOT | TRADING | 11,978,002 | 11,892,780 | True | True | — |
| ETC | TRADING | 10,695,346 | 10,664,304 | True | True | — |
| ETH | TRADING | 794,873,329 | 789,660,523 | True | True | — |
| HBAR | TRADING | 33,390,649 | 33,024,347 | True | True | — |
| HYPE | not listed | 0 | 0 | False | False | — |
| ICP | TRADING | 9,626,937 | 9,509,097 | True | True | — |
| LINK | TRADING | 39,323,143 | 39,201,413 | True | True | — |
| LTC | TRADING | 40,834,194 | 40,294,579 | True | True | — |
| NEAR | TRADING | 268,431,559 | 265,622,833 | True | True | — |
| PEPE | TRADING | 105,881,522 | 104,886,818 | True | True | — |
| POL | TRADING | 7,264,712 | 7,288,489 | True | True | — |
| SHIB | TRADING | 13,296,103 | 13,276,765 | True | True | — |
| SOL | TRADING | 340,045,854 | 330,811,159 | True | True | — |
| SUI | TRADING | 110,355,522 | 108,312,003 | True | True | — |
| TON | BREAK | 7,717,352 | 7,717,352 | False | False | — |
| UNI | TRADING | 221,257,311 | 223,048,916 | True | True | — |
| XLM | TRADING | 33,063,571 | 32,953,525 | True | True | — |
| XRP | TRADING | 466,553,687 | 467,948,846 | True | True | — |

Coins whose book verdict differs between the two readings: none. Pass at start: 25 of 27. Smallest passing start
volume: (3978169, 'ALGO')

Grid points evaluated (`multipleComparisons.gridPointsEvaluated`): 79,920.

Cost-monotonicity check (`part3_theScreen.perCoinVerdicts[stop][coin][window].{binance,binanceBnb}[tape].seededOwn`):
binanceBnb ≥ binance in 364 of 364 seeded cells; same trade count in 364 of 364; smallest binanceBnb − binance: +0.06
pts (shipped, PEPE/USD, B, kraken).

Seeded cells whose TRADE COUNT differs between revx and binance
(`part3_theScreen.perCoinVerdicts[stop][coin][window].{revx,binance}[tape].seededOwn.trades`): 2 of 364. Among the
five live coins: shipped·coinbase SUI A: revx +1.36 % on 12 trades, binance +32.46 % on 11; trail·coinbase SUI A: revx
-10.49 % on 16 trades, binance +17.61 % on 15.

Headline (`shipped·seeded·both`): every coin-window whose verdict differs between revx and binance, and why
(`part3_theScreen.perCoinVerdicts.shipped[coin][w][venue][tape]`, `…bookUsd`):

| coin | window | revx: four tests on both tapes / UK book USD | binance: four tests on both tapes / Binance book USD | the difference is |
|---|---|---|---|---|
| AAVE | A | pass / 54,000 | pass / 20,618,180 | the book leg (the four tests agree) |
| BNB | A | pass / 19,000 | pass / 125,490,422 | the book leg (the four tests agree) |
| ETC | B | pass / 8,000 | pass / 10,695,346 | the book leg (the four tests agree) |
| LTC | B | pass / 44,000 | pass / 40,834,194 | the book leg (the four tests agree) |
| POL | A | pass / 11,000 | pass / 7,264,712 | the book leg (the four tests agree) |

The four tests alone (seeded, both tapes, shipped; book leg ignored), revx against binance, over every coin-window
both price (A–D): 0 of 91 disagree.
- shipped·coinbase, window A: the sleeve moves +5.61 pts (`part1_theLiveCoins.sleeve`); SUI's $20 slot moves +5.56 USD
  on the $100 sleeve, i.e. +5.56 pts
  (`part2_suiSeat.perArm[arm].windowsSuiHas["shipped·coinbase"].A.suiSlotPnlPerDollar`: revx +0.0613, binance
  +0.3393).
- trail·coinbase, window A: the sleeve moves +5.72 pts (`part1_theLiveCoins.sleeve`); SUI's $20 slot moves +5.66 USD
  on the $100 sleeve, i.e. +5.66 pts
  (`part2_suiSeat.perArm[arm].windowsSuiHas["trail·coinbase"].A.suiSlotPnlPerDollar`: revx -0.0689, binance +0.2142).
- shipped·kraken, window A: the sleeve moves +0.29 pts (`part1_theLiveCoins.sleeve`); SUI's $20 slot moves +0.25 USD
  on the $100 sleeve, i.e. +0.25 pts
  (`part2_suiSeat.perArm[arm].windowsSuiHas["shipped·kraken"].A.suiSlotPnlPerDollar`: revx +0.3155, binance +0.3281).
- trail·kraken, window A: the sleeve moves +0.35 pts (`part1_theLiveCoins.sleeve`); SUI's $20 slot moves +0.31 USD on
  the $100 sleeve, i.e. +0.31 pts (`part2_suiSeat.perArm[arm].windowsSuiHas["trail·kraken"].A.suiSlotPnlPerDollar`:
  revx +0.3138, binance +0.3295).

Every coin that clears both windows under a Binance arm and under neither revx nor kraken, in any condition
(`…perCondition[cond].newAtBinanceCost`), with what stops it on the other two venues
(`…perCoinVerdicts[stop][coin][w][venue][tape]`, seeded or chosen as the condition names):

| condition | coin | arm | revx, A / B | kraken, A / B |
|---|---|---|---|---|
| shipped·seeded·coinbase | POL | binance | book 11,000 < 100k / book 11,000 < 100k | clears / coinbase: plateau < 50 % |
| shipped·seeded·coinbase | POL | binanceBnb | book 11,000 < 100k / book 11,000 < 100k | clears / coinbase: plateau < 50 % |
| shipped·seeded·kraken | AAVE | binance | book 54,000 < 100k / book 54,000 < 100k | clears / kraken: plateau < 50 % |
| shipped·seeded·kraken | AAVE | binanceBnb | book 54,000 < 100k / book 54,000 < 100k | clears / kraken: plateau < 50 % |
| shipped·chosen·kraken | AAVE | binance | book 54,000 < 100k / book 54,000 < 100k | clears / kraken: plateau < 50 % |
| shipped·chosen·kraken | SHIB | binance | book 11,000 < 100k / book 11,000 < 100k | kraken: plateau < 50 % / clears |
| shipped·chosen·kraken | AAVE | binanceBnb | book 54,000 < 100k / book 54,000 < 100k | clears / kraken: plateau < 50 % |
| shipped·chosen·kraken | SHIB | binanceBnb | book 11,000 < 100k / book 11,000 < 100k | kraken: plateau < 50 % / clears |
| trail·seeded·both | SUI | binance | coinbase: own-venue return not positive / clears | coinbase: other-venue return not positive / clears |
| trail·seeded·both | SUI | binanceBnb | coinbase: own-venue return not positive / clears | coinbase: other-venue return not positive / clears |
| trail·seeded·coinbase | SUI | binance | coinbase: own-venue return not positive / clears | coinbase: other-venue return not positive / clears |
| trail·seeded·coinbase | SUI | binanceBnb | coinbase: own-venue return not positive / clears | coinbase: other-venue return not positive / clears |

## 7. What follows, and what does not

**What follows**

1. **At this account's tier, Binance does not improve the live row's record by anything that matters.** The fee is the
   probe's 10 bps. The worst window stays D, with ret÷DD -0.50 (and -0.48 with BNB). The saving is AVAX's and SUI's
   spread, worth 0.1–0.4 points a window to the sleeve outside §4.1's one cell. As pre-registration §9 says, this
   measures how much of each coin's record is its cost; it is not a recommendation to move the row.
2. **SUI's seat: the rule says undecided under every arm.** Priced on Binance's tight book, SUI is still the weakest
   earner of the five on both tapes. Its wide UK spread does not explain its record. This is a statement about a row
   executed on Binance, not about the Revolut X row, whose verdict (§3.20) stands.
3. **The screen: no candidate.** At Binance cost, 1 coin clears both windows where chance gives 3.21–4.17. Binance's
   deep books let five coins that Revolut X's UK book excluded be judged on the four tests. None clears two windows.
   The bar admits nothing here, so there is nothing to certify.

**What does not follow**

- That SUI's +32.46 % window-A reading is a Binance advantage. It is one stop decided by 3 bps, followed by the last
  34 hours of one coin's file (§4.1).
- Anything about whether Binance may serve this UK account, about custody, funding, the GBP→USDT conversion, or the
  price risk of holding BNB for the discount. None of these was asked, and none is modelled.
- That these spreads are Binance's typical spreads. They are one night's (§8).

## 8. Caveats

1. **One evening's spreads.** Every Binance spread charged was sampled between 02:21 and 03:08 UTC on 2026-09-23, a UK
   night. Binance's BTC, ETH and SOL books were one cent wide in all 25 of this study's own samples (ask − bid =
   $0.01; `binance_cost_bookticker_samples.jsonl`), and a daytime book could differ. The Revolut X side is
   `COSTS.revx`, untouched by design. The paired sample's UK medians that night (1.628 / 1.758 / 3.632 / 8.988 /
   23.561 bps for BTC / ETH / SOL / AVAX / SUI; `books.liveFiveRevolutXCompared`) are reported beside `COSTS.revx`'s
   1.5 / 2.1 / 3.1 / 9.6 / 23.94 in §3's table; they are not charged.
2. **USDT against USD.** Every tape is USD (Coinbase, Kraken), and Binance trades `<COIN>USDT`. The USDT/USD basis is
   not modelled, and the book leg reads USDT quote volume as dollars.
3. **Depth: one sentence in the output overstates.** `costArms.notModelled` says "a $20 order is far inside the touch
   on every pair priced". The raw samples mostly agree, but not on every pair (`bc2_touch_check.py` →
   `bc2_touch_check.out`; not a study number):
   - For the five live coins, walking the recorded five levels, a $20 order paid at most 0.297 bps beyond the
     half-spread (AVAXUSDT, a sell; 56 depth snapshots, 02:03–02:18 UTC).
   - In this study's own 25 samples, the touch held less than $20 at the ASK (where a buy walks) in 9 samples for
     AAVE, 6 for HBAR, 4 for POL, 2 for AVAX and 1 each for BCH, DOGE, ICP and LTC. It held less than $20 at the BID
     (where a sell walks) in 6 for POL, 4 each for HBAR and LINK, 3 each for AVAX and ICP, 2 for AAVE and 1 for DOGE.
     No depth was recorded for those pairs, so the next level's cost is not measured.
   - Against a round trip of about 20 bps this is small, but "every pair" is not what the samples say.
4. **The fee.** 10 bps is measured (the probe, reference §6). The 7.5 bps BNB rate is as stated, not measured.
5. **Window A's end differs by coin.** The Coinbase files end at 2026-09-20T03:00Z for BTC, ETH and SOL, and about a
   day and a half later for AVAX and SUI. So those two coins' window A includes hours the other three lack, and SUI's
   path change sits in exactly those hours. This is the project's `windowsOn`, unchanged by design, and reported here
   because it decides one cell.
6. **The bar admits, it does not certify** (§4.15). Two windows are two draws. A coin clearing at Binance cost would
   still have been at most a candidate, subject to the count and a paper record. None cleared.
7. **Binance's UK status is not this study's question.**

## 9. Reproduce, from the repository root

The book samples and the 24-hour volumes the run read are committed in
`docs/agents/backtests/inputs/binance_books_2026-09-23/`, and the frozen
pre-registration in `docs/agents/reviews/2026-09-23-binance-cost-prereg.md`
(sha256 `ce27276b…`). The price data are not in the repository: Coinbase hourly
(`--data`), Kraken's hourly extension (`--ext`) and Kraken's own 4 h tape
(`--ktape`), the inputs every sibling study uses; `binance.json` names each of
the 81 files by sha256 (`data.perSymbol[].files`). Keep `--tape`, `--set2` and
`--sui` exactly as written: those strings are copied into the output.

```sh
deno run --allow-read --allow-write supabase/functions/agents/backtest_binance.ts \
  --data <dir with BTC-USD_1h_3y.json …> --ext <dir with BTC-USD_1h_kraken.json …> \
  --ktape <dir with BTC-USD_4h_kraken.json …> \
  --tape docs/agents/backtests/tape.json --set2 docs/agents/backtests/set2.json --sui docs/agents/backtests/sui.json \
  --books docs/agents/backtests/inputs/binance_books_2026-09-23 \
  --prereg docs/agents/reviews/2026-09-23-binance-cost-prereg.md \
  --arms revx,revxMedian,binance,binanceBnb --out docs/agents/backtests
```

Two runs in separate processes wrote byte-identical files (sha256
`b7e4fb4f4d77e94f…`), and the main session's re-run on the committed tree wrote
the same bytes. The Revolut X-only reproduction is the same command with
`--arms revx` (sha256 `73cb2dff…`). The two diagnostics quoted in §4.1 and §8
were one-off scripts outside the repository; their outputs are quoted where
they are used.

## Appendix A: Part 1 on chosen parameters, and under the trail stop

**shipped·coinbase, chosen** — out-of-sample return % (drawdown %, trades) from
`part1_theLiveCoins.perCoin["shipped·coinbase"][coin][window][arm].chosen.{ret,maxDD,trades}` — chosen point
`…chosen.params` (fast/slow/atr):

| coin | arm | A | B | C | D |
|---|---|---|---|---|---|
| BTC | revx | -19.3 (24.4, 26) [30/100/4] | -0.9 (21.8, 28) [30/50/4] | -4.1 (25.9, 38) [20/100/2] | +14.5 (8.9, 20) [20/100/3] |
| BTC | kraken | -25.4 (28.7, 26) [30/100/4] | -9.0 (24.9, 28) [30/50/4] | +37.0 (17.2, 20) [30/100/4] | +7.8 (10.5, 20) [20/100/3] |
| BTC | binance | -19.4 (24.5, 26) [30/100/4] | -1.0 (21.9, 28) [30/50/4] | -4.2 (26.0, 38) [20/100/2] | +14.5 (8.9, 20) [20/100/3] |
| BTC | binanceBnb | -18.9 (24.1, 26) [30/100/4] | -0.3 (21.7, 28) [30/50/4] | -3.3 (25.7, 38) [20/100/2] | +15.1 (8.8, 20) [20/100/3] |
| ETH | revx | +2.8 (19.6, 16) [30/50/3] | +100.7 (22.3, 18) [10/50/4] | +8.3 (13.5, 28) [30/150/2] | -11.7 (35.7, 26) [10/150/4] |
| ETH | kraken | -2.0 (22.2, 16) [30/50/3] | +90.1 (23.5, 18) [10/50/4] | -0.4 (14.1, 28) [30/150/2] | -18.4 (39.5, 26) [10/150/4] |
| ETH | binance | +2.8 (19.6, 16) [30/50/3] | +100.6 (22.4, 18) [10/50/4] | +8.3 (13.5, 28) [30/150/2] | -11.7 (35.7, 26) [10/150/4] |
| ETH | binanceBnb | +3.2 (19.4, 16) [30/50/3] | +101.5 (22.3, 18) [10/50/4] | +9.1 (13.5, 28) [30/150/2] | -11.2 (35.4, 26) [10/150/4] |
| SOL | revx | +27.0 (11.3, 14) [30/150/2] | +14.4 (16.5, 29) [20/150/2] | +90.8 (22.0, 24) [30/150/3] | -12.8 (13.8, 8) [10/50/3] |
| SOL | kraken | +21.8 (13.0, 14) [30/150/2] | +4.9 (19.4, 29) [20/150/2] | +77.6 (22.9, 24) [30/150/3] | -14.8 (15.1, 8) [10/50/3] |
| SOL | binance | +27.0 (11.3, 14) [30/150/2] | +14.5 (16.5, 29) [20/150/2] | +90.9 (21.9, 24) [30/150/3] | -12.8 (13.8, 8) [10/50/3] |
| SOL | binanceBnb | +27.4 (11.2, 14) [30/150/2] | +15.3 (16.4, 29) [20/150/2] | +92.0 (21.9, 24) [30/150/3] | -12.6 (13.7, 8) [10/50/3] |
| AVAX | revx | +48.7 (8.7, 9) [10/50/4] | +4.4 (28.8, 17) [30/100/4] | +125.4 (32.9, 19) [20/50/3] | -41.1 (44.1, 16) [20/50/4] |
| AVAX | kraken | +45.1 (8.7, 9) [10/50/4] | -0.4 (29.9, 17) [30/100/4] | +114.0 (35.0, 19) [20/50/3] | -43.8 (46.4, 16) [20/50/4] |
| AVAX | binance | +49.1 (8.7, 9) [10/50/4] | +4.8 (28.7, 17) [30/100/4] | +126.7 (32.6, 19) [20/50/3] | -41.0 (44.0, 16) [20/50/4] |
| AVAX | binanceBnb | +49.5 (8.7, 9) [10/50/4] | +5.3 (28.5, 17) [30/100/4] | +127.8 (32.4, 19) [20/50/3] | -40.7 (43.7, 16) [20/50/4] |
| SUI | revx | +29.6 (24.6, 15) [20/50/3] | -2.5 (31.3, 10) [10/100/3] | — | — |
| SUI | revxMedian | -3.6 (21.2, 20) [20/50/2] | -2.2 (31.1, 10) [10/100/3] | — | — |
| SUI | kraken | +25.5 (25.6, 15) [20/50/3] | -4.3 (32.4, 10) [10/100/3] | — | — |
| SUI | binance | -2.5 (20.7, 20) [20/50/2] | -1.2 (30.5, 10) [10/100/3] | — | — |
| SUI | binanceBnb | -2.0 (20.5, 20) [20/50/2] | -5.9 (30.3, 10) [30/150/3] | — | — |

**shipped·kraken, chosen** — out-of-sample return % (drawdown %, trades) from
`part1_theLiveCoins.perCoin["shipped·kraken"][coin][window][arm].chosen.{ret,maxDD,trades}` — chosen point
`…chosen.params` (fast/slow/atr):

| coin | arm | A | B | C | D |
|---|---|---|---|---|---|
| BTC | revx | -22.9 (27.8, 28) [30/100/4] | +31.9 (14.3, 26) [30/100/4] | +0.5 (22.1, 36) [20/100/2] | +14.5 (8.9, 20) [20/100/3] |
| BTC | kraken | -29.1 (32.2, 28) [30/100/4] | +21.9 (16.1, 26) [30/100/4] | +29.9 (12.6, 22) [30/100/4] | +7.8 (10.5, 20) [20/100/3] |
| BTC | binance | -22.9 (27.8, 28) [30/100/4] | +31.8 (14.3, 26) [30/100/4] | +0.4 (22.1, 36) [20/100/2] | +14.5 (8.9, 20) [20/100/3] |
| BTC | binanceBnb | -22.4 (27.5, 28) [30/100/4] | +32.7 (14.2, 26) [30/100/4] | +1.3 (21.9, 36) [20/100/2] | +15.1 (8.8, 20) [20/100/3] |
| ETH | revx | +3.8 (18.0, 18) [10/50/3] | +75.4 (13.5, 18) [30/50/3] | +1.0 (13.9, 34) [30/150/2] | -11.7 (35.7, 26) [10/150/4] |
| ETH | kraken | -1.6 (21.6, 18) [10/50/3] | +66.2 (14.3, 18) [30/50/3] | -8.8 (17.3, 34) [30/150/2] | -18.4 (39.5, 26) [10/150/4] |
| ETH | binance | +3.8 (17.9, 18) [10/50/3] | +75.4 (13.5, 18) [30/50/3] | +1.0 (13.9, 34) [30/150/2] | -11.7 (35.7, 26) [10/150/4] |
| ETH | binanceBnb | +4.3 (17.6, 18) [10/50/3] | +76.2 (13.5, 18) [30/50/3] | +1.9 (13.7, 34) [30/150/2] | -11.2 (35.4, 26) [10/150/4] |
| SOL | revx | +28.2 (10.4, 14) [30/150/2] | -6.5 (22.7, 39) [20/50/2] | +62.7 (22.5, 26) [30/150/3] | -12.8 (13.8, 8) [10/50/3] |
| SOL | kraken | +22.9 (12.1, 14) [30/150/2] | -16.8 (27.7, 39) [20/50/2] | +50.5 (24.1, 26) [30/150/3] | -14.8 (15.1, 8) [10/50/3] |
| SOL | binance | +28.2 (10.4, 14) [30/150/2] | -6.5 (22.7, 39) [20/50/2] | +62.8 (22.5, 26) [30/150/3] | -12.8 (13.8, 8) [10/50/3] |
| SOL | binanceBnb | +28.6 (10.3, 14) [30/150/2] | -5.6 (22.3, 39) [20/50/2] | +63.8 (22.4, 26) [30/150/3] | -12.6 (13.7, 8) [10/50/3] |
| AVAX | revx | +48.1 (8.7, 7) [10/50/4] | +7.1 (28.9, 17) [30/100/4] | +151.4 (27.8, 19) [20/50/3] | -41.1 (44.1, 16) [20/50/4] |
| AVAX | kraken | +45.3 (8.7, 7) [10/50/4] | +23.8 (26.3, 19) [10/50/4] | +138.7 (29.7, 19) [20/50/3] | -43.8 (46.4, 16) [20/50/4] |
| AVAX | binance | +48.5 (8.7, 7) [10/50/4] | +7.6 (28.8, 17) [30/100/4] | +152.9 (27.6, 19) [20/50/3] | -41.0 (44.0, 16) [20/50/4] |
| AVAX | binanceBnb | +48.7 (8.7, 7) [10/50/4] | +8.1 (28.7, 17) [30/100/4] | +154.1 (27.4, 19) [20/50/3] | -40.7 (43.7, 16) [20/50/4] |
| SUI | revx | +32.5 (17.3, 15) [30/50/3] | -2.7 (31.4, 10) [10/100/3] | — | — |
| SUI | revxMedian | +33.3 (17.2, 15) [30/50/3] | -1.9 (30.8, 10) [10/100/3] | — | — |
| SUI | kraken | +28.3 (17.9, 15) [30/50/3] | -4.4 (32.5, 10) [10/100/3] | — | — |
| SUI | binance | +34.4 (17.2, 15) [30/50/3] | -1.4 (30.5, 10) [20/100/3] | — | — |
| SUI | binanceBnb | +34.9 (17.2, 15) [30/50/3] | -1.2 (30.4, 10) [20/100/3] | — | — |

**trail·coinbase, seeded** — out-of-sample return % (drawdown %, trades) from
`part1_theLiveCoins.perCoin["trail·coinbase"][coin][window][arm].seeded.{ret,maxDD,trades}`:

| coin | arm | A | B | C | D |
|---|---|---|---|---|---|
| BTC | revx | -13.6 (21.1, 32) | +17.0 (14.6, 40) | +1.7 (22.0, 36) | +19.6 (9.8, 20) |
| BTC | kraken | -21.6 (26.8, 32) | +3.7 (19.7, 40) | -8.8 (25.5, 36) | +12.5 (11.4, 20) |
| BTC | binance | -13.7 (21.1, 32) | +16.9 (14.6, 40) | +1.6 (22.0, 36) | +19.5 (9.8, 20) |
| BTC | binanceBnb | -13.0 (20.6, 32) | +18.1 (14.4, 40) | +2.5 (21.7, 36) | +20.1 (9.7, 20) |
| ETH | revx | -10.3 (19.9, 24) | +49.4 (21.7, 28) | +47.6 (11.1, 22) | -1.4 (21.1, 26) |
| ETH | kraken | -16.5 (24.3, 24) | +37.4 (24.2, 28) | +38.1 (12.7, 22) | -8.8 (25.5, 26) |
| ETH | binance | -10.3 (19.9, 24) | +49.4 (21.7, 28) | +47.6 (11.1, 22) | -1.4 (21.1, 26) |
| ETH | binanceBnb | -9.7 (19.5, 24) | +50.4 (21.5, 28) | +48.4 (11.0, 22) | -0.7 (20.7, 26) |
| SOL | revx | +13.3 (17.6, 16) | -10.9 (36.7, 35) | +113.3 (19.8, 24) | -3.5 (10.2, 4) |
| SOL | kraken | +8.0 (20.1, 16) | -19.7 (40.8, 35) | +98.5 (20.7, 24) | -4.7 (10.8, 4) |
| SOL | binance | +13.3 (17.6, 16) | -10.8 (36.7, 35) | +113.4 (19.8, 24) | -3.5 (10.2, 4) |
| SOL | binanceBnb | +13.8 (17.4, 16) | -10.1 (36.4, 35) | +114.7 (19.7, 24) | -3.4 (10.2, 4) |
| AVAX | revx | +12.1 (9.1, 10) | -3.3 (23.7, 24) | +67.7 (22.1, 19) | -25.8 (29.5, 16) |
| AVAX | kraken | +9.1 (9.6, 10) | -9.3 (25.8, 24) | +59.3 (24.8, 19) | -29.0 (32.4, 16) |
| AVAX | binance | +12.5 (9.0, 10) | -2.5 (23.4, 24) | +68.8 (21.8, 19) | -25.4 (29.2, 16) |
| AVAX | binanceBnb | +12.8 (9.0, 10) | -1.9 (23.2, 24) | +69.6 (21.6, 19) | -25.1 (29.0, 16) |
| SUI | revx | -10.5 (25.4, 16) | +3.0 (25.7, 10) | — | — |
| SUI | revxMedian | -9.9 (25.2, 16) | +3.4 (25.5, 10) | — | — |
| SUI | kraken | +12.2 (25.2, 15) | +0.8 (27.2, 10) | — | — |
| SUI | binance | +17.6 (23.8, 15) | +4.0 (25.1, 10) | — | — |
| SUI | binanceBnb | +18.1 (23.7, 15) | +4.2 (24.9, 10) | — | — |

**trail·kraken, seeded** — out-of-sample return % (drawdown %, trades) from
`part1_theLiveCoins.perCoin["trail·kraken"][coin][window][arm].seeded.{ret,maxDD,trades}`:

| coin | arm | A | B | C | D |
|---|---|---|---|---|---|
| BTC | revx | -17.3 (24.3, 34) | +29.2 (11.6, 38) | -11.3 (18.9, 38) | +19.6 (9.8, 20) |
| BTC | kraken | -25.4 (30.1, 34) | +15.2 (13.2, 38) | -21.0 (23.0, 38) | +12.5 (11.4, 20) |
| BTC | binance | -17.4 (24.4, 34) | +29.1 (11.6, 38) | -11.4 (18.9, 38) | +19.5 (9.8, 20) |
| BTC | binanceBnb | -16.7 (23.9, 34) | +30.3 (11.5, 38) | -10.6 (18.6, 38) | +20.1 (9.7, 20) |
| ETH | revx | -8.6 (18.4, 24) | +48.4 (21.0, 30) | +40.6 (11.0, 26) | -1.4 (21.1, 26) |
| ETH | kraken | -14.9 (22.9, 24) | +35.6 (23.5, 30) | +30.1 (14.1, 26) | -8.8 (25.5, 26) |
| ETH | binance | -8.6 (18.4, 24) | +48.4 (20.9, 30) | +40.6 (11.0, 26) | -1.4 (21.1, 26) |
| ETH | binanceBnb | -8.0 (18.0, 24) | +49.5 (20.7, 30) | +41.5 (10.7, 26) | -0.7 (20.7, 26) |
| SOL | revx | +9.9 (20.0, 18) | -9.8 (35.2, 37) | +71.8 (19.7, 28) | -3.5 (10.2, 4) |
| SOL | kraken | +4.2 (22.8, 18) | -19.2 (39.3, 37) | +58.0 (20.7, 28) | -4.7 (10.8, 4) |
| SOL | binance | +10.0 (20.0, 18) | -9.7 (35.2, 37) | +71.9 (19.7, 28) | -3.5 (10.2, 4) |
| SOL | binanceBnb | +10.5 (19.8, 18) | -8.9 (34.8, 37) | +73.1 (19.6, 28) | -3.4 (10.2, 4) |
| AVAX | revx | +14.0 (8.6, 8) | -7.9 (22.7, 24) | +77.8 (18.6, 19) | -25.8 (29.5, 16) |
| AVAX | kraken | +11.6 (9.1, 8) | -13.7 (24.6, 24) | +68.9 (20.8, 19) | -29.0 (32.4, 16) |
| AVAX | binance | +14.3 (8.6, 8) | -7.1 (22.4, 24) | +78.9 (18.3, 19) | -25.4 (29.2, 16) |
| AVAX | binanceBnb | +14.5 (8.5, 8) | -6.6 (22.3, 24) | +79.8 (18.1, 19) | -25.1 (29.0, 16) |
| SUI | revx | +29.4 (21.4, 15) | +4.7 (24.4, 10) | — | — |
| SUI | revxMedian | +30.3 (21.1, 15) | +5.1 (24.2, 10) | — | — |
| SUI | kraken | +25.4 (22.7, 15) | +2.4 (25.9, 10) | — | — |
| SUI | binance | +31.5 (20.8, 15) | +5.7 (23.8, 10) | — | — |
| SUI | binanceBnb | +32.0 (20.6, 15) | +5.9 (23.6, 10) | — | — |

Sleeve return, arm minus revx, percentage points (from the sleeve table's fields):

| condition | arm | A | B | C | D |
|---|---|---|---|---|---|
| shipped·coinbase | revxMedian | +0.09 | +0.06 | +0.00 | +0.00 |
| shipped·coinbase | binance | +5.61 | +0.36 | +0.13 | +0.10 |
| shipped·coinbase | binanceBnb | +6.03 | +0.93 | +0.71 | +0.49 |
| shipped·kraken | revxMedian | +0.10 | +0.17 | +0.00 | +0.00 |
| shipped·kraken | binance | +0.29 | +0.37 | +0.12 | +0.10 |
| shipped·kraken | binanceBnb | +0.72 | +0.96 | +0.71 | +0.49 |
| trail·coinbase | revxMedian | +0.13 | +0.08 | +0.00 | +0.00 |
| trail·coinbase | binance | +5.72 | +0.33 | +0.14 | +0.10 |
| trail·coinbase | binanceBnb | +6.20 | +1.01 | +0.77 | +0.51 |
| trail·kraken | revxMedian | +0.13 | +0.08 | +0.00 | +0.00 |
| trail·kraken | binance | +0.35 | +0.33 | +0.14 | +0.10 |
| trail·kraken | binanceBnb | +0.85 | +1.02 | +0.83 | +0.51 |
