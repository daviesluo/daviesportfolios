-- Net-inventory exit rules replayed on RW's own fills (2026-09-25 00:00 -> 2026-10-04 00:00 UTC), per market, event by event.
-- State: net (YES shares), avgc (average cost of the open position), cash, topen (minute the position was opened or flipped).
-- Between two fills, a rule may flatten the whole net at the touch of a recorded book (bid for a long, ask for a short),
-- paying the taker fee rate*X*(1-X) a share. Rules: none (must reproduce RW: -568.72), tick k (the mark, RW's own, is k
-- ticks worse than avgc), time T (the position has not been flat for T minutes since it was opened). A book at minute u
-- can act before a fill printed inside minute u; a fill is acted on from the next book on.
with recursive par(kind, k) as (values ('none', 0), ('tick', 1), ('tick', 2), ('tick', 3), ('cent', 5), ('cent', 10), ('time', 15), ('time', 60)),
fs as (
  select cond, row_number() over (partition by cond order by ts, print_id) i, minute t, case side when 'bid' then 1 else -1 end s,
         price::float8 p, size::float8 q
  from public.pm_rw_fills where minute >= '2026-09-25 00:00:00+00' and minute < '2026-10-04 00:00:00+00'
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
sim(kind, k, cond, step, i, tcur, net, avgc, cash, topen, nstops, fees) as (
  select par.kind, par.k, mk.cond, 0, 0::bigint, timestamptz '2026-09-24 23:59:00+00', 0::float8, 0::float8, 0::float8, null::timestamptz, 0, 0::float8
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
    case when tr.minute is not null then s.cash + s.net * tr.x - abs(s.net) * me.fr * tr.x * (1 - tr.x)
         else s.cash - nf.s * nf.q * nf.p end,
    case when tr.minute is not null then null::timestamptz
         when abs(s.net + nf.s * nf.q) < 1e-9 then null::timestamptz
         when s.net = 0 or sign(s.net + nf.s * nf.q) <> sign(s.net) then nf.t
         else s.topen end,
    s.nstops + case when tr.minute is not null then 1 else 0 end,
    s.fees + case when tr.minute is not null then abs(s.net) * me.fr * tr.x * (1 - tr.x) else 0 end
  from sim s
  join meta me on me.cond = s.cond
  left join fs nf on nf.cond = s.cond and nf.i = s.i + 1
  left join lateral (
    select mm.minute, case when s.net > 0 then mm.bb else mm.ba end::float8 x
    from public.pm_rw_minutes mm
    where s.kind <> 'none' and s.net <> 0 and mm.cond = s.cond and mm.minute > s.tcur
      and mm.minute <= coalesce(nf.t, timestamptz '2026-10-03 23:59:00+00')
      and mm.bb is not null and mm.ba is not null
      and ((mm.quoting and mm.m is not null) or (not mm.quoting and mm.ab is not null and mm.aa is not null))
      and ((s.kind = 'tick' and sign(s.net) * ((case when mm.quoting then mm.m else (mm.ab + mm.aa) / 2 end) - s.avgc) <= -s.k * mm.tick + 1e-9)
        or (s.kind = 'cent' and sign(s.net) * ((case when mm.quoting then mm.m else (mm.ab + mm.aa) / 2 end) - s.avgc) <= -s.k * 0.01 + 1e-9)
        or (s.kind = 'time' and mm.minute >= s.topen + s.k * interval '1 minute'))
    order by mm.minute limit 1
  ) tr on true
  where nf.i is not null or tr.minute is not null
),
fin as (
  select distinct on (kind, k, cond) kind, k, cond, net, cash, nstops, fees from sim order by kind, k, cond, step desc
),
mz as (
  select mk.cond, case when st.settled_at is not null and st.settled_at < '2026-10-04 00:02:00+00' then st.payout::float8 else hz.mid::float8 end Mz
  from mk left join public.pm_rw_settlements st on st.cond = mk.cond
  left join lateral (select case when mm.quoting then mm.m else (mm.ab + mm.aa) / 2 end mid from public.pm_rw_minutes mm where mm.cond = mk.cond and mm.minute < '2026-10-04 00:00:00+00'
                     and ((mm.quoting and mm.m is not null) or (not mm.quoting and mm.ab is not null and mm.aa is not null)) order by mm.minute desc limit 1) hz on true
)
select fin.kind, fin.k, count(*) markets, sum(nstops) exits, round(sum(fees)::numeric, 2) fees, round(sum(cash + net * mz.Mz)::numeric, 2) fills_pnl,
  round(min(cash + net * mz.Mz)::numeric, 2) worst_market, round(percentile_cont(0.05) within group (order by cash + net * mz.Mz)::numeric, 2) p05_market,
  round(sum(abs(net))::numeric, 1) open_shares_end
from fin join mz on mz.cond = fin.cond
group by fin.kind, fin.k order by fin.kind, fin.k;
