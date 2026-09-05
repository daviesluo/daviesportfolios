#!/bin/sh
# Copyright 2026 Zheng Luo (Davies Luo). Licensed under the Apache License
# 2.0, whose text is the LICENSE file in this package. Keep this notice
# when you copy the script.
#
# Self-test for the pre-commit hook in SKILL.md.
#
# It extracts the hook FROM SKILL.md itself, installs it in a throwaway
# repository and exercises both gates and every escape hatch, so the test
# can never drift from the document it is testing. Run it after any edit
# to the hook, and on a new platform before trusting it there.
#
#   sh selftest.sh            # from this folder
#
# Needs: sh, git, awk, sed. Takes a few seconds. Writes only inside a
# temporary directory it removes on exit.

set -e
HERE=$(cd "$(dirname "$0")" && pwd)
# the protocol sits at the package root and this script sits in bin/ beside
# it, so look one level up first and then beside, which keeps working if
# somebody puts the script back at the root
for c in "$HERE/../SKILL.md" "$HERE/SKILL.md"; do
  [ -f "$c" ] && { SKILL=$c; break; }
done
[ -n "${SKILL:-}" ] || { echo "SKILL.md is neither above this script nor beside it"; exit 1; }

T=$(mktemp -d) || exit 1
# AND THE OPERATOR'S OWN GIT CONFIG STAYS OUT OF THIS RUN. Measured here: a
# machine carrying `commit.gpgsign true` in its global config sent every
# throwaway repository this suite creates through a signing service, and one
# 503 from that service killed the run mid-case with no totals line. Nothing
# under test has anything to do with the operator's identity, signing, default
# branch name or aliases, and a suite that answers to them is not the same
# suite on two machines. HOME points at the throwaway tree, so there is no
# ~/.gitconfig to read, and NOSYSTEM drops /etc/gitconfig as well. Every tool
# run from here is git, sh, awk, sed and this package's own scripts, none of
# which reads HOME, and the rehearsal cases push only to bare repositories
# created inside $T, so no credential is wanted either.
HOME=$T; export HOME
GIT_CONFIG_NOSYSTEM=1; export GIT_CONFIG_NOSYSTEM
# AND HOME IS NOT THE ONLY PLACE GIT LOOKS. It also reads
# $XDG_CONFIG_HOME/git/config, which survived the two lines above, and it obeys
# GIT_CONFIG_GLOBAL and the GIT_CONFIG_COUNT injection vars outright. Measured
# by the Codex seat against the first version of this block: an XDG config
# carrying commit.gpgsign and a failing signer stopped this suite before case
# one at status 128, which is the exact failure the block claims to prevent.
XDG_CONFIG_HOME=$T/xdg; export XDG_CONFIG_HOME
unset GIT_CONFIG_GLOBAL GIT_CONFIG_SYSTEM GIT_CONFIG_COUNT GIT_CONFIG GIT_CONFIG_PARAMETERS 2>/dev/null || true
i=0; while [ "$i" -lt 32 ]; do unset "GIT_CONFIG_KEY_$i" "GIT_CONFIG_VALUE_$i" 2>/dev/null || true; i=$((i + 1)); done
trap 'rm -rf "$T"' EXIT INT TERM
pass=0; fail=0
ok()  { pass=$((pass+1)); echo "  ok   $1"; }
bad() { fail=$((fail+1)); echo "  FAIL $1"; }
# blocked <label> <command...>: the commit must be refused
blocked() { l=$1; shift; if "$@" >"$T/out" 2>&1; then bad "$l (the commit went through)";
            else ok "$l"; fi; }
allowed() { l=$1; shift; if "$@" >"$T/out" 2>&1; then ok "$l";
            else bad "$l (blocked: $(head -3 "$T/out" | tr '\n' ' '))"; fi; }
says()    { if grep -q "$2" "$T/out"; then ok "$1"; else bad "$1"; fi; }

