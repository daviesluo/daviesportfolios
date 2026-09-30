-- 0073: variant-2's TrueFX rate is read before the turn it prices (reference §4 item 47, deviation 1 of
-- `reviews/2026-09-28-pr5-rule-d-prereg.md`).
--
-- The first engine (`agents/quotes_ruled.ts` code version 1, `0072`) read TrueFX when it decided a minute. The call
-- fires at :00 and PR5 decides the minute before only at :25, so it decided minute m − 2 at m + ~1 s and gave it a rate
-- from about two minutes after that minute's turn; a re-price at the turn then chose which quotes rested through the
-- minute on where GBP/USD went during it. Code version 2 reads it in the minute before the turn and holds it for that
-- turn only, and on its first call wipes this instance's rows and decides everything again from 2026-09-28 00:00 UTC.
--
-- From here a row that says TrueFX also says when the snapshot was read, and the database refuses one read at or after
-- its minute began. The constraint is NOT VALID so that it checks every row written from now on without scanning the
-- version-1 rows the engine is about to delete; a version-1 call that lands between this migration and the new
-- function's deploy fails its write and decides nothing, and the next call starts again from 2026-09-28 00:00.

alter table public.agent_quoted_minutes
  add column if not exists x_d_t    timestamptz,   -- a TrueFX minute's snapshot: its own timestamp
  add column if not exists x_d_read timestamptz;   -- and when the engine read it

alter table public.agent_quoted_minutes
  add constraint agent_quoted_minutes_truefx_before_turn_check
  check (x_source <> 'truefx' or (x_d_read is not null and x_d_read < minute)) not valid;
