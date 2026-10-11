# Pre-registration LP-SKEW-FT: inventory-skewed quoting for live-prep, a paper forward test

Written 2026-10-11 between 20:40 and 21:00 UTC. It is frozen by the commit that adds this file, `agents/lpskew.ts`,
migration `0117_lpskew.sql` and `docs/agents/backtests/lpskew/`. Nothing below may change after that commit, and any
change is reported as a deviation. The replay starts at **2026-10-12 00:00 UTC** and is read **on or after 2026-10-19
00:05 UTC**, once at least seven whole UTC days and at least three settlements of markets the base arm held are in;
until both hold, the reading moves a day at a time, and on 2026-10-26 00:05 UTC it is read whatever it holds (fewer than
three settlements or seven days reads "needs more data", never a change). It is not blind: the design follows a
non-blind read of live-prep's 10-09 → 10-11 record (below).

**What it changes:** nothing that trades. It adds one Edge call (`agents?action=pmlpskew`, every minute), one lease
(`pm-lpskew`) and two tables (`pm_lpskew_state`, `pm_lpskew_days`). It reads `pm_lp_minutes` and `pm_lp_settlements` and
writes nothing else. `pm_live.ts`, `pm_lp.ts`, `pm_prep.ts`, every config row and every frozen pre-registration are
unchanged; `src/lpskew_prereg.test.js` pins their bytes as they stand at this freeze.

## On whose word

Davies, 2026-10-11 20:35 UTC:

> 同意，做 LP-SKEW-FT 纸面前向测试

In English: "Agreed, run the LP-SKEW-FT paper forward test." And at 20:37 UTC:

> 同意迁移，全部做 LP-SKEW-FT（独立模块 + 迁移）

In English: "Agreed to the migration; do all of LP-SKEW-FT (a standalone module and a migration)."

## Why (what was read before design, not blind)

Live-prep's fills from 2026-10-09 to 2026-10-11 20:00 UTC marked −$86.58 against $35.21 of rewards and rebates. Four
markets made 81 % of the loss (MrBeast 215–223M settled against 49.9 NO shares, −$32.54). The mid 60 minutes after a
fill had moved 3.3 ¢ against the fill on average over 338 fills. A fill-removal replay of four candidate rules (drift
pause, end-date horizon, inventory cap, a per-market stop) flipped sign between the live record and the 10-04 → 10-09
paper record, and a minute-level touch simulator failed calibration (+$209.56 simulated against −$84.98 live). So this
test measures what a one-minute record can measure: the reward an arm keeps, the inventory it carries, and the 60-minute
markout of its own fills. It cannot measure news-driven adverse selection inside a minute.

## The arms

All three run in `agents/lpskew.ts` on the same minutes: only market-minutes in which live-prep itself rested a quote
(`bid_price` or `ask_price` recorded), so live-prep's selection, pause, TB1 skip and reward check are shared. Inventory is
in YES-equivalent shares q per market.

- **base** (live-prep's quoting, S2): RW's `quote` prices at N = `sizeN(min_size)`; a side stops at 5N its way.
- **cap40**: base, and a side stops at min(40, 5N) shares its way (the reducing side always quotes).
- **skew**: cap40, and both prices shifted by −k·q with k = $0.001 a share, each rounded away from the mid to the tick
  and never through the raw touch.

Fill rule (all arms): a bid of minute t fills in full (N) when minute t+1's best ask or adjusted mid is at or under it;
an ask when t+1's best bid or adjusted mid is at or over it; t+1 must be within two minutes. Reward: the Polymarket
formula on the arm's own quotes (`scoreS`, two-sided rule as RW) against the others' recorded scores (`othersOf`),
rate/1440 a minute, valued at R = 0.737 (live-prep's pooled R on 2026-10-11). A settlement books the holding at its
payout. **Kill:** an arm whose marked fills reach −$50 quotes nothing more (recorded as `killed_at`).

## Hypotheses and the bar

- **H1:** skew's 60-minute markout per filled share (side-signed: mid in 60 minutes less the fill price, for a buy) is
  better than base's by at least 30 % (`skew ≥ 0.7 × base` when base's is negative).
- **H2:** skew's reward formula is at least 75 % of base's.
- **Net:** for cap40 and for skew, the daily paired difference (arm − base) of net (the change of the marked value +
  0.737 × formula), bootstrapped over days with `random.Random(20261019)`, 2,000 draws: the 5th percentile (index 100 of
  the sorted means) > 0, and the mean without the arm's best day > 0.

An arm is a candidate for live-prep only if H1, H2 and Net all hold, and then only through its own addendum, Davies'
word, and a half-size live start. Any arm killed fails.

## Limitations (stated before the data)

- The fill rule is a one-minute touch model: it misses fills inside a minute and news trades, so its fills are not
  live-prep's fills (calibration on 10-09 → 10-11 failed on sign). Net is about the arms' differences on the same
  model, not about live money.
- Queue position, partial fills and the others' reaction to our prices are not modelled.
- Seven days and a handful of settlements are a small sample; SKILL §7's three-day floor is a minimum, not proof.
- The arms see only minutes live-prep quoted: if live-prep is disarmed or stopped, the replay stops with it and the
  reading uses the days it has.

## The frozen files

| File | sha256 |
|---|---|
| `supabase/functions/agents/lpskew.ts` | `802b108a931e9c92e17ddc7f40020a05d42a24ad5ef9b97737c99f12047ff461` |
| `supabase/migrations/0117_lpskew.sql` | `3649bb7f74abdbaac7f661c7fca0939d4b16cbe070e705accfee9c054c9758c7` |
| `docs/agents/backtests/lpskew/scripts/bar.py` | `c9ed3de1e5b3d229ab31f26a242a64f3e62c8bef8250cf52162c6fcb92818357` |
| `docs/agents/backtests/lpskew/sql/readout.sql` | `fc8b15ac4f3cf84898495302961826660e5f68196aa67b408290da000a1d4a09` |

Unchanged at this freeze (pinned, not edited): `pm_live.ts` `ee96ba0e40e38ac9999f78028470cc8713584cf05c45539f265eca76c2d3667d`,
`pm_lp.ts` `53f7f788a47e93f52770f96410db9faf8f34cdd7dc2cf4ddbd877c9038d07278`, `pm_prep.ts`
`a13ef03c870db2a17411456ffbfcb1b203ffe4654525d7792e6e38ed675b696a`.
