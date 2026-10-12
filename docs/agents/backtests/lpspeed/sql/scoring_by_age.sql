-- LP-SPEED (3): does a younger order score less? Polymarket says an order scores only if it "has been live for the
-- required duration" and does not say how long. Each live minute's turn reads /order-scoring for the orders resting from
-- earlier turns (pm_live.ts, "the minute's formula"); the minute row keeps a side's verdict (bid_scoring, ask_scoring).
-- Here each side's verdict is paired with the age, at the turn (minute + 3 s), of our one live order resting on that
-- side of that book (sides with two or more orders are left out); only minutes where the formula scored the side
-- (detail qBid / qAsk > 0: inside the spread, over the minimum). Read-only; 2026-10-10 01:14 to 2026-10-12 07:30 UTC.
-- The youngest orders read are ~55 s old (posted by the turn before), so it cannot speak for a few seconds.
with m as materialized (
  select cond, minute, s.yside, s.sc
  from pm_lp_minutes, lateral (values ('bid', bid_scoring, (detail->>'qBid')::numeric), ('ask', ask_scoring, (detail->>'qAsk')::numeric)) as s(yside, sc, q)
  where mode = 'live' and minute >= '2026-10-10 01:14+00' and minute < '2026-10-12 07:30+00' and s.sc is not null and s.q > 0
), o as materialized (
  select cond, case when (side = 'BUY') = (outcome = 'yes') then 'bid' else 'ask' end as yside,
         to_timestamp((response->'readBack'->>'created_at')::bigint) as c,
         least(coalesce(cancelled_at, 'infinity'), coalesce(filled_at, 'infinity'), to_timestamp(expiration - 60)) as e
  from pm_lp_orders where mode = 'live' and response->'readBack'->>'created_at' is not null and ts >= '2026-10-09 23:00+00' and ts < '2026-10-12 07:30+00'
), j as (
  select m.cond, m.minute, m.yside, bool_or(m.sc) as sc, count(*) as n, extract(epoch from m.minute + interval '3 seconds' - max(o.c)) as age
  from m join o on o.cond = m.cond and o.yside = m.yside and o.c < m.minute and o.e > m.minute + interval '3 seconds'
  group by 1, 2, 3
)
select string_agg(concat_ws(',', band, n, scoring, round(100.0 * scoring / n, 1)), E'\n' order by band) from (
  select case when age < 70 then '1: under 70 s' when age < 130 then '2: 70-130 s' when age < 300 then '3: 130-300 s' else '4: 300 s and over' end as band,
         count(*) as n, count(*) filter (where sc) as scoring
  from j where n = 1 group by 1
) z;
-- band, side-minutes, scoring, % scoring
