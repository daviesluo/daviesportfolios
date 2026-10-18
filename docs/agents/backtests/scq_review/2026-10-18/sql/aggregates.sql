-- 2026-10-18 stablecoin quotes review: the aggregate reads the review quotes, SELECT only, through the Supabase connector,
-- 2026-10-18 03:27-03:50 UTC. Each output is quoted under its statement (cited in the review as [H1] ... [E1]).

-- H1. Health: the twins' spec rows, LIVE's config and state, both Coinbase engines.
select now(), (select json_agg(json_build_object('id',id,'name',display_name,'engine',engine,'cap',capital_gbp,'start',start,'enabled',enabled,'rules',rules) order by display_order) from public.agent_quote_twin_specs) specs,
 (select json_build_object('dry',dry_run,'conf',live_confirmed_at,'cap',capital_gbp) from public.agent_quote_live_config where id=1) live_cfg,
 (select json_build_object('upd',updated_at,'err',last_error,'gov',state->'governor') from public.agent_quote_live_state) live_state,
 (select json_build_object('upd',updated_at,'lm',last_minute,'err',last_error) from public.cb_quote_state) cbq,
 (select json_build_object('upd',updated_at,'lm',last_minute,'err',last_error,'started',state->>'startedAt') from public.cb_hold_state) cbh;
-- 03:27:48: pr5 £1,200, p50 £600, take50 £600 (take from 2026-10-04 16:00), d £1,800 (ruled-d), all enabled; LIVE dry_run false,
-- confirmed 2026-10-01 16:29:53, £120, state 21 s old, no error, governor {"live":"all"}; cb_quote last minute 03:25, cb_hold
-- 03:24, no error, cb_hold startedAt 1791849600000 (2026-10-13 00:00 UTC).

-- H2. Freshness of every minute call over the last hour.
select path, count(*) beats_60m, max(minute) last from edge_call_beats where minute > now() - interval '60 minutes' group by 1 order by 1;
-- 03:43: books, cbbooks, cbhold, cbrec, cjrec, pmlp, pmlpreserve, pmrec, quotes, quotesd, quotestwins, quotesv, tick, views,
-- edge-watchdog, grokpm sync, ig quotes, monitor deadman: 60 of 60 each; grokpmrec and pmrec-meta 12 (five-minutely),
-- grokpm redeem 2, overnight-record and snapshot-record 12, trading212 orders-sync 6.

-- H3. The error box, four days.
select kind, count(*) n, max(created_at) last, min(created_at) first, left(max(message),160) sample from ops_errors
where created_at > now() - interval '4 days' group by kind order by n desc;
-- ig.quotes 165 (2026-10-16 20:52 -> 2026-10-18 03:39, "cfd: 401 error.security.account-token-invalid; sb: 401 ...");
-- agents.cb_books 10, agents.pm_lp 8, agents.pm_rec 8, agents.quotes_twins 7, agents.tick 7, agents.quotes 5, agents.cj_rec 5,
-- agents.cb_rec 5, agents.quotes_live 3 (10-15 16:59-17:18, "turn: Signal timed out."), trading212.upstream 2,
-- agents.pm_lp_reserve 2, edge-watchdog.retry 2, agents.cb_hold 2, data.save.error 1, edge-watchdog.unreadable 1,
-- grokpm.redeem 1. Apart from ig.quotes, every one is a 502 or a timeout of the network or the database.

-- H4. The IG weekend recorder's runs by hour since Friday evening.
select date_trunc('hour', started_at) h, count(*) runs, sum(ok::int) ok, sum(snapshots) snaps, sum(logins) logins, left(max(error),100) err
from ig_quote_runs where started_at > '2026-10-16 18:00' group by 1 order by 1 desc;
-- every hour from 2026-10-17 07:00 to 03:00 on 10-18: 60 runs, 13-26 ok, 107-156 snapshots, 183-204 logins, each failed run
-- "cfd: 401 error.security.account-token-invalid; sb: 401 ...". 10-16 20:00-21:00 and 10-17 06:00: 5-10 runs.

