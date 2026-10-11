-- LP-CAPDEEP: every live refill (pm_lp_events kind 'refill'), with the buy budget at its minute, what the refill
-- market did, and whether the market it replaced came back into the universe later that day. Read-only.
--
-- budget: the cap less held at cost at the refill minute (rebuilt as alloc_extra.sql does; the closed form of
--   "resting buys <= pUSD - 80"), against the first-quote capital the day's active markets need (the refill test's own
--   sum, pm_lp_markets.capital of the day's rows not replaced, the new one included).
-- took_*: the refill market from its refill to the end of its UTC day: minutes in 'quote', of them with a book wider
--   than a tick, two-sided (both our orders resting), and the formula it scored.
-- back_*: the replaced market from its replacement to the end of the day: minutes whose stored programme (detail.reward)
--   was back in the universe (rate >= 10 and minimum <= 20), and its selection formula a day (pm_lp_markets.formula_day).
with recursive
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
ev as (
  select e.minute, (e.minute at time zone 'utc')::date d, e.detail->>'for' rep, e.detail->>'took' took, (e.detail->>'rank')::int rank,
    (e.detail->>'capital')::numeric need, e.detail->>'why' why
  from pm_lp_events e where e.kind = 'refill' and e.mode = 'live'
),
bud as (
  select ev.*, x.heldcost,
    floor(402.028365 + x.realised
      + case when ev.minute >= '2026-10-10 00:05+00' then 6.524180 else 0 end
      + case when ev.minute >= '2026-10-10 01:00+00' then 1.976628 else 0 end
      + case when ev.minute >= '2026-10-11 00:05+00' then 21.890765 else 0 end
      + case when ev.minute >= '2026-10-11 00:30+00' then 4.82 else 0 end - 80) - x.heldcost budget
  from ev cross join lateral (select heldcost, realised from run where run.t <= ev.minute order by run.t desc limit 1) x
),
took as (
  select ev.minute, count(*) filter (where x.detail->'lp'->>'state' = 'quote') q,
    count(*) filter (where x.detail->'lp'->>'state' = 'quote' and (x.ba - x.bb) > x.tick + 1e-9) q_wide,
    count(*) filter (where x.bid_price is not null and x.ask_price is not null) two,
    round(sum(x.formula_usd), 3) formula, count(*) mins
  from ev join pm_lp_minutes x on x.mode = 'live' and x.cond = ev.took and x.minute > ev.minute
    and x.minute < (ev.d + 1)::timestamp at time zone 'utc'
  group by 1
),
back as (
  select ev.minute, count(*) mins,
    count(*) filter (where (x.detail->'reward'->>'rate')::numeric >= 10 and coalesce((x.detail->'reward'->>'minSize')::numeric, 0) <= 20) back_in,
    min(x.minute) filter (where (x.detail->'reward'->>'rate')::numeric >= 10 and coalesce((x.detail->'reward'->>'minSize')::numeric, 0) <= 20) first_back
  from ev join pm_lp_minutes x on x.mode = 'live' and x.cond = ev.rep and x.minute > ev.minute
    and x.minute < (ev.d + 1)::timestamp at time zone 'utc'
  group by 1
),
-- the buys the day's markets quoting at that minute wanted (state 'quote', a book wider than a tick; a side whose token
-- the other side holds >= N sells and costs nothing): what the budget had to fund before the refill, which rank order
-- (Addendum 17) funds last
wq as (
  select ev.minute, count(x.*) quoting_wide,
    coalesce(sum(case when coalesce((x.detail->'lp'->'held'->>'no')::numeric, 0) >= (x.detail->'lp'->>'n')::numeric - 1e-9 then 0 else (x.detail->'lp'->>'n')::numeric * x.bb end
      + case when coalesce((x.detail->'lp'->'held'->>'yes')::numeric, 0) >= (x.detail->'lp'->>'n')::numeric - 1e-9 then 0 else (x.detail->'lp'->>'n')::numeric * (1 - x.ba) end), 0) want
  from ev left join pm_lp_minutes x on x.mode = 'live' and x.minute = ev.minute and x.detail->'lp'->>'state' = 'quote' and (x.ba - x.bb) > x.tick + 1e-9
  group by 1
),
needday as (
  select ev.minute, sum(k.capital) need_all
  from ev join pm_lp_markets k on k.day = ev.d and k.selected_at <= ev.minute + interval '1 minute'
  where not exists (select 1 from pm_lp_events e2 where e2.kind = 'refill' and e2.mode = 'live' and e2.detail->>'for' = k.cond and e2.minute <= ev.minute)
  group by 1
)
select to_char(bu.minute, 'MM-DD HH24:MI') at, left(bu.rep, 10) replaced, left(bu.took, 10) took, bu.rank, bu.need,
  round(bu.heldcost, 2) held, round(bu.budget, 2) budget, round(nd.need_all, 2) day_need, (bu.budget >= bu.need) covers_own, (bu.budget >= nd.need_all) covers_day,
  wq.quoting_wide, round(wq.want, 2) want_quoting, round(bu.budget - wq.want, 2) free_after, (bu.budget - wq.want >= bu.need) funded_at_once,
  t.mins, t.q, t.q_wide, t.two, t.formula,
  bk.mins rep_mins, bk.back_in rep_back_in, to_char(bk.first_back, 'HH24:MI') rep_first_back, left(bu.why, 50) why
from bud bu left join took t on t.minute = bu.minute left join back bk on bk.minute = bu.minute left join needday nd on nd.minute = bu.minute left join wq on wq.minute = bu.minute
order by bu.minute;
