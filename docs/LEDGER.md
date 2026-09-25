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

00000000000000. **HANDOVER, 2026-09-24 ~20:30 UTC: ONE Cursor session on this repository, rotating between Opus 5.5 and
   Grok 4.7 — goals and plan, in priority order.** Everything is committed and pushed (`main` at the commit that adds
   this item; CI green on `9f3e8a6`, the last code commit). Read `.claude/CLAUDE.md`, the working-with-davies skill and
   this list first; reply to Davies in Chinese; commit as daviesluo; run `sh bin/gates.sh` before every push; the
   ledger line goes in the same commit. Nothing below needs a new strategy or a new study: the work is running things
   that exist and deciding them by their pre-registered bars.
   - **Rotation (Davies switches the model inside the one session).** The model that is about to be switched away
     from cannot know it, so every turn ends in a state the other model can pick up: work lands as small COMPLETE
     commits, each with its ledger line, pushed; nothing is left half-edited in the tree at the end of a turn. A model
     that finds itself newly active (or is told "切换了") first runs `git status` and `git log -5`, then re-reads this
     item and the newest history section before touching anything; anything uncommitted it did not write is shown to
     Davies, not discarded. Each history section's source header names the model that did the work
     (`Platform: Cursor | Model: Opus 5.5` or `Grok 4.7`). The first thing a newly active model does with the other's
     latest code commit is read its diff adversarially — the two models reviewing each other is the point of rotating.
   - **G1 — keep RW's paper test healthy, daily (item 000000000000).** It runs by itself (cron `agents-pmrw-every-minute`,
     `agents-pmrw-select`). Once a day read §4 item 36's R1–R5, or the Agents page ("Reward quotes" → its page):
     `pm_rw_state.last_error` empty and `last_minute` within ~3 min; today's `pm_rw_selection` present by ~00:05 UTC;
     `pm_rw_days` gains a row a day; `net._http_response` has no 546 (CPU) or 5xx for `action=pmrw-select`; the page
     shows no "fills and total differ" warning. Do NOT change `agents/pmrw.ts`'s rule (the spec is frozen); a bug fix
     is allowed only as a recorded deviation (spec, reference, ledger) with a pin that fails on the old code.
     **Last read 2026-09-24 21:06–21:10 UTC (Cursor): healthy** (numbers in that history section). `pm_rw_days` is
     empty until the warm-up day closes at ~00:02 on 09-25 (`closeDays` writes a day only when it ends), so the next
     read checks that row and 09-25's selection. The page's `rw` without a password: `net.http_get` of
     `agents?action=dashboard` with the Vault `cron_secret` (as the cron jobs build it), then read
     `content::jsonb->'rw'` from `net._http_response` (`mismatchUsd` is the warning's figure).
   - **G2 — RW's verdict, on or after 2026-10-09 00:05 UTC** (the procedure is in item 000000000000, step 3). Then the
     page row stays as a record until Davies says otherwise, and the two cron jobs are unscheduled by a migration.
   - **G3 — only if RW passes, and only on Davies' word: design (not build) RW's live test** under this item's plan:
     `eu-west-1` only (refuse unless `SB_REGION` is `eu-west-1`), open positions only while his Ireland attestation is
     current (an expiring timestamp set in conversation), reduce or close only otherwise; never a VPN, a proxy or another
     account; `_shared/polymarket.ts` stays GET-only until the design is agreed. The design says: order signing (the
     CLOB's EIP-712 orders and L2 headers), a dry-run first, caps, the kill switch, reconciliation by order id, and
     reading the account's actual reward payouts to compare with the formula — the one thing paper cannot show.
   - **G4 — trend-4h is LIVE at $50: `0054_go_live.sql` applied 2026-09-24 22:51:15 UTC, armed 22:53:09 UTC** on
     Davies' word ("验证没问题的话就上线，并盯着上线情况", 22:35; at 22:40: "上线后的买卖不需要找我确认，如果真的需要你帮忙盯
     着就行" — no confirmation of his for any trade after the go-live; the session watches, and the read-back is the
     session's). The first bar it can enter on closes 2026-09-25 00:00 UTC; nothing is held and no live order exists.
     **Watch (read-only, report to Davies, never ask):** at each 4h close + 3 min (00:03, 04:03 … 20:03 UTC) read the
     live row's four decisions beside `trend-4h`'s (same `rule_action` per coin), `agent_orders` where `mode = 'live'`,
     `ops_errors` and the tick's cron runs; five minutes after a live order, its read-back; every 15 minutes while it
     holds a position (the 8 % floor fires in any minute). Report a live order, a fill, an order `pending` over 2
     minutes, a missing decision, a live-row error or a failed tick. Nothing sends an alert by itself (the page's
     banners and the admin badge show only when the site is open). The queries, one per check, are in the Cursor
     project store's `internal/trend-4h-watch.md`. **The first buy's read-back** (before its exit): the fee fields the
     venue sent or `feeDerived`, `filled_base` in whole `base_step`s (D11), `fromAccount` (D12), and the coin's balance
     against the book (the probe, booleans only); after the sell: the book flat and the account under one step. **Cap
     steps:** 15 → 30 once that first round trip reads back clean, → 75 after seven clean days; each is one statement
     (`update public.agent_risk set max_exposure_usd = … where id = 1;`), and Davies is told when it runs. In the Claude Code session the move below was refused by the tool's permission
     layer (it is the act of going live), so it is Davies' to allow or to run himself. The verification: paper
     `trend-4h` healthy (30 decisions in 24 h, the last at 20:00, flat after its three exits) with params identical to
     the draft's; `ops_errors` only four transient timeouts, each handled (nothing placed that turn); the read-only
     probe — key `pkcs8-b64`, no active orders, BTC/ETH/SOL/AVAX `active` on the UK book (2.9–10.6 bps), the
     sub-account holding USD only and at least $51; `global_pause` false, `live_confirmed_at` null; the draft's
     INSERT checked against every constraint of `agent_strategies` (kind, venue, signal venue, mode, capital, NOT
     NULLs, no trigger). The steps, unchanged: move
     `docs/agents/go_live.sql.draft` to `supabase/migrations/0054_go_live.sql` (0053 is RW's), push, read the
     `migrations.yml` run, arm `live_confirmed_at` in that conversation, confirm the first live order with him, and have
     the first buy read back by a person before its exit. He funds ≥ ~$51 USD in the Revolut X sub-account first. Never
     trade by hand in that account.
   - **G5 — PR5 (GBP stablecoin quotes): NOT ready for live (checked 2026-09-24 20:35 UTC); the four-week review is
     on 2026-10-21** (items 00000000000, 000000000 §2). The paper engine and the dry-run are healthy (no error), but
     after ~29 h the paper test has 0 round trips (3 fills), and **L3 is not empty: 2 dry-run entries sit 1 and 4
     ticks below the paper order they carry out** (id 4, USDT-GBP bid 0.7544 against 0.7545, refused on its first
     minute because the paper bid was above the live ask; id 108, USDT-GBP bid 0.7543 against 0.7547, 12:44 UTC).
     **Both rows EXPLAINED AND FIXED 2026-09-24 21:35 UTC (Cursor): one executor defect** — it carried out a paper
     order the engine had REFUSED, including the ticks the rule re-prices a refused order to while it waits (reference
     §4 item 35, "A refused paper order is no decision"). After the deploy L3 must stay empty and L4 list only guard
     or governor minutes: check both on the next read. **The ~9 % order shortfall is RECONCILED** (reference §4 item
     31, `backtests/pr5_live/reconcile_first_day.py`): the frozen simulator on the stored inputs matches the engine in
     every minute to 21:47; the twelve orders are one USDT-GBP re-price and its reversal at 21:48 / 21:58, which hinged
     on 0.106 bps and on an input the engine does not record. **Davies approved recording X and fairU every minute**
     ("这个你觉得需要的话就加上", relayed at 22:38 UTC). The table is `0055_quote_minutes.sql` (`agent_quote_minutes`),
     pushed on its own so it exists before any writer; the engine change that writes it deploys at 00:03 UTC or later,
     after the 00:00 close is decided, because `trend-4h-live` runs in the same `agents` function. Decisions stay
     byte-identical with or without the record (pinned on the first evening's minutes). **Its first round trips (Davies asked at 22:52 whether it can meet the go-live standard now):** not
     decidable yet — the standard is the spec's six conditions after four weeks (2026-10-21), and the three trips so far
     are one event; the conditions that can be read early are on track (reference §4 item 31, "The first round trips").
     Live stays a NO-GO until the review; going live is one statement on his word.
   - **G4a — DONE.** The Agents page on LIVE and TESTING tabs is on `main` at `7a015b6`. Production
     `daviesportfolios.pages.dev` serves `app-cc8519ef.js`, and the agents chunks match the committed files (23:34
     history). The remote branch `agents-live-testing` is gone; its pre-rebase head is in the 23:29 section.
     Davies decided the two paper tests count (23:41): TESTING's scoreboard includes both, the Revolut X card includes Stablecoin quotes, and Reward quotes stays on the Polymarket card.
   - **G6 — housekeeping.** **The 75 stale branches are DELETED** (2026-09-24 22:49 UTC, Cursor; every head is in that
     day's 22:48 history section, restorable). **`pm-geo-probe` is DELETED** (2026-09-24 23:25 UTC): the one-off step in
     `1883785` ran `supabase functions delete` with CI's PAT, the log says deleted, and the live list at 23:26 has the
     eleven repository functions and not it. The step is gone again in the commit that records this. Keep the
     Polymarket wallet empty or small.
   - **Where things are:** RW — `agents/pmrw.ts` (engine), `agents/pmrw_view.ts` (page summary), `_shared/polymarket_public.ts`
     (keyless client), `0053_pm_rw_paper.sql`, spec `docs/agents/reviews/2026-09-24-polymarket-rw-paper-spec.md`, study
     `…/2026-09-24-polymarket-fp4-study.md`, reference §3.33 and §4 item 36. PR5 — `agents/quotes.ts`, `quotes_live.ts`,
     `0051`/`0052`, §4 items 31 and 35. Go-live — `docs/agents/go-live.md`, `0054_go_live.sql`, §3.31, §4 items 32–34.

0000000000000. **`main`'S HISTORY WAS REWRITTEN (2026-09-24, Davies' word): every commit's author and committer is
   daviesluo; the content is byte for byte the same (final tree `a09ad6a`, 1,053 commits, dates kept).** Old hashes map
   through `docs/commit-map-2026-09-24.md`. Remaining:
   1. ~~The other 75 branches (48 `claude/…`, 3 `cursor/…`, 2 `agent-remote/…`, 22 old feature branches)~~ **deleted
      2026-09-24 22:49 UTC from Cursor**, whose git token may delete branches where Claude Code's proxy answered 403;
      each head is in the 22:48 history section. The open pull requests all closed when `main` was replaced, and
      dependabot removed its own 14 branches.
   2. Any clone made before the rewrite (his machine's, Cursor's) must be re-cloned or reset to `origin/main`.

000000000000. **POLYMARKET: THE ACCOUNT VERIFIED READ-ONLY; POSITIONS MAY OPEN ONLY FROM IRELAND, WHILE DAVIES IS THERE (2026-09-24).**
   `?action=probe&only=polymarket` (`_shared/polymarket.ts`, reference §2d, results §6) ran from London (02:54) and,
   with `x-region: eu-west-1`, from Ireland (03:20). Every stored name is set and consistent; the private key controls
   the stored signer; the L2 credentials authenticate; the funder is the profile's proxy wallet; not closed-only; no
   open orders; the wallet effectively empty. The geoblock answers `blocked` for both (GB, and IE because it speaks for
   the frontend). Davies is resident in Ireland as well as the UK and approved the Irish region; Ireland is close-only
   on the frontend only. **The rules an order path follows** (reference §2d, `.claude/CLAUDE.md`): it runs only in
   `eu-west-1` (refuse unless `SB_REGION` is `eu-west-1`); it opens a position only while his attestation that he is in
   Ireland is current (an expiring timestamp he sets in conversation); otherwise reduce or close only; never a VPN, a
   proxy or anyone else's account. Remaining:
   1. **The search reported (fp4, reference §3.33, `reviews/2026-09-24-polymarket-fp4-study.md`): FAV and WX fail;
      RW — minimum-size two-sided quotes for the liquidity rewards — passes its forward bar** on 268 recorded minutes
      of one day (+$46.61 on $480: rewards $50.92 by the published formula, fills −$4.31), and would not survive
      reduce-only stretches. The study's §0 finds that the Terms of Use bar residents of the UK and Ireland from
      trading; Davies read it on 2026-09-24 and said the plan continues.
   2. **RW's paper run is RUNNING since 2026-09-24 19:30 UTC** (`201c19f`; migration `0053`, `agents/pmrw.ts`,
      reference §4 item 36, spec `reviews/2026-09-24-polymarket-rw-paper-spec.md`): a warm-up until midnight, then
      fourteen days, 2026-09-25 00:00 → 10-09 00:00 UTC; read it on the Agents page (the last testing row, "Reward
      quotes", and its page, `9f3e8a6`) or with §4 item 36's queries R1–R5. The paper reward is the published formula's
      against the visible book, an upper bound on what an account would be paid. At 20:13 UTC (warm-up, 42 minutes):
      16 markets, 38 fills, total +$36.61 (rewards $30.27, fills +$6.35), stress −$0.33 — the stress arm, not the
      total, is the figure to watch; realised + unrealised equalled the engine's total to 1e-14.
   3. **The verdict, on or after 2026-10-09 00:05 UTC** (once `pm_rw_days` has the row for 2026-10-08), written up as
      `docs/agents/reviews/2026-10-09-polymarket-rw-paper-result.md`, reference §3.x and this ledger:
      a. The bar, exactly as the spec words it, from `pm_rw_days` (the fourteen run rows, 09-25 … 10-08): each day's
         total is the change from the row before (09-25 against 0; the warm-up row counts nowhere); (1) total > 0;
         (2) stress total > 0; (3) ≥ 100 fills; (4) no market over 50 % of the total and the total without the best
         market > 0 (per market from the last row's `detail.perMarket`); (5) Python `random.Random(20261009)`, 2,000
         draws of fourteen `choice`s of the day totals, sums sorted, the one at index 100 > 0; (6) the total on the run's
         capital (the largest daily `capital`) × 365 / 14 > 4 %. Commit the script with its output.
      b. The engine ran the rule: replay the stored `pm_rw_minutes` rows with the stored `pm_rw_prints` through the
         frozen rule (`stepRw`, or `rw_test.py`'s `run_market`) and reproduce `pm_rw_fills` and the rewards.
      c. No print was missed: pull every quoted market's prints for the run again from `/v2/trades` (cache-busted, as
         `pmPrints` does) and compare with `pm_rw_prints`; any print the engine did not see is a deviation — recompute
         with the full prints and report both.
      d. A migration unschedules `agents-pmrw-every-minute` and `agents-pmrw-select` (the tables stay).
      e. Report to Davies in Chinese. Passes → G3 of the handover item (a design, on his word). Fails → RW stops. After 10-09: the bar from `pm_rw_days` (a day's total
      is the change from the day before; bootstrap seed 20261009); the stored minutes replayed through rw_test.py's
      rule, and each quoted market's prints pulled again to show none was missed; then a migration unschedules
      `agents-pmrw-every-minute` and `agents-pmrw-select`. It passes → a live test under this plan; it fails → RW
      stops. Only an account that quotes can show what Polymarket actually pays.
   4. The key was exposed to another tool: keep the wallet empty or small; revoking that tool's Supabase token is his.

00000000000. **PR5'S LIVE PATH: PUSHED (`0aca828`), RUNNING IN DRY-RUN SINCE 02:40 UTC 2026-09-24** (reference §4
   item 35). `0052` applied; the executor writes its state every minute, with no error. Its first minute (02:41)
   recorded six would-be bids, one per paper bid; five would rest and one would be refused because the paper bid
   (placed at 00:18) sat above the live best ask. The asks are skipped because the account holds only GBP.
   - **What it is:** `agents/quotes_live.ts` and migration `0052`. The executor carries out the paper engine's decisions
     order for order on PR5's own sub-account, with the design's hard limits.
     - Orders are post-only and written `pending` before the POST. They are reconciled by client id, and fills come only
       from the venue's read-back, through the tick's D11/D12 (`bookLiveBuy`).
     - The limits: the governor at 600 and 700 POSTs; the loss stop at −1 % of £50; the de-peg guard at 50 bps; stale
       inputs; the 24-hour stop as an IOC bounded at 50 bps; the kill switch
       `agent_quote_live_config.live_confirmed_at`; and `global_pause`.
     - `0052` puts the config in dry-run and unarmed. The dry-run sends nothing, and reads the sub-account's balances
       each minute.
   - **The evidence:**
     - 31 pins, and 32 counterfactuals, each caught.
     - The golden stop window replayed through it: every live entry is a paper order, and no rung ever held two open
       orders.
     - `0052` applied to PGlite refuses what the test double refuses.
     - Deno check clean, 494 passed; knip clean.
   - **What remains before live, in order:**
     1. Done: pushed (`0aca828`, `0052` applied); `.claude/CLAUDE.md` follows (`6b7f1c4`).
     2. Done: the trend-4h go-live draft moves as `0054` (RW's paper test took `0053` on 2026-09-24).
     3. Watch the dry-run against the paper engine for at least a day, with §4 item 35's L1–L5. L3 should be empty;
        L4 should show only guarded minutes.
     4. Davies' word. Then, in that conversation, run
        `update public.agent_quote_live_config set dry_run = false, live_confirmed_at = now() where id = 1;`,
        and confirm the first live order there.
     5. Optional, for the asks: `POST ?action=quotes-convert {"book":"USDT-GBP","gbp":12.5}`, which previews the
        order; `"send": true` then sends it, only while live and armed.
     6. Not built: the page (the design's item 9).

0000000000. **THE SECOND REVOLUT X KEY: VERIFIED ON THE FUNDED SUB-ACCOUNT (2026-09-24 01:43 UTC).** Davies stored
   `Revolut_X_API_kEY_2` / `REVOLUT_X_PRIVATE_KEY_2` for PR5. `?action=probe&only=revx2`, read-only: key form
   `pkcs8-b64`; balances, pairs (393) and a signed call with a query all 200; USDC/GBP, USDT/GBP, USDC/USD and USDT/USD
   `active` (base step 0.00001, quote step 0.0001, minimum 0.1 in the quote); UK tickers at 1.3 bps; no active orders.
   The first run (01:37) read another account (no GBP, a coin balance); Davies had mixed up the accounts, and the
   re-run at 01:43 reads the new sub-account holding GBP only, the £50 he moved in. The rows' key (`only=revx`) reads
   the USD sub-account, funded above the $51 the $50 go-live needs, with no orders. Only the probe reads the second
   key; the PR5 live path is being built dry-run first.

000000000. **DAVIES' REQUESTS OF 2026-09-24 ~00:00 UTC: two strategies live
   at $50 each, after a final validation that fixes what it finds.**
   1. **`trend-4h` at $50: GO on his word. The code and the draft are
      ready.**
      - **S2** (`reviews/2026-09-24-trend4h-golive-validation.md`, reference
        §3.31) replayed the paper row bar for bar, and the database agrees
        (read-only, about 00:55 UTC):
        - Q1: 95 bar decisions through the 09-23 20:00 bar (BTC/ETH/SOL 21
          each, AVAX/SUI 16 each). The only non-holds are ETH entering on
          the 09-21 00:00 bar, BTC and SOL on 08:00, and ETH exiting on
          09-23 12:00, with rule and final equal on each.
        - Q2: no protective decisions.
        - Q3: four paper fills, all marketable, all 9.00 bps: buy ETH
          2665.74 (09-21 04:00:07), buy BTC 84848.67 and buy SOL 116.788
          (12:00:08), sell ETH 2655.55 (09-23 16:00:06). The predicted ETH
          trail exit is confirmed.
      - **D11** (`bf80626`) and **D12** (`29dbd8b`) are fixed and pinned
        (§4 item 33): a live buy books only what the account can sell.
        With no fee reported, it books from the balance and records
        `fromAccount`.
      - **`go_live.sql.draft` is at $50** (§4 item 34): capital 50, four
        $12.50 slots, exposure cap 15. It rises to 30 once a person has read
        the first round trip back, and to 75 after a clean week. Daily loss
        stays 5 and orders 40. `live_confirmed_at` is written null.
      - **Left, all his:**
        - the go, which means moving the draft into `supabase/migrations/`
          as the next free number (`0054`: RW's paper test took `0053`);
        - funding: at least about **$51 of USD** in the Revolut X
          sub-account;
        - the first live order confirmed in the conversation;
        - the first buy read back by a person BEFORE its exit;
        - never trading by hand in that account.
   2. **PR5 live: NO-GO until its four weeks end on 2026-10-21** (S3,
      reference §3.32): it is a build, not a switch, and at $50 it earns
      $0.021 a day. The paper engine is healthy (read about 00:55 UTC):
      - P1: `last_minute` 2026-09-24 00:53, no error.
      - P2: on 09-23 from 15:09, USDC-GBP 59 orders + 2 refused and USDT-GBP
        57 + 2, with no withdrawals, fills or exits; on 09-24 so far 12 + 1
        and 11 + 1.
      - P3: no round trips yet, as expected.
      - P4: 24 book snapshots, 15:10 → 00:48.

      **116 orders on 09-23 against the review's ~128 (−9 %)**: not a
      blocker, but reconcile it minute by minute at the four-week review.
      **Reconciled 2026-09-24 (G5, reference §4 item 31).**
   3. **The BTC-regime entry filter is REJECTED** (S1, §3.30): §3.9's last
      candidate is closed, with no paper twin.
   4. **DONE (2026-09-24 01:14 UTC):** `.claude/CLAUDE.md`'s Agents section now
      says what follows. It was behind, and an agent may not edit it on another
      agent's word, so the main session made the two edits:
      - "a BTC-regime filter on entries is the one written-down candidate,
        to be re-tested on a non-bear window before any paper twin" should
        say it was re-tested on non-bear windows and rejected (§3.30);
      - the go-live bullet should say the draft starts the row at $50 (four
        $12.50 slots) with a $15 cap, raised to $30 after the first round
        trip is read back and to $75 after a clean week (not $100 with a
        $30 cap and then $150), and that D8–D12 are done.

00000000. **DAVIES' REQUESTS OF 2026-09-23 ~20:40 UTC.** The go-live work
   (item 0000000) was paused on his word; he has since **un-paused its
   preparation**: D8–D10 are done (item 0000000.1), and D11, D12 and the
   $50 draft too (item 000000000.1). The go itself stays his explicit word.
   The DecisionFC review is still paused; do not resume it without him.
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

- **Cursor cloud containers (2026-09-24):** the git identity comes preset as
  "Cursor Agent" (set it as above), and `core.hooksPath` points at Cursor's
  own dispatcher in `~/.cursor/agent-hooks/<id>/`, which runs the hook in the
  folder named by its `.cursor-original-hooks-path` file and then Cursor's
  secret scanner. That file named `.git/hooks`, so the ledger hook was OFF.
  Point it at the repo's hooks rather than replacing the dispatcher:

        for f in ~/.cursor/agent-hooks/*/.cursor-original-hooks-path; do printf '%s\n' "$PWD/bin/hooks" > "$f"; done
        git config --local ledger.path docs/LEDGER.md

  `bin/gates.sh` then warns that the hook is off; it is not (the dispatcher
  runs it). There is no `/opt/pw-browsers`; the browser gates run on the
  system Chrome with
  `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/google-chrome-stable`.
  Its git token deletes remote branches (`git push origin :refs/heads/<b>`),
  which Claude Code's proxy refuses. There is no Supabase PAT or CLI on the
  machine, and the Supabase connector lists, reads and deploys Edge
  Functions but cannot delete one.
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

### [2026-09-25 04:35 UTC] Platform: Cursor | Model: Grok 4.7

**fp5, ten Premier League full-time rules frozen and not yet run** (branch `cursor/polymarket-fp5-b50c`; not on main). The 04:19 section ran PEER, DIURNAL, SHIFT, NEXT, BACK, MEAN3, DRIFT and AGREE; none cleared the bar, and none of them is reopened. This round's ten each buy one YES from final scores, one hour before kickoff, and hold to settlement. No Polymarket price of these rules and no return have been read. MED, VAR, NEAR, RICH, YDAY, CLIM, JUMP, HOT, POST, HITS, POISSON, PACE, VOL, COPY, ROUND and FADE stay failed. No testing or live row. `agents/pmrw.ts`, PR5 and trend-4h were not touched. Bookmaker columns, prints after kickoff, a halftime copy, exact-score ladders and goalscorer props were not run (`reviews/2026-09-25-polymarket-fp5-round10-kills.md`).
- ELO (`reviews/2026-09-25-polymarket-fp5-prereg-elo.md`): fixed rating, K 20, home advantage 60, draw anchor 0.25. Self-check `H 0.459513 14.638156`.
- FORM5 (`reviews/2026-09-25-polymarket-fp5-prereg-form5.md`): last five, points per game, gap 0.6. Self-check `H 1.0 14.638156`.
- TABLE (`reviews/2026-09-25-polymarket-fp5-prereg-table.md`): this season's points, lead of three, four games played. Self-check `H 1.0 14.638156`.
- REST (`reviews/2026-09-25-polymarket-fp5-prereg-rest.md`): two more days since the previous match. Self-check `H 1.0 14.638156`.
- VENUE (`reviews/2026-09-25-polymarket-fp5-prereg-venue.md`): this club's home win rate, eight homes. Self-check `H 1.0 -10.2995`.
- STREAK3 (`reviews/2026-09-25-polymarket-fp5-prereg-streak3.md`): three wins, the other side not. Self-check `H 1.0 14.638156`.
- DRAWBASE (`reviews/2026-09-25-polymarket-fp5-prereg-drawbase.md`): the league draw rate. Self-check `D 0.25 88.560401`.
- H2H (`reviews/2026-09-25-polymarket-fp5-prereg-h2h.md`): modal result of this pair, three meetings. Self-check `H 1.0 14.638156`.
- CONGEST (`reviews/2026-09-25-polymarket-fp5-prereg-congest.md`): two fewer matches in 14 days. Self-check `H 1.0 14.638156`.
- MARGIN (`reviews/2026-09-25-polymarket-fp5-prereg-margin.md`): one goal per game over the last eight. Self-check `H 1.0 14.638156`.

### [2026-09-25 04:19 UTC] Platform: Cursor | Model: Grok 4.7

**fp5, eight temperature rules were run on the full sample and none clears the bar.** The 04:07 section froze them before any price of the rule was scored. The 04:09 section made a missing bracket a no-trade; the pins did not change, and PEER's file matches a run of that code. This section is those runs. Branch `cursor/polymarket-fp5-b50c`, not main. No testing or live row. `agents/pmrw.ts`, PR5 and trend-4h were not touched. MED, VAR, NEAR, RICH, YDAY, CLIM, JUMP, HOT, POST, HITS, POISSON and PACE were not retuned. The search file is not written: nothing passed. Each run was repeated and the two files matched. The weather file sha256 is `890d805ef362fbc63eec19db4309d5bcbe7fc3b3ab85487634b9e124a841a948`. One Seoul fill was recomputed with the fee formula and matched the scorer (−$4.471505), and it is DRIFT's only January trade.
- PEER: **−$547.639707 on 489 trades**, 70 won and 419 lost. One half is positive. Both runs sha256 `f3f9f5106945358850491ee9ccd1fdf8f7566483aeeca29217ae35e7e2f25ed8`. `peer_test.py` blob `b07e05de8b0acde9d503963a8daec34f10914a5f`. Write-up: `reviews/2026-09-25-polymarket-fp5-peer.md`.
- DIURNAL: **+$138.529726 on 43 trades**, 7 won and 36 lost. Both halves, stress and +666% a year pass. August is 133%; without it −$45.13. The null's 95th is +$407.27. Both runs sha256 `e1ba7a42cb9cd454ad835520cc03d30a471397dea432521f719dec1b8ff904df`. `diurnal_test.py` blob `29c0be5c877540fa6c4797968803cd23b7681f33`. Write-up: `reviews/2026-09-25-polymarket-fp5-diurnal.md`. Not retried with August removed.
- SHIFT: **+$259.949931 on 1,064 trades**, 146 won and 918 lost. The first half is −$769.07. July is 228%. Both runs sha256 `c58ac43ecb41fa2c515f24e7eda793be4e59213fbe9d359e5ed6163c6dde709b`. `shift_test.py` blob `1194e8139416c30329ca10c47613e7c3305f2f14`. Write-up: `reviews/2026-09-25-polymarket-fp5-shift.md`.
- NEXT: **+$27.3845 on 292 trades**, 46 won and 246 lost. The second half is −$224.42. May is several times the profit. Both runs sha256 `213020ef16dc7ea11d1259a4e6e6416d738c0bd74e20f2b4e9a2612b5a9f7096`. `next_test.py` blob `dcd6b69e458b2b10c472782f50d13068e272083f`. Write-up: `reviews/2026-09-25-polymarket-fp5-next.md`.
- BACK: **+$314.609943 on 114 trades**, 12 won and 102 lost. The first half is −$182.18. July is 139%. Stress and the trade count pass. The null's 95th is +$496.39. Both runs sha256 `a8138acf24a3f2ae75b48bb7b55b3deac316e75f92e7fb81102fd8f40a421a76`. `back_test.py` blob `cd69d1e8087cbb22d8ee28857b52b7b5e0a004f0`. Write-up: `reviews/2026-09-25-polymarket-fp5-back.md`.
- MEAN3: **+$299.8544 on 670 trades**, 123 won and 547 lost. The first half is −$169.17. April is 130%. Stress and the trade count pass. Both runs sha256 `37b79a2301cfd0cf93738050a861620a6db59cb234af6ee08d20d706835ea1dc`. `mean3_test.py` blob `655d2108194c02f7e58572b52922c9caa7181cb4`. Write-up: `reviews/2026-09-25-polymarket-fp5-mean3.md`.
- DRIFT: **+$660.418866 on 251 trades**, 29 won and 222 lost. Both halves, stress, the trade count and +1,739% a year on a $55 peak pass. The null's 95th is +$773.30. April is 77%; without it +$154.94. Both runs sha256 `419b54c250b2fc16687bba464085c710e7a85ed2a57e98a850d5921f7b74f7dc`. `drift_test.py` blob `7ad60faf2b7f9502af92930a9815679fb9e6f284`. Write-up: `reviews/2026-09-25-polymarket-fp5-drift.md`. Not retried with April removed.
- AGREE: **−$513.325434 on 193 trades**, 34 won and 159 lost. One half is positive. Both runs sha256 `a6e3c915b4c4623e0de25cb82a8fb6e0a76c1ced1be6a764195e63cdbbe915c6`. `agree_test.py` blob `c64f5ef5ec7dc9fbe03fe91985020cd3ae01d9d7`. Write-up: `reviews/2026-09-25-polymarket-fp5-agree.md`.

### [2026-09-25 04:09 UTC] Platform: Cursor | Model: Grok 4.7

**fp5, a missing temperature bracket is no trade.** The 04:07 freeze named the eight rules. `city_more.hit` asked a bracket that is not on the board for its interval and raised. The pre-registration already says that case is no trade. The guard is in `city_more.py`, and `diurnal_test.py --self-check` now refuses a target that sits outside every bucket. The pins are unchanged. No return has been written up. `agents/pmrw.ts` was not touched.

### [2026-09-25 04:07 UTC] Platform: Cursor | Model: Grok 4.7

**fp5, eight temperature rules frozen and not yet run** (branch `cursor/polymarket-fp5-b50c`; not on main). The 03:51 section ran MED, VAR, NEAR, RICH, YDAY, CLIM, JUMP and HOT; none cleared the bar, and none of them is reopened. This round's eight each have a fill walk. No price of these rules and no return have been read. VOL, COPY, ROUND, FADE, POST, HITS, POISSON and PACE stay failed. No testing or live row. `agents/pmrw.ts`, PR5 and trend-4h were not touched. A same-bucket gap between cities, a weekday split of CLIM, and the reverse of JUMP were not run (`reviews/2026-09-25-polymarket-fp5-round9-kills.md`).
- PEER (`reviews/2026-09-25-polymarket-fp5-prereg-peer.md`): the bucket that contains other cities' latest midpoints. Self-check 37.224048.
- DIURNAL (`reviews/2026-09-25-polymarket-fp5-prereg-diurnal.md`): yesterday's low plus the month's median daily range, highs only. Self-check 21.913065.
- SHIFT (`reviews/2026-09-25-polymarket-fp5-prereg-shift.md`): the bracket the histogram of past changes points at, yesterday's bracket excluded. Self-check 60.998571.
- NEXT (`reviews/2026-09-25-polymarket-fp5-prereg-next.md`): the other bucket yesterday's bucket most often moved to. Self-check 33.093261.
- BACK (`reviews/2026-09-25-polymarket-fp5-prereg-back.md`): one listed bucket from yesterday toward the month median, never the median bucket. Self-check 80.464091.
- MEAN3 (`reviews/2026-09-25-polymarket-fp5-prereg-mean3.md`): the bucket that contains the mean of the last three midpoints. Self-check 17.457778.
- DRIFT (`reviews/2026-09-25-polymarket-fp5-prereg-drift.md`): one listed bucket on the side past steps mostly took. Self-check 25.354286.
- AGREE (`reviews/2026-09-25-polymarket-fp5-prereg-agree.md`): the three-day mean and the other cities' median, only when they name one bucket. Self-check 42.226579.

### [2026-09-25 03:51 UTC] Platform: Cursor | Model: Grok 4.7

**fp5, eight rules were run on the full sample and none clears the bar.** The 03:42 section froze them before any price of the rule was scored. This section is those runs. Branch `cursor/polymarket-fp5-b50c`, not main. No testing or live row. `agents/pmrw.ts`, PR5 and trend-4h were not touched. VOL, COPY, ROUND, FADE, POST, HITS, POISSON and PACE were not retuned. The search file is not written: nothing passed. Each run was repeated and the two files matched.
- MED: **−$18.41788 on 2 trades**, both lost. Input sha256 `c4c9b65998072cfe2c9626301d9cc4e3cca22481daa67a25050381670cd59348`. Both runs sha256 `3cdf218ee9be5073b5e8694c4fafd34b4132478153a8b4b189c0cefb8f4ed174`. `med_test.py` blob `39bc83382ca9807db8d98e70dfb6f21e60d2ab29`. Write-up: `reviews/2026-09-25-polymarket-fp5-med.md`.
- VAR: **−$71.465357 on 11 trades**, 0 won. The second half has no trade. The null's 95th percentile equals the loss. Input sha256 `cdccb393000e7fb11e3f1e1975be88f3a23c581153cbfc86d4cfc909506dd840`. Both runs sha256 `fd5c4f64c7e8b3736413f975d8e5de5f4106f2933b37f023964644f73df95b44`. `var_test.py` blob `4bc847d4ade113adcfc2598237b8c8e8ad326cea`. Write-up: `reviews/2026-09-25-polymarket-fp5-var.md`.
- NEAR: the full sample filled once, in sample, −$10. Out of sample **$0 on 0 trades**. Input sha256 `14c547491b8dba90333dcf705a55450a6159490600832f86b154922a2307365f`. Both runs sha256 `7ce537e2f5024517d89633495a571066ee8ca1621ed62daa5e5d8576e851ec96`. `near_test.py` blob `0408522816806e5840c5da8a9456e2d56eeb3a07`. Write-up: `reviews/2026-09-25-polymarket-fp5-near.md`.
- RICH: **+$13.973837 on 52 trades**, 45 won and 7 lost. Both halves, stress and +40.32 % a year on a $50 peak pass. The null's 95th is +$48.65. May is 93 %. Input sha256 `6601381ce28e22143ec45ff920203ea6aa5e2cd7381216fadd770a37e2c1e131`. Both runs sha256 `01a54dfe1b278a6bb11f4f5ad9f27f2e889ae82c493ea61d3e1e9c99d47071cd`. `rich_test.py` blob `09788904a7bc2d701c9516819552a7496423060c`. Write-up: `reviews/2026-09-25-polymarket-fp5-rich.md`. Not retried with May removed.
- YDAY: **−$1,536.215242 on 584 trades**. Both halves lose. Weather file sha256 `890d805ef362fbc63eec19db4309d5bcbe7fc3b3ab85487634b9e124a841a948`. Both runs sha256 `237a6ab9924c0a989919dc927eab8262e849357c8d8a23fa470c7fac30213880`. `yday_test.py` blob `056cdd01b14aff1a75e922dfbd40d1c00d56e164`. Write-up: `reviews/2026-09-25-polymarket-fp5-yday.md`.
- CLIM: **−$283.661551 on 944 trades**. One half is positive. Both runs sha256 `6a7101f40ded74bf0b5a1c298c2edfad56a4d5f6e93df2519ccad672e2ded4a0`. `clim_test.py` blob `d73c241b6b79b1fd669a6e9b4628fed3c9d362eb`. Write-up: `reviews/2026-09-25-polymarket-fp5-clim.md`.
- JUMP: **+$692.119086 on 421 trades**. The first half is −$15.30. May is 105 %; without it −$36.30. Stress and the trade count pass. Both runs sha256 `dd587fa891539a8df194d57cfb0224f7d0bec82f5f30c8e7117532fa61e2fefa`. `jump_test.py` blob `e77ca696e30c5b27a8da0150d1891b7130322007`. Write-up: `reviews/2026-09-25-polymarket-fp5-jump.md`. Not retried with May removed.
- HOT: **−$735.322014 on 493 trades**. Both halves lose. Both runs sha256 `efaeae3c364966305d67d0a572573c82c7a2aba454d22234be3e2475b35f1b40`. `hot_test.py` blob `0f0ce3aca66786db63d0f01d6fbb00343b3f3746`. Write-up: `reviews/2026-09-25-polymarket-fp5-hot.md`.

### [2026-09-25 03:42 UTC] Platform: Cursor | Model: Grok 4.7

**fp5, eight rules frozen and not yet run** (branch `cursor/polymarket-fp5-b50c`; not on main). The 03:25 section recorded ten names, six of which were arithmetic kills and do not count. This round's eight are each a frozen rule with a fill walk. No price of these rules and no return have been read. VOL, COPY, ROUND, FADE, POST, HITS, POISSON and PACE stay failed. No testing or live row. `agents/pmrw.ts`, PR5 and trend-4h were not touched.
- MED (`reviews/2026-09-25-polymarket-fp5-prereg-med.md`): the bracket that contains the median of past winning midpoints. Self-check 39.351744.
- VAR (`reviews/2026-09-25-polymarket-fp5-prereg-var.md`): the bracket named by the book's variance against the historical variance. Self-check 9.607843.
- NEAR (`reviews/2026-09-25-polymarket-fp5-prereg-near.md`): the bracket beside the dearest one, toward the median. Self-check 39.751244.
- RICH (`reviews/2026-09-25-polymarket-fp5-prereg-rich.md`): NO on the dearest bracket, and only while the YES price is inside 0.10 to 0.90. Self-check 14.638156.
- YDAY, CLIM, JUMP, HOT (`reviews/2026-09-25-polymarket-fp5-prereg-yday.md` and the three beside it): temperature buckets from the last resolved day, the month's median, one extrapolated step, and the bucket above that median. No forecast. Self-checks 14.095244, 37.224048, 14.095244, 156.196667.

### [2026-09-25 03:25 UTC] Platform: Cursor | Model: Grok 4.7

**fp5, this round of ten is recorded and none clears the bar.** The 03:08 section froze HITS, POISSON and PACE and killed five rules on arithmetic. The 02:59 section froze POST and killed the Betfair gap. This section is those four runs. Branch `cursor/polymarket-fp5-b50c`, not main. No testing or live row. `agents/pmrw.ts`, PR5 and trend-4h were not touched. VOL, COPY, ROUND and FADE were not retuned. The search file is not written: nothing passed.
- POST: **$0 on 0 trades**. 138 of 212 windows opened more than 3¢ apart. Seven candidates filled under $2. Input sha256 `c451f2d00a37192b58e6af4c65e2cdd7d0e6d7d288ab0cf6fca1492bf17270b3`. Both runs sha256 `a0b5fa37a3a0624071b354ea26c43837801bf8e58672117b881663e2851e7969`. `post_test.py` is still blob `fbf5ce993199ef08746bb99c2ba88b3c46a5146b`. Write-up: `reviews/2026-09-25-polymarket-fp5-post.md`. Not retried with a wider band.
- HITS: **−$68.657229 on 9 trades**, 0 won. Both halves lose. Stress −$89.64. Null 95th +$109.91. In sample −$81.20 on 15. Input sha256 `676b4b35b3757ca9e1adb31428a246d717252c1501579d122ad9ae378ad4d383`. Both runs sha256 `4583c9815360cc7e5969a68c665b7d1b98ef0d0ed001cd030af341b61a926228`. `hits_test.py` is still blob `9943968cb68ef36d30610b738548c9fd5c514afa`. Write-up: `reviews/2026-09-25-polymarket-fp5-hits.md`. Not retried by requiring the mode.
- POISSON: **+$115.240837 on 26 trades**, 2 won and 24 lost. OOS2 −$43.96 on 5. Stress +$109.86. Null 95th +$225.27. January is 185 %; without it −$97.83. Stress and +4.61 % a year on a $36 peak pass. Input sha256 `53498b7bca13db2172d77374596fedf28feefbf9fb65c66e7e5b2c326afbbb85`. Both runs sha256 `e6b50b006f7639204ced9aaeefc72db8b8ac0c91e6b051c635fd51f804d2d1c0`. `poisson_test.py` is still blob `9f61a764af2d26b433a91e8e1f2d81c2ebd643da`. Write-up: `reviews/2026-09-25-polymarket-fp5-poisson.md`. Not retried with January removed.
- PACE: **−$69.011 on 7 trades**, 0 won. The second half has no trade. Stress −$82.21. The null's 95th percentile equals the loss. In sample −$20 on 2. Input sha256 `d40019926b9aa0c12ed84273ed17d4390e2e3cebea74b35b4a0699cf5160d3f6`. Both runs sha256 `d2f8799f28215ac012f7ad51f2299199e1d9c3265cfeb0b2d2207a58df6d19cb`. `pace_test.py` is still blob `f57e3659dac22368843e7e5bcae8e1d39f42a18d`. Write-up: `reviews/2026-09-25-polymarket-fp5-pace.md`. Not retried at another hour.
- Already killed on arithmetic, not run: Betfair (no keyless simultaneous book), overlapping weeks, buying the dearest price, a geopolitics quote with no queue, a second grid whose out-of-sample count is zero, and NO on a rare bracket (that is FAV). Note: `reviews/2026-09-25-polymarket-fp5-round8-kills.md`.

### [2026-09-25 03:08 UTC] Platform: Cursor | Model: Grok 4.7

**fp5, more rules frozen in the same round, none of them run** (branch `cursor/polymarket-fp5-b50c`; not on main). Davies said a round does not stop after one rule, and this round needs at least eight. POST's fetch has finished; the file has not been opened and no return has been computed. FADE, ROUND, COPY and VOL stay failed.
- Killed on arithmetic, not run (`reviews/2026-09-25-polymarket-fp5-round8-kills.md`): an overlapping week cannot force a bracket to zero (58 posts in two days is wider than a bracket); buying the dearest bracket because it is the dearest never clears the fee; a geopolitics quote has no queue in the public tape; a second grid of the same week exists five times, all in 2025, so the out-of-sample count is zero; buying NO on a rare bracket is FAV and stays failed. Betfair stays the kill in the 02:59 POST pre-registration.
- Frozen, not yet run: HITS (`reviews/2026-09-25-polymarket-fp5-prereg-hits.md`, hand fill +88.560401), POISSON (`reviews/2026-09-25-polymarket-fp5-prereg-poisson.md`, hand fill +39.351744), PACE (`reviews/2026-09-25-polymarket-fp5-prereg-pace.md`, hand fill +39.351744). No testing or live row. `agents/pmrw.ts`, PR5 and trend-4h were not touched.

### [2026-09-25 02:59 UTC] Platform: Cursor | Model: Grok 4.7

**fp5 POST pre-registration frozen, not yet run** (branch `cursor/polymarket-fp5-b50c`; not on main). FADE failed in the 02:52 section and is not being retuned. ROUND, COPY and VOL stay failed. Davies asked for two ideas. A Polymarket–Betfair gap is not run: Betfair's historical files are a purchased package behind a session token, the free football CSV is one closing price and not the same contract, and one leg alone is the information bet fp4's S5 already refused. The rule that is frozen buys, on Elon tweet ladders (series 10000) and Trump Truth Social ladders (series 11108), the bracket past windows of the same length landed in most often, and only when the live brackets at the open are within 3¢. It sells a day before the end when the shown price has risen, and otherwise holds. The rule is `reviews/2026-09-25-polymarket-fp5-prereg-post.md`. `post_test.py --self-check` passes (round trip +5.348107, hold to a win +72.205128). No opening price and no return have been read. No testing or live row. `agents/pmrw.ts`, PR5 and trend-4h were not touched.

### [2026-09-25 02:52 UTC] Platform: Cursor | Model: Grok 4.7

**fp5 FADE was run and it fails. Not a testing candidate.** The 02:48 section froze the rule and said the run was next. This section is that run. Branch `cursor/polymarket-fp5-b50c`, not main. No testing or live row. `agents/pmrw.ts`, PR5 and trend-4h were not touched. ROUND, COPY and VOL were not retuned.
- Out of sample: **+$54.579594 on 62 trades**. OOS1 +$83.21 on 39, OOS2 −$28.63 on 23. Stress +$27.73. Null 95th +$109.34. In sample +$44.47 on 37. March is +$48.03, 88 % of the total; without it the remainder is +$6.55, so the month fails on the 40 % cap. YES +$4.81 on 41 and NO +$49.77 on 21 were read after the run and not promoted. Stress and +7.87 % a year on a $10 peak pass. The halves, the null, the trade count and the month do not.
- The pull: 369 ladders, 108 inside the band, no missing earlier price, no incomplete tape. Input sha256 `d71aa476a8f66c4914b904430b330e127b0e5c27539123b7a855eb766c63fda0`. Both runs sha256 `382cf28ae7e537150179008c4f49ce85ae0d1daff4e9db7fe2d56b87e3f4a264`. `fade_test.py` is still the freeze's blob. Write-up: `reviews/2026-09-25-polymarket-fp5-fade.md`. The six-hour fade is not retried the other way, at another lag, with a wider band, or with March removed.

### [2026-09-25 02:48 UTC] Platform: Cursor | Model: Grok 4.7

**fp5 FADE pre-registration frozen, not yet run** (branch `cursor/polymarket-fp5-b50c`; not on main). ROUND failed in the 02:42 section and is not being retuned: one side is not taken, September stays in the sum, and the strike spacing stays at $10,000. COPY and VOL stay failed. The next rule buys the side a six-hour move made cheaper, on the daily Bitcoin strike whose shown price is closest to one half inside 0.40 to 0.60, and holds to settlement. No spot, no neighbor line and no wallet. The band chooses the strike; it is not a claim that 0.40–0.60 is underpriced. The rule is `reviews/2026-09-25-polymarket-fp5-prereg-fade.md`. `fade_test.py --self-check` passes (hand fill +13.977244). Hourly up/down fade is not opened: the history there lags the prints by about 12¢. No decision-time price and no return have been read. No testing or live row. `agents/pmrw.ts`, PR5 and trend-4h were not touched.

### [2026-09-25 02:42 UTC] Platform: Cursor | Model: Grok 4.7

**fp5 ROUND was run and it fails. Not a testing candidate.** The 02:38 section froze the rule and said the run was next. This section is that run. Branch `cursor/polymarket-fp5-b50c`, not main. No testing or live row. `agents/pmrw.ts`, PR5 and trend-4h were not touched. COPY and VOL were not retuned.
- Out of sample: **−$691.320703 on 245 trades**. OOS1 −$838.28 on 158, OOS2 +$146.96 on 87. Stress −$1,132.27. Null 95th +$2,716.63. In sample −$377.46 on 92. YES −$99.94 on 122, NO −$591.38 on 123, read after the run and not promoted. September is +$487.82 inside a loss; dropping it was not done, and it would make the loss larger. Only the trade count passes.
- The pull: 369 ladders, 793 round strikes, no incomplete tape. Input sha256 `40a147eba1f9949e1e7534977473d59942b497d2c9e175cf85fcefd30620a3d1`. Both runs sha256 `18c83ca54e984cf5412feb7554519077a0d1f5640960a17f2c1c5be072d02b2d`. `round_test.py` is still the freeze's blob. Write-up: `reviews/2026-09-25-polymarket-fp5-round.md`. The line through the two neighbors is not retried at a finer modulus or on one side only.

### [2026-09-25 02:38 UTC] Platform: Cursor | Model: Grok 4.7

**fp5 ROUND pre-registration frozen, not yet run** (branch `cursor/polymarket-fp5-b50c`; not on main). COPY failed in the 02:31 section and is not being retuned: the page cap stays, and August stays in the sum. VOL stays failed. The next rule buys a $10,000 Bitcoin strike when it sits off the straight line through the strike below it and the strike above it by more than the taker fee and one tick, and holds to settlement. No spot and no volatility. The rule is `reviews/2026-09-25-polymarket-fp5-prereg-round-strike.md`. `round_test.py --self-check` passes (hand fill +11.36113). No decision-time price and no return have been read. No testing or live row. `agents/pmrw.ts`, PR5 and trend-4h were not touched.

### [2026-09-25 02:31 UTC] Platform: Cursor | Model: Grok 4.7

**fp5 COPY was run and it fails. Not a testing candidate.** The 00:48 section froze the rule. The 01:12 section only changed the fetch pace, before any ranking. This section is the run. Branch `cursor/polymarket-fp5-b50c`, not main. No testing or live row. `agents/pmrw.ts`, PR5 and trend-4h were not touched.
- Out of sample: **+$393.285293 on 206 trades**. OOS1 +$56.93 on 178, OOS2 +$336.36 on 28. Stress +$321.49. Null 95th +$395.66, so it misses by $2.37. August is +$331.08, 84 % of the total, and that month is one wallet's 22 trades. Both halves, the stress book, the trade count and +17.25 % a year on an $81.59 peak pass. The null and the month do not.
- The pull matched the freeze: 9,412 wallets with at least five May prints, no incomplete May market, 472 closed-position histories unread past the cap and not ranked, five leaders, 713 buys, 155 tapes, none incomplete. Input sha256 `215b2b4ea68d7d7ab128eecd0a4aed385dccb515b68724f0282624452fa7e15e`. Both runs sha256 `35fcffdb5dc18403a0ba7842d249e0f8e9bdab99df7e1a1c6b0fecbf99568f69`. `copy_test.py` is still the freeze's blob. Write-up: `reviews/2026-09-25-polymarket-fp5-copy.md`. The copy family stops. Not retried with a higher page cap, a different top N, or August removed.

### [2026-09-25 01:12 UTC] Platform: Cursor | Model: Grok 4.7

**fp5 COPY pull, pace only.** The 01:02 section's eight-wide fetch was keeping the rows and running at about one wallet a second, because each history is several pages and the host gap was 0.12s. The gap for `data-api.polymarket.com` in this pull is now 0.02s, sixteen at a time. Still before any ranking. A 429 still backs off. Not on main.

### [2026-09-25 01:02 UTC] Platform: Cursor | Model: Grok 4.7

**fp5 COPY pull, deviation before any ranking.** The 00:48 freeze stands. May tapes are on disk (9,412 wallets with at least five prints, no incomplete market). Closed positions one wallet at a time were about three seconds each, which would not finish. `copy_inputs.py` now fetches eight wallets at once, still 0.12s per host, and still keeps the same rows. No wallet has been ranked. No copied return has been computed. Not on main. No testing row.

### [2026-09-25 00:48 UTC] Platform: Cursor | Model: Grok 4.7

**fp5 COPY pre-registration frozen, not yet run** (branch `cursor/polymarket-fp5-b50c`; not on main). VOL failed in the 00:44 section and is not being retuned. The next rule copies five wallets chosen only from May Bitcoin-ladder prints and closed positions dated before 2026-06-01, into taker buys from 2026-06-01 to 2026-09-11, filled by the next other buy within five minutes at a price no better than the leader's. The 25 crypto month-leaderboard addresses and one peeked May page are excluded by name. The rule is `reviews/2026-09-25-polymarket-fp5-prereg-copy-wallets.md`. `copy_test.py --self-check` passes (hand fill +6.701762). No wallet has been ranked and no copied return has been computed. No testing or live row.

### [2026-09-25 00:44 UTC] Platform: Cursor | Model: Grok 4.7

**fp5 VOL was run and it fails. Not a testing candidate.** The 00:26 section froze the rule and said the run was next. This section is that run. Branch `cursor/polymarket-fp5-b50c`, not main. No testing or live row. `agents/pmrw.ts`, PR5 and trend-4h were not touched.
- Primary, hourly DVOL, out of sample: **−$239.675216 on 146 trades**, OOS1 −$277.08 on 88, OOS2 +$37.41 on 58. Stress −$320.42. Null 95th +$418.13. Only the ≥80-trade condition passes. The shown-history counterfactual is still −$200.37, so it is not fp4's history lag. Secondary realised vol also fails (−$20.79 on 167). The digital-versus-vol family is discarded, including an ETH twin and a threshold change.
- Deviation, before any P&L: the frozen puller skipped a Deribit chunk on one boundary candle and dropped every other 40 days (190 of 367 events had no DVOL). It now requires 90 % of the hours the pre-registration named. The candle definition did not change. Input sha256 `ed5bf0928e10f8c3bc1039a7ff04904d7b5838e16baffd9496c56dcc2fe4bc17`. Both runs sha256 `5d599374b8d5cc9cb6dff94a5d91ca16bce75267cfcf500de26d7c9f24fa04d0`. Write-up: `reviews/2026-09-25-polymarket-fp5-vol.md`.

### [2026-09-25 00:26 UTC] Platform: Cursor | Model: Grok 4.7

**fp5, Polymarket only, pre-registration frozen and not yet run** (branch `cursor/polymarket-fp5-b50c`; not on main).
Davies asked for new Polymarket strategies by the same method. RW, PR5 and trend-4h were not touched, and no
testing or live row was added. Ideas that die before a test: copying the leaderboard (the ranking has no as-of
date, so a backtest would select on the outcome; a month-leader sample's next buy was 0.66¢ worse, 16 of 63);
buying a disputed proposal (the resolution record has no proposal time, so an entry would look ahead);
Kraken against Binance (about 4 bps, under a cent on a 16-hour digital). VOL is the one that clears the
arithmetic: a Deribit hourly DVOL digital against the daily Bitcoin ladder, fee and one tick, days before
2026-09-11. The rule is `reviews/2026-09-25-polymarket-fp5-prereg-vol-digital.md`. The self-check passes.
The historical run is the next commit.

### [2026-09-24 23:41 UTC] Platform: Cursor | Model: Grok 4.7

**Davies: the two paper tests count in TESTING's totals.** "算进" on the open question (TESTING's scoreboard and the Revolut X card).
- TESTING's scoreboard adds Stablecoin quotes and Reward quotes to its strategies. The funded cell says how many of each. Unrealised's percent is of the strategies' cost plus what the tests have deployed, and the label says `cost and deployed`.
- The Revolut X card adds Stablecoin quotes, the test that trades there. Reward quotes stays the Polymarket card: that money is not Revolut X's, and the three cards still add up to the scoreboard. LIVE does not take either test.
- Pin: `agents.test.js`, "says what each total covers". Leaving a test out fails it. The sweep is 300 checks, green, on the bundle this commit ships (`app-9c918eb5.js`). No strategy row, rule or live state was written.

### [2026-09-24 23:34 UTC] Platform: Cursor | Model: Grok 4.7

**G4a closed: the redesign is on main, production serves that bundle, the LIVE tab matches the database, and `agents-live-testing` is gone.**
- **On main.** `7a015b6` (fast-forward `95a879d..7a015b6`). `1883785` and `2ad42ee` after it delete `pm-geo-probe` and then take that one-off step back out; they do not change `dist/`. `origin/main` at this writing is `2ad42ee`.
- **Production bundle, 23:34 UTC.** `https://daviesportfolios.pages.dev` names `assets/app-cc8519ef.js`, the file committed in `dist/index.html`. `assets/agents-485e1fcc.js` sha256 `8e04fbd2b377764745e4ce01268dbd0c69bcaa1ff5e02d18249fa414506fd56e` equals `dist/assets/agents-485e1fcc.js`, and `assets/agents-2abbffcb.js` sha256 `a8010b26ebe2d89165bb7975d87f8df41fad5907adc8fd635f75c09fc4238d3c` equals its committed file. The page chunk contains `ag-modebar`, `ag-rw-tiles`, `FUNDED` and `Live trading is on`. `daviesluo.com` from this machine is a Cloudflare challenge (`cf-mitigated: challenge`, HTTP 403), so that hostname was not content-checked.
- **LIVE tab against the database, same minute.** `trend-4h-live` is mode `live`, venue `revx`, capital 50, name `Trend 4h · Revolut X · live`, symbols BTC/ETH/SOL/AVAX, not retired. `agent_orders` for that id has no rows. `agent_risk`: `global_pause` false, `max_exposure_usd` 15, `live_confirmed_at` `2026-09-24 22:53:09.568392+00`. The dashboard the page reads (`agents?action=dashboard`, pg_net request 32983, HTTP 200) returns that row with capital 50, cost, value, unrealised, realised, fees and today all 0, `holdsLive` false, `openOrders` 0, `windingDown` false, and the same confirmation time and pause. The page's own functions then open on LIVE, title the row `Trend 4h · Revolut X` (the trailing ` · live` is display-only), and show FUNDED $50.00, DEPLOYED $0.00 (0.00%), today / unrealised / realised $0.00, and `Live trading is on Since 24 Sep 23:53 BST` (`fmtChartStamp` of that timestamp, London, BST). Each of the four positions is flat (base 0, no fills).
- **Branch.** `git ls-remote --heads origin` returns only `refs/heads/main`. `git push origin --delete agents-live-testing` answered `remote ref does not exist`. Restore of the pre-rebase head stays `eb58acbba9add14a5004492f1717745a25ba1e8a`, recorded in the 23:29 section.
- **Left open, and not changed:** whether TESTING's scoreboard and the Revolut X card fold the two paper tests into their totals. No strategy row, rule or live state was written.

### [2026-09-24 23:34 UTC] Platform: Cursor | Model: Grok 4.7

**`.claude/CLAUDE.md`'s two go-live passages now say what landed.** Re-read at 23:33:23 UTC: the live row is
"Trend 4h · Revolut X · live", mode live, venue revx, capital 50, created 22:51:15.132539; `agent_risk.live_confirmed_at`
22:53:09.568392, `global_pause` false, `max_exposure_usd` 15; live orders 0. The rule that an agent may not edit this
file on another agent's word is only in this ledger (item 000000000 §4, 2026-09-24 01:14 UTC). The coordinator
verified that landed state themselves at 23:07:49, so the edit is not on another agent's word. The two passages: the
live set is that one row, armed that evening, and the paper `trend-4h` row stays the control (SUI stays paper); the
migration was applied as `0054`, created unarmed, then armed at 22:53:09.568, cap still $15 until the first round
trip is read back. Adversarial read of `b23ec78` (the previous model's `0055`): the table stores inputs only, the
checks match `0051`'s (null or positive X and fair, non-negative counts, the two GBP books), RLS is on with no
policy the same way as the other quote tables, and it does not touch `quotes.ts` — the writer stays for after the
00:00 close.

### [2026-09-24 23:29 UTC] Platform: Cursor | Model: Grok 4.7

**G6: `pm-geo-probe` is deleted, and the one-off step is out.** Run
[36072610413](https://github.com/daviesluo/daviesportfolios/actions/runs/36072610413) on `1883785` finished green; its
delete step logged `Deleted Function pm-geo-probe`. The live list at 23:26 UTC is the eleven repository functions
(`prices`, `auth`, `data`, `ops-error`, `fundamentals`, `chart`, `trading212`, `overnight-fetch`, `overnight-record`,
`snapshot-record`, `agents`) and nothing else. This commit removes the step, so a later push deploys only what
changed, as before. No credential was created. The step sat before "Detect changed functions" with no guard, so leaving
it would fail every later deploy once the function was already gone.
- **`agents-live-testing`, recorded before deletion.** Head `eb58acbba9add14a5004492f1717745a25ba1e8a` (2026-09-24
  22:58:11 UTC, "Name what every Agents figure covers and is of, and take Davies' second pass"). No open pull request.
  Its tree is not `7a015b6`'s: merge-base with `main` is `1bf254d`, so restore is this SHA
  (`git push origin eb58acbba9add14a5004492f1717745a25ba1e8a:refs/heads/agents-live-testing`), not that commit. Deleted
  once this commit is on `main`.

### [2026-09-24 23:22 UTC] Platform: Cursor | Model: Grok 4.7

**G6: Davies said to delete `pm-geo-probe`, so CI does it with the PAT it already has.** The connector still cannot
delete a function and this machine still has no Supabase token, so no credential was created. `edge-functions.yml`
gains one step, after the CLI install and only on a push to `main`: `supabase functions delete pm-geo-probe --yes`
with `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF`. It fails the job if either secret is missing, rather than
skipping. The step comes out in the next commit once the live function list shows it gone. The other eleven functions
are not named by the step.

### [2026-09-24 23:14 UTC] Platform: Cursor | Model: Opus 5.5

**PR5's per-minute input record: the table goes first, the engine after the 00:00 close** (G5; Davies: "这个你觉得需要
的话就加上", relayed by the coordinator). `0055_quote_minutes.sql` adds `agent_quote_minutes`: per book and decided
minute, X and the Yahoo bar it came from, the USD book's median and how many hourly closes it took, and the prints the
minute was decided on. The migration is pushed alone, so the table exists before any code writes to it; the engine
change that writes it follows in its own commit, deployed at 00:03 UTC or later, after the 00:00 close is decided,
because `trend-4h-live` runs in the same `agents` function.

### [2026-09-24 22:57 UTC] Platform: Cursor | Model: Opus 5.5

**trend-4h is live and armed; the watch is written; PR5 cannot be judged on its first round trips yet** (G4, G5).
- **Applied:** `migrations.yml` run 36069681883 on `0bf01ae` — "Applying migration 0054_go_live.sql… Finished supabase
  db push." (22:51:14–15 UTC). In the database: `0054` recorded; `trend-4h-live` created 22:51:15 (live, `revx`,
  signal `kraken`, BTC/ETH/SOL/AVAX, capital 50, params equal to the draft's and to `trend-4h`'s); `agent_risk` now
  `max_exposure_usd` 15, loss 5, orders 40, `live_confirmed_at` null, `global_pause` false. The 22:52 tick wrote the new
  row's four observations and decided the last closed bar for it (16:00, at 22:52:04): four holds, "no close above prior
  55-bar high", the same as the paper row's on that bar.
- **Armed:** `update public.agent_risk set live_confirmed_at = now(), updated_at = now() where id = 1;` →
  `live_confirmed_at` 2026-09-24 22:53:09.568 UTC. After it: the 22:54 and 22:55 ticks succeeded, three responses all
  200 and none with an error in its report, no `ops_errors` since the migration, the tick report counts seven rows and
  lists the live row's four coins ("bar 16:00 already decided"), no live order. The first bar it can enter on closes at
  00:00 UTC.
- **Watch:** the Cursor project store's `internal/trend-4h-watch.md` — the read-only queries (W0–W7), when to run them,
  what to report, the read-back and the cap steps; the what-remains item G4 carries the short version. Nothing in the
  system alerts on a live order by itself.
- **PR5, Davies at 22:52: "Stablecoin quotes策略现在有round trips了，也研究下看看能不能达到上线标准？"** Three round
  trips, all from one £27.5k sweep at 18:57 through the three USDT-GBP bids, +$0.570; the standard is four weeks, so two
  of its conditions cannot be read and the rest are on track (reference §4 item 31, "The first round trips"). At £50 the
  event would have made $0.024.
- **For the coordinator:** `.claude/CLAUDE.md`'s Agents section still describes the go-live as a draft (the bullets
  "The set that is recommended for live is ONE row" and "A row's `mode` LABEL is not the BOOK it trades", which say it
  "is drafted at `docs/agents/go_live.sql.draft`"). They should say it was applied as `0054` at 22:51:15 UTC and armed
  at 22:53:09 UTC; left for the main session under the rule that an agent does not edit that file on another agent's
  word.

### [2026-09-24 22:54 UTC] Platform: Cursor | Model: Opus 5.5

**The redesign's second round, on `agents-live-testing` (still NOT on `main`): the coordinator's three TESTING fixes,
RW's rounding, and Davies' UI list.**
- **Every percent names its base** (coordinator: a figure shown in two places is the same figure, or its label says
  why): the same +$0.42 read +0.12 / +0.23 / +0.42 % on the scoreboard, the Revolut X card and the Trend 4h row, each
  on its own capital. Each label now carries its base on a line under it ("% of funded", "% of $20.00 cost",
  "% of deployed"; the table's headings "% of cap" / "% of cost"). RW's unrealised is on what it holds at the mid
  (`heldUsd`), not on cost, so its own cell says so.
- **Every total says what it covers; no sum changed.** The two paper tests stay out of the sums by decision, not by
  accident (item 00000000.2: "Open for Davies … folding the quotes in would put $1,200 more on Revolut X's funded
  figure"; `.claude/CLAUDE.md`: "the rows' totals do not include it"). TESTING reads "6 strategies, 2 tests", FUNDED
  "6 strategies", each test's row "not in the scoreboard", the Revolut X card "Not in these totals: Stablecoin quotes".
- **The phone's ragged label**: `.sb-label` is a flex ROW, so "(incl. fees …)" beside the name broke into two columns.
  A label is now a column (the name, then each aside on its own line), and the scoreboard a subgrid of three rows
  (label, figure, what is under it), so every figure stands on one line.
- **RW's parts add up to its total as printed** (the ops read: +$34.23 beside realised 55.75 + unrealised −21.53 =
  34.22; they show together on RW's page). `splitCents` rounds each part exactly as `fmtMoney` prints it (neither
  `x * 100` nor `toFixed` does: 283.965, 257.945, −0.125 all differ) and hands a missing cent to the part rounding cut
  most; `rwSplit` makes ONE split of the total into rewards, closed orders and open orders, which the row, the
  scoreboard, the bar and the Polymarket card all print. A real mismatch (half a cent or more) is left visible.
  Pins: the ops shape, ties, three parts, 2,000 random splits through the page's own formatter; the sweep's
  `AGENTS_RW_CENTS` (+$55.76 − $21.53 = +$34.23 = +$48.72 − $14.49; a market $18.41 + $0.20 = $18.61).
  Counterfactual, reconciliation off: 3 pins and exactly the sweep's 2 rounding checks fail, 298 pass.
- **Davies' list (2026-09-24 22:19 UTC)**: "Stablecoin quotes页面的…删了；Reward quotes页面的…和…删了，那个warm up的表格也要设计展示的更好一些；
  unrealised和realised g/l中请把rewards和通过order的收益分开…；live和testing的切换请保持窗口大小的一致，agents模式所有子页面窗口大小也都一致，
  …所有的scoreboard都在DEPLOYED前加上funded的金额并且在适当的位置加上百分比（…可以超过100%）…；live的策略名称标题中也不用加live；
  STRATEGIES表格中可以把mode删了；polymarket也做到testing的venue里…；live页…那个框显示的所有信息要普通人能看得懂的". Done: both test pages'
  head lines and RW's formula note gone; RW's bar four tiles under a day-of-14 line; realised and unrealised split into
  rewards and orders; one window for every agents page (85vh on a desk, the whole screen on a phone); FUNDED before
  DEPLOYED on all four scoreboards, DEPLOYED as a share of funded with a bar (gold past 100 %); the live row named
  without " · live" (display only, `strategyName`: `agent_strategies.name` untouched); no Mode column; a Polymarket card
  on TESTING, which is Reward quotes' own row (the Revolut X and Binance cards and the scoreboard still add up the
  strategies alone); LIVE's box and banner in plain words, the not-on-yet one amber rather than a red fault.
- **Evidence:** vitest 82 in agents; sweep 300 checks (16 new), both widths; old against new (`main` `e7973d4`'s
  bundle, the sweep's fixtures and clock): 174 figure comparisons, 0 differ; no console error in either bundle.
  Screenshots overwritten in the Project store's `media/agents-redesign/`, with the three sub-pages added.
- **Open, for Davies:** whether TESTING's scoreboard and the Revolut X card fold the two tests in (item 00000000.2;
  with the Polymarket card showing Reward quotes, the question is sharper). The same rounding class — parts beside a
  sum — also stands where a table's rows sit beside a total (the quotes page's books against its realised, a
  strategy's position cards against its unrealised, a tab's rows against its scoreboard); not changed, since each row
  reads its own correctly rounded figure and forcing the sum would make a row disagree with its own page.

### [2026-09-24 22:51 UTC] Platform: Cursor | Model: Opus 5.5

**G6: the 75 branches are deleted; `pm-geo-probe` is not, because no credential here can delete a function.**
- **Branches:** deleted 22:48–22:49 UTC, after `e7973d4` put their heads on `main`: `cloudflare/workers-autoconfig`
  alone first, to test the token, then the other 74 in one push. Each deletion carried its recorded head as a lease
  (`--force-with-lease=<ref>:<sha>`), so a branch that had moved since the record would have been refused and kept;
  none was. Checked again just before: no open pull request, and no push to any of the 75 in the activity feed's last
  day. `git ls-remote --heads` afterwards: `main` (`e7973d4`) and `agents-live-testing` (`404755c`, untouched), nothing
  else. G6's count and the list derived here agree: 75.
- **`pm-geo-probe`: still ACTIVE at 22:50 UTC in the project's live list** (connector `list_edge_functions`): the
  eleven repository functions plus `pm-geo-probe`, v1, uploaded 2026-09-24 02:12:22 UTC with `verify_jwt` false and an
  entry point under `/tmp/user_fn_…`, so deployed out of band, never by CI. Its whole source is one `index.ts` that
  fetches `polymarket.com/api/geoblock` and `ipinfo.io/json` and returns both: no secret, no database. `git log --all
  -S pm-geo-probe` finds only the commit that wrote G6, and nothing in the tree names it but this ledger, so there is
  no source, map row, workflow or test to remove. The blocker, exactly: the connector's Edge Function tools are list,
  get and deploy, with no delete; the machine has no Supabase access token and no CLI login; the one PAT that could,
  `SUPABASE_ACCESS_TOKEN`, sits in the GitHub `production` environment, readable only by `edge-functions.yml`'s deploy
  step, which never deletes. No credential was created. Davies deletes it (G6 has the dashboard path and the command),
  or gives the word for a one-off CI step that runs that command with CI's PAT, taken out again in the commit after.

### [2026-09-24 22:48 UTC] Platform: Cursor | Model: Opus 5.5

**G6's 75 branches, every head recorded here BEFORE any is deleted** (Davies asked at 22:35 UTC to have G6 done for
him; item 0000000000000 §1). At 22:43 UTC the remote had 77 heads: `main`, `agents-live-testing` (created 21:54 UTC by
the Agents-page redesign, which waits to land: kept) and G6's 75 exactly, 48 `claude/`, 3 `cursor/`, 2 `agent-remote/`
and 22 older feature branches. No pull request is open, and the repository's activity feed shows no push to any of the
75 in the last 24 hours (the newest, `claude/repo-audit-restore-uverhn`, was last pushed 2026-09-23 04:39 UTC). Each
line gives the head, the branch, and what keeps the commit on GitHub once the branch is gone: `pull/N`, it is
`refs/pull/N/head`, which GitHub keeps; `in pull/N`, an ancestor of that ref; `bundle`, nothing. Those 8 heads carry 14
commits no `main` ever had (May–June debugging and review commits, and three WIP backups of 09-22/23 on
`repo-audit-restore`), so they are also in a 691 KB thin bundle in the Cursor project's store,
`internal/branch-cleanup/unheld-branches.bundle` (sha256 `89be880a86c8290e…`, its 8 prerequisites all in pull refs).
To restore a branch: `git fetch origin refs/pull/N/head && git push origin <sha>:refs/heads/<name>`; for a `bundle`
line, `git fetch origin '+refs/pull/*/head:refs/pull/*'`, then `git fetch <bundle> 'refs/heads/bk/*:refs/heads/*'`,
then push it.

    f2bd15802f6434788af74dc713852117f9f3fd89  agent-remote/1f24a9d6-1400-49f2-b643-1d9276da8a2b  bundle
    a5972e6d4f280346da3093243f5f067511ab6a23  agent-remote/7a215b4b-d58f-4e83-be7d-5a9b1299051f  bundle
    55cfe5c4d4adbf8d12c17f87bda0c1559944a110  chart-1d-and-density                               pull/50
    aac179e92b635b8527292f698d5d9e0845a3cf43  chart-polish-v2                                    pull/46
    79cdd5f81357f0ded853687430073497e89e3d0b  chart-polish-v3                                    pull/47
    e9b623cab6d40da59630e4ea798561be7a9d3c9d  chart-polish-v4                                    pull/48
    ce66f88351589ce513a8d3b7dc6ec5f7fb2df069  claude/add-peg-ratio                               pull/112
    c4c91be1e4581266ade70ab2fb50a19f435150c1  claude/add-ps-ytd-view                             pull/110
    11debab10ba8c6bd9954bab2fd40898567742054  claude/chart-primitive                             bundle
    17783bddad409aba651ecff0cfe7337960fed039  claude/codebase-improvements                       pull/171
    98e60f4d516c2f009b3a59de7c7b51a5cca0563a  claude/db-retention-ci-budgets                     pull/159
    dc32e5cb3e039a101a3388db0025a97fb5c2f9f3  claude/drag-swap-positions                         pull/166
    10aa6cfb2b67a2ec6774b92fd8d3bc2b50c13f46  claude/ext-hours-and-peg-display                   pull/119
    9b5ca905a30e3479bed4dca8a082aae0902dc7bf  claude/ext-hours-home-fixes                        pull/122
    84f0ff81823398b892c5b3f568a10139342caf09  claude/fix-mobile-heatmap-scroll-bdZpO             pull/169
    91d75629d7501856a08ca3cf8f5110b1c98787b8  claude/fix-overnight-line-regression               pull/177
    f99bf2a1f4271d1aa54406a5f6d282bc58eb1bdc  claude/fix-portfolio-display-fuIpj                 pull/10
    0c21d57f8f0142a3e30809fb5b6ccf1ba1d4d979  claude/fix-ps-live-tail-cliff                      pull/111
    a5bc3e658e8d7ab65b8fe29b2253193fa3eaa4f0  claude/fundamentals-split                          pull/131
    c1b8887baca45096be972588a09c8ae7b221d7e5  claude/gracious-mayer-9j1sz5                       pull/184
    c0a02bc0baf10e2117cbe5f1b085e599f46dbddf  claude/holdings-list-menu                          pull/167
    44603b09d9115e200f2a7d142c1d5d86862bfda9  claude/infra-security-hardening                    pull/176
    6406d29b1564500e2961df647024a9afc15c1298  claude/item2-revert-mkt-cap-row                    pull/127
    ee8224a1efc6a167a0ad04cf5061408e3af73d0f  claude/mkt-cap-restore-and-preload                 pull/128
    97b37c0d5d6658636af00b86763d8bb976e04d2b  claude/mobile-scoreboard-ccy-toggle                in pull/161
    fea2e548d4979648cae9e4ccb320a6c3063573a7  claude/modal-decompose                             pull/172
    a6391f1d19cc3d92f2965420225c3e4ec2a227e0  claude/modal-market-cap                            pull/126
    ff52c3b784b1f753738dda28977ecb3db4cb6c47  claude/move-holding-and-readme                     pull/165
    15eef4e28a506d4b7d55a8ae07b482d9492ffc5f  claude/ops-error-acknowledge                       pull/123
    6ed7eff8d5e3f8098d28cd1ee502e1aea3f7665d  claude/overnight-intraday-recorder                 pull/162
    b9b60561a19315ef11627352513a3529b7ab0cf7  claude/overnight-line-always-on                    pull/197
    7abc4d8bf32cf12d91599030bd7ece75bb82cde2  claude/peg-2y-forward                              pull/118
    51f99bf1dfa5e092e64da89b1d3fdf38ad961c9b  claude/peg-cache-bust                              bundle
    9dbdfc477374d7dfa35d8ec72e83cc1f97b2c6a5  claude/peg-debug-tmp                               pull/113
    ffa18f360a3362c5cf03503a9119445581449d87  claude/peg-input-debug                             pull/116
    b560c0895eec9f903a5fab80a216fa31d8bc1e1c  claude/peg-source-probe                            pull/117
    ba6054233a4b00608ff92c27645e15bb5656ceaf  claude/perf-overnight-1d-1w                        pull/196
    ee596bcb8dd3f6ab3fd3dad5491767f3d3824f08  claude/ps-quarterly-revenue                        pull/125
    34612e252ce45fae1b4ca6b9733c1aead2d98f6b  claude/ps-ytd-cache-invalidation                   pull/121
    6295485b083f4642a419c6682ef6ed19b9ebdb3f  claude/ps-ytd-earnings-steps                       pull/120
    af38eea5adb0b2e443ecd53f52bb48911c7e473a  claude/refactor-modal-tests-migrations-ci          pull/158
    ddb4c67bd81db525bead10daa9fbfac24f8c8183  claude/repo-audit-restore-uverhn                   bundle
    3fee5504c4cfb47a1e7db02f24768a6f81aebf0b  claude/restore-migration-0005                      pull/115
    238ce2debaa16488ee1913cdfed36fe481f1d95c  claude/sales-source-probe                          pull/124
    a5ddf8cc346af23b17340eede3eff7e97ce95d7e  claude/skip-weekend-overnight-dot                  bundle
    8c621370ae9bee2639f78c85d14e6e20647fff43  claude/sleepy-archimedes-0sTSy-2                   bundle
    1371ce0cd9000df8cf8cb825ec3c5e1245e1f239  claude/sleepy-archimedes-0sTSy-3                   pull/175
    8c9a9b89b28a50d320ccf8627b69f8a2b61cc021  claude/sleepy-archimedes-0sTSy                     in pull/208
    604521832421e55bafdaa81c5ddbc0bfc0c811d9  claude/ticker-modal-1y-range                       pull/170
    36b049d862e92fb04c325c27740dc45c7ddb2e1f  claude/trading212-autosync                         bundle
    fe41833c5c996653b8eea8d92fb4738965b57385  claude/utils-split-final                           pull/130
    70b44703e2e463ff75995d8903639757a3becb4f  claude/visibility-gating-memo-tests                pull/161
    557abebc99e1b99b30118e8e4eb35699d6e67446  claude/yahoo-crumb-fundamentals                    pull/114
    e3b64c77fc2305e1f96ecd3037d9767befc19a29  claude/yahoo-finance-chart-integration-MONGx       pull/52
    ebfe754bd20b3281eb8c2263256c384d402a356c  cleanup-and-ci                                     pull/38
    7b1b84bfb344133274bee0e9f1cbfa5895ff3db3  cloudflare/workers-autoconfig                      pull/4
    ce17fde0e0ca1b25b22589caf2ca4f8779044b2b  cursor/fix-scoreboard-portfolio-6b8b               pull/208
    e89259db551d3f973d3ea88ac9767935c6628f08  cursor/t212-transactions-6b8b                      in pull/208
    0c8a2636de1884e66101dd325bc7a8a757d890a2  cursor/working-with-davies-skill-6b8b              pull/206
    7afce3695a66739670abfd6e5d9d800bd708e894  fix/cn-fund-refresh-stall                          pull/202
    bc937387204204a8c98ee6f6deb6e02882bd8d9b  hide-values-toggle                                 pull/41
    8a4992e624fd0988997aac9528ef2ad4c0f3d8d8  hotfix/move-dist-to-root                           pull/32
    35535c4d9fbc115f7b3c2810a29feb77a9c93717  lot-management-ui                                  pull/37
    c1d7f3363116e69ad99b90c6377a18eab40bbb89  mask-and-intraday-fix                              pull/43
    3b65a020496e0fbaff0e7a0edad733087177e8d0  perf-chart-1d-logic                                pull/49
    aa9eb17b53be54d00fdf16d32e6aeba009387fa8  perf/cold-start-fix                                pull/201
    899b26c2484094bd2bdb9b4dd6e1c0069b5ab393  ranges-and-ticker-chart                            pull/42
    55152c44c33d7973c066cc92f7f5ee836d8005be  server-lockout                                     pull/39
    20a69f98b52033ef9db96f594785428154265ded  service-worker                                     pull/35
    e1dc085088d7caa32e30f4bc3ed20735ada0ddfc  split-modules                                      pull/34
    35680827d3f829d0e2aeb0bb4f6e7e8eb27eb7f3  ticker-chart-overhaul                              pull/44
    b51126fd6501dca6e657a95ecd523fbc6d81017f  ticker-chart-polish                                pull/45
    1ef8ff534f940e37c20b0cd96b1f0943c39248e5  typecheck                                          pull/36
    d9b84cf7f48ea1087f54b960d921e5cceb9c9745  vite-outdir-root                                   pull/33
    c1e3f590dad4e81fb7e9e81091a022885d84068d  ytd-tests                                          pull/40

### [2026-09-24 22:42 UTC] Platform: Cursor | Model: Opus 5.5

**trend-4h goes live at $50: `0054_go_live.sql` pushed on Davies' word** (G4). Davies, 22:35 UTC, after being told
the go-live is the migration, then the arming, then a first real buy the loop places by itself on the next entry
signal, then the fill read back: "验证没问题的话就上线，并盯着上线情况". At 22:40: "上线后的买卖不需要找我确认，如果真
的需要你帮忙盯着就行" — so no separate confirmation of the first order, and the read-back before the first exit is the
session's. Every precondition was checked again first, read-only, 22:40–22:41 UTC: no `trend-4h-live` row;
`agent_risk` `global_pause` false, `live_confirmed_at` null (caps 100 live / 300 paper, loss 5, orders 40); paper
`trend-4h` flat, params equal to the draft's; no live order ever, no open order in any mode; no `ops_errors` and every
cron run succeeded since 21:22 (269 responses, all 200, none with an error in its report); probe 200, `pkcs8-b64`, USD
the only currency, USD available ≥ $51 true, reserved 0, BTC/ETH/SOL/AVAX `active` (UK spreads 3.1 / 2.8 / 4.7 /
10.8 bps), no active order, no order history; remote migrations end at `0053`. The file moved from
`docs/agents/go_live.sql.draft` with its SQL byte for byte as verified; only its header comment now says what it is.
The Binance twins compute their own decisions from the same rulebook, so a second Revolut X `trend-4h` row changes
nothing of theirs.

### [2026-09-24 21:51 UTC] Platform: Cursor | Model: Opus 5.5

**`1bf254d` is live, and PR5's first-evening order gap is reconciled** (handover G5).
- **The deploy:** `check` and `edge-functions` green; the workflow's log shows `agents` deployed, and the project lists
  `agents` v63 updated 21:37:51 UTC. From then to 22:00:41: 79 cron responses, all 200, none with an error in its
  report; no `ops_errors`; the executor, the paper engine and RW each at minute 21:49 with no error at 21:51; L3 has
  no row since; the tick decided the 22:00 bar (trend-1h and its Binance twin, three holds each, at 22:00:04).
- **The ~9 % shortfall** (116 orders on 09-23 15:09 → 24:00 against the design's 128):
  `backtests/pr5_live/reconcile_first_day.py` (with its `.json`) replays the frozen `pr5_sim.py` (hash checked) on the
  inputs the design pulled, which equal the engine's stored ones hour by hour (prints per book, the 34 USD-book hours,
  and GBP/USD but for 20:52, a null in the pull that the engine stored at the 20:51 value, added in the replay). By
  minute the replay and `agent_quote_events` are identical up to 21:47 on both books, 116 orders each. The gap is
  USDT-GBP's re-price at 21:48 and its reversal at 21:58, six orders each. At the 21:48 turn the stored 21:47 close
  puts fair 5.106 bps from its priced level, 0.106 bps past the 5 bps step (21:42 reached 4.973); the engine did not
  act, and what it read then is not recorded: it writes X and fairU only on the minutes it acts (all 116 of those equal
  the stored inputs), and `agent_quote_inputs` is re-written by every later fetch. A provisional Yahoo close, or the
  20:00 USD candle missing from the 21:00 fetch (fair then 4.606 bps away), would each leave it under the step. The
  spec's ±5 % / ±10 % check tolerates this; recording X and fairU every minute would make it exact (Davies' call, G5).
### [2026-09-24 21:48 UTC] Platform: Cursor | Model: Opus 5.5

**The Agents page on two tabs, LIVE and TESTING: built and pushed on branch `agents-live-testing`, NOT on `main`; it
lands when trend-4h is live.** Davies: "如果上线的话，整个agents页面需要重新设计，最上方加上live和testing两个页面选择，可以点击切换，
需要精美设计，把live和testing的策略以及信息分开". The coordinator: build it now, land it on `main` only on its word that
trend-4h is live; until then the branch (no PR) carries it for Cloudflare's preview.
- **What it is:** a tab bar between the title and the page, outside the scrolling body: LIVE and TESTING, each with its
  row count and one line of words (LIVE: armed / awaiting arming / paused / winding down / nothing is live; TESTING:
  paper), switched by a click or the arrow keys. It opens on LIVE while anything is live, else on TESTING; a click
  holds through refreshes and stacked pages. Each tab is its own scoreboard, venue cards, banners and table, every
  figure summed from that tab's rows alone (`scoreboardView(dash, tab)`, `venueRows(dash, tab)`: `dashboard()`'s own
  sums over a subset, so over every row they are the server's `totals` and `byVenue` to the bit, pinned). LIVE is a
  row labelled live or still holding real coins (`strategyTab`: `holdsLive`, the tick's book rule); banners carry the
  tabs they concern (`alertsFor`: Binance's fault is TESTING's, the confirmation LIVE's, the pause both). LIVE shows
  "Armed since …" once `live_confirmed_at` is set, the existing "Live not confirmed" banner while it is not, and
  "Nothing is live" when empty. A venue card no longer counts live rows (the tab says it), and a lone card takes the
  width. Presentation only: no strategy's data, rule or live state, no Edge Function, no migration.
- **Evidence:** vitest, 7 new pins (two rewritten to feed rows, not aggregates); the sweep's new `AGENTS_LIVE` fixture
  (the draft's `trend-4h-live` long ETH, armed and unarmed; `totals`/`byMode`/`byVenue` summed from its rows) and 34
  new checks at both widths, held to hand arithmetic: LIVE $12.50 / +$0.20 / +$0.50 / +$0.30, TESTING $21.50 / +$0.42 /
  +$1.50 / +$12.34, together $34.00 / +$0.62 / +$2.00 / +$12.64. Old against new — `main`'s bundle (`1bf254d`) and this
  one under the sweep's own fixtures and clock, read out of the DOM — 146 comparisons, 0 differ: every row and every
  detail page line for line; with nothing live the scoreboard and cards are TESTING's; with a live row the old single
  scoreboard and Revolut X card are LIVE + TESTING to the cent. Counterfactuals, each caught: one build with the tabs
  but neither the split nor the banner scoping (20 sweep failures, 10 a width, the pause and confirmation banners
  among them; 32 comparison differences — LIVE + TESTING read $68.00 against $34.00), and `strategyTab` without
  `holdsLive` (3 pins). No console error in either bundle. Screenshots and the harness: the Project store's
  `media/agents-redesign/` and `internal/agents-redesign/`.
- **To land, on the coordinator's word:** on `agents-live-testing`, `git fetch origin main && git rebase origin/main`
  (LEDGER.md will conflict: keep both sides), `npm run build` in `src/` if `src/` moved on `main`, `sh bin/gates.sh`,
  `git push origin HEAD:main`; then check the live site's `app-*.js` is this build's. `docs/README.md` says Agents
  screenshots "will follow once a strategy is live": Davies' call, not part of this.

### [2026-09-24 21:35 UTC] Platform: Cursor | Model: Opus 5.5

**Resumed from `f2dc64d` (Claude Code); G1 read, G4 re-verified, PR5's L3 rows explained and fixed.** The tree was clean
and `main` equal to `origin/main`. This container's ledger hook was off behind Cursor's hook dispatcher (machine setup
now says how to point it at `bin/hooks`).
- **G1, RW (21:06–21:10 UTC, warm-up):** `pm_rw_state` last minute 21:04 at 21:06:33, no error; 09-24's selection 16
  markets, $295.52; `pm_rw_days` empty (correct until ~00:02 on 09-25); minutes 19:00–21:06: 1,343 quoting rows with a
  size-adjusted touch, every one decided, and 151 without one (the rule's "no book"), none decided; 64 fills in 12
  markets, each on a stored print; cron `agents-pmrw-every-minute` 103/103 and `agents-pmrw-select` 20/20 succeeded, one
  selection (19:30) and 19 "already selected today"; pg_net's window (15:08–21:07) 916 responses, all 200. The page's
  figures (dashboard GET): total +$34.23 (rewards +$48.71, fills −$14.48), realised 55.75 + unrealised −21.53 = total,
  `mismatchUsd` 0; **the stress arm −$42.29** (−$0.33 at 20:13) with 12 open positions holding $136.36, marked at the
  size-adjusted touch. The warm-up counts nowhere; the stress arm over the fourteen days is condition (2).
- **G4, trend-4h at $50, fresh (21:13–21:22 UTC): READY.** Paper `trend-4h`: 30 decisions in 24 h (six 4h bars × five
  coins, the last the 16:00 bar at 20:00:11), all `provider: rule` (no entry signal, so Jev was not asked); its three
  exits (ETH 09-23 16:00, BTC 04:00, SOL 12:00) were ATR trails, filled at 9.0 bps; flat. Params equal the draft's (`jsonb` equality true). `agent_orders`:
  no live order ever. `ops_errors` (24 h): one `agents.crash` in `action: quotes` (09-23 21:58, PR5's paper engine,
  before the executor existed), a lease-claim timeout, a Kraken quotes timeout and a PR5 pair-config timeout, each
  handled; the tick has not crashed since D1's deploy. Probe (`only=revx`, via pg_net): 200, `pkcs8-b64`, balances
  200, USD the only currency held, **USD available ≥ $51: true**, reserved 0; BTC/ETH/SOL/AVAX `active`, UK spreads
  2.4 / 1.2 / 4.0 / 10.5 bps; active orders 0; order history 0; the signed call with a query 200. `agent_risk`:
  `global_pause` false, `live_confirmed_at` null. The draft's INSERT meets every constraint of `agent_strategies`
  (kind, venue, signal venue, the Binance-paper-only check, mode, capital, primary key, NOT NULLs); neither table has a
  trigger or a policy; no `trend-4h-live` row exists. Remote migrations end at `0053` (plus the four 202608
  out-of-band versions), locally too: **the next free number is `0054`**. CI green on `f2dc64d`; `migrations.yml`
  last ran green (`0053`). Nothing was moved, armed or sent: Davies has not said "开" in this conversation.
- **PR5's two L3 rows: one defect, fixed in this commit** (reference §4 item 35). A refused paper order is not
  resting, and the frozen rule re-prices it while it waits to be placed again, under the same order id and live
  minute, with no event and no order counted. `paperEntryTarget` did not look at the order's state, so the executor
  carried out refused orders: it sent 108 at the re-priced 0.7543 under the 12:36 decision (paper 0.7547, refused at
  12:36; placed again at 12:49 at 0.7543, when the executor had nothing left to send, L4's row), and on its first
  minute sent 4 at 0.7544, re-priced from a bid refused at 00:18. Five of the day's 14 refused bids left a dry-run
  order resting 9–37 minutes. L4's other row (USDC-GBP 14:28) was the same thing, harmless: re-placed at the ticks the
  dry-run still rested at. Now a refused order is no target: the rung withdraws with the reason "the paper engine
  refused its order" and sends nothing until the rule places it again. Pins: the two production cases replayed
  through the paper engine and the executor, in dry-run and live, asserting L3 and L4 empty; with the one condition
  removed, both and the extended `paperEntryTarget` pin fail (3 of 33), and with it 52 of 52 PR5 tests pass. The
  golden replay never saw it: its fake book sits a tick either side of the last print, so the venue refused whatever
  the paper refused. This redeploys `agents` (the tick, PR5 and RW all run there); read decisions, `ops_errors` and
  RW's last minute after it. Gates green here (vitest 988, sweep 250, perf 60, Deno 531); the build's `dist/` was
  not committed, since no `src/` changed and the CalVer stamp moves every hash.
- **Rotation review of the last code commit (`9f3e8a6`, RW's page):** its server read (the UTC day's selection, the
  fills paged by their whole key, the minute encoded) and the client helpers (`rwRow`, `rwView`, guarded divisions)
  hold; nothing to fix.

### [2026-09-24 20:38 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The two Revolut X candidates, verified** (handover G4, G5). Davies: verify the two strategies that were being
prepared and go live if nothing is wrong. **trend-4h at $50: every check passes** (paper row, params, probe, funding,
constraints — the list is in G4); moving the draft to `0054_go_live.sql` was refused by this session's permission
layer, so the move waits on Davies. **PR5: not ready** — no round trip yet, and L3 has two dry-run entries below
their paper orders (G5); it stays on paper and dry-run until its 2026-10-21 review. The Agents page redesign he asked
for (LIVE and TESTING as two switchable views at the top) follows the go-live, and is not started.

### [2026-09-24 20:24 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The handover is to one Cursor session, not two** (item 00000000000000). Davies: a single session on this repository,
in which he switches between Opus 5.5 and Grok 4.7. The item now says so and adds the rotation rule: end every turn
committed and pushed with its ledger line, and a newly active model checks `git status` / `git log`, re-reads the
handover and reviews the other model's latest code commit before working.

### [2026-09-24 20:18 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Handover for the next sessions** (item 00000000000000). Davies' usage is nearly spent; Cursor (Opus 5.5, Grok 4.7)
continues. Checked before writing: the tree clean, CI green on `9f3e8a6`, the live site serving that commit's
`app-acb3a648.js` on daviesluo.com and pages.dev, its `edge-functions` run green, and the production dashboard answering `rw`
(warm-up, 16 markets, 38 fills, the split equal to the engine's total). The go-live draft's migration number moved to
`0054` in the ledger and the reference, since RW took `0053`. RW's verdict procedure is written out (item 000000000000,
step 3).

### [2026-09-24 20:09 UTC] Platform: Claude Code | Model: not recorded (session policy)

**RW on the Agents page** (item 000000000000). Davies: the paper test was nowhere on the page; put it in TESTING
STRATEGIES, with a page like the others' changed for what it holds. It is the last testing row, "Reward quotes" on
Polymarket — a badge in Polymarket's blue, `#7d8bff`, which the dataviz validator separates from Revolut X's blue
(ΔE 15.6, 15.7 deutan), Binance's yellow and gain/loss — with a page: the scoreboard (realised carries the rewards),
the bar so far, today's markets (question, pool, our quote, our share of the pool, what is held, rewards, fills,
total), the closed days, the latest fills and the formula's caveat. The rows' totals do not include it.
- **Server:** `agents/pmrw_view.ts` builds the dashboard's `rw` from `pm_rw_*` with the engine's own `snapshot`,
  `accTotal` and `accCapital`. The one added figure, fill P&L split by average cost into closed trades and the open
  inventory at the mid, must sum to the engine's: pinned on 300 random fill sequences, and shown on the page as a
  warning when it does not (`mismatchUsd`). `pm_rw_fills` pages by its whole key (`db.ts`, pinned).
- **Client:** `rwRow` / `rwView` / `fmtCents` / `rwHeldText` with their pins; the sweep's `AGENTS_RW` is
  `rwSummary`'s shape and consistent with itself; eight new checks at both widths (250 in all): the row, the page, the
  phone's columns, the question's lines, "Sep", and the mask. `shot()` now waits out the modal's 0.22 s rise, so a
  screenshot of a page opened over another shows that page.
- **Found by looking at the screenshots, then pinned:** en-GB wrote "16 Sept" (now `fmtDayMonth`), and one line of a
  question named no market ("Will the highest temperature in Los Ang…"): two lines on a desk, four on a phone, where
  the Rewards column gives way (Total carries it).

### [2026-09-24 19:20 UTC] Platform: Claude Code | Model: not recorded (session policy)

**RW's paper engine: built, pinned, and measured against the live endpoints before it ships** (item 000000000000).
Davies: "继续推进 现在开始搭". `agents/pmrw.ts` ports RW's rule line for line and drives it from two cron jobs
(`0053`): each minute's book stored, each minute decided two minutes later from the public prints, the UTC day's
portfolio picked once. Every read is keyless (`_shared/polymarket_public.ts`); nothing is placed.
- **The port is RW:** the golden replay (`rw_golden.json`, from `scripts/rw_golden.py`) — 58 raw books summarised to
  rw_inputs.py's rows exactly, 2,821 first rows ranked to RW's primary in order, 29 markets to rw_test.py's numbers
  to 2e-6, the primary +$46.606921 and stress +$13.78. 17 pins in `pmrw.test.ts`.
- **Seventeen counterfactuals, each caught:** a fill at our own price; one-sided counted at a half; scores left
  unrounded; a one-minute decide lag; a decision row without its not-null columns; no inventory cap; no cache
  buster; no flat start; no end clamp; no end skip; the latest selection instead of the day's; settling without a
  closed time; selecting after the run; selecting a selected day again; Gamma never asked; no Gamma tokens for the
  markets the short list lacks; a token mismatch let through.
- **Two findings before deploy.** (1) The data API and Gamma answer `cache-control: public, max-age=300` and
  CloudFront served repeats of a URL from its copy (a hit 50 s old; one newest print for 36 s): every print read now
  carries its own millisecond, and uncached the feed is prompt (4,779 prints: median 4.3 s, max 9.7 s behind), so a
  two-minute decide lag holds. (2) An Edge request gets 2 s of CPU and reading all of Gamma cost 0.66 s of the
  selection's 1.22 s: tokens now come from the CLOB's short list (matched Gamma on 300 of 300) and Gamma is asked only
  about the markets `choose` takes — the same portfolio (pinned on 200 random ones), 0.87 s.
- **Run against the live endpoints locally** (in-memory database): the selection took 16 markets for $299.78 in
  35 s; six minutes recorded 16 books each, decided each two minutes later, read the prints, filled once, no error.
  `0053` applied twice to PGlite refuses what the double refuses.
- Also: the spec (frozen by this commit) now says a day quotes only on its own selection, the warm-up closes at its
  marks so the fourteen days start flat, and nothing is read after 10-09; `MANIFEST.json` lists the two new files.
- **Live (`201c19f`):** `0053` applied and `agents` v61 deployed at 19:25 UTC. The 19:30 selection answered 200 with
  3,154 markets booked, 2,182 scored, 16 checked with Gamma (0 refused, 0 mismatched), 16 chosen for $295.52 — inside
  the CPU limit. Minutes 19:31–19:33 were stored with 16 books each and decided two minutes later; prints were read
  from the Edge (4) and two filled; `last_error` empty; the tick and the quotes jobs kept answering 200.

### [2026-09-24 10:52 UTC] Platform: Claude Code | Model: not recorded (session policy)

**fp4 lands on `main`, and RW passes its forward bar** (item 000000000000). The research agent was stopped at 09:25 UTC
with an interruption of the main session, and its recorder and queued after-window job with it. On Davies' word the
main session restarted the recorder at 10:15:56 on the frozen universe and ran the agent's after-window job unchanged
at 10:43:30: 268 of 480 minutes recorded, prints complete for 2,821 markets, `rw_test.py` byte-identical twice. RW
passes all six conditions: primary +$46.61 on $480 (rewards $50.92, fills −$4.31 on 38), stress +$13.78, resampled
p5 +$21.78. The study's pending parts, reference §3.33 and `MANIFEST.json` are filled in; the agent's 16 commits
were cherry-picked onto the rewritten `main` (its branch predated the rewrite), ledger conflicts merged newest first.

### [2026-09-24 08:14 UTC] Platform: Claude Code | Model: not recorded (session policy)

**fp4: two descriptive checks, neither a test** (not pushed). Fed the 24-hour forecast — issued after WX's decision
time, so it flatters the model — the same weather model still scores a Brier of 0.0728 against the market's 0.0637:
the gap is not the forecast's age. FAV re-priced at the shown price loses $95.10 rather than $292.15: a third of its
loss is the favourites' own price, two thirds the prints. WX's forecast script is back to the version that produced
its data.

### [2026-09-24 08:12 UTC] Platform: Claude Code | Model: not recorded (session policy)

**`main` rewritten so every commit names Davies** (his word, 2026-09-24, before the CV goes out: "all contributors of
both public repositories linked in the CV become me"). `git filter-repo` on a full clone set author and committer of
all 1,053 commits to `daviesluo <daviesluo@gmail.com>` (550 had been another author, 184 committed by GitHub's web
flow, 7 by dependabot) and dropped co-author and session trailers; the final tree is unchanged (`a09ad6a`), so the
site, the functions and the database see nothing new. Force-pushed with a lease on `bd0c2f8` → `28f5c01`.
`docs/commit-map-2026-09-24.md` maps old hashes to new. Deleting the other branches was refused by the session's git
proxy (403); 75 remain for Davies (dependabot removed its 14). `decision-fc` needed nothing: its one commit and both `gh-pages` commits are his.


### [2026-09-24 08:10 UTC] Platform: Claude Code | Model: not recorded (session policy)

**fp4's study and reference §3.33 drafted, RW pending** (not pushed). The review and the reference section carry
FAV's and WX's failures, the measurements and the access finding; RW's rows say pending until its window closes at
10:42 UTC. A queued job pulls RW's prints at 10:43:30, builds its input and runs its test twice. Descriptively, FAV
would still lose $95.10 out of sample had every fill been at the shown price, which could not be traded.


### [2026-09-24 08:06 UTC] Platform: Claude Code | Model: not recorded (session policy)

**fp4's WX fails: the market knows more than the free forecast** (not pushed). Polymarket's daily temperature
buckets against Open-Meteo's 48-hour forecast with a normal error fitted on 2025 → 2026-02, trading the bucket the
model says is 10 points mispriced: out of sample (2026-03 → 09-10, 11,586 events in all) −$1,589.09 on 5,336 trades
of $5, −6.6 % a dollar; on 106,666 buckets the market's own price scores a Brier of 0.064 against the model's 0.075;
the thresholds 0.05 and 0.20 lose too. Byte-identical twice (`2e87cb33…`); 26 of 26 sample fills re-read from the feed.


### [2026-09-24 07:40 UTC] Platform: Claude Code | Model: not recorded (session policy)

**fp4: the oracle is not where near-certain outcomes lose** (M2, not pushed). Of 344,229 resolved markets with
$5,000 of volume since 2025-01 (crypto up/down apart), 411 were disputed and 93 had their first proposal overturned
(0.27 per 1,000), concentrated in politics (2.7) and mentions (5.6); sports pays 50-50 on 11 games in 1,000; capital
stays locked a median 2.3 h after a sports market's scheduled end, 30 h after a political one. FAV's twenty sample
trades were re-read from the public feed: 28 of 28 fills found at their second, 20 of 20 payouts agree.


### [2026-09-24 07:31 UTC] Platform: Claude Code | Model: not recorded (session policy)

**fp4's FAV fails every condition but the trade count** (not pushed). Buying the 0.90–0.99 side a day before a
market's scheduled end and holding it to resolution, filled only from real prints: out of sample (2026-01 → 09-10,
one event in four) −$292.15 on 2,282 trades of $10, −1.4 % per dollar; the favourites won 95.1 % of the time
against an average fill of 96.3 ¢; the calibration null's 95th percentile +$106.96; stress −$351.35. A week before
−$55.49 on 334, an hour before −$910.51 on 2,538. Byte-identical twice (`4b202faf…`). WX's forecasts are complete
after one refusal by Open-Meteo's daily limit; its prices and prints are being pulled; RW's window ends 10:42 UTC.

### [2026-09-24 07:21 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Polymarket runs from Ireland when it trades, and only while Davies is there** (item 000000000000). Davies is resident
in Ireland as well as the UK, and approved the Irish region. Supabase's regional invocation (`x-region: eu-west-1`,
docs read 2026-09-24) ran the same probe in Ireland at 03:20: every account read as from London, the reply's
`x-sb-edge-region` `eu-west-1`, and the geoblock `blocked: true` for IE, because that endpoint answers for the frontend.
`.claude/CLAUDE.md` and reference §2d now carry the rules an order path follows (`eu-west-1` only, an expiring
attestation that he is in Ireland to open, reduce or close only otherwise, never a VPN, proxy or anyone else's
account); §6 records the run. No code changed.

### [2026-09-24 07:14 UTC] Platform: Claude Code | Model: not recorded (session policy)

**`bin/gates.sh` runs only the unit tests for a Markdown-only change** (Davies, 2026-09-24: eight minutes of gates
for a one-line README edit). Against origin/main (unpushed commits, edits, new files), a change made only of `*.md`,
`*.mdc` and the `.claude/`, `.cursor/`, `.agents/` folders runs `npm test` and the Deno tests, the only checks that
read Markdown (`docs_map.test.js` reads `docs/map.md`; `agents/jev_rows.test.ts` a pre-registration); anything else,
an empty diff, or `--full` runs every gate. Checked on seven sample change lists. CI still runs everything on push.

### [2026-09-24 07:06 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The public README no longer mentions AI coding agents** (Davies, 2026-09-24, before the CV goes out): the
repository map's `.claude/`, `.cursor/`, `.agents/` row is gone, and `.claude/CLAUDE.md`'s README rule says the map
names no AI coding agent and no folder of theirs, so a later session does not put the row back.


### [2026-09-24 06:49 UTC] Platform: Claude Code | Model: not recorded (session policy)

**fp4 resumed after the container restarted at ~04:02 UTC** (not pushed). RW's book recorder was down 04:03 → 06:42
and runs again on its frozen universe; its pre-registration already says a missed minute quotes nothing, so the
test runs on the minutes recorded. The monthly pulls are now read one market at a time (the September 2026 pull is
1.4 GB of JSON). WX's station parser read only Wunderground URLs; from 2026-08 the markets name weather.gov's time
series page (`site=kord`), whose ICAO code the pre-registration's "resolution URL's ICAO code" covers, so it reads
both now — fixed before any WX price or forecast was read. Polymarket's Terms of Use (effective 2026-08-11) name
Ireland as well as the United Kingdom among the places whose residents may not trade.


### [2026-09-24 03:30 UTC] Platform: Claude Code | Model: not recorded (session policy)

**fp4: negative-risk sets measured, and the pulls packed** (not pushed). Three sweeps of every negative-risk event's
books 15 minutes apart (M5): a complete set's YES asks sum to 2.88 at the median (5th percentile 1.03); per sweep two
sets pay to buy every YES and one or two to buy every NO after fees, the largest 12.5 ¢ on ten shares locked to
2027-02; an augmented set's asks sum below 1 because its unlisted outcomes are missing, not as an arbitrage. FAV's
and WX's price reads now pack twenty tokens a request (each still reads only its own window) and their print walks
split across processes; the data is the same.


### [2026-09-24 03:14 UTC] Platform: Claude Code | Model: not recorded (session policy)

**fp4: the pulls survive a dropped connection and a short disk** (not pushed). A Gamma month died on an
`IncompleteRead` the helper did not retry; it retries now, and RW's recorder was restarted on the fixed helper at
03:10 UTC between two rounds (a restart never rewrites a minute it has). The container had 1.6 GB free: raw monthly
pulls are gzipped as they land and every reader takes the `.gz`. The 2026 months hold 250–700 k closed markets each.


### [2026-09-24 03:06 UTC] Platform: Claude Code | Model: not recorded (session policy)

**fp4: two data-side deviations fixed before any FAV price is read** (not pushed). FAV's prints are pulled one Gamma
event at a time (the same prints, one walk per event), and the test runs on one event in four chosen by its id,
because every candidate's prints would take about six hours of paced requests; a first draft of the universe that
dropped 50-50 and void payouts was caught against the pre-registration and fixed. Measured beside the tests: 896
strike/date ladders hold 16 out-of-order pairs after fees, the largest under 1 ¢ a share on markets settling in
2027–28 (M6), and the 400 largest makers on the richest reward pools took $6.78 M of rewards lifetime (M4).

### [2026-09-24 02:57 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The Polymarket probe ran; the account is verified and cannot open positions from here** (item 000000000000).
`8c0c633` pushed after `bin/gates.sh` ended all green (984 vitest, 242 sweep checks, the perf matrix, 509 Deno); the
edge-functions run deployed every function (`_shared` changed), and the tick, the quotes and PR5's dry-run all ran on
the new version at 02:55–02:56 with no `ops_errors`. The probe (02:54 UTC, reference §6): settings complete and
consistent, the key controls the signer, the L2 credentials authenticate, the funder is the profile's proxy wallet, not
closed-only, no open orders, the wallet effectively empty, and **geoblock `blocked: true` (GB, ENG)**. It found one
unnamed spender with an unlimited pUSD allowance, `0xe3333700…`: Combos' Exchange v3, on Polymarket's contracts page.
The client now names it and three more Combos contracts (reference §2d), pinned in the probe test, which fails without
the names. `.claude/CLAUDE.md`: the probe parts list gains `revx2` and `polymarket`, the secrets list the
`POLYMARKET_*` names, and a bullet says Polymarket opens nothing from here and why. Item 00000000000 no longer says
PR5's live path is unpushed.


### [2026-09-24 02:49 UTC] Platform: Claude Code | Model: not recorded (session policy)

**fp4: a third pre-registration, WX, frozen** (not pushed): Polymarket's daily temperature markets against
Open-Meteo's archived 48-hour forecast, a normal error model fitted on 2025 → 2026-02, one trade per event when the
model and the price differ by 10 points, OOS 2026-03 → 09-10, a calibration null. The test scripts of FAV and RW are
committed with it, before their data is complete; RW's book recorder has run since 02:42 UTC.

### [2026-09-24 02:43 UTC] Platform: Claude Code | Model: not recorded (session policy)

**Polymarket phase 1: a read-only probe part, and the facts it rests on** (item 000000000000). `_shared/polymarket.ts`
loads the `POLYMARKET_*` secrets (a credential's two spellings must agree), signs L2 the documented way (the official
clients' HMAC vector and two more from their Python implementation are pinned), derives the EOA with `@noble/curves`
2.0.1 and `@noble/hashes` 2.0.1 over npm at exact versions (the official clients' published test key gives its
published address; EIP-55's own cases pinned), and makes GET-only reads from a fixed list. Reference §2d: the CLOB is
V2 since 2026-04-28 (pUSD collateral; the v1 clients are archived and "no longer functional"), L1/L2 auth, fees
(takers only, `feeRate × (1 − p)` of notional), the geoblock (GB close-only on the API), and why not
`@noble/secp256k1` (unaudited in its current version). knip reads Deno's `npm:` as a package named `npm`, so
`supabase/knip.json` ignores that name. Rebased onto `6b7f1c4` (PR5's live path). Deno: check clean, 509 passed; knip
clean; the docs-map test green. Two counterfactuals each fail a pin: signing the path WITH its query, and cutting an
upstream error before scrubbing it. The public reads were run keylessly from this container against the live hosts.
Not deployed, not run with the keys.


### [2026-09-24 02:40 UTC] Platform: Claude Code | Model: not recorded (session policy)

**fp4, the fourth first-principles search, on Polymarket: two pre-registrations frozen before their data exists**
(branch `worktree-agent-aed9a8c7d9e3f4117`, not pushed). FAV buys the token priced 0.90–0.99 a day before a
market's scheduled end and holds it to resolution (IS 2025, OOS 2026-01 → 09-10, a calibration null); RW quotes the
minimum qualifying size on both sides of the rewarded markets with the largest expected share, forward over eight
hours of recorded books. Found first, and outside both tests: Polymarket's own geoblock page lists the United
Kingdom as close-only on the frontend and the API, and its terms prohibit circumventing that. Public reads only.

### [2026-09-24 02:36 UTC] Platform: Claude Code | Model: not recorded (session policy)

**`.claude/CLAUDE.md` follows PR5's live path** (`0aca828`): the PR5 bullet says it is built and runs in dry-run, how it
goes live and how it stops; the secrets bullet says the executor reads key `_2`; the hand-trading rule now covers
PR5's sub-account too.

### [2026-09-24 02:33 UTC] Platform: Claude Code | Model: not recorded (session policy)

**PR5's live path is built, in dry-run, and NOT pushed** (item 00000000000). It is on branch
`worktree-agent-a8ae57caa382aed95`, off `15056c5`.

**The executor.** `agents/quotes_live.ts` runs after the paper engine inside `agents?action=quotes`, and reads the state
the paper engine saved.
- A flat rung quotes the paper rung's own entry order, one POST per paper decision.
- A held rung exits at the rule's `exitTicks` on the paper's fair, and is stopped after 24 hours.
- The paper engine, its tables and its replay are untouched.

**Migration `0052`** adds the config (in dry-run and unarmed), the orders table with a partial unique index (one open
order per rung), events, state, and the lease. It applies and replays cleanly on PGlite (PostgreSQL 16).

**The one D11/D12 rule.** `bookLiveBuy` was extracted from the tick's `settledBase`, and both now call it. The golive
pins are unchanged and still green.

**The doubles are stricter**, and every existing test stayed green:
- FakeRevx reserves what a resting order could spend, and refuses a placement the account cannot cover.
- It refuses a taker buy the account cannot pay for.
- It charges its fee in the book's quote currency.
- It serves the GBP books and the public order book.
- It can lose a cancel, or refuse a post-only order with a 400.
- memDb enforces 0052's checks and both unique indexes.

**The replay.** PR5's golden stop window (1,710 min) through the live engine gave 90 entries against the paper's 93
entry orders, 10 fills, 80 exits (7 filled) and 3 bounded stops (all filled). No rung ever held two orders.

**A defect the replay found, fixed and pinned.** A re-price's confirmed cancel did not give its coin back before the
replacement was sized, so on tight inventory the asks were skipped: 60 in the replay, 0 after the fix.

**Counterfactuals, 32, each failing at least one pin:**
- M1 the dry-run sends.
- M2 a refused decision is sent again.
- M3 a cancel is trusted on the DELETE's word.
- M4 an order the venue shows nowhere is marked rejected.
- M5 the row is not written pending before the POST.
- M6 a missing order is taken as cancelled instead of being read back.
- M7 D12 books gross; M8 D11 does not floor.
- M9 and M10 the governor.
- M11 the loss stop.
- M12 de-peg.
- M13 to M15 stale inputs (the paper behind, the USD hour, an exit re-priced).
- M16 to M18 the 24-hour stop (its bound, its retry, the book's halt).
- M19 the kill switch; M20 the global pause.
- M21 asks without coin; M22 a cancel's inventory not given back.
- M23 entries off the paper's price; M24 entries not post-only.
- M25 a partial entry's remainder; M26 dust.
- M27 the exit's price.
- M28 and M29 the conversion.
- M30 a paper table written.
- M31 the double's per-rung index.
- M32 the migration not yet applied.

Deno: check clean, 494 passed; knip (Edge) clean. No venue was called with a key, and no order was sent.


### [2026-09-24 01:43 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The second Revolut X key now reads the funded sub-account** (item 0000000000): the 01:43 re-run shows GBP only,
the amount Davies moved in, and no orders. The 01:37 run had read another account; he had mixed them up.

### [2026-09-24 01:38 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The second Revolut X key reads, but not the funded account** (item 0000000000): `only=revx2` answered every
read-only call and showed PR5's four books active at 1.3 bps, and an account with no GBP and a coin balance. The
rows' account is funded for the $50 go-live. No order was placed or can be by the probe.

### [2026-09-24 01:32 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The probe reads PR5's own Revolut X sub-account** (Davies opened it on 2026-09-24 with a key stored as
`Revolut_X_API_kEY_2` / `REVOLUT_X_PRIVATE_KEY_2`, and says he moved £50 into it). `?action=probe&only=revx2` runs
the same read-only checks as the rows' account — balances, pair config for USDC/GBP, USDT/GBP, USDC/USD and
USDT/USD, a signed call with a query, the book's region and the active orders' field names — and nothing else
reads that key yet. `REVX_KEY_NAMES` keeps both accounts' secret names in one table; `runProbe(revx2)` is pinned
to GETs only. Deno: check clean, 463 passed.

### [2026-09-24 01:14 UTC] Platform: Claude Code | Model: not recorded (session policy)

**`.claude/CLAUDE.md`'s Agents section follows the $50 go-live work** (item 000000000.4): the recommended row
is four $12.50 slots, $50; the drafted row goes in unarmed with a $15 cap (then $30, then $75); D1–D12 are fixed
and pinned; a live buy books only what the account can sell (D11, D12); the BTC-regime filter is rejected (§3.30).
Deno on this tree: check clean, 461 passed.

### [2026-09-24 01:11 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The go-live draft is at $50; the go is Davies' word alone** (item 000000000.1). `go_live.sql.draft` has capital 50
(four $12.50 slots) and `max_exposure_usd` 15. The steps to 30 (after a person reads the first round trip back) and
to 75 (after a clean week) are comments with their conditions. Daily loss 5 and orders 40 are written out, and
`live_confirmed_at` is written null. It is still unnumbered (0052 when it moves). The main session's read-only checks
at about 00:55 UTC agree with S2 and S3. Q1–Q3 are `replay.json` exactly, confirming ETH's trail exit at 2655.55.
P1–P4 show PR5's paper engine running with no error, at 116 orders on 09-23 against about 128 expected, to reconcile
at the four-week review. PR5 live stays a NO-GO until 2026-10-21. Reference §4 item 34, the go-live brief's note and
both reviews' status lines say so. CLAUDE.md's two Agents lines are left for the main session (item 000000000.4).

### [2026-09-24 01:08 UTC] Platform: Claude Code | Model: not recorded (session policy)

**D12 is fixed: a live buy whose fee went unreported is booked from the account** (reference §4 item 33). The book
takes the balance of the coin less the rest of the live book (buys less sells), never more than the gross, floored to
the step. It records what it read (`fromAccount`). Three cases settle nothing and are reported: a shortfall the fee
cannot explain, an unreadable balance, and a missing pair config (D11 now waits a turn for it, where S2's patch settled
unfloored). S2's reproduction went red → green with its assertions unchanged, and D4, D8 and D11 stay green. Four
more pins (full precision, a hand trade, the floor selling past an unreadable buy, no pair config) all fail on
`bf80626`; the third also fails against a clamped position. Deno: 461 passed, check clean, knip clean.

### [2026-09-24 00:59 UTC] Platform: Claude Code | Model: not recorded (session policy)

**D11 landed: a live buy settles floored to its pair's base step** (S2's patch
`p11_tick_settle_live_buy_to_the_base_step.diff` and its pin, applied unchanged on top of D8–D10). A coin fee reported
at full precision left `gross − fee` between two steps and a remainder the exit could never sell. The pin failed
without the tick patch (settled 0.031773937696 BTC against the 0.03177393 that can be sold) and passes with it.
Deno: 456 passed, check clean. D12's fix and the $50 draft are next.

### [2026-09-24 00:57 UTC] Platform: Claude Code | Model: not recorded (session policy)

**The docs follow the first-paint fix.** `.claude/CLAUDE.md` quotes the browser sweep's 242
checks, and the working-with-davies skill (all three copies) records the lesson it cost: the
chart store's `ytd` and `maCache` stores never reached IndexedDB, and every unit test passed
because the tests ran without it. The three first-paint commits were rebased onto `ea9fc39`
(the S1–S3 merge); the ledger's history keeps every section, newest first.

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
