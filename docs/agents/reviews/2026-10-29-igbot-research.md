# IGBOT: a Grok-driven trading bot on IG, researched and built for the demo (2026-10-29)

Davies, 2026-10-28: "我觉得grokbot做polymarket的这个策略不错，你仔细深度研究下是否可以做个类似的做ig的cfd/options/spread betting的
trading bot并搭建架构，做好了给我发prompt" — he likes the Grok-driven Polymarket strategy (GROKPM) and wants a similar Grok-driven
bot on IG (CFDs, options, spread betting): research it in depth, build the architecture, and give him the prompt.

**What this is.** Research on IG's products, API, costs and rules for a UK retail client; an honest look at where a
Grok-style analyst could have an edge there and what GROKPM's record does and does not show; and the design of the bot
that was built (`supabase/functions/igbot/`, migration `0157_igbot.sql`), which runs on IG's **demo** environment only.
Its draft pre-registration is `reviews/2026-10-29-igbot-prereg.md` (DRAFT, not frozen) and the prompt for Grok is
`docs/agents/igbot/GROK_PROMPT.md`. Nothing here touched Davies' live IG account, read a live credential, placed, cancelled
or amended anything, or armed anything. The only production reads were read-only SQL on `ig_facts` (the `ig` function's
demo facts of 2026-10-15) through the Supabase connector.

**The repository is public.** No balance or P&L of Davies' accounts is written here. GROKPM's realised P&L is `[•]`;
its counts, rules and scores stay.

**Sources.** IG's own pages were read and committed by earlier work: `backtests/ig_research/inputs/ig_pages/` (2026-10-09)
and `backtests/ig_deepdive/inputs/sources/` (2026-10-15, each page's sha256 in `source_index.csv`). This review re-read
those files and, on 2026-10-28, IG UK's charges page live. The earlier IG reviews are the evidence for every strategy
result quoted: `reviews/2026-10-09-ig-opportunities.md`, `2026-10-14-ig-deepdive.md`, `2026-10-15-ig-verification.md`,
`2026-10-16-ig-strategy-search.md` and `2026-10-18-ig-strategy-search-3.md`. GROKPM's are its pre-registration
(`2026-10-15-grokpm-prereg.md`) and its five reviews to `2026-10-28-grokpm-utilisation.md`. A statement from memory says so.

## 1. The answer in short

1. **As a demo test, yes; as a money strategy, not on the evidence.** The architecture is GROKPM's and transfers whole:
   Grok holds no credential, the server checks every request against fixed rules and its own book, journals it, and only
   then sends it. That is built and pinned. What does not transfer is the edge.
2. **The base rate is against it.** IG's own disclosure on 2026-10-28: "70% of retail investor accounts lose money when
   trading spread bets and CFDs with this provider" (IG UK charges page; its product pages said 69 % on 2026-10-15,
   `ig_deepdive` F37/F38).
3. **GROKPM has not shown that Grok forecasts better than the market.** Its record so far: 24 live orders, 5 fills, 3
   positions (utilisation review §2). On the shadow forecasts the market's last trade scored better than Grok (Brier 0.0004
   against 0.0019 on 4 resolved; rules study §1), and Grok's sub-threshold forecasts scored worse than the market (0.136
   against 0.106 on 9; zero-trades review). Grok only looked better against the stale midpoint of emptied books. Where
   GROKPM did make money it was a handful of category-B entries in low-attention markets, too few to read.
4. **IG has no low-attention market for an LLM to be early in.** GROKPM's thesis was a news-reading agent beating
   markets few people watch. IG's tradable underlyings are the S&P 500, the Nasdaq, the FTSE, the DAX and the FX majors,
   the most-watched prices in the world, where news is priced in milliseconds. A Grok agent that wakes every 15 to 30
   minutes is several orders of magnitude too slow to trade news. This repository already tested the scheduled-event
   rules mechanically (FOMC, CPI, payrolls, EIA) and found nothing (§5).
5. **Where a Grok edge is plausible at all** is in judgement, not speed: whether a scheduled release will surprise
   against consensus, and how far the market over- or under-reacts in the hours after. Neither has evidence behind it
   here. IG's weekend markets, priced by IG itself from client flow, are the one venue-specific inefficiency candidate,
   and the weekend recorder is already measuring them (§5.5); the bot does not trade them in this phase.
6. **So the right test is a cheap, falsifiable one.** On the demo, with a notional £1,000 and £10 of risk a trade, every
   open a bracket (entry, guaranteed stop, limit) whose geometry gives the market's driftless probability m. Grok states
   p, the chance the limit is hit first, and must beat m by 8 points. Grok's p against m, scored by Brier on every bracket
   (real and shadow), is the question; demo P&L is reported beside it. A live budget is a later pre-registration on
   Davies' word.
