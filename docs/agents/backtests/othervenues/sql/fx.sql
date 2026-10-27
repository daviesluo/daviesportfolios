-- OTHERVENUES, read 2026-10-27 ~05:10 UTC through the Supabase connector, SELECT only. Each reply was saved by the
-- connector and cut out by scripts/grab_text.py, which refuses a payload whose md5 or line count the database did not
-- compute over the same text (eurusd 16,981 lines md5 e36b805ab863df4f519dc54217225304; gbpusd 25,457 lines md5
-- 3167e278b9b683060c4c05d4c22047ed).

-- EUR/USD, the Coinbase paper test's stored Yahoo minutes.
select json_build_object('table','eurusd','n',count(*),'md5',md5(string_agg(l, E'\n' order by ms)),'text',string_agg(l, E'\n' order by ms)) payload
from (select (extract(epoch from t)*1000)::bigint ms, (extract(epoch from t)*1000)::bigint||'|'||value l
      from public.cb_quote_inputs where kind='fx:EURUSD' and t < '2026-10-27T00:00:00Z') s;

-- GBP/USD, PR5's stored minutes.
select json_build_object('table','gbpusd','n',count(*),'md5',md5(string_agg(l, E'\n' order by ms)),'text',string_agg(l, E'\n' order by ms)) payload
from (select (extract(epoch from t)*1000)::bigint ms, (extract(epoch from t)*1000)::bigint||'|'||value l
      from public.agent_quote_inputs where kind='fx' and t >= '2026-10-01T00:00:00Z' and t < '2026-10-27T00:00:00Z') s;
