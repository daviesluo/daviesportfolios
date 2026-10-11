-- LP-RULES: what the 5N side cap did live against RW's 3N. A BUY that fills while its side's inventory (YES held less
-- NO held, in the buy's direction) is already 3N or more is a fill 3N would not have taken; a quoting minute whose
-- inventory is 3N or more its way is one where 3N would have rested only the other side, so RW's formula (0 for one
-- side) would have scored nothing. Part 1: those fills against the others, at the fill and marked out 60 minutes and 6 hours on
-- (the mid then, or the payout of a market settled by then); the 6-hour figure is also in dollars. Part 2: the
-- formula of those minutes, by day (in part 2 the column mo6h_usd holds the formula in $). N is the market's n_size (20 on every live market so far). Read-only.
with mk as (select distinct on (cond) cond, yes_token, n_size from pm_lp_markets order by cond, day desc),
f as (select f.cond, f.side, f.price::numeric p, f.size::numeric s, f.match_time t, (f.token = mk.yes_token) yes, mk.n_size n
      from pm_lp_fills f join mk on mk.cond = f.cond where f.status = 'CONFIRMED'),
seq as (
  select f.*, coalesce(sum(case when yes then 1 else -1 end * case when side = 'BUY' then s else -s end)
    over (partition by cond order by t, side rows between unbounded preceding and 1 preceding), 0) net_before
  from f),
z as (
  select seq.*,
    case when side = 'BUY' and ((yes and net_before >= 3 * n - 1e-9) or (not yes and net_before <= -3 * n + 1e-9)) then 'buy beyond 3N'
         when side = 'BUY' then 'buy under 3N' else 'sell' end zone,
    (select (m.detail->>'m')::numeric from pm_lp_minutes m where m.mode = 'live' and m.cond = seq.cond and m.minute <= seq.t and m.detail->>'m' is not null order by m.minute desc limit 1) m0,
    (select (m.detail->>'m')::numeric from pm_lp_minutes m where m.mode = 'live' and m.cond = seq.cond and m.minute <= seq.t + interval '60 min' and m.minute > seq.t + interval '30 min' and m.detail->>'m' is not null order by m.minute desc limit 1) m60,
    (select (m.detail->>'m')::numeric from pm_lp_minutes m where m.mode = 'live' and m.cond = seq.cond and m.minute <= seq.t + interval '6 hours' and m.minute > seq.t + interval '5 hours' and m.detail->>'m' is not null order by m.minute desc limit 1) m360,
    (select st.payout::numeric from pm_lp_settlements st where st.cond = seq.cond and st.settled_at <= seq.t + interval '6 hours') pay6
  from seq),
w as (select z.*, coalesce(pay6, m360) m6 from z)
select 'fills' part, zone, count(*) n, round(sum(s), 1) shares,
  -- edge at the fill against the mid, and markouts (the mid's move against the fill), cents a share, + = good for us
  round(100 * sum(s * case when side = 'SELL' then p - (case when yes then m0 else 1 - m0 end) else (case when yes then m0 else 1 - m0 end) - p end) / sum(s), 2) edge_c,
  round(100 * sum(s * case when side = 'SELL' then p - (case when yes then m60 else 1 - m60 end) else (case when yes then m60 else 1 - m60 end) - p end) filter (where m60 is not null) / nullif(sum(s) filter (where m60 is not null), 0), 2) mo60_c,
  round(100 * sum(s * case when side = 'SELL' then p - (case when yes then m6 else 1 - m6 end) else (case when yes then m6 else 1 - m6 end) - p end) filter (where m6 is not null) / nullif(sum(s) filter (where m6 is not null), 0), 2) mo6h_c,
  round(sum(s * case when side = 'SELL' then p - (case when yes then m6 else 1 - m6 end) else (case when yes then m6 else 1 - m6 end) - p end) filter (where m6 is not null), 2) mo6h_usd,
  count(*) filter (where m6 is not null) n6h
from w group by zone
union all
select 'minutes ' || (minute at time zone 'utc')::date::text, case when abs(coalesce((detail->'lp'->'held'->>'yes')::numeric, 0) - coalesce((detail->'lp'->'held'->>'no')::numeric, 0)) >= 3 * 20 - 1e-9 then 'beyond 3N' else 'under 3N' end,
  count(*), null, null, null, null, round(sum(formula_usd), 2), null
from pm_lp_minutes where mode = 'live' and detail->'lp'->>'state' = 'quote' group by 1, 2
order by 1, 2;
