-- Coinbase's prints, kept 40 days in a compact form (CBBOOKS-1's recorder proposal R1; decided 2026-10-18 by the main session
-- on Davies' "记录器改进建议验证后你来决定"). `cb_trades` keeps every print only 10 days (0112) while the books keep 35 (0114), so a
-- study of the books more than ten days back had no prints beside them. This keeps, per book and minute, the prints summed by
-- second, price and aggressor side: exactly what CBBOOKS-1 pulled (docs/agents/backtests/cbbooks/sql/pull_trades.sql) and what
-- its queue and fill checks read; the trade ids and the sub-second order within a second are not kept.
--
-- WHO WRITES IT. Not the recorder: `cb_rec.ts` and its error path are unchanged. `cb_print_minutes_build(from, to)` rebuilds the
-- minutes in [from, to) from `cb_trades` and upserts only the rows whose content changed, so it is exact (the stored prints, not a
-- second copy of the recorder's reading), idempotent, and picks up a print that arrives late (a paged-back hole) the next time
-- its minute is in the window. pg_cron runs it every ten minutes over the last six hours, up to two minutes ago (the recorder
-- stores a minute's prints by about 23 s into the next). It never deletes a row, and it skips each book's oldest stored minute,
-- which the 10-day prune of `cb_trades` may have cut in half, so it can never overwrite a whole minute with part of one.
-- Never call it by hand over a range older than `cb_trades` holds: it would find nothing there and change nothing.
--
-- THE ROW. One per book and minute with prints. Five arrays of one length, sorted by (second, price, buy first): `sec` the second
-- of the minute (0-59), `px` the price in the book's steps (0.0001; USDT-EUR 0.00001, as cb_book_levels), `buy` true when the
-- AGGRESSOR bought (cb_trades.side is the aggressor's: the recorder flips Coinbase's maker side), `n` the prints, `sz` their
-- size in hundredths of a coin. Measured 2026-10-15 on production: 78,674 prints made 33,963 (second, price, side) groups in
-- 5,061 book-minutes, about 1.2 MB a day as arrays (per-group rows would be about 3.7 MB), about 48 MB over 40 days.
--
-- Backfilled below from everything `cb_trades` still holds (from 2026-10-08/09), so the record starts there.

create table if not exists public.cb_print_minutes (
  product text not null check (product in ('USDC-GBP', 'USDT-GBP', 'USDC-EUR', 'USDT-EUR')),
  minute  timestamptz not null check (minute = date_trunc('minute', minute)),
  sec     smallint[] not null,
  px      integer[]  not null,
  buy     boolean[]  not null,
  n       integer[]  not null,
  sz      bigint[]   not null,
  built_at timestamptz not null default now(),
  primary key (product, minute),
  check (cardinality(sec) > 0 and cardinality(px) = cardinality(sec) and cardinality(buy) = cardinality(sec)
         and cardinality(n) = cardinality(sec) and cardinality(sz) = cardinality(sec))
);

comment on table public.cb_print_minutes is 'Coinbase prints summed by second, price and aggressor side, a row per book and minute; rebuilt from cb_trades by cb_print_minutes_build every 10 min over the last 6 h; kept 40 days (0132).';
comment on column public.cb_print_minutes.px is 'Price steps: 0.0001 of the quote currency (USDT-EUR 0.00001), as cb_book_levels.';
comment on column public.cb_print_minutes.buy is 'True when the aggressor bought (cb_trades.side = buy; the recorder stores the aggressor''s side).';
comment on column public.cb_print_minutes.sz is 'Hundredths of a coin.';

alter table public.cb_print_minutes enable row level security;
revoke all on public.cb_print_minutes from anon, authenticated;

create or replace function public.cb_print_minutes_build(p_from timestamptz, p_to timestamptz)
returns integer
language plpgsql
set search_path = public
as $fn$
declare
  k integer;
begin
  with first_full as (
    -- each book's oldest stored minute may be cut by the prune: start at the minute after it (the PK reaches the oldest id)
    select p.product, date_trunc('minute', f.ts) + interval '1 minute' t
    from (values ('USDC-GBP'), ('USDT-GBP'), ('USDC-EUR'), ('USDT-EUR')) p(product)
    cross join lateral (select ts from public.cb_trades t where t.product = p.product order by t.trade_id limit 1) f
  ), g as (
    select t.product, date_trunc('minute', t.ts) mi, floor(extract(second from t.ts))::smallint s,
           round(t.price / case when t.product = 'USDT-EUR' then 0.00001 else 0.0001 end)::integer x,
           t.side = 'buy' b, count(*)::integer c, round(sum(t.size) * 100)::bigint z
    from public.cb_trades t join first_full f on f.product = t.product
    where t.ts >= greatest(date_trunc('minute', p_from), f.t) and t.ts < date_trunc('minute', p_to)
    group by 1, 2, 3, 4, 5
  ), r as (
    select product, mi,
           array_agg(s order by s, x, b desc) s, array_agg(x order by s, x, b desc) x, array_agg(b order by s, x, b desc) b,
           array_agg(c order by s, x, b desc) c, array_agg(z order by s, x, b desc) z
    from g group by 1, 2
  ), u as (
    insert into public.cb_print_minutes as m (product, minute, sec, px, buy, n, sz)
    select product, mi, s, x, b, c, z from r
    on conflict (product, minute) do update
      set sec = excluded.sec, px = excluded.px, buy = excluded.buy, n = excluded.n, sz = excluded.sz, built_at = now()
      where (m.sec, m.px, m.buy, m.n, m.sz) is distinct from (excluded.sec, excluded.px, excluded.buy, excluded.n, excluded.sz)
    returning 1
  )
  select count(*) into k from u;
  return k;
end
$fn$;

revoke all on function public.cb_print_minutes_build(timestamptz, timestamptz) from public, anon, authenticated;

-- The backfill: everything cb_trades still holds.
select public.cb_print_minutes_build(timestamptz '2026-10-01T00:00:00Z', now() - interval '2 minutes');

-- Every 10 minutes: the last six hours, up to two minutes ago.
select cron.schedule(
  'cb-print-minutes-build',
  '4-59/10 * * * *',
  $cron$select public.cb_print_minutes_build(now() - interval '6 hours', now() - interval '2 minutes');$cron$
);

-- Daily: rows older than 40 days.
select cron.schedule(
  'cb-print-minutes-prune',
  '41 10 * * *',
  $cron$delete from public.cb_print_minutes where minute < now() - interval '40 days';$cron$
);
