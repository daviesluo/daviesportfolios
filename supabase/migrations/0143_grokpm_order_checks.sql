-- 0143: each GROKPM order keeps what its checks read, so a later check can see what the server judged.
--
-- On whose word. Davies, 2026-10-27: "Polymarket analyst下了几单，你也仔细验证下并且也看看有什么可以优化的地方" (the order
-- verification, `docs/agents/reviews/2026-10-27-grokpm-first-orders.md`, V1). The first D15 orders could be checked
-- against everything but two things: the `event_at` the agent sent, which sets a D15 order's cut, and the book the server
-- read, which decides whether an order was thin (orders 9 and 11 of 10-26 went out as ordinary orders in a market whose
-- other bids were D15's, and nothing recorded why).
--
--   grokpm_orders.event_at  the `event_at` of the order's body as sent (null when none was sent or it was null).
--   grokpm_orders.checks    what the server read and computed for it: the book (best bid and ask, mid, spread, bids
--                           within 5 points), the edge (p less the dearer of price and mid), the market's cost with the
--                           order, the quarter-Kelly cap, and for a D15 order its cap and cut. A record, read by no rule.
--
-- Written by the `grokpm` function. No grant and no policy (0125's table keeps its row level security). No rule changes.

alter table public.grokpm_orders add column if not exists event_at timestamptz;
alter table public.grokpm_orders add column if not exists checks jsonb;
