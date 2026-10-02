-- 0082: the database answers the service role only; the anon key the page carries opens nothing in it.
--
-- Found 2026-10-02, from Supabase's security advisor and then read here (Davies: "看看supabase还有没有其他可以优化的地方").
-- The anon key ships in the page's bundle and the repository is public, so whatever `anon` may do, anyone may do:
--
--   * `board_data`, the whole portfolio, carried three policies made in the dashboard before 0009 was written
--     ("allow anon read", "allow anon write", "allow anon update"; `using (true)` and `with check (true)`, to PUBLIC):
--     anyone holding the anon key could read the book and overwrite it through `/rest/v1/board_data`. 0009 states the
--     design, no policy at all, but its `create table if not exists` never met a table that already existed. A
--     count-only read with the anon key answered `*/1` before this file.
--   * Eight SECURITY DEFINER functions were executable by `anon` and `authenticated` through `/rest/v1/rpc/`:
--     save_board_data (overwrite the book), prune_price_snapshots and prune_portfolio_snapshots (thin the recorded
--     history, given a far `_now`), price_snapshot_series and portfolio_snapshot_series (read it), bump_auth_attempt
--     (lock any IP out of sign-in), try_claim_av_call and try_claim_t212_refresh (spend the claims). 0013 and 0017
--     revoked PUBLIC, but Supabase's default privileges grant `anon` and `authenticated` by name, so those grants stood.
--
-- The edge logs kept (every day sampled from 2026-09-25 to 10-02) show every PostgREST request made with the service
-- key and none with the anon key. Every caller is an Edge Function using the service role (auth, data, fundamentals,
-- trading212, agents and the rest) or pg_cron as postgres; the page reaches the database only through Edge Functions,
-- which take the anon key at their gateway and nowhere else.
--
-- So the policies go; `anon` and `authenticated` lose every privilege on this schema's tables, views, sequences and
-- functions; PUBLIC loses EXECUTE on its functions; and what is created here later starts the same way, so neither a
-- new SECURITY DEFINER function nor a table made without RLS is open to the anon key by default. The service role keeps
-- everything it had. The advisor's other warning, a mutable search_path on the two variant reset functions, is left:
-- they are SECURITY INVOKER and only the service role may run them, and they belong to a test that is running.
--
-- It lands before 2026-10-03 00:00 UTC: it changes no code and no table's columns, only privileges of two roles nothing
-- here uses, on every table of this schema, mini-pool's and mid-pool's among them, before mini-pool's window and
-- mid-pool's d1 open.

drop policy if exists "allow anon read"   on public.board_data;
drop policy if exists "allow anon write"  on public.board_data;
drop policy if exists "allow anon update" on public.board_data;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;
