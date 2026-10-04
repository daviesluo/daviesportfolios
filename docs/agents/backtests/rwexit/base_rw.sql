-- Per-fill base for RW's paper fills, 2026-09-25 00:00 -> 2026-10-04 00:00 UTC (the nine closed days of RW's run).
-- s = +1 for a bid fill (bought YES at p), -1 for an ask fill (sold YES at p). Prices are YES prices.
-- Exit: the first book RW recorded AFTER the fill's minute (L1, normally minute t+1, read a few seconds into it),
-- and the first at or after t+2 min (L2) and t+5 min (L5); raw touch (bb/ba, any size) and size-adjusted touch
-- (ab/aa: the best level holding >= min_size shares, which covers a minute's fills, <= N = min_size a side).
-- Marks: RW's own lastM, the size-adjusted mid of the last book at or before the horizon that RW marked from (a quoting
-- minute's decided m, a held minute's (ab+aa)/2), or the payout
-- once the engine had recorded the settlement (settled_at <= horizon), as RW's day rows do.
-- Taker fee per share: rate * X * (1 - X), rate from the market's feeType (Gamma's feeSchedule, read 2026-10-04).
with f as (
  select fl.cond, fl.minute t, fl.ts, fl.side, case when fl.side = 'bid' then 1 else -1 end s,
         fl.price::float8 p, fl.size::float8 q, fl.print_id
  from public.pm_rw_fills fl
  where fl.minute >= '2026-09-25 00:00:00+00' and fl.minute < '2026-10-04 00:00:00+00'
),
x as (
  select f.*, sel.rate::float8 rate, sel.cat, sel.end_date, sel.min_size::float8 ms,
    case sel.cat when 'crypto_fees_v2' then 0.07 when 'sports_fees_v2' then 0.03 when 'sports_fees_v3' then 0.05
      when 'culture_fees' then 0.05 when 'economics_fees' then 0.05 when 'weather_fees' then 0.05 when 'general_fees' then 0.05
      when 'finance_prices_fees' then 0.04 when 'politics_fees' then 0.04 when 'mentions_fees' then 0.04 when 'tech_fees' then 0.04
      else 0 end::float8 fr,
    m0.m::float8 m0, coalesce(m0.tick, sel.tick)::float8 tick, m0.qb, m0.qa,
    st.payout::float8 payout, st.settled_at,
    (date_trunc('day', f.t at time zone 'UTC') at time zone 'UTC') + interval '1 day' as dayend,
    n1.minute t1, n1.bb::float8 bb1, n1.ba::float8 ba1, n1.ab::float8 ab1, n1.aa::float8 aa1,
    n2.minute t2, n2.bb::float8 bb2, n2.ba::float8 ba2, n2.ab::float8 ab2, n2.aa::float8 aa2,
    n5.minute t5, n5.bb::float8 bb5, n5.ba::float8 ba5, n5.ab::float8 ab5, n5.aa::float8 aa5,
    h15.mid::float8 h15, h15.minute h15m, h60.mid::float8 h60, h60.minute h60m, h240.mid::float8 h240, h240.minute h240m,
    hd.mid::float8 hd, hd.minute hdm, hz.mid::float8 hz, hz.minute hzm
  from f
  left join public.pm_rw_selection sel on sel.day = (f.t at time zone 'UTC')::date and sel.cond = f.cond
  left join public.pm_rw_minutes m0 on m0.cond = f.cond and m0.minute = f.t
  left join public.pm_rw_settlements st on st.cond = f.cond
  left join lateral (select minute, bb, ba, ab, aa from public.pm_rw_minutes mm where mm.cond = f.cond and mm.minute > f.t
                     and mm.bb is not null and mm.ba is not null order by mm.minute limit 1) n1 on true
  left join lateral (select minute, bb, ba, ab, aa from public.pm_rw_minutes mm where mm.cond = f.cond and mm.minute >= f.t + interval '2 minutes'
                     and mm.bb is not null and mm.ba is not null order by mm.minute limit 1) n2 on true
  left join lateral (select minute, bb, ba, ab, aa from public.pm_rw_minutes mm where mm.cond = f.cond and mm.minute >= f.t + interval '5 minutes'
                     and mm.bb is not null and mm.ba is not null order by mm.minute limit 1) n5 on true
  left join lateral (select case when mm.quoting then mm.m else (mm.ab + mm.aa) / 2 end mid, minute from public.pm_rw_minutes mm where mm.cond = f.cond and mm.minute <= f.t + interval '15 minutes'
                     and ((mm.quoting and mm.m is not null) or (not mm.quoting and mm.ab is not null and mm.aa is not null)) order by mm.minute desc limit 1) h15 on true
  left join lateral (select case when mm.quoting then mm.m else (mm.ab + mm.aa) / 2 end mid, minute from public.pm_rw_minutes mm where mm.cond = f.cond and mm.minute <= f.t + interval '60 minutes'
                     and ((mm.quoting and mm.m is not null) or (not mm.quoting and mm.ab is not null and mm.aa is not null)) order by mm.minute desc limit 1) h60 on true
  left join lateral (select case when mm.quoting then mm.m else (mm.ab + mm.aa) / 2 end mid, minute from public.pm_rw_minutes mm where mm.cond = f.cond and mm.minute <= f.t + interval '240 minutes'
                     and ((mm.quoting and mm.m is not null) or (not mm.quoting and mm.ab is not null and mm.aa is not null)) order by mm.minute desc limit 1) h240 on true
  left join lateral (select case when mm.quoting then mm.m else (mm.ab + mm.aa) / 2 end mid, minute from public.pm_rw_minutes mm where mm.cond = f.cond
                     and mm.minute < (date_trunc('day', f.t at time zone 'UTC') at time zone 'UTC') + interval '1 day'
                     and ((mm.quoting and mm.m is not null) or (not mm.quoting and mm.ab is not null and mm.aa is not null)) order by mm.minute desc limit 1) hd on true
  left join lateral (select case when mm.quoting then mm.m else (mm.ab + mm.aa) / 2 end mid, minute from public.pm_rw_minutes mm where mm.cond = f.cond and mm.minute < '2026-10-04 00:00:00+00'
                     and ((mm.quoting and mm.m is not null) or (not mm.quoting and mm.ab is not null and mm.aa is not null)) order by mm.minute desc limit 1) hz on true
),
y as (
  select x.*,
    -- marks with RW's settlement convention (payout once the engine had recorded it)
    case when settled_at is not null and settled_at <= t + interval '15 minutes' then payout else h15 end M15,
    case when settled_at is not null and settled_at <= t + interval '60 minutes' then payout else h60 end M60,
    case when settled_at is not null and settled_at <= t + interval '240 minutes' then payout else h240 end M240,
    case when settled_at is not null and settled_at < dayend + interval '2 minutes' then payout else hd end Mday,
    case when settled_at is not null and settled_at < '2026-10-04 00:02:00+00' then payout else hz end Mz,
    -- exit prices: raw touch and size-adjusted touch; a long sells at the bid, a short buys at the ask
    case when s = 1 then bb1 else ba1 end X1r, case when s = 1 then ab1 else aa1 end X1a,
    case when s = 1 then bb2 else ba2 end X2r, case when s = 1 then ab2 else aa2 end X2a,
    case when s = 1 then bb5 else ba5 end X5r, case when s = 1 then ab5 else aa5 end X5a,
    (ab1 + aa1) / 2 M1
  from x
)
