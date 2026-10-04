# Pending: code built and kept off `main` until Davies' word

Each patch here is a change that is built, reviewed and tested, and not deployed, because deploying it is his decision.
Nothing in this folder runs: the Edge Functions deploy only from `supabase/functions/`, and no gate reads a patch.

| Patch | What it changes | Waits for |
|---|---|---|
| `2026-10-04-mid-pool-payouts-per-path.patch` | What Polymarket pays, told apart per path: `pm_live.ts`'s readout books a payout only for a market the path's own minutes show it quoting live that day, and mid-pool reads the account's earnings only once live. Its pins: `agents/pm_payouts.test.ts` beside the byte copy of the path mid-pool's pre-registration froze (`pm_live_mid_frozen.ts`, on `main` since 2026-10-04's formula fix), and `pm_mid_formula.test.ts` told of what it adds; stale comments in `pm_mid.ts` and `index.ts`; the map's rows. No dry-run decision changes. Since live-prep's build (2026-10-04) it is also what keeps live-prep's R and its stop on its own markets, and live-prep's payouts out of mini-pool's dry-run readout. | Davies' go-live decision for mid-pool. His word, 2026-10-04: "之后再部署吧 我想等v-3 v-4的结果更明显了看看能不能inform现在的mid策略之后再决定上线，具体时间我来定，代码你先都存好". **It is also needed before live-prep's go** (`reviews/2026-10-04-polymarket-lp-prereg.md`, precondition P3); applying it is Davies' call, as its deploy is. |

## Applying the payouts patch

1. Its base is the build of "Reward quotes live-prep" (2026-10-04, migration `0091`), where
   `supabase/functions/agents/pm_live.ts` is sha256 `23112a4f…e5a9` (after the patch: `2feb0e58…63c5`). On a tree whose
   `pm_live.ts` still has that hash, `git am docs/agents/pending/2026-10-04-mid-pool-payouts-per-path.patch` applies it
   as one commit (verified on that build: it applies cleanly, and `pm_payouts.test.ts`, `pm_mid_formula.test.ts`,
   `pm_instance.test.ts`, `pm_lp.test.ts`, `pm_live.test.ts` and `pm_mid.test.ts` pass on it). If `pm_live.ts` has
   changed since, rebuild it on the new code instead: the frozen copy must stay the bytes mid-pool's pre-registration
   names (`8ba7b915…`), and the comparison test must run the new path beside it. It was first built on `8d06a995`
   (`pm_live.ts` `8ba7b915…9653`), rebuilt on the formula fix the same day (`51cd7e45`, `effd6351…1617`;
   `pm_payouts.test.ts` takes the fix's own fields out of both sides first, as `pm_mid_formula.test.ts` states and pins
   them, so it still shows this change alone), and rebuilt on live-prep's build, where only a header comment of
   `pm_live.ts` needed merging.
2. Run the gates (`sh bin/gates.sh`), then update what says it waits: the draft pre-registration's precondition 3
   (`reviews/2026-10-04-polymarket-mid-pool-live-prereg.md`), the design doc's "where each stands" under step 8m,
   reference item 53 and `docs/agents/CLAUDE.md`'s mid-pool sentence; live-prep's pre-registration
   (`reviews/2026-10-04-polymarket-lp-prereg.md`: an addendum records it, as its precondition P3 says), the design doc's
   step 8lp and reference item 54; delete the patch from this folder and its row above; and write the ledger line in the
   same commit.
3. Deployed on or before 2026-10-16 it falls inside mid-pool's dry-run window and is a deviation its readout names;
   from 2026-10-17 00:00 UTC it is not.
4. If the RW-X arms' results (x4 "wide", x5 "lean"; Test 1 read at or after 2026-10-09 00:05 UTC) change mid-pool's
   quoting rule before it goes live, that rule runs in mid-pool's dry-run first, and the comparison in
   `pm_payouts.test.ts` is redone against whatever the funded pre-registration then freezes.
