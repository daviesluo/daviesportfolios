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

# Read `.ledger/SKILL.md`, not this file

Copyright 2026 Zheng Luo (Davies Luo), Apache License 2.0, whose text
is `.ledger/LICENSE`. Keep this line when you copy the file.

This file is a POINTER, not the protocol. The protocol is ONE file so
that Claude Code, Cursor, Codex and anything reading `AGENTS.md` all
load the same text and no copy can go stale against another. In this
repository it lives at `.ledger/SKILL.md`, which is
`../../../.ledger/SKILL.md` relative to THIS FILE and plain
`.ledger/SKILL.md` from the repository root. Those are different
starting points and a session usually stands at the second, so if one
does not resolve try the other, and if neither does, find it with
`git grep -L 'This file is a POINTER' -- '*SKILL.md'`, which lists the
protocols by excluding every file that says, as this one does, that it
is a pointer.

READ THE PROTOCOL NOW, in full, before acting on anything this skill
covers. Do not act on this file alone.

## What this repository does with it

The live ledger is `LEDGER.md` at the root. `handover.md` is its
ARCHIVE — the decision log and the raw session transcripts — and is
opened only when a closed item is reopened or audited. The hook is
`hooks/pre-commit`, reached through `core.hooksPath`, and both it and
`ledger.path` are per-clone config that a rebuilt container loses:
`LEDGER.md`'s machine-setup section has the commands.

Everything beside the protocol is part of the same package: the
`README.md`, `EXAMPLE.md` and the self-test under `.ledger/bin/`.
