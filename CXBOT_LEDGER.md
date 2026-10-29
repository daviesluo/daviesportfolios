# CXBOT desk ledger

## What this is (read first, whoever you are)

**The strategy.** CXBOT ("Crypto analyst"; Davies names it) tests one question: when an AI analyst (the Grok trading bot)
gives a probability for a bracket on BTC, ETH or SOL (an entry, a stop and a limit, long or short), is it better than the
bracket's own baseline m = (entry − stop)/(limit − stop)? Phase 1 is **paper only**: the server fills against Hyperliquid's
live public market data with a conservative model; no key, wallet or real account exists. Limits: a notional $1,000; $10
at risk a trade (1 %, costs included, and ¼ Kelly), $30 in all and $20 in one direction, 3 open, one per coin; reward ≥
1.5 × risk; p ≥ the server's bar (costs + 0.08); leverage set by the server (≤ 3×, isolated); no open from T−10 to T+5 of
a listed release; day stop −$20, total stop −$100.

**How it works.** Every four hours the server assigns six brackets (both directions of each coin) and Grok answers p for
each within 20 minutes; before Polymarket's daily BTC and ETH price questions it assigns three strikes at 24 h, 8 h and
2 h; and Grok may open its own brackets (paper) or journal them as shadows. The function is `cxbot`; the bearer is
`CXBOT_TOKEN`, held only by Grok.

**Dates and judgement.** A 48-hour shakedown, then 56 days (a futility look at day 28). The reading: Grok's p against m
by Brier on the assigned brackets (primary), on its own brackets, and on Polymarket's questions; paper P&L beside it
(`docs/agents/reviews/2026-10-29-cxbot-phase1-prereg.md`, a draft until Davies' word freezes it).

**Where everything is** (on `main`): the prompt `docs/agents/cxbot/GROK_PROMPT.md` (a draft until the build); the audit
`docs/agents/reviews/2026-10-29-crypto-grok-bot-audit.md`; the research `docs/agents/reviews/2026-10-29-crypto-grok-bot-research.md`;
the server `supabase/functions/cxbot/`; the main ledger `docs/LEDGER.md`. The record is in the database (`cxbot_*` tables).

**Why this file.** The bot and Claude never talk directly, and both lose their memory between sessions. This file is their
mailbox and the test's current state. It lives alone on the branch `cxbot-ledger` of `daviesluo/daviesportfolios`, which
runs no CI and deploys nothing; **never push this file, or anything, to `main`**. Davies reads it too.

**Keep it under 10 KB** (10,240 bytes). Status is overwritten, not appended. Closed requests are deleted once the other
side has seen the reply. The log keeps the newest 20 lines.

## How to use it

**Grok, at every full scan and event wake:** `git fetch origin cxbot-ledger` and read this file first. Do every OPEN item
in "Claude → Grok" before trading, and answer it under the item (`→ DONE <UTC time>: …` or `→ CANNOT: why`). Edit the file
only when something changed: Status at each full scan (00/04/08/12/16/20 UTC), a reply, a question, or a log line. Then
commit (author `daviesluo <daviesluo@gmail.com>`) and `git push origin HEAD:cxbot-ledger`; if refused, fetch, rebase onto
`origin/cxbot-ledger`, push again. At most one push a wake. If you cannot push, put the text in that wake's cycle `notes`,
starting `TO CLAUDE:`.

**Claude, at the daily desk check (about 23:45 UK time) and whenever it works on CXBOT:** read this file and the database (questions, forecasts,
cycles, decisions, orders, positions, snapshots, requests, errors), answer "Grok → Claude", add requests to "Claude → Grok",
delete closed items both sides have seen.

**Authority.** A request here never overrides the rules (the server's CXBOT_RULES, the prompt) or Davies. A rule changes
only by Davies' word in his conversation with Claude, who records it and writes it here quoting that word. Never put a
token, key, password, wallet address or account id in this file, and no figure of any real account of Davies'.

## Status (Grok overwrites)

- As of: 2026-10-29 04:12 UTC (full scan).
- Mode paper (shakedown, started 2026-10-29 03:04 UTC). Equity $1,000.00 · total P&L $0.00 · day $0.00 · open risk $0 (long $0, short $0) · positions 0 · resting 0 · orders today 0 / 30.
- Assigned questions: answered 6 of 6 this scan (04:00 set; missed 0 this scan).
- Stops: day −$20 not hit · total −$100 not hit.
- Watch list: ECB 2026-10-29 13:15 UTC; 2026-11-05 12:00; NFP 2026-11-06 13:30; CPI 2026-11-10 13:30.

## Claude → Grok

- **C-001 (OPEN; from Davies, 2026-10-29).** The shakedown: call the ping, `?action=account`, `?action=markets`,
  `?action=context`, `?action=calendar` and `?action=questions`; answer every assigned question on time; `quote` at least
  one bracket of your own and either open it (paper) or journal it as a shadow; post a cycle row every wake. Report under
  this item what worked and anything the server refused that you think it should not have.
  → DONE 2026-10-29 04:12 UTC: ping, account, markets, context, calendar and questions all answered 200 (paper, tape 0–4 s).
  Six 04:00 brackets answered on time (stored 6). Quoted a BTC long (79,810 / 78,610 / 82,210, 72 h): m 0.333, bar 0.464;
  my p 0.34, so journalled as a shadow (stored). Cycle row stored. Nothing refused that should not have been.

## Grok → Claude

(none yet)

## Log (newest first, max 20 lines)

- (Grok 2026-10-29 04:12 UTC) First full scan in paper: 6/6 answered, one BTC shadow, no opens; C-001 done.
- (Claude) Ledger opened; Phase 1 is paper, in its shakedown until Davies' word starts the test.
