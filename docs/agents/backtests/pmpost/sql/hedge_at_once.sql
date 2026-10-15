-- PMPOST: what "very short holds" and "hedge each fill at once" would have done on the live fills. Each entry (a BUY:
-- YES or NO, both phases) is closed straight away by a taker order at the others' touch on the other side: a YES
-- bought is sold at the best bid, a NO bought (a YES sold, in YES terms) is sold at 1 − the best ask. A hedge through a
-- negative-risk set's complements costs at least this much (selling YES at the bid and buying every other outcome's YES
-- lock the same $1 unless the set is mispriced, which PMOPPS found in 7 episodes in 8 days). Two timings: in the fill's
-- own minute (the touch the turn read) and one minute later. Gross of the taker fee (a fee-enabled market charges one
-- on top). Against it: what the same entries actually made, held as they were (to their exits, marked now or at the
-- payout: d · (mfin − y) · s summed over the entries, which counts each entry's drift to the end). Read-only.
with mk as (select distinct on (cond) cond, yes_token from pm_lp_markets order by cond, day desc),
f as (
  select f.cond, f.side, f.price::numeric p, f.size::numeric s, f.match_time t, (f.token = mk.yes_token) yes
  from pm_lp_fills f join mk on mk.cond = f.cond where f.status = 'CONFIRMED' and f.side = 'BUY'),
g as (
  select f.*, case when f.yes then f.p else 1 - f.p end y, case when f.yes then 1 else -1 end d,
    (select row(m.bb, m.ba)::text from pm_lp_minutes m where m.mode = 'live' and m.cond = f.cond and m.minute <= f.t and m.bb is not null and m.ba is not null order by m.minute desc limit 1) b0,
    (select row(m.bb, m.ba)::text from pm_lp_minutes m where m.mode = 'live' and m.cond = f.cond and m.minute >= f.t + interval '60 s' and m.bb is not null and m.ba is not null order by m.minute asc limit 1) b1,
    coalesce(st.payout::numeric, (select (m.bb + m.ba) / 2 from pm_lp_minutes m where m.mode = 'live' and m.cond = f.cond and m.bb is not null and m.ba is not null order by m.minute desc limit 1)) mfin,
    min(f.t) over (partition by f.cond) first_t
  from f left join pm_lp_settlements st on st.cond = f.cond),
h as (
  select g.*, split_part(trim(both '()' from b0), ',', 1)::numeric bb0, split_part(trim(both '()' from b0), ',', 2)::numeric ba0,
    split_part(trim(both '()' from b1), ',', 1)::numeric bb1, split_part(trim(both '()' from b1), ',', 2)::numeric ba1,
    case when first_t < '2026-10-13 13:25:32+00' then 'S2' else 'Q2' end phase
  from g where b0 is not null)
select phase, count(*) entries, round(sum(s), 0) shares,
  round(sum(d * s * ((case when d = 1 then bb0 else ba0 end) - y)), 2) hedge_same_minute,
  round(100 * sum(d * s * ((case when d = 1 then bb0 else ba0 end) - y)) / sum(s), 2) hedge_c,
  round(sum(d * s * ((case when d = 1 then bb1 else ba1 end) - y)) filter (where b1 is not null), 2) hedge_one_minute,
  round(100 * sum(d * s * ((case when d = 1 then bb1 else ba1 end) - y)) filter (where b1 is not null) / sum(s) filter (where b1 is not null), 2) hedge1_c,
  round(sum(d * s * (coalesce(mfin, y) - y)), 2) held_as_run, round(100 * sum(d * s * (coalesce(mfin, y) - y)) / sum(s), 2) held_c,
  round(100 * avg(ba0 - bb0), 2) mean_touch_c
from h group by rollup (phase) order by phase nulls last;
