---
name: ledger
description: >-
  Task continuity across AI platforms and sessions through one live
  ledger in the repository. Load this when a task may outlive the
  session working on it, when usage limits can cut a platform off mid
  task, or when several platforms take turns on one piece of work: it
  defines the ledger file, the rule that keeps it current in the same
  commit as the work, the git hook that enforces both, the platform
  source headers that record who did what, and the resume ritual that
  lets the next session, on any tool, continue from the repository
  alone. Works on Claude Code, Cursor, Codex or any tool with a shell
  and git.
---

# The ledger protocol: one task, many sessions, no lost baton

Copyright 2026 Zheng Luo (Davies Luo). Licensed under the Apache
License 2.0, whose text is the LICENSE file beside this one. Keep
this line when you copy the file.

Version 1.0, September 2026. Copies of this file drift once they are
pasted into other repositories, so check this line against the
source, https://github.com/daviesluo/ledger-skill, before
trusting a copy you did not install yourself.

A session working on a long task can end at any moment, and not
politely: a usage limit lands mid edit, a container is reclaimed, a
context window fills, a machine goes away. Whatever survives is what
was pushed. This protocol makes the pushed state always sufficient:
any session, on any platform, resumes the task from the repository
alone, with no access to the dead session's context and no person
re-explaining what was happening.

The whole mechanism is one file and one rule. The FILE is a live
ledger in the repository. The RULE is that the ledger moves with the
work, in the same commit or the very next one, so there is never a
window in which the work is ahead of the record. Everything else
here, the hook, the headers, the resume ritual, the cliff drill,
exists to keep that rule cheap and to make breaking it loud.

## 1. The ledger

One markdown file, committed, on the branch the work lands on. Call
it what the repository likes. This file writes `<ledger>` wherever
the path appears, and `LEDGER.md` at the repository root is a fine
default. It has three parts, in this order.

**What remains right now.** The top of the file is the live half: a
numbered list of exactly what is left, in execution order, each item
concrete enough to start without asking anything. A resuming session
reads this first and works down it. Keep it CURRENT rather than append-only:
when an item completes, it moves into the history below with its
commit hash. When the plan changes, the list is rewritten. State
here, not in anyone's head, and never only in a chat window.

**Machine and platform setup.** What a fresh environment must
re-assert before working: the commit identity, the hook path, the
tools to reinstall, the configuration that a rebuilt container or a
different platform silently loses. Write it as commands to run rather than
descriptions. This section exists because environments reset and the
session that discovers it is never the one that knew the fix.

**The history, newest first.** Dated sections recording what
happened: what was done, WHY, which commits carry it, what was
decided and on what grounds, what is still at risk. Decisions the
user made are archived in their words. Numbers, hashes and filenames
are exact, because the reader may have nothing else, and every entry
that closes a sitting names the branch and the last pushed commit, so
the resume ritual has a recorded state to verify against. This half is
append-only in spirit: a completed section stays as written, and a
newer section above supersedes it.

Each history section OPENS WITH A SOURCE HEADER naming when, which
platform and which model wrote it:

```
### [2026-08-22 17:40 UTC] Platform: Claude | Model: opus max
```

The header is what makes a multi-platform trail auditable: months
later it still says which tool did which stage, which platform's work
a defect traces to, and where the budget went. The hook below
enforces its presence and its shape.

**Archiving closed operations.** A ledger read on every resume must stay
small: every platform pays context for it again on every wake, and a live
file that reaches tens of thousands of tokens taxes the whole team (one
real ledger measured 55,000 tokens and was cut by ninety percent). When an
operation closes, move its block verbatim to an archive file beside the
ledger, named by the ledger's stem plus `_archive` (`LEDGER.md` gets
`LEDGER_archive.md`), leave one line at the head of the history
recording the move, and note beside the what-remains list that the
archive exists. Nothing is deleted, and the archive is opened only when
a closed item must be reopened or audited.

A REAL HANDOFF IS WORKED THROUGH ON ONE PAGE IN
[`EXAMPLE.md`](EXAMPLE.md), beside this file: one task crossing one
usage cliff, the ledger as the dying platform leaves it and the first
entry the next one writes. Read it once before writing your first
ledger, since the three parts above are faster to learn from a
filled-in copy than from their description.

## 2. The rule: the ledger moves with the work

Every commit that changes anything a later session would need to know
about carries its ledger line IN THE SAME COMMIT, or in the very next
one. Not at the end of the day, not when the task closes, not when
someone remembers. The reason is exactly the failure this protocol
exists for: the session that plans to write the ledger later is the
session that a usage limit cuts off first, and everything since the
last ledger line dies with it.

