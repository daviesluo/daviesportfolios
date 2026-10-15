-- PR5's paper engine's own record, for scripts/cbfast_revx.py (inputs/revx_paper_record.json.gz, packed by scripts/pack_revx_record.py). Select only.
-- 1. the Revolut X UK prints it decided on, one line a print: ms, price, qty, side initial, id.
select book, count(*) n, string_agg(concat_ws(',', (extract(epoch from ts)*1000)::bigint, price, qty, left(side,1), id), ';' order by ts, id) as lines
from agent_quote_prints group by book order by book;
-- 2. each decided minute: minute index (epoch / 60), GBP/USD and the dollar fair; an empty field is a dark input.
select book, count(*) n, string_agg(concat((extract(epoch from minute)/60)::bigint, ',', coalesce(x::text,''), ',', coalesce(fair_u::text,'')), ';' order by minute) as lines
from agent_quote_minutes where minute >= '2026-09-25 00:05' group by book order by book;
-- 3. the engine's own day totals (quoted in the review): trips, won and P&L by exit day, and the release minute of 2026-10-14.
select (t_exit at time zone 'UTC')::date d, count(*) trips, count(*) filter (where pnl_usd>0) won, round(sum(pnl_usd)::numeric,4) pnl,
       round(sum(pnl_usd) filter (where t_entry = '2026-10-14 12:30')::numeric,4) pnl_release_min, count(*) filter (where t_entry = '2026-10-14 12:30') n_release_min
from agent_quote_trips group by 1 order by 1 desc limit 8;
