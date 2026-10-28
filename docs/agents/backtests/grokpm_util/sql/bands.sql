-- GROKPM utilisation study (2026-10-28): each market's FIRST counted forecast (D9: from 2026-10-20 17:30 UTC), by the size of
-- p - m, with the resolved outcome y of the token it priced, Brier for p, m and the last trade, and the paper P&L per share
-- of buying at m (an upper bound: it assumes a fill at the mid). Read-only. Run 2026-10-28 ~21:30 UTC.
with d as (select d.*, row_number() over (partition by d.market_id, d.token_id order by d.received_at) rn
             from grokpm_decisions d where d.p is not null and d.m is not null and d.received_at > '2026-10-20 17:30+00'),
f as (select d.id, d.category, d.p, d.m, d.p - d.m e,
             (select (o.ord - 1)::int from jsonb_array_elements_text(r.tokens::jsonb) with ordinality o(v, ord) where o.v = d.token_id) idx,
             r.payouts::jsonb pj
        from d left join grokpm_resolutions r on r.cond = d.market_id where d.rn = 1),
g as (select f.*, (pj->>idx)::numeric y, sm.price lt from f left join grokpm_shadow_marks sm on sm.decision_id = f.id)
select category cat,
       case when e >= 0.12 then '1 >=12' when e >= 0.08 then '2 8-12' when e >= 0.05 then '3 5-8' when e >= 0 then '4 0-5' else '5 <0' end band,
       count(*) n, count(y) resolved, count(*) filter (where y = 1) won,
       round(avg(p) filter (where y is not null), 3) avg_p, round(avg(m) filter (where y is not null), 3) avg_m, round(avg(y), 3) rate,
       round(avg(power(p - y, 2)), 4) brier_p, round(avg(power(m - y, 2)), 4) brier_m, round(avg(power(coalesce(lt, m) - y, 2)), 4) brier_lt,
       round(sum(y - m), 3) pnl_per_share_at_m
  from g group by 1, 2 order by 1, 2;
