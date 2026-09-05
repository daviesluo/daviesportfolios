# Improvement plan

Written 2026-09-05 against `main` at `2b77f15`, from a full read of the
repository — 54 client modules, eleven Edge Functions, 38 migrations,
four workflows — and from measurements against the live production
surfaces. Every number here was measured on that date. Nothing was
estimated, and nothing was taken on trust: each finding below was
re-checked in the source or against production before it was written
down.

**Nothing in this plan has been executed.** It is a proposal, and it
stays a proposal until the owner says otherwise. Each item says what it
costs, what it risks, how it would be verified, and whether it needs him
at a console.

**What this file deliberately leaves out.** This document is served
publicly today — that is item 1 — so it describes the work rather than
the weakness. Which endpoint answers what, which comment says what, and
anything else shaped like an instruction for attacking the running
system is in the pull request that proposes this file, which is private
to the repository. When item 1 lands, the split stops being needed.

**Order.** Tiers are the order, not a menu. Inside a tier, work down.

---

## Tier 0 — before anything else

### 1. Stop the site publishing the repository, then rotate the secrets

**What.** `https://daviesluo.com` serves every file in the repository
root to anyone, unauthenticated. Re-measured 2026-09-05: the handover
archive returns 200 with 1.87 MB of real position history; the ledger,
all of `src/`, the migration carrying purchase records, `CLAUDE.md` and
`.env.example` are all 200. The Edge Function sources are readable too,
and that is the worse half — one of them documents the app's own
credential design in a header comment. Those responses carry
`Access-Control-Allow-Origin: *`, so any page on the internet can read
them with script.

**Why first.** It is the only finding whose damage is already done and
still accruing. Everything else here makes a good system better.

**Root cause, corrected.** The ledger currently blames
`wrangler.jsonc`'s `assets.directory`, and that wrong diagnosis is what
produced two failed fixes. `assets.directory` and `observability` are
Cloudflare **Workers** keys; a **Pages** project ignores them, and
`wrangler` is not even a dependency here — the `$schema` in that file
points at a path that does not exist. The site serves the repository
root because **no build output directory is configured anywhere**, and
the Pages default is the repository root. Same reason both fixes failed:
`.assetsignore` is a Workers mechanism, and a redirect cannot beat a
static asset that genuinely exists.

**How.** The right in-repo knob for a Pages project is
`pages_build_output_dir` in the Wrangler configuration file. It is an
inheritable Pages key, and that file becomes the source of truth for
whatever it sets.

1. Point Vite's `outDir` at `../dist` instead of `..`; move the
   committed bundle there and delete the copies left at the root.
2. Add `"pages_build_output_dir": "./dist"` to `wrangler.jsonc` and drop
   the two Workers-only keys that never applied.
3. Push to a branch and let Pages build the **preview**. Require two
   things of it before production: the app loads and its asset hash
   matches the branch, and the archive path returns 404.
4. Only then merge.

No dashboard change, no build command. If he would rather Cloudflare
built from source, that is item 11 and it subsumes this — but item 1
should land first either way, because it is one commit and a preview URL
proves it.

**Then treat it as a breach.** Rotate both application passwords and the
token-signing secret, and assume anything the repository published has
been read. The calming measurement: the auth table holds five failed
attempts in its whole history and none in thirty days, so there is no
sign anyone found it. That is a reason not to panic, not a reason to
skip the rotation.

**Cost** S. **Risk** low with the preview check; a wrong output
directory takes the site down, which is exactly what step 3 catches.
**Needs him** for the rotation only.

### 2. Teach the health check about this failure

`healthcheck.yml` pings production every ten minutes and knows nothing
about this class of failure. Assert that three repository paths return
404 and the app root returns 200. Configuration drifts; a platform
change or a later migration to Workers could silently republish
everything. The check that would have caught this in August is four
lines. **Cost** S. **Risk** none. **Verified by** running it before item
1 and watching it fail, then after and watching it pass.

