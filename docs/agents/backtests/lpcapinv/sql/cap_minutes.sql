-- LP-CAPINV: which live minutes had a BUY of today's markets withheld by `cap_total`, and what the formula lost.
-- The turn's withheld list is not stored per minute (only the newest turn's, in pm_lp_state.state.withheld), so it is
-- rebuilt here from what each minute stored. Read-only.
--
-- The cap, rebuilt: 320 (the config) until Addendum 8 deployed (commit 44d37e87, 2026-10-09 15:12 UTC; taken as
-- 15:20); after it floor(equity − 75 − 5), the equity at cost = the deposit 402.028365 + the realised P&L of every
-- CONFIRMED fill and settlement at average cost (as `tokenBooks`) + rewards and rebates as they reached pUSD
-- (6.524180 at 2026-10-10 00:05, the rebates 1.976628 by 01:17, taken at 01:00; 21.890765 at 2026-10-11 00:05).
-- (pUSD + held at cost + unredeemed moves only by realised P&L and money in, so this is the equity `lpCapital` reads,
-- less its two-readings lag on a raise.)
-- Committed: what each minute stored after its turn (detail.lp.committed: held at cost in every market + resting buys).
-- A side of a market in state 'quote' with no order of ours on it (bid_price / ask_price null) wants a BUY unless the
-- token it would sell is held ≥ N; that BUY costs N × bb (YES bid) or N × (1 − ba) (NO bid). It is counted withheld by
-- the cap when committed + that cost > cap. Minutes whose raw touch is one tick (TB1's skip) are left out: the rule
-- rests nothing there anyway.
-- The formula lost: under RW's formula a market scores min(qBid, qAsk), so a market missing a side scores 0; each such
-- market-minute is priced at that market's mean formula over its own two-sided 'quote' minutes of the same UTC day.
with recursive
f0 as (
  select f.token, f.side, f.price::numeric p, f.size::numeric s, f.match_time t from pm_lp_fills f where f.status = 'CONFIRMED'
  union all select s.yes_token, 'SELL', s.payout::numeric, 1e9, s.settled_at from pm_lp_settlements s
  union all select s.no_token, 'SELL', 1 - s.payout::numeric, 1e9, s.settled_at from pm_lp_settlements s
),
f as (select *, row_number() over (partition by token order by t, case side when 'BUY' then 0 else 1 end) k from f0),
b as (
  select token, k, t, case when side = 'BUY' then s else 0 end held, case when side = 'BUY' then p else 0 end avg, 0::numeric r
  from f where k = 1
  union all
  select f.token, f.k, f.t,
    case when f.side = 'BUY' then b.held + f.s else greatest(0, b.held - f.s) end,
    case when f.side = 'BUY' then (b.avg * b.held + f.p * f.s) / nullif(b.held + f.s, 0) when b.held - f.s <= 0 then 0 else b.avg end,
    case when f.side = 'SELL' then least(b.held, f.s) * (f.p - b.avg) else 0 end
  from b join f on f.token = b.token and f.k = b.k + 1
),
realised as (select t, sum(r) over (order by t rows unbounded preceding) cum from b),
mins as (
  select minute, max((detail->'lp'->>'committed')::numeric) committed from pm_lp_minutes where mode = 'live' group by minute
),
capm as (
  select m.minute, m.committed,
    case when m.minute < '2026-10-09 15:20+00' then 320
      else floor(402.028365
        + coalesce((select cum from realised r where r.t <= m.minute order by r.t desc limit 1), 0)
        + case when m.minute >= '2026-10-10 00:05+00' then 6.524180 else 0 end
        + case when m.minute >= '2026-10-10 01:00+00' then 1.976628 else 0 end
        + case when m.minute >= '2026-10-11 00:05+00' then 21.890765 else 0 end
        - 80) end cap
  from mins m
),
sides as (
  select x.minute, x.cond, x.formula_usd::numeric fu,
    (x.bid_price is not null and x.ask_price is not null) two,
    (x.detail->'lp'->>'n')::numeric n,
    case when x.bid_price is null and coalesce((x.detail->'lp'->'held'->>'no')::numeric, 0) < (x.detail->'lp'->>'n')::numeric - 1e-9
      then (x.detail->'lp'->>'n')::numeric * x.bb end yes_cost,
    case when x.ask_price is null and coalesce((x.detail->'lp'->'held'->>'yes')::numeric, 0) < (x.detail->'lp'->>'n')::numeric - 1e-9
      then (x.detail->'lp'->>'n')::numeric * (1 - x.ba) end no_cost,
    (x.ba - x.bb) <= x.tick + 1e-9 tight
  from pm_lp_minutes x where x.mode = 'live' and x.detail->'lp'->>'state' = 'quote'
),
j as (
  select s.*, c.committed, c.cap, c.cap - c.committed headroom,
    (not s.tight and ((s.yes_cost is not null and c.committed + s.yes_cost > c.cap) or (s.no_cost is not null and c.committed + s.no_cost > c.cap))) capped,
    (not s.tight and (s.yes_cost is not null or s.no_cost is not null)) missing
  from sides s join capm c using (minute)
),
mean2 as (
  select (minute at time zone 'utc')::date d, cond, avg(fu) f2 from j where two group by 1, 2
)
select (j.minute at time zone 'utc')::date as utc_day,
  count(distinct j.minute) minutes,
  count(distinct j.minute) filter (where j.capped) minutes_capped,
  count(*) quote_market_minutes,
  count(*) filter (where j.missing) missing_side_mm,
  count(*) filter (where j.capped) capped_mm,
  round(sum(j.fu), 2) formula,
  round(sum(coalesce(m2.f2, 0)) filter (where j.capped), 2) formula_lost_capped,
  round(sum(coalesce(m2.f2, 0)) filter (where j.missing and not j.capped), 2) formula_lost_other_missing,
  round(avg(j.headroom), 1) mean_headroom, round(min(j.cap), 0) cap_min, round(max(j.cap), 0) cap_max
from j left join mean2 m2 on m2.d = (j.minute at time zone 'utc')::date and m2.cond = j.cond
group by 1 order by 1;
