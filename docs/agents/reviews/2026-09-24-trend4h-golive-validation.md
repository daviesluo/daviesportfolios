# S2: `trend-4h` at $50 — the final validation before live money (2026-09-24)

Davies wants `trend-4h` live on Revolut X at $50 (the drafted `trend-4h-live` row: BTC/ETH/SOL/AVAX, equal slots)
after a validation that fixes what it finds. Three questions: (a) does the paper row's actual record match the
backtester on the same bars; (b) what do the bars since the last studied window say; (c) does $50 — four $12.50 slots —
work against Revolut X's own rules, the coin fee, rounding, the floor and the daily loss limit, and what exactly should
the row be. Public data and the repository's own code only; no key, no signed call, no order, no database read (the
queries that would read the record are written below and were not run). Code lines are cited at `07c6e44`, the main
that landed the go-live audit's D8–D10 at 00:00 UTC while this ran (the worktree branched from `96859b4`); the patches
below were rebuilt and tested on it.

**Status (2026-09-24, later that night).**
- **D11** landed as the patch and pin below, unchanged (`bf80626`).
- **D12's fix is built.** A live Revolut X buy whose fee went unreported is booked from the account: its balance of the
  coin less the rest of the live book (buys less sells), never more than the gross, floored to the step. The row
  records what that read (`fromAccount`).
- **What still settles nothing:** a shortfall the fee cannot explain, an unreadable balance, and a buy with no pair
  config (its booking waits a turn).
- **Pins:** the reproduction below passes with its assertions unchanged. Four more pins cover the cases it does not
  (reference §4 item 33).
- **The draft:** the $50 amendment below is now in `go_live.sql.draft`, with the daily loss limit (5), the order cap (40)
  and `live_confirmed_at` (null) written out too (reference §4 item 34).
- **The database agrees with (a):** read-only at about 00:55 UTC, Q1–Q3 returned what `replay.json` predicts. That
  includes the ETH exit by the trail on the 09-23 12:00 bar, filled at 2,655.55.
- **The go:** both of the verdict's code preconditions are met. What stays is Davies' word, the funding, and the first
  buy read by a person before its exit.

## Answer first

* **(a) No mismatch.** Replayed bar by bar with the loop's own functions (`buildSnapshot`, `ruleDecision`,
  `highWaterSince` from the entry's bar, the bar-counted cooldown, the v2 gate) on the Kraken candles the loop reads,
  the paper row's life reproduces everything the repository records: **ETH entered on the 2026-09-21 00:00 bar, BTC and
  SOL on the 08:00 bar, with the recorded state words exactly; AVAX and SUI never signalled; 80 bar decisions through
  the 09-23 08:00 bar, the audit's count to the bar; $0.036 of fees, the audit's figure to the cent;** and the audit's
  "about −$0.47 unrealised" at 15:29–15:55 UTC lies inside the −$0.51 … −$0.12 the replayed fills imply in that
  volatile half-hour. The backtester's `run` on the same bars takes the same trades (1 / 2 / 1 / 0 / 0 fills). One
  event falls after the audit's read and is PREDICTED: **ETH exited by the rulebook's own 3×ATR trail on the 09-23
  12:00 bar** (close 2,655.96 under 2,806.69 − 3 × 47.73 = 2,663.50), decided about 16:00:05. BTC and SOL are still
  held. Whether the database agrees is three queries (below).
* **(b) The 12 bars no study has scored** (2026-09-22 00:00 → 09-24 00:00): one decision, that ETH exit. On the four
  live coins at $12.50 the rule's book moved −$1.31 against buy-and-hold's −$2.23, most of the difference AVAX staying
  flat through −8.8 %. Twelve bars and one trade say nothing about an edge; they say the rule did what the backtester
  says it does.
