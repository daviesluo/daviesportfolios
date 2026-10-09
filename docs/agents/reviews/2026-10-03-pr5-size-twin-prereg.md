# Pre-registration: "Stablecoin quotes variant-1", PR5's rule on its realistic twin at £50 a rung

Written 2026-10-03 (UTC) from `TEMPLATE-variant-prereg.md`. Frozen by the commit that adds it, before any minute of its
forward window (§3) and before the twin's first turn in production. Any change after the freeze is a deviation and is
reported as one, here, in an addendum, and in the ledger.

## 0. On whose word

Davies asked for a study of what each stablecoin rung makes at the twins' sizes, after penny rounding ("…看每一档…经过便士
取整后的真实盈亏…这个到时候你再研究下，不要忘了"; asked again, "之前说的这事你忘了？"), and for the next numbered variant to be
launched if the data point to a change worth testing; he has given standing approval to launch the variants a study
recommends. The study is committed: reference §4 item 51, its addendum of 2026-10-03, and `docs/agents/backtests/twins/size/`
(`study.ts`, `results.json`, `MANIFEST.json`). It proposed this twin. On its name, 2026-10-03: "你目前正在做的variant改名为
variant-1排上面，这个新的是variant-2，原来的variant-1改名为variant-3" (variant-2 is kept for a later twin); on its form, the same
day, "你说的这四点建议全做": a variant is a row of `agent_quote_twin_specs`, and this is the first made that way.

## 1. What differs from its base

Its base is "Stablecoin quotes" (`pr5`, `2026-10-02-pr5-realistic-twins-prereg.md` §1 to §4): the live executor's own
code (`quotes_live.ts`) on a simulated Revolut X account (`revx_sim.ts`), carrying out PR5's paper decisions
(`stepMinute`, `quotes.ts`) from a replica of PR5's engine at PR5's timing, its asks' coin bought by the operator's maker
conversions. Only its size differs:

