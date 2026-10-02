# Polymarket's live calibration: what liquidity rewards really pay (2026-10-01)

## On whose word

Davies, 2026-10-01, verbatim:

> 选市场速度的问题也直接优化下吧，并且确保Polymarket可以上线测试（我准备把kraken的钱转到polymarket里去，密钥没有泄露，这些钱对我来说没多少，可以用来测试真实reward情况），你确定一下上线的具体是哪个Reward quotes策略并解释原因，并确保这个策略所有设置最优，准备上线

In English: make the market selection fast; make sure Polymarket can go live for a test (he will move his Kraken money
to Polymarket; the key was not leaked; the money is small to him and is for testing what the rewards really pay);
decide which Reward quotes strategy goes live and explain why; make every setting of it optimal; prepare to go live.

He agreed the plan the same afternoon (~15:25 UTC), verbatim: "同意你polymarket的方案". On the funding he said first,
verbatim, "没有400刀那么多闲钱，我觉得既然300刀上限的话我转300就可以了吧？而且转成usdc后还有些碎钱" (he does not have $400 spare;
with a $300 ceiling he will move $300, and once it is USDC there is some loose change besides), and then, ~17:00 UTC,
verbatim, "polymarket的策略我决定还是听你的转400美元进去追求最优效果" (he has decided after all to follow the advice and put in
$400, for the best result). **The $400 stands**, the pre-study's own figure ("Fund about $400"), and the caps below are
sized for it. The stops do not move: the extra money buys breadth, not risk.

This is the pre-study's Option 2 ("a live calibration during RW-C on markets under $10 a day",
`2026-10-01-polymarket-live-prestudy.md`), which the pre-study did not recommend, taken on his word. It is a recorded
deviation of RW-NEXT's ordering, as Option 1 was, and of nothing frozen: no file of RW, RW-E, the variants or RW-C
changes, none of their tables is read, and none of their markets is quoted.

**Status:** built and in dry-run. `PM_ORDER_SENDS_ENABLED` is true and the action loads the signing key; migration
`0076` keeps the config row at `dry_run = true`, `live_confirmed_at = null`. Going live is one statement, after the
funding below, in the conversation where Davies says go; it also sets the total cap from the balance that arrived.

## The strategy, and why this one

**What it quotes.** RW's quoting rule as RW-E applies it, through RW's own exported functions (`summarize`, `quote`,
`sizeN`, `RW_INV_CAP` in `agents/pmrw.ts`; `excludedByDay` in `agents/pmrw_e.ts`; neither file changed): each minute
a bid as a BUY of YES at RW's b and an ask as a BUY of NO at 1 − RW's a, N = max(the reward minimum, 5) shares each,
a side stopped once the inventory is 3N its way; post-only GTD orders, replaced only when the rule's price or size
changes or the order nears its expiry. RW-E's rule: no market is quoted on the UTC day its scheduled end falls in; the
order path's own 48-hour horizon (0074's) passes over a market that ends, or whose game starts, within two days of the
selection. **Where:** rewarded markets with a total daily rate of at least $6 and under $10, a spread to score in,
N ≤ 20, accepting orders with two tokens, a two-sided book, and a first-round formula reward of at least $2.50 a day;
ranked each UTC day by RW's own first-round reward per dollar (`firstScore`, `choose`), at most `max_markets` of them
within `select_budget_usd`. **What it answers:** R = Σ actual rewards / Σ formula rewards, over the market-days it
quoted live (`pm_live_reward_days`), where the formula is RW's reward line computed every minute on the quotes as they
rested, against the book without them (`pm_live_minutes`).

**Why a calibration, and why now.** The one thing paper cannot show is whether Polymarket pays what the paper formula
says. RW's six paper days broke even at R ≈ 0.40 (fills as RW's paper filled them) and need R ≈ 0.58 at the stress
spec's fills (the pre-study, from RW's aggregates and spec). Fills, adverse selection and the rule's economics are what
RW and RW-C measure on paper; R is what only an account that quotes can read. Davies wants that number with real money
he can spare, before RW-C's verdict rather than after.

**Why not RW's universe.** RW (to 10-09) and RW-C (10-09 → 10-23) are frozen paper tests whose engines read each
quoted market's public book every minute and fill from its public prints. Our orders in a market of theirs would sit
in the books they quote against and our fills would be prints they count: the frozen tests would be measuring a
market we are in. A rate of $10 or more is RW's universe, so this path never quotes one: the listing's rate decides
(`inUniverse`), the selection scores nothing at $10 or over, and the table's CHECK refuses one (`pm_live_markets`,
`pm_live_minutes`). RW-C selects from the same universe by the same rule, so the same bound keeps us out of it.

**Why RW's rule, and not a variant.** RW-NEXT Part 1 fixes the candidate mechanically on or after 10-09 00:05 UTC from
the five arms' verdicts. To pick RW-E, x1, x2 or x3 now on its merits would mean reading their running results, which
breaks no-peek; this design read no `pm_rw*` or `pm_rwc*` table and no RW market-level figure of 09-28 or later. R is a
property of what the venue pays for a quote resting where RW rests, and every arm rests where RW rests: the variants
differ in which minutes and markets they quote, not in where a quote sits.

**Why as RW-E applies it.** RW-E's same-day exclusion rests on evidence from before its freeze: split by how far each
market's scheduled end was from the day it was chosen, RW's run to 2026-09-26 16:16 UTC put its whole stress loss in
the markets that end that day (15 markets: rewards $147.84, fills −$128.53, stress −$77.61; every other market +$60.86
of stress), and RW-E was pre-registered on that the same day (`2026-09-26-polymarket-rw-end-prereg.md`). Using it
reads nothing written after. The order path's 48-hour horizon, from 0074's own evidence (the China Open match that
closed three hours after it was chosen), holds RW-E's rule many times over; it is kept, by RW-E's own function, so the
rule is RW-E's whatever becomes of the horizon.