* **(c) $50 works, and the validation found two conditional defects that would bite at any size**, both in how a buy
  fee taken in the coin reaches the book. Every $12.50 order clears the venue's minimum 125 times, rounds away at most
  $0.00006, and is under 0.3 % of the touch. **D11: a coin fee the venue REPORTS is never a whole number of base
  steps**, so the book keeps a sub-step remainder after the exit. **D12: a coin fee the venue does NOT report is booked
  gross by D8's derived dollar fee**, so the book keeps the whole fee. Either way the coin reads "long" for good — no
  re-entry, and a floor exit that cannot be placed, every minute. Both turn on how the venue charges and reports a
  buy's fee, which nobody has seen (B4/D8). D11's fix and pin are in `2026-09-24-golive50-patches/`, tested on current
  main (the whole Edge suite passes with it; the pin is red without it), **not applied**; D12 has a reproduction there,
  red on current main with or without D11's fix, and a fix still to build. The daily loss limit is inert at $50 (all
  four floors in one day cost $4.05–4.27, under $5) and is one number for every bucket, paper included.
* **Verdict: GO at $50** on Davies' word, with the amended draft below — **after D11's patch lands**, and with the first
  live buy read back by a person BEFORE its exit: which fee fields the venue sent (D8), and the account's balance of the
  coin against the book (D12). A shortfall of about 9 bps of the coin means D12 is live: clear `live_confirmed_at` (exits
  stay armed) until its fix lands and the book is corrected.

## (a) The paper row against the backtester

`backtests/golive50/replay_trend4h.ts` → `replay.json`. Inputs, committed in `backtests/golive50/inputs/` and pulled
keylessly at 2026-09-24 00:12 UTC by `pull_public.py`: Kraken's public OHLC (the 720 most recent 4-hour and daily
candles — the loop's signal series) and Revolut X's UK 1-minute and 4-hour candles (the book the paper row fills
against). Each coin is decided from the last bar CLOSED at its first turn (the row 2026-09-20 18:23; AVAX after
`0039`, 09-21 13:10; SUI after `0040`, 14:11), exactly as `tick.ts` decides.

| coin | bars decided (to the 09-23 20:00 bar) | rule said enter | state at the entry (recorded → replayed) | paper fill (proxy) | since |
|---|---|---|---|---|---|
| BTC | 21 | 09-21 08:00 bar | moderate · above range · normal · positive → same | 84,766.30 | held |
| ETH | 21 | 09-21 00:00 bar | moderate · above range · normal · positive → same | 2,665.15 | **exit, 09-23 12:00 bar, ATR trail** (2,655.15) |
| SOL | 21 | 09-21 08:00 bar | strong · above range · high · positive → same | 116.858 | held |
| AVAX | 16 | none (the last bars read "volatility extreme") | — | — | flat |
| SUI | 16 | none | — | — | flat |

The recorded entries are `backtest_jev.ts`'s `RECORDED` rows 83, 118 and 120 (Jev v1 answered 0.94, 0.95, 0.61, all
above that day's 0.60). The fill proxy is the decision minute's UK candle open times (1 + the half-spread the backtests
charge); the paper order's own price was the ticker's ask at the turn. The floor never came near: no UK minute's low
reached 8 % under any fill.

**The departures between the loop and the backtester, checked on this record:**

| departure | status | did it change a decision here? |
|---|---|---|
| D5 — the trail skipped the entry bar's own high (fixed 2026-09-23 ~20:25) | fixed | no: all three high-waters were set on the 09-21 20:00 bar, with or without the entry bar |
| D6 — the cooldown in wall-clock hours (fixed) | fixed | no re-entry was signalled |
| the lateness guard (`entryTooLate`), which the backtester lacks | by design | no: no entry signal fell on the late 09-22 12:00 bar |
| the fill: the touch seconds after the close (loop) vs the next bar's open (`run`) | by design (D9 records the gap live) | no; it moves each slot by 0.02–0.07 points (BTC −0.60 % loop vs −0.67 % `run`) |
| the floor: the bid once a minute (loop) vs the bar's low (`run`) | by design | no floor came within reach |

