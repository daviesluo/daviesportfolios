-- LP-RULES (the coordinator's case, 2026-10-11 01:00 UTC): a SELECTED market taking entries (detail.lp.state 'quote')
-- in a book one tick wide (ba - bb <= tick, the book without our orders), holding at least the 5-share minimum of a
-- token, and resting nothing: TB1's skip empties `lpQuotes`, sells included, and Addendum 16's exit rule applies only to
-- close-only markets. Per UTC day: the market-minutes, the markets, the dollars held in those minutes (mean and peak, at
-- the adjusted mid detail.m: YES at m, NO at 1 - m), and what holding cost or gained across them: the holding times the
-- mid's move to the market's next live minute, summed (a mark-to-market of the stock an exit at the best ask would have
-- offered). Also the same for a selected market in a one-tick book holding nothing (rank 9's shape), for scale. Read-only.
with m as (
  select cond, minute, (minute at time zone 'utc')::date d, detail->'lp'->>'state' st, (detail->>'m')::numeric mid,
    coalesce((detail->'lp'->'held'->>'yes')::numeric, 0) y, coalesce((detail->'lp'->'held'->>'no')::numeric, 0) n,
    bid_price is null and ask_price is null empty, ba::numeric - bb::numeric <= tick::numeric + 1e-9 tight,
    ba::numeric ba, bb::numeric bb
  from pm_lp_minutes where mode = 'live'),
x as (
  select m.*, lead(mid) over (partition by cond order by minute) mid_next from m),
c as (
  select x.*, (y >= 5 or n >= 5) holds, y * mid + n * (1 - mid) held_usd,
    y * (mid_next - mid) - n * (mid_next - mid) dpnl,
    -- what an exit sell at the best ask would ask above the mid, per share: YES at ba, NO at 1 - bb
    case when y >= 5 then ba - mid when n >= 5 then (1 - bb) - (1 - mid) end ask_over_mid
  from x where st = 'quote' and empty and tight)
select d, holds, count(*) mm, count(distinct cond) markets, round(avg(held_usd), 2) mean_held_usd, round(max(held_usd), 2) peak_held_usd,
  round(sum(dpnl) filter (where mid_next is not null), 2) holding_pnl, round(100 * avg(ask_over_mid) filter (where holds), 2) exit_ask_over_mid_c
from c group by rollup (d, holds) having grouping(holds) = 0 or grouping(d) = 1 order by d nulls last, holds;
