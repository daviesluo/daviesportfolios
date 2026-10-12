# LP-SPEED: was live-prep's loss a matter of speed? Reward changes, fills and staleness, second by second

Research only (2026-10-12, read 23:05–23:45 UTC). No live path, config, order or migration was touched; every database
read was a `select`; every Polymarket read was a keyless public GET. SQL, data, scripts and outputs are in
`docs/agents/backtests/lpspeed/` (`MANIFEST.json`). Code read at `787d878` (`pm_live.ts`, `pm_lp.ts` at Addendum 18's
bytes). Not blind. Nothing here is applied: Davies decides. A sibling study takes adverse selection by market type and
the rule's filters and sizing; this one takes timing and speed only.

Davies, 2026-10-12, verbatim:

> 我自己感觉是reward市场变得太快了 挂的单fill的也快，很多时候是不是刚挂没多久就没rewards了，就等着我们实际挂呢？所以之前纸面没测出来（纸面可以挂很久），加快检测reward的频率及时响应会不会更好些，也研究下，我们最快可以每秒跑一次

In English: my feeling is that the reward markets change too fast, and our orders fill fast too; isn't it often the case
that soon after we post, the reward is gone, and someone is just waiting for our real order? That is why paper did not
show it (paper can rest a long time). Would checking the rewards more often and reacting in time be better? Study it
too; we can run as fast as once a second.

Live-prep went live at 2026-10-09 01:33 UTC and tripped its −$75 total stop at 2026-10-12 07:30 UTC: fills −$129.35,
rewards paid $38.10, rebates $10.02. It stays close-only.

## The verdict, in plain words

**Partly right about the market, not right about the cure.**

- **Right: the reward programmes do change fast.** 55 of the 60 market-days from 10-10 to 10-12 were read out of the
  universe by the reward check at least once (rate under $10, minimum over 20, or ended), a median 190 minutes after the
  market was picked (6 within 10 minutes, 14 within the hour). Rates move in 2.7 % of all minute-to-minute reads, and the
  CLOB's own answer flips between the old and the new programme second by second for 45–81 s while a change goes through (section e).
- **Partly right: fills do come faster than chance right after a post.** In the same market and hour, an order's first
  second carries 3.4 times the fills a constant hazard gives (13 against 3.85), the first ten seconds 58 against 34. But
  that is about 24 extra fills of 370, and the fills that came within 2 s of a post lost $6.53 at +60 minutes, 4 % of the
  fills' $165.77.
- **Not right: the reward was gone and we kept resting.** Since the per-minute check (10-10 01:14 UTC) not one BUY filled
  in a minute the check read the market out. The check reads every ~60 s; across all 118 times it found a programme
  gone, exactly **one** fill (20 shares at 0.62) came between the last good read and the read that saw the change, and it
  came in a 119 s gap where a turn was missed. The detection lag cost about nothing (−$0.60 at +1 minute, +$1.20 at +60).
- **Not right: paper missed it because paper rests long.** On the 8,527 market-minutes where live-prep live and RW-C's
  paper quoted the same market, the paper's fills came at the same point of the minute (median 31 s against live's 29 s)
  and lost as much per share (−3.11 ¢ against −2.71 ¢ at +60 minutes). What differs is how much fills: live took 3,395
  shares there, paper 2,179 (1.56 times). That is a fill-volume question for the sibling study, not a timing one.