# the parentheses around the redirection target are REQUIRED: BSD awk, which
# is /usr/bin/awk on macOS, rejects `print > T"/x"` as a syntax error and the
# whole suite dies before its first assertion. gawk and mawk accept it, so
# this only ever fails for the reader and never for the author.
awk -v T="$T" '/^```(bash|sh)$/{inb=1; next} /^```$/{inb=0; next}
     inb {print > (T "/pre-commit")}' "$SKILL"
[ -s "$T/pre-commit" ] || { echo "could not extract the hook from SKILL.md"; exit 1; }
sed -i.bak 's|<ledger>|LEDGER.md|' "$T/pre-commit"
sh -n "$T/pre-commit" || { echo "the hook does not parse"; exit 1; }
chmod +x "$T/pre-commit"
echo "extracted the hook from SKILL.md, it parses"

export GIT_AUTHOR_NAME=selftest GIT_AUTHOR_EMAIL=selftest@example.invalid
export GIT_COMMITTER_NAME=selftest GIT_COMMITTER_EMAIL=selftest@example.invalid
mkdir -p "$T/hooks" && cp "$T/pre-commit" "$T/hooks/pre-commit"
cd "$T"; git init -q repo; cd "$T/repo"; git config core.hooksPath "$T/hooks"
HDR='### [2026-08-25 12:00 UTC] Platform: Claude | Model: opus5'

echo "1. the very first commit, with no ledger anywhere"
echo work > a.txt; git add a.txt
allowed "the root commit is exempt, there is no previous commit to check" git commit -qm root

echo "2. work alone, with no ledger in the repository at all"
echo more >> a.txt; git add a.txt
blocked "refuses the commit" git commit -qm work
says    "says the ledger does not exist" "does not exist in this"

echo "3. work with its ledger line"
printf '# Ledger\n\n%s\n\nStarted.\n' "$HDR" > LEDGER.md; git add -A
allowed "goes through" git commit -qm 'work and ledger'

echo "4. work alone, one commit after the ledger moved"
echo again >> a.txt; git add a.txt
allowed "one commit of slack is deliberate" git commit -qm 'work, slack'

echo "5. work alone, two commits after the ledger moved"
echo third >> a.txt; git add a.txt
blocked "refuses the commit" git commit -qm 'work, no ledger'
says    "says the ledger is two commits behind" "two commits behind"

echo "6. the escape hatch for a commit that records nothing"
allowed "LEDGER_OK=1 lets it through" env LEDGER_OK=1 git commit -qm 'trivial'

echo "7. a staged deletion of the ledger does not count as carrying it"
git rm -q LEDGER.md; echo x >> a.txt; git add a.txt
blocked "refuses the commit" git commit -qm 'delete the ledger with work'
git checkout -- . 2>/dev/null || true; git reset -q --hard HEAD

echo "8. a merge commit"
# pad the ledger first, so the two branches edit regions far enough apart
# that git merges them cleanly and the hook is what decides the outcome
i=1; while [ $i -le 40 ]; do echo "filler line $i" >> LEDGER.md; i=$((i+1)); done
git add -A; git commit -qm pad
git checkout -qb side; echo s > s.txt
printf '\n%s\n\nSide.\n' "$HDR" >> LEDGER.md; git add -A; git commit -qm side
git checkout -q -; echo m > m.txt
awk -v h="$HDR" 'NR==1{print; print ""; print h; print ""; print "Main."; next} {print}' \
  LEDGER.md > "$T/led" && mv "$T/led" LEDGER.md
git add -A; git commit -qm main
allowed "merges are exempt, the gate cannot ask a merge to invent a line" git merge -q --no-edit side

echo "9. gate two, a new deep heading that is not a source header"
printf '\n### Some notes\n\nText.\n' >> LEDGER.md; git add LEDGER.md
blocked "refuses the commit" git commit -qm 'bad heading'
says    "names the required shape" "not a source header"
# AND NAMES THE TWO ORDINARY REASONS TO MEET IT WITHOUT HAVING WRITTEN A BAD
# HEADER, because this gate has no hatch by design and a refusal with no route
# is the shortest path to --no-verify. Both answers were already in the
# installation notes and neither was in the message.
says    "and says a fenced template trips it, since the gate cannot see fences" \
        "markdown fences"
