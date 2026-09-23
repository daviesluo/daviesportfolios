# Go-live audit: `trend-4h-live` and PR5 on Revolut X (2026-09-23)

Davies asked for both candidates to be verified in depth before either goes live ("请全面深度验证并确保这两个策略都是最佳…你验证认为可以上线的话就做好上线准备").
An independent agent audited them adversarially and wrote everything below the rule; its patches are in
`2026-09-23-golive-audit-patches/` beside this file. **Nothing here has been applied**, and an agent's claim is not a fact
until it is re-computed here.

## What was re-computed here, and what was not

* **D1 is real.** `agents/index.ts` awaits `kraken.refreshFees()` with no catch, and production's `ops_errors` holds
  `agents.crash` rows reading "Signal timed out." at the times the audit gives. P1 was read and applies to `main`.
* **Every patch still applies** to `main` at the commit that adds this file (`git apply --check`, the combined diff and P1).
* **Not yet re-computed here:** D2's dead-IOC rates on the UK book, D3–D10, the pricing of the draft's configuration, and
  PR5's figures. Each is re-run before its patch lands. The audit's scripts, tape copies and worktree stayed in the
  session's scratch folder and are not committed.

---

Independent and adversarial. Tree audited: `origin/main` at `8d4a5fe` (detached worktree `wt/`). Main moved to `3b8e4f4` during the audit, but that change is only the dashboard's quotes card: `tick.ts`, `revx.ts`, `quotes.ts` and the draft are unchanged, D1 sits at `index.ts:186` there, and every patch below applies cleanly to `3b8e4f4` (`git apply --check`). Production was read with SELECT only (project `flmvxigozjuizpckllvk`, 15:29–15:55 UTC). The venue was read through public endpoints only, paced through the shared Revolut X lock. No commit, push or edit touched `/home/user/daviesportfolios`, and no order was placed. Everything below can be re-run from the scripts in this folder.

## Answer first

**Can PR5 go live directly? No.**
1. There is no live execution path. `agents/quotes.ts` never calls an order endpoint, by design.
2. Its paper record was 20 minutes old when I read it. The pre-registered spec asks for four weeks.
3. Since the books tightened (week of 2026-08-24), the rule makes **$0.42 a day on $1,200** (95 % CI $0.22–$0.65, bootstrapped by day). That is about $150 a year.
   - The P&L is clearly above zero and above cash (P = 0.0006).
   - It **cannot yet be told apart from the spec's own 8 %/yr bar** (P = 0.07). At the observed variance that takes about 93 days of record.
4. Going live needs a whole build (§B4), and in practice a separate sub-account. The USDC/USDT inventory cannot be bought by hand in the loop's account.

**Does Revolut X now have two strategies that can go live? No. It has one candidate, `trend-4h-live`, and it is not ready as the code stands.**
- The strategy evidence holds up. I reproduced it byte for byte, priced the draft's exact configuration for the first time, and ran a new random-timing test that the rule passes in the three trending windows.
- The **live execution path has four defects that would cost real money or leave real coins unmanaged**:
  - D1: a Kraken fee-tier timeout crashes the whole tick. It is already visible in production.
  - D2: IOC orders priced at a 3–7 s old touch die unfilled 37–53 % of the time, and a dead rule exit is not retried for 4 hours.
  - D3: a 5xx on placement is recorded as `rejected` although the venue may have filled it.
  - D4: a buy fee taken in the coin leaves a phantom position that blocks that coin for good.

  Each one is reproduced by a failing-behaviour test, and each has a patch that turns the reproduction around while all 232 existing tests stay green.
- **What turns `trend-4h-live` into a GO:**
  1. Patches P1–P4 land, with the lifecycle pin updated.
  2. The draft is armed in two steps (P7): push with `live_confirmed_at` null and a $30 cap. Arm in the conversation on Davies' word. The first round trip is one $25 slot.
  3. The first fill's read-back is checked by a person: field names, the fee currency, and the balance equal to the book. Only then is the cap raised to $150.

**What to expect from `trend-4h-live`:** roughly **+$5 to $10 in a bear year (Kraken's tape vs Coinbase's), +$22 to $25 in a bull year, +$58 in a strong bull year and −$8 in a sideways year, on $100.** These are the gate-on figures for this exact configuration. Drawdowns run up to about 16 %. It is a regime bet: it is long volatility and direction. The money is small, and live is mainly a test of the plumbing.

