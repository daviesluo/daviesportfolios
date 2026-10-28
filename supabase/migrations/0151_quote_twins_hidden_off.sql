-- 0151: the three hidden stablecoin twins stop, their readouts written (docs/agents/reviews/2026-10-28-pr5v-ruled-readings.md
-- §3; the numbers in docs/agents/backtests/pr5v/ruled/twins/results/readout.json).
--
-- On whose word. Davies, 2026-10-26, on the stablecoin quotes review (docs/agents/reviews/2026-10-26-stablecoin-quotes-review.md
-- §5): "…剩下几个马上就停了的就不在网页上显示了，到时候你在这里读就行" (the ones about to stop come off the page; read them here when
-- the time comes). 0141 hid them and the review's §3.3 retires each "once their last reading is written": "Stablecoin quotes"
-- (`pr5`, £1,200) and the size twin (`p50`, £600) after their readout beside rule D's twin, and rule D's twin (`d`, £1,800) after
-- rule D's reading, whatever its result. Rule D's reading and the three readouts were written on 2026-10-28.
--
-- What it does: `enabled = false` for `pr5`, `p50` and `d`. 0087's `agents?action=quotestwins` then runs the other enabled rows
-- only, under the same lease and budget. Their spec rows, tables and records stay (nothing is dropped), so every figure the
-- readouts read can be read again.
--
-- What it leaves alone: PR5's paper engine and its minute record (LIVE, QUEUE, PR5-W and the LIVE-rule twins read it); PR5V's and
-- rule D's paper engines and their calls (each pre-registration stops its arms at the reading unless Davies says otherwise, and
-- that is his call, not this migration's); the live executor and its config; every other twin; `edge_calls` and every cron
-- job. No grant and no policy.

update public.agent_quote_twin_specs
   set enabled = false
 where id = 'pr5';

update public.agent_quote_twin_specs
   set enabled = false
 where id = 'p50';

update public.agent_quote_twin_specs
   set enabled = false
 where id = 'd';
