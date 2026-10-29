-- 0161: which IG environment wrote each row of the `ig` function's tables (`supabase/functions/ig/`; amendment
-- docs/agents/backtests/ig_deepdive/DEVIATION-2-live-prices.md).
--
-- On whose word. Davies, 2026-10-29: "同意，按方案1改". The `ig` function (G1 facts, G2 history, G4's weekend recorder) moves
-- from IG's demo login to IG's LIVE login, for reading prices only; dealing stays impossible (its client refuses every
-- call but login, the switch between the login's two accounts, log-out and a fixed list of GETs, on the live host only,
-- before anything is sent). IG's demo login is IGBOT's alone: IG keeps one current account per user, the recorder switches
-- accounts every minute, and the restored demo secrets were IGBOT's own login, so the two refused each other
-- (401 error.security.account-token-invalid in `igbot_requests`, 2026-10-29 00:15-00:31 UTC).
--
-- What it does. `environment text not null default 'demo'`, 'demo' or 'live', on ig_facts, ig_price_pulls, ig_quotes,
-- ig_quote_runs and ig_action_log. Every row already there is the demo login's and keeps 'demo' (the default fills it);
-- the function writes 'live' from its next deploy on. Both are kept; a reading says which it used.
--   * ig_facts: its lookup index leads with the environment, since the recorder reads the newest ok row of each account
--     kind with `environment = 'live'` (a demo account id is never tried on the live login).
--   * ig_price_pulls: "this window is done" is per environment (the live login's allowance and answers are its own).
--   * ig_quotes: the key and `ig_quotes_record`'s "same quote as the newest row" are per environment, so a live quote never
--     extends a demo row of the same epic. The function takes each sample's `environment`; a sample without one is 'demo',
--     as the column's default says (the function as deployed before this migration sends none).
--
-- Its size (2026-10-29 00:50 UTC, read-only): ig_quotes 23,625 rows (5.5 MB), ig_quote_runs 7,550, ig_price_pulls 53,
-- ig_facts 5, ig_action_log 11. A constant default adds no rewrite; the rebuilt key and indexes are a moment's work. The
-- recorder's row (`ig?action=quotes`) is off until Friday 21:35 UK (`public.ig_quotes_window`).
--
-- No grant to anon or authenticated, no policy: row level security stays on, and 0082's default privileges keep them out.
-- The record function stays the service role's alone.

set lock_timeout = '3s';

alter table public.ig_facts       add column if not exists environment text not null default 'demo' check (environment in ('demo', 'live'));
alter table public.ig_price_pulls add column if not exists environment text not null default 'demo' check (environment in ('demo', 'live'));
alter table public.ig_quotes      add column if not exists environment text not null default 'demo' check (environment in ('demo', 'live'));
alter table public.ig_quote_runs  add column if not exists environment text not null default 'demo' check (environment in ('demo', 'live'));
alter table public.ig_action_log  add column if not exists environment text not null default 'demo' check (environment in ('demo', 'live'));

drop index if exists public.ig_facts_kind_id;
create index if not exists ig_facts_env_kind_id on public.ig_facts (environment, account_kind, id desc);

drop index if exists public.ig_price_pulls_done;
create unique index if not exists ig_price_pulls_done on public.ig_price_pulls (environment, account_kind, epic, window_key) where ok;

alter table public.ig_quotes drop constraint if exists ig_quotes_pkey;
alter table public.ig_quotes add constraint ig_quotes_pkey primary key (environment, account_kind, epic, ts);

-- As 0122's, with the environment in the newest-row lookup, the row and the conflict key.
create or replace function public.ig_quotes_record(samples jsonb)
returns integer
language plpgsql
set search_path = ''
as $fn$
declare
  s jsonb;
  env text;
  last_row public.ig_quotes;
  t timestamptz;
  started integer := 0;
begin
  for s in select * from jsonb_array_elements(samples) loop
    t := (s->>'received_at')::timestamptz;
    env := coalesce(s->>'environment', 'demo');
    select * into last_row from public.ig_quotes q
      where q.environment = env and q.account_kind = s->>'account_kind' and q.epic = s->>'epic'
      order by q.ts desc limit 1;
    if found and last_row.ts <= t
       and last_row.bid is not distinct from (s->>'bid')::numeric
       and last_row.offer is not distinct from (s->>'offer')::numeric
       and last_row.market_status = s->>'market_status' then
      update public.ig_quotes set seen_until = greatest(seen_until, t), reads = reads + 1
        where environment = last_row.environment and account_kind = last_row.account_kind and epic = last_row.epic and ts = last_row.ts;
    else
      insert into public.ig_quotes (environment, account_kind, account_id, epic, ts, seen_until, bid, offer, market_status, update_time, update_time_utc, delay_time)
      values (env, s->>'account_kind', s->>'account_id', s->>'epic', t, t, (s->>'bid')::numeric, (s->>'offer')::numeric,
              s->>'market_status', s->>'update_time', s->>'update_time_utc', (s->>'delay_time')::integer)
      on conflict (environment, account_kind, epic, ts) do nothing;
      started := started + 1;
    end if;
  end loop;
  return started;
end $fn$;
revoke all on function public.ig_quotes_record(jsonb) from public, anon, authenticated;
grant execute on function public.ig_quotes_record(jsonb) to service_role;

reset lock_timeout;
