# Pre-registration: GROKPM, "Polymarket analyst (Grok)", an outside LLM agent trading $100 on Polymarket on information (2026-10-15)

**Frozen at the commit that adds this file.** Any later change is a deviation, written in §9 with its date and reason.
`src/grokpm_prereg.test.js` pins this file's sha256. The record is **not blind**: every row may be read at any time
(Davies, 2026-10-04: "所有不偷看条款全部取消"); the reading in §6 runs as written here, and its report says it was not blind.

## 0. On whose word, and what this is

- Davies, 2026-10-15: "Polymarket我目前还有些钱，要不让grok bot里开一个trading bot，给他100美元让他每小时或每半小时盯一次，自己在市场里找机会
  下单买卖…" — run a trading bot inside Grok, give it $100, let it watch every hour or half hour and find its own trades.
- The same day: "这些也做到github中也写到prompt里，每天的日志和汇总也都自动化和我们之前网站中rewards策略一样实时更新…网站中live页也加上策略和子策略
  页面（仿照之前rewards策略来做），并且"交易节奏"部分你仔细研究下看看那种最好…先让他就用100美元测试" — put it in the repository and the
  prompt, automate the daily log and summary and update them in real time like the Reward quotes strategy, add a row and a
  page to LIVE modelled on Reward quotes, study which trading rhythm is best, and test with $100 first.
- The context is PMPOST (`2026-10-15-pm-postmortem.md`): no systematic Polymarket edge was found at this size, and the
  reward strategies lost to takers who knew more. This test asks the remaining question: **can an LLM that reads the news
  be that better-informed side, on a small book, in markets few people watch?**
- **What is ours and what is not.** The agent is an outside Grok agent on another platform; this repository runs none of
  its code, holds none of its keys and places none of its orders. This repository holds three things: this
  pre-registration, the journal endpoint the agent posts to (`supabase/functions/grokpm/`), and an independent recorder of
  the agent's wallet (`agents?action=grokpmrec`, `agents/grokpm_rec.ts`, migration `0124_grokpm.sql`), with its row and
  page on LIVE (`agents/grokpm_view.ts`, `src/agents/`).
- **Davies does two things himself:** create a new Polymarket wallet and move $100 USDC into it (never live-prep's
  account: its path books that account's balance as its own), and configure the Grok side (the prompt, the
  schedule, the trading key, the `GROKPM_LOG_TOKEN`). The ledger's what-remains lists every step.

## 1. Hypothesis

H1: an LLM agent that trades only on (A) outcomes already confirmed by an authoritative source while the price lags, and
(B) researched mispricings in low-attention markets, with limit orders and the risk rules of §2, makes money over four
weeks AND forecasts the markets it enters better than their prices did.

H0: it does not; any profit is luck, and its probabilities are no better than the market's.

