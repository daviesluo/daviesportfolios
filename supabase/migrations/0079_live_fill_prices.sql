-- 0079: every live fill booked before 2026-10-02, re-priced at what its account moved.
--
-- On whose word. Davies, 2026-10-02: "“成交记账精度” - 这个做". From that day `toOrderView` (`_shared/revx.ts`,
-- `fillPrice`) prices a Revolut X fill at its reply's `filled_amount` over the GROSS `filled_quantity`: what the account
-- moved. The venue moves the quote currency in whole hundredths, a sell's credit floored and a buy's debit rounded up,
-- and derives `average_fill_price`, which the client booked until then, from that amount at the pair's price step. Fill
-- 1184 sold 13.18565 USDT and was credited £9.99; its 0.7576 average booked £9.98945.
--
-- This applies the same rule to the fills booked before it, each from its OWN stored reply: the venue's read-back,
-- which the row keeps as `response`, or as `response.view` where the tick reconciled the order by its client id.
-- Nothing is estimated. Read on production first (2026-10-02, read-only): eight live fills, all eight carrying
-- `filled_amount`, and both accounts moved by exactly those amounts. PR5's GBP moved -£60.00 over its six (the averages
-- say -£60.00053); the live row's USD moved -$0.66 over its two and their $0.03 fee (the averages say -$0.66006);
-- reference §4 item 35. Where the venue took the fee in the coin, the fee is re-valued at the new price, as
-- `toOrderView` values it, so a buy's coins held and its fee cost exactly the debit. Before -> after:
--
--   agent_quote_live_orders, PR5 (GBP)  avg_fill_price              fee_gbp                         books
--   1154 buy  39.58399 (0.03566 USDT)   0.7572 -> 0.757200025745…   0.027001752 -> 0.027001752918…  29.99999898 -> 30
--   1158 buy  39.54742 (0.03563 USDC)   0.7579 -> 0.757900161812…   0.027003977 -> 0.027003982765…  29.99999360 -> 30
--   1184 sell 13.18565                  0.7576 -> 0.757641830323…                                   9.98944844 -> 9.99
--   1186 buy  13.18565                  0.7584 -> 0.758400230554…                                   9.99999696 -> 10
--   1309 sell 13.19262                  0.758  -> 0.757999548232…                                   10.00000596 -> 10
--   1314 buy  13.1916                   0.7573 -> 0.757300100064…                                   9.98999868 -> 9.99
--   agent_orders, trend-4h-live (USD)   avg_fill_price              fee_usd                         books
--   37   buy  0.206612 (0.000187 SOL)   120.94 -> 120.938689258652…  0.02261578 -> 0.022615534891…   25.01027106 -> 25.01
--   44   sell 0.206612 ($0.03 fee)      118    -> 117.998954562175…                                  24.350216 -> 24.35
--
-- ("books" is a buy's base × price + fee, a sell's base × price - fee.) So PR5's first round trip reads -£0.0100, what
-- the account lost, not -£0.0105, and the live row's SOL trip -$0.66, not -$0.66006. Bases, states, a fee in the quote
-- currency, a derived fee (D8, `feeDerived`), a fee of nothing, and every row whose reply has no usable `filled_amount`
-- (it keeps the venue's average, as the code does) are left as they are. Each expression below mirrors `toOrderView`:
-- the quantity is `filled_quantity`, else `filled_size`; the fee `total_fee`, else `fees`; a coin fee is one whose
-- `fee_currency` is the pair's base.
--
-- Replay-safe: each value is computed from the row's own reply, so a second run writes what the first did, and a fresh
-- database has no live fill to touch. Dry-run on production before pushing, as a read-only SELECT of these expressions:
-- the eight rows above, each then booking its `filled_amount` (a sell's less its fee in the quote currency) to within
-- 1e-17 (numeric division carries the price to about twenty significant digits).
-- The tables carry no trigger, rule or check on these columns.

with r as (
  select o.id, o.response ? 'feeDerived' as derived,
    case when jsonb_typeof(o.response->'view') = 'object' then o.response->'view' else o.response end as reply
  from public.agent_quote_live_orders o
  where o.mode = 'live' and o.state in ('filled', 'partially_filled')
), n as (
  select r.id, r.derived,
    case when r.reply->>'filled_amount' ~ '^[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$' then (r.reply->>'filled_amount')::numeric end as amount,
    case when coalesce(r.reply->>'filled_quantity', r.reply->>'filled_size') ~ '^[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$'
      then coalesce(r.reply->>'filled_quantity', r.reply->>'filled_size')::numeric end as gross,
    case when coalesce(r.reply->>'total_fee', r.reply->>'fees') ~ '^[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$'
      then coalesce(r.reply->>'total_fee', r.reply->>'fees')::numeric end as fee,
    r.reply->>'fee_currency' = split_part(replace(r.reply->>'symbol', '-', '/'), '/', 1) as coin_fee
  from r
)
update public.agent_quote_live_orders o
set avg_fill_price = n.amount / n.gross,
    fee_gbp = case when n.coin_fee and not n.derived and n.fee > 0 then n.fee * (n.amount / n.gross) else o.fee_gbp end,
    updated_at = now()
from n
where o.id = n.id and n.amount > 0 and n.gross > 0;

with r as (
  select o.id, o.response ? 'feeDerived' as derived,
    case when jsonb_typeof(o.response->'view') = 'object' then o.response->'view' else o.response end as reply
  from public.agent_orders o
  where o.mode = 'live' and o.state in ('filled', 'partially_filled')
), n as (
  select r.id, r.derived,
    case when r.reply->>'filled_amount' ~ '^[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$' then (r.reply->>'filled_amount')::numeric end as amount,
    case when coalesce(r.reply->>'filled_quantity', r.reply->>'filled_size') ~ '^[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$'
      then coalesce(r.reply->>'filled_quantity', r.reply->>'filled_size')::numeric end as gross,
    case when coalesce(r.reply->>'total_fee', r.reply->>'fees') ~ '^[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$'
      then coalesce(r.reply->>'total_fee', r.reply->>'fees')::numeric end as fee,
    r.reply->>'fee_currency' = split_part(replace(r.reply->>'symbol', '-', '/'), '/', 1) as coin_fee
  from r
)
update public.agent_orders o
set avg_fill_price = n.amount / n.gross,
    fee_usd = case when n.coin_fee and not n.derived and n.fee > 0 then n.fee * (n.amount / n.gross) else o.fee_usd end,
    updated_at = now()
from n
where o.id = n.id and n.amount > 0 and n.gross > 0;
