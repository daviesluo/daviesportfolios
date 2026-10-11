-- LP-RULES: how often each live rule acted, from live-prep's live minutes (pm_lp_minutes, mode 'live', the go
-- 2026-10-09 01:32 UTC onward), by UTC day. Read-only. For each class: market-minutes, markets, and the formula those
-- minutes scored (a minute that rests nothing scores 0, so for a rule that empties a minute the formula column is what
-- was left, not what was lost).
--   quote         today's market taking entries
--   quote, empty  ... with nothing resting (bid_price and ask_price null): TB1's skip, a cap, the near-certain limit
--   quote, tight  ... whose raw touch (ba - bb of the book without our orders) is one tick or less (TB1's skip)
--   quote, one    ... with one side resting
--   paused        x2's 15-cent pause (detail.lp.state 'paused')
--   carried: why  a market worked close-only: held from an earlier day (no reason), or taken out, by the reason's
--                 first words (the reward check's programme verdict, the backstop, the AI rule, the loss guard, a refill)
with m as (
  select (minute at time zone 'utc')::date d, cond, detail->'lp'->>'state' st, detail->'lp'->>'out' why,
    bb::numeric bb, ba::numeric ba, tick::numeric tick, bid_price, ask_price, formula_usd::numeric f
  from pm_lp_minutes where mode = 'live'),
c as (
  select d, cond, f,
    case
      when st = 'quote' and bid_price is null and ask_price is null and ba - bb <= tick + 1e-9 then 'quote, empty, tight'
      when st = 'quote' and bid_price is null and ask_price is null then 'quote, empty, not tight'
      when st = 'quote' and (bid_price is null or ask_price is null) then 'quote, one side'
      when st = 'quote' then 'quote, two sides'
      when st = 'paused' then 'paused'
      when st = 'carried' and why is null then 'carried: from an earlier day'
      when st = 'carried' and why ilike '%fills are marked%' then 'carried: loss guard'
      when st = 'carried' and why ilike '%AI market%' then 'carried: AI rule'
      when st = 'carried' and why ilike '%scoring%' then 'carried: backstop (not scoring)'
      when st = 'carried' and why ilike '%refill%' or why ilike '%replaced%' then 'carried: replaced by a refill'
      when st = 'carried' then 'carried: reward check (' || left(why, 40) || '…)'
      else coalesce(st, '?') end cls
  from m)
select d, cls, count(*) mm, count(distinct cond) markets, round(sum(f), 2) formula
from c group by d, cls order by d, cls;
