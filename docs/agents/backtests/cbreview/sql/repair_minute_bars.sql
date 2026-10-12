-- PROPOSED, NOT RUN (the review's SQL is read-only). Puts back the four side extremes that `cbMinuteRow` lost (2026-10-12 review,
-- section 2): `xs.reduce(Math.min)` handed Math.min the index and the array as well, so a side with two prints or more in a
-- minute came out NaN and was stored as null. 12,728 decided minutes were checked: a stored extreme is non-null exactly when its
-- side printed once (0 mismatches), and every non-null one equals the prints' own (3,218 sell, 2,998 buy). The engine's rungs,
-- fills and trips never read these columns; only the faithful-replay bar (replay.py, pre-registration bar 1) does.
--
-- Order: deploy the fixed `cbMinuteRow` first (otherwise the next minutes are written broken again), then run this once, then
-- run `select ... verify` below. It must run BEFORE the prints go: `cb-rec-prune` deletes `cb_trades` older than 10 days, so the
-- first lit minute (2026-10-11 23:01) is lost to it from 2026-10-21 23:01 UTC. After that the prints can only be paged back from
-- Coinbase by trade id (api.exchange.coinbase.com/products/{id}/trades?after=...), which is public and keyless.
-- It changes a frozen test's record, so it is a deviation of the pre-registration (Deviation 2): write it before running.
--
-- The repair starts at the window's start, 2026-10-11 00:00 UTC (2026-10-09 23:14 would also mend the dark minutes before it).
update public.cb_quote_minutes m
set sell_lo = b.sell_lo, sell_hi = b.sell_hi, buy_lo = b.buy_lo, buy_hi = b.buy_hi
from (
  select product as book, date_trunc('minute', ts) as minute,
         min(price) filter (where side = 'sell') sell_lo, max(price) filter (where side = 'sell') sell_hi,
         min(price) filter (where side = 'buy') buy_lo, max(price) filter (where side = 'buy') buy_hi
  from public.cb_trades where ts >= '2026-10-11 00:00' group by 1, 2
) b
where m.book = b.book and m.minute = b.minute and m.minute >= '2026-10-11 00:00' and m.prints_n > 0
  and (m.sell_lo is distinct from b.sell_lo or m.sell_hi is distinct from b.sell_hi or m.buy_lo is distinct from b.buy_lo or m.buy_hi is distinct from b.buy_hi);

-- verify (select only): every decided minute with prints agrees with the prints, and nothing is left null that printed
with b as (
  select product as book, date_trunc('minute', ts) as minute, count(*) n, sum(price * size) vol,
         min(price) filter (where side = 'sell') sell_lo, max(price) filter (where side = 'sell') sell_hi,
         min(price) filter (where side = 'buy') buy_lo, max(price) filter (where side = 'buy') buy_hi
  from public.cb_trades where ts >= '2026-10-11 00:00' group by 1, 2)
select count(*) minutes,
       count(*) filter (where m.prints_n <> b.n) prints_n_wrong,
       count(*) filter (where m.sell_lo is distinct from b.sell_lo or m.sell_hi is distinct from b.sell_hi) sell_wrong,
       count(*) filter (where m.buy_lo is distinct from b.buy_lo or m.buy_hi is distinct from b.buy_hi) buy_wrong
from public.cb_quote_minutes m join b on b.book = m.book and b.minute = m.minute where m.minute >= '2026-10-11 00:00';
