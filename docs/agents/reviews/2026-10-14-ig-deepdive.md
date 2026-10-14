# IG CFD and spread betting: deep dive after the 2026-10-09 screen (2026-10-14)

Davies, 2026-10-14: after the Polymarket statistical-arbitrage work, do the same deep research and verification
architecture for IG CFDs and spread betting; he is willing to bear some risk if a strategy is good enough, but it
must be researched thoroughly first.

**What this is.** A second, narrower pass over `reviews/2026-10-09-ig-opportunities.md`, using its committed
inputs and the new measurements under `backtests/ig_deepdive/`. It does not re-open candidates that the earlier
screen closed, and it does not turn a proxy-feed result into an IG result. No IG account was opened or funded, no
API key was read, no demo or live order was placed, and no production table was touched.

**Companion handoff.** `backtests/ig_deepdive/SPEC-for-verification.md` states the exact account, quote,
execution and statistical checks for Grok Engineer, with frozen bars. This review explains why those checks are
necessary and what may still be worth Davies' risk if they pass.

## Bottom line

1. **No IG strategy is live-ready on the evidence now in the repository.** The binding gap is not another
   parameter search. It is that none of the surviving candidates has yet been measured on IG's own tradable
   bid/offer, at IG's opening time, under the product and account Davies will actually use.
2. **FXW-AUD remains the only historically supported candidate.** On FXCM weekends it survives assumed opening
   spreads of 12, 20 and 30 bps and is positive in every era split. It is nevertheless fragile in two specific
   ways: the advantage mostly disappears if entry is an hour late, and a 440 bp worst observed adverse excursion
   makes leverage based on final-trade drawdown unsafe.
3. **IG's weekend index markets remain a genuine venue-specific unknown.** Their spreads are small relative to
   the Friday-to-Sunday futures move they forecast, but there is still no public history of IG's weekend prices.
   This is a quote-discovery study, not yet a strategy.
4. **Simple volatility gates do not rescue model-priced short volatility.** At 0.8 times Cboe's short-dated
   volatility indices, requiring implied volatility to exceed trailing realised volatility made daily and weekly
   straddle sales worse, including after adding model-priced wings. Term-structure gates likewise removed the
   apparent front-VX roll rather than isolating it. The only volatility question left is factual: what does IG
   itself bid for a straddle, day after day?
5. **Willingness to take risk changes position size only after the venue facts pass.** It does not cure a
   one-hour timing mismatch, an unknown opening spread, an unknown guaranteed-stop distance, or uncertainty over
   the contracting IG entity and tax treatment.

## What the earlier screen already settled

The 2026-10-09 review measured roughly 72 arms and set a Bonferroni-style bar of about |t| 3.4. Its closures are
not reopened here:

| family | earlier result | status now |
|---|---|---|
| FOMC-day and pre-holiday index longs | FOMC effect decayed to +2.7 bps, t 0.13 in the last five years; pre-holiday t 1.38 since 2011 | closed |
| Overnight index long on a DFB | most of the gross overnight premium is consumed by about 2 bps a night of funding; residual is beta | closed as an edge |
| Intraday opening-gap fade and day-of-week | no arm clears the family bar; the apparent UK result is an ETF opening-print artefact | closed |
| Index option premium at monthly horizons | Cboe PUT/WPUT are equity-like, and IG's minimum US 500 option stake forces about £78k notional | closed at practical size |
| Iron condors | Cboe CNDR is weak before IG's four option spreads, estimated at 6-16% of collateral a year | closed |
| Short front VIX futures | positive roll with a drawdown larger than notional even under a modelled +30% stop | closed; new gates below agree |
| FX carry | IG's ±1.5% a year tom-next fee exceeds the measured major-pair rate gaps | closed by arithmetic |

Three matters were explicitly left open: FXW-AUD on IG's own Sunday quote, a backfill of IG's weekend markets,
and the ratio of IG's actual short-dated option bids to Cboe's variance-style indices. The ESG Sunday-gap fade
was descriptive only: +50.2 bps on 18 qualifying futures weekends. Those four are the entire subject below.

## New measurement 1: FXW is pair-specific, early and path-risky

`scripts/fxw_risk.py` re-reads STATARB-2's committed FXCM weekend rows without changing the 20 bp trigger,
Friday-mid target or 24-hour close. It charges half the stated opening spread at entry plus 2 bps for exit and
funding, matching the earlier IG repricing. Bootstrap intervals resample whole trades with seed 20261014.

### The AUD result is not a generic "fade every FX weekend gap" result

