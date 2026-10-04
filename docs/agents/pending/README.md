# Pending: code built and kept off `main` until Davies' word

Each patch here is a change that is built, reviewed and tested, and not deployed, because deploying it is his decision.
Nothing in this folder runs: the Edge Functions deploy only from `supabase/functions/`, and no gate reads a patch.

| Patch | What it changes | Waits for |
|---|---|---|
| `2026-10-04-mid-pool-payouts-per-path.patch` | What Polymarket pays, told apart per path: `pm_live.ts`'s readout books a payout only for a market the path's own minutes show it quoting live that day, and mid-pool reads the account's earnings only once live. Its pins: `agents/pm_payouts.test.ts` beside a byte copy of the path mid-pool's pre-registration froze (`pm_live_mid_frozen.ts`), and `src/pm_mid_prereg.test.js`; stale comments in `pm_mid.ts` and `index.ts`; the map's rows. No dry-run decision changes. | Davies' go-live decision for mid-pool. His word, 2026-10-04: "之后再部署吧 我想等v-3 v-4的结果更明显了看看能不能inform现在的mid策略之后再决定上线，具体时间我来定，代码你先都存好". |

## Applying the payouts patch

1. Its base is `8d06a995`, where `supabase/functions/agents/pm_live.ts` is sha256 `8ba7b915…9653`. On a tree whose
   `pm_live.ts` still has that hash, `git am docs/agents/pending/2026-10-04-mid-pool-payouts-per-path.patch` applies it
   as one commit. If `pm_live.ts` has changed since, rebuild it on the new code instead: the frozen copy must stay the
   bytes mid-pool's pre-registration names (`8ba7b915…`), and the comparison test must run the new path beside it.
2. Run the gates (`sh bin/gates.sh`), then update what says it waits: the draft pre-registration's precondition 3
   (`reviews/2026-10-04-polymarket-mid-pool-live-prereg.md`), the design doc's "where each stands" under step 8m,
   reference item 53 and `docs/agents/CLAUDE.md`'s mid-pool sentence; delete the patch from this folder and its row
   above; and write the ledger line in the same commit.
3. Deployed on or before 2026-10-16 it falls inside mid-pool's dry-run window and is a deviation its readout names;
   from 2026-10-17 00:00 UTC it is not.
4. If the RW-X arms' results (x4 "wide", x5 "lean"; Test 1 read at or after 2026-10-09 00:05 UTC) change mid-pool's
   quoting rule before it goes live, that rule runs in mid-pool's dry-run first, and the comparison in
   `pm_payouts.test.ts` is redone against whatever the funded pre-registration then freezes.
