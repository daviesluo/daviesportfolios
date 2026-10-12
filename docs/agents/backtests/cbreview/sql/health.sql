-- The Coinbase recorder's and paper test's health, read-only (select only), as run on 2026-10-12 ~23:00 UTC for
-- docs/agents/reviews/2026-10-12-coinbase-first-days.md, section 1. The first block is ledger items 12-13 as written.

-- 12 / 13: the recorder, the paper engine and the book recorder, as the ledger lists them
select last_report->'reached' as reached, last_error, updated_at from public.cb_rec_state;
select last_minute, last_error, now() - last_minute as lag from public.cb_quote_state;
select last_error, last_report from public.cb_book_state;

-- prints per book: count, first and last print, and the trade-id span against the count (a hole shows as span > n)
select product, count(*) n, min(ts) first_ts, max(ts) last_ts, max(trade_id) - min(trade_id) + 1 id_span, count(distinct trade_id) ids
from public.cb_trades group by 1 order by 1;

-- every break in a book's trade-id sequence (ids run one a print with no gap on Coinbase; 2026-10-12: USDC-GBP 7321708 only)
with o as (select product, trade_id, ts, lag(trade_id) over (partition by product order by trade_id) pid, lag(ts) over (partition by product order by trade_id) pts
           from public.cb_trades)
select product, trade_id, pid, ts, pts from o where trade_id <> pid + 1 order by product, trade_id;

-- the longest silence between two prints of a book in the window (a quiet book, not a hole, when the ids are continuous)
with o as (select product, ts, lag(ts) over (partition by product order by trade_id) pts from public.cb_trades where ts >= '2026-10-11')
select product, max(ts - pts) longest_gap, count(*) filter (where ts - pts > interval '10 minutes') gaps_over_10m from o group by 1 order by 1;

-- the paper engine's minutes: a row per book per minute, no hole; dark minutes (no GBP/USD or EUR/USD within ten minutes)
with o as (select book, minute, lag(minute) over (partition by book order by minute) pm, x from public.cb_quote_minutes)
select book, count(*) n, min(minute) first_minute, max(minute) last_minute, count(*) filter (where minute - pm > interval '1 minute') holes,
       count(*) filter (where x is null) dark, count(*) filter (where x is null and minute >= '2026-10-11') dark_in_window
from o group by 1 order by 1;

-- dark minutes by hour, to see that they are the interbank closure (Friday ~22:00 to Sunday ~23:00 UTC) and nothing else
select date_trunc('hour', minute) h, count(*) filter (where x is null) dark, count(*) n
from public.cb_quote_minutes where book = 'USDC-GBP' group by 1 order by 1;
-- PR5's own paper engine goes dark on the same minutes: its weekly share
select date_trunc('week', minute) wk, count(*) mins, count(*) filter (where x is null) dark, round(100.0 * count(*) filter (where x is null) / count(*), 1) dark_pct
from public.agent_quote_minutes where book = 'USDC-GBP' and minute >= '2026-09-14' group by 1 order by 1;

-- the interbank inputs the engine reads (PR5's GBP/USD and hourly closes; Yahoo's EUR/USD it stores itself)
select kind, count(*), min(t), max(t) from public.agent_quote_inputs group by 1 order by 1;
select kind, count(*), min(t), max(t) from public.cb_quote_inputs group by 1 order by 1;

-- the book recorder: a snapshot stored only when the book changed, `reads` counts the repeats; a gap is a minute without a read
select product, count(*) rows, sum(reads) reads, min(ts) first_ts, max(ts) last_ts from public.cb_book_levels group by 1 order by 1;
with o as (select product, ts, lag(seen_until) over (partition by product order by ts) ps from public.cb_book_levels)
select product, ps, ts, ts - ps gap from o where ts - ps > interval '75 seconds' order by 1, 3;
with o as (select product, ts, lag(ts) over (partition by product order by ts) pts from public.cb_touch)
select product, count(*) rows, count(*) filter (where ts - pts > interval '90 seconds') gaps_over_90s, max(ts - pts) longest from o group by 1 order by 1;

-- the watchdog: beats a minute for each call, the minutes with none, and the reruns
select path, count(*) beats, min(minute) first_beat, max(minute) last_beat, extract(epoch from max(minute) - min(minute)) / 60 + 1 expected
from public.edge_call_beats where path in ('agents?action=cbrec', 'agents?action=cbbooks') group by 1;
with g as (select generate_series('2026-10-10 10:36'::timestamptz, now() - interval '5 minutes', '1 minute') m)
select p.path, g.m as missing from (values ('agents?action=cbrec'), ('agents?action=cbbooks')) p(path) cross join g
left join public.edge_call_beats b on b.path = p.path and b.minute = g.m where b.minute is null order by 1, 2;
select path, count(*) retries from public.edge_call_retries where path in ('agents?action=cbrec', 'agents?action=cbbooks') group by 1;
select path, enabled, retry, every_minutes, timeout_ms from public.edge_calls where path like '%cb%';

-- the errors box since the deploy: Coinbase's kinds, then anything that names it
select created_at, kind, left(message, 200) msg from public.ops_errors
where created_at >= '2026-10-10' and (kind like 'agents.cb_%' or message ilike '%coinbase%' or context::text ilike '%coinbase%') order by created_at;

-- sizes (Micro, 1 GB): the tables and the database
select relname, pg_size_pretty(pg_total_relation_size(c.oid)) total, pg_total_relation_size(c.oid) bytes
from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and relkind = 'r' and relname like 'cb\_%' order by bytes desc;
select pg_size_pretty(pg_database_size(current_database())) database_size;
