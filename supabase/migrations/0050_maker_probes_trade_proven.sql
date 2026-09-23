-- 0050: a maker probe is filled only by a TRADE through its price.
--
-- The tick resolved a probe (`0042`) as filled when the execution venue's
-- last closed minute touched its price: `low <= maker` for a buy, `high >=
-- maker` for a sell, with no look at the minute's volume. Revolut X's UK
-- 1-minute candles are built from QUOTES while nothing trades (reference
-- §3.26): on the coins the loop trades 59–96 % of minutes carry no volume,
-- and many of them still move. From this commit the tick asks for a trade
-- (`tradedThrough` in agents/tick.ts: volume > 0, and strictly through the
-- price, because a print AT it fills the queue ahead of an order that
-- joined the touch). This migration does the two things that leaves.
--
-- 1. `fill_minute`: the minute candle that proved a fill, written beside
--    the verdict. The loop records inputs, not only conclusions, and the
--    venue keeps its 1-minute candles for 28 days: without this column a
--    fill could not be re-judged afterwards. These three could be only
--    because they were a day old.
--
-- 2. The three probes on record, all resolved under the old test on a
--    minute with ZERO volume, corrected to what the venue's own trades
--    show (its public candles, read back on 2026-09-23):
--
--      id  probe                        old: minute, fill   first trade through    fill
--      1   BTC/USD sell @ 85,675.99     04:00, vol 0, 1 min   04:07, vol 0.0291     8 min
--      2   ETH/USD sell @ 2,729.96      05:02, vol 0, 3 min   05:42, vol 0.0549    43 min
--      3   SOL/USD sell @ 116.319       08:00, vol 0, 1 min   08:06, vol 39.80      7 min
--
--    `resolved_at` becomes the turn after that minute closed, when the
--    fixed tick would first have seen it. `mark_at_resolve` and the
--    follow-up marks are CLEARED, not recomputed: the loop took them at
--    the wrong moments (old values below), and the mid the loop marks
--    with is not in any public record, so any other number would be a
--    reconstruction. `watching` stays false, so nothing is re-measured.
--    Old values, for the record:
--      1: resolved 04:01:00.525, mark 85650.755, m15 85547.285, m60 85409.585
--      2: resolved 05:03:01.57,  mark 2728.63,   m15 2719.16,   m60 2730.93
--      3: resolved 08:01:00.528, mark 116.335,   m15 116.345,   m60 117.2805
--
-- Replay-safe: the column is `if not exists`, and each update matches its
-- row by the values it corrects, so on a fresh database it touches nothing
-- and on a second run it finds nothing.

alter table public.agent_maker_probes add column if not exists fill_minute jsonb;

comment on column public.agent_maker_probes.fill_minute is
  'The execution venue''s 1-minute candle whose trade proved the fill (volume > 0, strictly through maker_price); null unless filled. Migration 0050.';

update public.agent_maker_probes
   set resolved_at = '2026-09-22 04:08:00+00', minutes_to_fill = 8, mark_at_resolve = null, follow_up = '{}'::jsonb, watching = false,
       fill_minute = '{"start": 1790050020000, "open": 85672.39, "high": 85681.96, "low": 85652.8, "close": 85654.27, "volume": 0.02914424}'::jsonb
 where id = 1 and symbol = 'BTC/USD' and side = 'sell' and maker_price = 85675.99 and state = 'filled' and minutes_to_fill = 1;

update public.agent_maker_probes
   set resolved_at = '2026-09-22 05:43:00+00', minutes_to_fill = 43, mark_at_resolve = null, follow_up = '{}'::jsonb, watching = false,
       fill_minute = '{"start": 1790055720000, "open": 2731.28, "high": 2733.23, "low": 2730.94, "close": 2731.41, "volume": 0.0549167}'::jsonb
 where id = 2 and symbol = 'ETH/USD' and side = 'sell' and maker_price = 2729.96 and state = 'filled' and minutes_to_fill = 3;

update public.agent_maker_probes
   set resolved_at = '2026-09-22 08:07:00+00', minutes_to_fill = 7, mark_at_resolve = null, follow_up = '{}'::jsonb, watching = false,
       fill_minute = '{"start": 1790064360000, "open": 116.327, "high": 116.396, "low": 116.291, "close": 116.396, "volume": 39.801196}'::jsonb
 where id = 3 and symbol = 'SOL/USD' and side = 'sell' and maker_price = 116.319 and state = 'filled' and minutes_to_fill = 1;
