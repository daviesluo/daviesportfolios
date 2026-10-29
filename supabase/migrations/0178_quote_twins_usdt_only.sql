-- 0178: LIVE quotes USDT-GBP alone from 2026-10-30 00:00 UTC, and the twins with it (docs/agents/reviews/2026-10-29-usdt-only.md,
-- the study; docs/agents/reviews/2026-10-29-usdt-only-deviation.md, the deviation of every pre-registration it touches;
-- docs/agents/reviews/2026-10-29-usdt-only-twins-prereg.md, the new variant-5's pre-registration).
--
-- On whose word. Davies, 2026-10-29: "之后下一步你再研究下Revolut X的USDT-GBP近期是不是也完全超过USDC，基本可以肯定效果正面的话，把live全换成
-- 只做USDT-GBP的（live策略改名为Stablecoin quotes USDT/GBP）（Stablecoin quotes LIVE twin同步改）（换币也用挂单不要有转换损失），variant-1，2，3，5，7和8
-- 也改为在新的实盘基础上做，variant-6改为usdc和usdt 1:1作为两个币都做的对比（追踪usdt和usdc的年化比率，在它子页面的score board下加一行文字更新
-- 这个）"; then "原 variant-5 …这个可以删了" and "原 variant-7 …这个在'原 variant-6…改成 USDC:USDT 1:1…'这个基础上做，也加那一行文字". His
-- variant numbers are those before 0176; this file names each twin by its id.
--
-- What it does, in this order:
--   1. LIVE's weights on every twin on LIVE's rules, at LIVE's own instant (`QUOTE_LIVE_USDT_ONLY_FROM`, agents/quotes_live.ts, the
--      same push): `weights {from: 2026-10-30T00:00:00Z, book: {USDC-GBP: 0, USDT-GBP: 1}}`, added to a row that has none, guarded
--      on its absence: `live600` (the LIVE twin), `live1200` (variant-1), `take50` (variant-2), `live600x1` (variant-7, variant-6
--      from here) and its control `live600ctl`, so both arms of the exit-tick test switch at the same minute.
--   2. A row's weights replaced, guarded on the weights they replace (the jsonb equal to what 0152 inserted):
--      `n600no03` (variant-3) → USDT-GBP alone with its own rule kept (`k` 0.3 % at 0), from the same instant. Between this apply
--      and the instant its weights are not in force, so its 0.3 % rungs quote again for those hours at the capital over twelve
--      (the deviation record says so); from 00:00 it is LIVE's new rules less the 0.3 % rung, as it was LIVE's old rules less it.
--      `n600usdt` (variant-5, variant-4 from here) → USDC:USDT 1:1 from the instant: both books, the capital over twelve, its
--      page carrying the USDT/USDC line (`twinBookRatio`, agents/index.ts). From this apply to the instant it is 1:1 already (no
--      weights in force is the capital over twelve); from 00:00 its coin is rebooked to it.
--      Weights from the instant or later rebook the coin for three days (`rebookOn`, quotes_live.ts: the surplus coin sold by
--      post-only orders at the top of the asks, never under fair, the short book topped up past the £5 cap), LIVE's included.
--   3. Variant-4 (`n600usdt3`, USDT 3:1) stops and leaves the page, named for what it was, "Stablecoin quotes USDT 3:1 from 10-28".
--   4. Variant-6 (`u300nudge`, the USDC-GBP nudge at $300) and its control `u300ctl` stop; `u300nudge` leaves the page, named
--      "Stablecoin quotes USDC nudge $300 from 10-29". The nudge goes on as a new twin at the 1:1 twin's capital (its sim account
--      cannot take £374.67 more: a twin's account is funded once, at its start), so the 1:1 twin is its control:
--        `n600nudge` "Stablecoin quotes variant-5": `n600usdt`'s rules from 00:00 (LIVE's fill rule, its weekend, the £1 holding
--        line, USDC:USDT 1:1 by `weights`) and the nudge on USDC-GBP's fair (w 0.5, a 24-hour half-life), £600, from
--        2026-10-30 00:00 UTC. Its tables are 0087's template; the nudge's minutes go to 0169's `agent_quote_twin_nudge`.
--      `u300ctl` gives place 52 to it (moved to 56, guarded on 52): the page's order is variant-4, variant-5, variant-6.
--   5. Page names, each rename after the one that frees its name: `n600usdt` variant-5 → variant-4; `live600x1` variant-7 →
--      variant-6; `live600` "Stablecoin quotes LIVE twin" → "Stablecoin quotes USDT/GBP LIVE twin", as LIVE is "Stablecoin quotes
--      USDT/GBP" on the page (agents.js).
-- The twins' minute call (`agents?action=quotestwins`, 0087) runs every enabled row: no call is added, so nothing joins
-- `edge_calls` or the watchdog.
--
-- Its order with the function. LIVE's weights and the rebook ship in agents/quotes_live.ts with this push (edge-functions.yml)
-- while this applies (migrations.yml); the twins' rules need no new driver code (`weights` and `fairNudge` have been twin rules
-- since 0148 and 0169). Before 00:00 nothing quotes differently but the 0.3 % rungs of `n600no03` and `n600usdt`'s USDC-GBP.
--
-- What it leaves alone: the live executor's config and tables, PR5's paper engine, every twin's record, `n600usdt2` (the hidden
-- USDT 2:1, on its own weights from 10-28), every disabled twin, `edge_calls` and every cron job. No grant and no policy; nothing
-- is dropped.

