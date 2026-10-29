-- 0172: GBP/USD and EUR/USD at second resolution, recorded beside Yahoo's minute bar (`agents/fx_rec.ts`,
-- `agents?action=fxrec`).
--
-- On whose word. Davies, 2026-10-29: "并行记录秒级汇率 并研究下最佳数据源并且要有fallback" (record a second-level rate in
-- parallel, find the best source, with a fallback). The sources were chosen in docs/agents/reviews/2026-10-29-fx-second-
-- sources.md: TrueFX's keyless snapshot the primary, read every second; Kraken's spot GBP/USD and EUR/USD ticker the
-- fallback, read every 5 s always and every 2 s while TrueFX is unhealthy. Neither needs an account or a key. Nothing here
-- trades, and NO STRATEGY READS THESE TABLES: every quote row keeps Yahoo's bar; the review's comparison plan is the only
-- reader, for 2–4 weeks, before anything about a faster rate is decided.
--
--   fx_ticks        a row per source, pair and minute: the minute's first read and every later read that brought a new
--                   quote (or, for TrueFX, a new timestamp of its own), as parallel arrays: when it arrived and the
--                   source's own time, each in ms after the minute (Kraken gives none: null); bid, ask and mid in
--                   millionths; whether it was read as the fallback. With them the minute's reads and failed reads.
--   fx_tick_reads   the same, a row per read, in timestamps and prices (a view; security_invoker).
--   fx_rec_state    one row: the primary's health (failed reads in a row, unhealthy since), the fault last reported to
--                   `ops_errors` (`agents.fx_rec`: TrueFX unhealthy 5 minutes with the market open, the fallback failing
--                   every read of a minute it was needed, a failed write; when it first appears and at most hourly while
--                   it lasts), the last run's errors and report.
--
-- Its size. A weekday minute keeps up to 59 TrueFX reads a pair (one real minute at 07:29 UTC on 2026-10-29 kept 34 and
-- 43 of 59) and up to 12 of Kraken's. A full row of 59 reads is 1,444 bytes (`pg_column_size`, PostgreSQL 16), so a
-- weekday is at most about 5 MB and a closed weekend almost nothing. Kept 42 days (the comparison's four weeks and two
-- spare): at most about 200 MB, likely about half. The database was 2,607 MB on 2026-10-29.
--
-- The row of the job. Every minute, all day: the call answers at once and its run goes on under `waitUntil` to 58 s into
-- its minute (none of the job's batch is held), so its 10 s timeout is the answer's. Run again by the watchdog when its
-- worker never started (`retry`): the retry reads from 13 s on into the same minute's rows, and changes nothing else. Its
-- beat is the `agents` function's, written before its work. Like every row since 0104 it waits 15 minutes (`active_from`'s
-- default) for the function's deploy.
--
-- Not among the monitor's health readings (`monitor/health.ts`): a research recorder that stops trades nothing; its
-- faults go to the errors box.
--
-- No grant and no policy: row level security is on, and 0082's default privileges keep `anon` and `authenticated` from
-- the new tables. Only the service role (the function) and postgres (the prune) touch them.
--
-- ⚠️  As 0075: the job's URL is the PRODUCTION project's Edge host, so this row makes any database it is applied to call
-- production.

create table if not exists public.fx_ticks (
  source      text not null check (source in ('truefx', 'kraken')),
  pair        text not null check (pair in ('GBPUSD', 'EURUSD')),
  minute      timestamptz not null,
  recv_ms     integer[] not null,                    -- when each read arrived, ms after `minute` (the function's clock)
  src_ms      integer[],                             -- the source's own time of each quote, ms after `minute`; null: none given
  bid         integer[] not null,                    -- millionths
  ask         integer[] not null,
  mid         integer[] not null,                    -- millionths, (bid + ask) / 2 rounded
  fallback    boolean[] not null,                    -- read because the primary was unhealthy
  reads       integer not null check (reads >= 0),   -- the minute's reads of the source, kept or not
  failed      integer not null check (failed >= 0), -- of which failed
  last_error  text,
  primary key (source, pair, minute),
  check (cardinality(bid) = cardinality(recv_ms) and cardinality(ask) = cardinality(recv_ms)
         and cardinality(mid) = cardinality(recv_ms) and cardinality(fallback) = cardinality(recv_ms)
         and (src_ms is null or cardinality(src_ms) = cardinality(recv_ms)))
);

comment on table public.fx_ticks is 'Second-level GBP/USD and EUR/USD (agents/fx_rec.ts, 0172): TrueFX primary, Kraken fallback. Research only; no strategy reads it.';
comment on column public.fx_ticks.bid is 'Millionths of a dollar per pound or euro.';
comment on column public.fx_ticks.ask is 'Millionths of a dollar per pound or euro.';

create or replace view public.fx_tick_reads with (security_invoker = true) as
select t.source, t.pair, t.minute,
       t.minute + make_interval(secs => r.recv / 1000.0) as recv_ts,
       case when r.src is null then null else t.minute + make_interval(secs => r.src / 1000.0) end as src_ts,
       r.b / 1e6 as bid, r.a / 1e6 as ask, r.m / 1e6 as mid, r.fb as fallback
from public.fx_ticks t,
     unnest(t.recv_ms, t.src_ms, t.bid, t.ask, t.mid, t.fallback) as r(recv, src, b, a, m, fb);

create table if not exists public.fx_rec_state (
  id          integer primary key check (id = 1),
  state       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz,
  last_error  text,
  last_report jsonb
);
insert into public.fx_rec_state (id, updated_at) values (1, now()) on conflict (id) do nothing;

alter table public.fx_ticks     enable row level security;
alter table public.fx_rec_state enable row level security;

insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('agents?action=fxrec', 10000, 1, 23, true) on conflict (path) do nothing;

-- Daily: rows older than 42 days.
select cron.schedule(
  'fx-ticks-prune',
  '43 10 * * *',
  $cron$delete from public.fx_ticks where minute < now() - interval '42 days';$cron$
);