## Defects, ranked (file:line on `8d4a5fe`)

| # | Sev | Where | What happens | Fix (patch) |
|---|---|---|---|---|
| D1 | **High** | `agents/index.ts:184-187`, `_shared/kraken.ts:341-350` | `loadVenues()` awaits `kraken.refreshFees()` (a private TradeVolume call) with no catch. A network-level failure throws out of `runTick` before `tick()` starts: no lease, no reconcile, **no floor on any Revolut X position**. The fee cache stays cold after a failure, so every later minute of a Kraken outage crashes the same way. Production shows 4 `agents.crash` rows reading "Signal timed out." (09-22 02:17, 09-23 11:50, 12:36, 13:07), each 8–9 s into the minute, the client timeout. This path or the equally unguarded lease claim is the cause. Reproduced: `audit_runtick.test.ts` crashes with exactly "Signal timed out." and makes zero DB calls. | Catch it, back off 5 minutes, record a note. Kraken is a signal venue only since `0046`, so nothing in the tick needs its fee tier. `patches/p1_*.diff` |
| D2 | **High** | `agents/tick.ts:1460-1469` (bar order at the turn-start touch), `:1280` (floor at the same touch), `:1064` (limit = that touch), `:1413` (`hasOrder`: one order per decision) | Every Revolut X order is an IOC limited at the ticker read at the turn's start. Decision rows land at hh:00:04–08, so the touch is 3–7 s old when the order goes out. Measured on the UK book (180 ticker pairs): with the touch 2.6 s old, a buy IOC at the old ask dies **32–52 %** of the time and a sell at the old bid **25–38 %**; with the touch 6.2 s old, **37–44 % / 46–53 %**. When it dies on a **rule exit** the bar counts as "already decided", so the coins stay held until the next 4 h bar; only the 8 % floor is armed. A dead entry is simply lost for that bar. Paper fills a marketable order at its price every time, so neither paper nor any backtest can show this. Reproduced: `audit_repro.test.ts` D2. | Re-read the touch just before a live marketable order. Allow 10 bps on entries and 50 bps on exits: an IOC executes at the best price up to its limit, and the measured p90 move is 2–13 bps. Retry a decision whose IOC died unfilled, up to 5 attempts; each is one row under `0041` (`requotes` = attempt). `patches/p2_*`, lifecycle pin `p2_lifecycle_pin_update.diff` |
| D3 | **Med-High** | `agents/tick.ts:1102-1108`; reconcile `:689-725` | `!placed.ok` → `rejected` for any status, 5xx included. A gateway 5xx says nothing about the order, and the venue may have executed it. Those coins are then in no book, no floor covers them, and the rule buys again next bar. Reproduced: D3 (the venue holds twice the book). A reply lost at the fetch level (a throw) does stay `pending`, but the reconcile reads `/orders/active` only. An IOC never rests there, so the row is pending for a person forever and the pair is frozen. That is safe but manual. | 4xx → rejected; 5xx or a throw → stays `pending`. Reconcile through `GET /api/1.0/orders/historical` (documented, ≤ 1 week window, filter by symbol) by client id. `patches/p2_p3_*` (tick) and `p3_p4_*` (revx, venue) |
| D4 | **High if the venue takes buy fees in the coin (unverified)** | `_shared/revx.ts:366-378` (`toOrderView`) | The venue reference says a buy's `filled_quantity` is "gross, before fees". The client books the gross, turns a coin fee into dollars, and never nets the base. After the exit, the sell is capped at the venue balance (correctly), but **the book keeps a residue equal to the fee**. The rule reads itself "long" and **never enters that coin again**. Reproduced: D4. | Book `filled − fee` on a buy whose `fee_currency` is the base. `patches/p3_p4_*` |
| D5 | Low | `agents/tick.ts:477-482`, `:1401` | The trail's high-water skips the entry bar's high, because the fill lands seconds after the bar opened. The backtester counts it. Measured on the four-coin sleeve: **−0.6 to +1.4 pts** per window, mixed sign. | Trail from the start of the fill's bar (`fromItsBar`). `patches/p2_*` |
| D6 | Low | `agents/tick.ts:1448` | The cooldown is 8 wall-clock hours. The backtester counts bars (`i − lastExitBar < 2`). After a rule exit, whether live re-enters one bar early depends on which of the two turns ran later within its minute. Measured impact **0.0 pts**: the rule never signals within two bars of its own exit. | Count bars. `patches/p2_*` |
| D7 | Medium (process) | `docs/agents/go_live.sql.draft:123-127` | The migration sets `live_confirmed_at = now()`. The loop then places the first live order by itself at the next signal, possibly days later, with nobody present. That breaks "first live order needs Davies' confirmation in the same conversation". It also arms all four slots before the settlement names (B4) have been seen on a single order. | Two-step arming and a $30 first-trip cap. `patches/p7_go_live_draft_two_step_arming.diff` |
| D8 | Medium | `_shared/revx.ts:352-354` (B4 guard) | The venue reference lists `total_fee` / `fee_currency` as optional on `GET /orders/{id}` ("shown only when present"). A filled order without them is refused forever, the pair stays in flight, and only the floor protects it. | Verify on the first order. If they are absent, derive a taker fee as 9 bps of `filled_amount` and mark it derived; a maker fill is 0 %. |
| D9 | Medium (measurement) | `agents/tick.ts:726-738` | The paper control fills every marketable order at its own price. It cannot show dead IOCs or the fill-versus-touch shortfall, and that shortfall is the one thing the new live row plus its paper twin is meant to measure. | Record the touch at placement and the venue's fill beside the paper price. Accept that the paper side of the comparison is optimistic. |
| D10 | Low | `agents/tick.ts:365` | The lease claim is an unguarded DB call. A DB timeout crashes the turn. | Wrap it. There is no floor without the DB either way. |

