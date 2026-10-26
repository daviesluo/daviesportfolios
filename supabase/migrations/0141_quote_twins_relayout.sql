-- 0141: the stablecoin quotes twins laid out for LIVE's next size (docs/agents/reviews/2026-10-26-stablecoin-quotes-review.md
-- §3; the size twins' pre-registration docs/agents/reviews/2026-10-26-live-size-twins-prereg.md; the LIVE twin's deviation 1,
-- docs/agents/reviews/2026-10-21-live-twin-prereg.md; variant-3's withdrawal, docs/agents/reviews/2026-10-26-variant3-withdrawn.md).
--
-- On whose word. Davies, 2026-10-26, answering that review: "你验证没问题的话就都按你推荐的来，£300 和 £600在最新live的rules上建吧，live
-- twin要改成300磅的， £600改为variant-1，variant-2和variant-3周末的策略已经都实现进live的rules了吧存在还有意义吗要不删了吧，目前的LIVE 模拟分身
-- 改为variant-2；另外测试里的“Stablecoin quotes”有什么用？要不关了吧？剩下几个马上就停了的就不在网页上显示了" (if it checks out, do it all
-- as recommended: build £300 and £600 on LIVE's latest rules; the LIVE twin becomes £300, £600 becomes variant-1; variant-2 and
-- variant-3's weekend rule is in LIVE's rules now, is there a point keeping them, delete them; the current LIVE twin becomes
-- variant-2; what is "Stablecoin quotes" in testing for, close it; the ones that stop soon leave the page).
--
-- What it does, in this order (page names are unique, so each rename frees the name the next row takes):
--   1. `hidden`, a new column: a twin whose row says true runs as before and is left off the page (`twinsOnPage`,
--      agents/index.ts). Null or false: on the page. Nothing else reads it.
--   2. Page names: TAKE's twin (`take50`) "Stablecoin quotes TAKE", the size twin (`p50`) "Stablecoin quotes size twin", and
--      the £120 LIVE twin (`live`) "Stablecoin quotes variant-2". Ids, tables, leases and records stay.
--   3. The £120 LIVE twin trades the weekends from the next closure, 2026-10-30 21:00 UTC, as LIVE has since 2026-10-23
--      21:00 (`weekend_mode` 'live'): its pre-registration's deviation 1. Before then nothing of it changes.
--   4. Variant-3 (`take50wk`) stops: its call skips a row that is not enabled. Its rows, tables and record stay; its 11-25
--      reading is withdrawn (variant3-withdrawn.md): LIVE's own weekends and the three LIVE-rule twins below carry what it
--      was to show.
--   5. Off the page, still running until their readings: "Stablecoin quotes" (`pr5`, its readout after 2026-10-28), the
--      size twin (`p50`, its 10-28 readout beside rule D's twin), TAKE's twin (`take50`, TAKE's reading, and the yardstick of
--      LIVE's take shadow, the live design's addendum of 2026-10-18), rule D's twin (`d`, after 10-28). A migration after
--      their readings switches them off.
--   6. Two new twins on LIVE's rules, "Stablecoin quotes LIVE twin" (`live300`, £300, £25 a rung, the size LIVE is about to
--      take) and "Stablecoin quotes variant-1" (`live600`, £600, £50 a rung): the £120 twin's row but for the id, name,
--      place, capital, tables, lease, start, rules, backfill and pre-registration. LIVE's fill rule from their start and
--      LIVE's weekend from the same closure as the £120 twin; no take (LIVE's take_mode is 'shadow', which sends nothing).
--      They start flat at 2026-10-27 00:00 UTC, as variant-3 started, with the operator's maker conversions at their first
--      turn; deployed later, they first turn at the oldest beat kept.
--
-- Its time. No new call: 0087's `agents?action=quotestwins`, under the watchdog, runs the enabled rows (seven from here, one
-- fewer than six plus two) under the same lease and budget, so no `edge_calls` row is added.
--
-- What it leaves alone: the live executor, its config (capital, take_mode, weekend_mode) and its tables; PR5's paper engine and
-- every reading of it (PR5V and rule D on 10-28, QUEUE to 11-02, PR5-W to 11-25); every twin's tables and record; the
-- Coinbase tests; `edge_calls` and every cron job. No grant and no policy: row level security is on, and 0082's default
-- privileges keep `anon` and `authenticated` from the new tables.

alter table public.agent_quote_twin_specs add column if not exists hidden boolean;

update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes TAKE'
 where id = 'take50' and display_name = 'Stablecoin quotes variant-2';
update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes size twin'
 where id = 'p50' and display_name = 'Stablecoin quotes variant-1';
update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes variant-2'
 where id = 'live' and display_name = 'Stablecoin quotes LIVE twin';

update public.agent_quote_twin_specs
   set rules = rules || '{"weekend": {"from": "2026-10-30T21:00:00Z"}}'::jsonb
 where id = 'live' and not (rules ? 'weekend');

update public.agent_quote_twin_specs
   set enabled = false
 where id = 'take50wk';

update public.agent_quote_twin_specs
   set hidden = true
 where id in ('pr5', 'p50', 'take50', 'd');

insert into public.agent_quote_twin_specs
select * from jsonb_populate_recordset(null::public.agent_quote_twin_specs, $json$[
  { "id": "live300", "display_name": "Stablecoin quotes LIVE twin", "display_order": 11, "engine": "pr5", "capital_gbp": 300, "gov": "account", "start": "2026-10-27T00:00:00Z", "table_prefix": "agent_quote_twin_live300", "lease": "quotes-twin-live300", "rules": { "fill": { "model": "at", "from": "2026-10-27T00:00:00Z" }, "weekend": { "from": "2026-10-30T21:00:00Z" } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-26-live-size-twins-prereg.md", "migration": "0141", "enabled": true },
  { "id": "live600", "display_name": "Stablecoin quotes variant-1", "display_order": 12, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-27T00:00:00Z", "table_prefix": "agent_quote_twin_live600", "lease": "quotes-twin-live600", "rules": { "fill": { "model": "at", "from": "2026-10-27T00:00:00Z" }, "weekend": { "from": "2026-10-30T21:00:00Z" } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-26-live-size-twins-prereg.md", "migration": "0141", "enabled": true }
]$json$::jsonb)
on conflict (id) do nothing;
select public.create_quote_twin_tables('live300');
select public.create_quote_twin_tables('live600');
