-- 0136: "Stablecoin quotes LIVE twin" (`live`), the realistic twin that mirrors LIVE itself: PR5's rule carried out by the
-- live executor's code on the simulated Revolut X account at LIVE's own £120 (£10 a rung), with LIVE's own fill rule
-- (docs/agents/reviews/2026-10-21-live-twin-prereg.md; the audit docs/agents/reviews/2026-10-21-sim-vs-live-audit.md).
--
-- On whose word. Davies, 2026-10-21, on PR5's four-week review: "A，引擎也继续运行，但要确保模拟的真实性和实盘策略完全一致，不一致的地方就
-- 直接改" (option A; keep the engine running; make the simulation match the live strategy exactly, fixing what is inconsistent).
-- The audit found the twins' fill rule the one large inconsistency (LIVE filled 317 of its 502 filled maker orders on prints AT
-- its price, which the twins' rule 1 fills nothing on) and added LIVE's rule as the twin rule `fill`; the main session chose a
-- new row at LIVE's size to carry it (the audit's option (a)).
--
-- The row. PR5's twin's (`pr5`, 0087/0088) but for its id, page name and place (15: after "Stablecoin quotes", before
-- variant-1), its capital (£120, LIVE's), its tables and lease, its rule `fill` (`{ "model": "at", "from": "2026-09-23T15:09:00Z" }`:
-- a print AT a resting order's price, from the other side, fills it, from the replica's first minute), its backfill and its
-- pre-registration. Its start is PR5's first minute, so its replica is PR5's engine event for event, as every PR5 twin's is.
--
-- Its record before now, the backfill (docs/agents/backtests/twins/live.json.gz, built by
-- docs/agents/backtests/livesim/scripts/backfill_live.ts on docs/agents/backtests/livesim/data/inputs.json.gz): no turn until
-- LIVE's go-live (2026-10-01 16:29:53), then LIVE's starting £120.33, LIVE's two go-live conversions at their own instants,
-- the dead-man from 2026-10-02 19:06, and LIVE's operations as LIVE met them (a turn every minute, 30 s in; the monitor's 48
-- dead-man cancels of 2026-10-07; the venue's outage of 2026-10-20), to 2026-10-21 15:09 UTC. From there the production call
-- catches it up turn by turn from PR5's beats (`edge_call_beats` keeps about three days: deploy before 2026-10-24) and runs it
-- forward as every twin, meeting no outage of its own but its own dead-man.
--
-- Its time. No new call: 0087's `agents?action=quotestwins`, already under the watchdog, runs it with the others under the same
-- lease and budget, so no `edge_calls` row is added.
--
-- What it leaves alone: every other twin's row, tables and record (TAKE, variant-3 and the size twin keep the through-only fill
-- rule their pre-registrations froze), the live executor and its tables, PR5's paper test and every frozen reading of it, PR5-W's
-- and QUEUE's freeze lines, `edge_calls` and every cron job. No grant and no policy: row level security is on, and 0082's default
-- privileges keep `anon` and `authenticated` from the new tables.

insert into public.agent_quote_twin_specs
select * from jsonb_populate_recordset(null::public.agent_quote_twin_specs, $json$[
  { "id": "live", "display_name": "Stablecoin quotes LIVE twin", "display_order": 15, "engine": "pr5", "capital_gbp": 120, "gov": "account", "start": "2026-09-23T15:09:00Z", "table_prefix": "agent_quote_twin_live", "lease": "quotes-twin-live", "rules": { "fill": { "model": "at", "from": "2026-09-23T15:09:00Z" } }, "backfill": { "file": "docs/agents/backtests/twins/live.json.gz", "sha256": "930744a026c35f4ce8f092d53aae9ce02907efb1c7bf97db0a3fbcb3ee5fae9e", "until": "2026-10-21T15:09:00.000Z" }, "prereg": "docs/agents/reviews/2026-10-21-live-twin-prereg.md", "migration": "0136", "enabled": true }
]$json$::jsonb)
on conflict (id) do nothing;
select public.create_quote_twin_tables('live');
