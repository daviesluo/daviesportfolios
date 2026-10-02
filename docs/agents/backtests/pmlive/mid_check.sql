-- Mid-pool's day-1 check: docs/agents/reviews/2026-10-02-polymarket-mid-pool-prereg.md, conditions (a)–(g), one row each
-- with what was measured, the bar and PASS or FAIL, (f) printed as not applicable. It asks of mid-pool's tables
-- (`pm_mid_*`, `pm_midprep_*`, 0081) what small-pool's `prep_check_addendum2.sql` asks of its own, with mid-pool's band
-- ($10 to under $50) and its exclusion's count in (b2), and its window: d1, the first full UTC day after 0081 made its
-- config row (`pm_mid_config.created_at`). Read-only: it selects and changes nothing, and it reads no table of small-pool's,
-- RW's or RW-C's. Run it once, at or after d1 + 1 day 00:10 UTC, as one statement (the Supabase SQL connector's
-- execute_sql, or psql); run earlier, its first row reads FAIL.
with
w as (
  select x.w0, x.w0 + interval '1 day' as w1, (x.w0 at time zone 'utc')::date as d
    from (select (date_trunc('day', c.created_at at time zone 'utc') + interval '1 day') at time zone 'utc' as w0
            from public.pm_mid_config c where c.id = 1) x),
cfg as (select c.* from public.pm_mid_config c where c.id = 1),

-- (a) the path's turn ran: a minute of its record, and the faults of the path and of its paper layer, by minute.
a_turns as (
  select count(distinct m.minute) as n from public.pm_mid_minutes m, w
   where m.mode = 'dry_run' and m.minute >= w.w0 and m.minute < w.w1),
a_faults as (
  select count(distinct date_trunc('minute', e.created_at)) as n from public.ops_errors e, w
   where e.created_at >= w.w0 and e.created_at < w.w1
     and (e.kind in ('agents.pm_mid', 'agents.pm_midprep') or (e.kind = 'agents.crash' and e.context->>'action' in ('pmmid', 'pmmidprep')))),
a_prep as (
  select (select s.last_minute from public.pm_midprep_state s where s.id = 1) as last_minute,
         (select count(*) from public.pm_midprep_days p, w where p.day = w.d) as day_rows),

