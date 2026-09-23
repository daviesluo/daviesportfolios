#!/bin/sh
# One-time setup for a fresh clone or a rebuilt container. Safe to re-run.
#
# Everything here is per-clone git config or local files, which a new clone
# or a rebuilt container does not have. The ledger hook in particular is
# silently OFF until core.hooksPath points at bin/hooks. The commit identity
# is not set here: that is each person's own.
set -e
cd "$(git rev-parse --show-toplevel)"

git config core.hooksPath bin/hooks
git config --local ledger.path docs/LEDGER.md

npm ci

echo "set up: the ledger hook (bin/hooks), the ledger path, node_modules"
