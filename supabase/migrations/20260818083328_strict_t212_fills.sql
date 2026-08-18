-- Rebuild T212 order history using fill evidence only.
--
-- The earlier shaper accepted `{ order }` rows without a nested `fill`
-- and used limitPrice / createdAt as if they were execution price /
-- filledAt. Those values are not exact (price improvement and delayed
-- execution make both differ), so they cannot drive Investment
-- Performance Deposited.
--
-- `orders-sync` immediately starts the idempotent history walk again.
-- During the walk the client/snapshot recorder keeps the board ledger;
-- it switches to T212 fills only after every account is complete.

delete from public.t212_orders;

update public.t212_orders_sync
set cursor = null,
    complete = false,
    fetched = 0,
    last_error = null,
    updated_at = now();
