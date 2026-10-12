-- The compact export `scripts/replay_check.py` reads (inputs/lit_window_lines.json.gz): the paper test's first lit window,
-- 2026-10-11 23:01 -> 2026-10-12 23:00 UTC, one line a minute for each book, ';'-joined, as {book, lines}. Select only.
-- Line: minute offset from 23:01, fair, prints_n, volume, sell prints, buy prints, then (for a side that printed) its lowest and
-- highest price, then the last print and its aggressor. `concat_ws` leaves out what is null, which replay_check.py reads.
-- The extremes come from the prints (`cb_trades`), not from the stored record, because the stored record lost them (2026-10-12,
-- docs/agents/reviews/2026-10-12-coinbase-first-days.md, section 2).
with b as (
  select product as book, date_trunc('minute', ts) as minute,
         count(*) filter (where side = 'sell') ns, count(*) filter (where side = 'buy') nb,
         min(price) filter (where side = 'sell') sell_lo, max(price) filter (where side = 'sell') sell_hi,
         min(price) filter (where side = 'buy') buy_lo, max(price) filter (where side = 'buy') buy_hi
  from public.cb_trades where ts >= '2026-10-11 23:00' and ts < '2026-10-12 23:00' group by 1, 2)
select m.book,
       string_agg(concat_ws(',', (extract(epoch from m.minute)::bigint - 1791759660) / 60, round(m.fair::numeric, 8), m.prints_n, round(m.vol::numeric, 2),
                            b.ns, b.nb, b.sell_lo, b.sell_hi, b.buy_lo, b.buy_hi, m.last, left(m.last_side, 1)), ';' order by m.minute) as lines
from public.cb_quote_minutes m left join b on b.book = m.book and b.minute = m.minute
where m.x is not null and m.minute >= '2026-10-11 23:01' and m.minute < '2026-10-12 23:00'
group by m.book order by m.book;
