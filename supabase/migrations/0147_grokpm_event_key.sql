-- 0147: each GROKPM order keeps its market's negative-risk group, so one event's outcomes count as one market.
--
-- On whose word. Davies, 2026-10-27, on the first orders' proposals P1 and P2 ("剩下两点由你权衡后来做出最优选择": the
-- remaining two points, weigh them and make the best choice). P2 is Deviation D17 of the pre-registration
-- (`docs/agents/reviews/2026-10-27-grokpm-first-orders.md`): the outcome markets of one event, one negative-risk group,
-- count as one market for the $10 market cap and Deviation D15's $5. BanRep's "+25 bp, Yes" and "no change, No" both win
-- on a hike and were held as two markets of $10 each.
--
--   grokpm_orders.neg_risk_market_id  Gamma's `negRiskMarketID` of the order's market when the server read it (null for a
--                                     market that is not negative-risk). The server groups the agent's markets by it.
--
-- The orders placed before this column were read from Gamma on 2026-10-27 (public data) and are filled in below, so the
-- markets already held are grouped from the first minute: the three markets of the live record so far.
--
-- Written by the `grokpm` function. No grant and no policy (0125's table keeps its row level security). Narrows only.

alter table public.grokpm_orders add column if not exists neg_risk_market_id text;

update public.grokpm_orders set neg_risk_market_id = '0x05b05f89d96db9b8e63b5fbeed68083469f02c35300b6ba5de11817b446e3600'
  where neg_risk_market_id is null and cond in (
    '0xbba373b59d6eba4fb133670c4ac3fe77263b3cbd9b7e525ad4e894676b981074',   -- BanRep October: +25 bp
    '0x2e8f33b84686fac2bb77eb7d1276f2d844f8d9952150a9581a75cf05161aeaf4');  -- BanRep October: no change
update public.grokpm_orders set neg_risk_market_id = '0x6a791055f17cc4455c54a4bb713fe40e866b7337bdd1b870eacbb23129226400'
  where neg_risk_market_id is null and cond = '0x8f62c057175af52d5887e7af4efa3ae899d96146a43283cbedf1b5e2071c309d';  -- Vertiv Q3 margin 24-26 %
