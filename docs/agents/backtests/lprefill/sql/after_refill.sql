-- LPREFILL, Addendum 15 (2026-10-10): live-prep live after its first refills. Read-only, through the Supabase connector at
-- 2026-10-10 19:32 UTC (the 19:00 hour is partial).
-- 1. What the day's markets (the 00:00 ten and the refills) earned by the formula, hour by hour.
with t as (select cond from public.pm_lp_markets where day = '2026-10-10')
select date_trunc('hour', m.minute) h,
       count(distinct m.cond) filter (where coalesce(m.bid_scoring, false) or coalesce(m.ask_scoring, false)) scoring,
       round(sum(m.formula_usd)::numeric, 3) formula
from public.pm_lp_minutes m join t using (cond)
where m.mode = 'live' and m.minute >= '2026-10-10 13:00'
group by 1 order by 1;
-- 2. The day's refills (events) and 0x3090f7aa's settlement.
select minute, left(detail->>'for', 10) "for", left(detail->>'took', 10) took from public.pm_lp_events where kind = 'refill' and minute >= '2026-10-10' order by minute;
select left(cond, 10), payout, settled_at from public.pm_lp_settlements where settled_at >= '2026-10-10';
-- 3. 0x3090f7aa's confirmed fills at its payout: cash plus what is left of each token at the payout (rewards not counted).
with f as (select f.token, f.side, f.price::numeric p, f.size::numeric s from public.pm_lp_fills f where f.status = 'CONFIRMED' and f.cond like '0x3090f7aa%'),
     st as (select yes_token, no_token, payout::numeric payout from public.pm_lp_settlements where cond like '0x3090f7aa%')
select count(*) fills,
       round(sum(case when side = 'BUY' then -p * s else p * s end), 4) cash,
       round(sum(case when side = 'BUY' then s else -s end) filter (where token = (select yes_token from st)), 4) yes_net,
       round(sum(case when side = 'BUY' then s else -s end) filter (where token = (select no_token from st)), 4) no_net,
       round(sum(case when side = 'BUY' then -p * s else p * s end)
             + coalesce(sum(case when side = 'BUY' then s else -s end) filter (where token = (select yes_token from st)), 0) * (select payout from st)
             + coalesce(sum(case when side = 'BUY' then s else -s end) filter (where token = (select no_token from st)), 0) * (1 - (select payout from st)), 4) final
from f;
