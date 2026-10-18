-- One Coinbase book's recorded levels over [from, to), one line per row, as a {table, n, md5, text} payload the
-- grab script checks. Run once per product and half with :product, :from, :to and :name (books_<product>_<1|2>) replaced;
-- prices are already integers in the book's steps (the recorder stores them so).
-- Line: ts_ms seen_until_ms reads bid1 ask1 | bid offsets (bid1 - px_i, i = 2..) | bid sizes (hundredths) | bid_n1 | ask offsets (px_i - ask1) | ask sizes | ask_n1
-- ms are since 2026-10-10T03:00:00Z.
with r as (
  select ts, seen_until, reads, bid_px, bid_sz, bid_n, ask_px, ask_sz, ask_n
  from public.cb_book_levels
  where product = :product and ts >= :from and ts < :to
), l as (
  select ts, concat_ws(' ',
    round(extract(epoch from ts - timestamptz '2026-10-10T03:00:00Z') * 1000)::bigint,
    round(extract(epoch from seen_until - timestamptz '2026-10-10T03:00:00Z') * 1000)::bigint,
    reads, coalesce(bid_px[1]::text, '-'), coalesce(ask_px[1]::text, '-'),
    '|', coalesce((select string_agg((bid_px[1] - bid_px[i])::text, ',' order by i) from generate_subscripts(bid_px, 1) i where i > 1), '-'),
    coalesce(array_to_string(bid_sz, ','), '-'), coalesce(bid_n[1]::text, '-'),
    '|', coalesce((select string_agg((ask_px[i] - ask_px[1])::text, ',' order by i) from generate_subscripts(ask_px, 1) i where i > 1), '-'),
    coalesce(array_to_string(ask_sz, ','), '-'), coalesce(ask_n[1]::text, '-')) line
  from r
), t as (select string_agg(line, E'\n' order by ts) text, count(*) n from l)
select json_build_object('table', :name, 'n', n, 'md5', md5(coalesce(text, '')), 'text', text) payload from t;
