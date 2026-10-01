# The research round of 2026-10-01: where everything stands, what to change, what to add

Davies, 2026-10-01: "目前在测的和交易的策略以及只测量、不交易的研究都进展如何？研究下有值得优化的地方或者值得新加入paper
trading或测试与测量的策略吗？" How are the strategies that trade, the tests and the measurement-only studies doing; is
anything worth optimising; is anything worth adding to paper trading or to testing and measurement?

The coordinating session read production's health itself and ran three research agents: the trend family (status and
optimisation), new candidates in crypto, prediction markets and the quote family, and US equities. Every read stayed
inside each frozen test's no-peek list (§6). The coordinator re-ran every script whose number is quoted here, from the
committed folders, and each output came back byte-identical; it re-fetched AVAX's volume itself. Nothing here is
evidence of an edge, and nothing was pre-registered or frozen.

## 1. Where everything stands (2026-10-01, 00:20–00:40 UTC)

| Row | What it is | State | Next date |
|---|---|---|---|
| `trend-4h-live` | live, Revolut X, $100, cap $25 | 152 of 152 decisions, a median 5.1 s after the close; one round trip (SOL, the 09-25 08:00 bar to the 09-28 04:00 bar), −$0.66 with $0.053 of fees; flat | — |
| `trend-4h` | paper control, $1,000 | 4 round trips, −$11.86 (−1.19 %) | — |
| `trend-1h` | paper, $1,000, Jev in shadow | 5 round trips, −$8.76 (−0.88 %) | — |
| `momentum-1d` | paper, $1,000, Jev in shadow | BTC, ETH and SOL open, +$38.92 (+3.89 %) at the UK mid | — |
| PR5 | GBP stablecoin quotes, paper | 54 round trips, all closed, +$7.22: $0.98 a day over 7.4 days against the plan's $0.42, but 09-28 alone made $4.93 (31 trips); 2 lost | review 10-21 |
| PR5's live path | dry-run, unarmed | no error, no guard | after 10-21, on Davies' word |
| PR5V, variant-2 | paper replays of PR5's minutes | caught up, no error; variant-2's check $0.00 over 3 days | reading 10-28 |
| RW | Polymarket reward quotes, paper | 6 of 14 days: +$711.62, of which estimated rewards +$1,194.62 and trading −$482.99; stress −$100.68; 1,617 fills | verdict 10-09 |
| RW-E, RW-X1–X3 | replays of RW's minutes | no error; checks $0.00; nothing diverged | verdict 10-09 |
| RW-C | RW's rule forward | not started | warm-up 10-08, verdict 10-23 |
| QUEUE | Revolut X book recorder | about 1,250 rows a day on each GBP book | window 10-04 → 11-01 |
| PR5-W | PR5 at weekends | first forward weekend from 10-02 21:00 | reading 11-25 |
| MX-1 | maker probes | 0 eligible exits: no row has had an entry signal since 09-27 08:00 | at 150 exits or 2027-06-30 |
| EX-GAP | live fill against its paper twin | 2 pairs | at 16 pairs or 2027-01-31 |
| JEV-DRIFT | the gate's drift monitor | 0 checks: no entry answer since it went live | — |
| VIEWS | YouTube view recorder | about 3,200 view reads a day; quota 2,872–3,509 of 10,000 a day | study ~10-25 → 11-08 |

Health: `edge-calls-every-minute` ran 1,440 of 1,440 minutes in 24 h. In the six hours `net._http_response` keeps,
4,534 calls answered 200, 4 answered 503 and 3 answered 520, and every engine caught up. No `ops_errors` row in 24 h;
since 09-28, four connection resets on lease reads (none the tick) and one client timeout.

The three paper trend rows' records are ten days long. They say the rules run as written, not whether they earn:
`trend-4h` traded about three times its backtest rate (three of its four entries on 09-21), `trend-1h` about twice.
Since v2 (09-23) the gate answered four entries, all at 0.56–0.74, and vetoed none; the three vetoes on record were v1's.
Every exit was the rulebook's 3×ATR close trail; the 8 % floor has never fired.

## 2. The trend family

### 2.1 CAP: the live row's cap is one slot of four, and no study had priced that

