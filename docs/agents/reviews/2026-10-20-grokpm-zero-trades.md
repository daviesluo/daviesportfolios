# GROKPM after three and a half days: zero trades, and whether the rules are too strict (2026-10-20)

Davies, 2026-10-20: "The Polymarket analyst live strategy hasn't placed a single order so far. Are the criteria too
strict? Do a retrospective study." This review reads the record from the go (2026-10-17 02:39:14 UTC) to 2026-10-20
16:00 UTC: read-only SQL over the `grokpm_*` tables, the agent's desk ledger (`GROKPM_LEDGER.md` on the
`grokpm-ledger` branch), and keyless public Polymarket reads. Nothing was ordered, armed or disarmed. The study's scripts,
data and outputs are in `docs/agents/backtests/grokpm_zero/`; the frozen rules are
`reviews/2026-10-15-grokpm-prereg.md` (D1–D6). The only money figure here is the test's $100 budget.

## 1. Headline

- **Neither the server nor any rule a machine checks has been binding: the agent has never asked for an order.** There
  have been 448 requests to `grokpm` since the go. 417 were answered 200. 31 were refused, and none of them was an order:
  - 30 were market reads on 10-18 with a malformed id;
  - 1 was a cycle row stamped more than 10 minutes in the future.

  The 169 journal decisions are all `no_action`, and 0 orders exist. The 169 cycles split into 21 full and 148 light,
  about 47 a day, with every full scan on schedule.
- **What stops it is the agent applying the frozen §2 bars to itself.**
  - Every B candidate it priced was under the 12-point bar: 19 candidates carry a stated p, with gaps of 3.5 to 10.1
    points.
  - The only gaps of 12 or more were in books §2 forbids as thin: three markets with gaps of 11 to 15.5 points.
  - Every A confirmation it saw was already priced: 6 of 6 sat at 0.96 to 0.9995 when the source confirmed.
- **The near misses say the bars protected the money.**
  - Of the 9 candidates that have resolved or are all but resolved, the side the agent's p favoured won 3.
  - Its Brier on them is worse than the market's: 0.136 against 0.106.
  - With the B bar at 10 it would have made 2 trades and lost $7.49.
  - At 8: 3 trades, −$10.59.
  - At 5: 6 trades, −$13.18.

  Every one of those bids would have filled: the public price traded through it within 9 to 84 minutes. The cost
  is only that it lowers the bar for candidates the agent itself judged below it, and fees would be 0, since a resting
  buy is a maker.
- **Base rates: the bar between 5 and 12 points barely changes the room. What would change it is the agent's skill.**
  - On resolved low-attention markets, 23 to 46 % sat at least 12 points from their outcome 24 hours before the close,
    and lowering the bar to 5 points adds only 3 to 3.5 points of share (26 to 49 %).
  - The share of markets mispriced in hindsight does not depend on the bar. What a bar selects is how sure the agent
    must be.
- **Recommendation: keep the frozen bars and the money rules, and add no new risk.** Propose D7, a shadow forecast, so
  the test still produces a readable answer:
  - the agent journals p and m for every candidate it researches;
  - the reading adds a Brier comparison of those forecasts, reported beside the frozen bar and not replacing it.

  Without it, zero trades by 11-14 means the pre-registered reading has nothing to read. Section 6 has the details.

## 2. The funnel: where every candidate stopped

The candidates are read from the 21 full-scan decisions and the desk ledger's log. Each full scan read about 2,100 Gamma
markets ending within 30 days; most rescans were the same few hundred markets. After the agent's filters, 98 to 830 were
left, mainly sports, weather, crypto and spread filters. Counted once per market or daily series:

| where it stopped | rule or reason | markets | examples (the agent's words) |
|---|---|---:|---|
| **B under the 12-point bar** | §2 B, D3 `edge` | 24 | "my p Fry about 0.52-0.55 vs 0.59: under 12 points"; "Allyson ~0.62 vs 0.535: under 12 pts"; "UMich… about 0.55 vs 0.46/0.49" |
| **Thin or wide book** | §2 thin (spread > 5 or < $500 bid in 5 points), D2 `thin` | 20 | "Wildwood… a NO edge of roughly 12-17 points… but the NO side has only $29 bid depth… forbidden"; "Surrey, Prince George, Saanich… spreads 12-75 points" |
| **A not confirmed** (or contested resolution) | §2 A | 13 | Kyiv daily strikes ("no official… confirmation"); Saudi/Houthi dailies ("reported only by Houthi sources… resolution is contested"); Paris curfew ("minors-only would not count") |
| **A confirmed but already priced** | §2 A, 8 points of lag | 6 | China Q3 GDP at 0.9995; Lille curfew at 0.987; Kyiv 18 Oct at 0.99; Vancouver (Fry) at 0.934/0.979; the 18 Oct earthquake at about 0.985; the Paris curfew series resolved at 0.99+ |
| **High attention, no researched edge** | §2 B "low-attention" (the agent's call) | 8 | Doerkson as BC Premier, the Fed, Brazil, Israel and the ceasefire, Musk and Trump post counts, earnings beats |
| **Favourite at 0.90 or above, outside A** | §2 `favourite` | 6 | Alberta NO, Whalefall under 8M, Romania PM, the Israel election at 0.918, a Rotten Tomatoes ≥ 99 at 0.94, Amazonas |
| **May run past 30 days, or unresolvable** | §2 horizon | 2 | the Sweden PM and Sachsen-Anhalt government markets |
| **Live sports** | §2 | 1 series | exact-score markets |

The 24 B rows include the 19 with a stated p, which are listed in section 3. The other five were judged "fair" or as
having "no basis" without a number.

**Nothing stopped at the server.** No candidate reached `?action=order`. So the machine checks of D2 and D3, the
quarter-Kelly cap, the two-resting-order discipline and the 150 orders a day never came into play. The constraint is the
§2 rulebook as the agent applies it, and it applied it correctly in every case read.

## 3. Near misses: every candidate with a stated p

Source: `scripts/near_misses.py` (`results/near_misses.txt`).
- **Gap:** p minus the mid of the side bought, which is D3's measure for a bid at or under the mid.
- **Outcomes:** Gamma, read 2026-10-20 16:2x UTC. A `*` marks a count that is all but final (Alberta's official count is
  due 29 Oct).

| decision (UTC) | market | side | p | mid | gap | thin | outcome |
|---|---|---|---:|---:|---:|---|---|
| 10-17 04:16 | China Q3 GDP 4.3-4.6 % | YES | 0.775 | 0.735 | 4.0 | | won |
| 10-17 04:16 | Vancouver mayor: Fry | NO | 0.465 | 0.410 | 5.5 | | lost |
| 10-17 04:16 | Serbia PM: Vucic | YES | 0.700 | 0.665 | 3.5 | | open |
| 10-17 08:14 | Vancouver mayor: Sim | YES | 0.480 | 0.415 | 6.5 | | lost |
| 10-17 08:14 | Israel election as scheduled | YES | 0.950 | 0.885 | 6.5 | | open |
| 10-17 12:11 | Alberta Remain margin 20-40 | YES | 0.295 | 0.195 | **10.0** | | lost* |
| 10-17 12:11 | Alberta Remain margin 40-60 | YES | 0.600 | 0.545 | 5.5 | | won* |
| 10-17 12:11 | Street Fighter weekend 30-35 M | NO | 0.525 | 0.424 | **10.1** | | lost |
| 10-17 12:11 | Street Fighter weekend 27-30 M | YES | 0.400 | 0.315 | **8.5** | | lost |
| 10-17 12:11 | Sense and Sensibility weekend 5-6 M | YES | 0.200 | 0.090 | 11.0 | thin | lost |
| 10-18 08:24 | GitHub longest critical incident 3-6 h | YES | 0.740 | 0.690 | 5.0 | | open |
| 10-19 00:16 | Biggest earthquake 18 Oct under 5.3 (an A check) | YES | 0.940 | 0.900 | 4.0 | thin | won |
| 10-19 08:18 | Tocantins governor: Dorinha | YES | 0.300 | 0.225 | 7.5 | | open (25 Oct) |
| 10-19 08:18 | Rio Grande do Norte governor: Allyson | YES | 0.620 | 0.535 | **8.5** | | open (25 Oct) |
| 10-19 20:09 | Martin mayor: Uhercik | YES | 0.475 | 0.440 | 3.5 | | open (24 Oct) |
| 10-19 20:09 | Pickering mayor: Ashe | YES | 0.800 | 0.730 | 7.0 | | open (26 Oct) |
| 10-20 00:11 | Wildwood Rotten Tomatoes ≥ 96 | NO | 0.275 | 0.120 | 15.5 | thin | open (26 Oct) |
| 10-20 08:19 | Alberta: Leave wins any division | NO | 0.575 | 0.430 | 14.5 | thin | open; by 12:12 the agent's own p had moved to the mid |
| 10-20 12:12 | UMich October final 46.0-48.9 | YES | 0.550 | 0.475 | 7.5 | | open (23 Oct) |

**On the 9 resolved:**
- The agent's side won 3.
- Brier on the YES probabilities: agent 0.1359 against market 0.1059. The market was better.
- Where the agent leaned against the price, the price was usually right: Street Fighter's 30-35M bracket won, and both
  Alberta brackets settled where the polls' central reading put them, not where the agent's adjustment did.

**Counterfactual P&L at the server's sizing.** The server's sizing is a quarter Kelly of $100 at the mid, capped at $10.
Thin books stay forbidden.

| B bar | resolved trades | P&L |
|---|---:|---:|
| 12 (frozen) | 0 | $0.00 |
| 10 | 2 (Alberta 20-40, Street Fighter 30-35 NO) | −$7.49 |
| 8 | 3 (+ Street Fighter 27-30) | −$10.59 |
| 5 | 6 | −$13.18 |

**Fill realism.** I read the public price series and the data API's taker trades for the four rows that clear 8 points.
A post-only bid one tick under the mid would have filled:

| row | traded through the bid within | taker sells at or under it afterwards |
|---|---|---|
| Alberta 20-40 YES | 29 min | 7,742 shares |
| Street Fighter 30-35 NO | 84 min (needs one re-placement at the 35-minute expiry) | 787 shares |
| Street Fighter 27-30 YES | 9 min | 488 shares |
| Rio Grande do Norte YES (still open) | 2.5 h | 990 shares |

The losers fill fastest. That is the adverse selection PMPOST measured, and it would be no different here. Fees: 0 (a
resting buy is a maker; the counterfactual sells nothing before resolution).

Lowering A to 5 or 6 points would have added nothing:
- the earthquake case had a 4-point gap and a book of about $41;
- the other five A confirmations had lags of 0.05 to 4 points.

## 4. Is it the rules or the agent?

- **Not the server.** No limit was reached: 0 orders against 150 a day, cash $100 against the $30 floor, 0 markets
  against 6. No order was ever refused, because none was ever asked for.
- **A is close to impossible on Grok's clock, not because of the 8 points.**
  - In all six confirmations it saw, the book had moved before the agent did. The market reads the same official sources
    within minutes.
  - On resolved markets the winner did spend 30 minutes or more at a gap of 8 to 20 points in its last 24 hours in 24 to
    29 % of low-attention markets (4.7 to 6.3 a day). But the data cannot say whether the outcome was confirmed during
    that stretch; in the agent's six cases it was not.
  - The cadence study's point stands: half of all final approaches finish within about an hour. A wake every 30 minutes
    sees confirmations, not lags.
- **B: the 12 points plus "quiet market" plus Grok's latency rarely clears, and the evidence above says it should not.**
  - The agent's sub-threshold edges had negative value on the 9 that have resolved.
  - The ≥ 12-point gaps it found were all in thin books, where §2's rule exists because the other side knows more.
  - Price-level stability (cadence study §7.3) means a 4-hour scan is not what makes B miss: a low-attention price moves
    12 points within 4 hours from only 8 % of moments.
- **The agent's own caution beyond the rules is small and reasoned.** It counted contested or attribution-risk
  resolutions (the Saudi and Houthi dailies, minors-only curfews) as not confirmed, as the rules' text requires; none
  of those calls has been shown wrong.
- **One process note.** The 30 malformed market reads on 10-18 are the agent's tool sending an id that was not a lower-case
  condition id or a decimal token. They cost nothing.

## 5. Base rates (public data; hindsight is not edge)

Source: `scripts/base_rates.py`, run on two samples.
- **The cadence study's own pull:** markets closed 2026-08-15 to 10-15, 200 per stratum, 7 days of five-minute prices
  (`results/base_rates_cadence_sample.txt`).
- **A fresh pull of the week closed 2026-10-13 to 10-20:** every low (115) and high (76) attention market, 200 thin, 4 days
  of prices (`scripts/fetch_week.py`, `results/base_rates_week.txt`).
- **The categories:** the cadence study's tags (politics, economy, world, tech, geopolitics), excluding sports, crypto
  and weather.

| low-attention ($10k-$50k), winner's gap N h before close, price 0.05-0.90 | ≥ 5 pts | ≥ 8 | ≥ 10 | ≥ 12 | a day |
|---|---:|---:|---:|---:|---:|
| 61-day sample, 24 h | 25.6 % | 25.6 % | 25.6 % | 22.6 % | 6.0-6.8 |
| 61-day sample, 4 h | 8.5 % | 8.5 % | 8.5 % | 7.5 % | 2.0-2.3 |
| week of 10-13, 24 h | 49.1 % | 49.1 % | 49.1 % | 45.6 % | 7.5-8.1 |
| week of 10-13, 4 h | 23.5 % | 23.5 % | 23.5 % | 21.7 % | 3.6-3.9 |
| either sample, 1 h | ≤ 0.9 % | | | | ≤ 0.1 |

- **What this says:** a few low-attention markets a day still carry a large gap to their outcome 4 to 24 hours out, and
  that count is almost the same whether the bar is 5 or 12 points. Markets are either near-settled or genuinely
  uncertain, with little in between.
- **What it does not say:** whether anyone could have known the side. That is the agent's p, and section 3 says its p
  was worse than the price on the cases it priced.
- **Calibration.** At 24 hours, low-attention YES priced 0.20-0.80 behaves differently in the two samples:
  - it won 20 % against a mean price of 0.36 in the 61-day sample (n 25);
  - it won 72 % against 0.49 in the week (n 36), with the same sign in each 10-point bucket of the week.

  The signs are opposite, and both samples are clustered (one event's brackets resolve together), so there is no stable
  mispricing to aim a looser rule at (`results/pooled_calibration.txt`).
- **Limits.**
  - The close is Gamma's `closedTime`, often hours after the event, so "1 h before close" is mostly post-event.
  - The CLOB's price history is a mid-like series, not an executable book.
  - One week is one week.
  - The opportunity counts are an upper bound for a perfect forecaster.

## 6. Recommendation

1. **Keep the money rules as frozen:** A 8, B 12, thin, favourite and longshot, the caps, the stops and the cadence.
   - Looser B bars lost on every resolved case: B10 −$7.49 on 2 trades, B8 −$10.59 on 3, in 3.5 days.
   - At B8's pace the −$30 stop would be reached in about 10 days.
   - Looser A adds nothing.
   - A looser thin rule would buy exactly the books PMPOST lost to.
   - A faster full scan (for example every 2 hours) changes neither A, which is already priced at confirmation, nor B,
     whose prices stand for hours.
   - On the evidence of 9 resolved cases (few, so weak), the agent's sub-threshold p is worse than the market's. Lowering
     the bar would buy trades at a negative edge.
2. **The cost of keeping them: the reading may have nothing to read.**
   - At 0 entries in 3.5 days, the expected count by 11-14 is about 0 to 3. §6's P&L and Brier bar then report "no
     entries", which answers H1 only as "no edge clearing the frozen bars was found".
   - That is a real result, but a thin one.
   - D7 below makes the second question, whether its probabilities beat the market's, readable without risking a dollar.
3. **D7, drafted, for Davies' word only.** Shadow forecasts, a reading added and no rule changed:
   - **What the agent does:** for every candidate it researches to a number, it journals a `no_action` decision carrying
     `market_id`, `token_id`, `p` (formed before the price), `m` (the mid it read), `category` (the one it was testing)
     and `reason`. The journal already accepts these fields on a `no_action` row (`ingest.ts`), so no code changes.
   - **What the reading adds:** at the end, besides §6's frozen bar, a secondary Brier comparison of these shadow
     forecasts (agent p against market m) on every one whose market has resolved:
     - the market's m is the agent's own (no record mid exists for an unbought token);
     - each market is counted once, at its first shadow forecast;
     - the same paired bootstrap as §6.2 is used.
   - **What it is not:** it is not a bar. Continuing still needs §6's two conditions on real entries. It tells Davies
     whether a later, looser test could be worth pre-registering.
   - **Expected volume:** about 5 shadow forecasts a day at today's research rate (19 numbered candidates in 3.5 days),
     so 100 or more by 11-14, of which perhaps half resolve inside the test.
   - **Risk:** none to the $100. About 10 journal rows a day against the 200-an-hour cap.
4. **Not recommended, unless Davies prefers trades to protection:** a D7 that lowers B to 10. Expect about 4 trades a
   week. The observed edge is negative (2 of 2 lost), so expect a loss and the −$30 stop within the 28 days if that
   continues. If he chooses it anyway, sizing should stay a quarter Kelly so the stop is not reached sooner.

## 7. The message for Grok (only after Davies says yes to D7)

> From Davies, 2026-10-20. Nothing about your trading rules changes: A 8, B 12, thin books, caps and stops are exactly as
> before, and "no open" remains the right answer when nothing clears them. One addition (Deviation D7, shadow forecasts):
> whenever you research a candidate far enough to put a number on it, journal it as a no_action decision with
> `market_id`, `token_id` (the side you would buy), `p` (your probability that this token pays 1, formed from your sources
> before you look at the price), `m` (the mid you then read), `category` ("A" or "B", the one you tested), and a short
> `reason`. One row per market per scan at most, and only when you have a real p, not a guess. These rows send no order
> and cost nothing; at the end they are scored against the market (Brier), beside the real trades. Keep doing everything
> else as you do now.

## 8. The SQL (read-only, 2026-10-20 ~16:05 UTC)

```sql
-- decisions, cycles, requests since the go
select action, category, count(*), min(ts), max(ts) from public.grokpm_decisions
 where ts >= '2026-10-17T02:39:14Z' group by 1, 2;                                     -- no_action, null, 169
select kind, count(*), sum(actions) from public.grokpm_cycles
 where ts >= '2026-10-17T02:39:14Z' group by 1;                                        -- full 21, light 148, 0 actions
select status, count(*) from public.grokpm_requests where at >= '2026-10-17T02:39:14Z' group by 1;  -- 200: 417, 422: 31
select left(error, 120), count(*) from public.grokpm_requests
 where at >= '2026-10-17T02:39:14Z' and status <> 200 group by 1;  -- 30 malformed market ids, 1 cycle ts in the future
select count(*) from public.grokpm_orders where mode = 'live';                        -- 0
select date_trunc('day', at), count(*), count(*) filter (where status = 422),
       count(*) filter (where error ilike 'order%') from public.grokpm_requests
 where at >= '2026-10-17T02:39:14Z' group by 1;                                        -- 90 / 180 / 113 / 66, no order
-- the full scans' own words (the funnel and the near-miss table were read from these)
select ts, notes from public.grokpm_cycles where ts >= '2026-10-17T02:39:14Z' and kind = 'full' order by ts;
select ts, reason from public.grokpm_decisions where ts >= '2026-10-17T02:39:14Z'
   and (reason ilike 'full scan%' or reason ilike 'first full scan%') order by ts;
```

Public reads:
- Gamma `public-search` for the near-miss markets' outcomes;
- the CLOB's `/prices-history` and the data API's `/trades?takerOnly=true` for fill realism;
- Gamma `/events?closed=true&tag_slug=…` and `/prices-history` for the week's base rates.

All of them keyless GETs.

**Not blind:** every row was read as it stood; no figure here changes the test.

## 9. Audit note (2026-10-20 evening, read-only; nothing above is changed)

Offline, the committed scripts reproduce `results/near_misses.txt` and both base-rate files byte for byte, the MANIFEST's
nine sha256 hold, and the headline figures stand: 3 of 9 won, Brier 0.1359 against 0.1059, B10 −7.49 on 2, B8 −10.59 on 3.
Where the text says more than its tables:
- "Looser bars lost on every resolved case" holds for B10 and B8 (5 trades, all lost); B5's six held one win (Alberta
  40-60, `1*`), and the Alberta 20-40 loss in B10 and B8 rests on a count not official until 29 Oct (`0*`).
- §1's "6 of 6 sat at 0.96 to 0.9995" against §2's Vancouver (Fry) at 0.934/0.979; and §3 lists the A earthquake check at
  0.90, §2 at about 0.985.
- §1's "within 9 to 84 minutes" is the four losers' (the script's header); Rio Grande do Norte (open) took 2.5 h (§3).
- The 19 near-miss rows, the outcomes and the server counts are copied by hand from production reads (§8); no export of
  them is committed, so they cannot be re-derived offline.