---

## Tier 1 — the numbers and the money paths

This is the tier that matters most, because every item in it is a way
for the app to be confidently wrong rather than visibly broken.

### 3. One holding, two ledgers

**What.** The Investment Performance panel draws a value line and a
deposited line. When a holding's written lots do not net to its board
share count, the two reconcile that differently. Verified by running
both real functions on a synthetic holding of 20 board shares with one
written lot of 5 bought mid-window:

```
value line     lots: [ 2026-01-01, 20 shares ]                   sells dropped
deposited line lots: [ 1970-01-01, 15 shares ] + [ 2026-06-01, 5 ]  sells kept
```

The value line throws the real lots away and dates the whole position at
the window start. The deposited line keeps the real dated lots and backs
in only the residue. So for these holdings the two lines are built from
incompatible histories, and the value line owns shares before they were
bought.

**The nuance that matters.** The value line's behaviour is documented
and was deliberate when written — "the value is right even when the
timing isn't knowable". The deposited line later found a better answer
and it was never back-ported. So this is not a bug someone introduced;
it is a fix that only landed on one side.

**How.** Measure first, against the real board, before changing
anything: how many holdings take the fallback, and how far apart the two
lines actually sit at the first point of each range. If the gap is real,
give `ledgerFor` the deposited line's reconciliation — keep the real
lots and sells, stand in only the residue, date the stand-in before
every window. Pin the current outputs before touching it, because every
number on that panel moves.

**Cost** M. **Risk** M — it changes displayed performance. **Verified
by** the measurement first, then pinned before/after values for each
range, then the browser sweep's reconciliation identity.

### 4. A failed save is deferred silently

**What.** Verified in `app.jsx`: the debounce timer marks the portfolio
as saved *before* awaiting the save. When the save comes back not-ok and
is not a conflict — expired token, 5xx, offline — nothing rolls that
marker back and nothing is shown. The next render computes the same
fingerprint, takes the early return, and the edit is never retried in
that tab.

**The honest severity.** The edit is not lost: a session-storage mirror
holds it and a cold mount replays it. So this is a silent deferral until
the user happens to reload, not data loss. That is still the exact
"quiet fallback" shape that has cost this project three times.

**How.** Advance the marker only inside the ok branch. On a non-conflict
failure, show the same class of banner the conflict case already gets,
and retry with a bounded backoff. **Cost** S. **Risk** low.

### 5. A failed load can substitute the demo book

**What.** The remote load returns the same demo fallback for "the server
has no row" and "the load failed". The mount path guards against this,
with a comment citing the review that found it. Verified: the
cross-tab reload path does not have that guard — it accepts whatever
comes back. So another tab saves, this tab reloads, the token has
expired, and the real board is replaced by the seeded demo one.

**How.** Return a result that distinguishes empty from failed, and fall
back to the demo book only on empty. Apply the mount path's guard to the
broadcast path too. **Cost** M. **Risk** M — it changes the load
contract, though that contract is well covered by tests.

### 6. No plausibility band on an incoming price

**What.** A quote is written to the board after a shape check only —
non-null, right envelope. There is no finiteness or positivity check at
the write, and no band against the previous close or the last known
value. That matters more than data hygiene: when the price Edge Function
is unavailable the client falls back to five free public CORS proxies,
and the code comments already record two occasions where a proxy served
a well-formed wrong number.

**How.** The precedent is in the repository: the after-hours trust guard
already bands an extended-hours quote against the last bar, and was
recently made to scale that band with the stock's own volatility. Reuse
that shape. A quote outside the band is dropped and reported, not shown.
**Cost** M. **Risk** low, provided the band is wide enough for a real
gap — which is what the volatility scaling is for.

### 7. The FX shim reaches the performance line