7. **Live has two practical walls.** IG's live minimum stakes (£1 a point on the US 500, £0.50 on the FTSE, Germany 40
   and AUD/USD) put a 0.5 % stop at £17–£63 of risk, so a 1 %-a-trade rule needs a budget of £2,000–£6,000 or a wider
   risk share. And IG's spread-betting agreement forbids automated software without IG's written consent (Term 9(12)):
   Davies needs IG's written confirmation before anything automated deals live.

## 2. IG for a UK retail client

### 2.1 The products

| product | what it is | UK tax | API | notes |
|---|---|---|---|---|
| **Spread bet** (IG Index Ltd) | a bet in £ a point on a market's move; daily funded bets (`expiry` "DFB") roll with overnight funding, futures bets (a month) carry no funding but a wider spread | not a chargeable gain (TCGA 1992 s.51; HMRC CG56105); losses not allowable; no stamp duty; taxable only if the betting is itself a trade (BIM22020) | yes, product code `IGFSB` | the bot trades only these: £ a point makes risk exact, and gains are untaxed |
| **CFD** (IG Markets Ltd) | a contract on the price difference, in contracts | CGT on gains, losses allowable (CG56100) | yes, `IGCFD` | a separate account under the same login, reached by `PUT /session`; shares have no price feed through the API ("Shares trading is available but without share price information", IG Labs FAQ) |
| **IG's options** | IG's own OTC options on indices, FX, commodities (daily, weekly, monthly), as spread bets or CFDs | as the wrapper | yes (`OPT_*` instrument types) | minimum bets: daily US 500 £10 a point, daily FTSE 100 £2, FX options £1, weekly FX £2; spreads 0.4–1.0 points (daily US 500) to 8–16 (weekly FX) (IG options product page, 2026-09-08) |
| **Knock-outs, barriers** | a bull or bear bet on a bought option with a knock-out level; the premium is in the spread; cannot be shorted | as the wrapper | the API's enum lists `KNOCKOUTS_*` | IG UK links a "knock-outs spread bet product details" page (search result; it answered 404 on 2026-10-28); IG's barrier pages found are Ireland's. **Whether a UK retail account is offered them through the API is not settled** (§9) |
| Binary options | — | — | `BINARY` in the enum | banned for UK retail since 2019 (from memory; the FCA page was not re-read) |
| Crypto derivatives | — | — | — | banned for UK retail since 2021-01-06 (FCA, committed page) |
| DMA, share dealing, ISA, SIPP | — | — | no: "Direct market access is not currently available for our APIs"; product codes other than IGCFD, IGFSB, IFFUTOPT refused | not needed |

