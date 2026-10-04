-- As q_netstop_rw.sql, with the paper-fill quirk corrected on the first book after a fill: when a rule fires on the very
-- next minute's book after a fill on the position's own side, up to that fill's size goes at the better of the touch and
-- the fill print's own YES price (the level the print consumed would still be there had our order taken the print).
with recursive par(kind, k) as (values ('none', 0), ('time', 1), ('tick', 1), ('tick', 2), ('tick', 3), ('cent', 10), ('time', 15), ('time', 60)),
fs as (
  select f.cond, row_number() over (partition by f.cond order by f.ts, f.print_id) i, f.minute t, case f.side when 'bid' then 1 else -1 end s,
         f.price::float8 p, f.size::float8 q, (case when pr.oi = 0 then pr.price else 1 - pr.price end)::float8 ypx
  from public.pm_rw_fills f join public.pm_rw_prints pr on pr.id = f.print_id
  where f.minute >= '2026-09-25 00:00:00+00' and f.minute < '2026-10-04 00:00:00+00'
),
mk as (select cond, max(i) n from fs group by cond),
meta as (
  select distinct on (cond) cond,
    case cat when 'crypto_fees_v2' then 0.07 when 'sports_fees_v2' then 0.03 when 'sports_fees_v3' then 0.05
      when 'culture_fees' then 0.05 when 'economics_fees' then 0.05 when 'weather_fees' then 0.05 when 'general_fees' then 0.05
      when 'finance_prices_fees' then 0.04 when 'politics_fees' then 0.04 when 'mentions_fees' then 0.04 when 'tech_fees' then 0.04
      else 0 end::float8 fr
  from public.pm_rw_selection where cond in (select cond from mk) order by cond, day desc
),
sim(kind, k, cond, step, i, tcur, net, avgc, cash, topen, nstops, fees, lt, ls, lq, lypx) as (
  select par.kind, par.k, mk.cond, 0, 0::bigint, timestamptz '2026-09-24 23:59:00+00', 0::float8, 0::float8, 0::float8, null::timestamptz, 0, 0::float8,
         null::timestamptz, 0, 0::float8, 0::float8
  from par cross join mk
  union all
  select s.kind, s.k, s.cond, s.step + 1,
    case when tr.minute is not null then s.i else s.i + 1 end,
    coalesce(tr.minute, nf.t),
    case when tr.minute is not null then 0::float8
         else case when abs(s.net + nf.s * nf.q) < 1e-9 then 0::float8 else s.net + nf.s * nf.q end end,
    case when tr.minute is not null then 0::float8
         when abs(s.net + nf.s * nf.q) < 1e-9 then 0::float8
         when s.net = 0 or sign(s.net + nf.s * nf.q) <> sign(s.net) then nf.p
         when abs(s.net + nf.s * nf.q) > abs(s.net) then (abs(s.net) * s.avgc + nf.q * nf.p) / abs(s.net + nf.s * nf.q)
         else s.avgc end,
    case when tr.minute is not null then s.cash + sign(s.net) * (tr.qcf * tr.xcf + (abs(s.net) - tr.qcf) * tr.x)
                                         - me.fr * (tr.qcf * tr.xcf * (1 - tr.xcf) + (abs(s.net) - tr.qcf) * tr.x * (1 - tr.x))
         else s.cash - nf.s * nf.q * nf.p end,
    case when tr.minute is not null then null::timestamptz
         when abs(s.net + nf.s * nf.q) < 1e-9 then null::timestamptz
         when s.net = 0 or sign(s.net + nf.s * nf.q) <> sign(s.net) then nf.t
         else s.topen end,
    s.nstops + case when tr.minute is not null then 1 else 0 end,
    s.fees + case when tr.minute is not null then me.fr * (tr.qcf * tr.xcf * (1 - tr.xcf) + (abs(s.net) - tr.qcf) * tr.x * (1 - tr.x)) else 0 end,
    case when tr.minute is not null then s.lt else nf.t end,
    case when tr.minute is not null then s.ls else nf.s end,
    case when tr.minute is not null then s.lq else nf.q end,
    case when tr.minute is not null then s.lypx else nf.ypx end
  from sim s
  join meta me on me.cond = s.cond
  left join fs nf on nf.cond = s.cond and nf.i = s.i + 1
  left join lateral (
    select g.minute, g.x,
      case when g.cfok then least(abs(s.net), s.lq) else 0 end::float8 qcf,
      case when g.cfok then (case when s.net > 0 then greatest(g.x, s.lypx) else least(g.x, s.lypx) end) else g.x end::float8 xcf
    from (
      select mm.minute, case when s.net > 0 then mm.bb else mm.ba end::float8 x,
             (s.lt is not null and mm.minute <= s.lt + interval '1 minute' and sign(s.net) = s.ls) cfok
      from public.pm_rw_minutes mm
      where s.kind <> 'none' and s.net <> 0 and mm.cond = s.cond and mm.minute > s.tcur
        and mm.minute <= coalesce(nf.t, timestamptz '2026-10-03 23:59:00+00')
        and mm.bb is not null and mm.ba is not null
        and ((mm.quoting and mm.m is not null) or (not mm.quoting and mm.ab is not null and mm.aa is not null))
        and ((s.kind = 'tick' and sign(s.net) * ((case when mm.quoting then mm.m else (mm.ab + mm.aa) / 2 end) - s.avgc) <= -s.k * mm.tick + 1e-9)
          or (s.kind = 'cent' and sign(s.net) * ((case when mm.quoting then mm.m else (mm.ab + mm.aa) / 2 end) - s.avgc) <= -s.k * 0.01 + 1e-9)
          or (s.kind = 'time' and mm.minute >= s.topen + s.k * interval '1 minute'))
      order by mm.minute limit 1
    ) g
  ) tr on true
  where nf.i is not null or tr.minute is not null
),
fin as (select distinct on (kind, k, cond) kind, k, cond, net, cash, nstops, fees from sim order by kind, k, cond, step desc),
mz as (
  select mk.cond, case when st.settled_at is not null and st.settled_at < '2026-10-04 00:02:00+00' then st.payout::float8 else hz.mid::float8 end Mz
  from mk left join public.pm_rw_settlements st on st.cond = mk.cond
  left join lateral (select case when mm.quoting then mm.m else (mm.ab + mm.aa) / 2 end mid from public.pm_rw_minutes mm where mm.cond = mk.cond and mm.minute < '2026-10-04 00:00:00+00'
                     and ((mm.quoting and mm.m is not null) or (not mm.quoting and mm.ab is not null and mm.aa is not null)) order by mm.minute desc limit 1) hz on true
)
select fin.kind, fin.k, count(*) markets, sum(nstops) exits, round(sum(fees)::numeric, 2) fees, round(sum(cash + net * mz.Mz)::numeric, 2) fills_pnl_cf,
  round(min(cash + net * mz.Mz)::numeric, 2) worst_market, round(percentile_cont(0.05) within group (order by cash + net * mz.Mz)::numeric, 2) p05_market,
  round(sum(abs(net))::numeric, 1) open_shares_end
from fin join mz on mz.cond = fin.cond group by fin.kind, fin.k order by fin.kind, fin.k;
