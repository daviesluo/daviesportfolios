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

## Deviation 2 — two hedges of one key settle as one trip (2026-10-31; Davies: "两个策略停了，有报错，请修复")

- **What happened.** From 2026-10-30 09:57 UTC (`inside`) and 10:55 UTC (`behind`) every run failed writing
  `agent_xhedge_trips` with Postgres 21000 ("ON CONFLICT DO UPDATE command cannot affect row a second time") and rolled the arm
  back to the state it had, so no minute after those was decided until this fix.
- **Why.** Two Revolut X prints stamped the same millisecond (one taker's order across levels), each filling over £1 of the
  arm's order, became two owed hedges with the same first and last fill, settled on the same Coinbase read: two trips with
  one key (arm, book, side, t_fill, t_hedge) in one batch.
- **The fix, and why it is a deviation.** `xhSettle` folds hedges of one key into one trip: quantity, fee, P&L and fills
  summed, the Revolut X price weighted by quantity. It only makes the code do what §2 says (each fill hedged at the first read
  ≥ fill + 30 s); the money and the inventory are exactly the two trips', so the effect on every figure the reading uses is
  nil by construction, and the record keeps one row where it would have kept two. The count of folded trips in the minutes
  it touched is read after the replay and added below.
- **The minutes it touched.** The missed minutes are decided after the fix by the arms' own code from the same recorded
  inputs (`agent_book_levels`, `cb_touch`, `agent_quote_prints`, all kept from 10-28), 30 minutes a run, so the record has
  no hole; the void rule's "dark" counts days without decided minutes, and none is.
- **Pin.** "two prints of one instant, each a whole hedge, settle as one trip" in `xhedge.test.ts`, failing on the old code
  (shown: 14 passed, 1 failed with the fix reverted).
- **The files' new sha256** (the others are §8's):

| file | sha256 |
|---|---|
| `supabase/functions/agents/xhedge.ts` | c896c6b3523090ad1bf3f85c35acccfb710441e09df435304862414d42a8ffa2 |
| `supabase/functions/agents/xhedge.test.ts` | 36999897f1b8beecc043f9fe5482c38c02d27c060674880dd6859fcc90a65ee0 |
