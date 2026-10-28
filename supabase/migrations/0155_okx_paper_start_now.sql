-- 0155: OKX's two paper twins ("Stablecoin quotes OKX USDG" and "… OKX EURC", 0150) start at 2026-10-28 22:00 UTC instead of
-- 2026-10-29 00:00 UTC, the hour PR5-OPT's five twins start (0154).
--
-- On whose word. Davies, 2026-10-28, after variant-4 to -8 were moved to start at 22:00: "okx" (start OKX's now, too).
--
-- What it moves. The engine's state (`okx_quote_state`, written by `okx_quotes.ts`'s first run at 19:53 UTC) holds the window's
-- start, `startedAt` = the first 00:00 UTC after that run (`okxStart`), and `lastMinute` = one minute before it. Nothing has been
-- decided yet: every book is idle and `okx_quote_minutes`, `_events` and `_trips` are empty. Both move back two hours, guarded on
-- the values they replace, so a re-run or an already-moved row changes nothing. The next minute call catches up from 22:00 on the
-- prints and touches the recorder has kept since 19:53 (or waits for 22:00, if this lands first). The pre-registration's window
-- is 28 UTC days from `startedAt`: 2026-10-28 22:00 → 2026-11-25 22:00 (its deviation 1). The rule, the bar and every frozen file
-- are untouched.
--
-- A minute call that read the state before this commits and writes it after would put the old values back; the session that
-- lands this reads `startedAt` once the call has run and applies it again by its own migration if so.

update public.okx_quote_state
   set state = jsonb_set(jsonb_set(state, '{startedAt}', '1793224800000'::jsonb), '{lastMinute}', '1793224740000'::jsonb),
       updated_at = now()
 where id = 1 and state->>'startedAt' = '1793232000000' and state->>'lastMinute' = '1793231940000';
