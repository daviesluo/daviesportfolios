-- 0047: the fixed Jev question's threshold on every row.
--
-- Davies, 2026-09-23, on putting the model in shadow: "这不就相当于把jev模型给
-- 实际retire了？听起来像是jev模型的规则配置问题而不是jev本身，请修复并验证" —
-- it is the question's configuration, not the model; fix it and verify it.
-- Paper rows only: no row trades real money yet.
--
-- WHAT WAS WRONG (reference §4.21)
--
--   * The v1 question listed the conditions of an "established uptrend" —
--     trend_strength moderate or strong, momentum_30d positive — and the model
--     applied the list to the letter: every weak-trend and every unknown-momentum
--     entry got P 0.04-0.21 and was vetoed. The rulebook reads neither word, so
--     that was a filter written in prose and never backtested.
--   * The threshold, 0.60, sat inside the band where the model's high-volatility
--     answers flipped from call to call (0.54-0.64): a coin flip on a third of
--     the entries.
--
-- WHAT CHANGES
--
--   * The loop now asks `jevQuestionsV2` (tick.ts, from this push): it says what
--     the rule already checked, defines the words without saying what to
--     conclude, and asks whether the move looks more likely to continue than to
--     fail. The model was asked every entry state five times with it; its
--     replies are `docs/agents/backtests/jev_answers_v2.json` and
--     `jev_answers_v2_other.json`.
--   * `enterMin` 0.60 -> 0.45 on all three rows. Chosen from those replies alone,
--     before any backtest: on a trend entry every reply for a weak trend in high
--     volatility is 0.35-0.41 and every other reply is 0.47 or more, so a
--     threshold anywhere in (0.41, 0.47] decides every state the same way on
--     every call. 0.45 is in that band. `JEV_ENTER_MIN` in agents_strategy.ts is
--     the same number, pinned against the measured replies.
--
-- WHAT IT COSTS AND EARNS (docs/agents/backtests/jev_v2.json)
--
-- On the live candidate's four walk-forward windows, primary evaluation, the
-- rulebook alone against the rulebook with the fixed gate: A +8.0 -> +9.6 %,
-- B +20.1 -> +19.5 %, C +55.6 -> +58.2 %, D -7.8 -> -7.8 %. It refuses 0-9 %
-- of entries (none in D), improves A and C in all four evaluations, and leaves
-- the worst window where it was. The gate as it ran (v1 at 0.60) read -1.0 /
-- +14.6 / +55.7 / -2.3 %.
--
-- For momentum-1d the same question and threshold refuse a buy whose 4-hour
-- picture is against it (a down or flat-and-weak trend, a breakdown); that rule
-- is not priced by this replay, as it never was under v1, and its paper record
-- is the measurement.
--
-- TO UNDO: set enterMin back to 0.6 and JEV_QUESTION_VERSION back to "v1".
--
-- Dry-run before pushing, inside a transaction that raised at the end: 3 rows
-- updated, each params with enterMin 0.45 and every other key unchanged.

do $$
declare n int;
begin
  update public.agent_strategies
     set params     = params || '{"enterMin": 0.45}'::jsonb,
         updated_at = now()
   where id in ('trend-4h', 'trend-1h', 'momentum-1d');
  get diagnostics n = row_count;
  if n <> 3 then
    raise exception '0047: expected to update 3 strategy rows, updated %', n;
  end if;
end $$;