**What it is not.** Not a test of RW's profitability, not a verdict on any arm, and not RW-NEXT's live test of the
candidate, which keeps its own order and pre-registration after RW-C.

**An assumption it carries.** R is read on pools of $6–$10 a day and is to be applied to RW's pools of $10 and more.
The formula is the same at any rate; a difference would come from how Polymarket applies it (the size cutoff per
level, the one-sided divisor, the scoring duration), which does not depend on the pool's size. The readout keeps R per
market, so a dependence on the rate can be looked for.

## Each setting, and why

| Setting | Value | Why |
|---|---|---|
| Universe floor | total daily rate ≥ $6 (`PM_LIVE_REWARD_FLOOR`) | The scan of 2026-10-01 15:27 UTC (every book from $5 to $10, 4,466 of them): RW's top eight by first-round reward per dollar all have rates of $6–$9, and `choose($120, 6)` takes the same six markets with a $5 floor as with a $6 one. A $6 floor reads 750 books instead of 4,466. |
| Universe ceiling | rate < $10 (`PM_LIVE_REWARD_RATE_MAX`) | RW's universe is $10 and over. |
| N ≤ 20 | `PM_LIVE_MAX_N` | RW's 3N inventory rule at N = 20 commits at most $60 a market, the per-market ceiling: the cap is a backstop, never the rule. 2,375 of the 2,746 scorable markets from $5 to $10 had N ≤ 20. |
| Formula floor | ≥ $2.50 a day (`PM_LIVE_MIN_FORMULA_DAY_USD`) | Polymarket pays nothing under $1 ("The minimum reward payout is $1; amounts below this will not be paid"); at R ≈ 0.40, $2.50 of formula is that dollar. The docs do not say whether the minimum is per market or per address; this clears it either way. 86 of the 448 scorable markets from $6 to $10 cleared it on the scan. |
| Horizon | nothing ending or starting within 48 h (`PM_LIVE_MIN_HORIZON_MS`) | 0074's: a market that resolves while selected leaves no book. |
| RW-E's rule | no market on the UTC day it ends | Above. |
| Ranking | RW's `firstScore` and `choose` on the book without our own orders | RW's own selection, on this universe. Our orders still resting from the day before are taken out of the books it scores, or a market we quoted would rank against itself. |
| Markets and budget | phase 1: `max_markets` 2, `select_budget_usd` $40; phase 2: **8 and $160** | The pre-study's phases: two markets for the plumbing and the first midnight payout, then the most markets that leave half the total cap for inventory, as the $300 plan's six did ($110.72 of $220). On the scan, with RW's own `choose`: two markets need $36.60 of first-quote capital for $16.00 a day of formula; eight need $147.12 for $53.42, leaving $172.88 of $320 (54 %); nine would leave 48 %, ten 42 %. |
| Total cap | $320 (`cap_total_usd`; code ceiling $320) | The balance that arrived less the total stop less a margin: about $400 − $75 − $5. Buys' collateral plus what is held at cost never pass it, so at the worst point the account still holds the cap and $5 more: the strategy's limits bind before the balance does. Set by the go-time statement from the balance the path read; the only clamp is $320, the cap the $400 he named gives, so loose change above $400 adds margin, not commitment (a $400 ceiling instead would let a larger balance commit more without a decision of his). 0074's ceiling was $300. |
| Market cap | $60 (`cap_market_usd`; ceiling $60) | 3N at N ≤ 20, one side at $1 a share at most, plus the other side's bid. With eight markets the worst case is $480 against a $320 cap, so the total cap binds first. |
| Stops | −$25 a day, −$75 in all (ceilings) | Kept, as agreed: they are set from the strategy's flows, not the deposit. Phase 2's formula is about $53 a day on the scan, and RW's paper fills gave back about 40 % of rewards (about −$21 a day); −$25 is a day past that, −$75 the most the test may lose (under a fifth of the deposit). Lower stops would end the test on an ordinary day; the code allows no higher. |
| GTD lifetime | 600 s (`gtd_lifetime_s`, the most the path allows) | An order scores only once it "has been live for the required duration" (undocumented); a replacement starts that clock again. At 600 s an order unchanged by the rule is replaced every ~8.5 minutes instead of every ~3.5. The cost: if the loop stops, an order rests up to 10 minutes unmanaged, within the caps. |
| POSTs a day | 6,000 (`max_posts_day`) | Twelve slots replaced every ~8.5 minutes is about 2,000 a day, with room for re-pricing. |
| A refused quote | sent again only on new information (`refusalWait`) | PR5's live verification (2026-10-01) found its refused post-only exits re-sent every turn: 872 of 1,150 exit POSTs in a calm market. Here the same quote is not sent again until the rule's price or size changes, or, refused as crossing the book, until the level it faced moves. |
| Self-cross | an order that would take our own resting order is withheld | The venue's post-only check includes our orders; one still resting because its cancel was not confirmed must not be met by its replacement. |
| A cancel | read back, then read again after 300 and 700 ms while the venue still shows it resting (`PM_LIVE_CANCEL_REREAD_MS`); never replaced before the venue shows it gone; a fault only from the turn after it was first asked | PR5's first live hour (Revolut X, 2026-10-01) found a cancel answered at once and carried out a moment later: the read-back straight after the DELETE still showed 3 of 11 re-priced orders resting at 16:37:29 UTC and 7 of 11 at 16:41:29, each cancelled on the next turn, and each such freeze was reported as a fault (reference §4 item 35). Polymarket's docs give a cancel's reply as its outcome ("it identifies the orders that were canceled", `trading/manage-orders`), which suggests the CLOB carries a cancel out before it answers, but they say nothing of when `GET /data/order/{id}` shows it, so the path is built for the venue measured. The global pause's cancel-all is read back the same way, each order marked with the time it was first asked. |
| Collateral | no buy past the pUSD the resting buys leave | Read every live minute (`/balance-allowance?asset_type=COLLATERAL`); an unread balance sends no new buy and cancels nothing funded; settled tokens not yet redeemed count as capital. |

