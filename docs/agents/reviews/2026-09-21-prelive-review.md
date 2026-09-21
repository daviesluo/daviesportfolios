# Agents — independent pre-live review

Scope: `supabase/functions/agents/{index,tick,db,backtest,backtest_ideas}.ts`,
`supabase/functions/_shared/{agents_strategy,jev,revx,kraken,venue}.ts`,
migrations `0037`–`0040`, `src/agents.{js,jsx}`, `src/agents_chart.js`,
`test/browser/app-sweep.mjs`, against `docs/agents/reference.md` and
`LEDGER.md` item 0.

Gates run here, all green and unchanged by this review (read-only):
`npx deno test --allow-env supabase/functions/` → 291 passed;
`npx deno check --quiet supabase/functions/` → clean; `npm test` → 905
passed / 50 files. Findings below were produced by reading the code and by
two throwaway scripts in the scratchpad that import the shipped modules and
print their actual output; every claim marked **verified by execution** was
printed, not inferred.

---

## Blockers before live (must fix)

### B1. A live order that fills before it is reconciled is recorded as `rejected` — a real position becomes invisible
`supabase/functions/agents/tick.ts:357-378`

The `pending` row (written before the venue is called) is reconciled one
turn later by looking the client id up in `venue.activeOrders()`
(`tick.ts:361-372`). If it is **not** among the active orders the row is
settled `rejected` (`tick.ts:376`) on the reasoning in the comment at
`tick.ts:373-375`: *"A post-only order cannot have filled on arrival, so it
was never accepted."*

That reasoning does not hold on the venue that goes live first. Every
Revolut X order the loop places is **marketable IOC** — entries
(`tick.ts:713`), protective stops (`tick.ts:669`) — see
`revx.ts:326` (`allow_taker` + `time_in_force: "ioc"`). An IOC order is
never "active": it fills or it dies inside the turn. And
`tick.ts:359` deliberately defers reconciliation by a whole minute
(`if (ageMs < TICK_MS) continue`), which maximises the chance the order has
already filled and left the active list.

Concrete failure: the loop writes `pending`, Revolut X accepts and fills
$20 of BTC, the HTTP reply is lost (Edge isolate killed, 50 s pg_net
timeout, network reset). Next turn `/orders/active` does not contain the
client id, the row is marked `rejected` and an `ops_errors` line is
written. From then on the loop believes it is flat: `positionFromFills`
never sees the fill, so the ATR trail and the 8 % floor never protect it
(`tick.ts:664`), the exposure cap does not count it (`tick.ts:454-462`),
and the next closed bar can buy the *same* $20 again. The account holds
0.00050 BTC that nothing in the system knows about.

Kraken has the same hole in a milder form: a post-only bid at the touch can
be lifted seconds after it rests, so it too leaves `OpenOrders`
(`kraken.ts:297-304`).

Smallest fix: before marking a `pending` row rejected, ask the venue for
the order itself, not only for the resting ones — Revolut X
`GET /1.0/trades/private/{symbol}` over the last few minutes filtered by
`client_order_id` (or the order lookup once its shape is proved, see B4),
Kraken `ClosedOrders`/`QueryOrders`. Until such a lookup exists, do **not**
settle the row: leave it `pending` and keep reporting it, so a human, not a
guess, closes it.

### B2. A fill is lost when the post-cancel read fails
`supabase/functions/agents/tick.ts:334-348`

```
const c = await venue.cancel(o.venue_order_id);
if (!c.ok) { … return "failed"; }
const after = await venue.order(o.venue_order_id);
if (after.ok && after.view.filledBase > 0) { …settle "filled"… }
await settle(o, { cancelled_at: nowIso, response: { cancelled: why } }, "cancelled");
```

If `venue.order()` comes back `ok:false` — a timeout, a 5xx, Kraken's
`EService:Busy`, Revolut X's `no view` — the row is settled **`cancelled`
with `filled_base` 0** even though the cancel succeeded and the order may
have been partially filled first. The cancel is the destructive step and it
already happened, so the partial fill is real and is now unrecorded.
Same consequences as B1: no stop, no exposure, and a re-entry on the next
bar doubles the position.

This path runs on the two most common triggers — a resting order older than
an hour (`tick.ts:419`) and a stop outranking a resting order
(`tick.ts:674`, `tick.ts:636`) — so it is not a corner.

Smallest fix: treat `!after.ok` like `!c.ok` — return `"failed"`, leave the
row open, add the key to `inFlight`, and let the next turn re-read it.

### B3. The position query is unbounded and will silently truncate
`supabase/functions/agents/tick.ts:437`, `supabase/functions/agents/index.ts:219`

```
const filled = await d.db.select<OrderRow>("agent_orders",
  "state=in.(filled,partially_filled)&select=*&order=ts.asc");
```

No `limit`, and `db.ts:28` adds none. This repo already documents the cap it
runs into — `supabase/functions/overnight-fetch/index.ts:47`: *"PostgREST
default max-rows is 1000 … a single request used to be truncated at the
1000th row"*, which is why that function pages
(`overnight-fetch/index.ts:101-140`). Nothing equivalent here.

Because the order is `ts.asc`, truncation keeps the **oldest** 1,000 fills
and drops the newest. Every position in the loop and on the page then
freezes at a state from weeks earlier: sells disappear, so a flat book
reads as long (stops fire against a position that is not there); buys
disappear, so a held position reads as flat (no stops, and re-entry).