`agent_risk.max_exposure_usd` is $25 against a $100 row of four $25 slots, so `riskGate` refuses every entry while one
coin is held (`exposureUsd + orderUsd > maxExposureUsd`, exposure marked to market). Every figure behind the live row
(§3.11, §3.19, §3.20, go-live §4) adds four independent slots. `backtests/cap/scripts/cap_study.ts` steps the four coins
together exactly as `run()` does (equal to `run()` on all 16 coin-window cells, worst difference 0), adds the tick's
gate, and books $25 slots into one $100 book (Coinbase hourly tape, seeded parameters, Revolut X costs):

| Window | $25 (one slot) | $50 (two) | $100 | $110, or no cap |
|---|---|---|---|---|
| A, 2025-09-10 → 2026-09-21 (bear) | +$11.77, DD 7.3 % | +$12.11, 9.2 % | +$10.52, 16.7 % | +$11.56, 16.7 % |
| B, 2024-08-31 → 2025-09-21 (bull) | +$8.91, 8.7 % | +$24.79, 6.4 % | +$25.72, 10.2 % | +$26.65, 11.7 % |
| 2023-10-20 → 2026-09-30 | +$43.81, 6.8 % | +$57.80, 6.9 % | +$83.08, 11.6 % | +$94.23 / +$92.17, 11.5–11.6 % |

- **One slot is a different strategy**: the first coin to break out takes the only slot, and the coin list's order
  breaks ties. Over all 24 orders, window B's one-slot result is $8.91 / $18.64 / $18.64 (min / median / max), and
  the row's own order (BTC, ETH, SOL, AVAX) is the minimum. Two slots give $24.79 in every order.
- **A $100 cap is not four slots.** Exposure is marked to market, so it refuses a fourth entry whenever the open
  positions are up (4, 12 and 33 refusals). Four true slots need about $110.
- **What four slots cost**: drawdown 11.6–16.7 % against 6.8–8.7 %; all four 8 % floors on one day lose about $8,
  over the $5 daily limit, which never refuses an exit; the book fell $5 from a day's open on 0, 2 and 6 days.
- **Frozen tests**: the slot stays $25, so EX-GAP's unit does not move; its 14 remaining pairs come in about 48–68 days
  at four slots against 96–128 at one (inference: every live fill pairs). MX-1 and JEV-DRIFT are untouched.
- **What it is not**: the windows were seen by every earlier study, so the two-slot row's better return on drawdown is
  not a finding. This is a sizing screen. The cap level is Davies' decision (ledger item 3).

### 2.2 AVAX's UK book: about $31k a day, not $1.9m

§3.8's table quoted "24 h quote volume" from one 24-hour ticker read on 2026-09-21, 13:35–13:55 UTC. For AVAX that
was the month's largest day. Revolut X's public UK daily candles, 2026-08-31 → 09-29 (`backtests/cap/inputs/`,
re-fetched by the coordinator with the same result):

| Coin | 30-day median a day | Days under $100k | Spread, median of `agent_basis` |
|---|---|---|---|
| BTC | $1.82m | 0 | — |
| ETH | $1.06m | 0 | — |
| SOL | $631k | 1 | — |
| AVAX | $31k | 22 | 9.71 bps (2,723 samples; p99 14.3; over 50 bps 0.04 %) |
| SUI (paper only) | $165k | 10 | 23.6 bps (over the 50 bps guard 6.05 %) |

AVAX's monthly medians have been $10k–$32k since 2025-11 ($9.9k–$31.6k by UK day). So AVAX does not clear §4.15's
book test as written. §4.15 also says the bar admits a coin and does not certify the ones already in, and that the
sleeve's number governs money; the book test is about trading at size. At $25 an order is 0.08 % of a median day,
and one snapshot held about $8.6k each side at the touch. The seat is Davies' call. From here a book test is read
on a 30-day median of the daily candles, not on one ticker.

### 2.3 Nothing else is worth changing now

- **The coin list.** Of 306 active UK USD pairs, the new names over $100k on 2026-10-01 (QNT, ONDO, INJ, BERA, CRV,
  VIRTUAL) are all under it on a 30-day median ($1.6k–$61k). Of §3.8's 27 only AAVE crossed ($198k), and it fails
  window B. A screen is not worth running: the bar's own null gives about 1.8 chance passers in 23 (§4.15).
- **The Jev gate.** v2 is priced (§4.21) and deterministic per state; the shadow rows have one answer in five days and
  a forward test would need 5–18 years (§3.43). Only a JEV-DRIFT flag would reopen it.
