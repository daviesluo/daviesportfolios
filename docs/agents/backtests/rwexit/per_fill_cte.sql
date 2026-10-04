, z as (
  select y.*,
    case when rate < 50 then 'a <50' when rate < 100 then 'b 50-99' when rate < 200 then 'c 100-199' else 'd >=200' end band,
    case when end_date is not null and end_date <= dayend then 'same-day' else 'later' end endk,
    case when cat = 'weather_fees' then 'weather' else 'other' end wx,
    -- per-fill dollars; a fill with no later book cannot be exited: it is held to its terminal value (no fee)
    case when t1 is null then q*s*(Mz - p) else q*(s*(X1r - p) - fr*X1r*(1 - X1r)) end e1r,
    case when t1 is null then q*s*(Mz - p) else q*(s*(coalesce(X1a, X1r) - p) - fr*coalesce(X1a, X1r)*(1 - coalesce(X1a, X1r))) end e1a,
    case when t1 is null then q*s*(Mz - p) else q*(s*(X1r - p)) end e1r_nofee,
    case when t2 is null then q*s*(Mz - p) else q*(s*(X2r - p) - fr*X2r*(1 - X2r)) end e2r,
    case when t5 is null then q*s*(Mz - p) else q*(s*(X5r - p) - fr*X5r*(1 - X5r)) end e5r,
    case when t1 is null then 0 else q*fr*X1r*(1 - X1r) end fee1,
    case when t + interval '15 minutes' <= '2026-10-04 00:00:00+00' then q*s*(M15 - p) end h15d,
    case when t + interval '60 minutes' <= '2026-10-04 00:00:00+00' then q*s*(M60 - p) end h60d,
    case when t + interval '240 minutes' <= '2026-10-04 00:00:00+00' then q*s*(M240 - p) end h240d,
    q*s*(Mday - p) hdayd, q*s*(Mz - p) hzd, q*s*(m0 - p) edge0
  from y
)
