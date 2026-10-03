# Working on this repo

The standing instructions for every coding agent on this repository, in
one file, with the agents feature's own rules in `docs/agents/CLAUDE.md`.
Claude Code reads it here; Cursor is pointed at it by
`.cursor/rules/instructions.mdc`. (There is no `AGENTS.md`: its content
was this file's, repeated, and it moved here on 2026-09-23.)

How the owner actually works — what "done" means, what counts as
evidence, settled chart/ledger rules, past mistakes — is
`.claude/skills/working-with-davies/SKILL.md` (auto-loaded). Cursor
loads the same text from `.cursor/rules/working-with-davies.mdc`. The
live handover record is `docs/LEDGER.md`; `docs/handover.md` is its archive.

**Reply to Davies in Chinese.** He writes in Chinese, and every line he
reads is Chinese: answers, the one-line progress notes between tool
calls, and above all the first lines after a context compaction, whose
summary is written in English. Everything committed stays English. The
rule is here and not only in the skill because the skill is cut short
when a context is compacted, and English came back four times (the last
on 2026-09-23: "怎么会话又变成英文了").

**Sub-agents are `opus-max` or `sonnet-max`, nothing else** (Davies,
2026-09-30): both run at max effort, the first for important or difficult
work, the second for easy work, and both are defined in `.claude/agents/`.
Never a built-in agent type or another model; at most three at a time
(the working-with-davies skill).

## A fresh container

Overview: this repo is a Vite + React (JSDoc/`checkJs`, not TSX) client
bundled to static files, plus Supabase Edge Functions written in Deno
(`supabase/functions/*`). There is no local backend by default — the
client and CI both talk to the **deployed production** Supabase project
hard-coded in `src/app/supabase_config.js`.

Standard commands are already documented — see the `scripts` block in
`src/package.json`, the "Local development" section of `docs/map.md`, and
the CI workflows (`.github/workflows/check.yml`, `edge-functions.yml`).
Client — the web app is an npm project in `src/`, so run these there:
`npm run dev` (Vite on `http://localhost:5173`), `npm test` (vitest),
`npm run typecheck`, `npm run lint`, `npm run build`. Edge Functions,
from the root: `deno check supabase/functions/` and
`deno test --allow-env --no-check supabase/functions/`. `sh bin/setup.sh`
prepares a fresh clone (the ledger hook, `npm ci` in `src/`);
`sh bin/gates.sh` runs the CI gates the change can break (`--full`: every one).

Non-obvious caveats:

- **Deno 1.x is required for the Edge Function checks**, to match
  Supabase's Deno-1 Edge Runtime and CI (`setup-deno` with `v1.x`) — do
  not run them on Deno 2. A container may have no `deno` at all:
  `sh bin/gates.sh` fetches 1.46.3, the last 1.x and the one CI gets,
  through `npx --yes deno@1.46.3`, and a single command can do the same.
- **The app is password-gated against production.** The React shell
  renders a login form; every Edge call (`auth`, `prices`, `data`,
  `chart`, `fundamentals`, `trading212`, …) requires an app token
  derived from the password (`?pwd=<APP_ADMIN_PWD|APP_RO_PWD>` in the
  URL, e.g. `http://localhost:5173/?pwd=<value>`). Without it, `auth`
  returns `401` and the data functions return `401 {"error":"invalid
  token"}`. To exercise the board, live prices, or any data flow you
  need one of these passwords; there is no dev bypass and pointing at a
  local Supabase would require editing `src/app/supabase_config.js` + running
  the full local stack.
- **The anon key opens nothing in the database** (`0082`, 2026-10-02).
  The page carries it for the Edge Functions' gateway alone; every read
  and write goes through an Edge Function with the service role, or
  pg_cron as postgres. `anon` and `authenticated` hold no privilege in
  `public`, and its default privileges keep them out of what is created
  later: never add a policy or a grant for either. Until then three
  dashboard-made policies let the anon key read and write `board_data`.
- **Do not brute-force the password.** The `auth` Edge Function has an
  IP-keyed lockout (3 wrong attempts → escalating 24 h lockout), so a
  handful of bad guesses will lock the whole VM's egress IP out of
  production auth.
- **`npm run build` writes the bundle to `dist/`**, and that committed
  bundle is served as-is by Cloudflare Pages (`wrangler.jsonc`'s
  `pages_build_output_dir` makes `dist/` the only directory it
  publishes). Running a build dirties the working tree; if you did not
  intend to ship a bundle, restore with `git checkout -- dist/` and
  `git clean -fdq dist/`. Per the CI "bundle freshness" gate, any change
  to `src/*.{js,jsx,css}` MUST be committed together with a rebuilt
  bundle or CI goes red.

## Documentation

- **Keep the docs in sync as part of every change** — don't wait to be
  asked. `docs/map.md` is the source-of-truth map of the system: when a
  change adds or removes an Edge Function, migration, `src/` module,
  workflow or script, update its row there (and the engineering notes,
  stack or data flow if they change) in the same commit. A row is ONE
  line saying what the file is for; why it is built that way goes in the
  file's own comments, never back into the row — appending each change's
  story to its row is how the README reached 275 KB.
  `src/docs_map.test.js` fails when a file has no row or a row names a
  file that is gone. `docs/guide.md` says how to use the site, in plain
  words for a user; update it when a user-facing feature changes. A
  change that lands without its docs update is incomplete.
- **`docs/README.md` is the public front page, and it stays one page**
  (GitHub shows a README from `docs/` on the repository's home page, so
  it left the root on 2026-09-23; Davies shows the repo in interviews and
  had it cut from 275 KB to 10 KB the same day): the pitch, the live example at daviesluo.com
  (password: contact Davies), screenshots in `docs/screenshots/` with
  every dollar amount masked by the site's hide-values mode, what it
  does, how it's built, how he works, the crypto loop, and a
  one-row-per-folder map, which names no AI coding agent and no folder of
  theirs (Davies, 2026-09-24). Touch it only when one of those changes. It is
  written in his voice — first person, plain words, short sentences, no
  slogans — and detail goes to `docs/map.md`, never back into it.
- **No personal financial figure goes into `docs/README.md`, `docs/guide.md`
  or `docs/map.md`** — no balance, position value, share count, lot
  price or P&L in dollars from the real book; describe the engineering
  with neutral wording instead.

## The ledger

This repository runs the **ledger protocol**, whose full text is
`.agents/skills/ledger/SKILL.md` (invoke it as `/ledger`). That folder is
the whole vendored package, where Cursor and Codex find it themselves;
Claude Code finds it through the pointer at `.claude/skills/ledger/`, and
Cursor also has one at `.cursor/skills/ledger/`. Read it before your
first ledger entry. What follows is only this repository's half of the
arrangement.

**`docs/LEDGER.md` is the live record.** Three parts in order:
what remains right now, machine and platform setup, then history newest
first. A resuming session reads it first and works down the list. It is
kept SMALL on purpose — every session on every platform pays context for
it on every wake.

**`docs/handover.md` is its ARCHIVE**, not a second live document. It holds
the decision log and the raw session transcripts, 35k lines of them, and
is opened only when a closed item is reopened or audited. When an
operation closes, its block moves there verbatim and one line at the head
of the ledger's history records the move. Do not maintain both as
running records: two handover documents drifting apart is the exact
failure the protocol exists to prevent.

**The rule: the ledger moves with the work.** Every commit that changes
anything a later session would need to know about carries its ledger line
in the SAME commit, or the very next one. Never at the end of the day.
The session that plans to write it later is the session a usage limit
cuts off first.

**The hook enforces it.** `bin/hooks/pre-commit`, reached through
`core.hooksPath`, refuses a commit whose ledger is two behind, and
refuses a new history section that does not open with a source header.
Both are per-clone config a rebuilt container loses — the commands are
in the ledger's machine-setup section (`sh bin/setup.sh`). The escape hatch is
`LEDGER_OK=1 git commit`, for the three cases the refusal names; reach
for it before `--no-verify`, which switches off every gate rather than
the one that does not fit.

**Source headers.** Each history section opens with a timestamped header
naming the platform and the model, in the exact shape the hook checks —
see `.agents/skills/ledger/SKILL.md`, and `EXAMPLE.md` beside it for a filled-in one.
Sessions running under an operator rule that forbids model identifiers in
pushed artifacts write `Model: not recorded (session policy)`; that
satisfies the gate and says why the field is empty.

**Before you finish**, and the moment a usage limit looks near: stop
opening new work, land the smallest COMPLETE unit, write its ledger line,
push, and spend what is left making the what-remains list exact. That
list is the entire briefing the next session gets.

Keep `.claude/skills/working-with-davies/SKILL.md` (and its two Cursor
copies) in step whenever a session learns something durable about how the
owner works, or pays for a mistake worth not repeating. The skill is the
distilled agreement; the ledger and its archive are the evidence behind
it.

Do not copy live balances out of `docs/LEDGER.md` or `docs/handover.md` into new
files, issues, or anything public. The repo is private; those files quote
real positions.
## Agents (crypto, stablecoin quotes, Polymarket, Jev)

Their rules are in **`docs/agents/CLAUDE.md`** since 2026-10-03 (Davies: "你说的这四点建议全做"): about 39 KB that
every call of every session paid for while they lived here. Read it, and `docs/agents/reference.md`, before touching
`supabase/functions/agents/`, `src/agents/`, `docs/agents/`, a migration of theirs, or anything that trades, quotes or
reads a venue. Claude Code loads it by itself when a session reads a file under `docs/agents/`, and the two code
folders hold a pointer it loads the same way. What must never be missed, wherever you are:

- Never trade by hand in the loop's Revolut X account or in PR5's sub-account (key `_2`): each books that account's
  balance as its own. Tell Davies so whenever the subject comes up.
- Only Davies arms anything live, in the conversation where he says go; Polymarket opens a position only from
  Ireland, under his standing attestation. Secrets are never printed and never moved.
- A pre-registered test's no-peek rules bind every session: what may not be read before its reading is not read, and
  anything seen by accident is disclosed in the ledger.
- Every recurring Edge call is a row of `public.edge_calls` and joins the watchdog in the migration that adds it.

## Git workflow

- **Push `main` directly.** No feature branch, no PR, unless he
  explicitly asks for Codex review. Each commit is its own logical
  unit; if the work spans multiple concerns, split into multiple
  commits before pushing.
- **PR only when he asks.** `@codex` only reviews PRs — e.g. a new
  Edge Function, anything that touches `auth` or migration state, if
  he wants that second look. Don't open one otherwise.
- Run `sh bin/gates.sh` before every push, and push only when it ends
  with `all gates green`. It runs the gates the change can break,
  chosen by the paths it touches against `origin/main` (Davies,
  2026-09-27: the full run had reached twelve minutes): `src/` or
  `dist/` every web gate; an Edge Function the Deno checks and the unit
  tests; a migration, `docs/` or Markdown the unit tests (and the Edge
  tests for `docs/`, whose pre-registrations and fixtures they read);
  anything else every gate. Everything runs at once: the checks that
  read the source beside the bundle's line — built, then the browser
  sweep in shards (each a viewport and a group of its parts,
  `SWEEP_PART`), the perf matrix and the size budget together, each on a
  port the system has free. Each step prints its seconds.
  `--full` forces every gate. CI runs every gate on every push either
  way.
- Cloudflare Pages Git builds (watch paths `dist/*` when set in the
  dashboard) and `.github/workflows/pages-deploy.yml` (Wrangler Direct
  Upload of the committed `dist/`) publish a `dist/` change. The Action
  is the path that does not clone the whole repository on Cloudflare's
  builders. `check.yml` still runs on every push. If a push leaves
  `main` red, fix-up commit on `main` is the next priority — don't
  move on to new features while CI is broken.
- Never force-push `main` and never bypass hooks (`--no-verify`)
  without explicit user confirmation in the same message. The one
  force-push so far (2026-09-24, Davies' word) rewrote every commit to
  name him as author and committer, content unchanged: a hash quoted
  from before it maps through `docs/commit-map-2026-09-24.md`, and a
  clone made before it must be re-cloned or reset to `origin/main`.
- Keep commit messages focused on **why**, not **what**.
- **Commit as the repo owner, never as Claude / Anthropic.** Every
  GitHub contribution must land in the owner's name so the graph
  reflects them. At the start of each session set the git identity
  before committing:
  `git config user.name "daviesluo" && git config user.email "daviesluo@gmail.com"`
  (containers clone fresh, so this resets every session — set it each
  time). Do NOT author/commit as `Claude <noreply@anthropic.com>`, and
  do NOT add a `Co-Authored-By: Claude …` trailer.

## The production monitor

A Cloudflare Worker, `daviesportfolios-monitor` (`workers/monitor/`),
runs every minute on Cloudflare's clock (Davies, 2026-10-02: GitHub had
run the 10-minute `healthcheck.yml` 9 times in 48 hours, and nothing
alerted on that day's 80-minute database stall). It checks the live
site, Supabase's minute loop (the `monitor` function's read-only health
action) and PR5's dead-man switch; a check failing two minutes running
alerts, and again on recovery, as an `ops_errors` row (`monitor.*`, the
site's errors box) and through `monitor-alert.yml` as the issue labelled
`monitor`. `monitor-deploy.yml` deploys it on a change to
`workers/monitor/`; its `CLOUDFLARE_API_TOKEN` needs Account → Workers
Scripts → Edit as well as Pages, and without it the run deploys nothing
and says so in a warning. `MONITOR_SECRET` (the Worker and the `monitor`
function share it) is set only by that workflow, which generates it:
never by hand, never printed; run it with `rotate_secret` to change it.
GitHub needs the repository secret `MONITOR_GITHUB_PAT` (fine-grained,
Actions: Read and write on this repository); without it the Worker skips
GitHub and says so at its address. The `monitor` function imports nothing
of `agents` and deploys with JWT verification on (the Worker sends the
anon key). When a critical recurring job is added, ask whether its
freshness belongs among the health readings (`monitor/health.ts`).

## Edge Function deploys

`.github/workflows/edge-functions.yml` auto-deploys every changed
`supabase/functions/<name>/index.ts` on push to `main`, gated by
`deno test supabase/functions/`. Requires repo secrets
`SUPABASE_ACCESS_TOKEN` (account PAT) and `SUPABASE_PROJECT_REF`
(project ref id). When a commit changes an Edge Function:

1. Add / update the matching `index.test.ts` so the pure helpers stay
   pinned — the workflow's deploy step won't run if `deno test` fails.
2. Commit + push as usual. The workflow takes care of the deploy.
3. Verify in the Supabase dashboard → Edge Functions list that the
   "Last updated" timestamp jumped to the deploy run.

If the deploy secrets are missing or revoked the workflow logs a
warning and exits 0 — the push doesn't go red, but production stays
on the previous version. Fallback in that case: paste the new
`index.ts` into Supabase dashboard → Edge Functions manually, same as
the pre-CI workflow.

The `Deno.serve(...)` entry in each `index.ts` is wrapped in
`if (import.meta.main)`. Preserve that guard — without it, importing
the function's pure helpers from `index.test.ts` would bind a port.

## Testing

The npm commands run in `src/`; `sh bin/gates.sh` runs the ones the
change can break, and the Edge Function checks when they can be broken,
from anywhere in the repository (`--full`: every one).

- `npm run typecheck` — tsc with `checkJs` + `strictNullChecks`, no type
  errors should slip through. The `useState(null)` / `useRef(null)` slots
  carry JSDoc `@type` annotations; keep new ones annotated.
- `npm run lint` — ESLint (flat config, `src/eslint.config.js`). A bug gate,
  not a formatter: errors on `react-hooks/rules-of-hooks`, warns on
  `exhaustive-deps` (a few effects intentionally narrow their deps). Runs
  in CI between typecheck and test.
- `npm test` — vitest. Over 1,150 cases covering: YTD chart math, fetch /
  proxy strategy, ticker-shape predicates, cache TTL + LRU, per-proxy
  backoff, market-cache + legacy fallback, SW banner suppression
  window, ops-badge desktop gate, portfolio user-fingerprint diffing,
  T212 sync application, and the chart-modal indicator math (MA /
  VWAP / TTM-EPS-P/E / extended-hours-bar detection). Add a pin
  test whenever a regression is fixed so the bug can't quietly come
  back.
- `npm run build` — Vite production bundle, output to `dist/` (committed;
  Cloudflare Pages serves only that directory).
- `npm run verify:browser` — the whole-app browser sweep in
  `src/e2e/app-sweep.mjs`: serves the COMMITTED bundle over http and
  drives it in real Chromium at both breakpoints (603 checks). A hard CI
  gate since 2026-09-17. Its clock is pinned, so it gives the same answer
  at any hour — do not replace `CLOCK` with a live `Date`. Needs
  `npx playwright install chromium` once per machine; a container that
  ships its own Chromium can set `PLAYWRIGHT_CHROMIUM_PATH` instead.
  `sh bin/gates.sh` runs it in shards at once, each a viewport
  (`SWEEP_VIEWPORT`) and some of its parts (`SWEEP_PART`) on a free port
  (`SWEEP_PORT=0`), and CI the same four shards as jobs of their own
  (2026-10-02: 6 min 08 s on one job before); unset, one process runs it
  whole.
  Every bug it has caught was live while `npm test` and the Edge suite
  were green, because each was an integration failure.
- `npm run verify:perf` — the performance-panel matrix in
  `src/e2e/perf-matrix.mjs`: 60 cases (two views × five ranges ×
  three recorded-data states × two books) read back from the committed
  bundle and compared with answers worked out by hand. A hard CI gate
  since 2026-09-23. Its clock is pinned too (`PERF_MATRIX_CLOCK` moves
  it), and it refuses an instant its fixture cannot serve: its "18
  failures" were all 14:00–20:00 UTC, where the fixture's first bar has
  left the 24H window and the app was right.
- `deno test --allow-env supabase/functions/` — Edge Function pin
  tests. Required locally before pushing changes to any
  `supabase/functions/<name>/index.ts`; CI runs the same on every PR
  and push to main. Each function's pure helpers are `export`ed and
  pinned by a co-located `index.test.ts`.

When refactoring chart math, add a test pinning the formula's output
for the affected case so the YTD bugs (+80% / +21% / +9% misreports)
can't quietly come back. Same rule applies to Edge Function helpers
— extract the pure logic and pin it in `index.test.ts`.

Note: `vitest` 4 runs on the project's own Vite 8 (rolldown / oxc), the
same pipeline `npm run build` uses; the esbuild-deprecation warnings of
the Vite 5 era are gone. A transpile-sensitive change is still worth
eyeballing in a real `npm run build`, because the browser sweep tests the
bundle and vitest tests the modules.

## Storage

Persisted state lives under the `dp.*` namespace with a single schema
version (`Storage.migrate()` in `src/app/storage.js`). When the data shape
changes, bump `CURRENT_SCHEMA_VERSION` in `src/app/storage.js` and add a
migration step instead of inventing a new key.

## Pull requests

Codex's `@codex` bot reviews PRs only, not direct commits to `main`.
Default is direct push; the owner catches issues via Cloudflare
preview deploys and real-world testing. Open a PR only when he asks
for Codex — then wait for the review and respond to
`get_review_comments` before merging. The T212 rollout (PR #129)
caught both the per-share-vs-total cost bug and the boundary-race
concern this way.

**While a PR is open its description is part of the branch, and it is
maintained the way the ledger is — in real time.** Every push that
changes the diff rewrites the description in the same step, before the
turn ends. Never leave it describing the previous push: it is read as
the current state of the branch, so a stale one actively misinforms.

Each rewrite has to leave these true:

- **It describes only what the PR would add to `main` right now.** Work
  that lands on `main` separately stops being this PR's work — take it
  out of the summary, and out of the branch. **Rebase onto `main`;
  don't merge `main` in.** A merge drags `main`'s own commits into the
  PR's commit list, where they read as unreviewed work the PR is
  proposing.
- The commit table matches the commits. Rewrite it whenever the history
  is rewritten.
- The test plan names what was actually run against the tree being
  pushed — the gates, the browser verification, the counterfactuals.
- Risks say what merging does to production: a migration
  `migrations.yml` will apply, an Edge Function that redeploys, a
  behaviour change that touches live data.
- **The Cloudflare Pages preview link is in it**, near the top, so the
  branch can be checked on a real machine before it merges.

Cloudflare Pages aliases every branch to
`https://<slug>.daviesportfolios.pages.dev`, where `<slug>` is the
branch name lowercased with every non-alphanumeric run collapsed to `-`
and truncated to 28 characters — `claude/repo-audit-restore-uverhn`
becomes `claude-repo-audit-restore-uv`. Verify it before quoting it:
fetch the URL and check the `assets/app-<hash>.js` it references is the
one committed on the branch, not the one on `main`.
