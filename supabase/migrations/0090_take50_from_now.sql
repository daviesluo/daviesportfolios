-- 0090: TAKE ("Stablecoin quotes variant-2", `take50`) starts its rule at 2026-10-04 16:00 UTC instead of 10-05 00:00
-- (docs/agents/reviews/2026-10-03-take-prereg.md, Addendum 1). Davies, 2026-10-04: "这个现在就开始吧 为什么要等？". The
-- 10-05 start was chosen only to open on a Monday's 00:00; nothing in the rule needs it. The new instant is in the future
-- when this lands, so no turn already taken changes: before it the twin is variant-1 minute for minute (K1), from it the
-- take runs as frozen. Only this row's `rules.take.from` moves; every other column and row stays.
update public.agent_quote_twin_specs
   set rules = jsonb_set(rules, '{take,from}', '"2026-10-04T16:00:00Z"'::jsonb)
 where id = 'take50' and rules->'take'->>'from' = '2026-10-05T00:00:00Z';
