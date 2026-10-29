-- 0174: `cb_quote_inputs` takes Coinbase's USDT-USD minutes (kind `cb:USDT-USD`) beside Yahoo's EUR/USD.
--
-- Why. The Coinbase arms price USDT at Coinbase's own USDT-USD since 2026-10-29 08:00 UTC (`cb_live`, the base prereg's
-- Deviation 5; Davies, 2026-10-29: "目前coinbase的测试策略全部直接改用coinbase自己的币价而不是revolutx的"). The base call
-- fetches those minutes and stores them here as `CB_USDT_KIND`, but 0112 made the kind check `kind in ('fx:EURUSD')`, so every
-- write was refused (`agents.cb_rec` "cbusdt … violates check constraint", 13 times from 08:02) and the USDT books found no coin
-- value and stayed dark: no entry, exits and stops as the engine's dark minute allows. Nothing wrong was traded.
--
-- What it does: the kind check admits both kinds. From the next minute the call stores USDT-USD and the USDT books light again.
-- The value check (> 0), the key and everything else stay as 0112 made them. No grant and no policy.

alter table public.cb_quote_inputs drop constraint if exists cb_quote_inputs_kind_check;
alter table public.cb_quote_inputs add constraint cb_quote_inputs_kind_check check (kind in ('fx:EURUSD', 'cb:USDT-USD'));
