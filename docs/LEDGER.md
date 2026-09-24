# Ledger

The live handover record for this repository, under the ledger protocol
in `.agents/skills/ledger/SKILL.md`. Read this file first on any resume; it is kept
small on purpose. The deep record — the full decision log and the raw
session transcripts — is `docs/handover.md`, which is this ledger's ARCHIVE
and is opened only when a closed item is reopened or audited.

## What remains right now

**The full plan is `docs/improvement-plan.md`** — 28 items in four
tiers, written 2026-09-05 from a whole-repository review, with cost,
risk and a verification step on each. It is a PROPOSAL: nothing in it
has been executed, and nothing should be until Davies confirms. This
list stays the short version; the plan is the reasoning behind it.

00000000. **DAVIES' REQUESTS OF 2026-09-23 ~20:40 UTC.** The go-live work
   (item 0000000) was paused on his word; he has since **un-paused its
   preparation**, and D8–D10 are done (item 0000000.1). The go itself stays
   his explicit word. The DecisionFC review is still paused; do not resume it
   without him.
   1. **The read-only password hides the transaction history and the
      INVESTMENT view: DONE** (its password is being shared publicly). The
      menu item and the tab are not rendered for a viewer, the panel shows
      VS S&P 500 alone at both breakpoints, and the modal cannot open;
      pinned in Vitest and by four checks in the browser sweep (226), all
      of which fail on the previous bundle. Presentation only: the
      portfolio payload a viewer loads still carries the lots.
   2. **Agents page: the stablecoin quotes (PR5 paper test) are a row of
      TESTING STRATEGIES: DONE**, last, in a strategy's cells (unrealised is
      the held rungs at each book's last print, `quoteBookView`), and its row
      opens a page: the strategy page's header and scoreboard, each book's six
      rungs, and the latest 20 round trips. The card below the table is gone.
      **Open for Davies:** the page's scoreboard and the Revolut X card still
      total the strategies only; folding the quotes in would put $1,200 more
      on Revolut X's funded figure.
   3. **The admin error badge's nine rows (24 h): DONE as far as code can.**
      Eight are `agents.crash` "Signal timed out." from before D1's fix went
      live at 20:12 UTC (none since); they age out of the 24 h window by
      19:29 UTC tomorrow, or Acknowledge hides them now. The ninth, a
      `trading212.unhandled` timeout at 16:00, was a T212 history page slower
      than ten seconds: its fetch threw past the walk's own failure path.
      `historyPageRequest` now returns it as a failed page the walk retries.

0000000. **DAVIES' REQUESTS OF 2026-09-23 ~15:20 UTC**, in order:
   1. **Can PR5 go live now, and are two Revolut X strategies ready?**
      Answered: PR5 not yet (no live execution path, a record minutes old,
      $0.42 a day since the books tightened). **The independent audit is
      DONE** (`reviews/2026-09-23-golive-audit.md`, patches beside it):
      `trend-4h-live` is the one candidate and is **not ready as the code
      stands** — D1 a Kraken fee-refresh timeout crashes the whole tick
      (re-computed here: the unguarded await, and `agents.crash` rows
      "Signal timed out." in production), D2 an IOC priced at a 3–7 s old
      touch dies unfilled 25–53 % of the time and a dead rule exit waits
      4 h, D3 a 5xx is booked `rejected` though the venue may have filled
      it, D4 a buy fee taken in the coin leaves a phantom position. **D1 is
      FIXED** (P1: the fee refresh is caught, noted and retried in five
      minutes; `runtick.test.ts` failed on the old code with production's
      "Signal timed out." and passes now), and an `agents.crash` row now
      carries the action and the top of the stack (`crashReport`). Deployed
      20:12 UTC (the first deploy died on ghcr.io's rate limit; one re-run);
      production had 8 such crashes in the 24 h before it. **D2–D6
      reproduced on `main`** before their fixes (the audit's five
      failing-behaviour tests all passed there). **P7 is in the draft**: the go-live migration
      now creates the row unarmed with a $30 cap; `live_confirmed_at` is
      set in the conversation on Davies' word, and the cap goes to $150
      after the first round trip settles. **P2–P4 are landed** (`golive.test.ts`
      pins D2–D6, each test failing without its fix): a live marketable order
      re-reads the touch (10 bps entry, 50 exit), a dead IOC is sent again
      (five attempts), a 5xx or lost reply stays pending and the venue's
      order history, read back through `GET /orders/{id}`, settles it, a
      coin fee is booked net, the trail counts the fill's bar and the
      cooldown counts bars. Two changes to the audit's patches: its history
      lookup settled from a list that carries no price or fee (it would
      never have settled), and its net-of-fee left a 1e-18 residue that
      reads "long" for good; `FakeRevx` now serves the history as the venue
      documents it. **D8–D10 are DONE** (`golive.test.ts` pins each; each
      failed on the code before its fix): D8 a fill read back without
      `total_fee` / `fee_currency` settles with the schedule's fee (9 bps
      taker, 0 % post-only), recorded as `feeDerived` beside the venue's
      reply, and a coin fee with no amount is still refused (D4); D9 every
      marketable order records its touch (`request.touch`: bid, ask, age,
      re-read) beside its fill; D10 a lease claim the database does not
      answer ends the turn with a note, not a crash. Every defect in the
      audit is fixed (D7 in the draft). Going live stays Davies' explicit go, and the
      first live order needs his confirmation in the same conversation; its
      read-back shows which fee fields the venue sends.
   2. **A third, independent first-principles search, Binance first: DONE**
      (reference §3.29, review `reviews/2026-09-23-fp3-study.md`, three
      frozen pre-registrations, re-run here byte for byte). One pass, and it
      is worth about cash: resting bids for Binance's liquidation cascades
      made +$488.99 out of sample (4.37 %/yr on $3,000), nearly all in
      2023–24, and lost $108.98 since Binance began capping its own wicks.
      The zero-fee stablecoin quotes and the delisting window fail. **Kept:**
      since March 2026 Binance refuses any trade beyond ±15 % (majors) of
      the 5-minute mean price (2 % on stablecoin books), so a Binance market
      stop in a crash can come back EXPIRED. Binance still has no strategy
      of its own worth money; if Davies wants one on the page, the cascade
      bids are the only candidate with a pass, on paper.

000000. **DAVIES' REQUESTS OF 2026-09-23 ~13:35 UTC**, in order:
   1. **PR3 on a longer, credible record: PASSED (PR5), and it runs on
      paper.** PR3 had 13.25 out-of-sample days because it read the 1-minute
      candles the venue keeps 28 days; the venue serves its whole PUBLIC
      trade history keylessly (`/api/1.0/public/trades/all`, ≤ 1-day window,
      1 request/s). On the nine months PR3 never saw, PR3's unchanged rule
      made +$707.90 on $1,200 over 8,192 trips and cleared all six
      pre-registered conditions (reference §3.27, review
      `reviews/2026-09-23-pr5-study.md`), reproduced here byte for byte.
      **But the books tightened in the week of 2026-08-24**: since then
      $0.42 a day (12.7 %/yr on the locked capital) — plan with that.
      **The paper test runs from its own cron job** (`agents?action=quotes`,
      migration `0051`, §4 item 31): four weeks from its first minute, then
      the spec's six conditions. **Running since 15:09 UTC** (checked
      15:10–15:13: `0051` applied, cron job 18 fires, each run decides the
      minute just closed with no error, 12 quotes out around fair 0.7541 /
      0.7539, the order books recorded as their go-live evidence). **On the
      page** as its own card under the strategies (funded (Paper) $1,200,
      realised, today, round trips, open, orders today of 1,000).
   2. **A second, independent first-principles search: DONE — nothing**
      (reference §3.28, review `reviews/2026-09-23-fp2-study.md`): 20 ideas,
      19 new, three pre-registered tests, all three lose out of sample
      (re-run here byte for byte). Why in one number: a UK half-spread is
      smaller than a minute of Binance's movement on every busy book. Kept:
      in a crash the UK book shelters a seller; a bot prints $0.10 trades at
      the UK touch (PR5's trips of $10 or more carry $693.90 of $707.90).
   3. **"(Paper)" stays on funded only: DONE** — the scoreboards and the
      venue cards say DEPLOYED / deployed with no label.
   4. **The CI flake: FIXED** — both workflows pin the Supabase CLI
      (2.117.0) instead of resolving `latest` through GitHub's anonymous
      API (item 00000.5).

00000. **DAVIES' REQUESTS OF 2026-09-23 ~10:20 UTC**, in order:
   1. **Labels: DONE** (`466d7ec`): "Agents (beta)" in the menu and title;
      "funded (Paper)" / "deployed (Paper)" on both VENUES cards with the
      paper capital row gone and no real balance shown; "DEPLOYED (Paper)"
      on the scoreboards (`paperOnly`, so the label goes when a row is live).
      The deployed labels went again at 13:44 on his word (000000.3).
   2. **Binance runs the same strategies on paper: DONE** (`634dd5b` the
      venue, migration `0049` the three twins; reference §4.29). Feasible:
      five coins TRADING, $5 minimum, tighter books, 10 bps a side. Their
      decisions are the Revolut X rows'; they are for the page, paper only
      by constraint. The go-live draft is `0051` now (`0050` became the
      maker-probe correction, item 3).
   3. **Venue-unique strategies from first principles, NOT the existing
      rulebooks: DONE — nothing worth money** (reference §3.26, review
      `reviews/2026-09-23-first-principles-study.md`). 31 ideas, 25 killed
      by arithmetic, four pre-registered tests, all reproduced byte for byte
      here. The one small edge, 0 % quotes 0.1–0.3 % either side of
      interbank on Revolut X's USDC/GBP and USDT/GBP books (+$4.68 on
      $1,200 in 13 out-of-sample days, ≈ $0.35 a day), is a FOUR-WEEK PAPER
      TEST CANDIDATE, not seeded: it needs GBP/USDC/USDT working capital and
      a quote loop the tick does not have. **DAVIES DECIDES** whether to
      build that forward test. Binance's stablecoin-tail quotes pass and earn
      ≈ 1.5 %/yr, below cash. **The search found a production bug, FIXED**
      (reference §4 item 30, migration `0050`): Revolut X's UK 1-minute
      candles move on quotes while nothing trades, and the tick resolved all
      three maker probes on such minutes; a fill now needs a trade through
      the price (`tradedThrough`), the proving minute is kept (`fill_minute`),
      and `0050` corrected probes 1–3 (first trade through: 8, 43, 7 min, not
      1, 3, 1). **Landed and checked 13:21 UTC**: `0050` applied (on the
      second attempt, see below), probes 1–3 read 8/43/7 min with their
      proving minutes, agents redeployed 13:17:08, and the four ticks after
      it answered 200 with no error. Still to see: the next probe that fills
      carries a `fill_minute` whose volume is above zero.
   5. **CI flake: FIXED 2026-09-23 on Davies' word** (000000.4): migrations.yml
      failed its first attempt in "Install Supabase CLI" — `setup-cli` with
      `version: latest` asks GitHub's API for the latest release without a
      token and hit the anonymous rate limit before any migration ran; the
      one re-run passed. edge-functions.yml has the same step. Pinning the
      CLI version, or giving the step a token, removes the lookup; until
      then a failed migrations run must be read, because the function can
      deploy without the column it writes.
   4. A second repository, `daviesluo/personal`, was cloned into the
      session: it is EMPTY; Davies will say what it is for.