A defined-risk position exists three ways at IG: a **guaranteed stop** on a spread bet or CFD (filled exactly at its
level, "even if prices move rapidly or gapping occurs"; a premium charged only if it triggers), a **bought option**
(risk = premium paid) and a **knock-out** (risk = the bet's cost). The bot uses the first: it is available on every
whitelisted market (`controlledRiskAllowed` true on all nine epics `ig_facts` id 3 read) and needs no option chain.

### 2.2 The REST API (IG Labs; committed pages `labs_*`)

- **Hosts.** `https://demo-api.ig.com/gateway/deal` and `https://api.ig.com/gateway/deal`. **The demo is a separate
  environment with its own key**, made from the live account's demo login ("Login to the web trading platform with your
  live account; Use the account switcher … to create a demo account"; one key per account). The `ig` function already
  holds a demo key (`IG_API_KEY_DEMO`, `IG_DEMO_USERNAME`, `IG_DEMO_PASSWORD`) for the weekend recorder.
- **Session.** `POST /session` (v2) returns `CST` and `X-SECURITY-TOKEN` headers, valid 6 hours and extended up to 72
  while used; weekend maintenance invalidates every token. `PUT /session` switches account (it returns a new
  `X-SECURITY-TOKEN` and no `CST`, which the `ig` function learned on 2026-10-15). The bot keeps tokens in the isolate's
  memory only and logs in again when IG calls them invalid.
- **Opening.** `POST /positions/otc` (v2): `epic`, `expiry`, `direction`, `size`, `orderType` (`MARKET`, `LIMIT` =
  fill-or-kill at a worst level, `QUOTE` by agreement only), `timeInForce`, `guaranteedStop`, `stopLevel` or
  `stopDistance`, `limitLevel` or `limitDistance`, `trailingStop` with `trailingStopIncrement`, `forceOpen`,
  `currencyCode`, and our own `dealReference` (`[A-Za-z0-9_-]{1,30}`). Constraints from the reference: a stop or limit
  needs `forceOpen` true; **"If trailingStop equals true, then guaranteedStop must be false"**; a guaranteed stop takes
  one of `stopLevel` or `stopDistance`.
- **Working orders.** `POST /workingorders/otc` (v2): `type` `LIMIT` or `STOP`, `level`, `timeInForce`
  `GOOD_TILL_CANCELLED` or `GOOD_TILL_DATE` (`goodTillDate` "yyyy/mm/dd hh:mm:ss" UTC), and, with a guaranteed stop,
  `stopDistance` ("If guaranteedStop equals true, then set only one of stopDistance"). `DELETE /workingorders/otc/{dealId}`.
- **Closing, amending, confirming.** `DELETE /positions/otc` with a body (`dealId`, the opposite `direction`, `size`,
  `orderType`, `level` for a `LIMIT`, `timeInForce`; **no `dealReference`**: IG's reference lists it only in the close's
  answer [audit 2026-10-29]), sent as a POST with `_method: DELETE` by clients that cannot send a body with DELETE;
  `PUT /positions/otc/{dealId}` (v2) sets the stop and limit (both are sent: one left out is removed);
  `GET /confirms/{dealReference}` reads a deal's outcome (`dealStatus` ACCEPTED or REJECTED, `reason`, `dealId`, `level`).
- **Reading.** `GET /accounts` (balance, deposit, profitLoss, available), `GET /positions`, `GET /workingorders`,
  `GET /markets/{epic}` (instrument, dealing rules, snapshot), `GET /markets?epics=` (up to 50), `GET /history/activity`
  (v3, filterable by `dealId`), `GET /prices/{epic}`, client sentiment.
- **Allowances** (FAQ, "default REST Trading API limits"): 60 non-trading requests a minute per app; **30 non-trading and
  100 trading** ("create/amend position or working order requests") a minute per account; 10,000 historical price points
  a week; 40 streaming subscriptions; "no possibility to increase the limits"; "do not create multiple concurrent
  connections as this may lead to your API key being suspended". Using the API is free at these quotas. [audit
  2026-10-29: these are the live defaults. "The limits for DEMO are lower, and have been known to change randomly and
  without notice" (trading-ig's FAQ, https://trading-ig.readthedocs.io/en/latest/faq.html); a key's own are
  `allowanceAccountOverall` and `allowanceAccountTrading` from `GET /operations/application`. Read them before the arm.]
- **Dealing rules per market** (`/markets/{epic}` `dealingRules`): `minDealSize`, `minNormalStopOrLimitDistance`,
  `minControlledRiskStopDistance` (the guaranteed minimum, in points or a percentage), `maxStopOrLimitDistance`,
  `minStepDistance`, `trailingStopsPreference`; the instrument's `limitedRiskPremium` is the guaranteed-stop premium.

### 2.3 What `ig_facts` read on the demo spread-bet account (2026-10-15, read-only SQL)

| epic | market | min size (demo) | min guaranteed distance | GS premium (demo) | live min bet / spread / GS premium (IG UK page) |
|---|---|---:|---:|---:|---|
| `IX.D.SPTRD.DAILY.IP` | US 500 | 0.04 | 4 pts | 0.6 | £1 / 0.4 pt (14:30–21:00), 0.6 otherwise, 1.5 at 22:00–23:00 / 0.25 |
| `IX.D.NASDAQ.CASH.IP` | US Tech 100 | 0.01 | 10 | 2 | £1 / 1 pt, 2, 5 / 1 |
| `IX.D.DOW.DAILY.IP` | Wall Street | 0.04 | 30 | 4 | £0.20 / 3.6 (08:00–14:30) … / 1.8 |
| `IX.D.FTSE.DAILY.IP` | FTSE 100 | 0.04 | 10 | 1.5 | £0.50 / 1 (08:00–16:30), 2–4 otherwise / 0.8 |
| `IX.D.DAX.DAILY.IP` | Germany 40 | 0.04 | 10 | 2 | £0.50 / 1.2 in hours (10-09 review) / 1.5 |
| `CS.D.AUDUSD.TODAY.IP` | AUD/USD | 0.04 | 6 pips | 1.5 | £0.50 / 0.6 min, 0.82 average pip / 1.5 |

Margin 5 % on all six (20:1) in the first bands; the weekend markets (`SUNDAX`, `SUNFUN`) take a 2 % guaranteed minimum
and no trailing stops. **Demo and live differ**: the demo's minimum size is 0.04 where live is £0.20–£1, and its
premiums are higher than the live page's. A demo result at £0.24 a point is not a live result at £1 a point (§8).

