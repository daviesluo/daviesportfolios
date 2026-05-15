-- Atomic refresh claim for the trading212 Edge Function.
--
-- The function does a single conditional UPSERT against
-- `trading212_cache`: bump `updated_at` to now() only when the
-- existing row is older than `ttl_ms` (or no row exists yet). The
-- function returns whether the row was actually written. Because
-- `INSERT ... ON CONFLICT DO UPDATE WHERE` is atomic at the row
-- level in Postgres, two concurrent workers racing the call will
-- see at most one `true` return value — so at most one of them
-- will call the live T212 API in any given window, regardless of
-- how many Edge Function workers are running.
--
-- This kills the boundary race the Edge Function's old re-read
-- mitigation only partially handled: two visitors arriving in the
-- same millisecond just after the TTL would each pass the freshness
-- check and each fire a live T212 call, which is exactly the case
-- T212's rate limit (1 req / 30 s on `/equity/portfolio`) punishes.
-- Now the loser of the claim re-reads the cache and serves whatever
-- the winner just wrote, no upstream call.
--
-- `security definer` so the Edge Function (which authenticates as
-- the service role) can call it without granting public write
-- access to the cache table.

create or replace function public.try_claim_t212_refresh(ttl_ms int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  rc int;
begin
  insert into public.trading212_cache (id, data, updated_at)
  values (1, '{}'::jsonb, now())
  on conflict (id) do update
    set updated_at = excluded.updated_at
    where public.trading212_cache.updated_at
        < now() - make_interval(secs => ttl_ms / 1000.0);
  get diagnostics rc = row_count;
  return rc > 0;
end;
$$;

-- Service role calls this; anon / authenticated have no business
-- forcing a cache refresh.
revoke all on function public.try_claim_t212_refresh(int) from public;
grant execute on function public.try_claim_t212_refresh(int) to service_role;
