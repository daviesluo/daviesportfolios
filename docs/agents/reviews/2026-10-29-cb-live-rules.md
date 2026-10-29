# Coinbase live: is "with Euros - 2" the rule set to take live, and what changes first? (CB-LIVE-RULES, 2026-10-29)

Davies, 2026-10-29, verbatim: "Coinbase做好实盘搭建并且准备with Euros - 2这个策略的live上线（你也可以先研究下coinbase还有没有别的改进空间，确保这个策略一切最优）".
Another session builds the live executor. This study asks whether "Stablecoin quotes with Euros - 2" (`cb_nudge.ts`) is the
rule set to put live, and what to change before the go.

**What changes in production: nothing.** No engine, row, pre-registration or frozen file was touched, and no key was used.
Paper money only.

## 1. Answers first

**Take "- 2" live as it runs.** No single change clears the bar written before the runs, and the one combination that does
was picked after the first pass, so it goes to paper first.

**The recommended live rule set** is "- 2" exactly as `cb_nudge.ts` runs it:
- **Book:** USDC-GBP alone.
- **Rungs:** $300 in six rungs of $50.
  - Bids at fair × (1 − 0.1 / 0.2 / 0.3 %), floored to the 0.0001 tick; asks at fair × (1 + the same), rounded up.
  - Post-only.
  - A resting order re-prices when fair moves more than 0.05 %.
- **Exits:** at fair (a long's ask rounded up to the tick, a short's bid floored), no offset.
- **Stop:** the 24-hour taker stop, at Coinbase's 0.0045 % taker fee plus the spread crossed.
- **Fair** = the coin's value ÷ GBP/USD.
  - The coin's value is `cb_live`: USDC = 1, dark when more than 50 bps from Revolut X's F3.
  - GBP/USD is `cb_fx.ts`'s: the newest `fx_ticks` read that arrived by t + 58 s, TrueFX or Kraken's marked fallback, 120 s
    fresh, else Yahoo's bar.
  - The rate is held through an FX closure for up to 60 hours.
  - In closures, the fair is nudged by Revolut X's USDC-GBP mid: ½ × the deviation of (mid − fair) from its 24-hour EMA,
    skipped at 50 bps.
  - The fair is withheld for [T − 1, T + 5] minutes around each scheduled CPI, NFP, FOMC, ECB and BoE release.
