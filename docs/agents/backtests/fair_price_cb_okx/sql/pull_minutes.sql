-- One Coinbase book's paper minute record ("with Euros", cb_quote_minutes) and the weekend arm's fair beside it
-- (cb_hold_minutes, "with Euros - 1"), as one {table, n, md5, text} payload that scripts/grab.py checks.
-- Run once per book with :book replaced (USDC-GBP, USDT-GBP, USDC-EUR, USDT-EUR); table name minutes_<book>.
-- Line (tab-separated, '-' for null): minute (epoch / 60), x (pounds per unit), fair (base), hold fair, FX bar age in
-- minutes (x_t), EUR bar age (eur_t), hours_n, prints_n, vol, sell_lo, sell_hi, buy_lo, buy_hi, last, last_side (b/s).
with r as (
  select m.minute, m.x, m.fair, h.fair hfair, m.x_t, m.eur_t, m.hours_n, m.prints_n, m.vol, m.sell_lo, m.sell_hi, m.buy_lo,
         m.buy_hi, m.last, m.last_side
  from public.cb_quote_minutes m
  left join public.cb_hold_minutes h on h.book = m.book and h.minute = m.minute
  where m.book = ':book' and m.minute >= '2026-10-10T00:00:00Z' and m.minute < '2026-10-29T00:00:00Z'
), l as (
  select minute, concat_ws(chr(9),
    (extract(epoch from minute) / 60)::bigint,
    coalesce(x::text, '-'), coalesce(fair::text, '-'), coalesce(hfair::text, '-'),
    coalesce(round(extract(epoch from minute - x_t) / 60)::text, '-'),
    coalesce(round(extract(epoch from minute - eur_t) / 60)::text, '-'),
    hours_n, prints_n, round(vol::numeric, 2),
    coalesce(sell_lo::text, '-'), coalesce(sell_hi::text, '-'), coalesce(buy_lo::text, '-'), coalesce(buy_hi::text, '-'),
    coalesce(last::text, '-'), coalesce(left(last_side, 1), '-')) line
  from r
), t as (select string_agg(line, E'\n' order by minute) text, count(*) n from l)
select json_build_object('table', 'minutes_:book', 'n', n, 'md5', md5(coalesce(text, '')), 'text', text) payload from t;
