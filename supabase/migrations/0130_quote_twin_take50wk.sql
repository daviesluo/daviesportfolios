-- 0130: "Stablecoin quotes variant-3" (`take50wk`), variant-2 (TAKE, `take50`) with PR5-W's weekend rule, and rule D's twin
-- renamed "Stablecoin quotes variant-4" (docs/agents/reviews/2026-10-18-revx-weekend-prereg.md; the 2026-10-18 stablecoin
-- quotes review's §5; reference §4 item 51).
--
-- On whose word. Davies, 2026-10-18, answering that review: "加一个 Revolut 周末 paper 测试，在目前最好的variant-2基础上加，上线测试一下
-- 作为variant-3，目前的3改为4" (add a Revolut X weekend paper test on top of the best current variant, variant-2, as
-- variant-3, and make the current variant-3 variant-4). So the new twin is "Stablecoin quotes variant-3", in rule D's twin's
-- place on the page, and rule D's twin (`d`) is "Stablecoin quotes variant-4", after it. Only d's page name changes: its id,
-- tables, lease, order (40), rules and record stay (0108 did the same on 2026-10-09; 0109 undid it).
--
-- The rename comes first: page names are unique, and the new row takes d's old one.
--
-- The row. As take50's (0089, with 0090's take.from) but for its id, page name and place (35: after variant-2's 30, before
-- d's 40), its tables and lease, its start, its second rule and its pre-registration. Its rule extension `weekend`
-- (`TWIN_RULES.weekend`, agents/quotes_twin.ts; `QuoteLiveInstance.weekend`, agents/quotes_live.ts; the rule itself
-- agents/quotes_weekend.ts, in this commit) is PR5-W's: from 2026-10-23 21:00 UTC (the window's first minute, a closure's
-- first), a minute whose GBP/USD is dark inside an FX closure is decided on the book's last X, and the executor reads fair at
-- it. Before then it is take50's rule exactly.
--
-- Its start, 2026-10-19 00:00 UTC, with no backfill. A twin catches up only in the minutes PR5's call left a beat
-- (`quotesCallMinutes`), and `edge_call_beats` keeps about three days of them: a twin started at PR5's first minute from
-- the committed backfill (to 2026-10-02 21:05) would turn in none of 10-02 → 10-15 and wake with two-week-old positions to
-- stop. So it starts flat on a Monday shortly before its deploy, as every twin started, with the operator's maker
-- conversions at its first turn, and has a weekday or more to settle before its first closure. Deployed after 10-21 it
-- simply first turns at the oldest beat kept; deployed after 10-23 21:00 its first whole weekend is lost (its
-- pre-registration then reads fewer). Its record before the window is not take50's: their rule is the same, minute for
-- minute (quotes_twin.test.ts), but take50 has carried its own positions and coins since 09-23.

-- Its time. No new call: 0087's `agents?action=quotestwins`, already a row of `edge_calls` under the watchdog, runs it after
-- variant-2 under the same lease and budget, so no `edge_calls` row is added. Its first call starts it at 2026-10-19 00:00
-- and it catches up from there, at most 12 s of turns a call.
--
-- What it leaves alone: every other twin's row but d's page name, every twin's tables and record, the live executor and its
-- tables (its instance has no weekend rule), PR5's paper test, PR5V and rule D and their frozen readings, PR5-W's and
-- QUEUE's freeze lines (`stepMinute`, `agent_quote_minutes`, `books.ts`, `agent_book_levels` untouched: the rule only reads
-- them), `edge_calls` and every cron job. No grant and no policy: row level security is on, and 0082's default privileges keep
-- `anon` and `authenticated` from the new tables.

update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes variant-4'
 where id = 'd' and display_name = 'Stablecoin quotes variant-3';
insert into public.agent_quote_twin_specs
select * from jsonb_populate_recordset(null::public.agent_quote_twin_specs, $json$[
  { "id": "take50wk", "display_name": "Stablecoin quotes variant-3", "display_order": 35, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-19T00:00:00Z", "table_prefix": "agent_quote_twin_take50wk", "lease": "quotes-twin-take50wk", "rules": { "take": { "from": "2026-10-04T16:00:00Z" }, "weekend": { "from": "2026-10-23T21:00:00Z" } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-18-revx-weekend-prereg.md", "migration": "0130", "enabled": true }
]$json$::jsonb)
on conflict (id) do nothing;
select public.create_quote_twin_tables('take50wk');
