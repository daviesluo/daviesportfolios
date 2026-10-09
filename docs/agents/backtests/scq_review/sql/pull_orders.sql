-- 2026-10-09 stablecoin quotes review: every read of production behind data/, SELECT only, through the Supabase
-- connector, 2026-10-09 15:56-16:10 UTC. The connector saved each long reply to a file; scripts/grab.py cut the payloads
-- out of it into data/<table>.json.

-- 1. The orders every figure of the page reads (filled, or still resting), for the live account and the four twins:
-- QUOTE_LIVE_SUMMARY_COLUMNS (agents/index.ts) plus paper_oid, paper_live, fair and the take mark. 105 / 180 / 201 / 209
-- / 845 rows.
select json_build_object('table', t, 'n', n, 'rows', rows) payload from (
select 'agent_quote_live_orders' t, count(*) n, json_agg(json_build_array(id, ts, mode, book, rung_side, k, leg, side, state, base_size, filled_base, avg_fill_price, price, fee_gbp, filled_at, response->'wouldBeRefused', paper_oid, paper_live, fair, request->'take') order by id) rows from public.agent_quote_live_orders where mode='live' and (filled_base > 0 or state in ('pending','new','partially_filled'))
union all
select 'agent_quote_twin_pr5_orders', count(*), json_agg(json_build_array(id, ts, mode, book, rung_side, k, leg, side, state, base_size, filled_base, avg_fill_price, price, fee_gbp, filled_at, response->'wouldBeRefused', paper_oid, paper_live, fair, request->'take') order by id) from public.agent_quote_twin_pr5_orders where mode='live' and (filled_base > 0 or state in ('pending','new','partially_filled'))
union all
select 'agent_quote_twin_p50_orders', count(*), json_agg(json_build_array(id, ts, mode, book, rung_side, k, leg, side, state, base_size, filled_base, avg_fill_price, price, fee_gbp, filled_at, response->'wouldBeRefused', paper_oid, paper_live, fair, request->'take') order by id) from public.agent_quote_twin_p50_orders where mode='live' and (filled_base > 0 or state in ('pending','new','partially_filled'))
union all
select 'agent_quote_twin_take50_orders', count(*), json_agg(json_build_array(id, ts, mode, book, rung_side, k, leg, side, state, base_size, filled_base, avg_fill_price, price, fee_gbp, filled_at, response->'wouldBeRefused', paper_oid, paper_live, fair, request->'take') order by id) from public.agent_quote_twin_take50_orders where mode='live' and (filled_base > 0 or state in ('pending','new','partially_filled'))
union all
select 'agent_quote_twin_d_orders', count(*), json_agg(json_build_array(id, ts, mode, book, rung_side, k, leg, side, state, base_size, filled_base, avg_fill_price, price, fee_gbp, filled_at, response->'wouldBeRefused', paper_oid, paper_live, fair, request->'take') order by id) from public.agent_quote_twin_d_orders where mode='live' and (filled_base > 0 or state in ('pending','new','partially_filled'))
) s;

-- 2. data/meta.json: each instance's config, the state fields the page reads (dust, balances), its paper engine's last
-- print and GBP/USD per book, the twins' orders sent per day, and the GBP tickers, read at 2026-10-09 15:57:57 UTC; the
-- reply was short and is copied into meta.json as it came (the spec rows are in agent_quote_twin_specs, quoted in the
-- review). The statement selected, for each of agent_quote_live_* and agent_quote_twin_<id>_*: config (row_to_json),
-- state->'dust', state->'balances', the paper table's state->'books'->b->'lastPrint' and ->'lastX', and _sim's
-- state->'days'; plus agent_quote_tickers.

-- 3. The UK prints PR5's engine stored (agent_quote_prints) from 2026-09-23, for scripts/exit_offset.py. 3,956 rows.
select json_build_object('table','prints','n',count(*),'rows',json_agg(json_build_array(book, (extract(epoch from ts)*1000)::bigint, price, qty, side) order by book, ts)) payload
from public.agent_quote_prints where ts >= '2026-09-23';
