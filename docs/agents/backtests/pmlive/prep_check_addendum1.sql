-- The live-prep check on Addendum 1's window: docs/agents/reviews/2026-10-01-polymarket-live-prep-prereg.md, conditions
-- (a)–(g), one row each with what was measured, the bar and PASS or FAIL. Davies moved the window on 2026-10-01 ("改为现在
-- 就开始测试，可以测试今天剩余时间+明天一整天"): it opens on the first full UTC hour after 2026-10-01's selection by RW's
-- ranking (the first `selected_at` of that day's rows with a reward rate) and closes at 2026-10-03 00:00 UTC, over two
-- UTC days. Each bar is the frozen check's (prep_check.sql): a bar that counts minutes is the same share of this window's
-- minutes (99 % turns, 1 % fault minutes), a bar that reads a day reads each of the two days, and a bar over the
-- window's records reads the window. Read-only: it selects and changes nothing. Run it once, at or after 2026-10-03
-- 00:10 UTC, as one statement. The window is the addendum's and is not a parameter.
with
w as (select date_trunc('hour', s.at at time zone 'utc') at time zone 'utc' + interval '1 hour' as w0, timestamptz '2026-10-03 00:00:00+00' as w1
        from (select min(m.selected_at) as at from public.pm_live_markets m where m.day = date '2026-10-01' and m.reward_rate is not null) s),
wm as (select (extract(epoch from (w.w1 - w.w0)) / 60)::integer as minutes from w),
days as (select x.d, x.by_at from (values
  (date '2026-10-01', (select w0 from w)),                        -- today's selection: before the window opens
  (date '2026-10-02', timestamptz '2026-10-02 00:10:00+00')       -- tomorrow's: by 00:10, as the frozen check
) as x(d, by_at)),
cfg as (select c.* from public.pm_live_config c where c.id = 1),

-- (a) the order path's turn ran: a minute of its record, and the faults of the path and of this layer, by minute.
a_turns as (
  select count(distinct m.minute) as n from public.pm_live_minutes m, w
   where m.mode = 'dry_run' and m.minute >= w.w0 and m.minute < w.w1),
a_faults as (
  select count(distinct date_trunc('minute', e.created_at)) as n from public.ops_errors e, w
   where e.created_at >= w.w0 and e.created_at < w.w1
     and (e.kind in ('agents.pm_live', 'agents.pm_prep') or (e.kind = 'agents.crash' and e.context->>'action' in ('pmlive', 'pmprep')))),
a_prep as (
  select (select s.last_minute from public.pm_prep_state s where s.id = 1) as last_minute,
         (select count(*) from public.pm_prep_days p where p.day in (select d from days)) as day_rows),

-- (b) each day's selection.
b as (
  select dd.d, dd.by_at,
         count(m.cond) as n, count(distinct m.selected_at) as runs, min(m.selected_at) as first_at, coalesce(sum(m.capital), 0) as capital,
         count(m.cond) filter (where not (m.reward_rate >= 6 and m.reward_rate < 10)) as bad_rate,
         count(m.cond) filter (where m.n_size is distinct from greatest(m.min_size, 5) or greatest(m.min_size, 5) > 20) as bad_n,
         count(m.cond) filter (where (m.end_date is not null and m.end_date < m.selected_at + interval '48 hours')
                                  or (m.game_start is not null and m.game_start < m.selected_at + interval '48 hours')) as bad_horizon,
         count(m.cond) filter (where m.max_spread is null or m.max_spread <= 0) as bad_spread,
         count(m.cond) filter (where m.formula_day is null or m.formula_day < 2.5) as bad_formula
    from days dd left join public.pm_live_markets m on m.day = dd.d
   group by dd.d, dd.by_at),

-- (c) every order the path would have sent in the window.
o as (select o.* from public.pm_live_orders o, w where o.mode = 'dry_run' and o.ts >= w.w0 and o.ts < w.w1),
c_post as (
  select count(*) as n,
         count(*) filter (where o.book_seen->>'bestBid' is null or o.book_seen->>'bestAsk' is null
            or (o.side = 'BUY'  and o.outcome = 'yes' and o.price >= (o.book_seen->>'bestAsk')::numeric)
            or (o.side = 'BUY'  and o.outcome = 'no'  and o.price >= 1 - (o.book_seen->>'bestBid')::numeric)
            or (o.side = 'SELL' and o.outcome = 'yes' and o.price <= (o.book_seen->>'bestBid')::numeric)
            or (o.side = 'SELL' and o.outcome = 'no'  and o.price <= 1 - (o.book_seen->>'bestAsk')::numeric)) as crossing
    from o),
c_size as (
  select count(*) as bad from o left join public.pm_live_markets m on m.cond = o.cond and m.day = (o.ts at time zone 'utc')::date
   where m.cond is null or o.size < greatest(m.min_size, 5) or o.size < coalesce((o.book_seen->>'minSize')::numeric, 0)),
c_caps as (
  select coalesce(max(t.per_market), 0) as worst_market, coalesce(max(t.total), 0) as worst_total from (
    select (select coalesce(sum(y.price * y.size), 0) from public.pm_live_orders y
             where y.mode = 'dry_run' and y.side = 'BUY' and y.cond = x.cond and y.ts <= x.ts and (y.cancelled_at is null or y.cancelled_at > x.ts)) as per_market,
           (select coalesce(sum(y.price * y.size), 0) from public.pm_live_orders y
             where y.mode = 'dry_run' and y.side = 'BUY' and y.ts <= x.ts and (y.cancelled_at is null or y.cancelled_at > x.ts)) as total
      from o x where x.side = 'BUY') t),

-- (d) the formula: the path's own minute record of the quotes that rested.
d as (
  select count(*) as rows, count(*) filter (where m.formula_usd > 0) as scored from public.pm_live_minutes m, w
   where m.mode = 'dry_run' and m.minute >= w.w0 and m.minute < w.w1),

-- (e) each paper day, closed by this layer; and every paper loss stop in the window. A day row covers its whole UTC
-- day, so 2026-10-01's carries any stop or loss from before the window opens too.
e_days as (
  select dd.d, p.day, p.pnl_day_r40, p.fills_pnl_day, p.reward, p.minutes_matched,
         coalesce(p.stop_day, false) or coalesce(p.stop_total, false) as stop_flag
    from days dd left join public.pm_prep_days p on p.day = dd.d),
e as (
  select count(e_days.day) as rows, min(e_days.pnl_day_r40) as worst, coalesce(min(e_days.minutes_matched), 0) as matched,
         coalesce(bool_or(e_days.stop_flag), false) as stop_flag,
         string_agg(e_days.d || ' ' || coalesce('$' || round(e_days.pnl_day_r40, 4) || ' (fills $' || round(e_days.fills_pnl_day, 4)
           || ', formula $' || round(e_days.reward, 4) || ', matched ' || e_days.minutes_matched || ')', 'no day row'), '; ' order by e_days.d) as text,
         (select count(*) from public.pm_prep_events v, w where v.kind in ('loss_stop_day', 'loss_stop_total') and v.minute >= w.w0 and v.minute < w.w1) as stops
    from e_days),

-- (g) the paper layer's own validity in the window: the path rested RW's quote whenever it rested anything.
g as (
  select count(*) filter (where p.class in ('matched', 'dark', 'diverged')) as decided, count(*) filter (where p.class = 'diverged') as diverged
    from public.pm_prep_minutes p, w where p.minute >= w.w0 and p.minute < w.w1),

-- (f) the gates and the account, now (read at go time).
f as (select s.state as st, s.updated_at from public.pm_live_state s where s.id = 1)

select 'a1 turns: minutes with a row of the path''s record' as condition, a_turns.n::text as measured,
       '>= ' || ceil(0.99 * wm.minutes) || ' of ' || wm.minutes || ' (99 %)' as bar,
       case when a_turns.n >= ceil(0.99 * wm.minutes) then 'PASS' else 'FAIL' end as verdict from a_turns, wm
union all
select 'a2 faults: minutes with an agents.pm_live / agents.pm_prep / their crash row', a_faults.n::text, '<= ' || floor(0.01 * wm.minutes) || ' (1 %)',
       case when a_faults.n <= floor(0.01 * wm.minutes) then 'PASS' else 'FAIL' end from a_faults, wm
union all
select 'a3 the paper layer decided the window and closed both days', coalesce(a_prep.last_minute::text, 'none') || '; day rows ' || a_prep.day_rows,
       'last_minute >= 2026-10-02 23:59; 2 day rows',
       case when a_prep.last_minute >= timestamptz '2026-10-02 23:59:00+00' and a_prep.day_rows = 2 then 'PASS' else 'FAIL' end from a_prep
union all
select 'b1 selection: each day once, with a market, in time',
       string_agg(b.d || ': ' || b.n || ' markets, ' || b.runs || ' run(s), first at ' || coalesce(b.first_at::text, 'none'), '; ' order by b.d),
       '>= 1 market, 1 run; 2026-10-01''s before the window opens, 2026-10-02''s by 00:10',
       case when bool_and(b.n >= 1 and b.runs = 1 and b.first_at < b.by_at) then 'PASS' else 'FAIL' end from b
union all
select 'b2 every market inside the rules (rate [6,10), N = max(min,5) <= 20, 48 h horizon, a reward spread, formula >= 2.50/day)',
       'rate ' || sum(b.bad_rate) || ', N ' || sum(b.bad_n) || ', horizon ' || sum(b.bad_horizon) || ', spread ' || sum(b.bad_spread) || ', formula ' || sum(b.bad_formula) || ' outside',
       'all 0',
       case when bool_and(b.n >= 1) and sum(b.bad_rate + b.bad_n + b.bad_horizon + b.bad_spread + b.bad_formula) = 0 then 'PASS' else 'FAIL' end from b
union all
select 'b3 phase 1, each day: count <= max_markets, first-quote capital <= select_budget_usd',
       string_agg(b.d || ': ' || b.n || ' markets, $' || round(b.capital, 2), '; ' order by b.d), '<= ' || min(cfg.max_markets) || ' and <= $' || min(cfg.select_budget_usd),
       case when bool_and(b.n <= cfg.max_markets and b.capital <= cfg.select_budget_usd + 1e-9) then 'PASS' else 'FAIL' end from b, cfg
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
select 'e paper days: each day''s fills P&L + rewards at R = 0.40 above the -$25 day stop; no paper loss stop',
       coalesce(e.text, 'no day row') || '; stops ' || e.stops, '> -25 each day, 0 stops, a day row with matched minutes each day',
       case when e.rows = 2 and e.worst > -25 and e.stops = 0 and not e.stop_flag and e.matched > 0 then 'PASS' else 'FAIL' end from e
union all
select 'g paper validity: diverged market-minutes in the window', g.diverged || ' of ' || g.decided, '<= 2 % of decided',
       case when g.decided > 0 and g.diverged <= 0.02 * g.decided then 'PASS' else 'FAIL' end from g
union all
select 'f gates and account now (read at go time)',
       'region ' || coalesce(f.st->>'sbRegion', '?') || ', gates ' || coalesce((f.st->'gates')::text, '?') || ', keyed ' || coalesce(f.st->>'keyed', '?')
         || ', pusd ' || coalesce(f.st->>'pusd', '?') || ' at ' || coalesce(f.st->>'at', '?'),
       'eu-west-1; region, geoblock, attestation, closed_only true; keyed true; pusd >= 81 read within 5 minutes',
       case when f.st->>'sbRegion' = 'eu-west-1'
             and (f.st->'gates'->>'region') = 'true' and (f.st->'gates'->>'geoblock') = 'true'
             and (f.st->'gates'->>'attestation') = 'true' and (f.st->'gates'->>'closed_only') = 'true'
             and (f.st->>'keyed') = 'true'
             and (f.st->>'pusd')::numeric >= 81 and (f.st->>'at')::timestamptz >= now() - interval '5 minutes'
            then 'PASS' else 'FAIL' end from f;
