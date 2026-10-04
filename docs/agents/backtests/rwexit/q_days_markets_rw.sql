-- Immediate exit realised on the fill's UTC day (raw and cf), and per-market totals against holding to 10-04 00:00.
with f as (
  select fl.cond, fl.minute t, fl.side, case when fl.side = 'bid' then 1 else -1 end s, fl.price::float8 p, fl.size::float8 q,
         (case when pr.oi = 0 then pr.price else 1 - pr.price end)::float8 ypx
  from public.pm_rw_fills fl join public.pm_rw_prints pr on pr.id = fl.print_id
  where fl.minute >= '2026-09-25 00:00:00+00' and fl.minute < '2026-10-04 00:00:00+00'
),
x as (
  select f.*, sel.q question, sel.rate::float8 rate,
    case sel.cat when 'crypto_fees_v2' then 0.07 when 'sports_fees_v2' then 0.03 when 'sports_fees_v3' then 0.05
      when 'culture_fees' then 0.05 when 'economics_fees' then 0.05 when 'weather_fees' then 0.05 when 'general_fees' then 0.05
      when 'finance_prices_fees' then 0.04 when 'politics_fees' then 0.04 when 'mentions_fees' then 0.04 when 'tech_fees' then 0.04
      else 0 end::float8 fr,
    st.payout::float8 payout, st.settled_at, n1.minute t1, n1.bb::float8 bb1, n1.ba::float8 ba1, hz.mid::float8 hz
  from f
  left join public.pm_rw_selection sel on sel.day = (f.t at time zone 'UTC')::date and sel.cond = f.cond
  left join public.pm_rw_settlements st on st.cond = f.cond
  left join lateral (select minute, bb, ba from public.pm_rw_minutes mm where mm.cond = f.cond and mm.minute > f.t
                     and mm.bb is not null and mm.ba is not null order by mm.minute limit 1) n1 on true
  left join lateral (select case when mm.quoting then mm.m else (mm.ab + mm.aa) / 2 end mid from public.pm_rw_minutes mm where mm.cond = f.cond and mm.minute < '2026-10-04 00:00:00+00'
                     and ((mm.quoting and mm.m is not null) or (not mm.quoting and mm.ab is not null and mm.aa is not null)) order by mm.minute desc limit 1) hz on true
),
y as (
  select x.*, case when settled_at is not null and settled_at < '2026-10-04 00:02:00+00' then payout else hz end Mz,
    case when s = 1 then bb1 else ba1 end X1r, case when s = 1 then greatest(bb1, ypx) else least(ba1, ypx) end X1o
  from x
),
z as (
  select y.*, case when t1 is null then q*s*(Mz - p) else q*(s*(X1r - p) - fr*X1r*(1 - X1r)) end e1r,
    case when t1 is null then q*s*(Mz - p) else q*(s*(X1o - p) - fr*X1o*(1 - X1o)) end e1o, q*s*(Mz - p) hzd
  from y
),
bym as (select cond, max(question) question, max(rate) rate, count(*) n, sum(hzd) hold, sum(e1o) cf, sum(e1r) raw, max(payout) payout from z group by cond)
select 'day' kind, (t at time zone 'UTC')::date::text k, count(*)::text n, round(sum(e1r)::numeric, 2) exit_raw, round(sum(e1o)::numeric, 2) exit_cf, null::numeric hold_end, null::text extra
from z group by 2
union all
select 'mkt_worst_hold', left(cond, 10), n::text, round(raw::numeric, 2), round(cf::numeric, 2), round(hold::numeric, 2), left(question, 50) || ' | $' || rate || '/d | payout ' || coalesce(payout::text, 'open')
from (select * from bym order by hold asc limit 6) a
union all
select 'mkt_best_hold', left(cond, 10), n::text, round(raw::numeric, 2), round(cf::numeric, 2), round(hold::numeric, 2), left(question, 50) || ' | $' || rate || '/d | payout ' || coalesce(payout::text, 'open')
from (select * from bym order by hold desc limit 4) b
union all
select 'mkt_summary', 'markets', count(*)::text, round(percentile_cont(0.05) within group (order by raw)::numeric, 2), round(percentile_cont(0.05) within group (order by cf)::numeric, 2),
  round(percentile_cont(0.05) within group (order by hold)::numeric, 2), 'p05 of per-market totals; min hold ' || round(min(hold)::numeric, 2) || ', min cf ' || round(min(cf)::numeric, 2) || ', min raw ' || round(min(raw)::numeric, 2)
from bym order by 1, 2;