**What.** The FX helper falls back to 1:1 when a rate is missing and
documents that callers must check the `missing` flag. Only one caller
does. The performance value line, the realized gain total and two others
take the shim, so a missing rate renders a non-USD holding at roughly
its foreign face value. The header shows a global "FX missing" pill, but
the affected figures are neither suppressed nor marked.

**How.** The right pattern is already in the deposited-line module: it
refuses to draw rather than convert at 1. Propagate a missing flag to
the panels and render an em dash for the affected series. **Cost** M.
**Risk** M — some charts will refuse to draw where they previously drew
something wrong, which is the point.

---

## Tier 2 — the structure that prevents the next one

### 8. Make the browser sweeps a real gate

The two Playwright harnesses caught the scoreboard mismatch, the missing
preflight header, the overnight sawtooth and the heat-map em dash. They
live in a directory called `scraps`, need a hand-built Playwright
install under `/tmp`, and run when someone remembers. Add Playwright as
a dev dependency, move them to `test/browser/`, add `npm run
verify:browser`, run it on pull requests. Chromium is preinstalled and
CI can cache it.

This is the highest-value testing change available: 764 unit tests and
208 Edge tests were green while all four of those bugs were live,
because each was an integration failure. The sweeps already encode the
answers; only their status is wrong. **Cost** M. **Risk** low.

### 9. Collapse the duplicated market logic

Three kinds of knowledge are copy-pasted, and all three have already
drifted. Verified:

- The Trading 212 ticker mapping exists in three places. The trading
  function's copy handles compound US symbols and symbols containing a
  digit; the two recorders' copies still use the older patterns. Those
  tickers are silently absent from recorded prices — an unmapped ticker
  is not an error, it is just missing from the row.
- The set of US-listed names with no overnight tape has two members in
  the client and one in the overnight recorder, so the recorder writes
  overnight points for a name the client treats as having none.
- The session predicates are implemented separately in the client and in
  each recorder.

One shared ticker module, one shared no-overnight set, one shared
session module, each with a pin test. Client and Edge cannot import from
each other, so the client keeps its own session copy — but a table test
asserting the two agree across a list of timestamps closes the drift
without merging the code. **Cost** S–M. **Risk** low; write the pins
before the move.

### 10. Watch what the cron jobs actually did

Six scheduled jobs fire HTTP calls and discard the response; the health
check explicitly does not cover their freshness. Nothing would notice a
recorder returning 403 on every call. Add a daily job that asserts the
newest row in each recorded series is as recent as the market calendar
says it should be, and writes an ops error otherwise. The calendar part
is the whole trick — the naive version pages all weekend, which is
precisely the mistake a session made by hand on 2026-09-05. **Cost** S.
**Risk** none.

### 11. Let Cloudflare build the site

Move to a Cloudflare-side `npm ci && npm run build` with output `dist`,
and stop tracking the bundle. Five pieces of machinery exist only
because the bundle is committed: the bundle-freshness gate; the CalVer
stamp, chosen because a build SHA cannot name the commit that ships it;
the rule that a preview must be checked by reading its asset hash;
`emptyOutDir: false` with its prebuild clean-up; and 29 MB of git
history that is mostly superseded bundles. All five dissolve, the
version stamp goes back to a real SHA, and a rebuild stops rewriting
666 kB of tracked minified output into the commit.

Not Tier 0 because it changes how production deploys, and item 1 gets
the same security result with one commit. **Cost** M. **Risk** M — a
failed build means no deploy, which is strictly better than today's
failure mode of deploying a stale bundle while CI stays green, but it is
new behaviour and wants a week of watching. **Needs him** once, to set
the build command.

---

## Tier 3 — known latent defects

Each of these is small, verified, and currently harmless. They are here
so none of them is discovered the hard way.

**12. The price recorder's deploy flag is missing.** Its own header
comment says it must be deployed with the platform JWT gate off, and
names the workflow variable that does it; it is not in that list.
Measured 2026-09-05: it wrote a row one minute before the check, so
nothing is broken — the deploy tool preserves the setting already on the
function. But that tool is pinned to `latest` while every action beside
it is pinned by SHA. The day it stops preserving the setting, price
history stops and nothing reports it. Add the name; pin the CLI. **S.**

