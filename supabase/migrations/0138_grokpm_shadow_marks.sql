-- 0138: GROKPM's shadow forecasts get the record their reading needs: each forecast's last trade (D10's column).
--
-- On whose word. Davies, 2026-10-23: "同意，按你的建议做" (the rules study, `docs/agents/reviews/2026-10-23-grokpm-rules-study.md`:
-- D10 scores D7's shadow forecasts against the market's last trade before each forecast as well as against the agent's
-- m); 2026-10-24: "同意 另外看看有什么可以优化的地方" (the optimisation review, `reviews/2026-10-24-grokpm-optimisation.md`,
-- finding F2: nothing recorded that last trade, and a market's public tape keeps only its newest trades).
--
--   grokpm_shadow_marks  one row a journal decision carrying p and m: the market's newest public taker trade at or before
--                        the decision's time, as the forecast token's price (a trade of the other outcome at q is 1 - q),
--                        or why there is none (`none_before`: the market had not traded; `beyond_window`: the tape's page
--                        ends after it). Beside it, the forecast token's best bid and ask as the public book shows
--                        them, kept only when read within ten minutes of the forecast (D10 marks a forecast whose book
--                        was one-sided or wider than 5 points; the journal holds the agent's m, not its book). Written
--                        once, a few markets a run, by the keyless recorder
--                        (`agents/grokpm_rec.ts`, `agents?action=grokpmrec`, every five minutes, already a row of
--                        `edge_calls` and of the watchdog). Read by the end reading only: no trading path, no page and not
--                        the agent's book reads it.
--
-- The same change has the recorder write `grokpm_resolutions` for the markets the forecasts name (F1), at a payout of 0,
-- 1/2 or 1 only; that table and its columns are unchanged (0124).
--
-- No grant and no policy: row level security is on, and 0082's default privileges keep `anon` and `authenticated` from the
-- new table. Only the service role (the `agents` function) touches it. No rule, bar or reading of the frozen
-- pre-registration changes.

create table if not exists public.grokpm_shadow_marks (
  decision_id  text primary key references public.grokpm_decisions (id),
  market_id    text not null check (market_id ~ '^0x[0-9a-f]{64}$'),
  token_id     text not null,
  decision_ts  timestamptz not null,
  status       text not null check (status in ('found', 'none_before', 'beyond_window')),
  price        numeric check (price is null or (price >= 0 and price <= 1)),
  trade_at     timestamptz,
  trade_asset  text,
  trade_side   text,
  trade_size   numeric,
  book_bid     numeric,
  book_ask     numeric,
  read_at      timestamptz not null default now(),
  check ((status = 'found') = (price is not null and trade_at is not null))
);

alter table public.grokpm_shadow_marks enable row level security;
