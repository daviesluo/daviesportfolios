-- 0173: which source priced each Coinbase minute's rate, now that every Coinbase arm reads GBP/USD and EUR/USD at second
-- resolution (agents/cb_fx.ts).
--
-- On whose word. Davies, 2026-10-29: "coinbase的所有策略用更多秒级数据更长时间再深度回测验证下，如果还是正向优化的话把所有coinbase策略的
-- 汇率数据源从yahoo换为刚才研究的最佳秒级数据源+fallbacks" (backtest every Coinbase strategy again on more second-level data over
-- a longer time; if it still improves them, switch every Coinbase strategy's FX source from Yahoo to the best second-level source
-- just studied, with fallbacks). It did on all four (docs/agents/reviews/2026-10-29-fx-second-sources.md §8), and each arm's
-- pre-registration records the switch as a deviation: the base test's 7, the weekend variant's 6, "- 1"'s 5, "- 2"'s 4.
--
-- The rule (cb_fx.ts): from each arm's switch (`fxFrom` in its state, its first minute decided at or after 2026-10-29 10:00 UTC)
-- minute t's rate is the newest `fx_ticks` read (0172) that ARRIVED by t + 58 s, TrueFX's, or Kraken's marked fallback read when
-- that is newer, while it is no more than 120 s old; else Yahoo's bar as before (`fxBarAt`); else dark, or on a held arm its held
-- bar, holding the last fast read when it is no older than that bar.
--
-- The column, on the four arms' minute records: `fx_src`, the source of the book's own pair (GBP/USD on a GBP book, EUR/USD on a
-- EUR book): 'truefx', 'kraken', 'yahoo', 'held:truefx', 'held:kraken', 'held:yahoo', or 'dark'. Null on every minute before the
-- arm's switch, which is never backfilled. The arms count the same in their state (`fxCount`).
--
-- `fx_ticks` is no longer read by research alone: its comment says so. Its prune (42 days) is far longer than the 60 hours a held
-- arm reaches back.
--
-- What it leaves alone: every other column, the arms' calls, leases and prunes, Revolut X's tables. No grant and no policy.

alter table public.cb_quote_minutes add column if not exists fx_src text;
alter table public.cb_hold_minutes  add column if not exists fx_src text;
alter table public.cb_usdc_minutes  add column if not exists fx_src text;
alter table public.cb_nudge_minutes add column if not exists fx_src text;

do $$
declare t text;
begin
  foreach t in array array['cb_quote_minutes', 'cb_hold_minutes', 'cb_usdc_minutes', 'cb_nudge_minutes'] loop
    if not exists (select 1 from pg_constraint where conname = t || '_fx_src_check') then
      execute format('alter table public.%I add constraint %I check (fx_src in (''truefx'', ''kraken'', ''yahoo'', ''held:truefx'', ''held:kraken'', ''held:yahoo'', ''dark''))', t, t || '_fx_src_check');
    end if;
    execute format('comment on column public.%I.fx_src is %L', t,
      'The source of the book''s own rate this minute (agents/cb_fx.ts, 0173): truefx, kraken, yahoo, held:*, dark. Null before the arm''s switch.');
  end loop;
end $$;

comment on table public.fx_ticks is 'Second-level GBP/USD and EUR/USD (agents/fx_rec.ts, 0172): TrueFX primary, Kraken fallback. Every Coinbase arm prices its rate on it since 0173 (agents/cb_fx.ts).';
