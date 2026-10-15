-- The same compact export as export_lit_window.sql, for the two chunks that follow it: 2026-10-12 23:00 -> 2026-10-14 00:00 and
-- 2026-10-14 00:00 -> 2026-10-15 00:00 UTC (run once per chunk with its two bounds; the minute offset stays counted from
-- 2026-10-11 23:01, so the chunks join the first one's lines). scripts/cbfast.py reads them packed in
-- inputs/lit_lines_1012_1014.json.gz. Select only.
with b as (
  select product as book, date_trunc('minute', ts) as minute,
         count(*) filter (where side = 'sell') ns, count(*) filter (where side = 'buy') nb,
         min(price) filter (where side = 'sell') sell_lo, max(price) filter (where side = 'sell') sell_hi,
         min(price) filter (where side = 'buy') buy_lo, max(price) filter (where side = 'buy') buy_hi
  from public.cb_trades where ts >= :'from' and ts < :'to' group by 1, 2)
select m.book,
       string_agg(concat_ws(',', (extract(epoch from m.minute)::bigint - 1791759660) / 60, round(m.fair::numeric, 8), m.prints_n, round(m.vol::numeric, 2),
                            b.ns, b.nb, b.sell_lo, b.sell_hi, b.buy_lo, b.buy_hi, m.last, left(m.last_side, 1)), ';' order by m.minute) as lines
from public.cb_quote_minutes m left join b on b.book = m.book and b.minute = m.minute
where m.x is not null and m.minute >= :'from' and m.minute < :'to'
group by m.book order by m.book;
