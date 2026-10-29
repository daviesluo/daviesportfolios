# CXBOT, "Crypto analyst": an independent audit of its rules, architecture and prompt (2026-10-29)

On whose word: Davies, 2026-10-29: "加密货币分析bot的所有rules和架构和prompts再交给一个独立subagents仔细深度审核下，确保所有细节完美".
The auditor did not build CXBOT. Every claim of the design documents (the research, the first audit
`2026-10-29-crypto-grok-bot-audit.md`, the DRAFT prereg `2026-10-29-cxbot-phase1-prereg.md`) was checked against the code
(`supabase/functions/cxbot/`, `0163_cxbot.sql`), the scorer (`docs/agents/backtests/cxbot/score.mjs`), the prompt
(`docs/agents/cxbot/GROK_PROMPT.md`), the production record (read-only SQL, 2026-10-29 02:00–02:12 UTC) and arithmetic.
Nothing here changes a threshold, a cap or the scoring rule's substance; where a definition changed, the reason is below.
The mode in production was not touched (dry-run).

## 1. Findings, ranked

Each with the failure it allows (inputs → wrong output), and whether it is fixed. "Pin" names the test that fails on the
code before the fix.

| # | severity | finding | fixed |
|---|---|---|---|
| F1 | critical | A shadow bracket's clock was the agent's own `ts`, which the journal accepts up to 7 days old | yes |
| F2 | high | The paper engine books a minute about two minutes after it ends; close, amend and cancel acted on minutes already visible | yes |
| F3 | high | A minute that outran its 45 s lease, or was run twice, could open a resting order twice, charge an hour's funding twice and move the engine back | yes |
| F4 | high | A minute missing from the tape when the engine ran was stepped over for good, with any stop inside it | yes |
| F5 | medium | A resting entry filled in a minute that also reached its stop survived that minute | yes |
| F6 | medium | A stop gapped through at a minute's open filled at the stop less 5 bps when the next minute had recovered | yes |
| F7 | medium | At the end (mode back to dry-run) open paper positions froze; prereg §3.3 says they run to their exits | yes |
| F8 | medium | Layer B issued a fourth, fifth… strike inside its 10-minute window when the mids moved | yes |
| F9 | low | The scorer started a real bracket filled on a minute boundary one minute late | yes |
| F10 | low | A voided question counted as issued and unanswered (the 90 % bar) | yes |
| F11 | low | Bar (c) counted the shakedown's P&L, which §3.1 says is not scored | yes (definition) |
| F12 | low | The prompt's Never list had no geoblock rule (no VPN, proxy or relay) | yes |
| F13 | low | The prereg's §4 named tables that do not exist and data never recorded; §5 said "the mid" where the code uses the open | yes |
| F14 | low | Questions stuck in `scoring` forever (a missing last minute, a 50/50 resolution) would starve the 200-row resolver | yes |
| F15 | low | The minute's worst case: sequential reads at 8 s each could exceed 50 s and hold every other minute call's pg_net batch | yes |
| F16 | low | Kelly and margin used an equity that counted other open positions at their entry | yes |
| F17 | low | The margin check assumed 3× for every held position | yes |
| F18 | low | Funding used the rate read on the hour itself (Hyperliquid's next hour's prediction) | yes |
| F19 | info | The page showed the bare $1,000 after the end, voided questions as issued, and named migration 0161 | yes |
| F20 | info | The 3-day block bootstrap is 10–25 % narrower than D's true spread when luck runs in spells | no (reported) |

### F1, critical: a backdated shadow scored a move already made

