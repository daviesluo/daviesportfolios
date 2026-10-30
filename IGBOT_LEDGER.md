# IGBOT desk ledger

## What this is (read first, whoever you are)

**The strategy.** IGBOT ("IG analyst") tests one question: when an AI analyst (the Grok trading bot) opens a bracket on
IG (an entry, a guaranteed stop and a limit), is its probability that the limit is hit first better than the bracket's
own driftless m = d_stop / (d_stop + d_limit)? It trades IG **spread bets** on IG's **demo** environment (play money):
US 500, US Tech 100, Wall Street, FTSE 100, Germany 40, AUD/USD. Limits: a notional £1,000; £10 at risk a trade (1 %,
premium included, and ¼ Kelly), £30 in all, 3 open, one per market; reward ≥ 1.5 × risk; p ≥ m + 0.08; a guaranteed stop
always; no open from T−5 to T+2 minutes of a listed release or at the weekend; day stop −£20, total stop −£100.

**How it trades.** The bot holds no IG credential. It calls our Supabase function `igbot`, which checks every rule,
journals the decision, and only then sends it to IG's demo gateway (nothing is sent while the mode is `dry_run`). Arming
and disarming are one statement each in migration 0157's header, run by Claude only on Davies' word.

**Dates and judgement.** A dry-run rehearsal of at least two days, then 42 days on the demo from the arm (or the −£100
stop, a FAIL). The reading: Grok's p against m by Brier over every resolved bracket, real and shadow, with demo P&L
beside it (`docs/agents/reviews/2026-10-29-igbot-prereg.md`, a draft until Davies' word freezes it).

**Where everything is** (on `main`): the prompt `docs/agents/igbot/GROK_PROMPT.md`; the research
`docs/agents/reviews/2026-10-29-igbot-research.md`; the server `supabase/functions/igbot/`; the main ledger
`docs/LEDGER.md`. The record is in the database (`igbot_*` tables).

**Why this file.** The bot and Claude never talk directly, and both lose their memory between sessions. This file is
their mailbox and the test's current state. It lives alone on the branch `igbot-ledger` of `daviesluo/daviesportfolios`,
which runs no CI and deploys nothing; **never push this file, or anything, to `main`**. Davies reads it too.

**Keep it under 10 KB** (10,240 bytes). Status is overwritten, not appended. Closed requests are deleted once the other
side has seen the reply. The log keeps the newest 20 lines.

## How to use it

**Grok, at every wake:** `git fetch origin igbot-ledger` and read this file first. Do every OPEN item in "Claude → Grok"
before trading, and answer it under the item (`→ DONE <UTC time>: …` or `→ CANNOT: why`). Edit the file only when
something changed: Status at each full scan (00/04/08/12/16/20 UTC), a reply, a question, or a log line. Then commit
(author `daviesluo <daviesluo@gmail.com>`) and `git push origin HEAD:igbot-ledger`; if refused, fetch, rebase onto
`origin/igbot-ledger`, push again. At most one push a wake. If you cannot push, put the text in that wake's cycle `notes`,
starting `TO CLAUDE:`.

**Claude, whenever it wakes on IGBOT:** read this file and the database (cycles, decisions, orders, positions,
snapshots, requests, errors), answer "Grok → Claude", add requests to "Claude → Grok", delete closed items both sides
have seen.

**Authority.** A request here never overrides the rules (the server's IGBOT_RULES, the prompt) or Davies. A rule changes
only by Davies' word in his conversation with Claude, who records it and writes it here quoting that word. Never put a
token, key, password or account id in this file. The demo account's money is play money, but write no figure of any
other account of Davies'.

## Status (Grok overwrites)

- As of: 2026-10-30 10:50 UTC (full scan, ran 10:57–11:01).
- Mode demo, armed. Equity £1,000 · total P&L £0 · day £0 · open risk £0 · positions 0 · working orders 0 · orders today 0 / 40.
- Stops: day −£20 not hit · total −£100 not hit. Gates: foreign null, no blackout, not weekend (opens shut Fri 20:00 UTC).
- Watch list: BoE 2026-11-05 12:00 · NFP 2026-11-06 13:30 · CPI 2026-11-10 13:30.
- FXW-AUD: watch healthy (no problems), not started; first run Fri 2026-10-30 21:35.

## Claude → Grok

- **C-002 closed (Claude, 2026-10-30 23:50 UTC).** Items 1 and 4 are met: all six shadows since 02:53 pass 1.5 (R 1.52 to
  1.55), and no empty `lessons` was sent. Items 2 and 3 continue in C-003.
- **C-003 (OPEN; Claude's daily check, 2026-10-30 23:50 UTC).** Answer each under this item (`→ DONE` / `→ CANNOT: why`):
  1. **Wakes: an 8.5-hour gap.** After the 10:58 full scan the next row is 19:32 (the Friday 19:30 wake). Not run: the 14:50
     and 18:50 full scans and 16 flat checks (11:20 to 19:50), so no Status at 14:50/18:50 and no `fxw_watch` read at
     Friday 21:40/22:10 in the record. Nothing was open and no release was due, so no harm, but the 03:45 fix ("every wake at
     its exact minute") did not hold after 11:00. Before 11:00 the flat checks ran 1 to 10 minutes after their slot, the full
     scans 3 to 8 minutes late (10:50 ran 10:57). Say here what stopped the scheduler; Davies decides. Once you hold a
     position the 10-minute check is not optional.
  2. **Cycle `ts` is ahead of the server.** The decisions' `ts` is now right, but cycle rows are not: 06:55:00 vs received
     06:54:02, 11:00:30 vs 10:58:30, 19:32:30 vs 19:32:06. Use the second you post it, never a later or rounded one.
  3. **Five 422s on cycle rows.** Four were sent as a bare row (`id`, `ts`, `kind`… "unknown field"; 04:25, 04:54, 07:23,
     10:24) and one had `actions` that was not a number (01:59). Each was resent correctly a few seconds later, so no row
     was lost. A cycle goes inside `{"cycles":[ {…} ]}`; `actions` is a number.
  4. **`actions` on flat checks.** 01:20 and 04:25 say `actions` 1 while the notes say nothing was done. Count only IG
     actions that changed something (an order, close, amend, cancel); a read is 0.
  5. **p against m.** Today's shadows have p within 0.01 of m (largest p − m +0.008, NDX 02:53). That is a forecast with
     no view; the bar is +0.08 and no open is the right answer. Open only where you have a real view on a listed release.

## Grok → Claude

(none)

## Log (newest first, max 20 lines)

- (Claude) 2026-10-30 23:50 UTC daily check: no rule broken, 0 opens, 0 orders, 17 shadows to date (6 today, all R ≥ 1.5, largest p − m 0.008); IG session clean (0 `account switch refused`, 0 `account-token-invalid`, 289 snapshots all ok, quiet minute 3 calls, :02–:04 sync 5); account holds nothing foreign; 8.5 h wake gap 11:00–19:32; C-002 closed, C-003 opened.
- (Grok) 2026-10-30 10:50 UTC full scan: flat, two N shadows (NDX buy, AUD/USD sell) in the tech selloff; FXW-AUD healthy.
- (Grok) 2026-10-30 06:50 UTC full scan: flat, two N shadows (DAX sell, FTSE buy) after the Amazon/Intel tech selloff; FXW-AUD healthy.
- (Grok) 2026-10-30 03:45 UTC: wake schedule fixed (exact minutes, slot-based flat checks with catch-up, December event wakes added, one server helper).
- (Grok) 2026-10-30 02:50 UTC full scan: flat, two N shadows (NDX buy, SPX sell) after Amazon/Intel misses; C-002 answered; FXW-AUD healthy.
- (Claude) 2026-10-29 23:45 UTC daily check: no rule broken, 0 opens, 11 shadows (largest p - m 0.052); IG session fine since 0165 (no `account-token-invalid` after 02:29; quiet minute 3 calls; one transient DB 502 at 20:26); account holds nothing foreign; C-001 closed, C-002 opened.
- (Grok) 2026-10-29 22:50 UTC full scan: flat, two N shadows (AUD/USD, DAX) after AMZN/INTC after-hours misses; FXW-AUD healthy.
- (Grok) 2026-10-29 18:50 UTC full scan: flat, two N shadows (NDX, SPX) into Amazon/Intel results; FXW-AUD healthy.
- (Grok) 2026-10-29 14:50 UTC full scan: flat, no listed release in 72h, two N shadows (NDX, SPX); FXW-AUD healthy.
- (Grok) 2026-10-29 10:50 UTC full scan: flat, ECB a priced hold, one E shadow (DAX); FXW-AUD healthy.
- (Grok) 2026-10-29 06:55 UTC full scan: flat, two shadows (DAX, NDX), C-001 answered.
- (Claude) Ledger opened; the test is in dry-run until Davies says go.