**What the database would confirm — three queries, NOT run** (the instruction was to write them and stop):

    -- Q1: every BAR decision of the paper row (a protective decision claims minute + 1 s, so a bar is a multiple of 4 h)
    select d.symbol, d.bar_start, d.ts, d.rule_action, d.rule_reason, d.final_action, d.final_reason, d.risk_allowed,
           d.state->>'trend_4h' trend, d.state->>'trend_strength' strength, d.state->>'breakout_4h' breakout,
           d.state->>'volatility' volatility, d.state->>'momentum_30d' momentum, d.state->>'position' position,
           d.numbers->>'jevQuestion' jev_question, (d.answers->'healthy_trend'->>'probability')::numeric p_healthy
    from public.agent_decisions d
    where d.strategy_id = 'trend-4h' and d.bar_start >= '2026-09-20T12:00:00Z'
      and extract(epoch from d.bar_start)::bigint % 14400 = 0
    order by d.symbol, d.bar_start;

    -- Q2: every protective (floor) decision of the paper row
    select d.symbol, d.bar_start, d.rule_reason, d.final_action, d.risk_allowed
    from public.agent_decisions d
    where d.strategy_id = 'trend-4h' and extract(epoch from d.bar_start)::bigint % 60 = 1
    order by d.bar_start;

    -- Q3: every order of the paper row, with the bar it came from
    select o.symbol, o.side, o.ts, o.filled_at, o.price, o.base_size, o.filled_base, o.avg_fill_price, o.fee_usd,
           o.state, o.mode, o.requotes, d.bar_start, o.request->>'marketable' marketable
    from public.agent_orders o left join public.agent_decisions d on d.id = o.decision_id
    where o.strategy_id = 'trend-4h'
    order by o.symbol, o.ts, o.id;

Expected, from `replay.json`: Q1 95 rows through the 09-23 20:00 bar (BTC/ETH/SOL 21, AVAX/SUI 16), `rule_action` and
`final_action` equal to `perCoin[sym].decisions[].rule` / `.final` on the same `bar_start` — enter on ETH 09-21 00:00
and BTC/SOL 09-21 08:00, exit on ETH 09-23 12:00, hold on every other; Q2 no rows; Q3 four paper orders (three buys
09-21, the ETH sell about 09-23 16:00:05), each within about 15 bps of the proxy prices above (half a spread plus a
minute's move) and paying 9 bps. **A decision that differs on the same bar is a bug to find in `tick.ts`; a fill more
than ~15 bps from its proxy is a fill question (D9), not a decision one.**

## (b) The bars no study has scored

The last bar any published study scored is Kraken's 2026-09-21 20:00 (`sizing.json`'s tape); Revolut X's UK tape was
pulled to 09-22 for window A. The stretch since, 2026-09-22 00:00 → 09-24 00:00, is 12 bars:

| coin | the rule's book (per $ of slot) | buy-and-hold (UK) | what happened |
|---|---|---|---|
| BTC | −2.63 % | −2.63 % | held throughout |
| ETH | −4.43 % | −3.23 % | held, then sold by the trail at 2,655 two hours before a rebound to 2,684 |
| SOL | −3.16 % | −3.16 % | held throughout |
| AVAX | 0.00 % | −8.85 % | flat: no breakout, then "volatility extreme" |
| **four slots at $12.50** | **−$1.31** | **−$2.23** | |

`run` started flat at the stretch's first bar takes no trade in it (no fresh breakout). One draw of 12 bars cannot say
whether the rule has an edge; it says the live rule and the backtester agree on these bars too.

## (c) $50: four $12.50 slots against the venue

`backtests/golive50/sizing50.py` → `sizing50.json`, from the public pair configuration, tickers and order books pulled
00:12 UTC, with the loop's own arithmetic (`slotUsdOf` = capital ÷ coins; `sizeBase` floors to the base step and
checks both minimums; a marketable buy's limit is the ask plus 10 bps rounded up to the price step; 9 bps taker).

