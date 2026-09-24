#!/bin/sh
# Every gate CI runs, in CI's order, stopping at the first failure: check.yml
# first, then the Edge Function checks from edge-functions.yml. Run it before
# every push. check.yml also refuses a push that changes src/ without the
# rebuilt dist/, so commit the dist/ this build writes along with the change.
# The browser checks need Chromium: CI installs it; a container that ships
# its own sets PLAYWRIGHT_CHROMIUM_PATH.
set -e
ROOT="$(git rev-parse --show-toplevel)"

# A change made of Markdown alone (or the agents' instruction folders) cannot move
# the types, the lint, the bundle, the browser sweep or the perf matrix. The only
# checks that read Markdown are unit tests: docs_map.test.js reads docs/map.md and
# agents/jev_rows.test.ts a pre-registration under docs/agents/reviews/. So such a
# change, measured against origin/main (commits not yet pushed, edits and new
# files), runs the two test suites alone; anything else, or `--full`, runs every
# gate. CI runs every gate on the push either way.
docs_only() {
  [ "$1" = "--full" ] && return 1
  base="$(git -C "$ROOT" merge-base HEAD origin/main 2>/dev/null)" || return 1
  files="$( { git -C "$ROOT" diff --name-only "$base" HEAD; git -C "$ROOT" diff --name-only HEAD; git -C "$ROOT" ls-files --others --exclude-standard; } | sort -u)"
  [ -n "$files" ] || return 1
  ! printf '%s\n' "$files" | grep -v -E '\.(md|mdc)$|^\.claude/|^\.cursor/|^\.agents/' | grep -q .
}
if docs_only "$1"; then
  echo "Markdown-only change: running the unit tests, the checks that read Markdown (bin/gates.sh --full runs everything)"
  cd "$ROOT/src"
  npm test
  cd "$ROOT"
  npx --yes deno@1.46.3 test --allow-env supabase/functions/
  echo "all gates green (Markdown-only change)"
  exit 0
fi

# The ledger hook moved from hooks/ to bin/hooks on 2026-09-23. A clone that
# still points at the old folder runs no hook at all, and git says nothing.
if [ "$(git -C "$ROOT" config core.hooksPath)" != "bin/hooks" ]; then
  echo "warning: the ledger hook is off in this clone; run: sh bin/setup.sh" >&2
fi

# The web app: an npm project in src/.
cd "$ROOT/src"
npm run typecheck
npm run lint
npm test
npm run build
npm run verify:browser
npm run verify:perf
npx size-limit
npx knip
sh ../bin/knip-edge.sh
npm audit --audit-level=high --omit=dev

# The Edge Functions, on the Deno CI runs: edge-functions.yml asks for v1.x,
# whose last release is 1.46.3. A bare `npx deno` fetches Deno 2 instead.
cd "$ROOT"
npx --yes deno@1.46.3 check --quiet supabase/functions/
npx --yes deno@1.46.3 test --allow-env supabase/functions/

echo "all gates green"