| | "Stablecoin quotes" (`pr5`) | "Stablecoin quotes variant-1" (`p50`) |
|---|---|---|
| decisions of | PR5's paper engine | the same engine, the same decisions |
| rungs | 0.1, 0.2, 0.3 % a side of each book: 12 | the same 12 |
| capital | £1,200: £100 a rung | £600: £50 a rung (£300 for the bids, £150 of each coin for its asks) |
| governed keys | one (`account`), 900 / 950 POSTs a day | the same |
| daily loss stop | 1 %, £12 | 1 %, £6 |
| from | 2026-09-23 15:09 UTC (PR5's first decided minute) | the same minute, so the two records cover the same minutes |
| on the page | first of the stablecoin rows | second, above "Stablecoin quotes variant-3" (rule D's twin) |

Its spec row, as 0088 inserts it (`quotes_twin.ts`' seed rows carry the same, `src/twin_specs.test.js` holds them equal):

```json
{ "id": "p50", "display_name": "Stablecoin quotes variant-1", "display_order": 20, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-09-23T15:09:00Z", "table_prefix": "agent_quote_twin_p50", "lease": "quotes-twin-p50", "rules": null, "backfill": { "file": "docs/agents/backtests/twins/p50.json.gz", "sha256": "f94c9ebecb6a757498fa39f25a2e9907c4e0e4a00f008a16dda17f25335a7bc8", "until": "2026-10-02T21:05:00.000Z" }, "prereg": "docs/agents/reviews/2026-10-03-pr5-size-twin-prereg.md", "migration": "0088", "enabled": true }
```

Its tables are 0087's template for one more id (`create_quote_twin_tables('p50')`); 0087's call,
`agents?action=quotestwins`, runs it between the other two; no call is added. That the twins became rows is the twins'
pre-registration's deviation 1 (its §12).

## 2. Why

1. **The size effect, forward.** The study found that PR5's rule, carried out by its twin, keeps 14–15 bps a round trip
   at every rung size and makes fewer trips as the rungs grow (with the capital exactly twelve rungs the top-ups leave the
   bids short of pounds, and a bigger exit takes longer to fill through the prints). That was measured on the span the
   proposal was made from. From here the £100 twin and this £50 twin carry out the same decisions on the same prints in
   the same minutes, so what differs between their records is what size does.
2. **PR5's rule at rule D's rung size.** After rule D's reading (2026-10-28), rule D's twin (£50 a rung, nine a side) can
   be set beside PR5's rule at the same £50 a rung, instead of across two sizes.

## 3. Window, reading and bar

**The expectation, in sample.** The study's run `s50` (PR5's rule on its twin at £600, on the twins' committed inputs,
2026-09-23 15:10 → 2026-10-02 21:05 UTC) is this twin's record to 2026-10-02 21:05 (§4 checks it figure for figure):
**57 round trips, 53 won, realised +£3.9040**, 14.61 bps a trip, +£0.4222 a day, 25.68 % a year on its £600 (realised
only; the asks' coins not marked), 3,360 orders written and 3,310 sent. Beside it the £100 twin (`s100`, the committed
`pr5.json.gz`): 47, 44, +£6.0476, 14.12 bps, 19.89 % a year. Per rung (trips · won · realised):

| rung | £50 (`s50`, this twin) | £100 (`s100`, "Stablecoin quotes") |
|---|---|---|
| USDC bid 0.1 % | 12 · 12 · +£0.7569 | 8 · 8 · +£0.9896 |
| USDC bid 0.2 % | 3 · 3 · +£0.3788 | 3 · 3 · +£0.6258 |
| USDC bid 0.3 % | 0 | 0 |
| USDC ask 0.1 % | 2 · 0 · −£0.0295 | 1 · 0 · −£0.0397 |
| USDC ask 0.2 % | 1 · 1 · +£0.0264 | 1 · 1 · +£0.0450 |
| USDC ask 0.3 % | 0 | 0 |
| USDT bid 0.1 % | 12 · 10 · +£0.5073 | 11 · 9 · +£0.5410 |
| USDT bid 0.2 % | 9 · 9 · +£0.9061 | 8 · 8 · +£1.4263 |
| USDT bid 0.3 % | 6 · 6 · +£0.8137 | 5 · 5 · +£1.5556 |
| USDT ask 0.1 % | 10 · 10 · +£0.3655 (66.21 USDT held) | 8 · 8 · +£0.5467 (132.42 USDT held) |
| USDT ask 0.2 % | 2 · 2 · +£0.1786 | 2 · 2 · +£0.3573 |
| USDT ask 0.3 % | 0 | 0 |
| all | 57 · 53 · +£3.9040 | 47 · 44 · +£6.0476 |

These are in sample: 2026-09-23 → 10-02 is the span the proposal was made from, so they are what is expected, not
evidence. The direction the study found, more round trips at £50 than at £100 and more realised per pound of capital, is
the expectation for the window.

**Bar: descriptive.** Nothing is decided by this twin, and no pass or fail bar is set: it measures, and a bar set later
would be a new pre-registration. A forward readout against the expectation is reported as that, and nothing is changed
for it.

**The window** is the round trips that close (their last fill) at or after **2026-10-04 00:00 UTC**, after this freeze:
from 2026-10-02 21:29 UTC GBP/USD is dark until Sunday evening, so the executors send no entry until then, and anything
either twin closes between the backfill's end (2026-10-02 21:05) and 2026-10-04 00:00 is reported apart, in neither the
window nor the sample.

- **2026-10-21, beside PR5's verdict** (and beside "Stablecoin quotes"' own readout, the twins' pre-registration §9): for
  each rung, this twin and "Stablecoin quotes" over the window to 2026-10-21 00:00 UTC: round trips, won, realised, fees,
  realised per pound of the rung (bps of what the trips traded), and what each holds at the end; the totals, and realised
  as a share of each one's capital. The size effect is the difference per rung and in total, per pound. For each trip one
  twin made and the other did not, its reason in the words of the twins' pre-registration §8 (pounds short for a bid, a
  rung still holding, an entry no print went through, an ask without coin, a re-price at a different turn). Each twin's
  whole record from 2026-09-23 is given beside it, the sample marked as such.
- **After rule D's reading is written** (on or after 2026-10-28): "Stablecoin quotes variant-3" (rule D's twin, £50 a
  rung, nine a side) and this twin (£50 a rung, three a side) over the window to 2026-10-28 00:00 UTC: per rung at the
  three rungs both quote (0.1, 0.2 and 0.3 %), and in total per pound of capital. Not before: rule D's twin's figures are
  not read before its reading (its pre-registration and the twins' §9).
- **Every day until then, health only**: `agent_quote_twin_p50_sim.last_error` empty; its `state->'paperCheck'->'mismatches'`
  46 (the replica is PR5's twin's, whose 46 differences all lie before 2026-09-24 18:13, where PR5's minute records did not
  exist); its mode `forward` once caught up and `agent_quote_twin_p50_state.updated_at` within ~3 min of PR5's call; the
  call's beats in `edge_call_beats`; no `ops_errors` `agents.quotes_twins`; no row of any twin in
  `agent_quote_live_orders`. Its trips and P&L are not analysed before 2026-10-21; its page is Davies'.

Every twin's decisions are PR5's paper engine's: if that engine stops (its own verdict is 2026-10-21, and keeping it
running is then put to Davies), every twin stops with it, the windows end there, and the readouts say so.

