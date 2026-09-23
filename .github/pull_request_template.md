<!--
  Mirrors .claude/CLAUDE.md's "commit messages focused on **why**, not **what**"
  guidance — lead with the reason this change exists, not the file
  list (the diff is already there).
-->

## Summary

<!-- 1-3 bullets: what the change does + why. -->

## Test plan

<!--
  - [ ] `sh bin/gates.sh` green (every CI gate; the npm ones run in src/)
  - [ ] Manual: <which page / flow / device>
-->

## Risks

<!--
  Anything that could break in prod that the tests don't catch.
  Migrations to re-apply via Supabase SQL Editor? Cache shape change
  that needs a key-version bump? Edge Function deploy that needs a
  secret added? Note it here so the merger doesn't have to dig.
-->
