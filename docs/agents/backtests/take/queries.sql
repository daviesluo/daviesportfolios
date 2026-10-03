-- TAKE (reference §4 item 52): every read of production, SELECT only, through the Supabase connector, 2026-10-03
-- 02:28-02:56 UTC. agent_book_levels is read on QUEUE's deviation 1 (docs/agents/reviews/2026-09-28-queue-prereg.md, last
-- section). Nothing of rule D, PR5V or the twins of rule D was read. Each output is checked by its md5 where the query
-- returned one; study.py checks the files against the same hashes.

-- C. Sizes (outputs quoted, nothing saved).
select book, count(*) n, min(ts) first_ts, max(ts) last_ts, max(seen_until) last_seen, sum(reads) reads
from public.agent_book_levels where book in ('USDC-GBP','USDT-GBP') group by book order by book;
-- USDC-GBP 7,507 rows 2026-09-26 18:16:00 -> 10-03 02:28:42; USDT-GBP 7,343 rows 18:26:00 -> 02:28:43.

-- E. Every paper minute T whose book, read at most 90 s before the turn (T + 85 s), has its touch through PR5's 0.1 %
-- rung on fair_u / x: the touch, which side, where the next read came from (s: the same row read again after the turn;
-- n: a new row within 60 s; v: none), and that read's levels within the 0.1 % rung's price. 841 rows,
-- md5 3741a0e76d7d6a20c13ff9a3cf53a2ff over the lines joined by "\n" in (book, minute) order.
with m as (
  select book, minute as t, fair_u / x as f, minute + interval '85 seconds' as tau
  from public.agent_quote_minutes
  where book in ('USDC-GBP','USDT-GBP') and minute >= '2026-09-26 18:30+00' and minute < '2026-10-03 02:00+00'
    and x is not null and fair_u is not null and x > 0),
j as (
  select m.*, b.seen_until bseen, b.bids, b.asks,
    round((b.bids->0->>0)::numeric / 0.0001)::int bidt, round((b.asks->0->>0)::numeric / 0.0001)::int askt
  from m join lateral (
    select ts, seen_until, bids, asks from public.agent_book_levels bl
    where bl.book = m.book and bl.ts <= m.tau order by bl.ts desc limit 1) b on true
  where b.seen_until >= m.tau - interval '90 seconds'),
e as (select j.*, floor(f*(1-0.001)/0.0001 + 1e-9)::int lim_b, ceil(f*(1+0.001)/0.0001 - 1e-9)::int lim_a from j),
ev as (select e.*, case when askt <= lim_b then 'B' else 'A' end ev from e where askt <= lim_b or bidt >= lim_a),
nx as (
  select ev.*, case when ev.bseen > ev.tau then 's' when n.ts is not null then 'n' else 'v' end nflag,
    case when ev.bseen > ev.tau then (case when ev.ev = 'B' then ev.asks else ev.bids end)
         else (case when ev.ev = 'B' then n.asks else n.bids end) end side_lv
  from ev left join lateral (
    select ts, bids, asks from public.agent_book_levels bl
    where bl.book = ev.book and bl.ts > ev.tau and bl.ts <= ev.tau + interval '60 seconds' order by bl.ts asc limit 1) n on true),
o as (
  select book, t, (case when book = 'USDC-GBP' then 'C' else 'T' end) || ',' || (extract(epoch from t)::bigint / 60) || ',' || bidt || ',' || askt || ',' || ev || ',' || nflag || ',' ||
    coalesce((select string_agg(round((l->>0)::numeric/0.0001)::int || ':' || (l->>1), '/' order by ord)
       from jsonb_array_elements(side_lv) with ordinality a(l, ord)
       where (ev = 'B' and round((l->>0)::numeric/0.0001) <= lim_b) or (ev = 'A' and round((l->>0)::numeric/0.0001) >= lim_a)), '') line
  from nx)
select count(*) n, md5(string_agg(line, E'\n' order by book, t)) md5, string_agg(line, E'\n' order by book, t) body from o;
-- E2 returned the same rows, run-length coded (a line equal to the one before but for the minute and the next read is
-- "+<minutes><flag>[:<levels>]", and equal lines "<line>*<count>"; 430 runs): inputs/events_rle.txt, which study.py
-- expands and checks against E's md5.

-- N. The null's pool: every paper minute whose md5(book || ':' || epoch minute) starts with a byte under 10 (10/256),
-- read as in E, with the next read's best bid and best ask. 591 rows, md5 e3732815a95498d9e8077150994b104b
-- (inputs/null_pool.csv: book, minute, bid, ask, next bid:qty, next ask:qty).
with m as (
  select book, minute as t, minute + interval '85 seconds' as tau
  from public.agent_quote_minutes
  where book in ('USDC-GBP','USDT-GBP') and minute >= '2026-09-26 18:30+00' and minute < '2026-10-03 02:00+00'
    and x is not null and fair_u is not null and x > 0
    and get_byte(decode(md5(book || ':' || (extract(epoch from minute)::bigint / 60)::text), 'hex'), 0) < 10),
j as (
  select m.*, b.seen_until bseen, b.bids, b.asks,
    round((b.bids->0->>0)::numeric / 0.0001)::int bidt, round((b.asks->0->>0)::numeric / 0.0001)::int askt
  from m join lateral (
    select ts, seen_until, bids, asks from public.agent_book_levels bl
    where bl.book = m.book and bl.ts <= m.tau order by bl.ts desc limit 1) b on true
  where b.seen_until >= m.tau - interval '90 seconds'),