0000. **DAVIES' REQUESTS OF 2026-09-23 ~06:20–06:45 UTC**, in order:
   1. Jev on the paper rows: **(c)** — and "每个策略的jev都可以有自己的
      设计": momentum-1d and trend-1h each get their OWN question, measured
      on every state and priced before the loop asks it. **DONE: neither
      clears the bar** (reference §4.28, review
      `reviews/2026-09-23-jev-row-questions-study.md`). trend-1h's wording
      decides every state exactly as v2 does (all 1,843 priced cells equal
      v2's). momentum-1d's replies still follow the 4-hour words, so its
      threshold (0.77) refuses almost every entry: 2–7 of 30–55 a window,
      bear year −9.0 → −0.1 %, bull year C +104.4 → +7.1 %; it beats a
      random veto under the shipped stop (P 0.050 / 0.039) and loses under
      the trail (0.968 / 0.959), and the bar asks for all four. Production
      is unchanged: every row asks v2 at 0.45. **DAVIES DECIDES** for the two
      paper rows: keep the v2 gate, or shadow them (`params.jevGate: false`).
   2. SUI's live seat: his call handed to the session ("删了也行").
      **DONE: paper only** (reference §3.20's addendum). The go-live draft
      adds BTC/ETH/SOL/AVAX at four $25 slots on $100; the paper
      `trend-4h` keeps all five.
   3. "Does Binance / Deribit data improve the strategies?" — answered
      from §3.21 and §3.22: no tested use does; the value is Binance as a
      second venue with its own strategy (4).
   4. **VENUES on the Agents page: Kraken out, Binance in**, a Binance
      theme colour, and the PAPER badge recoloured so it cannot be read as
      Binance. Kraken's public candles stay the signal. **DONE**
      (reference §4.27): Binance's card is its account, read-only; PAPER
      is a neutral dashed badge — he turned down pink, and every other hue
      measured too close to blue, yellow, gain or loss. Screenshots sent.
   5. **Revolut X and Binance each need a strategy of their own** — the
      same rule on both is pointless. **Studied: neither has one the
      evidence supports** (reference §3.23, §3.24): maker-only rules on
      Revolut X's 0 % fee, 0 of 6 pass; cross-sectional momentum over
      Binance's whole USDT list, 0 of 7, worst windows −64 to −79 %.
      **Second search, DONE** (reference §3.25): reversal and low
      volatility over the same list, 0 of 6 — all six lose window A;
      reversal loses to random picks, low volatility beats them only by
      holding the calmest (largest) coins. Chance: 0 of 13 over both
      searches against 0.011 expected. No Binance row is proposed.
   6. **The fixed $20 per-order cap: removed** ("单笔上限删了吧，之后测试
      表现好的话我还会再加资金的"). An entry is its row's slot; reference
      §4.26. **DONE**: the tick (`ef28a06`), then migration `0048`
      dropping the column; the go-live draft is `0050` now (`0049` became
      Binance's paper twins).

000. **DAVIES' REQUESTS OF 2026-09-23 (~02:10 and ~02:35 UTC)**, in order:
   1. Root: `AGENTS.md`, `LEDGER.md`, `README.md`, `package.json`,
      `vite.config.js` still held root slots — **DONE** (item 00.1).
      `.ledger` merged into `.agents/skills/ledger` — **DONE** (`d86dcea`).
   2. Phone screenshots in the README — **DONE** (`7b12ba5`).
   3. "Were R's three blockers and the medium issues all fixed?" —
      **audited, yes** (`ec61952`, reference §4.24): all 18 fixed and
      pinned but #15's paper-only half; B4's field names are confirmed
      only by the first live order.
   4. Binance / Deribit keys: **verified read-only** (`8288c82`, item
      0d). Uses and strategies: the desk research ranked four; three
      pre-registered studies price them.
      - **Sizing and entry gates: DONE** (reference §3.21): volatility-sized
        slots, a DVOL gate and a funding gate all fail the bar; nothing
        changes.
      - **Binance's costs: DONE** (reference §3.22): no verdict changes —
        the worst window stays, SUI's seat stays undecided, no coin
        clears. **The paper rows' Jev gates: DONE** (reference §4.21):
        both fail the bar; the choice is Davies' (item 6).
      - The backup of both studies' half-finished state stays on
        `claude/repo-audit-restore-uverhn` (`ddb4c67`); nothing there is
        needed any more.
   5. `src/` has too many files: sort it into subfolders — **DONE**:
      `app/`, `portfolio/`, `prices/`, `charts/`, `board/`, `tables/`,
      `agents/`, plus `e2e/` and `public/`; the top of `src/` is only the
      npm project's own files, `index.html` and the test setup.
   6. "What did the Jev and SUI studies find, and what is next?" — the
      answer is item 00.3 and reference §3.20. **The paper rows' gates are
      now priced (reference §4.21): neither clears the bar.** DAVIES
      DECIDES: leave the gate on those two rows, shadow them
      (`params.jevGate: false`), or write momentum-1d its own question
      (v2 speaks of the 4-hour picture), measure it on every state and
      price it before the loop asks it. **Davies chose (c) on 2026-09-23,
      and added that every strategy's Jev may have its own design**:
      momentum-1d and trend-1h each get their own question (item 0000.1).
      **SUI: decided the same day, paper only** (reference §3.20's addendum).

00. **DAVIES' FOUR REQUESTS OF 2026-09-22 ~20:15 UTC, in hand from
   23:35 UTC.** His usage window closed before any was begun.
   1. ~~Root: fewer files still.~~ **DONE 2026-09-23** (history entries
      of 01:13 and 02:13–02:17 UTC; the second round after he said a
      re-pointed root file still holds its slot; a third on 2026-09-23
      after he named `package.json` too: the npm project — `package.json`,
      the lockfile, `tsconfig.json`, `.nvmrc` — is now `src/`, with the
      browser tests in `src/e2e/`). `bin/` holds the hook, `setup.sh`,
      `gates.sh` and `knip-edge.sh`; `public/`, `eslint.config.js` and
      `vite.config.js` are in `src/`. The root is folders plus
      `LICENSE`, `wrangler.jsonc` and three dotfiles. No `cloud/`: `wrangler.jsonc` has to stay at
      the root, and `supabase/` alone in it would not remove a root
      entry. **Tell him: every clone of his (Mac, Cursor) must run
      `git config core.hooksPath bin/hooks` once, or the ledger hook is
      silently off there.**
   2. **README much shorter, plain, in his own voice.** "目前readme太长了，请精简，
      没用的东西也可以删了，确保逻辑清晰，并且所有语句措辞也清晰不绕弯，而且没有ai感像我本人自己写的".
      **DONE 2026-09-23** (entries of 01:16 UTC and 01:25 UTC).
      README 275 KB → 10 KB in his first person; the map's file table
      191 KB → 18 KB, one line per file, pinned complete by
      `src/docs_map.test.js`; the guide 34 KB → 10 KB of plain how-to.
      The long versions stay in git (`75cd4e1`).
   3. ~~Jev: fix the configuration, do NOT shadow it.~~ **DONE
      2026-09-23 (reference §4.21, review `2026-09-23-jev-question-fix.md`,
      migration `0047`).** v2 question + threshold 0.45 chosen from the
      measured replies before any backtest; every state decided the same
      way on every call; priced A +9.6 / B +19.5 / C +58.2 / D −7.8 %
      (rulebook +8.0 / +20.1 / +55.6 / −7.8). Worst window unchanged, A
      and C better in all four evaluations, inside chance. Watch the paper
      rows' first v2 decisions; momentum-1d's gate is unpriced.
   4. ~~"30 Sept" → "30 Sep"~~ **DONE 2026-09-23**: one month table
      (`MONTHS`, `fmtDayMonth`, `fmtMonth` in `src/app/formatters.js`) for the
      earnings panel, both chart modules and the Agents page.

0a. **WORK IN FLIGHT (as of 2026-09-22 23:35 UTC).** Every sub-agent died
   on the usage limit at ~20:20 UTC. **The main working tree is the
   agents' sandbox** (uncommitted, reviewed by nobody yet); a backup of
   it is on branch `claude/repo-audit-restore-uverhn` (`79a7ad4`, a
   backup ref only: no PR, never merged as is). The main session
   integrates from a clean worktree at `origin/main` and pushes from
   there. Nothing an agent reports is repeated as fact until recomputed.

   **R — pre-live fixes: SHIPPED (reference §4.24), AUDITED 2026-09-23**
   against R's own reproductions: all 18 fixed and pinned but #15's
   second half (paper only, cannot arise under the new-row go-live).
   **R — details:** Reviewed line by
   line and integrated from the agents' tree, with three more fixes of
   my own, each pinned and red on the old code: a marketable fill is
   dated from its own row (flag E: a buy settled after the floor sold it
   read as a phantom long), PostgREST's `code` + `message` go ahead of
   the failing row so `ops_errors` keeps the constraint (flag F), every
   tick error is kept in `context.errors`; plus #16 (`stepDecimals`).
   Flag A settled: the venue's own TypeScript client and CLI set
   `time_in_force` (gtc/ioc) at placement, so the code stays; the fake
   venue now refuses what that client refuses. Left, paper only: #15's
   tick half (cannot arise under the new-row go-live). **Merging this
   redeployed every Edge Function (`_shared/` changed): check decisions
   and `ops_errors` after the deploy, not the basis.**

   **S — SUI's seat: DONE, committed (reference §3.20).** Keep SUI in
   the live row as the incumbent: the pre-registered test is undecided
   (p(worse) 0.178 / 0.256; deciding it needs ~24 years of folds). Keep
   it in paper too. Its admission does not survive the running stop
   (window A only), and its median round trip is ~33 bps, not ~42.

   **Venue survey: DONE, committed (`docs/agents/venue-survey.md`).**
   Brief Davies in Chinese; his answers to its §10 questions (US state and
   SSN/ITIN, HKID, stay small or scale, an always-on host, a long/short
   study) decide any next step.

   **J — Jev: fixed (item 00.3).** The shadow recommendation is gone.

   **K — Kraken history: DONE, committed (reference §4.23).** Stop
   researching Kraken; Davies moves the money to Revolut X (item 0c).

0b. **Public repository: prepared, the switch is Davies'.** He chose to
   publish THIS repository as it stands ("C方案": old personal records
   are acceptable if they are not prominent). Done: the demo book in the
   public bundle is fictional (`f1ad198`), the root is tidied (`56eeca7`),
   the README is scrubbed of every figure from the real book and its
   facts are checked (`1ca2962`). He flips visibility himself (Settings →
   General → Danger Zone). Phone screenshots: DONE 2026-09-23 (three,
   every amount masked, taken from his message). The Agents page's come
   after live.

0c. **Kraken money: Davies is withdrawing it and moving it to Revolut X
   (his decision, 2026-09-22; reference §4.23). The Kraken API key stays
   in use.** After he says the transfer is done: fire the read-only
   `?action=probe` through pg_net with the Vault `cron_secret` and check
   that the Revolut X balance the key sees includes it (the probe places
   nothing). No code or row changes; order sizes come from `agent_risk`.

0d. **Binance and Deribit keys: verified read-only 2026-09-23 02:24 UTC**
   (reference, "Binance and Deribit keys"). Both usable from the server;
   neither funded (Deribit cannot be from the UK). What they are FOR:
   `docs/agents/venue-survey.md` §11 (rules, reach, uses, limits); three
   uses priced and rejected (reference §3.21); the Binance-cost study is
   item 000.4. Nothing trades on either. His settings, when convenient: switch off Binance's "Enable
   Spot & Margin Trading" and universal transfer, and Deribit's
   `trade:read_write`, until a use is decided.

0. **Agents (crypto auto-trading) — paper since 2026-09-20 18:23 UTC
   (#211, `23d2fdd`).** Two review rounds from Davies landed (history,
   09-20 19:21 and 09-21 01:57 UTC). What the record says after the first
   night: 0 errors, 437 / 437 cron runs, ~90 observations an hour, Jev
   answering on every entry (no `provider: none`); positions: momentum
   BTC / ETH / SOL on both venues, rotation ETH + SOL on both, trend-1h
   ETH; trend-4h flat on both (no close above the prior 55-bar high yet —
   not a fault). Open:
   (a) **Every Revolut X quote before the region fix was one of the
   venue's two books at random** (UK / EEA: the client kept whichever
   ticker row came last, and the region-less candles are the EEA book's),
   so pre-fix marks, `agent_basis` rows and paper fills are not all this
   account's book; nothing is re-priced. Fixed in `_shared/revx.ts`
   (`REVX_REGION = "UK"`, `quotesForRegion`, `region=` on every public
   call; the probe reports the rows). **Verified 12:01 UTC**: the probe
   (fired through pg_net) shows `requested: UK` and one UK row per
   symbol — BTC 1.3 bps, SOL 4.2 bps wide; `agent_basis` since the fix:
   p95 3.0 bps, max 6.1, widest Revolut X spread 12.9 bps (before it:
   p95 5.2, max 68).
   (b) **Thin-book guard — BUILT 2026-09-22.** A long's stop is judged at
   the BID (`exitMark`), never the mid, and an ENTRY is refused when the
   book is wider than 50 bps (`WIDE_SPREAD_BPS`; `bookBps` on the decision
   row). An EXIT is never refused by it: a position that cannot get out is
   the worse failure. Measured the same day on the live UK book — BTC 1.6,
   ETH 3.2, SOL 4.2, AVAX 9.1, SUI 25.7 bps — so only SUI is within
   hailing distance of the ceiling.
   (c) The phone shows five columns per detail table (`ag-ph`); the rest
   need a wider screen. A retired strategy (`agent_strategies.retired_at`,
   `0038`) is hidden by the dashboard and skipped by the tick; its records
   stay. Un-retiring is a migration. (e) **AVAX (`0039`) and SUI
   (`0040`) on trend-4h, paper, both venues.** Watch their first entries
   (Kraken's AVAXUSD / SUIUSD candles feeding the signal, a fill on each
   venue, the $20 slot) and whether the paper record looks like the
   backtest — AVAX +12 % a year on the seeded parameters (9–10 trades)
   but NEGATIVE on the second walk-forward window (§3.8); SUI +14.5 % on
   the chosen parameters and −10.5 % on the seeded ones, with a 42 bps
   round trip. The bar is now two windows plus a $100k-a-day book
   (§4.15); a coin one venue lacks may run on the other alone (§4.16,
   Davies 09-21). Watches: POL (clears both windows, book too thin), LINK /
   HBAR / PEPE (three of four). Nothing joins momentum-1d or the rotation
   basket; the BTC-regime filter (§3.9) is the next rule candidate, to be
   re-tested on a non-bear window first. (d) Live is still three switches, all Davies'
   (`agent_strategies.mode`, `agent_risk.live_confirmed_at`, the gate),
   and the first live order needs his confirmation in the conversation.
   (f) **Pre-live review: the server half is SHIPPED (this commit) —
   every blocker B1–B7 and should-fixes S1, S3, S4, S5, S6, S8, S9, S10,
   S12, S16, each pinned; reference §4.17 is the itemised record, §3.10
   the portfolio study's verdicts.** Migration `0041` (unique index on
   `agent_orders (decision_id, requotes)`) applies on this push; the
   agents function redeploys. STILL TO DO (nothing blocking a Revolut X
   live start): S2's answer is in §3.4 and may change what goes live; the
   review's remaining item is S7's venue half —
   the Kraken key's nonce window is Davies' setting at Kraken, before any
   Kraken live row. (The retention gap is closed, reference §4.25:
   decisions, orders and probes are kept in full, ≈ 70 MB a year at
   today's ≈ 100 decisions and 3 orders a day.)
   (g) **Live is waiting on Davies' word, and only that.** The brief is
   `docs/agents/go-live.md` (rows, coins, mechanics, edge, both windows'
   returns, fees, caps, what can go wrong). Recommendation in it:
   **`trend-4h` on Revolut X live, everything else paper** — the rulebook
   with the most evidence, the tightest drawdowns, a trade count 20 bps
   survives, on the venue that holds USD; rotation is negative out of
   sample on both venues and its own stops make it worse, momentum
   carries 33–56 % drawdowns, trend-1h is on a plateau on no coin, and
   every Kraken row is blocked by GBP → USD and the nonce window anyway.
   The headline fact he must weigh: **of 21 shipped members not one
   clears the two-window bar**. When he says go, the switch is ONE
   migration, **drafted, dry-run and committed at
   `docs/agents/0050_go_live.sql.draft`** (renumbered from 0047, 0048 and
   then 0049 on 2026-09-23; `enterMin` 0.45) — deliberately NOT under
   `supabase/migrations/`, because a file there is applied by
   `migrations.yml` on the next push, so MOVING it is the act of going
   live. It adds `trend-4h-live` as a new row (rather than flipping
   `trend-4h`, which would strand three paper positions and cost the live
   row its same-venue control), sets `live_confirmed_at`, and raises
   `max_exposure_usd` $100 → $150 for the mark-to-market reason in §4.19.
   **Since 2026-09-23 the draft's live row is BTC/ETH/SOL/AVAX, four $25
   slots, $100: SUI stays on paper** (reference §3.20's addendum; dry-run
   again that day: 3 → 4 rows, rolled back, production untouched).
   **The pre-live verification is done (2026-09-22, §4.19 and go-live §9)
   and found one real defect, now fixed: a position did not carry the mode
   it was opened in.** One box is left and it is Davies': run the
   read-only `probe` — **run 14:05 UTC and green**. The Jev question is
   fixed (item 00.3): with the v2 gate the bear year reads +9.6 %, not the
   −1.0 % the old gate gave it. Before arming, re-run the probe (Kraken's
   money is moving to Revolut X, item 0c). Then watch the first live order: its read-back is what verifies
   Revolut X's settlement field names (B4), and the page raises a banner
   if it is left pending.
   Kraken holds £75 GBP, not USD (probe 09-20 19:08 UTC); a live Kraken
   order needs the GBP → USD conversion first, and that waits for his
   word. **Usage rule**: no main-model polling and no scheduled check-ins;
   he asks when he wants a look.

1. ~~Cloudflare's edge still serves five cached copies of the old
   exposure.~~ **Clear, re-checked 2026-09-23 01:27 UTC**: all five
   paths return the app's `<!DOCTYPE html>` shell on
   `daviesportfolios.pages.dev` and on `daviesluo.com` (`/docs/handover.md`
   too). The note below is the history.
   **Was: Cloudflare's edge still serves five cached copies of the old
   exposure, for up to seven days.** (Related, 2026-09-21: the same
   not-found fallback also inherited the assets' one-year `immutable`
   header and poisoned browsers' copies of new chunks during a deploy —
   fixed in `_headers` and with `404.html`; see that day's entry.) The ORIGIN is fixed — every path
   not in `dist/` now returns the app's HTML shell, confirmed on paths
   never requested before and on cache-busted requests to the five.
   But `/LEDGER.md`, `/handover.md`, `/src/app.jsx`, `/package.json`
   and `/supabase/functions/auth/index.ts` were cached at the edge with
   `s-maxage=604800` while they were still real files, and
   `cf-cache-status: HIT` says they are still being served from there.
   They were cached BY THIS SESSION'S OWN VERIFICATION FETCHES — no
   other path shows a cache entry at all.
   Nothing can evict them from here: `*.pages.dev` has no zone to purge
   and Cloudflare ignores a client's `no-cache`. They expire on their
   own within seven days of 2026-09-18 08:50 UTC. Re-check with a plain
   `curl https://daviesportfolios.pages.dev/LEDGER.md | head -1` — the
   app's `<!DOCTYPE html>` means clear.

2. **Rotate both app passwords and `APP_AUTH_SECRET`.** The site
   stopped publishing the repository on 2026-09-18 (see history), but
   `supabase/functions/*` sources — including `auth` — were readable by
   anyone for months before that. Nothing suggests they were: five
   failed logins in the auth table's whole history, none in 30 days.
   Rotating is cheap insurance, and it is Davies' to do: change
   `APP_ADMIN_PWD`, `APP_RO_PWD` and `APP_AUTH_SECRET` in the Supabase
   dashboard's Edge Function secrets. Changing the secret invalidates
   every issued token, so every device re-prompts once.

3. ~~Check the `RECORDED` provenance rule has walked left across the
   24H window.~~ **Confirmed 2026-09-18.** The browser sweep now serves
   recorded rows shaped like the real feed (recording starts 30 days
   back) and asserts the pair that carries the evidence: 24H draws NO
   handover rule — the window is wholly recorded — while 3M still draws
   one, because its window opens before recording began. The 3M half is
   what proves data reached the panel at all; run against an empty feed,
   3M fails and 24H passes vacuously.
4. **The AH-trust fix has not been exercised, because nothing has moved
   fast enough.** Measured 2026-09-18 over every recorded sample: the
   largest single five-minute step in THIRTY days of after-hours is
   1.77 % (2DG.SG, 09-16), and overnight it is 0.79 %. `ahQuoteTolerance`
   doubles the biggest step and floors at 3 %, so it has sat on its
   floor the whole time — the scaling engaged once, at 3.54 %, and never
   mattered. The fix is dormant, not wrong, and the field test this item
   was waiting for has simply not occurred. Nothing to do but leave it;
   the BE case is pinned with its real numbers, with a control (same gap,
   quiet tape, still rejected) and now a third pin for WHY the lookback
   is a bar count — see the history entry.
5. **Decide what `Model:` carries in this ledger's source headers.** The
   protocol wants the exact model in every header. This session runs
   under an operator rule that forbids putting a model identifier into
   anything pushed to a repository, so its headers say
   `not recorded (session policy)`. A session without that rule should
   write the real model. Davies decides whether to backfill.
6. ~~Issue #207~~ **Closed 2026-09-18.** Was (`edge-functions failed on main`, opened 2026-08-18)
   is stale — that workflow has been green on every push since. Close it
   or leave it for the next real failure to bump. Still open and
   still stale, re-checked 2026-09-18.

Nothing else is in flight. `main` is clean and pushed.

## Machine and platform setup

A rebuilt container loses every line below. Run them before working.

    git config user.name "daviesluo"
    git config user.email daviesluo@gmail.com
    sh bin/setup.sh

  `bin/setup.sh` sets `core.hooksPath bin/hooks` (the ledger hook moved
  from `hooks/` on 2026-09-23: a clone still pointing at `hooks` runs NO
  hook, and git says nothing, until it re-runs this), `ledger.path
  docs/LEDGER.md` (this file left the root the same day; a clone still
  set to `LEDGER.md` is stopped at its next commit with "the ledger does
  not exist", which is the cue to re-run it), and `npm ci` in `src/` (the
  web app's npm project moved there on 2026-09-23; a root `node_modules`
  left from before is dead weight and can go). It leaves the identity alone because the repo is meant
  to go public and a stranger's setup must not commit as Davies.
  `sh bin/gates.sh` runs every CI gate in CI's order and warns when the
  hook is off.

Facts a fresh session would otherwise rediscover:

- **Node 22** (`src/.nvmrc`). npm 10.x. Every npm command runs in `src/`.
- **The Edge Function checks run on Deno 1.46.3 through npx**
  (`npx --yes deno@1.46.3 test --allow-env supabase/functions/`), the
  version CI's `setup-deno` `v1.x` resolves to; this container has no
  `deno` of its own. A bare `npx deno` fetches Deno 2, which CI never runs
  — and which `bin/gates.sh` used until 2026-09-23 03:06 UTC.
- **The app sweep is now a normal gate**: `npm run verify:browser`.
  Playwright is a devDependency, so `npm ci` brings it. Chromium is
  preinstalled at `/opt/pw-browsers` in this container — do NOT run
  `playwright install` here; point the sweep at it instead:

        cd src && PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run verify:browser

  CI runs `npx playwright install chromium` and needs no such variable.
  The performance matrix is a gate too since 2026-09-23:
  `npm run verify:perf` (same Chromium variable). Its clock is pinned;
  `PERF_MATRIX_CLOCK=<instant>` moves it, and an instant its fixture
  cannot serve is refused with the reason.

- **The container clock has been wrong before.** On 2026-09-05 it read
  91 minutes behind the database, and that alone produced a false outage
  report. On anything time-gated, take the time and the WEEKDAY from the
  database (`select now()`), not from `date`.
- **Gates, all of which must pass before a push:** `sh bin/gates.sh`
  runs them in CI's order — typecheck, lint, vitest (**check the exit
  code, not the summary line**), build, both browser tests, size-limit,
  knip (twice: the web app, then the Edge Functions through
  `bin/knip-edge.sh`), the npm audit, `deno check` and `deno test`. Commit the `dist/`
  the build writes with any `src/` change; the source maps it also
  writes are gitignored.

## History, newest first

Closed operations move verbatim into `docs/handover.md`, whose Part 2
(decision log) and Part 3 (transcripts) are this ledger's archive.
Everything before 2026-09-22 lives there already — the 2026-09-05 →
2026-09-21 sections under Part 2's "LEDGER.md history, archived
2026-09-22", oldest first.

### [2026-09-24 00:52 UTC] Platform: Claude Code | Model: not recorded (session policy)

**S1–S3 recorded in the reference as §3.30 (the BTC-regime filter, rejected), §3.31 (`trend-4h` at $50, D11 and D12)
and §3.32 (PR5 live, NO-GO).** This sitting closes here, on branch `worktree-agent-a0f7bbde042313d4f` (a worktree
off `96859b4`; `origin/main` has since moved to `07c6e44`), NOT pushed, per its instruction: `a4ea134` (S1
pre-registration), `321998b` (S1 run), `364b3fb` (S2), `f33fe5d` (S3) and this commit. Merge it rather than
cherry-pick, so `a4ea134` stays the pre-registration's commit that the study cites. **Left for the main session:**
- land D11's patch;
- build D12's fix (book what the account's balance shows);
- run Q1–Q3 and P1–P4;
- put the $50 amendment into the draft when Davies says go;
- update the Agents section's line in `.claude/CLAUDE.md` that still calls the BTC-regime filter a candidate.

### [2026-09-24 00:51 UTC] Platform: Claude Code | Model: not recorded (session policy)

**S3: PR5 live is a NO-GO now — a build, not a switch, and $50 is not the reason to do it**
(`reviews/2026-09-24-pr5-live-design.md`, `backtests/pr5_live/`, the frozen simulator imported unchanged and
reproducing `posthoc_new_regime.json` exactly). At $50 the frozen shape made $0.576 on 102 trips in the 28 tightened
days — $0.021 a day, 15 %/yr — while still sending 205 orders a day (441 at most), as at $1,200. It needs about £19 of
GBP and $12.50 each of USDC and USDT (the venue lists USDC/USD, USDT/USD and both GBP books, no GBP/USD; converting costs
about $0.09), a POST governor (entry quotes off at 600 a day, stops only at 700), a hard limit per risk, and a nine-item
build list, ending in a separate sub-account and key. The paper engine's first nine hours should show 128 orders and no
round trip (queries P1–P4, not run). Nothing needs Davies until the four weeks end on 2026-10-21.

### [2026-09-24 00:50 UTC] Platform: Claude Code | Model: not recorded (session policy)

**S2: `trend-4h` at $50 — GO on Davies' word, after D11's patch and with the first buy read by a person**
(`reviews/2026-09-24-trend4h-golive-validation.md`, `backtests/golive50/`, public data only, no database read). (a) The
paper row's life replays bar for bar with the loop's own functions: ETH 09-21 00:00, BTC/SOL 08:00 entries with the
recorded states, 80 decisions, $0.036 of fees; ETH's 3×ATR exit on the 09-23 12:00 bar is predicted (queries Q1–Q3 in
the review confirm it, not run). (b) 12 unscored bars: −$1.31 against buy-and-hold's −$2.23. (c) Four $12.50 slots
clear every venue rule; the daily limit is inert at $50 and stays $5; amendment to the draft (not applied): capital 50,
exposure cap 15 → 30 → 75. **Two conditional defects, both a buy fee taken in the coin leaving the book "long" for
good: D11 (reported at full precision: a sub-step remainder) — fix + pin in `reviews/2026-09-24-golive50-patches/`,
tested on `07c6e44`, NOT applied; D12 (taken but not reported: D8's derived dollar fee books the gross) — reproduction
only, red on `07c6e44`, fix to build.** Left for the main session: land D11, build D12's fix, and fold both into the
go-live item; this branch is based on `96859b4`.

### [2026-09-24 00:45 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The stablecoin row's NEXT reads whole** (Davies: the cell was cut off). Measured in the bundle:
"every minute" needs 93 px, the table gives NEXT 66 px at 1400, 1024 and 800 px wide, so it read
"every mi…"; the phone's card (338 px) and every strategy's countdown fit. It now breaks between
its words inside the row the name cell already makes two lines tall (66 of 66 px, row height
unchanged at 43 px). Sweep 240 → 242: the desktop check fails on the previous bundle; the phone
one guards the card. All gates green on this tree.


### [2026-09-24 00:41 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The Agents page opens drawn, the first time after a reload too** (Davies: "every time I open it
I have to wait for loading"). Measured with every answer held 2 s: opened right after a reload it
said "Loading…" until the dashboard answered (~2.6 s) and asked for it twice; opened 1.6 s after its
chunk had arrived it still showed its code frame ~290 ms (React.lazy suspends a first render
whatever is in memory, then React holds the fallback). Now the last dashboard and each strategy's
first chart are kept in `dp.agentsCache` (capped; masked at render when values are hidden), a
request already out is joined, and `lazyPage` renders a page whose code is here directly (every
menu page and the ticker modal gain it). Sweep 236 → 240: the four new checks fail on the previous
bundle; section 0 now holds the chunk until released, as its 700 ms hold passed only because of
that frame.

### [2026-09-24 00:18 UTC] Platform: Claude Code | Model: not recorded (session policy)

**S1 run: the BTC-regime entry filter is REJECTED** (`reviews/2026-09-24-btc-regime-study.md`, result
`backtests/btc_regime/btc_regime.json`, two runs byte-identical, sha256 `c30e5826…`). It makes the live row's worst window
worse in all four evaluations — D (sideways) −7.81 → −11.58 % on the shipped stop, −3.20 → −8.13 % under the trail —
and worse than 95–99 % of random vetoes of the same size; no fixed N rescues D. It helps only the bear year A
(+8.51 → +14.61 %, beyond chance), and in the fresh non-bear windows it costs G (+54.9 → +30.9 %) beyond chance on three
evaluations of four and H on both trail ones. §3.9's last written-down candidate is closed; no paper twin.


### [2026-09-24 00:18 UTC] Platform: Claude Code | Model: not recorded (session policy)

**A reload paints what the page last showed** (Davies: every open showed other numbers, then
"Computing…" and a flat line on the vs-S&P chart, then jumped). Measured in the committed bundle
with every answer held 2 s: PORTFOLIO read the cached row's prices, the server row's, then live;
the chart said "Computing…" until the network answered, then drew +0.00 % flat until the holdings'
batch landed. Causes: the chart store's `ytd` and `maCache` object stores NEVER EXISTED (idb-keyval
makes a store only when the database is new, and all three shared one: after a session only
`tickerChart` was on disk) — now one `dp-charts` database, schema v2 drops the old one; the 24H
chart now paints from `dp.perfSeed`, waits for the store, and never draws the benchmark alone; the
prices last shown (`dp.lastPrices`, `portfolio/shown_prices.js`) are drawn over a copy of the book
until live quotes land, never saved (pinned). Sweep 230 → 236, the six new checks fail on the old
bundle. `.claude/CLAUDE.md` still quotes 230 checks: not edited from a subagent.

### [2026-09-24 00:08 UTC] Platform: Claude Code | Model: not recorded (session policy)

**S1 pre-registered before any arm ran: §3.9's BTC-regime entry filter on the live row** (Davies' request of
2026-09-24: two strategies live at $50 each after a final validation, and the one pre-registered candidate left).
`reviews/2026-09-24-btc-regime-prereg.md` freezes the filter as §3.9 wrote it (BTC's last closed daily close above its
N-day average, N from {100, 150, 200} chosen in sample per window), the four-coin `trend-4h-live` sleeve as the
incumbent (reproduced to the digit against `sui.json` and `set2.json`), windows A–D plus four FRESH windows E–H
(2018-08 → 2022-08, BTC/ETH, never scored out of sample), the bear label (equal-weight buy-and-hold below −20 %: A and
E; B, C, D, F, G, H not bear), a same-count episode null, and the bar (improve the worst window, beat chance there,
cost no other window beyond chance → adopt / reject / inconclusive). Script
`backtests/btc_regime/backtest_btc_regime.ts` committed with it (sha256 in the file); only its definitions and a
placebo-gate smoke stage have run. It discloses that §3.17 already found the gate worsens window D at sleeve level.


### [2026-09-24 00:00 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The go-live audit's last three are fixed** (item 0000000.1; Davies un-paused the preparation,
not the go). D8: a fill read back with no fee field settles with the schedule's fee, recorded as
`feeDerived` beside the venue's reply. D9: every marketable order records the touch it was
priced from and that quote's age. D10: a lease claim the database does not answer is a note, not
a crash. Four new pins in `golive.test.ts` fail on the old code; lifecycle stage 7 now reads a
reply with no average price, the one still refused. Deno: 455 passed, check clean.

### [2026-09-23 21:35 UTC] Platform: Claude Code | Model: not recorded (session policy)

**A T212 history timeout is a failed page, not an unhandled crash** (item 00000000.3). Both
page fetches go through `historyPageRequest`, which turns a timeout or a dropped connection
into `{ ok: false, status: 0 }`; the walk keeps its cursor and records `last_error`. Pinned in
Deno, and the test fails with production's "Signal timed out." when the catch is removed.

### [2026-09-23 21:33 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The quote test is a row of TESTING STRATEGIES with a page of its own** (item 00000000.2).
`quotesSummary` now carries each book (`quoteBookView`: rungs, the held rung marked at the last
print, trips) and the newest 20 trips, pinned in Deno; `quotesRow` and `quoteLadderRows` in
Vitest; the sweep (230) opens the row's page at both widths. Nothing the loop reads changed.

### [2026-09-23 21:05 UTC] Platform: Claude Code | Model: not recorded (session policy)

**A viewer no longer sees the transaction history or the INVESTMENT view** (item 00000000.1):
`PerfPanel` forces the vs-S&P view and drops the tabs when `isReadOnly`, the ☰ menu leaves
the entry out, and `app.jsx` will not open the modal. The sidebar's copy of the panel is the
one phones see, so it takes the flag too. Sweep 222 → 226 checks. Go-live and the DecisionFC
review are paused on Davies' word.

### [2026-09-23 20:25 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The live execution path's audit defects D2–D6 are fixed** (P2–P4, with the two corrections
the new tests found in the audit's own patches; item 0000000). Paper rows change in two
places only: the trail counts the high of the bar an entry filled in, and the cooldown is
counted in bars, both as the backtester already did.

### [2026-09-23 20:15 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The go-live draft no longer arms itself** (audit P7): moving it into
`supabase/migrations/` creates `trend-4h-live` with entries refused and a $30 cap; the
confirmation is one statement in the conversation where Davies says go. CLAUDE.md and
`go-live.md` say so. The D1 fix is live (deploy re-run after a ghcr.io rate limit), and D2–D6
reproduce on `main`; P3 needs a `getOrder` after its history lookup before it can settle.

### [2026-09-23 20:07 UTC] Platform: Claude Code | Model: not recorded (session policy)

**D1 of the go-live audit is fixed**: a Kraken fee-tier timeout no longer throws out of
`runTick` before the tick begins (P1). `runtick.test.ts` reproduces production's crash on the
old code and passes on the new; the next minute does not call Kraken again. `agents.crash`
rows now name the action and the top of the stack, which the four "Signal timed out." rows
could not. D2–D4 are next (item 0000000).

### [2026-09-23 20:00 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The third search and the go-live audit are on record.** fp3: reference §3.29, the study,
its three pre-registrations (committed verbatim, hashes as frozen), scripts with the research
paths replaced by `FP_ROOT`, results; all three tests re-run here byte for byte (ZF
`37ec1bdf…`, CB `103a3eae…`, DL `84883e09…`), DL again from the committed copy, and the
price range rule read live from Binance's public endpoint. The go-live audit is committed as a
review with its patches, applied to nothing; D1 is re-computed, D2–D4 are next (item 0000000).

### [2026-09-23 15:30 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The quotes card is live and reads production** (`2b3a525`): the Edge deploy finished
15:28:41; the dashboard, called with the cron secret, returns `quotes` running, two minutes
behind, 12 orders today, no fills yet; daviesluo.com serves the committed `app-71f1cb28.js`.
Davies' newest requests (the go-live audit, a third search) are item 0000000, both running as
background agents.

### [2026-09-23 15:27 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The paper quote test has its own card on the Agents page**, under the strategies:
funded (Paper) $1,200, realised and today, round trips and share won, open, orders today of
1,000, and a red border with the reason if it stops (`quotesView`; the dashboard's
`quotesSummary`, null until its tables exist). Its own classes share the venue cards' rules;
the sweep checks the card's figures and that no venue selector reaches it.

### [2026-09-23 15:19 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The second first-principles search is on record** (reference §3.28, review
`reviews/2026-09-23-fp2-study.md`, its two frozen pre-registrations, scripts with the
research-folder paths replaced by `FP_ROOT`, results). Nothing passed: T1 −$69.97, T2
−$99.81, T3 −$11.38 out of sample, re-run here byte for byte; trips were not re-derived (the
results keep per-book totals). The paper quote test has run since 15:09 UTC, one minute
behind the clock, with no error (checked 15:10–15:13).

