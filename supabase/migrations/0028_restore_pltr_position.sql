-- One-off data repair: put PLTR back on the board.
--
-- What happened. `migrate()`'s "sold out but never closed" heal fires on
-- any holding that has sells and whose LOT LEDGER nets to ≤ 0, then
-- writes `shares: 0`, zeroes the cost, marks it closed and strips the
-- ticker out of every position. PLTR's ledger is a complete 2024 round
-- trip — 6.5 bought across four lots, 6.5 sold on 2024-08-08 — while the
-- account held 55 shares the ledger had never been told about. So the
-- heal deleted a live ~$9,400 position, and re-deleted it on every load:
-- typing the shares back into the edit modal survived until the next
-- reload. The code fix (the heal now requires the BOARD to already read
-- ~0 shares) stops the bleeding, but it cannot know what the position
-- was. This restores it.
--
-- Quantity and average cost are the owner's own figures: 55 shares at
-- $123.29, $6,780.95 total. The next Trading 212 sync confirms both from
-- `/equity/positions`, which has reported this position all along — the
-- sync's `holdings` map was allow-listed to two ETFs, so the number was
-- fetched and thrown away.
--
-- The 2024 lots and the 2024-08-08 sell are left EXACTLY as they are.
-- They are real history and they are correct; what is missing was never
-- a lot, it is the later re-entry, whose date nothing on this side
-- knows. The order-history backfill is stuck before it reaches that far
-- back (see `t212_orders_sync.last_error`), so inventing a date here
-- would be fabricating a transaction. The deposit line already handles
-- this case: whatever the board holds beyond what the ledger accounts
-- for stands in at board average cost, dated before every window.
--
-- `t212PositionKey` is set so that if the ticker is ever stripped from
-- the board again, `stripClosedFromPositions`'s restore path knows which
-- slot to put it back into.
--
-- The version bump is deliberate. `board_data` uses optimistic
-- concurrency: without it an open tab holding the old version would save
-- its stale copy straight over this repair. Bumping forces that tab into
-- the conflict banner and a reload instead.
--
-- Two statements rather than one, each independently idempotent and each
-- a plain expression — no CTE inside an UPDATE's SET clause. Applied
-- automatically by `migrations.yml` on push to main; do NOT also run it
-- by hand, or the remote records a version no local file matches and
-- every later push fails outright.

-- 1. Restore the holding itself: real quantity and cost, no longer
--    closed, remembering the slot it belongs to. Guarded on the board
--    still reading it as sold out, so a book where PLTR was genuinely
--    sold again later is left alone.
update public.board_data
set data = jsonb_set(
             data,
             '{holdings,PLTR}',
             ((data -> 'holdings' -> 'PLTR') - 'closed')
             || jsonb_build_object(
                  'shares', 55::numeric,
                  'cost', 123.29::numeric,
                  't212PositionKey', 'CM'
                )
           ),
    version = version + 1,
    updated_at = now()
where id = 1
  and data -> 'holdings' ? 'PLTR'
  and coalesce((data -> 'holdings' -> 'PLTR' ->> 'shares')::numeric, 0) <= 0;

-- 2. Put it back in its board slot — CM, "AI Appli", alongside AMZN /
--    MSFT / META / GOOG. Without this the holding exists but the
--    scoreboard never counts it: every total on the board is scoped to
--    tickers a position actually references.
update public.board_data
set data = jsonb_set(
             data,
             '{positions,CM,tickers}',
             (data -> 'positions' -> 'CM' -> 'tickers') || '["PLTR"]'::jsonb
           ),
    updated_at = now()
where id = 1
  and data -> 'holdings' ? 'PLTR'
  and data -> 'positions' ? 'CM'
  and jsonb_typeof(data -> 'positions' -> 'CM' -> 'tickers') = 'array'
  and not ((data -> 'positions' -> 'CM' -> 'tickers') @> '["PLTR"]'::jsonb);
