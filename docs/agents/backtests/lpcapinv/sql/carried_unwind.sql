-- LP-CAPINV: how fast carried inventory unwinds. An episode starts at a market's first live minute in state
-- 'carried' (close-only: held from another day, or taken out today by the reward check, the AI rule, the loss guard
-- or a refill) after a minute in another state or none; its holding is detail.lp.held (the account's token balances,
-- YES + NO shares). The share of the starting holding still held at +1, +3, +6, +12 and +24 hours (the last minute
-- read at or before then, while the market is still recorded; null when the record ends first), and how many of
-- those minutes a SELL of ours rested in it (detail.orders > 0). Read-only.
with m as (
  select minute, cond, detail->'lp'->>'state' st,
    coalesce((detail->'lp'->'held'->>'yes')::numeric, 0) + coalesce((detail->'lp'->'held'->>'no')::numeric, 0) sh,
    coalesce((detail->'lp'->'held'->>'yes')::numeric, 0) * (detail->>'m')::numeric
      + coalesce((detail->'lp'->'held'->>'no')::numeric, 0) * (1 - (detail->>'m')::numeric) usd,
    (detail->>'orders')::int orders,
    (x.ba - x.bb) <= x.tick + 1e-9 tight,
    lag(detail->'lp'->>'state') over (partition by cond order by minute) prev_st,
    lag(minute) over (partition by cond order by minute) prev_min
  from pm_lp_minutes x where mode = 'live'
),
ep as (
  select cond, minute t0, sh sh0, usd usd0 from m
  where st = 'carried' and sh >= 5 and (prev_st is distinct from 'carried' or prev_min < minute - interval '5 min')
),
lastrec as (select cond, max(minute) tmax from m group by cond),
at as (
  select e.*, h.hrs, l.tmax,
    (select m.sh from m where m.cond = e.cond and m.minute <= e.t0 + make_interval(hours => h.hrs) order by m.minute desc limit 1) sh_h
  from ep e cross join (values (1), (3), (6), (12), (24)) h(hrs) join lastrec l on l.cond = e.cond
)
select left(cond, 10) cond, to_char(t0, 'MM-DD HH24:MI') t0, round(sh0, 1) sh0, round(usd0, 2) usd0_mid,
  round(max(sh_h / sh0) filter (where hrs = 1 and t0 + interval '1 hour' <= tmax), 2) h1,
  round(max(sh_h / sh0) filter (where hrs = 3 and t0 + interval '3 hours' <= tmax), 2) h3,
  round(max(sh_h / sh0) filter (where hrs = 6 and t0 + interval '6 hours' <= tmax), 2) h6,
  round(max(sh_h / sh0) filter (where hrs = 12 and t0 + interval '12 hours' <= tmax), 2) h12,
  round(max(sh_h / sh0) filter (where hrs = 24 and t0 + interval '24 hours' <= tmax), 2) h24,
  (select count(*) from m where m.cond = at.cond and m.minute >= at.t0 and m.st = 'carried') carried_min,
  (select count(*) from m where m.cond = at.cond and m.minute >= at.t0 and m.st = 'carried' and m.orders > 0) with_sell_min,
  (select count(*) from m where m.cond = at.cond and m.minute >= at.t0 and m.st = 'carried' and m.tight) tight_min
from at group by cond, t0, sh0, usd0 order by t0, cond;