| coin | base step · price step · min | $12.50 buys | rounding left | × the $0.10 minimum | touch (ask / bid) | round trip | floor exit loses |
|---|---|---|---|---|---|---|---|
| BTC | 1e-8 · 0.01 · $0.10 | 0.00014823 | $0.00002 | 125 | $5.5k / $5.5k | $0.025 (19.8 bps) | $1.01 (worst $1.07) |
| ETH | 1e-8 · 0.01 · $0.10 | 0.00465604 | $0.00002 | 125 | $16.3k / $5.4k | $0.026 (20.9 bps) | $1.01 |
| SOL | 1e-6 · 0.001 · $0.10 | 0.108629 | $0.00006 | 125 | $5.0k / $5.7k | $0.028 (22.5 bps) | $1.01 |
| AVAX | 1e-6 · 0.001 · $0.10 | 1.221180 | $0.000002 | 125 | $8.1k / $8.1k | $0.036 (28.8 bps) | $1.02 |

Spreads at the pull: BTC 1.8, ETH 2.9, SOL 4.5, AVAX 10.8 bps. All four pairs `active`. Nothing about $12.50 is too
small for the venue: the minimum is $0.10, the price grid moves a limit by at most one AVAX tick (0.98 bps), and a
slot is under 0.3 % of the size at the touch.

### D11 and D12 — a coin fee leaves the book "long" for good (found here; D11 fixed in a patch, D12 reproduced; nothing applied)

The venue's reference says a buy's `filled_quantity` is GROSS, "before fees", and the fee may be charged in the coin
(`fee_currency`); since D4 the client books `gross − fee` when the reply names the coin (`_shared/revx.ts:439`). A
9 bps fee is never a whole number of base steps: at $12.50 it is **13.3 steps of BTC, 419.0 of ETH, 97.8 of SOL,
1,099.1 of AVAX** (`sizing50.json`). Whenever the book holds more of a coin than the account can sell:

1. every exit can sell only what the account holds, floored to the step — `sizeBase` floors
   (`_shared/agents_strategy.ts:753`), and so does the sell cap at the venue's balance (`agents/tick.ts:1128`);
2. the book keeps the remainder: `applyFill` subtracts the sold base and keeps the average cost
   (`_shared/agents_strategy.ts:100`);
3. `ruleDecision` reads any `base > 0` as long (`_shared/agents_strategy.ts:269`), so **the rule never enters that coin
   again**;
4. and once the mark falls 8 % under the old cost, the floor decides an exit every minute that `sizeBase` cannot size
   (`agents/tick.ts:1399`: "is under the venue minimum"), as does any rule exit (`agents/tick.ts:1590`).

