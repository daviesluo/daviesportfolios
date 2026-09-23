# Pre-registration — the cross-sectional momentum (xsmom) study

Written 2026-09-23, from 07:08 UTC (read from `date -u`), BEFORE any candidate
arm, null draw or benchmark was run. It is not edited after results are seen;
a mistake found later is corrected by a dated note APPENDED below the last
line, and every such note is reported with the results.

## 0. State of play when this was written

- Klines downloaded and checked (section 1); manifest sha256
  `24cf84bd4c52c1f2c99ae62a2cefd44ac72b5a3a18d8bc7582003363c8c9ed00`.
- Data QA run (`$S/research_bd/xsmom/qa_data.py` → `qa_data.out`): spans,
  gaps, a near-$1 screen, the tokenised-stock spans. It computes no return.
- `supabase/functions/agents/backtest_xsmom.ts --stage data` run twice
  (`$S/research_bd/xsmom/stage_data.out` holds the first run). It prints the
  universe's membership, IS_START, the spreads, the USDC/USDT check and the
  incumbent's reproduction, and writes nothing. **Disclosure:** in the first
  run its simulator self-check no. 4 ran ONE family point internally (k 5 ·
  L 28 · abs ma · regime on, window A) to test the null's slot matching; it
  printed only "nullMatchesSlots ok", never a return, and no return from it
  was looked at. The check now uses a synthetic, non-family path (the top m by
  volume, m cycling 5, 3, 0, 4).
- No candidate, grid point, null draw, benchmark or combination number exists
  anywhere. Script sha256 at the freeze:
  `1eecf20f5448cf20a86fad70b932eb179e87115bf4cd0e540bc73e84c41fdb96`.

## 1. Data

- Binance's public spot bulk archive, keyless. Symbols: every folder under
  `data/spot/monthly/klines/` (3,710 symbols, 735 ending in USDT), listed from
  the bucket `https://s3-ap-northeast-1.amazonaws.com/data.binance.vision`,
  which is the `BUCKET_URL` data.binance.vision's own index page reads.
  Files: `https://data.binance.vision/data/spot/monthly/klines/{SYM}/1d/…zip`
  for every month listed, plus `data/spot/daily/klines/{SYM}/1d/…-2026-09-DD.zip`
  for every symbol with a 2026-08 file. 38,351 zips, each checked against the
  bucket's ETag (MD5) and its size; kept under `$S/binance_klines/raw/`.
- Parsed to `$S/binance_klines/daily/{SYM}.json`, rows
  `[open_time_sec, open, high, low, close, base_vol, quote_vol, trades]`
  (the archive's millisecond timestamps before 2025 and microsecond ones from
  2025 both normalised to seconds). 734 series (USDSOLDUSDT has no files).
  Calendar 2017-08-17 → 2026-09-22. `manifest.json` holds the sha256 of every
  zip and every parsed file; the script verifies every parsed file against it.
- **How delisted pairs are found**: the archive keeps a delisted pair's folder,
  so the listing already contains them. 252 series end before the archive's
  last day; every one of them is `BREAK` (211) or absent (41) in the keyless
  `exchangeInfo` fetched 2026-09-23 02:02 UTC (`bc_exchangeInfo_full.json`,
  sha256 `8fb2eab1…`), and no series that reaches the end is anything but
  `TRADING`. "Delisted" in the results means: not `TRADING`, or no kline in
  the archive's last two days.
- Spans per pair are in the manifest (`first`, `last`, `rows`) and, for every
  pair that ever enters the universe, in `xsmom.json` (`inputs.everInUniverse`,
  with each segment).

## 2. The universe (point in time)