The test is small on purpose. $100, 40 resolved positions at most, cannot prove an edge; it can show that there is none
(a loss, or probabilities worse than the market's), and it measures what an LLM trader does in practice: how often it
finds category A, how its p compares with m, what the fills cost, and whether it follows its rules.

## 2. The agent's rules, frozen (the prompt carries them word for word)

**Categories.** Every open is one of three, and says which:

- **A — confirmed outcome.** The outcome is already confirmed by an authoritative source (the official result, the
  agency's release, the court's ruling, the organiser's announcement) while the price lags the confirmed outcome by **at
  least 8 points**. The source is linked.
- **B — researched mispricing.** In a low-attention market, the agent's researched probability differs from the price by
  **at least 12 points**, with at least one source linked.
- **C — adjustment.** A change to a position it already holds: add, trim or exit, on new information.

**Forbidden.**

- market making (quoting both sides for the spread or rewards);
- buying a favourite at **0.90 or above** outside category A;
- longshots: buying anything under **0.05**;
- live sports (any market on a game in progress or starting within its holding period);
- short-dated crypto (any crypto price market resolving within 7 days);
- thin books: a market whose best bid and ask are more than **5 points** apart, or that has under **$500** within
  5 points of the mid on the side it would exit into;
- markets resolving more than **30 days** out.

**Orders and risk.**

- **Limit orders only, resting (maker), except to exit a broken thesis**, which may cross the spread.
- At most **$10 per market** (cost), sized at **1/4 Kelly** from its p and the price, and never above $10.
- At most **6 open positions**; at most **$25 per theme** (markets driven by one underlying event or question).
- Keep at least **$30 cash** at all times.
- **Daily loss limit −$10** (UTC day, from the day's opening equity): no new opens for the rest of the day.
- **Total stop −$30** (from the $100): from then on it may only close positions.
- **Ireland only.** Before any order, each wake, from the same machine that sends the orders:
  `GET https://polymarket.com/api/geoblock` must answer **`country` "IE"**. It must not trade from anywhere else, and never
  through a VPN, a proxy or anyone else's account. (Deviation D1 from the brief, §9: the brief also asked for "not
  blocked", but from Ireland this endpoint answers `blocked: true` with country IE, because it speaks for the website,
  where Ireland is close-only, while the API is not restricted there; reference §2d, measured from eu-west-1. "Not blocked"
  would forbid every order. The country is the check.)
- **Every order is GTD** with an expiry no later than its next wake plus five minutes (§7.4); a cancel is journalled.
- **Every decision is journalled** to the endpoint in Appendix A, with its p, the m it saw, its category, its sources, its
  reason and what would prove it wrong; every wake posts a cycle row; every UTC day a daily summary.

**The agent's p** is its probability that the token it buys pays 1. **m** is the mid it saw for that token.

## 3. Start, end, and stops

- **Start.** The recorder stamps `grokpm_config.started_at` at its first five-minute snapshot whose equity (cash plus
  positions) is at least 90 % of FUNDED ($90), the funded wallet's first reading. Day 1 is that UTC day; FUNDED counts
  from that snapshot, and the first day's P&L is measured from $100.
- **End.** The first of: **28 days** after the start's UTC day began (00:00 UTC of day 29), or the moment the **40th
  resolved position** is recorded (an entry whose market has resolved, §5), or the total stop.
- **Stops** (the agent's, written in its prompt; the page shows their room, and nothing here can enforce them):
  - day −$10: no new opens until 00:00 UTC;
  - total −$30: close-only to the end; **the test ends as a FAIL** at that moment, and its reading runs at once.
- **Breaches.** An open while close-only, an open over $10 by more than 10 %, an open from outside Ireland, or a market
  the rules forbid, is counted in the reading (§6.4). A breach of the total stop, or of Ireland, ends the test as a FAIL,
  and the main session tells Davies the same day.
- **The record wins.** Where the agent's numbers and the record differ by more than $1 (the page flags it), the record is
  the figure, and the main session looks at why within a day.

## 4. The independent record

Every dollar this test reports comes from Polymarket's public record of the wallet, never from the agent's word.

- **What is read, every five minutes** (`agents?action=grokpmrec`, keyless): the wallet's pUSD, USDC.e and USDC by public
  JSON-RPC `balanceOf` on Polygon (`polygon-bor-rpc.publicnode.com`); `data-api.polymarket.com` `/positions?user=`,
  `/value?user=` and `/activity?user=`; each held token's book (`clob.polymarket.com` `POST /books`); and, every half
  hour, Gamma for the markets it touched that have resolved.
- **What is kept:** a snapshot a slot (`grokpm_snapshots`: cash, each position with its size, average price and mark, the
  data API's `/value` beside it, the equity); every activity item once (`grokpm_activity`); each token it came to hold,
  once, with the market's mid when first seen (`grokpm_entries`); each resolution (`grokpm_resolutions`).
- **The mark** is the book's mid while a market trades, and the payout (0 or 1) once the data API calls the position
  redeemable.
- **Its wallet** is set by a one-line migration once Davies sends the address; until then the recorder reads nothing.

## 5. Definitions (one place: `agents/grokpm_view.ts`; the reading script uses the same)

- **Equity** = cash (pUSD + USDC.e + USDC) + Σ size × mark. **Total P&L** = equity − FUNDED ($100).
- **Day P&L** = equity at the next UTC day's first snapshot (or now) − equity at this day's first snapshot (day 1: $100).
- **Unrealised** = Σ over positions still trading of size × (mark − average price). **Realised** = total − unrealised.
- **Entry**: a token the wallet bought. Its **category** is that of the agent's last `open` decision for it at or before
  its first fill; an entry with no such decision is **unreported**.
- **Resolved position**: an entry whose market Gamma shows resolved; **y** is the token's payout (0 or 1; a 50-50
  resolution scores 0.5).
- **Brier.** On every resolved entry with a p: the agent's p from that decision, the market's **m = the record's mid when
  it first saw the entry** (`grokpm_entries.mid`, at most five minutes after the fill), or the agent's own m when the
  record has none (it then says how many). Brier_agent = mean (p − y)², Brier_market = mean (m − y)², over the same entries.
- **Per-entry P&L** (for the category breakdown): its cash flows from the activity (buys out, sells and redemptions in)
  plus what is still held at its mark.

## 6. The reading (at the end, §3)

Run with read-only SQL over the `grokpm_*` tables, and Python over its output, from the repository root; the script is
written before the end, committed beside this file's folder (`backtests/grokpm/`), and its output is committed.

1. **Total P&L** from the record (§5), with the day-by-day table.
2. **Brier**, agent against market, on every resolved entry: the two means, their difference D = Brier_market −
   Brier_agent (positive: the agent was better), and a **paired bootstrap** of D: 10,000 resamples of the entries with
   replacement, `random.Random(20261015)`; its 5th and 95th percentiles and the share above 0.
3. **By category** (A, B, C, unreported): entries, resolved, P&L, Brier pair.
4. **Rule-keeping**: opens that broke a §2 rule, from the journal and the record (price ≥ 0.90 outside A, under 0.05,
   over $10 a market, a 7th position, cash under $30, a market more than 30 days out, an open on a day already at −$10 or
   after −$30), and decisions the record shows that were never journalled.
5. **Journal against record**: the days whose summary differed from the record by more than $1.
6. **Cadence**: the cycles by kind (light, full, event), and the opens each kind produced.

**Continue only if BOTH: total P&L > 0 AND Brier_agent < Brier_market** on the same resolved positions (the point
estimates, as Davies' brief set). Otherwise stop. The bootstrap interval is reported beside it and is not a second bar;
with 40 positions or fewer it will likely span zero, and the report says so. A continuation with more money is a new
pre-registration.

## 7. The cadence study: which trading rhythm is best

Asked: "交易节奏部分你仔细研究下看看那种最好" — every 30 minutes, or hourly? Measured on public data, keyless
(`backtests/grokpm/`: `scripts/fetch.py` pulled, `scripts/cadence.py` read, `results/cadence.txt` is its output; 600
resolved markets of the categories this test may trade).

### 7.1 The sample

Every binary market closed between 2026-08-15 and 2026-10-15 under Gamma's tags politics, economy, world, tech and
geopolitics, resolved cleanly to 0 or 1, and not a sports, crypto, short-dated price or weather market: 11,693. Three
strata by lifetime volume, 200 drawn from each with `random.Random(20261015)`: **thin** (under $10k: 9,073 markets, the
books §2 forbids), **low attention** ($10k–$50k: 1,627, the markets category B looks for) and **high** (≥ $50k: 993). For
each, the winning token's price every five minutes over its last seven days (`/prices-history`, fidelity 5).

### 7.2 Category A: how long a confirmed outcome's lag lasts

The moment an outcome becomes known is not in the data. The proxy is the **final approach**: from just after the last
point where the winning token's gap to 1 was 30 points or more, to the first point after it within 8 points of 1 (A's bar).
A checker that wakes every P minutes at a random phase sees the market inside that window with probability min(1, D / P).

| stratum | approaches | D: p25 / median / p75 (min) | within one 5-min bar | caught at 15 min | 30 min | 60 min | 120 min | 240 min |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| thin | 89 | 5 / 30 / 385 | 19 % | 77.4 % | 66.2 % | 57.4 % | 49.4 % | 40.4 % |
| **low attention** | **94** | **11 / 62 / 886** | **10 %** | **85.5 %** | **76.6 %** | **67.0 %** | **54.7 %** | **45.0 %** |
| high | 96 | 10 / 60 / 574 | 9 % | 85.4 % | 75.7 % | 64.2 % | 54.7 % | 45.0 % |

90 % bootstrap intervals for low attention: 30 min [70.8, 82.1], 60 min [60.4, 73.7]. From a 50-point gap instead of 30
(sensitivity): 89.6 % and 82.0 %. **Half the approaches finish within about an hour, a tenth within one five-minute bar
(no LLM on any schedule catches those), and a long tail lasts hours to a day.** Checking every 30 minutes instead of 60
catches about 10 points more of the approaches (76.6 % against 67.0 %); every 15 minutes, 9 more again.

**When approaches start.** In low-attention markets 30 of 94 approaches started in the hour after a US release slot
(12:30, 13:30, 14:00, 15:00, 18:00, 19:00 UTC) against 23 % of the day those hours cover (z ≈ 2.0); in high-attention
markets 20 % (no excess). The busiest single hour in all three strata is **16:00 UTC** (12:00 ET): deadlines written as
"by noon ET". So scheduled times matter for the markets that name them, and a market's own deadline is a time to look.

### 7.3 Category B: how long a price level stands

From every hourly point priced between 0.05 and 0.95 in the last 7 days less the final 24 hours:

| stratum | 12-point move within 30 min | 1 h | 2 h | 4 h | 8 h | 24 h | price within ±3 points for 1 h | 2 h | 4 h |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| thin | 5.8 % | 8.4 % | 12.1 % | 17.9 % | 26.3 % | 44.8 % | 80 % | 72 % | 61 % |
| **low attention** | **1.5 %** | **2.7 %** | **4.6 %** | **8.0 %** | **14.0 %** | **29.0 %** | **84 %** | **76 %** | **65 %** |
| high | 0.9 % | 1.7 % | 3.3 % | 6.2 % | 11.5 % | 27.4 % | 88 % | 80 % | 68 % |

**A low-attention price moves 12 points within four hours from only 8 % of moments.** A researched mispricing found on a
four-hourly scan has, in most cases, not been corrected by the time the next scan comes; scanning every 30 minutes instead
would buy little for B and cost eight times the research.

### 7.4 Order expiry, and LLM cost

- **Expiry.** Polymarket's GTD orders end one minute before their stated expiry, and an expiry under three minutes ahead
  is refused (reference §2d, "Order rules"). A resting limit that outlives the agent's attention is how an LLM trader gets
  picked off: PMPOST measured takers who knew more than the quotes they hit. So every entry rests **GTD until the next
  light check plus five minutes** (`expiration = now + 60 + (minutes to next wake + 5) × 60` seconds: 35 minutes on a
  30-minute rhythm) and is re-placed only if the thesis and price still hold. Exits may rest longer on a held position.
- **LLM cost.** Not measured here: Grok's price and the scheduler's limits depend on Davies' plan, and public reports of
  Grok Tasks' limits conflict (3 to 10 daily tasks). The schedule below costs about **42 light checks + 6 full scans + up
  to 4 event wakes a day**; a full scan every 30 minutes would be 48 full scans, eight times the research. The cycle rows
  carry each wake's kind, so the first week's actual usage is read from them, and the rhythm is cut if the cost is out of
  proportion to $100.

### 7.5 The recommendation

1. **A light check every 30 minutes**: geoblock, cash, positions, resting orders (cancel or re-place each at its expiry),
   the held markets' prices and news, the category-A watch list. Cheap; it catches about 77 % of low-attention final
   approaches against 67 % hourly.
2. **A full scan every 4 hours** (00:00, 04:00, … UTC, in place of that slot's light check): look for new A and B. A
   low-attention price moves 12 points within 4 hours from 8 % of moments.
3. **Extra wakes, where the scheduler allows them**, for held or watch-listed markets: 12:35 UTC (13:35 from 2026-11-02,
   when the US leaves daylight time) on a US data day, 14:05 and 18:05/19:05 UTC (FOMC), and a few minutes after each held
   market's own deadline; the busiest hour for final approaches is 16:00 UTC (noon ET deadlines).
4. **If the scheduler allows only hourly wakes**: hourly light checks, a full scan every 4 hours, and the release wakes;
   about 10 points fewer A approaches caught, B unchanged.
5. **Not faster than 15 minutes**: a tenth of approaches finish inside five minutes, and those belong to bots.

What the study cannot say: whether the agent *recognises* a confirmed outcome when it looks (that is the test itself),
and the approach is a proxy for the confirmed-but-lagging window, which may start before confirmation. The prices are the
CLOB's history (a mid-like price per five minutes), not executable books.

## 8. What this does not check

- The agent's own code, prompt or scheduler: they live on another platform.
- That the wallet is the agent's alone: Davies must never trade in it by hand (the record would count it as the agent's).
- Fees: they are inside the cash the record reads; this test does not split them out.
- Deposits after the start: FUNDED is $100; a later deposit or withdrawal needs a migration moving `funded_usd`, and
  the reading names it.

## 9. Deviations

- **D1 (2026-10-15, before freezing).** The brief's geoblock rule "country IE and not blocked" is written as "country IE":
  from Ireland the endpoint answers `blocked: true` (reference §2d, the eu-west-1 measurement), so the brief's rule as
  written would refuse every order.
- **D2 (2026-10-16, before the start; migration `0125`).** Davies, 2026-10-16: "之前的live reward卖完了吗，可以用目前这个
  polymarket跑吗" and "让grok用我们搭好的爱尔兰服务器下单，不是网页端". The agent does not get a wallet or a key. It trades
  through this project's server (`supabase/functions/grokpm/exec.ts`), forced to eu-west-1, on the Polymarket account
  live-prep used, whose remaining holdings are dust under the 5-share minimum. What changes:
  1. **Execution.** Every order is a request to the server carrying its journal decision (Appendix A.2). The server
     checks it, journals it, and only then signs and sends it with the order paths' own client. The agent cannot send an
     order any other way. Disarmed (`grokpm_config.dry_run` true, `armed_at` null), everything is checked and journalled
     and nothing is sent. The go statement (0125's header) arms it only in the conversation where Davies says go, and
     0091's one-armed rule now covers GROKPM: it cannot be armed while live-prep is, nor live-prep while it is. 0125
     disarms live-prep where it holds nothing an order can sell.
  2. **Server-side rules.** Every rule of §2 a machine can check is refused with its reason before anything is sent:
     - a BUY is post-only;
     - a SELL may take the book only as a close of category C;
     - a BUY must be at 0.05 or more, and under 0.90 unless category A;
     - at most $10 at cost a market (held plus resting buys plus the order);
     - at most 6 markets open;
     - at most $25 a theme: the agent names a `theme` with each open, and a market keeps the theme of its first buy;
     - cash after the order at least $30;
     - the −$10 day stop and the −$30 total stop, both from the agent's own book;
     - a market ending within 30 days, not a sport playing or ending within 7 days, and not a crypto price market ending
       within 7 days;
     - not thin: spread at most 5 points, and at least $500 bid within 5 points of the mid;
     - the decision's p, m, category, sources and invalidation present;
     - the venue's tick and minimum size;
     - at most 50 orders a UTC day (150 since D5);
     - a GTD expiry clamped to between 3 and 65 minutes (35 by default).

     Live, the server also requires all of these, read by the server itself:
     - eu-west-1;
     - the key loaded for the stored signer;
     - the geoblock answering `country` "IE" (this replaces §2's agent-side check);
     - Davies' Ireland attestation current, for opens;
     - no global pause and no other armed path;
     - the account not closed-only, for opens.
  3. **Budget isolation.** The agent's book is its own orders and their fills only (`grokpm_orders`, `grokpm_fills`).
     - Its equity is the $100 budget plus what its trades realised, less fees, plus what it holds at the mid (at the
       payout once resolved).
     - The shared account's pUSD and live-prep's dust never count, and the agent can never sell a token it did not buy.
     - It cancels only its own orders, each by its id; the venue's cancel-all is never sent.
     - The independent record (§4) counts only the account's public trades whose transaction and token are one of the
       agent's fills.
  4. **Start.** The start (§3) is the go statement's `started_at`, the baseline from which the agent's own book counts,
     not a snapshot holding $90. FUNDED is the $100 budget from then.
  5. **Requests.** Since the agent also reads its account and markets here, the hourly cap on requests is 600 (journal
     rows stay at 200 an hour).

  Nothing else changes: the categories, the reading (§6), its bar and its end are as frozen. The account's address is
  never returned to the agent or shown on the page.
- **D3 (2026-10-16, before the start; no migration).** The agent's dry-run rehearsal sent a category-B open at p 0.85
  with the mid at 0.865, said itself that this was no 12-point edge, and noted that the server did not check it. Three
  more of §2's rules are machine-checkable and are now refused by the server like the others (`exec.ts`, its Edge tests):
  1. **`edge`**: an open of category A needs p at least 8 points over the price, of category B at least 12, where the
     price is the dearer of the order's price and the book's mid as the server reads it (so neither a low resting price
     nor a stale m clears the bar); an open of category C needs p over the order's price.
  2. **`kelly`**: an open costs at most a quarter of the Kelly stake of the agent's equity at its p and its price,
     `0.25 × (p − price) / (1 − price) × equity`, or the venue's smallest order when that is more (the $10 market cap
     still applies on top).
  3. **`adjustment`**: an open of category C needs a position the agent already holds in that market.

  These enforce rules §2 already states; nothing about the categories, the reading (§6), its bar or its end changes.
- **D4 (2026-10-17, before the start; no migration).** An independent audit of the server before the go (Davies: "叫一个独立的
  sub-agent再审核一下…如果有问题就修复") found four places where the server's book or rules did not do what §2, §3 and D2
  already say. Fixed in `exec.ts` and `index.ts`, each pinned by an Edge test that failed before:
  1. **A resolved holding is cash.** The agent's book now settles a resolved market's tokens at their payout into its cash
     (as live-prep's book does), instead of keeping them as a held value outside the cash. Before, every win shrank the cash
     the $30 floor reads, and after about $70 of resolved entries the agent could open nothing more, far short of §3's 40.
     Equity and P&L are unchanged; the account's `budget` adds `settled_usd`. The tokens stay on chain until Davies redeems
     them; the shared account's pUSD covers them meanwhile.
  2. **The stops hold once reached.** §2's day stop ("no new opens for the rest of the day") and §3's total stop
     ("close-only to the end") are latched when first reached in live (`grokpm_exec_state`): the day's until 00:00 UTC, the
     total's to the end, so a mark recovering a minute later no longer opens them again. The total stop is reported once to
     the errors box (§3: the test ends as a FAIL, and the main session tells Davies). `budget` adds `day_stop_hit_at` and
     `total_stop_hit_at`, and `can_open` reads them.
  3. **Every fill is booked.** A cancel's read-back books the trades it names (a fill between the minute's sync and the
     cancel was lost); trades not yet final are read again until CONFIRMED or FAILED (the keyless record of §4 finds the
     agent's trades by the transaction hash, which a trade read at MATCHED lacks); and an order of the last two days
     matched beyond its booked fills is read again (live-prep's Addendum 25).
  4. **The kill switches reach resting orders.** Under the global pause, or once the path is disarmed (0125's undo), the
     minute's sync cancels the agent's live orders, each by its own id; before, they rested up to 65 minutes.

  Also: the agent's orders and fills are read whole (a 1,000-row guard would have refused every request, closes included,
  from about day 20 at 50 orders a day), only held tokens' books are read, and an order whose decision id is already a
  journal row is refused with that reason instead of a 500. Nothing about the categories, the reading (§6), its bar or its
  end changes.
- **D5 (2026-10-17, before the start; migration `0127`).** Davies, 2026-10-17, on the audit's two open questions: "你的其他问题
  都按你推荐的来".
  1. **150 orders a UTC day, not 50.** An order kept resting is re-placed each wake (its GTD expiry is the next wake plus five
     minutes, §2), so one order kept alive through a day on the 30-minute rhythm cost 48 of the 50. Buys stay post-only under
     every cap and stop above, so this adds no money at risk.
  2. **The end is closed by the main session.** At the end (§3: 28 days, the 40th resolved position, or the total stop) the
     agent stops opening and tells Davies; the main session then disarms the path with 0125's undo once the agent's resting
     orders are cancelled (the minute's sync cancels any left, D4), and runs the reading (§6). What the agent still holds then
     settles at resolution and is counted by the record.

  Nothing about the categories, the reading (§6), its bar or its end changes.
- **D6 (2026-10-17, after the start; migration `0128`; operational, no rule changes).** Davies, 2026-10-17: "加上吧 全部都自动化掉"
  (add it, automate all of it), on redeeming resolved positions automatically. D4 counts a resolved holding as the agent's
  cash at its payout, but on chain the winning tokens become pUSD only when redeemed, and the shared account's own pUSD
  was then about $103, so unredeemed wins could have left the agent's buys short at the venue. The `grokpm` function now
  redeems every redeemable position of the shared account once an hour (`grokpm/redeem.ts`): the agent's, live-prep's
  resolved dust and Davies' own, since a redemption only turns resolved tokens into pUSD (a losing token pays 0 and is
  cleared). It sends one gasless transaction a run through Polymarket's relayer, signed by the account's own key, at most
  five markets, each recorded in `grokpm_redeems`, and nothing while `grokpm_config.redeem_enabled` is false (it then records
  what it would redeem). A redemption writes no fill: the agent's book (§5, D2.3, D4) and the independent record (§4) count
  what they counted before, so nothing is counted twice. Nothing about the rules, the categories, the reading (§6), its bar
  or its end changes.
- **D7 (2026-10-20, after the start; no migration; a reading added, no rule changed).** Davies, 2026-10-20: "同意", on the
  zero-trades retrospective (`reviews/2026-10-20-grokpm-zero-trades.md`, §6.3). In 3.5 days the agent sent no order, and on
  the 9 candidates that resolved its sub-threshold p scored worse than the market (Brier 0.136 against 0.106), so the bars
  stay as frozen. Added: for every candidate it researches to a number, the agent journals a `no_action` decision with
  `market_id`, `token_id` (the side it would buy), `p` (formed from its sources before it reads the price), `m` (the mid it
  then reads), `category` (the one it tested) and `reason`, at most one a market per scan (the journal already accepts these
  fields; no code changes). At the end, beside §6's frozen bar, a secondary reading compares these shadow forecasts with the
  market's m by Brier on every one whose market resolved: each market counted once, at its first shadow forecast, with
  §6.2's paired bootstrap. It is not a bar: continuing still needs §6's two conditions on real entries; it tells Davies
  whether a later, looser test could be worth pre-registering. The message given to the agent is the review's §7.
- **D8 (2026-10-20, after the start; no migration).** The server's `kelly` rule is cumulative within one market: the
  cost already held, plus the cost of buys still resting, plus the new buy, must be no more than
  `min($10, max(0.25 × (p − price) / (1 − price) × equity, the venue's smallest order at that price))`. Thus Davies'
  2026-10-20 basis — the smaller of a quarter Kelly of equity and $10 a market — replaces D3's per-open reading, and
  the venue-smallest-order exception is likewise applied to the cumulative total, not to the new order alone. The ¼
  Kelly coefficient does not change. This is never looser than §2/D3 judged order by order: a buy that passes the
  cumulative cap would pass the old per-open cap, while a buy that passed alone can now be refused because the market
  already holds or rests cost. D8 takes effect only from the moment PR #245 is merged and `grokpm` is redeployed;
  every order sent before that deployment remains judged under §2/D3's per-open rule. At the time D8 is recorded,
  GROKPM live had sent 0 orders. Authorization: Davies, 2026-10-20, in the group: "claude来决定D4"; Claude approved.
  §2, the agent prompt, the appendices and D1–D7 are unchanged; nothing about the categories, the reading (§6), its
  bar or its end changes.
- **D9 (2026-10-22, after the start; no migration; D7's reading, no rule changed).** Davies, 2026-10-22: "6-9听你建议的", on
  when D7's shadow forecasts start counting. D7's secondary reading counts the shadow forecasts journalled from C-003's
  start, 2026-10-20 16:58 UTC. The first wake after it (decision ids `2026-10-20T17:05Z-d7-*`, two rows) is left out: that
  round read the price and the vote count together, so its p was not formed before its m as D7 requires. Each market's
  first counted forecast is then its next one (for both of those markets, the 17:35 UTC wake's). Nothing about the rules,
  the categories, §6's reading, its bar or its end changes (the zero-trades review's §10).
- **D10 (2026-10-23, after the start; no migration; a reading's column added, no rule changed).** Davies, 2026-10-23:
  "同意，按你的建议做", on the rules study (`reviews/2026-10-23-grokpm-rules-study.md`). In its first six days the agent sent no
  order. Every shadow forecast that cleared its category's bar on p − m (19 rows in 4 markets, 2026-10-20 16:58 to
  10-23 04:45 UTC) stood in a book §2 forbids as thin. In the three of them that resolved, the market had last traded
  at 0.97 or more before the forecast: the agent's m was the midpoint of an emptied book, not a price anyone would sell
  at. On the 4 resolved forecasts, Brier against m was 0.0019 for the agent and 0.1270 for the market; against the
  market's last trade, 0.0004. The rules stay as frozen. D7's secondary reading adds a second market reference beside
  m: the market's last trade of the forecast token before each counted forecast (the data API's taker trades, keyless;
  a trade of the other outcome at q counts as 1 − q). It is scored the same way (Brier, log loss, and §6.2's paired
  bootstrap) and reported beside the m column, which stays as D7 defined it. Each counted forecast whose book was
  one-sided or wider than 5 points is marked. It is not a bar: continuing still needs §6's two conditions on real
  entries. Nothing about the categories, the rules, §6's reading, its bar or its end changes.

## Appendix A: the journal API (paste into the prompt)

**URL:** `https://flmvxigozjuizpckllvk.supabase.co/functions/v1/grokpm`

**Headers:**

- `Authorization: Bearer <GROKPM_LOG_TOKEN>` (the secret Davies sets in Supabase and gives only to the agent; at least 32
  characters; never print it, never put it in a journal row).
- `Content-Type: application/json`
- An `apikey` header is not needed (the function is deployed without the gateway's JWT check) and is ignored if sent.

**GET** (no body): a ping. `200 {"ok":true,"now":"…","rows_left_this_hour":200,"requests_this_hour":0}`. Use it to check
the secret.

**POST** one JSON object with up to three lists, at least one row in all, at most **50 rows** a request and **64 KiB**:
`{"decisions":[…],"cycles":[…],"daily":[…]}`. All or nothing: one bad row refuses the request and nothing is stored.
Every row has an `id` you choose (1–64 of `A–Z a–z 0–9 . _ : -`); a row sent again with a stored id is counted as a
duplicate, not stored twice, so resend a request whose answer you lost. Times are ISO 8601 with a zone, within 7 days back
and 10 minutes ahead of the server's clock. Unknown fields are refused. Free text is stored and shown as text only.

**A decision** (`action`: `open`, `close`, `cancel`, `no_action`):

| field | type | required |
|---|---|---|
| `id` | string | always |
| `ts` | ISO time | always |
| `action` | `open` \| `close` \| `cancel` \| `no_action` | always |
| `market_id` | condition id, `0x` + 64 lower-case hex | all but `no_action` |
| `token_id` | the outcome token's id, decimal string | `open`, `close` |
| `outcome` | string ≤ 64 (e.g. "Yes") | no |
| `side` | `BUY` (an open) \| `SELL` (a close) | `open`, `close` |
| `price` | number, 0 < price < 1 | `open`, `close` |
| `size` | shares, number > 0 | `open`, `close` |
| `p` | your probability the token pays 1, 0–1 | `open` |
| `m` | the mid you saw for the token, 0–1 | `open` |
| `category` | `A` \| `B` \| `C` | `open`, `close` |
| `sources` | array of ≤ 10 http(s) URLs, each ≤ 500 characters | ≥ 1 for an `open` of A or B |
| `reason` | string, 1–2,000 characters | always |
| `invalidation` | string ≤ 1,000: what would prove it wrong | `open` |
| `order_id` | string ≤ 128 (`A–Z a–z 0–9 . _ : -`) | no |

<!-- example:decision -->
```json
{
 "id": "2026-10-16T09:25Z-open-1",
 "ts": "2026-10-16T09:25:00Z",
 "action": "open",
 "market_id": "0x3f1c0e5b0a7d2c9e8f6b4a3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b",
 "token_id": "71321045679252212594626385532706912750332728571942532289631379312455583992563",
 "outcome": "Yes",
 "side": "BUY",
 "price": 0.82,
 "size": 12,
 "p": 0.97,
 "m": 0.835,
 "category": "A",
 "sources": ["https://www.bls.gov/news.release/cpi.nr0.htm"],
 "reason": "BLS published September CPI at 08:30 ET: 0.2 % m/m, inside this market's YES range. The book still offers YES at 0.82.",
 "invalidation": "BLS revises or retracts the release, or the market's rules name a different series.",
 "order_id": "0x9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b"
}
```

**A cycle** (one per wake; `kind`: `light`, `full`, `event`): `id`, `ts`, `kind`, `cash_usd` (0–100,000),
`positions_value_usd` (0–100,000), `pnl_usd` (your total P&L as you see it), `open_positions` and `actions` (whole numbers
0–100), `notes` (≤ 1,000, optional). All but `notes` required.

<!-- example:cycle -->
```json
{
 "id": "2026-10-16T09:30Z-cycle",
 "ts": "2026-10-16T09:29:40Z",
 "kind": "event",
 "cash_usd": 80.16,
 "positions_value_usd": 19.86,
 "pnl_usd": 0.02,
 "open_positions": 2,
 "actions": 1,
 "notes": "Woke for the CPI release; one category A buy resting until 10:05."
}
```

**A daily summary** (once a UTC day, after 00:00 for the day before): `id`, `day` (YYYY-MM-DD, not in the future),
`cash_usd`, `positions_value_usd`, `pnl_day_usd`, `pnl_total_usd`, `trades` (0–1,000), `summary` (1–4,000), `lessons`
(≤ 2,000, optional). The page shows the newest summary of a day beside the record's P&L.

<!-- example:daily -->
```json
{
 "id": "2026-10-15-daily",
 "day": "2026-10-15",
 "cash_usd": 88.4,
 "positions_value_usd": 11.2,
 "pnl_day_usd": -0.4,
 "pnl_total_usd": -0.4,
 "trades": 2,
 "summary": "One category B entry on a committee schedule; one no-action full scan. Nothing cleared category A.",
 "lessons": "Thin books in two candidate markets: skipped as the rules require."
}
```

**Answers:**

| status | body | what to do |
|---|---|---|
| 200 | `{"ok":true,"stored":{"decisions":n,"cycles":n,"daily":n},"duplicates":n,"rows_left_this_hour":n}` | done |
| 400 | `{"error":"body is not valid UTF-8 JSON"}` | fix the JSON |
| 401 | `{"error":"unauthorised"}` | the bearer is wrong or missing |
| 405 | `{"error":"method not allowed"}` | GET or POST only |
| 413 | `{"error":"body over 65536 bytes"}` | split the request |
| 415 | `{"error":"content-type must be application/json"}` | set the header |
| 422 | `{"error":"invalid","errors":["decisions[0].p: must be between 0 and 1", …]}` (≤ 20) | fix each named field and resend all |
| 429 | `{"error":"rate limited","rows_left_this_hour":n,"max_rows_per_hour":200,"retry_after_s":n}`, header `Retry-After` | wait that long |
| 500 | `{"error":"could not store; send again later"}` | resend later (ids make it safe) |
| 503 | `{"error":"not configured","detail":"GROKPM_LOG_TOKEN is not set"}` | Davies sets the secret |

**Limits:** 200 rows stored and 600 requests (refused ones included) in any rolling hour (120 before D2).

**Example:**

```sh
curl -sS -X POST https://flmvxigozjuizpckllvk.supabase.co/functions/v1/grokpm \
  -H "Authorization: Bearer $GROKPM_LOG_TOKEN" -H "Content-Type: application/json" \
  -d '{"cycles":[{"id":"2026-10-16T10:00Z-cycle","ts":"2026-10-16T10:00:05Z","kind":"light","cash_usd":80.16,"positions_value_usd":19.9,"pnl_usd":0.06,"open_positions":2,"actions":0}]}'
```

### A.2 Trading through the server (Deviation D2)

Every call below goes to `https://flmvxigozjuizpckllvk.supabase.co/functions/v1/grokpm?action=<action>&forceFunctionRegion=eu-west-1` with the same `Authorization: Bearer
<GROKPM_LOG_TOKEN>`. Called from any other region it answers `403 {"error":"wrong region"}`. The ping (GET with no
action) says which region answered. The server holds the account; you never see its address or key.

| action | method | what it answers |
|---|---|---|
| `account` | GET | `mode` (`dry_run` or `live`), `armed`, `started_at`, `gates` (`geoblock`, `attestation`, `global_pause`, `closed_only`, `other_path_armed`, `key_loaded`), `budget` (`funded_usd`, `cash_usd`, `resting_buys_usd`, `free_cash_usd`, `cash_floor_usd`, `spendable_usd`, `held_value_usd`, `equity_usd`, `fees_usd`, `total_pnl_usd`, `day_pnl_usd`, `day_stop_usd`, `total_stop_usd`, `day_room_usd`, `total_room_usd`, `can_open`, `orders_today`, `max_orders_day`, `markets_open`, `max_markets`, `market_cap_usd`, `theme_cap_usd`, `cost_by_theme`, `cost_by_market`), `positions` (your own: `market_id`, `token_id`, `size`, `avg_price`, `mark`, `mark_from`, `value_usd`, `unrealised_usd`, `resting_sell`, `theme`), `open_orders` (`order_id`, `decision_id`, `market_id`, `token_id`, `side`, `price`, `size`, `size_matched`, `post_only`, `state`, `expires_at`, `expires_in_s`, `theme`) |
| `market&cond=0x…` or `market&token=…` | GET | `market_id`, `question`, `end_date`, `neg_risk`, `accepting_orders`, `closed`, `fee_type`, `tags`, `sports`, `crypto`, `game_start_time`, `tick`, `min_size`, `outcomes` (each: `token_id`, `outcome`, `best_bid`, `best_ask`, `mid`, `spread`, `bid_depth_usd_5pt`, `ask_depth_usd_5pt`, `tick`, `min_size`, `thin`), `open_blocked_by` (the market rules an open there would break now) |
| `order` | POST | one order from its decision: an `open` decision BUYs, a `close` decision SELLs (body below) |
| `cancel` | POST | `{"order_id":"0x…"}` (one of yours), optional `"decision"` (action `cancel`) to journal it |
| `cancel_all` | POST | every open order of yours, each cancelled by its id; optional `"decision"` |

**An order** is `{"decision": <a decision row as in Appendix A, action open or close>, "theme": "<1–64 characters>",
"expires_at": "<ISO time>"}`.
- The decision's `market_id`, `token_id`, `side`, `price`, `size` and `category` ARE the order. `theme` is required for
  an open. `expires_at` is optional: it is clamped to between 3 and 65 minutes ahead, and is 35 minutes when absent.
- The decision is journalled with the order. Do not post it to the journal again.
- A request whose decision `id` was already used answers the order it made (`"duplicate": true`), so a lost answer can be
  resent safely.

<!-- example:order -->
```json
{
 "decision": {
  "id": "2026-10-16T09:25Z-open-1",
  "ts": "2026-10-16T09:25:00Z",
  "action": "open",
  "market_id": "0x3f1c0e5b0a7d2c9e8f6b4a3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b",
  "token_id": "71321045679252212594626385532706912750332728571942532289631379312455583992563",
  "outcome": "Yes",
  "side": "BUY",
  "price": 0.82,
  "size": 12,
  "p": 0.97,
  "m": 0.835,
  "category": "A",
  "sources": [
   "https://www.bls.gov/news.release/cpi.nr0.htm"
  ],
  "reason": "BLS published September CPI at 08:30 ET: 0.2 % m/m, inside this market's YES range. The book still offers YES at 0.82.",
  "invalidation": "BLS revises or retracts the release, or the market's rules name a different series."
 },
 "theme": "us-cpi-september",
 "expires_at": "2026-10-16T10:05:00Z"
}
```

A close of category C (a broken thesis) may sell at or below the best bid; any other order rests (post-only).

<!-- example:close -->
```json
{
 "decision": {
  "id": "2026-10-16T13:05Z-close-1",
  "ts": "2026-10-16T13:05:00Z",
  "action": "close",
  "market_id": "0x3f1c0e5b0a7d2c9e8f6b4a3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b",
  "token_id": "71321045679252212594626385532706912750332728571942532289631379312455583992563",
  "outcome": "Yes",
  "side": "SELL",
  "price": 0.6,
  "size": 12,
  "category": "C",
  "sources": [
   "https://www.bls.gov/news.release/cpi.nr0.htm"
  ],
  "reason": "BLS corrected the release: the series is outside the range. Thesis broken; exit at the bid."
 }
}
```

**Answers to `order`:**

| status | body |
|---|---|
| 200, dry-run | `{"ok":true,"mode":"dry_run","sent":false,"would_send":{"token_id","side","price","size","post_only","order_type":"GTD","expires_at"},"order":{…}}` |
| 200, live | `{"ok":true,"mode":"live","sent":true,"venue":"<the venue's status>","order":{"order_id","decision_id","state","post_only","expires_at",…}}` |
| 409 | `{"ok":false,"sent":true,"venue":"<why the venue refused it>","order":{…,"state":"rejected"}}` |
| 422 | `{"error":"invalid","errors":[…]}` (the decision's fields) or `{"error":"refused","mode":…,"refusals":[{"rule":"…","why":"…"}]}` |
| 403 | `{"error":"wrong region"}` |

**The refusals' rules:**

| rule | meaning |
|---|---|
| `region` | not eu-west-1 |
| `global_pause` | the project's global pause is on |
| `key` | the signing key is not loaded |
| `one_armed` | another path of the account is armed |
| `geoblock` | the server's geoblock is not IE |
| `attestation` | Davies' Ireland attestation is not current: closes only |
| `closed_only` | the account is closed-only: closes only |
| `orders_day` | the day's orders already reached (150 since D5) |
| `market` | Gamma has no such open market, or the token is not one of its outcomes |
| `book` | the book is unreadable |
| `longshot` | a buy under 0.05 |
| `favourite` | a buy at 0.90 or more outside category A |
| `total_stop` | −$30 reached: closes only |
| `day_stop` | −$10 today: no new open until 00:00 UTC |
| `market_cap` | over $10 in the market |
| `positions` | 6 markets open |
| `theme` | no theme, or the market's theme differs |
| `theme_cap` | over $25 in the theme |
| `cash_floor` | cash would fall under $30 |
| `end_date` | the market resolves more than 30 days out, or names no end |
| `sports` | a sport playing or ending within 7 days |
| `crypto` | a crypto price market ending within 7 days |
| `thin` | one-sided, spread over 5 points, or under $500 bid within 5 points of the mid |
| `post_only` | a buy at or above the ask, or a sell at or below the bid that is not a category-C close |
| `not_owned` | selling more than you hold from your own buys, less your resting sells; you can never sell a token you did not buy |
| `edge` | p under the category's bar over the dearer of price and mid (A 8 points, B 12; C: p not over the price) |
| `kelly` | the open costs more than a quarter Kelly of the equity at p and the price (or the venue's smallest order) |
| `adjustment` | a category-C open in a market the agent holds nothing in |
| `venue` | off the tick, under the minimum size, or a bad expiry |

**Example (a light check, then an open):**

```sh
B="https://flmvxigozjuizpckllvk.supabase.co/functions/v1/grokpm"
H="Authorization: Bearer $GROKPM_LOG_TOKEN"
curl -sS "$B?action=account&forceFunctionRegion=eu-west-1" -H "$H"
curl -sS "$B?action=market&cond=0x3f1c…4c3b&forceFunctionRegion=eu-west-1" -H "$H"
curl -sS -X POST "$B?action=order&forceFunctionRegion=eu-west-1" -H "$H" -H "Content-Type: application/json" -d @order.json
curl -sS -X POST "$B?action=cancel_all&forceFunctionRegion=eu-west-1" -H "$H" -H "Content-Type: application/json" -d '{}'
```
