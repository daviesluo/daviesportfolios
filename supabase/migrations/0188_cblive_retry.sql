-- 0188 — Coinbase's live executor joins the watchdog's retry (Davies, 2026-10-31: "a和b都改", on the agents-module audit's
-- finding A).
--
-- 0177 put `agents?action=cblive` under the watchdog with `retry` false ("a lost run is not run again in its minute; the next
-- minute's turn reconciles by client id"). The agents function fails to boot on about one request in ten (503 BOOT_ERROR), and
-- each such minute was simply lost: since it was armed (2026-10-29 21:45 UTC) 188 of 1,440 minutes a day, up to four in a row
-- (10-30 01:42 → 01:47), `excluded` in `edge_call_retries`.
--
-- A retry is safe here for the reason 0075 gives for `quotes`: the watchdog runs a call again only when its minute has NO beat,
-- and the function writes its beat before any work, so a retried minute is one whose first run never started. The executor's
-- `cb-live` lease keeps one turn at a time, every order it sends carries a client id it writes before the call, and the next turn
-- reconciles by that id. A retried turn is the same turn 13 s late.
--
-- Undo: update public.edge_calls set retry = false where path = 'agents?action=cblive';

update public.edge_calls set retry = true where path = 'agents?action=cblive';
