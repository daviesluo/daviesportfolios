-- PMPOST: every live CONFIRMED fill of live-prep (S2, Q2 and the close-only spells), with what the decomposition needs.
-- y is the fill's YES-equivalent price (a NO at p is a YES at 1 - p) and d its direction in YES (+1 a BUY of YES or a
-- SELL of NO, -1 otherwise). m0: the others' raw touch midpoint ((bb + ba) / 2 of the book without our orders) in the
-- market's last live minute row at or before the fill; m1: the same in its first row at least 60 s after; mfin: the
-- payout once settled, else the latest such midpoint; mpre: the latest midpoint before the settlement. fee_bps: the
-- trade record's fee rate. Read-only.
with mk as (select distinct on (cond) cond, yes_token from pm_lp_markets order by cond, day desc),
f as (
  select f.trade_id, f.cond, f.side, f.price::numeric p, f.size::numeric s, f.match_time t, (f.token = mk.yes_token) yes,
    coalesce(f.detail->'trade'->>'fee_rate_bps', '0') fee_bps, f.detail->'trade'->>'trader_side' role
  from pm_lp_fills f join mk on mk.cond = f.cond where f.status = 'CONFIRMED'),
mm as (select cond, minute, (bb::numeric + ba::numeric) / 2 mid from pm_lp_minutes where mode = 'live' and bb is not null and ba is not null)
select f.trade_id, substr(f.cond, 1, 10) c, to_char(f.t, 'YYYY-MM-DD"T"HH24:MI:SS') t, f.side, f.yes, f.p, f.s, f.fee_bps, f.role,
  (select mid from mm where mm.cond = f.cond and mm.minute <= f.t order by mm.minute desc limit 1) m0,
  (select mid from mm where mm.cond = f.cond and mm.minute >= f.t + interval '60 s' order by mm.minute asc limit 1) m1,
  coalesce(st.payout::numeric, (select mid from mm where mm.cond = f.cond order by mm.minute desc limit 1)) mfin,
  st.payout, to_char(st.settled_at, 'YYYY-MM-DD"T"HH24:MI:SS') settled_at,
  (select mid from mm where mm.cond = f.cond and mm.minute < st.settled_at order by mm.minute desc limit 1) mpre
from f left join pm_lp_settlements st on st.cond = f.cond
order by f.t, f.trade_id;
