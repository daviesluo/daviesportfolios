-- 0146: LIVE's capital can compound what it realises, OFF until Davies turns it on (Davies, 2026-10-27: "你再研究下策略如何能够
-- 有效利用账户中赚的钱，我希望赚的钱也能利用起来，现在好像完全没用到"; docs/agents/reviews/2026-10-26-stablecoin-quotes-review.md §9;
-- agents/quotes_compound.ts).
--
-- The columns, on LIVE's config only (a twin's config has none, and its capital never moves):
--   compound_mode      'off' (the default: nothing changes) or 'realised';
--   compound_base_gbp  the capital when it was turned on: what was put in;
--   compound_from      when it was turned on: realised P&L counts from here;
--   compound_cap_gbp   the most it may set: £1,200, the size read's per-pound cliff, until variant-1's reading (11-11);
--   compound_floor_gbp the least it may set: £300;
--   compound_step_gbp  how far the target must be from the capital before it moves: £12, a pound a rung;
--   compound_on        the UTC day it last ran; compound_last what it found then.
-- With 'realised', the first quotes call of each UTC day sets `capital_gbp` to base + realised since `compound_from`, in whole
-- £12, between the floor and the cap, when that is at least the step away; 0145's trigger records each change.
--
-- To turn it on (Davies' one statement; the first change can come at the next 00:00 UTC):
--   update public.agent_quote_live_config
--      set compound_mode = 'realised', compound_base_gbp = capital_gbp, compound_from = now(),
--          compound_on = (now() at time zone 'utc')::date, updated_at = now()
--    where id = 1;
-- To turn it off (the capital stays where it is):  update public.agent_quote_live_config set compound_mode = 'off' where id = 1;
-- After a deposit or a withdrawal of £D:  update public.agent_quote_live_config set compound_base_gbp = compound_base_gbp + D where id = 1;
--
-- What it leaves alone: every value LIVE runs on now (capital, take_mode, weekend_mode, dry_run, live_confirmed_at), its other
-- tables, the twins, `edge_calls` (it runs inside `agents?action=quotes`). No grant and no policy.

alter table public.agent_quote_live_config
  add column if not exists compound_mode text not null default 'off',
  add column if not exists compound_base_gbp numeric,
  add column if not exists compound_from timestamptz,
  add column if not exists compound_cap_gbp numeric not null default 1200,
  add column if not exists compound_floor_gbp numeric not null default 300,
  add column if not exists compound_step_gbp numeric not null default 12,
  add column if not exists compound_on date,
  add column if not exists compound_last jsonb;

alter table public.agent_quote_live_config drop constraint if exists agent_quote_live_config_compound_check;
alter table public.agent_quote_live_config add constraint agent_quote_live_config_compound_check check (
  compound_mode in ('off', 'realised')
  and compound_cap_gbp > 0 and compound_floor_gbp > 0 and compound_floor_gbp <= compound_cap_gbp and compound_step_gbp > 0
  and (compound_mode = 'off' or (compound_base_gbp > 0 and compound_from is not null))
);