### [2026-09-23 15:06 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The paper quote test is built** (`agents/quotes.ts`, migration `0051`, reference §4 item
31): `agents?action=quotes` on its own cron job runs PR5's frozen rule one minute behind the
clock, public reads only, into `agent_quote_*`. `quotes.test.ts` replays the simulator's five
golden windows trip for trip; counting a touch as a fill, or reading an unfinished hour into
fair, fails all five. The test double checks the new tables' columns, constraints and
ON CONFLICT keys (and now upserts are checked at all), knows PostgREST's `lte`, and the paged
order accepts a composite key. The go-live draft is unnumbered (`go_live.sql.draft`).

### [2026-09-23 15:06 UTC] Platform: Claude Code | Model: not recorded (session policy)

**PR5, PR3's rule on nine months of public prints, is on record**: the study with this
session's re-computation (freeze before results, byte-identical re-runs from the committed
inputs, 30 trips matched to the raw tape, the regime change measured independently, dust
checked), the frozen pre-registration, the simulator and pipeline, the inputs it reads
(3.6 MB gzipped), its results, the agent's paper-test spec, and `golden_windows.json` —
the simulator on five windows with its exact inputs, for the loop's engine. Reference §3.27.

### [2026-09-23 13:44 UTC] Platform: Claude Code | Model: not recorded (session policy)

**CI installs a pinned Supabase CLI (2.117.0)** in migrations.yml and
edge-functions.yml. Resolving `latest` asked GitHub's API without a token and was
rate-limited once today, before a migration ran. Bump the pin on purpose.

### [2026-09-23 13:44 UTC] Platform: Claude Code | Model: not recorded (session policy)

**"(Paper)" now sits beside funded only** (Davies: the label on funded is enough).
The page scoreboard, each strategy's scoreboard and both venue cards say DEPLOYED /
deployed with no label; `paperOnly` still decides funded's. The sweep pins all three
places, the strategy page's scoreboard for the first time. Two research agents are
running, each in its own scratchpad folder: PR3 re-tested on ten months of prints
(`research_pr5`), and a second first-principles search (`research_fp2`).

### [2026-09-23 13:22 UTC] Platform: Claude Code | Model: not recorded (session policy)

**`0050` is in production, and the tick runs clean on the new fill test.** The
migrations run failed its first attempt before applying anything: the Supabase
CLI install asked GitHub's API for the latest release without a token and was
rate-limited. One re-run passed. The three probes read 8, 43 and 7 minutes, each
with the minute that proved it; agents redeployed at 13:17:08, and the ticks at
13:18–13:21 returned 200 with no error. The flake and its fix are item 00000.5.

### [2026-09-23 13:13 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The Chinese-reply rule now opens `CLAUDE.md`**, after a fourth slip into English
following a context compaction ("怎么会话又变成英文了"). The skill is cut short at a
compaction; CLAUDE.md is loaded whole on every turn. The skill's three copies record
the fourth slip.

### [2026-09-23 13:13 UTC] Platform: Claude Code | Model: not recorded (session policy)

**A maker probe, like a resting paper order, is filled only by a trade through its
price** (`tradedThrough`, migration `0050`, reference §4 item 30). The tick read the
last minute's low/high with no volume check, and on Revolut X's quote-built UK
candles all three probes on record were resolved on zero-volume minutes. A fill now
needs volume > 0 and a price strictly through, and the proving minute is kept in
`fill_minute`. `0050` corrects probes 1–3 to 8, 43 and 7 minutes and clears their
marks; a dry run in a rolled-back transaction touched exactly those three rows. The
go-live draft is `0051_go_live.sql.draft` now, and the test double refuses an unknown
probe column. Counterfactual: the old rule fails the three new tests.

### [2026-09-23 13:13 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Davies' first-principles request is answered: nothing unique to either venue is
worth money** (reference §3.26, review `reviews/2026-09-23-first-principles-study.md`).
A research agent on public data derived 31 ideas, killed 25 by arithmetic and
pre-registered four tests. PR3 (0 % quotes either side of interbank on Revolut X's
USDC/GBP and USDT/GBP books) passes small: +$4.68 on $1,200 in 13 out-of-sample
days, a paper-test candidate, not seeded. PR2 (Binance's stablecoin tail) passes at
≈ 1.5 %/yr, below cash. PR4 fails; PR1 is void because Revolut X's UK candles are
built from quotes. Checked here before commit: all four reproduce byte for byte from
the committed scripts, and each pre-registration's hash matches and predates its
result. A fresh 1,000-minute pull and a 12-minute poll of the trade tape confirm the
quote-built candles. The inputs that expire (Revolut X 1-minute candles, kept 28
days) are committed gzipped.

### [2026-09-23 11:25 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The README's three phone screenshots are Davies' new ones** (his message, taken
08:27 BST today): tactics board, heat map, sidebar, replacing the 23:52 set under
the same names, so the README's table and alt text still describe them. Every
dollar amount is masked by the site's hide-values mode, as before; the same
920 × 2000 WebP.

