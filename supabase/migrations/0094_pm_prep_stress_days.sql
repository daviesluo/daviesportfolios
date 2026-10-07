-- 0094: the paper layers' worst case at the start of each UTC day, so "Reward quotes mini-pool", "mid-pool" and
-- "live-prep" show a WORST CASE on every day of their DAYS table, today's live, as RW's rows do (Davies, 2026-10-07:
-- "Reward quotes列表里后三个点开之后DAYS里worst case里没数据"; "WORST CASE目前是当天实时都可以显示吧？…之前的问题只是mini-pool、mid-pool、
-- live-prep 展开后 WORST CASE 列为空").
--
-- RW's engine stores its cumulative worst case at each day's close (`pm_rw_days.stress_total`); the order path's paper
-- layer (`agents/pm_prep.ts`, frozen) keeps only the running one, in its state. `agents/pm_prep_stress.ts`, called by each
-- layer's action after its turn, writes a row here a layer and a day: the cumulative worst case at the day's 00:00 UTC
-- and the accounts it sums. `source` says how it was made: `recorded` (the layer's own state, at rest after deciding
-- 23:59), `start` (its first day: 0, its accounts begin empty) or `replay` (the day before's row with the day's records
-- applied, for a day before this table or one whose turn at rest was missed). Nothing is backfilled here: the first turns
-- after the deploy write each layer's first day and replay the rest, two days a turn, oldest first.
--
-- `layer` is the layer's lease name (`pm-prep`: mini-pool's, `pm-midprep`: mid-pool's, `pm-lpprep`: live-prep's), its own
-- and never a display name.
--
-- No grant and no policy: row level security is on, and 0082's default privileges keep `anon` and `authenticated` from
-- the new table. Only the `agents` function reads and writes it, with the service role.
create table if not exists public.pm_prep_stress_days (
  layer       text not null check (layer in ('pm-prep', 'pm-midprep', 'pm-lpprep')),
  day         date not null,
  stress      numeric not null,
  parts       jsonb not null default '{}'::jsonb,
  source      text not null check (source in ('start', 'recorded', 'replay')),
  detail      jsonb,
  recorded_at timestamptz not null default now(),
  primary key (layer, day)
);

alter table public.pm_prep_stress_days enable row level security;
