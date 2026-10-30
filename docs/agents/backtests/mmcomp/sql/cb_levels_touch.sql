-- MMCOMP-2 (2026-10-30, SELECT only, through the Supabase connector): Coinbase's best level from the level recorder
-- (cb_book_levels, read about :30 each minute), USDC-GBP and USDT-GBP, 2026-10-10 -> 2026-10-29 00:00 UTC, as one payload a
-- book {table, n, md5, text} for pr5_opt/scripts/grab_text.py: ms|bid|ask|bid_size|ask_size. With cb_touch (read at :00,
-- REVX-FAIR's committed copy) it gives Coinbase's touch every 30 s for the hedge-delay replay. Public market data.
select json_build_object('table', 'cb30_' || product, 'n', count(*), 'md5', md5(string_agg(l, E'\n' order by ms)),
                         'text', string_agg(l, E'\n' order by ms)) payload
from (select product, (extract(epoch from ts) * 1000)::bigint ms,
             (extract(epoch from ts) * 1000)::bigint || '|' || bid_px[1] || '|' || ask_px[1] || '|' || bid_sz[1] || '|' || ask_sz[1] l
      from cb_book_levels
      where product in ('USDC-GBP', 'USDT-GBP') and ts >= '2026-10-10' and ts < '2026-10-29'
        and bid_px[1] is not null and ask_px[1] is not null) s
group by product;