## The selection, made fast

The reward listing (`GET /rewards/markets/current`, 500 rows a page) was read page after page by the venue's cursors:
30.6 s and 36.6 s from eu-west-1 on 2026-10-01's two selections, inside a 40 s deadline. Its cursor is base64 of a
row offset ("MA==" is 0, "NTAw" 500, "LTE=" −1, the end), its pages are in condition-id order, any offset can be read
directly, a bad cursor answers 400 and an offset past the end answers `{"data":[],"next_cursor":"LTE=","limit":500,
"count":0}`. So `rewardListing` reads page 0, and if its cursor is the offset it expects, reads the rest eight at a time
at offsets 480 apart: each page overlaps the one before by 20 rows, and the read is complete only when every page
begins inside the one before (no row fell between), every page before the last is full and its cursor is the next
offset, and the last is short or says END. The listing moves while it is read (below), so a read that fails the proof
is made again once, page 0 included; a listing whose cursor or order is not what was measured is read page after page.

Measured from this repository's container (Cloudflare's Atlanta edge), keyless, 2026-10-01, 39 native pages:

| Read | Wall time | Boundaries off where expected |
|---|---|---|
| one after another, by the venue's cursors | 52.9 s | — |
| one at a time, overlapping | 39.7 s | 18 of 38 |
| six at a time, overlapping | 9.9, 9.3, 9.2 s | 3–8 of 38, by up to 4 rows |
| ten at a time, overlapping | 5.4, 5.1 s | up to 16 of 38, by up to 4 rows |
| thirteen at a time, overlapping | 4.1 s | — |

A page took about 1.2 s (median) whatever the concurrency. Eight at a time sits between six and ten; Cloudflare allows
the CLOB 9,000 requests in 10 s. Gamma is then asked fifty condition ids a read, six reads at once, and each eligible
market's book is read twelve at a time.

**The whole selection, measured through the path's own code** (`selectMarkets` against the live venue, keyless, the
turn's 40 s deadline, six markets and $120; six runs from this container, 2026-10-01 16:50–16:54 UTC, the last three
in `backtests/pmlive/results/selection_time_out.txt`): **13.1–14.1 s**, the listing alone 7.2–7.3 s. Each run read
44–48 listing pages (both listings, and the pages idle readers had started past the end), found 19,061–19,064 rewarded
markets and 559–564 in the universe, asked Gamma 12 times, read 482–487 books (7 one-sided, none gone), scored 94–104
at $2.50 a day or more, and took six, all neg-risk at N = 20 and rates of $7–$9: $105.36–$107.16 of first-quote
capital for $44.77–$48.29 a day of formula. The two sequential selections from eu-west-1 earlier that day took
30.6 s and 36.6 s for the listing alone, and this container read it in 36 s that way, so eu-west-1 should land near
these figures; each selection records its own `ms`.

## The reward readout

Every endpoint was read 2026-10-01 from docs.polymarket.com's API reference and the CLOB OpenAPI (sha256
`d993169c…edb8`), and checked against both official clients (`@polymarket/clob-client-v2` at `8046a89e`,
`py-clob-client-v2`). Each L2 one answered `401 {"error":"Unauthorized/Invalid api key"}` to a keyless GET from this
container at 16:41 UTC, so none is public.

| What | Request | Auth | Notes |
|---|---|---|---|
| Earnings per market, a day | `GET /rewards/user?date=&signature_type=&next_cursor=` | L2 | Paged from `MA==` as the clients page it. `sponsored=true` returns sponsored-only earnings; without it, native. `earnings` in the asset, `asset_rate` to USD |
| The day's total | `GET /rewards/user/total?date=&signature_type=&sponsored=true` | L2 | `sponsored=true` "aggregates both native and sponsored earnings" |
| Live share of each pool | `GET /rewards/user/percentages?signature_type=` | L2 | Read once a live minute |
| Is one order scoring | `GET /order-scoring?order_id=` | L2 | "Scoring" includes "the order has been live for the required duration". The clients also POST `/orders-scoring` with many ids; the path reads one at a time |
| Maker rebates, a day | `GET /rebates/current?date=&maker_address=` | none | Answered `null` for an address with none (keyless, 16:41 UTC); neither client wraps it |
| pUSD | `GET /balance-allowance?asset_type=COLLATERAL&signature_type=` | L2 | `balance` in base units (6 decimals) |

Polymarket pays "daily at midnight UTC"; an epoch is a UTC day, "the order book is sampled once per minute at a random
offset" (up to 1,440 samples), and "The minimum reward payout is $1". So once a UTC day after 01:00 the path reads the
two days before (each day twice, the second a day later, for a late posting; never twice on one UTC day) and writes,
per mode, day and market (`pm_live_reward_days`): the minutes it had a quote, the minutes both sides scored by RW's
formula, the minutes the venue called both sides scoring, the formula's sums (all, and over the venue-scored minutes),
the rate, and, live only, what was paid: native, sponsored and rebates. A market paid but never quoted is a live row
with no minutes. R is a query:

    select sum(coalesce(actual_usd, 0) + coalesce(actual_sponsored_usd, 0)) / nullif(sum(formula_usd), 0) as r,
           sum(formula_usd) as formula, count(*) as market_days
      from public.pm_live_reward_days where mode = 'live';

Two more readings come free: R over the venue-scored minutes only (`formula_scored_usd`), which separates "not paid"
from "not scoring"; and per market, for a dependence on the rate.