The journal (`ingest.ts` `stampOf`) takes a `ts` up to 7 days old, and `score.mjs` started a shadow from its `ts`.
Scenario: on day 10 the agent posts `{action: no_action, ts: day 7, SOL long, entry 182.5, stop 176.9, limit 194, p: 0.95}`
after SOL went from 182.5 to 195 on day 7. The scorer reached the entry on day 7, the limit next, and scored y = 1 against
p = 0.95: D for that row +0.39 (Brier(m) 0.45 vs 0.0025). Sixty such rows pass layer C by themselves. **Fix:** the export
carries `received_at` (the server's `now()` on insert); a shadow's clock is the later of `ts` and `received_at`, and one
without a receipt is not scored (`no_receipt`). The prompt says so. Pin: `src/cxbot_score.test.js` "audit F1".

### F2, high: an option on minutes the agent can already see

`stepBook` decides minute t only once t + 1 is recorded (its stop fill needs the next open), so the book lags the tape by
about two minutes, and the agent can read those minutes (`markets`' `last_minute`, any chart). Scenarios, each one-sided:
a long's stop at 79,580 trades at 79,500 at 09:02 and the price is back at 81,200 by 09:03:20: `close` filled at the book
(about 81,199) instead of the engine's stop fill (79,540); `amend` moved the stop to 80,500 to get a better fill; `amend`
moved the limit in to 82,500 after 09:02 traded at 82,600, booking a profit already made; `cancel` withdrew a limit entry
that had filled on a fall that continued. **Fix:** close, amend and cancel read the venue's minutes from the engine's next
minute to now (the minute in progress included) and refuse with `pending_exit` / `pending_fill` when the position's stop or
limit (or liquidation, or an amend's new level), or the order's entry, was already reached; `cancel_all` cancels the rest
and lists those as `not_cancelled`. The prompt names both rules. Pins: `index.test.ts` "audit F2" (three tests).

### F3, high: a minute that runs twice books twice

The tick takes a 45 s lease but its call may take 50 s and a function can run on after pg_net gives up. The old order was
record → lease → context (up to 6 × 8 s for Polymarket alone, sequential) → book, and `writeState` wrote unconditionally.
Scenario: minute 1 stalls in the context past 45 s; minute 2 takes the lease and fills resting order 7; minute 1 wakes and
fills order 7 again (the order's update was not conditional), then writes its older `engineMinute`, so minute 3 re-runs a
minute: if that minute is on the hour, the position's funding is charged again. **Fix:** a resting order is claimed
(`state=eq.resting` compare-and-set) before its position is written; each hour's funding moves `funded_through` forward by
compare-and-set (0164); the state is written only while the lease is still the run's (`writeStateHeld`); the tick's fault
report moved to its own column (`last_error`) so it never rewrites the state. Pins: "audit F3" (two tests).

### F4, high: a gap in the tape skipped a stop for good

If `record` failed in a minute (a 429, a timeout), `stepBook` ran anyway, `continue`d past each minute whose own or next
candle was missing, and set `engineMinute` to the end. The recorder re-reads from its newest minute next time, but the
engine had moved on. Scenario: a long's stop is hit at 09:01; the 09:03:30 tick's candle read fails, so 09:02 is missing
and 09:01 (whose fill needs 09:02's open) is stepped over; at 09:04:30 the minutes are back but never decided: the position
lives on below its stop. **Fix:** a coin the engine holds or rests in waits at a gap younger than 10 minutes; an older gap
is stepped over (the record has no minute there). Pin: "audit F4".

### F5, medium: a fill and a stop in one minute

The old engine judged a position from the minute after its fill. A limit long fills on a fall, the fall that fills it
often reaches the stop: minute 09:02 opens 2,400, trades 2,320 (through the entry 2,390 and the stop 2,330) and closes
2,395. Before: a position at 2,390, alive. Now: stopped in that minute at the worst of 2,330 × (1 − 5 bps), the open 2,400
and the next open 2,396: 2,328.84 (a loss of about $9.4 on 0.15 ETH with fees). Pin: "audit F5".

### F6, medium: a gap through the stop

`stopFill` took the worse of the stop less 5 bps and the NEXT minute's open. A minute that opens at 98 under a long's stop
of 100 and is back at 100.5 by the next open filled at 99.95. Now the minute's own open is in the worst-of (98); the stop
entry's fill mirrors it (`stopEntryFill`). Pin: `rules.test.ts` paper fills.

### F7, medium: the end froze the book

`tick` ran `stepBook` and `snapshot` only in paper mode and moved `engineMinute` to now in dry-run. After the main session
sets the mode back to dry-run at the end, an open position was never closed, its P&L never booked, and resting orders could
not fill but stayed `resting`. Now the book and the snapshot run while anything is held; outside paper mode every resting
order is cancelled (no new open) and held positions run to their stop, limit or 7-day close. Pin: "audit F7".

### F8, medium: layer B's extra questions

`issueB` runs every minute of a 10-minute window and named its question by strike; a tick whose mids had moved picked other
strikes and issued them, with later deadlines (up to 30 questions a horizon). The id now names the target (25/50/75) and a
strike taken for one target is not taken for another. Pin: "audit F8".

### F9–F11, the scorer

F9: `Math.floor(opened / M) * M + M` started a real bracket filled at 09:10:00 (a resting fill, booked on the boundary) at
09:11, skipping the minute the engine itself judges; now `Math.ceil`. F10: a void question was counted as issued and
unanswered. F11: `money` measured the end's equity from $1,000, so a shakedown gain or loss counted in bar (c) although
§3.1 scores nothing of the shakedown; it now counts from the newest snapshot at or before the shakedown's end, the whole
run's P&L reported beside it. The total stop still counts from $1,000. Pins: `cxbot_score.test.js` "audit F9, F10, F11".

### F12–F19

F12: the Never list now says: no VPN, proxy, relay or someone else's account to get round a geoblock or access rule, and
paper is all this phase is. F13: prereg §2, §4, §5 and §6 now describe what the code records and does (the open of the
deadline's minute; the venue's hourly candles for sd24; the shadow's clock; one shadow per coin per four hours, every real
bracket scored). F14: a layer-A question reads ten minutes past its hold (a later minute proves coverage) and is voided a
day after its hold with no tape; a layer-B question with no 0/1 result after 7 days is voided. F15: the minute now runs
the book, the questions and the snapshot first, reads each coin and each context kind in parallel, and starts no context
kind after 25 s (a skipped kind stays due). F16, F17: equity at every coin's newest mid; each held bracket's margin at its
own leverage. F18: the funding paid on the hour uses the rate read in the hour before. F19: the TESTING row keeps the paper
equity and the days run after the end, counts no voided question, and its header names 0163.

### F20, reported: the bootstrap's width

`docs/agents/backtests/cxbot/blockcheck.py` (400 windows of 56 days, seed 20261029): forecasters with no skill whose
"macro view" flips every 3, 7 or 14 days and leans p by 0.03 or 0.06. The true sd of D across windows exceeded the
bootstrap's own estimate by 10–25 % (e.g. L = 14, δ = 0.03: 0.00419 vs 0.00321); 7-day blocks narrow the gap only a little
(0.00343). Yet each paid its leaning in Brier (mean D −0.0006 to −0.0041), and passed layer A's three conditions in 2.0–5.8 %
of windows (L = 14, δ = 0.03, 3-day blocks: 5.8 %; 7-day blocks: 5.0 %). The bar's other parts (both ambiguity conventions,
layer C, P&L) only lower that. Not changed: a longer block is a design choice for Davies; the prereg's §8 now says what a
pass is worth.

## 2. Verified as correct

- **m and the timeout rule:** E[y] = m for a price martingale (optional stopping); the server's `resolveOnTape` and the
  scorer's `resolve` are the same rule, and the tests pin both on the same minutes. Layer A's m is 1/3 for every bracket
  (stop d, limit 2d), so no-skill p = m scores D = 0 exactly and must lose to pass.
- **No look-ahead in layer A:** the answer is refused at or after the deadline (server time); the bracket starts at the
  deadline minute's open, its distances fixed at issue.
- **Costs and p\*:** p\* = m + c/(d_stop + d_limit) is the break-even of the linear payoff; the prompt's worked example
  (2.5 % / 5 %, 20.5 bps: p\* 0.361, bar 0.441; iv e_y 0.071 + 0.574 × 0.459 = 0.334) and both order examples (m 0.3409,
  bar 0.4592; m 0.3333, bar 0.4282) recompute.
- **Liquidation:** for an isolated long, M0 + S(P − E) = mm·S·P gives P = E(1 − 1/L)/(1 − mm), the code's formula and
  Hyperliquid's documented one (liq = price − side × margin_available / size / (1 − l × side), margin_available = initial −
  maintenance at the entry); the short mirrors. Maintenance = half the initial margin at the maximum leverage (40×, 25×,
  20× → 1.25 %, 2 %, 2.5 %). `leverageFor` solves (1/L − mm)/(1 ∓ mm) ≥ 3.5 d_stop: d_stop 2 % → 3×; 10 % → 2.7× on BTC.
- **Funding sign:** a long pays a positive rate (rate × size × oracle), a short receives it; costs count only a rate
  against the side.
- **Every number agrees** across `rules.ts`, the prompt, the prereg and the ledger seed: 1 % ($10) a trade, 3 % ($30) in
  all, 2 % ($20) a direction, 3 open, one a coin, reward ≥ 1.5, bar p\* + 0.08, ¼ Kelly, stop 0.75–5 day-sd and ≥ 1 %,
  ≤ 3× isolated with liquidation 2.5 stop distances beyond, funding ≤ 0.01 %/h, blackout T−10 to T+5, tape ≤ 2 min, spread
  ≤ 5/5/10 bps, slippage ≤ 0.1 stop distance, resting 5 min–24 h, 7-day close, 3 trading requests a minute, 30 orders a day,
  day stop −$20, total stop −$100 (`src/cxbot.test.js` holds the prompt to the code's constants).
- **The release calendar** (`agents/cb_releases.ts`, Nov–Dec 2026): FOMC 2026-10-28 18:00 and 12-09 19:00 UTC; ECB 10-29 and
  12-17 13:15; BoE 11-05 and 12-17 12:00; NFP 11-06 and 12-04 13:30; CPI 11-10 and 12-10 13:30. The BLS dates its comment
  calls unconfirmed were read today from bls.gov's own schedules (CPI 11-10 and 12-10, Employment Situation 11-06, 12-04 and
  2027-01-08, 08:30 ET). Its comment's "third-Friday rule" is the BLS rule (the third Friday after the reference week), not
  the third Friday of the month; the dates are right. The list is frozen for the Coinbase tests and was not edited.
- **Polymarket's resolution time:** Gamma's `endDate` is 16:00 UTC for the October questions (read in production); US
  summer time ends Sunday 2026-11-01, so noon ET is 17:00 UTC from that day, as the prompt says; the server reads `endDate`
  and needs no table of its own.
- **Auth:** every agent action needs the bearer (SHA-256 digests compared in constant time, a secret under 32 characters
  refuses everything); `tick` and `reach` take `CRON_SECRET` through `constantTimeEqual`; the function reads no secret
  but `CXBOT_TOKEN`, `CRON_SECRET` and Supabase's own (the test lists them); the client refuses every host and path off its
  list, and every method but GET (POST to Hyperliquid's `/info` only), before `fetch`. 0163 and 0164 grant nothing to anon
  or authenticated and create no policy.
- **The recorder in dry-run (production, 02:00–02:12 UTC):** 1,116 tape rows, six hours back-filled from 20:01, one
  candle a coin a minute to the last complete minute, 36 book reads (12 minutes × 3 coins), every context kind written
  (the Deribit smile, Polymarket's three days of BTC and ETH events with their 16:00 UTC ends, sd24 BTC 1.45 %, ETH 2.07 %,
  SOL 2.16 %); `reach` found all twelve targets answering 200 from the project's region; no `cxbot.*` fault in the errors
  box. About 235 bytes a tape row: about 1 MB a day, and about 1.5 MB a day of context.
- **Rate budgets:** the minute's Hyperliquid reads weigh about 130 of the 1,200 a minute Hyperliquid allows an IP (three
  candle reads, the asset contexts, the predicted fundings, three books); the agent's venue reads are capped at 10 a
  minute. Supabase's Edge egress addresses are shared, so a 429 from someone else's load cannot be ruled out: the engine now
  waits at the gap it leaves.

## 3. For Davies to decide

1. **The block length (F20).** Keep 3-day blocks (a no-skill false pass of about 6 % at worst in the simulation) or use
   7-day blocks (about 5 %, and a little less power). The prereg is a draft: either is a one-line change before the freeze.
2. **The test's window and the calendar.** The release list ends 2026-12-31 and opens are refused after it; a go later
   than about 2026-11-03 runs the 56 days into 2027. Extending the list (2027-01-08 NFP, 2027-01-13 CPI are already on
   bls.gov) is a deviation to the shared calendar.
3. **The P&L bar from the shakedown's end (F11)** is a change of definition that follows §3.1; if Davies wants the whole
   run counted instead, it is one line of `score.mjs`.

### Decided (Davies, 2026-10-29: "你说的那三件事全按你的建议来")

1. **7-day blocks.** `score.mjs`'s `BLOCK_DAYS` is 7 and the prereg's §5 and §8 say so. In `blockcheck.py` the worst
   no-skill case passed layer A's part of the bar in 5.0 % of windows with 7-day blocks, 5.8 % with 3.
2. **CXBOT's own 2027 release list.** `cxbot/rules.ts`, `CXBOT_RELEASES_2027Q1`, covers CPI on 01-13, 02-11 and 03-10, NFP
   on 01-08, 02-05 and 03-05, and the FOMC statement on 01-27 (19:00 UTC) and 03-17 (18:00 UTC, after US summer time starts
   on 03-14). The CPI and NFP dates are read from bls.gov's CPI and Employment Situation schedules (08:30 ET); the FOMC
   dates are from federalreserve.gov's FOMC calendar (tentative until the meeting before confirms them). It is appended to
   the shared list for CXBOT's blackout and its E and R categories only, and the calendar rule now ends 2027-03-31.
   `agents/cb_releases.ts` is untouched: it stays frozen for the Coinbase tests, and so does its comment's wording ("the
   third-Friday rule", the BLS dates "unconfirmed"). The BLS's own schedule now confirms those dates (§2). Pinned in
   `rules.test.ts`: an open in the 2027-01-13 CPI blackout is refused, one outside it is allowed, and the shared list keeps its 10.
3. **Bar (c) from the shakedown's end** (F11) is recorded in the prereg's §0.

The TESTING row of an ended test (mode back to dry-run after a start) now reads "ended" (`grokTestRow`, its MODE tile
"ENDED"), not "dry-run".

## 4. What this audit did not check

The Grok platform, its scheduler and its git access; fills against a live book (paper is not a fill); Hyperliquid's
behaviour in a crash beyond the documented formulas; the front-end rows at both breakpoints (no file under `src/` changed:
the page's numbers come from `agents/grok_tests_view.ts`; the follow-up's "ended" label is a two-line change to
`src/agents/agents.js` and `agents.jsx`, checked by `src/agents/grok_tests.test.js`).