-- H5. The other engines' states and CoinJar's recorder.
-- cj_rec, cb_rec, cb_book_state updated 03:43-03:44, no error; agent_quoted_state, agent_quotev_state and agent_quote_state
-- decided 03:42, no error; cj_book 2,880 rows and cj_trades 11 in the last 24 h.

-- A1. The twins' takes (TAKE): every order with request.take.
select id, ts, book, rung_side, k, side, state, filled_base, avg_fill_price, fee_gbp, fair from public.agent_quote_twin_take50_orders
where request ? 'take' order by id;
-- 9, all USDT-GBP and filled: 3423, 3440 (10-05), 4112 (10-06), 5087, 5110 (10-08), 6424, 6449, 6677 (10-14), 7894 (10-16).

-- A2. Orders each row wrote, by leg (data/order_counts.json holds the output).
with o as (
 select 'live' r, ts, leg, state, filled_base, response from agent_quote_live_orders where mode='live'
 union all select 'pr5', ts, leg, state, filled_base, response from agent_quote_twin_pr5_orders where mode='live'
 union all select 'p50', ts, leg, state, filled_base, response from agent_quote_twin_p50_orders where mode='live'
 union all select 'take50', ts, leg, state, filled_base, response from agent_quote_twin_take50_orders where mode='live'
 union all select 'd', ts, leg, state, filled_base, response from agent_quote_twin_d_orders where mode='live')
select r, leg, count(*) rows_, count(*) filter (where coalesce((response->>'wouldBeRefused')::boolean,false)) not_sent,
 count(*) filter (where filled_base>0) filled, count(*) filter (where ts >= '2026-10-11') rows_7d,
 count(*) filter (where filled_base>0 and ts >= '2026-10-11') filled_7d
from o group by 1,2 order by 1,2;

-- P1. The paper engines' trips by entry day (data/paper_engines.json holds the output).
with t as (
 select 'pr5_paper' s, t_entry, t_exit, pnl_usd pnl, notional_usd nt, how from public.agent_quote_trips
 union all select 'pr5v_'||arm, t_entry, t_exit, pnl_usd, notional_usd, how from public.agent_quotev_trips
 union all select 'ruled_'||arm, t_entry, t_exit, pnl_usd, notional_usd, how from public.agent_quoted_trips),
d as (select s, t_entry::date d, sum(pnl) p, count(*) n from t group by 1,2)
select s, (select count(*) from t where t.s=x.s) n, (select sum((pnl>0)::int) from t where t.s=x.s) won,
 (select sum((how='taker')::int) from t where t.s=x.s) stops, (select round(sum(pnl),4) from t where t.s=x.s) pnl,
 (select min(t_entry) from t where t.s=x.s) first, json_object_agg(d::text, round(p,4) order by d) by_entry_day
from d x group by s order by s;
-- pr5_paper 189 trips, 177 won, 3 stops, +$13.3605; pr5v_main = ruled_v1 975, 826, 3, +$28.7566; pr5v_top5 666, 583, 3,
-- +$23.1711; ruled_d 1,057, 894, 3, +$28.8880.

-- P2. PR5's paper engine's own daily view, the days near the spec's 700-orders condition and the last week.
select * from agent_quote_days where day >= '2026-10-12' or orders > 650 order by day;
-- 2026-10-01 714 orders; 10-12 203; 10-13 233; 10-14 611; 10-15 645; 10-16 483. No day over 700 but 10-01.

-- C1. Coinbase's two tests, by entry day and by exit day.
with t as (select 'cbq' s, * from public.cb_quote_trips union all select 'cbh', * from public.cb_hold_trips)
select s, date_trunc('day', t_entry)::date d, to_char(t_entry,'Dy') dow, count(*) n, sum((pnl_gbp>0)::int) won,
 sum((how='stop')::int) stops, round(sum(pnl_gbp),4) pnl from t group by 1,2,3 order by 1,2;
