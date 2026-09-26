-- 0059: the two paper rows ask Jev in shadow (Davies, 2026-09-26: "这个听你的吧", on the session's recommendation).
--
-- Priced on 2026-09-23 (reference §4.21), the v2 gate at 0.45 fails its bar on `trend-1h` and `momentum-1d`: trend-1h's
-- worst window falls in all four evaluations, and momentum-1d's bear year falls 4–15 points as the loop runs it. Each
-- row's own wording was then measured and priced (§4.28) and neither clears the bar either. In shadow
-- (`params.jevGate = false`, `combineDecision`) the model is still asked on every entry and its answer still recorded,
-- and the decision's reason says whether it would have vetoed; the entry is the rulebook's. So these rows keep a
-- forward record of what the gate would have done, from which a later test can score it, instead of being run by a
-- gate that failed its bar. Their Binance twins take the same step, so each pair keeps making the same decisions.
--
-- The live row (`trend-4h-live`) and its paper control keep the v2 gate at 0.45: on trend-4h it passed its bar.

update public.agent_strategies
set params = params || '{"jevGate": false}'::jsonb
where id in ('trend-1h', 'trend-1h-binance', 'momentum-1d', 'momentum-1d-binance');
