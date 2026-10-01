# Polymarket's first live step: a pre-study (2026-10-01)

Davies, 2026-10-01: "唯一的有条件测量 POOLAGE … 这个是推荐我上线Polymarket的策略进live实验的意思吗？你研究下哪个策略最适合进live
实验，并也确保上线的这个策略各个方面都最佳之后和我确认，我往polymarket钱包里面从kraken转钱". Is POOLAGE a
recommendation to go live; which Polymarket strategy suits a live experiment; make sure it is the best in every
respect, confirm with him, and he moves money from Kraken to the Polymarket wallet.

A read-only pre-study by one research agent, checked by the coordinating session (the break-even ratios recomputed
from RW's aggregates and RW's spec; the Terms text's sha256 equal to fp4's recorded `0506de1e…847d`; the power
simulation re-run identical). No database table, no `POLYMARKET_*` secret, no signed or L2 call; nothing placed.
Scripts and outputs: `backtests/pmlive/`.

## Answer

- **POOLAGE is not a live recommendation.** It is a measurement of how fast other makers reach a new reward pool, read
  from RW's own minutes after 10-09 and only if RW or RW-E passes (research round §3).
- **Nothing outside the RW family deserves live money.** FAV, WX, DRAW-X, USLATE, HARVEST, VIEWS and fp5's taker rules
  failed on real prints and real fees (reference §3.33–§3.42). Polymarket's new Perps liquidity rewards need at least
  1 % of trailing seven-day maker volume and are leveraged perpetuals this UK account may not hold.
- **The frozen protocol already names the rule and the order.** RW-NEXT fixes the candidate mechanically on or after
  10-09 00:05 UTC, runs it forward as RW-C to 10-23, and only on RW-C's pass does "the live-design question go to
  Davies under Part 4". The earliest first live order is about 10-29 to 11-01 (inference: a design, a frozen live
  pre-registration, the build and a watched dry-run after 10-23).
- **What only a live account can show is whether Polymarket pays the rewards the paper formula assumes.** RW's six
  paper days are +$1,194.62 of formula rewards and −$482.99 of trading, so the rule breaks even at an actual-to-formula
  ratio R ≈ 0.40; at the stress spec's fills (one tick worse; its halved rewards removed) it needs R ≈ 0.58. A reading
  of `pmrw.ts` against the published formula suggests the paper is conservative (others' one-sided score summed
  across makers, the two-sided term over all makers' totals, the size cutoff per level, our capped side scored 0
  where the docs give a third): inference, not measured, and nothing is changed in a frozen engine for it.
- **No money should move yet.** The key was exposed to another tool, two spenders hold unlimited allowances the order
  book does not use, nothing may open a position before RW-C passes and Davies says go, and a transfer takes minutes,
  so moving early buys no lead time.

## The smallest experiment that answers R (to be pre-registered after RW-C, if it passes)

- The candidate exactly, on its own daily ranking, up to 6 markets or $120 of first-quote capital; post-only GTD
  quotes at the market's minimum size (median 20 shares in RW's universe), replaced only when the rule's price
  changes or the expiry nears; a paper shadow on the same minutes with our orders removed from the book.
- Phase 1: 2 days in Ireland on 1–2 markets (plumbing, scoring status, the first midnight payout). Phase 2: about 12
  days in Ireland, about 70 market-days. R = Σ actual (`GET /rewards/user`, L2) / Σ formula computed on the quotes as
  they rested, with a bootstrap interval clustered by market; diagnostics from `/orders-scoring`,
  `/rewards/user/percentages` and the close-only flag; maker rebates (`/rebates/current`, keyless) as a second
  calibration.
- Power (`scripts/ratio_power.py`; the noise is an assumption, because what is unknown is exactly that noise): 30
  market-days separate R = 1 from R ≤ 0.6 with power 0.50–1.00, 84 with 0.82–1.00; R = 0.3 shows below 0.6 with power
  0.79–1.00 after 12.
- Caps: live capital (RW-NEXT Part 3.1) ≤ $300 in code, ≤ $60 a market; stops at −$25 a day and −$75 in all; a futility
  stop after at least 18 market-days if R's upper bound is under the break-even. Fund about $400.