update public.agent_quote_twin_specs
   set rules = rules || '{"weights": {"from": "2026-10-30T00:00:00Z", "book": {"USDC-GBP": 0, "USDT-GBP": 1}}}'::jsonb
 where id = 'live600' and not (rules ? 'weights');

update public.agent_quote_twin_specs
   set rules = rules || '{"weights": {"from": "2026-10-30T00:00:00Z", "book": {"USDC-GBP": 0, "USDT-GBP": 1}}}'::jsonb
 where id = 'live1200' and not (rules ? 'weights');

update public.agent_quote_twin_specs
   set rules = rules || '{"weights": {"from": "2026-10-30T00:00:00Z", "book": {"USDC-GBP": 0, "USDT-GBP": 1}}}'::jsonb
 where id = 'take50' and not (rules ? 'weights');

update public.agent_quote_twin_specs
   set rules = rules || '{"weights": {"from": "2026-10-30T00:00:00Z", "book": {"USDC-GBP": 0, "USDT-GBP": 1}}}'::jsonb
 where id = 'live600x1' and not (rules ? 'weights');

update public.agent_quote_twin_specs
   set rules = rules || '{"weights": {"from": "2026-10-30T00:00:00Z", "book": {"USDC-GBP": 0, "USDT-GBP": 1}}}'::jsonb
 where id = 'live600ctl' and not (rules ? 'weights');

update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{weights}', '{"from": "2026-10-30T00:00:00Z", "book": {"USDC-GBP": 0, "USDT-GBP": 1}, "k": {"0.001": 1, "0.002": 1, "0.003": 0}}'::jsonb)
 where id = 'n600no03' and rules->'weights' = '{"from": "2026-10-28T22:00:00Z", "k": {"0.001": 1, "0.002": 1, "0.003": 0}}'::jsonb;

update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{weights}', '{"from": "2026-10-30T00:00:00Z", "book": {"USDC-GBP": 1, "USDT-GBP": 1}}'::jsonb)
 where id = 'n600usdt' and rules->'weights' = '{"from": "2026-10-28T22:00:00Z", "book": {"USDC-GBP": 0, "USDT-GBP": 1}}'::jsonb;

update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes USDT 3:1 from 10-28'
 where id = 'n600usdt3' and display_name = 'Stablecoin quotes variant-4';

update public.agent_quote_twin_specs
   set enabled = false
 where id = 'n600usdt3';

update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes USDC nudge $300 from 10-29'
 where id = 'u300nudge' and display_name = 'Stablecoin quotes variant-6';

update public.agent_quote_twin_specs
   set enabled = false
 where id = 'u300nudge';

update public.agent_quote_twin_specs
   set enabled = false
 where id = 'u300ctl';

update public.agent_quote_twin_specs
   set hidden = true
 where id in ('n600usdt3', 'u300nudge');

update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes variant-4'
 where id = 'n600usdt' and display_name = 'Stablecoin quotes variant-5';

update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes variant-6'
 where id = 'live600x1' and display_name = 'Stablecoin quotes variant-7';

update public.agent_quote_twin_specs
   set display_name = 'Stablecoin quotes USDT/GBP LIVE twin'
 where id = 'live600' and display_name = 'Stablecoin quotes LIVE twin';

update public.agent_quote_twin_specs
   set display_order = 56
 where id = 'u300ctl' and display_order = 52;

insert into public.agent_quote_twin_specs
select * from jsonb_populate_recordset(null::public.agent_quote_twin_specs, $json$[
  { "id": "n600nudge", "display_name": "Stablecoin quotes variant-5", "display_order": 52, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-30T00:00:00Z", "table_prefix": "agent_quote_twin_n600nudge", "lease": "quotes-twin-n600nudge", "rules": { "fill": { "model": "at", "from": "2026-10-30T00:00:00Z" }, "weekend": { "from": "2026-10-30T00:00:00Z" }, "holdMin": { "from": "2026-10-30T00:00:00Z", "gbp": 1 }, "weights": { "from": "2026-10-30T00:00:00Z", "book": { "USDC-GBP": 1, "USDT-GBP": 1 } }, "fairNudge": { "from": "2026-10-30T00:00:00Z", "book": "USDC-GBP", "w": 0.5, "halfLifeMin": 1440 } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-29-usdt-only-twins-prereg.md", "migration": "0178", "enabled": true, "hidden": false }
]$json$::jsonb)
on conflict (id) do nothing;
select public.create_quote_twin_tables('n600nudge');
