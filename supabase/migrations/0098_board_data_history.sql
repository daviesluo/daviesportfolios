-- 0098: the portfolio keeps its earlier versions.
--
-- Why (review F9, approved by Davies 2026-10-08). `board_data` is one row, and every save overwrites it
-- (`save_board_data`, 0013): a save that loses shares, from a bug in a sync or an edit made by mistake, could only be
-- undone from the platform's backups. This book has lost shares to a sync before (the skill's Trading 212 section).
-- So each change to the row first copies the version it replaces into `board_data_history`, kept 90 days.
--
-- What it costs: the row is about 25 kB stored (jsonb, compressed), and it is saved a few times a day (version 495 on
-- 2026-10-08), so 90 days of versions is a few MB. A save that does not change `data` copies nothing.
--
-- Who can read it: nobody but the service role and postgres, like every table here since 0082 (RLS on, no policy, no
-- grant to anon or authenticated). Nothing in the app reads it; a version is restored by hand, by its `version`:
--   update public.board_data set data = (select data from public.board_data_history where version = <v>
--     order by id desc limit 1), updated_at = now() where id = 1;
-- (which itself copies the version it replaces first).

create table if not exists public.board_data_history (
  id          bigint generated always as identity primary key,
  board_id    int not null,
  version     bigint not null,
  data        jsonb not null,
  saved_at    timestamptz,                         -- when the replaced version was saved (its `updated_at`)
  replaced_at timestamptz not null default now()   -- when it was replaced, or the row deleted
);
create index if not exists board_data_history_replaced_at on public.board_data_history (replaced_at);
alter table public.board_data_history enable row level security;
revoke all on table public.board_data_history from anon, authenticated;

create or replace function public.board_data_keep_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or old.data is distinct from new.data then
    insert into public.board_data_history (board_id, version, data, saved_at)
    values (old.id, old.version, old.data, old.updated_at);
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;
revoke all on function public.board_data_keep_history() from public, anon, authenticated;

drop trigger if exists board_data_keep_history on public.board_data;
create trigger board_data_keep_history
  after update or delete on public.board_data
  for each row execute function public.board_data_keep_history();

-- Ninety days of versions, pruned once a day (SQL only, no Edge call).
select cron.schedule(
  'board-data-history-prune',
  '55 10 * * *',
  $$ delete from public.board_data_history where replaced_at < now() - interval '90 days'; $$
);