## 4. Its record before now (the backfill)

`docs/agents/backtests/twins/p50.json.gz` is this twin's record from PR5's first minute to 2026-10-02 21:05:00 UTC, built by
`docs/agents/backtests/twins/scripts/backfill.ts p50` (its spec row read from the migrations by `spec_rows.ts`), the
production code in the in-memory database that holds the schema's checks, on the twins' committed inputs
(`inputs/twins_inputs.json.gz`, the twins' pre-registration §6): 13,198 turns (2026-09-23 15:10:25 → 2026-10-02
21:05:25), 3,360 orders, 248 events, 285,094 bytes; built again on the final code, it wrote the same bytes. The production
call's first run after the deploy loads it from the repository's `main`, checked against the sha256 its row pins, with no
turn of this twin in that call (the other twins turn in it), then catches up turn by turn (about twenty a call) and turns
forward with PR5's call.

Summed as the study sums its runs (`liveRungs`, `liveRungTrips`), it is the study's `s50` run in every figure the study
recorded: 57 trips, 53 won, realised +£3.9040, penny cost £0.0649, 14.61 bps a trip, 3,360 orders written and 3,310 sent,
the same six conversion fills and the same final balances, and each of the twelve rungs' lines. Its replica check: 3,751
events, 46 differences, the first `replica only 2026-09-23T21:48:00.000Z|USDT-GBP|ask|0.001|order|7552`: PR5's twin's own.

