# Reward quotes mid-pool, funded: the current dry-run strategy with real orders (pre-registration, DRAFT)

**Status: DRAFT, not frozen.** Written 2026-10-04 (UTC). It freezes only when Davies names the go date: a commit then
fills in that date, the hashes of "Frozen files" and the readout script, and removes this paragraph, before the first
live minute. Until then anything here may change, and nothing here arms anything. No session and no routine runs the
go-time statement; it runs once, in the conversation where Davies says go.

## On whose word

Davies, 2026-10-04 (about 00:00 UTC), verbatim:

> 准备mid-pool的上线，确保和现在的策略一致

In English: prepare mid-pool's go-live, and make sure it is consistent with the current strategy. The live mid-pool runs
exactly what its dry-run runs now: the same rule, the same band and exclusion, the same sizes, the same code path, with
only the sending switched on. When it goes live is his call alone.

The day before, on his word ("授权你现在读", 2026-10-03 23:36 UTC), both pools' paper results were read early (mid-pool's
deviation 1; ledger history, 2026-10-03 23:39): on 2026-10-03, at the same size, mid-pool's formula reward was about
2.6 times mini-pool's, with no worse fill cost. Mid-pool's own pre-registration
(`2026-10-02-polymarket-mid-pool-prereg.md`) says a funded mid-pool "would need a pre-registration of its own", and
that its margin "would be measured again before one, from this audit and a new measurement". This is that document.

## What goes live: the dry-run's strategy, unchanged

Everything below is what mid-pool's dry-run runs today, and the evidence that the live path runs the same.

- **The code path.** `agents?action=pmmid&forceFunctionRegion=eu-west-1` every minute (`runPmMidAction`, wired as
  mini-pool's since `0084`), `pm_live.ts` on `PM_MID_INSTANCE` (`pm_mid.ts`), and its paper layer `pm_prep.ts` on
  `PREP_MID_INSTANCE`. A turn is live only when sends are enabled in code, `dry_run` is off and the signing key is
  loaded for the stored signer. The mode changes only what meets the venue: whether an order is sent, our own resting
  orders taken out of the book the rule reads (a dry-run's are in no book, so the rule reads the same book), the
  `armed` gate, the collateral guard, and what is read of the account's earnings (below).
- **The rule.** RW's quoting rule as RW-E applies it (`rwQuotes`: RW's `summarize` and `quote` on the book without our
  own orders, N = max(the reward minimum, 5) ≤ 20, a side stopped at 3N of inventory its way), post-only GTD orders of
  600 s; the UTC day's markets chosen once by RW's ranking (`firstScore`, `choose`) with a formula floor of $2.50 a day,
  Gamma's word, the 48-hour horizon and RW-E's same-day rule.
- **The band and the exclusion.** A total daily reward rate of at least $10 and under $50 (a CHECK on `pm_mid_markets`
  and `pm_mid_minutes`). RW's frozen selection recomputed from public data at each selection, and every market scoring at
  least 0.33 of its last pick left out (`PM_MID_EXCLUSION_MARGIN` = 0.67), only a count recorded.
- **The sizes** (`pm_mid_config`, `0081`/`0084`): eight markets and $160 of first quotes a UTC day, $320 in all, $60 a
  market, −$25 a day and −$75 in all, 6,000 POSTs a day, GTD 600 s. The go-time statement sets the total cap from the
  balance the path read: least(320, floor(pUSD − 75 − 5)), so **the cap is the dry-run's $320 only on a balance of at
  least $400.00**; $398.20 gives $318.
- **Mini-pool stays in dry-run, unarmed.** The two paths trade one account; a trigger on both configs (`0084`) refuses
  arming either while the other is armed, and each go-time statement refuses it too.

The evidence:

- **The go-time statement arms that and nothing else.** Step 8m of `2026-10-01-polymarket-live-calibration.md`, read
  word for word, run on PGlite 16 over every migration of the repository in order, 0001 through `0089`
  (`backtests/pmlive/scripts/mid_live_check.mjs`, output `results/mid_live_check_out.txt`, 125 checks): the chain leaves
  `pm_mid_config` at exactly the sizes above, dry-run and unarmed; the statement refuses, leaving the row as it was, on
  each of twelve conditions (the balance unread, five minutes old, $0.036673 — the account's balance on 2026-10-04 —,
  $80.99; the last turn outside eu-west-1 or with no region; the key not loaded or unrecorded; the attestation revoked,
  absent or dated ahead; mini-pool armed); it arms at $401.37 and $400 with a cap of $320, $398.20 → $318, $300 → $220,
  $81 → $1; and armed on $401.37, of the schema's 137 tables only `pm_mid_config` changed, and of its columns only
  `dry_run`, `live_confirmed_at` and `updated_at` (the cap stays 320). Two counterfactuals fail it: the statement without
  its key check (2 checks fail), and one that also sets the market count (2 fail).
- **The same code decides live as in the dry-run.** The payouts change (below) carries `agents/pm_payouts.test.ts`,
  which runs mid-pool through the changed `pm_live.ts` beside the path mid-pool's pre-registration froze (`pm_live_mid_frozen.ts`, byte for byte sha256
  `8ba7b915…`), minute by minute, over three simulated days with the paper layer beside every turn: through the dry-run
  every table, request, body and report is the same; then armed, through fills, a lost reply, a 425, a late and a lost
  cancel, the pause's cancel-all, the day's loss stop, a paid readout and a settlement, every order, fill, cancel,
  selection, settlement, minute and event is the same, and what differs is only what the path now reads of the account's
  earnings (below). `pm_mid.test.ts` pins the action's wiring: as deployed a day sends nothing but GETs and its keyless
  batch read; armed, the same action and client send; the kill switches reach the venue. The change was built and
  every gate passed on 2026-10-04, and again rebuilt the same day on the formula fix (whose own fields its comparison
  takes out of both sides first, as `pm_mid_formula.test.ts` states and pins them); it is not on `main`, because
  deploying it changes the live order path's code, which waits for Davies' word (precondition 3).

