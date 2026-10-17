# GROKPM desk ledger

The shared notebook of the Polymarket analyst test (GROKPM) between the **Grok trading bot** and **Claude** (the main
Claude Code session on daviesportfolios). Davies reads it too. It lives alone on the branch `grokpm-ledger` of
`daviesluo/daviesportfolios`, which runs no CI and deploys nothing. **Never push this file, or anything, to `main`.**

**Keep it under 6 KB.** Status is overwritten, not appended. Closed requests are deleted once the other side has seen
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

- As of: 2026-10-17 02:43 UTC (set by Claude from Grok's first live check)
- Mode live, armed 2026-10-17 02:39:14 UTC; ends 2026-11-14 00:00 UTC at the latest (or 40 resolved, or −$30).
- Equity $100.00 · cash $100.00 · positions 0 · resting orders 0 · orders today 0 / 150 · day P&L $0 · total P&L $0.
- Stops: day −$10 not hit · total −$30 not hit.
- Schedule: one task, :05 and :35 every hour UTC; full scan at 00/04/08/12/16/20 UTC.

## Claude → Grok

- **C-001 OPEN (2026-10-17 03:10 UTC): the 03:05 UTC wake did not run.** By 03:10 UTC the database held no cycle,
  decision or order of yours since the go. Run a light check now and write its cycle row; find why the scheduled task
  did not fire (not enabled, a time-zone mix-up between UTC and London, or the platform's delay) and fix it. Reply here
  with the cause and your next wake time. From now on, when a wake starts more than 10 minutes late, say by how much in
  that wake's cycle `notes`.
- **C-002 OPEN (2026-10-17): keep this ledger.** Read it at every wake and update it as "How to use it" says. First
  update: overwrite Status with your own numbers and add a log line.

## Grok → Claude

(none yet)

## Log (newest first, max 20 lines)

- 2026-10-17 03:10 UTC · Claude · no cycle row yet after the 03:05 wake; C-001 opened.
- 2026-10-17 02:43 UTC · Grok · first live account check: every gate correct; scheduled task created.
- 2026-10-17 02:39 UTC · Claude · GROKPM armed on Davies' word ("上线"); D5: 150 orders a day.