- **Execution beyond MX-1 and EX-GAP.** Both live IOCs filled at once; 1 bp a fill is worth $0.10–0.26 a year at $25
  orders, and 2 bps would take about 400 fills to see.

## 3. New candidates in crypto, prediction markets and the quote family (fp7)

Nothing new clears a sensible prior as a paper strategy; one measurement is worth keeping in mind, conditionally.
`backtests/fp7/` (run its scripts from that folder).

- **The catalogue first.** About 400 ideas are already tested, running or decided: §3.1–§3.43, the reviews, fp1–fp6,
  and fp5's unmerged Polymarket branch (`31250cab`), where copy-trading (COPY), FADE and a Deribit digital (VOL)
  failed. Nothing below repeats one.
- **The quote family has no untried book.** Revolut X configures 455 pairs; its UK side has 393 books, quoted in USD
  (306), GBP (64) and USDC (23). The only stablecoin-against-currency books are the four PR5, PR6 and QUEUE use
  (USDT/GBP 5.31 bps, USDT/USD 1.0, USDC/USD 2.0, USDC/GBP 5.31). USDC/EUR is configured but has no UK book.
- **The 23 coin/USDC UK books are dead as maker quotes.** Seven days of UK prints (09-24 → 10-01) against Binance's
  coin/USDC 1-minute closes: 26–133 real prints a book (the rest under $1), a ceiling of $0.13–0.51 a day a book, and
  the 5-minute drift on those fills takes back as much or more (at k = 10 bps: SOL −$3.94 against a +$2.35 ceiling,
  HBAR −$14.39 against +$2.15, LINK −$6.84 against +$3.25). At k = 20 bps the quote re-prices about once a minute,
  beyond the 1,000-a-day order budget.
- **The payers nobody had examined each fail**: the UMA disputer's bounty (the first disputer takes it, so it is a
  race; 11 of 35 votes went against the dispute); Polymarket Combos makers (signed quotes within 400 ms, so an
  always-on process, and positions under the Ireland rule); listing announcements (a race, ruled out with FAST-A);
  token unlocks (spot can only bet on a rebound, the drift after forced selling continues down, and a +2 % mean needs
  about 1,200 events).
- **POOLAGE, measurement only, conditional.** Polymarket pays $245,745 a day over 18,776 rewarded markets
  (2026-10-01, keyless aggregates; the per-market list was deleted unread because it could show RW's selection).
  12,830 of 18,784 active reward configs (68.3 %), carrying $212,814 of $248,746 a day (85.6 %), began 09-29 → 10-01,
  so the reward money sits mostly in pools a few days old (inference: many are short-lived daily markets). How fast
  other makers arrive on a new pool is unmeasured, and RW selects once a day. Step 1 costs nothing new: after RW's
  verdict, read RW's own `others` score by minute of day. Step 2, a recorder (200 pools born each day, each book read
  at 5 minutes to 16 hours), only if RW or RW-E passes on 10-09 and step 1 shows competition arriving over hours; its
  data covers RW-C's markets, so it is not read before 10-23 00:05 UTC. The prior that it ever earns this account
  money is under 5 %. Not built.
- **What would change the answer**: a venue where this account may open event positions (Smarkets' event list
  answered keylessly; Betfair's API needs a key); RW-C or QUEUE passing; a keyed weather source as fast as the
  takers; a venue change, such as a larger order budget or a new GBP stablecoin book (`scripts/revx_census.py`
  re-checks in seconds).

## 4. US equities, phase 1 (EQ1)

Can a US-equity rule earn a paper row in the account Davies already has (Trading 212, GBP, Invest and Stocks ISA)?
On its merits, no. `backtests/equity/`.

- **Cost decides most of it.** Trading 212's API spec: "Orders can be executed only in the primary account currency"
  and "Multi-currency accounts are not currently supported through the API"; the ISA has no multi-currency at all. So
  an automated loop pays the 0.15 % FX fee each way on every USD instrument, 30 bps a round trip. Commission and
  custody are free. Shorting exists only in the CFD account, which the API does not serve, so everything here is
  long-only. US-domiciled ETFs stay closed to UK retail (CCI replaced PRIIPs on 2026-04-06, not a free pass). The API
  has no auction orders, and its order endpoints are not idempotent in the beta. A demo server is documented as
  "Paper Trading (Demo)" and needs a key made in the demo account.
- **Screening on Ken French's CRSP-based files to 2015-12-31 only** (the script cuts every series as it parses it and
  asserts no later row survives; 2016-01 → 2026-09 is held out and unseen):

  | Idea | 1926/27–1989 | 1990–2015 | 2003–2015 | Verdict |
  |---|---|---|---|---|
  | Turn of the month (4-day window, per event over the rest) | +0.62 % (t 8.6) | +0.27 % (t 2.2) | +0.18 % (t 1.0) | the one with a named payer; decayed |
  | 10-month trend on the market (a year over buy-and-hold) | −1.24 % | −0.23 % | +0.07 % | a drawdown rule (−17.3 % against −50.3 %), not an edge |
  | Top 3 of 12 industries by momentum (a year over all 12) | +2.41 %, IR 0.32 | +2.80 %, IR 0.35 | +1.90 %, IR 0.27 | 50–115 years to t = 2 net of cost |
  | Big-cap one-month reversal, long leg (a year) | +2.39 % | +0.12 % | −1.60 % | gone; 4.1–17.7 % a year of FX cost |

