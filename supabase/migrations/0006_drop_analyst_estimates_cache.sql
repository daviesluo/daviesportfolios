-- Drop the analyst-estimates cache table. It backed the 3-year
-- EPS-growth CAGR that fed PEG, sourced from FMP's
-- /v3/analyst-estimates endpoint. PR #114 removed the entire FMP
-- layer (its free tier started returning 403/402 mid-2025), so
-- nothing reads or writes this table anymore — PEG now uses
-- Yahoo's 5-year EPS-growth figure, computed inline in the
-- `fundamentals` Edge Function with no server-side cache.
--
-- 0005's `create table` stays in history (it was applied to
-- production); this is the forward migration that retires it,
-- rather than editing 0005 in place.
--
-- To apply: paste this SQL into Supabase Dashboard → SQL Editor → Run.

drop table if exists public.analyst_estimates_cache;
