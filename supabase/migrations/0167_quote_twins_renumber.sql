-- 0167: the stablecoin twins' page names renumbered, variant-2 retired and USDT 2:1 hidden (Davies, 2026-10-29: "变体2直接删了吧，
-- 不就是目前的Stablecoin quotes LIVE twin么 / 变体 7隐藏 / 数字依然用变体1-6"; then, of the sixth: "还是这个隐藏吧，变体 5改为变体 7
-- （USDT 3:1）": the USDT 2:1 twin is the one hidden and the USDT 3:1 twin keeps a number).
--
-- Variant-2 (`live`, the £120 twin that has mirrored LIVE since 2026-09-23) is the LIVE twin's smaller copy: LIVE's size has
-- grown to £600 and `live600` ("Stablecoin quotes LIVE twin") is what it was a stand-in for. Its engine stops (`enabled = false`,
-- as 0149 and 0152 stop theirs, so 0087's `agents?action=quotestwins` skips it) and it leaves the page; it is named for what it
-- was, "Stablecoin quotes £120 twin", so its name no longer holds a variant number. Its row, tables and record stay.
-- The USDT 2:1 twin (`n600usdt2`, variant-6 until now) is hidden (`hidden = true`, 0141): it keeps running and its record keeps
-- growing for a reading, the page shows nothing of it, and its name no longer holds a number: "Stablecoin quotes USDT 2:1 from
-- 10-28", as 0149 and 0152 named the retired ones.
-- The visible rows then count 1 to 6 as before ("数字依然用变体1-6"): variant-1 (`live1200`) stays; `take50` (3) becomes 2,
-- `n600no03` (4) becomes 3, `n600hold1` (5) 4, `n600usdt3` (USDT 3:1, 7) 5 and `n600usdt` (8) 6. Their ids, places
-- (`display_order`), tables, capital and rules are untouched: an id never names a variant number.
--
-- Names are unique, so each rename follows the one that frees its name: `live` gives up "variant-2" before `take50` takes it,
-- and so down the chain; "variant-6" is free once `n600usdt2` has been renamed. Each statement is guarded by the old name (or
-- sets a flag to the value it should have), so a second run changes nothing. No grant and no policy; nothing is dropped.

update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes £120 twin'
 where id = 'live' and display_name = 'Stablecoin quotes variant-2';

update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes USDT 2:1 from 10-28'
 where id = 'n600usdt2' and display_name = 'Stablecoin quotes variant-6';

update public.agent_quote_twin_specs
   set enabled = false
 where id = 'live';

update public.agent_quote_twin_specs
   set hidden = true
 where id in ('live', 'n600usdt2');

update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes variant-2'
 where id = 'take50' and display_name = 'Stablecoin quotes variant-3';

update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes variant-3'
 where id = 'n600no03' and display_name = 'Stablecoin quotes variant-4';

update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes variant-4'
 where id = 'n600hold1' and display_name = 'Stablecoin quotes variant-5';

update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes variant-5'
 where id = 'n600usdt3' and display_name = 'Stablecoin quotes variant-7';

update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes variant-6'
 where id = 'n600usdt' and display_name = 'Stablecoin quotes variant-8';
