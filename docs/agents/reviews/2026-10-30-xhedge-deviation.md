# XHEDGE: deviations from the frozen pre-registration

`reviews/2026-10-30-xhedge-prereg.md` is frozen by its sha256 (`src/xhedge_prereg.test.js`), so its §7 deviations are written
here, as the compounding and OKX deviations are written apart from theirs. Each one: the date, the reason, Davies' word, the pin,
and the files' sha256 where a file changed.

## Deviation 1 — the window starts at 2026-10-30 04:20 UTC, not at the first 00:00 UTC after the first run

- **On whose word.** Davies, 2026-10-30 ~04:17 UTC: "A1/A2 纸面测试现在就可以上线" (A1/A2's paper test may go live now).
- **What changed.** §3 set S, each arm's `agent_xhedge_state.state.startedAt`, at the first 00:00 UTC after its first run: the
  first run (03:18 UTC) wrote S = 2026-10-31 00:00 UTC. One statement moved it, on both arms, before either had decided a minute:

  ```sql
  update public.agent_xhedge_state
     set state = jsonb_set(jsonb_set(state, '{startedAt}', to_jsonb(1793334000000::bigint)), '{lastMinute}', to_jsonb(1793333940000::bigint)),
         last_minute = '2026-10-30T04:19:00Z', updated_at = now()
   where arm in ('inside','behind') and (state->>'startedAt')::bigint = 1793404800000 and state->'books' = '{}'::jsonb;
  ```

  It returned two rows (`inside`, `behind`), each S = 2026-10-30 04:20:00 UTC and its last decided minute 04:19 UTC.
- **What did not change.** No file: the rule (§2), its numbers, its inputs and the bar (§5) are as frozen; `xhedge.ts` decides a
  minute from `lastMinute` + 1 whatever S is, and the first day's TODAY is measured against FUNDED (`xhedge_page.ts`).
- **The window and the reading date follow S (§3).** The window is 2026-10-30 04:20 UTC → 2026-11-27 04:20 UTC; the reading runs on
  or after 2026-11-27 05:20 UTC and no later than 2026-12-04 04:20 UTC. The first UTC day is a part day (04:20 → 24:00); a reading in
  days counts it as a day, and the void rule's "dark for more than 3 of the 28 days" counts UTC days from 10-30.
- **Pin.** No code changed, so no test can fail on old code; the reading script reads S from the state row, as §3 says.
