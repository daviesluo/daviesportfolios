-- IP-keyed failed-login bookkeeping for the `auth` Edge Function.
-- The function reads/writes via the service-role key. Anon access is denied
-- at the table level by enabling RLS without any policies (default deny).
--
-- To apply: paste this SQL into Supabase Dashboard → SQL Editor → Run.

create table if not exists public.auth_attempts (
  ip            text  primary key,
  attempts      int   not null default 0,
  lockout_until bigint,                                 -- unix ms
  updated_at    timestamptz not null default now()
);

alter table public.auth_attempts enable row level security;

-- Atomic increment-or-lockout. Each call either (a) inserts a new row at
-- attempts=1, or (b) increments the existing counter, or (c) crosses the
-- max-attempts threshold and rotates the row into "locked: counter reset to
-- 0, lockout_until set to now+lockout_ms". All three paths run inside a
-- single UPDATE so concurrent wrong-password requests can't race-read the
-- same `attempts` value and undercount.
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
as $$
declare
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  result record;
begin
  insert into public.auth_attempts as t (ip, attempts, lockout_until, updated_at)
    values (_ip, 1, null, now())
  on conflict (ip) do update
    set attempts      = case when t.attempts + 1 >= _max then 0
                              else t.attempts + 1 end,
        lockout_until = case when t.attempts + 1 >= _max then now_ms + _lockout_ms
                              else t.lockout_until end,
        updated_at    = now()
  returning t.attempts, t.lockout_until into result;

  return query
    select result.attempts,
           result.lockout_until,
           (result.lockout_until is not null and result.lockout_until > now_ms);
end $$;

-- The service role (used by the Edge Function) can execute the function.
grant execute on function public.bump_auth_attempt(text, int, bigint) to service_role;