### [2026-09-23 11:01 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Binance runs the same three strategies on paper** (migration `0049`, pushed
after `634dd5b` deployed and the 11:00 UTC bar decided with no error; reference
§4.29). Three twins copied from the Revolut X rows — kind, parameters, coins,
capital, Kraken signal — filled at Binance's touch plus 10 bps; their decisions
are the Revolut X rows'. Feasible there, measured today: five coins TRADING, $5
minimum, Binance's book tighter on all five, 10 bps against 9. Paper only by
constraint (`agent_strategies_binance_paper_only`); dry-run in a transaction
that raised to roll back: three rows, and a live Binance row refused. The
go-live draft is `0050_go_live.sql.draft` now. Sweep fixture six rows, 216 green.

### [2026-09-23 10:52 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The loop can run paper rows on Binance; none does until migration `0049`.**
`binancePaperVenue` (agents/binance.ts) reads Binance's PUBLIC market data from
data-api.binance.vision — api.binance.com answers 451 to a US address, this host
answered 200 from one — holds no key, and refuses every order call; a paper order
there takes the touch (`takesTheTouch`: maker and taker are both 10 bps) and pays
10 bps. The tick asks Binance only for its own rows' coins, so with no Binance row
nothing changes. The page's Binance card stops signing an account read on every
load (`binanceCard` removed): no real balance is shown since `466d7ec`. Pinned in
binance.test.ts and tick.test.ts; red with Binance resting or unquoted.

### [2026-09-23 10:46 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Agents page, Davies' labels** (his request, 2026-09-23 ~10:20 UTC): the menu
and the page say "Agents (beta)"; both VENUES cards read "funded (Paper)" — the
capital the venue's rows are allotted, the old "paper capital" figure — and
"deployed (Paper)", and the paper capital row is gone; the scoreboard and each
strategy's say "DEPLOYED (Paper)". The accounts' real balances are no longer on
the page ("账户真的fund没用，放在这里有误导"). One helper, `paperOnly`, decides the
label, so it disappears the day a row goes live or holds live coins. Sweep 216
checks; with the old card labels 8 of them fail.

### [2026-09-23 08:36 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Each paper row's own Jev question, priced: neither clears the bar**
(reference §4.28; `backtest_jev_rows.ts` → `backtests/jev_rows.json`; review
`reviews/2026-09-23-jev-row-questions-study.md`). The script first reproduced
`jev_v2_other.json` from the v2 replies at 0.45 (8,101 cells, 0 differences,
twice, identical bytes) and its check failed on a counterfactual threshold; the
pricing ran on the same script bytes, twice, identical output. trend-1h's
wording makes v2's decisions exactly. momentum-1d's 0.77 nearly switches the row
off and passes the null only under the shipped stop; the bar needs all four
evaluations. Production unchanged; the paper rows' gate is Davies' call.

### [2026-09-23 08:31 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Every test's components are unmounted after it** (`src/test_setup.js`). RTL
cleans up by itself only under vitest's globals, which are off, so every hook a
test mounted stayed mounted for the rest of its file; during a gates run under
heavy load an earlier test's NVDA poll counted 2 calls in the SFTBY overnight
test, and the gates went red on a change that touched no `src/` file. Pinned in
`charts/use_ticker_chart_data.test.jsx`: a later test sees 60 of an earlier
test's polls without the cleanup and none with it. All 930 tests pass with it.

### [2026-09-23 08:23 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Binance's universe, second search: reversal and low volatility — 0 of 6 pass**
(reference §3.25; `backtest_xsrev.ts` → `backtests/xsrev.json`; pre-registration
frozen 08:07:52 UTC before any candidate ran). All six lose window A; reversal
loses to random picks; low volatility beats them by holding the calmest, largest
coins, and BTC alone beat it in B, C and D. Verified here, not taken from the
agent: two re-runs from a clean `main` with the new files copied in wrote the
agent's bytes (`ffaf6e74…`), the Python re-implementation printed VERIFIED, and
the six hash-pinned files are unchanged. No Binance row is proposed.

### [2026-09-23 07:55 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The README's architecture diagram names Binance among the outside services**
the server calls (the VENUES card reads its account since `1b194e2`). The line
was measured in Chromium before the change: 312 px in a 400 px box.

### [2026-09-23 07:53 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Eight of today's history headers carried guessed times, 2–14 minutes late;
they now carry their commits' times** (the skill's rule: read `date -u` or the
commit time, every time). No entry's content changed.

### [2026-09-23 07:53 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Two lessons into `working-with-davies`** (all three copies): a study's
arguments are part of its output, so run it with repository paths and diff the
re-run before committing (the xsmom result carried a scratchpad path until it
was re-run); and read a rule's measured holding time before describing it (the
first draft of momentum-1d's Jev question said "weeks" where the median is
about three days).

### [2026-09-23 07:50 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Each paper row's own Jev question, measured** (`backtests/jev_answers_rows.json`;
pre-registration `reviews/2026-09-23-jev-row-questions-prereg.md`). Every entry
state ×5 through the production endpoint from the database: trend-1h 54 states,
momentum-1d 189, 0 echo failures, 0 missing answers; each batch's compact text
was checked against the database by MD5 before it was written. The
pre-registered rule gives trend-1h 0.47 (the lowest of three equally wide
deterministic bands; it vetoes the same six weak-trend high-volatility states
v2 does) and momentum-1d 0.77 (its replies overlap everywhere below 0.66; the
widest band vetoes 183 of 189 states). Committed now because `net._http_response`
is pruned in hours and this file is the only copy. Pricing is next.

### [2026-09-23 07:45 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Each paper row's own Jev question is written, frozen and deployable**
(reference §4.28). Two wordings, `v3-momentum-1d` and `v3-trend-1h`, frozen
with the threshold rule and the bar before the model saw them; they live in
`agents/jev_rows.ts` because six results pin `agents_strategy.ts`. The
measurement endpoint asks them (for their own rule only) and the tick asks a
row's own wording only when `params.jevQuestion` names it — no row does, so
nothing the loop does changes. Pinned: the text by hash, the fallback to v2,
the endpoint's refusal for another rule; red when the row param is ignored.

