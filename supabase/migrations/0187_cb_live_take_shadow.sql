-- 0187: "Stablecoin quotes USDC/GBP" (agents/cb_live.ts), Coinbase's live executor, records what a taker entry would do: the
-- take shadow. Records only: nothing is sent, cancelled or promised, and the executor stays maker-only (its one taker order is
-- the 24-hour stop). docs/agents/reviews/2026-10-29-cb-live-design.md §11.
--
-- On whose word. Davies, 2026-10-31 ~02:00 UTC, in the message that armed Revolut X LIVE's take ("RX USDT/GBP上") and put the
-- Revolut X USDC/GBP executor's take in shadow ("RX USDC/GBP开 shadow"): "Coinbase USDC/GBP也做好加开 shadow记录".
--
-- `take_mode`, 'off' | 'shadow', default 'off'. 'live' is not allowed: a live taker entry on Coinbase is a new decision, a new
-- migration lifting this check, and Davies' word. With 'shadow', each turn, for every rung the decision source ('paper' or
-- 'self') wants to enter, outside an FX closure and a release blackout: the take's limit is k + this account's taker fee
-- (Coinbase's transaction_summary for SPOT, read once a day, kept in cb_live_state) from the fair the entries are priced on;
-- when the turn's touch is through it, the book is read with its sizes (GET product_book, once a turn at most), and when that
-- read rests more coin through the limit than the executor's holding line (£1 at fair, or the product's minimum), a
-- `take_shadow` row goes into cb_live_events (60 days, 0177's prune) with the limit, size, fee, funds check and the read.
--
-- Its undo, at any time (the next turn records nothing):
--
--   update public.cb_live_config set take_mode = 'off', updated_at = now() where id = 1;
--
-- No grant and no policy: row level security is on, and 0082's default privileges keep `anon` and `authenticated` out.

alter table public.cb_live_config add column if not exists take_mode text not null default 'off';
alter table public.cb_live_config drop constraint if exists cb_live_config_take_mode_check;
alter table public.cb_live_config add constraint cb_live_config_take_mode_check check (take_mode in ('off', 'shadow'));

update public.cb_live_config set take_mode = 'shadow', updated_at = now() where id = 1;
