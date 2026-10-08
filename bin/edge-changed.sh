#!/bin/sh
# The Edge Functions a push to main deploys, one name a line: edge-functions.yml's "Detect changed functions" step.
# Run from the repository's root with AFTER checked out, and the push's history in the clone (the workflow checks out
# with fetch-depth 0).
#
#   AFTER   the commit being deployed
#   BEFORE  the push's previous tip (40 zeros when the push created the branch)
#   LAST    the commit the last successful run of edge-functions.yml on main deployed, or empty
#
# Why LAST (review F8, 2026-10-08). The workflow cancels a run in progress when a newer push starts one
# (`cancel-in-progress`), and a run can fail before its deploy step. Diffing from the push's own BEFORE, the next run
# deployed only its own push's functions: those of the cancelled or failed push stayed on their old version, with CI
# green, until a later push happened to touch them. Diffing from LAST, the next run deploys everything that changed
# since a run last deployed in full. LAST is not used when the clone does not hold it (a history rewritten since) or
# when it is not behind AFTER (an old run re-run): then BEFORE, as before, with a warning.
#
# What changed decides what deploys:
#   * a top-level `_shared/` module: every function, since each bundles its imports at deploy (`_`-prefixed folders
#     are never functions themselves);
#   * otherwise every function with a changed file anywhere in its own folder, not only its index.ts: the deploy
#     bundles its sibling modules too, and matching index.ts alone once shipped a CORS header added to
#     `fundamentals/_shared.ts` everywhere but the function that serves it;
#   * test files and notes (`.test.ts`, `.md`) aside: a note is not bundled, and adding `agents/CLAUDE.md` once started
#     a redeploy of the agents function for nothing inside a pre-registered window (2026-10-03);
#   * a folder the push deleted is not a function to deploy. With no usable base at all, every function.
set -e

say() { echo "$*" >&2; }
every_function() {
  for d in supabase/functions/*/; do
    n=$(basename "$d")
    case "$n" in _*) ;; *) echo "$n" ;; esac
  done
}
holds() { [ -n "$1" ] && git cat-file -e "$1^{commit}" 2> /dev/null; }

base=""
if holds "$LAST" && git merge-base --is-ancestor "$LAST" "$AFTER" 2> /dev/null; then
  base=$LAST
  say "edge-changed: from $LAST, the commit the last successful run deployed"
else
  if [ -n "$LAST" ]; then
    say "::warning::edge-changed: the last successful run's commit $LAST is not behind this one in this clone; diffing from the push's before"
  else
    say "::warning::edge-changed: no last successful run found; diffing from the push's before"
  fi
  base=$BEFORE
fi

if [ "$base" = "0000000000000000000000000000000000000000" ] || ! holds "$base"; then
  say "edge-changed: no base commit to diff from: every function"
  every_function
  exit 0
fi

changed=$(git diff --name-only "$base" "$AFTER")
if echo "$changed" | grep -q '^supabase/functions/_'; then
  say "edge-changed: a shared module changed: every function"
  every_function
  exit 0
fi
# `[^_]` leaves the top-level `_shared/` to the branch above; `|| true` keeps a push with nothing deployable from
# failing the pipe.
echo "$changed" \
  | { grep '^supabase/functions/[^_][^/]*/' || true; } \
  | { grep -v '\.test\.ts$' || true; } \
  | { grep -v '\.md$' || true; } \
  | awk -F/ '{print $3}' \
  | sort -u \
  | while IFS= read -r fn; do
      if [ -d "supabase/functions/$fn" ]; then echo "$fn"; else say "edge-changed: $fn was deleted: nothing to deploy"; fi
    done
