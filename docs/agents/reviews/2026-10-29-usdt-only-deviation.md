# A deviation of LIVE and of every running twin pre-registration: USDT-GBP alone from 2026-10-30 00:00 UTC, the coin rebooked by maker orders, variant-4 and the $300 nudge retired, the nudge on the 1:1 twin (migration `0178`)

Recorded apart from the pre-registrations it concerns, which are left as they were frozen, byte for byte (the session that made
it works under a rule never to edit a frozen pre-registration; `reviews/2026-10-29-holdmin-deviation.md` is the precedent).
Where a pre-registration froze a file this change touches, its pin test reads the hashes it froze there, those the holding-line
deviation named, and the hash named here, under its own heading, for the file as it is.

## On whose word, and why

Davies, 2026-10-29: "之后下一步你再研究下Revolut X的USDT-GBP近期是不是也完全超过USDC，基本可以肯定效果正面的话，把live全换成只做USDT-GBP的
（live策略改名为Stablecoin quotes USDT/GBP）（Stablecoin quotes LIVE twin同步改）（换币也用挂单不要有转换损失），variant-1，2，3，5，7和8也改为在新的实盘
基础上做，variant-6改为usdc和usdt 1:1作为两个币都做的对比（追踪usdt和usdc的年化比率，在它子页面的score board下加一行文字更新这个）". Then, on the
two questions the main session put to him: "原 variant-5 …这个可以删了" and "原 variant-7 …这个在'原 variant-6…改成 USDC:USDT 1:1…'这个基础上做，
也加那一行文字". His variant numbers are those before `0176`: 1 `live1200`, 2 `take50`, 3 `n600no03`, 5 `n600usdt3`, 6 `n600usdt`,
7 `u300nudge`, 8 `live600x1`.

The study, `reviews/2026-10-29-usdt-only.md`: on LIVE's rules with the £1 holding line, USDT-GBP alone beat LIVE's two books at
£600 since 09-01 by +7.1 % a year (80 % +3.0 to +11.3, P(≤ 0) 0.014), every month since May; less at £1,200 (P 0.019) and not
significant at £2,400 (P 0.051) or over the last 30 days alone (P 0.17). Book for book USDT-GBP led USDC-GBP by +21 % a year
(P 0.0004). LIVE's own record agreed (USDT-GBP 1.75 times USDC-GBP per pound of book). Not blind.

## What changed

- **LIVE** (`supabase/functions/agents/quotes_live.ts`): `QUOTE_LIVE_INSTANCE.weights = { from: QUOTE_LIVE_USDT_ONLY_FROM, book:
  { "USDC-GBP": 0, "USDT-GBP": 1 } }`, `QUOTE_LIVE_USDT_ONLY_FROM` = 2026-10-30 00:00 UTC: PR5-OPT's capital split (unchanged code
  since `0148`) gives USDT-GBP's six rungs the whole capital (£100 each at £600) and USDC-GBP's none, so USDC-GBP quotes no entry
  from then and a USDC holding still exits and stops. **The coin rebook** (`rebookOn`, `planDrains`, new): for 72 hours from
  weights that come into force at `QUOTE_LIVE_REBOOK_SINCE` (the same instant) or later, a book holding more coin beyond its
  longs than its asks need and the top-ups' 2 % buffer sells the surplus by one post-only order at a time at the top of the
  asks (a tick under a best ask two ticks or more over the bid, else at it), **never under fair rounded up**, re-sent at the
  book as it stands after 30 minutes unfilled; a surplus under the venue's minimum is carried. The book that is short is topped
  up by the existing maker top-ups with the day's cap lifted from £5 to the capital. Makers only: no taker, no crossing, no sale
  under fair (Davies: "换币也用挂单不要有转换损失"). Before 00:00 the executor is as it was: `quotes_live_instance.test.ts` runs
  the live instance against `quotes_live_frozen.ts` (unchanged, sha256 `60d3f33f2bb8d328fe14693d570396afdffcc2cae9b75e05e2d4eed5ea459a52`)
  turn by turn on its fixtures, all before the instant; weights from before the rebook's instant (PR5-OPT's twins of 10-28)
  rebook nothing. The live design's addendum of 2026-10-29 records it (`reviews/2026-09-24-pr5-live-design.md`).
- **The page** (`agents/index.ts`, `src/agents/agents.js`): LIVE is named "Stablecoin quotes USDT/GBP". A conversion that sells
  is no conversion lot: it takes its coins out of the lots first in, first out, as an ask does, and the coin book counts its
  coins and pounds out. A twin on both books from the instant (`twinBookRatio`) shows a line under its scoreboard: each book's
  realised a year on its half of the capital since 00:00, and USDT's over USDC's.
