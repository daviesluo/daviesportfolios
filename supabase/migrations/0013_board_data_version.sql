-- Optimistic concurrency on board_data.
--
-- Today the `data` Edge Function does a last-write-wins UPSERT on
-- id=1. Two tabs (or a phone + a laptop) both loaded at version V can
-- both save and the later write silently clobbers the earlier — the
-- portfolio_remote.js BroadcastChannel + fingerprint guard close most
-- of the obvious cases, but anything that bypasses them (offline tab
-- coming back online; second device that wasn't subscribed to the
-- channel; a slow network round-trip overtaking another) still loses
-- edits with no audible signal anywhere.
--
-- This migration adds:
--   1. A monotonic `version` counter on board_data (default 0; every
--      successful save increments by 1).
--   2. A `save_board_data(_data, _if_match)` RPC that atomically:
--        - inserts the row when there's no row yet (cold project),
--        - on UPSERT, checks `version = _if_match` in the WHERE and
--          increments by 1 — so two concurrent saves with the same
--          _if_match can't both win; the second one's WHERE fails
--          and it returns conflict.
--        - when _if_match IS NULL the version check is skipped
--          (backward-compatible path for any old client / one-off
--          script that hasn't been updated to send If-Match yet).
--
-- The `data` Edge Function passes the client's `If-Match` header
-- through as _if_match; the client (portfolio_remote.js) tracks the
-- version returned from the last load/save and sends it back on
-- the next save.
--
-- Old-row migration: existing rows get version=0 from the column
-- default. The first save with a new client will set version=1,
-- and from then on optimistic concurrency is enforced.
--
-- To apply: paste into Supabase Dashboard → SQL Editor → Run.

alter table public.board_data
  add column if not exists version bigint not null default 0;

create or replace function public.save_board_data(
  _data     jsonb,
  _if_match bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_version bigint;
  new_version     bigint;
  rc              int;
begin
  -- Snapshot the current version (NULL if no row yet — cold project
  -- with the migration applied but nothing ever saved).
  select version into current_version from public.board_data where id = 1;

  -- Optimistic check. NULL _if_match means the client opted out
  -- (legacy path); any client that has a version SHOULD send it.
  -- Cold-project special case: when no row exists yet, an If-Match
  -- of 0 matches (treats "I expected version 0" as "I expected an
  -- empty store"), which is what the client sees on its very first
  -- load before any save has happened.
  if _if_match is not null then
    if current_version is null then
      if _if_match <> 0 then
        return jsonb_build_object(
          'ok', false,
          'conflict', true,
          'current_version', 0
        );
      end if;
    elsif _if_match <> current_version then
      return jsonb_build_object(
        'ok', false,
        'conflict', true,
        'current_version', current_version
      );
    end if;
  end if;

  -- Atomic UPSERT with a guarded UPDATE. The WHERE on the DO UPDATE
  -- branch re-checks the version (when supplied) so two parallel
  -- callers passing the same _if_match can't both win the race
  -- — one's WHERE will see the other's increment.
  new_version := coalesce(current_version, 0) + 1;
  insert into public.board_data (id, data, version, updated_at)
    values (1, _data, new_version, now())
  on conflict (id) do update
    set data       = excluded.data,
        version    = excluded.version,
        updated_at = now()
    where _if_match is null
       or public.board_data.version = _if_match;

  get diagnostics rc = row_count;
  if rc = 0 then
    -- WHERE on the UPDATE failed → someone wrote between our SELECT
    -- and our UPSERT. Re-read and return conflict so the client
    -- doesn't silently believe the save succeeded.
    select version into current_version from public.board_data where id = 1;
    return jsonb_build_object(
      'ok', false,
      'conflict', true,
      'current_version', current_version
    );
  end if;

  return jsonb_build_object('ok', true, 'version', new_version);
end $$;

revoke all on function public.save_board_data(jsonb, bigint) from public;
grant execute on function public.save_board_data(jsonb, bigint) to service_role;