This has a date. `LEDGER.md` (09-21 12:04) records 22 orders in 24 h across
8 strategies, and `0039`/`0040` since added two symbols to both trend-4h
rows. At ~20–25 fills a day the table crosses 1,000 rows around early-to-mid
November 2026 — i.e. inside the first paper quarter, before any live order.

Smallest fix: page the query the way `overnight-fetch` does, or scope it —
positions only need fills since each pair's last flat point; a
`&ts=gte.<90 days>` plus an explicit `limit` with a short-page assertion
would do, but a silent truncation must become a loud one either way.

### B4. Revolut X's settlement schema is unverified by the reference and untouched by the probe
`supabase/functions/_shared/revx.ts:151-155,195-199,282-289`;
`supabase/functions/agents/index.ts:414-453`

`toOrderView` reads `filled_size`, `average_fill_price` and `fees` off the
venue's order object. None of those three field names, and neither
`GET /1.0/orders/{venue_order_id}` nor `GET /1.0/orders/active`, appears
anywhere in `docs/agents/reference.md` — the §2 table documents place,
cancel, balances, candles and `GET /1.0/orders/fills/{venue_order_id}`, and
nothing else. The probe (`index.ts:417-453`) exercises balances, pair
config, a signed candles call and the region filter; it never calls either
order endpoint. So the entire live reconciliation path rests on guessed
field names, and both failure modes are silent:

- `fees` missing or differently named → `Number(undefined ?? 0)` = **0**.
  Every live Revolut X fill is a 9 bps taker fill (`revx.ts:279`,
  reference §4.3); recording its fee as zero overstates realised P&L,
  understates `feesUsd`, and feeds a wrong `dayPnl` to the daily loss
  breaker (`tick.ts:143-161`) — the kill switch reads a number that is
  systematically too kind.
- `filled_size` missing → `filledBase` 0 → `toOrderView` returns state
  `"new"` for an order the venue has filled (`revx.ts:284-287`). The row
  never settles, the position never exists, and after an hour
  (`tick.ts:419`) the loop "cancels" an order that is long gone.

Smallest fix: add the two order reads to the probe (they place nothing) and
assert the field names against the live reply before the first live order;
until then, make an order view with `filledBase > 0` and no readable
`fees` an error, not a zero.

### B5. Re-quotes place orders with no risk gate at all — including under a global pause
`supabase/functions/agents/tick.ts:526-532`

```
for (const { o, touch } of requoteWanted) {
  const s = byId.get(o.strategy_id);
  if (!s) continue;
  await place(s, o.symbol, o.side, String(o.base_size), touch, …);
}
```

`place()` (`tick.ts:487-524`) checks only `live_confirmed_at` and
credentials. `riskGate` (`agents_strategy.ts:615-628`) is never consulted
on this path, so a re-quote ignores `global_pause`, the daily loss limit,
the per-order cap, the exposure cap and the order-count cap. Up to
`MAX_REQUOTES = 5` fresh live orders per decision can go out after the
operator has hit the kill switch.

The page states the opposite in words the owner will read as a guarantee —
`src/agents.js:626`: *"it places no order, on either venue, until the pause
is lifted."*

Today's exposure is Kraken-only (Revolut X orders are IOC and never rest to
be re-quoted), and Kraken cannot trade until GBP→USD; but Kraken live is a
stated next step and the fix is three lines: run `riskGate` on the
re-quote's side and notional before calling `place`, and skip on
`globalPause` unconditionally.

### B6. A bar whose order fails to place is spent — the rule's exit is lost until the next bar
`supabase/functions/agents/tick.ts:566-577, 696-717`

The decision insert is the bar claim (`0037_agents.sql:119-120`), and it
happens **before** the order is placed. Everything after it can fail
without releasing the claim:

- `!q || !cfg` → `tick.ts:709` logs and returns (a `venue.pairs()` throw at
  `tick.ts:288` leaves `pairs = {}` for every symbol on that venue);
- `sizeBase` → null → `tick.ts:716`;
- live placement rejected by the venue → `tick.ts:506-510` returns.

Next minute `decided(s, sym, barStart)` (`tick.ts:697`) is true, so the bar
is skipped; for `momentum-1d`/`rotation-1d` that is 24 hours, for
`trend-4h` four. If the lost action was `exit` — "4h trend turned down",
"30-day momentum turned negative", "dropped out of the top 2" — the
position stays on, with only the 8 % floor and the ATR trail as backstop.

Note the protective-stop path does **not** have this problem: it claims the
minute (`tick.ts:678`), so a failed stop order is retried 60 s later. That
asymmetry is the fix: record the claim, but let a decision whose order was
not placed be re-attempted — e.g. set a `placed` flag on the decision and
let `decided()` ignore an allowed-but-unplaced row, or move the claim to
after a successful `place`.

### B7. The tick lease is shorter than the worst-case turn, and is released by whoever finishes last
`supabase/functions/agents/tick.ts:225-236`

`LEASE_MS = 55e3` (`tick.ts:71`). One turn asks Jev once per **entry**
decision (`tick.ts:543-546`), serially, and `askJev` allows 8 s per
transport across two transports (`jev.ts:170,181-193`) — 16 s worst case
per entry. On a 4-hour close the seeded rows can produce up to 27 entry
decisions in one turn (trend-4h 5 syms × 2 venues, trend-1h 3, momentum 3+3,
rotation 4+4). A degraded Jev therefore puts the turn minutes past its own
lease, after which the next minute's tick takes the lease and runs
concurrently — the invariant `0037_agents.sql:276-284` and reference §4.12
promise is gone.

Worse, the release is unconditional:

```
await d.db.update("agent_locks", "name=eq.tick", { lease_until: nowIso, holder: null });
```

`tick.ts:233` has no `holder` filter. The overrunning turn A, finishing at
t+160 s, clears turn B's lease (taken at t+60 s, valid to t+115 s), so turn
C starts at t+120 s alongside B. One overrun cascades into permanent
overlap. The bar claim still prevents duplicate decisions, but settlement,
re-quotes and observation writes all double up, and B1/B2's windows widen.

Smallest fix: (a) filter the release on `holder=eq.<this turn's token>`;
(b) give the turn a wall-clock budget — stop asking Jev and stop opening new
work once `Date.now() - start > LEASE_MS * 0.7` — or renew the lease
mid-turn.

---

## Should fix before live

### S1. The bar rule's ATR trail and `drawdown_from_high` read an un-trailed high-water — the shipped rule is not the backtested rule
`_shared/agents_strategy.ts:97,235-236,267-269` vs `agents/backtest.ts:172`

`applyFill` sets `highWater` from **fill prices only** and never raises it
with the market (`agents_strategy.ts:97`). The live loop feeds exactly that
position into `buildSnapshot` and `ruleFor` (`tick.ts:655,698-699`). The
backtester raises it every bar: `pos = { ...pos, highWater: Math.max(pos.highWater ?? next.high, next.high) }`
(`backtest.ts:172`).

**Verified by execution** — same bars, same position (entry 100, high since
entry 202, close 150.7):

```
LIVE     (pos.highWater = 100) → state.drawdown_from_high = "none",  unrealised = "gain"
BACKTEST (pos.highWater = 202) → state.drawdown_from_high = "large"
```

Two consequences:

1. `ruleDecision`'s trailing-stop clause (`agents_strategy.ts:267`)
   compares `close < position.highWater − atrStop × atr`, i.e. **entry price
   − 3×ATR**. It can only ever fire once the position is already 3 ATR below
   its *entry*; in the backtest it fires 3 ATR below the running *high*.
   The bar-level "3×ATR trailing stop" named in the seed text
   (`0037_agents.sql:244`) and in reference §3.3a is not what ships.
2. The state word `drawdown_from_high` in `agent_observations`, in every
   decision record, and on the page's LIVE STATE pills is drawdown from
   **cost**, not from the high. The page will say "drawdown none" on a
   position 25 % off its peak.

Mitigation that keeps this out of Blockers: the per-minute
`protectiveExit` is fed `highWaterSince(pos, bars, i)`
(`tick.ts:665`, `agents_strategy.ts:369-374`), which does trail and matches
the backtester's level — **verified by execution**, `highWaterSince` = 202
on the same series. So the *stop level* is right; the bar clause and the
state word are wrong. And Jev never sees the bad word, because it is asked
on entries only, where the position is flat and the word is "none" by
construction (`agents_strategy.ts:236`).

Smallest fix: build the snapshot and call `ruleFor` with
`{ ...pos, highWater: highWaterSince(pos, bars, i) }`, which is what
`backtest.ts:172` does.

### S2. The rotation backtest runs neither the floor stop nor the cooldown the live rotation rule runs
`agents/backtest.ts:192-235` vs `agents/tick.ts:586,702-705`

`runRotation` takes no `StopParams` and has no cooldown: its loop is
enter/exit on the rank only. The live rotation rows get the 8 % floor
(`tick.ts:586`, `maxLossPct` defaults to 0.08 for every kind) and the
two-bar (= two-day) re-entry cooldown (`tick.ts:702-705`).

So reference §3.4's whole table (default −12.2 % / −45.5 % with the filter
off / +128 % full) and §3.3a's rotation line describe a rule the loop does
not run, and reference §4.11's claim — *"The backtester runs the same stops
and the same cooldown, so the tables describe the shipped rule"* — is false
for `rotation-1d` and `rotation-1w-kraken`. In the −47 % bear year an 8 %
floor on each slot would have fired repeatedly and then blocked re-entry
for two days each time; that is not a small perturbation of a 22×/year
rotation.

Smallest fix: give `runRotation` the same `stops` argument `run` takes, and
re-run §3.4 before the rotation rows' record is read against it.

### S3. A zero mark is treated as a real mark, and `dayPnl` and `exposure` disagree about it
`agents/tick.ts:157` vs `agents/tick.ts:461`

`tick.ts:294`: when the venue quote is missing and the 1-minute candle list
is empty, `mark` is stored as `0`. Then:

- `dayPnl` uses `marks[sym] ?? now.avgCost` — `0` is not nullish, so it is
  used. **Verified by execution**, one $100 position: a good mark of 101
  gives `dayPnl = +1.00`; the same rows with the mark back as `0` give
  `dayPnl = −100.00`; with the mark simply absent, `0.00`.
- `exposure` uses `|| pos.avgCost` (`tick.ts:461`), so it falls back.

A single bad quote minute therefore fabricates a loss the size of the whole
book and trips `daily_loss_limit_usd` (default $5), blocking every new
entry on that venue and mode for the rest of the UTC day
(`agents_strategy.ts:623`). Exits are unaffected, so this is fail-safe in
direction, but it is a silent, self-inflicted kill switch.

Smallest fix: `const mark = marks[sym] || now.avgCost;` in `dayPnl`, and
store `mark: null` rather than `0` when neither source produced one.

### S4. A protective stop on a bar boundary claims the bar the next decision needs
`agents/tick.ts:678` vs `agents/tick.ts:697`

