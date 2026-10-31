# A deviation of TAKE (variant-2, `take50`) and of LIVE's take: a take only through more coin than the holding line, from 2026-10-31 04:00 UTC (TAKE-DEPTH)

This is recorded apart from the pre-registrations it concerns, which stay byte for byte as they were frozen. Where one froze
`supabase/functions/agents/quotes_live.ts`, its pin test reads the hashes named before it and the hash named here, under its own
heading, for the file as it is.

## On whose word, and why

On 2026-10-31, a test of the live executor's own take code (`quotes_live_take_rules.test.ts`) found what LIVE's `take_mode` would
do under the £1 holding line (`holdMin`, since 2026-10-29 22:00). A take IOC that filled only under the line (0.6 coins of a
132.64-coin IOC) left the rung counted as holding nothing. The next minute the rung sent its whole IOC again. On one opportunity
that made three IOCs, the rung carrying 1.2 coins over its pounds into one exit.

Davies was told the two ways to stop it, and that either one changes this pre-registration's rule:
- (A) size a repeat take to the rung's remainder;
- (B) take only when the read's depth through the limit passes the line.

At ~01:30 UTC he answered: "按照你推荐的来，确保效果最佳，你觉得需要改就改". LIVE's `take_mode` stays 'shadow' (not touched).

## The measurement that chose B alone

All read-only SQL, not blind.

### Variant-2's own takes

There are 14, from 2026-10-05 02:51 to 10-29 15:22, all filled. The least coin any read rested through its limit was 49.65
(about £37). None rested £1 or less. None filled under the line, and none repeated.

### LIVE's take shadow

All 47 `take_shadow` events (10-28 18:42 to 10-29 15:28) were at least 48.45 coins deep. None was £1 or less.

### The book recorder's USDT-GBP reads, 10-05 to 10-31

There were 22,947 reads with an input to price them. Fair was taken as the median of the prior 24 hourly USD closes over the
read's GBP/USD minute. On the hour checked it matched LIVE's recorded fair (10-22 07:00: 0.74424 against 0.74427). The rung states and the guards are not
applied, so a count is an upper bound on takes.

**How often a read was through a take limit:**

| | 0.1 % rung | 0.2 % rung | 0.3 % rung |
|---|---|---|---|
| bid rungs | 840 | 95 | 0 |
| ask rungs | 292 | 107 | 1 |

**How often £1 or less rested through the limit:** 132 times.
- 69 on the 0.1 % ask and 63 on the 0.2 % ask.
- All on 10-22 between 05:00 and 09:00 UTC: bids of 0.02 to 0.70 coins at 0.7466–0.7472.
- At 10-22 07:10 LIVE's 0.2 % and 0.3 % asks held positions, so neither the twin nor the shadow took them.

**Each of those 132, taken at the venue's rules, lost to fair.** A sell's pounds are floored to the penny and its 0.09 % fee is
raised to the penny, so it is at least £0.01.
- Average −£0.0158 on the 0.1 % rung and −£0.0148 on the 0.2 % rung.
- The best was −£0.0089, and none was above zero.
- Together −£2.02 if each were an IOC. That is an upper bound: under the old rule, repeats stop once a rung's partials pass the line.

### The four options priced on the same events

- **On every recorded take and shadow event, all four are identical.** No read was that thin, and no rung carrying coin took.
- **B** removes every sub-£1 take on the recorder's reads. Each of them lost money, so B gives up nothing that made money.
- **A** applies to none of the recorded events. Where it would apply (a rung already carrying c coins under the line when a take
  goes), it buys c fewer coins at a take's edge. That gives up at most about £1 × 0.3 %, a third of a penny, and removes no loss,
  since the carried coin leaves in the same exit as the rest.
- **Under B**, a take that fills under the line can arise only when the book thins between the read and the fill. Then the next
  minute's IOC again needs a read deeper than the line.

So the winner is **B alone**. A makes no difference anywhere on the record and is not free. A+B is B.

## What changed

**The rule.** From `TAKE_DEPTH_FROM` (2026-10-31 04:00 UTC) a take goes only when the read rests more coin through its limit
than the rung's holding line. The depth is the asks at or under a bid rung's limit, or the bids at or over an ask rung's limit
(`readDepthThrough`). The line is `holdLineBase` at fair, which is £1 of coin wherever `holdMin` is in force (LIVE, variant-2 and
every twin on LIVE's rules). `takeDeep` decides.

**What a shallow read does.**
- It is no take: the rung's paper entry rests on, and nothing is cancelled for it.
- The shadow records no `take_shadow` for it, so the shadow keeps recording what 'live' would send.
- An instance with no `holdMin` has a line of 0, so for it nothing changes.

**The code** (`supabase/functions/agents/quotes_live.ts`, the shared take path `takeTurn` and `shadowTake`):
- LIVE's instance and variant-2 (`take50`, its row's `holdMin` from 10-29 22:00) take it at the same minute.
- The USDC/GBP executor (`take_mode` off) would too.
- No twin row, migration or config changed. `quotes_twin.ts` and `revx_sim.ts` are untouched.
- Before the instant, every take is as it was.

**The pins** (`quotes_live_take_rules.test.ts`). They run LIVE's instance and variant-2's on a simulated account:
- From the instant, reads 0.6 deep take nothing and the first deeper read takes once, whole. The shadow records only the deep
  minutes.
- On 10-30, before the instant, the same reads sent an IOC a minute: three IOCs, a carry over the rung.
- With the two call sites reverted, the pins fail.

## Each pre-registration it touches

### `docs/agents/reviews/2026-10-03-take-prereg.md`

`take50` (variant-2) takes TAKE-DEPTH from 2026-10-31 04:00 UTC. Its window ends with trips opened by 11-02, or by 11-30 if it
waits for 15 take trips. A take trip that opens after the instant was decided under this rule, and the reading says so, with the
count before and after. None of its 14 takes so far would have been stopped. The bar is unchanged. It froze `quotes_live.ts` at
`425def7ed57f1b4e6157cadf7167e7d1711a06ec05fa552df25c35d2adf12e6b`. The file has changed since, each change recorded in its own
deviation. The file as it is now:

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | 2ec5455b525f8f5d5d9996e994e9b512154cc0abfe4890df14dd33e786b06270 |

### `docs/agents/reviews/2026-10-29-usdt-only-twins-prereg.md`

Its twins take no take, so their turns are unchanged. It froze the executor; the file as it is:

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | 2ec5455b525f8f5d5d9996e994e9b512154cc0abfe4890df14dd33e786b06270 |

### `docs/agents/reviews/2026-10-29-revx-usdc-nudge-twin-prereg.md`

Its twins are off since `0178`, and neither takes. It froze the executor; the file as it is:

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | 2ec5455b525f8f5d5d9996e994e9b512154cc0abfe4890df14dd33e786b06270 |

### `docs/agents/reviews/2026-10-29-revx-exit-tick-twin-prereg.md`

It was closed early and its twins are off. It froze the executor; the file as it is:

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | 2ec5455b525f8f5d5d9996e994e9b512154cc0abfe4890df14dd33e786b06270 |

### `docs/agents/reviews/2026-10-29-rx-usdc-live-prereg.md`

`rxu120` takes no take, and its executor's `take_mode` is off. It froze the executor; the file as it is:

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_live.ts` | 2ec5455b525f8f5d5d9996e994e9b512154cc0abfe4890df14dd33e786b06270 |

For the record: the executor was `b6bdbd8cc1947b0949923322988290b6928f679798f7042c100b1776ffbcc3a1` before this change.