says    "and sends a titled subheading of the reader's own deeper" \
        "four hashes or deeper"
git checkout -q -- LEDGER.md

echo "10. gate two, a well-formed source header"
printf '\n%s\n\nText.\n' "$HDR" >> LEDGER.md; git add LEDGER.md
allowed "goes through" git commit -qm 'good heading'

echo "11. gate two, a subheading inside a section that opens with a good header"
printf '\n%s\n\n#### A titled subheading\n\nText.\n' "$HDR" >> LEDGER.md; git add LEDGER.md
allowed "titled subheadings are allowed beside a good header" git commit -qm 'header and subheading'

echo "11b. a titled subheading committed on its own"
printf '\n#### A subheading with no new section\n\nNotes.\n' >> LEDGER.md; git add LEDGER.md
allowed "deeper headings are none of gate two's business" git commit -qm 'subheading alone'

echo "12. a ledger-only commit"
printf '\nOne more line.\n' >> LEDGER.md; git add LEDGER.md
allowed "the ledger may always move on its own" git commit -qm 'ledger only'

echo "13. a clone that owns a different ledger, the composed case"
git config ledger.path OWN_LEDGER.md
echo w > z.txt; git add z.txt
blocked "the gate now asks for the ledger this clone owns" git commit -qm 'work, wrong ledger'
says    "names the clone's own ledger" "OWN_LEDGER.md does not exist"
printf '# Own\n\n%s\n\nMine.\n' "$HDR" > OWN_LEDGER.md; git add -A
allowed "and is satisfied by it" git commit -qm 'work and own ledger'
git config --unset ledger.path

echo "14. the shipped pointers have not drifted from the protocol"
# THE POINTER LAYOUT'S ONE PROMISE is that there is exactly one copy of the
# protocol, so nothing can go stale against anything else. The front matter
# is the exception it cannot keep by construction: each pointer carries its
# own copy, and a tool lists the skill by what the POINTER says. Edit the
# description in SKILL.md and the pointers silently describe the old one.
# That happened within an hour of the description being edited.
R=$(cd "$HERE/.." && pwd)
fm(){ awk 'NR==1&&$0!="---"{exit} NR==1{next} /^---$/{exit} {print}' "$1"; }
drift=0; found=0
for q in "$R/.agents/skills/ledger/SKILL.md" "$R/.claude/skills/ledger/SKILL.md"; do
  [ -f "$q" ] || continue
  found=$((found+1))
  [ "$(fm "$q")" = "$(fm "$R/SKILL.md")" ] || { drift=$((drift+1)); echo "     drifted: $q"; }
done
if [ "$found" = 0 ]; then ok "no shipped pointers in this install, nothing to drift"
elif [ "$drift" = 0 ]; then ok "every pointer's front matter matches SKILL.md, all $found of them"
else bad "$drift of $found pointers describe a protocol that has moved on"; fi
miss=0
for q in "$R/.agents/skills/ledger/SKILL.md" "$R/.claude/skills/ledger/SKILL.md"; do
  [ -f "$q" ] || continue
  grep -q '\.\./\.\./\.\./SKILL\.md' "$q" || { miss=$((miss+1)); echo "     no path to the canonical file: $q"; }
done
if [ "$miss" = 0 ]; then ok "and each one names ../../../SKILL.md, the file it stands for"
else bad "$miss pointers do not name the file they point at"; fi

echo "15. renaming the ledger, which costs one refusal and one config line"
# the rename leaves the old path absent, so the gate stops and says so; once
# the hook is repointed, the rename reads as an addition at the new path and
# the commit carries its own ledger. The first draft of the protocol
# prescribed LEDGER_OK=1 here, a hatch nothing called for, and running the
# recipe instead of believing it is what caught that.
git mv LEDGER.md RECORD.md
echo r >> a.txt; git add a.txt
blocked "before repointing, the rename is refused" git commit -qm 'rename, not repointed'
says    "and the message says to repoint and repeat" "repeat this commit"
if grep -q "LEDGER_OK" "$T/out"; then
  bad "the refusal prescribes the hatch where none is needed"
