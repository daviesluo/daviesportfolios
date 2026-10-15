-- PMPOST: the account now, for the reconciliation with the deposit: the path's own state (pUSD read this minute, the
-- equity at cost, the booked deposit and residual, the fills' P&L, the stop), the config, every funding event the path
-- booked, every settlement, and what each still-open market holds with its last others' mid. Read-only.
select now(), updated_at, last_error, state->'pusd' pusd, state->'lp'->'capital' capital, state->'lp'->'funding' funding,
  state->'lp'->'fundingResidual' resid, state->'pnl' pnl, state->'lp'->'stop' stop, state->'gates' gates,
  (select row_to_json(c) from (select dry_run, live_confirmed_at, restarted_at, restart_loss_usd, loss_total_usd, reinvest from pm_lp_config) c) cfg
from pm_lp_state;
select minute, detail::text from pm_lp_events where kind = 'funding' order by minute;
select cond, payout, closed_time, settled_at from pm_lp_settlements order by settled_at;
with mk as (select distinct on (cond) cond, yes_token, question, end_date from pm_lp_markets order by cond, day desc),
p as (select f.cond, sum(case when f.token = mk.yes_token then (case when f.side = 'BUY' then 1 else -1 end) * f.size::numeric else 0 end) y,
  sum(case when f.token <> mk.yes_token then (case when f.side = 'BUY' then 1 else -1 end) * f.size::numeric else 0 end) n,
  sum(case when f.side = 'BUY' then f.price::numeric * f.size::numeric else -f.price::numeric * f.size::numeric end) net_cost
  from pm_lp_fills f join mk on mk.cond = f.cond where f.status = 'CONFIRMED' group by f.cond)
select substr(p.cond, 1, 10) c, left(mk.question, 55) q, mk.end_date, round(p.y, 2) yes, round(p.n, 2) no, round(p.net_cost, 2) net_cost,
  (select (m.bb + m.ba) / 2 from pm_lp_minutes m where m.mode = 'live' and m.cond = p.cond and m.bb is not null order by m.minute desc limit 1) mid,
  (select count(*) from pm_lp_orders o where o.mode = 'live' and o.cond = p.cond and o.state = 'live') resting
from p join mk on mk.cond = p.cond where p.cond not in (select cond from pm_lp_settlements) and (abs(p.y) > 0.5 or abs(p.n) > 0.5) order by 1;