Stops claim `minuteStart` (`tick.ts:613,678`); bar decisions claim
`bars[i].start` or `dd[di].start` (`tick.ts:696`). Both go into the same
unique index `(strategy_id, symbol, bar_start)`.

**Verified by execution**:

```
stop at 2026-09-20T00:00:30Z claims bar_start 2026-09-20T00:00:00Z
the daily rule the next morning wants bar_start 2026-09-20T00:00:00Z  → collision: true
trend-1h stop at 09:00:40 claims 09:00:00 = the 09:00 bar the 10:00 tick wants: true
```

So a stop that fires in the first minute of a bar permanently consumes that
bar's decision: `decided()` returns true and the rule's own enter/exit for
that bar is skipped for good. Probability is 1-in-60 per stop, and
`trend-1h` hit 36 stops in the out-of-sample year (§3.3a), so it will
happen. Usually harmless (the rule has just exited and the cooldown blocks
re-entry anyway), but it is a silent loss of a decision and it removes the
record of what the rule would have said.

Smallest fix: claim a protective decision on a marker that cannot be a bar
start — e.g. `minuteStart + 1` ms, or a separate `kind` column in the
unique index.

### S5. Exposure ignores resting buy orders between turns
`agents/tick.ts:454-462, 522`

`exposure` is rebuilt each turn from **filled** orders only. Within a turn
`place()` adds a placed buy's notional (`tick.ts:522`), which is correct,
but on the next turn a still-resting Kraken post-only bid has vanished from
the tally. `inFlight` stops a second order on the *same* strategy × symbol,
not a first order on another pair in the same venue-and-mode bucket. With
the live cap at $100 and five $20 slots on one venue the arithmetic is
exactly at the limit, so any under-count crosses it.

Smallest fix: seed `exposure[bucket]` from `open` buy orders' unfilled
notional as well as from fills.

### S6. `combineDecision` can turn a hold into an exit — contradicting the reference, and pinned by a test
`_shared/agents_strategy.ts:560-563, 582-586`; `agents/strategy.test.ts:122`

```
if (rule.action === "hold" && jev.healthy != null && jev.healthy <= thresholds.exitMax) {
  return { action: "exit", reason: `model advises exit …` };
}
```

The doc comment above it says *"The model can VETO an entry or ADVISE an
exit"*. Reference §4.13 and the seeds say the opposite — `0037_agents.sql:244`:
*"Jev is asked on entries only and may veto one … exits are the rule's
alone."*

Today the branch is unreachable: `tick.ts:543` only calls `askJev` when
`rule.action === "enter"`, and `tick.ts:555` only calls `combineDecision`
in that case. But `exitMax: 0.3` is carried in every seeded row's `params`
(`0037_agents.sql:242-271`), it is read and passed on every decision
(`tick.ts:556`), and `strategy.test.ts:122` pins the behaviour as intended.
A future refactor that asks Jev on holds — the obvious next step for anyone
reading the params — hands the model the exit, against the design.

Smallest fix: delete the branch (and the `exitMax` params, and the half of
the test that pins it), or state in the function's own doc that it is
reachable only from a path that does not exist.

### S7. The Kraken nonce is per-isolate and can repeat or regress across isolates
`_shared/kraken.ts:86-89`; `agents/index.ts:134`

`makeNonce(start = Date.now() * 1000)` gives microsecond-looking values from
a millisecond clock, and a new generator is created on every `loadKraken()`
— i.e. per request. A dashboard load (which calls `refreshFees` and
`balances`, both private: `index.ts:154-157`, `index.ts:255`) concurrent
with a tick can emit the same nonce, or a delayed isolate's older nonce can
land after a newer one. Reference §2b: *"always increasing … repeated bad
nonces → temporary ban."*

Smallest fix: seed the nonce from `Date.now() * 1000 + a random 0-999
offset`, or set a nonce window on the key, or serialise private Kraken calls
behind the same lease the tick already takes.

### S8. `momentum-1d`'s `lookbackDays` parameter does nothing
`_shared/agents_strategy.ts:214`

`ret30d = d > 30 ? daily[d-1].close / daily[d-31].close - 1 : null` hard-codes
30. Both momentum rows carry `{"lookbackDays":30,…}` (`0037_agents.sql:258,267`)
and `ruleDecisionMomentum` reads only the derived word. Changing the row's
parameter would change nothing while appearing to. (`rotationParamsOf` does
honour `lookbackDays` for the rotation rank — only the momentum rule is
affected.)

Also in the same line: when fewer than 31 daily candles are cached,
`momentum_30d` is `"unknown"`, and `ruleDecision` only blocks on
`"negative"` (`agents_strategy.ts:274`) — so on the first ticks after a new
symbol is added the 30-day momentum gate is silently absent.

### S9. `loadSeries` never checks that the cached series is contiguous
`agents/tick.ts:204-223`

`warm` is decided on row **count** and the newest row's age
(`tick.ts:211`), and a warm cache is topped up only from `newest - spanMs`
(`tick.ts:212`). A gap in the middle — one venue outage, one failed turn —
is never healed, and `sma`, `priorRange`, `atrAt` and `realisedVol` all index
by array position (`agents_strategy.ts:22-63`), so a 100-bar SMA silently
becomes an average of 100 bars spanning 104 bars of time.

Smallest fix: treat a series whose consecutive `start` deltas are not all
`spanMs` as cold and refetch the whole window.

### S10. The Revolut X public budget is over-spent on calls the loop does not need
`agents/tick.ts:289-300`

