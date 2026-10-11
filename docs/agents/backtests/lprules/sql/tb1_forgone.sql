-- LP-RULES: the reward TB1's skip gave up live. In each live minute of a market taking entries that rested nothing in a
-- book one tick wide (bid_price and ask_price null, ba - bb <= tick), RW's quote would have joined the touch (its bid
-- at the best bid, its ask at the best ask: `quote` on a one-tick book). Where both touch levels already hold the reward
-- minimum (ab = bb, aa = ba), the adjusted mid is the touch's middle, each of our N-share sides sits half a tick from
-- it, and RW's formula would have been rate / 1440 × Q / (Q + others): Q = N × ((v − d) / v)², d = 50 × tick cents,
-- others = othersOf(m, q1, q2) on the minute's recorded scores of the rest of the book. Minutes whose touch holds less
-- than the minimum are counted apart (their formula needs the deeper book). Formula only: what the skip saved in fills
-- is not in the live record. Read-only.
with m as (
  select (minute at time zone 'utc')::date d, cond, rate::numeric rate, max_spread::numeric v, min_size::numeric ms,
    tick::numeric tick, bb::numeric bb, ba::numeric ba, ab::numeric ab, aa::numeric aa, q1::numeric q1, q2::numeric q2,
    coalesce((detail->'lp'->>'n')::numeric, 20) n
  from pm_lp_minutes
  where mode = 'live' and detail->'lp'->>'state' = 'quote' and bid_price is null and ask_price is null and ba::numeric - bb::numeric <= tick::numeric + 1e-9),
h as (
  select m.*, (ab + aa) / 2 mid, n * power(greatest(v - 50 * tick, 0) / v, 2) qo,
    case when (ab + aa) / 2 between 0.10 and 0.90 then greatest(least(q1, q2), (q1 + q2) / 3) else least(q1, q2) end oth,
    (ab = bb and aa = ba) at_touch
  from m)
select d, count(*) mm, count(*) filter (where at_touch) mm_touch_holds_min, count(distinct cond) markets,
  round(sum(rate / 1440 * qo / (qo + oth)) filter (where at_touch and qo > 0), 2) formula_forgone,
  round(avg(qo / (qo + oth)) filter (where at_touch and qo > 0), 3) mean_share
from h group by rollup (d) order by d nulls last;