| pair | trades | mean at 12 bp | mean at 20 bp | mean at 30 bp | 12 bp bootstrap 95% |
|---|---:|---:|---:|---:|---:|
| AUD/USD | 85 | +18.88 bps, t 4.82 | +14.88, t 3.80 | +9.88, t 2.52 | +10.93 to +26.24 |
| EUR/USD | 53 | +2.98, t 0.54 | -1.02, t -0.19 | -6.02, t -1.10 | -8.11 to +13.30 |
| GBP/USD | 72 | -9.34, t -1.48 | -13.34, t -2.12 | -18.34, t -2.91 | -21.85 to +2.71 |
| USD/JPY | 79 | -7.70, t -1.24 | -11.70, t -1.88 | -16.69, t -2.68 | -20.39 to +4.09 |

That cross-pair pattern cuts both ways. It argues against a universal weekend-gap law, so AUD carries a
selection warning from the original search. It also means a profitable AUD rule cannot be "diversified" into
EUR, GBP or JPY to manufacture more trades: on the same feed and costs, those pairs lose.

### Era and direction splits are supportive, not uniformly decisive

At a 12 bp assumed spread, AUD means by era are +10.90 bps (2016-2018, n 24), +18.35 (2019-2021, n 25),
+16.90 (2022-2024, n 17) and +31.42 (2025-2026, n 19). The sign never flips, but only 2019-2021 and
2025-2026 have bootstrap intervals wholly above zero. A claim of decade-long stability would be stronger than
the evidence.

The long side after a downward gap supplies most of the result: +22.20 bps, t 4.54, n 61, bootstrap
+12.25 to +31.40. Shorting an upward gap gives +10.44 bps, t 1.80, n 24, with an interval crossing zero.
That asymmetry must be reported, but it is not permission to delete the short side after seeing it. A long-only
rule would be a new hypothesis requiring Davies' approval and a new frozen test.

### One hour is most of the trade

| entry | trades | mean at 12 bp | mean at 20 bp | mean at 30 bp |
|---|---:|---:|---:|---:|
| Sunday first quote | 85 | +18.88 | +14.88 | +9.88 |
| 60 minutes later | 76 | +7.06, t 1.53 | +3.06, t 0.66 | -1.94, t -0.42 |
| 240 minutes later | 51 | +9.91, t 1.57 | +5.92, t 0.94 | +0.92, t 0.15 |

The 60- and 240-minute rows exclude trades already at target by then, so they are execution diagnostics, not
alternative strategies. Their message is still clear: an implementation that normally gets in an hour after
the measured open has no historical case at a plausible IG spread. This interacts badly with the known timing
mismatch — IG's weekday FX was documented as opening at 21:00 UK, an hour before the 22:00 UK first FXCM
minute on most weekends. IG may quote the gap earlier, partly faded, or too wide to trade. Only IG's own
history and a Sunday tick record can distinguish those cases.

### Final P&L understates the margin problem

At 12 bps, the worst finished trade is -129.3 bps and the worst cumulative final-P&L drawdown is -167 bps of
notional. The 24-hour adverse excursion is much larger: median 21.6 bps, p75 56.4, p90 117.5, p95 130.3 and
maximum 440.1 bps. Three quarters reach Friday's mid within 24 hours; the median successful exit takes
197 minutes.

This invalidates sizing from final drawdown alone. At leverage 12, the observed 4.401% adverse excursion is a
52.8% mark-to-market loss on account equity before any later recovery, quite apart from margin close-out. The
earlier review's illustrative L 12 therefore should not be carried into a live design. Position size has to be
set from an adverse-move stress and the cash buffer above required margin, not from the best-looking final
equity curve.

## New measurement 2: public volatility gates make short vol worse

`scripts/vol_gated.py` keeps the earlier model deliberately unfavourable to a seller: an at-the-money straddle
is priced from 0.8 times VIX1D for one trading day or 0.8 times VIX9D for one week, then charged the high end
of the earlier IG spread range. The new question is whether a gate knowable at sale time selects better days.
The gates are implied-minus-trailing-realised volatility of at least 3 or 5 points, the same condition with
implied volatility no higher than 30, and for weekly sales a non-inverted VIX9D/VIX ratio. An iron-butterfly
variant buys model-priced wings at twice the gross straddle premium.

| sale | all days | IV-RV >= 3 | IV-RV >= 5 | IV-RV >= 3 and IV <= 30 |
|---|---:|---:|---:|---:|
| Daily naked | -11.80 bps, n 1104 | -19.92, n 329 | -23.84, n 212 | -18.11, n 288 |
| Daily iron butterfly | -6.87 | -12.32 | -12.15 | -13.04 |
| Weekly naked | -13.32, n 769 | -9.26, n 354 | +0.98, n 195, t 0.10 | -4.37, n 324 |
| Weekly iron butterfly | -13.00 | -12.65 | -3.50 | -8.55 |

The economic interpretation is not subtle. A large excess of tomorrow's implied volatility over the last
21 days' realised volatility usually says an event or volatility expansion is actually coming; it is not, by
itself, evidence that the option is rich. Wings reduce the worst modelled daily loss from 664 to 263 bps, but
they do not create a positive mean. Weekly sales at a 5-point gate are merely flat before any claim about
IG's real wing spreads or margin treatment.

