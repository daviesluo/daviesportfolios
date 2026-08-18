-- Restart the Trading 212 order-history backfill from page one.
--
-- The first shaper expected a flat ticker/filledQuantity row.
-- Production publishes nested `{ fill, order }`, so every page parsed
-- to 0 rows while the cursor still advanced. After the nested shaper
-- landed, the walk has to start at page one again or the skipped fills
-- stay skipped forever (a completed walk only re-reads page one, which
-- holds the newest fills, not the ones already walked past).
--
-- Idempotent on a fresh database: `0023` creates an empty
-- `t212_orders_sync`, and this UPDATE matches zero rows.

update public.t212_orders_sync
set cursor     = null,
    complete   = false,
    fetched    = 0,
    last_error = null,
    updated_at = now();
