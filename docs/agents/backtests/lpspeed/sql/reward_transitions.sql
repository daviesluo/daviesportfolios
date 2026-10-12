-- LP-SPEED: every time live-prep's per-minute reward check (Addendum 9, from 2026-10-10 01:14 UTC) turned a market
-- from "in" to "out" for a reward reason (rate under $10, minimum over N, programme ended), with the read before it, and
-- the fills in that market from two minutes before the detecting turn to one minute after it. Read-only.
-- `at` is the reward read's own time (the turn's CLOB read); the change happened between prev_at and at.
with m as (
  select cond, minute, detail->'reward'->>'out' as out_txt, (detail->'reward'->>'at')::timestamptz as at,
         (detail->'reward'->>'rate')::numeric as rate, (detail->'reward'->>'minSize')::numeric as min_size,
         (detail->'reward'->>'native')::numeric as native, (detail->'reward'->>'sponsored')::numeric as sponsored,
         bid_price, ask_price, bid_scoring, ask_scoring,
         coalesce((detail->'lp'->'held'->>'yes')::numeric, 0) + coalesce((detail->'lp'->'held'->>'no')::numeric, 0) as held,
         detail->'lp'->>'state' as st
  from pm_lp_minutes where mode = 'live' and detail ? 'reward'
), c as (
  select *, case when out_txt like 'its reward rate%' then 'rate' when out_txt like 'its reward minimum%' then 'min'
                 when out_txt like 'its reward programme has ended%' then 'ended' when out_txt is null then 'in' else 'other' end as cls
  from m
), t as (
  select *, lag(cls) over w as prev_cls, lag(at) over w as prev_at, lag(rate) over w as prev_rate, lag(min_size) over w as prev_min,
         lag(minute) over w as prev_minute, lag(bid_price) over w as prev_bid, lag(ask_price) over w as prev_ask
  from c window w as (partition by cond order by minute)
)
select string_agg(line, E'\n' order by k) from (
  select '' as k, 'cond,minute,cls,prev_cls,prev_at,at,gap_s,prev_rate,rate,prev_min,min_size,held,prev_bid,prev_ask,fills_before,fills_after,fills_before_detail' as line
  union all
  select t.cond || t.minute::text, concat_ws(',', left(t.cond, 12), to_char(t.minute at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI'), t.cls, t.prev_cls,
    to_char(t.prev_at at time zone 'utc', 'HH24:MI:SS'), to_char(t.at at time zone 'utc', 'HH24:MI:SS'),
    round(extract(epoch from t.at - t.prev_at)), t.prev_rate, t.rate, t.prev_min, t.min_size, round(t.held, 2), t.prev_bid, t.prev_ask,
    (select count(*) from pm_lp_fills f where f.cond = t.cond and f.match_time >= t.prev_at and f.match_time < t.at),
    (select count(*) from pm_lp_fills f where f.cond = t.cond and f.match_time >= t.at and f.match_time < t.at + interval '60 minutes'),
    (select string_agg(f.side || ':' || f.price || 'x' || f.size || '@' || to_char(f.match_time at time zone 'utc', 'HH24:MI:SS'), ' ')
       from pm_lp_fills f where f.cond = t.cond and f.match_time >= t.prev_at - interval '120 seconds' and f.match_time < t.at + interval '60 seconds'))
  from t where t.cls in ('rate', 'min', 'ended') and t.prev_cls is distinct from t.cls and t.prev_cls = 'in'
) x;
-- Its summary (the same CTEs m, c, t above, then): by reason, the flips, how many had an order resting on either side at
-- the read before, the gap between the two reads, the fills between them, and the sides of the fills in the next hour.
--   select cls, count(*) flips, count(*) filter (where prev_bid is not null or prev_ask is not null) resting,
--          percentile_disc(0.5) within group (order by extract(epoch from at - prev_at)) gap_p50,
--          max(extract(epoch from at - prev_at)) gap_max,
--          sum((select count(*) from pm_lp_fills f where f.cond = t.cond and f.match_time >= t.prev_at and f.match_time < t.at)) fills_between,
--          sum((select count(*) from pm_lp_fills f where f.cond = t.cond and f.side = 'BUY' and f.match_time >= t.at and f.match_time < t.at + interval '60 minutes')) buys_next_hour,
--          sum((select count(*) from pm_lp_fills f where f.cond = t.cond and f.side = 'SELL' and f.match_time >= t.at and f.match_time < t.at + interval '60 minutes')) sells_next_hour
--   from t where cls in ('rate', 'min', 'ended') and prev_cls = 'in' group by rollup(cls);
