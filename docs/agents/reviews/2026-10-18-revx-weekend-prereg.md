# Pre-registration: "Stablecoin quotes variant-3" (`take50wk`), variant-2 with PR5-W's weekend rule, on paper (2026-10-18)

**Status: FROZEN** at the commit that adds migration `0130`. Any later change is a deviation, written in §7 with its date and
reason. It changes nothing of variant-2 (`take50`, `2026-10-03-take-prereg.md`), of PR5-W (`2026-09-28-pr5-weekend-prereg.md`,
read 2026-11-25 as written) or of any other reading. It was drafted the same morning as a separate paper row against PR5's
paper engine (this file's first version, in the commit of the stablecoin quotes review, `29b95e41`); Davies then chose the base,
and this version replaces the draft.

## 0. On whose word

- Davies, 2026-10-18, verbatim: "我看coinbase周末表现不错要不要给revolut也加一个周末的策略测试" (should Revolut X get a weekend
  strategy test?); the review answered yes (`2026-10-18-stablecoin-quotes-review.md` §5).
- Davies, 2026-10-18, answering the review, verbatim: "加一个 Revolut 周末 paper 测试，在目前最好的variant-2基础上加，上线测试一下作为
  variant-3，目前的3改为4" (add a Revolut weekend paper test on top of the best current variant, variant-2, put it on as
  variant-3, and rename the current variant-3 to variant-4).
- This is a paper test on the twins' simulated account: no key, no order, no money.

## 1. The one change, and everything else equal

PR5's rule goes dark when its newest GBP/USD bar started more than ten minutes before the minute; Yahoo has none from Friday about
21:40 to Sunday about 23:00 UTC, so variant-2 quotes nothing all weekend. **The change is PR5-W's rule, exactly**: inside an FX
closure (Friday 21:00 → Sunday 21:00 UTC; 24 December 21:00 → 25 December 21:00; 31 December 21:00 → 1 January 21:00), a minute
whose GBP/USD is dark is decided on the last X the replica took on that book (its `lastX`: the last live X, or a stray live bar's);
from Sunday 21:00 until a live bar the minute is dark, as in PR5. The executor the twin runs reads fair at that X in those minutes
(`QuoteLiveInstance.weekend`), so its entry guards, exits and re-prices stand on the rate the replica decided on. Code:
`agents/quotes_weekend.ts` (the rule), `TWIN_RULES.weekend` (`agents/quotes_twin.ts`), `weekend` in `paperView`
(`agents/quotes_live.ts`).

| | variant-2 (`take50`) | variant-3 (`take50wk`) |
|---|---|---|
| a dark GBP/USD minute inside a closure | dark: entries withdrawn | decided on the book's last X, from 2026-10-23 21:00 UTC |
| rule otherwise | PR5's decisions carried out by the live executor's code on a simulated account, £50 a rung, three a side, TAKE's taker entry | the same, the same code |
| capital | £600 | £600 |
| start | 2026-09-23 15:09 (its backfill) | 2026-10-19 00:00 UTC, flat, no backfill (§4) |
| tables, lease | `agent_quote_twin_take50_*` | `agent_quote_twin_take50wk_*`, `quotes-twin-take50wk` |
| call | `agents?action=quotestwins` (0087, under the watchdog) | the same call, after variant-2 |

Its spec row, as `0130` inserts it:

```json
{ "id": "take50wk", "display_name": "Stablecoin quotes variant-3", "display_order": 35, "engine": "pr5", "capital_gbp": 600, "gov": "account", "start": "2026-10-19T00:00:00Z", "table_prefix": "agent_quote_twin_take50wk", "lease": "quotes-twin-take50wk", "rules": { "take": { "from": "2026-10-04T16:00:00Z" }, "weekend": { "from": "2026-10-23T21:00:00Z" } }, "backfill": null, "prereg": "docs/agents/reviews/2026-10-18-revx-weekend-prereg.md", "migration": "0130", "enabled": true }
```

`0130` also renames rule D's twin `d` "Stablecoin quotes variant-4" (its page name only; id, tables, record, order and rule stay).

**Its weekdays are variant-2's rule, minute for minute** (pinned in `quotes_twin.test.ts`: on a world where GBP/USD is live, or
before the rule's instant, the two twins write the same orders, turn for turn; `quotes_live_instance.test.ts`: an executor
instance with the rule, before its instant or in force on a weekday with GBP/USD dark for an hour, writes every table exactly as the
frozen executor does; `quotes_weekend.test.ts`: the closures and the three cases). Its replica is checked against PR5's
record (`paperCheck`) up to the rule's instant; from then its state is its own.