### [2026-09-23 07:34 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Neither venue has a strategy of its own the evidence supports**
(reference §3.23, §3.24). Two pre-registered studies, each re-run here on a
clean tree with the agent's exact bytes and then from the repository with
repository paths (only path strings and the file's own hash moved): maker-only
rules on Revolut X, 0 of 6 pass — the edge is no larger than the gap between
two tapes; cross-sectional momentum over Binance's 735 USDT pairs, dead ones
included, 0 of 7 — every worst window −64 to −79 %, below random picks. The
Binance data pipeline is in `docs/agents/scripts/xsmom/`, and the
exchangeInfo snapshot and Revolut X's pair table are committed inputs.

### [2026-09-23 07:20 UTC] Platform: Claude Code | Model: not recorded (session policy)

**VENUES is Revolut X and Binance; Kraken is off the page** (Davies;
reference §4.27). Binance's card reads the account read-only
(`binanceCard`, a minute's cache, 4 s cut-off) and the page pins the
dashboard to London, because Binance refuses US addresses. PAPER went
from gold (ΔE 7.1 from Binance's yellow) to a neutral dashed badge after
Davies turned down pink; the validator put every other hue within ΔE 15
of a colour already on the page. The chart takes the row's venue colour,
and a stablecoin reads as money. Browser sweep 212 green; the five new
checks per breakpoint are red on the previous bundle.

### [2026-09-23 07:00 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The Chinese-reply rule now says it survives a context compaction**
(`working-with-davies`, all three copies). After this session's resume the
progress notes between tool calls came out in English until Davies asked
why ("这个会话怎么又变成英语了") — the third time. The first line after any
resume is Chinese.

### [2026-09-23 07:00 UTC] Platform: Claude Code | Model: not recorded (session policy)

**SUI stays on paper and does not go live** (Davies left the call to the
session; reference §3.20's addendum). Real money goes only to the core
majors and to coins that clear §4.15's bar under the stop that runs: AVAX
does at Revolut X's cost, SUI clears window A only, on the thinnest UK
book. The go-live draft (`0049`) now adds BTC/ETH/SOL/AVAX at four $25
slots on $100, re-dry-run inside a self-rolling-back block (3 → 4 rows,
exposure cap $150; afterwards production still had 3 rows and no
confirmation). The paper `trend-4h` keeps SUI, so nothing in production
changes. The cost, stated in the brief: window A's drawdown 11.3 → 15.8 %
against window B +20.1 → +25.1 %; over the span where all five coins
exist, four $25 slots +81.8 % against five $20 slots' +64.2 %.

### [2026-09-23 06:56 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Migration `0048` drops `agent_risk.max_order_usd`**, pushed after the
slot-sized tick (`ef28a06`) had deployed; no view, function or policy
named the column, and both readers select `*`. The go-live draft is now
`docs/agents/0049_go_live.sql.draft`, and every reference to its number
moved with it. The browser sweep's fixture lost the column too.

### [2026-09-23 06:52 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The fixed $20 per-order cap is gone** (Davies; reference §4.26). An
entry is `slotUsdOf(row)` — capital over the positions the row can hold —
and `riskGate`'s per-order limit is that slot × 1.1, per row, so capital
added to a row that earns it makes its orders bigger. Nothing in
production changes size today: every row's slot is already $20 or less.
Four tests that asserted the $20 were rewritten to the slot, two pins
added (four $25 orders on a $100 four-coin row; an entry over 1.1× its
slot refused, a re-quote's drift inside it placed), each red on the old
sizing, on a 1.0 tolerance and on no limit. Next: migration `0048` drops
`agent_risk.max_order_usd` once this tick has deployed; the go-live draft
becomes `0049`.

### [2026-09-23 05:45 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The live row at Binance's cost changes no verdict** (reference §3.22;
`backtest_binance.ts` → `binance.json`; review
`2026-09-23-binance-cost-study.md`). Pre-registered, resumed after a usage
limit, run twice with identical bytes and re-run here with the same bytes.
Round trips on AVAX and SUI fall by 7–21 bps, but the worst window does not
move, SUI's seat stays undecided and no coin clears the bar; the one big
number (window A, +5.6) is a single SUI stop missed by 3 bps at the end of
its file. The venue survey's §11 now says so. The book samples the study
read are in `backtests/inputs/binance_books_2026-09-23/`.

### [2026-09-23 05:42 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The v2 Jev gate on the two paper rows is priced, and fails the bar on
both** (reference §4.21; `backtest_jev_other.ts` → `jev_v2_other.json`;
review `2026-09-23-jev-gates-paper-rows.md`). trend-1h's worst window
falls in all four evaluations; momentum-1d's bear year falls 4–15 points
as the loop runs it, once a day. The gate refuses ~65 % of momentum-1d's
entry signals but does not switch it off. The study was cut off by a usage
limit, resumed, moved out of `backtest_jev.ts` into its own file (that
file's hash is pinned), and re-run here with the same bytes. Also found:
momentum-1d's published numbers price a 4-hour cadence the loop does not
run. The choice for the two rows is Davies' (item 000.6).

### [2026-09-23 04:49 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Two lessons into the working-with-davies skill** (all three copies): a
file whose hash a committed result pins is not to be edited for tidiness
(grep `docs/agents/backtests/` for the hash first; add a file beside it
instead), and "fewer files at the root" means the file leaves the root,
not that it is re-pointed.

### [2026-09-23 04:46 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The venue survey has a §11 for Binance and Deribit** as Davies actually
holds them. Checked at the source: Binance has taken no new UK users since
2023-10-16 and existing ones keep spot; Deribit takes no UK retail client
(help centre, 2026-09-15); an Edge Function runs nearest its caller unless
pinned, and has no fixed egress address. The survey's "Binance:
unavailable" now reads as his existing account. The measured spreads are
recomputed from the raw paired samples, and SUI's saving is stated against
its 60-sample median rather than the night-time sample.

### [2026-09-23 04:40 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Three ideas from the Binance and Deribit research are priced, and all
three fail** (reference §3.21, review `2026-09-23-sizing-filters-study.md`):
slots sized by the coin's volatility, no entry while DVOL is in its top
third, no entry while funding is in its top fifth. Pre-registered before
any arm ran; the incumbent reproduces exactly; the result file came out
byte-identical in the study's two runs and in this session's re-run on the
committed tree. `backtest_jev.ts` now exports its machinery (the loader
moved into `loadMeasuredSeries`) and still writes the committed
`jev_v2.json` byte for byte. The DVOL and funding files it read are in
`backtests/inputs/`, since neither can be fetched again unchanged. Two more
studies were cut off by a usage limit; their state is item 000.4.

### [2026-09-23 03:33 UTC] Platform: Claude Code | Model: not recorded (session policy)

**`agents/backtest.ts` is back to the bytes ten results pin.** Its
SHA-256, `31d27c7d82f8a94c…`, is recorded as an input by `fill`, `jev`,
`jev_v2`, `jev_v2_063`, `kraken3`, `set2`, `sui`, `tape`, `testingset` and
`windows`.json and cited by their reviews. `676b9e6` changed one path in
one comment (`src/agents.js`), which changed the hash and would have made
every later re-run look like it ran a different backtester. The comment
keeps the old path on purpose: **do not edit `backtest.ts` for a comment;
change it only with a re-run of what it feeds.**

### [2026-09-23 03:06 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The local gates run the Edge Functions on the Deno CI runs.**
`bin/gates.sh` called a bare `npx deno`, which fetches Deno 2.9.6, while
`edge-functions.yml` asks `setup-deno` for `v1.x` — so "every gate CI
runs" was not true of the last two; it now calls `npx --yes deno@1.46.3`
(the last 1.x): `deno check` clean, 400 tests passed. `.claude/CLAUDE.md`
said Deno 1.x was preinstalled at `/usr/local/bin/deno`; this container
has no `deno` at all, so that caveat now says how to get the right one.

### [2026-09-23 03:03 UTC] Platform: Claude Code | Model: not recorded (session policy)

**`src/` is sorted into folders** (Davies: "src文件夹里文件也太多太乱了"):
`app/` (startup, the root component, sign-in, storage, error reports,
styles, formats, types, icons), `portfolio/`, `prices/`, `charts/`,
`board/`, `tables/`, `agents/`, with every test beside its module; the
two tests named after the retired `utils` barrel took the names of what
they test (`prices/network.test.js`, `portfolio/metrics.test.js`). 112
files moved by script and every relative specifier rewritten to point at
the same file (imports, `vi.mock`, JSDoc `import()` types); `index.html`
loads `app/main.jsx`. The map's client section is regrouped by folder and
its test now walks `src/` and wants each row named with its folder
(removing one row fails it, naming the file). Every chunk is the same
size but `table_export`, 4 bytes smaller: the icons module sits earlier in
it, so the minifier's names differ; no literal changed. Path mentions in
comments moved with the files — in five Edge Function files too, so this
push redeploys functions whose code did not change.

### [2026-09-23 02:50 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The web app's npm project is `src/`**: `package.json`, the lockfile,
`tsconfig.json` and `.nvmrc` left the root, and the two browser tests
moved from `bin/` to `src/e2e/`, beside the Playwright they import.
Davies named `package.json` among the files still holding a root slot;
Cloudflare does not build, so nothing outside the repository needs it at
the root. knip reads only code under its `package.json`'s folder, so the
Edge Functions now get their own run (`bin/knip-edge.sh`, a scratch copy
against `supabase/knip.json`); a planted unused export and an orphan file
are caught on each side, and the real tree is clean on both. The build
from `src/` is byte-identical to the old layout's in the same minute
(source maps aside, which are not committed). CI runs every npm step in
`src/`; Dependabot watches `/src`. Every clone: `sh bin/setup.sh` again
(`npm ci` now runs in `src/`).

### [2026-09-23 02:27 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Both new keys work, read-only, from the server** (reference, "Binance
and Deribit keys"). The probe ran once through pg_net at 02:24 UTC from
eu-west-2: Binance answers there (it refuses this container with 451),
the account is SPOT and unfunded at 0.10 % maker and taker, all five
live-row coins trade against USDT with a $5 minimum, and post-only and
exchange-held stop orders exist. The Binance key can read AND trade spot
and has universal transfer on, no withdrawals and no IP restriction.
Deribit authenticates; its token's scope includes trading and account
writes but no withdrawal; the account is empty, and DVOL reads (BTC
37.69, ETH 51.30). Nothing depends on either key yet, so both trading
permissions can be switched off at the venues until a use is decided —
Davies' setting, item 0d.

### [2026-09-23 02:23 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The probe can check the Binance and Deribit keys** Davies added
(`Binance_API_KEY` / `Binance_SECRET_KEY`, `Deribit_CLIENT_ID` /
`Deribit_CLIENT_SECRET`; neither account funded, Deribit unfundable from
here). Two read-only clients under `agents/` so only that function
redeploys: Binance signs with HMAC-SHA256 (pinned to the documented
example, which openssl reproduces) and reads account permissions, API
restrictions, trade fees and symbol rules; Deribit authenticates with
client credentials in a POST body and reads its scope, whether the
account holds anything, and DVOL. Neither can place, cancel or withdraw
(each has an allow-list the tests enforce), and the report carries no
key, token or amount. `?action=probe&only=binance,deribit` runs just
those two. From this container `api.binance.com` answers 451 (restricted
location); the project runs in eu-west-2, which the probe will settle.

### [2026-09-23 02:17 UTC] Platform: Claude Code | Model: not recorded (session policy)

**`vite.config.js` is `src/vite.config.js`, which ends the root round.**
Its root is now its own folder (`import.meta.url`), and the npm scripts
pass `--config`; knip finds it through those scripts (without the file it
reports `@vitejs/plugin-react` unused, so it is reading it). The build is
the same bundle: every file of `dist/`, hashes aside, has the committed
size; the dev server serves `/main.jsx` and `src/public/`. The root is now
`.agents .claude .cursor .github bin dist docs src supabase`, four dot
files, and five files a tool reads only there: `package.json` and its
lock (npm), `tsconfig.json` (plain `npx knip` finds it nowhere else and
then reports `ambient.d.ts` unused), `wrangler.jsonc` (Pages reads it only
at the root, and it is what keeps the repository off the site) and
`LICENSE` (GitHub detects a licence only at the root).

### [2026-09-23 02:15 UTC] Platform: Claude Code | Model: not recorded (session policy)

**`AGENTS.md` is folded into `.claude/CLAUDE.md`** ("better shown whole in
one place"). Of its 160 lines only the fresh-container section was its
own; the ledger, pull-request and how-the-owner-works parts repeated
CLAUDE.md. That section is now CLAUDE.md's "A fresh container", and
`.cursor/rules/instructions.mdc` (always applied) sends Cursor to the one
file; the skill's opening line follows. The one tool that loses anything
is Codex, which reads only a root `AGENTS.md`: `@codex` PR reviews would
run without repo instructions. It still finds the ledger skill in
`.agents/skills/`.

### [2026-09-23 02:14 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The README is `docs/README.md`, with the phone screenshots.** GitHub
shows a README from `docs/` on the repository's home page when the root
has none, so the front page left the root and its links became relative
to `docs/`. Davies' three phone screenshots (tactics board, heat map,
sidebar; 22 Sep 23:52 BST, every dollar figure masked, checked by eye)
went in as `docs/screenshots/phone-*.webp` under a Phone row; they were
recovered from the session record, where the attachments were kept as
webp. CLAUDE.md's front-page rule, the map, the guide's link and item 0b
follow.

### [2026-09-23 02:13 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The ledger and its package leave the root** (Davies, 02:00 UTC: a root
file a commit only re-pointed still holds a root slot; "can .ledger and
.agents/skills/ledger merge?"). They can: `.agents/skills/` is where
Cursor and Codex look for skills (the package's own install table), so
the vendored package now lives there whole — protocol, README, EXAMPLE,
self-test, licence — and needs no pointer on those tools; the Claude Code
and Cursor pointers name the new place. `LEDGER.md` is `docs/LEDGER.md`,
beside its archive `docs/handover.md`. The hook's default path, `bin/setup.sh`
and every live reference follow; historical mentions (the pre-live
review, old ledger entries, comments on what the site once published)
are left as written. A clone whose `ledger.path` still says `LEDGER.md`
is stopped loudly at its next commit, not silently unguarded.

### [2026-09-23 02:07 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The adversarial review's items are audited, not remembered** (Davies
asked whether all of them were fixed). R's own reproductions, recovered
from the session record and pointed at this tree with the Deno 1.x
binary: R1–R9 and D1–D3 fail on the assertion that reproduced each bug,
the lifecycle (4c/4d/4e, 5e, 6b, 6c/6d) and the resolver matrix pass.
R10 failed until its fake venue reported the coins it held — the tick
caps live sells at the venue's balance now, and the fake's was always
empty; with real balances it sells 0.02 then 0.03, net 0. D4 tested
`dayPnl`'s inputs, not the page; the page uses the tick's `dayOpenOf`
(pinned both sides). Every item has a pin in the repo suites. Added: the
paging rule R found unenforced — `assertPagedOrder` now refuses an order
that does not end with the unique `id` (pinned, red on the old guard;
all 184 agents tests green with it). Left as decided: #15's second half,
a retired row labelled live stranding PAPER coins. Reference §4.24 has
the audit.

### [2026-09-23 02:02 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Two open items closed without code.** The pre-live review's retention
gap (item 0(f)): reference §4.25 writes down what the agents tables keep.
Basis and observations 30 days, candles 200 (1-minute candles 3);
decisions, orders (which carry the fills) and probes in full, because
every P&L figure is computed from them. Measured today: ≈ 100 decisions a
day (66 trend-1h, 30 trend-4h, 3 momentum-1d) at ≈ 1.8 kB each and 3
orders a day, about 70 MB a year against a 98 MB database; look again at
~300 MB, when the first thing to go is old HOLD decisions' state JSON.
Item 1, Cloudflare's cached copies of the old exposure: all five paths
return the app's shell on both hosts now.

### [2026-09-23 02:01 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The performance matrix gates CI, and its 18 failures are explained.**
`bin/verify-perf-matrix.mjs` read the real clock. It is pinned now the
way the sweep is (the fixture's dates in Node and the page's `Date` at
one instant, default Thu 2026-09-17 23:00 UTC; `PERF_MATRIX_CLOCK` moves
it), and it was run at 21 instants: 12 green, 9 red, and every red is its
fixture's, not the app's. The 18: after 14:00 and up to 17:00 UTC the 24H
filter keeps two of the previous session's three bars and reads +7.41 %,
right for those two; from 17:00 only one is left and the filter's
fall-back to the whole day restores all three. The other reds: a session
day on a weekend (3M flat or empty; its grid is weekdays), London on GMT
(3M's 17:00-London slot lands on the second bar's own time), and the
weeks within 60 days of the sold-down book's 1 February sale. The harness
refuses those instants with the reason (exit 2), so a failure is always
the app's: five known-bad instants refused, and all twelve good ones
re-run green with the guard in, the default three times in a row. 33 s a
run, so `npm run verify:perf` now runs in check.yml after the sweep and
in `bin/gates.sh`; the README, CLAUDE.md and the map say two browser
tests.

### [2026-09-23 01:25 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The map is a map again** (item 00.2 closed). `docs/map.md`'s file table
went from 191 KB to 18 KB: one line per file saying what it is for,
grouped (shell, portfolio, prices, chart maths, views; functions,
`agents/` and `_shared/`; migrations; build, CI and docs), duplicates
merged (`trading212.js` and `ticker_class.js` had two rows each), the
migrations in order, and the three `_shared/` modules and every
`agents/` file that had no row given one. `src/docs_map.test.js` pins
it: every client module, function, module beside them and migration has
a row, and every file a row names exists. Red on each drift it guards
(an extra source file, a dropped migration row, a row naming a missing
file) and on the old map (three of five checks); green on this one.
`docs/guide.md` went from 34 KB to 10 KB: plain instructions, the
engineering asides dropped because each lives in its code's comments
(the iOS status bar in `index.html` and `styles.css`, the refresh
throttles in `app.jsx`). Two facts corrected on the way: the P/E button
covers four indices, not three (`INDEX_PE_ALLOWED`), and the stack's
migrations run to `0047`. CLAUDE.md and the skill now say a row is one
line and the why belongs in the file.

### [2026-09-23 01:16 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The README is one page again** (item 00.2): 275 KB → 10 KB. What the
dashboard is, the live example and its password rule, the masked
screenshots, what it does, how it's built, how I work on it, the crypto
loop and one row per folder, in Davies' first person and plain
sentences. Nothing was dropped: the old "Using the board" is
`docs/guide.md`, and everything from "Engineering notes" down is
`docs/map.md`, both verbatim apart from heading levels, relative links
and the rows the root move changed; a line-by-line check found every
other old line in one of the two. CLAUDE.md, AGENTS.md and the
working-with-davies skill now point the per-change docs rule at
`docs/map.md` / `docs/guide.md`, keep the README to one page in his voice,
and extend the no-personal-figures rule to all three. The README's counts
were re-taken on this tree: 922 vitest, 391 deno, 208 sweep checks, four
runtime dependencies, eleven Edge Functions.

### [2026-09-23 01:13 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The root is down to what a tool needs there** (item 00.1). Moved:
`hooks/` → `bin/hooks/`, `test/browser/*` → `bin/`, `public/` →
`src/public/` (Vite's own default under `root: 'src'`; the built
`_headers`, `robots.txt` and manifest are byte-identical), and
`eslint.config.js` → `src/` (ESLint 10 finds it from each file's
folder; knip is pointed at it; the same 110 files lint with the same 0
errors and 6 warnings, plus the config itself, and a conditional hook in
a probe file still fails). New: `bin/setup.sh` (hook path, ledger path,
`npm ci`; no identity, since a stranger's setup must not commit as
Davies) and `bin/gates.sh` (CI's steps in CI's order, including the npm
audit; warns when the hook is off). Kept, with the reason: `wrangler.jsonc`
(Pages reads it only at the root, and it is what limits the site to
`dist/`: before it, the site published the whole repository), `tsconfig.json`
(plain `npx knip` reads it only at the root, and without it reports
`src/ambient.d.ts` unused, which invites a wrong deletion), `vite.config.js`
(vite and vitest find it at the root; anywhere else every command needs
`--config`), `package.json` and its lock, `README.md`, `LICENSE`,
`AGENTS.md`, `LEDGER.md`. So no `cloud/`: `supabase/` alone in it would
not remove a root entry and would rename a path the CLI, three workflows
and every document use. `verify-perf-matrix.mjs` lost its hard-coded
container paths and its side install of Playwright; run from its new
place it went 60 of 60 green, on the real clock.

### [2026-09-23 00:51 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Jev is fixed, not shadowed: v2 question at 0.45** (reference §4.21,
review `reviews/2026-09-23-jev-question-fix.md`, migration `0047`). The
model was asked every entry state of all three rules with the new wording
(1,665 calls, $0.059, answers in `backtests/jev_answers_v2*.json`, md5
checked against SQL); a v1 control in the same minute reproduced the old
answers, so the change is the wording's. 0.45 was chosen from the replies
before any backtest (every state decided the same way on every call; only
a weak trend in high volatility refused), pinned against the answers
file. Priced on the live candidate: A +9.6 / B +19.5 / C +58.2 / D −7.8 %
against the rulebook's +8.0 / +20.1 / +55.6 / −7.8; the worst window
does not move; A and C improve in all four evaluations, inside chance.
Two runs byte-identical (`672ae9a2…`). The go-live draft is renumbered
`0048` with `enterMin` 0.45. The migration applies on this push; the
agents function redeploys with v2 as the loop's question.

### [2026-09-23 00:20 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The venue survey is in** (`docs/agents/venue-survey.md`, 838 lines, 41
claims marked UNVERIFIED, no amounts from his accounts): from the UK stay
on Revolut X (Bitstamp and Coinbase Advanced the backups; OKX, Bybit,
Binance, Gemini and Luno unusable for the loop); no legal crypto shorting
for UK retail; in the US Binance.US is cheapest but thin, in Hong Kong
Futu's OpenAPI; data first: Binance bulk files, Deribit DVOL, Bitstamp's
tape. The Coinbase answer: the backtests read its keyless public candles.

### [2026-09-23 00:19 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Jev fix, step 1 of 3: the new wording can be measured before the loop
uses it.** `jevQuestions` is now versioned: `v1` is the old checklist,
kept verbatim; `v2` says what the rule already checked, defines the words
without saying what to conclude, and asks one symmetric question (is the
move more likely to continue than to fail), worded for the rule asking.
The loop still asks `v1`; `POST ?action=jev` takes `version` and `kind`,
and every entry decision records `numbers.jevQuestion`. Next: measure
`v2` on every entry state, pick a threshold outside any coin-flip band,
re-price against the null, then switch.

### [2026-09-23 00:12 UTC] Platform: Claude Code | Model: not recorded (session policy)

**SUI's seat, judged on what SUI has** (reference §3.20; script
`backtest_sui.ts`, output `backtests/sui.json`, report
`reviews/2026-09-22-sui-study.md`). Keep it in the live row, as the
incumbent, because the evidence cannot decide: SUI earns the least of
the five and damps the most. Keep it in paper to measure its book. Two
runs byte-identical (`badf7b33…`); every figure in the report rebuilt
from the JSON by script. CLAUDE.md corrected: SUI clears window A only
under the running stop, and its median round trip is ~33 bps.

### [2026-09-23 00:12 UTC] Platform: Claude Code | Model: not recorded (session policy)

**"Sept" is gone from the site.** `Intl`'s en-GB (and en-AU, en-IE,
en-IN) spells September "Sept", so a UK browser printed "30 Sept" in
Upcoming Earnings and "22 Sept" on the performance chart's and the
ticker chart's date labels, while the Agents page, with its own table,
said "Sep". Every month now comes from one table in `src/formatters.js`;
the locale still decides the order and the time zone the day. Pinned (the
panel renders "30 Sep", red on the old formatter; every month maps to the
table; a London midnight rolls the month). Gates green, sweep 208.

### [2026-09-22 23:53 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The third pre-live review is shipped** (reference §4.24): the review
agent's sixteen fixes, its lifecycle test and shared test doubles, and
three fixes of mine (flags E and F, every tick error kept), each with a
pin that fails on the old code. `time_in_force` stays: Revolut X's own
client and CLI send it at placement. New durable rule in CLAUDE.md: the
Revolut X account the key sees is the loop's alone, never traded by hand.
Gates: typecheck, lint (0 errors), vitest 918, build, size 110.03 kB,
knip, browser sweep 208, deno check + deno test 387 on Deno 2.9.6 and
1.46.3.

### [2026-09-22 23:36 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Resumed after the usage limit; the in-flight list rewritten.** Davies'
four requests of ~20:15 UTC (root into `bin/` / `cloud/`, a shorter
README in his voice, fix Jev's question and threshold instead of
shadowing it, "Sept" → "Sep") are item 00. Every sub-agent died on the
limit at ~20:20 UTC: the pre-live fix agent had already reported (17
items, flags A–I, summarised in 0a), the SUI agent had written
`sui.json` and a review draft, the venue survey only scratch notes. The
agents' uncommitted tree is backed up as `79a7ad4` on
`claude/repo-audit-restore-uverhn`. Item 0b now records his choice to
publish this repository as it stands.

### [2026-09-22 20:05 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The README's diagram and its facts.** "How it's built" is now a
hand-written SVG in the style of Davies' two skill repositories
(`docs/architecture.svg`: user → browser → Edge Functions / scheduled
jobs → Postgres, outside services beside them, blue / green / grey
arrows with a legend), replacing the mermaid block, and its alt text
carries the whole picture in words. Every finding of the README
fact-check agent was applied after spot-checking five against the code
(the SW polls every 60 s, Acknowledge is browser-local, the manifest has
no icons, 1W fetches 15-minute bars, the overnight cadence is 15 min on
1W): the Investment view is a tab, not a `⇄` button; hide-values masks
digits of money, prices and share counts with `•` and keeps each
number's length; the captain is the largest single holding; the
transaction and agents-detail columns; four indices with a P/E button,
from Alpha Vantage; no forced previous-close basis on any range; 1Y
draws MA 200; P/S 1Y; the Acknowledge button; CRON_SECRET via Vault;
the SQL-Editor advice replaced by `migrations.yml`; the env table (with
the agents' secrets); the deploy trigger; phantom functions removed
(`trimLru`, `collectPassword`, `fillRows`, `dropDepositSpikes`,
`data?action=snapshot`, `ops-error?action=acknowledge`); missing rows
added (`version.js`, `ambient.d.ts`, `agents/db.ts`, the last Kraken
study, `package.json`'s tool configs, `wrangler.jsonc`, `.nvmrc`,
`.github/SECURITY.md`, the env example); and the last figures from the
real book (a share-count restore, deposit totals, trade counts). The
working-with-davies skill (three copies) had two chart rules the code
had overtaken — a forced `prevCloseBasis` on 24H and a `⇄` switch — and
CLAUDE.md a stale test count, build output and Vite note; all corrected.
Previewed with GitHub's stylesheet; every relative link resolves.

### [2026-09-22 19:57 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The repository root is tidied for a public audience** (Davies chose to
make this repository public as it stands, "C方案", and asked for a root as
clean as his two skill repositories'). Thirty-three root entries become
twenty-six. Moved: `CLAUDE.md` → `.claude/CLAUDE.md` (Claude Code loads
either location; checked against its memory docs, and a `.claude/CLAUDE.md`
counts the same for the AGENTS.md rule), `handover.md` →
`docs/handover.md`, `SECURITY.md` → `.github/SECURITY.md` (GitHub reads it
there; "nine" functions → eleven), `.env.example` →
`supabase/functions/.env.example` (T212, cron and the agents' secret names
brought up to date), `scraps/agents-baseline-backtest.py` →
`docs/agents/scripts/`, `scraps/verify-perf-matrix.mjs` → `test/browser/`.
`knip.json` and `.size-limit.json` are folded into `package.json` (both
tools read them there; knip was shown to read it by removing an entry and
watching it flag 14 files). Every present-tense reference follows: the
ledger's header, CLAUDE.md, AGENTS.md (which also said the build wrote to
the repo root — it writes `dist/`), the six skill files, the PR template,
check.yml's comments, `.gitignore`, the reference, the README's paths, and
the sweep's stale run-by-hand header. Kept at the root on purpose:
`LEDGER.md` (the protocol and the hook's default), `AGENTS.md` (Cursor and
Codex read it there), `hooks/` (moving it would silently switch the gate
off in every other clone until each re-ran `core.hooksPath`), and the tool
configs that must sit there. Gates: typecheck, lint, vitest 916, knip,
size-limit, deno check.

### [2026-09-22 19:52 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The demo book in the public bundle was a real snapshot of Davies'
holdings** — `src/data.js`'s `INITIAL_PORTFOLIO`, about 35 holdings with
their share counts and average costs, compiled into `dist/assets/app-*.js`
where anyone can download it without a password (found by the README
fact-check; one lot matched the other-platform lot in `0033`). It is now
fictional: ten shares of each name (0.1 BTC) at 80 % of the listed price,
positions and tickers unchanged because `migrate()` reads the default
labels from it. `src/data.test.js` pins the pattern (red on the old file).
Old bundles stay in git history and in old Pages deployments; Davies
accepted historical data as long as it is not prominent. Gates in the
clean worktree: typecheck, lint, vitest 916, build, sweep 208/208, knip,
size-limit 110.03 of 122 kB.

### [2026-09-22 19:49 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Kraken's money moves to Revolut X — Davies' decision** on study K's
recommendation: he withdraws the whole balance himself (the system
cannot) and keeps the Kraken key, which the page and the loop still use
for candles, the fee tier, the venue card and the probe. Recorded in
reference §4.23 and as what-remains item 0c (probe after the transfer).

### [2026-09-22 19:48 UTC] Platform: Claude Code | Model: not recorded (session policy)

`snapshot-record` goes back into `PUBLIC_FNS`, the deploy workflow's list
of functions deployed `--no-verify-jwt`. It left the list in the
2026-08-18 rollback and never came back, while its own header and the
README said it was there. The cron calls it with the Vault secret, not a
Supabase JWT, so a platform JWT check would refuse every call. Production
shows `verify_jwt: false` today even though the function was redeployed
without the flag on 2026-08-26, so the CLI evidently keeps a function's
existing setting — the fix states the intent instead of leaning on that,
and changes nothing in production now (it recorded 12 buckets in the last
hour when checked). Found by the README fact-check.

### [2026-09-22 19:47 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Study J (the Jev veto, re-priced on the model's measured answers) is
verified and committed** — `backtest_jev.ts`, `backtests/jev.json`, the
rewritten jev-veto review, reference §4.21's new paragraph, the README's
two descriptions of the study, CLAUDE.md's Jev bullet and a note atop
go-live §9.6. Verified by the main session, not taken on trust: a re-run
in a clean worktree at HEAD (8 min) reproduced `jev.json` byte for byte
(sha256 `0e03c844…`), and its fidelity checks passed on that tree (144
cells, 0 mismatches; the rule arm equals `set2.json`'s incumbent). The
first replay's figures are superseded (veto rate 47.8 % → 40.0 %; A −2.5
→ −1.0 %; D −1.5 → −2.3 %). The recommendation — shadow mode on the live
row and its control — is Davies' decision, put to him in chat.

### [2026-09-22 19:45 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The website is English-only again, and the rule is written down.** The
holding list and the chart modal showed one Chinese string, the Chinese
fund's own title in `COMPANY_NAMES` (`017731`); it is now "Harvest
Global Industrial Upgrade Equity (QDII) C", and a pin fails if any name in
that map carries a CJK character (red with the old string, green now).
Davies had to remind this session twice to reply in Chinese; the skill's
Language section (all three copies) now says every reply is Chinese —
including after a hook message or an agent report, the turns where it
slipped — and that every word the site shows is English. Gates in the
clean worktree: typecheck, lint (0 errors), vitest 914, build, the
browser sweep 208/208, knip, size-limit 110.1 of 122 kB.

### [2026-09-22 19:24 UTC] Platform: Claude Code | Model: not recorded (session policy)

**README rebuilt as a public showcase** on Davies' request (he will show
the repository in finance-internship interviews). New top half: pitch;
the live example at daviesluo.com with "for a password, contact Davies";
five desktop screenshots he took with the hide-values mode on (three
cropped to their modal so they read at README size; no EXIF, ICC only);
what it does; a mermaid architecture diagram; the stack as a table;
engineering practice; the agents research in plain words. Below a
`# Reference` divider the old sections stay, reordered (Using the board →
Engineering notes, which is the old Highlights → Stack → File map → …).
Corrected on the way: Stack (eleven functions, not nine; migrations to
`0046`; four workflows and what `check.yml` really runs), the data-flow
diagram (all functions, every browser store, the cron jobs), local
development commands, the Live-prices note (the browser does reach Yahoo
through CORS proxies as a fallback), the Agents note (three paper rows,
no "four rulebooks"), a contradiction about Trading 212's first sync
(the code keeps a board excess — `trading212.js` `max(0, board −
broker)` — one cell said the opposite), and the iOS status-bar note
moved from Stack into the PWA section. **Nineteen passages that quoted
the real book** (share counts, lot prices, a position's value, deposit
totals, trade counts) now say the same engineering in neutral words; a
scan finds only market volumes, fixtures and format examples left.
`CLAUDE.md` and the three working-with-davies copies gain the rule: no
figure from the real book in the README. Previewed locally with
GitHub's stylesheet and mermaid before committing. Docs and images
only: no source changed, so the gates run on `54ab2ce` stand.