## What only live can show (listed, not changed in the dry-run)

The dry-run never sends, and the account holds nothing, so these parts of the same code have never run for mid-pool:

- The venue's replies: an order accepted, refused (as crossing, for its balance, its parameters), a 425 or 429 sent
  again as a new order, a lost reply left `pending` and settled by its hash; a refused quote sent again only on new
  information (`refusalWait`); an order that would take our own resting one withheld.
- Cancels: a DELETE read back, read again after 300 and 700 ms while the venue still shows it, its slot frozen until the
  venue shows it gone; the global pause's cancel-all. How soon `GET /data/order/{id}` shows a cancel is unmeasured.
- Our own orders in the book: the rule and the post-only check take them out (`othersLevels`), and each minute's
  formula scores them against the book with them in it, as the venue holds them, never twice (since 2026-10-04, mid-pool's
  pre-registration's Addendum 2); the next day's selection scores the books without our orders still resting. The exclusion's
  recomputation of RW's selection reads the public books with them in, as RW's and RW-C's own selections would: in a
  market of ours they count among the others, which lowers RW's score of it.
- Inventory: real CONFIRMED fills, so RW's 3N stop, close-only sells of what is held, holdings at cost inside the caps
  and the loss stops on real P&L. In the dry-run `held` is always 0, so the 3N stop never bound, and the path's own P&L
  is always 0, so its loss stops never tripped (the paper layer's stops are its own).
- Collateral: no buy past the pUSD the resting buys leave (the dry-run is held to nothing). Whether
  `/balance-allowance` reports the balance net of resting orders is unverified; the guard can only withhold more.
- Markets held from an earlier day (read and marked, never quoted), and their settlement at Gamma's payout; tokens not
  yet redeemed counted as capital.
- Scoring: each order's `/order-scoring` and the account's live share of each pool, every live minute, and the scoring
  duration ("live for the required duration", undocumented).
- What Polymarket pays: R, read once a UTC day after 01:00.
- The lease renewed before each live order.
- The paper layer has nothing more to fill: it reads only the dry-run's minutes, so from the first live turn every
  minute of `pm_midprep_*` is missing (its test has ended).

## What Polymarket pays, told apart per path (2026-10-04)

Polymarket pays the account, not a path. Until 2026-10-04 mini-pool's readout booked every market the account was
paid for as a live row of its own (a paid market its minutes did not show became a live row with no minutes), and
mid-pool read no payout at all (`readsPayouts` false): a live mid-pool's rewards would have landed in mini-pool's R,
and its own R would have read zero. The change, built on 2026-10-04 and deployed only on Davies' word (`pm_live.ts`'s readout and the minute's share read):

- a path books a payout only for a market its own minutes show it quoting live that day; a market paid that no live
  minute of it shows is no row of its, and the account's day total stays on every row (`detail.total`) and in the
  readout's event, so what neither path's rows hold can still be seen;
- mid-pool, which in dry-run reads nothing of what the account earns, reads it once live: its share of each pool every
  live minute, and the payouts of a day it quoted live;
- R per path is the design doc's query on each path's own table: mid-pool's is

      select sum(coalesce(actual_usd, 0) + coalesce(actual_sponsored_usd, 0)) / nullif(sum(formula_usd), 0) as r,
             sum(formula_usd) as formula, count(*) as market_days
        from public.pm_mid_reward_days where mode = 'live';

Its pins (`agents/pm_payouts.test.ts`, landing with it): mid-pool through today's path against the frozen path (above), and the two paths
on one account (mid-pool live and mini-pool in dry-run, then the other way round), each booking only its own live
markets, neither booking a market neither quoted live. Each of the change's pieces removed alone fails a pin (six
counterfactuals); mini-pool's `pm_instance.test.ts`, its default instance against the code its own pre-registration
froze through dry-run and live with a paid readout, still finds every table, request and report the same.

One limit stays: a market on both paths' live minutes on one UTC day would be booked by both. That needs both in live
mode the same day with the market in both selections, which the disjoint bands rule out but for a rate crossing $10
between two reads at 00:00; mini-pool stays in dry-run throughout this test, so it cannot happen here.

## Before the go-time statement

Each of these, read and recorded in the conversation where Davies says go:

1. **The overlap audit** (`backtests/pmlive/mid_audit.sql`) has run, no earlier than 2026-10-23 00:05 UTC, and its
   counts are reported: how many of mid-pool's daily picks RW's and RW-C's actual selections took (expected zero).
2. **The margin, measured again** (done 2026-10-04, keyless, `scripts/mid_margin.ts` unchanged, outputs
   `results/mid_margin_2026-10-04_out.txt` and `results/mid_margin_2026-10-04b_out.txt`): **0.67 is no longer
   overlap-free.** Two runs, 00:13–00:47 UTC, recomputed RW's selection 22 times (6 more lost to the reward listing's
   5 s timeout): one of mid-pool's picks was among RW's picks at a later recomputation in 4 of 111 pairs 1 to 16
   minutes apart (4 of 66 in the first run, 0 of 45 in the second; 0 of 32 at most two minutes apart, 3 of 41 three to
   six, 1 of 38 further); at 0.8 in none. The 2026-10-02 measurement found none at either (91 pairs). This draft keeps
   0.67, the dry-run's rule, for a go date after 2026-10-23 00:05 UTC, when RW's and RW-C's paper tests have ended and
   no frozen test reads those books; the audit's counts and these measurements are reported with the freeze.
