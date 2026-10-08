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
# `--full` runs every gate whatever changed. CI runs every gate on every push either way.
#
# `--quick` is a sub-agent's run (Davies, 2026-10-08: "如果不同agent都要跑所有gates的话可以一起就跑一个吗"): the same
# gates by what changed, less the bundle's line (build, browser sweep, perf matrix, size), the slow half. It ends
# "quick gates green", which is not leave to push: the agent commits and hands back, and the session landing a batch
# rebases every commit onto origin/main and runs this script once, without a flag, on the combined tree.
#
# Everything at once, each step's time printed (Davies, 2026-09-27: still slow; five and a half minutes before this):
# the checks that read the source, beside the bundle's own line — built, then everything that reads it at once: the
# browser sweep in shards, the perf matrix and the size budget. Nothing that reads the source reads dist/.
#
# The sweep's shards (Davies, 2026-10-01: "gates的运行还可以更快吗 还有没有可以一起并行跑的内容"): a run of the sweep is
# mostly waiting on its pages (a phone's alone: 222 s of wall time on 22 s of CPU), so it runs as several processes at
# once, each one viewport (`SWEEP_VIEWPORT`) and a group of the sweep's parts (`SWEEP_PART`; no check compares two
# processes), and a viewport's last shard runs every part its other shards leave out, so together they are always the
# whole sweep. Every process that serves the bundle takes a port the system has free (`SWEEP_PORT=0`, `PERF_PORT=0`):
# fixed ports collided whenever two gate runs, or a gate run and a sweep by hand, shared a machine.
set -e
ROOT="$(git rev-parse --show-toplevel)"
LOGS="$(mktemp -d)"
trap 'rm -rf "$LOGS"' EXIT

# One run at a time on a machine (Davies, 2026-10-08: "gates怎么又run的这么慢了"). Each run already fills the machine
# (four sweep shards, the perf matrix, the unit and Edge tests at once); with four worktrees' runs on four cores the
# load reached 48, every run took longer than queuing would have, and checks that wait on a page timed out at random.
# Every clone and worktree shares the one lock file, so a second run waits for the first and says so.
if command -v flock > /dev/null 2>&1; then
  exec 9> "${GATES_LOCK:-/tmp/daviesportfolios-gates.lock}"
  if ! flock -n 9; then
    echo "gates: another gate run holds this machine; waiting for it"
    w0=$(date +%s); flock 9; echo "gates: waited $(( $(date +%s) - w0 )) s"
  fi
fi

# The ledger hook moved from hooks/ to bin/hooks on 2026-09-23. A clone that still points at the old folder runs no
# hook at all, and git says nothing.
case "$(git -C "$ROOT" config core.hooksPath)" in
  bin/hooks|"$ROOT/bin/hooks") ;;
  *) echo "warning: the ledger hook is off in this clone; run: sh bin/setup.sh" >&2 ;;
esac

quick=0
[ "$1" = "--quick" ] && { quick=1; shift; }
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
echo "gates: web=$web edge=$edge unit=$unit edge-tests=$deno ($( [ "$1" = "--full" ] && echo "--full" || echo "by what changed; --full runs every gate"))$( [ "$quick" = 1 ] && echo " --quick: no bundle, sweep, perf or size")"

# Runs its steps at once, each "name|command" from src/, and fails if any fails, printing that step's output. Each
# step's seconds are printed beside it, so the slowest one is plain.
together() {
  pids=""
  for step in "$@"; do
    name="${step%%|*}"
    # `_step` keeps the step's name: a step that is itself a `together` (the bundle's) reuses `name` in its own loop.
    ( _step="$name"; t0=$(date +%s); cd "$ROOT/src" && eval "${step#*|}"; rc=$?; echo $(( $(date +%s) - t0 )) > "$LOGS/$_step.secs"; exit $rc ) > "$LOGS/$name.log" 2>&1 &
    pids="$pids $!:$name"
  done
  failed=""
  for p in $pids; do
    n="${p#*:}"
    if wait "${p%%:*}"; then
      echo "ok   $n ($(cat "$LOGS/$n.secs" 2>/dev/null || echo ?) s)$(grep -h '^ALL GREEN' "$LOGS/$n.log" 2>/dev/null | tail -1 | sed 's/^/ /')"
      # A step that is itself a `together` (the bundle's) lists its own steps under it.
      grep -h '^ok   ' "$LOGS/$n.log" 2>/dev/null | sed 's/^/  /' || true
    else echo "FAIL $n"; cat "$LOGS/$n.log"; failed=1; fi
  done
  [ -z "$failed" ]
}

EDGE_CHECK="edge-check|cd .. && npx --yes deno@1.46.3 check --quiet supabase/functions/"
# Deno 1.x, as CI's setup-deno v1.x: its last release is 1.46.3. A bare `npx deno` fetches Deno 2 instead.
EDGE_TEST="edge-test|cd .. && npx --yes deno@1.46.3 test --allow-env supabase/functions/"

# One viewport's sweep shards, a "name|command" line each: a process for each group of parts given, and one for every
# part those leave out (`SWEEP_PART=-a,-b`), so a part added to the sweep later runs without a change here.
sweep_shards() {
  vp=$1; shift; others=""
  for g in "$@"; do
    echo "sweep-$vp-${g%%,*}|SWEEP_VIEWPORT=$vp SWEEP_PART=$g SWEEP_PORT=0 node e2e/app-sweep.mjs ../dist"
    others="$others,-$(echo "$g" | sed 's/,/,-/g')"
  done
  echo "sweep-$vp-rest|SWEEP_VIEWPORT=$vp SWEEP_PART=${others#,} SWEEP_PORT=0 node e2e/app-sweep.mjs ../dist"
}

# The bundle's line: built, then everything that reads it at once. It runs as one step beside the source checks.
bundle() {
  t=$(date +%s)
  npm run build > "$LOGS/build.log" 2>&1 || { echo "FAIL build"; cat "$LOGS/build.log"; return 1; }
  echo "ok   build ($(( $(date +%s) - t )) s)"
  # Two shards a viewport, by each part's seconds on an idle 4-core machine (2026-10-01): `main`, sections 1–8 on one
  # page, ~65 s at either width, and the rest ~35 s.
  shards="$(sweep_shards desktop main; sweep_shards phone main)"
  set --
  while IFS= read -r s; do set -- "$@" "$s"; done <<EOF
$shards
EOF
  together "$@" "perf|PERF_PORT=0 npm run verify:perf" "size|npx size-limit"
}

T0=$(date +%s)
set -- "unit|npm test"
[ "$web" = 1 ] && [ "$quick" = 0 ] && set -- "$@" "bundle|bundle"
[ "$web" = 1 ] && set -- "$@" "typecheck|npm run typecheck" "lint|npm run lint" "knip|npx knip" \
  "audit|npm audit --audit-level=high --omit=dev"
[ "$edge" = 1 ] && set -- "$@" "$EDGE_CHECK" "$EDGE_TEST" "knip-edge|sh ../bin/knip-edge.sh"
[ "$deno" = 1 ] && set -- "$@" "$EDGE_TEST"
# Two steps fetching Deno at once into npx's cache can trip on each other in a fresh container: fetch it once first.
case "$*" in *deno@*) npx --yes deno@1.46.3 --version > /dev/null ;; esac
together "$@"

if [ "$quick" = 1 ]; then
  echo "quick gates green ($(( $(date +%s) - T0 )) s): not leave to push; the landing run is sh bin/gates.sh on the batch"
else
  echo "all gates green ($(( $(date +%s) - T0 )) s)"
fi
