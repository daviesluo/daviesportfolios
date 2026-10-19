-- S1b, Deviation 1 (2026-10-19): one weekend's usability by quote coverage. Read-only.
--
-- Set the four values in `params` for the weekend: the recorder's FX window for the S1b epic, in UTC (G4: Sunday 20:50
-- to Monday 22:05 UK), the documented Sunday open in UTC (FX dealing opens Sunday 21:00 UK), and the epic and account
-- the S1b reading uses. The values below are the first weekend, 2026-10-18/19 (BST, UTC+1).
--
-- A minute m is covered when the recorder holds a quote for the epic no older than 2 minutes at m's end: a row of
-- public.ig_quotes with ts <= m + 1 min and seen_until >= m + 1 min - 2 min (seen_until is extended by every run that
-- read the quote unchanged). The weekend is usable when all four hold: covered >= 95 % of the window's minutes; a
-- TRADEABLE quote at or after the open is captured; none of the ten minutes from the open is uncovered; no run of
-- uncovered minutes is longer than 5. The run-level success rate is reported beside it, as the deviation requires.
with params as (
  select timestamptz '2026-10-18 19:50:00+00' as w_from,   -- Sunday 20:50 UK
         timestamptz '2026-10-19 21:05:00+00' as w_to,     -- Monday 22:05 UK (exclusive)
         timestamptz '2026-10-18 20:00:00+00' as w_open,   -- Sunday 21:00 UK
         'sb'::text as kind, 'CS.D.AUDUSD.TODAY.IP'::text as epic
), mins as (
  select p.*, m
  from params p, generate_series(p.w_from, least(p.w_to, date_trunc('minute', now())) - interval '1 minute', interval '1 minute') m
), cov as (
  select m, w_open, exists (
    select 1 from public.ig_quotes q
    where q.account_kind = mins.kind and q.epic = mins.epic
      and q.ts <= m + interval '1 minute' and coalesce(q.seen_until, q.ts) >= m + interval '1 minute' - interval '2 minutes'
  ) as covered
  from mins
), runs_of_gaps as (
  select m, covered, sum(case when covered then 1 else 0 end) over (order by m) as grp from cov
)
select
  (select w_to <= now() from params) as window_ended,
  count(*) as minutes,
  count(*) filter (where covered) as covered,
  round(100.0 * count(*) filter (where covered) / nullif(count(*), 0), 2) as coverage_pct,
  coalesce((select max(n) from (select count(*) n from runs_of_gaps where not covered group by grp) g), 0) as longest_uncovered_run_min,
  count(*) filter (where not covered and m >= w_open and m < w_open + interval '10 minutes') as uncovered_in_first_ten,
  (select min(q.ts) from public.ig_quotes q, params p where q.account_kind = p.kind and q.epic = p.epic
     and q.ts >= p.w_open and q.ts < p.w_to and q.market_status = 'TRADEABLE') as first_tradeable_at,
  (select count(*) filter (where r.ok) || ' of ' || count(*) from public.ig_quote_runs r, params p
     where r.started_at >= p.w_from and r.started_at < p.w_to) as runs_ok
from cov;
