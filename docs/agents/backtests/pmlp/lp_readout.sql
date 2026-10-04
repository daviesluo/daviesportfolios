-- Live-prep's live readout: docs/agents/reviews/2026-10-04-polymarket-lp-prereg.md, "Live: what is read, and what ends
-- it". One row per live UTC day of its readout (`pm_lp_reward_days`, mode live, from the day of its first live order),
-- then the totals: what Polymarket paid (native, sponsored) against the formula of its own minutes, R = paid ÷ formula,
-- the maker rebates; the fills (CONFIRMED) and the path's own P&L of them (`pm_lp_state.state.pnl.total`) per filled
-- share against the paper record's −$0.0110; and the 7-day rule's reading (R after 7 live days with at least 40
-- market-days). Read-only: it selects and changes nothing, and reads no table but live-prep's. Run it at 7 live days
-- (the end rule) and at 14 (the readout); R's 90 % interval is the pre-registration's day-block bootstrap on these days'
-- rows. Until the first live order it returns its total row alone, with nothing in it.
with
live0 as (select min(o.ts) as first_live from public.pm_lp_orders o where o.mode = 'live'),
days as (
  select r.day, count(*) as market_days, sum(r.minutes) as minutes, sum(r.minutes_scored) as scored,
         sum(r.formula_usd) as formula, sum(r.formula_scored_usd) as formula_scored,
         sum(coalesce(r.actual_usd, 0)) as native, sum(coalesce(r.actual_sponsored_usd, 0)) as sponsored, sum(coalesce(r.rebate_usd, 0)) as rebates
    from public.pm_lp_reward_days r, live0
   where r.mode = 'live' and live0.first_live is not null and r.day >= (live0.first_live at time zone 'utc')::date
   group by r.day),
numbered as (select d.*, row_number() over (order by d.day) as n from days d),
fills as (
  select count(*) as fills, coalesce(sum(f.size), 0) as shares from public.pm_lp_fills f where f.status = 'CONFIRMED'),
pnl as (select (s.state->'pnl'->>'total')::numeric as fills_pnl from public.pm_lp_state s where s.id = 1)

select 'day ' || n.n || ' ' || n.day::text as row, n.market_days, n.minutes, n.scored,
       round(n.formula, 4) as formula_usd, round(n.native + n.sponsored, 4) as paid_usd, round(n.rebates, 4) as rebates_usd,
       round((n.native + n.sponsored) / nullif(n.formula, 0), 4) as r
  from numbered n
union all
select 'R after the first 7 live days (the end rule: stop when < 0.20 with >= 40 market-days)', sum(n.market_days), sum(n.minutes), sum(n.scored),
       round(sum(n.formula), 4), round(sum(n.native + n.sponsored), 4), round(sum(n.rebates), 4),
       round(sum(n.native + n.sponsored) / nullif(sum(n.formula), 0), 4)
  from numbered n where n.n <= 7
union all
select 'total over ' || (select count(*) from days) || ' live days; fills ' || f.fills || ' (' || round(f.shares, 2) || ' shares), their P&L $'
         || coalesce(round(p.fills_pnl, 4)::text, '?') || ', per share $' || coalesce(round(p.fills_pnl / nullif(f.shares, 0), 4)::text, '?') || ' (paper record: -0.0110)',
       (select sum(market_days) from days), (select sum(minutes) from days), (select sum(scored) from days),
       round((select sum(formula) from days), 4), round((select sum(native + sponsored) from days), 4), round((select sum(rebates) from days), 4),
       round((select sum(native + sponsored) from days) / nullif((select sum(formula) from days), 0), 4)
  from fills f left join pnl p on true;
