-- 0121: "Stablecoin quotes with Euros - 2" starts today, not at tomorrow's midnight (Deviation 1 of its pre-registration,
-- docs/agents/reviews/2026-10-13-coinbase-weekend-prereg.md §7).
--
-- On whose word. Davies, 2026-10-13 (evening): start "Stablecoin quotes with Euros - 2" immediately; do not wait for
-- 2026-10-14 00:00 UTC. The arm's first run (01:07 UTC 2026-10-13) created its state row with `startedAt` at the first
-- 00:00 after it (§3's rule) and has decided no minute since: every turn finds its horizon before that start and saves
-- the same empty record.
--
-- What this does. One guarded update of that still-empty record: `state.startedAt` and `state.lastMinute` (and the
-- `last_minute` column) move from 2026-10-14 00:00 UTC to 2026-10-13 00:00 UTC, and each book's `state.fed` floor moves
-- to the newest trade id the recorder holds before that start, so the next runs decide 2026-10-13's minutes from the
-- recorded prints and rates (at most 60 minutes a run, `CB_MAX_MINUTES`, caught up within the hour) and then continue
-- minute by minute. The window is 2026-10-13 00:00 to 2026-11-10 00:00 UTC, read on 2026-11-10 from 00:30 UTC; the four
-- whole weekends of §3 are unchanged. No code changes: `cb_hold.ts` is hash-frozen, and its start rule for an empty
-- record (the next midnight) is untouched; the books' rung state, flat since the first run, is untouched too. Nothing
-- here touches the base test's record, tables or window.
--
-- The guards make it a no-op unless the record is exactly as its first run left it: `startedAt` still the 2026-10-14
-- epoch, no row in `cb_hold_minutes`, and this migration applied before 2026-10-14 00:00 UTC (after which the arm would
-- be deciding minutes of its own and its start must never be rewritten).

with s as (
  select timestamptz '2026-10-13 00:00:00+00' as a,
         timestamptz '2026-10-14 00:00:00+00' as b
)
update public.cb_hold_state st
set state = jsonb_set(
              jsonb_set(
                jsonb_set(st.state, '{startedAt}', to_jsonb((extract(epoch from s.a) * 1000)::bigint)),
                '{lastMinute}', to_jsonb((extract(epoch from s.a) * 1000)::bigint - 60000)),
              '{fed}', (select jsonb_object_agg(p, coalesce(
                          (select max(t.trade_id) from public.cb_trades t where t.product = p and t.ts < s.a), 0))
                        from unnest(array['USDC-GBP', 'USDT-GBP', 'USDC-EUR', 'USDT-EUR']) as p)),
    last_minute = s.a - interval '1 minute',
    updated_at = now()
from s
where st.id = 1
  and (st.state ->> 'startedAt')::bigint = (extract(epoch from s.b) * 1000)::bigint
  and now() < s.b
  and not exists (select 1 from public.cb_hold_minutes);
