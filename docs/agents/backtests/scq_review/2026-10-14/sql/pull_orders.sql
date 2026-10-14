-- 2026-10-14 stablecoin quotes review: the reads of production behind data/, SELECT only, through the Supabase
-- connector, 2026-10-14 04:01-04:03 UTC. The connector saved the long reply to a file; ../scripts/grab.py cut the
-- payloads out of it into data/<table>.json (python3 -I ../scripts/grab.py <saved reply> data).

-- 1. The orders every figure of the page reads (filled, or still resting), for LIVE and the four twins: the same
-- statement as ../sql/pull_orders.sql (2026-10-09). 174 / 217 / 245 / 255 / 1,054 rows.
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

-- 2. data/meta.json, read at 2026-10-14 04:02:28 UTC and copied in as it came, with each instance's rungs added (the
-- code's: 0.1 / 0.2 / 0.3 % for LIVE and pr5, p50, take50; rule D's nine for d).
with p(b) as (values ('USDC-GBP'),('USDT-GBP'))
select json_build_object('name','meta','now',now(),
 'tickers',(select json_agg(row_to_json(t)) from public.agent_quote_tickers t),
 'inst', json_build_object(
  'live', json_build_object('config',(select json_build_object('dry_run',dry_run,'live_confirmed_at',live_confirmed_at,'capital_gbp',capital_gbp) from public.agent_quote_live_config where id=1),
     'state',(select json_build_object('dust',state->'dust','balances',state->'balances','updated_at',updated_at,'last_error',last_error,'governor',state->'governor') from public.agent_quote_live_state),
     'paper',(select json_build_object('books',(select json_object_agg(b, json_build_object('lastPrint',s.state->'books'->b->'lastPrint','lastX',s.state->'books'->b->'lastX')) from p)) from public.agent_quote_state s), 'days', null),
  'pr5', json_build_object('config',(select json_build_object('dry_run',dry_run,'live_confirmed_at',live_confirmed_at,'capital_gbp',capital_gbp) from public.agent_quote_twin_pr5_config),
     'state',(select json_build_object('dust',state->'dust','balances',state->'balances','updated_at',updated_at,'last_error',last_error) from public.agent_quote_twin_pr5_state),
     'paper',(select json_build_object('books',(select json_object_agg(b, json_build_object('lastPrint',s.state->'books'->b->'lastPrint','lastX',s.state->'books'->b->'lastX')) from p)) from public.agent_quote_twin_pr5_paper s),
     'days',(select state->'days' from public.agent_quote_twin_pr5_sim), 'sim_error',(select last_error from public.agent_quote_twin_pr5_sim))
  -- ... and the same four lines for p50, take50 and d, each from its own agent_quote_twin_<id>_* tables.
 )) payload;