The same script tests whether entering short front VX only in contango helps. It does not:

| cycle-start gate | +30% stop annual result on notional | worst drawdown | +50% stop annual result |
|---|---:|---:|---:|
| always short | +22.75%, Sharpe 0.33 | -150.5% | +29.65%, Sharpe 0.40 |
| front / spot VIX >= 1.00 | +3.34%, Sharpe 0.06 | -149.2% | +9.67%, Sharpe 0.15 |
| front / spot VIX >= 1.05 | -2.97%, Sharpe -0.05 | -170.7% | +1.85%, Sharpe 0.03 |
| second / front >= 1.03 | +1.44%, Sharpe 0.03 | -108.3% | -0.87%, Sharpe -0.02 |

"Always short" is not vindicated by being the least bad row. Its drawdown exceeds the notional being rolled,
28 of 161 cycles hit the +30% stop in the daily-bar model, and a guaranteed stop at IG would add a premium and
may not be placeable at the modelled distance. The gated and ungated forms are both unsuitable as a candidate
for live risk.

What remains is narrower than a strategy: sample IG's own daily and weekly US 500 straddle bids and offers,
convert the bid to an implied-volatility ratio against the matching Cboe index, and see whether IG ever bids
near the levels at which the ungated historical model breaks even. If it does not, short-dated option selling
closes without a trade. If it does, any later proposal still has to solve the £10-a-point minimum stake,
four-leg costs for defined risk, option margin offsets and a worst modelled weekly move above 10% of notional.

## Candidate ranking

| rank | candidate | what would have to be true | present verdict |
|---:|---|---|---|
| 1 | **FXW-AUD-IG** | IG's first Sunday AUD/USD quote still contains most of the proxy gap and becomes tradable at no more than about 20 bps quickly enough | worth Grok's full verification; not live-ready |
| 2 | **WKND index quote bias** | IG's last weekend bid/offer systematically misses the Sunday reopening value by more than both spreads and rollover effects | worth a descriptive backfill; no rule yet |
| 3 | **ESG-US500 Sunday-gap fade** | the 18-trade futures result survives a longer independent ES history and IG's US 500 quote/funding | fold data capture into WKND; do not promote on n 18 |
| 4 | **IG-VOL-K quote audit** | IG's executable straddle bid is repeatedly rich enough after all leg spreads, at a size whose tail Davies can actually fund | measurement only; closes quickly if bids are ordinary |

FXW and WKND are different kinds of opportunity. FXW is a complete rule whose venue transfer is unproven.
WKND is an unmeasured venue price with no rule. Mixing the two standards — backtesting WKND as if a rule
already existed, or treating FXW's FXCM history as if it were IG fills — would repeat the central error this
repository has paid for on other venues.

## If a candidate passes: how risk should be framed

Davies' willingness to bear risk is useful only if the loss unit is fixed before leverage is discussed. For
FXW the earlier published minimum spread bet was £0.50 a pip, about £3,300 notional at the AUD/USD level then
in the review, with 5% retail margin. Those figures must be re-read on the actual account, but they show the
shape:

| adverse AUD/USD move | loss at £3,300 notional | loss at £10,000 notional | loss at £33,000 notional |
|---:|---:|---:|---:|
| 1.293% (worst finished historical trade) | £43 | £129 | £427 |
| 4.401% (worst observed 24-hour excursion) | £145 | £440 | £1,452 |
| 6% stress | £198 | £600 | £1,980 |
| 10% stress | £330 | £1,000 | £3,300 |

At the 20 bp historical assumption, expected final P&L is 118.1 bps of notional a year before tax and any
slippage beyond the model: about £39 a year at minimum notional, £118 at £10,000 and £390 at £33,000. That is
the real economic scale. A backtest can be statistically interesting and still not justify operational risk,
weekend supervision and account complexity at the minimum stake.

A defensible first live design, if every verification bar passes and Davies separately says go, would therefore
have all of the following properties:

- the smallest available stake or contract size for an initial live-validation tranche, in a segregated IG
  account whose entire balance is money Davies has pre-accepted losing;
- cash in that account at least equal to required margin plus the chosen 10% adverse-move stress on the full
  position, rather than reliance on negative-balance protection or a margin close-out as the risk manager;
- no professional-client election merely to obtain leverage or weaker protections;
- one position at a time, no averaging into a gap that keeps moving, and a pre-written maximum number of live
  validation trades after which fills are compared with the frozen model before any size increase;
- a guaranteed stop only if its actual minimum distance, premium and effect on the target race have been
  measured; adding one by intuition can convert recoveries into certain losses;