## 5. Frozen files

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_twin.ts` | f14ecee87da252b9135dbeebcdcfd1dfa3f33c4a945c7b5b830cc2c37a61d7a8 |
| `supabase/functions/agents/revx_sim.ts` | 885def181e01899095745c7c1128a3dee06e11f960965ec439cc7a50642fcd48 |
| `supabase/migrations/0088_quote_twin_specs.sql` | d2e6d158a182f2fc4c52fd9ce6e10147e2061dfa4338ab2fbad4755968cb4609 |
| `docs/agents/backtests/twins/p50.json.gz` | f94c9ebecb6a757498fa39f25a2e9907c4e0e4a00f008a16dda17f25335a7bc8 |
| `docs/agents/backtests/twins/scripts/backfill.ts` | 0b29109946f664c5785e943da05edc5fed79cea8151d616e041a7c1254391d98 |
| `docs/agents/backtests/twins/scripts/spec_rows.ts` | b592f05fdc898c381348c613d18e0200f5c808f8833528af30219f264bf968bc |
| `docs/agents/backtests/twins/inputs/twins_inputs.json.gz` | f9ff04901d1b787d55401dac49d7d9be2e6d6b30d997a1ce856cea165e8dffa3 |
| `docs/agents/backtests/twins/size/results.json` | f4a17a4c940b986465179895516a3b6091a379e8811982e0767c7ea88cada94e |

`quotes_live.ts` is not frozen: it is the live executor, and a change to it is a change to every twin, as the twins'
pre-registration says. A change to a frozen file is a deviation (`src/size_twin_prereg.test.js` pins these hashes), and a
change to `quotes_twin.ts` is one of the twins' pre-registration as well.

## 6. Disclosures before the freeze

- Rule D's twin was not run, queried or read: its backfill was not built again, and no figure of its fills, trips,
  prices or P&L was seen. PR5V's and rule D's paper results were not read.
- Read for the proposal: the size study's figures (above). Read to size the call: production's function logs for
  `agents?action=quotestwins` (`execution_time_ms` only) and, from its responses of 2026-10-02 22:07–23:27 UTC, the PR5
  twin's own element (its mode, turns and last turn; selected by its id, nothing of the other twin's).

## 7. Deviation 1 (2026-10-03): the driver and the simulated account gain TAKE's rule

"Stablecoin quotes variant-2" (`take50`, `0089`, `2026-10-03-take-prereg.md`) is this twin with a taker entry from
2026-10-05, and its code changed two files §5 froze, `quotes_twin.ts` and `revx_sim.ts` (the twins' pre-registration's
deviation 2 says how). This twin is not changed by it: its row names no rule, so it runs the code path it ran, and
`p50.json.gz` built again on the new code is the same bytes (f94c9ebecb6a757498fa39f25a2e9907c4e0e4a00f008a16dda17f25335a7bc8).
In the call it turns before variant-2. Variant-2's record is this twin's before 2026-10-05 (its pre-registration's check
K1), so this twin is its base as well; nothing of this twin's own readout changes.

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_twin.ts` | d13b3eebce3dd3e89d8707e7373597b73d7127c5d5692fc36b6fcebe1d1dac0a |
| `supabase/functions/agents/revx_sim.ts` | 4b8f99e925f0ba6e05e188554e4b6bf8a43eead0aaec0b5d946a65664361f8aa |

§5 keeps the hashes the files were frozen at; this table names them from this deviation on (`src/size_twin_prereg.test.js`
pins both).

## 8. Deviation 2 (2026-10-09): a buy-back at the venue's minimum buys what its whole penny buys (F1)

Davies, 2026-10-09, verbatim: "修复 F1，应用所有tablecoin quotes包括live的" (fix F1 on every Stablecoin quotes row, LIVE
included). The live executor's `pennyExit` (`quotes_live.ts`, not frozen here: it is every twin's) now sizes a buy-back
worth £0.10–£0.11, which it cannot trim under the venue's minimum, to what its whole penny buys instead of paying that
penny for a hair under it; the twins' pre-registration's deviation 3 (its §14) says exactly what changed. No file §5 or §7
froze changes, and `p50.json.gz` holds no such exit (dust prints begin 2026-10-08). This twin met five such buy-backs
on 10-08 and 10-09 (£0.0351 of pennies in all, the review's `dust_exit.json`); the 10-21 readout says how many came
before and after the deploy. Not blind: written after the 2026-10-09 review read this twin's records.

## 9. Deviation 3 (2026-10-09): the driver gains rule D's twin's retired rung

Rule D's twin stops quoting its 0.03 % rung from 2026-10-10 (Davies, 2026-10-09: "…"规则 D 最内层的档位基本不赚钱"这个档删了";
the twins' pre-registration's deviation 4, its §15), and the code that says so changed `quotes_twin.ts`, a file §5 froze.
This twin is not changed by it: its engine retires no rung, so it runs the code path it ran; nothing of its readout
changes. Not blind (written after the 2026-10-09 review).

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_twin.ts` | 92c7d0db86dffc2b86650f99055e676902dc12ee905a89926771ee43d2329712 |

§5 and §7 keep the hashes the file had before; this table names it from this deviation on (`src/size_twin_prereg.test.js`).
