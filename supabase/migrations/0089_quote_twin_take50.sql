-- 0089: "Stablecoin quotes variant-2" (`take50`), TAKE's forward test (docs/agents/reviews/2026-10-03-take-prereg.md,
-- reference §4 item 52): variant-1's twin (PR5's rule on the live executor's code at £600, £50 a rung) with one rule
-- extension, `take`, from 2026-10-05 00:00 UTC. Before then it is variant-1, minute for minute; from then, before a rung's
-- paper entry, a taker IOC at k + 0.09 % from fair when Revolut X's recorded book (`agent_book_levels`) rests through it,
-- filled in the simulated account against the recorder's first read after the turn.
--
-- On whose word. Davies, 2026-10-03, on TAKE: "可以 批准研究后上线测试，并且这个新策略建立在目前哪个variant（或者原策略）之上效果最好
-- 呢？你决定吧"; its names the same day: PR5's rule at £50 a rung is "Stablecoin quotes variant-1", this test "variant-2"
-- (`take50`), rule D's twin "variant-3". Its rule, window and bar are frozen in its pre-registration (on main in 4fd3b1ac).
--
-- The row. As p50's but for its id, page name and place (between variant-1's 20 and variant-3's 40), its tables and lease,
-- its rule, its backfill and its pre-registration. Its record to 2026-10-02 21:05 UTC is its own backfill
-- (docs/agents/backtests/twins/take50.json.gz), built by backfill.ts take50 on the twins' committed inputs: before
-- `take.from` it is p50's record row for row (src/take_twin.test.js; the pre-registration's check K1). The code its rule
-- needs is in this commit: `TWIN_RULES.take` (agents/quotes_twin.ts), the instance option and the take before a rung's
-- paper entry (agents/quotes_live.ts), the take's fill against the recorded read (agents/revx_sim.ts, the twins'
-- pre-registration's deviation 2), and the driver's wait for the recorder's read (a turn that may take turns a call behind,
-- at most 120 s after its instant).
--
-- Its time. No new call: 0087's `agents?action=quotestwins` runs it after p50, under the same lease and budget. Its first
-- call loads its backfill (one file a call, no turn of its own in it; the other twins turn), then it catches up from
-- 2026-10-02 21:05 as p50 did. From 2026-10-05 00:00 its forward turn reads two rows of `agent_book_levels` a book.
--
-- What it leaves alone: every other twin's row, tables and record, the live executor and its tables, PR5's paper test,
-- PR5V and rule D and their frozen readings, `edge_calls` and every cron job. No grant and no policy: row level security
-- is on, and 0082's default privileges keep `anon` and `authenticated` from the new tables.

insert into public.agent_quote_twin_specs
select * from jsonb_populate_recordset(null::public.agent_quote_twin_specs, $json$[
  { "id": "take50", "display_name": "Stablecoin quotes variant-2", "display_order": 30, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-09-23T15:09:00Z", "table_prefix": "agent_quote_twin_take50", "lease": "quotes-twin-take50", "rules": { "take": { "from": "2026-10-05T00:00:00Z" } }, "backfill": { "file": "docs/agents/backtests/twins/take50.json.gz", "sha256": "8a1d68f9cfe183cf13b387a24103bff3fb6fc7ed3f59b91ca0b29614c051af26", "until": "2026-10-02T21:05:00.000Z" }, "prereg": "docs/agents/reviews/2026-10-03-take-prereg.md", "migration": "0089", "enabled": true }
]$json$::jsonb)
on conflict (id) do nothing;
select public.create_quote_twin_tables('take50');
