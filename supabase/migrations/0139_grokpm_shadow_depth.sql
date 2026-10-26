-- 0139: GROKPM's shadow forecasts keep the depth of the book they saw, so the thin rule can be judged on the record.
--
-- On whose word. Davies, 2026-10-26: "grok bot的live策略到现在还是一单没下，你再研究下策略需要优化吗？是不是规则还是太严了" (the
-- thin-rule study, `docs/agents/reviews/2026-10-26-grokpm-thin-rule-study.md`, G3). The server's thin rule refuses a book
-- whose spread is over 5 points or which holds under $500 of bids within 5 points of the mid. 0138 kept only a forecast's
-- best bid and ask, so the study could test the spread half of the rule and not the depth half, which stopped every
-- clear in a tight book (Vertiv, the BanRep pair, Korea's GDP).
--
--   grokpm_shadow_marks.bid_depth_usd  the dollars of the forecast token's bids within 5 points of its book's mid, and
--   grokpm_shadow_marks.ask_depth_usd  of its asks, as the server's `bookOf` counts them (`GROKPM_RULES.depthBand`),
--                                      from the same public book read as `book_bid`/`book_ask`: kept only when read
--                                      within ten minutes of the forecast; null when not, or when a side is empty.
--
-- Written by the keyless recorder (`agents/grokpm_rec.ts`). Read by no trading path, page or book. No grant and no
-- policy (0138's table keeps its row level security). No rule, bar or reading of the frozen pre-registration changes.

alter table public.grokpm_shadow_marks add column if not exists bid_depth_usd numeric check (bid_depth_usd is null or bid_depth_usd >= 0);
alter table public.grokpm_shadow_marks add column if not exists ask_depth_usd numeric check (ask_depth_usd is null or ask_depth_usd >= 0);
