-- Live-prep's day-1 check: docs/agents/reviews/2026-10-04-polymarket-lp-prereg.md, conditions (a)–(g), one row each
-- with what was measured, the bar and PASS or FAIL. It asks of live-prep's tables (`pm_lp_*`, `pm_lpprep_*`, 0091) what
-- its pre-registration words, over its window: d1, the first full UTC day after 0091 made its config row
-- (`pm_lp_config.created_at`). Read-only: it selects and changes nothing, and it reads no table of mini-pool's,
-- mid-pool's, RW's or RW-C's but the two configs' arms in (f). Run it once, at or after d1 + 1 day 00:10 UTC, as one
-- statement (the Supabase SQL connector's execute_sql, or psql); run earlier, its first row reads FAIL.
with
w as (
  select x.w0, x.w0 + interval '1 day' as w1, (x.w0 at time zone 'utc')::date as d
    from (select (date_trunc('day', c.created_at at time zone 'utc') + interval '1 day') at time zone 'utc' as w0
            from public.pm_lp_config c where c.id = 1) x),
cfg as (select c.* from public.pm_lp_config c where c.id = 1),

-- (a) the path's turn ran: a minute of its record, and the faults of the path and of its paper layer, by minute.
a_turns as (
  select count(distinct m.minute) as n from public.pm_lp_minutes m, w
   where m.mode = 'dry_run' and m.minute >= w.w0 and m.minute < w.w1),
a_faults as (
  select count(distinct date_trunc('minute', e.created_at)) as n from public.ops_errors e, w
   where e.created_at >= w.w0 and e.created_at < w.w1
     and (e.kind in ('agents.pm_lp', 'agents.pm_lpprep') or (e.kind = 'agents.crash' and e.context->>'action' in ('pmlp', 'pmlpprep')))),
a_prep as (
  select (select s.last_minute from public.pm_lpprep_state s where s.id = 1) as last_minute,
         (select count(*) from public.pm_lpprep_days p, w where p.day = w.d) as day_rows),

-- (b) the day's selection.
b as (
  select count(*) as n, count(distinct m.selected_at) as runs, min(m.selected_at) as first_at, coalesce(sum(m.capital), 0) as capital,
         count(*) filter (where not (m.reward_rate >= 10)) as bad_rate,
         count(*) filter (where m.n_size is distinct from greatest(m.min_size, 5) or greatest(m.min_size, 5) > 20) as bad_n,
         count(*) filter (where (m.end_date is not null and m.end_date < w.w1)
                             or (m.game_start is not null and m.game_start < m.selected_at + interval '48 hours')) as bad_horizon,
         count(*) filter (where m.max_spread is null or m.max_spread <= 0) as bad_spread,
         count(*) filter (where m.formula_day is null or m.formula_day < 2.5) as bad_formula
    from public.pm_lp_markets m, w where m.day = w.d),

-- (c) every order the path would have sent in the window, beside the minute of the turn that placed it (its signed
-- timestamp) and what that minute records of the decision (`detail.lp`: its state, the holdings it decided on, the caps'
-- count after the turn), and the market's N from its latest selection on or before that day.
o as (
  select o.*, date_trunc('minute', to_timestamp((o.request->>'timestamp')::numeric / 1000)) as placed,
         (select m.n_size from public.pm_lp_markets m where m.cond = o.cond and m.day <= (o.ts at time zone 'utc')::date order by m.day desc limit 1) as n
    from public.pm_lp_orders o, w where o.mode = 'dry_run' and o.ts >= w.w0 and o.ts < w.w1),
od as (
  select o.*, mm.detail->'lp' as lp from o
    left join public.pm_lp_minutes mm on mm.mode = 'dry_run' and mm.cond = o.cond and mm.minute = o.placed),
c_post as (
  select count(*) as n,
         count(*) filter (where o.book_seen->>'bestBid' is null or o.book_seen->>'bestAsk' is null or not o.post_only
            or (o.side = 'BUY'  and o.outcome = 'yes' and o.price >= (o.book_seen->>'bestAsk')::numeric)
            or (o.side = 'BUY'  and o.outcome = 'no'  and o.price >= 1 - (o.book_seen->>'bestBid')::numeric)
            or (o.side = 'SELL' and o.outcome = 'yes' and o.price <= (o.book_seen->>'bestBid')::numeric)
            or (o.side = 'SELL' and o.outcome = 'no'  and o.price <= 1 - (o.book_seen->>'bestAsk')::numeric)) as crossing
    from o),
c_size as (
  select count(*) filter (where o.n is null) as no_market,
         count(*) filter (where o.side = 'BUY' and o.size <> o.n) as bad_buy,
         count(*) filter (where o.side = 'SELL' and (o.size > o.n or o.size < coalesce((o.book_seen->>'minSize')::numeric, 0))) as bad_sell,
         count(*) filter (where o.size < coalesce((o.book_seen->>'minSize')::numeric, 0)) as under_venue
    from o),
c_rest as (
  select count(*) filter (where od.lp is null) as unrecorded,
         -- c3: a minute that placed a buy counted no more than the caps allow after its turn.
         count(*) filter (where od.side = 'BUY' and ((od.lp->>'committedMarket')::numeric > (select cap_market_usd from cfg) + 1e-6
                                                  or (od.lp->>'committed')::numeric > (select cap_total_usd from cfg) + 1e-6)) as over_cap,
         coalesce(max((od.lp->>'committedMarket')::numeric) filter (where od.side = 'BUY'), 0) as worst_market,
         coalesce(max((od.lp->>'committed')::numeric) filter (where od.side = 'BUY'), 0) as worst_total,
         -- c4: a sell no larger than the holding of its token the turn decided on.
         count(*) filter (where od.side = 'SELL' and od.size > coalesce((od.lp->'held'->>od.outcome)::numeric, 0) + 1e-9) as oversold,
         -- c5: no buy on a side whose inventory the turn decided on was 5N its way (net = YES - NO).
         count(*) filter (where od.side = 'BUY' and od.outcome = 'yes'
                            and (od.lp->'held'->>'yes')::numeric - (od.lp->'held'->>'no')::numeric >= 5 * od.n - 1e-9) as over_5n_yes,
         count(*) filter (where od.side = 'BUY' and od.outcome = 'no'
                            and (od.lp->'held'->>'no')::numeric - (od.lp->'held'->>'yes')::numeric >= 5 * od.n - 1e-9) as over_5n_no,
         -- c6: a market carried from an earlier day, a paused minute or a close-only one places sells only.
         count(*) filter (where od.side = 'BUY' and od.lp->>'state' in ('carried', 'close', 'paused')) as buys_not_quoting,
         count(*) filter (where od.lp->>'state' = 'carried') as carried_orders
    from od),

-- (d) the quotes scored: the minutes the path quoted in full with something resting, by its own figure of what rested.
d as (
  select count(*) as rows, count(*) filter (where (m.detail->'after'->>'formula')::numeric > 0) as scored
    from public.pm_lp_minutes m, w
   where m.mode = 'dry_run' and m.minute >= w.w0 and m.minute < w.w1
     and m.detail->'lp'->>'state' = 'quote' and coalesce((m.detail->'after'->>'orders')::int, 0) >= 1),

-- (e) the paper day, closed by its layer; and the path's own stop, in its dry-run.
e as (
  select (select count(*) from public.pm_lpprep_days p, w where p.day = w.d) as rows,
         (select p.pnl_day_r40 from public.pm_lpprep_days p, w where p.day = w.d) as pnl_day_r40,
         (select p.fills_pnl_day from public.pm_lpprep_days p, w where p.day = w.d) as fills_pnl_day,
         (select p.reward from public.pm_lpprep_days p, w where p.day = w.d) as reward,
         (select p.minutes_matched from public.pm_lpprep_days p, w where p.day = w.d) as matched,
         (select count(*) from public.pm_lp_events v, w where v.mode = 'dry_run' and v.kind in ('loss_stop_day', 'loss_stop_total') and v.minute < w.w1) as stops),

-- (g) the paper layer's own validity: what the path rested was RW's price on its side whenever it rested anything.
g as (
  select coalesce(sum(p.minutes_matched + p.minutes_dark + p.minutes_diverged), 0) as decided, coalesce(sum(p.minutes_diverged), 0) as diverged
    from public.pm_lpprep_days p, w where p.day = w.d),

-- (f) ready, at the moment the check runs: the path's own last record, and the other two configs unarmed.
f as (
  select s.state->>'sbRegion' as region, s.state->'gates' as gates, (s.state->>'keyed')::boolean as keyed, (s.state->>'pusd')::numeric as pusd,
         (s.state->>'at')::timestamptz as at,
         (select count(*) from public.pm_live_config l where l.live_confirmed_at is not null) + (select count(*) from public.pm_mid_config m where m.live_confirmed_at is not null) as others_armed
    from public.pm_lp_state s where s.id = 1)

select 'w the window: d1, the first full UTC day after pm_lp_config.created_at' as condition,
       coalesce(w.d::text || ' (' || w.w0::text || ' -> ' || w.w1::text || ')', 'no pm_lp_config row') as measured,
       'the check runs at or after d1 + 1 day 00:10 UTC' as bar,
       case when now() >= w.w1 + interval '10 minutes' then 'PASS' else 'FAIL' end as verdict from (select 1) one left join w on true
union all
select 'a1 turns: minutes with a row of the path''s record', a_turns.n::text, '>= 1426 of 1440 (99 %)',
       case when a_turns.n >= 1426 then 'PASS' else 'FAIL' end from a_turns
union all
select 'a2 faults: minutes with an agents.pm_lp / agents.pm_lpprep / their crash row', a_faults.n::text, '<= 14 (1 %)',
       case when a_faults.n <= 14 then 'PASS' else 'FAIL' end from a_faults
union all
select 'a3 the paper layer decided the window and closed its day', coalesce(a_prep.last_minute::text, 'none') || '; day rows ' || a_prep.day_rows, 'last_minute >= d1 23:59; 1 day row',
       case when a_prep.last_minute >= (select w0 + interval '1439 minutes' from w) and a_prep.day_rows = 1 then 'PASS' else 'FAIL' end from a_prep
union all
select 'b1 selection: once, by 00:10 UTC', b.n || ' markets, ' || b.runs || ' run(s), first at ' || coalesce(b.first_at::text, 'none'), '>= 1 market, 1 run, by 00:10',
       case when b.n >= 1 and b.runs = 1 and b.first_at < (select w0 + interval '10 minutes' from w) then 'PASS' else 'FAIL' end from b
union all
select 'b2 every market inside the rules (rate >= 10, N = max(min,5) <= 20, not ending on d1, no game within 48 h, a reward spread, formula >= 2.50/day)',
       'rate ' || b.bad_rate || ', N ' || b.bad_n || ', horizon ' || b.bad_horizon || ', spread ' || b.bad_spread || ', formula ' || b.bad_formula || ' outside',
       'all 0', case when b.n >= 1 and b.bad_rate + b.bad_n + b.bad_horizon + b.bad_spread + b.bad_formula = 0 then 'PASS' else 'FAIL' end from b
union all
select 'b3 size: count <= max_markets (10), first-quote capital <= select_budget_usd ($200)', b.n || ' markets, $' || round(b.capital, 2), '<= ' || cfg.max_markets || ' and <= $' || cfg.select_budget_usd,
       case when b.n <= cfg.max_markets and cfg.max_markets <= 10 and b.capital <= cfg.select_budget_usd + 1e-9 and cfg.select_budget_usd <= 200 then 'PASS' else 'FAIL' end from b, cfg
union all
select 'c1 post-only: no would-be order crosses the book it was decided on', c_post.crossing || ' of ' || c_post.n, '0 crossing, >= 1 order',
       case when c_post.n >= 1 and c_post.crossing = 0 then 'PASS' else 'FAIL' end from c_post
union all
select 'c2 size: every buy N, every sell at most N, none under the venue''s minimum, every order''s market selected',
       'buys ' || c_size.bad_buy || ', sells ' || c_size.bad_sell || ', under the venue ' || c_size.under_venue || ', no market ' || c_size.no_market, 'all 0',
       case when c_size.bad_buy + c_size.bad_sell + c_size.under_venue + c_size.no_market = 0 then 'PASS' else 'FAIL' end from c_size
union all
select 'c3 caps: in every minute that placed a buy, holdings at cost and resting buys after the turn',
       'market $' || round(c_rest.worst_market, 2) || ', total $' || round(c_rest.worst_total, 2) || '; over ' || c_rest.over_cap || '; unrecorded ' || c_rest.unrecorded,
       '<= $100 a market (cap_market_usd $' || cfg.cap_market_usd || '), <= cap_total_usd $' || cfg.cap_total_usd || '; 0 unrecorded',
       case when c_rest.over_cap = 0 and c_rest.unrecorded = 0 and cfg.cap_market_usd <= 100 then 'PASS' else 'FAIL' end from c_rest, cfg
union all
select 'c4 sells: no sell larger than the holding of its token the turn decided on', c_rest.oversold::text, '0',
       case when c_rest.oversold = 0 and c_rest.unrecorded = 0 then 'PASS' else 'FAIL' end from c_rest
union all
select 'c5 5N: no buy on a side whose inventory the turn decided on was 5N its way', 'YES ' || c_rest.over_5n_yes || ', NO ' || c_rest.over_5n_no, '0',
       case when c_rest.over_5n_yes + c_rest.over_5n_no = 0 and c_rest.unrecorded = 0 then 'PASS' else 'FAIL' end from c_rest
union all
select 'c6 a carried, paused or close-only minute places sells only', c_rest.buys_not_quoting || ' buys (' || c_rest.carried_orders || ' orders in carried markets)', '0 buys',
       case when c_rest.buys_not_quoting = 0 and c_rest.unrecorded = 0 then 'PASS' else 'FAIL' end from c_rest
union all
select 'd scored: of the market-minutes quoted in full with something resting, those whose quotes score (detail.after.formula > 0)',
       d.scored || ' of ' || d.rows || coalesce(' (' || round(100.0 * d.scored / nullif(d.rows, 0), 1) || ' %)', ''), '>= 60 %',
       case when d.rows > 0 and d.scored >= 0.60 * d.rows then 'PASS' else 'FAIL' end from d
union all
select 'e paper day: fills P&L + rewards at R = 0.40 above -$25; the path''s stop never tripped in its dry-run',
       coalesce('$' || round(e.pnl_day_r40, 4) || ' (fills $' || round(e.fills_pnl_day, 4) || ', formula $' || round(e.reward, 4) || ', matched ' || e.matched || '); stops ' || e.stops, 'no day row'),
       '> -25, 0 stops, a day row with matched minutes',
       case when e.rows = 1 and e.pnl_day_r40 > -25 and e.stops = 0 and e.matched > 0 then 'PASS' else 'FAIL' end from e
union all
select 'g paper validity: diverged market-minutes', g.diverged || ' of ' || g.decided, '<= 2 % of decided',
       case when g.decided > 0 and g.diverged <= 0.02 * g.decided then 'PASS' else 'FAIL' end from g
union all
select 'f ready now: eu-west-1, the gates region/geoblock/attestation/closed_only, the key loaded, pUSD >= $81 read within 5 minutes, mini-pool and mid-pool unarmed',
       coalesce('region ' || coalesce(f.region, '?') || ', gates ' || coalesce(f.gates::text, '?') || ', keyed ' || coalesce(f.keyed::text, '?') || ', pUSD '
         || coalesce(round(f.pusd, 2)::text, '?') || ' at ' || coalesce(f.at::text, '?') || ', others armed ' || f.others_armed, 'no pm_lp_state row'),
       'all true, >= 81, <= 5 min, 0 armed',
       case when f.region = 'eu-west-1' and (f.gates->>'region')::boolean and (f.gates->>'geoblock')::boolean and (f.gates->>'attestation')::boolean
              and (f.gates->>'closed_only')::boolean and f.keyed and f.pusd >= 81 and f.at >= now() - interval '5 minutes' and f.others_armed = 0
            then 'PASS' else 'FAIL' end from (select 1) one left join f on true;
