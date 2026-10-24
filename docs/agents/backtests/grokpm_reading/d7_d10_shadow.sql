-- GROKPM's secondary reading (D7, with D9's sample and D10's column), the rows and their point scores. Read-only.
--
-- Written 2026-10-24 (the optimisation review, `docs/agents/reviews/2026-10-24-grokpm-optimisation.md`, F5), before the
-- end, from the pre-registration's §9 as it stands: D7 (shadow forecasts scored by Brier against the agent's m, each
-- market once at its first shadow forecast), the zero-trades review's §10 (D9: the sample starts 2026-10-20 16:58 UTC and
-- leaves out the 17:05 UTC wake's rows, ids `2026-10-20T17:05Z-d7-*`), and D10 (agreed 2026-10-23: beside m, the market's
-- last trade before each counted forecast, and a mark on each forecast whose book was one-sided or wider than 5 points).
-- §6.2's paired bootstrap runs over these rows in the end reading's script; this file gives the rows and the means.
--
-- Sources: `grokpm_decisions` (the journal), `grokpm_resolutions` (outcomes, which the recorder writes for every market a
-- forecast names since 0138), `grokpm_shadow_marks` (0138: the last trade and, when read within ten minutes, the book).
-- `thin` is null where no book was kept (every forecast before 0138's deploy): the end report says how many.
--
-- D13 (2026-10-24, the optimisation review's P3; Davies: "这些你看看需要做的话就做"): beside the full set, which stays as D7
-- defines it, the same means on the stratum of forecasts whose m lies in [0.05, 0.95]. A forecast on a market already at
-- 0.9995 scores near 0 for both sides and only dilutes a difference; the stratum is where there is something to forecast.

with counted as (
  select d.* from public.grokpm_decisions d
   where d.action = 'no_action' and d.p is not null and d.m is not null and d.token_id is not null
     and d.ts >= '2026-10-20T16:58:00Z' and d.id not like '2026-10-20T17:05Z-d7-%'
), firsts as (
  select distinct on (lower(market_id)) * from counted order by lower(market_id), ts, id
), scored as (
  select f.id, f.ts, lower(f.market_id) as market_id, f.token_id, f.category, f.p, f.m,
         s.status as trade_status, s.price as last_trade, s.trade_at,
         s.book_bid, s.book_ask,
         case when s.book_bid is null and s.book_ask is null then null
              else (s.book_bid is null or s.book_ask is null or s.book_ask - s.book_bid > 0.05) end as thin,
         (select r.payouts ->> (array_position(array(select jsonb_array_elements_text(r.tokens)), f.token_id) - 1)
            from public.grokpm_resolutions r where r.cond = lower(f.market_id))::numeric as y
    from firsts f left join public.grokpm_shadow_marks s on s.decision_id = f.id
)
select 'row' as kind, id, ts, market_id, category, p, m, last_trade, trade_status, thin, y,
       null::bigint as n, null::numeric as brier_agent, null::numeric as brier_m, null::numeric as brier_last_trade
  from scored
union all
-- On the resolved rows: the agent against m (D7) on all of them, and the agent against the last trade (D10) on those
-- with one found, each pair on the same rows.
select 'mean vs m', null, null, null, null, null, null, null, null, null, null,
       count(*), avg((p - y) ^ 2), avg((m - y) ^ 2), null
  from scored where y is not null
union all
select 'mean vs last trade', null, null, null, null, null, null, null, null, null, null,
       count(*), avg((p - y) ^ 2), null, avg((last_trade - y) ^ 2)
  from scored where y is not null and last_trade is not null
union all
select 'stratum m 0.05-0.95: mean vs m', null, null, null, null, null, null, null, null, null, null,
       count(*), avg((p - y) ^ 2), avg((m - y) ^ 2), null
  from scored where y is not null and m between 0.05 and 0.95
union all
select 'stratum m 0.05-0.95: mean vs last trade', null, null, null, null, null, null, null, null, null, null,
       count(*), avg((p - y) ^ 2), null, avg((last_trade - y) ^ 2)
  from scored where y is not null and last_trade is not null and m between 0.05 and 0.95
order by kind desc, ts;
