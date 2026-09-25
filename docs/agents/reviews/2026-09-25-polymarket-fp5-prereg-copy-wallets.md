# Pre-registration COPY: five May Bitcoin-ladder wallets, copied for three months (fp5, test COPY)

Written 2026-09-25 (UTC) before any wallet was ranked and before any copied fill or any return of this
rule was computed. Frozen by the commit that adds this file. Nothing below may change after that commit;
a deviation is reported as a deviation.

`copy_test.py` is the rule. `copy_inputs.py` only assembles the inputs the rule names. The test reads the
committed input and nothing else. It refuses to run if the wallets the puller fetched are not the wallets
the rule ranks.

## Why this is Polymarket's own

The daily Bitcoin ladder is the same series as VOL. VOL said a published volatility index does not beat
the book. This test asks a different question: whether the takers who already traded that ladder in May,
and who had closed it profitably before June, keep an edge a later taker can still reach. The later taker
pays the crypto fee and does not get the leader's price. No parameter below was chosen from a return.

## What was seen before the freeze (disclosed)

* fp4's verdicts and fp5's VOL result. Neither is an input.
* Endpoint shapes only: `GET /v1/leaderboard` returns `proxyWallet`; `GET /closed-positions` returns
  `realizedPnl`, `timestamp`, `eventSlug`; `GET /trades` honours `start` and `end` (a May market's page
  stayed inside the window). `/v2/trades` does not, and is not used.
* One May 1 ladder market had 1,511 taker prints in a two-day window, and the May 15 event was created
  seven days before it ended. Those are sizes, not a ranking. The May 16 "$70,000" market
  (`volumeNum` 151,552.184052) returned 141 prints for May; its page is the one named below.
* The market slug is `bitcoin-above-76k-on-may-1`. The event slug is `bitcoin-above-on-may-1`. The rule
  follows the event slug.
* No wallet's out-of-sample profit was read. No closed-position sum was computed.

## Excluded, because they were already looked at

The crypto month leaderboard on 2026-09-25 has no as-of date, so those 25 addresses are contaminated.
The 141-print page above: its first row's wallet had its trade count for 2026-06-01..06-08 read (the
count was 0) during an endpoint check, and the address was not kept. The same page was read again only
to name that first row, and nothing after May was requested for it. All 26 are out of the ranking and
out of the copied trades:

`0x111f73e91f85b6fe4de1ddec3de2fe32122e355b`, `0x1465b79bff7992bc703e1aafb3683b1089647072`,
`0x06dc51826bc524d9a83770e7de9dd7e005b04524`, `0x0cb038487586d1119b165466072e9baf666f3a90`,
`0x41e2e1ccf1e4940029af02259a31c6b89b9fa354`, `0x32ed2e546b187ca15e2841edc82b22c713cf8ec3`,
`0xc2ad03f79ca3f3c17d8c7de2612ce0c89b7d40ed`, `0xb87532a1a04c654700aa8153b3a95675ac4f4b16`,
`0x3725d52f3c252e8374999cc8617292ea2608ad88`, `0x974da1d69a42f1db94b481a39621bfbafd41b050`,
`0xf53e7cc2894cba22dcdc40de936513a502ef16e3`, `0xe609d476ebecc64e55788b4595fc53c343a1d4d4`,
`0x20d2309cd92b797ae7ca175ed828ed8a27fbe29d`, `0xa19cbababc312f9df185e49d7004c249ed1ade6b`,
`0x4f1d5ae26fc31472966e951af3183308736d8de2`, `0x19c3b385be5667154fc69c87d8f7914be84087c1`,
`0x42d150e0171590b28332a61b3f4cfca0a34cdab6`, `0xce50c96b976203b53342a0a801067d2cdcfcf46e`,
`0x44832d0d2ec11187c1e77d786feb15f6a50254c6`, `0x074a3a0ffc6e1077a9d7fcbd774029e0cc6ef0e0`,
`0x091ccc435273c422260279c8a8277170b2dc182e`, `0xc387c2a40d389f17b723b6bba9b18b7dbd2de4f4`,
`0x21d0a97aac03917e752857a551bbe5103a00e8d7`, `0xc53375ff94e96100f2b30a4b5775db35218d69a9`,
`0xca79076e2d13b8930e0c3a4649c06c65449a4796`, `0x229ac650228719605849362bb1bd4271af78e62b`.

