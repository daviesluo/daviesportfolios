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

Anything under `supabase/functions/*` does NOT auto-deploy from this
repo — the user pastes the new code into the Supabase dashboard
manually. When a commit changes an Edge Function:
1. Commit + push as usual.
2. Print the full new file contents in the chat so the user can paste
   it into the dashboard.
3. Wait for the user to confirm the deploy before relying on the new
   server-side behavior in client code.

## Testing

- `npm run typecheck` — tsc with `checkJs`, no type errors should slip through.
- `npm test` — vitest. Currently covers YTD chart math + key
  fetch/proxy paths; add a pin test whenever a regression is fixed so
  the bug can't quietly come back.
- `npm run build` — Vite production bundle, output to repo root.

When refactoring chart math, add a test pinning the formula's output
for the affected case so the YTD bugs (+80% / +21% / +9% misreports)
can't quietly come back.

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
