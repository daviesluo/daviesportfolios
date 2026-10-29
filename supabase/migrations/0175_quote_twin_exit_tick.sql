-- 0175: "Stablecoin quotes variant-8", LIVE's rules at £600 with every exit one tick beyond fair, and its control, the same twin
-- without the offset, hidden, both from 2026-10-29 19:00 UTC (docs/agents/reviews/2026-10-29-revx-exit-tick-twin-prereg.md; the
-- study, docs/agents/reviews/2026-10-29-revx-lag-study.md §5–6).
--
-- On whose word. Davies, 2026-10-29: "好的，建 variant-8，在实盘live的基础上" (build variant-8, on LIVE's live rules), answering
-- REVX-LAG's recommendation: a paper twin of LIVE's rules with `exitOffset` one tick, pre-registered.
--
-- Two twins, from 2026-10-29 19:00 UTC (the first whole hour after this push was written; a later apply catches up from it on
-- PR5's own record, as 0170's twins did), each on LIVE's rules exactly as `live600` has them: LIVE's fill rule ("at") from its
-- start, LIVE's weekend from the closure of 2026-10-30 21:00 UTC (`live600`'s own instant; no closure falls between the start
-- and it), no take, and LIVE's exits meeting the book (`exitTicksOnBook`, in force on every instance since 2026-10-29 00:00, no
-- rule key). £600: twelve rungs of £50, both books, as `live600`.
--   `live600x1`  "Stablecoin quotes variant-8": with `exitOffset` (one tick from its start: every exit, placed or re-priced,
--                a tick beyond the rule's in the position's favour, then met with the book as every exit is).
--   `live600ctl` "Stablecoin quotes LIVE control from 10-29": without it, hidden (it runs; the page shows nothing of it). The
--                pre-registration's comparison is variant-8 against it, day by day: the same start, capital, rungs and rules,
--                both flat at the same minute, so the difference is the offset's. `live600` (from 10-27, carrying its own
--                holdings and conversions into the window) is reported beside it with no bar.
-- Their tables are 0087's template (`create_quote_twin_tables`). The twins' minute call (`agents?action=quotestwins`, 0087)
-- runs every enabled row: no call is added, so nothing joins `edge_calls` or the watchdog.
--
-- No code changes with it: `exitOffset` has been a rule of the driver (`TWIN_RULES`) and an option of the executor
-- (`QuoteLiveInstance.exitOffset`) since 0108, unchanged since; this is the first row since 0109 to name it.
--
-- What it leaves alone: every other twin's row and record (`live600` included), the live executor, its config and tables,
-- PR5's paper engine, `edge_calls` and every cron job. No grant and no policy: row level security is on, and 0082's default
-- privileges keep `anon` and `authenticated` out.

insert into public.agent_quote_twin_specs
select * from jsonb_populate_recordset(null::public.agent_quote_twin_specs, $json$[
  { "id": "live600x1", "display_name": "Stablecoin quotes variant-8", "display_order": 53, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-29T19:00:00Z", "table_prefix": "agent_quote_twin_live600x1", "lease": "quotes-twin-live600x1", "rules": { "fill": { "model": "at", "from": "2026-10-29T19:00:00Z" }, "weekend": { "from": "2026-10-30T21:00:00Z" }, "exitOffset": { "ticks": 1, "from": "2026-10-29T19:00:00Z" } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-29-revx-exit-tick-twin-prereg.md", "migration": "0175", "enabled": true, "hidden": false },
  { "id": "live600ctl", "display_name": "Stablecoin quotes LIVE control from 10-29", "display_order": 54, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-29T19:00:00Z", "table_prefix": "agent_quote_twin_live600ctl", "lease": "quotes-twin-live600ctl", "rules": { "fill": { "model": "at", "from": "2026-10-29T19:00:00Z" }, "weekend": { "from": "2026-10-30T21:00:00Z" } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-29-revx-exit-tick-twin-prereg.md", "migration": "0175", "enabled": true, "hidden": true }
]$json$::jsonb)
on conflict (id) do nothing;
select public.create_quote_twin_tables('live600x1');
select public.create_quote_twin_tables('live600ctl');