else
  ok "and prescribes no hatch, which nothing here calls for"
fi
git config ledger.path RECORD.md
allowed "repointed, the rename commit carries its own ledger" git commit -qm 'rename the ledger'

echo "16. amending the commit that was riding the slack"
# pre-commit cannot tell an amend from a fresh commit, so it reads the ledger
# as two commits back; the documented answer is the same hatch
printf '\nMore.\n' >> RECORD.md; git add RECORD.md
allowed "a ledger move sets up the slack" git commit -qm 'ledger moves'
echo s16 >> a.txt; git add a.txt
allowed "work alone rides the slack" git commit -qm 'work, slack'
echo s16b >> a.txt; git add a.txt
blocked "amending that commit reads the ledger as two commits back" \
        git commit -q --amend -m 'work, slack, amended'
# AND THE REFUSAL HAS TO NAME THIS CASE, which is the whole reason it is not a
# defect. Driven by the review seat against fifty operations: the message used
# to offer one route, conditioned on the commit recording nothing a later
# session would need, which does not describe somebody amending to ADD work.
# The word amend appeared in it zero times, and the next thing that person
# reaches for is --no-verify, which this protocol exists to prevent.
says "and the refusal names the amend, so the reader is not sent to --no-verify" \
     "AMEND"
says "and names the hatch by the exact string to type" "LEDGER_OK=1 git commit"
allowed "and the documented hatch is LEDGER_OK on the amend" \
        env LEDGER_OK=1 git commit -q --amend -m 'work, slack, amended'

echo "17. a clone whose ledger is named in non-ASCII"
# git prints such a name escaped unless quotePath is off, and an escaped name
# matches nothing it is compared against, so the hook reads the diff with
# quotePath off; this case holds the whole path, both gates, either way
git config ledger.path 记录.md
echo w17 >> a.txt; git add a.txt
blocked "the gate asks for the ledger this clone owns, in its own alphabet" \
        git commit -qm 'work, ledger not created yet'
says    "and names it unescaped" "记录.md does not exist"
printf '# 记录\n\n%s\n\nStart.\n' "$HDR" > 记录.md; git add -A
allowed "work carrying the non-ASCII ledger goes through" git commit -qm 'work and ledger'
# the one-commit allowance is the one path where the ledger's name meets a
# text comparison against diff-tree output, and the flag was missing there:
# a ledger named outside ASCII was refused the slack the protocol grants,
# with a message calling it two commits behind when it was one
echo w17b >> a.txt; git add a.txt
allowed "and work alone one commit later, the allowance in the clone's own alphabet" \
        git commit -qm 'work, slack'
# a no-op when the commit above landed; on a hook that wrongly refused it,
# drop the leftover staged work so the assertions below stay independent
git reset -q -- a.txt; git checkout -q -- a.txt
printf '\n### Not a header\n\n' >> 记录.md; git add 记录.md
blocked "and gate two still reads its diff" git commit -qm 'bad heading'
says    "names the required shape" "not a source header"
git reset -q -- 记录.md; git checkout -q -- 记录.md
# the deletion of the ledger ALONE must commit exactly as it would under an
# ASCII name: this is the one corner where the hook's quotePath guard is
# load-bearing, since an escaped name in the changed list would otherwise
# read as substantive work beside a ledger the index no longer carries
git rm -q 记录.md
allowed "and a deletion of the ledger alone commits, as an ASCII name would" \
        git commit -qm 'retire the ledger'
git config --unset ledger.path

echo "18. the README's install recipe and this suite extract the same hook"
# the suite pulls the hook from the fenced block and the README teaches a
# five-command sed recipe over shebang and exit markers; a second shell fence
# or a stray shebang line in SKILL.md would hand readers a different hook
# than the one this suite just tested
sed -n '/^#!\/bin\/sh$/,/^exit 0$/p' "$SKILL" | sed 's|<ledger>|LEDGER.md|' > "$T/pre-commit.readme"
if cmp -s "$T/pre-commit" "$T/pre-commit.readme"; then
  ok "byte for byte the same hook from both recipes"
