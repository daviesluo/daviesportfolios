# ledger

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0-brightgreen.svg)](#version)
[![Self-test](https://img.shields.io/badge/self--test-47%20cases-brightgreen.svg)](#install-and-invoke)
[![Tools](https://img.shields.io/badge/runs%20on-Claude%20Code%20%C2%B7%20Cursor%20%C2%B7%20Codex-lightgrey.svg)](#requirements)

A long task should survive the session that started it. The ledger
protocol keeps the task's whole state in one live ledger inside the
repository, forces every commit to carry it, and gives the next session,
on any AI platform, a one-paragraph ritual that resumes the work from
the repository alone.

## The problem

A session dies without warning: a usage limit lands, a container is
reclaimed, a context window overflows. Whatever lived only in that
session's head, the plan, the half-finished step, the reason behind a
decision, dies with it. Chat logs do not transfer between platforms,
and memory does not survive a fresh clone. The only store that every
platform can read and write, and that outlives them all, is the
repository itself.

## How it works

![The user hands the task to whichever session is alive. Session one commits
its work together with a ledger line, meets a usage limit and spends its last
minutes making the handover exact. Session two, on a different tool, resumes
from the repository,
continues, and ends when its container is reclaimed with no warning at all,
so only what it had already pushed survives. Session three resumes the same
way and finishes, with no memory of either session before it. The three sit
on Claude Code, Cursor and Codex in the example, and which tool is which
does not matter to any of them. Every commit goes down into the
repository, which holds the code and LEDGER.md beside it, and every
resume comes back up out of it.](ledger.svg)

The sessions run one after another, and only the repository spans them all.

**The ledger** is one markdown file with three parts. A what-remains
list at the top, so the next session reads its orders first. The
machine setup as runnable commands, so a fresh container can rebuild
its environment. A newest-first history in which every section opens
with a source header naming the platform and model that wrote it.
Closed operations move verbatim to an archive file beside it, so the
live ledger stays a few thousand tokens however long the project runs,
and every platform resumes cheaply.

**The rule** is that the ledger moves with the work: a commit that
changes anything else must carry the ledger too, or follow a commit
that did. A pre-commit hook, given in full as tested POSIX sh,
enforces the rule and a second gate on the source headers. One
commit of slack is deliberate, real work sometimes lands in two
pushes seconds apart, and a hook that blocks that teaches people to
bypass hooks.

**The cliff drill** is what a session does in the minutes before a
usage limit: stop opening new work, land the smallest complete unit,
write its ledger line, push, and spend what remains making the
what-remains list exact, because that list is the entire briefing the
next platform gets.

**The resume ritual** is one paragraph pasted into any cold session:
read the what-remains list, the machine setup and any history newer
than the last known point, run the setup commands, verify the tree
and branch against the ledger and reconcile before trusting either,
then start at the top of the list. No memory of the previous session
is assumed, which is the point.

## What is in here

| File | What it is |
|---|---|
| `SKILL.md` | The protocol itself, and the only file a session needs to read. Seven sections: the ledger, the rule, the hook, the handoff drills, several platforms on one task, running on any tool, and the design notes. |
| `README.md` | This page. |
| `.agents/skills/ledger/SKILL.md`, `.claude/skills/ledger/SKILL.md` | Two pointers, each `SKILL.md`'s own front matter plus a few lines: which file to read, how to find it if the relative path does not resolve, and what else is in the package. They are what makes the skill load on every tool that scans either path, from one copy of the protocol, and they are the template to adapt when installing the folder elsewhere. |
| `EXAMPLE.md` | A worked ledger, short enough to read in a minute and complete enough to copy. |
| `bin/selftest.sh` | Extracts the hook from `SKILL.md` and exercises both gates, every escape hatch and every documented recipe in a throwaway repository, in seconds, with no GNU tools needed: BSD awk runs it too. The case and assertion counts are printed by the run itself, which is the only place worth trusting them from. |
| `ledger.svg` | The diagram above. |
| `LICENSE`, `NOTICE` | Apache 2.0 and the notice that has to travel with any redistribution. |

## Install and invoke

**To try it, clone https://github.com/daviesluo/ledger-skill and open it with
your tool.** That repository is this folder and nothing else, so the two
pointers below land at the paths the tools scan, and both name the same
`SKILL.md` at the root beside them.

| Tool | Path it scans | Invoke |
|---|---|---|
| Claude Code | `.claude/skills/ledger/SKILL.md` | `/ledger` |
| Cursor | `.agents/skills/ledger/SKILL.md` | `$ledger` |
| Codex and other `AGENTS.md` tools | the same `.agents` path | `/ledger` |
| The same tools where no pointer sits at a scanned path, the folder embedded deeper in a host repository | one line in `AGENTS.md` | the model READS the file. There is no slash command |
| Anything else with a shell | none | paste `SKILL.md` in as the session's briefing |

A pointer at a scanned path registers a skill you can invoke by name; a
line in `AGENTS.md` makes the model read the file and registers nothing.
Both routes work, and the deployment this package grew up in ran on the
second one. Loading and invoking were checked on real installs of Claude
Code CLI 2.1.231, Codex CLI 0.149.0-alpha.4, Cursor agent CLI 2026.08.11,
opencode 1.18.23 and grok CLI 1.0.5. No tested CLI needed a restart to
notice a newly added skill, so if yours does not find it, restart the
environment before debugging anything else.

**To install it in a repository of your own,** copy this folder in at a
path that is NOT itself scanned, add one pointer file at the path your
tool does scan, and THEN DELETE THE TWO THAT CAME WITH THE FOLDER. The
pointer is `SKILL.md`'s OWN front matter, the block between the two `---`
lines at the top of it, plus a few lines naming `SKILL.md` itself; the two
shipped here are the template, so copy one out and fix its relative path,
which is the only part that changes. THE ORDER MATTERS: copy the folder
straight onto `.claude/skills/ledger/` and `SKILL.md` already sits where
the tool looks, so writing a pointer there replaces the protocol. Either
put the folder somewhere of your own and point at it, or put it on the
scanned path and add no pointer at all. On a tool that scans neither path,
a rule file in `.cursor/rules/` set to apply always, or one line in
`AGENTS.md`, does the same job.

Then check the hook works on this machine, before you trust it:

```sh
cd path/to/ledger && sh bin/selftest.sh
```

It installs the hook in a throwaway repository and exercises both gates,
every escape hatch and every documented recipe, printing its own cases and
totals, in a few seconds.

Installing the hook in your repository is five commands:

```sh
mkdir -p hooks
sed -n '/^#!\/bin\/sh$/,/^exit 0$/p' path/to/ledger/SKILL.md \
  | sed 's|<ledger>|LEDGER.md|' > hooks/pre-commit
chmod +x hooks/pre-commit
git config core.hooksPath hooks
git config --local ledger.path LEDGER.md
```

The last one is per clone. It matters when several sessions each own a
different ledger, and setting it now costs nothing. Then create
`LEDGER.md` at the repository root with its three parts in order,
`EXAMPLE.md` beside this file is a worked one to copy, and commit it
together with the hook.

## Using it

Installed and self-tested per the table above, the working loop is:

1. Create the ledger and install the hook, per the section above.
   `EXAMPLE.md` beside this file is a worked ledger to copy.
2. Work normally. The hook keeps the ledger honest, the history
   accumulates under source headers, and closed operations move to the
   archive so the live file stays cheap to read.
3. When a platform runs out, or you simply switch tools, paste the
   resume ritual into the next session. It continues from the
   repository alone.

## What it does not do

It does not run anything in the background, watch anything, or wake
anything. The ledger is a file, the hook is a gate at commit time, and the
resume ritual is a paragraph a person pastes. Nothing here needs a daemon,
a scheduler, or a service to be running for the handoff to work.

It does not read or write anything outside the repository, and it makes no
network call of its own beyond the git push a session was making anyway.

## The companion protocol

This protocol covers platforms taking turns on one task. Running
several sessions at the same time, master and sub-sessions, message
buses, review gates, belongs to the sub-session protocol, published at
https://github.com/daviesluo/sub-session-skill. The two compose:
each concurrent session keeps its own ledger discipline, and each
sub-session's outbox is its lane-owned ledger in this protocol's
sense.

## Requirements

A shell, git 2.9 or newer, and push access to a shared remote. The
version matters for one reason: `core.hooksPath` arrives in 2.9, and it
is what lets the hook live in a committed directory instead of in
`.git/hooks`, where nothing could carry it to the next clone. That
floor sits below the sub-session protocol's 2.13, whose watchers call
`git rev-parse --absolute-git-dir`. Nothing else: the ledger is
markdown, the hook is plain sh, and any mix of AI platforms can take
turns.

## Version

**1.0, September 2026. First release.**

WHAT IS IN IT. The protocol, one ledger file and one rule, a pre-commit
hook given in full as tested POSIX sh, the cliff drill and the resume
ritual, the composition rule for running beside the sub-session
protocol, and a self-test that extracts the hook from the protocol
itself, so the two can never drift apart.

WHERE IT HAS RUN. Under the deployment that wrote it: one research
repository's sessions handing one task across Claude Code, Cursor and
Codex for months, usage cliffs included. Every number quoted here was
measured there rather than reasoned about, the 55,000-token ledger the
archive rule cites among them.

Copies of this folder drift: when updating one, check its version
line against https://github.com/daviesluo/ledger-skill.

Licensed under the Apache License 2.0, whose text is the `LICENSE`
file in this folder. Copyright 2026 Zheng Luo (Davies Luo).
