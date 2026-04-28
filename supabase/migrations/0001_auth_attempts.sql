-- IP-keyed failed-login bookkeeping for the `auth` Edge Function.
-- The function reads/writes this table via the service-role key. Anon
-- access is denied at the table level by enabling RLS without any
-- policies (default deny).
--
-- To apply: paste this SQL into Supabase Dashboard → SQL Editor → Run.

create table if not exists public.auth_attempts (
  ip            text  primary key,
  attempts      int   not null default 0,
  lockout_until bigint,                                 -- unix ms
  updated_at    timestamptz not null default now()
);

alter table public.auth_attempts enable row level security;

-- No policies → only service role can read/write. The Edge Function
-- already authenticates with SUPABASE_SERVICE_ROLE_KEY, so no policy
-- statements are needed for it to work.
