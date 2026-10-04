-- Mini-pool's own record, market-day by market-day (2026-10-04): every market it quoted in its dry-run from 2026-10-01,
-- its recorded minutes, those with a formula above zero as recorded (`s_old`), and those that score with our quotes in
-- the book (`s_new`): recorded above zero, or both quotes resting within the reward's maximum spread of the midpoint of
-- the book with them in it (the size-cutoff touch on each side improved by our quote when ours is better). It is the
-- minute record's reading of the formula of 2026-10-04, as Addendum 6 of the live-prep pre-registration counts the
-- blind spot. Read-only. Its rows, as read at 2026-10-04 15:31 UTC (10-04 to then), are `results/mini_history_days.json`,
-- which `mini_books_read.ts` takes as its third argument.
with x as (
  select (minute at time zone 'utc')::date as day, cond, minute, max_spread::numeric as v, bb, ba, ab, aa, bid_price, ask_price, formula_usd
    from public.pm_live_minutes where mode = 'dry_run' and minute >= '2026-10-01'),
y as (select x.*, greatest(coalesce(ab, 0), bid_price) as abf, least(coalesce(aa, 1), ask_price) as aaf from x),
agg as (select day, cond, count(*) as n, count(*) filter (where formula_usd > 0) as s_old,
   count(*) filter (where formula_usd > 0 or (bid_price is not null and ask_price is not null and bid_price < aaf and ask_price > abf
     and (abf + aaf) / 2 - bid_price >= 0 and ((abf + aaf) / 2 - bid_price) * 100 < v
     and ask_price - (abf + aaf) / 2 >= 0 and (ask_price - (abf + aaf) / 2) * 100 < v)) as s_new
  from y group by 1, 2)
select a.day, a.cond, a.n, a.s_old, a.s_new
  from agg a join public.pm_live_markets m on m.cond = a.cond and m.day = a.day
 order by a.day, a.cond;
