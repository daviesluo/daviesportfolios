-- Strip the stale overnight prices `snapshot-record` wrote for US
-- equities, so the 24H chart stops tearing.
--
-- Overnight (20:00-04:00 ET) Yahoo publishes no tape: `lastPrice` and
-- `extPrice` are both a frozen carry of the last regular print.
-- `recordablePrice` fell through to them whenever the T212 call — one
-- fetch for the WHOLE book — timed out, so every holding in that sample
-- dropped to its previous close together and the next sample lifted
-- them all back. Measured on 2026-08-25: MSTR was stored at 122.60 (its
-- overnight open) at 01:05, 01:15, 01:20, 01:40, 01:45 and 02:15 UTC
-- while the overnight tape had it between 124.81 and 126.00, and NVDA
-- showed its own frozen 208.80 at exactly the same six ticks. With
-- Extended Hours on, the 24H portfolio line swung more than a percent,
-- several times an hour, all night. The book never moved; the sample did.
--
-- Fixed at the source in the same commit (`isUsOvernightSession` now
-- refuses the Yahoo fallback), but rows already written keep their bad
-- numbers, so this removes them.
--
-- WHAT IT REMOVES, precisely: inside the US overnight window only, and
-- only the keys naming a ticker the overnight recorder covers. That
-- recorder (`overnight_intraday_points`, same T212 source) is the
-- authoritative overnight series and the chart already splices it in,
-- so those keys were redundant even when correct. Everything else in
-- the row survives — a CN fund or a German listing genuinely trades
-- during the US night and its samples are real observations.
--
-- Rows left with no prices at all are deleted rather than kept as `{}`.
--
-- Timezone-correct year-round: the window is computed in
-- America/New_York, not as a fixed UTC offset, so it stays right across
-- the DST changes.
--
-- Idempotent — re-running finds nothing left to strip. Applied by
-- `migrations.yml` on push to main; do NOT also run it by hand.

with covered as (
  select distinct ticker from public.overnight_intraday_points
),
overnight_rows as (
  select ps.ts, ps.prices
  from public.price_snapshots ps
  where extract(hour from (ps.ts at time zone 'America/New_York')) >= 20
     or extract(hour from (ps.ts at time zone 'America/New_York')) < 4
),
cleaned as (
  select r.ts,
         coalesce(
           (select jsonb_object_agg(k, v)
            from jsonb_each(r.prices) as e(k, v)
            where k not in (select ticker from covered)),
           '{}'::jsonb
         ) as kept
  from overnight_rows r
)
update public.price_snapshots ps
set prices = c.kept
from cleaned c
where ps.ts = c.ts
  and ps.prices is distinct from c.kept;

delete from public.price_snapshots
where prices = '{}'::jsonb;
