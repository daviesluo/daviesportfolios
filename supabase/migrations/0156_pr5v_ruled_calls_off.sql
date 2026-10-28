-- 0156: PR5V's and rule D's paper engines stop, as both pre-registrations say once read.
--
-- On whose word. Both pre-registrations (PR5V's and rule D's): "Both arms stop at the reading, pass or fail, unless Davies says
-- otherwise." They were read on 2026-10-28 (reviews/2026-10-28-pr5v-ruled-readings.md: PR5V PASS, rule D FAIL on condition 3).
-- Davies, 2026-10-28, asked whether to keep them: "按照你的推荐来决定" (decide by your recommendation). The recommendation:
-- stop them. The readings are written; what PR5V asked (more capital at LIVE's rule) is now measured on LIVE's own code by the
-- £1,200 twin (`live1200`, variant-1, its own pre-registration), and rule D failed. Neither row has been on the page since 0141.
--
-- Off (enabled = false, never a delete; the rows, their tables and every record stay):
--   agents?action=quotesv   PR5V's engine (`agent_quotev_*`, 0071).
--   agents?action=quotesd   rule D's engine (`agent_quoted_*`, 0072).
-- Every other call and every cron job stays as it is. No grant and no policy.

set lock_timeout = '3s';
update public.edge_calls set enabled = false where path in ('agents?action=quotesv', 'agents?action=quotesd');
reset lock_timeout;
