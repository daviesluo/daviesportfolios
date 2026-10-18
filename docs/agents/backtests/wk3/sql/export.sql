-- "Stablecoin quotes variant-3" (`take50wk`) against variant-2 (`take50`): the reading's export
-- (docs/agents/reviews/2026-10-18-revx-weekend-prereg.md §3). Run once, SELECT only, on or after 2026-11-25 00:30 UTC (after
-- PR5-W's reading), each statement's reply saved to a file; ../../scq_review/scripts/grab.py <reply> data cuts statement 1
-- into data/<table>.json; statements 2 and 3 are saved as data/meta.json and data/closures.json as they come.

-- 1. Both twins' orders that filled or still rest, in the page's shape (the 2026-10-14 review's pull_orders.sql, two tables).
select json_build_object('table', t, 'n', n, 'rows', rows) payload from (
select 'agent_quote_twin_take50_orders' t, count(*) n, json_agg(json_build_array(id, ts, mode, book, rung_side, k, leg, side, state, base_size, filled_base, avg_fill_price, price, fee_gbp, filled_at, response->'wouldBeRefused', paper_oid, paper_live, fair, request->'take') order by id) rows from public.agent_quote_twin_take50_orders where mode='live' and (filled_base > 0 or state in ('pending','new','partially_filled'))
union all
select 'agent_quote_twin_take50wk_orders', count(*), json_agg(json_build_array(id, ts, mode, book, rung_side, k, leg, side, state, base_size, filled_base, avg_fill_price, price, fee_gbp, filled_at, response->'wouldBeRefused', paper_oid, paper_live, fair, request->'take') order by id) from public.agent_quote_twin_take50wk_orders where mode='live' and (filled_base > 0 or state in ('pending','new','partially_filled'))
) s;

-- 2. data/meta.json: the read's instant, the tickers, and each twin's dust and replica's last prints.
with p(b) as (values ('USDC-GBP'),('USDT-GBP'))
select json_build_object('name','meta','now',now(),
 'tickers',(select json_agg(row_to_json(t)) from public.agent_quote_tickers t),
 'inst', json_build_object(
  'take50', json_build_object('rungs', json_build_array(0.001,0.002,0.003), 'config',(select json_build_object('capital_gbp',capital_gbp) from public.agent_quote_twin_take50_config),
     'state',(select json_build_object('dust',state->'dust','balances',state->'balances','last_error',last_error) from public.agent_quote_twin_take50_state),
     'paper',(select json_build_object('books',(select json_object_agg(b, json_build_object('lastPrint',s.state->'books'->b->'lastPrint','lastX',s.state->'books'->b->'lastX')) from p)) from public.agent_quote_twin_take50_paper s)),
  'take50wk', json_build_object('rungs', json_build_array(0.001,0.002,0.003), 'config',(select json_build_object('capital_gbp',capital_gbp) from public.agent_quote_twin_take50wk_config),
     'state',(select json_build_object('dust',state->'dust','balances',state->'balances','last_error',last_error) from public.agent_quote_twin_take50wk_state),
     'paper',(select json_build_object('books',(select json_object_agg(b, json_build_object('lastPrint',s.state->'books'->b->'lastPrint','lastX',s.state->'books'->b->'lastX')) from p)) from public.agent_quote_twin_take50wk_paper s))
 )) payload;

-- 3. data/closures.json, bar 1's check: the entry orders variant-3 sent from each Saturday 00:00 to Sunday 21:00 UTC of the
-- window (GBP/USD dark: Friday 21:00 → 24:00 is left out, where it is live and variant-2 quotes too), keyed by the Friday the
-- closure began: a twin that never quoted there did not run the rule.
select json_build_object('name','closures','entries',(select coalesce(json_object_agg(f, n), '{}'::json) from (
  select to_char(date_trunc('week', ts - interval '4 days 21 hours') + interval '4 days 21 hours', 'YYYY-MM-DD') f, count(*) n
  from public.agent_quote_twin_take50wk_orders
  where mode='live' and leg='entry' and ts >= '2026-10-23 21:00:00+00' and ts < '2026-11-22 21:00:00+00'
    and (extract(isodow from ts) = 6 or (extract(isodow from ts) = 7 and extract(hour from ts) < 21))
  group by 1) x)) payload;