### [2026-09-22 19:11 UTC] Platform: Claude Code | Model: not recorded (session policy)

`go-live.md` §1 still listed FOUR rows with `trend-4h-kraken` in the
table and $280 of row capital, a day after `0046` deleted that row: it
now says three rows, $180, and why the fourth went (reference §4.22),
and the fee passage no longer speaks of Kraken twins in the present
tense. Production confirms the three: `agent_strategies` holds
`trend-4h`, `momentum-1d`, `trend-1h`, all Revolut X, all paper.

### [2026-09-22 19:10 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Study K (the 84 Kraken coins) is back, verified and committed** —
`backtest_kraken3.ts`, `backtests/kraken3.json`, the kraken-history
review, and reference §4.23. Verified by the main session, not taken on
trust: a re-run from the scratchpad tapes reproduced `kraken3.json` byte
for byte (44 s), and `deno check` passes. Verdict: no coin clears the
bar, Kraken research stops at this fee tier (reopen triggers in §4.23),
and the recommendation on the money is to withdraw the Kraken balance and
keep the account and the key, which is Davies' call. The study also
corrected item 22's seeded count (three tests → four: 2 against 3.33 →
1 against 2.56); the sentence stands. The 9 GB bundle in the scratchpad
(`krakenfull/`) stays until J and S finish, then can go.

### [2026-09-22 18:57 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Review R (adversarial, today's diff) is back and VERIFIED on the current
tree** — its lifecycle scenario and nine reproductions were re-run by the
main session against the repo itself (a copy of the harness with `head`
pointed at `/home/user/daviesportfolios`), not taken on trust. The core
lifecycle passes on the REAL venue clients (entry → pending → filled on
arrival → settled from the venue's view → floor at the bid → flat →
cooldown → re-entry → the kill switch still lets the exit out → a
demoted row keeps the live book's exits). What fails, and blocks the
first live order:

1. **An unreadable fill reply leaves real coins with no stop** — the
   book holds 0 while the venue holds the coins: 0 stops in 10 minutes
   with the price down 20 %. Its premise is B4, which is still open.
2. **The floor depends on Kraken's candles**: an OHLC outage skips the
   pair before the stop runs, even with a warm cache.
3. **Pulling the kill switch writes a false record** (`risk_allowed:
   true`), retries the refused entry every minute (~240 errors a bar a
   coin), and on re-arm placed a stale entry into a 200 bps book because
   the retry path skips `WIDE_SPREAD_BPS`.

Also reproduced: sells sized from the book and never capped by the
venue's balance; an unknown venue state read as "new" (a filled buy can
be settled `cancelled` and the coins bought again); a malformed fee
turns into a NOT NULL violation Postgres refuses and the stub accepts;
the duplicate classifier swallows real errors whose row values contain
"409"; a resting buy hides a sell in flight; a bar is decided however
old it is; two turns can trade at once; a protective exit with no quote
does nothing silently; four dashboard/tick disagreements; and three of
today's fixes are unpinned. **Being fixed now** by the reviewing agent
in the working tree, a pin per fix and its lifecycle scenario ported
into the repo as a permanent test; the main session reviews every line
and commits. The model ID it reported is `claude-opus-5-5`, as asked.

`go-live.md` §9.5 told the reader to move the draft to
`0045_go_live.sql` — a number already applied, which `supabase db push`
skips rather than applies — and reference §4.20 said `0046`, also taken.
Both now name `0047` and say to check it is still free.

### [2026-09-22 18:39 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The model's 450 replies are in the repository**, not only in a Postgres
table that prunes itself after six hours:
`docs/agents/backtests/jev_answers.json`, written by the Jev re-pricing
agent as its first step and **checked by the main session before
committing** — every one of the nine positive-momentum cells matches the
aggregate read straight from `net._http_response` (count, mean to three
places, veto count), and all 225 unknown-momentum replies are vetoes.
It is the input every later Jev number is computed from.

### [2026-09-22 18:38 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Eight of today's section headers were stamped AHEAD of the clock, by
8 to 76 minutes, and are corrected to the commit that carried each one**
(14:40→14:37, 15:10→14:43, 15:35→14:46, 16:20→15:10, 16:55→15:39,
18:25→18:17, 18:45→18:33, 19:05→18:36). They were estimated rather than
read off `date -u`, and one of them then became evidence: the tick
outage was dated from the "16:20" header and understated by an hour. The
outage entry is corrected in place with the recount (15:12:03 → 18:18:02,
187 errors). Headers are read from the clock from here on.

### [2026-09-22 18:36 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Archived 62 history sections (2329 lines, 2026-09-05 → 2026-09-21)
verbatim into `handover.md` Part 2**, oldest first, each checked
character-for-character against the original before this file was cut.
Nothing was deleted. The ledger had reached 3,300 lines, and every
session on every platform pays for it on every wake. The what-remains
list above is unchanged and is the whole briefing; open the archive only
to reopen or audit a closed item.

### [2026-09-22 18:33 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The real model was asked about every state it can ever see on an
entry, five times each, and the Jev question is answered.** The entry
state has only 90 possible values (5 coins × trend_strength ×
volatility × momentum; the rest is fixed on an entry). `POST
?action=jev` asked OpenRouter's `typesafe/jev-1.13-20260917` all 90 ×
5 = 450 calls, $0.0126, requests 26655/26656, zero no-answers, zero echo
failures:

| strength | vol | momentum | P(healthy) mean [min–max] | vetoed at 0.6 |
|---|---|---|---|---|
| weak | any | positive | 0.07–0.13 | **100 %** |
| moderate/strong | low/normal | positive | 0.94–0.97 | 0 % |
| moderate | high | positive | **0.600** [0.55–0.62] | 7/25 |
| strong | high | positive | **0.598** [0.56–0.64] | 12/25 |
| any | any | unknown | 0.04–0.21 | 100 % |

Caution never reaches 1.75 on an entry. **Two findings, both
structural:** (1) **the weak-trend veto is not the model's judgment — it
is the question's own prose**: `healthy_trend` tells the model to say yes
only when trend_strength is moderate or strong, the rulebook never reads
strength, and the model complies every time. That clause is an
untested rule hiding in a prompt, and it is what costs the bear year most
of its return in the earlier study (`weak-veto-only`: A +8.03 % → +0.63 %).
(2) **the high-volatility veto is a coin flip AT the threshold**: those
states' mean P sits on 0.600, and the same state on the same coin flips
between calls (strong|high ETH: 0.58 0.58 0.61 0.63 0.64). Whether real
money buys a high-volatility breakout would be decided by one call's
noise. The earlier study's bracket (`highvol-vetoed` / `highvol-passed`)
is therefore the honest answer and its "central" arm is not; its
assumed 0.15 for the weak states is confirmed (measured 0.07–0.13).

**Re-pricing with these answers is running** (Monte Carlo over the
coin-flip states; three configurations — rule with the model in shadow,
rule ∧ model as it runs, rule + the weak-trend clause as code — each
against its random-veto null). Nothing about the live row changes until
it lands and is checked. `docs/agents/backtests/jev_answers.json` will
hold the raw replies; `net._http_response` prunes them after ~6 h, and
re-measuring costs $0.013.

**A shadow switch, built and NOT switched on.** `params.jevGate: false`
on a strategy row keeps asking the model and recording its answer but
takes away its vote: the entry is the rulebook's — what every backtest
prices — and the decision's reason says what the gate WOULD have done
("model in shadow — would veto (P=0.59 < 0.6)"), so the counterfactual
stays one query away. Two of the three configurations the go-live
decision is choosing between need it; the default keeps today's
behaviour on every row, so nothing in production changes. Pinned in
`strategy.test.ts` and `tick.test.ts`; counterfactual checked (ignore the
switch in the tick and the new test fails).

### [2026-09-22 18:17 UTC] Platform: Claude Code | Model: not recorded (session policy)

**I broke the tick for three hours and the tests could not see it.**
`8e03297` (committed 15:10, deployed 15:12) made `selectAll` throw on a
query with no `order=` — and `tick.ts`'s count of today's orders had
none. Every tick from then on wrote the basis (section 1), then threw in
section 3, before the book, the protective stops, the observations and
the decisions: **187 errors from 15:12:03 to 18:18:02, no decision after
15:00:03, and `trend-4h`'s three paper positions with no floor for three
hours and six minutes.** (First written here as "16:20, 122 errors, two
hours": the start was read off a ledger header that was itself wrong and
the errors were counted from 16:15. Recounted from `ops_errors`; the
commit message of `023dfdc` still says 16:20 and is not rewritten.) Found at 18:16 on a fresh read of production,
not by any gate. Paper, so nothing real was exposed; live, it would have
been real coins with no stop — the exact failure this morning's work was
about.

**Why every test was green**: the guard lived only in the real client
(`db.ts`); the tick tests' in-memory stub had its own `selectAll` that
paged without it. The stub was looser than production — the same lesson
the CHECK-constraint bug taught six hours earlier, paid for twice in one
day. **Fixed at the root, not just at the caller**: the guard is now one
exported function, `assertPagedOrder`, called by the real client AND by
the stub, and the caller has its order. Counterfactual: drop that one
`order=` again and **55 of 60 tick tests fail**; restored, 60 of 60.
338 Edge tests green.

**What to do differently, and it goes in the skill**: after a deploy
that touches the tick, read production — decisions and `ops_errors`, not
the basis, which is written before most of the loop runs and so reads
"alive" through a crash.

**Recovered 18:19, verified from production, not from the badge.** The fix
deployed (every step green, Deploy included — the concurrency group
cancelled the hung `944c36d` run). Last `selectAll` error 18:18:02; the
first tick after it wrote decisions for every pair at 18:19:03–04, the
first since 15:00. All holds: `trend-4h` still long BTC/ETH/SOL with no
exit condition, so **no paper position crossed its floor while the stops
were down** — the outage cost `trend-1h` its 16:00 and 17:00 hourly decisions (only
the last closed bar is ever claimed) and `trend-4h` decided its 16:00 bar
at 18:19, late, and nothing else.

**`POST ?action=jev`** added to the agents function: a read-only
measurement of the model the entry gate reads. The state the loop can
show the model on an entry has only 90 possible values, so asking the
REAL model about every one, several times, turns the Jev study's replay
from an inference over twelve recorded answers into an exact lookup.
Operator-only, one transport per request, capped at 500 calls (~$0.01),
every state validated against the closed vocabulary (`STATE_VOCAB`,
`parseState`), and each reply read by `jevViewOf` — extracted from the
tick, so the measurement reads the model exactly as the gate does.
Places nothing, writes nothing. Pinned in `index.test.ts`.

**The standing rules caught up with the day.** `CLAUDE.md`'s agents
section still said FOUR rows and described `trend-4h-kraken` as running;
it now says three, why the twin went, that Kraken is signal-only, that a
row's label is not its book, where the go-live draft is, that the model's
veto is unpriced, and that a test double must be as strict as what it
stands in for. The same six lessons went into `working-with-davies` and
both Cursor copies, which are verified still identical.

### [2026-09-22 15:39 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Stopped on a usage limit, deliberately and with everything landed.**
Three studies were running; all three were stopped and their work
committed. **Read the next section's items J, S and K before doing
anything else** — one of them may have overturned the live case.

**The Jev study RAN and its headline is the biggest number of the day,
and I have NOT verified it.** `backtest_jev.ts` →
`docs/agents/backtests/jev.json` → `reviews/2026-09-22-jev-veto-study.md`.
It says the live sleeve's four windows move from

| | A (bear) | B | C | D (sideways) | worst |
|---|---|---|---|---|---|
| `rule` (every published table) | **+8.0 %** | +20.1 % | +55.6 % | −7.8 % | −7.8 % (D) |
| `rule ∧ Jev` (what runs) | **−2.5 %** | +15.8 % | +52.4 % | −1.5 % | −2.5 % (A) |

i.e. **the bear year that the whole go-live case rests on becomes
NEGATIVE**, while the sideways year improves 6.4 points. Historical veto
share 47.8 % against the live record's 20 %.

**Two caveats that are the study's own and matter as much as the
number.** (1) **The default arm does not call the model.** It replays
Jev's TWELVE recorded answers from `agent_decisions` onto historical
states by a pre-registered rule; `--replay live` is the arm that asks the
real model and has not been run. (2) The two recorded high-volatility
cells sit at **0.59 and 0.61** — one hundredth either side of
`enterMin`, and the model is repeatable only to about ±0.01 — so the
`highvol-vetoed` / `highvol-passed` arms BRACKET the answer rather than
give it, and their worst windows are −6.6 % and −3.3 %.

**I have not checked a single one of those figures.** Twice today a
reported number turned out to be the opposite of the record (AVAX's bar
verdict, and my own claim that the winding-down fix worked). **Verifying
this one is the first thing the next session does**, before it is
repeated to Davies as fact or acted on.

`0046` applied cleanly: 3 strategy rows left (`momentum-1d`, `trend-1h`,
`trend-4h`), orders 15 → 12, decisions 247 → 197, observations
1209 → 883, probes untouched, `live_confirmed_at` still null. All three
workflows green on `8e03297`.

**If `edge-functions` shows RED on `944c36d`, it is a false alarm — do
not chase it.** Both gating steps passed (Deno typecheck ✓, Deno test ✓)
and the run then hung on "Install Supabase CLI", a GitHub infrastructure
step, with `updated_at` frozen at 15:39:32. That commit changes **no
deployed Edge Function source** — only two study scripts and docs — so
there was nothing for it to deploy, and `8e03297`, which did change
`tick.ts` and `index.ts`, deployed successfully before it. Production is
current. Re-run the job if you want a green badge; there is nothing to
fix.

**The maker question, asked and answered for now**: the live row ships as
a TAKER (marketable, 9 bps) — that is what `tick.ts` does and what every
backtest assumes. Maker is not a rival version, it is an open question
`0042` measures, and the probe has **3 observations**: all sells, filled
in 1–3 minutes, spread saved 1.6–3.4 bps, adverse at 60 min −31.1 / +3.6
/ +82.7 bps (positive = against the fill). Mean +18.4 bps against a 9 bps
saving, on n = 3, which is noise. It needs 30–100 probes: 2–4 months.

### [2026-09-22 15:10 UTC] Platform: Claude Code | Model: not recorded (session policy)

