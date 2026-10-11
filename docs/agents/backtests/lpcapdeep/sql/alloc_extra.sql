-- LP-CAPDEEP: the buy budget handed out in rank order (Addendum 17, live since about 00:50 UTC 10-11) at the live
-- budget and with part or all of the cap's $80 released, replayed on every live minute in a window. Read-only.
--
-- Built on LP-CAPINV's alloc_replay.sql (backtests/lpcapinv/sql/), with the same rebuilt cap and held-at-cost, and the
-- same wanted buys: each market of today's in state 'quote' whose raw touch is wider than one tick wants, per side, a
-- BUY of N (YES at bb, NO at 1 - ba) unless the token that side would sell is held >= N (then that side is a SELL and
-- costs nothing). The budget for buys is B = cap - held at cost (the closed form: resting buys <= pUSD - 80).
-- The cap adds to LP-CAPINV's the 10-10 maker rebates ($4.82, LP-RULES day_pnl), taken as in pUSD from 00:30 UTC 10-11:
-- with them the rebuilt cap is 322, the live state's capTotal at 00:49 and 01:19.
-- Variants (column v):
--   e0, e20, e40, e60, e80: B + 0 / 20 / 40 / 60 / 80, whole markets in rank order (the live rule since Addendum 17);
--   top5: B for every market, B + 80 for ranks 1-5 only (a market ranked 6+ funds only within B);
--   held_lt_150 / held_lt_200: B + 80 only in minutes whose held at cost is under $150 / $200, else B.
-- Output: per variant and market, the market-minutes in 'quote' (wider than a tick), those funded two-sided, and the
-- selection's formula weight (formula_day / 1440) funded. The minute's real fills and holdings are as recorded.
-- Window: change w_from / w_to.
with recursive
params as (select '2026-10-11 00:51+00'::timestamptz w_from, '2026-10-11 02:00+00'::timestamptz w_to),
f0 as (
  select f.token, f.side, f.price::numeric p, f.size::numeric s, f.match_time t from pm_lp_fills f where f.status = 'CONFIRMED'
  union all select s.yes_token, 'SELL', s.payout::numeric, 1e9, s.settled_at from pm_lp_settlements s
  union all select s.no_token, 'SELL', 1 - s.payout::numeric, 1e9, s.settled_at from pm_lp_settlements s
),
f as (select *, row_number() over (partition by token order by t, case side when 'BUY' then 0 else 1 end) k from f0),
b as (
  select token, k, t, case when side = 'BUY' then s else 0 end held, case when side = 'BUY' then p else 0 end avg, 0::numeric r
  from f where k = 1
  union all
  select f.token, f.k, f.t,
    case when f.side = 'BUY' then b.held + f.s else greatest(0, b.held - f.s) end,
    case when f.side = 'BUY' then (b.avg * b.held + f.p * f.s) / nullif(b.held + f.s, 0) when b.held - f.s <= 0 then 0 else b.avg end,
    case when f.side = 'SELL' then least(b.held, f.s) * (f.p - b.avg) else 0 end
  from b join f on f.token = b.token and f.k = b.k + 1
),
bd as (select t, held * coalesce(avg, 0) - coalesce(lag(held * coalesce(avg, 0)) over (partition by token order by k), 0) d, r from b),
run as (select t, sum(d) over (order by t rows unbounded preceding) heldcost, sum(r) over (order by t rows unbounded preceding) realised from bd),
mins as (select distinct minute from pm_lp_minutes, params where mode = 'live' and minute >= w_from and minute < w_to),
bud as (
  select m.minute, x.heldcost,
    floor(402.028365 + x.realised
      + case when m.minute >= '2026-10-10 00:05+00' then 6.524180 else 0 end
      + case when m.minute >= '2026-10-10 01:00+00' then 1.976628 else 0 end
      + case when m.minute >= '2026-10-11 00:05+00' then 21.890765 else 0 end
      + case when m.minute >= '2026-10-11 00:30+00' then 4.82 else 0 end - 80) cap
  from mins m cross join lateral (select heldcost, realised from run where run.t <= m.minute order by run.t desc limit 1) x
),
vars as (select * from (values ('e0', 0, 99, 1e9), ('e20', 20, 99, 1e9), ('e40', 40, 99, 1e9), ('e60', 60, 99, 1e9), ('e80', 80, 99, 1e9),
  ('top5', 80, 5, 1e9), ('held_lt_150', 80, 99, 150), ('held_lt_200', 80, 99, 200)) v(v, extra, maxrank, heldmax)),
mk as (
  select x.minute, x.cond, k.rank, k.formula_day / 1440 w,
    case when coalesce((x.detail->'lp'->'held'->>'no')::numeric, 0) >= (x.detail->'lp'->>'n')::numeric - 1e-9 then 0
      else (x.detail->'lp'->>'n')::numeric * x.bb end
    + case when coalesce((x.detail->'lp'->'held'->>'yes')::numeric, 0) >= (x.detail->'lp'->>'n')::numeric - 1e-9 then 0
      else (x.detail->'lp'->>'n')::numeric * (1 - x.ba) end cost,
    (x.bid_price is not null and x.ask_price is not null) two_live
  from pm_lp_minutes x join pm_lp_markets k on k.cond = x.cond and k.day = (x.minute at time zone 'utc')::date
  where x.mode = 'live' and x.minute in (select minute from mins) and x.detail->'lp'->>'state' = 'quote'
    and (x.ba - x.bb) > x.tick + 1e-9 and x.bb is not null and x.ba is not null
),
rk as (select v.v, v.extra, v.maxrank, v.heldmax, m.*, row_number() over (partition by v.v, m.minute order by m.rank, m.cond) i from mk m cross join vars v),
g as (
  select r.v, r.minute, r.i, r.cond, r.w, r.rank, r.two_live,
    (r.cost <= bu.cap - bu.heldcost + case when r.rank <= r.maxrank and bu.heldcost < r.heldmax then r.extra else 0 end + 1e-9) funded,
    case when r.cost <= bu.cap - bu.heldcost + case when r.rank <= r.maxrank and bu.heldcost < r.heldmax then r.extra else 0 end + 1e-9 then r.cost else 0 end used,
    bu.cap - bu.heldcost base, case when bu.heldcost < r.heldmax then r.extra else 0 end extra, r.maxrank
  from rk r join bud bu using (minute) where r.i = 1
  union all
  select r.v, r.minute, r.i, r.cond, r.w, r.rank, r.two_live,
    (g.used + r.cost <= g.base + case when r.rank <= g.maxrank then g.extra else 0 end + 1e-9),
    g.used + case when g.used + r.cost <= g.base + case when r.rank <= g.maxrank then g.extra else 0 end + 1e-9 then r.cost else 0 end,
    g.base, g.extra, g.maxrank
  from g join rk r on r.v = g.v and r.minute = g.minute and r.i = g.i + 1
)
-- per variant and market (grouping set 1), and per variant in all (grouping set 2, cond null)
select v, left(cond, 10) cond, min(rank) rank, count(*) mkt_min, count(*) filter (where funded) funded_mm,
  count(*) filter (where two_live) two_live_mm, round(sum(w), 3) w_all, round(coalesce(sum(w) filter (where funded), 0), 3) w_funded,
  round(coalesce(sum(w) filter (where funded), 0) / sum(w), 3) share, count(distinct minute) minutes, round(avg(base), 2) mean_budget
from g group by grouping sets ((v, cond), (v)) order by 1, 2 nulls first;
