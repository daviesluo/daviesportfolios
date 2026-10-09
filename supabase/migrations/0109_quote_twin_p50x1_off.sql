-- 0109: "Stablecoin quotes variant-3" (`p50x1`, 0108) is withdrawn before its window opened, and rule D's twin (`d`) is
-- "Stablecoin quotes variant-3" again (docs/agents/reviews/2026-10-09-p50x1-prereg.md §7; the twins' pre-registration's
-- §17; reference §4 item 51).
--
-- On whose word. Davies, 2026-10-09, after the F3 replay (docs/agents/backtests/scq_f3/): "删掉 p50x1：回到 4 个测试版本，规则
-- D 改回 variant-3。" (delete p50x1: back to four test variants, and rule D's twin back to variant-3). The replay ran the
-- twins' own code over 2026-09-23 15:09 -> 10-09 16:00 UTC: one tick beyond fair wins only under the twins' through-only
-- fill rule (p50 +£0.24) and loses when a print at the exit's price fills it (p50 -£0.20), which LIVE's own exits show half
-- the time (22 of 44). A twin on the through-only simulator would read the favourable side only.
--
-- What it removes. The row, then its six tables and its lease row. Nothing else reads them: no view, function, cron job,
-- `edge_calls` row or retention job names them (production, read-only, 2026-10-09 18:24 UTC: `pg_depend` finds no view
-- on them, and `cron.job` no command naming a twin), and the call and the page read only the rows of
-- `agent_quote_twin_specs`. Its record is not lost: its offset was to start 2026-10-12 00:00 UTC, so every turn it took
-- was variant-1's (`p50`), minute for minute (src/p50x1_twin.test.js held the backfills equal, at d0c6f823); at 18:24 it
-- had caught up to 2026-10-07 16:46 (3,540 orders, 270 events), never forward.
--
-- The order. The row goes before the rename: page names are unique, and `d` takes back the name p50x1 holds (0108 did the
-- reverse). `d`'s id, tables, lease, order (40), rules and record stay; only its page name changes.
--
-- Safe while the call runs. `agents?action=quotestwins` reads the rows once, at its start, under the lease
-- `quotes-twins`, and then turns each twin; a call that read p50x1's row and met its tables gone would report an
-- `agents.quotes_twins` error. So this file first waits, at most 70 s, until no call holds that lease, and holds the
-- lease's row until it commits: a call starting meanwhile waits on that row (milliseconds: the rest is a delete, an
-- update and six drops) and then reads the rows without p50x1. The page's read of a twin that fails is no row, not an
-- error (`readQuotesTwin`).
--
-- What stays: the rule extension `exitOffset` in agents/quotes_twin.ts (`TWIN_RULES`) and agents/quotes_live.ts
-- (`QuoteLiveInstance.exitOffset`), which no row names now, so no twin runs it; taking it out of quotes_twin.ts would
-- change the hash the twins' and p50's pre-registrations pin, a further deviation in each, for code no row reaches.
-- Every other twin's row, tables and record, the live executor, PR5's paper test,
-- PR5V and rule D, `edge_calls` and every cron job. No grant and no policy.

set lock_timeout = '10s';

do $wait$
declare
  t0 timestamptz := clock_timestamp();
begin
  loop
    perform 1 from public.agent_locks
     where name = 'quotes-twins' and (holder is null or lease_until < clock_timestamp())
     for update;
    exit when found
      or not exists (select 1 from public.agent_locks where name = 'quotes-twins')
      or clock_timestamp() > t0 + interval '70 seconds';
    perform pg_sleep(0.5);
  end loop;
end
$wait$;

delete from public.agent_quote_twin_specs where id = 'p50x1';
update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes variant-3'
 where id = 'd' and display_name = 'Stablecoin quotes variant-4';
drop table if exists
  public.agent_quote_twin_p50x1_config, public.agent_quote_twin_p50x1_orders, public.agent_quote_twin_p50x1_events,
  public.agent_quote_twin_p50x1_state, public.agent_quote_twin_p50x1_paper, public.agent_quote_twin_p50x1_sim;
delete from public.agent_locks where name = 'quotes-twin-p50x1';
