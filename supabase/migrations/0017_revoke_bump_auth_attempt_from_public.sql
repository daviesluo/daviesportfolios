-- Harden bump_auth_attempt to match the other security-definer RPCs.
--
-- 0001 (and the re-create in 0011) granted EXECUTE on
-- public.bump_auth_attempt to service_role but never revoked it from
-- PUBLIC. PostgreSQL grants EXECUTE to PUBLIC by default, so the
-- auth-lockout RPC stayed callable by the anon / authenticated PostgREST
-- roles via POST /rest/v1/rpc/bump_auth_attempt. The function takes the
-- IP as a parameter, so an anonymous caller could inflate the
-- failed-attempt counter for an arbitrary IP (a targeted-lockout DoS) or
-- otherwise drive the lockout state the Edge Function is supposed to own.
--
-- The auth Edge Function authenticates as service_role, so revoking
-- PUBLIC doesn't affect the legitimate caller — it just removes the
-- accidental anonymous surface. Brings 0001/0011 to parity with
-- try_claim_t212_refresh (0008), try_claim_av_call (0012), and
-- save_board_data (0013), all of which already revoke PUBLIC.
--
-- Idempotent (revoke/grant are both safe to re-run). Apply via the
-- Supabase SQL Editor — the edge-functions deploy workflow doesn't run
-- migrations.

revoke all on function public.bump_auth_attempt(text, int, bigint) from public;
grant execute on function public.bump_auth_attempt(text, int, bigint) to service_role;