Per turn the loop makes one `publicTickers`, one `publicPairs` and one
1-minute `publicCandles` **per symbol per exec venue**. With `0039`/`0040`
the Revolut X symbol set is {BTC, ETH, SOL, AVAX, SUI, XRP} → 8 public
Revolut X calls a turn against the documented 1 token/second bucket
(reference §2, §4.2 assumes "half a dozen"). `revxPublic` waits out a 429
twice (`revx.ts:212-235`), so the overflow is paid in seconds of turn time —
which feeds B7.

And most of it is waste: the 1-minute candle exists only to fill a *resting*
paper order (`tick.ts:384`), but every Revolut X order is marketable and
fills without it, and `mark` prefers the quote (`tick.ts:294`). Fetch the
1-minute candle only for venues/symbols with a resting paper order.

### S11. Pausing a strategy that holds a position switches off its stops
`agents/tick.ts:241`

`mode=in.(paper,live)` excludes `paused` rows from the turn entirely, so a
paused strategy's open position gets no ATR trail, no floor, no exit and no
observations — while the dashboard keeps showing it
(`index.ts:217` filters on `retired_at`, not on mode) and its capital keeps
inflating the scoreboard denominator (`src/agents.js:432`).
`riskGate`'s own `ctx.mode === "paused"` branch (`agents_strategy.ts:617`)
is dead for the same reason. The comment at `agents_strategy.ts:612-613`
("a paused book is the operator's to unwind") acknowledges the policy; the
page does not say it. At minimum, warn on the page when a paused row is
long.

### S12. The probe no longer covers the symbols the loop trades
`agents/index.ts:83`

`SYMBOLS = ["BTC/USD","ETH/USD","SOL/USD"]` drives the probe's pair-config
check (`index.ts:430`), Kraken's `TradeVolume` (`index.ts:465`) and the
spread readout (`index.ts:499`). `0039` and `0040` put AVAX/USD and SUI/USD
on both trend-4h rows, so the two newest — and widest, SUI at 24 bps
(§3.8) — pairs are never probed. A missing Revolut X pair entry means
`place()` refuses with "no pair config" *after* the bar has been claimed
(B6).

### S13. Client: the dashboard refresh has no cancellation or ordering guard
`src/agents.jsx:824-838`

`load()` has no `alive` flag and no request id, and it runs on a
`setInterval` alongside a manual ↻ button. Two overlapping calls resolve in
arrival order, so a slow response can overwrite a newer one — and
`fetchAgentsDashboard` writes the module cache unconditionally
(`src/agents.js:82`), so the stale copy is also what the next modal opens
on. `SymbolChart`'s effect does guard this (`agents.jsx:623,635`); the
dashboard does not. `load()` also sets `loading` true on every interval
tick, so the refresh button greys out once a minute.

### S14. Client: hide-values leaves position sizes unmasked
`src/agents.jsx:331, 401, 590`

Every money column goes through `m()`, and the chart header masks the size
too (`agents.jsx:662`: `m(book.base.toFixed(6))`). The positions table's
Size (`:331`), the orders table's Base (`:401`) and the fills table's Base
(`:590`) do not. With the mark shown one row over, an unmasked size is the
value.

### S15. Client: nothing on the page says a live row cannot trade because `live_confirmed_at` is null
`src/agents.js:621-642`

`agentsAlerts` raises a global pause, a venue fault and a live row on a
keyless venue. It does not raise the state that actually gates live
trading: `risk.live_confirmed_at === null` with at least one `mode: "live"`
row. In that state `place()` refuses each order and writes an `ops_errors`
line (`tick.ts:501`) while the page shows a normal-looking live strategy
that silently never trades. This is the first thing that will happen on the
day Davies flips a row to live.

### S16. "Today" is computed from three different day-opens
`agents/tick.ts:447-452`, `agents/index.ts:232-235`, `agents/index.ts:279-281`

The rule is "P&L in one place", and `dayPnl` is indeed shared
(`index.ts:67` imports it from `tick.ts`). Its *inputs* are not:

- the tick builds `dayOpen` from the in-memory daily series of whichever
  **signal** venue was loaded first for that symbol (`tick.ts:448-452`,
  keyed by symbol only, `if (dayOpen[sym] == null)`), and marks with the
  **exec** venue's mid;
- the dashboard builds `dayOpen` from `agent_candles` with **no venue
  filter** (`index.ts:233`), so whichever venue's row sorts first wins;
- `today` order counts come from a per-strategy query (`index.ts:221`)
  while the tick's cap counts per venue × mode (`tick.ts:439-441`).

