# Hand-kept target tables (branch `hand-targets`)

This branch holds the two analyst-target tables that no data API serves, for the Target price page of
daviesportfolios: bitcoin's bank and research-house price targets (`btc`) and the S&P 500 year-end index targets
of sell-side strategists (`sp500`, which the page scales onto VUAA). An outside agent (Grok) refreshes
`HAND_TARGETS.json` here once a week; the main repository's session copies the file into
`supabase/functions/targets/strategists.ts` after checking it. Only this branch is written here: never `main`.

Rules for every row: `firm`, `target` (a number: USD per bitcoin, or S&P 500 index points), `date` (YYYY-MM-DD,
the day the firm published that figure), `horizon` (e.g. "end-2026", "12 months"), `url` (a source that shows the
figure and its date). One row per firm, its latest figure. `sp500` keeps one horizon, `end-2026`; a firm that only
gives a 12-month or mid-2027 figure is left out. Update `asOf` to the day of the check. No figure from memory.