Batching the record to the end has a second cost that is easy to
miss: the summary written afterwards records what the writer
remembers, and the writer remembers the outcome, not the dead ends,
the reverted attempt, or the reason the second approach replaced the
first. A ledger written with the work records what was true at the
time. That is the version a resuming session needs.

The rule binds THE DIRECTION OF TRAVEL, not the prose: one line
naming what changed and where is enough while work is moving, and the
fuller history section lands when the piece completes. What is never
acceptable is leaving the ledger behind: the record may trail the work
by one commit, never by two, and never past the end of a sitting.

## 3. The hook that makes breaking the rule loud

A rule with no trigger does not fire. The hook below adds two gates
to `pre-commit`: a commit with substantive changes must carry the
ledger, or follow a commit that did, so work and record are never
more than one commit apart. And a ledger addition that opens a new
history section must open it with a well-formed source header. Both
gates were run in production before they were written down here.

```sh
#!/bin/sh
# Ledger gates. Set up once with: git config core.hooksPath <hooks-dir>
#
# The ledger path is read from LOCAL config, with the project default as
# the fallback, because the hook file itself is committed and shared. A
# clone that owns a different ledger, which is what happens when this
# protocol runs beside the sub-session protocol and each seat owns its
# own outbox, sets its own path once:
#   git config --local ledger.path <path>
# --local matters: a plain `git config` reads system and global too, so a
# global entry would retarget the gates in every repository on the machine.
LEDGER=$(git config --local ledger.path 2>/dev/null || echo "<ledger>")

# AND A CLONE STILL CARRYING THE OLD KEY IS TOLD, ONCE, LOUDLY. This key
# was named `relay.ledger` before the protocol was renamed, and the key
# lives in each clone rather than in this file, so a rename here does not
# reach one. Silently falling back to the default is the bad case: the
# gates would then guard the project ledger while the clone believes they
# guard its own, which is exactly what the per-clone key exists to avoid.
# Carrying the old name as a fallback would work and would put a dead name
# in a first release, so the hook refuses instead and says what to type.
if [ -z "$(git config --local ledger.path 2>/dev/null)" ] &&
   [ -n "$(git config --local relay.ledger 2>/dev/null)" ]; then
  # THE COMMAND IS QUOTED, because the path it names is the reader's and may
  # hold a space or an apostrophe. Unquoted, `Seat Ledger.md` migrated as
  # `Seat` and `Seat's Ledger.md` failed outright, so the advice broke exactly
  # the clones least like the author's.
  printf '%s\n' 'this clone sets relay.ledger, the name this protocol used before it was renamed, and nothing reads that key any more. Run: git config --local ledger.path "$(git config --local relay.ledger)"' >&2
  exit 1
fi

# quotePath escapes non-ASCII names, and an escaped name matches nothing.
# The flag guards EVERY line whose output is compared against the ledger's
# name as text, here and in the diff-tree read below: the first omission
# disabled gate 2 outright, and the second refused the one-commit allowance
# to any ledger named outside ASCII, telling its user the record was two
# commits behind when it was one. The pathspec reads need no flag, since a
# pathspec matches bytes and only a status letter is read from the output.
changed=$(git -c core.quotePath=false diff --cached --name-only)

# Gate 1: the ledger moves with the work. A commit that changes
# anything else must add to or modify the ledger, or the previous
# commit must have carried it. A staged deletion of the ledger never
# counts as carrying it. Merges are exempt; LEDGER_OK=1 skips THREE cases,
# the same three the refusal below names: a commit that genuinely records
# nothing a later session would need, an amend of a commit riding the slack,
# where pre-commit cannot tell an amend from a fresh commit and reads the
# ledger as two commits back, and a change confined to the ledger's own
# archive file. The comment listed two while the message listed three, which
# is the reader learning the hatch from whichever of them they happened to
# read first.
if [ -z "$LEDGER_OK" ] && [ ! -e "$(git rev-parse --git-dir)/MERGE_HEAD" ]; then
  substantive=$(printf '%s\n' "$changed" | grep -vFx -- "$LEDGER")
  carries=$(git diff --cached --name-status -- "$LEDGER" | grep -E '^[AM]')
  if [ -n "$substantive" ] && [ -z "$carries" ] && git rev-parse -q --verify HEAD >/dev/null; then
    if ! git ls-files --error-unmatch -- "$LEDGER" >/dev/null 2>&1; then
      echo
      echo "commit stopped: the ledger $LEDGER does not exist in this"
      echo "repository. Create it, write the first entry, stage it with"
      echo "this work, and commit again. If you have just RENAMED it,"
      echo "point the hook at the new path and repeat this commit: read"
      echo "against the new path, the rename carries its own ledger."
      exit 1
    fi
    if ! git -c core.quotePath=false diff-tree -m --root --no-commit-id --name-only -r HEAD | grep -qFx -- "$LEDGER"; then
      echo
      echo "commit stopped: $LEDGER is two commits behind the work."
      echo "The ledger is the repository's handover document: every change"
      echo "goes into it as it happens, in the same commit as the work or"
      echo "the very next one. Write the line for this change, stage the"
      echo "ledger, commit again."
      echo
      echo "THREE CASES TAKE THE HATCH INSTEAD, as: LEDGER_OK=1 git commit"
      echo "  an AMEND of a commit that was riding the slack, since this"
      echo "  gate counts the commit it is about to replace and so reads"
      echo "  one commit of slack as two,"
      echo "  a commit that genuinely records nothing a later session"
      echo "  would need,"
      echo "  and a change confined to the ledger's own archive file."
      echo "Reach for that before --no-verify, which switches off every"
      echo "gate here rather than the one that does not fit."
      exit 1
    fi
  fi
