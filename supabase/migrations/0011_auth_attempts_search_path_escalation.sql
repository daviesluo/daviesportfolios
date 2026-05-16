-- Two hardening changes to the auth attempt limiter (0001).
--
-- 1. `security definer` + explicit `set search_path = public, pg_temp`.
--    Without the search_path lock, a malicious schema-shadow attacker
--    could create a `public.auth_attempts` table in a schema earlier
--    on the default search_path and have the function operate on
--    their fake table instead of ours. The 0008 RPC was created with
--    the lock; this brings 0001 to parity.
--
-- 2. Escalating lockout: each time an IP crosses the max-attempts
--    threshold, the lockout window doubles (24h → 48h → 96h → ...),
--    capped at 30 days. Without this, an attacker who patiently
--    waited out the 24h could try another 3 wrong passwords every
--    24h forever, with no penalty escalation. With doubling, the
--    attacker's wait grows superlinearly while a legitimate user
--    (who realistically only triggers a lockout once) is unaffected.
--
-- New column `lockouts` tracks how many times this IP has crossed
-- the threshold; the function reads it on the next cross to compute
-- the doubled window. No decay — a busy attacker pays the
-- compounding penalty for as long as they keep going.
--
-- To apply: paste into Supabase Dashboard → SQL Editor → Run.

alter table public.auth_attempts
  add column if not exists lockouts int not null default 0;

create or replace function public.bump_auth_attempt(
  _ip          text,
  _max         int,
  _lockout_ms  bigint
)
returns table (
  attempts_out      int,
  lockout_until_out bigint,
  locked_out        boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  now_ms       bigint := (extract(epoch from now()) * 1000)::bigint;
  -- 30 days in ms — the ceiling on escalated lockout windows so a
  -- single IP can't be locked for years from one bad afternoon.
  max_ms       bigint := 30::bigint * 86400::bigint * 1000::bigint;
  result       record;
begin
  insert into public.auth_attempts as t (ip, attempts, lockout_until, lockouts, updated_at)
    values (_ip, 1, null, 0, now())
  on conflict (ip) do update
    set attempts = case when t.attempts + 1 >= _max then 0
                        else t.attempts + 1 end,
        lockouts = case when t.attempts + 1 >= _max then t.lockouts + 1
                        else t.lockouts end,
        lockout_until = case when t.attempts + 1 >= _max then
                          now_ms + least(
                            _lockout_ms * (1::bigint << least(t.lockouts, 30)),
                            max_ms
                          )
                        else t.lockout_until end,
        updated_at = now()
  returning t.attempts, t.lockout_until into result;

  return query
    select result.attempts,
           result.lockout_until,
           (result.lockout_until is not null and result.lockout_until > now_ms);
end $$;

grant execute on function public.bump_auth_attempt(text, int, bigint) to service_role;