- Expected scale (inference, RW's six days scaled to 6 markets): about $60 a day of formula rewards and −$24 of fills.

## What the order path needs (RW-NEXT Part 4 and the CLOB docs, read 2026-10-01)

- L1 `ClobAuth` and L2 HMAC headers (already pinned in `agents/polymarket.test.ts`); EIP-712 orders for signature type 1
  (proxy wallet) against the CTF Exchange or, for `neg_risk` books, the Neg Risk CTF Exchange; the order id is the
  order hash, so it is known before the POST. Official EIP-712 vectors are still to be produced offline.
- Post-only GTC/GTD (GTD at least 3 minutes ahead, expiring a minute early: the dead-man switch for a once-a-minute
  loop); no edit, so cancel and post; tick and minimum-size rules (the docs disagree on whether the minimum is shares or
  USDC: the dry-run settles it); rate limits far above six markets' needs; 425 and two minutes of post-only around an
  engine restart; trades reconciled until CONFIRMED or FAILED.
- pUSD collateral (USDC.e wrapped by the Onramp); merging and redeeming need a Relayer key or a manual claim.
- `eu-west-1` only for any POST; cancels allowed from any region so the kill switch never depends on one.
- The Ireland gate: while his attestation is current, a bid is BUY YES at b and an ask BUY NO at 1 − a (or SELL what is
  held); otherwise close-only: cancel every BUY and rest only SELLs of what is held. The account's closed-only flag is
  read the same way. Makers pay no fees; nothing takes.
- A pending row before every POST, reconciliation by order id, an order the venue shows nowhere left for a person;
  `live_confirmed_at` cleared or `global_pause` cancels all; test doubles at least as strict as the venue; a new module,
  with `_shared/polymarket.ts` left GET-only; at least a day of dry-run in `eu-west-1`.

## Wallet and transfer

- Keep the existing account, treat its key as compromised: fund only the experiment, only after the dry-run passes and
  Davies says go, and sweep it out at the end. Before funding, revoke the two pUSD spenders the order book does not use
  (the retired v1 Neg Risk Adapter and Combos Exchange v3) and their Conditional Tokens approvals; keep the two
  exchanges. Revoking the other tool's Supabase token is his. A fresh polymarket.com account would mean accepting the
  Terms and the site's attestation again, and gets a Deposit Wallet (type 3) whose signatures and reward endpoints
  differ; Session Keys (cannot withdraw) are gated and beta.
- When ready: USDC on Polygon from Kraken (withdrawal fee about 1 USDC, minimum 2; the address confirmed by email first)
  to the wallet's EVM deposit address from polymarket.com → Deposit; the bridge quoted about 0.02 % on native USDC and
  nothing on USDC.e. Not native USDC straight to the proxy wallet (inference: the Onramp wraps USDC.e). $5 first,
  checked through the probe's collateral read (ledger item 6), then the rest.

## Options for Davies

- **0, as frozen (recommended):** nothing built or funded until RW-C passes; first order about 10-29 to 11-01.
- **1, a recorded deviation:** build the rule-independent path (signing, client, reconciliation, gates, caps) during
  RW-C, inert, with any dry-run only on markets outside RW's universe and nothing of `pm_rwc_*` read. Saves about 5–7
  days; breaks RW-NEXT's ordering ("before any live design") and the ledger's "design, not build", and is wasted if
  RW-C fails. PR5's live path, built and dry-run before its verdict, is the precedent.
- **2, not recommended:** a live calibration during RW-C on markets under $10 a day. It takes on the Terms risk and real
  money before the candidate is confirmed, and a close-only sanction would end the candidate's own test.

## Risks, stated as his

- The Terms (re-read 2026-10-01, byte-identical to 09-24) bar UK and Irish residents, "THERE ARE NO EXCEPTIONS". It is
  his accepted risk; the named consequences are close-only mode, exclusion from "any reward or incentive programs"
  (which would read as R ≈ 0), and termination.
- It earns only on days he is in Ireland; never a VPN, a proxy or anyone else's account.
- The exposed key bounds the loss at the balance; adverse selection gave back about 40 % of rewards on paper; Polymarket
  can change reward rules at any time; quotes must be real and fillable (the Terms' spoofing clause).

## Preconditions before any money moves

1. RW-NEXT Part 1 names a candidate (on or after 10-09 00:05 UTC). 2. RW-C passes (on or after 10-23 00:05 UTC).
3. Davies' word on the live design, given after 10-23. 4. The live test pre-registered and frozen (R's readout, stops,
caps, bar). 5. The order path built in a new module, pinned, with both gates, caps, kill switches, reconciliation and
strict doubles. 6. At least a day of dry-run in `eu-west-1`, watched. 7. The wallet decided, the unused allowances and
the other tool's token revoked. 8. The probe reads the account as not closed-only, before and after funding. 9. His
Ireland dates cover phase 2, his attestation set in conversation with an expiry. 10. The Terms bar stated in the
design as his accepted risk. 11. The $5 test transfer confirmed, then the rest. 12. His confirmation of the first live
order in that conversation.

## Not verified

The scoring-duration rule; whether the $1 payout minimum is per address or per market; shares or USDC for the minimum
size; whether the reward endpoints accept signature type 3; official EIP-712 vectors; staging or Amoy for an outside
account; Kraken's Travel Rule questions; whether a new account is shown a new attestation.

## Davies' decision (2026-10-01)

"“选项 1：违反原规则的先后顺序，在 RW-C 期间先把下单通道建好、只空跑，可以早约 5–7 天” - 这个你现在就建好吧 我之后长期在爱尔兰，如果
变动需要更改会和你说，不和你说关就一直没事 也不用问我". He chose Option 1: the rule-independent order path is built now,
during RW-C, and only dry-run, as a recorded deviation of RW-NEXT's ordering on his word. And his Ireland attestation is
standing: he will be in Ireland long-term, it stays current until he says it changed, and nobody asks him. That
replaces the expiring timestamp of RW-NEXT Part 4 and of precondition 9 above; Part 4's frozen file is not edited. The
other preconditions stand; 5 and 6 are now to be met during RW-C rather than after it, and the build and its dry-run
are recorded in the ledger (item 2).
