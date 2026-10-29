-- 0169: "Stablecoin quotes variant-7", REVX-FAIR's USDC-GBP lead as a paper twin on LIVE's rules, $300 funded, USDC-GBP alone,
-- its fair nudged by Coinbase's USDC-GBP; and its control, the same twin without the nudge, hidden
-- (docs/agents/reviews/2026-10-29-revx-usdc-nudge-twin-prereg.md; the study, docs/agents/reviews/2026-10-29-revx-fair-price-study.md §5–6).
--
-- On whose word. Davies, 2026-10-29: "“唯一的线索：只针对 USDC-GBP • 做法：用 Coinbase 的 USDC-GBP 中间价偏离程度，对合理价做半权重的
-- 微调。” 这个开testing variant-7，在目前实盘的基础上做300美元funded" (the one lead, USDC-GBP only, the fair nudged at half weight
-- by Coinbase's USDC-GBP mid's deviation: open it as testing variant-7, on LIVE's current rules, funded $300).
--
-- 1. `agent_quote_twin_nudge`: each minute of a nudged twin's book from its start, what its fair was, Coinbase's mid and its
--    instant, the EMA, the deviation, the fair it priced off and why it fell back (`quotes_nudge.ts`, `nudgeRow`). About 1,440
--    rows a day for the one twin; nothing prunes it during the 28-day window.
-- 2. Two twins, from 2026-10-30 00:00 UTC (the first 00:00 after this push; a later apply catches up from it on PR5's own
--    record, as a twin whose start is behind it does), each on LIVE's rules as `live600` has them (LIVE's fill rule) with the
--    weekend from its start (LIVE quotes closures since 2026-10-23 21:00), USDC-GBP alone (`weights`: USDT-GBP 0, as `n600usdt`
--    weights the other way), £225.33: $300 at GBP/USD 1.3314, the rate read at writing (`usdCapital`; the page shows FUNDED
--    $300). Six rungs of £37.55 (`rungGbpOf`: £225.33 ÷ 6 to the penny below), about $49.99 each.
--      `u300nudge` "Stablecoin quotes variant-7": with `fairNudge` (w 0.5, a 24-hour half-life, a touch at most 5 minutes old).
--      `u300ctl`   "Stablecoin quotes USDC control from 10-30": without it, hidden (it runs; the page shows nothing of it). The
--                  pre-registration's comparison is variant-7 against it, day by day: the same capital, rungs and fills rule,
--                  so the difference is the nudge's.
--    Their tables are 0087's template (`create_quote_twin_tables`). The twins' minute call (`agents?action=quotestwins`, 0087)
--    runs every enabled row: no call is added, so nothing joins `edge_calls` or the watchdog.
--
-- Its order with the function. The rules `fairNudge` and `usdCapital` deploy with this push (edge-functions.yml) while this
-- applies (migrations.yml); a function without them refuses both rows ("no code for its rule") and runs the rest, and both
-- wait for their start either way.
--
-- What it leaves alone: every other twin's row and record, the live executor, its config and tables, PR5's paper engine,
-- `edge_calls` and every cron job. No grant and no policy: row level security is on, and 0082's default privileges keep
-- `anon` and `authenticated` out.

create table if not exists public.agent_quote_twin_nudge (
  twin_id     text not null,
  book        text not null,
  minute      timestamptz not null,
  fair        numeric,
  cb_mid      numeric,
  cb_at       timestamptz,
  ema         numeric,
  dev         numeric,
  fair_nudged numeric,
  fallback    text check (fallback in ('dark', 'stale', 'cap')),
  primary key (twin_id, book, minute)
);
alter table public.agent_quote_twin_nudge enable row level security;

insert into public.agent_quote_twin_specs
select * from jsonb_populate_recordset(null::public.agent_quote_twin_specs, $json$[
  { "id": "u300nudge", "display_name": "Stablecoin quotes variant-7", "display_order": 51, "engine": "pr5", "capital_gbp": 225.33, "gov": "account", "start": "2026-10-30T00:00:00Z", "table_prefix": "agent_quote_twin_u300nudge", "lease": "quotes-twin-u300nudge", "rules": { "fill": { "model": "at", "from": "2026-10-30T00:00:00Z" }, "weekend": { "from": "2026-10-30T00:00:00Z" }, "weights": { "from": "2026-10-30T00:00:00Z", "book": { "USDC-GBP": 1, "USDT-GBP": 0 } }, "usdCapital": { "usd": 300, "gbpusd": 1.3314 }, "fairNudge": { "from": "2026-10-30T00:00:00Z", "book": "USDC-GBP", "w": 0.5, "halfLifeMin": 1440 } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-29-revx-usdc-nudge-twin-prereg.md", "migration": "0169", "enabled": true, "hidden": false },
  { "id": "u300ctl", "display_name": "Stablecoin quotes USDC control from 10-30", "display_order": 52, "engine": "pr5", "capital_gbp": 225.33, "gov": "account", "start": "2026-10-30T00:00:00Z", "table_prefix": "agent_quote_twin_u300ctl", "lease": "quotes-twin-u300ctl", "rules": { "fill": { "model": "at", "from": "2026-10-30T00:00:00Z" }, "weekend": { "from": "2026-10-30T00:00:00Z" }, "weights": { "from": "2026-10-30T00:00:00Z", "book": { "USDC-GBP": 1, "USDT-GBP": 0 } }, "usdCapital": { "usd": 300, "gbpusd": 1.3314 } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-29-revx-usdc-nudge-twin-prereg.md", "migration": "0169", "enabled": true, "hidden": true }
]$json$::jsonb)
on conflict (id) do nothing;
select public.create_quote_twin_tables('u300nudge');
select public.create_quote_twin_tables('u300ctl');
