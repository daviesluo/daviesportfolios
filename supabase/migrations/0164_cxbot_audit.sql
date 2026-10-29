-- 0164: CXBOT's independent audit (docs/agents/reviews/2026-10-29-cxbot-independent-audit.md, Davies 2026-10-29: "加密货币分析bot
-- 的所有rules和架构和prompts再交给一个独立subagents仔细深度审核下，确保所有细节完美"). One column, and nothing else changes.
--
--   cxbot_positions.funded_through   the hour up to which the position's funding is booked. The paper engine books an
--                                    hour's funding only by moving this forward (a compare-and-set), so a minute the engine
--                                    runs twice (a retry, a run that outlived its lease, a fault before its state was
--                                    written) never charges or pays the same hour twice (audit F3). Null: none booked yet.
--
-- The mode stays as it is (dry-run until Davies' word); no grant, no policy: the table keeps 0163's row level security.

set lock_timeout = '3s';

alter table public.cxbot_positions add column if not exists funded_through timestamptz;

reset lock_timeout;
