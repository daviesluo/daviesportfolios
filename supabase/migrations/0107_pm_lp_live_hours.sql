-- 0107: live-prep's live formula by UTC hour and market, for the estimate of today's rewards on LIVE's "Reward quotes".
--
-- Why. Davies, 2026-10-09, verbatim: "live页的Reward quotes子页面status中TOP SHARE这个框删了，右边的两个框往左移一格，最右边的那个
-- 空余的框显示预估今日rewards收益，可以给个范围（最低-最优），和实际的r值（应该也是会每天变动的吧）研究一套估算算法", and then
-- "预估今日rewards收益那个框也要实时更新，每天实际拿到payout后可以自动优化算法，然后清0继续算下一个day窗口的". In English: on
-- LIVE's Reward quotes page, take TOP SHARE out of STATUS and show today's estimated rewards as a range (low to best) in
-- the freed tile, with an algorithm for it and for the actual R; the tile updates in real time, recalibrates itself after
-- each day's payout, and starts again from zero for each UTC day.
--
-- What this does, and nothing else. A view, `public.pm_lp_live_hours`: `pm_lp_minutes`' live rows of the last 48 hours,
-- summed by UTC hour and market (the minutes recorded and the formula's reward for our quotes). The dashboard reads it
-- every minute (at most 48 × 10 rows) instead of the day's 14,400 minute rows; the estimate (`lpRewardEstimate`,
-- agents/pm_lp_live_view.ts) keeps today's hours and reads the earlier days from `pm_lp_reward_days`. The view is the
-- caller's (`security_invoker`): only the service role reads `pm_lp_minutes`, and the anon key opens nothing (0082). Its
-- WHERE is on the primary key's leading columns (mode, minute), so it reads two days of rows, never the whole table.
-- No table, row, function or call changes.

create or replace view public.pm_lp_live_hours with (security_invoker = true) as
select date_trunc('hour', minute at time zone 'UTC') at time zone 'UTC' as hour,
       cond,
       count(*)::integer as minutes,
       sum(formula_usd) as formula_usd
  from public.pm_lp_minutes
 where mode = 'live' and minute >= now() - interval '48 hours'
 group by 1, 2;

revoke all on public.pm_lp_live_hours from anon, authenticated;
grant select on public.pm_lp_live_hours to service_role;