nx as (
  select j.*, case when j.bseen > j.tau then j.bids else n.bids end nb, case when j.bseen > j.tau then j.asks else n.asks end na
  from j left join lateral (
    select ts, bids, asks from public.agent_book_levels bl
    where bl.book = j.book and bl.ts > j.tau and bl.ts <= j.tau + interval '60 seconds' order by bl.ts asc limit 1) n on true
  where j.bseen > j.tau or n.ts is not null),
o as (select book, t, (case when book = 'USDC-GBP' then 'C' else 'T' end) || ',' || (extract(epoch from t)::bigint / 60) || ',' || bidt || ',' || askt || ',' ||
   round((nb->0->>0)::numeric/0.0001)::int || ':' || (nb->0->>1) || ',' || round((na->0->>0)::numeric/0.0001)::int || ':' || (na->0->>1) line from nx)
select count(*) n, md5(string_agg(line, E'\n' order by book, t)) md5, string_agg(line, E'\n' order by book, t) body from o;

-- T. PR5's inputs after the twins' committed export (cut 2026-10-02 21:08): prints 33 rows md5
-- 368a06795577dff9febf86949e05c6ce (inputs/tail_prints.txt); lit minutes 80 rows md5 2134f4725752baf99e3cf37ae5df1c6c
-- (two values of x, regenerated and checked in study.py); inputs 100 rows md5 2c6b92363cb13430f20b1c48c900bda8 (the eight
-- hourly closes 21:00 -> 00:00 are written in study.py; the GBP/USD minutes add nothing: no lit minute after 21:39).
with p as (select string_agg(id || '|' || book || '|' || (extract(epoch from ts)*1000)::bigint || '|' || price || '|' || qty || '|' || side, E'\n' order by ts, id) s, count(*) n
  from public.agent_quote_prints where book in ('USDC-GBP','USDT-GBP') and ts >= '2026-10-02 21:00+00' and ts < '2026-10-03 02:40+00'),
mi as (select string_agg(book || '|' || (extract(epoch from minute)*1000)::bigint || '|' || coalesce(x::text,'') || '|' || coalesce(fair_u::text,''), E'\n' order by minute, book) s, count(*) n
  from public.agent_quote_minutes where minute >= '2026-10-02 21:00+00' and minute < '2026-10-03 02:40+00' and x is not null),
i as (select string_agg(kind || '|' || (extract(epoch from t)*1000)::bigint || '|' || value, E'\n' order by kind, t) s, count(*) n
  from public.agent_quote_inputs where t >= '2026-10-02 20:00+00' and t < '2026-10-03 02:40+00')
select p.n pn, md5(p.s) pmd5, p.s prints, mi.n mn, md5(mi.s) mmd5, mi.s minutes, i.n inn, md5(i.s) imd5, i.s inputs from p, mi, i;

-- M. For each take and each episode's first minute (study.py's list): the mid (best bid + best ask, in ticks) of the last
-- row at or before the turn + 15, 60, 240 and 1,440 minutes, and that last row's touch with its quantities 1,440 minutes
-- on (the 24-hour stop's book). 49 keys, md5 3293efcb33ab20266c915985fe6989f5 over the lines in (book, minute) order;
-- one more key (T29847417) read alone afterwards. inputs/markouts.csv holds the 50 lines.
with k as (
  select case when left(x, 1) = 'C' then 'USDC-GBP' else 'USDT-GBP' end book, substr(x, 2)::bigint tm
  from unnest(string_to_array('<the keys, e.g. C29844914,T29843012,...>', ',')) x),
i as (select k.*, to_timestamp(tm * 60 + 85) tau from k),
h as (
  select i.book, i.tm, hh.n, (select case when i.tau + hh.d <= now() then round((bl.bids->0->>0)::numeric/0.0001)::int + round((bl.asks->0->>0)::numeric/0.0001)::int end
     from public.agent_book_levels bl where bl.book = i.book and bl.ts <= i.tau + hh.d order by bl.ts desc limit 1) mid2
  from i cross join (values (1, interval '15 minutes'), (2, interval '60 minutes'), (3, interval '240 minutes'), (4, interval '1440 minutes')) hh(n, d)),
s as (
  select i.book, i.tm, (select case when i.tau + interval '1440 minutes' <= now() then round((bl.bids->0->>0)::numeric/0.0001)::int || ',' || (bl.bids->0->>1) || ',' ||
     round((bl.asks->0->>0)::numeric/0.0001)::int || ',' || (bl.asks->0->>1) end
     from public.agent_book_levels bl where bl.book = i.book and bl.ts <= i.tau + interval '1440 minutes' order by bl.ts desc limit 1) st
  from i),
o as (select s.book, s.tm, (case when s.book = 'USDC-GBP' then 'C' else 'T' end) || ',' || s.tm || ',' ||
  (select string_agg(coalesce(h.mid2::text, ''), ',' order by h.n) from h where h.book = s.book and h.tm = s.tm) || ',' || coalesce(s.st, ',,,') line from s)
select count(*) n, md5(string_agg(line, E'\n' order by book, tm)) md5, string_agg(line, E'\n' order by book, tm) body from o;