The basis is ~1 bp so the numbers will look fine, but the page's "today"
and the loop's kill-switch "today" are not guaranteed to be the same
figure, and nothing would catch it if they drifted. Pick one source (the
strategy's own signal venue, stored on the row) and use it in both.

---

## Correct as far as verified

Paths traced end to end and found sound:

- **The region fix (reference §2.2, §4.14) is complete on every path that
  touches money.** `revxVenue.candles` → `publicCandles` with
  `region=${region}` (`revx.ts:253,302-306`); `quotes` → `publicTickers`
  with the region **and** `quotesForRegion` dropping any other region's row
  (`revx.ts:256,264-271,307-311`); the probe reports the requested region
  and each filtered row's spread (`index.ts:443-451`). The tick prices
  every order from `markets.get(mk(s.venue, sym)).quote`, i.e. the exec
  venue's region-filtered touch (`tick.ts:293,708-714`), and paper fills use
  the exec venue's own 1-minute candle (`tick.ts:291-295,382-391`). Pinned
  by `revx.test.ts:141,160`. No paper order is priced from the wrong book.
- **Jev is an entries-only node and is never given a number or a date.**
  `askJev` fires only when `rule.action === "enter"` (`tick.ts:543`);
  `combineDecision` is only reached on an entry (`tick.ts:555-557`);
  exits pass the model untouched. The state handed over is
  `CategoricalState` — ten closed-set words (`agents_strategy.ts:137-148`)
  — while every number stays in `Snapshot.numbers` and goes to the database
  only (`tick.ts:568`). Thresholds match the design: veto below
  `enterMin` 0.6 (`agents_strategy.ts:578`), veto at `caution ≥ 1.75` on
  the 0…2 expected-level scale reference §6 measured
  (`agents_strategy.ts:579`, `tick.ts:556`), echo mismatch downgraded to
  "no answer" (`agents_strategy.ts:572-575`). A transport failure,
  a malformed answer, or an answer missing any asked question all produce
  `provider: "none"` with no answers (`jev.ts:200-207,225`), which becomes
  **hold** on an entry (`agents_strategy.ts:577`) — pinned by
  `tick.test.ts:508` and `jev.test.ts:108,119`. Cost is OpenRouter's own
  `usage.cost` when present, else $0.042/M input tokens
  (`jev.ts:74-78,211,217`), matching reference §6's measured
  `0.000018354 = 437 × 0.042/M`.
- **Position and P&L arithmetic.** `applyFill` averages buys in, realises
  `sold × (price − avgCost) − fee` on sells, keeps the cost basis unchanged
  after a partial exit, and clamps an oversell to what is held
  (`agents_strategy.ts:87-111`). **Verified by execution**: buy 1 @ 100
  (fee 0.09) then sell 0.4 @ 120 (fee 0.05) → `base 0.6, avgCost 100,
  realisedUsd 7.86, feesUsd 0.14` — i.e. 0.4 × 20 − 0.05 − 0.09, signs and
  fees correct. `positionFromFills` sorts by timestamp and is
  order-independent (`agents_strategy.ts:113-115`, pinned
  `strategy.test.ts:66`). There is no positions table to drift.
- **`dayPnl` measures only today.** Realised since the day began plus the
  change in unrealised from the day's open (`tick.ts:143-161`).
  **Verified by execution** for a position carried in from a previous day:
  open 100, mark 101 → `+1.00`, not the position's whole lifetime gain.
  Pinned by `tick.test.ts:711`.
- **The risk gate stops new risk only.** `hold` always passes; `paused` and
  `globalPause` stop everything; the order-count cap, the loss limit, the
  per-order cap and the exposure cap are all inside `if (action === "enter")`
  (`agents_strategy.ts:615-628`). An exit is never refused for size, budget
  or a bad day. Pinned `strategy.test.ts:141,228`.
- **`live_confirmed_at` is checked before the venue is called**, alongside
  credentials, on every live placement (`tick.ts:500-502`); pinned
  `tick.test.ts:405,414`.
- **`pending`-before-call.** The intent row is inserted before
  `venue.placeLimit` and the row stays `new` whatever the placement reply
  says — even `"filled"` — so a fill is only ever recorded from the venue's
  own view, with its fee (`tick.ts:503-516`); pinned `tick.test.ts:421,436`.
- **A venue-cancelled order that had filled counts as a fill of that part**
  on both venues (`tick.ts:404-408`, `revx.ts:284-285`,
  `kraken.ts:211-215`); a partial fill is a position the stops and caps see
  (`tick.ts:437`, pinned `tick.test.ts:452,493`).
- **Stops outrank resting exits, and are claimed per minute.** The stop
  block runs before the in-flight guard (`tick.ts:664` vs `tick.ts:693`);
  on Revolut X a resting order is cancelled first and the sale goes
  marketable at the bid, on Kraken a resting ask is left to work
  (`tick.ts:669-685`); a stop whose order did not go out is retried the next
  minute, not the next bar. Pinned `tick.test.ts:565`.
- **Marketable vs post-only per venue matches reference §4.3.** Revolut X
  takes the touch on every order — `allow_taker` + IOC (`revx.ts:326`),
  price ceiled to the tick on a marketable buy so it still reaches the ask
  (`tick.ts:493`, `agents_strategy.ts:644-650`); Kraken rests `oflags: "post"`
  GTC, stops included, priced at the ask (`kraken.ts:267-269`,
  `tick.ts:669,683`). Pinned `kraken.test.ts:150`.
- **Kraken `validate=true` is a probe-only path.** It is priced far from
  market, post-only, and if a `txid` ever came back it is cancelled at once
  and flagged (`index.ts:475-490`). No other code path sets `validate`.
- **Signing.** Revolut X's message is `timestamp + METHOD + path-from-/api +
  query-without-"?" + minified body`, pinned byte for byte against the
  reference's own example (`revx.ts:77-79`, `revx.test.ts:12,26,79`).
  Kraken's `API-Sign` reproduces the documented test vector
  (`kraken.ts:71-78`, `kraken.test.ts:19`). Neither key nor signature is
  ever stored: `placeLimit` keeps `{ request, result }` only
  (`revx.ts:329-332`, `kraken.ts:271-274`), and the probe reports
  `keyForm` / `secretBytes`, never a byte of a key (`index.ts:422,460`).
- **The bar claim is a real claim.** Unique index on
  `(strategy_id, symbol, bar_start)` (`0037_agents.sql:119-120`); the insert
  is the claim, and a 409 is caught and turned into a skip
  (`tick.ts:566-577`). Pinned `tick.test.ts:384,394` including the race
  where another tick claims between the check and the insert.
- **Sizing and venue minimums.** `sizeBase` floors to `base_step` and
  refuses anything under `min_order_size` or `min_order_size_quote`
  (`agents_strategy.ts:657-664`). **Verified by execution**: $20 at $80,000
  on Revolut X's BTC config → `0.00025000`; `ceilToStep(80000.004, "0.01")`
  → `80000.01`, `floorToStep` → `80000.00`.
- **The two-bar cooldown after any exit** is applied live
  (`tick.ts:702-705`) and in the backtester (`backtest.ts:144,156,169`) for
  `run`-driven rules; pinned `tick.test.ts:519`.
- **Parameters match what the reference reports for the seeded rows.**
  `trend-4h` / `trend-4h-kraken` / `trend-1h` all run
  `fast 20, slow 100, breakoutUp 55, breakoutDown 20, atrN 14, atrStop 3,
  volN 42` (`0037_agents.sql:246,254,271`) = `DEFAULT_TREND`
  (`agents_strategy.ts:174`) = §3.7's "seeded" column; `rotation-1d` is
  `DEFAULT_ROTATION` and `rotation-1w-kraken` differs only by
  `minHoldDays: 7`, as §3.4 says. `0039`/`0040` add AVAX and SUI to both
  trend-4h rows and move capital 60 → 80 → 100 so each symbol keeps its $20
  slot, and both guards are idempotent (`0039:59`, `0040:89`).
  `KRAKEN_ALTNAME` / `KRAKEN_PAIR_ID` / `KRAKEN_ASSET` know both new coins
  (`kraken.ts:35-42`).
- **The rules themselves implement what §3 describes**: entry needs trend
  up + close above the prior `breakoutUp`-bar high + 30-day momentum not
  negative + volatility not extreme; exit on trend down, a close below the
  prior `breakoutDown`-bar low, or the ATR clause
  (`agents_strategy.ts:262-277`). Momentum is long while
  `momentum_30d === "positive"`, with the extreme-volatility gate on entry
  only (`agents_strategy.ts:286-295`). Rotation ranks by lookback return,
  takes the top N, and the bear filter drops anything below its `slowDays`
  average, with an uncomputable average not blocking
  (`agents_strategy.ts:321-344`); `bearFilter` is a row parameter, not a
  constant (`tick.ts:184`). Volatility is annualised per bar size —
  `(ONE_D / barMs) × 365` live (`tick.ts:611`), `(24 / barHours) × 365` in
  the backtester (`backtest.ts:141`) — so `trend-1h` reads 8,760 bars a year
  on both sides, as §3.4 requires.
- **The retired dislocation row is out of the loop and off the page but
  keeps its records.** `0038` sets `retired_at` and `mode='paused'` in place
  after the delete was refused by the FK; the tick filters
  `mode=in.(paper,live)&retired_at=is.null` (`tick.ts:241`) and the
  dashboard filters `retired_at=is.null` (`index.ts:217`). Pinned
  `tick.test.ts:234`.
- **RLS.** All nine agent tables have RLS enabled with **no policies** —
  `agent_strategies`, `agent_risk`, `agent_decisions`, `agent_orders`,
  `agent_candles`, `agent_basis`, `agent_observations`, `agent_backtests`
  (`0037_agents.sql:226-233`) and `agent_locks` (`0037_agents.sql:291`) —
  so anon and authenticated are denied and only the function's service-role
  key reaches them. Auth on the function is a constant-time cron bearer or
  an app token, with `tick` and `probe` operator-only
  (`index.ts:99-112, 532-553`).
- **The observation change check is canonical.** `canon` sorts object keys
  before comparing, so jsonb's key order cannot re-write an unchanged state
  (`tick.ts:117`); the last state per strategy × symbol is looked up one tiny
  query at a time so a busy pair cannot push a quiet pair out
  (`tick.ts:475-481`). Pinned `tick.test.ts:258,278`.
- **The basis is recorded every fifth minute for every symbol both venues
  quote** (`tick.ts:271-281`), pinned `tick.test.ts:289`.
- **One pair's failure is one pair's failure**: the per-symbol body is
  wrapped (`tick.ts:718-721`), and quotes, pairs and candles are each caught
  per venue or per pair (`tick.ts:269,288,297`). Pinned `tick.test.ts:608`.
- **The chart module.** `chartGeometry` is pure, clamps an empty or
  one-point series, and is pinned by 34 cases (`src/agents.test.js:252-367`).
  `src/agents_chart.js:127` deliberately bounds the right edge to three bars
  past the last close so a stale cache squeezes the line rather than the
  window.
- **Client status logic.** A reading under three minutes old means running;
  otherwise the per-rulebook decision clock decides; paused and the global
  pause win over both (`src/agents.js:256-268`), pinned
  `src/agents.test.js:135-171`. Negative and null money formatting, the
  `—` for nulls and the stated percentage bases are pinned
  (`src/agents.test.js:72,516-541`).

---

## Missing tests in priority order

1. **A `pending` live order that filled before reconciliation** (B1). Stub a
   venue whose `activeOrders` is empty but whose fill exists; assert the row
   does **not** become `rejected` and that the position is visible to
   `positionFromFills` next turn. This is the single most expensive untested
   path: `tick.test.ts:464` only covers the case where the order *is* in the
   active list.
2. **`cancelOrder` when the post-cancel read fails** (B2). `venue.order`
   returns `{ok:false}` after a successful cancel → assert the row is not
   settled `cancelled` with `filled_base` 0, and that the key stays in
   flight. Today `tick.test.ts:493` only covers `ok:true`.
3. **`filled` beyond one page** (B3). Feed the stub db more than 1,000 filled
   rows (or make the stub honour a max-rows cap) and assert the position
   equals the position from the full set. Equivalent for
   `runDashboard`.
4. **Global pause and the daily loss limit against a re-quote** (B5).
   Seed a resting Kraken buy whose touch has moved, set
   `global_pause: true`, assert no order is placed. Same with
   `dayPnlUsd ≤ -limit`.
5. **A bar decision whose order cannot be placed** (B6). Make
   `venue.pairs()` throw (or `sizeBase` return null) on an `exit` decision,
   then re-tick the same bar and assert the exit is retried rather than
   skipped as "already decided".
6. **The lease under an overrunning turn** (B7). Assert the release is
   conditional on the holder: turn A overruns, turn B takes the lease, turn
   A's `finally` must not free B's lease.
7. **`buildSnapshot` / `ruleDecision` fed the trailed high-water** (S1). Pin
   that a position 25 % below its high since entry reads
   `drawdown_from_high: "notable"|"large"`, not `"none"`, and that the
   bar-level ATR clause fires at `high − 3×ATR`. Pair it with a backtester
   assertion that `run`'s snapshot and the tick's snapshot agree for the
   same bars and fills — the cheapest guard against any future
   backtest/live divergence.
8. **`runRotation` with stops and cooldown** (S2), plus a pin that the
   rotation numbers in `summary.json` were produced with the shipped stops.
9. **`dayPnl` and `exposure` with a missing or zero mark** (S3). Pin that a
   zero mark does not fabricate a loss and does not trip the daily limit.
10. **A protective stop on a bar boundary** (S4). Fire a stop at
    `bar_start + 30 s` and assert the next bar decision still happens.
11. **`supabase/functions/agents/index.test.ts` does not exist at all.**
    CLAUDE.md requires a co-located pin for every Edge Function's pure
    helpers, and `_shared/agents_strategy.ts:7` still claims *"it is pinned
    by agents/index.test.ts"*. Unpinned today: `authorise`, `envAny`,
    `isNotReady`, `chartWindow`, `jevStats`, the dashboard's aggregation
    (`byVenue`, `byMode`, `totals`, `todayUsd` per strategy) and the basis
    percentile arithmetic (`index.ts:312-322`).
12. **Browser sweep fixture drift.** `test/browser/app-sweep.mjs:279-354`
    still models five strategies including the retired `dislocation-1m`,
    three symbols on trend-4h, and **no `todayUsd` or `dayStart` anywhere**
    — so the TODAY scoreboard cell the sweep asserts at
    `app-sweep.mjs:1136` is only ever exercised with `0`. Refresh the
    fixture to the current payload and assert a non-zero, signed "today".

---

## Doc gaps

- **reference §4.11 is wrong for the rotation rule.** *"The backtester runs
  the same stops and the same cooldown, so the tables describe the shipped
  rule"* — `runRotation` (`backtest.ts:192-235`) runs neither (S2). Either
  fix the code or correct §3.4, §3.3a and §4.11.
- **The trailing stop is described in three places as trailing from the
  high, and the bar rule does not** (S1) — `0037_agents.sql:244`,
  reference §3.3a, §4.11. Say which stop trails (the per-minute one) and
  which does not.
- **Reference §2 documents no `GET /1.0/orders/{id}` and no
  `/1.0/orders/active`**, yet both carry the live settlement path (B4). Add
  them, with the real field names, once the probe has read them — this is
  exactly the §4.14 rule ("any fact of that kind written into this reference
  is a requirement on the client with a pin") applied in reverse: the client
  has facts the reference has never verified.
- **§4.2 says "half a dozen" public Revolut X calls a turn.** After
  `0039`/`0040` it is eight (S10). The sentence is load-bearing — it is the
  justification for the one-minute cadence against a one-token-a-second
  bucket — so it needs the new number and a note on what the retries cost.
- **Nothing documents what happens to a paused strategy that is long**
  (S11) — no stops, no exits, still on the page. The ledger's item 0 lists
  "three switches, all Davies'"; this is the fourth thing those switches do.
- **Retention is documented for basis, observations and candles
  (`0037_agents.sql:340-349`) and for nothing else.** `agent_decisions` and
  `agent_orders` grow without bound (~150 decisions and ~25 orders a day
  today); B3 makes that a correctness problem, not just a storage one.
  Write down the intended retention.
- **LEDGER.md item 0(b) — the thin-book guard — is still open and is the
  right call**, but it should name the interaction this review found: the
  guard is the only thing that would stop a marketable Revolut X stop
  (`tick.ts:669,683`) selling into a wide UK book, and the marketable-IOC
  choice is also what makes B1 a live-money hole rather than a Kraken
  curiosity.
- **A fresh session cannot learn from the docs that the loop's own
  `agent_orders` reads are unpaged**, that `dayPnl`'s inputs come from three
  different day-opens (S16), or that `combineDecision` has an unreachable
  exit branch its test pins (S6). All three read as intentional to a new
  reader.
- Minor: `_shared/agents_strategy.ts:7` cites a test file that does not
  exist; `supabase/functions/agents/backtest_portfolio.ts` is present but
  untracked in git (covered by `knip.json`'s `backtest*.ts` entry, so it
  will not redden `check` when it lands).
