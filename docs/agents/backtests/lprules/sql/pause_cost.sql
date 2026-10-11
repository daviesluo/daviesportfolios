-- LP-RULES: x2's pause (15 cents between two minutes' adjusted mids, 60 minutes) live. Episodes: a market's run of
-- 'paused' minutes. For each: its first minute, its length, the mid jump that started it (the last quoted minute's
-- detail.m before against the first paused minute's), the mid 60 minutes after the start against the mid at the start
-- (did it keep going, or come back?), and an upper bound of the formula the pause gave up: the episode's minutes times
-- the market's mean formula a two-sided quoting minute that UTC day (its own pause-free rate; a market that never
-- quoted two-sided that day counts 0). Read-only.
with m as (
  select cond, minute, (minute at time zone 'utc')::date d, detail->'lp'->>'state' st, (detail->>'m')::numeric mid,
    formula_usd::numeric f, bid_price is not null and ask_price is not null two
  from pm_lp_minutes where mode = 'live'),
g as (select m.*, minute - (row_number() over (partition by cond, st = 'paused' order by minute)) * interval '1 minute' grp from m),
ep as (
  select cond, min(minute) t0, count(*) mins, min(d) d from g where st = 'paused' group by cond, grp),
rate as (select cond, d, avg(f) filter (where two) fpm from m where st = 'quote' group by cond, d),
x as (
  select ep.*,
    (select mid from m where m.cond = ep.cond and m.minute < ep.t0 and m.mid is not null order by m.minute desc limit 1) mid_before,
    (select mid from m where m.cond = ep.cond and m.minute >= ep.t0 and m.mid is not null order by m.minute asc limit 1) mid_start,
    (select mid from m where m.cond = ep.cond and m.minute >= ep.t0 + interval '60 min' and m.mid is not null order by m.minute asc limit 1) mid_60,
    coalesce(r.fpm, 0) * ep.mins formula_ub
  from ep left join rate r on r.cond = ep.cond and r.d = ep.d)
select d, substr(cond, 1, 10) cond, to_char(t0, 'HH24:MI') t0, mins, round(100 * (mid_start - mid_before), 1) jump_c,
  round(100 * (mid_60 - mid_start), 1) next60_c, round(formula_ub, 2) formula_ub
from x order by t0;