- Excluded by construction (145 of 734 series), by base asset:
  - leveraged tokens (50): a base that is BULL or BEAR, or another listed base
    followed by UP / DOWN / BULL / BEAR — the script's list, and the script
    throws if the rule finds one the list lacks (so JUP and SYRUP stay in);
  - stablecoins, fiat and pegged tokens (29 series): AEUR, AUD, BFUSD, BKRW,
    BUSD, DAI, EUR, EURI, FDUSD, GBP, PAX, RLUSD, SUSD, TUSD, USD1, USDC, USDE,
    USDP, USDS, USDSB, USDSOLD, UST (the pre-collapse pair, 2021-12-24 →
    2022-05-13), U (closes 0.9993–1.0017; added after the near-$1 screen found
    it), XUSD; gold PAXG, XAUT; WBTC, WBETH, BETH, BNSOL. USTC is NOT excluded:
    its pair has traded 0.004–0.06 since 2023-03-10 and never near $1, like
    LUNC; FRAX here is the governance token (0.23–1.23) and stays in;
  - tokenised equities (66): the `…B` stock tokens listed from 2026-06-11 on
    (none reaches 100 days of age inside any window, so this has no effect).
- A gap of more than **7** missing days inside a series starts a new segment
  (7 or fewer is bridged: STRAX 7, BNX 5, BCC 4 and five of 3 days). Segments
  that matter: LUNA (old token to 2022-05-13, new from 2022-05-31), FTT (halt
  2022-11-15 → 2023-09-22), CVC (2022-12-09 → 2023-05-12), KEY, VEN, NBT, VIDT.
  A position is sold at its segment's last close; a new segment must age again.
- **Eligible** on the close of day d: not excluded; a kline on each of the 30
  days d−29…d; the current segment at least 100 days old (so the 28-day return
  and the 100-day mean exist). **Universe** = the 30 eligible pairs with the
  largest 30-day quote volume (sum of quote volume over d−29…d; ties by
  symbol). N = 30.
- IS_START = **2019-07-01**, the first Monday with 30 eligible pairs and a
  BTCUSDT 200-day mean; every Monday decision from then to 2026-09-19 sees a
  full 30. 287 pairs pass through the universe over that span, 70 of them
  since delisted; per window: A 99 (1 delisted), B 84 (8), C 105 (22),
  D 107 (30).

## 3. The rule and the family

- Weekly: decide on the close of Sunday (UTC), fill at Monday's daily open.
  Every run also forms its book on its first day (decision on the prior close).