- **Not right: a faster loop would have saved the money.** 376 of the 413 fills (to 09:00 on 10-12), and $161.48 of the
  $165.77 lost at +60 minutes (97 %), came from a taker who swept several levels in one order (122 fills, −$96.48) or took
  our order at the touch with no print before it (254 fills, −$65.00). No loop, at any speed, reads a book change that
  happens in the same match. A loop that re-decides every 1–30 s on the tape's warnings would have avoided 3–32 fills
  worth **+$0.3 to +$2.0 a day**, against fills losing about $40 a day. Older decisions did not lose more than fresh
  ones (−2.54 ¢ a share for fills 0–15 s after the turn's read, −2.46 ¢ for 45–70 s): staleness is not what lost.

**Recommendation: no speed change.** Keep the one-minute turn and the one-minute reward check; do not build a 1 s loop,
a sub-minute pg_cron job or a Cloudflare Worker for this. The loss is adverse selection by takers who arrive in one
shot, which the sibling study's filters and sizing can address and speed cannot. The cheapest timing change that would
capture most of the little there is, a cancel-on-move sub-loop every 5 s inside the existing call, is written out below
as a proposal priced at +$0.3 to +$1.3 a day, and is not recommended now.

## The data, and how far it can see

- **Our side**: `pm_lp_orders` (mode live; the venue's `created_at` from each order's read-back, whole seconds),
  `pm_lp_fills` (`match_time`, whole seconds; the trade record with every maker order and its price),
  `pm_lp_minutes` (the turn's own book read and reward read each minute, Polymarket's scoring read of each side),
  `pm_lp_markets`. 413 fills to 2026-10-12 09:00 UTC (`data/fills.csv`, `sql/fills_export.sql`); the 23 after are
  close-only sells after the stop.
- **The market's side**: pm-rec's print tape (bucket `pm-rec`, `prints/<day>/<hh>.jsonl.gz`, 81 hours from 10-09 00:00 to
  10-12 08:00; 4,859 minute frames, every one `complete`), each taker print with its second. 398 of the 413 fills found
  their own taker print on it; the tape's stamp runs **3 s** behind `match_time` (median; p10 2 s, p90 3 s), and every
  print is taken back by 3 s (`scripts/tape.py`).
- **What it cannot see**: books between minutes. pm-rec reads its books at :01–:03, the turn at about :02, so both are
  one snapshot a minute. A book that moves with no print (quotes pulled or added) is invisible; section c counts what
  that could hide.
- **Timing inside a turn**: the turn reads the reward programme at about :00–:01, the books about :02, and posts at a
  median 7.2 s into the minute (p90 10.8 s, p99 15.1 s). Its whole call runs a median 9.1 s (p90 12.2, p99 19.1, max
  26.8; Supabase's logs, 1,419 calls to 10-12 07:30).

## a. Post to fill

| | p10 | p25 | median | p75 | p90 | ≤1 s | ≤5 s | ≤15 s | ≤60 s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| post (venue `created_at`) to fill, 413 fills | 6 s | 24 | 54 | 215 | 379 | 19 | 39 | 76 | 224 |
| the latest turn's decision to fill | 7 s | 14 | 30 | 44 | 53 | 0 | 26 | 109 | 399 |

Every turn re-reads the book and keeps a resting order only while the rule still wants its price, so what a fill meets is
the latest turn's decision, at most a minute old, not the post. Fills spread evenly over the minute: 59, 82, 65, 67, 77
and 63 in each ten seconds from :00.

**Against paper on the same minutes** (`sql/paper_vs_live.sql`; RW-C's paper fills on the data API's prints, a minute
grid like live-prep's):

| on 8,527 market-minutes, 18 markets | fills | shares | seconds into the minute p10 / p50 / p90 | in the first 5 s | markout +1 min | +60 min |
|---|---:|---:|---|---:|---:|---:|
| live-prep, live | 217 | 3,395 | 6 / 29 / 52 | 16 | −0.92 ¢ a share | −2.71 ¢ a share |
| RW-C, paper | 129 | 2,179 | 7 / 31 / 55 | 7 | −1.68 ¢ | −3.11 ¢ |

Paper's fills come when live's do and are as adverse. (Paper's `ts` is the data API's stamp, ~3 s late, which if
anything makes its fills look later; RW-C's quote sizes are its own, so shares compare volume, not a like-for-like
queue.) The paper's resting time is not what made it look better.

## b. Reward-programme changes and the check's lag

The check (Addendum 9) reads each quoted market's programme from the CLOB every turn. A change happened between two
consecutive reads; nothing dates it closer (pm-rec's listing reads every 15 minutes, Gamma lags the CLOB, section e).

| reason the check took a market out (10-10 01:14 → 10-12 23:12) | flips in→out | an order resting at the read before | gap between the reads, p50 / max | fills between the two reads | buys / sells in the next hour |
|---|---:|---:|---|---:|---:|
| rate under $10 | 93 | 23 | 60 s / 119 s | 1 | 0 / 6 |
| minimum over N = 20 | 12 | 5 | 60 s / 62 s | 0 | 0 / 2 |
| programme ended | 13 | 6 | 60 s / 1,080 s | 0 | 4 / 12 |
| all | 118 | 34 | 60 s / 1,080 s | 1 | 4 / 20 |

(The 1,080 s gap is one market, `0x3c82c098a4` on 10-12, that the check did not read from 05:01 to 05:19, with no fill
in between; the 4 buys after an "ended" read came after the
programme read back in.) The one fill between reads: 0x79a1501912, BUY YES 20 at 0.62 at 17:11:40 on 10-11, in a 119 s
gap with a turn missed; markout −$0.60 at +1 minute, −$0.80 at +5, +$1.20 at +60. **Dollar cost of the detection lag
over the whole live run: about $0, ±$1.**

**Fills with no reward attached** (`sql/fills_reward.sql`; markout at +60 minutes against the turn's mid):

| the fill's minute | fills | markout +60 min |
|---|---:|---:|
| check in, Polymarket read our side scoring | 191 (124 buys, 67 sells) | −$89.52 |
| check in, read not scoring | 26 (16 buys, 10 sells) | −$12.46 |
| check in, no scoring read | 31 | −$2.14 |
| check out (rate, minimum, ended, refilled): all sells of what was held, by design | 33 | −$16.85 |
| 10-09, before the check existed | 131 | −$46.02 |
| no minute row | 1 | +$1.20 |

After the check, the money was lost in markets whose reward was in force and which Polymarket said we were scoring in.

**How fast programmes go after we start quoting** (`sql/selection_to_out.sql`, 60 market-days 10-10 to 10-12): 55 were read
out at least once; median 190 minutes after selection (p25 42, p75 351); 6 within 10 minutes, 10 within 30, 14 within
60. Of the 116 consecutive-minute flips out, 3 came back in within 5 minutes, 16 within 15 and 54 within 60
(`sql/programme_churn.sql`).

## c. Stale quotes: what a faster loop could have dodged

For each fill, the warnings are the tape's prints in the market after the turn's decision and before the fill that show
the book moving toward the order ("tight": a level beyond the turn's touch traded; "loose": our side traded at the touch
or beyond). A loop that re-decides every k seconds, at a random phase, with L seconds from its read to the venue
carrying the cancel, dodges a fill with probability min(1, (fill − L − first warning) / k), and keeps that fill's
markout (`scripts/tape.py`, `results/tape.txt`).

| what the fill met | fills | shares | markout +5 min | +60 min |
|---|---:|---:|---:|---:|
| A. a print moved the book toward us more than 1 s first (a loop can see it) | 32 | 250 | −$4.55 | −$6.47 |
| B. one taker swept several levels, ours among them (no loop sees it first) | 122 | 2,236 | −$75.31 | −$96.48 |
| C. we sat behind the touch, the levels ahead went with no print, then one taker hit us (a book-reading loop's ceiling) | 5 | 95 | +$1.91 | +$2.18 |
| D. we sat at the touch and one taker took it, no print before (a loop helps only if the far side moved quietly) | 254 | 4,100 | −$38.93 | −$65.00 |
| all | 413 | 6,681 | −$116.89 | −$165.77 |

**The staleness test**: if fills were stale quotes being picked off, older decisions would lose more. They do not:

| the turn's decision was | 0–15 s old | 15–30 s | 30–45 s | 45–70 s |
|---|---:|---:|---:|---:|
| fills | 108 | 92 | 112 | 101 |
| markout +60 min, cents a share | −2.54 | −1.61 | −3.70 | −2.46 |

**The k-second loop, on the record** (3.29 days of fills; a positive figure is money kept):

| k | L | signal | fills dodged | markout kept at +5 min | at +60 min | a day |
|---:|---:|---|---:|---:|---:|---|
| 1 s | 1 s | tight | 6.0 | +$3.45 | +$4.05 | +$1.0 to +$1.2 |
| 1 s | 1 s | loose | 32.0 | +$4.55 | +$6.47 | +$1.4 to +$2.0 |
| 5 s | 1 s | tight | 5.2 | +$2.98 | +$0.99 | +$0.3 to +$0.9 |
| 5 s | 1 s | loose | 28.6 | +$4.33 | +$2.68 | +$0.8 to +$1.3 |
| 15 s | 1 s | tight | 3.3 | +$2.38 | +$1.31 | +$0.4 to +$0.7 |
| 15 s | 1 s | loose | 24.8 | +$3.78 | +$2.70 | +$0.8 to +$1.1 |
| 30 s | 1 s | tight | 2.6 | +$2.19 | +$1.45 | +$0.4 to +$0.7 |
| 30 s | 1 s | loose | 20.7 | +$3.36 | +$2.41 | +$0.7 to +$1.0 |
| 60 s (today) | — | — | 0 | $0 | $0 | $0 |

With L = 2 s (or a tape stamp a second later than the 3 s taken) the 1 s loop keeps much less at +60 minutes, +$0.23
tight and +$1.46 loose (`results/tape.txt`): the edge of 1 s over 5 s rests on leads of one to two seconds, which the
tape's whole-second stamps cannot resolve. At +1 minute every row keeps between −$0.12 and +$0.65: the dodged fills had
not yet lost when the next turn read the book. On buys alone (cancelling buys, leaving exits resting)
it is $0 to +$3.83 over the 3.29 days, about nothing at k ≥ 5 s. The loose signal also cancels orders that would never
have filled; that reward time is not charged here, so the table is an upper bound. The tape cannot see C and the quiet
part of D: C was profitable (dodging it would have cost $2.18), and D at its absolute ceiling is $65 over 3.3 days only if
every one of 254 touch hits followed a quiet move of the far side, which the flat staleness test argues against.

## d. Do fills cluster right after we post?

Each live order's time at risk, from `created_at` to its first fill, cancel or expiry, binned by age; the first fills by
the age they came at; the expected count holds each market-hour's own hazard fixed (`sql/fill_hazard.sql`, query 2; the
pooled query 1 confounds young orders with busy markets).

| order age | 0–1 s | 1–2 s | 2–5 s | 5–10 s | 10–20 s | 20–30 s | 30–60 s | 60–120 s | 120–300 s | 300–600 s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| first fills observed | 13 | 6 | 17 | 22 | 32 | 29 | 86 | 39 | 71 | 55 |
| expected (constant hazard in the market-hour) | 3.85 | 3.85 | 9.99 | 16.42 | 31.83 | 31.16 | 75.87 | 54.41 | 84.88 | 56.74 |
| ratio | **3.37** | 1.56 | 1.70 | 1.34 | 1.01 | 0.93 | 1.13 | 0.72 | 0.84 | 0.97 |

Buys alone: 9 against 1.89 in the first second (4.76), 5 against 1.88 in the next. So there IS something there in the
first two seconds: a taker who acts on a new order, or a post-only order that lands just as a taker arrives. It is
about 24 fills more than chance in 370, and by money it is small:

| post to fill | fills | markout +1 min | +60 min | per fill at +60 |
|---|---:|---:|---:|---:|
| 0–2 s | 17 | −$5.06 | −$6.53 | −$0.41 |
| 2–10 s | 39 | −$4.61 | +$0.35 | +$0.01 |
| 10–60 s | 164 | −$9.30 | −$35.52 | −$0.22 |
| 60 s and over | 191 | −$76.19 | −$123.62 | −$0.69 |

The orders that rested longest lost the most per fill, which is the opposite of "someone was waiting for our post".

## e. How fast the programme data changes, and how fast the endpoints show it

Ten markets (the four that flipped most in the record and six of 10-12's picks) polled every second for 20 minutes from
2026-10-12 23:20:10 UTC: the CLOB's per-market programme as any caller gets it and with a cache-busting query (the
origin), and every 5 s the sponsored listing and Gamma (`scripts/poll_programmes.py`, `results/speed_costs.txt`).

| read | what the check uses it for | cache | measured |
|---|---|---|---|
| CLOB `/rewards/markets/{id}` | rate, spread, minimum (the check's main read) | `public, max-age=5` | Cloudflare HIT on 9,424 of 11,360 reads (83 %); p50 0.28 s, p90 0.41 s |
| the same, cache-busted | — | MISS every time | p50 0.38 s, p90 0.48 s |
| CLOB `/rewards/markets/current?sponsored=true` | the sponsored rate | `public, max-age=10` | HIT on 136 of 228 |
| Gamma `/markets` (`clobRewards`) | not used by the check (Addendum 9) | `public, max-age=300` | HIT on 224 of 228; 3 changes seen in 20 minutes |

**A programme change is not an instant.** In the 20 minutes, 4 of the 10 markets changed programme: `0x0386c36c28` from
$3 a day at a minimum of 50 to $38 at 20 (back into the universe), `0x36597ead16` from $1 at 50 to $18 at 20 (back in),
`0x562e6601b4` from $26 to $29, `0x567b548b61` from $292 to $283. Each time, the origin answered the old and the new
programme by turns, second by second, for 45 to 81 seconds (23 to 31 flips) before it settled; the cached read first
showed the new one 5 to 31 s after the origin did, and flipped 3 to 9 times itself. Polymarket's own servers disagree
for about a minute.

So a 1 s check would glimpse a change up to about a minute before a once-a-minute read is sure to see it, and in that
minute would read the old programme again in about half its reads; below 5 s the cached read gives it nothing more. The
record's in-and-out flips (3 of 116 back within 5 minutes) fit this picture. And the money in that minute was one fill in
3.3 days (section b). Over the whole record the check read a rate change in 2.7 % of minute pairs (1,748 of 64,536), a
minimum change in 308 and a spread change in 94.

## 3. The speed options, priced

| option | effect on the live record | what binds first, with its number | cost and risk |
|---|---|---|---|
| reward check every 1 / 5 / 15 / 30 s (today 60 s) | ≈ $0 at every N: one fill in all 118 undetected windows (±$1) | the CLOB endpoint's own cache: `max-age=5`, a Cloudflare HIT on 83 % of reads, so below 5 s a faster check reads the same answer; then the data: a change is dated only to the minute and our reads already catch it inside it | 11 GETs a check (10 markets and the sponsored listing): at 1 s, 110 per 10 s against the CLOB's 9,000; but the origin's answer flips within seconds on some markets (section e), so a faster check churns markets in and out: each out cancels buys, each back-in reposts them |
| re-quote / cancel loop every 1 / 5 / 15 / 30 s | +$0.3 to +$2.0 a day (table c), under 4 % of the fills' markout loss | sub-minute pg_cron through pg_net: a job of its own queues behind the minute batch (pg_net 0.20 runs a batch until every call answers; the batch's calls run to 58 s, pmrec-meta p99 35 s), so a 1–30 s job is late by up to that; then the turn itself (p50 9.1 s, p99 19.1 s wall) cannot repeat each second, so it must be a light sub-loop inside the minute call | POSTs: at most +680 to +1,070 a day (print buckets, `results/speed_costs.txt`) on 5,163–6,058 a day today, inside the 12,000 governor; Polymarket's 9,000 per 10 s is far; reward: no age penalty seen (81.6 % of sides scoring at under 70 s against 79.6 % at 300 s and over, `sql/scoring_by_age.sql`), and an order is out of the book ~0.3–0.5 s per reprice against a once-a-minute random sample; Edge CPU (2 s a request) unmeasured for this path; a new code path on real money |
| Polymarket's market websocket through an always-on Cloudflare Worker | at most what a book-reading loop sees: the table's A (+$0.2 to +$6.5 over 3.3 days) plus the quiet part of D, which the record cannot measure; never B (−$96.48) | the venue's matching: a sweep or a touch hit lands in one match before any push; every cancel must still leave from eu-west-1 (the Ireland rule), one more hop | Workers Paid (~$5–6 a month) and a Durable Object kept open, a deployment that is Davies' call, a second always-on system on the live path |

## 4. Recommendation and proposal

**Change nothing in the cadence.** The record says the money went to one-shot takers (sweeps and touch hits, 97 % of the
markout loss), not to slow checks or stale quotes. The reward check at one minute already catches every programme
change within about a minute, and in 118 changes that left one fill exposed. Paper did not miss a timing effect: on the
same minutes its fills came at the same seconds and were as adverse. The fill-volume gap (live filled 1.56 times paper's
shares on the same minutes) and the per-market adverse selection belong to the sibling study.

**If Davies wants the one timing change that captures most of the small benefit anyway** (a proposal; nothing is built):

- What: after the turn's posts, inside the same `pmlp` call, re-read the books of the markets with an order resting every
  5 s until 45 s into the call, and cancel a resting order whose book traded beyond the turn's touch toward it (the
  "tight" signal); the next turn reprices as today. Cancels only: no post outside the turn, so the governor, the GTD
  three-minute rule and `PM_LIVE_SEND_UNTIL_MS` are untouched.
- Where: `supabase/functions/agents/pm_live.ts`, in `turn()` after the post loop and before "── 6. the minute's record"
  (line 2722 at `787d878`); the book read is `venue.bookBatch` (mid-pool's `bookReplies`, `pm_mid.ts` line 168), one POST
  for every token at once; the cancel is the turn's own `cancel` (line 2553), which reads the cancel back; the lease
  (`PM_LIVE_LEASE_MS` 55 s) is kept by `holdLease`. Its option is a new `PmLpOptions.requote = { everyS: 5, untilS: 45 }`
  set only by `PM_LP_INSTANCE` in `pm_lp.ts` (line 217), so mini-pool and mid-pool are unchanged.
- Worth: +$0.3 to +$1.3 a day on the record (5 s, tight to loose, +5 and +60 minute markouts); 3.3 days cannot tell that
  from zero. It needs an addendum, the hash chain and Davies' word, and a dry-run day to measure its CPU against the 2 s.
- Verdict: not recommended now. Spend the change on what B and D are (which markets and prices the one-shot takers
  hit), which is the sibling study's.

## What this could not check

- Books between minute snapshots: a quote pulled or added with no print is invisible, so the cancel-on-move figures are
  bounded by the tape's prints, and the quiet part of D is not measured (its ceiling is stated).
- The real moment a programme changed: only bracketed by two reads ~60 s apart; Polymarket keeps no history of a
  programme's edits that a keyless read can see.
- Polymarket's "required duration" for scoring: the youngest orders the scoring read meets are ~55 s old; nothing here
  says how a 5 s order scores.
- The CPU time of a live-prep turn (the logs give wall time only) and of the proposed sub-loop.
- Queue position: the tape says when a level traded, not whether our order was first in it.
- Fills after 09:00 on 10-12 (23 close-only sells) are outside the tape analysis; the hazard and staleness tables run
  to the stop (07:30) or to 09:00 as each says.
