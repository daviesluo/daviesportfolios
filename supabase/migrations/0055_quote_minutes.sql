-- 0055: PR5's paper engine writes down, for every minute it decides, the inputs it decided it on (reference §4 item 31).
--
-- `agent_quote_inputs` keeps every GBP/USD minute and USD-book hour, but each fetch re-writes the rows it returns, so a
-- value the source revised after the engine read it is gone, and a candle that arrived late looks as if it had always
-- been there. On the test's first evening that left one USDT-GBP re-price unexplainable from the record: the stored
-- close put fair 0.106 bps past the re-price step, and the engine had not acted (backtests/pr5_live/
-- reconcile_first_day.py). The engine wrote its inputs only on the minutes it acted.
--
-- So each decided minute gets one row per book: X as the turn read it and the start of the Yahoo bar it came from, the
-- USD book's median and how many hourly closes it took, and how many prints the minute was decided on. These are
-- inputs, never conclusions: nothing the rule decides reads this table, and a minute decides the same with it or
-- without it (pinned on replayed production minutes in `quotes.test.ts`). With it, the four-week review can replay each
-- minute on what the engine actually read. A change made while the test runs; the spec's record says from when.

create table if not exists public.agent_quote_minutes (
  book        text not null check (book in ('USDC-GBP', 'USDT-GBP')),
  minute      timestamptz not null,                          -- the minute decided
  x           numeric check (x is null or x > 0),            -- GBP/USD as the turn read it; null is dark
  x_t         timestamptz,                                   -- the start of the Yahoo minute bar X came from
  fair_u      numeric check (fair_u is null or fair_u > 0),  -- the USD book's median close as the turn read it; null is none
  hours_n     integer not null check (hours_n >= 0),         -- how many hourly closes that median took
  prints_n    integer not null check (prints_n >= 0),        -- the book's prints the minute was decided on
  recorded_at timestamptz not null default now(),
  primary key (book, minute)
);

alter table public.agent_quote_minutes enable row level security;
