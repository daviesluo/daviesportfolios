# A deviation of LIVE and of every running twin pre-registration: variant-4's £1 holding line for all from 2026-10-29 22:00 UTC, variant-4 retired (migration `0176`)

Recorded apart from the pre-registrations it concerns, which are left as they were frozen, byte for byte (the session that made
it works under a rule never to edit a frozen pre-registration; `reviews/2026-10-29-variant7-frozen-files-deviation.md` is the
precedent). Where a pre-registration froze a file this change touches, its pin test reads the hash it froze there and the hash
named here, under its own heading, for the file as it is.

## On whose word, and why

Davies, 2026-10-29: "那你研究下variant-4的结果，如果基本可以肯定效果正面的话，加入实盘live的规则里和所有测试策略包括所有variant里，并且把variant-4删了，
之后的数字都-1" (study variant-4's result; if it is basically certain to be positive, add it to LIVE's rules and every test strategy
including every variant, delete variant-4, and number the rest down by one). The verdict, `reviews/2026-10-29-holdmin-verdict.md`:
basically certain positive on USDT-GBP (LIVE's own days replayed with it +0.62 bps of capital a day before the haircut, P(≤ 0) 0.002;
+9.96 after it, 17 days ahead and none behind; the long replays +5.3 / +3.0 / +1.9 % a year at £600 / £1,200 / £2,400 since 09-01 and
+2.0 / +1.1 / +0.8 out of sample, P(≤ 0) 0.000 each) and harmless on USDC-GBP (+0.1 to +0.2); no mechanism downside found.

## What changed

- **The rule** is variant-4's, not a new one: `holdMin {gbp: 1}` (PR5-OPT, `reviews/2026-10-27-pr5-opt-twins-prereg.md` §1;
  `TWIN_RULES.holdMin`, `QuoteLiveInstance.holdMin`, `holdLineBase`). A rung counts as held only above £1 of coin; under it the
  rung's entry keeps resting and its coin is carried into the trip; over it one exit takes the whole holding, and once that exit
  rests the line is the venue's minimum again; the 24-hour stop counts from the fill that crossed £1.
- **LIVE** (`supabase/functions/agents/quotes_live.ts`): `QUOTE_LIVE_INSTANCE.holdMin = { from: QUOTE_LIVE_HOLD_MIN_FROM, gbp: 1 }`,
  `QUOTE_LIVE_HOLD_MIN_FROM` = 2026-10-29 22:00 UTC. Before the instant its line is the venue's minimum, as before; nothing else in
  the executor changed. `quotes_live_frozen.ts` is untouched (sha256 `60d3f33f2bb8d328fe14693d570396afdffcc2cae9b75e05e2d4eed5ea459a52`),
  and `quotes_live_instance.test.ts` still runs the live instance beside it, turn for turn, on its fixtures (all before the
  instant). The live design's addendum of 2026-10-29 records it (`reviews/2026-09-24-pr5-live-design.md`).
- **Every running twin** (`0176`): the rule `holdMin {gbp: 1, from: 2026-10-29T22:00:00Z}` added, guarded on its absence, to
  `live600` (LIVE twin), `live1200` (variant-1), `take50` (variant-2), `n600no03` (variant-3), `n600usdt2` (hidden), `n600usdt3`,
  `n600usdt`, `u300nudge` and `u300ctl`, `live600x1` and `live600ctl`. No driver code changed (`quotes_twin.ts` is the bytes every
  record below names). The instant is LIVE's, so the twins keep mirroring LIVE.
- **Variant-4** (`n600hold1`) off and hidden, named "Stablecoin quotes hold £1 from 10-28"; its row, tables and record stay.
- **Page names**: variant-5 → variant-4 (`n600usdt3`), variant-6 → variant-5 (`n600usdt`), variant-7 → variant-6 (`u300nudge`),
  variant-8 → variant-7 (`live600x1`). Display only: ids, tables and every other rule are as they were.

## Each pre-registration it touches

Every paired reading below has **both arms take the line at the same minute**, so it stays like for like from 22:00; the days
before 22:00 are as they were. Each reading reports the switch, and the days on each side of it apart where it can.

### `docs/agents/reviews/2026-10-26-live-size-twins-prereg.md`

`live600` (the LIVE twin) takes the line from 22:00, as LIVE does. Its comparison is LIVE's own record: both change at the same
instant. No file it froze changed.

### `docs/agents/reviews/2026-10-27-live-next-size-prereg.md`

`live1200` (variant-1) and its yardstick `live600` both take the line from 22:00. No file it froze changed.

### `docs/agents/reviews/2026-10-03-take-prereg.md`

`take50` (variant-2) takes the line from 22:00. It froze `quotes_live.ts` at `425def7ed57f1b4e6157cadf7167e7d1711a06ec05fa552df25c35d2adf12e6b`
(changed by earlier sessions since, each recorded in its own deviations); the file as it is now:

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | 99ce22c051431df2fc179ebaf93717460b953f95f87d109466d6f91d55d40bd8 |

### `docs/agents/reviews/2026-10-27-pr5-opt-twins-now-prereg.md`

PR5-OPT's five (`n600*`): variant-3 (`n600no03`), the hidden USDT 2:1 (`n600usdt2`), USDT 3:1 (`n600usdt3`, variant-4 from now)
and USDT alone (`n600usdt`, variant-5 from now) take the line from 22:00, as does their yardstick `live600`, so each reading is
still one change against LIVE's rules. **Variant-4 (`n600hold1`, the holding line's own twin) stops: its 11-25 reading is
superseded**, its question answered by the verdict and its rule now everyone's. Its record to the stop stays and may be reported
for what it is (about a day). No file it froze changed.

### `docs/agents/reviews/2026-10-29-revx-usdc-nudge-twin-prereg.md`

Variant-7, now variant-6 on the page (`u300nudge`), and its control `u300ctl` take the line at the same minute; the comparison
stays the nudge's alone. It froze the executor; the file as it is:

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | 99ce22c051431df2fc179ebaf93717460b953f95f87d109466d6f91d55d40bd8 |

### `docs/agents/reviews/2026-10-29-revx-exit-tick-twin-prereg.md`

Variant-8, now variant-7 on the page (`live600x1`), and its control `live600ctl` take the line at the same minute; the comparison
stays the exit offset's alone. Its window began at 19:00, three hours before the line. It froze the executor; the file as it is:

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | 99ce22c051431df2fc179ebaf93717460b953f95f87d109466d6f91d55d40bd8 |

For the record: the executor was `12e3dad7cc9058cedc7cd840fc4ac5d3396b955c842e39fd70f22f18cfad25eb` before this change.
