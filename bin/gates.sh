#!/bin/sh
# Every gate CI runs, stopping at the first failure: check.yml's, then the Edge Function checks from
# edge-functions.yml. Run it before every push. check.yml also refuses a push that changes src/ without the rebuilt
# dist/, so commit the dist/ this build writes along with the change. The browser checks need Chromium: CI installs
# it; a container that ships its own sets PLAYWRIGHT_CHROMIUM_PATH.
#
# It runs the gates the change can break, not every gate every time (Davies, 2026-09-27: the full run had grown to
# twelve minutes). The change is everything against origin/main: commits not yet pushed, edits and new files.
#   * src/ or dist/                       the web app's gates, every one (types, lint, unit tests, bundle, the browser
#                                         sweep, the perf matrix, size, dead code, audit)
#   * supabase/functions/                 the Edge Functions' (deno check and test, their dead code) and the unit tests
#   * supabase/migrations/                the unit tests (cron_jobs.test.js replays the migrations' cron calls)
#   * docs/, Markdown, the agents' folders the unit tests and the Edge tests (docs_map.test.js reads docs/map.md; Edge
#                                         tests read pre-registrations and golden fixtures under docs/agents/)
#   * anything else (bin/, .github/, the root's config) every gate
# `--full` runs every gate whatever changed. CI runs every gate on every push either way. Checks that do not depend on
# each other run at once; the browser sweep runs alone, because some of its checks are timed.
set -e
ROOT="$(git rev-parse --show-toplevel)"
LOGS="$(mktemp -d)"
trap 'rm -rf "$LOGS"' EXIT

# The ledger hook moved from hooks/ to bin/hooks on 2026-09-23. A clone that still points at the old folder runs no
# hook at all, and git says nothing.
case "$(git -C "$ROOT" config core.hooksPath)" in
  bin/hooks|"$ROOT/bin/hooks") ;;
  *) echo "warning: the ledger hook is off in this clone; run: sh bin/setup.sh" >&2 ;;
esac

web=0 edge=0 unit=0 deno=0
if [ "$1" = "--full" ]; then
  web=1 edge=1
else
  base="$(git -C "$ROOT" merge-base HEAD origin/main 2>/dev/null)" || base=""
  files=""
  [ -n "$base" ] && files="$( { git -C "$ROOT" diff --name-only "$base" HEAD; git -C "$ROOT" diff --name-only HEAD; git -C "$ROOT" ls-files --others --exclude-standard; } | sort -u)"
  if [ -z "$base" ] || [ -z "$files" ]; then
    web=1 edge=1
  else
    while IFS= read -r f; do
      case "$f" in
        src/*|dist/*) web=1 ;;
        supabase/functions/*) edge=1; unit=1 ;;
        supabase/migrations/*) unit=1 ;;
        docs/*|*.md|*.mdc|.claude/*|.cursor/*|.agents/*) unit=1; deno=1 ;;
        *) web=1; edge=1 ;;
      esac
    done <<EOF
$files
EOF
  fi
fi
[ "$web" = 1 ] && unit=0          # the web gates run the unit tests themselves
[ "$edge" = 1 ] && deno=0         # the Edge gates run the Edge tests themselves
echo "gates: web=$web edge=$edge unit=$unit edge-tests=$deno ($( [ "$1" = "--full" ] && echo "--full" || echo "by what changed; --full runs every gate"))"

# Runs its steps at once, each "name|command" from src/, and fails if any fails, printing that step's output.
together() {
  pids=""
  for step in "$@"; do
    name="${step%%|*}"
    ( cd "$ROOT/src" && eval "${step#*|}" ) > "$LOGS/$name.log" 2>&1 &
    pids="$pids $!:$name"
  done
  failed=""
  for p in $pids; do
    if wait "${p%%:*}"; then echo "ok   ${p#*:}"; else echo "FAIL ${p#*:}"; cat "$LOGS/${p#*:}.log"; failed=1; fi
  done
  [ -z "$failed" ]
}

EDGE_CHECK="edge-check|cd .. && npx --yes deno@1.46.3 check --quiet supabase/functions/"
# Deno 1.x, as CI's setup-deno v1.x: its last release is 1.46.3. A bare `npx deno` fetches Deno 2 instead.
EDGE_TEST="edge-test|cd .. && npx --yes deno@1.46.3 test --allow-env supabase/functions/"

# The first round: every static check the change needs, at once.
set -- "unit|npm test"
[ "$web" = 1 ] && set -- "$@" "typecheck|npm run typecheck" "lint|npm run lint"
[ "$edge" = 1 ] && set -- "$@" "$EDGE_CHECK" "$EDGE_TEST" "knip-edge|sh ../bin/knip-edge.sh"
[ "$deno" = 1 ] && set -- "$@" "$EDGE_TEST"
# Two steps fetching Deno at once into npx's cache can trip on each other in a fresh container: fetch it once first.
case "$*" in *deno@*) npx --yes deno@1.46.3 --version > /dev/null ;; esac
together "$@"

# The web app's bundle and what reads it: the sweep alone, then the rest at once.
if [ "$web" = 1 ]; then
  (cd "$ROOT/src" && npm run build)
  (cd "$ROOT/src" && npm run verify:browser)
  together "perf|npm run verify:perf" "size|npx size-limit" "knip|npx knip" "audit|npm audit --audit-level=high --omit=dev"
fi

echo "all gates green"