The draft SQL itself is schema-compatible. I checked every current constraint: kind, venue, signal_venue, mode, Binance-paper-only (`0049`), capital ≥ 0, no `max_order_usd` (dropped by `0048`), and `retired_at` nullable. Its params equal the paper `trend-4h` row's. The next free number is **0052**; `migrations.yml` runs `db push --include-all`, so the out-of-band 202608… versions do not block it.

## A. `trend-4h-live`: evidence and code

**A1. Reproduced exactly.** `backtest_jev.ts --answers jev_answers_v2.json --enter-min 0.45` over the three tape directories rewrote `jev_v2.json` **byte for byte (sha256 672ae9a2…)**. The 5-coin incumbent A +8.03 / B +20.08 / C +55.64 / D −7.81 and the gate A +9.56 / B +19.46 / C +58.23 / D −7.81 are confirmed.

**A2. The draft's exact configuration was never priced. Priced here** (`scripts/backtest_jev_live4.ts`, a 3-line copy: four coins, $25 slot, SUI's replies skipped). Fidelity: 128 cells, 0 mismatches against `run`. The rule arm equals `sui.json`'s four-coin figures.

| evaluation | window | rulebook | **rulebook ∧ Jev v2 @0.45 (as it will run)** | gate refused | random veto ≥ gate |
|---|---|---|---|---|---|
| shipped · Coinbase (primary) | A bear | +8.5 %, DD 15.8 % | **+10.4 %, DD 13.9 %** | 1/37 | P 0.072 |
| | B bull | +25.1 %, DD 11.4 % | **+22.2 %, DD 11.8 %** | 3/56 | gate worse than rule |
| | C strong bull | +55.6 %, DD 7.3 % | **+58.2 %, DD 5.0 %** | 6/51 | P 0.089 |
| | **D sideways (worst)** | **−7.8 %, DD 15.5 %** | **−7.8 %, DD 15.5 %** | 0/32 | – |
| shipped · Kraken (the loop's signal) | A / B / C / D | +3.6 / +28.1 / +50.9 / −7.8 % | **+5.5 / +25.4 / +53.5 / −7.8 %** | | P 0.06 / – / 0.065 / – |
| trail · Coinbase | A / B / C / D | +1.3 / +14.4 / +47.1 / −3.2 % | +2.2 / +13.9 / +48.0 / −3.2 % | | 0.21 / 0.65 / 0.19 / – |

- **The gate does not earn its keep, and it does no harm where it matters.** It never touches the worst window (0 refusals in D). It adds about 2 points in A and C and costs 2.9 in B, all inside what a random veto of the same size produces.
- **The model is untested live.** No production entry has yet been gated by the v2 question: the last entry signal was 09-21, and v2 arrived 09-23 00:52.

**A3. Is the timing better than chance?** This test is new; the reference never priced it. `scripts/audit_edge.ts`, fidelity 32 cells, 0 mismatches.
- **Method.** Each coin's actual trades are replaced by the same number of trades, with the same holding lengths, the same costs and the same 8 % floor, at random non-overlapping times. There are 2,000 draws per window, with fixed-slot P&L as the live row trades.
- **Rule vs the random draws, fixed-slot sleeve:**

  | tape | A | B | C | D |
  |---|---|---|---|---|
  | Coinbase | +9.8 % vs −5.8 % (P 0.026) | +25.7 % vs +6.2 % (P 0.067) | +62.7 % vs +15.0 % (P 0.004) | −7.6 % vs −0.3 % (P 0.82) |
  | Kraken | P 0.10 | P 0.044 | P 0.007 | P 0.81 |

- **Reading.** The rule's timing is worth something in trending years and is worse than random in the sideways year. This is the strongest pro-edge evidence in the repository. It is still one run per window.

**A4. The rest of the evidence.**
- **Plateau (§3.17, not re-run):** 100/100/100/4 % of the grid positive in A/B/C/D. That is a regime effect, not a parameter peak.
- **AVAX's seat:** AVAX clears A, B and C (one passer of 23 where chance gives 1.80). It is the highest-beta member: +126.7 % in C and −29.5 % in D, most of D's loss. Its bear year reads +34.1 % or +12.6 % depending on the tape. Leave-one-out: −2.35 in C, −0.56 in A, +0.13 in B, +0.57 in D. **Defensible at sleeve level, not proven.** Dropping it is the one change that helps D, and doing that now would be choosing on the same data. It would need pre-registering and a new window: Kraken's Q3-2026 bundle, or window A's tail on Revolut X's own tape.
- **The live loop's departures from the backtester** (§A-D5/D6): −0.6 to +1.4 and 0.0 pts.
- **Two modelling gaps that remain unpriced:**
  - The backtester compounds each coin's cash, while live uses fixed $25 slots. The sleeve's daily-arithmetic combine is the closer proxy.
  - The daily loss limit is not simulated. $5 on $100 deployed is a 5 % day.

**A5. Code path, beyond the defects.** These parts are correct and pinned:
- the risk gate: confirmation on entries only, `global_pause`, per venue × mode caps, a loss limit that never blocks an exit, `ORDER_SLOT_TOLERANCE`;
- slot sizing (capital ÷ coins);
- `posKey` / `bookMode`;
- the `pending → reconcile` path, which never guesses;
- the floor at the bid, the per-minute protective claim, the lease compare-and-set, and the `0041` attempt claim;
- the sell cap at the venue balance, the "sell in flight stands the stop down" rule, and the Kraken-candle outage fallback.

The existing suite is green: 232 tests plus my 6 reproductions (`logs/agents_suite.log`).

**A6. The production paper record of `trend-4h`.**
- 80 bar decisions from 09-20 18:24 to 09-23 12:00, with no missed bar: decisions per coin equal bars elapsed. Median decision lag is 5–7 s after the close.
- The two late bars were the start-up and the 09-22 12:00 bar, decided at 18:19 after 187 crashed minutes (the `selectAll` bug, now fixed). **That was 3 hours with no floor.**
- 3 entries on 09-21 (ETH, BTC, SOL at $13.33 slots, the pre-`0048` sizing), 0 exits, all still held: about −$0.47 unrealised plus $0.036 in fees. This is not evidence of anything.
- Jev answered 12 of 12 entry questions (OpenRouter, mean 419 ms, max 776 ms), with no `provider: none`.
- The paper fill equals the touch by construction, so paper cannot validate fill quality (D9).
- Cron: 1,440 of 1,440 tick runs in 24 h, and 3 HTTP 500s in the last 6 h. These are D1-type timeouts.

## B. PR5

**B1. Re-verified.**
- The frozen simulator reproduces `pr5_run1.json` byte for byte (**ed87659b…**, 33 s). All six bar conditions pass: +$707.90, null p95 $43.68, stress $618.96, 8,192 trips, 10/10 positive months, largest month 17.3 %.
- My parameterised copy is trip-for-trip identical to the frozen `simulate`, stress arm included, on both the full run and the post-change run.
- **The new regime, fresh from 2026-08-26 (28 days):**
  - $11.67 on 102 trips, **mean $0.417/day, SD $0.594/day**.
  - iid bootstrap by day: 95 % CI **[$0.22, $0.65]**. 7-day block: [$0.29, $0.55].
  - t = 3.71 against 0 and t = 2.54 against cash ($0.13/day); P(mean ≤ cash) = 0.0006. **P(mean ≤ 8 %/yr, $0.263/day) = 0.07.**
  - Fresh from 08-24 (30 days): $0.545/day [0.30, 0.83].
  - Concentration: 6 of 28 days at zero (weekends, FX dark), and the top 3 days make 43 % of the P&L (09-04 alone makes 22 %).
  - By book on its own $600: **USDT/GBP 17.2 %/yr, USDC/GBP 8.1 %/yr**. Bids made $8.71 and asks $2.96.
- **The pre-registered null on the new regime** (random-time twins, 2,000 draws, seed 20260923): mean $0.02, **p95 $0.99** against the rule's $11.67, and 0 draws at or above it. On the second half only: $5.68 against p95 $0.71. **The edge is real and small.**
- **Power:** at 80 % power and one-sided 5 %, the observed mean needs **13 days to beat 0, 27 days to beat cash, and 93 days to beat the spec's 8 %/yr**. The spec's four weeks can only answer the cash question.

**B2. Is this the best version? Descriptive only: 28 days cannot select parameters.** (`pr5/pr5_audit.json`)
- The frozen setting is at or near the best of every single-dimension change, with two exceptions:
  - Tighter rungs (0.05/0.1/0.15 %): $15.09 on 311 trips.
  - A larger share of minute volume: $13.25 at 100 %.
- Re-pricing:
  - 0.05 % is best on P&L.
  - 0.1 % and 0.2 % cut orders from 205 a day to 69 and 33, at $8.64 and $7.42 on 129 and 182 trips.
  - 0.02 % needs 930 orders a day and breaks the budget.
- Exiting inside fair loses $1.3–4.9. The 24 h stop is flat against 48–72 h, and 1–4 h is worse.
- **Dust is irrelevant.** 89 of 102 trips are filled by prints of $100 or more; ignoring prints under $100 gives $11.46.
- Stress (one tick through plus 18 bps) gives $9.12, and no post-only refusal gives $12.85.
- **Capacity is the real lever** (post-hoc, not a selection): $300 rungs make $30.47 (11.0 %/yr on their capital), $1,000 make $85, and $3,000 make $210.
- **A variant worth testing:**
  - The candidates: rungs 0.05/0.1/0.15 %, plus re-pricing at 0.1 % to fit the order budget, plus $300 rungs.
  - The pre-registration would freeze those three settings and the hypothesis "beats the frozen rule's P&L per locked dollar and its random-time null".
  - The data would be the paper test's own forward record: the stored prints, FX and hours, replayed through both configurations after four weeks. Nothing seen before the freeze may be used.

**B3. The paper test in production.**
- It started 15:09 UTC, and I read it at 15:29–15:55. It had placed the 12 entry quotes at 15:09 and taken 2 book snapshots at 15:10. There were 0 fills, 0 refusals and `last_error` null.
- It had stored 176 prints over 24 h (122 USDT/GBP, 54 USDC/GBP), 990 FX minutes and 25 fair hours per book. Its golden-window replays pass (`quotes.test.ts`).
- **My 25 live book samples** (15:37–16:01 UTC, `pr5/queue_summary.json`):
  - All 12 quotes would be accepted post-only in every sample.
  - **The USDC/GBP book sits 5–10 bps below PR5's fair** (median −6.5). Its asks are 11–27 ticks behind 60k–1.1M USDC, and its 0.1 % bid is 0–3 ticks under the touch behind about 5.9k better plus 15k at the same price.
  - USDT/GBP sits at fair (median −1.1).
- **The spec's book snapshot uses `limit=5` and cannot see most 0.2/0.3 % rung levels.** The books have 20–33 levels, and the v2 endpoint served `limit=100`.

**B4. What a live PR5 needs (the build).**
1. A **separate Revolut X sub-account and key**. The trend row's floor and sell caps assume its account holds only what the loop bought.
2. The venue calls: POST `/orders` with a post-only GTC limit. There is no amend or replace in the reference, so a re-price is a cancel plus a new order. Also DELETE `/orders/{id}`, GET `/orders/{id}`, `/orders/active`, `/orders/historical` (by client id) and `/trades/private/{symbol}` for fills.
3. `client_order_id` as the idempotency key, with retry on the SAME id.
4. Reconcile: every minute, compare the active orders with the state rows, and settle fills from the venue's own view.
5. Inventory and funding:
   - about £450 plus $300 USDC plus $300 USDT, acquired **by the loop** (one-off taker conversions at 9 bps), never by hand;
   - an inventory cap per book and side, so a run of ask fills cannot drain the stablecoins.
6. The **order budget** shared with `trend-4h-live`:
   - PR5 ran 205 orders a day (max 441) since the change, and 1,856 on one old-regime day;
   - a hard daily cap of 700 or less, re-pricing throttled first, and the tick's exits reserved.
7. A kill switch for the quotes:
   - its own pause flag;
   - cancel-all on pause, when FX goes dark and on shutdown;
   - a daily loss limit;
   - a stale-fair guard: no quotes if fair is more than N hours old or the book mid is more than X bps from fair.
8. Weekends and an FX outage:
   - entry quotes are cancelled (the rule already withdraws them);
   - exits stay resting at Friday's fair, which is a gap exposure to accept;
   - the 24 h stop must be a real taker order.
9. Latency: the paper loop decides one minute late. A live loop must act on minute t−1 prints at the start of minute t, which needs the tape to be complete within seconds. Measure that first.
10. P&L and the page, pins mirroring `quotes.test.ts`, and a four-week paper-versus-simulator reconciliation as the spec says. The owner's go and the first order confirmed in the conversation.

## C. Checklist before real money

- **Venue.**
  - The sub-account holds USD only and nothing else trades on it; tell Davies again.
  - The key is set to trading.
  - Know, from the first fill, whether buy fees are charged in the coin.
- **Database.**
  - `0052_go_live.sql` = the draft with P7: `live_confirmed_at` null, `max_exposure_usd` 30.
  - The Binance and paper rows are unchanged.
- **Code.**
  - P1–P4 landed, with pins, and the lifecycle pin updated.
  - The probe is green, including a signed `/orders/historical` read.
  - One 24 h paper soak with the patched tick.
- **Owner's hands.**
  - Davies' explicit go to push `0052`.
  - His word in the conversation for `live_confirmed_at`.
  - A person watches the first fill's read-back: the three field names, the fee currency, and the venue balance equal to the book.
  - Only then is the cap raised to $150.
  - Undo stays `live_confirmed_at = null`: entries stop and exits stay armed.

## Files

- `audit.md`: this report.
- `patches/`:
  - `p1_*`: D1;
  - `p2_p3_p5_p6_tick_*`: D2, D3, D5, D6;
  - `p3_p4_revx_*`: D3's history reconcile and D4;
  - `p2_lifecycle_pin_update.diff`;
  - `p7_go_live_draft_*`;
  - `ALL_code_patches_combined.diff`.

  With them applied, all 232 existing tests pass and 5 of the 6 reproductions flip. D5 tests the shared function, whose fix sits in `tick.ts`. See `logs/agents_suite_patched2.log`.
- `scripts/`:
  - `audit_repro.test.ts`, `audit_runtick.test.ts`: the reproductions;
  - `audit_edge.ts`: A3 and D5/D6 pricing;
  - `backtest_jev_live4.ts` and `bt/backtest_jev_live4.diff`: A2;
  - `pr5_audit.py`: B1/B2;
  - `queue_sampler.py`, `queue_summary.py`: B3;
  - `ioc_staleness.py`, `ioc_summary.py`: D2.
- Outputs:
  - `bt/jev5/jev_v2.json` (byte-identical reproduction);
  - `bt/jev4/jev_v2_live4.json` and `bt/jev4_summary.txt`;
  - `bt/audit_edge.json`, `bt/ioc_summary.json`, `bt/ioc_pairs_*.jsonl`;
  - `pr5/pr5_rerun.json` (byte-identical), `pr5/pr5_audit.json`, `pr5/queue_samples.jsonl`, `pr5/queue_summary.json`;
  - `logs/`;
  - `docs_ext/llm.md` (the venue's public API reference, as fetched).