else bad "the two extractions differ, so the README hands out an untested hook"; fi

echo
echo "19. a clone still carrying the key's old name is told, not silently retargeted"
# REV-F76: the key lives in each clone, so renaming it here reaches none of
# them. A clone that had set the old name fell back to the project default,
# and the gates then guarded a file that clone does not own, which is the one
# thing the per-clone key exists to prevent. The hook refuses instead.
cd "$T/repo"
git config --local --unset ledger.path 2>/dev/null || true
# THE SCENARIO THAT FLIPS. The clone owns OUTBOX_seat.md and says so under the
# old name alone. Touching the DEFAULT ledger and not its own used to satisfy
# the old hook completely: it read the default, saw it move, and allowed the
# commit while the file this clone actually owns went ungated. A first
# assertion that merely blocked would have passed on that hook too, since a
# work-only commit is refused either way for the ordinary reason.
git config --local relay.ledger OUTBOX_seat.md
printf '# seat ledger\n' > OUTBOX_seat.md; git add OUTBOX_seat.md
git commit -qm "seed the seat ledger" >/dev/null 2>&1 || git commit -q --no-verify -m "seed the seat ledger"
echo w19 >> a.txt; printf '\n- unrelated\n' >> LEDGER.md; git add -A
blocked "a commit that moves the default ledger and not this clone's own is refused" \
        git commit -qm "work with the old key still set"
says "and it names the command that fixes it" "git config --local ledger.path"
# AND THE COMMAND IT NAMES RUNS, ON A PATH WITH A SPACE AND AN APOSTROPHE.
# Unquoted, the advice migrated `Seat Ledger.md` as `Seat` and failed outright
# on an apostrophe, so it broke exactly the clones least like the author's.
git config --local --unset relay.ledger
git config --local relay.ledger "Seat's Ledger.md"
git commit -qm "probe" 2>"$T/out" || true
cmd=$(sed -n 's/.*Run: //p' "$T/out" | head -1)
# THE COMMAND MUST SUCCEED, and masking it with `|| true` passed a printed
# command followed by a failure. Two independently chosen difficult paths,
# because hardcoding one of them passed as well.
mrc=0; ( eval "$cmd" ) >/dev/null 2>&1 || mrc=$?
if [ "$mrc" = 0 ] && [ "$(git config --local ledger.path)" = "Seat's Ledger.md" ]; then
  ok "and running that command verbatim migrates a path holding a space and an apostrophe"
else
  bad "the printed command exited $mrc and left ledger.path as [$(git config --local ledger.path)] rather than [Seat's Ledger.md]"
fi
git config --local --unset ledger.path
git config --local --unset relay.ledger
git config --local relay.ledger 'a b "c".md'
echo w19b >> a.txt; printf '\n- unrelated\n' >> LEDGER.md; git add -A
git commit -qm "second difficult path" 2>"$T/out2" || true
cmd2=$(sed -n 's/.*Run: //p' "$T/out2" | head -1)
mrc2=0; ( eval "$cmd2" ) >/dev/null 2>&1 || mrc2=$?
if [ "$mrc2" = 0 ] && [ "$(git config --local ledger.path)" = 'a b "c".md' ]; then
  ok "and a second, differently awkward path migrates too, so the advice is not hardcoded"
else
  bad "the second path exited $mrc2 and migrated as [$(git config --local ledger.path)]"
fi
# AND MIGRATING DOES NOT OPEN THE GATES. A build that let every commit through
# whenever both keys were present passed the whole suite.
blocked "a work-only commit is still refused once both keys exist" \
        git commit -qm "work after migration, no ledger"
git config --local --unset ledger.path
git config --local --unset relay.ledger
git config --local relay.ledger OUTBOX_seat.md
git config --local ledger.path LEDGER.md
printf '\n- w19\n' >> LEDGER.md; git add -A
allowed "and setting the new name lets the same commit through" \
        git commit -qm "work and its ledger"
git config --local --unset relay.ledger

echo
echo "$pass passed, $fail failed"
[ "$fail" = 0 ] || exit 1
