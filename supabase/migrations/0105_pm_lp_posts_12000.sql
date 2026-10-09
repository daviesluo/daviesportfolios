-- 0105: "Reward quotes live-prep" may send 12,000 POSTs a UTC day, up from 6,000.
--
-- Why. Davies, 2026-10-09, verbatim: "同意提到 12000". Live-prep has been live since 01:32:21 UTC and posts about 400
-- orders an hour: four or so of its markets re-price most minutes, and every order is refreshed before its GTD expiry.
-- That is about 9,100 a day, so its 6,000 governor would stop all its quoting near 16:15 UTC and leave nothing resting
-- for the rest of the day. Polymarket's own limits are per 10 seconds (reference §2d), far above 12,000 a day.
--
-- What this does, and nothing else.
--   1. `pm_lp_config`'s CHECK on `max_posts_day` (0091: 0 to 6000, named `pm_lp_config_max_posts_day_check` by
--      Postgres) admits 0 to 12000.
--   2. Live-prep's row: `max_posts_day = 12000`. No other column is written: not `dry_run`, `live_confirmed_at`,
--      `cap_total_usd`, nor `updated_at`. The arming trigger (0091) fires on the update and finds no other config armed,
--      as at the go.
-- Mini-pool's and mid-pool's configs, CHECKs and code ceiling (`PM_LIVE_MAX_POSTS_DAY`, 6,000) are untouched.
--
-- Safe in either deploy order. The turn uses min(config, code ceiling): live-prep's ceiling is `PM_LP_MAX_POSTS_DAY`
-- (12,000, `agents/pm_live.ts`, `lpLimits`) and was the shared 6,000 before. This first: min(12000, 6000) = 6000 until
-- the function deploys. The code first: min(6000, 12000) = 6000 until this applies. Only both raise it.
--
-- Safe while the path runs live. The path reads its config once a minute in a statement of milliseconds. Swapping the
-- CHECK and updating the one row take the table's exclusive lock until the commit, milliseconds later; `lock_timeout`
-- stops this waiting in the lock queue behind a long reader, where it would hold the path's read behind it: after 3 s
-- it fails instead, and migrations.yml says so. Applied twice it changes nothing more.

set lock_timeout = '3s';

alter table public.pm_lp_config drop constraint if exists pm_lp_config_max_posts_day_check;
alter table public.pm_lp_config add constraint pm_lp_config_max_posts_day_check check (max_posts_day >= 0 and max_posts_day <= 12000);

update public.pm_lp_config set max_posts_day = 12000 where id = 1 and max_posts_day is distinct from 12000;

reset lock_timeout;
