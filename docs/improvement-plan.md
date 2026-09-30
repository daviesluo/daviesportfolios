# Improvement plan

Written 2026-09-05 against `main` at `2b77f15`, from a full read of the
repository and measurements against production. **Re-checked item by item
on 2026-09-28 against `bace644c`**: every status below was read in the
source or the workflows that day, not recalled. The repository is public
now, so this file describes the work, never the weakness: nothing here is
shaped like an instruction for attacking the running system.

Scope: the web app, its Edge Functions and the delivery around them. The
crypto loop and the testing strategies are planned in `docs/LEDGER.md` and
`docs/agents/`, not here.

## Where it stands (2026-09-28)

Of 28 items: 16 done, 1 partly, 1 not doing by decision, 10 open (2 of
them wait on an answer only Davies can give). Items 4, 5 and 14 closed on
2026-09-30, after the re-check.

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Stop the site publishing the repository; rotate secrets | **Done**, one check left | `wrangler.jsonc` sets `pages_build_output_dir: ./dist`, so only `dist/` is published. Both app passwords were rotated; whether the token-signing secret was is not confirmed (Davies) |
| 2 | Teach the health check this failure | **Done** | `healthcheck.yml` fetches the shell and every chunk it names, and requires a 404 (never the HTML shell) for a missing asset |
| 3 | One holding, two ledgers | Open | `ledgerFor` (`src/charts/ytd.js`) still dates the whole position at the window start when the lots do not net to the board count |
| 4 | A failed save is deferred silently | **Done** 2026-09-30 | `portfolio_saver.js`: the marker moves only when the server takes a change; a failed save shows NOT SAVED and retries (5 s … 5 min, then by hand); pinned in its tests and the sweep's `save-retry` checks, which fail on the old bundle |
| 5 | A failed load can substitute the demo book | **Done** 2026-09-30 | The cross-tab reload refuses a demo result (a failed load's fallback); the sweep's `cross-tab/no-demo` check fails on the old bundle. A failed first load with nothing cached still shows the demo banner, as designed |
| 6 | No plausibility band on an incoming price | Open | Nothing bands a quote at the write |
| 7 | The FX shim reaches the performance line | Open, needs Davies | The header pill and the per-holding badge exist; the value line does not read the `missing` flag |
| 8 | Make the browser sweeps a real gate | **Done** | `npm run verify:browser` is a hard CI gate (222 desktop / 225 phone checks on 2026-09-28), with `verify:perf` (60 cases) beside it |
| 9 | Collapse the duplicated market logic | Open | The Trading 212 → Yahoo ticker map is still three copies: `trading212`, `overnight-record`, `snapshot-record` |
| 10 | Watch what the cron jobs actually did | Open | Nothing notices a recorder that stops writing; `healthcheck.yml` says so in its header |
| 11 | Let Cloudflare build the site | **Not doing** | Davies keeps the committed bundle; `pages-deploy.yml` uploads `dist/` as committed |
| 12 | The recorder's deploy flag; pin the CLI | **Done** | `snapshot-record` is in the no-JWT list; the Supabase CLI is pinned to 2.117.0 and its action by SHA |
| 13 | Read-side tightening on the anonymous endpoints | Open, small | Do each when that function is next touched |
| 14 | The market calendar has no early closes | **Done** 2026-09-30 | `_shared/us_market_calendar.ts` knows them (pinned against NYSE's published 2025–2028 calendars); the snapshot recorder's session and the price function's extended-hours scan end the session at 13:00 ET on those days, pinned by tests that fail on the old code. The board keeps 16:00 by decision: its anchors all read 16:00-ET bars (`market_hours.js`) |
| 15 | Foreign-session predicates ignore weekends | **Done** | Both predicates return false on Saturday and Sunday (`src/prices/market_hours.js`) |
| 16 | Migration ordering on a fresh replay | Open, a paragraph | New files kept the `00NN` sequence (to `0071`); the four timestamped files sort after them on a replay |
| 17 | Lot dates are UTC while the picker is local | Open, needs Davies | The add-holding modal still takes today from `toISOString()` |
| 18 | The chart recomputes on every render | **Done** | `perf_chart.jsx` memoises, pinned by `perf_chart.memo.test.jsx` |
| 19 | Modals have no dialog semantics | Open | No `role="dialog"` or `aria-modal` anywhere; each modal still handles Escape itself |
| 20 | One error boundary for the whole app | Open | Still one, at the root of `app.jsx` |
| 21 | The overnight cache in localStorage | Open, low | `src/prices/overnight_intraday.js` still writes there |
| 22 | The open chart modal polls forever | **Done** | It polls only while the page is visible and the tape can move (`use_ticker_chart_data.js`) |
| 23 | Give the app an icon | Open | `manifest.webmanifest` still ships `"icons": []` |
| 24 | Split the modal cluster out of the main bundle | **Done** | The chart modal, transaction history, export, lists and the Agents page are lazy chunks |
| 25 | Make the gates one command | **Done** | `sh bin/gates.sh` runs what a change can break; `--full` runs every gate |
| 26 | Correct the drifted documentation | **Done** | `.claude/CLAUDE.md` now says 900+ cases and Vite 8 |
| 27 | Small things | Partly | `prefers-reduced-motion` now covers two selectors; the rest unverified |
| 28 | The ledger's own two questions | **Done** | Source headers settled; the backfill question stays on the ledger's list |

## What is worth doing, in order

Each is small, fixes a way the app can be confidently wrong, or has a date.

1. **The app icon (23).** S. A 192 px and a 512 px icon and one `<link>`:
   the board lives on a phone home screen, and today iOS uses a screenshot
   for the badge and Chrome will not offer to install it.
2. ~~**The two quiet fallbacks (4 and 5).**~~ Done 2026-09-30. S each, the class of bug that has
   cost this project three times. Save: advance the marker only on success;
   on any other failure show the conflict banner's sibling and retry with a
   bounded backoff. Load: the cross-tab reload refuses a result marked
   `_isDemo`, so a failed reload can never swap the real board for the demo.
3. ~~**Early closes (14), before 2026-11-27.**~~ Done 2026-09-30 for the
   recorded prices. Moving the board's own anchors to the day's close is M
   (the after-hours verdict, the market cards' close and the chart windows
   all read 16:00-ET bars) and waits until an early close is seen to matter.
4. **A freshness watch for the recorders (10).** S. One daily check that the
   newest row of each recorded price series is as recent as the market
   calendar says it should be, writing an ops error otherwise. The calendar
   is the whole trick: a naive version pages all weekend.
5. **One ticker map (9).** S–M. Move the Trading 212 → Yahoo map into
   `supabase/functions/_shared/`, import it in the three functions, pin it.
   An unmapped ticker is not an error; it just disappears from recorded
   prices.
6. **A plausibility band on quotes (6).** M. Reuse the after-hours guard's
   volatility-scaled band at the write; a quote outside it is dropped and
   reported, never shown. It matters most when the price function is down
   and the public proxies answer.
7. **Error boundaries per surface (20).** M. Wrap the performance panel, the
   heat map, the sidebar, the Agents page and each modal, so one throw
   degrades a panel instead of blanking the board. The Agents page is now
   the largest surface in the app.
8. **Measure item 3 before touching it.** S to measure: how many holdings
   take the fallback, and how far the value line and the deposited line sit
   apart at the first point of each range. Change `ledgerFor` only if the
   gap is real, with before/after values pinned for every range.

Not worth doing now: **11** (his decision), **16** (one paragraph in
`supabase/migrations/README.md`; rename nothing already applied), **13**,
**19**, **21** and **27** (do each when that file is next touched).

## Needs Davies

1. **Was `APP_AUTH_SECRET` rotated with the two passwords?** If not, rotate
   it (Supabase → Edge Function secrets); every session signs in again.
2. **Which calendar is a lot date in** — UK local, US market date or UTC?
   They disagree for an entry made in the evening (item 17).
3. **When a live FX rate is missing**, should the performance line draw at
   the last frozen rate or refuse to draw, as the deposited line does? And
   should history re-mark at today's rate or at the frozen one? (item 7)
4. **May a failed FIRST load show the demo book?** A cross-tab reload never
   swaps it in now (item 5); a first load that fails with nothing cached
   still shows the demo under its banner. Keep that, or show "couldn't reach
   the server" instead?
5. **Is hide-values meant to conceal magnitude**, or only the exact digits?
   It keeps the digit count and the scale suffix today.
6. **Can a board carry negative cash, or one ticker in two positions?**
   Both are handled inconsistently and neither may be reachable.
7. **Migration `0027`** does not exist: a skip, or a file lost in a
   rollback?

## Not doing, and why

- **Rewriting the main component.** Large, but no bug is attributable to its
  size; item 18 was the part worth doing. Revisit when a change to it is
  actually hard. (Davies deferred the hook split explicitly.)
- **Building the site on Cloudflare (11).** Davies keeps the committed
  bundle; the bundle-freshness gate and the CalVer stamp stay with it.
- **A context for the value-hiding flag.** It would break the heat map's
  memoisation. Keep the prop.
- **A static-analysis service.** The dependency audit and the dead-code
  scan already run on every push.
- **Replacing the free proxy chain.** A fallback for an already degraded
  state; item 6 bounds the damage, which is the proportionate answer.
- **One package for client and Edge session logic.** Different runtimes and
  deploy cadences; a table test that the two agree buys the same safety.

## Baseline

| | 2026-09-05 | 2026-09-28 |
|---|---|---|
| `main` | `2b77f15` | `bace644c` |
| Browser sweep | two scripts in `scraps/`, run by hand | CI gate: 222 desktop / 225 phone checks |
| Performance matrix | none | CI gate: 60 cases |
| Migrations | 38 | `0001`–`0071` plus four timestamped files |
| Scheduled calls | six cron jobs | one pg_net job, `edge-calls-every-minute`, holding every recurring call |
| Main bundle | 120.29 kB gzipped against a 122 kB budget | size gate green; the modal cluster and the Agents page are lazy chunks |
