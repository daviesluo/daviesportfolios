# Pre-registration fp6: the family — five hypotheses of Binance's own, Holm-corrected together

Written 2026-09-26 (UTC). Frozen with the five files it names, by the commit that puts them on `main`; nothing in any
of the six may change after it, and any deviation is reported as a deviation. No return, funding payment, basis
change or P&L of any of the five rules was computed before the freeze; what each saw is disclosed in its own file. A
sixth hypothesis, H1 (BTC and ETH carry against the perpetual), was written and then withdrawn before the freeze, on
arithmetic from its own counts (below); its number is kept so the record shows it.

## Why a fourth search

Davies asked on 2026-09-26 for another round built on the lessons and the leads of the three Binance searches (§3.24–
§3.26, §3.28–§3.29 of the reference, fp5 and its review), and said his Binance account supports futures. What was on
record is that the API key's futures permission is off (§6, read 2026-09-23) — a setting on the key, not the account.
This round asks what Binance's derivatives would add if they were usable, and it follows the fp5 review's rules for any
next round: a power check first, at most ten hypotheses, Holm-corrected, nulls by resampling with replacement or by
circular shift, annualised on the capital a rule ties up, funding on every perpetual leg, fees from each market's own
schedule, resting orders filled only at their limit and only on a print through it (none of the five rests an order),
and fills priced where the account would trade (Binance's own books).

## Access (read before any result)

Every hypothesis here has a derivative leg. The sources, read on 2026-09-26:

* **FCA PS20/10** (published 2020-10-06, rules in force 2021-01-06, page updated 2025-07-11): the sale, marketing and
  distribution to retail clients of derivatives and ETNs referencing unregulated transferable cryptoassets is
  prohibited for "firms who carry out marketing, distribution or selling activities in, or from, the UK". **COBS
  22.6.5R** (in force from 2025-10-08, when ETNs reopened to retail): "A firm or TP firm must not: (a) sell a
  cryptoasset derivative … to a retail client; (b) distribute … ; (c) market …".
* **Binance, UK**: from 2023-10-16 17:00 UK time no new UK users; "Existing UK users will retain the current services
  available (providing they have completed their Investor Declaration and Appropriateness Test)" and "any new products
  and services will not be made available during this interim period" (Binance blog, 2023-10-16). Binance asked UK
  users to declare an investor category by 2022-02-14 "to determine whether your access to these products is permitted
  under local regulatory requirements or will be restricted" — futures, margin, options and leveraged tokens (CoinDesk,
  2021-12-14, quoting Binance's notice; secondary). The Earn products opened on 2025-08-14 to "UK Professional Users"
  (FPO Articles 19 and 49: investment professionals and high-net-worth companies) do not include futures (Binance
  announcement, 2025-08-14).
* **Ireland / EU**: crypto perpetuals are MiFID financial instruments, not MiCA crypto-assets; ESMA (2026-02-24,
  ESMA35-243228190-8024) says perpetual futures "are likely to fall within the scope of the existing national product
  intervention measures on CFDs" (retail leverage limits, margin close-out, negative balance protection). Binance's
  Credits Trading Mode FAQ (2024-06-24, updated 2026-01-12) offers USDⓈ-M futures "to users in eligible regions".
  Binance withdrew its Greek MiCA application and wrote that "some users may be impacted depending on their country and
  account status … we will communicate directly with affected users" (Binance blog, 2026-06-24); the press reports it
  stopped providing services to EU users from 2026-07-01 (CoinDesk 2026-06-26, Euronews 2026-06-25). No Binance entity
  is in ESMA's interim MiCA register (CASPS.csv, read 2026-09-26: 362 providers, 12 Irish).
* **Binance's own terms** (`https://www.binance.com/en/terms`) sit behind a bot challenge from this machine and were not
  read; `fapi.binance.com`'s refusal here cites their "b. Eligibility" section.

So: **registered in the UK as a retail client**, the account may not be sold a crypto derivative — the FCA's rule binds
the firm, and Binance's own notices have restricted UK users' futures by investor category since 2022 and given UK
users nothing new since 2023-10-16. **Registered in Ireland**, futures were offered to "eligible regions", but Binance
told EU users it would stop serving them from 2026-07-01, and what an Irish account may do now is not public; were
perpetuals offered, ESMA's CFD-style retail limits would likely apply. **Not verifiable from here**: the account's
registered country, its investor category, whether its futures account is open, and the terms' list of eligible
regions — only the app, or a signed read of the account (not made), can say. **No result of this family makes any of
the five rules available to this account.** A pass says a rule would have been worth money; whether the account may run
it is a separate question, and only Davies and Binance can answer it.

## Fees (the schedules the five use)

* **Spot**, regular tier: 0.10 % maker and taker, 0.075 % paying with BNB (the account's measured tier,
  `2026-09-23-binance-cost-study.md`).
* **USDⓈ-M futures**, regular tier: 0.02 % maker, 0.05 % taker; 10 % off paying with BNB held in the futures wallet
  (Binance FAQ 360033544231, "Binance Futures Fee Structure & Fee Calculations").
* **USDC-margined perpetuals**: 0 % maker, 0.04 % taker (0.036 % with BNB) from 2025-12-10 08:00 UTC "until further
  notice" (Binance, 2025-12-09).
* Every rule here takes the touch and pays no BNB: 0.10 % a spot fill, 0.05 % a USDⓈ-M fill.
* **Zero-fee books**: USDT/USD and USDC/USD (zero maker and taker since 2025-11-18) exclude residents of the United
  Kingdom, France, Spain, Italy, the Netherlands and others (Binance, 2025-11-17). The zero-fee promotions on
  BFUSD/USDT (2025-08-13), U/USDT and U/USDC (2026-01-12) and RLUSD/USDT and RLUSD/U (2026-01-21) list the Netherlands
  but neither the UK nor Ireland; whether each still runs was not checked. The FDUSD majors keep a 0 % maker fee only,
  with the standard taker fee since 2026-01-29. §3.29's ZF priced zero-fee stablecoin quotes and failed; none is
  re-tested here.

## The ideas, and what killed the others

| idea | why it could earn | what kills it | verdict |
|---|---|---|---|
| **H1** BTC/ETH carry: long spot, short the USDⓈ-M perpetual while trailing 7-day funding ≥ 8 % a year | the formula pays 0.0100 % per 8 h (10.95 % a year on notional) whenever the premium sits within ±0.05 % (Binance FAQ 360033525031) | since 2025 no BTC or ETH settlement has been above that floor, and the rule held BTC 94 and ETH 18 of the last 365 days (below) | **withdrawn** (arithmetic) |
| **H2** ETH spot against its quarterly, held to delivery | the basis is locked at entry; SPQTR was real on BTC; ETH was never scored | a thin basis: condition 4 needs the one package of the last twelve months entered at ≥ 17.5 % | **pre-registered** |
| **H3** the same carry across the 40 most liquid altcoin perpetuals, trailing 3-day funding ≥ 25 % | funding up to ±2 % a settlement (BTC ±0.3 %), hourly once capped; never priced across the list | squeezes (33 of 84 packages close at the +40 % guard), funding that turns, spreads | **pre-registered** |
| **H4** the live trend rule long and short on perpetuals | the long rule sits in cash while a market falls; its worst window is the sideways D (−7.81 %) | whipsaw in a flat market; a short pays funding when it is negative | **pre-registered**, through the house backtester |
| **H5** short the perpetual after "Binance Will Delist …" | DL on spot: −$2,689.89 over 111 events, median −31 % | a crowded short pays funding; squeezes; the perpetual delisted too | **pre-registered** |
| **H6** short a new crypto perpetual for thirty days | fp3's B5: new spot listings −28.2 % median at thirty days | a crowded short pays funding; squeezes | **pre-registered** |
| Short only across one settlement | collect a payment without holding | one settlement pays 1 bp at the floor; a perpetual round trip costs 4 bp at maker, 10 at taker | killed (arithmetic) |
| The premium's sag into a settlement | longs close before paying and reopen after | measured (`kill_premium.py`): over 1,090 settlements each on BTC, ETH, SOL and DOGE, 2025-09 → 2026-08, the premium's mean change across a settlement is −0.03 to +0.15 bp and its 90th-percentile size 2.5–3.9 bp, against 8–10 bp for two taker fills | killed (measurement) |
| USDT- against USDC-margined funding on one coin | two books of one coin, two crowds | measured (`measurements.json` → `kills`): the trailing 7-day difference is ≥ 10 % a year on 13 (BTC) and 15 (ETH) of 989 days since 2024-01-10, ≥ 5 % on 42 and 53; a week at 10 % is 19 bp against 18 bp of four taker fills | killed (measurement) |
| Calendars, and coin- against USDT-margined books | the curve's shape; two collateral books | the Binance branch priced them (§3.171, §3.217–§3.219, §3.225, §3.241, §3.248, §3.255, §3.264 there): none clears | not re-tested |
| Positioning (long/short ratios, open interest, funding as a signal) | crowded sides unwind | FUND (§3.34): an edge before 2024, not since; LS-FADE +3.5 bp a trade against a null p95 of +21.6 bp; §3.21 | not re-tested |
| Cascade bids on perpetuals (CB's cousin) | forced sellers overshoot | `PERCENT_PRICE` rests a limit at most 5 % from the mark (10 % on AVAX and DOGE); CB on spot earned about cash and loses since March 2026 (§3.29) | killed (the filter) |
| Reverse carry: short spot on margin, long the perpetual when funding is negative | shorts pay longs | margin borrowing, which Binance restricts for UK users by investor category, as it does futures (the 2021–22 notice); the borrow rate | killed (access) |
| BFUSD and Earn yield on collateral | a yield on margin | UK: Professional Users only (2025-08-14) | killed (access) |
| TradFi and stock perpetuals | weekend gaps | 3.5 months of history; fp2's weekend tokens | killed (data) |
| Perpetual-leads-spot | faster price discovery | a minute's edge against a 10–20 bp round trip: nothing under an hour survives (§3.6) | killed (arithmetic) |
| A quarterly's last hours to delivery | settlement is the index's 30-minute average | the basis at the delivery day's open is a few basis points (SPQTR's exits); four fills cost ≥ 30 bp | killed (arithmetic) |

## H1, withdrawn before the freeze

H1 held long spot against a short USDⓈ-M perpetual on BTC and on ETH ($1,000 each, notional $1,000 / 1.1 ≈ $909)
while the trailing 7-day funding was at least 8 % a year, and closed below 4 %. Its bar required, among seven
conditions, at least 4 % a year on the $2,000 over the last twelve months (2025-09-25 → 2026-09-25). Its counts
(`measurements.json` → `h1`, counts only) make that impossible:

* **No settlement above the floor since 2025.** BTCUSDT: 188 of 1,095 settlements in 2025 and 56 of 802 in 2026 paid
  exactly 0.0100 %, none more, and 141 and 209 were negative; ETHUSDT 212 and 42 at the floor, none above, 177 and 247
  negative. (In 2023–24 BTC paid above the floor on 69 and 213 settlements, ETH on 76 and 242.)
* **Days held.** The hold rule held BTC on 94 and ETH on 18 of the last twelve months' 365 days.
* **So** the funding it could collect in the last twelve months is at most 3 × 0.0100 % × (94 + 18) × $909 ≈ $30.5:
  1.5 % of $2,000, where condition 4 needs $80. The rest would have to come from the basis — at least $49 over at most
  six packages (four entries in those months, and at most one carried in per coin), 0.9 % of notional each before
  their fees of 0.30 % a round trip — where the daily change in the perpetual-to-spot basis has a standard deviation
  of 1.8–2.0 bp and mean-reverts (variance ratio 0.25–0.27 at ten days). It cannot.

No mean of funding or of the basis, no return and no P&L of H1 was computed; the bound uses only the counts above. The
perpetual carry on the majors is therefore answered in phase 1: since 2025 it has paid at most the floor, and a rule
that holds it only while it pays would have collected less than cash over the last twelve months. H2 and H3 carry the
carry question where it can still pay: a locked quarterly basis, and altcoins' funding above the floor.

## The five hypotheses and the p each contributes

| # | file | rule | p for Holm |
|---|---|---|---|
| H2 | `2026-09-26-fp6-prereg-carry-quarterly.md` | ETH long spot, short the quarterly with the best annualised net basis ≥ 8 %, one at a time, to delivery | block bootstrap, H0 "annualised return on capital ≤ 8 %" |
| H3 | `2026-09-26-fp6-prereg-carry-xs.md` | the same carry on up to five of the 40 most liquid altcoin perpetuals with trailing 3-day funding ≥ 25 % | the same |
| H4 | `2026-09-26-fp6-prereg-trend-ls.md` | the live trend rule long and short on perpetuals, windows A–D, the house's four evaluations | the short leg against random shorts, the largest of the four evaluations' p |
| H5 | `2026-09-26-fp6-prereg-delist-short.md` | short a coin's perpetual after "Binance Will Delist …", to a day before spot trading stops | events against shorts of established perpetuals on the same days |
| H6 | `2026-09-26-fp6-prereg-listing-short.md` | short a new crypto perpetual for its first thirty days | the same |

**Holm, step-down at 5 %**: order the five p's from smallest to largest, p(1) ≤ … ≤ p(5). The hypothesis with p(k)
clears condition "beyond chance" when p(j) ≤ 0.05 / (6 − j) for every j ≤ k; the first p that fails stops the ladder,
and it and every larger p fail. A hypothesis PASSES only when it clears its Holm step AND every other condition of its
own bar. Ties are ordered by the table's order.

## Order of work in phase 2

1. Re-pull every input with `fetch.py` or check the stored ones: every sha256 in `backtests/fp6/manifest.json` must
   match, and the tapes H4 reads must match the hashes in its file. A mismatch stops everything and is reported.
2. Each scorer recomputes its phase-1 counts from the inputs and stops if one differs from `measurements.json` /
   `trend_ls_counts.json`; H4's also reproduces the incumbent's published entries and returns first.
3. The five scorers run, each twice, byte-identical; then the Holm ladder is applied once, to the five p's as written.
4. The study write-up reports every condition of every hypothesis, pass or fail, every deviation, and H1's withdrawal.

## What this family cannot show

Access (above). Custody and counterparty risk on Binance, which is outside the FSCS and any UK authorisation (the
worth-money lines of 8 % a year, twice cash, are set with it in mind but do not price it); liquidation or
auto-deleveraging of a winning short in a crash, and changes to collateral ratios. Binance's future changes to its
fees, funding caps, intervals and collateral rules. And, for H5 and H6, a blind test of the price leg: DL and fp3's B5
already measured it on spot.
