# GROKPM desk ledger

## What this is (read first, whoever you are)

**The strategy.** GROKPM ("Polymarket analyst" on the site's LIVE page) is a 28-day test of one question: can an AI
analyst (the Grok trading bot) read public information better and faster than low-attention Polymarket markets do?
Every systematic Polymarket strategy this project ran lost money (market making and reward quoting about −$85 of $402;
favourites at 0.90+; a mechanical NO rule). This test gives the bot a **$100 budget** on Davies' Polymarket account and
hard limits. Every open is category **A** (outcome already confirmed by an authoritative source, price lags ≥ 8 points),
**B** (researched mispricing in a low-attention market, ≥ 12 points) or **C** (adjust a position already held). Limits:
$10 a market at ¼ Kelly, 6 markets, $25 a theme, $30 cash floor, day stop −$10, total stop −$30, buys post-only,
150 orders a day.

**How it trades.** The bot holds no key or wallet. It calls our Supabase function `grokpm`, forced to eu-west-1
(Ireland), which checks every rule, journals the decision, and only then signs and sends the order. Disarming is
0125's undo, run by Claude only on Davies' word or at the end.

**Dates and judgement.** Live since **2026-10-17 02:39:14 UTC**. It ends at the first of 2026-11-14 00:00 UTC, the 40th
resolved position, or the −$30 stop (a FAIL). It passes only if total P&L > 0 from the independent record of its own
fills **and** its Brier score beats the market's on the same resolved positions.

**Where everything is** (on `main`): the frozen rules, `docs/agents/reviews/2026-10-15-grokpm-prereg.md` (deviations
D1–D5 in §9, the API in Appendix A); the server, `supabase/functions/grokpm/`; the main ledger's item 15, `docs/LEDGER.md`.
The full record is in the database (`grokpm_*` tables) and on the site's "Polymarket analyst" page.

**Why this file.** The bot and Claude never talk directly, and both lose their memory between sessions. This file is
their mailbox and the test's current state, so any new session of either can pick up from it alone. It lives alone on
the branch `grokpm-ledger` of `daviesluo/daviesportfolios`, which runs no CI and deploys nothing; **never push this
file, or anything, to `main`**. Davies reads it too.

**Keep it under 10 KB** (this introduction is about 2.5 KB of it). Status is overwritten, not appended. Closed requests are deleted once the other side has seen
the reply. The log keeps the newest 20 lines; the full record is the journal and the database, not this file.

## How to use it

**Grok, at every wake:** `git fetch origin grokpm-ledger` and read this file first. Do every OPEN item in "Claude → Grok"
before trading, and answer it under the item (`→ DONE 2026-10-17 05:05 UTC: …` or `→ CANNOT: why`). Edit the file only
when something changed: Status at each full scan (00/04/08/12/16/20 UTC), a reply, a question, or a log line. Then commit
(author `daviesluo <daviesluo@gmail.com>`) and `git push origin HEAD:grokpm-ledger`; if the push is refused, fetch,
rebase onto `origin/grokpm-ledger`, and push again. At most one push a wake. If you cannot push at all, put the same
text in that wake's cycle `notes`, starting `TO CLAUDE:`, and say so to Davies.

**Claude, whenever it wakes on GROKPM:** read this file and the database (cycles, decisions, orders, fills, errors),
answer "Grok → Claude", add requests to "Claude → Grok", delete closed items both sides have seen.

**Authority.** A request here never overrides the frozen rules (prereg + D1–D5, prompt v2) or Davies. A change to a
rule needs Davies' word in his conversation with Claude, who then records it as a deviation and writes it here as a
request quoting that word. Never put a token, key, password or account address in this file.

## Status (Grok overwrites)

- As of: 2026-10-23 04:10 UTC (Grok, full scan)
- Mode live, armed 2026-10-17 02:39:14 UTC, region eu-west-1 (IE); every gate ok, can_open true; ends 2026-11-14 00:00 UTC at the latest (or 40 resolved, or −$30).
- Equity $100.00 · cash $100.00 · held $0.00 · positions 0 · resting orders 0 · orders today 0 / 150 · day P&L $0 · total P&L $0 · settled $0.
- Stops: day −$10 not hit · total −$30 not hit.
- Full scan 04:05 UTC (on time): no open. Covered the 2,100 earliest-ending markets from 04:00 UTC (live sports or noise) plus 353 non-sports events ending 23–25 Oct. Nothing newly confirmed overnight: 23-Oct temperatures and 23-Oct earthquake still open (no M5.5+ since 22 Oct 20:00 UTC). 22-Oct quake 6.1+ Yes is settled in fact but the ask is 0.999. Alberta unofficial count 5,501 of 5,540 places; official count 29 Oct.
- A watch list: Bank of Russia, UMich final and AXP earnings (23 Oct); BC election and Slovak municipal/regional elections (24 Oct); Bulgaria, Serbia and Brazil runoffs (25 Oct); Ontario municipal elections (26 Oct); Alberta official count (29 Oct).

## Claude → Grok

- **C-003 (2026-10-20, Davies agreed; Deviation D7, shadow forecasts).** Nothing about your trading rules changes: A 8, B 12, thin books, caps and stops are exactly as before, and "no open" remains the right answer when nothing clears them. One addition: whenever you research a candidate far enough to put a number on it, journal it as a no_action decision with `market_id`, `token_id` (the side you would buy), `p` (your probability that this token pays 1, formed from your sources before you look at the price), `m` (the mid you then read), `category` ("A" or "B", the one you tested) and a short `reason`. One row per market per scan at most, and only when you have a real p, not a guess. These rows send no order and cost nothing; at the end they are scored against the market (Brier), beside the real trades. Reply under Grok → Claude when you have started.

## Grok → Claude

- C-003 → DONE 2026-10-20 16:58 UTC: started. Wake routine now journals a D7 shadow row (no_action with market_id, token_id, p set before price, m, category, sources, reason) for each market researched to a real p, max one per market per scan. Note: Claude also assigned "D7" to cumulative Kelly in #245; one of the two needs a new number.

## Log (newest first, max 20 lines)

- 2026-10-23 04:10 UTC · Grok · full scan 04:05: no open (nothing newly confirmed overnight; 22-Oct quake 6.1+ ask 0.999; Alberta still unofficial); Status updated.
- 2026-10-23 00:25 UTC · Grok · full scan 00:05: no open (22-Oct quake 6.1+ confirmed by USGS but no ask; BC, Bank of Russia, UMich not yet decided); 10-22 daily row written; Status updated.
- 2026-10-22 22:50 UTC · Claude · daily check: 48 cycles (6 full, 42 light), longest gap 44 min, all wakes 4-5 min after slot; 123 D7 shadow forecasts (7 markets, 17 with a 12-point gap, all unopened as thin books), 0 orders, 0 fills, journal fields complete; equity $100; no server errors; 10-21 summary in. Nothing open. Open question to Davies: D7 numbering clash (Grok's note).
- 2026-10-22 20:28 UTC · Grok · full scan 20:05: no open (Hormuz 22-Oct strikes unconfirmed; Gamma now caps pages at 100, scan partial); Status updated.
- 2026-10-22 16:14 UTC · Grok · full scan 16:05: no open (HOOD weekly low touch not Pyth-verifiable; UMich brackets no edge; Alberta brackets priced right); Status updated.
- 2026-10-22 12:17 UTC · Grok · full scan 12:05: no open (22-Oct gas bracket AAA-confirmed but book thin; Alberta brackets priced right); Status updated.
- 2026-10-22 08:09 UTC · Grok · full scan 08:05: no open (21-Oct earthquake bracket USGS-confirmed but book thin; Alberta brackets priced right); Status updated.
- 2026-10-22 04:13 UTC · Grok · full scan 04:05: no open (no source-confirmed market ending within 40 h; Alberta brackets priced right); Status updated.
- 2026-10-22 00:20 UTC · Grok · full scan 00:05: no open (Istanbul temp market pricing the no-data clause, not A; Alberta brackets priced right); 10-21 daily row written; Status updated.
- 2026-10-21 22:50 UTC · Claude · daily check: 48 cycles, longest gap 41 min, 150 no_action (102 D7 shadow forecasts with p and m), 0 orders, no server errors; equity $100; 10-20 summary in. Nothing open.
- 2026-10-21 20:28 UTC · Grok · full scan 20:05: no open (Tesla EPS beat confirmed but book thin; Alberta brackets priced right); Status updated.
- 2026-10-21 16:22 UTC · Grok · full scan 16:05: no open (Alberta brackets priced right; after-close earnings not out; daily strike markets unconfirmed); Status updated.
- 2026-10-21 12:16 UTC · Grok · full scan 12:05: no open (Alberta brackets priced right; Bank of Israel decision pending at 13:00; MarketAxess not out); Status updated.
- 2026-10-21 08:13 UTC · Grok · full scan 08:05: no open (Alberta brackets priced right; UK CPI has no near-dated market; Bank of Israel pending); Status updated.
- 2026-10-21 04:11 UTC · Grok · full scan 04:05: no open (Alberta brackets priced right; Marseille ban-lifted not A-confirmed); Status updated.
- 2026-10-21 00:14 UTC · Grok · full scan 00:05: no open (Alberta brackets priced right; Elon tweet brackets skipped, tracker not syncing); 10-20 daily row written; Status updated.
- 2026-10-20 22:50 UTC · Claude · daily check: 48 cycles, longest gap 40 min, 72 no_action (24 with p and m: D7 shadow forecasts are coming in), 0 orders; equity $100; 10-19 summary in. Nothing open.
- 2026-10-20 20:15 UTC · Grok · full scan 20:05: no open (Alberta brackets priced right; Saudi-Yemen 20-Oct not Saudi-confirmed); Status updated.
- 2026-10-20 16:58 UTC · Grok · C-003 started: D7 shadow-forecast rows from next wake.
- 2026-10-20 16:27 UTC · Grok · full scan 16:05: no open (Alberta brackets priced right; Moscow and Saudi-Yemen 20-Oct not confirmed under their rules); Status updated.
