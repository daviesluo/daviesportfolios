-- 0068: a minute that began before a maker probe was written does not fill it.
--
-- `tradedThrough` (agents/tick.ts, `0050`) resolved a resting probe, and a
-- resting paper order, on the execution venue's last closed 1-minute candle
-- without asking when that minute began. The loop writes an order a few
-- seconds into its minute and reads that same minute back as the last closed
-- one on the next turn, so a trade in those first seconds could fill a probe
-- that did not exist yet: a candle cannot say when inside it a print came.
-- From this commit the minute must begin at or after the probe (or order) was
-- written. This migration corrects the two probes on record that the old test
-- resolved on such a minute, found by the TESTING review of 2026-09-27
-- (`docs/agents/reviews/2026-09-27-testing-portfolio-review.md`). The other
-- nine were all resolved on a minute that began after they were written.
--
-- Both are corrected to what the venue's own trades show (Revolut X's public
-- UK 1-minute candles for SOL/USD, read back on 2026-09-27): the first minute
-- that began after the probe was written, traded (volume > 0) and went
-- strictly through its price.
--
--   id  probe (written)                        old: minute, fill   first trade through after it    fill
--   15  SOL/USD sell @ 119.992 (10:00:04.597)  10:00, 1 min        09-26 10:01, vol 0.4999, high 120.026    2 min
--   17  SOL/USD buy  @ 124.143 (08:00:04.697)  08:00, 1 min        09-27 08:38, vol 0.1867, low 124.117    39 min
--
-- As in `0050`: `resolved_at` becomes the turn after that minute closed, when
-- the fixed tick would first have seen it; `mark_at_resolve` and the follow-up
-- marks are CLEARED, not recomputed, because the loop took them at the wrong
-- moments and the mid it marks with is in no public record. `watching` stays
-- false, so nothing is re-measured. Old values, for the record:
--   15: resolved 2026-09-26 10:01:28.393, mark 120.0095, m15 120.4125, m60 120.487,
--       fill_minute 10:00 {open 119.974, high 120.005, low 119.93, close 120.005, vol 0.124995}
--   17: resolved 2026-09-27 08:01:00.303, mark 123.955, m15 124.854, m60 124.198,
--       fill_minute 08:00 {open 124.38, high 124.42, low 124.11, close 124.11, vol 7.515224}
--
-- A probe is a notebook, never an order: no position, order, P&L or page
-- figure reads these rows (the dashboard's `probeSummary` is read by query).
--
-- Replay-safe: each update matches its row by the values it corrects, so on a
-- fresh database it touches nothing and on a second run it finds nothing.
-- Dry-run on production before pushing, inside a block that raised at the end
-- to roll itself back: one row each.

update public.agent_maker_probes
   set resolved_at = '2026-09-26 10:02:00+00', minutes_to_fill = 2, mark_at_resolve = null, follow_up = '{}'::jsonb, watching = false,
       fill_minute = '{"start": 1790416860000, "open": 120.01, "high": 120.026, "low": 120.01, "close": 120.026, "volume": 0.499929}'::jsonb
 where id = 15 and symbol = 'SOL/USD' and side = 'sell' and maker_price = 119.992 and state = 'filled' and minutes_to_fill = 1;

update public.agent_maker_probes
   set resolved_at = '2026-09-27 08:39:00+00', minutes_to_fill = 39, mark_at_resolve = null, follow_up = '{}'::jsonb, watching = false,
       fill_minute = '{"start": 1790498280000, "open": 124.117, "high": 124.117, "low": 124.117, "close": 124.117, "volume": 0.186692}'::jsonb
 where id = 17 and symbol = 'SOL/USD' and side = 'buy' and maker_price = 124.143 and state = 'filled' and minutes_to_fill = 1;