### 2.4 Costs, margin, leverage, protection

- **Spreads**: the table above; at the US 500's 7,700 a 0.4-point spread is 0.5 bps.
- **Overnight funding** (positions held through 22:00 UK; Friday counts three): index spread bets "(3.4 % admin fee ±
  SONIA/SOFR) ÷ 365" (360 for non-GBP markets), about 2 bps a night long on the US 500 at 2026-10 rates; FX tom-next plus
  1.5 % a year on one IG page and plus 0.0022 % a day on another (`ig_deepdive` F12/F13, **not settled**); CFDs 3 % (1 %
  FX) instead of 3.4 % (1.5 %) (charges page, 2026-10-28). Futures bets pay none; their carry is in the price.
- **Guaranteed stop**: "Premiums are only charged if your stop is triggered"; value per point × premium.
- **Margin and leverage (FCA, PS19/18, in force 2019)**: leverage capped "between 30:1 and 2:1"; positions closed out
  "when their funds fall to 50% of the margin needed"; "a client cannot lose more than the total funds in their CFD
  account". The tiers (30:1 major FX, 20:1 non-major FX, gold and major indices, 10:1 other commodities, 5:1 shares) are
  ESMA's summary, not re-read at the FCA.
- **Negative balance protection**: "a regulatory requirement in the UK … we are obligated to return your balance back up
  to zero as soon as possible – at no cost to you. Negative balance protection does not apply to professional traders"
  (IG UK help page, committed 2026-10-15).
- **No inactivity fee**; 0.8 % currency conversion on a trade in another currency (a £-a-point bet settles in £).

### 2.5 The terms that bind a bot (IG Index's spread-betting agreement, July 2023)

- **Term 9(12)**: "You will not use any automated software, algorithm or betting strategy other than those that we make
  available to you … without our prior written consent". 9(6) and 9(8) add consent for automated entry and a customised
  interface (REST). A generated API key is probably consent for the API itself; **before anything automated deals live,
  Davies should have IG's written confirmation** (an email to IG's API support) that his account may run it.
- **Term 20(k)**: no latency abuse or practice "whereby you are not subject to any downside market risk". The bot races
  nothing and every position carries market risk.
- **Term 11, manifest error**: IG may void a bet on an obviously wrong price, out of hours and on its weekend markets
  above all ("our quotations reflect our own view").

## 3. The base rate

IG's mandated disclosure: 70 % of retail accounts lose money on its spread bets and CFDs (2026-10-28). The FCA's 2019
rules exist because the losses were systemic. Discretionary retail trading on IG loses on average after spread and
funding; an LLM making the same discretionary calls starts from that base rate, not from zero.

## 4. What this repository already measured on IG (the evidence the bot inherits)

Four rounds of IG research ran 2026-10-09 → 10-18, each frozen before its data:

