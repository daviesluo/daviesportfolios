# A worked handoff

One task crossing one usage cliff: the ledger as platform A leaves it,
and the first entry platform B writes. The project is invented, a data
pipeline, and the shapes are the contract. The ledger is `LEDGER.md` at
the repository root.

**The ledger top as platform A pushes it, minutes before its limit:**

```
# Ledger

## What remains right now

1. Rebuild the March segment with the new normaliser and rerun its
   row-count check against the manifest (expect 1,244,000 exactly).
2. Re-point the four dashboard queries at the rebuilt table, one
   commit per query, names in the 16:40 section below.
3. Delete the shadow table only after item 2 is verified on staging.

## Machine and platform setup

    git config user.name "A. Author"
    git config user.email author@example.org
    git config core.hooksPath hooks
    git config --local ledger.path LEDGER.md
    pip install -r tools/requirements.txt

## History, newest first

### [2026-03-14 16:55 UTC] Platform: Claude | Model: opus max

Usage limit near. Banked the finished half: the normaliser fix is
in b4e2a91 and its unit test passes. Item 1 was NOT started, the
February rebuild in fd0c317 is verified, and nothing else is in
flight. The tree is clean and pushed on main at b4e2a91.

### [2026-03-14 16:40 UTC] Platform: Claude | Model: opus max

February segment rebuilt and verified against the manifest
(1,198,340 rows exactly, fd0c317). The four dashboard queries that
read the old table: revenue_daily, revenue_monthly, churn_weekly,
ops_backlog. The shadow table stays until they are re-pointed.
```

**The first entry platform B writes, before touching item 1:**

```
### [2026-03-14 18:10 UTC] Platform: Cursor | Model: gpt5.2

Resumed from the ledger. Verified the tree at b4e2a91, clean, and
the machine setup ran. One correction to the record: the 16:55
entry says the normaliser unit test passes, and it does, but the
integration test was never run; ran it before starting, it passes
too. Starting item 1.
```

That is the whole mechanism working: the cliff drill banked a finished
unit and made the list exact, the resume ritual re-verified the state
instead of trusting the last words of a dying session, the correction
went into the record, and the task continued as if nothing had
happened, which is the point.

---

Copyright 2026 Zheng Luo (Davies Luo). Licensed under the Apache
License 2.0, whose text is the `LICENSE` file beside this one.
