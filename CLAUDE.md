# Working on this repo

A few standing instructions for Claude Code sessions.

## Git workflow

- **Push directly to `main`.** No feature branches, no PRs. Each commit
  is its own logical unit; if the work spans multiple concerns, split
  into multiple commits before pushing.
- Run `npm test`, `npm run typecheck`, and `npm run build` locally
  before every push — only push if all three are green.
- Cloudflare Pages and the `typecheck-and-build` GitHub Action run on
  every push. If a push leaves `main` red, fix-up commit on `main` is
  the next priority — don't move on to new features while CI is broken.
- Never force-push `main` and never bypass hooks (`--no-verify`)
  without explicit user confirmation in the same message.
- Keep commit messages focused on **why**, not **what**.

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

- `npm run typecheck` — tsc with `checkJs`, no type errors should slip through.
- `npm test` — vitest. 163 cases as of this writing: YTD chart math,
  fetch/proxy strategy, ticker-shape predicates, cache TTL + LRU,
  market-cache + legacy fallback, SW banner suppression window,
  ops-badge desktop gate, portfolio user-fingerprint diffing, and
  the chart-modal indicator math (MA / VWAP / TTM-EPS-P/E /
  extended-hours-bar detection). Add a pin test whenever a regression
  is fixed so the bug can't quietly come back.
- `npm run build` — Vite production bundle, output to repo root.
- `deno test --allow-env supabase/functions/` — Edge Function pin
  tests. Required locally before pushing changes to any
  `supabase/functions/<name>/index.ts`; CI runs the same on every PR
  and push to main. Each function's pure helpers are `export`ed and
  pinned by a co-located `index.test.ts`.

When refactoring chart math, add a test pinning the formula's output
for the affected case so the YTD bugs (+80% / +21% / +9% misreports)
can't quietly come back. Same rule applies to Edge Function helpers
— extract the pure logic and pin it in `index.test.ts`.

## Storage

Persisted state lives under the `dp.*` namespace with a single schema
version (`Utils.Storage.migrate()`). When the data shape changes, bump
`CURRENT_SCHEMA_VERSION` in `src/utils.js` and add a migration step
instead of inventing a new key.

## Codex / PR review (legacy — currently unused)

Codex's `@codex` bot reviews PRs only, not direct commits to `main`.
With the current push-to-main workflow there's no automated review
— the human user catches issues via Cloudflare preview deploys and
real-world testing. If a future change re-introduces PRs, the old
"check Codex's `get_review_comments` before merging" rule applies again.
