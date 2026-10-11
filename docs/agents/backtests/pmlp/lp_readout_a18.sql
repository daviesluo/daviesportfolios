-- Live-prep's live readout, Addendum 18's corrected copy of lp_readout.sql (docs/agents/reviews/2026-10-04-polymarket-lp-prereg.md,
-- "Live: what is read, and what ends it", and its Addendum 18). The frozen script stays as it is; this copy is what the
-- 7-day end rule (R < 0.20 with >= 40 market-days, read on or after 2026-10-16 01:00 UTC) and the 14-day readout read.
-- One change, LP-OBS-DEEP's defect 1 (docs/agents/reviews/2026-10-11-lp-observations-deep.md): 2026-10-09 enters the
-- formula at its like-for-like figure, market by market, $8.081876 in all (Addendum 10's, backtests/lpcfg/results/rtrue.txt,
-- the table `LP_R_DAY_CORRECTIONS` in pm_lp_live_view.ts), not the $153.90 its readout row priced at the 00:00 selection's
-- programmes, which Polymarket had cut. Every other day stands as read, on the whole formula (`formula_usd`): R = paid ÷
-- formula, as the pre-registration wrote it. Each row also reports the scored formula (10-09 the same like-for-like
-- figure) and R over it, beside. Read-only: it selects and changes nothing, and reads no table but live-prep's. Until the
-- first live order it returns its total row alone, with nothing in it.
with
live0 as (select min(o.ts) as first_live from public.pm_lp_orders o where o.mode = 'live'),
corr as (select c.cond, c.formula from (values
                ('0x045fdf4be2f890a3f846357a5160834685bb7dfae65909d3d307e5547898e1ad', 0.879838),
                ('0x5b3350e20f05e072422dbb35a02cc87a7c83c63052794a9d91a3c25c8c1f5dd0', 0.314623),
                ('0x5fec667514efa90a507dc672f18706a38eff7643cb80e77be606219da1fa2ad0', 1.884818),
                ('0x9235351ee3dd6313185e3b7d75730d3be90cf8c736985fa03ebb69cece650522', 1.973267),
                ('0xa326c49fad38dd03d04d67c5acb334f4fb851a88784153b5e55bec1a5d75e96b', 0.968556),
                ('0xecc209a690169d2ccf22be5db33e42bec5ff01930e9773d2ccc1ab0ed81e6301', 0.346739),
                ('0xeee7384867f13b7aa044eb5c52cb52cf193e4f520aa1349b7f3f63a98857eb87', 0.897922),
                ('0xf050353934ca8adbf3a2706a763afd2190c27f2e067daf28d5ccb060894ca337', 0.0),
                ('0xf6f3f159e6d96c5f875705c1257b02b87711fa7c08edac71a73e7dbbea984978', 0.65654),
                ('0xfbd3437ca9a83c2d96f09df6a9278451a175dc7ed155cc6ac890064410df74c4', 0.159572)
              ) as c(cond, formula)),
days as (
  select r.day, count(*) as market_days, sum(r.minutes) as minutes, sum(r.minutes_scored) as scored,
         sum(case when r.day = date '2026-10-09' then coalesce(k.formula, r.formula_usd) else r.formula_usd end) as formula,
         sum(case when r.day = date '2026-10-09' then coalesce(k.formula, r.formula_scored_usd) else r.formula_scored_usd end) as formula_scored,
         sum(coalesce(r.actual_usd, 0)) as native, sum(coalesce(r.actual_sponsored_usd, 0)) as sponsored, sum(coalesce(r.rebate_usd, 0)) as rebates
    from public.pm_lp_reward_days r cross join live0 left join corr k on k.cond = r.cond
   where r.mode = 'live' and live0.first_live is not null and r.day >= (live0.first_live at time zone 'utc')::date
   group by r.day),
numbered as (select d.*, row_number() over (order by d.day) as n from days d),
fills as (
  select count(*) as fills, coalesce(sum(f.size), 0) as shares from public.pm_lp_fills f where f.status = 'CONFIRMED'),
pnl as (select (s.state->'pnl'->>'total')::numeric as fills_pnl from public.pm_lp_state s where s.id = 1)

select 'day ' || n.n || ' ' || n.day::text as row, n.market_days, n.minutes, n.scored,
       round(n.formula, 4) as formula_usd, round(n.native + n.sponsored, 4) as paid_usd, round(n.rebates, 4) as rebates_usd,
       round((n.native + n.sponsored) / nullif(n.formula, 0), 4) as r,
       round(n.formula_scored, 4) as formula_scored_usd, round((n.native + n.sponsored) / nullif(n.formula_scored, 0), 4) as r_scored
  from numbered n
union all
select 'R after the first 7 live days (the end rule: stop when < 0.20 with >= 40 market-days; 10-09 like for like, Addendum 18)',
       sum(n.market_days), sum(n.minutes), sum(n.scored),
       round(sum(n.formula), 4), round(sum(n.native + n.sponsored), 4), round(sum(n.rebates), 4),
       round(sum(n.native + n.sponsored) / nullif(sum(n.formula), 0), 4),
       round(sum(n.formula_scored), 4), round(sum(n.native + n.sponsored) / nullif(sum(n.formula_scored), 0), 4)
  from numbered n where n.n <= 7
union all
select 'total over ' || (select count(*) from days) || ' live days; fills ' || f.fills || ' (' || round(f.shares, 2) || ' shares), their P&L $'
         || coalesce(round(p.fills_pnl, 4)::text, '?') || ', per share $' || coalesce(round(p.fills_pnl / nullif(f.shares, 0), 4)::text, '?') || ' (paper record: -0.0110)',
       (select sum(market_days) from days), (select sum(minutes) from days), (select sum(scored) from days),
       round((select sum(formula) from days), 4), round((select sum(native + sponsored) from days), 4), round((select sum(rebates) from days), 4),
       round((select sum(native + sponsored) from days) / nullif((select sum(formula) from days), 0), 4),
       round((select sum(formula_scored) from days), 4),
       round((select sum(native + sponsored) from days) / nullif((select sum(formula_scored) from days), 0), 4)
  from fills f left join pnl p on true;
