-- 0126: GROKPM's market titles, so its page names every market its journal mentions and links it on polymarket.com.
--
-- On whose word. Davies, 2026-10-17: "子页面JOURNAL部分做的更美观和清晰一些…链接可以直接用link（下划线）作为超链接可以点，而且目前
-- 还有“0xdf9bf27e…”这种乱码应该是问题没显示正常的问题" (make the JOURNAL clearer, links clickable and underlined, and the
-- "0xdf9bf27e…" is a market that did not display properly). The page took titles only from the markets the agent HOLDS
-- (`grokpm_entries`, the record's positions), so a decision on any other market showed its condition id.
--
--   grokpm_markets  one row a market the agent's journal or its record names: its question, its slug (the page links
--                   https://polymarket.com/market/<slug>) and its end date, as Gamma serves them by condition id. Written by
--                   the keyless recorder (`agents/grokpm_rec.ts`) for each condition id it does not hold yet, a few a run;
--                   read by the dashboard (`agents/grokpm_view.ts`). A cache of public data: nothing trades on it.
--
-- No grant and no policy: row level security is on, and 0082's default privileges keep `anon` and `authenticated` from the
-- new table. Only the service role (the `agents` function) touches it.

create table if not exists public.grokpm_markets (
  cond        text primary key check (cond ~ '^0x[0-9a-f]{64}$'),  -- the market's condition id, lower case
  question    text,
  slug        text,
  end_date    timestamptz,
  updated_at  timestamptz not null default now()
);

alter table public.grokpm_markets enable row level security;
