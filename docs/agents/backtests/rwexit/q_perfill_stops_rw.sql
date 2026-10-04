-- Per-fill stops (no netting): each fill exits at the touch of the first recorded book where RW's mark is k ticks worse
-- than its fill price, else it is held to 2026-10-04 00:00 (payout or RW's mark). cf: a stop on the first book after the
-- fill uses the better of the touch and the fill print's own price.
with f as (
  select fl.cond, fl.minute t, fl.side, case when fl.side = 'bid' then 1 else -1 end s, fl.price::float8 p, fl.size::float8 q,
         (case when pr.oi = 0 then pr.price else 1 - pr.price end)::float8 ypx
  from public.pm_rw_fills fl join public.pm_rw_prints pr on pr.id = fl.print_id
  where fl.minute >= '2026-09-25 00:00:00+00' and fl.minute < '2026-10-04 00:00:00+00'
),
x as (
  select f.*,
    case sel.cat when 'crypto_fees_v2' then 0.07 when 'sports_fees_v2' then 0.03 when 'sports_fees_v3' then 0.05
      when 'culture_fees' then 0.05 when 'economics_fees' then 0.05 when 'weather_fees' then 0.05 when 'general_fees' then 0.05
      when 'finance_prices_fees' then 0.04 when 'politics_fees' then 0.04 when 'mentions_fees' then 0.04 when 'tech_fees' then 0.04
      else 0 end::float8 fr,
    coalesce(m0.tick, sel.tick)::float8 tick, st.payout::float8 payout, st.settled_at, n1.minute t1, hz.mid::float8 hz, tr.u1, tr.u2, tr.u3
  from f
  left join public.pm_rw_selection sel on sel.day = (f.t at time zone 'UTC')::date and sel.cond = f.cond
  left join public.pm_rw_minutes m0 on m0.cond = f.cond and m0.minute = f.t
  left join public.pm_rw_settlements st on st.cond = f.cond
  left join lateral (select minute from public.pm_rw_minutes mm where mm.cond = f.cond and mm.minute > f.t and mm.bb is not null and mm.ba is not null order by mm.minute limit 1) n1 on true
  left join lateral (select case when mm.quoting then mm.m else (mm.ab + mm.aa) / 2 end mid from public.pm_rw_minutes mm where mm.cond = f.cond and mm.minute < '2026-10-04 00:00:00+00'
                     and ((mm.quoting and mm.m is not null) or (not mm.quoting and mm.ab is not null and mm.aa is not null)) order by mm.minute desc limit 1) hz on true
  left join lateral (
    select min(mm.minute) filter (where f.s * (mk - f.p) <= -1 * coalesce(m0.tick, sel.tick) + 1e-9) u1,
           min(mm.minute) filter (where f.s * (mk - f.p) <= -2 * coalesce(m0.tick, sel.tick) + 1e-9) u2,
           min(mm.minute) filter (where f.s * (mk - f.p) <= -3 * coalesce(m0.tick, sel.tick) + 1e-9) u3
    from (select minute, case when quoting then m else (ab + aa) / 2 end::float8 mk from public.pm_rw_minutes
          where cond = f.cond and minute > f.t and minute < '2026-10-04 00:00:00+00' and bb is not null and ba is not null
            and ((quoting and m is not null) or (not quoting and ab is not null and aa is not null))) mm
  ) tr on true
),
y as (
  select x.*,
    case when settled_at is not null and settled_at < '2026-10-04 00:02:00+00' then payout else hz end Mz,
    b1.bb::float8 bb_1, b1.ba::float8 ba_1, b2.bb::float8 bb_2, b2.ba::float8 ba_2, b3.bb::float8 bb_3, b3.ba::float8 ba_3
  from x
  left join public.pm_rw_minutes b1 on b1.cond = x.cond and b1.minute = x.u1
  left join public.pm_rw_minutes b2 on b2.cond = x.cond and b2.minute = x.u2
  left join public.pm_rw_minutes b3 on b3.cond = x.cond and b3.minute = x.u3
),
z as (select y.*, case when s = 1 then bb_1 else ba_1 end X1, case when s = 1 then bb_2 else ba_2 end X2, case when s = 1 then bb_3 else ba_3 end X3 from y),
w as (
  select z.*, q*s*(Mz - p) hold,
    case when u1 is null then q*s*(Mz - p) else q*(s*(X1 - p) - fr*X1*(1 - X1)) end st1r,
    case when u2 is null then q*s*(Mz - p) else q*(s*(X2 - p) - fr*X2*(1 - X2)) end st2r,
    case when u3 is null then q*s*(Mz - p) else q*(s*(X3 - p) - fr*X3*(1 - X3)) end st3r,
    case when u1 is null then q*s*(Mz - p) else q*(s*((case when u1 = t1 then (case when s = 1 then greatest(X1, ypx) else least(X1, ypx) end) else X1 end) - p)
         - fr*(case when u1 = t1 then (case when s = 1 then greatest(X1, ypx) else least(X1, ypx) end) else X1 end)*(1 - (case when u1 = t1 then (case when s = 1 then greatest(X1, ypx) else least(X1, ypx) end) else X1 end))) end st1o,
    case when u2 is null then q*s*(Mz - p) else q*(s*((case when u2 = t1 then (case when s = 1 then greatest(X2, ypx) else least(X2, ypx) end) else X2 end) - p)
         - fr*(case when u2 = t1 then (case when s = 1 then greatest(X2, ypx) else least(X2, ypx) end) else X2 end)*(1 - (case when u2 = t1 then (case when s = 1 then greatest(X2, ypx) else least(X2, ypx) end) else X2 end))) end st2o,
    case when u3 is null then q*s*(Mz - p) else q*(s*((case when u3 = t1 then (case when s = 1 then greatest(X3, ypx) else least(X3, ypx) end) else X3 end) - p)
         - fr*(case when u3 = t1 then (case when s = 1 then greatest(X3, ypx) else least(X3, ypx) end) else X3 end)*(1 - (case when u3 = t1 then (case when s = 1 then greatest(X3, ypx) else least(X3, ypx) end) else X3 end))) end st3o
  from z
)
select count(*) n, round(sum(hold)::numeric, 2) hold_end,
  count(u1) trig1, sum(case when u1 = t1 then 1 else 0 end) trig1_first, round(sum(st1r)::numeric, 2) stop1_raw, round(sum(st1o)::numeric, 2) stop1_cf,
  count(u2) trig2, sum(case when u2 = t1 then 1 else 0 end) trig2_first, round(sum(st2r)::numeric, 2) stop2_raw, round(sum(st2o)::numeric, 2) stop2_cf,
  count(u3) trig3, sum(case when u3 = t1 then 1 else 0 end) trig3_first, round(sum(st3r)::numeric, 2) stop3_raw, round(sum(st3o)::numeric, 2) stop3_cf,
  round(percentile_cont(0.05) within group (order by st1o)::numeric, 3) p05_stop1_cf, round(min(st1o)::numeric, 2) worst_stop1_cf,
  round(percentile_cont(0.05) within group (order by st2o)::numeric, 3) p05_stop2_cf, round(min(st2o)::numeric, 2) worst_stop2_cf,
  round(percentile_cont(0.05) within group (order by st3o)::numeric, 3) p05_stop3_cf, round(min(st3o)::numeric, 2) worst_stop3_cf
from w;
-- results: n 2665 hold -568.72 | stop1 fires 2341 (656 on the first book) -1796.55 raw / -1073.51 cf | stop2 2245 (483) -1804.47 / -1136.03
--          stop3 2165 (362) -1809.78 / -1195.74 | p05 per fill (cf): stop1 -2.631, stop2 -2.883, stop3 -3.115; worst -17.31 each
