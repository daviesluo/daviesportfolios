-- 0134: the analyst targets behind the "Target price" page, written by a scheduled job rather than fetched by the browser.
--
-- On whose word. Davies, 2026-10-21 (relayed in English): a "Target price" page after Sector list, and the table "should
-- update itself automatically": on a US trading day when pre-market starts (04:00 ET), at the open (09:30 ET) and at the
-- close (16:00 ET); on weekends and market holidays once a day at 09:30 ET.
--
--   analyst_targets        one row a holding: its latest snapshot (`targets/compute.ts`: a stock's sell-side consensus
--                          from Yahoo, an ETF's holdings-weighted target, bitcoin's hand-kept bank targets), the slot it
--                          was written for and when. The page reads it through the `targets` function's GET, in the app's
--                          preload.
--   analyst_targets_state  one row: the last slot done, a slot claimed by a run still working (so a second call in its
--                          minute does nothing), a day's cache of Alpha Vantage's ETF holdings, the last error.
--   a call                 `targets`, every minute. It runs only when a slot is due (`targets/schedule.ts`: America/New_York
--                          wall clock, the shared US market calendar's holidays and 13:00 early closes), so 1,436 of a
--                          day's calls answer at once. Its beat is written first (0075); `retry` true: a second run finds
--                          the slot claimed and does nothing. 55 s at most, under the minute (0099).
--
-- No grant and no policy: row level security is on, and 0082's default privileges keep `anon` and `authenticated` out.
-- ⚠️  As 0075: the call's URL is the PRODUCTION project's Edge host.

set lock_timeout = '3s';

create table if not exists public.analyst_targets (
  ticker   text primary key,
  slot     timestamptz not null,
  as_of    timestamptz not null,
  payload  jsonb not null
);

create table if not exists public.analyst_targets_state (
  id            integer primary key check (id = 1),
  last_slot     timestamptz,
  claimed_slot  timestamptz,
  claimed_at    timestamptz,
  cache         jsonb not null default '{}'::jsonb,
  updated_at    timestamptz,
  last_error    text
);
insert into public.analyst_targets_state (id) values (1) on conflict (id) do nothing;

alter table public.analyst_targets       enable row level security;
alter table public.analyst_targets_state enable row level security;

insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('targets', 55000, 1, 23, true) on conflict (path) do nothing;

reset lock_timeout;
