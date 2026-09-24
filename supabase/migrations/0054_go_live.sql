-- The first live row. It waited unnumbered as docs/agents/go_live.sql.draft
-- (it was numbered 0047, 0048, 0049, 0050 and 0051 on 2026-09-23 alone, each
-- new migration taking the number from under it) and moved here as 0054 on
-- 2026-09-24, on Davies' word in the conversation (22:35 UTC), after a fresh
-- read-only check of every precondition. Pushing this file applied it
-- (`.github/workflows/migrations.yml` runs `supabase db push` on every push to
-- main). Arming is the separate statement under AUDIT below, run in that
-- conversation; the loop then places the first live entry on its own.
--
-- WHAT IT DOES
--
-- Adds ONE live row — `trend-4h-live`, Revolut X, BTC/ETH/SOL/AVAX,
-- four equal $12.50 slots, $50 — and sets the caps its first round trip
-- runs under. It leaves the row UNARMED: `live_confirmed_at` is null
-- when it has run, and the one statement that arms it is run in the
-- conversation where Davies says go (see AUDIT below). `trend-4h` stays
-- exactly as it is: paper, $100, same rulebook, same venue, and SUI as
-- well as the four.
--
-- WHY $50 (Davies, 2026-09-24; reference §3.31, reviews/2026-09-24-trend4h-golive-validation.md)
--
-- He wants the row live at $50 after a validation that fixes what it
-- finds. It found nothing about $12.50 that the venue objects to: each
-- order is 125 times the $0.10 minimum, rounding costs at most $0.00006,
-- a round trip costs $0.025–0.036 (19.8–28.8 bps), and a floor exit
-- loses about $1.01. It found two ways a buy fee taken in the coin left
-- the book "long" for good, D11 and D12, and both are fixed and pinned
-- (reference §4 item 33). Before the go the sub-account must hold at
-- least about $51 of USD (four slots, the 10 bps entry allowance and the
-- fees), and nothing may ever be traded in it by hand: the floor counts
-- the venue's balance.
--
-- WHY FOUR COINS (2026-09-23, reference §3.20's addendum)
--
-- SUI stays on paper and does not go live; Davies left the call to the
-- session. Real money goes only to the core majors and to coins that
-- clear §4.15's bar under the stop that runs: AVAX does, SUI clears
-- window A only, and its UK book is the thinnest of the five. Its paper
-- record continues on `trend-4h`. The $50 is spread over the four at
-- $12.50 a slot; the fixed $20 per-order cap went on 2026-09-23 (`0048`,
-- reference §4.26). The live row and its control still share every bar
-- on the four coins: the comparison reads the fill against the paper
-- assumption in bps, so the slots differing ($12.50 live, $20 paper)
-- does not blur it.
--
-- WHY A NEW ROW RATHER THAN FLIPPING `trend-4h`
--
-- Two reasons, one safety and one measurement.
--
-- Safety: `trend-4h` is long BTC, ETH and SOL on paper, bought
-- 2026-09-21 at $13.33 a slot. Until the position key carried the mode
-- (fixed 2026-09-22), flipping that row would have handed those three
-- paper positions to the live book, and the first exit or floor stop
-- would have placed a REAL sell at Revolut X for base the account never
-- bought. That is fixed — a live book now starts flat — but flipping in
-- place still strands the three paper positions: no rule would manage
-- them again, they would sit in the paper exposure bucket forever, and
-- the page would show a live row holding three positions nothing owns.
--
-- Measurement: a paper twin of the live row, on the SAME venue and the
-- same rulebook, is the only thing that measures the live fill against
-- the paper assumption (the touch plus 9 bps). The difference between
-- the two Revolut X rows on any bar they both trade IS the
-- implementation shortfall, which nothing in the backtests could compute.
-- (Kraken runs no row since `0046`; nothing else measures this.)
--
-- There is no simpler alternative worth taking. Flipping `trend-4h` in
-- place was offered here until 2026-09-22 and is now struck: besides
-- stranding the three paper positions, it makes the DASHBOARD draw one
-- position out of two books — base, average cost, opened-at, high-water
-- and the realised/unrealised split all wrong — and bills the whole
-- blend to `live`, which is the headline number for how much real money
-- this has made. The page was given the same book resolution as the tick
-- the same day, so the blend no longer happens; the stranded positions
-- still would.
--
-- CAPS (reference §3.31)
--
-- `max_exposure_usd` is the LIVE cap, per venue account. It starts at $15
-- (below), then moves in two steps, each a statement run in the
-- conversation, not in this file:
--
--   $15 — the first round trip. Marked to market, $15 admits ONE $12.50
--         entry and refuses a second (the first would have to be down
--         80 % to make room).
--   $30 — two slots, for the rest of the first week. Only once a person has
--         read that first round trip back cleanly. When its BUY has
--         settled, and BEFORE its exit: the fee fields the venue sent
--         (B4/D8), and the account's balance of the coin against the book
--         (a buy that came back with no fee was booked from that balance,
--         and its row's `fromAccount` shows what was read, D12). After its
--         SELL: the book exactly flat, and the account holding under one
--         step of the coin (D11).
--   $75 — all four slots, with room. After seven days with no unexplained
--         difference between the venue's balances and the book.
--
-- $75 is NOT a loosening of risk. The rulebook does not pyramid
-- (`ruleDecision` only ever holds or exits while `position.base > 0`), so
-- four coins at one $12.50 slot each can never deploy more than $50 of
-- capital, whatever this number says. What the room is for: `tick.ts`
-- derives exposure as base x MARK, not cost. At $50 the fourth entry
-- would be refused the moment the three slots already held were in profit
-- at all, so the cap would tighten exactly when the rulebook was working.
-- $75 leaves the fourth slot reachable until the other three are up two
-- thirds.
--
-- The other two limits are unchanged, and written below so what goes live
-- is readable here:
--
--   daily loss limit, $5 — one number for every venue x mode bucket, paper
--     included. It is inert at $50: all four floors in one day lose
--     $4.05–4.27. Lowering it for the live row would halve it for its
--     paper control too.
--   orders, 40 a day per bucket — far above what four slots use.
--
-- The paper rows keep their own $300 bucket. There is no per-order number
-- to set: an entry is its row's slot (capital / coins, so $12.50 here),
-- and the gate refuses one more than 10 % over it (reference §4.26).
--
-- TO UNDO
--
-- `update public.agent_risk set live_confirmed_at = null where id = 1;`
-- stops every live BUY, on both venues, at once, and leaves the exits
-- armed. That is the switch to reach for first.
--
-- Until 2026-09-22 that sentence was false in the way that matters. The
-- check in `place()` was side-agnostic, so clearing the confirmation
-- refused the protective SELL as well: the one lever the operator is
-- told to pull would have left real coins with no floor and no rule
-- exit, once a minute, while the decision row recorded that the exit was
-- allowed. It is side-aware now, and pinned. The same paragraph also
-- offered `mode = 'paper'` as an undo; read literally that made the row
-- flat, so the real coins lost their exits and the row started buying on
-- paper beside them. A position is now resolved to the book that HOLDS
-- it, so real coins outrank the label and keep their exits whatever the
-- row is called.
--
-- `global_pause` remains the one switch that outranks an exit. It is
-- meant to: it is a person saying stop everything, and an operator
-- unwinding a paused book by hand is the intended path.

-- The row is written out in full rather than copied with `select … from
-- trend-4h`, so what goes live is readable HERE and cannot drift if a
-- later migration edits the paper row.

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

-- Not `on conflict do nothing`: if this row already exists the migration
-- should FAIL rather than quietly arm `live_confirmed_at` beside a row
-- in some other shape.

-- AUDIT 2026-09-23: the push does NOT arm the first order. Setting `live_confirmed_at` here made the loop place the first
-- live order by itself at the next bar that signals — hours or days after the push, with nobody in the conversation —
-- which is not "the first live order needs Davies' confirmation in the same conversation". The row goes in with entries
-- refused (each refusal is on the record: "live not confirmed"); the operator runs the one statement below in the
-- conversation where Davies confirms, and the first entry follows on the next signal.
--
-- The first round trip is ONE slot: the exposure cap admits a single $12.50 entry (marked to market, with room), so the
-- settlement read-back (B4: filled_quantity / average_fill_price / total_fee + fee_currency, and whether a buy's fee is
-- taken in the coin, D11/D12) is verified on one order before four are at risk. `live_confirmed_at` is written null
-- here so the row goes in unarmed whatever the column held before.
update public.agent_risk
   set max_exposure_usd     = 15,
       daily_loss_limit_usd = 5,
       max_orders_per_day   = 40,
       live_confirmed_at    = null,
       updated_at           = now()
 where id = 1;

-- In the conversation, on Davies' word (not in this file):
--   update public.agent_risk set live_confirmed_at = now(), updated_at = now() where id = 1;
-- When the first BUY has settled, BEFORE its exit, a person reads it back: the fee fields the venue sent (B4/D8), and the
-- account's balance of the coin against the book (with no fee reported, the row's `fromAccount` shows what the booking
-- read, D12). After its SELL: the book exactly flat, and the account under one step of the coin (D11). Anything else:
-- clear `live_confirmed_at` (exits stay armed) and find out why.
-- Then, two slots for the rest of the first week:
--   update public.agent_risk set max_exposure_usd = 30, updated_at = now() where id = 1;
-- After seven days with no unexplained difference between the venue's balances and the book, all four slots:
--   update public.agent_risk set max_exposure_usd = 75, updated_at = now() where id = 1;
