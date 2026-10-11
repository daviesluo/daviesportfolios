-- LP-CAPINV: how much of the selection's formula a quoting minute earns. For each UTC day, today's markets in state
-- 'quote', split top 3 by rank / the rest: the minutes' formula over the selection's (formula_day / 1440 a minute),
-- `k_all`, and the formula a quote market-day earns. Read-only.
with mm as (
 select (x.minute at time zone 'utc')::date d, x.cond, x.formula_usd::numeric fu, x.bid_scoring and x.ask_scoring sc
 from pm_lp_minutes x where x.mode = 'live' and x.detail->'lp'->>'state' = 'quote')
select mm.d, (k.rank <= 3) top3, count(*) qmm, round(sum(fu), 2) f, round(sum(fu) filter (where sc), 2) f_sc,
 round(sum(k.formula_day / 1440), 2) f_sel, round(sum(fu) / sum(k.formula_day / 1440), 3) k_all,
 round(sum(fu) filter (where sc) / sum(k.formula_day / 1440), 3) k_sc, round(1440 * sum(fu) / count(*), 2) f_per_mday
from mm join pm_lp_markets k on k.cond = mm.cond and k.day = mm.d group by rollup (1, 2) order by 1, 2;