- **Round 1** (10-09, ~72 arms, Bonferroni |t| ≥ 3.4): only FXW-AUD (fade AUD/USD's Sunday-open gap) clears; calendar
  effects, option selling, short VIX and FX carry are beta, decayed or killed by IG's costs.
- **Round 2** (10-16, 23 arms, 12 families): nothing passes. The pre-FOMC drift went from t 3.09 to 0.83; trend
  following earns a little before IG's overnight fee and nothing after it.
- **Round 3** (10-18, 50 arms): **event days are dead mechanically**: the intraday pre-FOMC drift is gone (train −5 to
  −14 bps); after the statement the move does not continue (t −0.2 to −0.3); CPI and payroll days earn nothing intraday
  because the move happens at 08:30 ET, before the cash open; EIA crude has no persistent first-five-minute direction.
  With 54–184 test trades only an effect of 12–25 bps a trade could have shown.
- **The verification** (10-15 on): FXW-AUD's history passes on independent recomputation; a 200 bps guaranteed stop caps
  its tail for about 3 bps a trade; the weekend recorder (S1b, twelve Sundays) is running.

So a Grok bot is not filling an empty field: the mechanical versions of "trade the event" have been tested and failed
here. A Grok edge has to come from judging the content of an event, which none of those tests could measure.

## 5. Where a Grok-style analyst could plausibly have an edge

GROKPM's lesson, stated precisely: its plausible edge was **event knowledge in markets few people watch** — an outcome
already confirmed while a thin Polymarket book still lagged it, or a researched view in a market nobody else researched.
Even there, the confirmations were priced 25 minutes to 9 hours before the agent first looked, in books with no seller
left (rules study §1). IG quotes no probability, so the translation is a **directional bracket with defined risk**: an
entry, a guaranteed stop and a limit. Its geometry gives the market's own probability: for a driftless price the chance
of reaching the limit before the stop is m = d_stop / (d_stop + d_limit). Grok's p is its probability of the limit
first. That makes every IG trade a binary forecast scored exactly as GROKPM's are.

| candidate | why an LLM could help | why it may not | evidence here | verdict for the bot |
|---|---|---|---|---|
| **5.1 Scheduled releases (CPI, NFP, central banks): positioning before** (category E) | can read nowcasts (e.g. the Cleveland Fed's inflation nowcast), surveys and central-bank speeches and judge the surprise's sign against consensus | consensus forecasts are close to efficient; the price already holds the expected surprise; the release moves faster than any wake; spreads widen at the print | the mechanical event rules are dead (§4); no measurement of an LLM's surprise calls exists here | **allowed, small, with a blackout from T−5 to T+2 minutes**; the test measures it |
| **5.2 After a release: the reaction** (category R) | can judge, within the hour, whether the first move over- or under-shot what the data say, and trade the next hours | the post-statement drift was measured flat (t −0.2); the first minutes are bots' | round 3: no continuation; reversion not tested event-conditionally | **allowed**; the test measures it |
| **5.3 Unscheduled news** (category N) | reads more sources than a person | IG's underlyings price news in milliseconds; a 15–30 minute wake is always late | GROKPM's A confirmations were priced before the agent looked, even in thin markets | **allowed only as a slower thesis (hours to days)**; the prompt says plainly that news older than minutes is priced |
| 5.4 Earnings on single-stock CFDs | reads the release and the call | the API has no share prices; US PEAD and earnings drift were closed here | `reviews/2026-10-09-ig-opportunities.md` §B.5 | **not in this phase** (no share epic on the list) |
| **5.5 IG's weekend markets** | they are priced by IG from client flow with no underlying ("As the only provider of weekend trading, we do not have access to real-time data of underlying asset prices"): the closest thing at IG to a low-attention market; weekend news (elections, wars, policy) is exactly what an LLM reads | Term 11 voids on IG's own weekend prices; spreads 5–8 bps; the edge is unmeasured | WKND: the weekend recorder (`ig_quotes`) is building the first record; nothing scored yet | **not in this phase** (opens are refused from Friday 20:00 to Sunday 22:00 UTC); a candidate once WKND reads |
| 5.6 Options (buying around events) | defined risk; volatility views | IG's options carry 0.4–16 points of spread and a £2–£10 minimum; the bot would need IG's option chain and its pricing | the 2026-10-09 review priced the sales, not buys | **not in this phase**; the rule engine's risk model (premium = risk) would extend to them |
| 5.7 Regime or risk filter | an LLM can refuse to trade into a known risk | Jev's veto in this repository was within chance (`docs/agents/CLAUDE.md`) | measured on crypto only | not a strategy by itself |

**What it all comes to.** The only plausible sources are judgement about scheduled events (5.1, 5.2) and, later, IG's
own weekend prices (5.5). Neither has evidence. The test therefore makes the question cheap to answer: does Grok's p beat
the bracket's m, by Brier, over a few hundred brackets?

## 6. What GROKPM's record does and does not transfer

| what | transfers? | why |
|---|---|---|
| The split: Grok proposes, the server enforces, Grok holds no credential | **yes, whole** | the same function shape, bearer, journal, refusals by rule name, dry-run, arm, lease, sync, desk ledger |
| Grok follows its rules and its schedule | **yes, as behaviour** | 89 cycles on 10-27/28, none over 41 minutes apart; every order checked and correct (utilisation review §2); refusals read and acted on |
| Grok's calibration beats the market's price | **no** | not shown: against the market's last trade Grok scored worse on the 4 resolved shadow forecasts (0.0019 against 0.0004), and its sub-threshold forecasts worse on 9 (0.136 against 0.106); 3 real entries, too few |
| Grok finds an edge often | **no, rather the opposite** | about 2 % of GROKPM's budget was deployed time-weighted since its go and about 10 % since D15; 14 markets cleared a bar in 8 days and 3 could be bought. On IG every market is liquid, so orders will fill; what is rare is an edge |
| GROKPM's P&L | **no** | `[•]` on a handful of positions in a different market structure; nothing to read across |
| The thin-book lesson (a stale mid flatters the agent) | **yes, as a design rule** | IG always shows a two-sided price; the bracket's m is computed from the levels the agent sends and the touch the server reads, never from the agent's own m |

## 7. The design that was built

### 7.1 The shape

```
Grok (outside, scheduled wakes)                                     IG demo gateway
   │  Bearer IGBOT_TOKEN                                                   ▲
   ▼                                                                       │ demo host only
 igbot Edge Function ── ingest.ts (journal, request rules) ── rules.ts (IGBOT_RULES, pure) ── client.ts (IgbotClient)
   │                     exec.ts (context, lease, order/close/amend/cancel, sync)
   ▼
 Postgres: igbot_config · igbot_instruments · igbot_decisions · igbot_cycles · igbot_daily · igbot_requests
           igbot_orders · igbot_positions · igbot_snapshots · igbot_exec_state       (RLS on, no grant, no policy)
   ▲
 pg_cron: edge_calls row `igbot?action=sync` every minute (beat first, watchdog retry)
```

- **Demo only, by construction.** `client.ts` knows one host, `https://demo-api.ig.com/gateway/deal`; `assertIgbotAllowed`
  refuses any other host, scheme, port, path or query before `fetch` (13 refusals pinned). `igbot_config.environment` is
  under `check (environment = 'demo')`. The four secrets read are `IGBOT_DEMO_API_KEY`, `IGBOT_DEMO_USERNAME`,
  `IGBOT_DEMO_PASSWORD` and `IGBOT_DEMO_ACCOUNT_ID`. The client refuses to deal unless that account is one of the login's
  and is a `SPREADBET` account, and logs out if not. **There is no live arming path**: going live is a new
  pre-registration, Davies' word, a migration that drops the check, and code that knows the live host.
- **Two modes.** `dry_run` (the default): every request is read against IG, checked and journalled, and the answer
  says what would be sent; nothing is sent. `demo`: sent to IG's demo gateway. Arming is one statement in 0157's header,
  run only on Davies' word; its undo makes the next minute's sync delete every working order of the bot.
- **The book is the demo account's own**: its equity as IG reports it (balance + unrealised), measured from the arm and
  from each UTC day's first reading. Funding, premiums and fills are all in it, so the money never rests on the agent's
  word. That requires the demo account to be the bot's alone (§10 says so to Davies).
- **Every send is written first**: the order row and its `dealReference` are inserted before IG is called; the
  confirmation is read by the reference IG answers with (an open's is ours; a close's, an amend's and a delete's are
  IG's own [audit 2026-10-29: the build read every confirmation under ours and sent ours on the close, which IG's close
  does not take]); a lost answer stays `unknown` and the sync settles it (go-live audit D3's rule: never rejected on a
  guess).
- **One decision at a time**: a 60-second lease on `igbot_exec_state` taken by every sending action and the sync, held
  again on the live clock just before each send [audit 2026-10-29: it was 20 s, which four IG reads at up to 10 s each
  could outlast].

### 7.2 IGBOT_RULES (`rules.ts`), with the reason for each number

| rule | value | why |
|---|---|---|
| instruments | the six whitelisted DFB epics in `igbot_instruments` (US 500, US Tech 100, Wall Street, FTSE 100, Germany 40, AUD/USD) | each read on the demo spread-bet account, guaranteed stops allowed, the most liquid of IG's markets; a market joins by a migration |
| product | spread bets only (`expiry` DFB, £ a point) | risk in £ is size × points exactly; gains untaxed in the UK |
| guaranteed stop | mandatory on every open, at least IG's minimum distance | the loss is capped at the stop even through a gap; it is also the only way the risk number is exact. No trailing stop (IG forbids one with a guaranteed stop); the agent tightens by `amend` |
| limit | mandatory, reward ≥ 1.5 × risk | gives every trade the bracket the forecast is scored on, and caps the variance of each outcome |
| risk per trade | ≤ 1 % of the budget at the stop, the premium included; and ≤ ¼ Kelly of the bot's own equity (budget + its P&L) at p and R | £10 at £1,000: forty losing trades in a row to the total stop; Kelly as GROKPM's D3/D8 |
| edge | p ≥ m + 0.08, m = d_stop/(d_stop+d_limit) from the worst fill accepted | GROKPM's category-A bar (8 points), against the bracket's own driftless probability; the agent cannot supply m |
| total risk | ≤ 3 % of the budget at the stops (positions and working orders) | three trades at full risk |
| open at once | ≤ 3 positions and working orders together | as above |
| one per market | no second position or order in a market: no adding, no averaging down, no hedging | the most common way a retail book blows up |
| notional | ≤ 5 × the budget | an effective leverage cap well under the FCA's 20:1 on indices |
| immediate deals | IG `LIMIT` fill-or-kill: the level is the worst fill accepted, at most a tenth of the stop distance beyond the touch | slippage bounded, and risk computed at the worst fill |
| working orders | `LIMIT` or `STOP`, good-till-date 5 minutes to 24 hours, never resting into a release window or past Friday 20:00 UTC | no stale order picked off; no unattended weekend entry |
| release blackout | no open from 5 minutes before to 2 minutes after a listed CPI, NFP, FOMC, ECB or BoE release (`agents/cb_releases.ts`, listed to 2026-12-31) | spreads widen and fills slip at the print; positioning before and the reaction after stay allowed (categories E and R) |
| weekend | no open from Friday 20:00 to Sunday 22:00 UTC | the weekend markets are a later candidate (§5.5) |
| categories | E (a **listed** release within 72 h ahead, `event_at`), R (a listed release within 24 h behind), N (news); C for changes; every open ≥ 1 source and an invalidation | GROKPM's journal discipline [audit 2026-10-29: the build took any time as `event_at`] |
| day stop | −£20 (2 %) from the day's first equity reading: no open until 00:00 UTC, latched | GROKPM's latches (D4) |
| total stop | −£100 (10 %) from the arm: close-only to the end, latched; the test ends as a FAIL | as GROKPM's |
| max hold | the server closes a position held 5 days | funding (≈ 2 bps a night on indices) and stale theses |
| order rate | ≤ 3 trading requests a minute and ≤ 40 a UTC day; ≤ 4 IG-reading actions a minute and 300 requests an hour from the agent; ≤ 24 IG requests a minute for the whole function, kept in `igbot_requests.ig_calls` (0159), and the client's own count for its isolate | IG's 30/100 a minute per account (lower on the demo) [audit 2026-10-29: the client's count was per request, so nothing held the minute's total] |
| gates | the global pause (nothing sent but cancels; the sync deletes working orders), armed, credentials read, equity read (no open on an unread book) | the project's kill switches reach IG too |

All of it is pinned in `igbot/rules.test.ts` (15 tests, each rule broken alone and refused under its own name, with the
numbers worked by hand) and `igbot/index.test.ts` (19 tests: the bearer; the guard; dry-run; the order row before the
send; refusals storing nothing; resends sending nothing twice; the lease; the stops; close and amend; the journal; the
action budget; the views; the sync's beat, history closes with the premium, the five-day close, the kill switch).

### 7.3 What it does not do (yet)

No CFD, option, knock-out, share or weekend market; no streaming (REST snapshots only); no TESTING-page row (the record
is in the tables; a page can follow the first demo week); not among the monitor's health readings (a demo path moves no
money). Funding is read in the account's equity, not split per position. How a stop- or limit-triggered close is read
from `/history/activity` (the SYSTEM channel, the nearer level) is from IG's reference and must be confirmed on the first
demo closes (§9).

## 8. What a demo test can and cannot show

- **Power.** A bracket with R = 2 pays +2 or −1 risk units; at p ≈ 0.4 its standard deviation is about 1.5 units. To
  show a true edge of +0.2 units a trade at t = 2 needs about (2 × 1.5 / 0.2)² ≈ 225 trades. At three to five real
  trades a week that is a year. **A six-week demo cannot prove an edge in P&L.** It can show a gross failure, the agent's
  discipline, and, with shadow brackets, its calibration.
- **Calibration is the measurable question.** Each real bracket and each `no_action` shadow bracket (same fields, no
  order) resolves to 1 (limit first) or 0 (stop first) on IG's own prices. Grok's Brier against m's, paired by bracket,
  over a few hundred brackets in six weeks, has the power P&L lacks. That is the pre-registration's primary reading.
- **Demo fills are indicative**: IG documents nothing about their likeness to live, and the demo's sizes and premiums
  differ from live (§2.3).
- **Live sizing.** At IG's live minimums a 0.5 % stop risks £38 on the US 500 (£1 × 38 pts), £27 on the FTSE, £63 on the
  Germany 40, £52 on Wall Street, £17 on AUD/USD. A live phase at 1 % a trade needs £2,000–£6,000, or wider risk shares on
  a smaller budget; the draft proposes £2,500 at 1.5 % (£37.50) on the four cheapest markets, for Davies to decide later.

## 9. Not settled, not checked

- Whether **knock-outs and barriers** are on a UK retail account and through the API (the UK page answered 404; the
  barrier pages found are IG Ireland's). A demo `GET /markets?searchTerm=` on knock-out names settles it.
- **FX funding**: tom-next + 1.5 % a year or + 0.0022 % a day (IG's pages disagree).
- **The close's channel and level in `/history/activity`** for a guaranteed stop or a limit triggered by IG: built from
  the reference; confirm on the first demo closes. IG's reference does not say whether the `dealId` filter matches the
  closing activity, so the sync reads the whole account's history since the open when it finds nothing [audit
  2026-10-29]. **`MARKET` closes on spread bets**: IG's reference lists "error.trading.otc.market-orders.not-supported" for
  some accounts, and all six markets read `marketOrderPreference` AVAILABLE_DEFAULT_OFF on the demo (`ig_facts` 3).
  [audit 2026-10-29: the close is now the `LIMIT` fill-or-kill at the exit touch less three spreads or 5 bps.]
- **Two sessions on one demo login**: if Davies reuses the weekend recorder's demo login for the bot, whether IG's
  sessions interfere was not tested; a separate demo login is recommended.
- **IG's written consent under Term 9(12)** for automated dealing: not asked.
- **Irish tax** on spread-bet winnings (Davies is resident in both): TCA 1997 s.613(2) exempts betting winnings from
  chargeable gains; whether he is taxed in the UK, Ireland or both is for an adviser.
- **LLM forecasting quality** in general: published studies of retrieval-augmented LLM forecasters report results near,
  not above, crowd aggregates (from memory; not re-read here).
- The FCA's leverage tiers were not re-read at source; the binary-options ban is from memory.
- No IG price was read today; nothing was placed on the demo.

## 10. What Davies does (no secret in a chat or a commit)

1. Make a **demo** login for the bot (recommended: its own, from the live account's demo switcher; or reuse the
   recorder's), and its **demo** API key (My Account → Settings → API keys, while switched to demo).
2. Store four Supabase Edge Function secrets: `IGBOT_DEMO_API_KEY`, `IGBOT_DEMO_USERNAME`, `IGBOT_DEMO_PASSWORD`,
   `IGBOT_DEMO_ACCOUNT_ID` (the demo spread-bet account's id, from the demo platform's account switcher). And
   `IGBOT_TOKEN`: 32 or more random characters, given only to Grok.
3. **Never deal by hand in that demo account**: its equity is the bot's book. It must hold nothing when the dry-run
   starts: the server refuses every open while it holds a position or working order the bot did not place
   (`account_shared`, audit 2026-10-29).
4. Configure Grok with `docs/agents/igbot/GROK_PROMPT.md` and its schedule.
5. After the dry-run rehearsal, say go for the demo arm (0157's statement). Live is a separate decision, much later.

## 11. The independent audit of 2026-10-29

Davies (2026-10-28): "有任何问题或漏洞的话指出并修复，确保一切细节完美我再发grokbot". An independent session read this review, the
server, 0157, the prompt and the draft pre-registration against IG's reference (labs.ig.com, `positions-otc`,
`history-activity`), the demo facts (`ig_facts` id 3) and the code, before the prompt went to the agent. Corrections made
in place above are marked "[audit 2026-10-29]". What it found and changed (the ledger's entry of 2026-10-29 has the list
ranked, the commits and the tests):

- The close was a `MARKET` order carrying our `dealReference`; IG's close takes no reference, and the demo's six markets
  default market orders off. Now a `LIMIT` fill-or-kill at the exit touch less max(3 spreads, 5 bps), confirmed under the
  reference IG answers with.
- The five-day close used its decision id once: a refusal (a closed market at the weekend) left the position open for
  good. It now waits for the market and tries again ten minutes after a refusal.
- The sync deleted, booked and five-day-closed whatever the demo account held, in dry-run too. It now touches only what
  the bot placed (our reference prefix, or an id IG answered our order with); anything else is reported and blocks opens
  (`account_shared`), since the account's equity is the book.
- The IG allowance was counted per request; it is now held for the function in `igbot_requests.ig_calls` (0159).
- A position missing from IG's list was booked closed `unknown` the first minute its close was not yet in the history;
  it now waits fifteen minutes and also reads the account's history without the deal filter.
- The pre-registration resolved shadow brackets on IG's hour bars that nothing recorded; the sync now records them
  (`igbot_bars`, 0159), and the scorer is written (`docs/agents/backtests/igbot/score.mjs`). Its baseline was the
  bracket's own m, which overstates the limit's chance by the spread, and an hour reaching both sides counted as the
  stop: both reward a forecaster who shades p down without skill. The draft now scores against the exit side's m and
  excludes ambiguous hours, with an oracle-shift guard in the bar.
- Smaller: a percentage premium read as points; IG's guaranteed distance measured from the level, not the touch; IG's
  limit distances unchecked; E and R accepting any time; nothing stopping opens after the release list ends; a second
  open allowed while the first's answer was unknown; 429s locking the agent out of its own next minute.
