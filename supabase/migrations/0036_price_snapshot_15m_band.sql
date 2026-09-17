-- Keep the 26 h → 8 d band at 15-minute resolution, not 30.
--
-- The prune bands in `0029` were written to match the chart read
-- buckets one for one: 5 min for the 24 H window, 30 min for 1W, 1 h
-- for 1M, 4 h for 3M, 1 day for YTD. 1W has since moved from 60-minute
-- to 15-minute bars, so the band that feeds it was coarsening away
-- exactly the density the chart now asks for — the recorded stretch of
-- a 1W chart drew at half the resolution of the fetched stretch beside
-- it, and the seam showed.
--
-- Only the 26 h → 8 d band changes. Every other band already matches
-- its range (3M reads at 4 h and the 35 d → 100 d band is already 4 h).
-- Cost: that band doubles from ~330 rows to ~660, which is nothing
-- against the 400-day retention.
--
-- Rows ALREADY coarsened to 30 minutes cannot be recovered; this only
-- changes what survives from here on, so the seam heals as the window
-- rolls forward over the next eight days.

create or replace function public.prune_price_snapshots(_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n int := 0;
  k int;
begin
  delete from public.price_snapshots s
  where s.ts < _now - interval '400 days';
  get diagnostics k = row_count;
  n := n + k;

  delete from public.price_snapshots s
  where s.ts < _now - interval '100 days'
    and s.ts >= _now - interval '400 days'
    and s.ts not in (
      select max(x.ts) from public.price_snapshots x
      where x.ts < _now - interval '100 days'
        and x.ts >= _now - interval '400 days'
      group by floor(extract(epoch from x.ts) / 86400)
    );
  get diagnostics k = row_count;
  n := n + k;

  delete from public.price_snapshots s
  where s.ts < _now - interval '35 days'
    and s.ts >= _now - interval '100 days'
    and s.ts not in (
      select max(x.ts) from public.price_snapshots x
      where x.ts < _now - interval '35 days'
        and x.ts >= _now - interval '100 days'
      group by floor(extract(epoch from x.ts) / 14400)
    );
  get diagnostics k = row_count;
  n := n + k;

  delete from public.price_snapshots s
  where s.ts < _now - interval '8 days'
    and s.ts >= _now - interval '35 days'
    and s.ts not in (
      select max(x.ts) from public.price_snapshots x
      where x.ts < _now - interval '8 days'
        and x.ts >= _now - interval '35 days'
      group by floor(extract(epoch from x.ts) / 3600)
    );
  get diagnostics k = row_count;
  n := n + k;

  delete from public.price_snapshots s
  where s.ts < _now - interval '26 hours'
    and s.ts >= _now - interval '8 days'
    and s.ts not in (
      select max(x.ts) from public.price_snapshots x
      where x.ts < _now - interval '26 hours'
        and x.ts >= _now - interval '8 days'
      group by floor(extract(epoch from x.ts) / 900)
    );
  get diagnostics k = row_count;
  n := n + k;

  return n;
end;
$$;

revoke execute on function public.prune_price_snapshots(timestamptz) from public;
grant  execute on function public.prune_price_snapshots(timestamptz) to postgres;