- Rank the universe by L-day return, close(d)/close(d−L) − 1 (ties by symbol);
  take the top k; each is held at 1/k of equity. Absolute filter options:
  `none`; `ret` — a pick is held only if its L-day return is > 0; `ma` — only
  if its close is above its 100-day mean. A pick failing the filter leaves its
  slot in cash (top-k first, then the filter, as §3.4's rotation does). BTC
  regime option: `on` — the whole book is cash while BTCUSDT's close is below
  its 200-day mean at the decision; `off`.
- Rebalancing: holdings leaving the target are sold whole; kept holdings are
  trimmed or topped up to 1/k only when the difference is at least $5; new
  entries under $5 are skipped; a full exit always executes (counted as dust
  when under $5). Sells before buys; buys scaled down if fees leave cash short.
- The family: k ∈ {3, 5} × L ∈ {7, 14, 28} × abs ∈ {none, ret, ma} × regime
  ∈ {off, on} = 36 points; grid order abs × regime × k × L as listed.

## 4. The walk-forward and the windows

- Out-of-sample windows = the project's A–D as `windowsOn` cuts them on
  BTC/USD (checked at run time against `loadMeasuredSeries`), daily bars
  inclusive: **A 2025-09-10 → 2026-09-19 (375 d), B 2024-08-31 → 2025-09-09
  (375), C 2023-08-22 → 2024-08-30 (375), D 2022-08-22 → 2023-08-21 (365)**.
  The two most recent are A and B.
- In sample for window W = IS_START (2019-07-01) → the day before W starts:
  as much history as the universe supports, expanding (A and B's own in-sample
  in the project is likewise all history before them).
- Choice: `backtest.ts`'s — best in-sample return / max(0.05, drawdown);
  the first in grid order wins a tie.
- **Seven candidates** (the only arms the bar judges):
  C1 abs none · regime off, C2 none · on, C3 ret · off, C4 ret · on,
  C5 ma · off, C6 ma · on — each with (k, L) chosen in sample per window from
  its six points — and C7, all 36 points chosen in sample per window.
- Each window's book starts with $100 cash on its first day; marked at daily
  closes; the last day is marked, not liquidated (`run`'s convention).

## 5. Costs

- 10 bps a side on every fill (Davies' tier, maker = taker). BNB 7.5 bps is
  reported for every candidate and never decides.
- Plus half the full spread per side: for the 25 pairs in the committed
  `docs/agents/backtests/inputs/binance_books_2026-09-23/binance_cost_bookticker_samples.jsonl`
  (sha256 `c520f902…`; 25 samples each, 2026-09-23 02:44–03:08 UTC) the median
  of its samples, recomputed by the script (BTC 0.001 … PEPE 20.429 bps);
  **every other pair is charged the widest of those 25 medians, 20.429 bps**
  (PEPE's) — 4.5× the measured 75th percentile (4.578), because the unmeasured
  pairs are the older, smaller and delisted ones. Spreads doubled is reported
  and never decides.
- Minimum notional $5; capital $100. Turnover is counted exactly: every fill's
  notional, fee dollars and spread dollars, fills, forced exits and skipped
  trades, per window.

## 6. The null and the benchmarks

- **Primary null (decides)** — random selection with the candidate's own cash
  decisions AND turnover: at each rebalance it holds as many coins as the
  candidate holds (so the same weeks in cash and the same unfilled slots),
  keeps as many of its own current holdings as the candidate keeps (chosen at
  random among those still in the universe), and fills the rest with coins
  drawn uniformly from the same 30-pair universe that it does not already
  hold. Same engine, costs and minimum. 1,000 draws per grid point per window;
  a candidate uses its chosen point's draws. Seeds `seedOf("xsmom-null",
  point, window, draw)` through `mulberry32` (imported). Why turnover is
  matched: a fresh random pick every week turns the whole book over weekly and
  pays two to three times the candidate's costs, which would make the bar
  easier — a control looser than the thing it stands in for.
- **The request's literal null (descriptive)**: k fresh random coins from the
  universe every week, always invested, 1,000 draws per k per window.
- **Benchmarks (descriptive)**: the whole 30-pair universe equal-weighted and
  rebalanced weekly (without the $5 minimum — it cannot be held at $100: $3.33
  a coin); BTCUSDT bought on the first day and held.
- **Four-coin control (descriptive, never a candidate)**: §3.4's rotation moved
  onto this engine — top 2 of BTC/ETH/SOL/XRP by 28-day return, each only above
  its 100-day mean, weekly, same costs — so breadth is compared with four
  coins on the same mechanics.

## 7. The bar

A candidate PASSES when (1) its out-of-sample return is > 0 in window A AND in
window B, and (2) its worst window of A–D is above the 95th percentile of its
null's worst window — for each null draw, the minimum over A–D of that draw's
four window returns; the percentile is s[floor(0.95 · 1000)] of the sorted
1,000, and "above" is strict. P(null worst ≥ candidate worst), ties against the
candidate, is reported beside it. Every window's return, drawdown, turnover
and fees are reported. §4.15's 35 % drawdown limit is flagged: a pass with a
window over it is named as failing that limit and cannot be recommended for
money.

## 8. The chance count

For each candidate, p = the share of its 1,000 null draws that pass the same
bar (A > 0, B > 0, worst window above the candidate's own null threshold).
Expected passes by chance = Σ p over the seven. P(≥ observed passes) is the
exact Poisson-binomial tail over the seven p's (independent candidates);
P(≥ 1) is also given for identical candidates (max p). The same count is
reported for all 36 grid points as fixed arms (descriptive). Looks counted:
7 candidates × 4 windows decide; 36 points × 4 windows × (in, out of sample)
are reported.

## 9. The combination with the incumbent

- The incumbent is `trend-4h` on Revolut X, BTC/ETH/SOL/AVAX/SUI, five equal
  $20 slots (four in C and D, where SUI has no window), seeded parameters,
  primary evaluation (shipped stop, Coinbase-spliced tape), rebuilt from
  `backtest_jev.ts`'s exported machinery and required to equal `set2.json`'s
  `equal` row on all four evaluations and the published +8.03 / +20.08 /
  +55.64 / −7.81 % with worst |Δ| = 0 BEFORE anything else runs (done in the
  data stage: 0).
- Its day-by-day P&L (as `combine` sums it) on the xsmom window calendar
  (days outside it — AVAX/SUI's later window ends — are dropped, and the
  incumbent's return on this calendar is reported beside the published one).
- Reported per candidate and benchmark, per window: Pearson correlation of
  daily returns (all days, and the days the incumbent's P&L is non-zero), and
  **half each**: $50 in the xsmom book and $50 in the incumbent, each
  compounding in its own account with no transfer, summed — return, drawdown,
  return/drawdown — against each alone.
- **"Adds"** only if ALL of: the candidate passes the bar; the half-each book's
  worst-window return AND worst-window return/drawdown beat the incumbent
  alone's on the same calendar; and the half-each book's worst window beats
  the same combination built with the candidate's null draws (P < 0.05).
  Otherwise the combination is descriptive.

## 10. Reported, never deciding

The 36 grid points out of sample (share positive per window, their own null
p95s and bar results); BNB fees; spreads doubled; the rebalance weekday
(all seven; the Monday entry must equal the primary exactly); the universe
at N = 20 and N = 50 (C7 re-chosen in sample, the equal-weight benchmark at
that N); the literal null; the four-coin control; USDC/USDT's largest daily
deviation per window (A 19, B 21, C 23, D 408 bps — D's is USDC's own
2023-03-11 depeg, not USDT's).

## 11. Reading rules, fixed now

- No candidate passes → the answer is no: breadth on Binance does not buy a
  momentum edge that clears the bar; no row is proposed.
- One or more pass, but P(≥ observed | chance) ≥ 0.05 → the passes are inside
  chance; reported as such; at most a paper MEASUREMENT row could be argued,
  never money (§4.15: one-window and inside-chance passes are noise).
- Passes and P < 0.05 → a paper row on Binance is recommended (paper first;
  live only on Davies' word; a window over 35 % drawdown blocks money).
- The combination changes nothing unless "adds" (section 9) holds.

## 12. Determinism

No wall clock in the output. The study runs twice from a clean start; the two
`xsmom.json` files must have the same sha256, and `fetch_klines.py --verify`
must re-hash every zip and parsed file to the manifest.

---

## Correction 1 — 2026-09-23 07:14 UTC, AFTER the first full run was seen

**What was wrong.** Section 2 bridged gaps of up to 7 missing days as one
instrument. Auditing implausible first-run numbers (a 98 % in-sample drawdown)
found that the short gaps in this archive are token REDENOMINATIONS, not
halts: the price across the gap moves by BNX ×0.01 (2023-02-16 → 02-22),
BTCST ×0.1 (2021-03-15 → 03-19), COCOS ×1000 (2021-01-19 → 01-23), DREP ×100
(2021-03-29 → 04-02), QUICK ×0.001 (2023-07-17 → 07-21), STRAX ×0.1
(2024-03-20 → 03-28), SUN ×0.001 (2021-06-14 → 06-18); BCC (2018, ×1) is the
only price-neutral one. Bridging them manufactures ×0.001–×1000 moves.
No discontinuity exists at a day boundary WITHOUT a gap among pairs that can
enter the universe (one boundary jump >30 % in the whole non-excluded archive:
SCR on its listing day, never eligible).

**Correction.** `GAP_BRIDGE_DAYS = 0`: every missing day starts a new segment
(the archive has no one-day gaps at all, so nothing else changes), the new
segment must age 100 days again, and a holding is sold at the old segment's
last close. Nothing else in the protocol changes.

**What the first run was.** Its output is kept verbatim:
`$S/research_bd/xsmom/uncorrected/xsmom_G7.json` (sha256 `08ac17d8…`), log
`uncorrected/run1_G7.log`. Its verdict: 0 of 7 candidates pass. Before
re-running, the audit found that none of the five redenominated pairs that
ever enter the universe (BNX, BTCST, COCOS, STRAX, SUN) was in it within 100
days after its swap, so the correction is expected to change no candidate path;
the re-run is diffed against the first run and the difference reported.

The frozen text above is the first 14,132 bytes of this file; its sha256 is
`543f009db734617bbedb0dd7b4e155fa167fe8b5035de0e71c04a2c2e9a696f6`
(`prereg_xsmom.sha256`).