**13. Read-side gaps on the anonymous endpoints.** One endpoint answers
questions it should require a token for; one accepts an unbounded
lookback that any token can use to pull the whole recorded history in a
single call; two request-size guards trust a header a chunked request
simply omits. Details in the pull request. One of these was tried once
and reverted because it broke the legitimate overnight line, so it needs
the preflight interaction checked before it is trusted. **S each.**

**14. The market calendar has no early closes.** It knows full holidays
but not the three-or-so half days a year. On those afternoons the
recorder treats a frozen carry as a live sample — the same class of bug
that produced the overnight sawtooth and needed a migration to clean up.
**S.**

**15. The foreign-session predicates ignore weekends.** They check
clock-minutes only, so the London and Amsterdam sessions read as open on
a Saturday. One documented consumer tolerates it; the chart modal's
choice of daily anchor does not, and flips to the live branch all
weekend. All of these functions are untested. **S.**

**16. Migration ordering would not replay as production ran it.** The
directory mixes sequence numbers with timestamps, and the push tool
sorts by string. One of the timestamped files rebuilds a table; on a
fresh replay the data repairs would run and then be wiped, in an order
production never saw. Use timestamps for everything new, say so in the
migrations README, and rename nothing already applied. **S.**

**17. Lot dates are UTC while the date picker is local.** Four call
sites take today's date from an ISO string. For a US user after 19:00
Eastern a trade is dated tomorrow, and lot dates drive the
prior-year-versus-in-year basis split — on New Year's Eve that is the
same family as the year-to-date misreports this project has already
paid for. Needs his answer first: which calendar should a lot date be
in. **S, but the decision comes first.**

**18. The chart recomputes on every render.** The whole per-bar
portfolio computation sits in the render body with no memo, and the
panel is not memoised, so one 30-second refresh runs it four or five
times over roughly 150 bars. One `useMemo` around the block. **S.**

**19. Modals have no dialog semantics.** No `role="dialog"`, no
`aria-modal`, no label, no focus trap, no focus restore. Separately,
each modal registers its own key listener, so with two stacked one
Escape closes both — defeating the layering the code deliberately
builds. Route Escape through a stack so only the top one handles it.
**M.**

**20. One error boundary for the whole app.** A throw anywhere replaces
the entire page. Wrap the performance panel, the heat map, the sidebar
and each modal so one panel degrades instead of the app. **M.**

**21. The overnight cache is the one unbounded localStorage row.** The
whole map is re-serialised on every overnight fetch — every 30 seconds
for hours — and re-parsed on every read. Nothing prunes tickers that
leave the book. This is exactly what the chart caches were moved to
IndexedDB to avoid. **M.**

**22. The open chart modal polls every five seconds forever.** No market
phase gate, no visibility gate, no backoff. A modal left open over a
weekend is tens of thousands of Edge calls. **S.**

---

## Tier 4 — craft

**23. Give the app an icon.** The manifest ships an empty icon array and
the page has no icon link at all. No favicon; iOS uses a screenshot for
the home-screen badge; Chrome will not offer to install without a 192 px
and a 512 px icon. For an app that lives on a phone home screen this is
the best ratio of result to effort in the repository. **S.**

**24. Split the modal cluster out of the main bundle.** 120.29 kB
gzipped against a 122 kB budget is 1.71 kB of headroom, which means the
next feature is paid for by raising the number instead of making a
choice. The ticker chart modal, its geometry, the indicator maths, the
transaction history and the export path are all reachable only after a
click. A separate vendor chunk for React would also stop every app
change invalidating a cached copy of React. **M.**