fi

# Gate 2: a commit that adds THIRD-LEVEL headings to the ledger must add
# at least one well-formed source header among them. Requiring every one
# to be a source header was tried and rejected: real ledgers carry titled
# subheadings inside their sections, and a gate that refuses the
# file's own conventions teaches people to bypass hooks. Deeper headings
# are left alone entirely, so a subheading written on its own passes. The residual
# is accepted knowingly: a malformed section can ride along with a
# good one in the same commit.
if [ -n "$(git diff --cached --name-only -- "$LEDGER")" ]; then
  # only third-level headings: a source header is by definition a ###, so a
  # deeper titled subheading is none of this gate's business. Matching #{3,}
  # refused a subheading committed on its own, which is exactly the case the
  # note below says the design allows.
  heads=$(git diff --cached -U0 -- "$LEDGER" | grep -E '^\+### ')
  new_heads=$(printf '%s' "$heads" | grep -c .)
  good_heads=$(printf '%s' "$heads" \
    | grep -cE '^\+### \[[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2} UTC\] Platform: [^|]+ \| Model: .+')
  if [ "$new_heads" -gt 0 ] && [ "$good_heads" -eq 0 ]; then
    echo
    echo "commit stopped: a heading added to $LEDGER is not a source header."
    echo "Every history section opens with exactly:"
    echo "### [YYYY-MM-DD HH:MM UTC] Platform: <tool> | Model: <exact model>"
    echo
    echo "Two ordinary reasons to see this without having written a bad"
    echo "header. Writing that FORMAT into the ledger as documentation"
    echo "trips it, because this gate reads the diff and pays no"
    echo "attention to markdown fences: indent the template by four"
    echo "spaces or put it in backticks. And a titled subheading of your"
    echo "own belongs at four hashes or deeper, which this gate leaves"
    echo "alone entirely."
    exit 1
  fi
fi

