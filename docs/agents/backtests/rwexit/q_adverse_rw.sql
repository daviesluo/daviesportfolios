with f as (
  select fl.cond, fl.minute t, fl.ts, fl.side, case when fl.side = 'bid' then 1 else -1 end s,
         fl.price::float8 p, fl.size::float8 q, fl.print_id,
         (case when pr.oi = 0 then pr.price else 1 - pr.price end)::float8 ypx, pr.size::float8 psize
  from public.pm_rw_fills fl join public.pm_rw_prints pr on pr.id = fl.print_id
  where fl.minute >= '2026-09-25 00:00:00+00' and fl.minute < '2026-10-04 00:00:00+00'
),
x as (
  select f.*, sel.rate::float8 rate, sel.cat, sel.end_date, sel.q question,
    case sel.cat when 'crypto_fees_v2' then 0.07 when 'sports_fees_v2' then 0.03 when 'sports_fees_v3' then 0.05
      when 'culture_fees' then 0.05 when 'economics_fees' then 0.05 when 'weather_fees' then 0.05 when 'general_fees' then 0.05
      when 'finance_prices_fees' then 0.04 when 'politics_fees' then 0.04 when 'mentions_fees' then 0.04 when 'tech_fees' then 0.04
      else 0 end::float8 fr,
    m0.m::float8 m0, coalesce(m0.tick, sel.tick)::float8 tick, st.payout::float8 payout, st.settled_at,
    (date_trunc('day', f.t at time zone 'UTC') at time zone 'UTC') + interval '1 day' as dayend,
    n1.minute t1, n1.bb::float8 bb1, n1.ba::float8 ba1, n1.ab::float8 ab1, n1.aa::float8 aa1,
    h15.mid::float8 h15, h60.mid::float8 h60, h240.mid::float8 h240, hd.mid::float8 hd, hz.mid::float8 hz
  from f
  left join public.pm_rw_selection sel on sel.day = (f.t at time zone 'UTC')::date and sel.cond = f.cond
  left join public.pm_rw_minutes m0 on m0.cond = f.cond and m0.minute = f.t
  left join public.pm_rw_settlements st on st.cond = f.cond
  left join lateral (select minute, bb, ba, ab, aa from public.pm_rw_minutes mm where mm.cond = f.cond and mm.minute > f.t
                     and mm.bb is not null and mm.ba is not null order by mm.minute limit 1) n1 on true
  left join lateral (select case when mm.quoting then mm.m else (mm.ab + mm.aa) / 2 end mid, minute from public.pm_rw_minutes mm where mm.cond = f.cond and mm.minute <= f.t + interval '15 minutes'
                     and ((mm.quoting and mm.m is not null) or (not mm.quoting and mm.ab is not null and mm.aa is not null)) order by mm.minute desc limit 1) h15 on true
  left join lateral (select case when mm.quoting then mm.m else (mm.ab + mm.aa) / 2 end mid, minute from public.pm_rw_minutes mm where mm.cond = f.cond and mm.minute <= f.t + interval '60 minutes'
                     and ((mm.quoting and mm.m is not null) or (not mm.quoting and mm.ab is not null and mm.aa is not null)) order by mm.minute desc limit 1) h60 on true
  left join lateral (select case when mm.quoting then mm.m else (mm.ab + mm.aa) / 2 end mid, minute from public.pm_rw_minutes mm where mm.cond = f.cond and mm.minute <= f.t + interval '240 minutes'
                     and ((mm.quoting and mm.m is not null) or (not mm.quoting and mm.ab is not null and mm.aa is not null)) order by mm.minute desc limit 1) h240 on true
  left join lateral (select case when mm.quoting then mm.m else (mm.ab + mm.aa) / 2 end mid, minute from public.pm_rw_minutes mm where mm.cond = f.cond and mm.minute < (date_trunc('day', f.t at time zone 'UTC') at time zone 'UTC') + interval '1 day'
                     and ((mm.quoting and mm.m is not null) or (not mm.quoting and mm.ab is not null and mm.aa is not null)) order by mm.minute desc limit 1) hd on true
  left join lateral (select case when mm.quoting then mm.m else (mm.ab + mm.aa) / 2 end mid, minute from public.pm_rw_minutes mm where mm.cond = f.cond and mm.minute < '2026-10-04 00:00:00+00'
                     and ((mm.quoting and mm.m is not null) or (not mm.quoting and mm.ab is not null and mm.aa is not null)) order by mm.minute desc limit 1) hz on true
),
y as (
  select x.*,
    case when settled_at is not null and settled_at <= t + interval '15 minutes' then payout else h15 end M15,
    case when settled_at is not null and settled_at <= t + interval '60 minutes' then payout else h60 end M60,
    case when settled_at is not null and settled_at <= t + interval '240 minutes' then payout else h240 end M240,
    case when settled_at is not null and settled_at < dayend + interval '2 minutes' then payout else hd end Mday,
    case when settled_at is not null and settled_at < '2026-10-04 00:02:00+00' then payout else hz end Mz,
    case when s = 1 then bb1 else ba1 end X1r,
    case when s = 1 then greatest(bb1, ypx) else least(ba1, ypx) end X1o,
    case when ab1 is not null and aa1 is not null then (ab1 + aa1) / 2 end M1
  from x
),
z as (
  select y.*,
    case when rate < 50 then 'a <50' when rate < 100 then 'b 50-99' when rate < 200 then 'c 100-199' else 'd >=200' end band,
    case when end_date is not null and end_date <= dayend then 'same-day' else 'later' end endk,
    case when cat = 'weather_fees' then 'weather' else 'other' end wx,
    case when t1 is null then q*s*(Mz - p) else q*(s*(X1r - p) - fr*X1r*(1 - X1r)) end e1r,
    case when t1 is null then q*s*(Mz - p) else q*(s*(X1o - p) - fr*X1o*(1 - X1o)) end e1o,
    case when t1 is null then 0 else q*fr*X1o*(1 - X1o) end fee_o,
    case when t + interval '15 minutes' <= '2026-10-04 00:00:00+00' then q*s*(M15 - p) end h15d,
    case when t + interval '60 minutes' <= '2026-10-04 00:00:00+00' then q*s*(M60 - p) end h60d,
    case when t + interval '240 minutes' <= '2026-10-04 00:00:00+00' then q*s*(M240 - p) end h240d,
    q*s*(Mday - p) hdayd, q*s*(Mz - p) hzd, q*s*(m0 - p) edge0
  from y
),
u as (
  select h, s, q, m0, M1, mh, p, X1r, X1o from z cross join lateral (values
    ('a t+1', M1), ('b 15m', case when t + interval '15 minutes' <= '2026-10-04' then M15 end), ('c 60m', case when t + interval '60 minutes' <= '2026-10-04' then M60 end),
    ('d 4h', case when t + interval '240 minutes' <= '2026-10-04' then M240 end), ('e day', Mday), ('f end', Mz)) as v(h, mh)
  where mh is not null and M1 is not null
)
select h, count(*) n,
  round(avg(case when s*(mh - m0) < -1e-9 then 1.0 else 0 end)::numeric, 3) frac_against_pre,
  round(avg(case when abs(s*(mh - m0)) <= 1e-9 then 1.0 else 0 end)::numeric, 3) frac_flat_pre,
  round(avg(case when s*(mh - m0) > 1e-9 then 1.0 else 0 end)::numeric, 3) frac_favour_pre,
  round(avg(case when s*(mh - M1) < -1e-9 then 1.0 else 0 end)::numeric, 3) frac_further_vs_t1,
  round(avg(case when s*(mh - M1) > 1e-9 then 1.0 else 0 end)::numeric, 3) frac_back_vs_t1,
  round(avg(case when s*(mh - p) < -1e-9 then 1.0 else 0 end)::numeric, 3) frac_markout_neg,
  round(sum(q*s*(mh - m0))::numeric, 2) usd_move_vs_pre, round(sum(q*s*(mh - M1))::numeric, 2) usd_move_vs_t1,
  round(sum(q*s*(m0 - p))::numeric, 2) usd_edge0, round(sum(q*s*(X1r - M1))::numeric, 2) usd_halfspread_exit_raw, round(sum(q*s*(X1o - M1))::numeric, 2) usd_halfspread_exit_cf
from u group by h order by h;
