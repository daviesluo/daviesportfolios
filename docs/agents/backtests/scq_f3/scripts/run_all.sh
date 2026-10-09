#!/bin/sh
# Every arm of F3's replay (scripts/replay.ts), four at a time: three sizes (pr5 £100, p50 £50, s10 LIVE's £10 a rung),
# four exits (at fair; one and two ticks beyond; one tick, back to fair after 60 minutes), two fill assumptions.
# About 12 minutes a run on a busy four-core machine. Then: python3 -I scripts/analyze.py
#   sh scripts/run_all.sh [gen dir] [names to skip...]
set -e
HERE=$(cd "$(dirname "$0")/.." && pwd)
GEN=${1:-${TMPDIR:-/tmp}/scq_f3_gen}
[ $# -gt 0 ] && shift
python3 -I "$HERE/scripts/patch.py" "$GEN" >/dev/null
for twin in pr5 p50 s10; do for fill in through at; do
  for arm in "0 -" "1 -" "2 -" "1 60"; do
    set -- $arm
    off=$1; fb=$2
    name="${twin}_o${off}_${fill}"; [ "$fb" != "-" ] && name="${twin}_o${off}fb${fb}_${fill}"
    [ -f "$HERE/results/runs/$name.json.gz" ] && continue
    echo "$name $twin $off $fill $fb"
  done
done; done | xargs -P 4 -L 1 sh -c 'cd "$0" && npx --yes deno@1.46.3 run --allow-read --allow-write --allow-env --no-check --import-map="$1/import_map.json" scripts/replay.ts "$2" "$3" "$4" "$5" "$6" > "$1/$2.log" 2>&1 && tail -1 "$1/$2.log" || echo "FAILED $2"' "$HERE" "$GEN"
