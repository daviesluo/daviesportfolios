-- 0137: the two Polymarket research recorders stop: pm-rec (the reward universe's books, 0092) and the view-count
-- recorder (0062). Every row they recorded stays, and so does the archive in Storage.
--
-- On whose word. Davies, 2026-10-18, asked whether to keep the Polymarket recorders running: "还是你觉得删了更好" (or do you
-- think deleting them is better). The main session's decision: delete. Nothing that runs reads them: GROKPM, the one
-- Polymarket test left, keeps its own keyless record (`agents?action=grokpmrec`, agents/grokpm_rec.ts), which records
-- everything its reading needs; live-prep has been disarmed since 0125 and every paper Reward quotes path is off since
-- 0120. LPRESEL6, the last reading of pm-rec's record, needed it to run to 2026-10-23 00:00 UTC (its pre-registration,
-- reviews/2026-10-09-lp-reselect6h-prereg.md), and it did: the archive holds every books, universe and prints hour of
-- 2026-10-09 00:00 -> 10-22 23:00 (336 of each), read-only on 2026-10-23.
--
-- Off (enabled = false, never a delete; the rows stay in the list):
--   agents?action=pmrec        pm-rec's minute call: the books of every market paying $10 a day or more, a fifteenth of
--                              the rewarded universe, and the prints, into pm_rec_frames.
--   agents?action=pmrec-meta   its five-minute call: the reward listing, Gamma's metadata, and each closed hour moved to
--                              the private Storage bucket `pm-rec` and indexed in pm_rec_archive.
--   agents?action=views        the view-count recorder (agents/views.ts): Polymarket's view-count markets' books and the
--                              YouTube counters they resolve on, into pm_view_books and the yt_* tables. Its study was
--                              never pre-registered; it ends here, with its record kept.
--
-- Unscheduled: `pm-rec-prune` (0092, hourly). With the recorder stopped it would only delete: it drops the data of frames
-- the archive has not taken within six hours (the last hour or two before this applies, which no meta call will now
-- archive), deletes the frames' rows after seven days, and deletes markets seven days after the listing dropped them.
-- Unscheduled, every recorded row stays as it is. pm-rec's tables, leases, state rows and every archive object stay, and
-- nothing is dropped. The view recorder had no prune.
--
-- What stays on (the rows this file does not name; checked by src/cron_jobs.test.js): GROKPM's record
-- (`agents?action=grokpmrec`) and its server's calls (`grokpm?action=sync|redeem&forceFunctionRegion=eu-west-1`),
-- live-prep's live path and reserve (`agents?action=pmlp&forceFunctionRegion=eu-west-1`, `agents?action=pmlpreserve`),
-- and every other call and job.
--
-- What it leaves undone: the archive's signed URLs were re-signed by pmrec-meta 30 days before they expired
-- (`PM_REC_RESIGN_DAYS`); from here each lasts a year from its last signing, and the objects themselves stay in the
-- bucket, so a later read signs them again through the Storage API. Nothing read the recorders' freshness: neither
-- monitor/health.ts nor the watchdog expects them (the watchdog runs only enabled rows).
--
-- Safe while the job runs: as 0103 and 0120, the one-minute job reads the list in one plain SELECT that an UPDATE's row
-- locks do not block; a row turned off after a minute's read is called once more, and the watchdog never runs a disabled
-- row.

set lock_timeout = '3s';

update public.edge_calls set enabled = false where path in ('agents?action=pmrec', 'agents?action=pmrec-meta', 'agents?action=views');

select cron.unschedule('pm-rec-prune');

reset lock_timeout;
