-- LP-OBS-DEEP, item 5: live-prep's total-stop basis hour by hour since the go, with and without the maker rebates.
-- Fills: every CONFIRMED live fill to the hour (cash and shares by token); a settled market's tokens leave at its payout
-- from its settled_at; each held token marked at its market's last recorded live mid ((bb + ba)/2, YES at m, NO at 1 - m)
-- at or before the hour, as `bookPnl` marks it. Paid: the readout's live rows (pm_lp_reward_days), each UTC day's rewards
-- counted from 00:10 the next day and its maker rebates from 01:20 (when they landed on 10-10 and 10-11; Addendum 10).
-- The stop trips at basis <= -75. Read-only.
with mk as (select distinct on (cond) cond, yes_token, no_token from pm_lp_markets order by cond, day desc),
f as (
  select fl.cond, fl.token, fl.token = mk.yes_token is_yes, fl.match_time t,
    case when fl.side = 'BUY' then fl.size else -fl.size end dq,
    case when fl.side = 'BUY' then -fl.price * fl.size else fl.price * fl.size end dc
  from pm_lp_fills fl join mk on mk.cond = fl.cond where fl.status = 'CONFIRMED'),
h as (select generate_series(timestamptz '2026-10-09 02:00+00', date_trunc('hour', now()), interval '1 hour') h),
pos as (
  select h.h, f.cond, f.token, bool_and(f.is_yes) is_yes, sum(f.dq) q, sum(f.dc) cash
  from h join f on f.t <= h.h group by h.h, f.cond, f.token),
val as (
  select pos.*, s.payout, s.settled_at,
    (select (e.bb + e.ba) / 2 from pm_lp_minutes e where e.mode = 'live' and e.cond = pos.cond and e.minute <= pos.h
       and e.bb is not null and e.ba is not null order by e.minute desc limit 1) mid
  from pos left join pm_lp_settlements s on s.cond = pos.cond),
pnl as (
  select h, round(sum(cash + q * case when settled_at is not null and settled_at <= h then case when is_yes then payout else 1 - payout end
                                      else case when is_yes then coalesce(mid, 0) else 1 - coalesce(mid, 1) end end), 4) fills
  from val group by h),
pay as (
  select h.h,
    coalesce(sum(coalesce(r.actual_usd, 0) + coalesce(r.actual_sponsored_usd, 0)) filter (where h.h >= r.day + interval '1 day 10 min'), 0) rewards,
    coalesce(sum(coalesce(r.rebate_usd, 0)) filter (where h.h >= r.day + interval '1 day 80 min'), 0) rebates
  from h left join pm_lp_reward_days r on r.mode = 'live' group by h.h)
select to_char(p.h, 'MM-DD HH24:MI') at_hour, p.fills, round(y.rewards, 2) rewards, round(y.rebates, 2) rebates,
  round(p.fills + y.rewards, 2) basis_now, round(p.fills + y.rewards + y.rebates, 2) basis_with_rebates
from pnl p join pay y on y.h = p.h order by p.h;
