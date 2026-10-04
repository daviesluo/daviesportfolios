-- Prints through the side RW's cap had stopped (fills an exit-on-fill rule, never capped, would also have taken), and
-- their immediate exit at the next recorded book (raw) or the better of that and the print's own price (cf).
with mn as (
  select mm.cond, mm.minute t, mm.m::float8 m, mm.b::float8 b, mm.a::float8 a, mm.qb, mm.qa,
         sel.rate::float8 rate, greatest(sel.min_size::float8, 5) n,
         case sel.cat when 'crypto_fees_v2' then 0.07 when 'sports_fees_v2' then 0.03 when 'sports_fees_v3' then 0.05
           when 'culture_fees' then 0.05 when 'economics_fees' then 0.05 when 'weather_fees' then 0.05 when 'general_fees' then 0.05
           when 'finance_prices_fees' then 0.04 when 'politics_fees' then 0.04 when 'mentions_fees' then 0.04 when 'tech_fees' then 0.04
           else 0 end::float8 fr
  from public.pm_rw_minutes mm
  join public.pm_rw_selection sel on sel.day = (mm.minute at time zone 'UTC')::date and sel.cond = mm.cond
  where mm.minute >= '2026-09-25 00:00:00+00' and mm.minute < '2026-10-04 00:00:00+00' and mm.quoting and mm.b is not null and (not mm.qb or not mm.qa)
),
pr as (
  select mn.cond, mn.t, mn.n, mn.fr, case when not mn.qb then 1 else -1 end s, case when not mn.qb then mn.b else mn.a end px,
         sum(p.size::float8) through_size,
         case when not mn.qb then max(case when p.oi = 0 then p.price else 1 - p.price end)::float8 else min(case when p.oi = 0 then p.price else 1 - p.price end)::float8 end ybest,
         count(*) nprints
  from mn join public.pm_rw_prints p on p.cond = mn.cond and p.ts > mn.t and p.ts <= mn.t + interval '60 seconds'
  where (not mn.qb and ((p.oi = 0 and p.side = 'SELL' and p.price < mn.b - 1e-12) or (p.oi = 1 and p.side = 'BUY' and 1 - p.price < mn.b - 1e-12)))
     or (not mn.qa and ((p.oi = 0 and p.side = 'BUY' and p.price > mn.a + 1e-12) or (p.oi = 1 and p.side = 'SELL' and 1 - p.price > mn.a + 1e-12)))
  group by mn.cond, mn.t, mn.n, mn.fr, mn.qb, mn.b, mn.a
),
ex as (
  select pr.*, least(pr.n, pr.through_size) qx, n1.bb::float8 bb1, n1.ba::float8 ba1
  from pr left join lateral (select bb, ba from public.pm_rw_minutes mm where mm.cond = pr.cond and mm.minute > pr.t and mm.bb is not null and mm.ba is not null order by mm.minute limit 1) n1 on true
),
v as (select ex.*, case when s = 1 then bb1 else ba1 end xr, case when s = 1 then greatest(bb1, ybest) else least(ba1, ybest) end xo from ex)
select count(*) capped_minutes_with_through_prints, round(sum(qx)::numeric, 1) extra_shares,
  round(sum(case when xr is null then 0 else qx*(s*(xr - px) - fr*xr*(1 - xr)) end)::numeric, 2) extra_exit_raw,
  round(sum(case when xo is null then 0 else qx*(s*(xo - px) - fr*xo*(1 - xo)) end)::numeric, 2) extra_exit_cf,
  sum(case when xr is null then 1 else 0 end) no_next_book
from v;
-- result: 522 | 7913.7 | -234.86 | -114.80 | 14