3. **The payouts change is deployed, on Davies' word.** Built and pinned on 2026-10-04 with every gate green, and kept
   off `main` as `docs/agents/pending/2026-10-04-mid-pool-payouts-per-path.patch` (Davies: "之后再部署吧…具体时间我来定，
   代码你先都存好"): it changes the live order path's code, so it reaches production only when he says so (its runs green,
   `agents` redeployed, mid-pool's next turns read without error). Deployed on or before 2026-10-16 it falls inside
   mid-pool's dry-run window (d2–d14) and is a deviation its readout names (it changes no dry-run decision: pinned);
   from 2026-10-17 00:00 UTC it is not.
4. **Mid-pool's dry-run readout** (`mid_readout.sql`, at or after 2026-10-17 00:10 UTC, its d15) has run and gone to
   Davies whole. Its dates assume the day-1 check passed; a failed check restarts the window by an addendum and moves
   them.
5. **Funding**: at least $400.00 of pUSD as the path reads it (`pm_mid_state.state.pusd`), so the cap is $320: about
   $402 of USDC on Polygon from Kraken to his polymarket.com deposit address, $5 first, then the rest (each transfer
   costs about 1 USDC of Kraken's fee). The account held 0.036673 on 2026-10-02 and on 2026-10-04.
6. **The probe from Ireland** (design step 2, operator): the key's address is the stored signer, the account is not
   closed-only, the geoblock's country is IE, the profile names the stored funder as its proxy wallet.
7. Recommended, his call (design step 3): the two pUSD spenders the order book does not use revoked.
8. **Health, within the last minutes**: `pm_mid_state` `keyed` true, `signerProblem` null, `sbRegion` eu-west-1, `pusd`
   read within five minutes, `last_error` null; no `agents.pm_mid` fault in the last hour that is not explained; the
   day's selection landed.
9. **Mini-pool unarmed** (`pm_live_config.live_confirmed_at` null) and in dry-run; the attestation current in
   `pm_mid_config` (`ireland_until` null or ahead).
10. **This file frozen**: the go date, the hashes and the readout script filled in by a commit before the first live
    minute.
11. Decided, either way: whether `pm_mid_state.updated_at` joins the production monitor's health readings while
    mid-pool is armed (CLAUDE.md asks it of a critical recurring job). A stalled loop leaves nothing resting past its
    GTD expiry, ten minutes, but nothing would alert that the loop stopped.
12. Decided, either way: whether the Agents page gets the live row the design doc describes ("The LIVE page row", not
    built) before the go. Until it does, mid-pool's page row is its paper layer's (`prepMid`), which stops at the first
    live turn, and the live record is read by query.

## The go-time statement

Step 8m, word for word, run once in the conversation where Davies says go:

    update public.pm_mid_config c
       set cap_total_usd = case when s.pusd is null or s.at is null or s.at < now() - interval '5 minutes'
                                     or s.keyed is not true or s.region is distinct from 'eu-west-1'
                                     or c.ireland_attested_at is null or c.ireland_attested_at > now()
                                     or (c.ireland_until is not null and c.ireland_until <= now())
                                     or exists (select 1 from public.pm_live_config o where o.live_confirmed_at is not null)
                                then null
                                else least(320, floor(s.pusd - c.loss_total_usd - 5)) end,
           dry_run = false, live_confirmed_at = now(), updated_at = now()
      from (select (state->>'pusd')::numeric as pusd, (state->>'at')::timestamptz as at, (state->>'keyed')::boolean as keyed,
                   state->>'sbRegion' as region from public.pm_mid_state where id = 1) s
     where c.id = 1;

Read back: `select dry_run, live_confirmed_at, cap_total_usd from public.pm_mid_config;` (false, the instant, 320). A
refusal reads as `cap_total_usd` null or under $1, or the trigger's message, and leaves the dry-run. Then the design
doc's first-day reads (steps 9–14) on `pm_mid_*` and `agents.pm_mid`, and Davies' confirmation of the first live order.

## The window and what it measures

**g0** is `pm_mid_config.live_confirmed_at`; **d1** the first full UTC day after it; the window is fourteen UTC days,
d1 00:00 → d15 00:00 UTC. The part-day from g0 to d1 is reported apart. Descriptive: no bar and no verdict; it arms,
raises or extends nothing. What follows it is Davies' decision.

The readout runs once, read-only, at or after d16 01:30 UTC (the path reads each day's payouts twice, the day after
and the day after that, for a late posting), and goes to Davies whole. One row for each day d1–d14, then the total:

- **R**: Σ (actual + sponsored) / Σ formula over `pm_mid_reward_days` rows of mode `live` that day, with the market-days
  and the formula; R over the venue-scored minutes only (`formula_scored_usd`), which tells "not paid" from "not
  scoring"; the maker rebates; per market, R against its rate, for a dependence on the pool's size.
- **The fills**: their count and their P&L on the day, realised and held, by the path's own book-keeping (`tokenBooks`,
  `bookPnl`, `settlementFills` of `pm_live.ts`) over `pm_mid_fills` (CONFIRMED) and `pm_mid_settlements`; the readout's
  script runs those functions, never a second implementation.
- **The day's result**: what was paid plus rebates plus the fills' P&L, in dollars, against the $320 cap.
- **The path**: minutes recorded, POSTs, refusals by reason, cancels carried out late (`cancelled_at` after
  `cancel_requested_at`), orders `pending` over two minutes, buys withheld by `cap_total`, `cap_market` or `collateral`,
  the loss stops, and the faults (`agents.pm_mid`).
- **Every deviation**, with its day: a deploy of `pm_live.ts`, `pm_prep.ts`, `pm_mid.ts` or a migration of mid-pool's
  tables; a day the readout did not read (missing, never zero); a stop; a kill switch.

Expected scale, as inference: 8 markets for 14 days is 112 market-days, the design doc's power table's last row (its
simulation's assumptions: 90 % half-width 0.074–0.238 at R = 1). The dry-run's formula ran about $25–$43 a day on
2026-10-02 and 10-03 (deviation 1's read); at R ≈ 0.4–1 that is about $10–$43 a day of rewards, before fills.

## Stops and kill switches

- **Automatic** (the path's own, as in the dry-run): at −$25 on the UTC day nothing opens until the next day; at −$75
  in all nothing opens again until a person clears the stop. Sells of what is held stay armed under both.
- `update public.pm_mid_config set live_confirmed_at = null where id = 1;` — nothing that opens; open buys withdrawn on
  the next turn; sells of what is held stay armed.
- `update public.pm_mid_config set dry_run = true where id = 1;` — back to dry-run; its live orders cancelled.
- `update public.agent_risk set global_pause = true where id = 1;` — every open order cancelled (one cancel-all, the
  account's) and nothing placed; it also stops the crypto loop and PR5.
- `PM_ORDER_SENDS_ENABLED = false` in code and a deploy: no order and no cancel can leave, so cancel first; what rests
  expires within ten minutes. It holds both paths.
- The attestation revoked, on his word that he is not in Ireland: `update public.pm_live_config set ireland_until =
  now() where id = 1;` and `update public.pm_mid_config set ireland_until = now() where id = 1;` — close-only.

## What stops it before the window ends

Each is reported to Davies the same day; only his word starts it again:

- the total loss stop (−$75), or the day stop on two days of the window;
- a live order `pending` for more than two minutes that its read-back does not settle, or a cancel the venue has not
  carried out by the next turn, on two turns of one day: `live_confirmed_at = null` and a report;
- the account found closed-only, the geoblock's country not IE, or the attestation revoked: the gates make it close-only
  by themselves; R from then would read zero;
- two consecutive days with live minutes the venue calls scoring and no payout at all: the Terms' exclusion from reward
  programmes is the named suspect;
- a live order in a market of RW's or RW-C's selection on the same UTC day, if the go date comes before 2026-10-23
  (below);
- Davies' word.

At the window's end: `live_confirmed_at = null`, then the day's markets left to expire; resolved markets redeemed on
polymarket.com; the balance moved out only if he wants.

## The earliest start, and what an earlier one accepts

Per mid-pool's dry-run pre-registration, a funded mid-pool comes after the overlap audit, which runs no earlier than
2026-10-23 00:05 UTC, and after a new measurement of the margin (done 2026-10-04, above). **So the earliest funded start
this draft proposes is after 2026-10-23 00:05 UTC**, once the audit's counts are read.

A go date before that is Davies' to choose, and accepts:

- **Real orders beside two frozen paper tests.** RW (to 2026-10-09 00:00 UTC) and RW-C (2026-10-09 → 10-23, warm-up from
  10-08) quote on paper in RW's universe, $10 a day and over, which holds mid-pool's band, and fill from the public
  prints. A live order of mid-pool's in a market of theirs sits in the book they read and its fills are prints they
  count: their tests would then be measuring a market we are in, which their pre-registrations did not provide for. At
  the margin of 0.67 one of mid-pool's eight picks was among RW's picks a few minutes later in 4 of 111 pairs measured
  on 2026-10-04 (none of 91 on 10-02, none of 57 at most two minutes apart in either); RW's, RW-C's and mid-pool's
  selections each try every five minutes until their day lands, so on a day one of them retries they are minutes apart.
  RW-C's verdict decides RW-NEXT's candidate.
- **The margin unchanged or a different rule.** Raising the margin to 0.8 (no overlap in any pair measured) protects
  them better, but it is not the dry-run's rule: it leaves out about twice as many of the band's markets (55 to 62 at
  each recomputation against 25 to 28 at 0.67 on 2026-10-04), so mid-pool would pick other markets than its dry-run
  picks, a rule never run.
- **Mid-pool's own dry-run cut short.** Armed on or before 2026-10-16 it is inside its pre-registered window: from that
  turn its paper layer has nothing to fill and the readout names the deviation; armed before its d15 the readout is
  read on fewer than fourteen paper days.

## What this does not test

RW's profitability or any RW arm's verdict; whether R on $10–$50 pools carries to other pools; Polymarket's rules beyond
the window. It is one account, one path armed at a time: RW-NEXT's live step, if RW-C passes, would need this account
too, and cannot run beside a live mid-pool.

## Risks, his accepted risks

As in the design doc: Polymarket's Terms bar UK and Irish residents ("THERE ARE NO EXCEPTIONS"), with close-only mode,
exclusion from reward programmes (read here as R ≈ 0) and termination as the named consequences; positions open only
from eu-west-1 under his standing Ireland attestation, never through a VPN, a proxy or anyone else's account; the key's
exposure bounded by the balance he chose; adverse selection, which gave back about 40 % of rewards on RW's paper, and
which a pool of $10–$50 may bring more of.

## Frozen files (filled at the freeze)

| file | sha256 |
|---|---|
| `supabase/functions/agents/pm_live.ts` | at the freeze (`effd6351…` on `main` since 2026-10-04's formula fix; `61b1d53f…81cb` with the payouts change) |
| `supabase/functions/agents/pm_prep.ts` | `ea3ee5b1…6dc9` (2026-10-04's formula fix; `8d7861ab…4dea` at mid-pool's pre-registration) |
| `supabase/functions/agents/pm_mid.ts` | at the freeze (`9fd37436…` on `main`; its comments change with the payouts change) |
| the readout's statement and script | written and pinned at the freeze |

## Disclosures before the freeze

- Mid-pool's deviation 1 (2026-10-03 23:36 UTC, on Davies' word): its 10-02 day row, d1's running figures, both days'
  selections as counts, rates and capital, and the share of its reward each market held, read before its day-1 check.
- Writing this draft (2026-10-04, 00:13–00:15 UTC) read only mid-pool's health readings (`pm_mid_state`'s `keyed`,
  `signerProblem`, `pusd`, `at`, `sbRegion`, `last_error`, `updated_at`; `pm_midprep_state`'s `last_error`,
  `updated_at`, `last_minute`; `ops_errors` of `agents.pm_mid` and `agents.pm_midprep` and their crash rows; a count of
  `pm_mid_markets` rows for 10-03 and 10-04), both configs' `dry_run`, `live_confirmed_at`, `ireland_attested_at` and
  `ireland_until`, `pm_live_state`'s `last_error` and `updated_at`, a count of `pm_live_markets` rows for 10-04, and the
  applied migrations' versions. Nothing of RW's, RW-C's or the RW-X arms'.