**`0046` deletes `trend-4h-kraken`** on Davies' word ("这三点按照你的建议
处理"): 3 orders, 50 decisions, 326 observations, 0 probes, 0 backtests.
Paper records only, nothing stranded at a venue. Dry-run first, as every
delete here is now. **Kraken is a SIGNAL venue only from here** — every
rule still reads its candles — and the browser sweep was moved to that
shape: three rows, the book on `trend-4h` where production keeps it, and
a venue card with ZERO execution rows, which is what the page must handle
now. 208 checks green, so it does.

**The audit's reasoned-but-unreproduced list was worked through** ("这里面
你认为该修的也都修了"). Five of seven fixed:

- **The lease renewed exactly once**, bounding a turn at about half a
  lease plus a lease; past that the lock expired under a turn still
  placing orders and the next cron minute ran beside it. It renews
  whenever the lease is half gone now.
- **A fresh order with a null `decision_id` is refused.** `0041`'s index
  is partial, so such an order carries no claim and two turns would both
  place it. A re-quote is left alone on purpose — it replaces a row the
  same turn already settled, and `MAX_REQUOTES` bounds it.
- **The day's open was yesterday's OPEN for the first minutes of every
  UTC day**, before the venue publishes today's daily candle: a whole
  day of move counted as today's, every night, which inflates `dayPnl`
  and can spend the $5 limit on a move that already happened. Yesterday's
  CLOSE is where today opened.
- **A partial fill is stamped when it first filled**, so the
  realised/unrealised split stops changing retroactively.
- **Every paged read orders by a unique column last**, and `selectAll`
  now REFUSES an unordered query: LIMIT/OFFSET is stable only under a
  total order, and a fill read twice is a position counted twice.

Two recorded rather than fixed, with the reason: the exposure bucket
reads `rows[0].venue`, which misbills only if a strategy's `venue`
changes and no migration does that; and the re-quote decision id, above.

### [2026-09-22 14:46 UTC] Platform: Claude Code | Model: not recorded (session policy)

**`trend-4h-kraken` makes no decision of its own — 50 of 50 paired
decisions match `trend-4h` exactly, 0 differ**, on `final_action` and
`rule_action` alike, because both rows carry `signal_venue = 'kraken'`
and the same rulebook, parameters and coins. It can differ ONLY through
the fill path, **nothing reads that path** (no Kraken `probeSummary`
anywhere; `agent_maker_probes` is 3 rows, all revx), and the path is a
SIMULATION whose accuracy has now been measured keylessly in 18 minutes:
a resting order at Kraken's touch is reached 79 % within a minute and
91 % within five, against the loop's candle model's 82 % and 92 % —
accurate to 1.01–1.04×, repeatable from two public endpoints any
afternoon. Meanwhile it pays **4.44× the fee for identical fills**
($0.1600 against $0.0360; Kraken's PRICE was 1.27 bps better, the fee is
the whole difference at +29.70 bps a side). Davies' read was right.
**Recommendation: delete it, add nothing.** Draft at
`supabase/migrations/0046_delete_kraken_twin.sql`, dry-run clean (0 probes,
3 orders, 50 decisions, 326 observations, 0 backtests; 3 rows left).

**Nothing Kraken-native clears the bar either.** Eighteen coins chosen by
a cost-and-book screen BEFORE any backtest: with a search, 2 two-window
passes against 1.39 by chance; **on seeded parameters, 2 against 3.33 —
fewer than chance**. Six six-month folds with nothing chosen: the live
five are positive in 39 of 60 on Revolut X's costs, the 18
Kraken-advantaged coins in **49 of 216 (22.7 %)**, best-of-18 3 of 6. A
free fee schedule moves them 1.8 points. The problem is the coins, not
the venue. Market making is dead by arithmetic (median spread 14.76 bps
against 80 bps a round trip). The fee tier is 30.4× the turnover away and
worth +0.73 points.

**Two corrections to the reference.** §3.19's "the two cost schedules do
not overlap by 26.2 bps" is true over the 27 coins in `COSTS` and FALSE
over the book: across all 245 bases both venues list they overlap on 71,
26 with a real Kraken book, and the worst Revolut X round trip among
booked coins is PONKE at 409 bps. Verdict unchanged — the overlap is all
in the illiquid tail — but the sentence would fall over the first
measurement. And §3.14's "exactly zero times in 952 cells" is about
Revolut X's FEES at Kraken's SPREAD; against the real UK book Kraken wins
28 of 36 cells on the coins where it is cheaper. Same verdict, different
reason. Reference §4.22.

**One finding that is not about Kraken**: in the same fold test, Revolut X
RESTED at 0 % maker beat Revolut X taking the touch, 40 of 60 against
39 of 60, at 1.87–11.91 bps a round trip against 19.87–29.91. That is
`0042`'s question and the same ~18 bps the whole Kraken argument turns
on, on the venue already traded. No backtest can settle it — the probe is
the instrument and it is already running.

### [2026-09-22 14:43 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Jev has been vetoing one entry in five and nobody had counted it.**
Every published figure is the RULEBOOK's; the account runs `rule ∧ Jev`.
`agent_decisions`, all of it: 15 entry signals, 12 taken, **3 vetoed —
20 %** (`trend-1h` 2 of 5, `momentum-1d` 1 of 4, `trend-4h` 0 of 3).
**Two of the three were P(healthy) = 0.59 against a threshold of 0.60**,
so `enterMin` binds at its boundary — and it is a seeded parameter never
varied and never backtested that gates every entry the live row will
make. My own §9.1 line said "0 refused by the risk gate", which was true
and was not the layer doing the refusing. Now go-live §9.6 and §4.21.

**I told Davies something false about AVAX this morning and the record
had told me.** I said it cleared one walk-forward window and that §4.15
would not admit it today. That is the `trail` regime — the intra-bar
stop the loop STOPPED RUNNING on 09-21. Under the rule `tick.ts` runs,
recomputed by me from `tape.json`: **AVAX clears A, B and C, and is the
only coin of 27 clearing BOTH walk-forward windows**; SUI clears A alone.
`reference.md` §4.15 and `go-live.md` §3 both carried the stale version,
and §3's was the sentence that document calls its most important — it
said the re-run had not happened when it had, the same day.

**But it is not a qualification either, and the audit that found it
overstated it.** Across the 93 coin-window cells priced under the shipped
rule, 26 clear the bar: a per-window pass rate of **0.280**. Twenty-three
coins have both A and B priced, so chance gives 0.280² × 23 = **1.80**
coins clearing both, P(at least one) = 0.85. **One passer is fewer than
chance gives.** So the conclusion (keep AVAX) is unchanged and BOTH the
reason I gave and the reason the audit gave were wrong. The real reason
is §4.15's own: a member's record is not the argument. AVAX is the row's
largest concentration in both directions — ~95 % of the sideways year's
loss and ~57 % of the strong bull's gain — and the sleeve is steadier
holding it.

Also corrected: the set study's "four evaluations" are two on the window
that decides, because window D is bit-identical across the tape arms (its
own fidelity block proves it). The optimistic null is wrong by orders of
magnitude — the whole study's 15 of 98 goes from P = 0.0011 to P = 0.993.
It cuts in the incumbent's favour, so no verdict moves, but that column
is unusable rather than evidence.

### [2026-09-22 14:37 UTC] Platform: Claude Code | Model: not recorded (session policy)

**An independent audit found that there was no working way to stop a live
row that still held coins.** Three mechanisms, each independently broken,
each reproduced against the real code, and together they meant that on the
day a real position went wrong every lever the operator has been told to
pull either did nothing or made it worse.

1. **`live_confirmed_at = null` refused EXITS.** The check in `place()`
   tested the row's mode and the confirmation and never the SIDE, and it
   sits after `riskGate` has already allowed the exit. That switch is the
   first sentence of the emergency procedure in `go-live.md`. Pulling it
   would have left real coins with no floor and no rule exit, writing a
   decision row and an `ops_errors` row a minute per symbol while the
   record said the exit was allowed. Side-aware now; `global_pause` stays
   the one switch that outranks an exit.
2. **A paused row's exit order violated the schema, so the whole
   `windingDown` fix was INERT in production.** `agent_orders_mode_check`
   is `in ('paper','live')`; the tick wrote `mode: s.mode`, which is
   `'paused'` for exactly the rows `0038` and `0043` retired. The decision
   landed (no check on that table), the ORDER was refused by Postgres, the
   error carried no `409|duplicate|unique` so it was swallowed into
   `report.errors`, and the page went on telling the owner the floor was
   running. **My own tests certified it**, because the in-memory stub does
   not enforce CHECK constraints. The stub enforces the mode check now, and
   reverting the fix turns those three tests red.
3. **A live row demoted to `mode = 'paper'` read itself flat** — offered
   as an undo — so its real coins lost their exits while it started buying
   on paper beside them.

One root: **a row's `mode` LABEL and the book it is trading are different
things.** `bookMode(s, sym)` resolves the book — real coins outrank the
label, else the row's mode, a paused row falling back to paper — and the
order, the decision, the probe, the exposure bucket and the caps all follow
the BOOK. `riskGate` keeps the LABEL, because "may this rulebook take new
risk" is what it asks. `offBook()` generalises `windingDown` from "retired"
to "holds a book it does not trade".

**Two more holes left a real position unprotected.** An order that could
not be read back or cancelled blocked its pair's stop every minute,
indefinitely — and an unreadable filled order is exactly what B4 produces
if the settlement field names are wrong, so the first live order could both
fail to settle AND disarm the stop on the coin it just bought. A `pending`
row, which is what a venue timeout produces, did the same. A buy is not the
exit: the stop steps past it, says so, and sells what is held; only a SELL
in flight still stands it down.

**The dashboard had not been given this morning's fix** — `index.ts` still
keyed on strategy and symbol with no mode and billed `byMode` from the row's
label, so a row that ever changed mode drew one position out of two books
and the whole blend landed under "live realised". It resolves the book the
same way the tick does now.

Four smaller fixes: a `filled` reply reporting `filled_size: 0` is a problem
rather than a fill of the whole order at fee zero (absent is still absent —
that distinction cost a test); `positionFromFills` sorts to a total order,
buy-first at a tie; `stepDecimals` reads an exponential step; a paused row is
refused before `askJev` is paid. **`0045` makes `agent_maker_probes`
cascade** — a THIRD child of `agent_strategies` that `0044` did not delete,
which survived on luck because the only three probe rows belonged to a row
that stayed. Orders and decisions stay explicit: a forgotten one should fail
loudly, which is what happened.