exit 0
```

Install it as `<hooks-dir>/pre-commit`, substitute `<ledger>` and
`<hooks-dir>`, make it executable with `chmod +x`, and run the
`git config` line once per clone. Then PROVE THE GATE FIRES before
trusting it: stage a work file without the ledger twice and watch the
second commit stop. A hook file without its executable bit is
silently skipped, git prints one hint and commits anyway, and the
first install is exactly when nobody knows what the gate looks like
when it works.

WHAT THE GATE CANNOT SEE, said once so that nobody has to discover it. A
pre-commit hook runs on `git commit` and on `git commit --amend`, and
git does not run it while REPLAYING commits. Measured: a cherry-pick, a
revert, a rebase and a clean merge each completed with the hook never
invoked once. So a rebase carries forward whatever the commits it
replays already held, including one this gate refused that somebody
forced in, and nothing later re-checks them. That is ordinary git rather
than a hole in this hook, and it is the reason merges are exempt in the
code above: the only merge that reaches a hook at all is one that
conflicted and was finished by hand.

The gate audits diffs, so headers written before the hook existed are
never re-checked. When adopting the ledger protocol in a repository with
an existing ledger, read the old headers once by hand. And when writing
the header FORMAT into the ledger itself as documentation, indent the
template or set it in backticks: written as a live heading it is a
malformed header to the gate, which reads the diff and pays no attention
to markdown fences. Two notes from running it. Hooks are per-clone
configuration and a rebuilt environment silently loses them, so
re-asserting the hook path belongs in the ledger's machine-setup
section. And the escape hatch is spelled `LEDGER_OK=1` on one commit,
deliberately awkward: the moment it feels routine, the ledger is
drifting and the next handoff will show it.

If the repository already runs a pre-commit hook, append these gates
to it rather than replacing it.

Renaming the ledger costs one refusal and one config line. The rename
leaves the old path absent, so the gate stops with the does-not-exist
message; point the hook at the new path, by editing `LEDGER=` or by
setting `ledger.path`, and repeat the commit. No hatch is needed: read
against the new path alone, the rename is an addition there, so the
commit carries its own ledger, and the first draft of this paragraph
prescribed `LEDGER_OK=1` here anyway, teaching the hatch where nothing
called for it, which the suite caught by running the recipe instead of
believing it. Amending a commit that was riding the one commit of slack
does need the hatch, since pre-commit cannot tell an amend from a fresh
commit and reads the ledger as two commits back. That use is not the
drift the hatch warns about.

`bin/selftest.sh` pulls the hook out of THIS file, installs it in a
throwaway repository and walks every gate, every escape hatch and every
documented recipe, printing its own case and assertion counts, which are
the only place worth trusting them from. Three of the things it covers are
worth naming, because nothing else would catch them. IT RUNS THE RECIPES
RATHER THAN BELIEVING THEM, so the rename recipe is executed and the
README's five-command extraction is compared byte for byte against this
suite's own, and the two cannot drift apart. It checks the shipped pointers
against this file's own front matter, since each pointer carries a copy of
that front matter and a tool lists the skill by what the POINTER says. And
it drives the paths a person hits and a test usually skips: a ledger named
in non-ASCII, a staged deletion of it, a merge commit, and the amend that
rides the hook's slack. Run it after editing the hook,
and on a new platform before trusting it there.

AND WHEN A CASE IS ADDED TO COVER A DEFECT, RUN IT AGAINST THE DEFECT
FIRST. A case that passes on the broken hook as well as the fixed one
proves nothing, and it hides behind a green suite where nobody looks
again. Copy the tree, revert ONLY the fix, run the suite, and require
the new assertion to FAIL there. It costs one run and it is the only
thing that separates a test from a decoration. Measured on the
sub-session package rather than this one: a case written to cover a
lock defect passed for a reason unrelated to the rule it was checking,
and the defect shipped behind it.

## 4. Handing off when a platform runs out

The handoff this protocol is built for is the involuntary one: the
usage meter runs out, the session freezes, and whatever was not
pushed is gone. Two drills decide how that goes.

**The cliff drill.** When the limit is near, stop opening new work.
Land the smallest COMPLETE unit in progress, write its ledger line,
commit, push, and spend whatever remains on making the ledger's
what-remains list exact, because that list is the entire briefing the
next platform gets. Banking a finished step beats gambling on an
unfinished bigger one, every time, and the moment of the cutoff is
not under your control.

**The resume ritual.** The next session, on whatever platform:

```
Open the repository and continue: read the ledger's what-remains
list, its machine-setup part, and any history newer than the last
point you know, opening the archive file only if a closed item is
being reopened; run the machine-setup commands; verify the
working tree is clean and the branch matches the ledger's record,
and reconcile before anything else if they disagree; say in one line
here which platform and commit you are resuming from and which item
you are starting; then start at item one of what remains, keep the
ledger moving with the work, and as each item lands say in one line
here what it was and which commit carries it.
```

That paragraph is the whole handoff. If a resuming session needs
more than this, the ledger is missing something. Write the missing
thing into the ledger for the next time instead of asking the person
to explain it again.

**Say what you picked up, and say when you put it down.** The ledger
is written for the next session, and the person watching this window
reads none of it. So a resuming session opens with one line naming
the commit and the platform it inherited from and the item it is
starting, and it closes each item with one short line saying what
landed and where. A session that reads a ledger, works for an hour
and says nothing has done the whole handoff correctly and still left
the only human involved unable to tell a live session from a dead
one. The cliff drill gets the same treatment at the other end: the
line that says the limit is near, the unit being banked and what the
next session will find is worth more to the person reading it than
any further minute of work.

**Verify before trusting.** The dying session may not have finished
its last push, and its final ledger line may describe an intention
rather than a fact. The resume ritual therefore checks the
repository's actual state against the ledger's claims, believes the
repository wherever they differ, and records the correction as its
first ledger line.

## 5. Several platforms on one task

Platforms take turns. They do not interleave. One session works the task
at a time, and the handoff point is a pushed commit with a current
ledger. If two sessions must genuinely work at once, that is a different
problem with different parts, exclusive writers, an instruction bus,
watchers, and it is the sub-session protocol's territory, a separate
skill. Run the ledger protocol for continuity and that protocol for
concurrency, they compose. Composing them changes one setting: each
session's ledger is THE FILE IT OWNS under that protocol's one-writer
rule, the project ledger for the master and its own outbox for a
sub-session. The hook file is committed and shared, so the per-clone
part is a local config entry, `git config --local ledger.path
<bus-dir>/OUTBOX_<name>.md` in each seat's clone and nothing at all in
the master's, which falls through to the project default. Set it in the
same breath as `core.hooksPath`, before the first commit, and put both
lines in the ledger's machine-setup section. Without it every seat's
first checkpoint is refused for not staging a ledger it does not own,
and staging that ledger would break the seat's own one-writer limit. The
master's merges bring both records onto the integration branch. An
outbox serving as a ledger carries the history half only, and it stays
append-only by its own protocol's rule. IT DOES NOT NEED THIS PROTOCOL'S
SOURCE HEADERS, and this paragraph said it did: every outbox entry
already carries its own UTC timestamp and the file names the seat that
owns it, so the one thing a header would add is the platform and the
model. A team that wants that writes ONE header per sitting rather than
one per line, and the deployment that wrote both protocols has never
written one, across sixty-one entries in the outbox it uses most. An
unenforced requirement that its own authors ignore is worse than no
requirement, since gate two only fires on a heading that IS added. The
what-remains half for that seat lives in its inbox and in the master's
project ledger.

What keeps a turn-taking trail coherent:

- ONE commit identity for the whole task, whoever is driving, set in
  the machine-setup section. The ledger's source headers, not the
  git author, record which platform did what.
- The same conventions bind every platform: the strongest available
  session re-verifies delegated or inherited work at its own
  standard before building on it, and anything one platform pushed
  that another cannot verify goes on the what-remains list rather
  than being assumed correct.
- Platform-specific facts (which tool has a scheduler, which loses
  hooks on rebuild, which needs the model named) live in the
  machine-setup section as they are discovered, so the cost of
  learning them is paid once.

## 6. Running this on any tool

The protocol needs a shell, git 2.9 or newer, and push access to a
shared remote, nothing else. The version floor is `core.hooksPath`,
which arrives in 2.9 and is what lets the hook sit in a committed
directory rather than in `.git/hooks`, which no clone carries. The
ledger is markdown, the hook is POSIX sh, and the resume ritual is a
paragraph a person can paste into any session.

Where the skill file goes: the two shipped pointers,
`.agents/skills/ledger/SKILL.md` and `.claude/skills/ledger/SKILL.md`,
sit at the paths Claude Code, Cursor and Codex scan, so cloning this
repository loads the protocol on every tool that scans either path,
from this one file. Installed elsewhere, copy one pointer out to the
path your tool scans and fix its relative path, per the README. On a
tool that scans neither path, a rule file in `.cursor/rules/` set to
apply always, or one line
in `AGENTS.md`, tells the session to read this file before working, and
on anything else, paste this file as the session's briefing. The front
matter above is one tool's loader metadata. Every other tool ignores
it.

Pre-authorise the calls the protocol makes where the tool asks per
call, so committing and pushing the ledger never waits on a human
click: an allow-list entry for the shell and git operations, made
once, per the tool's own permission mechanism.

## 7. Why this shape (design notes)

- The ledger lives in git rather than a wiki or a chat because the
  handoff moment is exactly when every channel except the repository
  fails: the session is dead, the chat is gone, and only what was
  pushed exists. There is one copy, it travels with the code, and
  its history is the audit trail.
- The rule allows one commit of slack because real work sometimes
  lands in two pushes seconds apart, and a hook that blocks that
  teaches people to bypass hooks. That much slack keeps the gate
  strict enough to matter and loose enough to obey.
- Source headers earn their place the day two platforms disagree
  about what happened. The git author cannot carry this, because the
  task runs under one identity on purpose.
- The what-remains list is at the TOP because the resuming session
  reads under pressure, possibly on a small context, and what it must
  not miss is the work still owed. The history can wait a minute. The
  list cannot.
- The economy of the ledger is a design constraint that binds from
  the first entry: the resume ritual is priced into every session start
  on every platform, so the live file carries only what a resuming
  session needs and the archive carries everything else. A protocol
  whose own paperwork grows without bound eventually costs more than
  the failures it prevents.
- The protocol says nothing about how to do the work, only how to
  record and resume it. That is deliberate: it composes with any
  working agreement, any review protocol, and the sub-session skill,
  rather than competing with them.
