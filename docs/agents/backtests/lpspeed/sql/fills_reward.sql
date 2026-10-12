-- LP-SPEED (b): the reward standing of each live fill's market in the fill's minute: the reward check's verdict
-- (detail.reward: in, or out for rate / minimum / ended / another reason), Polymarket's own scoring read of our two
-- sides that minute, and the market's state (quoting or worked close-only); with the fills' markouts against the
-- turn's mid 1 and 60 minutes on (YES-book terms, as scripts/tape.py). Before 2026-10-10 01:14 UTC there was no check
-- (detail.reward absent): "nocheck". Read-only; fills to 2026-10-12 09:00 UTC.
with f as (
  select f.cond, f.price, f.size, f.match_time, o.side, o.outcome, o.gate,
         case when (o.side = 'BUY') = (o.outcome = 'yes') then 1 else -1 end as dir,
         case when o.outcome = 'yes' then f.price else 1 - f.price end as qy
  from pm_lp_fills f join pm_lp_orders o on o.hash = f.hash and o.mode = 'live'
  where f.match_time < '2026-10-12 09:00+00'
), j as (
  select f.*, m.detail, m.bid_scoring, m.ask_scoring,
         case when m.detail is null then 'no minute row'
              when not (m.detail ? 'reward') then 'nocheck'
              when m.detail->'reward'->>'out' is null then 'in'
              when m.detail->'reward'->>'out' like 'its reward rate%' then 'out: rate'
              when m.detail->'reward'->>'out' like 'its reward minimum%' then 'out: minimum'
              when m.detail->'reward'->>'out' like 'its reward programme has ended%' then 'out: ended'
              when m.detail->'reward'->>'out' like 'replaced by a refill%' then 'out: refilled'
              else 'out: other' end as rw,
         coalesce(m.detail->'lp'->>'state', '') as st,
         (select (bb + ba) / 2 from pm_lp_minutes x where x.mode = 'live' and x.cond = f.cond and x.minute = date_trunc('minute', f.match_time) + interval '1 minute') as m1,
         (select (bb + ba) / 2 from pm_lp_minutes x where x.mode = 'live' and x.cond = f.cond and x.minute = date_trunc('minute', f.match_time) + interval '60 minute') as m60
  from f left join pm_lp_minutes m on m.mode = 'live' and m.cond = f.cond and m.minute = date_trunc('minute', f.match_time)
)
select string_agg(concat_ws(',', rw, gate, scoring, n, round(sh, 1), round(mo1, 2), round(mo60, 2), n60), E'\n' order by rw, gate, scoring) from (
  select rw, gate,
         case when bid_scoring or ask_scoring then 'scoring' when bid_scoring is false or ask_scoring is false then 'not scoring' else 'no read' end as scoring,
         count(*) as n, sum(size) as sh,
         sum(dir * (m1 - qy) * size) as mo1, sum(dir * (m60 - qy) * size) as mo60, count(m60) as n60
  from j group by 1, 2, 3
) z;
