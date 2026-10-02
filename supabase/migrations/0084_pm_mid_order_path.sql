-- 0084: "Reward quotes mid-pool" becomes the same real order path as mini-pool, still a dry-run and unarmed; and the two
-- paths, which trade ONE Polymarket account, can never both be armed.
--
-- On whose word. Davies, 2026-10-02 (~17:15 UTC), verbatim:
--
--   把mid-pool 的结构和路径也做成和mini-pool一样的真实下单路径，按上线规模跑 dry-run，之后更好对比，现在就做不要等
--
-- In English: make mid-pool's structure and path the same real order-placing path as mini-pool's, run its dry-run at the
-- go-live size, so the two compare better later; do it now, don't wait.
--
-- What changes. 0081 held mid-pool in dry-run in three places of its own: its config refused `dry_run` false and any
-- `live_confirmed_at`, its orders refused every mode but `dry_run`, and its action read no signing key and built a wire
-- that refused every POST and DELETE. From this push mid-pool's action is mini-pool's (agents/index.ts): it loads
-- POLYMARKET_PRIVATE_KEY, kept only when its address is the stored signer, reads the account's pUSD every minute
-- (`pm_mid_state.state`: `keyed`, `signerProblem`, `pusd`), and builds the same keyed wire, whose POST and DELETE leave only
-- when the turn is live. So, as for mini-pool since 0076, what keeps every order home is the config row: `dry_run` true
-- and `live_confirmed_at` null, which this file does not touch. It drops 0081's two config CHECKs and lets an order be
-- `live` (0074's own CHECK on `pm_live_orders`). Its sizes stay 0081's, mini-pool's at the $400 deposit: eight markets
-- and $160 of first quotes, $320 in all, $60 a market, -$25 a day and -$75 in all, GTD orders of 600 s.
--
-- One account, never both armed. Both rows sign for the same funder and signer and read the same pUSD. Two armed paths
-- would each size its buys against the whole balance, and the cancel-all of the global pause takes both paths' orders.
-- So a trigger on each config refuses any row that is armed (`live_confirmed_at` not null) while the other row is: the
-- go-time statement of either, or a hand-written update, fails whole, and the row stays as it was. A transaction-scoped
-- advisory lock makes two arming transactions take turns, so the second reads the first's committed row. "Armed" is
-- `live_confirmed_at`, the path's own `armed` (`state.armed`): with it cleared a path opens nothing and still sells what
-- it holds, so the other may be armed while the first winds down. Each go-time statement also refuses while the other
-- row is armed (docs/agents/reviews/2026-10-01-polymarket-live-calibration.md, step 8 and step 8m).
--
-- Mid-pool's go-time statement is in that design doc beside mini-pool's, with the same checks: the cap from the path's
-- own pUSD read, refused when unread, older than five minutes or under $81; the key loaded for the stored signer; its
-- last turn run from eu-west-1; Davies' Ireland attestation current; the other path unarmed. No session and no routine
-- runs either: a path goes live only in the conversation where Davies says go. Mid-pool's pre-registration
-- (docs/agents/reviews/2026-10-02-polymarket-mid-pool-prereg.md, its Addendum 1, written before its d1) records this
-- change and why its fourteen days stay the same test; mini-pool's (2026-10-01-polymarket-live-prep-prereg.md, its
-- Addendum 5, written before its window) records the trigger on its config. No code of agents/pm_live.ts or
-- agents/pm_prep.ts changes, and no row of either config, of `public.edge_calls` or of any other table is written.

alter table public.pm_mid_config drop constraint if exists pm_mid_config_dry_run_check;
alter table public.pm_mid_config drop constraint if exists pm_mid_config_live_confirmed_at_check;

alter table public.pm_mid_orders drop constraint if exists pm_mid_orders_mode_check;
alter table public.pm_mid_orders add constraint pm_mid_orders_mode_check check (mode in ('dry_run', 'live'));

-- Fired after a row of either config is written armed: refuses it while the other config's row is armed.
create or replace function public.pm_one_account_one_armed() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  other text := case tg_table_name when 'pm_live_config' then 'pm_mid_config' else 'pm_live_config' end;
  other_armed boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pm_one_account_one_armed', 0));
  if tg_table_name = 'pm_live_config' then
    select exists (select 1 from public.pm_mid_config m where m.live_confirmed_at is not null) into other_armed;
  else
    select exists (select 1 from public.pm_live_config l where l.live_confirmed_at is not null) into other_armed;
  end if;
  if other_armed then
    raise exception '% cannot be armed while % is armed: mini-pool and mid-pool trade one Polymarket account', tg_table_name, other
      using errcode = 'check_violation';
  end if;
  return null;
end
$$;

drop trigger if exists pm_live_config_one_armed on public.pm_live_config;
create trigger pm_live_config_one_armed
  after insert or update on public.pm_live_config
  for each row when (new.live_confirmed_at is not null)
  execute function public.pm_one_account_one_armed();

drop trigger if exists pm_mid_config_one_armed on public.pm_mid_config;
create trigger pm_mid_config_one_armed
  after insert or update on public.pm_mid_config
  for each row when (new.live_confirmed_at is not null)
  execute function public.pm_one_account_one_armed();
