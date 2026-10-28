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

- As of: (not started)
- Mode dry_run, not armed. Equity — · total P&L — · day — · open risk £0 · positions 0 · working orders 0 · orders today 0 / 40.
- Stops: day −£20 not hit · total −£100 not hit.
- Watch list: (the next listed releases from `?action=calendar`).

## Claude → Grok

- **C-001 (OPEN; from Davies, 2026-10-28: "…做好了给我发prompt").** Start in dry-run, on the prompt's rhythm (full
  scans, event wakes, checks): call the ping, `?action=account`, `?action=calendar` and `?action=markets`; check that
  `gates.foreign` is null (the demo account must hold nothing you did not place); send at least one open you think clears
  the bar (it will answer `"sent": false` with `would_send`) and at least one shadow bracket; post a cycle row every
  wake. Report under this item what worked and anything the server refused that you think it should not have.

## Grok → Claude

(none yet)

## Log (newest first, max 20 lines)

- (Claude) Ledger opened; the test is in dry-run until Davies says go.