- a manual kill path that works when the API token has been invalidated by weekend maintenance.

This is not a sizing recommendation. It is the minimum evidence Davies needs in front of him before choosing
an amount of risk. In particular, an account balance equal only to initial margin is not "risking the margin":
retail close-out can realise the loss at the adverse excursion, and negative-balance protection, where it
applies to the contracting entity, does not preserve the position or the account balance.

## Venue, legal and operational facts that can kill an otherwise good result

These are not footnotes. Each is a pass/fail input to the verification spec.

- **Which IG entity and product Davies actually has.** The 2026-10-09 work read IG's UK pages and
  spread-betting agreement. It did not establish the entity named in Davies' approved application, whether
  both CFD and spread-bet accounts are available to him, his account base currency, or whether the same
  markets and minimum sizes appear after login. A strategy specified as a £-a-point spread bet cannot silently
  become an EU CFD, or the reverse.
- **Tax follows residence and product, not the marketing label.** UK spread-bet winnings were sourced to
  TCGA 1992 s.51 and HMRC CG56105; CFD outcomes to CG56100. Irish residence was not checked, and systematic
  automated activity is the BIM22020 edge case already flagged. No after-tax ranking is valid until Davies has
  an answer for his own residence and contracting entity.
- **Automation consent.** Spread-betting Term 9(12), as read in the earlier review, requires prior written
  consent for automated software or a betting strategy beyond what IG makes available. An API key may evidence
  consent to use the API; it is not treated here as proof that a particular automated strategy may deal live.
- **No latency or manifest-error strategy.** Term 20(k) prohibits taking unfair advantage of how IG constructs
  or conveys bid/offer prices, and Term 11 allows a bet based on an obvious error to be voided or amended.
  FXW and WKND are therefore specified as trades at ordinary tradable quotes after the market is open, never
  as racing a stale IG quote against a faster external feed. Any apparent edge concentrated in off-market
  opening prints is a terms risk, not a harvestable result.
- **Out-of-hours and weekend prices are IG's own view.** They can widen, move with other clients' business or
  become non-tradable in ways an exchange proxy cannot show. Weekend positions also roll into weekday
  positions, so settlement and close-out semantics must be read from the actual market details, not inferred
  from the product name.
- **The API maintenance window is the strategy window.** IG warns that weekend maintenance invalidates tokens.
  A Sunday recorder or trader must prove re-login, one-connection discipline, rate-limit accounting and a
  manual fallback before any money stage. Demo fills remain indicative; IG does not document them as live
  execution.
- **Retail protections are account-level facts.** Leverage caps, 50% margin close-out and negative-balance
  protection must be confirmed for the actual entity and client classification. They limit some outcomes; they
  do not make a leveraged, gap-exposed rule safe. IG UK's current standard warning, re-read on 2026-10-14,
  says 70% of retail investor accounts lose money trading spread bets and CFDs with the provider.

## What was not done or not checked

- No IG login, account document, API response, demo quote or live quote was read. Every "IG spread" in the
  historical tables is an assumption applied to FXCM or Cboe history.
- Current product detail numbers were not treated as refreshed merely because IG's public charges and weekend
  pages were reachable on 2026-10-14. Minimum stakes, guaranteed-stop distances and premia, margin tiers,
  funding, market hours and weekend rollover all require the account-level read in the spec.
- The FXCM weekend file has first quotes, target-fill minutes and 24-hour high/low, not the full minute path.
  It cannot price a guaranteed stop, an ordinary stop, a knock-out, exact slippage or the race between target
  and stop. Those wrappers are therefore unpriced, not assumed protective.
- The volatility work prices options from indices, not IG option quotes. It falsifies the tested public gates
  at that model price; it does not measure IG's bid. Wing prices, margin offsets and automatic settlement at IG
  remain unknown.
- ESG still rests on 730 days of Yahoo hourly ES data and 18 trades at the 0.5% threshold. No longer
  independent Sunday futures history was obtained.
- No tax advice is given. Irish treatment, the effect of dual residence and whether systematic betting could
  be trading income remain for a qualified adviser.
- No live-risk amount is recommended. The stress table is arithmetic on hypothetical notionals, not a statement
  about Davies' account or wealth.

## Files and reproducibility

- `docs/agents/backtests/ig_deepdive/scripts/fxw_risk.py` writes `results/fxw_risk.json`.
- `docs/agents/backtests/ig_deepdive/scripts/vol_gated.py` writes `results/vol_gated.json`.
- `docs/agents/backtests/ig_deepdive/SPEC-for-verification.md` is the run-ready handoff.
- Inputs are the committed FXCM weekend files under `../statarb_search2/inputs/fx/` and the Cboe/Yahoo inputs
  and source pages under `../ig_research/inputs/`.
- `MANIFEST.json` in `ig_deepdive/` pins the new scripts, results and spec by sha256.