## 2. Why

The review's replay (`backtests/scq_review/2026-10-18/`, `results/weekends.json`; seen before this file, in sample): PR5's rule
with the rate held, against the same rule dark, weekend by weekend (trips entered from Friday 21:00 to the Monday 00:00 after):

| record | weekends | positive | sum ($100 a rung) | worst |
|---|---:|---:|---|---|
| committed tape, 2026-01-01 → 09-23 | 38 | 37 | +£112.69 | −£0.09 |
| the same, 2026-08-26 → 09-23 | 4 | 4 | +£3.05 | +£0.18 |
| PR5's own record, 09-26 → 10-18 | 4 (one partial) | 4 | +£6.59 (+£9.12 with prints at our price filling) | +£0.01 |

Revolut X's GBP books trade at weekends at about half the weekday pounds an hour, with wider touches and two to five times as many
prints beyond 20 bps of fair (review §5b). PR5-W reads the same rule offline on 2026-11-25 on PR5's paper simulator; this test runs
it forward through the live executor's code, on variant-2, the best Revolut X test row (review §2).

## 3. Window, reading and bar

- **Window.** Trips entered from **2026-10-23 21:00 UTC** (the rule's first minute, a closure's first) to **2026-11-23 00:00 UTC**:
  five whole weekends (10-23/25, 10-30/11-01, 11-06/08, 11-13/15, 11-20/22). A weekend is a Friday 21:00 → the Monday 00:00 after
  it, and a trip belongs to the weekend it entered in.
- **Reading.** On or after **2026-11-25 00:30 UTC**, after PR5-W's own reading of that day, never before it:
  `docs/agents/backtests/wk3/sql/export.sql` (SELECT only), then `wk3/scripts/read.ts` on it, both frozen below. Each twin's round
  trips are the page's own (`liveRungs`, `liveRungTrips`). Not blind (§6).
- **Bar** (all four must hold):
  1. **It ran the rule.** It sent entry orders on the Saturday or the Sunday before 21:00 of at least three of the five whole
     weekends. If not, the test is void (a fault), not failed.
  2. **Better than variant-2, weekend by weekend.** Variant-3's realised P&L less variant-2's, over trips entered in each whole
     weekend, is positive in all but at most one, and its sum is positive.
  3. **No bad reopen.** No whole weekend's difference is below −£1.50.
  4. **Not one weekend.** The best weekend's difference is at most 60 % of the sum.
- **Reported beside the bar, not in it:** each weekend's trips, stops, the trips that closed after the reopen and their P&L; the
  whole window's realised P&L of each twin (their weekdays are the same rule but not the same record: §4); the books apart;
  the unrealised marks at the reading.
- **What a pass allows:** the case for LIVE quoting at weekends (a pre-registered change of what LIVE carries out, at £10 a
  rung for four weekends first), on Davies' word alone. A fail: no weekend quoting on Revolut X from this test.
- **Until the reading, health only:** the call's beats, `agent_quote_twin_take50wk_sim.last_error`, its state's `updated_at`
  against PR5's call, and no `ops_errors` `agents.quotes_twins`; that it is caught up (mode `forward`) before 2026-10-23 21:00.
  Its trips may be read (no no-peek rule); a read before the reading is reported in it.

**Power.** Five weekends: if a weekend is better with probability 0.9 (37 of 38 on the tape), four of five hold with probability
0.92; if a coin toss, 0.19. The replay's weekend differences at £50 a rung are about £0.1 – £2.0; the floor (bar 3) is about the
cost of the largest Sunday gap PR5-W's series shows (54 bps) on half the rungs held.

## 4. Its record before now

None. It starts flat at 2026-10-19 00:00 UTC, as every twin starts, with the operator's maker conversions at its first turn. It
does not load a backfill: a twin catches up only in the minutes PR5's call left a beat, and `edge_call_beats` keeps about three
days, so a twin started from the committed backfill (to 2026-10-02 21:05) would wake on 10-15 or later holding two-week-old
positions to stop. So its weekday record is variant-2's rule but not variant-2's record: different positions and coins, the
same decisions for the same state. It must be caught up before 2026-10-23 21:00: `0130` deployed by 2026-10-22 gives it a
day or more. If it is deployed after the window opens, the weekends before its first whole one are reported, not judged, and
fewer than three whole weekends make the reading descriptive.

## 5. Frozen files

