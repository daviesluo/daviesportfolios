-- The one purchase missing from RKLB's ledger.
--
-- `0030` restored the three multi-platform share counts. Two of the
-- three already carried the other platform's purchases as lots — SPCX's
-- 50 and 21, HOOD's 30 — so their ledgers agree with their totals. RKLB
-- did not: 160 shares on the board against 30 in the ledger, and the
-- 11.5 shares bought away from Trading 212 appeared nowhere at all.
--
-- The owner's own record for that purchase is 11.5 shares at $48.18 on
-- 2025-11-07. It is a real trade, it is the exact excess `0030` put
-- back, and with it the ledger stops being silent about where those
-- shares came from.
--
-- This does NOT close the whole gap: 118.5 of the Trading 212 shares are
-- still missing from the ledger, because the order backfill parked
-- before reaching them. That is fixed in the Edge Function, not here —
-- the fills will arrive on their own and the lot editor offers them.
--
-- `shares` and `cost` are untouched. The board is the source of truth
-- for quantity; the ledger supplies dates.
--
-- Idempotent: the guard is the absence of a 2025-11-07 row, so a second
-- application is a no-op. Applied by `migrations.yml` on push to main —
-- do NOT also run it by hand.

update public.board_data
set data = jsonb_set(
             data,
             '{holdings,RKLB,lots}',
             jsonb_build_array(
               jsonb_build_object('date', '2025-11-07', 'shares', 11.5, 'cost', 48.18)
             ) || coalesce(data -> 'holdings' -> 'RKLB' -> 'lots', '[]'::jsonb)
           ),
    version = version + 1,
    updated_at = now()
where id = 1
  and data -> 'holdings' -> 'RKLB' is not null
  and not exists (
    select 1
    from jsonb_array_elements(coalesce(data -> 'holdings' -> 'RKLB' -> 'lots', '[]'::jsonb)) l
    where l ->> 'date' = '2025-11-07'
  );
