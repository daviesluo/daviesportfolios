-- GROKPM rules study (2026-10-23): the D7 shadow forecasts, read-only. Run 2026-10-23 04:45 UTC through the Supabase
-- connector; its output, copied by hand, is data/shadow.json. Every no_action decision carrying both p and m, less the
-- 17:05 UTC wake of 2026-10-20 that D7's sample rule (the zero-trades review's §10) leaves out (2 rows).
--   markets: the 10 markets, keyed by the first 10 characters of the condition id, with the token the agent priced.
--   rows:    every row of the 8 markets other than the two Alberta referendum markets, its reason whole.
--   alberta: the two Alberta markets' 238 rows (119 each), summarised: their count, first row, gap range, rows that clear
--            their category's bar on p − m, and rows whose reason mentions a thin book. Each of those reasons says
--            "no edge" (under 8 or 12 points, or the mid above p).
with s as (
  select d.* from public.grokpm_decisions d
   where d.action = 'no_action' and d.p is not null and d.m is not null
     and d.id not like '2026-10-20T17:05Z-d7-%'
), alberta as (
  select * from s where market_id in ('0x1976c8f59abd1819cf56d9fb7d5c90fd3fc2cfc2044056266e6aae72df8d5334',
                                      '0xf860dcb3fcbeab65ecfeaefefdc830ee7c44c9ca999fbdc2e3314aa54591ebac')
)
select json_build_object(
  'markets', (select json_object_agg(k, json_build_object('market_id', market_id, 'token_id', token_id))
                from (select distinct left(market_id, 10) k, market_id, token_id from s) x),
  'rows', (select json_agg(json_build_array(
             id, to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), left(market_id, 10), category, p, m, reason)
             order by ts, id) from s where s.id not in (select id from alberta)),
  'alberta', (select json_object_agg(k, v) from (
     select left(market_id, 10) k, json_build_object(
       'n', count(*),
       'first', (array_agg(json_build_array(id, to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), category, p, m) order by ts))[1],
       'gap_min', min(p - m), 'gap_max', max(p - m),
       'clear', count(*) filter (where (category = 'A' and p - m >= 0.08) or (category = 'B' and p - m >= 0.12)),
       'thin_mentioned', count(*) filter (where reason ~* 'thin')) v
     from alberta group by 1) y))::text j;
