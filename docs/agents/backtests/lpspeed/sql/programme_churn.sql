-- LP-SPEED (e): how often the programme live-prep's check reads (detail.reward, once a turn) changes from one minute's
-- read to the next, and how long a reward-out lasts before the market is back in. Read-only; every live minute with a
-- reward read (2026-10-10 01:14 UTC on). One row: reads, consecutive pairs, pairs whose rate / minimum / spread changed,
-- in->out flips for a reward reason, and of those flips how many came back in within 1, 5, 15 and 60 minutes.
with m as (
  select cond, minute, (detail->'reward'->>'rate')::numeric as rate, (detail->'reward'->>'minSize')::numeric as mn,
         (detail->'reward'->>'v')::numeric as v,
         coalesce(detail->'reward'->>'out', '') like 'its reward%' as rout,
         detail->'reward'->>'out' is null as rin
  from pm_lp_minutes where mode = 'live' and detail ? 'reward'
), p as (
  select *, lag(minute) over w as pm, lag(rate) over w as pr, lag(mn) over w as pmn, lag(v) over w as pv, lag(rin) over w as prin
  from m window w as (partition by cond order by minute)
), flips as (
  select cond, minute from p where rout and prin and pm = minute - interval '1 minute'
), back as (
  select f.cond, f.minute, (select min(x.minute) from m x where x.cond = f.cond and x.minute > f.minute and x.rin) as back_at from flips f
)
select (select count(*) from m) as reads,
       (select count(*) from p where pm = minute - interval '1 minute') as pairs,
       (select count(*) from p where pm = minute - interval '1 minute' and pr is distinct from rate) as rate_changed,
       (select count(*) from p where pm = minute - interval '1 minute' and pmn is distinct from mn) as min_changed,
       (select count(*) from p where pm = minute - interval '1 minute' and pv is distinct from v) as spread_changed,
       (select count(*) from flips) as flips_out,
       (select count(*) filter (where back_at <= minute + interval '1 minute') from back) as back_1m,
       (select count(*) filter (where back_at <= minute + interval '5 minute') from back) as back_5m,
       (select count(*) filter (where back_at <= minute + interval '15 minute') from back) as back_15m,
       (select count(*) filter (where back_at <= minute + interval '60 minute') from back) as back_60m;
