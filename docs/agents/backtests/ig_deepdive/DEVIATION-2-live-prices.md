# Deviation 2 to `SPEC-for-verification.md`: the recorder reads prices on IG's live login

**Recorded 2026-10-29, before the first weekend recorded on the live login (Friday 2026-10-30, from 21:35 UK).** The spec
itself is left byte for byte as frozen (its sha256 in `MANIFEST.json` is unchanged), as Deviation 1 left it; this file is
the amendment to its hard rule 1 and the disclosed deviation for S1b, and every reading after it cites it.

**On whose word.** Davies, 2026-10-29: "同意，按方案1改" ("agreed, change it as option 1").

## Why

IG keeps one current account per user, and the `ig` function's recorder switches between the spread-bet and the CFD
account every minute (`supabase/functions/ig/actions.ts`, the comments around `QUOTES_FORCE_SWITCH_AFTER_LOGIN`). The
restored `IG_*_DEMO` secrets turned out to be the same demo login as IGBOT's (account `Z6F18K`), and two programs on one
login refuse each other: `401 error.security.account-token-invalid`, measured 2026-10-29 00:15-00:31 UTC in
`igbot_requests`. A second demo login cannot get an API key: IG creates demo keys only from the live login, and allows one
per account. The live login is a different user, so it cannot clash with IGBOT, whose demo login is now its alone.

## Hard rule 1, amended

The text as frozen, kept:

> 1. **Demo environment only.** Code must refuse to run unless the configured IG environment is exactly `demo`.
>    Never call the live dealing host. Account facts from the live platform are supplied by Davies as redacted
>    documents or screenshots; balances are neither needed nor recorded.

From 2026-10-29 it reads: **the recorder may log in to IG's live environment to read prices; dealing stays impossible.**
In full:

- The `ig` function calls one host, `https://api.ig.com/gateway/deal`, and refuses every other one, the demo host above
  all, before anything is sent (`ig/client.ts`, `assertAllowed`).
- It reads the live login's three secrets only, `IG_API_KEY_LIVE`, `IG_LIVE_USERNAME` and `IG_LIVE_PASSWORD` (stored by
  Davies on 2026-10-15), never a demo name nor an `IGBOT_` one.
- Hard rule 2 is unchanged and enforced on the live host exactly as it was on the demo one. Only `POST`, `PUT` and `DELETE`
  on `/session` (log in, switch between the login's two accounts without changing the default, log out) are allowed, plus
  the listed GETs. The GETs are `/accounts`, `/markets`, `/markets/{epic}`, `/marketnavigation`, `/prices/{epic}` and
  `/clientsentiment`. There is no path to positions, working orders, confirms, watchlists, history, transactions,
  funding, applications or costs, and there is no order code.
- Balances are still neither needed nor recorded: every session and `/accounts` answer loses its balances and client id
  before anything keeps it, and every secret and session token is scrubbed from every answer, row and error.
- Every row the function writes says `environment = 'live'` (migration `0161`); the rows from before say `demo`.
- G1's account facts on the live login are what its `facts` reads by account type; no account id is expected for live.

Unchanged: hard rules 2 to 9, and every bar of the spec. This spec still cannot produce `PASS-TO-LIVE`, and nothing in it
places, amends or closes a bet.

## S1b: a disclosed deviation

- **Two sources.** The weekends recorded so far (2026-10-16/19, 10-23/26) come from IG's **demo** quotes. The weekends
  from the first live run on (Friday 2026-10-30 21:35 UK) come from IG's **live** quotes.
- **Both are kept**, told apart by `environment` on `ig_quotes`, `ig_quote_runs`, `ig_facts`, `ig_price_pulls` and
  `ig_action_log`. A live quote never extends a demo row: `ig_quotes_record` looks up the newest row and keys rows per
  environment.
- **The reading says which it used.** Each weekend's S1b reading names its environment and the account and epic its facts
  row gave (the live spread-bet account's AUD/USD epic is read from the live `facts`, never assumed equal to demo's).
  It adds `and q.environment = '<env>'` to its two `ig_quotes` reads and `and r.environment = '<env>'` to its
  `ig_quote_runs` read in `sql/s1b_coverage.sql`. Only one environment records in any weekend's window, because the
  switch happens midweek. So the statement as frozen gives the same answer for every weekend, and the filter makes that
  explicit.
- **Twelve weekends.** The target of twelve consecutive weekends is unchanged. A demo weekend and a live weekend are not
  the same quote source: the write-up reports the demo and the live weekends apart as well as together, and says whether
  the verdict changes if only the live weekends are counted.