-- (b) the day's selection, and its exclusion's count (the selection event of d1's first selection; no market named).
b as (
  select count(*) as n, count(distinct m.selected_at) as runs, min(m.selected_at) as first_at, coalesce(sum(m.capital), 0) as capital,
         count(*) filter (where not (m.reward_rate >= 10 and m.reward_rate < 50)) as bad_rate,
         count(*) filter (where m.n_size is distinct from greatest(m.min_size, 5) or greatest(m.min_size, 5) > 20) as bad_n,
         count(*) filter (where (m.end_date is not null and m.end_date < m.selected_at + interval '48 hours')
                             or (m.game_start is not null and m.game_start < m.selected_at + interval '48 hours')) as bad_horizon,
         count(*) filter (where m.max_spread is null or m.max_spread <= 0) as bad_spread,
         count(*) filter (where m.formula_day is null or m.formula_day < 2.5) as bad_formula
    from public.pm_mid_markets m, w where m.day = w.d),
b_ex as (
  select (select e.detail->'exclusion' from public.pm_mid_events e, w, b
           where e.mode = 'dry_run' and e.kind = 'selection' and e.minute = date_trunc('minute', b.first_at)) as ex),

-- (c) every order the path would have sent in the window.
o as (select o.* from public.pm_mid_orders o, w where o.mode = 'dry_run' and o.ts >= w.w0 and o.ts < w.w1),
c_post as (
  select count(*) as n,
         count(*) filter (where o.book_seen->>'bestBid' is null or o.book_seen->>'bestAsk' is null
            or (o.side = 'BUY'  and o.outcome = 'yes' and o.price >= (o.book_seen->>'bestAsk')::numeric)
            or (o.side = 'BUY'  and o.outcome = 'no'  and o.price >= 1 - (o.book_seen->>'bestBid')::numeric)
            or (o.side = 'SELL' and o.outcome = 'yes' and o.price <= (o.book_seen->>'bestBid')::numeric)
            or (o.side = 'SELL' and o.outcome = 'no'  and o.price <= 1 - (o.book_seen->>'bestAsk')::numeric)) as crossing
    from o),
c_size as (
  select count(*) as bad from o left join public.pm_mid_markets m on m.cond = o.cond and m.day = (o.ts at time zone 'utc')::date
   where m.cond is null or o.size < greatest(m.min_size, 5) or o.size < coalesce((o.book_seen->>'minSize')::numeric, 0)),
c_caps as (
  select coalesce(max(t.per_market), 0) as worst_market, coalesce(max(t.total), 0) as worst_total from (
    select (select coalesce(sum(y.price * y.size), 0) from public.pm_mid_orders y
             where y.mode = 'dry_run' and y.side = 'BUY' and y.cond = x.cond and y.ts <= x.ts and (y.cancelled_at is null or y.cancelled_at > x.ts)) as per_market,
           (select coalesce(sum(y.price * y.size), 0) from public.pm_mid_orders y
             where y.mode = 'dry_run' and y.side = 'BUY' and y.ts <= x.ts and (y.cancelled_at is null or y.cancelled_at > x.ts)) as total
      from o x where x.side = 'BUY') t),

-- (d) the formula: the path's own minute record of the quotes that rested.
d as (
  select count(*) as rows, count(*) filter (where m.formula_usd > 0) as scored from public.pm_mid_minutes m, w
   where m.mode = 'dry_run' and m.minute >= w.w0 and m.minute < w.w1),

-- (e) the paper day, closed by its layer; and every paper loss stop in the window.
e as (
  select (select count(*) from public.pm_midprep_days p, w where p.day = w.d) as rows,
         (select p.pnl_day_r40 from public.pm_midprep_days p, w where p.day = w.d) as pnl_day_r40,
         (select p.fills_pnl_day from public.pm_midprep_days p, w where p.day = w.d) as fills_pnl_day,
         (select p.reward from public.pm_midprep_days p, w where p.day = w.d) as reward,
         (select p.minutes_matched from public.pm_midprep_days p, w where p.day = w.d) as matched,
         (select coalesce(p.stop_day, false) or coalesce(p.stop_total, false) from public.pm_midprep_days p, w where p.day = w.d) as stop_flag,
         (select count(*) from public.pm_midprep_events v, w where v.kind in ('loss_stop_day', 'loss_stop_total') and v.minute >= w.w0 and v.minute < w.w1) as stops),

-- (g) the paper layer's own validity: the path rested RW's quote whenever it rested anything.
g as (
  select coalesce(sum(p.minutes_matched + p.minutes_dark + p.minutes_diverged), 0) as decided, coalesce(sum(p.minutes_diverged), 0) as diverged
    from public.pm_midprep_days p, w where p.day = w.d)

select 'w the window: d1, the first full UTC day after pm_mid_config.created_at' as condition,
       coalesce(w.d::text || ' (' || w.w0::text || ' -> ' || w.w1::text || ')', 'no pm_mid_config row') as measured,
       'the check runs at or after d1 + 1 day 00:10 UTC' as bar,
       case when now() >= w.w1 + interval '10 minutes' then 'PASS' else 'FAIL' end as verdict from (select 1) one left join w on true
union all
select 'a1 turns: minutes with a row of the path''s record', a_turns.n::text, '>= 1426 of 1440 (99 %)',
       case when a_turns.n >= 1426 then 'PASS' else 'FAIL' end from a_turns
union all
select 'a2 faults: minutes with an agents.pm_mid / agents.pm_midprep / their crash row', a_faults.n::text, '<= 14 (1 %)',
       case when a_faults.n <= 14 then 'PASS' else 'FAIL' end from a_faults
union all
select 'a3 the paper layer decided the window and closed its day', coalesce(a_prep.last_minute::text, 'none') || '; day rows ' || a_prep.day_rows, 'last_minute >= d1 23:59; 1 day row',
       case when a_prep.last_minute >= (select w0 + interval '1439 minutes' from w) and a_prep.day_rows = 1 then 'PASS' else 'FAIL' end from a_prep
union all
select 'b1 selection: once, by 00:10 UTC', b.n || ' markets, ' || b.runs || ' run(s), first at ' || coalesce(b.first_at::text, 'none'), '>= 1 market, 1 run, by 00:10',
       case when b.n >= 1 and b.runs = 1 and b.first_at < (select w0 + interval '10 minutes' from w) then 'PASS' else 'FAIL' end from b
union all
select 'b2 every market inside the rules (rate [10,50), N = max(min,5) <= 20, 48 h horizon, a reward spread, formula >= 2.50/day), and RW''s exclusion recorded as a count',
       'rate ' || b.bad_rate || ', N ' || b.bad_n || ', horizon ' || b.bad_horizon || ', spread ' || b.bad_spread || ', formula ' || b.bad_formula || ' outside; exclusion '
         || coalesce((select jsonb_build_object('rule', b_ex.ex->'rule', 'margin', b_ex.ex->'margin', 'excluded', b_ex.ex->'excluded')::text from b_ex where b_ex.ex is not null), 'not recorded'),
       'all 0; rule RW, margin 0.67, excluded a count',
       case when b.n >= 1 and b.bad_rate + b.bad_n + b.bad_horizon + b.bad_spread + b.bad_formula = 0
             and (select b_ex.ex->>'rule' = 'RW' and (b_ex.ex->>'margin')::numeric = 0.67 and jsonb_typeof(b_ex.ex->'excluded') = 'number' from b_ex)
            then 'PASS' else 'FAIL' end from b
union all
select 'b3 size: count <= max_markets, first-quote capital <= select_budget_usd', b.n || ' markets, $' || round(b.capital, 2), '<= ' || cfg.max_markets || ' and <= $' || cfg.select_budget_usd,
       case when b.n <= cfg.max_markets and b.capital <= cfg.select_budget_usd + 1e-9 then 'PASS' else 'FAIL' end from b, cfg
union all
select 'c1 post-only: no would-be order crosses the book it was decided on', c_post.crossing || ' of ' || c_post.n, '0 crossing, >= 1 order',
       case when c_post.n >= 1 and c_post.crossing = 0 then 'PASS' else 'FAIL' end from c_post
union all
select 'c2 size: every order >= the market''s reward minimum (N) and the venue''s minimum', c_size.bad::text, '0',
       case when c_size.bad = 0 then 'PASS' else 'FAIL' end from c_size
union all
select 'c3 caps: resting buys'' collateral at each order''s placement', 'market $' || round(c_caps.worst_market, 2) || ', total $' || round(c_caps.worst_total, 2),
       '<= cap_market_usd $' || cfg.cap_market_usd || ', <= cap_total_usd $' || cfg.cap_total_usd,
       case when c_caps.worst_market <= cfg.cap_market_usd + 1e-9 and c_caps.worst_total <= cfg.cap_total_usd + 1e-9 then 'PASS' else 'FAIL' end from c_caps, cfg
union all
select 'd formula: market-minutes of the path''s record with formula_usd > 0', d.scored || ' of ' || d.rows || coalesce(' (' || round(100.0 * d.scored / nullif(d.rows, 0), 1) || ' %)', ''),
       '>= 75 %', case when d.rows > 0 and d.scored >= 0.75 * d.rows then 'PASS' else 'FAIL' end from d
union all
select 'e paper day: fills P&L + rewards at R = 0.40 above the -$25 day stop; no paper loss stop',
       coalesce('$' || round(e.pnl_day_r40, 4) || ' (fills $' || round(e.fills_pnl_day, 4) || ', formula $' || round(e.reward, 4) || ', matched ' || e.matched || '); stops ' || e.stops, 'no day row'),
       '> -25, 0 stops, a day row with matched minutes',
       case when e.rows = 1 and e.pnl_day_r40 > -25 and e.stops = 0 and not e.stop_flag and e.matched > 0 then 'PASS' else 'FAIL' end from e
union all
select 'g paper validity: diverged market-minutes', g.diverged || ' of ' || g.decided, '<= 2 % of decided',
       case when g.decided > 0 and g.diverged <= 0.02 * g.decided then 'PASS' else 'FAIL' end from g
union all
select 'f not applicable: mid-pool cannot go live (0081 holds its config in dry-run)',
       'dry_run ' || coalesce(cfg.dry_run::text, '?') || ', live_confirmed_at ' || coalesce(cfg.live_confirmed_at::text, 'null'), 'n/a', 'N/A' from cfg;
