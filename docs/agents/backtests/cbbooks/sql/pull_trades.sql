-- One Coinbase book's prints over [from, to), summed by second, price and the stored side (cb_trades.side is the
-- AGGRESSOR's: the recorder flips Coinbase's maker side on write, agents/cb_rec.ts), as a {table, n, md5, text} payload.
-- Line: second since 2026-10-10T03:00:00Z, price in the book's steps, b|s (aggressor side; "case when side = 'buy'"), size in hundredths of a coin, prints. :tick is 0.0001 (USDT-EUR 0.00001).
with g as (
  select floor(extract(epoch from ts - timestamptz '2026-10-10T03:00:00Z'))::bigint s, round(price / :tick)::bigint px,
         case when side = 'buy' then 'b' else 's' end sd, round(sum(size) * 100)::bigint sz, count(*) n
  from public.cb_trades where product = :product and ts >= :from and ts < :to
  group by 1, 2, 3
), t as (select string_agg(concat_ws(' ', s, px, sd, sz, n), E'\n' order by s, px, sd) text, count(*) n from g)
select json_build_object('table', :name, 'n', n, 'md5', md5(coalesce(text, '')), 'text', text) payload from t;
