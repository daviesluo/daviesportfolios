-- EXPENSIVE-SIDE (2026-10-09): live-prep's own paper record (pm_lpprep_*, 2026-10-04 17:55 -> 10-09 01:32 UTC), read-only
-- through the Supabase connector. Rewards by the market's expensive-token mid, the paper fills' P&L by the traded token's
-- price (each fill marked to its market's settlement payout, else its last stored mark), and the $ held in tokens marked
-- >= 0.90 / >= 0.95 each minute (in all, and the largest single market).
with fin as (
  select distinct on (m.cond) m.cond, coalesce(s.payout, m.mark) as v_yes
  from pm_lpprep_minutes m left join pm_lpprep_settlements s using (cond)
  where m.mark is not null order by m.cond, m.minute desc
), tok as (
  select distinct cond, yes_token from pm_lp_markets
  union select cond, yes_token from pm_lpprep_settlements
), f as (
  select f.*, case when f.token = t.yes_token then fin.v_yes else 1 - fin.v_yes end as v_tok
  from pm_lpprep_fills f join fin using (cond) left join tok t on t.cond = f.cond
), fills as (
  select 'fills' as part, case when token_price >= 0.95 then '>=.95' when token_price >= 0.90 then '.90-.95' else '<.90' end as bucket,
         token_side || case when close_only then ' close-only' else '' end as kind,
         count(*) as n, round(sum(size), 1) as shares, round(sum(size * token_price), 2) as usd,
         round(sum(case when token_side = 'BUY' then size * (v_tok - token_price) else size * (token_price - v_tok) end), 2) as pnl_to_end,
         count(*) filter (where v_tok is null) as unmarked
  from f group by 2, 3
), rew as (
  select 'reward' as part, case when greatest(mark, 1 - mark) >= 0.95 then '>=.95' when greatest(mark, 1 - mark) >= 0.90 then '.90-.95' else '<.90' end as bucket,
         'formula reward' as kind, count(*) filter (where reward > 0) as n, null::numeric as shares, null::numeric as usd, round(sum(reward), 2) as pnl_to_end, 0::bigint as unmarked
  from pm_lpprep_minutes where mark is not null group by 2
), ex as (
  select minute, cond,
         (case when mark >= 0.90 then yes_held * mark else 0 end) + (case when 1 - mark >= 0.90 then no_held * (1 - mark) else 0 end) as x90,
         (case when mark >= 0.95 then yes_held * mark else 0 end) + (case when 1 - mark >= 0.95 then no_held * (1 - mark) else 0 end) as x95
  from pm_lpprep_minutes where mark is not null and (yes_held > 0 or no_held > 0)
), exm as (
  select minute, sum(x90) as t90, sum(x95) as t95, max(x90) as one90 from ex group by minute
), expo as (
  select 'exposure' as part, 'minutes ' || (select count(distinct minute) from pm_lpprep_minutes) as bucket,
         'mean t90 ' || round(sum(t90) / (select count(distinct minute) from pm_lpprep_minutes), 2) || ' / max t90 ' || round(max(t90), 2) ||
         ' / max t95 ' || round(max(t95), 2) || ' / max one market ' || round(max(one90), 2) ||
         ' / minutes t90>0 ' || count(*) filter (where t90 > 0) || ', >=25 ' || count(*) filter (where one90 >= 25) || ', >=50 ' || count(*) filter (where one90 >= 50) ||
         ', >=75 ' || count(*) filter (where one90 >= 75) as kind,
         null::bigint, null::numeric, null::numeric, null::numeric, null::bigint
  from exm
)
select * from fills union all select * from rew union all select * from expo order by 1, 2, 3;
