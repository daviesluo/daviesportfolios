#!/bin/sh
# knip for the Edge Functions. knip reads only code under the folder that
# holds its package.json, and the web app's is src/, beside supabase/ rather
# than above it. So the functions are checked in a scratch copy with a
# throwaway manifest, against supabase/knip.json; nothing is written into the
# repository, and the report's paths read as they do in it.
set -e
ROOT="$(git rev-parse --show-toplevel)"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT
mkdir "$SCRATCH/supabase"
cp -R "$ROOT/supabase/functions" "$SCRATCH/supabase/"
cp "$ROOT/supabase/knip.json" "$SCRATCH/"
echo '{ "name": "edge-functions", "private": true }' > "$SCRATCH/package.json"
cd "$SCRATCH"
"$ROOT/src/node_modules/.bin/knip" --config knip.json
