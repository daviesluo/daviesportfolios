# Working on this repo

A few standing instructions for Claude Code sessions.

## PR workflow

- Each new feature / bug fix → its own branch + PR. Don't push directly to main.
- After opening a PR, wait for both Cloudflare Pages and `typecheck-and-build`
  CI checks to go green before merging.
- Keep commit messages focused on **why**, not **what**.

## Codex review monitoring

`@codex` reviews every PR. **Always check Codex's review comments before
merging** via:

```
mcp__github__pull_request_read method=get_review_comments pullNumber=N
```

Apply Codex's suggestions when:
- It identifies a real bug (race condition, off-by-one, type error,
  regression, etc.)
- The fix is small and the reasoning is correct.
- The change doesn't conflict with the user's stated design intent.

Skip Codex's suggestion when:
- It's a stylistic preference rather than a correctness issue.
- The behaviour Codex flagged was deliberate (e.g. fallback paths,
  no-op caching).
- The fix would require redesigning a feature the user already approved.

If a Codex finding is borderline, surface it to the user before merging
rather than silently dismissing.

## Edge Function deploys

Anything under `supabase/functions/*` is deployed manually by the user
(Supabase dashboard paste). When a PR changes an Edge Function:
1. Commit the new code.
2. Open the PR.
3. **Tell the user the new code so they can paste it before merging.**
4. Wait for the user to confirm deploy before merging.

## Testing

- `npm run typecheck` — tsc with `checkJs`, no type errors should slip through.
- `npm test` — vitest, currently covers the YTD chart math.
- `npm run build` — Vite production bundle, output to repo root.

When refactoring chart math, add a test pinning the formula's output for
the affected case so the YTD bugs (+80% / +21% / +9% misreports) can't
quietly come back.

## Storage

Persisted state lives under the `dp.*` namespace with a single schema
version (`Utils.Storage.migrate()`). When the data shape changes, bump
`CURRENT_SCHEMA_VERSION` in `src/utils.js` and add a migration step
instead of inventing a new key.