-- by entry: "with Euros" Mon 10-12 8 +0.4897, Tue 3 -0.4734, Wed 19 -0.8701, Thu 19 +1.0901, Fri 12 +1.0448;
-- "- 2" Tue 10-13 4 -0.3143, Wed 18 -0.8873, Thu 19 +0.9782, Fri 12 +0.7756. No trip entered on a Saturday or Sunday in either.
with t as (select 'cbq' s, * from public.cb_quote_trips union all select 'cbh', * from public.cb_hold_trips)
select s, t_exit::date d, to_char(t_exit,'Dy') dow, count(*) n, round(sum(pnl_gbp),4) pnl from t group by 1,2,3 order by 1,2;
-- by exit: "with Euros" Mon +0.4897, Tue +0.0851, Wed -2.6951, Thu +1.9803, Fri +0.6168, **Sat 10-17 8 trips +0.8042**;
-- "- 2" Tue +0.0851, Wed -2.5532, Thu +1.8684, Fri +0.3499, **Sat 10-17 8 trips +0.8019**.
select 'cbq' s, book, side, k, t_entry, t_exit, how, round(pnl_gbp,4) pnl from public.cb_quote_trips where t_exit >= '2026-10-16 18:00'
union all select 'cbh', book, side, k, t_entry, t_exit, how, round(pnl_gbp,4) from public.cb_hold_trips where t_exit >= '2026-10-16 18:00' order by 1,5;
-- Saturday's eight in each: all entered Friday 10-16 07:31-17:56; seven closed by the 24-hour stop (USDC-EUR bids +0.4966 and
-- +0.4104, USDT-EUR ask +0.1222, USDC-GBP bid +0.1223 in "with Euros", the others -0.0342 to -0.1699) and one maker exit in
-- "- 2" (USDC-GBP bid, +0.1201 at 10:53).
with t as (select 'cbq' s, * from public.cb_quote_trips union all select 'cbh', * from public.cb_hold_trips)
select s, book, count(*) n, sum((pnl_gbp>0)::int) won, sum((how='taker')::int) stops, round(sum(pnl_gbp),4) pnl,
 round(sum(pnl_gbp) filter (where how='taker'),4) stop_pnl, round(min(pnl_gbp),4) worst from t group by rollup(1,2) order by 1,2;
-- "with Euros" 61 trips, 31 won, 10 stops, +£1.2810 (stops +£1.3154); "- 2" 53, 25, 9, +£0.5522 (stops +£1.1930).
select minute, book, side, k, kind, detail from public.cb_hold_events where minute >= '2026-10-16 20:00' and kind <> 'order' order by minute;
-- "- 2"'s own weekend so far: five entry fills on Saturday 10-17 (USDT-GBP ask 16:37, USDC-GBP asks 0.1 % and 0.2 % 17:00,
-- USDC-EUR ask 18:58, USDT-EUR ask 0.2 % 22:05), all five still open at 03:30 on 10-18 (cb_hold_state rungs in "position").
select 'hold' s, minute::date d, book, count(*) mins, count(fair) fair_mins, sum(prints_n) prints, round(sum(vol),0) vol from public.cb_hold_minutes where minute >= '2026-10-16' group by 1,2,3
union all select 'quote', minute::date, book, count(*), count(fair), sum(prints_n), round(sum(vol),0) from public.cb_quote_minutes where minute >= '2026-10-16' group by 1,2,3 order by 1,2,3;
-- "- 2" has a fair in every minute of Saturday 10-17 on all four books; "with Euros" in none (dark, as designed).

-- B1. Revolut X's GBP books, weekend (Fri 21:00 -> Sun 24:00 UTC) against weekday, from the book recorder 2026-09-27 -> 10-17.
with r as (
 select book, ts, reads, (asks->0->>0)::numeric a, (bids->0->>0)::numeric b,
  (select sum((e->>0)::numeric*(e->>1)::numeric) from jsonb_array_elements(bids) e) bd,
  (select sum((e->>0)::numeric*(e->>1)::numeric) from jsonb_array_elements(asks) e) ad
 from agent_book_levels where book in ('USDC-GBP','USDT-GBP') and ts >= '2026-09-27' and ts < '2026-10-18')
