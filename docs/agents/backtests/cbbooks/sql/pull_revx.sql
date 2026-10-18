-- Revolut X over the window: each book read's touch and depth (agent_book_levels, five levels, prices in GBP), its prints
-- (agent_quote_prints, side = AGGRESSOR), and PR5's minute record (agent_quote_minutes: x = GBP/USD, fair_u = the USD
-- book's fair; fair in GBP = fair_u / x). Three payloads.
with w as (select timestamptz '2026-10-10T03:00:00Z' t0, timestamptz '2026-10-18T03:00:00Z' t1),
b as (
  select book, ts, concat_ws(' ', book, round(extract(epoch from ts - (select t0 from w)) * 1000)::bigint,
    round(extract(epoch from seen_until - (select t0 from w)) * 1000)::bigint, reads,
    bids->0->>0, bids->0->>1, asks->0->>0, asks->0->>1,
    (select coalesce(sum((e->>1)::numeric), 0) from jsonb_array_elements(bids) e),
    (select coalesce(sum((e->>1)::numeric), 0) from jsonb_array_elements(asks) e)) line
  from public.agent_book_levels where book in ('USDC-GBP', 'USDT-GBP') and ts >= (select t0 from w) - interval '10 minutes' and ts < (select t1 from w)
),
p as (
  select book, ts, concat_ws(' ', book, round(extract(epoch from ts - (select t0 from w)) * 1000)::bigint, price, qty, side) line
  from public.agent_quote_prints where book in ('USDC-GBP', 'USDT-GBP') and ts >= (select t0 from w) and ts < (select t1 from w) + interval '2 hours'
),
m as (
  select book, minute, concat_ws(' ', book, round(extract(epoch from minute - (select t0 from w)) / 60)::bigint, coalesce(x::text, '-'), coalesce(fair_u::text, '-'), prints_n) line
  from public.agent_quote_minutes where book in ('USDC-GBP', 'USDT-GBP') and minute >= (select t0 from w) and minute < (select t1 from w) + interval '2 hours'
),
tb as (select 'revx_books' tb, string_agg(line, E'\n' order by book, ts) text, count(*) n from b),
tp as (select 'revx_prints' tb, string_agg(line, E'\n' order by book, ts) text, count(*) n from p),
tm as (select 'revx_minutes' tb, string_agg(line, E'\n' order by book, minute) text, count(*) n from m)
select json_build_object('table', tb, 'n', n, 'md5', md5(coalesce(text, '')), 'text', text) payload from (select * from tb union all select * from tp union all select * from tm) u;
