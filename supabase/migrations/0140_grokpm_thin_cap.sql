-- 0140: GROKPM's Deviation D15, the thin rule's capped exception: each order says whether it was sent under it, and when it
-- must be gone.
--
-- On whose word. Davies, 2026-10-26: "你再验证下D15的修改，推荐的话就做" (verify D15 once more and, if still recommended,
-- build it), on the thin-rule study (`docs/agents/reviews/2026-10-26-grokpm-thin-rule-study.md`, §6 and §9).
--
--   grokpm_orders.thin_cap  true for an order sent under D15. A market with such an order is a D15 market while the agent
--                           holds or rests anything in it: every buy there is held to $5 at cost, and at most 3 such
--                           markets are open (`exec.ts` `ledgerOf`, `thinCapRefusals`).
--   grokpm_orders.cut_at    when a D15 order must be gone: 48 hours before the earlier of its market's end and the scheduled
--                           release the agent names (`event_at`). The order's GTD life ends before it; the minute's sync
--                           cancels it at the latest then, or earlier if Gamma moves the end (`cutThinCapOrders`).
--
-- Written by the `grokpm` function. No grant and no policy (0125's table keeps its row level security). Nothing else of
-- the rules changes; the frozen pre-registration gains D15 in its §9 after D14.

alter table public.grokpm_orders add column if not exists thin_cap boolean not null default false;
alter table public.grokpm_orders add column if not exists cut_at timestamptz;
