-- LP-SPEED (b): how soon after live-prep starts quoting a market does its reward programme take it out? For every
-- market selected at 00:00 or refilled (pm_lp_markets, live days from 2026-10-10, when the per-minute check began),
-- the first minute that day the check read it out for a reward reason after it was selected, and its fills (count, $
-- of buys) before that minute. Read-only. One CSV text: day, rank, refill?, minutes to the first reward-out (blank:
-- never that day), its reason, buy fills before it, buy $ before it, sell fills before it.
with s as (
  select day, cond, rank, (detail ? 'refill') as refill, selected_at from pm_lp_markets where day >= '2026-10-10'
), o as (
  select s.*, (select min(m.minute) from pm_lp_minutes m
               where m.mode = 'live' and m.cond = s.cond and m.minute >= s.selected_at and m.minute < s.day + 1
                 and (m.detail->'reward'->>'out' like 'its reward%')) as out_at
  from s
)
select string_agg(concat_ws(',', day, rank, refill, round(extract(epoch from out_at - selected_at) / 60),
  (select regexp_replace(m.detail->'reward'->>'out', '^its reward (\w+).*$', '\1') from pm_lp_minutes m where m.mode = 'live' and m.cond = o.cond and m.minute = o.out_at),
  (select count(*) from pm_lp_fills f where f.cond = o.cond and f.side = 'BUY' and f.match_time >= o.selected_at and f.match_time < coalesce(o.out_at, o.day + 1)),
  (select round(coalesce(sum(f.price * f.size), 0), 2) from pm_lp_fills f where f.cond = o.cond and f.side = 'BUY' and f.match_time >= o.selected_at and f.match_time < coalesce(o.out_at, o.day + 1)),
  (select count(*) from pm_lp_fills f where f.cond = o.cond and f.side = 'SELL' and f.match_time >= o.selected_at and f.match_time < coalesce(o.out_at, o.day + 1))),
  E'\n' order by day, rank) from o;
