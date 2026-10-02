-- Mid-pool's fourteen-day readout: docs/agents/reviews/2026-10-02-polymarket-mid-pool-prereg.md. Descriptive: no bar, no
-- verdict, and it arms nothing. Read-only: it selects and changes nothing. Run it once, at or after d15 00:10 UTC (d1 is
-- the first full UTC day after pm_mid_config.created_at), as one statement, and report every row to Davies.
--
-- One row for each UTC day d1–d14, then the total: mid-pool's paper day (pm_midprep_days) beside small-pool's
-- (pm_prep_days), each at R = 0.40 (`*_pnl_r40`) and at the formula (`*_pnl_formula`, R = 1). `*_days` is 1 for a day its
-- layer closed: a day it did not close is missing, never zero, and the total says over how many days it runs. Small-pool's
-- live record of the day beside them (pm_live_minutes and pm_live_reward_days, mode live): its paper layer reads only
-- the dry-run's record, so on a day its path was live its paper day holds nothing of the live minutes.
with
w as (select (date_trunc('day', c.created_at at time zone 'utc') + interval '1 day')::date as d1 from public.pm_mid_config c where c.id = 1),
days as (select (w.d1 + k)::date as day from w, generate_series(0, 13) k),
live as (
  select days.day,
         exists (select 1 from public.pm_live_minutes x where x.mode = 'live'
                  and x.minute >= days.day::timestamp at time zone 'utc' and x.minute < (days.day + 1)::timestamp at time zone 'utc') as was_live,
         (select sum(r.formula_usd) from public.pm_live_reward_days r where r.mode = 'live' and r.day = days.day) as formula,
         (select sum(coalesce(r.actual_usd, 0) + coalesce(r.actual_sponsored_usd, 0)) from public.pm_live_reward_days r where r.mode = 'live' and r.day = days.day) as paid
    from days),
rows as (
  select days.day::text as day,
         (m.day is not null)::int as mid_days, m.markets as mid_markets, m.fills as mid_fills, m.minutes_matched as mid_matched,
         m.minutes_dark as mid_dark, m.minutes_diverged as mid_diverged, m.minutes_missing as mid_missing,
         m.reward as mid_formula, m.fills_pnl_day as mid_fills_pnl, m.pnl_day_r40 as mid_pnl_r40, m.fills_pnl_day + m.reward as mid_pnl_formula,
         m.held_value as mid_held, coalesce(m.stop_day or m.stop_total, false)::int as mid_stops,
         (s.day is not null)::int as small_days, s.markets as small_markets, s.fills as small_fills, s.minutes_matched as small_matched,
         s.minutes_dark as small_dark, s.minutes_diverged as small_diverged, s.minutes_missing as small_missing,
         s.reward as small_formula, s.fills_pnl_day as small_fills_pnl, s.pnl_day_r40 as small_pnl_r40, s.fills_pnl_day + s.reward as small_pnl_formula,
         s.held_value as small_held, coalesce(s.stop_day or s.stop_total, false)::int as small_stops,
         live.was_live::int as small_live_days, live.formula as small_live_formula, live.paid as small_live_paid
    from days join live on live.day = days.day
    left join public.pm_midprep_days m on m.day = days.day
    left join public.pm_prep_days s on s.day = days.day)
select * from (
select 1 as part, * from rows
union all
select 2, 'total', sum(mid_days), sum(mid_markets), sum(mid_fills), sum(mid_matched), sum(mid_dark), sum(mid_diverged), sum(mid_missing),
       sum(mid_formula), sum(mid_fills_pnl), sum(mid_pnl_r40), sum(mid_pnl_formula), null, sum(mid_stops),
       sum(small_days), sum(small_markets), sum(small_fills), sum(small_matched), sum(small_dark), sum(small_diverged), sum(small_missing),
       sum(small_formula), sum(small_fills_pnl), sum(small_pnl_r40), sum(small_pnl_formula), null, sum(small_stops),
       sum(small_live_days), sum(small_live_formula), sum(small_live_paid)
  from rows) t
order by part, day;