- **The twins** (`0178`; no driver code changed: `quotes_twin.ts` is the bytes every record below names):
  - LIVE's weights at LIVE's instant, added, guarded on their absence: `live600` (named "Stablecoin quotes USDT/GBP LIVE twin"),
    `live1200` (variant-1), `take50` (variant-2), `live600x1` (variant-7 → variant-6) and its control `live600ctl`.
  - `n600no03` (variant-3): weights replaced, guarded on the old, by USDT-GBP alone with its own 0.3 % rung at 0, from 00:00.
    **Between this migration's apply and 00:00 its weights are not in force**: its 0.3 % rungs quote again for those hours, at
    the capital over twelve. From 00:00 it is LIVE's new rules less the 0.3 % rung, as it was LIVE's old rules less it.
  - `n600usdt` (variant-5 → variant-4): weights replaced by USDC:USDT 1:1 from 00:00 (Davies' old variant-6); from apply to 00:00
    no weights are in force, which is 1:1 already; from 00:00 its USDT surplus is rebooked into USDC.
  - `n600usdt3` (variant-4, USDT 3:1) off and hidden, named "Stablecoin quotes USDT 3:1 from 10-28" (Davies: "可以删了").
  - `u300nudge` (variant-6, the USDC-GBP nudge at $300) off and hidden, named "Stablecoin quotes USDC nudge $300 from 10-29", and
    its control `u300ctl` off (place 52 → 56). The nudge goes on as **`n600nudge` "Stablecoin quotes variant-5"**: the 1:1 twin's
    rules from 00:00 and the same nudge, £600, so `n600usdt` is its control; its own pre-registration is
    `reviews/2026-10-29-usdt-only-twins-prereg.md`. A twin's simulated account is funded once, at its start, so `u300nudge`
    could not move to £600 in place.
  - `n600usdt2` (the hidden USDT 2:1, weights from 10-28): untouched; it keeps running to its reading.

## Each pre-registration it touches

Every paired reading below has **both arms switch at the same minute**, 00:00 UTC on 2026-10-30, and each reading reports the
days before and after the switch apart where it can. The rebook's first three days are reported apart too: they carry the coin
switch, which no later day does.

### `docs/agents/reviews/2026-10-26-live-size-twins-prereg.md`

`live600` (the LIVE twin) takes LIVE's weights and the rebook from 00:00, as LIVE does; its comparison is LIVE's own record, both
changed at the same instant. The window (to 11-11) now spans the switch: 2 days before it and 12 after. It froze
`quotes_live.ts`; the file as it is now:

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | eb9790f61931636ca0ee58d7d4fbbb0d2d515fd2e2dc197303fd8f805d79136a |

### `docs/agents/reviews/2026-10-27-live-next-size-prereg.md`

`live1200` (variant-1) and its yardstick `live600` both switch at 00:00: the size question is now asked of USDT-GBP alone from
then (six rungs of £200 against six of £100). The study found the gain over both books smaller at £1,200 (+5.6 % a year against
+7.1 at £600), which the reading reports beside its bar.

### `docs/agents/reviews/2026-10-03-take-prereg.md`

`take50` (variant-2) takes LIVE's weights from 00:00; its take rule is unchanged and now acts on USDT-GBP alone. The take
window ends 2026-11-02 00:00: its last 3 days fall after the switch, reported apart.

### `docs/agents/reviews/2026-10-27-pr5-opt-twins-now-prereg.md`

`n600no03` (variant-3) and its yardstick `live600` switch together at 00:00; between this migration's apply and 00:00 its 0.3 %
rungs quote (above), which the reading reports. `n600usdt` (USDT alone) becomes USDC:USDT 1:1 from 00:00: **its 11-25 reading
is superseded** (the question of USDT alone against both books is answered by LIVE's switch on the study above); from 00:00 it
is variant-4 on the page, the both-coins comparison with the USDT/USDC line, and the control of `n600nudge`. `n600usdt3`
(USDT 3:1) **stops: its reading is superseded** (Davies: "可以删了"); its record to the stop stays. `n600usdt2` is untouched.

### `docs/agents/reviews/2026-10-29-revx-usdc-nudge-twin-prereg.md`

`u300nudge` and `u300ctl` **stop: the 11-26 reading is superseded** by `n600nudge` against `n600usdt` (Davies: "原 variant-7
…在'原 variant-6…改成 USDC:USDT 1:1…'这个基础上做"), the same nudge on the same book at £50 a rung, the size REVX-FAIR's replay
used. Their record to the stop (from 10-29 08:00, under a day) stays and may be reported for what it is. It froze the executor;
the file as it is:

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | eb9790f61931636ca0ee58d7d4fbbb0d2d515fd2e2dc197303fd8f805d79136a |

### `docs/agents/reviews/2026-10-29-revx-exit-tick-twin-prereg.md`

`live600x1` (variant-6 from now) and its control `live600ctl` take LIVE's weights at the same minute; the comparison stays the
exit offset's alone, now on USDT-GBP alone from 00:00 (5 hours on both books, then about 27.8 days on one). It froze the
executor; the file as it is:

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | eb9790f61931636ca0ee58d7d4fbbb0d2d515fd2e2dc197303fd8f805d79136a |

For the record: the executor was `99ce22c051431df2fc179ebaf93717460b953f95f87d109466d6f91d55d40bd8` before this change.
