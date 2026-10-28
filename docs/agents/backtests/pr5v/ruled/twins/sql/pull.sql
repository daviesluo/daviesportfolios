-- The 10-28 readouts of the three hidden twins (pr5, p50, d): every read, SELECT only, through the Supabase connector,
-- 2026-10-28 ~19:15 UTC. Each statement returns one payload {table, n, md5, text}: one JSON object a line, and the md5 the
-- database computed over that same text. The connector saved each long reply to a file; PR5V's
-- `scripts/pr5v/reading_grab.py` cut it into data/<table>.txt (md5 and line count checked), then gzip -n -9.
-- The twins kept running after the readouts' cut (2026-10-28 00:00 UTC); scripts/readout.ts drops what came after it.

-- 1-3. Each twin's orders the page's functions read: every filled order and conversion, and any still resting.
select json_build_object('table','orders_pr5','n',count(*),'md5',md5(coalesce(string_agg(l, E'\n' order by id),'')),'text',coalesce(string_agg(l, E'\n' order by id),'')) payload from (
select id, json_build_object('id',id,'ts',ts,'mode',mode,'book',book,'rung_side',rung_side,'k',k,'leg',leg,'side',side,'state',state,'base_size',base_size,
  'filled_base',filled_base,'avg_fill_price',avg_fill_price,'price',price,'fee_gbp',fee_gbp,'filled_at',filled_at,'not_sent',response->'wouldBeRefused')::text l
from public.agent_quote_twin_pr5_orders where mode='live' and (filled_base > 0 or leg='convert' or state in ('pending','new','partially_filled'))) s;
select json_build_object('table','orders_p50','n',count(*),'md5',md5(coalesce(string_agg(l, E'\n' order by id),'')),'text',coalesce(string_agg(l, E'\n' order by id),'')) payload from (
select id, json_build_object('id',id,'ts',ts,'mode',mode,'book',book,'rung_side',rung_side,'k',k,'leg',leg,'side',side,'state',state,'base_size',base_size,
  'filled_base',filled_base,'avg_fill_price',avg_fill_price,'price',price,'fee_gbp',fee_gbp,'filled_at',filled_at,'not_sent',response->'wouldBeRefused')::text l
from public.agent_quote_twin_p50_orders where mode='live' and (filled_base > 0 or leg='convert' or state in ('pending','new','partially_filled'))) s;
select json_build_object('table','orders_d','n',count(*),'md5',md5(coalesce(string_agg(l, E'\n' order by id),'')),'text',coalesce(string_agg(l, E'\n' order by id),'')) payload from (
select id, json_build_object('id',id,'ts',ts,'mode',mode,'book',book,'rung_side',rung_side,'k',k,'leg',leg,'side',side,'state',state,'base_size',base_size,
  'filled_base',filled_base,'avg_fill_price',avg_fill_price,'price',price,'fee_gbp',fee_gbp,'filled_at',filled_at,'not_sent',response->'wouldBeRefused')::text l
from public.agent_quote_twin_d_orders where mode='live' and (filled_base > 0 or leg='convert' or state in ('pending','new','partially_filled'))) s;

-- 4. -> data/meta.txt (short reply, copied as it came; its md5 checked). Each twin's dust (state->'dust'), health (last_error, the replica check's mismatches (_sim's paperCheck)), orders written and sent a day
-- before the cut, and each book's fair (fairU / X) at the cut from PR5's minute record.
select json_build_object('table','meta','n',count(*),'md5',md5(coalesce(string_agg(l, E'\n' order by l),'')),'text',coalesce(string_agg(l, E'\n' order by l),'')) payload from (
select json_build_object('twin','pr5','dust',(select state->'dust' from public.agent_quote_twin_pr5_state),'state_error',(select last_error from public.agent_quote_twin_pr5_state),
  'sim_error',(select last_error from public.agent_quote_twin_pr5_sim),'mismatches',(select state->'paperCheck'->'mismatches' from public.agent_quote_twin_pr5_sim),
  'orders',(select count(*) from public.agent_quote_twin_pr5_orders where ts < '2026-10-28T00:00:00Z'),
  'sent',(select count(*) from public.agent_quote_twin_pr5_orders where ts < '2026-10-28T00:00:00Z' and response->'wouldBeRefused' is null))::text l
union all select json_build_object('twin','p50','dust',(select state->'dust' from public.agent_quote_twin_p50_state),'state_error',(select last_error from public.agent_quote_twin_p50_state),
  'sim_error',(select last_error from public.agent_quote_twin_p50_sim),'mismatches',(select state->'paperCheck'->'mismatches' from public.agent_quote_twin_p50_sim),
  'orders',(select count(*) from public.agent_quote_twin_p50_orders where ts < '2026-10-28T00:00:00Z'),
  'sent',(select count(*) from public.agent_quote_twin_p50_orders where ts < '2026-10-28T00:00:00Z' and response->'wouldBeRefused' is null))::text
union all select json_build_object('twin','d','dust',(select state->'dust' from public.agent_quote_twin_d_state),'state_error',(select last_error from public.agent_quote_twin_d_state),
  'sim_error',(select last_error from public.agent_quote_twin_d_sim),'mismatches',(select state->'paperCheck'->'mismatches' from public.agent_quote_twin_d_sim),
  'orders',(select count(*) from public.agent_quote_twin_d_orders where ts < '2026-10-28T00:00:00Z'),
  'sent',(select count(*) from public.agent_quote_twin_d_orders where ts < '2026-10-28T00:00:00Z' and response->'wouldBeRefused' is null))::text
union all select json_build_object('fair',b.book,'at',x.minute,'value',x.fair_u/x.x)::text
from (values ('USDC-GBP'),('USDT-GBP')) b(book) cross join lateral (select minute, fair_u, x from public.agent_quote_minutes q where q.book=b.book
  and q.minute <= '2026-10-28T00:00:00Z' and q.x is not null and q.fair_u is not null order by minute desc limit 1) x) s;

-- 5. PR5's paper trips (beside the pr5 twin), by rung, closed before the cut: all, and the window's (closed from 2026-10-04
-- 00:00, the size twin's window). Short reply, copied into data/pr5_paper_by_rung.json as it came.
select book, side, k, count(*) trips, count(*) filter (where pnl_usd > 0) won, round(sum(pnl_usd)::numeric, 4) pnl_usd,
 count(*) filter (where t_exit >= '2026-10-04') w_trips, count(*) filter (where t_exit >= '2026-10-04' and pnl_usd > 0) w_won, round(coalesce(sum(pnl_usd) filter (where t_exit >= '2026-10-04'),0)::numeric, 4) w_pnl_usd,
 count(*) filter (where how='taker') takers
from public.agent_quote_trips where t_exit < '2026-10-28T00:00:00Z' group by rollup ((book, side, k)) order by book nulls last, side, k;