select book, case when extract(isodow from ts) in (6,7) or (extract(isodow from ts)=5 and extract(hour from ts)>=21) then 'weekend' else 'weekday' end k,
 sum(reads) reads, round(sum(reads*1e4*(a-b)/((a+b)/2))/sum(reads),2) spread_bps,
 round(percentile_cont(0.5) within group (order by 1e4*(a-b)/((a+b)/2))::numeric,2) med_spread_bps,
 round(sum(reads*bd)/sum(reads),0) bid_depth5_gbp, round(sum(reads*ad)/sum(reads),0) ask_depth5_gbp
from r where a>0 and b>0 group by 1,2 order by 1,2;
-- USDC-GBP weekday 11.01 bps (median 6.61), depth 666,726 / 441,665; weekend 13.27 (9.27), 750,183 / 411,929.
-- USDT-GBP weekday 5.28 (3.98), 468,339 / 53,096; weekend 11.42 (5.30), 631,903 / 41,945.
with rv as (select book p, ts, ((asks->0->>0)::numeric+(bids->0->>0)::numeric)/2 m from agent_book_levels where book in ('USDC-GBP','USDT-GBP') and ts >= '2026-09-27' and ts < '2026-10-18'),
rr as (select p, ts, 1e4*ln(m/lag(m) over (partition by p order by ts)) r from rv)
select p, case when extract(isodow from ts) in (6,7) or (extract(isodow from ts)=5 and extract(hour from ts)>=21) then 'weekend' else 'weekday' end k, count(*) n,
 count(*) filter (where abs(r) > 200) outliers, round(stddev(r) filter (where abs(r) <= 200)::numeric,3) sd_trim,
 round(avg(abs(r)) filter (where abs(r)<=200)::numeric,3) mean_abs, round((count(*) filter (where r<>0))::numeric/count(*),3) share_moved
from rr where r is not null group by 1,2 order by 1,2;
-- mid change between reads (bps): USDC-GBP weekday sd 1.463 (4 outliers over 200 bps dropped), weekend 2.044; USDT-GBP 1.704 / 2.045;
-- share of reads where the mid moved 0.523 / 0.344 and 0.358 / 0.239: at weekends it moves less often, in larger steps.

-- B2. Coinbase's four books, the week 2026-10-11 -> 10-17, the same split.
with t as (select product, ts, bid, ask, case when extract(isodow from ts) in (6,7) or (extract(isodow from ts)=5 and extract(hour from ts)>=21) then 'weekend' else 'weekday' end k from cb_touch where ts >= '2026-10-11' and ts < '2026-10-18' and bid>0 and ask>0),
v as (select product, case when extract(isodow from ts) in (6,7) or (extract(isodow from ts)=5 and extract(hour from ts)>=21) then 'weekend' else 'weekday' end k, count(*) n, sum(price*size) vol from cb_trades where ts >= '2026-10-11' and ts < '2026-10-18' group by 1,2)
select t.product, t.k, count(*) mins, round(avg(1e4*(ask-bid)/((ask+bid)/2)),2) spread_bps, max(v.n) trades, round(max(v.vol)) vol_quote
from t join v on v.product=t.product and v.k=t.k group by 1,2 order by 1,2;
-- weekday 7,017 minutes / weekend 3,059: USDC-EUR spread 1.17 / 1.13 bps, trades 156,916 / 32,206, volume 245.8m / 22.5m;
-- USDC-GBP 1.48 / 1.37, 22,474 / 7,769, 10.4m / 2.6m; USDT-EUR 0.29 / 0.32, 107,831 / 5,575, 178.8m / 9.8m;
-- USDT-GBP 1.68 / 1.38, 27,407 / 4,755, 18.4m / 2.1m. Mid change per minute, sd (bps): 0.95 / 0.31, 1.01 / 0.37, 0.87 / 0.29,
-- 1.03 / 0.46 (the same table, `stddev(1e4*ln(m/lag(m)))` over cb_touch).

-- E1. The crypto loop's rows and their orders in 30 days.
select strategy_id, mode, count(*) n, count(*) filter (where ts > now()-interval '7 days') n7, max(ts)::date last from agent_orders
where ts > now()-interval '30 days' group by 1,2 order by 1;
-- momentum-1d paper 10 (5 in 7 days, last 10-18); trend-1h paper 22 (6, last 10-12); trend-4h paper 8 (0, last 09-28);
-- trend-4h-live live 2 (0, last 09-28).
