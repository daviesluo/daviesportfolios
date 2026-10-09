-- 0108: "Stablecoin quotes variant-3" (`p50x1`), variant-1's twin with its exit one tick beyond fair, and rule D's twin
-- renamed "Stablecoin quotes variant-4" (docs/agents/reviews/2026-10-09-p50x1-prereg.md; the 2026-10-09 stablecoin quotes
-- review's F3 and appendix; reference §4 item 51).
--
-- On whose word. Davies, 2026-10-09, after reading the review: "新增 TESTING "variant-4"（p50x1），但和目前的variant-3换位置"
-- (add the TESTING twin p50x1, and swap it with the current variant-3). So the new twin is "Stablecoin quotes variant-3",
-- in rule D's twin's place on the page, and rule D's twin (`d`) is "Stablecoin quotes variant-4", after it. Only d's page
-- name changes: its id, tables, lease, order (40), rules and record stay.
--
-- The rename comes first: page names are unique, and the new row takes d's old one.
--
-- The row. As p50's (0088) but for its id, page name and place (35: after variant-2's 30, before d's 40), its tables and
-- lease, its rule, its backfill and its pre-registration. Its rule extension `exitOffset` (`TWIN_RULES.exitOffset`,
-- agents/quotes_twin.ts; `QuoteLiveInstance.exitOffset`, agents/quotes_live.ts, in this commit) moves every exit it places
-- or re-prices one tick further in the position's favour from 2026-10-12 00:00 UTC, the window's first minute; before then
-- it is p50, minute for minute. Its record to 2026-10-02 21:05 UTC is its own backfill
-- (docs/agents/backtests/twins/p50x1.json.gz, built by backfill.ts p50x1 on the twins' committed inputs): p50's record row
-- for row but for the twin's id (src/p50x1_twin.test.js); from there it catches up minute by minute, as take50 did.
--
-- Its time. No new call: 0087's `agents?action=quotestwins` runs it after variant-2, under the same lease and budget, and no
-- `edge_calls` row is added. Its first call loads its backfill (one file a call, no turn of its own in it; the other twins
-- turn), then it catches up from 2026-10-02 21:05.
--
-- What it leaves alone: every other twin's row but d's page name, every twin's tables and record, the live executor and its
-- tables, PR5's paper test, PR5V and rule D and their frozen readings, `edge_calls` and every cron job. No grant and no
-- policy: row level security is on, and 0082's default privileges keep `anon` and `authenticated` from the new tables.

update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes variant-4'
 where id = 'd' and display_name = 'Stablecoin quotes variant-3';
insert into public.agent_quote_twin_specs
select * from jsonb_populate_recordset(null::public.agent_quote_twin_specs, $json$[
  { "id": "p50x1", "display_name": "Stablecoin quotes variant-3", "display_order": 35, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-09-23T15:09:00Z", "table_prefix": "agent_quote_twin_p50x1", "lease": "quotes-twin-p50x1", "rules": { "exitOffset": { "ticks": 1, "from": "2026-10-12T00:00:00Z" } }, "backfill": { "file": "docs/agents/backtests/twins/p50x1.json.gz", "sha256": "ece1e81ce6e2b790ae52ef3a7939bce6631d97f3c9760be7e5442ff14de9259e", "until": "2026-10-02T21:05:00.000Z" }, "prereg": "docs/agents/reviews/2026-10-09-p50x1-prereg.md", "migration": "0108", "enabled": true }
]$json$::jsonb)
on conflict (id) do nothing;
select public.create_quote_twin_tables('p50x1');
