-- 0111: live-prep's reward check (its pre-registration's Addendum 9, 2026-10-10).
--
-- Why. On 2026-10-09, live-prep's first live day, Polymarket changed the reward programmes of five of its ten markets
-- during the day: two went from 200 a day at a minimum of 20 shares to 50 a day at 50 (our orders are 20), one had no
-- programme left, two more were cut or delisted. The path reads a programme once, at the 00:00 UTC selection, so it kept
-- quoting them and its minute formula kept counting them at the morning's rate: $153.90 of formula for the day, of which
-- the minutes Polymarket read both our sides scoring held about $19.80 (docs/agents/backtests/lpcfg/). Davies, verbatim:
-- "策略每分钟读的时候都检查奖励配置，避免再次出现这种白挂了并且承担风险并且没奖励的事情" (check the reward programme on every minute's
-- read, so we never again rest orders that carry the risk and earn nothing). The code (agents/pm_live.ts, `rewardCheck`)
-- now reads each quoted market's programme every turn and records the minute on the programme as read.
--
-- What this does, and nothing else:
--   1. `pm_lp_minutes.rate` may be under $10: a minute now records the rate its reward check read, which may have fallen
--      under live-prep's floor or ended (0). The CHECK of 0091 (rate >= 10) becomes rate >= 0. Until this runs, a minute
--      holding such a market fails to record (the turn says "minutes not recorded"), so it goes out with the code or
--      before it. `pm_lp_markets.reward_rate` keeps 0091's band: a selection is still $10 and over.
--   2. 0107's view `pm_lp_live_hours` gains, at its end, the minutes Polymarket read both our sides scoring and the
--      formula over them (`minutes_scored`, `formula_scored_usd`), as the readout counts them per day: the estimate of
--      today's rewards now rests on them (`lpRewardEstimate`). Its grants are 0107's: the service role reads it, the
--      anon key opens nothing (0082).
-- No other table, row, function or call changes.

alter table public.pm_lp_minutes drop constraint if exists pm_lp_minutes_rate_check;
alter table public.pm_lp_minutes add constraint pm_lp_minutes_rate_check check (rate >= 0);

create or replace view public.pm_lp_live_hours with (security_invoker = true) as
select date_trunc('hour', minute at time zone 'UTC') at time zone 'UTC' as hour,
       cond,
       count(*)::integer as minutes,
       sum(formula_usd) as formula_usd,
       (count(*) filter (where bid_scoring and ask_scoring))::integer as minutes_scored,
       coalesce(sum(formula_usd) filter (where bid_scoring and ask_scoring), 0) as formula_scored_usd
  from public.pm_lp_minutes
 where mode = 'live' and minute >= now() - interval '48 hours'
 group by 1, 2;

revoke all on public.pm_lp_live_hours from anon, authenticated;
grant select on public.pm_lp_live_hours to service_role;