## Universe and ranking (everything here is before 2026-06-01)

Events in series 45, closed, `endDate` in [2026-05-01, 2026-06-01), event slug
`bitcoin-above-on-<month>-<day>` or `bitcoin-above-on-<month>-<day>-<year>`, one event per UTC day, the
lowest slug. Markets whose outcomes are not exactly `["Yes","No"]` are skipped.

A wallet's May count is its taker prints on those markets with `timestamp` in [2026-05-01, 2026-06-01)
and before that market's `endDate`. The pull window starts at the later of 2026-05-01 and eight days
before `endDate`. At least 5 prints.

Ranking uses `closed-positions` rows whose `eventSlug` matches the same pattern and whose `timestamp`
is strictly before 2026-06-01. At least 10 such rows. Score is the sum of `realizedPnl`. The top 5.
A tie takes the lower address. A wallet whose closed-position pages hit the cap (40 pages of 50) or
repeat a page is not ranked. A May market that hits its cap (60 pages of 500) is left out of the counts,
and if any May market is in that state the test cannot pass.

## What is copied

Those five wallets' taker BUYs on the same event-slug pattern, `timestamp` in [2026-06-01, 2026-09-11),
and strictly before that market's `endDate`. Sells are not copied.

The fill is the earliest other wallet's taker BUY of the same outcome, in `(t, t+300s]`, at a price
greater than or equal to the leader's price and at most 0.99, with notional at least $2. A smaller print
does not fill and does not block a later one inside the window. One tape print fills at most one copy
(the earlier leader buy, then the lower transaction hash). Size is `min($5, that print's notional)`.
Hold to `outcomePrices`. Fee `rate × p × (1−p)` per share, the market's `feeSchedule.rate` when it is
positive, otherwise 0.07. Tick is the market's, otherwise 0.01.

A leader whose own trade pages hit the cap (80 pages of 500) is listed as incomplete. A market tape that
hits its cap is incomplete. Either one means the test cannot pass, whatever the sign of the partial sum.

## Windows and the bar

Halves and calendar months are by the leader's timestamp, not the fill's. OOS1 is [2026-06-01, 2026-07-21).
OOS2 is [2026-07-21, 2026-09-11). The year-fraction uses 102 days, the length of that window.

The six conditions, all required, and the same shape as VOL:

1. Out-of-sample P&L positive, and both halves positive.
2. Above the 95th percentile of 10,000 draws (seed 20260925) of a Bernoulli at the fill price, index
   `floor(0.95 × 10000)`, fees left on.
3. The same shares one tick worse and fees doubled, book not re-walked, still positive.
4. At least 80 copied trades.
5. Out-of-sample P&L positive, no calendar month above 40 % of it, and the total without that month
   still positive.
6. Annualised on the peak capital tied up in the window, above 4 % a year. Capital is opened at the
   fill and released at the market's close.

There is no in-sample copy. Ranking on May and scoring May would be the same trades twice.

## Pin, before the historical run

`copy_test.py --self-check` must pass on the frozen file. The hand case is a leader buy at 0.40 filled
at 0.42 for $5, fee rate 0.07, payout 1: the shares are `5/0.42` and the P&L is those shares times
`0.58`, minus `0.07 × 0.42 × 0.58` times the shares. A print at 0.39, the leader's own print, a sell,
a $0.42 print, and a print 301 seconds later do not fill. One tape print does not fill two copies.
A print at 0.995 does not fill. The rank pin drops the excluded address, a nine-position history, a
row timestamped on the cut, and an incomplete pull, and breaks a tie toward the lower address.
