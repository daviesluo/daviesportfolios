-- Client-side observability sink. The `ops-error` Edge Function inserts
-- one row per reported error (fetch failures, auth flakes, render
-- crashes). Anon access is denied at the table level — only the service
-- role can write, only the dashboard owner can read.
--
-- To apply: paste this SQL into Supabase Dashboard → SQL Editor → Run.

create table if not exists public.ops_errors (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  kind        text not null,           -- 'fetch.histbatch', 'fetch.histsingle', 'auth.unexpected', 'render.crash', etc.
  symbol      text,                    -- ticker / symbol when applicable
  message     text,                    -- short human-readable explanation
  context     jsonb,                   -- { range, interval, attempts, status, ua, ... }
  ip          text                     -- captured server-side from x-forwarded-for
);

create index if not exists ops_errors_created_at_idx
  on public.ops_errors (created_at desc);
create index if not exists ops_errors_kind_created_at_idx
  on public.ops_errors (kind, created_at desc);

alter table public.ops_errors enable row level security;
-- No policies → all anon/authenticated reads/writes denied. The Edge
-- Function inserts via the service-role key.
