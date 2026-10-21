# Hand-kept target tables (branch `hand-targets`)

This branch holds the two analyst-target tables that no data API serves, for the Target price page of
daviesportfolios: bitcoin's bank and research-house price targets (`btc`) and the S&P 500 year-end index targets
of sell-side strategists (`sp500`, which the page scales onto VUAA). An outside agent (Grok) refreshes
`HAND_TARGETS.json` and `HAND_RISKS.json` here every day at the US open (09:30 ET). Only this branch is written here: never `main`.

The site reads these two files live: within about five minutes of a push the targets job reads them and checks each
file whole (its keys and types, dates, https sources, every target within 0.3–3× the current level, each risk note at
most 120 characters and at most 3 per ticker). A file that fails any check is ignored entirely, the copy built into the
site stands, and one line goes to the site's errors box; so a push shows on the page in minutes, or not at all. The main
repository's session also copies checked figures into `supabase/functions/targets/strategists.ts` as the fallback.

Rules for every row: `firm`, `target` (a number: USD per bitcoin, or S&P 500 index points), `date` (YYYY-MM-DD,
the day the firm published that figure), `horizon` (e.g. "end-2026", "12 months"), `url` (a source that shows the
figure and its date). One row per firm, its latest figure. `sp500` keeps one horizon, `end-2026`; a firm that only
gives a 12-month or mid-2027 figure is left out. Update `asOf` to the day of the check. No figure from memory.

## Key risks (`HAND_RISKS.json`)

One entry per ticker on the board: 1–3 short, factual, dated notes in English, each `{ "text": …, "until"?: "YYYY-MM-DD" }`
(`until` = the last day a date-bound note shows, e.g. an earnings date). `"@lowest-target"` is a placeholder the site
computes live (RKLB's lowest target vs price): keep it as it is. No personal holdings, sizes or P&L in any note.
