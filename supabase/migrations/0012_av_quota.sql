-- Daily-quota guardrail for Alpha Vantage calls.
--
-- AV's free tier is 25 calls / day per API key. The fundamentals
-- function normally hits this at ~4 calls / day (4 ETFs × 1 cache
-- miss / 24 h), comfortably under the cap. But if the
-- `index_fundamentals_cache` table becomes unreadable (RLS rule
-- regression, env-var typo on rotation, migration not applied to a
-- fresh project), every Edge invocation goes cold and the 25-call
-- budget evaporates in a few hours of normal traffic — then the
-- next 23 h of users see the hardcoded `INDEX_PE_FALLBACK`
-- constants as if they were live.
--
-- This migration adds a single-row-per-UTC-day counter + an atomic
-- claim RPC. The fundamentals function calls `try_claim_av_call(20)`
-- (cap at 20 so there's a 5-call buffer for human-triggered tests /
-- one-off probes) BEFORE every live AV call. The RPC's
-- `INSERT ... ON CONFLICT DO UPDATE WHERE` is atomic at the row
-- level, so two concurrent Edge invocations can't both squeak past
-- the threshold check.
--
-- Old rows are not cleaned up here — the table grows by one row per
-- day (~365 rows / year), which is dust. If needed, a future cron
-- can prune > 30 days.
--
-- To apply: paste into Supabase Dashboard → SQL Editor → Run.

create table if not exists public.av_quota (
  utc_day date primary key,
  calls   int not null default 0
);

alter table public.av_quota enable row level security;
-- Service role only; no policies needed since no anon / authenticated
-- caller has any business reading or writing this table.

create or replace function public.try_claim_av_call(max_calls int)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rc int;
begin
  -- First call of the day: row doesn't exist → INSERT (calls=1).
  -- Subsequent calls below threshold: row exists → UPDATE increments.
  -- Subsequent calls at/above threshold: UPDATE's WHERE fails → no
  -- write → row_count = 0 → return false. (INSERT path always
  -- succeeds with calls=1; the WHERE only gates the UPDATE branch.)
  insert into public.av_quota (utc_day, calls)
  values ((now() at time zone 'utc')::date, 1)
  on conflict (utc_day) do update
    set calls = public.av_quota.calls + 1
    where public.av_quota.calls < max_calls;
  get diagnostics rc = row_count;
  return rc > 0;
end $$;

revoke all on function public.try_claim_av_call(int) from public;
grant execute on function public.try_claim_av_call(int) to service_role;