**The go-live draft is corrected and renumbered `0046`.** Its TO UNDO said
both of the false things above; the flip-in-place alternative is struck; the
row is written out in full instead of copied by `select` (dry-run verified
byte-identical to the paper row's params) and `on conflict do nothing` is
gone, so a re-run fails rather than quietly arming the live gate beside a row
of unknown shape. Reference §4.20.

### [2026-09-22 13:52 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The pre-live verification found the thing it exists to find.** A
position did not carry the mode it was opened in: `tick.ts` keyed the
book on `strategy_id|symbol` alone and read its exposure bucket off the
FIRST fill's mode. So a row flipped from paper to live would have
inherited its paper positions — the rulebook reads itself already long
(`ruleDecision` only holds or exits while `position.base > 0`), never
buys the coin for real, and the first exit or 8 % floor places a **real
sell at Revolut X for base the account never bought**, billed to the
paper cap. `trend-4h` is long BTC, ETH and SOL on paper at $13.33 a slot,
so this was one migration from happening. The mode is in the key now
(`posKey`), one resolver (`bookKey`) hands both the position and the fill
history to the row's current book — which also caught that the re-entry
cooldown read `byKey` under the old key, so the first patch broke two
existing tests and said so. A PAUSED row keeps `0043`'s behaviour and
still sees its book, or the stuck positions come back. Three pins in
`tick.test.ts` / `strategy.test.ts`, counterfactual checked (drop the
mode, the test goes red).

**Everything else verified, with numbers.** 1,440 / 1,440 minute ticks in
24 h; every HTTP reply in the retained 6-hour window a 200; 137 decisions
with **0** `provider: none` and 0 refused by the gate; 3 agent errors in
48 h, each a single occurrence and each explained, none in 11 hours.
**AVAX's and SUI's `min_order_size_quote` is finally measured** (§3.13's
fourth caveat, the assumption under every $20 slot on those two):
`/1.0/public/configuration/pairs` is PUBLIC and keyless — all five coins
`active`, minimum **$0.10**, so a $20 slot is 200× the floor; steps are
already honoured in code, worst rounding residue $0.0005. Live UK touch
the same minute: BTC 1.6 / ETH 3.2 / SOL 4.2 / AVAX 9.1 / **SUI 25.7**
bps, all inside the 50 bps refusal, and SUI's 25.7 + 9 bps a side is the
43.7 bps round trip §3.8 priced it at.

**Two cap facts.** The exposure cap is marked to market, not costed
(`base × mark`), so at $100 against a $100 row four slots up 6 % refuse
the fifth entry — it tightens exactly when the rulebook is working.
Raising it cannot loosen risk, because the rulebook does not pyramid: five
coins at a $20 per-order cap deploy at most $100 of capital whatever the
number says. The draft sets $150. `daily_loss_limit_usd` $5 is 5 % of the
row and blocks new entries only, never an exit.

**The draft migration is `docs/agents/0047_go_live.sql.draft`, and it is
deliberately NOT under `supabase/migrations/`** — a file there is applied
by `migrations.yml` on the next push, so moving it IS the act of going
live. It adds `trend-4h-live` as a NEW row rather than flipping
`trend-4h`: flipping in place is safe now but strands three paper
positions no rule would manage again, and keeping `trend-4h` paper gives
the live row a control on the same venue and rulebook — the only thing
that can measure a live Revolut X fill against the paper assumption of the
touch plus 9 bps (`trend-4h-kraken` measures Kraken's post-only fills, not
this). Dry-run inside a self-rolling-back transaction: 4 → 5 rows, caps as
intended, production untouched and re-checked afterwards.

**The probe is RUN and green** (14:05 UTC, fired through `pg_net` so the
operator secret goes from the vault into the header without leaving the
database — the same method as 09-21). Revolut X: key loads, balances 200,
the SIGNED pairs 200 with **all five coins active at $0.10**, the signed
call WITH a query 200 (the part most likely to be wrong), active orders
200, region UK with one ticker row per symbol. Kraken: secret 64 bytes,
**the account holds USD and no GBP — §4.18's conversion prerequisite is
confirmed done at the venue**, TradeVolume confirms 0.80 % / 0.40 % at
$0 of 30-day volume, `AddOrder validate=true` 200 with `txid: null`, so
the placement path is verified without an order. Jev answers on BOTH
transports and the two agree. **B4 stays open and no probe can close it**:
both order histories are empty, so the settlement field names are still
the client's assumption until the first live order's read-back. New
measurement kept: **Kraken's book is 3–5× tighter than Revolut X's** on
all five coins (SUI 4.94 bps against 23.7) — it does not move the venue
verdict, because fees decide it, but it says the fee schedule is the
whole of Kraken's disadvantage. Reference §4.19; checklist and order of
operations, `docs/agents/go-live.md` §9.

### [2026-09-22 12:00 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The retired rows are gone, history and all** — on the second attempt.
The first `0044` deleted decisions before orders and `migrations.yml`
refused it: `agent_orders` has TWO foreign keys, `strategy_id` to the
strategy AND `decision_id` to the decision that produced the order, and I
had only thought about the first. Nothing was applied (the CLI runs the
file in a transaction, verified afterwards — all 1,377 observations still
there). Fixed by ordering orders before decisions, and **dry-run first
this time**: the whole sequence inside a transaction that raises at the
end to roll itself back, which reported 1,377 / 11 / 35 / 4 and no
constraint violated. That check cost one minute and would have saved the
red build. (`0044`, Davies' word:
"retired 的 testing strategies 也都删了，不用留历史"). 4 strategy rows,
11 orders, 35 decisions, 1,371 observations, irreversibly. `0038` and
`0043` had retired them IN PLACE because a strategy row cannot be deleted
while `agent_decisions` references it; `0044` deletes the children first,
which is the step those two would not take. Three of the four were still
long in paper, so nothing is stranded at a venue. The migration is now
the only record of what went, and it says so. `agent_basis` and
`agent_candles` are untouched — no strategy id, venue measurements rather
than a rule's record — and every number those rows produced is still in
the reference (§3.4, §3.5, §3.14, §3.17).

**The maker-probe line is off the page**, also on his word. The probe
keeps collecting and `probeSummary` stays in the payload; only the
rendering went, with its tests and its two sweep assertions. Deleting the
retired rows takes the three winding-down banners with them — those were
a symptom of the rows existing, not a separate thing to remove. The
winding-down CODE stays: nothing exercises it today, but the next row
retired while holding something will need it, and its `riskGate` half (a
paused strategy may still EXIT) is a correctness fix either way.

**Paper, 38 hours in** — asked for and worth recording: `trend-1h` is the
only row to complete a round trip, +$0.1734 on $40 over three coins;
`trend-4h`, `momentum-1d` and `trend-4h-kraken` are each long three coins
and flat on realised. The Kraken twin paid **$0.16 in fees against the
Revolut X row's $0.036 for the identical three fills** — 4.4×, which is
§3.12's arithmetic showing up in the paper record on day two.

**AVAX and SUI have never traded.** They joined `trend-4h` at
2026-09-21 14:11 (`0039`/`0040`) and the row's three fills all predate
that — which is why those fills are $13.33 (40/3) rather than $20
(100/5). Both read trend up, momentum positive, position flat, breakout
NOT above range: the rule has not offered an entry. **So the paper record
carries zero evidence about the two coins Davies is asking about**, and
the answer to his question has to come from the backtests, not from the
live rows.

### [2026-09-22 03:22 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The four settled choices were re-asked with everything now available,
and nothing changes — with a margin behind each.** §3.19, the last of the
studies. Four windows, both tapes, and for the bear year a THIRD: Revolut
X's own book. 98 arms, 15 pass the worst-window test, **49 expected by
chance** once the arms' correlation is MEASURED (0.63–0.83) rather than
assumed. The bar for a change was set before the search: beat the
incumbent on the worst of four windows in all four evaluations.

- **Coins**: 3 of 25 pass, and **not one add candidate is admitted by
  §4.15's bar** — ATOM's UK book is a sixth of the floor, ICP fails
  window B in every condition.
- **Weights**: equal slots stands. Two arms beat it on the worst window;
  **0 of 6 beat it in the bear year on any of the three tapes**, and both
  look worst on the venue's own book. The arm §3.15 predicted would fail
  was priced instead of assumed — weighting by windows-cleared fails 0 of
  4 honestly AND 0 of 4 with look-ahead, while a return look-ahead is
  worth +1.68…+2.59. The lever works; the evidence for aiming it does not
  exist.
- **Mechanics**: window D re-orders every search nearly end to end (rank
  correlation down to −0.81) and changes no setting: 9 of 42 beat the
  shipped one on the worst window, **0 on every window**. Every winner
  buys D by giving back A or B. §3.17's finding from another direction.
- **Venue**: settled, and it is arithmetic rather than a backtest.
  Verified here from `COSTS`: **the worst Revolut X round trip is TON at
  53.8 bps, the best Kraken one is BTC at 80.0 — the two schedules do not
  overlap, by 26.2 bps.** Kraken at its best costs more than Revolut X at
  its worst. 3 of 372 cells favour Kraken; 0 of 50 on the venue's own
  book. **The question should stop being asked until a fee tier moves.**

**One finding that does NOT generalise, and the study said so itself.**
§3.16 found the tape disagreement had no direction. Against the venue's
own book it does: **Revolut X reads lower than Kraken on 21 of 25 coins,
p = 0.00091** (recomputed here from the raw counts, exact). So a per-coin
Kraken figure is mildly optimistic about the book the orders meet. It
does not carry to the live five, and the bear-year sleeve on the venue's
own book is **+10.39 %, ret/DD 0.98** — better than either published tape.
Note the study counted one observation per coin rather than per cell,
which is the pseudo-replication trap §3.16 caught itself in: it learned
from the study before it.

Verified here: re-run byte-identical; three `runSet` paths against `run`
at 844 cells each, zero; **3,456 cells against `tape.json`, zero differ**
(so the harness IS §3.16); §3.17's published row table typed back in at
worst |Δ| 0; the cost-schedule arithmetic recomputed independently.

**The agents feature has no open work item left except Davies' go-live
decision.**

### [2026-09-22 02:59 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The probe summary reached the payload and stopped there.** `0042` has
been collecting since 00:20 and `probeSummary` went into the dashboard at
01:12, but `src/agents.jsx` never referenced `makerProbes` — the number
that answers the maker-versus-taker question was computed, shipped to the
browser, and drawn nowhere. Found it by grepping my own work rather than
by being told, which is the only reason it did not sit there for a week.

`probeLine` now renders it under VENUES: fill rate, median wait, and the
adverse move with §3.13's 10–20 bps break-even read against it. **The rule
it enforces is that an unresolved probe says so** — *"no probe yet"* or
*"3 resting, none resolved yet"* — and never a 0 % fill rate or 0.0 bps.
A zero on no evidence is exactly what this page printed once about AVAX
while the loop was reading it every minute. Pinned four ways in
`agents.test.js` (none / waiting / measured-without-follow-up / the
break-even reading), and the browser sweep now asserts the unresolved
state renders **with no percentage and no bps in it at all** — 210 checks.

917 vitest, 327 Deno, lint and typecheck green.

### [2026-09-22 02:52 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The split nobody had modelled is worth −0.05 points, and the proxy
everyone would have reached for is worth −4.93.** §3.18. The loop decides
on Kraken's candles and fills on Revolut X, and no table here had ever
priced that; the study priced it on the venue's OWN book for window A,
which is possible because those candles turned out to be public.

- (b) published, Coinbase throughout: **+7.62 %** / 0.67
- (a) §3.16's Kraken arm: **+8.74 %** / 0.80
- **(c) what the loop actually does: +8.69 % / 0.78**

So **(c) − (a) = −0.05 points** and (c) − (b) = +1.07. The thing that was
never modelled is worth five hundredths; the thing §3.16 already measured
is worth twenty times more. 296 real fills: adverse cost **0.057 bps a
round trip**, 0.29 % of the cheapest round trip, no direction (141 vs 149,
p = 0.68). §2c's ≤ 3 bps was the right order of magnitude. **No verdict
moves**: 1 of 23 coin-windows flips on the bar (ICP, in no row), none of
the five live coins, leave-one-out unchanged, §3.11's ranking holds.

**Two things from it worth keeping, both about method.**

**The fidelity check caught a 19-point artefact.** The first split
trailed high-water on the FILL tape; `tick.ts` trails it on the SIGNAL
tape (verified here: `bars` is `signalFor(s, sym).bars`). High-water is
an input to a DECISION, not a price paid. That error manufactured AVAX
window A at +31.75 % against the correct +12.49 %, out of two tapes that
agree to 4 bps. A plausible split would have produced a large, clean,
fictitious result.

**A stop fires on the low, which is the price venues agree on least.**
Verified against all three tapes: SUI entered near 0.8757, floor 0.8056,
and on the 2026-09-20 00:00 bar Kraken's low is 0.8124 and Revolut X's
0.8100 — above it — while **Coinbase's is 0.8051**. Six basis points of
wick. The Coinbase-fill arms stop out and book +1.4 %; the arms filling
on Kraken or Revolut X hold to 1.01 and book +29–30 %. That is why
filling on Coinbase is not an acceptable proxy, and why **windows B, C
and D must be read off §3.16's Kraken arm**, which is already published.

Verified here: re-run byte-identical; `runSplit` vs `run` 2,600 cells and
903,928 curve points at zero; arms (a)/(b) reproduce `tape.json` on 2,520
cells per stop rule; the SUI wick and the `bars` provenance checked
independently in the repo and the raw tapes.

**Still running**: the coins / weights / mechanics / venue study.

### [2026-09-22 02:14 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The pre-live should-fix list is closed, and three of its four items had
been done for a day without the record saying so.** Went to fix S13, S14
and S15 and found each already shipped: `newestWins()` guards the
dashboard render AND the module cache, with `loading` set only on a
manual refresh or a cold open (S13); `sizeText(base, m)` masks every size
on the page, its own comment giving the reason — a size beside a mark IS
the value (S14); `agentsAlerts` raises `live-unconfirmed` whenever a row
is live and `live_confirmed_at` is null (S15). **A list that says a thing
is undone when it is done is the same failure as the reverse**, and this
one sat two lines from a go-live decision. §4.17 now says what is true.

**One alert had gone stale in the dangerous direction.** `paused-long`
told the reader that "no stop, trail or exit runs on a paused row" —
correct until 02:00 today, and the exact opposite afterwards. It now
reads `winding-down` at a `paused` tone when the payload carries the
`windingDown` flag, and **stays a fault when it does not**: the flag is
the evidence that the exits are running, and a page must not claim
protection it cannot see. Pinned both ways.

**The sweep fixture is refreshed to the post-`0043` payload**: four rows
instead of seven, `makerProbes` in it, and the three assertions that had
hard-coded seven rows corrected with it. That fixture had been modelling
a set that no longer exists since the retirement migration this morning.
208 browser checks green, 913 vitest, 327 Deno.

**Both studies still running** (the fill split; coins / weights /
mechanics / venue), each resumed with the Revolut X tape finding.

**What remains on the agents feature**: nothing from the pre-live review.
The open items are the two studies, and then Davies' go-live decision.

### [2026-09-22 02:05 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Revolut X's own candles are public, and the repository was wrong about
them twice.** A study agent found the endpoint while building the fill
study; verified here. `GET /1.0/public/candles/{SYM}?interval=240&region=UK`
— **no key**, 1,000 candles a call, paged with `until=<ms>`, `region=UK`
because §4.14. Pulled for all 27 coins: **2,257 four-hour bars each,
2025-09-11 → 2026-09-22, 376 days = 1.03 years**, no gaps but TON (2) and
ETC (1). So §2.3's "hourly available for the same [three-year] span" was
wrong, and §3.16's "needs a signed endpoint and is unreachable from a
harness" was wrong; `backtest.ts`'s header — one year of intraday — was
right the whole time. Both corrected in place.

**What the one year means**: the venue's own book covers walk-forward
window A (out of sample 2025-09-10 → 2026-09-20) with a day to spare, and
**none of B, C or D**. That turns §3.16's T4 from an argument into a
measurement — moving `signal_venue` to `revx` would delete three of the
four windows — and it lets the fill study price the bear year on the REAL
book instead of a proxy. Data is in the scratchpad (`revxuk/`, puller
`pull_revx_uk.py`), which does not survive the container; the endpoint and
the pull recipe are now in §2.3, which does.

**The thin-book guard is built** (ledger item 0b, open since the region
bug, and more pressing since the intra-bar trail went and the floor became
the only stop between bars). Two halves, opposite directions on purpose:

- **A long's stop is judged at the BID** (`exitMark`), not the mid. It was
  always checked on the mid and filled at the bid — half a spread of
  wishful thinking, 0.75 bps on BTC but 21 on SUI and unbounded if the
  book goes wide — which says a position is above its floor while the
  money available for it is below. The stop fires late, into a worse
  price, exactly when the book is worst.
- **An entry is refused above 50 bps of book** (`WIDE_SPREAD_BPS`), since
  every Revolut X entry crosses and pays the ask, so a wide book charges
  its width on top of the 9 bps. Measured UK book: 1.5–24 bps. The EEA
  book was once seen at 180. `bookBps` goes on the decision row so the
  refusal is auditable.
- **An exit is never refused by the guard.** A stop exists for exactly the
  minute the book is ugly.

Pinned: `exitMark`, `spreadBps`, and an end-to-end case that refuses the
entry on a blown-out book while the floor still fires on the same book.
327 passed.

**Both studies resumed** after a session limit cut them off at 02:00 UTC
(fill study; coins / weights / mechanics / venue), each told about the
Revolut X tape and its one-year span.

**Still open**: S13 (dashboard refresh race), S14 (unmasked sizes), S15
(the missing live-unconfirmed alert), the sweep fixture.

### [2026-09-22 01:33 UTC] Platform: Claude Code | Model: not recorded (session policy)

**I made S11 real, then fixed it — and it was worse than the review
said.** `0043` retired three rows that were still LONG (checked against
the live table: `momentum-1d-kraken` 0.126, `rotation-1d` 0.189,
`rotation-1w-kraken` 0.189 base). `0038` got away with the same move only
because `dislocation-1m` was flat. Under the old rule those positions had
no exit path at all, in two independent places:

1. the tick skipped a paused row entirely, so no floor and no rule exit
   ran and the page hid it; and
2. **`riskGate` refused a paused strategy's EXIT** — that test sat ABOVE
   the `action === "enter"` branch whose own comment reads "an exit
   reduces risk and is never refused here". The gate that exists to let
   positions out was the thing holding them in. It was pinned, twice, so
   it was a decision rather than a slip; the decision was wrong.

Fixed: the tick reads retired rows, derives the book, and keeps running
the exits of any still holding (`windingDown` in the report), refusing
every entry through one gate inside `decide()` so a later code path
cannot miss it; a retired row that is flat is skipped before any decision
work. `riskGate` moves the paused test inside the enter branch — the
GLOBAL pause still outranks an exit, because that one is a person's
emergency switch. The dashboard shows a winding-down row until it is
flat, and filters retired-and-flat rows BEFORE the aggregates are summed
so the page's totals keep the meaning they had. Pinned: three
winding-down cases in `tick.test.ts`, the corrected gate in
`strategy.test.ts`. 324 passed.

**The probes are readable now** (`probeSummary`, in the dashboard
payload): fill rate over resolved probes, median minutes to fill, and
`adverseBps` at +15 / +60 minutes, **signed so POSITIVE is against the
fill**. That median against §3.13's 10–20 bps band is the whole
maker-versus-taker answer. Pinned in `index.test.ts`.

**Two studies running**: the decide-here-fill-there split (§3.16 named it
and nobody has ever modelled it), and coins / weights / mechanics /
venue re-asked on four windows × both tapes.

**Still open from the pre-live review**: S13 (dashboard refresh race),
S14 (unmasked sizes), S15 (the missing live-unconfirmed alert), the sweep
fixture, and the thin-book guard (ledger item 0b) — the last one matters
more now that the floor is the only intra-bar stop.

### [2026-09-22 01:12 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Two studies land: the tape does not change what to run, and nothing
repairs the sideways year.** Both re-run here byte-identical; both were
interrupted by a server-side 529 after handing back, and both had already
written all three of their files.

**§3.16, the tape.** The gap between Kraken's tape (what `signal_venue`
makes the loop read) and Coinbase's (what every table is priced on) is
large — median **4.03 points**, p95 31.3, max 70.4 over 288 comparisons,
9.0 % sign flips, **5.9 % of §4.15 verdicts flip** — and it has **no
direction**: Kraken higher in 149 cells, Coinbase in 139, p = 0.596;
p = 0.690 per coin. Recomputed here from the raw cells, every figure
reproduced. The study caught the trap in its own data: cell level looks
tilted in window A at p = 0.0035, but that is pseudo-replication and at
one observation per coin it is p = 0.690. **The sleeve moves about a
point** (A +8.0 → +9.2, B +20.1 → +22.5, C +55.6 → +50.9, **D identical**
— D is Kraken bars on both arms by construction), so the recommendation
stands. **Per coin it moves up to thirty**: AVAX's bear year +34.1 % →
+12.6 %, SUI's +1.4 % → +29.1 %, and the coin most expensive to remove
swaps from AVAX to SUI. §3.15 survives both findings on Kraken's tape.
Its Coinbase arm was checked against `windows.json` **cell for cell,
4,464 cells, zero differ**, with the file's SHA-256 recorded and matching
— so the two studies are the same arithmetic and every difference is the
tape. **Decision: change neither `signal_venue` nor the arithmetic.**
Switching to `revx` deletes windows C and D outright (Revolut X history
starts ~2023-08), moves the decision onto a book 100–300× thinner and
re-opens §4.14's region trap. The labelling was what was wrong.

**§3.17, the TESTING set.** Nothing repairs the sideways year — **0 of 33
gate arms** under either stop rule — and the reason is one number:
Pearson(how much a gate refuses, Δ window C) = **−0.85**. Everything that
helps the sideways year helps by being out of the market, which is
exactly what costs the strong bull. A trend rule's worst regime is the
other side of the trade that makes it work. Migration `0043` retires
`momentum-1d-kraken`, `rotation-1d` and `rotation-1w-kraken` (0.90–1.00
correlated with a row that stays, worse in all four windows, two over the
35 % drawdown limit in the bear year), in place with `retired_at` —
`0038` already learned that DELETE is refused by the decisions foreign
key. **`trend-1h` is KEPT, reversing §3.14**: on four windows it is
positive in all of them under both stop rules and is the only row of
seven with half its grid positive in all four, and it is the best row in
the sideways year (+16.2 %, drawdown 5.6 %, plateau 96 %). Its return is
still not the argument — one row of seven clearing everything is what
chance gives (P = 0.29–0.71), and +5 bps a fill takes its bear window
from +3.8 % to +0.6 %. Kept as a measurement row. **Nothing added**:
every candidate priced is inside chance. Row capital $440 → $280, live
exposure exactly at its $100 cap, no cap moves.

**Pushing `0043` applies it.** It pauses three rows and touches no data.

**The next study, named by §3.16 and not done**: the loop decides on
Kraken and FILLS on Revolut X, and no table in this repository simulates
that split. §2c's ≤ 3 bps basis suggests it is small against 9 bps of
taker fee — suggests, not measures. Also unresolved: §2.3 says Revolut X
has three years of hourly history and `backtest.ts`'s header says one;
only a keyed probe settles it.

### [2026-09-22 00:19 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The maker question now has an instrument instead of an argument.**
Migration `0042` adds `agent_maker_probes`. Revolut X is 0 % maker and
the loop crosses the touch, so "rest everything and pay nothing" is the
standing question; §3.13 could not answer it because the backtest runs on
Coinbase candles with a synthetic bid and duly reports that a resting
order fills with a median delay of ZERO hours — the model's limit, not a
measurement. What it cannot see is the only thing that decides it: on a
breakout rule a resting bid fills exactly when the breakout fails, so the
fills you get are the bad half of the distribution.

The probe measures that on the real book at no cost and without resting
anything. Every marketable order writes down where a post-only order
would have sat (the same side's touch); turn 2b resolves it against the
execution venue's last closed minute — came back or not, and after how
many minutes — and then records the mark at +15 and +60. That last gap is
the adverse selection in bps, read against §3.13's 10–20 bps break-even
band. **A probe is never an order**: not in any position, book, exposure
or P&L; written last in `place()` so a probe that fails to insert cannot
cost an order; and it adds one public minute-candle call only on a symbol
the loop has just traded.

Two design notes worth keeping. The tick's read is a single
`watching=eq.true` over one partial index, NOT a compound predicate over
`state` and `follow_up` — the first version used PostgREST's `or=(…)`,
which the test stub rightly refused, and the simpler column is better
anyway. And the insert writes `state`, `watching` and `follow_up`
explicitly rather than leaning on column defaults: the starting state of
a probe is part of what the code means.

Pinned by `tick.test.ts`: `probeFilled`, `probeFollowUpDue`, and three
end-to-end cases (a marketable order opens a probe at the OTHER side's
touch and places nothing extra; a resting probe fills or expires against
the minute; a resolved probe collects m15 then m60 and stops being
watched). 320 passed / 0 failed.

**Pushing this migration applies it** — `migrations.yml` runs on push to
main. It creates one new table and touches nothing existing.

**Two studies running**: re-pricing the reference on Kraken's tape
(§3.14's problem), and the TESTING-set optimisation on all four windows.
The TESTING-row migration waits for the second one.