- **Expected forward year** (STRATEGY-COMPARE's method, × e = 0.825):
  - **The headline is 30.2 % a year [27.3, 33.1], £68 [£62, £75] on £225**, P(year < 0) 0.000. That is the rate since
    2026-09-01, when Coinbase's GBP flow moved from USDT to USDC (CMP-CB §4.4).
  - Two things below it should be planned for:
    - **A queue.** If the price level must clear by a tick before a resting order fills, the headline is 22.0 % [19.9, 24.1],
      £50 (§3.3).
    - **The September regime ending.** The ½ out-of-sample + ½ last-3-months blend is 14.4 % [11.9, 16.9]; with that queue,
      10.4 %.

**What each candidate showed** (one change at a time against the baseline; the bar: Δ out of sample with P(≤ 0) < 0.10 and
a mean above zero, Δ since 09-01 not negative, and positive in ≥ 2/3 of 25 months):

| candidate | out-of-sample effect | verdict |
|---|---|---|
| Weekend hold vs dark | Hold is worth £4.86 a year out of sample and £18.91 a year since 09-01 (dark loses in 19 of 25 months) | **keep the hold** |
| Nudge: closures vs off vs every minute | Differences of −£0.19 to +£0.66 a year (it has 20 days of Revolut X's book, from 10-09) | **keep as is**; its own pre-registration reads it |
| Release blackout: none / [−5, +15] | +£0.37 a year (P 0.050) / +£0.08 | **keep [−1, +5]**: the effect is pennies with the fast rate, and dropping it fails the months bar (10 of 25) |
| Re-price at 0.025 % or 0.1 % | Both worse (−£1.59, −£2.23 a year) | keep 0.05 % |
| Exit one or two ticks beyond fair | Worse here (−£1.61, −£2.73 a year), unlike Revolut X's variant-8 | **keep the exit at fair** |
| Stop at 12 h, 48 h or 7 days | None better (+£0.01, −£0.44, −£0.67 a year) | keep 24 h |
| Rung sets (see §3.1 for the full list) | The best single change is dropping the 0.3 % rung: +£2.15 a year (P 0.002), +£6.19 since 09-01, positive in 16 of 25 months (one short of the bar). Weighting the near rungs (1.5 / 1 / 0.5) is +£0.89 (P 0.032), also 16 of 25 | **paper twin** |
| Combination of the two near-misses: no 0.3 % rung (0.1 / 0.2 % at $75 each) and no blackout | +£2.68 a year (P 0.001), +£6.31 since 09-01, 17 of 25 months: it **passes**, but was chosen after the first pass | **paper twin first** |
| Size | £ rises almost in proportion and % falls slowly: 30.2 → 28.7 % from $50 to $400 rungs at the engine's 10 % cap; 29.1 → 26.4 % at a 2 % cap | start at $300 as pre-registered; $600–$1,200 is the next step on a clean live record |
| USDC-EUR as a second book | 10.2 % a year since 09-01 (£23 on £225), 4.5 % out of sample | **not now**: $300 more on USDC-GBP gives £134 against £91 for the two books; keep EUR on paper ("with Euros" runs it) as the diversifier if USDC-GBP's regime ends |
| Fewer asks (the coin is a dollar position) | The $150 the asks hold carries a GBP/USD spread of £7.2 a year, against £68 expected. One ask costs £15 a year since 09-01 to save £4.8 of spread; bids only cost £25 | **keep three asks; no hedge** |
| Live frictions | Post-only crossing by the recorded touch: 5 of 2,776 orders (0.18 %). About 211 orders a day against 15 requests a second. 5 of 1,785 fills under £1 | none material |

**What stays on paper:**
- "with Euros" (the four books, the weekend hold): the control and the EUR book.
- A new twin of "- 2" with the 0.3 % rung dropped (0.1 / 0.2 % at $75) and no release blackout: the combination that passed
  after selection.
- The base test without the hold, as it already runs to 11-10.

## 2. Method

**The record** is CMP-CB's (`compare/cb/scripts/cb_compare.py`'s `Book`): Coinbase's USDC-GBP and USDC-EUR minute bars
2024-10-01 → 10-08 (SCQ-VENUES, which replay as the prints do), then the engines' own minute record 10-10 → 10-28. 2026-10-09
has no prints.

**The baseline is "- 2" as it runs** (`cb_nudge.ts` on `cb_usdc.ts`' driver), in dollars:
- the simulator's X is GBP/USD;
- six $50 rungs;
- P&L in pounds at the exit minute's rate;
- the fair is §1's, with the rate modelled as Exness's last tick at t + 57 s (FX-SPEED-LONG's `L3_raw`);
- the nudge acts where Revolut X's USDC-GBP book is recorded (REVX-FAIR's `rx_mid_USDC-GBP.txt.gz`, from 2026-10-09). Before
  that date the row is the same rule un-nudged.

**The simulator is `scripts/vsim.py`**: PR5's frozen `pr5_sim.simulate` with its constants as parameters. Those are the rungs
and their weights, the re-price step, an exit offset in ticks, the stop's length and cost, the fill cap's share of the minute,
and a tick a print must clear.
- At its defaults it is that function. `vsim.check` runs it first on the baseline's own inputs and asserts the same 1,785
  trips.

**Scoring** (STRATEGY-COMPARE's method, `scripts/cb_rules_stats.py`), every figure × e = 0.825:
- **The headline** is the rate since 2026-09-01. Its 80 % band and P(year < 0) come from 10,000 simulated years of 3-day
  blocks of those days, seed 20261029.
- **Beside it:**
  - out of sample: 2025-11-21 → 10-28;
  - in sample: 2024-10-01 → 2025-11-20;
  - the blend: ½ out of sample + ½ the last three months.
- **The bar for a change**, fixed before any run was read: the paired daily difference against the baseline
  - has out-of-sample P(≤ 0) < 0.10 (3-day block bootstrap, 10,000 draws) with a mean above zero;
  - is not negative since 09-01;
  - is positive in at least two thirds of the 25 calendar months.
- **Capital** is the dollars the rungs fund, at GBP/USD 1.3306 (Exness, 2026-10-28 00:00 UTC): $300 = £225.
- **Two passes.** The first ran each change alone. The second ran three combinations of first-pass near-misses
  (`combos.json`), chosen after reading the first. A combination that passes is therefore not a pre-registered result.

## 3. Results

### 3.1 One change at a time (USDC-GBP, $300, × e)

| change | since 09-01 %/yr [80 %] | OOS %/yr | in sample %/yr | Δ OOS £/yr, P(≤ 0) | Δ since 09-01 £/yr | months + / − of 25 | bar | trips/day, bps, stops/yr |
|---|---|---|---|---|---|---|---|---|
| **baseline: "- 2" as it runs** | **30.2 [27.3, 33.1]** | 8.7 | 22.3 | — | — | — | — | 1.44, 12.4, 44 |
| nudge off | 30.1 [27.2, 33.0] | 8.7 | 22.3 | -0.03, 0.675 | -0.19 | 0 / 1 | fail | 1.44, 12.3, 44 |
| nudge in every minute | 30.4 [27.5, 33.4] | 8.7 | 22.3 | +0.11, 0.302 | +0.66 | 1 / 0 | fail | 1.49, 12.0, 45 |
| dark in closures (no hold) | 21.8 [19.6, 24.1] | 6.5 | 18.2 | -4.86, 0.999 | -18.91 | 6 / 19 | fail | 1.0, 13.4, 15 |
| no release blackout | 30.2 [27.3, 33.1] | 8.8 | 22.4 | +0.37, 0.050 | +0.08 | 10 / 3 | fail | 1.44, 12.6, 44 |
| blackout [T − 5, T + 15] | 30.1 [27.2, 33.1] | 8.7 | 21.9 | +0.08, 0.272 | -0.10 | 7 / 6 | fail | 1.44, 12.4, 44 |
| re-price at 0.025 % | 28.3 [25.6, 31.2] | 8.0 | 19.4 | -1.59, 0.977 | -4.15 | 3 / 22 | fail | 1.28, 12.8, 62 |
| re-price at 0.1 % | 27.5 [24.6, 30.4] | 7.7 | 20.6 | -2.23, 0.967 | -6.10 | 5 / 20 | fail | 3.57, 4.6, 41 |
| exit a tick beyond fair | 28.3 [25.3, 31.2] | 8.0 | 22.4 | -1.61, 0.962 | -4.26 | 13 / 12 | fail | 1.35, 12.1, 52 |
| exit two ticks beyond | 26.1 [23.6, 28.7] | 7.5 | 21.4 | -2.73, 0.975 | -9.23 | 8 / 17 | fail | 1.24, 12.3, 67 |
| stop at 12 h | 29.7 [26.8, 32.7] | 8.7 | 20.7 | +0.01, 0.516 | -1.01 | 9 / 16 | fail | 1.5, 11.9, 89 |
| stop at 48 h | 29.5 [26.6, 32.5] | 8.5 | 22.3 | -0.44, 0.861 | -1.51 | 13 / 9 | fail | 1.4, 12.4, 15 |
| stop at 7 days | 29.5 [26.6, 32.5] | 8.4 | 23.3 | -0.67, 0.880 | -1.51 | 14 / 8 | fail | 1.38, 12.4, 2 |
| no 0.1 % rung (0.2/0.3 × 1.5) | 30.5 [27.5, 33.6] | 8.3 | 21.0 | -0.79, 0.823 | +0.74 | 11 / 14 | fail | 0.56, 20.1, 19 |
| no 0.3 % rung (0.1/0.2 × 1.5) | 32.9 [29.8, 36.0] | 9.6 | 23.5 | +2.15, 0.002 | +6.19 | 16 / 9 | fail | 1.27, 10.5, 37 |
| add 0.05 % (four × 0.75) | 28.1 [25.2, 31.0] | 7.9 | 22.1 | -1.88, 0.966 | -4.73 | 10 / 15 | fail | 7.73, 2.9, 77 |
| add 0.4 % (four × 0.75) | 26.1 [23.4, 28.9] | 7.8 | 20.9 | -2.06, 0.999 | -9.16 | 8 / 17 | fail | 1.53, 13.8, 49 |
| 0.1 % alone (× 3) | 27.9 [25.1, 30.8] | 8.9 | 23.9 | +0.59, 0.360 | -5.09 | 12 / 13 | fail | 0.88, 7.3, 24 |
| weights 1.5 / 1 / 0.5 | 30.8 [27.9, 33.8] | 9.1 | 23.0 | +0.89, 0.032 | +1.49 | 16 / 9 | fail | 1.44, 10.5, 44 |
| weights 0.5 / 1 / 1.5 | 29.4 [26.5, 32.4] | 8.3 | 21.4 | -0.98, 0.977 | -1.75 | 8 / 17 | fail | 1.44, 15.4, 44 |
| one ask (0.1 %), three bids | 35.2 [31.5, 39.0] | 10.2 | 29.8 | -4.27, 1.000 | -15.13 | 2 / 22 | fail | 1.23, 11.3, 34 |
| bids only | 38.4 [33.9, 43.2] | 11.4 | 34.9 | -6.79, 1.000 | -24.68 | 3 / 22 | fail | 0.92, 12.4, 22 |
| asks only | 21.9 [19.1, 24.7] | 6.0 | 9.7 | -12.80, 1.000 | -43.32 | 1 / 24 | fail | 0.51, 12.3, 21 |
| second pass: 0.1 × 2, 0.2 × 1 | 31.4 [28.4, 34.4] | 9.4 | 23.7 | +1.70, 0.038 | +2.67 | 16 / 9 | fail | 1.27, 9.2, 37 |
| second pass: 0.1 × 2, 0.2 × 1, no blackout | 31.4 [28.4, 34.4] | 9.7 | 24.0 | +2.19, 0.021 | +2.80 | 16 / 9 | fail | 1.27, 9.4, 37 |
| second pass: no 0.3 % rung, no blackout | 33.0 [29.8, 36.1] | 9.9 | 23.7 | +2.68, 0.001 | +6.31 | 17 / 8 | **pass** | 1.27, 10.8, 37 |

**How to read it:**
- "Δ" is the change's paired difference against the baseline in £ a year.
- "months + / −" counts the 25 calendar months in which the difference was positive or negative; the rest are exactly zero.
- **Nudge.** It acts only inside closures, where Revolut X's book is recorded, so it has 20 days and moves pennies.
- **Blackout.** With the fast rate, the release blackout is worth almost nothing either way: the hard-moving minutes are now
  priced at t + 58 s. Dropping it passes on P (0.050) but not on months (10 positive, 3 negative, 12 unchanged).
- **The rungs.** Dropping the 0.3 % rung and putting its capital on 0.1 % and 0.2 % adds £2.15 a year out of sample (P 0.002)
  and £6.19 since 09-01, positive in 16 months against 9. That is one month short of the bar.
  - The second pass combined it with no blackout: 17 months, a pass.
  - It was found by looking, so it is a paper twin's to confirm, not a reason to change the rule before the go.
- **Exit offset.** Unlike Revolut X, a tick beyond fair loses here. Coinbase's tick is 1.3 bps (Revolut X's 1.3 bps too), but
  the extra tick costs fills: 1.35 trips a day against 1.44, and 52 stops a year against 44.

### 3.2 The coin the asks hold

| rule | dollars held for the asks | GBP/USD spread on it, £ a year | its realised P&L out of sample / since 09-01 | strategy since 09-01, £ a year | ratio of the two |
|---|---|---|---|---|---|
| "- 2" (three asks) | $150 | £7.16 | −£2.12 / +£1.95 | £68.0 | 8.6 |
| one ask (0.1 %) | $50 | £2.39 | −£0.71 / +£0.65 | £52.9 | 14.5 |
| bids only | $0 | £0 | 0 / 0 | £43.3 | 17.2 |

- **The spread is real** (about 3 % of the capital a year) but is a seventh of what the asks earn. Cutting it costs more pounds
  than it saves.
- **A hedge** (borrowing dollars or shorting GBP/USD) is not available in the account and would cost more than £7 a year of
  spread to remove.
- **"Ratio"** is the expected £ since 09-01 over the combined yearly spread of the strategy (out-of-sample daily noise) and
  the FX on the coin held. It favours fewer asks on risk, not on money.

### 3.3 Size and a queue (USDC-GBP and USDC-EUR, × e)

| rung (capital) | queue model | USDC-GBP since 09-01 %/yr [80 %] | £/yr | OOS %/yr | USDC-EUR since 09-01 %/yr | £/yr | OOS %/yr |
|---|---|---|---|---|---|---|---|
| $50 ($300, £225) | 10 % of the minute (the engine's) | 30.2 [27.3, 33.1] | £68 | 8.7 | 10.2 | £23 | 4.5 |
| $50 ($300, £225) | 5 % | 29.8 [26.9, 32.7] | £67 | 8.6 | 10.2 | £23 | 4.5 |
| $50 ($300, £225) | 2 % | 29.1 [26.3, 32.0] | £66 | 8.4 | 10.1 | £23 | 4.5 |
| $50 ($300, £225) | 10 %, the level must clear by a tick | 22.0 [19.9, 24.1] | £50 | 6.3 | 8.3 | £19 | 3.7 |
| $100 ($600, £451) | 10 % of the minute (the engine's) | 29.8 [26.9, 32.7] | £134 | 8.6 | 10.2 | £46 | 4.5 |
| $100 ($600, £451) | 5 % | 29.3 [26.5, 32.2] | £132 | 8.4 | 10.1 | £46 | 4.5 |
| $100 ($600, £451) | 2 % | 28.4 [25.7, 31.3] | £128 | 8.3 | 10.1 | £45 | 4.5 |
| $100 ($600, £451) | 10 %, the level must clear by a tick | 21.9 [19.8, 24.0] | £99 | 6.2 | 8.2 | £37 | 3.7 |
| $200 ($1,200, £902) | 10 % of the minute (the engine's) | 29.3 [26.5, 32.2] | £264 | 8.4 | 10.1 | £91 | 4.5 |
| $200 ($1,200, £902) | 5 % | 28.7 [25.9, 31.5] | £259 | 8.3 | 10.1 | £91 | 4.5 |
| $200 ($1,200, £902) | 2 % | 27.4 [24.7, 30.2] | £247 | 8.1 | 10.0 | £91 | 4.5 |
| $200 ($1,200, £902) | 10 %, the level must clear by a tick | 21.9 [19.8, 23.9] | £197 | 6.2 | 8.2 | £74 | 3.7 |
| $400 ($2,400, £1,804) | 10 % of the minute (the engine's) | 28.7 [25.9, 31.5] | £517 | 8.3 | 10.1 | £182 | 4.5 |
| $400 ($2,400, £1,804) | 5 % | 27.7 [25.0, 30.5] | £500 | 8.2 | 10.0 | £181 | 4.5 |
| $400 ($2,400, £1,804) | 2 % | 26.4 [23.8, 29.1] | £476 | 7.9 | 10.0 | £181 | 4.5 |
| $400 ($2,400, £1,804) | 10 %, the level must clear by a tick | 21.6 [19.6, 23.7] | £390 | 6.1 | 8.2 | £148 | 3.7 |

- **The queue models are crude.** The engine fills a rung on any print strictly through it, up to 10 % of the minute's printed
  value.
  - Live, a resting order waits behind earlier ones at its price.
  - A smaller cap (5 %, 2 %) costs 0.4–1.1 points at $50 and 1.0–2.3 at $400.
  - Requiring a print a tick beyond the quote costs 7–8 points at every size. That is the pessimistic case, and the one
    the live record will settle.
- **£ grows almost in proportion with size.** At the engine's cap, $400 rungs earn £517 a year against £68 at $50. Under the
  tick-through queue it is £390 against £50.
- **The minutes that print through the quotes carry large values on Coinbase**, so the cap rarely binds. Revolut X's books bind at
  far smaller sizes.

## 4. Live frictions and venue facts

**Post-only rejects.** On 10-10 → 10-28 the simulator let 2,794 orders go live (it refused 20 more by the last print).
- Against the recorder's touch at the top of each minute, 5 of 2,776 would have crossed (0.18 %), so Coinbase would have
  rejected them as post-only.
- On USDC-EUR it was 2 of 2,513.
- The live executor must treat a reject as "not resting" and place again next turn, as the paper rule does.

**Order rate.** About 211 order placements and re-prices a day over the two years: 160,142 in 758 days, a cancel and a place
each.
- Coinbase Exchange's REST limits (its docs, read 2026-10-29) are 15 requests a second per profile (bursts to 30), `/fills`
  10 a second, and public endpoints 10 a second per IP.
- One turn a minute is far inside them.

**Sizes and steps** (Coinbase's public product endpoint, read 2026-10-29):
- USDC-GBP's `base_increment` is 0.01 USDC and `quote_increment` 0.0001.
- `min_market_funds` is £0.72.
- Settlement is in exact amounts: printed sizes carry 8 decimals. There is no penny rounding of the kind Revolut X has, so
  a hold line for leftover dust is moot.
- Of 1,785 simulated fills at $50, 5 were under £1 (the 10 % cap cutting a rung). An exit that small may sit under the
  venue's minimum, so the executor must carry it into the next trip or close it with the stop.

**Fees.** The engines book a 0 % maker fee and Coinbase's 0.0045 % taker on the stop (the `fx_stablecoin` schedule read
2026-10-09, `cb_quotes.ts`).
- Coinbase's fee page answered 403 to this machine today, so the schedule was not read again.
- The live build should read the account's own tier (`GET /fees`, authenticated) before the go. A maker fee above 0 % would
  take 2 bps a round trip for every 0.01 % of fee, from the 12.4 bps a trip earns.

**Rate source.** The live fair reads `fx_ticks`. A recorder outage falls back to Yahoo's bar, which FX-SPEED-LONG measured
at about a fifth less a year.

## 5. What this does not show

- **No live record on Coinbase.** e = 0.825 is Revolut X's LIVE against its replay, on another venue and another fill rule.
- **The regime is two months old.** The headline assumes the flow Coinbase's USDC-GBP book has carried since September.
  - Its own history reverted twice (CMP-CB §4.4).
  - The blend (14.4 %) and the tick-through queue (22.0 %) are the floors to plan with.
- **The nudge's 20 days** cannot rank it. Its pre-registration does (`2026-10-29-cb-usdc-nudge-prereg.md`).
- **The combination that passed was chosen after the first pass.** Its gain (+£2.68 a year out of sample, +£6.31 since 09-01)
  is inside the spread of the headline. It needs its own window.
- **Exness stands in for TrueFX** (FX-SPEED-LONG §8.7).

## 6. Files

`docs/agents/backtests/cb_live_rules/`:
- `scripts/vsim.py`: PR5's simulator with parameters, and `check`.
- `scripts/cb_rules.py`: the candidates (`CANDS`) and the second pass (`combos.json`). It reads FX-SPEED-LONG's derived Exness
  file (`fx_speed/MANIFEST_long.json`), and its output is not committed.
- `scripts/cb_rules_stats.py` → `results/cb_rules.json`: every candidate's figures, the pairs and bars, the coin's FX and the
  post-only check.

To run it again:

    python3 -I cb_live_rules/scripts/cb_rules.py X.txt.gz runs1.json.gz
    python3 -I cb_live_rules/scripts/cb_rules.py X.txt.gz runs2.json.gz cb_live_rules/combos.json
    python3 -I cb_live_rules/scripts/cb_rules_stats.py runs1.json.gz,runs2.json.gz X.txt.gz cb_live_rules/results/cb_rules.json