- **Post-earnings drift** can be timed exactly from SEC EDGAR (8-K item 2.02 acceptance times; of 236 filings by
  twelve large caps, 140 after the close, 96 before the open, none in regular hours), but large-cap drift is reported
  gone since 2006 (Martineau 2022) and a year forward detects only 1.5–3.0 % a hold. Overnight drift (85.7 % a year of
  cost with FX) and pre-FOMC drift (gone after 2015; the LSE shuts before 14:00 ET) fail on arithmetic.
- **If anything is pre-registered**, it is the turn of the month on CSP1.L (the S&P 500's GBP line, no FX) over the
  unseen 2016-02 → 2026-09: 128 month-turns, smallest detectable effect 0.46 % a turn, power 26 % at the 1990–2015 size
  (13 % under Holm-3). A pass would justify a twelve-trade-a-year paper row; the likely fail closes US equities at this
  size. Not frozen: whether US equities are in scope at all is Davies' call.

## 5. For Davies to decide

1. **The live row's cap.** The go-live brief's sequence was one slot for the first round trip, a person reads it
   back, then two slots, then after a clean week all four with headroom (its $30 and $75 on the $50 book; $150 in the
   $100 draft). The first round trip settled clean on 09-28 (both IOCs filled on the first attempt, D11 booked the
   coin fee, the book flat). Scaled to $100 the next steps are **$60** (two slots with the brief's 20 % headroom) and,
   after a clean week, **$150** (four slots; $110 is the least that holds four, §2.1). CAP adds the reason not to stay:
   one slot is the one arrangement no study priced, and its result depends on the coin list's order. The change is
   one statement in the conversation where he says it (`update public.agent_risk set max_exposure_usd = … where
   id = 1;`), as ledger item 3 says.
2. **AVAX's live seat**, now that its UK book reads $31k a day. The coordinator's view: keep it at $25, where the
   touch carries the order; re-check the book before any raise of the live capital; read every book test on a 30-day
   median from here.
3. **US equities**: in scope or not. If yes: which account (ISA or Invest), GBP-line UCITS ETFs only (long-only, no
   FX), whether to make a Trading 212 demo key, and whether the turn-of-the-month held-out test at 26 % power is worth
   pre-registering.
4. **Nothing to add to paper now.** POOLAGE is looked at again on 10-09 with RW's verdict, and only if RW or RW-E
   passes.

## 6. What was read, and what was not

- Production, SELECT only. The coordinator read state rows' `last_minute`, `updated_at` and `last_error`; from PR5V's
  and variant-2's states only `codeVersion`, `checkMaxUsd` and `checkDays`; from RW-E's and RW-X's states only their
  check scalars and the length of RW-E's `diverged`; RW's day rows without `detail`; PR5's own round trips; counts and
  timestamps of `agent_book_levels`, `yt_video_reads` and `pm_view_books`; `ops_errors`; `cron.job_run_details`;
  status codes of `net._http_response`. RW's state also returned `dayActive`, the day's 39 active market ids: no
  figure of any market.
- The trend agent read the four strategy rows' decisions and orders, each row on its own; `agent_maker_probes` once,
  as MX-1's count (columns symbol, side, ts, order_id, strategy_id, venue); EX-GAP as a count that selects no price, fee
  or time. No live-against-control gap was computed. Nothing of `agent_quote*`, `pm_rw*`, `pm_rwc_*`,
  `agent_book_levels`' contents, `yt_*` or `pm_view_*`.
- The other two agents read no production table.
- fp7 also read Revolut X's UK prints of four coin/USDC books and Binance's coin/USDC 1-minute klines (09-24 → 10-01),
  Polymarket's reward aggregates and docs, and probed Smarkets' and Betfair's public endpoints once each.
- Public data: Coinbase hourly candles (2023-09-20 → 2026-10-01; BTC, ETH, SOL, AVAX); Revolut X's public pair list,
  UK tickers, daily candles (30 days for 20 coins, 12 months for five) and one book snapshot; Ken French's files cut
  at 2015-12-31; Yahoo metadata only (currency, exchange, first date, bar count) for SPY and nine LSE lines; EDGAR
  filing metadata for twelve filers; Trading 212's API spec and help articles.
- The CAP screen used windows every earlier study had seen; no window was held back, and it proposes no hypothesis.

## Files

- `backtests/cap/`: `scripts/cap_study.ts` (run from `scripts/` with Deno 1.46.3) → `results/cap_study.json`;
  `scripts/pnl.py` → `results/pnl_out.json` from `results/orders.json`; `scripts/revx_universe.py` →
  `results/revx_universe_out.json`; `scripts/fill_rate.py`; `results/queries.sql`, every statement with its output;
  the pulls `scripts/pull_coinbase.py` and `scripts/revx_daily_volume.py` and what they wrote, in `inputs/`.
- `backtests/equity/`: `scripts/screen_french.py` → `results/screen_french.json`; `scripts/power.py` →
  `results/power.json`; `scripts/edgar_timing.py` → `results/edgar_timing.json` (fetches live; set `SEC_USER_AGENT`);
  `inputs/` the four Ken French files it reads (built from CRSP 202608) and Trading 212's API spec.
- `backtests/fp7/` (run from that folder): `scripts/revx_census.py` → `samples/revx_census_2026-10-01.txt`;
  `scripts/pull_usdc_books.py` → `samples/usdc/`; `scripts/screen_usdc_books.py` → `samples/usdc/screen_result.txt`;
  `scripts/reward_universe.py` and `scripts/reward_births.py` (live, aggregates only) → `samples/pm_*.txt`.
- Each folder's `MANIFEST.json` lists every file with its sha256.

## 7. Addendum, 2026-10-01 02:24 UTC: the live cap is $60

Davies, the same morning: "按照你的建议验证后确定好了就去做，确保上线的这个策略各个方面都最佳" — verify the recommendation
($60 now, $150 after a clean week; AVAX kept) and then do it, and make sure every aspect of the live strategy is at
its best. An audit agent checked it read-only and the coordinator re-ran its work from the committed folders
(`backtests/cap/`, byte-identical).

- **The statement is aimed right.** `agent_risk` holds one row (`CHECK (id = 1)`), and `max_exposure_usd` is the only
  setting that held the row to one slot: the per-order limit is the slot × 1.1 ($27.50), the 40-order cap and the $5
  daily limit were never close, and nothing else trades in the `revx|live` bucket.
- **The tick does what CAP assumed.** An entry placed earlier in a turn counts against the next coin's gate; with all
  four coins signalling on one bar it places 1 / 2 / 2 / 4 / 4 / 4 live orders at $25 / $50 / $60 / $100 / $110 / $150,
  in the row's coin order. Now pinned in `agents/tick.test.ts` ("live row: …"), with a buy the venue refuses for lack
  of USD (recorded rejected, reported, not re-sent on the bar) and the daily loss limit across two live positions
  (a third entry refused, both floors still sell). No code defect was found on the paths two or four concurrent
  positions use for the first time (exposure, D11/D12 per coin, the floor, the loss limit, the order cap,
  reconciliation, re-sends, the cooldown).
- **$60 is the true two-slot cap.** Exposure is marked to market, so $50 is two slots only while the first position is
  at or below cost. On the Coinbase tape, $60 against $25: window A +$11.24 against +$11.77 (drawdown 13.9 % against
  7.3 %), window B +$26.31 against +$8.91 (7.8 % against 8.7 %), three years +$81.49 against +$43.81 (9.0 % against
  6.8 %, the best return on drawdown of any cap). On Revolut X's own UK 4h tape (`scripts/cap_revx.ts`, window A and the
  venue's rolling year): +$8.16 against +$9.87 (15.0 % against 7.5 %) and +$1.10 against +$3.89. More slots help the
  bull windows and add drawdown in the bear one; no cap wins everywhere, and these windows were seen before.
- **Money, not code, limits four slots.** The tick does not check USD before a live buy. The account holds $99.34 (the
  read-only probe, 01:56 UTC: USD total and available 99.34, nothing reserved, no coin, no open order). Two slots need
  $50.10; four need $100.20, and never refusing an entry over the windows needed $104–$115 (`results/cash_needed*.json`).
- **Done:** `update public.agent_risk set max_exposure_usd = 60, updated_at = now() where id = 1;` at 2026-10-01
  02:24:51 UTC, read back (daily limit $5, 40 orders, `global_pause` false, `live_confirmed_at` unchanged); the next
  minutes ran with no error. Every other setting has a priced reason in reference §3–§4 and nothing new against it.
- **Next:** on 2026-10-08 the clean-week checks (`scripts/cap/clean_week.sql`, AVAX's book by `scripts/cap/book_30d.py`,
  the probe); $150 only if they are clean and the account holds at least $100.20 (about $115 recommended).

## 8. Addendum, 2026-10-01: EQ2, US strategies in the USD Invest account and the GBP ISA

Davies, the same morning: his Trading 212 Invest account's primary currency is USD, so the API's orders in the primary
currency carry no FX on US instruments ("可以探索研究美元策略，你深度研究下"); his Stocks ISA is GBP; and post-earnings
drift and the turn of the month are worth deep research if still promising. One `opus-max` agent, screens on Ken
French's CRSP-based files cut at 2015-12-31 as they are parsed (`backtests/equity2/`, every output re-run byte-identical
by the coordinator for the DFC screens).

- **Without FX the verdicts stand: power binds, not cost.** A forward paper test would need 11–36 years to confirm any
  candidate, so a held-out historical test is the only statistical test available; paper and a demo account can only
  check execution. Industry momentum, big-cap reversal (daily-formed: +1.95 % a year, t 0.75, in 2003–2015), low
  volatility (−0.67 % a year against the market in 2003–2015), overnight drift (7.6–10.1 % a year of spread), index
  additions (0.8 % and insignificant in the 2010s, Greenwood & Sammon 2025), pre-FOMC drift and pension rebalancing
  (its published sample covers the held-out years) all fail.
- **Post-earnings drift is not worth a test.** 9.33 % of S&P 500 member-time in 2016–2026 belongs to names Yahoo no
  longer serves (99 of 106 acquisitions), so no clean historical test exists keylessly; Martineau (2022) already covers
  2016–2019; a forward test has 26 % power after three years for a 0.5 % drift.
- **EQ1's turn of the month is the weakest part of the month-end pattern since 1990** (held-out power 0.21–0.38), and
  even a pass would lose 4.6–7.4 % a year against holding the index.
- **DFC, the month-end dash for cash (Etula et al. 2020), is the one test worth running.** Its payer is institutions
  selling by the settlement deadline to pay out at the month end. Before 2016 the per-day spread between the buy-back
  and selling windows was 15.46 bp (t 3.82) in 1990–2015 and steady by decade; the one rule that can beat the index,
  out over the selling window and in otherwise, made +2.43 % a year net of 8 bps over 1990–2015 but −0.02 % in
  2010–2015, its t only 1.41. Pre-registered (`reviews/2026-10-01-dfc-prereg.md`), reviewed independently, frozen and
  run once on CRSP's unseen 2016-01 → 2026-08; expect a fail.
- **Second and third**: the Treasury auction cycle on IDTL (held-out power about 0.42) and industry seasonality (no
  named payer); drafted, not frozen.
- **Guardrails for any live path** (EQ2 §4): both accounts hold Davies' own portfolio, which the app reads. A loop
  would need an instrument allowlist disjoint from his holdings, a loop-owned quantity it never sells beyond, a pending
  row before every order (the beta API's orders are not idempotent and carry no client id), reconciliation through the
  order history, a separate trading key, caps and a kill switch, and changes to the portfolio sync so his board never
  counts the loop's positions. No trading key before a pass, a paper row and a demo-account test.
- **EQ1's parser** compared missing codes after dividing by 100; fixed, and its results re-ran byte-identical.
