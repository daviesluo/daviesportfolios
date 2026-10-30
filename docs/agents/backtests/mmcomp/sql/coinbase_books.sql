-- MMCOMP part 8 (2026-10-30, SELECT only, through the Supabase connector): Coinbase's GBP stablecoin books as the keyless
-- recorder holds them. (a) the touch each minute (cb_touch, from 2026-10-10 01:47): spread in ticks of 0.0001, the share of
-- minutes at one tick, the touch's size and order count, by week; (b) the prints (cb_trades, kept ten days, from 2026-10-19):
-- count, the share and count of prints worth under GBP 1, and the five most frequent print sizes, by book.

-- (a)
select product, to_char(ts, 'IYYY-"W"IW') wk, count(*) minutes,
  percentile_disc(0.5) within group (order by round((ask - bid) / 0.0001)) spread_ticks_med,
  round(avg((round((ask - bid) / 0.0001) = 1)::int), 3) one_tick_share,
  percentile_disc(0.5) within group (order by bid_size) bid_size_med,
  percentile_disc(0.5) within group (order by ask_size) ask_size_med,
  percentile_disc(0.5) within group (order by bid_orders) bid_orders_med,
  percentile_disc(0.5) within group (order by ask_orders) ask_orders_med
from cb_touch where product in ('USDC-GBP', 'USDT-GBP') and ask > bid
group by 1, 2 order by 1, 2;

-- (b)
with t as (select product, size, price * size gbp from cb_trades where product in ('USDC-GBP', 'USDT-GBP'))
select product, count(*) prints, count(*) filter (where gbp < 1) under_1gbp,
  round(avg((gbp < 1)::int), 3) share_under_1gbp,
  percentile_disc(0.5) within group (order by gbp) median_gbp,
  (select json_agg(x) from (select size, count(*) n from cb_trades c where c.product = t.product group by size order by 2 desc limit 5) x) top_sizes
from t group by product order by product;
