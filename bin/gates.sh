#!/bin/sh
# Every gate CI runs, in CI's order, stopping at the first failure: check.yml
# first, then the Edge Function checks from edge-functions.yml. Run it before
# every push. check.yml also refuses a push that changes src/ without the
# rebuilt dist/, so commit the dist/ this build writes along with the change.
# The browser checks need Chromium: CI installs it; a container that ships
# its own sets PLAYWRIGHT_CHROMIUM_PATH.
set -e
ROOT="$(git rev-parse --show-toplevel)"

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

# The Edge Functions.
cd "$ROOT"
npx deno check --quiet supabase/functions/
npx deno test --allow-env supabase/functions/

echo "all gates green"