**25. Make the documented gates one command.** Seven commands are listed
as required before a push, with no aggregate script and no pre-push
hook, so the gate is a habit. Add `npm run check` and a `hooks/pre-push`
beside the ledger's `pre-commit`. **S.**

**26. Correct the drifted documentation.** Measured: `CLAUDE.md` says
the suite is about 400 cases (764, plus 208 on the Edge side) and says
the build runs Vite 5 (it is Vite 8, which makes its note about a
version mismatch with the test runner obsolete). The README's map is
accurate and should be left alone. **S.**

**27. Small things, each a few lines.** Sortable headers in the
transaction table are mouse-only while the other two tables are not;
that table also keys rows by index while re-sorting them. The
year-to-date anchor mixes UTC and local time. `prefers-reduced-motion`
disables one selector out of thirteen animations, and the per-tick flash
is the one that matters. The header clock component mounts twice, one
copy CSS-hidden, so two one-second intervals run forever. The sidebar
menu announces as a menu but does not behave as one. Two provenance
fields mean a lot edited by hand loses its broker origin. Roughly
fourteen dead CSS selectors. One dead exported function pair kept alive
only by its own test. A circular import that survives only because both
exports are hoisted declarations.

**28. Close the ledger's own two questions.** What `Model:` carries in
source headers, and the stale issue. Both are already on the ledger's
list; they are here so this plan is complete.

---

## Not doing, and why

- **Rewriting the main component.** 1,470 lines with 29 state slots is
  genuinely large, and there is a clean split available — four hooks and
  two presentational modules, listed in the pull request. But no bug is
  attributable to its size, the narrow dependency lists are documented
  where they are deliberate, and a split would be churn measured against
  taste. Revisit when a change to it is actually hard. Item 18 is the
  part worth doing now, and it is one memo.
- **A context for the value-hiding flag.** It is threaded to twelve
  sites, which is the usual argument for context, but a context would
  break the memoisation on the heat map. Keep the prop.
- **Adding a static-analysis service.** The dependency audit and the
  dead-code scan already run on every push, updates are automated, and
  this is a single-owner private repository.
- **Replacing the free proxy chain.** A real supply-chain surface, but
  it is a fallback for an already-degraded state and it is enumerated
  tightly in the content policy. Item 6 bounds the damage, which is the
  proportionate answer.
- **Merging client and Edge session logic into one package.** Different
  runtimes, different deploy cadences. A test asserting they agree buys
  the same safety for a fraction of the disruption.

---

## Questions only he can answer

1. Which calendar should a lot date be in — UK local, US market date, or
   UTC? Three of them disagree for an entry made in the evening.
2. When a live FX rate is missing, should the performance line draw at
   the last frozen rate, or refuse to draw as the deposited line does?
3. Should the value line re-mark history at today's FX rate, or at the
   frozen rate the deposited line uses?
4. Should a failed load ever be allowed to show the demo book, or should
   it show "couldn't reach the server" and keep the cached board
   read-only?
5. Is "hide values" meant to conceal magnitude, or only the exact
   digits? It currently keeps the digit count and the scale suffix.
6. Can a board carry a negative cash balance, or the same ticker in two
   positions? Both cases are handled inconsistently and neither may be
   reachable.
7. There is no migration numbered 0027 and no record of one — a skip, or
   a file lost in a rollback?

---

## Measured baseline, 2026-09-05

| | |
|---|---|
| `main` | `2b77f15`, clean, pushed |
| Tracked files / git size | 230 / 29 MB |
| `src/` | 15,764 lines across 54 modules, plus 10,426 across 46 test files |
| Unit tests | 46 files, 764 cases, green, 21 s |
| Edge tests | 208 cases, green |
| Dead-code scan | clean |
| Main bundle | 120.29 kB gzipped against a 122 kB budget |
| Committed assets | 666 kB in 4 files |
| Cron jobs / failures in 24 h | 6 / 0 |
| Failed logins, all time / last 30 days | 5 / 0 |