| file | sha256 |
|---|---|
| `supabase/migrations/0130_quote_twin_take50wk.sql` | 04996f560131ec254207270875f814858520fe79469a65342b873d4b69de0cf9 |
| `supabase/functions/agents/quotes_weekend.ts` | b811ca70b761f85ffa8c8ab00096cece8e06177763c64c2f8806985610d657a2 |
| `supabase/functions/agents/quotes_twin.ts` | fd4b6f992ea7c094c97759933fb714b49d81dcf60756dee18fee4860525a1524 |
| `supabase/functions/agents/revx_sim.ts` | 4b8f99e925f0ba6e05e188554e4b6bf8a43eead0aaec0b5d946a65664361f8aa |
| `docs/agents/backtests/wk3/scripts/read.ts` | b8e2fb24cb5db2783da09772e8c7ee20d21b7b4373469e03889440edfc86095a |
| `docs/agents/backtests/wk3/sql/export.sql` | 59f49220b8a424e6661dfd5f7075c8774ddbde590128e8a07ea36b88f13dda3f |

`src/weekend_twin.test.js` pins them. `agents/quotes_live.ts` is not frozen here: it is LIVE's executor and changes under its own
deviations; what this test needs of it (`weekend` in `paperView`, and nothing else when the instance has no rule) is pinned by
`quotes_live_instance.test.ts` and `quotes_twin.test.ts`, which every deploy runs. A change to a frozen file is a deviation (§7).

## 6. Disclosures before the freeze

- Every figure of §2 was seen, including PR5-W's first forward weekends (10-03/04, 10-10/11) replayed by its rule ahead of its
  2026-11-25 reading. PR5-W's reading is not changed by this file; its report should name the 2026-10-18 review as a non-blind read.
- Variant-2's record to 2026-10-18 was read (the review's §2: 6.59 bps of capital a weekday, the best Revolut X row). None of its
  weekend trips existed: it quotes nothing at weekends.
- The bars copy the Coinbase weekend test's shape (`2026-10-13-coinbase-weekend-prereg.md` bar 6); bar 3's −£1.50 was set after
  seeing that the worst of 46 replayed weekends was −£0.09 at $100 a rung.
- The reading is not blind.

## 7. Deviations

**Deviation 1 (2026-10-21): two frozen files change; this test does not.** Davies, 2026-10-21, on PR5's four-week review: "A，引擎也继续
运行，但要确保模拟的真实性和实盘策略完全一致，不一致的地方就直接改". The audit (`2026-10-21-sim-vs-live-audit.md`) found LIVE fills on prints AT
its price far more often than the twins' rule 1 allows; `revx_sim.ts` and `quotes_twin.ts` gain that as a twin rule, `fill`, and the
validation's replay of LIVE gains LIVE's operations (the twins' pre-registration's deviation 7, its §19). This twin's row names no
`fill` rule and has no replay, so it runs the code path it ran: its rule, window, reading and bars are unchanged. Its reading
should say that its fills, like every twin's, count no print at its own price, which undercounts LIVE's (the audit's figures).

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_twin.ts` | 36092d7f506565d5c89d11ea389d569e2106f738768d1a7450f4e3e39595c3d7 |
| `supabase/functions/agents/revx_sim.ts` | 7f05baba5a1a066166791e184ddac505bcd692865864dd219172d4c87569cc47 |

§5 keeps the hashes they were frozen at; this table names them from this deviation on (`src/weekend_twin.test.js`).

**Deviation 2 (2026-10-27): `quotes_twin.ts` gains PR5-OPT's rules; this test does not change.** Davies, 2026-10-27: "…还有哪些可以值得研究和测试的地方（比如每个%不同的档挂单钱数不同？不同的档位%？不同的细分rules等等）". The
study (`2026-10-27-pr5-rules-optimisation.md`) recommended three twins on LIVE's rules, built by `0148`
(`2026-10-27-pr5-opt-twins-prereg.md`). For them `quotes_twin.ts` gains two rules, `weights` and `holdMin`, and sizes a twin's start
conversions by `convertCapGbp`, which is a quarter of the capital for every twin without `weights`; `quotes_live.ts` gains the two
instance options they set, absent on the live account's instance and on every twin before `0148`. **This test is not changed**:
its row names neither rule, so it runs the code path it ran (pinned in `quotes_live_instance.test.ts`: the executor with each
option absent, before its instant, and at its neutral setting is the frozen executor, turn by turn). Its window, reading and bar
are as written. Not blind.

| file | sha256 |
|---|---|
| `supabase/functions/agents/quotes_twin.ts` | 015f3af08ba852c372e6b0a9f9d6815999731bd3322e03c8b5f944cdac8f4544 |

§5 and deviation 1 keep the hashes the file had before; this table names it from this deviation on (`src/weekend_twin.test.js`).
