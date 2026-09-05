# AGENTS.md

## Cursor Cloud specific instructions

Overview: this repo is a Vite + React (JSDoc/`checkJs`, not TSX) client
bundled to static files, plus Supabase Edge Functions written in Deno
(`supabase/functions/*`). There is no local backend by default — the
client and CI both talk to the **deployed production** Supabase project
hard-coded in `src/supabase_config.js`.

Standard commands are already documented — see the `scripts` block in
`package.json`, the "Local development" section of `README.md`, and the
CI workflows (`.github/workflows/check.yml`, `edge-functions.yml`).
Client: `npm run dev` (Vite on `http://localhost:5173`), `npm test`
(vitest), `npm run typecheck`, `npm run lint`, `npm run build`. Edge
Functions: `deno check supabase/functions/` and
`deno test --allow-env --no-check supabase/functions/`.

Non-obvious caveats:

- **Deno is required for the Edge Function tests** and is preinstalled at
  `/usr/local/bin/deno` (v1.x, to match Supabase's Deno-1 Edge Runtime —
  do not run those tests on Deno 2). It is not managed by the `npm`
  update script; if it is ever missing, reinstall with
  `curl -fsSL https://deno.land/install.sh | sudo DENO_INSTALL=/usr/local sh -s v1.46.3`.
- **The app is password-gated against production.** The React shell
  renders a login form; every Edge call (`auth`, `prices`, `data`,
  `chart`, `fundamentals`, `trading212`, …) requires an app token
  derived from the password (`?pwd=<APP_ADMIN_PWD|APP_RO_PWD>` in the
  URL, e.g. `http://localhost:5173/?pwd=<value>`). Without it, `auth`
  returns `401` and the data functions return `401 {"error":"invalid
  token"}`. To exercise the board, live prices, or any data flow you
  need one of these passwords; there is no dev bypass and pointing at a
  local Supabase would require editing `src/supabase_config.js` + running
  the full local stack.
- **Do not brute-force the password.** The `auth` Edge Function has an
  IP-keyed lockout (3 wrong attempts → escalating 24 h lockout), so a
  handful of bad guesses will lock the whole VM's egress IP out of
  production auth.
- **`npm run build` writes the bundle to the repo ROOT** (`assets/`,
  `index.html`, `sw.js`), and that committed bundle is served as-is by
  Cloudflare Pages. Running a build dirties the working tree; if you did
  not intend to ship a bundle, restore with
  `git checkout -- assets index.html sw.js` and `git clean -fd`. Per the
  CI "bundle freshness" gate, any change to `src/*.{js,jsx,css}` MUST be
  committed together with a rebuilt bundle or CI goes red.

## How the owner works

Mechanical gates live in `CLAUDE.md`. The working agreement — Chinese
replies, push-when-done, what counts as evidence, two-numbers-on-one-
screen is a bug, settled chart/ledger/T212 rules, and the mistakes
already paid for — is always-on at
`.cursor/rules/working-with-davies.mdc` (same text as
`.cursor/skills/working-with-davies/SKILL.md`). The 67-turn Claude Code
session it was distilled from is `handover.md` at the repo root; that
file has live balances, so do not copy numbers out of it.

## The ledger

This repository runs the **ledger protocol**, whose full text is
`.ledger/SKILL.md` (invoke it as `/ledger`; pointers sit at
`.claude/skills/ledger/`, `.cursor/skills/ledger/` and
`.agents/skills/ledger/`). Read it before your first ledger entry. What
follows is only this repository's half of the arrangement.

**`LEDGER.md` at the root is the live record.** Three parts in order:
what remains right now, machine and platform setup, then history newest
first. A resuming session reads it first and works down the list. It is
kept SMALL on purpose — every session on every platform pays context for
it on every wake.

**`handover.md` is its ARCHIVE**, not a second live document. It holds
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

**The hook enforces it.** `hooks/pre-commit`, reached through
`core.hooksPath`, refuses a commit whose ledger is two behind, and
refuses a new history section that does not open with a source header.
Both are per-clone config a rebuilt container loses — the commands are
in `LEDGER.md`'s machine-setup section. The escape hatch is
`LEDGER_OK=1 git commit`, for the three cases the refusal names; reach
for it before `--no-verify`, which switches off every gate rather than
the one that does not fit.

**Source headers.** Each history section opens with a timestamped header
naming the platform and the model, in the exact shape the hook checks —
see `.ledger/SKILL.md`, and `.ledger/EXAMPLE.md` for a filled-in one.
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

Do not copy live balances out of `LEDGER.md` or `handover.md` into new
files, issues, or anything public. The repo is private; those files quote
real positions.
## Pull requests

Codex's `@codex` bot reviews PRs only, not direct commits to `main`.
Default is direct push; the owner catches issues via Cloudflare
preview deploys and real-world testing. Open a PR only when he asks
for Codex — then wait for the review and respond to
`get_review_comments` before merging. The T212 rollout (PR #129)
caught both the per-share-vs-total cost bug and the boundary-race
concern this way.

**While a PR is open its description is part of the branch, and it is
maintained the way `LEDGER.md` is — in real time.** Every push that
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
