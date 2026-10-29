-- OKX's recorded books and prints and the paper twins' record, as {table, n, md5, text} payloads (scripts/grab.py).
--   okx_trades : every recorded print. Line: book, trade_id, ts (epoch ms), price, size, side (aggressor).
--   okx_books  : each minute's best bid and ask. Line: book, ts (epoch ms), bid, ask, bid_size, ask_size.
--   okx_minutes: okx_quote_minutes. Line: book, minute (epoch / 60), x, x_held, fair, guard, prints_n, last, bid, ask.
--   okx_trips  : okx_quote_trips as JSON, one a line.
with a as (select string_agg(concat_ws(chr(9), book, trade_id, (extract(epoch from ts) * 1000)::bigint, price, size, side), E'\n' order by book, trade_id) text, count(*) n from public.okx_trades),
b as (select string_agg(concat_ws(chr(9), book, (extract(epoch from ts) * 1000)::bigint, bid, ask, bid_size, ask_size), E'\n' order by book, ts) text, count(*) n from public.okx_books),
c as (select string_agg(concat_ws(chr(9), book, (extract(epoch from minute) / 60)::bigint, coalesce(x::text, '-'), coalesce(x_held::text, '-'),
        coalesce(fair::text, '-'), coalesce(guard, '-'), prints_n, coalesce(last::text, '-'), coalesce(bid::text, '-'), coalesce(ask::text, '-')), E'\n' order by book, minute) text, count(*) n from public.okx_quote_minutes),
d as (select string_agg(row_to_json(t)::text, E'\n' order by t.book, t.fill_ts) text, count(*) n from public.okx_quote_trips t)
select json_build_object('table', 'okx_trades', 'n', n, 'md5', md5(coalesce(text, '')), 'text', text) payload from a
union all select json_build_object('table', 'okx_books', 'n', n, 'md5', md5(coalesce(text, '')), 'text', text) from b
union all select json_build_object('table', 'okx_minutes', 'n', n, 'md5', md5(coalesce(text, '')), 'text', text) from c
union all select json_build_object('table', 'okx_trips', 'n', n, 'md5', md5(coalesce(text, '')), 'text', text) from d;
