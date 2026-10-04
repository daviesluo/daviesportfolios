-- Mini-pool ("Reward quotes mini-pool", paper layer pm_prep_* on the dry-run path's books pm_live_minutes, mode dry_run),
-- read at/after 2026-10-04 00:20 UTC (00:28:57 by date -u). 21 paper fills 10-02 07:58 -> 10-03 23:37. Fee rates from Gamma:
-- politics 0.04 (5 markets), tech 0.04 (2), culture 0.05 (1). Marks: the layer's own (pm_prep_minutes.mark, touch mid).
-- Per fill: exit at the next dry-run book's touch (raw) or the better of it and the print's price (cf); hold at horizons.
-- (queries as run; see results_mini.txt)
-- 1. per fill: exit at the next dry-run book (raw, cf) and holds marked at the path's touch mid
with f as (
  select fl.cond, fl.minute t, fl.ts, fl.side, case when fl.side = 'bid' then 1 else -1 end s, fl.price::float8 p, fl.size::float8 q,
    (case when pr.oi = 0 then pr.price else 1 - pr.price end)::float8 ypx,
    case when fl.cond in ('0xa5a08eeb7724af0ff3512db15f6a778fb14784261ac99f3777c0a5dfe54dd773','0xc4cb61ab76f2fc5fab8e4ac3ac1587d118aa18cec827875fa3886323fe92df66') then 0.04
         when fl.cond = '0x67d66925fa79005696aebcb4f21a2a3026d825bfb1e528efc83e19df9cea4282' then 0.05 else 0.04 end::float8 fr
  from public.pm_prep_fills fl join public.pm_prep_prints pr on pr.id = fl.print_id
),
x as (
  select f.*, m0.bb::float8 bb0, m0.ba::float8 ba0, n1.minute t1, n1.bb::float8 bb1, n1.ba::float8 ba1,
    h15.mid::float8 h15, h60.mid::float8 h60, h240.mid::float8 h240, hd.mid::float8 hd, hz.mid::float8 hz, hz.minute hzm
  from f
  left join public.pm_live_minutes m0 on m0.mode = 'dry_run' and m0.cond = f.cond and m0.minute = f.t
  left join lateral (select minute, bb, ba from public.pm_live_minutes mm where mm.mode = 'dry_run' and mm.cond = f.cond and mm.minute > f.t and mm.bb is not null and mm.ba is not null order by minute limit 1) n1 on true
  left join lateral (select (bb + ba) / 2 mid from public.pm_live_minutes mm where mm.mode = 'dry_run' and mm.cond = f.cond and mm.minute <= f.t + interval '15 minutes' and mm.bb is not null and mm.ba is not null order by minute desc limit 1) h15 on true
  left join lateral (select (bb + ba) / 2 mid from public.pm_live_minutes mm where mm.mode = 'dry_run' and mm.cond = f.cond and mm.minute <= f.t + interval '60 minutes' and mm.bb is not null and mm.ba is not null order by minute desc limit 1) h60 on true
  left join lateral (select (bb + ba) / 2 mid from public.pm_live_minutes mm where mm.mode = 'dry_run' and mm.cond = f.cond and mm.minute <= f.t + interval '240 minutes' and mm.bb is not null and mm.ba is not null order by minute desc limit 1) h240 on true
  left join lateral (select (bb + ba) / 2 mid from public.pm_live_minutes mm where mm.mode = 'dry_run' and mm.cond = f.cond and mm.minute < (date_trunc('day', f.t at time zone 'UTC') at time zone 'UTC') + interval '1 day' and mm.bb is not null and mm.ba is not null order by minute desc limit 1) hd on true
  left join lateral (select (bb + ba) / 2 mid, minute from public.pm_live_minutes mm where mm.mode = 'dry_run' and mm.cond = f.cond and mm.minute < '2026-10-04 00:00:00+00' and mm.bb is not null and mm.ba is not null order by minute desc limit 1) hz on true
),
y as (select x.*, case when s = 1 then bb1 else ba1 end X1r, case when s = 1 then greatest(bb1, ypx) else least(ba1, ypx) end X1o from x)
select left(cond, 10) c, t, side, p, round(q::numeric, 2) q, ypx, bb0, ba0, t1, bb1, ba1,
  round((q*(s*(X1r - p) - fr*X1r*(1 - X1r)))::numeric, 3) exit_raw, round((q*(s*(X1o - p) - fr*X1o*(1 - X1o)))::numeric, 3) exit_cf,
  round((q*s*(h15 - p))::numeric, 3) hold15, round((q*s*(h60 - p))::numeric, 3) hold60,
  case when t + interval '240 minutes' <= '2026-10-04' then round((q*s*(h240 - p))::numeric, 3) end hold4h,
  round((q*s*(hd - p))::numeric, 3) hold_day, round((q*s*(hz - p))::numeric, 3) hold_end, hz, hzm
from y order by ts;
-- 2. holds at the layer's own marks (reconciles to pm_prep_days 10-03 fills_pnl_total -4.5845)
with f as (select fl.cond, fl.minute t, fl.ts, case when fl.side = 'bid' then 1 else -1 end s, fl.price::float8 p, fl.size::float8 q from public.pm_prep_fills fl),
x as (
  select f.*, hz.mark::float8 hz, hd.mark::float8 hd, h15.mark::float8 h15, h60.mark::float8 h60, h240.mark::float8 h240
  from f
  left join lateral (select mark from public.pm_prep_minutes mm where mm.cond = f.cond and mm.minute < '2026-10-04 00:00:00+00' and mm.mark is not null order by minute desc limit 1) hz on true
  left join lateral (select mark from public.pm_prep_minutes mm where mm.cond = f.cond and mm.minute < (date_trunc('day', f.t at time zone 'UTC') at time zone 'UTC') + interval '1 day' and mm.mark is not null order by minute desc limit 1) hd on true
  left join lateral (select mark from public.pm_prep_minutes mm where mm.cond = f.cond and mm.minute <= f.t + interval '15 minutes' and mm.mark is not null order by minute desc limit 1) h15 on true
  left join lateral (select mark from public.pm_prep_minutes mm where mm.cond = f.cond and mm.minute <= f.t + interval '60 minutes' and mm.mark is not null order by minute desc limit 1) h60 on true
  left join lateral (select mark from public.pm_prep_minutes mm where mm.cond = f.cond and mm.minute <= f.t + interval '240 minutes' and mm.mark is not null order by minute desc limit 1) h240 on true
)
select count(*) n, round(sum(q*s*(hz - p))::numeric, 4) hold_end, round(sum(q*s*(hd - p))::numeric, 4) hold_day, round(sum(q*s*(h15 - p))::numeric, 4) hold15,
  round(sum(q*s*(h60 - p))::numeric, 4) hold60, round(sum(case when t + interval '240 minutes' <= '2026-10-04' then q*s*(h240 - p) end)::numeric, 4) hold4h from x;
