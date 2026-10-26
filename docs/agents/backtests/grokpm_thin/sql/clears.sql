-- GROKPM thin-rule study (2026-10-26): the shadow forecasts that cleared their category's bar on p - m from
-- 2026-10-23 05:00 UTC, the first clearing row of each market with its recorded book and last trade. Read-only; run
-- 2026-10-26 ~01:05 UTC through the Supabase connector; its output is data/clears.json (names and the agent's stated
-- books added by hand from the rows' reasons).
with c as (
  select d.*, s.book_bid, s.book_ask, s.price lt,
         row_number() over (partition by d.market_id order by d.ts) rn,
         count(*) over (partition by d.market_id) nclr, max(d.ts) over (partition by d.market_id) last_ts
    from public.grokpm_decisions d left join public.grokpm_shadow_marks s on s.decision_id = d.id
   where d.ts >= '2026-10-23T05:00Z' and d.p is not null and d.m is not null
     and ((d.category = 'A' and d.p - d.m >= 0.08) or (d.category = 'B' and d.p - d.m >= 0.12))
)
select json_agg(json_build_object('id', id, 'ts', ts, 'last_clear_ts', last_ts, 'n_clear', nclr, 'market_id', market_id,
         'token_id', token_id, 'category', category, 'p', p, 'm', m, 'book_bid', book_bid, 'book_ask', book_ask,
         'last_trade', lt) order by ts)
  from c where rn = 1;

-- The funnel's counts (same window).
select count(*) filter (where p is not null and m is not null) forecasts,
       count(distinct market_id) filter (where p is not null and m is not null) markets,
       count(*) filter (where (category = 'A' and p - m >= 0.08) or (category = 'B' and p - m >= 0.12)) clearing_rows
  from public.grokpm_decisions where ts >= '2026-10-23T05:00Z';   -- 189, 40, 42
select count(*) from public.grokpm_orders where created_at >= '2026-10-17T02:39:14Z';  -- 0
