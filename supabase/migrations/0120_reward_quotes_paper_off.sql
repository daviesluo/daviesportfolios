-- 0120: every PAPER Reward quotes test stops, and their rows leave TESTING. The live path (live-prep's real money) and the
-- research recorder keep running.
--
-- On whose word. Davies, 2026-10-13: "目前paper testing里的reward quotes全关了吧？感觉都不赚钱没什么意义？如果你实在觉得还有用的话就
-- 转到后台记录，不用在网站上显示了" (switch off every Reward quotes in paper testing? they don't seem to make money and there's
-- little point; if you really think one is still useful, move it to background recording, no need to show it on the site).
-- The main session's call the same day: close them all, none moves to the background. LP-BEST
-- (docs/agents/reviews/2026-10-13-lp-best-strategy.md) shows quoting near the touch loses across the reward universe, and
-- every one of these paper rows quotes near the touch.
--
-- Off (enabled = false, never a delete; the rows, their tables and every record stay):
--   agents?action=pmrwc, agents?action=pmrwc-select   RW-C's engine and its daily selection ("Reward quotes" since 10-09,
--       RW's rule's round 2; reviews/2026-09-28-rw-next-prereg.md Part 2). Its 10-23 verdict is withdrawn
--       (reviews/2026-10-02-polymarket-rw-rest-prereg.md, its withdrawal section).
--   agents?action=pmrwc-e   RW-E's replay of RW-C ("Reward quotes variant-1").
--   agents?action=pmrwc-x   the variants' replay of RW-C ("variant-2" x1, "variant-3" and "variant-4" TB1's two arms; x4 and
--       x5 off the page): RW-X4/X5's Test 2 and TB1's reading are withdrawn (their pre-registrations' withdrawal sections).
--   agents?action=pmmid&forceFunctionRegion=eu-west-1, agents?action=pmmidprep   mid-pool's order path in dry-run and its
--       paper layer ("Reward quotes mid-pool"): its 10-17 readout and 10-23 audit are withdrawn (its pre-registration's
--       withdrawal of 2026-10-13). Its config row is not touched: `dry_run` true, `live_confirmed_at` null, so nothing arms, and 0091's
--       one-armed trigger reads the row as it is.
--   agents?action=pmlpprep   live-prep's paper layer. Live, the path reads none of it (pm_live.ts: `paper` is set only in
--       dry-run, `mode === "dry_run" && inst.lp`); it wrote no row on 2026-10-12. Its page row left TESTING on 2026-10-10.
--       Should live-prep be disarmed, its dry-run would decide on the layer's last holdings: a dry-run, no order.
--   agents?action=pmprog   the programme factor's reader (0115): its factors priced only TESTING's paper rows
--       (`atProgramme` in agents/index.ts); LIVE's row never read them. Its refresh job, `pm-prog-refresh`, every 15
--       minutes, served only those rows and is unscheduled here; `pm-prog-prune` (its 30-day retention) stays as designed.
--
-- Kept (the rows this file does not name; checked by src/cron_jobs.test.js): agents?action=pmlp&forceFunctionRegion=eu-west-1
-- and agents?action=pmlpreserve (live-prep's live path and its refill reserve), agents?action=pmrec and
-- agents?action=pmrec-meta (pm-rec, the research recorder; LPRESEL6 reads its archive to 10-23), and every other call.
-- Neither the live path nor the recorder reads what stops: pm_live.ts in live mode reads `pm_lp_*`, `agent_risk` and its
-- lease (its paper tables only in dry-run); pm_lp_reserve.ts reads the reward listing, Gamma and the books; pm_book_rec.ts
-- reads each path's minutes and selections to know which markets are "ours" (a stopped path's tables just add none);
-- monitor/health.ts reads `pm_lp_state` alone of these.
--
-- What it saves (production, read-only, 2026-10-12, a whole UTC day): 10,647 calls of the minute job and as many beats
-- (`edge_call_beats`) and pg_net responses; about 114,500 rows written (pm_rwc_minutes 41,917, pm_midprep_minutes 51,796,
-- pm_mid_minutes 11,504, pm_mid_orders 4,038, pm_prog_reads 3,752, the rest under 1,000 each); about four hours of Edge
-- wall time a day (the function's logs, sampled).
--
-- Safe while the job runs: as 0103, the one-minute job reads the list in one plain SELECT that an UPDATE's row locks do
-- not block; a row turned off after a minute's read is called once more, and the watchdog never runs a disabled row.

set lock_timeout = '3s';

update public.edge_calls set enabled = false where path in ('agents?action=pmrwc', 'agents?action=pmrwc-select', 'agents?action=pmrwc-e', 'agents?action=pmrwc-x', 'agents?action=pmmid&forceFunctionRegion=eu-west-1', 'agents?action=pmmidprep', 'agents?action=pmlpprep', 'agents?action=pmprog');

select cron.unschedule('pm-prog-refresh');

reset lock_timeout;
