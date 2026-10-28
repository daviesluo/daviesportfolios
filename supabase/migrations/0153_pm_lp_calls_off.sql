-- 0153: live-prep's two calls stop. "Reward quotes live-prep" (Polymarket rewards, real money) has been disarmed since 0125
-- and its 14-day readout failed Addendum 19's bar on 2026-10-28 (reviews/2026-10-28-lp-reads.md): Polymarket rewards end.
--
-- On whose word. Davies, 2026-10-28, on the calls the disarmed path still ran (its daily selection retried every five minutes
-- on a day it found no market, 176 selection events on 10-27): "这个关掉" (switch this off).
--
-- Off (enabled = false, never a delete; the rows, the path's tables and every record stay):
--   agents?action=pmlp&forceFunctionRegion=eu-west-1   live-prep's order path (disarmed: `live_confirmed_at` null since 0125).
--   agents?action=pmlpreserve                         its refill reserve.
-- Its config row is not touched. Its dust is the shared Polymarket account's, and GROKPM's hourly redemption
-- (`grokpm?action=redeem`, 0128) redeems every redeemable position of that account, so nothing is left to the path.
-- The monitor stopped reading `pm_lp_state`'s freshness in the push before this one (`monitor/health.ts`), so the Worker
-- does not page when the path stops writing it.
--
-- Kept: GROKPM's calls (its sync and redemption) and every cron job; the recorder `pmrec` is off since 0137.
-- No grant and no policy.

set lock_timeout = '3s';
update public.edge_calls set enabled = false where path in ('agents?action=pmlp&forceFunctionRegion=eu-west-1', 'agents?action=pmlpreserve');
reset lock_timeout;
