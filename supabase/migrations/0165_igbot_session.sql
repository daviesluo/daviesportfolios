-- 0165: IGBOT's IG session, shared by the function's isolates (2026-10-29). Nothing here arms anything; the config stays
-- dry-run and demo-only.
--
-- In its first two hours on IG's demo the minute's sync was refused in 14 of the 58 minutes that logged in (401
-- error.security.account-token-invalid on the account switch, igbot_requests 00:16-02:00 UTC): the session lived only in
-- an isolate's memory, about half the minutes land in a fresh isolate, and a fresh isolate's three reads each logged in
-- at once. IG keeps one good session per login. The function now keeps one session for all its isolates and logs in one
-- at a time (`igbot/client.ts`, `IGBOT_SESSION`):
--
--   igbot_exec_state.session_box   the session, sealed with AES-GCM under a key derived from the four demo secrets, which
--                                  never leave the function: the row holds nothing IG would accept. Null until the first
--                                  login, and again when a refused session is logged out.
--   igbot_exec_state.login_until   the claim that lets one isolate at a time log in (a compare-and-set, as the lease's);
--                                  another isolate waits for the session it stores.
--
-- Row level security stays on with no grant and no policy (0157).

set lock_timeout = '3s';

alter table public.igbot_exec_state add column if not exists session_box text;
alter table public.igbot_exec_state add column if not exists login_until timestamptz;

reset lock_timeout;