**D11 — the fee is reported, at full precision.** Then `gross − fee` sits between two steps and the remainder is under
one step. **Why no test caught it**: D4's pin (`agents/golive.test.ts:139`) builds its coin fee with
`Math.round(o.fee / o.avg * 1e8) / 1e8` (`:154`) — rounded to the base step, the one case in which the remainder is
zero. The double is looser than the venue it stands in for, which is this repository's most expensive class of test
bug. **The fix** (`2026-09-24-golive50-patches/p11_tick_settle_live_buy_to_the_base_step.diff`): every place `tick.ts`
settles a live BUY floors the settled base to the pair's own `base_step` (loaded in step 1, before settlement), so the
book holds exactly what can be sold and the remainder — under one step, unsellable — stays at the venue as dust. The
step is never read from the decimals of a quantity string: the venue's own example returns `"filled_quantity":
"0.002"`, trimmed, and flooring to the string's decimals would throw away half of such a position (a first draft here
did exactly that and was discarded). **The pin** (`p11_golive_test_d11_pin.diff`, test "D11"): a $12.50 BTC buy whose
coin fee is reported at twelve decimals; the book must hold the floored base, be exactly flat after the floor's exit,
and enter again after the cooldown. Measured on a copy of `07c6e44`: with the fix the whole Edge suite passes, 456
tests (the D12 reproduction below aside, red by design); without it the pin fails — the settled base is
0.031773937696 against 0.03177393. (At `96859b4`, with that assertion removed, the book kept 7.7e-9 BTC after the
exit.)

**D12 — the fee is taken in the coin and NOT reported.** D8, landed on main at 00:00 UTC, settles a fill whose
read-back carries no `total_fee` / `fee_currency` with the schedule's fee in DOLLARS (`_shared/revx.ts:428`,
`derivedFee` at `:406`) and books the gross (`:431`, `:439`); its pin's double takes that fee "from the dollars and
does not say so" (`agents/golive.test.ts:242`; `FakeRevx` at `agents/testing.ts:349`). But "gross, before fees" is
what a fee taken in the coin looks like, and D4 was written for exactly that venue. If it takes the coin and reports
nothing, the book holds the gross, the account gross − fee, the floor's sell is capped at the account, and **the whole
fee stays in the book** — D4's phantom by another road, about $0.011 of BTC on a $12.50 slot, with the coin blocked as
above. No field of the reply tells the two venues apart; the account's balance does. **The reproduction**
(`p12_golive_test_d12_reproduction.diff`, test "D12", red until fixed): the same $12.50 BTC entry with the venue's
no-fee reply and the fee taken in the coin; after the floor's exit the venue is flat and the book keeps 0.00002862 BTC,
exactly the fee, on `07c6e44` with or without D11's fix. **The fix to build** (not drafted here: it decides how the
book learns what the venue kept): when a live Revolut X buy settles with a derived fee, read the account's balance of
the coin — the live-book block already rests on the account being the loop's alone (`agents/tick.ts:946`) — and book
what the account holds beyond the settled live book, floored to the step and never more than the gross; a shortfall
far from 9 bps settles nothing and is reported. D12's pin then goes green unchanged.

Until both land, the first live buy is the test, read by a person BEFORE its exit: the fee fields on its read-back,
and the account's balance of the coin equal to the book (a shortfall of about 9 bps is D12). After its sell, the book
must be exactly flat and the account's balance of the coin under one step (anything else is D11 or D12). Either
failure stops new entries before a second one.

### The floor, the daily loss limit and the caps at $50

* **The floor** (8 % under cost, judged at the bid once a minute) sells a whole $11.50 position at the touch; it loses
  about $1.01 a slot, $1.07 at worst if the IOC fills at its full 50 bps allowance. Sensible at this size.
* **The daily loss limit is inert at $50.** It counts realised plus the change in unrealised since the day's open, and
  all four floors firing on one day cost $4.05–$4.27, under the $5 limit; only a gap through the floor could reach it.
  It is also ONE number (`agent_risk.daily_loss_limit_usd`) applied to every venue × mode bucket, so lowering it to
  $2.50 for the live row would halve it for the paper rows too — including `trend-4h`, the live row's control, whose
  entries would then be refused on days the live row's are not. **Keep $5.** A live-only limit needs a per-bucket
  column (a build item, not a blocker: the floor is the binding loss bound at this size). The same bucket rule means
  the control shares its $5 with `momentum-1d` and `trend-1h` on bad days — a caveat on reading the control, not a
  defect.
* **The exposure cap is marked to market**, so it counts slots: at $15 exactly one $12.50 entry can happen (a second
  would need the first to be down 80 %), at $30 exactly two, and at $75 the fourth slot stays reachable until the other
  three are up two thirds — the draft's own $150-on-$100 arithmetic, halved.
* **Orders a day**: 40 per bucket is far above what four slots can use (four entries and four exits, five IOC attempts
  at most each).
* **Funding**: the sub-account must hold at least about $51 of USD (four slots, the 10 bps entry allowance and the fees).
  Nothing else may trade in it by hand: the floor counts the venue's balance.

### The amendment to `go_live.sql.draft` for a $50 start (not applied to the draft)

Unchanged: the row id, kind, venue, signal venue, the four coins, the parameters, `mode = 'live'`, `live_confirmed_at`
set only in the conversation, and the paper `trend-4h` kept as the control. Changed: capital, the description and the
three cap steps.

    insert into public.agent_strategies
      (id, kind, venue, signal_venue, name, description, symbols, capital_usd, params, mode)
    values (
      'trend-4h-live', 'trend-4h', 'revx', 'kraken',
      'Trend 4h · Revolut X · live',
      'The live row. Same rulebook and params as the paper `trend-4h`, which stays on as its control. Four coins at $12.50 a slot ($50), SUI on paper only.',
      array['BTC/USD','ETH/USD','SOL/USD','AVAX/USD'],
      50,
      '{"fast":20,"slow":100,"breakoutUp":55,"breakoutDown":20,"atrN":14,"atrStop":3,"volN":42,"enterMin":0.45,"exitMax":0.3}'::jsonb,
      'live'
    );

    -- The first round trip is ONE $12.50 slot: marked to market, $15 admits one entry and refuses a second.
    update public.agent_risk set max_exposure_usd = 15, updated_at = now() where id = 1;

    -- In the conversation, on Davies' word (not in the file):
    --   update public.agent_risk set live_confirmed_at = now(), updated_at = now() where id = 1;
    -- When the first BUY has settled, BEFORE its exit, a person reads it back: the fee fields the venue sent (B4/D8) and
    -- the account's balance of the coin against the book (D12: short by about 9 bps of the coin means clear
    -- live_confirmed_at until D12's fix lands). After its SELL: the book exactly flat and the account under one step of
    -- the coin (D11). Then:
    --   update public.agent_risk set max_exposure_usd = 30, updated_at = now() where id = 1;   -- two slots, the rest of the first week
    -- After seven days with no unexplained difference between the venue's balances and the book:
    --   update public.agent_risk set max_exposure_usd = 75, updated_at = now() where id = 1;   -- all four slots, with room
    -- daily_loss_limit_usd stays 5 (one number for every bucket, inert at $50); max_orders_per_day stays 40.

Slots: `slotUsdOf` = $50 ÷ 4 = $12.50, per-order limit $13.75 (`ORDER_SLOT_TOLERANCE` 1.1). The paper control stays at
$100 in five $20 slots; the comparison is in bps per fill, so the different slot does not blur it (the draft's own
argument for $25 against $20).

## What needs Davies

* The go itself, and the first live order's confirmation in the conversation.
* **Funding**: at least about $51 of USD in the Revolut X sub-account the key sees (it held one USD row at the probe).
* A reminder, as always: never trade by hand in that account.
* Whether D11's patch lands before the go (recommended), and that until D12's fix lands the first live buy is read back
  by a person before its exit, with entries stopped if the account holds less of the coin than the book.

## What this cannot show

* The database was not read: (a) reproduces every recorded fact the repository holds, and Q1–Q3 are the rest.
* The fill proxy is a minute's candle open, not the ticker the turn read; the paper fill's own price is in Q3.
* Twelve unscored bars are one draw. The edge question stays where §3.15–§3.19 left it.
* How the venue charges and reports a buy's fee is still unknown (B4/D8): D11 and D12 are conditional, and the first
  fill decides whether either would have bitten.

## Files

* `backtests/golive50/replay_trend4h.ts` → `replay.json` (a and b); `sizing50.py` → `sizing50.json` (c);
  `pull_public.py` and `inputs/` (the public snapshot, 2026-09-24 00:12 UTC, gzipped).
* `reviews/2026-09-24-golive50-patches/`, all three made against `07c6e44` and applied from the repository root:
  `p11_tick_settle_live_buy_to_the_base_step.diff` and `p11_golive_test_d11_pin.diff` (D11's fix and its pin), and
  `p12_golive_test_d12_reproduction.diff` (D12's reproduction: red until its fix, so it lands with that fix).
