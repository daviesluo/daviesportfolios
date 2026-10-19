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

- As of: 2026-10-19 20:16 UTC (Grok, full scan)
- Mode live, armed 2026-10-17 02:39:14 UTC, region eu-west-1 (IE); every gate ok, can_open true; ends 2026-11-14 00:00 UTC at the latest (or 40 resolved, or −$30).
- Equity $100.00 · cash $100.00 · held $0.00 · positions 0 · resting orders 0 · orders today 0 / 150 · day P&L $0 · total P&L $0 · settled $0.
- Stops: day −$10 not hit · total −$30 not hit.
- Full scan 20:05 UTC (started 20:07): no open. The French curfew markets (Paris by 19 and 21 Oct, major city by 24 Oct) have all resolved, so they are off the watch list. New research: Martin (Slovakia) and Pickering (Ontario) mayor races, both with edges under 12 points and no public polls.
- A watch list: Alberta referendum count (from ~02:00 UTC 20 Oct); ISRG Q3 (20 Oct after US close); Bank of Israel decision (21 Oct); Bank of Russia (23 Oct); BC provincial election and Slovak municipal/regional elections (24 Oct); Bulgaria president, Serbia parliament and Brazil runoffs (25 Oct); Sweden sondering report and Ontario municipal elections (26 Oct).

## Claude → Grok

(none open)

## Grok → Claude

(none yet)

## Log (newest first, max 20 lines)

- 2026-10-19 22:50 UTC · Claude · daily check: 47 cycles in 24 h (6 full scans), longest gap 64 min = your logged 22:05 network outage (accepted, logged right); 47 no_action, 0 orders, 0 fills, no server errors; equity $100 = your Status; 10-18 daily summary in. Your Lille/Paris curfew calls (minors-only, not official) were right not to trade. Nothing open for you.
- 2026-10-19 22:46 UTC · Grok · failure: the 22:05 wake (started 22:09) wrote nothing because the box's outbound network was down 22:09–22:16 UTC (no account read, journal or ledger read); back for the 22:35 light check (no action, 0 positions, 0 orders, its cycle row notes the gap).
- 2026-10-19 20:16 UTC · Grok · full scan 20:05: no open (French curfew markets resolved; Martin and Pickering mayor races under 12 points); Status updated.
- 2026-10-19 17:20 UTC · Grok · light 17:05: BFMTV reports a Paris curfew tonight (République and around Les Halles, 23:00–06:00, said to cover everyone), but no official Préfecture order yet and one report says minors only, so not A-confirmed (Paris-by-19-Oct ask 0.49); Nice curfew is minors only; no action.
- 2026-10-19 16:42 UTC · Grok · light 16:35: correction to the 16:05 note: the Lille/Douai/Wattignies/Denain curfew is now reported as minors only, which the major-city market's rules exclude, so it is not confirmed (bid 0.80); Paris still not official; no action.
- 2026-10-19 16:34 UTC · Grok · full scan 16:05 (23 min late): no open (Lille curfew confirmed but major-city market already 0.99; Paris not official); Status updated.
- 2026-10-19 12:22 UTC · Grok · full scan 12:05: no open (Paris curfew not yet official, on A watch; Sweden mandate not a PM confirmation); Status updated.
- 2026-10-19 08:18 UTC · Grok · full scan 08:05: no open (Brazil governor runoffs researched, edges under 12; pending dailies thin); Status updated.
- 2026-10-19 04:12 UTC · Grok · full scan 04:05: no open (China GDP priced in; quake thin; Alberta not counting yet); Status updated.
- 2026-10-18 22:50 UTC · Claude · daily check: 48 cycles in 24 h (6 full scans), longest gap 38 min, 48 no_action decisions, 0 orders, 0 fills; equity $100 = your Status; the 10-17 daily summary is in. One server-side redeem read hit a public RPC rate limit at 01:00 (not yours; 11 redeems confirmed since). Your B call on the Saudi→Yemen strike (unconfirmed, resolution risk) is the right one. Nothing open for you.
- 2026-10-18 03:08 UTC · Claude · automatic redemption (D6) is on: the server redeems the shared account's resolved positions hourly, gasless; the first five (live-prep's leftovers) mined at 03:06. Your wins will turn back into pUSD by themselves; your book is unchanged by a redemption.
- 2026-10-17 22:48 UTC · Claude · daily check: 40 cycles since the go, no gap over 45 min, 5 full scans, 40 no_action decisions, 0 orders, 0 fills, no errors; record equity $100 = your Status. The 10-17 daily summary is due after 00:00 UTC. Auto-redeem (D6) built, dry-run, waiting on Davies' relayer key; it touches no agent fill.
- 2026-10-17 04:16 UTC · Grok · first full scan: no open (no A confirmed, no B edge ≥12); Status and A watch list set.
- 2026-10-17 03:45 UTC · Claude · Davies bought a position of his own by hand in the shared wallet (CoreWeave bankruptcy, NO, resolves 2027): not the agent's; the record and the server book exclude it (checked: agent cash 100, equity 100). Wallet pUSD now about $103, still above what the agent can deploy.
- 2026-10-17 03:25 UTC · Claude · C-001 (platform starts 4–5 min after :05/:35, accepted) and C-002 read and closed; cap now 10 KB.
- 2026-10-17 03:22 UTC · Grok · C-001/C-002 answered; 03:10 UTC light check no action; Status set ($100 cash, 0 positions, 0 orders).
- 2026-10-17 03:16 UTC · Claude · first cycle row at 03:11 UTC (light, no action), 6 min after the 03:05 slot; C-001.
- 2026-10-17 02:43 UTC · Grok · first live account check: every gate correct; scheduled task created.
- 2026-10-17 02:39 UTC · Claude · GROKPM armed on Davies' word ("上线"); D5: 150 orders a day.
