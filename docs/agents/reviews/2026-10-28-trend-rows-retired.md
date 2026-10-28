# The crypto loop's trend rows retire: EX-GAP and MX-1 closed (2026-10-28)

Davies, 2026-10-28: "把实盘的Trend 4h和测试的Trend 1h Trend 4h删了吧，那一整套都表现太差了感觉不值得做" (retire the live Trend 4h
and the testing Trend 1h and Trend 4h; the whole set performed too poorly to be worth doing). Migration `0158` retires
`trend-4h-live`, `trend-4h` and `trend-1h` in place (paused, `retired_at`; records kept) and clears
`agent_risk.live_confirmed_at`. Read-only on production at about 23:00–23:30 UTC that day: all three flat, no order in
flight, no maker probe still watched; the live row's only round trip (SOL) closed 2026-09-28 08:00 UTC, the paper
control's the same minute, `trend-1h`'s last fill 2026-10-22 02:00 UTC.

Two pre-registrations read these rows' fills. Neither file is edited: this note is the dated deviation each one's text
asks for ("Deviations are recorded in the review, the reference and the ledger"; "any change after it is a deviation and
is reported as one"). The reference's item 65 and the ledger carry it too. These readings were not blind: every record
may be read at any time since 2026-10-04 (`docs/agents/CLAUDE.md`).

## EX-GAP (`2026-09-28-ex-gap-prereg.md`)

**Deviation 1 (2026-10-28): the arms are retired, so the count is final at 2 pairs, and the reading its §4 gives on
2027-01-31 is recorded now: undecided, nothing follows.** §4: "On 2027-01-31 with fewer than 8 pairs, the reading is
undecided and nothing follows. The pairs are reported." A pair needs a `trend-4h-live` fill, and the live row can no
longer trade, so no pair can be added before that date; reading early changes no outcome. The deviation is the date
only. The monthly count (wake `trig_018Ni6ydYybx39fE2wn7ZLeo`) has nothing left to count.

The pairs, from `agent_orders` and `agent_decisions` (orders 35/37 and 43/44), by §3's measure, in bps, positive when the
live fill is worse. The live account's fill prices, quantities and dollars are not written here (the repository is
public: `[•]`); the gaps are in bps.

| pair | bar (`bar_start`) | side | paper | live | price gap | fee gap | gap |
|---|---|---|---|---|---|---|---|
| 1 | 2026-09-25 08:00 | buy SOL | 120.89 | [•] | +4.03 | +0.04 | **+4.07** |
| 2 | 2026-09-28 04:00 | sell SOL | 118.00 | [•] | +0.09 | +3.31 | **+3.39** |

- Pair 1's price gap is +4.03 on the unrounded live average price; §6 of the pre-registration wrote +4.14 (gap +4.18)
  from that price rounded to two decimals.
- Pair 2's fee is the venue's whole-cent fee in dollars over the gross notional (`response.filled_quantity` ×
  `avg_fill_price`), 12.31 bps against the paper 9; not derived (`feeDerived` absent).
- Mean of the two: +3.73 bps. No interval is drawn: §4 draws one only at 8 pairs or more.

What it means: the paper rows' dollar figures carry no paper-execution adjustment (§4's "otherwise"), and nothing about
the live/paper gap is settled. With the rows retired, nothing reads a paper trend row's dollars any more.

## MX-1 (`2026-09-28-mx1-maker-first-prereg.md`)

**Deviation 1 (2026-10-28): the trend rows are retired, so no event can be added; the reading its §5 gives at
2027-06-30 is recorded now on the 7 eligible exits there are: undecided.** §5: "if fewer than 150 eligible exit events have
`t0` before 2027-06-30 00:00 UTC, it is read after the first weekly pull after that instant, on every eligible exit event
with `t0` before it. With fewer than 60 of them it is 'undecided', never passed." Every event is a probe of a
`trend-4h`/`trend-1h` row's order, and those rows place none any more.

- `scripts/mx1/weekly.sql` statement C, run read-only on 2026-10-28 at about 23:20 UTC: **7 eligible exit events**
  (bar closes to 2026-10-22 02:00 UTC) and 7 entry events (to 2026-10-21 14:00 UTC). The ledger's pulls agree: 10-26's
  pull read 7 exits of 150, its statement B empty (no probe missing `o15` or `o60`) and 0 windows failed.
- Every window of these events has been pulled (`backtests/mx1/tape/`, last 2026-10-26) and none is failed, so no
  window waits on a retry and nothing is void. No `agent_basis` row is still needed: B was empty.
- 7 is under 60: **undecided, never passed**. §6's switch (moving `trend-1h`'s exits to maker-first) has no row to act
  on either way. H1's statistic is not computed: §5 decides on the count first.
- The weekly wake (`trig_01Dm3nw4TbBm2GCX2z12tN7o`, Mondays 06:37 UTC) has nothing left to pull. §5 says to disable it
  after the reading; the reading is this note.

## Others that named these rows

- JEV-DRIFT (reference §4 item 43): its check runs on entries the tick decides; with no row deciding it checks nothing.
  Nothing to read.
- The live cap's clean week and its $150 step (ledger item 3, `scripts/cap/`): no live row to raise.
- The closed backtest pre-registrations that priced `trend-4h`/`trend-4h-live` (sizing filters, BTC regime, maker-only,
  the Binance cross-sections, fp6's trend-ls, fund crowding) were read before this day and are unchanged by it.
- RW-NEXT's tick-lateness reading used `agent_basis`; it was read on 2026-10-09, and the tick still writes the basis.