## Capital, power and what $400 buys

- **Funding:** about $400 of USDC, two transfers ($5, then the rest), each about 1 USDC of Kraken's withdrawal fee.
- **Caps:** $320 in all, $60 a market; the stops −$25 a day and −$75 in all. The go-time statement sets the cap from the
  balance the path read (`least(320, floor(balance − loss_total_usd − 5))`: a balance of $398.20 gives $318, $401.37
  gives $320), and fails, leaving the dry-run, on a balance unread, older than five minutes or under $81.
- **Every market meets its own reward minimum:** an order's size is N = max(the market's `rewards_min_size`, 5), and the
  universe takes only N ≤ 20. Every pick on the scan and in the live selections was N = 20 at a minimum of 20.
- **The total cap binds before collateral:** at the total stop the account has lost $75 and holds at most the cap in
  buys and inventory, so the balance covers it with $5 to spare; and the path reads pUSD every minute and sends no buy
  the balance less the resting buys cannot cover. With eight markets the per-market caps could sum to $480, so the
  total cap, not the balance, is what binds.
- **Phase 2 on the scan** (RW's own `choose`, the selection's filters; 67 markets qualify at a minimum of $2.50 a day;
  the 48-hour horizon and RW-E's rule not applied, which the scan did not read):

  | Markets, budget | Capital | Formula a day | Each market | Left of $320 for inventory |
  |---|---:|---:|---:|---:|
  | 6, $120 (the $300 plan) | $110.72 | $41.87 | $18.20–$19.20 | $209.28 (65 %; $109.28 of $220, 50 %) |
  | **8, $160 (proposed)** | $147.12 | $53.42 | $17.40–$19.20 | $172.88 (54 %) |
  | 9, $175 | $166.32 | $58.70 | $17.40–$19.20 | $153.68 (48 %) |
  | 10, $190 | $184.32 | $63.54 | $17.40–$19.20 | $135.68 (42 %) |
  | 12, $240 | $221.46 | $73.01 | $17.40–$19.20 | $98.54 (31 %) |

  Through the path's own selection, live and keyless at 17:05 UTC with eight markets and $160: eight taken, $147.12
  of first-quote capital for $47.43 a day of formula, each $17.20–$19.40, all neg-risk at N = 20 for a minimum of 20.
  Eight is proposed because it is the most markets that keep at least the $300 plan's share of the cap (half) free for
  inventory: a buy the total cap would pass is withheld, and a market quoting one side earns nothing, so a cap that
  binds often costs formula minutes. If the first days hold far less inventory than that, nine ($175) is the next step.
- **Market-days and power** (the pre-study's own simulation, `ratio_power.py`, unchanged; its noise an assumption):

  | Plan | Market-days in 14 days | P(lower bound > 0.6 \| R = 1) | P(upper bound < 0.6 \| R = 0.3) | 90 % half-width at R = 1 |
  |---|---:|---:|---:|---:|
  | $300: 2 × 2 + 6 × 12 | 76 | 0.81–1.00 | 0.93–1.00 | 0.088–0.278 |
  | **$400: 2 × 2 + 8 × 12** | **100** | **0.90–1.00** | **0.94–1.00** | **0.078–0.251** |
  | $400 with nine | 112 | 0.92–1.00 | 0.95–1.00 | 0.074–0.238 |

  Each range runs over the simulation's three noise scenarios; the noisiest gives the lower power and the wider
  interval. Reward observations a day go from six to eight in phase 2.
- **Expected scale (inference):** phase 2's eight markets had $53.42 a day of first-round formula on the scan. At
  R ≈ 0.4–1 that is about $21–$53 a day of rewards, against fills that on RW's paper gave back about 40 % of the
  formula.

## What was built

| File | What changed |
|---|---|
| `supabase/functions/agents/pm_live.ts` | RW's rule (`rwQuotes`) behind the `PmQuoteRule` interface, with our own orders taken out of the book (a market has one book: NO's is YES's mirror, verified keylessly on ten markets); the selection on RW's ranking; the listing read concurrently and proved complete; each minute's formula (`minuteFormula`); the daily readout; settlement of a market that resolves while held; the collateral guard; the geoblock's ten-minute memory, reported once when it goes stale; a market's own condition (gone, one-sided) recorded once as state, never as a fault; the refusal wait and the self-cross guard; a cancel read again before its slot freezes, a fault only from the turn after it was first asked. |
| `supabase/functions/_shared/polymarket_orders.ts` | `PM_ORDER_SENDS_ENABLED = true`; `loadPmLiveEnv` reads the key into a `PmOrderKey`, scrubs every spelling of it first, and keeps it only when it controls `POLYMARKET_SIGNER_ADDRESS`; the reward reads added to the route list; a caller's `sendsEnabled: false` lowers the switch and nothing raises it. |
| `supabase/functions/agents/index.ts` | The action passes the key and, when there is none, why. |
| `supabase/functions/agents/db.ts` | The paging keys of the minutes and the settlements. |
| `supabase/migrations/0076_pm_live_calibration.sql` | The config's market count and budget and the live test's caps, dry-run and unarmed; the day's markets keyed by market with RW's first-round reading; `pm_live_minutes`, `pm_live_reward_days`, `pm_live_settlements`; two event kinds. No cron function: the one-minute job and `public.edge_calls` (0075) are unchanged. |
| `supabase/functions/agents/testing.ts` | The doubles: 0076's tables and checks in `memDb`; `FakePolymarket` with RW's reward programme per market, a listing that pages and moves as the CLOB's does, our own orders in its book and in its post-only check, Gamma by condition id with resolutions, the reward reads, pUSD and resolved markets; a cancel (one order or all) carried out a read after its reply (`cancelLagReads`, 1 by default), or a second later. |
| `supabase/functions/agents/pm_live.test.ts` | 69 tests (below). |
| `supabase/functions/agents/polymarket_orders.test.ts` | 21 tests: the pins that assumed the switch off now pin the locks that remain. |

**The one-minute job and the watchdog (0075).** pmlive's row of `public.edge_calls` stays `retry = true`: a second
run in the same minute changes nothing a first did. The lease keeps two runs apart; a day is selected once (its markets
upserted on (day, cond), no selection while the day has any or within five minutes of a try); one open order per
market, token and side (0074's index): an order resting as the rule wants is left alone, one whose POST has not
settled stays pending and holds its slot, and a refused quote waits for new information; the minute's formula is
upserted on (mode, minute, cond); the readout is ten minutes apart and upserted on (mode, day, cond); events on (mode,
minute, kind); a settlement on its market.

## The locks that remain

With the switch on, five things keep an order home, each enough alone, each pinned with a counterfactual:
`pm_live_config.dry_run` on; `live_confirmed_at` null (nothing that opens; sells of what is held stay armed); no key,
or a key that is not the stored signer's (the loader keeps none, the executor checks again); a runtime that is not
eu-west-1 (the wire refuses every POST; the region gate closes opening and reducing); and every gate of 0074 (the
global pause, the geoblock's country, the closed-only flag, the Ireland attestation, the inventory read, the loss
stops). Through the real client, a full simulated day as deployed (dry-run on, unarmed, the key loaded) sends nothing
but GETs.

## Tests and counterfactuals

`pm_live.test.ts` 69 tests and `polymarket_orders.test.ts` 21, all 90 passing on Deno 1.46.3 with type checks. RW's
rule is pinned against RW's own `stepRw` on every recorded book of RW's golden day (`rw_golden.json`) at five
inventories, and the minute's formula against `stepRw`'s reward line; the selection against RW's own `firstScore` and
`choose` over 300 random worlds, every pick under $10 in both listings. 0074, the watchdog's 0075 and 0076 applied in
order to PGlite 0.5.8 (PostgreSQL 18.3), 0076 twice: the dry-run's 0074 rows keep under the new key, the seed is as
above (`cap_total_usd` 320, its column default 320 too), every 0076 constraint tried is refused by Postgres under the
name the double gives (a total cap of 321 among them), the go-time statement does what it says on six balances (unread,
older than five minutes and $60 refused, the path left in dry-run; $401.37 → $320, $398.20 → $318, $300 → $220, armed),
the kill and phase-2 statements run as written, and the cron jobs and `edge_calls` are unchanged by 0076.

Each rule below was removed alone from the source and both test files run (`--no-check`); the source was restored and
its sha256 checked after each. The whole set was run again on the cancel round's final source (`pm_live.ts`
`5f5388c4…7403`, `testing.ts` `21ca0156…66fe`, `polymarket_orders.ts` `13f08f9b…2105`): every earlier removal fails
every pin it failed on the source before (`a57fee42…1038`; one pin renamed), and four broad ones also fail the new
cancel pins. 49 of the 50 removals fail at least one pin:

| Removed alone | Pins failing | Which |
|---|---:|---|
| listing: the overlap proof (a page must begin inside the one before) | 1 | “the listing is read whole and proved so” |
| listing: the retry re-reads page 0 | 1 | “the listing is read whole and proved so” |
| listing: a read that fails the proof is made again once | 1 | “the listing is read whole and proved so” |
| listing: its end (a short page or END) | 45 | “the listing is read whole and proved so”; “every filter of the universe is load-bearing”; and 43 more |
| listing: a cursor that is not an offset is read by its own cursors | 1 | “a listing whose cursor is not an offset, or whose pages are not in id order, is …” |
| universe: the $6 floor | 25 | “every filter of the universe is load-bearing”; “inUniverse and candidateOf”; and 23 more |
| universe: under $10 (outside RW's universe) | 45 | “every filter of the universe is load-bearing”; “inUniverse and candidateOf”; and 43 more |
| universe: N at most 20 | 25 | “every filter of the universe is load-bearing”; “inUniverse and candidateOf”; and 23 more |
| selection: a first-round formula of at least $2.50 a day | 25 | “every filter of the universe is load-bearing”; “selectMarkets is RW's ranking on this universe”; and 23 more |
| candidate: the 48-hour horizon | 36 | “every filter of the universe is load-bearing”; “candidateOf passes over a market whose game starts, or which ends, within two da…”; and 34 more |
| candidate: RW-E's same-day rule | 0 | **none** (below) |
| selection: RW's ranking (choose by first-round reward per dollar) | 25 | “every filter of the universe is load-bearing”; “selectMarkets is RW's ranking on this universe”; and 23 more |
| selection: at most max_markets | 3 | “every filter of the universe is load-bearing”; “selectMarkets is RW's firstScore and choose over the universe, exactly”; and 1 more |
| selection: our own resting orders out of the books it scores | 1 | “live: the next day's selection reads the books without our orders still resting …” |
| rule: our own orders out of the book | 9 | “our own orders are taken out of the book”; “post-only against the whole book”; and 7 more |
| rule: RW's inventory stop at 3N | 1 | “rwQuotes is RW's own quote” |
| rule: the size N = sizeN(reward minimum) | 2 | “rwQuotes is RW's own quote”; “minuteFormula is RW's reward line” |
| formula: our own orders out of the others' book | 2 | “our own orders are taken out of the book”; “live: our resting orders are in the venue's book, and RW's rule does not chase t…” |
| formula: an order under the reward minimum scores nothing | 1 | “our own orders are taken out of the book” |
| readout: the minutes both sides scored | 1 | “the readout: once a UTC day after 01:00, the two days before — what Polymarket p…” |
| readout: a day is read at most once a UTC day | 1 | “the readout: once a UTC day after 01:00, the two days before — what Polymarket p…” |
| geoblock: a good answer kept for ten minutes | 1 | “geoblock: a failed read is answered by the last good one for ten minutes, with n…” |
| geoblock: a stale answer reported once | 1 | “geoblock: a failed read is answered by the last good one for ten minutes, with n…” |
| conditions: a market that left the book is state, not a fault | 2 | “a market held from an earlier day is read and marked, never quoted; resolved, it…”; “a market that leaves the book” |
| conditions: a one-sided book is state, not a fault | 1 | “a market's own condition is state, not a fault” |
| conditions: recorded when they change only | 3 | “a market that leaves the book”; “a market's own condition is state, not a fault”; and 1 more |
| lock: pm_live_config.dry_run | 21 | “sends are enabled in code; the config is the lock”; “the locks that remain, each alone”; and 19 more |
| lock: live_confirmed_at (armed) | 3 | “sends are enabled in code; the config is the lock”; “the locks that remain, each alone”; and 1 more |
| lock: the executor's key must be the stored signer's | 1 | “the locks that remain, each alone” |
| collateral: no buy past the pUSD the resting buys leave | 1 | “collateral: live, no buy is sent that the account's pUSD cannot cover beside wha…” |
| collateral: a funded order kept as it is is not judged (an unread balance cancels nothing) | 1 | “collateral: live, no buy is sent that the account's pUSD cannot cover beside wha…” |
| settlement: a resolved market realised at its payout | 1 | “a market held from an earlier day is read and marked, never quoted; resolved, it…” |
| settlement: unredeemed tokens counted as capital | 1 | “a market held from an earlier day is read and marked, never quoted; resolved, it…” |
| settlement: only once Gamma gives a closed time | 1 | “a market held from an earlier day is read and marked, never quoted; resolved, it…” |
| refusal: a refused quote waits for new information | 2 | “a quote the venue refused as crossing is not sent every minute”; “an explicit refusal is rejected and the same quote is not sent again; a 425 rest…” |
| refusal: a crossing refusal goes again once the level it faced moves | 2 | “refusalWait: a refused quote waits for new information — the rule's price or siz…”; “a quote the venue refused as crossing is not sent every minute” |
| post-only: our own orders still in the book (no self-cross sent) | 1 | “post-only against the whole book” |
| limits: the selection's budget at most the total cap | 1 | “effectiveLimits: a config row may lower every cap and stop, and never raise one …” |
| limits: a row without max_markets selects nothing | 1 | “effectiveLimits: a config row may lower every cap and stop, and never raise one …” |
| before 0076 the turn does nothing | 1 | “before 0076 has run the turn does nothing” |
| wire: a POST only from eu-west-1 | 1 | “the wire's locks that remain” |
| wire: a caller's sendsEnabled false keeps every write home | 1 | “the wire's locks that remain” |
| loader: the key kept only when it is the stored signer's | 2 | “loadPmLiveEnv loads the signing key into a holder that never prints, only when i…”; “agents?action=pmlive: it loads the key only for the stored signer, records the r…” |
| loader: every spelling of the key scrubbed | 1 | “loadPmLiveEnv loads the signing key into a holder that never prints, only when i…” |
| the code's switch (PM_ORDER_SENDS_ENABLED back to false) | 4 | “sends are enabled in code; the config is the lock”; “the wire's locks that remain”; and 2 more |
| cancel: an order still resting on its read-back is read again (no re-read) | 8 | “a cancel the venue carries out a read after its reply (the double's default, as …”; “a cancel slower than the re-reads freezes its slot for a turn without a fault, t…”; and 6 more |
| cancel: a first-turn freeze is no fault (an error on it) | 2 | “a cancel slower than the re-reads freezes its slot for a turn without a fault, t…”; “cancel, then post: the replacement goes only after the cancel is READ BACK; a ca…” |
| cancel-all: a first-turn order still resting is no fault (an error on it) | 1 | “global pause, live: a cancel-all the venue carries out late is no fault on its f…” |
| the double: a cancel lands a read after its reply (a double that cancels at once) | 3 | “a cancel the venue carries out a read after its reply (the double's default, as …”; “cancel, then post: the replacement goes only after the cancel is READ BACK; a ca…”; and 1 more |
| routes: the day's total earnings read | 3 | “a GET goes out as a GET, follows no redirect, carries L2 headers only on the acc…”; “pmOrderCall reaches only its routes”; and 1 more |

The one that fails none is RW-E's same-day rule, and by construction: a market whose end falls before the end of
today's UTC day ends within 24 hours, so the 48-hour horizon has already passed it over, and no world can tell the two
apart while the horizon stands. It is kept as RW-E's own function so the rule is RW-E's whatever becomes of the
horizon; `rweSameDay` itself is pinned against `excludedByDay` (“candidateOf passes over a market whose game starts…”).
The first run found a second rule no pin held, the formula's size cutoff (a test's book was too thin for the cutoff to
matter); a pin with a book deep enough for the others to qualify was added, and the removal now fails it.

The cancel as it stood before PR5's race was fixed here, its three edits reversed at once (read once; every freeze a
fault on its first turn; the cancel-all's orders unmarked, each still resting a fault), fails 9 pins against the double
that carries a cancel out a read after its reply. A double that cancels at once fails 3: the pins meet the venue as
Revolut X was measured, not as Polymarket's wording suggests.

For the $400 plan, three more, run the same way: the dry-run's own balance read removed fails 6 pins (among them
“collateral: live, no buy is sent…”, which reads the dry-run's recorded balance, and “dry-run, the default…”); the
code's total ceiling back at $300 fails 2 (“effectiveLimits…”, “caps…”); the double's CHECK back at 300 fails 1
(“0074's and 0076's constraints hold in the double…”).

## Go-live checklist

**Before any money moves**

1. 0076 applied (by the migrations workflow on merge) and the dry-run watched for at least a day from eu-west-1:
   `state.sbRegion` is `eu-west-1`, the day's markets are chosen in seconds (`detail.note.ms` in `pm_live_markets`),
   `pm_live_minutes` fills every minute, and `ops_errors` holds nothing of `agents.pm_live` but what is explained. On
   the day 0076 lands, that day's two markets are still 0074's picks, which carry no reward programme (`max_spread`
   null): the rule quotes nothing in them and withdraws the placeholder's dry-run orders, and the first selection by
   RW's ranking is made at the next 00:00 UTC.
2. The probe from Ireland, `GET agents?action=probe&only=polymarket&forceFunctionRegion=eu-west-1` (operator): the key's
   address equals the stored signer, the account is not closed-only, the geoblock's country is IE, and the profile names
   the stored funder as its proxy wallet.
3. Recommended by the pre-study, his call: revoke the two pUSD spenders the order book does not use (the retired v1 Neg
   Risk Adapter and Combos Exchange v3) and their Conditional Tokens approvals; keep the two exchanges. Davies says the
   key was not leaked (2026-10-01); an unlimited allowance nobody uses is still a door left open.

**Funding (his)**

4. On polymarket.com → Deposit, copy the account's EVM deposit address (not the proxy wallet itself). On Kraken, withdraw
   **$5** of USDC on the **Polygon** network to it (Kraken's fee about 1 USDC, minimum 2; the address confirmed by email
   first). Polymarket's deposit converts it to pUSD (the bridge quoted about 0.02 % on native USDC).
5. Read it arrived: the dry-run reads the same balance every minute (`select state->>'pusd', state->>'at' from
   public.pm_live_state;`, in dollars), and the probe's collateral read (step 2's call) shows it in base units.
6. Then the rest (about $395). Read the balance again.
7. The total cap needs no statement of its own: the go-time statement below sets it from that balance. Before it, read
   that the signing key is loaded for the stored signer: `select state->'keyed', state->>'signerProblem' from
   public.pm_live_state;` must read `true` and null (recorded in dry-run too since 2026-10-01; never the key itself).

**Going live (in the conversation where Davies says go; his confirmation of the first live order in it)**

8. The one statement. It sets the total cap from the balance the path read within the last five minutes, less the total
   stop and $5, clamped only at $320, and arms the path; it fails, and the path stays in dry-run, if that balance is
   unread, stale or under $81:

        update public.pm_live_config c
           set cap_total_usd = case when s.pusd is null or s.at < now() - interval '5 minutes' then null
                                    else least(320, floor(s.pusd - c.loss_total_usd - 5)) end,
               dry_run = false, live_confirmed_at = now(), updated_at = now()
          from (select (state->>'pusd')::numeric as pusd, (state->>'at')::timestamptz as at from public.pm_live_state where id = 1) s
         where c.id = 1;

   Read back: `select dry_run, live_confirmed_at, cap_total_usd from public.pm_live_config;`.

**The first day**

9. Within the minute: `select state->>'mode', state->>'why', state->'gates', state->>'openBlockedBy', state->>'pusd', last_error from public.pm_live_state;`
   — mode `live`, nothing blocking, the balance read.
10. Orders: `select state, count(*) from public.pm_live_orders where mode = 'live' and ts >= current_date group by 1;` and
    any refusal: `select ts, cond, outcome, side, price, size, response->>'why' from public.pm_live_orders where mode = 'live' and state = 'rejected' order by ts desc limit 20;`
11. Scoring, by the hour: `select date_trunc('hour', minute) as hour, cond, count(*) as minutes, count(*) filter (where ours > 0) as two_sided, count(*) filter (where bid_scoring and ask_scoring) as venue_scored, round(sum(formula_usd), 4) as formula from public.pm_live_minutes where mode = 'live' and minute >= current_date group by 1, 2 order by 1 desc, 2;`
    — the venue's flags should follow the formula's two-sided minutes once each order has rested its required time.
12. Fills: `select match_time, cond, side, price, size, status from public.pm_live_fills order by match_time desc limit 20;`
13. Faults: `select created_at, message from public.ops_errors where kind = 'agents.pm_live' and created_at > now() - interval '1 hour' order by created_at desc;`
    The caps: `select state->'withheld', state->'pnl', state->>'pusd' from public.pm_live_state;` — a buy withheld by
    `cap_total` means the inventory has reached the cap.
14. After 01:00 UTC the next day: `select * from public.pm_live_reward_days where day = current_date - 1 order by mode, cond;`
    and R (the query above). A first day under $1 a market may read 0 (the payout minimum).

**Phase 2, once the first payout has been read back**

15. `update public.pm_live_config set max_markets = 8, select_budget_usd = 160 where id = 1;` (takes effect at the next UTC
    day's selection). Nine and $175 is the next step if the first days' inventory stays well under the cap.
    **Done already, in the dry-run, on 2026-10-02** (migration `0080`; Davies: "现在就切 全功率320刀，并且什么时候上线我说了算不
    自动转了"): that day's markets were chosen again at eight and $160, and the path goes live at this size, not at
    phase 1's two. Step 8 runs only in the conversation where he says go; no routine runs it.

**Kill switches**

- `update public.pm_live_config set live_confirmed_at = null where id = 1;` — nothing that opens is placed; sells of
  what is held stay armed. Its open buys are withdrawn on the next turn.
- `update public.agent_risk set global_pause = true where id = 1;` — every open order cancelled (one cancel-all) and
  nothing placed. It is the global pause: the crypto loop and PR5 stop too.
- `update public.pm_live_config set dry_run = true where id = 1;` — back to dry-run; the live orders are cancelled.
- In code, `PM_ORDER_SENDS_ENABLED = false` and a deploy: no order and no cancel can leave, so cancel first; what
  rests then expires within ten minutes (GTD).

**While it runs, and after**

- A market that resolves while held is settled at Gamma's payout once Gamma shows it closed with a closed time; its
  tokens stay on chain until redeemed on polymarket.com, and the path counts them as capital until they read zero.
- At the end: `live_confirmed_at = null`, then `max_markets = 0`; redeem what resolved; move the balance out if he wants.

## Risks, his accepted risks

- **The Terms.** Polymarket's Terms of Use (re-read 2026-10-01, byte-identical to 09-24) bar UK and Irish residents,
  "THERE ARE NO EXCEPTIONS". Quoting is his accepted risk. The named consequences are close-only mode, exclusion from
  "any reward or incentive programs" (which would read here as R ≈ 0) and termination; a sanction would also end any
  later live test of the candidate.
- **Location.** It opens positions only while his Ireland attestation stands (standing since 2026-10-01, on his word) and
  only from eu-west-1. Never a VPN, a proxy or anyone else's account.
- **The key.** Davies says the key was not leaked (2026-10-01). The pre-study treated it as exposed because another tool
  stored it; either way the loss is bounded by the balance, and the balance is what he chose to spare.
- **The market.** Adverse selection gave back about 40 % of rewards on RW's paper; Polymarket can change its reward rules
  at any time; quotes must be real and fillable (the Terms' spoofing clause), and every quote here is.

## The LIVE page row, once it has a first live order (not built in this round)

As PR5's live executor became a row of LIVE from its first real order (`quotesLiveRow`): "Reward quotes" on Polymarket,
mode live, from the first `pm_live_orders` row with `mode = 'live'`. Funded: the pUSD balance at the last turn plus what
is held at cost plus settled tokens not yet redeemed at their payout. Deployed: resting buys' collateral plus holdings
at cost. Realised: CONFIRMED fills and settlements, plus the rewards actually paid (`pm_live_reward_days`, live rows);
unrealised: holdings at their mid less cost; today: the figure the day's loss stop reads. Its page adds R to date with
its market-days, today's formula so far, today's markets with each bid and ask and whether the venue says it scores,
and the gates line (open, close-only and why). The formula is never counted as money.

## Not verified

- The scoring duration ("live for the required duration"): the first live hour shows it in `pm_live_minutes`.
- Whether the $1 payout minimum is per market or per address (the $2.50 floor clears it either way).
- That the reward endpoints answer this account's signature type (1) as the docs say: only an L2 call can show it,
  and the first readout does.
- Whether `/balance-allowance` reports the balance net of resting orders: the guard counts resting buys as reserved
  either way, which can only withhold more.
- The rows' meaning: whether `/rewards/user` reports a market's earnings once per day per market, as the clients' types
  suggest; the readout sums whatever rows it gets, per market.
- R's carry-over from $6–$10 pools to RW's (above).
- How much inventory eight markets carry: no record this design may read gives RW's inventory per market. A buy the
  total cap would pass is listed in `state.withheld` with the gate `cap_total`; if that is common in phase 2, it stays
  at eight (or goes back to six) rather than up to nine.
- The selection's time from eu-west-1 with the concurrent listing: measured here from Atlanta; production records `ms`.
- How soon `GET /data/order/{id}` shows a cancel the CLOB has answered. The path waits about a second either way; the
  first live day shows it: a cancel carried out within the turn has `cancelled_at` equal to `cancel_requested_at`, one
  that froze its slot for a turn a later `cancelled_at`
  (`select count(*) filter (where cancelled_at > cancel_requested_at), count(*) from public.pm_live_orders where mode = 'live' and state = 'cancelled' and cancel_requested_at is not null;`),
  and one still resting a turn later is an `agents.pm_live` error that says when it was first asked.
- Everything 0074's design lists as unverified about a live POST (the reply's id, an expired order's read-back, the
  Irish exemption's wording, the HMAC accepted on a POST).

## Sources

Read 2026-10-01 unless stated.

- docs.polymarket.com: `market-makers/liquidity-rewards` (sha256 `9bb614da…dbcd`: midnight UTC, the $1 minimum, one
  sample a minute at a random offset), `market-makers/maker-rebates`, the API reference's reward pages
  (`rewards/get-earnings-for-user-by-date`, `…/get-total-earnings-for-user-by-date`, `…/get-reward-percentages-for-user`,
  `trade/get-order-scoring-status`, `rebates/get-current-rebated-fees-for-a-maker`), the CLOB OpenAPI
  (`d993169c…edb8`), `resources/error-codes` (`invalid post-only order: order crosses book`), `trading/manage-orders`
  (sha256 `e6e3b744…3024`; "Cancellation Results": a cancel's reply "identifies the orders that were canceled").
- `@polymarket/clob-client-v2` (github.com/Polymarket/clob-client-v2, commit `8046a89e`, 2026-09-25) and
  `py-clob-client-v2`: `getEarningsForUserForDay`, `getTotalEarningsForUserForDay`, `getRewardPercentages`,
  `isOrderScoring`, and their paging from `MA==`.
- The live pre-study (`2026-10-01-polymarket-live-prestudy.md`): R's break-even, the power table, the phases, the
  funding path, the Terms, the allowances. RW-E's pre-registration (`2026-09-26-polymarket-rw-end-prereg.md`). RW-NEXT
  (`2026-09-28-rw-next-prereg.md`). The order path's design (`2026-10-01-polymarket-order-path.md`).
- Measured, keyless, from this container: the listing's cursors and timings (above); the past-the-end and bad-cursor
  replies, `/rebates/current`'s `null` and the L2 reads' 401s (16:41 UTC); the floor scan (15:27 UTC); ten markets'
  NO books against their YES books.
