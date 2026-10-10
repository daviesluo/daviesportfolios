# The agents feature: its rules

These are the rules for the trading loop, the stablecoin quotes, Polymarket, the studies and everything that reads or
trades a venue. They lived in `.claude/CLAUDE.md` until 2026-10-03, when Davies had them moved here so that the
instructions every session and sub-agent loads on every call stay small ("你说的这四点建议全做"). Claude Code loads
this file by itself when a session reads a file under `docs/agents/`; `supabase/functions/agents/CLAUDE.md` and
`src/agents/CLAUDE.md` point here, and so does Cursor's `.cursor/rules/agents.mdc`. Everything in `.claude/CLAUDE.md`
still applies; this adds to it.

Read `docs/agents/reference.md` before touching anything under the
agents feature. It holds every verified fact about **TypeSafe: Jev 1.13**
(a System One decision model, released 2026-09-17 — it answers typed
questions with probabilities and cannot generate text; it is in no
model's training data, so nothing about it may be written from memory),
the **Revolut X REST API** (Ed25519-signed, 0 % maker / 0.09 % taker,
1,000 orders a day) and the **Kraken spot REST API** (HMAC-SHA512-signed,
0.40 % maker / 0.80 % taker at this account's tier, OHLC capped at the
720 most recent candles, `validate=true` dry run), plus the live
measurements and the two read-only probes the design rests on. The rules
that follow from that evidence, in short:

- Jev is a decision node inside a rulebook, never the source of the
  edge. Code computes every number; Jev sees a short categorical state;
  a deterministic risk layer it cannot override has the last word. The
  vendor's own jaggedness page says it cannot reason about numbers or
  dates.
- The loop runs every minute and does four things each turn: quotes on
  both venues (basis recorded every fifth minute), order management
  (fills, reconcile, re-quote a resting order the touch has left — five
  times at most, nothing rests past an hour), protective stops against
  the live mark (a hard floor under cost — sold without asking the model,
  marketable on Revolut X; NO intra-bar ATR trail since 2026-09-21, it
  duplicated the rulebook's own close-based trail, §3.13), and
  the categorical state on the FORMING bar written to `agent_observations`
  when it changes, and the maker probes (`0042`) — every marketable order
  writes down where a post-only order would have rested, and later turns
  record whether the book came back, where price went 15 and 60 minutes
  after, and the touch 15, 30 and 60 minutes after it was written (R2 of
  MX-1, reference §4 item 42); that gap is the adverse selection §3.13 could not compute, and a
  probe is never an order and never reaches any book. **A probe, like a
  resting paper order, is filled only by a TRADE through its price**
  (`tradedThrough`: volume > 0, strictly through; §3.26, migration `0050`,
  which also keeps the proving minute in `fill_minute`): Revolut X's UK
  1-minute candles move on quotes while nothing trades, and all three
  probes the old touch test resolved were on such minutes. The dashboard computes
  `probeSummary` — fill rate, median minutes to fill, and `adverseBps`
  signed so POSITIVE is against the fill — but does NOT show it on the
  page (taken off 2026-09-22 on Davies' word; read it with a query). **A retired row that
  still HOLDS something keeps its exits** (`windingDown`): the floor and
  the rulebook's exit keep running, every entry is refused, and a retired
  row that is flat is skipped. `riskGate` no longer refuses an EXIT to a
  paused strategy — only the global pause outranks an exit. **Thin-book
  guard** (2026-09-22): a long's stop is judged at the BID (`exitMark`),
  not the mid, and an ENTRY is refused when the book is wider than 50 bps
  (`WIDE_SPREAD_BPS`; `bookBps` goes on the decision row). An exit is
  never refused by it. **Revolut X's own candles are PUBLIC and one year
  long** — `/1.0/public/candles/{SYM}?interval=240&region=UK`, 2,257 4h
  bars per coin, 2025-09-11 → 2026-09-22 — which covers walk-forward
  window A and none of B, C or D (§2.3, corrected 2026-09-22). **Entries happen only on a newly closed 1h / 4h / 1d
  bar**, at most a few a day; the one exception is the dislocation rule,
  whose entries are events. At taker cost one round trip an hour burns
  ~75 % of the account a month. **Revolut X takes the touch** on every
  order (9 bps — the fill the backtests assume; a resting bid on a
  breakout fills when the breakout fails); **Kraken rests post-only**,
  stops included (at the ask). After any exit a rule waits two of its own
  bars before re-entering. One tick at a time: `agent_locks` lease.
- BTC / ETH / SOL as the core — the only pairs on the venue with ≤ 3 bps
  spreads — plus XRP in the rotation basket and, on trend-4h, AVAX
  (`0039`, §3.7) and SUI (`0040`, §3.8). The bar a coin has to clear is
  §4.15: the four tests on BOTH walk-forward windows and a UK book of
  ≥ $100k a day; the top twenty by market cap were all run in §3.8 and
  only SUI and POL cleared both windows (POL's book is too thin). AVAX
  cleared one window and failed the other; it stays in paper because the
  record is the test. **SUI's admission does not survive the running stop**
  (§3.20): it cleared both windows only under the old intra-bar trail, and
  clears window A alone now. Its seat was re-judged on the windows it has,
  and the evidence cannot decide either way (the pre-registered test's
  p = 0.18 / 0.26); Davies left the call to the session on 2026-09-23 and
  it went to the admission rule: SUI stays on the paper `trend-4h` and
  does not go live (§3.20's addendum). A coin joins a rule by that bar, never by a
  result alone; SUI's round trip is ~42 bps at its median UK book (23.7 bps
  over 1,815 samples, §3.43; §3.20's ~33 came from 60) against the majors' 20.
  **AVAX's UK book is about $31k a day** on a 30-day median of the daily candles (2026-10-01, §3.44), under
  the bar's $100k: §3.8's $1.9m was one day's ticker. A $25 order rides its 9.7 bps touch; the seat is
  Davies' call, and a book test is read on a 30-day median from now on. **A coin one venue lacks may run on the other
  alone** (Davies, 2026-09-21; §4.16): the two venues' symbol lists need
  not match — each `agent_strategies` row carries its own. A Kraken-only
  coin clears the same bar on Kraken's costs (40 bps maker a side, 80 bps
  a round trip before the spread) and a Kraken book of ≥ $100k a day, and
  joins the Kraken row only, paper first like everything else.
- **The set that is live is ONE row**: `trend-4h-live` ("Trend 4h ·
  live"; no name says its venue since `0061`) on Revolut X, BTC/ETH/SOL/AVAX, four equal $25
  slots, $100 (raised from $50 on 2026-09-25, on Davies' word), created
  2026-09-24 22:51:15 UTC by `0054_go_live.sql` and
  armed the same evening (`live_confirmed_at` 22:53:09.568 UTC) on
  Davies' word (§3.31, §4.34). That set is the allocation study's
  answer (§3.11) and the go-live brief's (`docs/agents/go-live.md`),
  reached independently, less SUI. The paper `trend-4h` row stays the
  same-venue control and still carries SUI, which does not go live
  (paper only since 2026-09-23, §3.20's addendum). Equal slots per
  coin, because weighting by a coin's own recent record loses to the
  null on BOTH windows. **Kraken runs no real money**: 80–96 bps a round
  trip needs ~9.7 days to pay back where a Revolut X major needs 2.4 and
  these rules hold 0.6–3.4 days; it keeps supplying the signal. That
  survived being asked again once the USD conversion and the nonce window
  removed the two reasons it COULDN'T trade (§3.12): seven slower
  rulebooks over 27 coins give 12 two-window passes where chance gives
  14.6, Revolut X beats Kraken in 18 of 18 paired comparisons, the fee
  tier needs 15.6× the turnover, and of the eight coins that clear on
  Kraken while failing Revolut X's UK book, none clears the bar on both
  windows. Kraken's book IS now measured for all 27 coins (all clear
  $100k a day; `ordermin` $2.53–$16.26, `costmin` $0.50). Both
  rotations and trend-1h drop out, momentum stays paper.
- **A row's `mode` LABEL is not the BOOK it trades** (§4.19, §4.20). A
  position carries the mode it was opened in (`posKey`); `bookMode`
  resolves the book — real coins outrank the label, a paused row falls
  back to paper — and orders, decisions, probes, exposure buckets and
  caps follow the BOOK while `riskGate` keeps the LABEL. Clearing
  `live_confirmed_at` stops live BUYS only; exits stay armed, and
  `global_pause` is the one switch that outranks an exit. The go-live
  migration was applied as `0054_go_live.sql` at 2026-09-24 22:51:15 UTC:
  a NEW row `trend-4h-live` (then "Trend 4h · Revolut X · live"), with
  `trend-4h` kept paper as its same-venue control. The row was created
  unarmed, with a $15 cap (one $12.50 slot); arming (`live_confirmed_at`
  22:53:09.568 UTC) was the one statement run in the conversation where
  Davies said go. On 2026-09-25 he set the funded capital to $100. A slot
  is the capital divided by the coins, so it is $25, and the one-slot cap
  moved with it to $25. The later steps of $30 and $75 were written for
  the $50 book and are not the next raises. One slot was never priced
  (CAP, §3.44): it lets the coin list's order pick the coin. On his word
  the cap is **$60 (two slots) since 2026-10-01 02:24:51 UTC**, and $150
  (four) follows a clean week once the account holds ≥ $100.20 ($115
  recommended): the tick does not check USD before a live buy, and a buy
  the venue refuses is recorded rejected and not re-sent. The
  audit's D1–D10 and the $50 validation's D11/D12 are fixed and pinned
  (§4.32–§4.33).
- **Jev gates entries with the v2 question at 0.45 (since 2026-09-23,
  §4.21, migration `0047`).** The v1 question listed an "established
  uptrend" checklist (trend_strength moderate/strong, momentum_30d
  positive) that the model applied to the letter, and its 0.60 sat where
  the model's answers were a coin flip. Davies rejected shadow mode ("that
  retires Jev"): the fix was the configuration. v2 says what the rule
  already checked, defines the words without saying what to conclude, and
  asks whether the move looks more likely to continue than to fail; 0.45
  was chosen from the model's measured replies (every weak-trend
  high-volatility reply 0.35–0.41, every other 0.47+) before any backtest,
  so every state is decided the same way on every call. Priced: A +8.0 →
  +9.6, B +20.1 → +19.5, C +55.6 → +58.2, D −7.8 → −7.8 % — worst window
  unchanged, A and C better in all four evaluations but within chance.
  **Rules that follow:** a question states what the rule already checked
  and never lists conditions the rulebook does not have; a threshold sits
  in a band where the measured replies are deterministic
  (`JEV_ENTER_MIN`, pinned against `backtests/jev_answers_v2.json`); a new
  wording is measured on every entry state through `POST ?action=jev`
  (`version`, `kind`) and priced before the loop asks it. **On the two
  paper rows the same gate fails the bar** (§4.21, priced 2026-09-23):
  trend-1h's worst window falls in all four evaluations, and momentum-1d's
  bear year falls 4–15 points as the loop runs it (once a day). Davies chose
  (c), **a wording of each row's own** (2026-09-23): `agents/jev_rows.ts`
  holds them, frozen word for word in
  `reviews/2026-09-23-jev-row-questions-prereg.md`, and a row asks its own
  only once a migration sets `params.jevQuestion`. **Measured and priced
  the same day, neither clears the bar** (§4.28): trend-1h's wording
  decides every state exactly as v2 does; momentum-1d's replies still
  follow the 4-hour words, so its only deterministic threshold (0.77)
  refuses almost every entry, and it loses to a random veto under the
  trail. So every row asks v2. **On the two paper rows the gate is in
  shadow since 2026-09-26** (`0059`, Davies: "这个听你的吧"):
  the model is asked on every entry and its answer recorded, the reason
  says whether it would have vetoed, and the rulebook enters; the live row
  and its control keep the gate. A wording lives in `jev_rows.ts`,
  not in `_shared/agents_strategy.ts`, because six committed results pin
  that file's hash; a second wording for a row needs a new
  pre-registration.
- **A test double must be at least as strict as what it stands in for.**
  Twice on 2026-09-22 a stub looser than production certified a failure:
  the in-memory db ignored `agent_orders_mode_check` (a paused row's exit
  was refused in production), and its `selectAll` skipped the order
  guard (the tick threw for three hours). Shared rules live in one function
  both call (`assertPagedOrder`); after a tick deploy, read decisions and
  `ops_errors`, not the basis — the basis is written before most of the
  loop runs and reads "alive" through a crash.
- Paper first, per strategy; live only on Davies' explicit go, and the
  first live order needs his confirmation in the same conversation. Live
  on KRAKEN additionally needs two things done at the venue first: the
  account holds GBP, not USD (the conversion is his), and the key needs a
  **nonce window** set in Kraken's API settings (§4.18) — the code keeps
  one nonce sequence per isolate, which a cold isolate cannot guarantee
  across a millisecond boundary.
- Record inputs (state, answers, order request/response, fills), not
  conclusions; P&L is computed in one place.
- Two venues, each for what it is good at: Revolut X executes (0 %
  maker); Kraken supplies the signal (`signal_venue` — its candles are
  the cleaner series) and runs the slow rules plus paper twins whose
  fills pay its real 0.40 %. **No cross-venue arbitrage**: the basis
  never came near Kraken's fee in 60 h of 5-minute closes or 10 minutes
  at the touch (reference §2c), and `agent_basis` keeps measuring it
  every turn. Caps in `agent_risk` are per venue account and per mode.
  **An entry is one slot of its row** — capital ÷ the positions it can
  hold — and nothing else sizes it: the fixed $20 per-order cap
  (`max_order_usd`, dropped by `0048`) was removed on Davies' word on 2026-09-23, so adding
  capital to a row that earns it makes its orders bigger. The gate still
  refuses an entry more than 10 % over its slot (`ORDER_SLOT_TOLERANCE`,
  reference §4.26).
- **FOUR ROWS run since migration `0065` (2026-09-27)**: the live row and
  the three Revolut X paper rows `0046` left (§3.17, §4.22): `trend-4h`
  (the live row's same-venue control), `momentum-1d` and `trend-1h` (kept
  for feedback speed, 31.7–56.1 fills per 90 days against the live row's
  14.6–26.8, and because at 0.63 it is the only row with no
  near-duplicate; its return is inside chance and inside the spread error
  bar and is NOT read as evidence). **The paper rows run at $1,000 each**
  (Davies, 2026-09-27: ten times their size by `0066` so they are not a
  sliver of VENUES, then `trend-1h` and `momentum-1d` × 2.5 by `0067` to
  compare on one capital), their paper book scaled from its first order,
  `paper_exposure_usd` $5,000 and a paper daily loss limit of its own,
  `paper_daily_loss_limit_usd` $100 (the live row keeps $25 and $5). A paper fill is at the touch whatever its size, so their
  prices and percentages are unchanged. **The Binance twins (`*-binance`,
  `0049`) were DELETED by `0065`** (Davies: keep them only if they beat
  the Revolut X rows): they made no decision of their own (315 of 315, 132
  of 135 and 12 of 15 paired decisions equal, every difference a position
  held from before they existed), their fills were no better (−1.0 bps a
  fill on four pairs, and a 10 bps fee against 9) and a Binance row cannot
  be live (§4 item 29's addendum). **`trend-4h-kraken` was DELETED by `0046`** (Davies'
  word): it made no decision of its own — 50 of 50 paired decisions matched
  `trend-4h` exactly — nothing read its fill path, that path's accuracy was
  measured keylessly in 18 minutes (79 % / 91 % of resting orders reached
  in 1 / 5 minutes against the loop's model's 82 % / 92 %), and it paid
  4.44× the fee for identical fills. **Kraken is a SIGNAL venue only from
  here**: every rule reads its candles; nothing executes there, and the
  page is swept in that shape. **VENUES shows Revolut X, and Polymarket
  for its tests; not Kraken, and not Binance since `0065`** (Davies,
  2026-09-23 and 2026-09-27; Binance returns with a strategy of its own):
  each card is its venue's paper book —
  "funded (Paper)" is the rows' capital, "deployed" (no label: one on
  funded is enough, Davies 2026-09-23) what they hold;
  no real balance is shown, and the page says "Agents (beta)" — and PAPER
  is a neutral dashed badge because Binance's yellow took the gold it
  wore. Binance's paper venue reads public market data only
  (data-api.binance.vision; api.binance.com refuses US addresses). **Retired**: `momentum-1d-kraken`, `rotation-1d`,
  `rotation-1w-kraken` — 0.90–1.00 correlated with a row that stays, worse
  in all four windows, two of them over the 35 % drawdown limit in the
  bear year. **All four retired rows were DELETED with their history by `0044`**
  (2026-09-22, Davies' word): 4 rows, 11 orders, 35 decisions, 1,371
  observations, irreversibly. `0038`/`0043` had retired them in place
  because a strategy row cannot be deleted while `agent_decisions`
  references it; `0044` deletes the children first. Every number they
  produced is still in the reference. The rulebooks all
  stay in `_shared/agents_strategy.ts` and in their tests — rotation-1d
  (top two of BTC/ETH/SOL/XRP by 30-day return, above their 100-day
  average) included, with §3.4's finding that the loop's own 8 % floor
  makes it WORSE on five variants of six still the reason not to run it.
  **Nothing was added**: every candidate priced in §3.15 and §3.17 is
  inside chance.
  A fifth, dislocation-1m (Revolut X's TOUCH ≥ 15 bps under Kraken's
  mid → lift the ask, rest the exit at the reference), was seeded as a
  measurement and **retired by migration `0038`** on Davies' word: the
  1-minute study's edge was stale last-trade prints (reference §3.5), and
  its one live-touch trade lifted an ask from Revolut X's EEA book, which
  this UK account cannot trade (the client mixed the two regions'
  tickers — since fixed, `REVX_REGION`), and was stopped out 50 bps lower
  a minute later. Its row stays, retired in place (`retired_at`, paused:
  hidden from the page, never ticked) so its records stay under their
  foreign keys; its code stays, dormant.
  Breakout-with-volume, squeeze breakouts, double bottoms (§3.5),
  15-minute / 1-hour trend and RSI(2) pullback rules (§3.6: nothing below
  an hour survives the 20 bps round trip), and five more ideas (§3.9: a
  bare Donchian, a 4-hour pullback, a stale-trend exit, weekly bars — all
  rejected; a BTC-regime filter on entries, re-tested on non-bear
  windows, is rejected too: it helps only the bear year, §3.30),
  and volatility-sized slots and DVOL / funding entry gates (§3.21, from the
  Binance and Deribit research) were tested and rejected with numbers;
  executing the live row at Binance's cost changes no verdict (§3.22); and
  each venue's own strategy — maker-only rules on Revolut X's 0 % fee (§3.23)
  and cross-sectional momentum over Binance's whole USDT list (§3.24), then
  reversal and low volatility over the same list (§3.25) — failed its
  pre-registered bar, and a search from first principles (§3.26: 31 ideas,
  four pre-registered tests) found nothing worth money either, nor did a
  second, independent one (§3.28: 20 ideas, three tests, all lose), nor a
  third, Binance first (§3.29: one pass, bids for liquidation cascades,
  worth about cash and losing since Binance began capping wicks), nor a
  fourth on Binance's derivatives (§3.38: five pre-registered, none passes;
  every one needs a derivative this UK account may not hold). **Since
  March 2026 Binance refuses any trade beyond `referencePrice × (1 ± R)`**
  (the 5-minute mean; R 15 % on the majors, 2 % on stablecoin books), so
  a market stop in a crash can come back EXPIRED. The
  first search's one small edge, 0 % quotes either side of interbank on
  Revolut X's USDC/GBP and USDT/GBP books, passed a longer test (§3.27)
  and runs on paper (§4 item 31). So what
  differs between the venues is cost and reach, not a rule. A faster rule
  is a fee schedule until data says otherwise.
  Backtests: reference §3.3a–§3.7, run with the loop's own fills, stops
  and cooldown — including the rotation rule since 2026-09-21, where the
  8 % floor turns out to make it WORSE on five variants of six (§3.4); the backtester writes `docs/agents/backtests/summary.json`
  itself and reports a parameter plateau per coin; `frequency.json` there
  is §3.6's raw output, `universe.json` (`--study universe`) §3.7's,
  `universe20*.json` §3.8's and `ideas.json` §3.9's.
- **PR5's GBP stablecoin quotes run on paper, beside the loop** (§3.27,
  §4 item 31, migration `0051`, 2026-09-23 on Davies' word). PR3's rule —
  0 % quotes 0.1 / 0.2 / 0.3 % either side of interbank on Revolut X's
  USDC/GBP and USDT/GBP books — passed on nine months of public prints it
  never saw, in a market that tightened in the week of 2026-08-24 (plan
  with ~$0.42 a day on $1,200, not the backtest's 82 %/yr). Its own call,
  `agents?action=quotes` (every minute), runs the frozen rule one minute
  behind the clock (`quotes.ts`, replayed trip for trip against the simulator in
  `quotes.test.ts`), public reads only, into its own `agent_quote_*`
  tables; nothing of the strategy rows reads them. Four weeks, then the
  spec's six conditions decide (`reviews/2026-09-23-pr5-paper-test-spec.md`).
  **Since 2026-10-02 the page shows realistic twins in its place** (`0087`,
  `agents/quotes_twin.ts`, reference §4 item 51, Davies: "确保一致，确保真实"):
  the live executor's own code on a simulated Revolut X account
  (`revx_sim.ts`: filled only by prints through a resting order, by their
  size; pennies as the venue moves them; maker conversions), "Stablecoin
  quotes" carrying out PR5's decisions at £100 a rung, "Stablecoin quotes
  variant-1" (`p50`) the same decisions at £50 a rung, and "Stablecoin quotes
  variant-3" (`d`; variant-1 until 2026-10-03) rule D's arm `d` at £50 (rule
  D's file calls it variant-2; PR5V is off the page; from 2026-10-10 the twin
  alone quotes no entry on its 0.03 % rungs, `RULED_D_RETIRED`); "variant-2" is
  TAKE's (`take50`, `0089`, `reviews/2026-10-03-take-prereg.md`). `p50x1`
  (`0108`, `p50` with its exit a tick beyond fair) was withdrawn before its
  window by `0109` (Davies 2026-10-09, after the F3 replay, `backtests/scq_f3/`),
  `d` "variant-3" again; the rule `exitOffset` stays in the code, named by no
  row. TESTING's scoreboard and the
  Revolut X card include them. **Since `0088` each twin is a row of
  `agent_quote_twin_specs`** (reference §4 item 51's "Twin variants" table):
  the call and the page read the enabled rows. A variant that differs only in
  its parameters is a migration of two statements, its row then
  `select public.create_quote_twin_tables('<id>')`, with a one-page
  pre-registration from `reviews/TEMPLATE-variant-prereg.md`; ids name
  tables, never a variant number. PR5's, PR5V's and rule D's paper tests keep running behind the page
  with their frozen readings (`reviews/2026-10-02-pr5-realistic-twins-prereg.md`).
  Revolut X serves its whole trade history keylessly
  (`/api/1.0/public/trades/all`), and its candles are built from the MID
  when a minute did not trade — read fills from prints. **Its live path is
  LIVE since 2026-10-01 16:29:53 UTC** (migration `0052`,
  `agents/quotes_live.ts`, reference §4 item 35; Davies' word the same
  afternoon, after the settings were verified in
  `reviews/2026-10-01-pr5-live-go.md`): on PR5's own sub-account (key
  `_2`, capital £120, £10 a rung) it carries out the paper engine's
  decisions order for order, at the paper's prices, under the design's
  limits (a POST governor at 900/950, raised from 600/700 on Davies' word
  on 2026-10-01; a −1 % daily loss stop; de-peg and stale-input guards; a
  bounded 24-hour stop; a refused exit sent again only after a newer print
  that is not through it; a post-only order the book it met shows crossing
  recorded refused and never sent, 2026-10-02; and a **dead-man switch**
  outside Supabase, 2026-10-02 on Davies' word: when the executor has not
  finished a turn for three minutes, or its state cannot be read and no
  read in the last three minutes found it fresh (2026-10-07, Davies:
  "读不到时看上次"; the Worker remembers that read in a Durable Object), the
  `monitor` function, called every minute by the monitor Worker, cancels
  every resting order on the `_2` account and reads each back; the next
  turn quotes the paper's decisions again; reference §4 item 35; and since
  2026-10-08 the executor watches the switch back: no entry while the
  dead-man call's newest beat is over five minutes old or missing, exits and
  stops armed, one error when it starts, `QUOTE_LIVE_DEADMAN_WATCH_MS`). Its asks hold coin bought by `quotes-convert`
  (£30 of each, 16:31–16:32 UTC), topped up by the executor itself since
  2026-10-02 when an ask runs short (a maker conversion at the bid, at most £5
  a book a day, `planTopUps`). It went live with `update
  public.agent_quote_live_config set dry_run = false, live_confirmed_at =
  now() where id = 1;`. Its `live_confirmed_at` is its kill switch (exits
  stay armed); `global_pause` cancels everything. From its first real
  order it is also a row of LIVE (`quotesLiveRow`, 2026-09-26): its
  real-money book from its own fills, in LIVE's totals. PR5's paper test
  still decides PR5 on 2026-10-21.
- The tick claims a bar by inserting its decision (unique index on
  strategy, symbol, bar_start; a protective decision claims one second
  INTO its minute, never a bar start; a dislocation decision the minute).
  An allowed decision whose order never reached the book is placed on a
  later turn, and the order insert is the claim on that attempt (`0041`).
  A live order is written as `pending` BEFORE the venue is called and
  reconciled by client id next turn: the active list first, then the
  venue's order HISTORY, whose list carries no price or fee, so a match is
  read back through `GET /orders/{id}` before it settles; **one the venue
  shows nowhere stays pending for a person to settle — never marked
  rejected on a guess**, and a 5xx or a lost reply is the same unknown,
  not a rejection (go-live audit D3). A live marketable order re-reads the
  touch as it is sent and allows 10 bps on an entry, 50 on an exit; an IOC
  that dies unfilled is sent again next turn, five attempts at most (D2).
  A buy fee Revolut X takes in the coin is booked net, because a buy's
  `filled_quantity` is gross (D4). A live buy books only what the account
  can sell: whole base steps (D11), and, when the venue did not report the
  fee, its balance of the coin (D12). A cancel whose
  read-back fails leaves the row open, and so does one the venue still
  shows resting after two re-reads: Revolut X carries a cancel out a
  moment after its 204 (PR5's first live hour, 2026-10-01). The fills query is paged. The
  daily loss limit blocks new risk only, never an exit; a resting exit
  order never outranks a stop (it is cancelled first); a re-quote passes
  the same gate as any order. Paper rows have their own exposure cap
  (`paper_exposure_usd`) and daily loss limit (`paper_daily_loss_limit_usd`,
  `0066`) so they measure independently. The pre-live
  review that found these is `docs/agents/reviews/`, its status §4.17.
- **The Revolut X account the key sees is the loop's alone.** The floor counts a live buy it cannot read back by
  the venue's balance beyond the settled book, and every live sell is capped at that balance (reference §4.24).
  A trade made there by hand would be counted and could be sold by the floor: never trade by hand in that
  account, and tell Davies so whenever the subject comes up. The same holds for PR5's sub-account (key `_2`):
  its executor books fills and inventory from that account's balance as its own.
- **The Revolut X connector** (claude.ai's, connected 2026-10-02) is
  read-only and sees Davies' own account, not the loop's and not PR5's
  sub-account: a session reads public market data through it (pairs and
  their minimums, books, tickers, trades) and the strategy accounts through
  the database and the `probe`, as before.
- Verify a key read-only before anything depends on it: the `probe`
  action (balances, pair config for every symbol on an active row, a
  signed call with a query, Revolut X active orders and Kraken closed
  orders — the field names the settlement path will read — Kraken
  `AddOrder validate=true`, Jev on both transports, and since 2026-09-23
  Binance's permissions, fees and symbol rules and Deribit's auth scope
  and DVOL; since 2026-09-24 PR5's sub-account and the Polymarket account,
  reference §2d; since 2026-09-26 the YouTube key). It places nothing.
  `?only=binance,deribit` runs just the parts named (`revx`, `revx2`,
  `kraken`, `jev`, `binance`, `deribit`, `polymarket`, `youtube`). The
  weather feeds' keys have a function of their own, `weather`, whose
  `?action=probe` (`meteofrance`, `faa`; cron bearer only) does the same
  for them (2026-09-27): the FAA's feed needs Solace's npm client, which
  stays out of the live loop's isolate.
- **Polymarket may open a position only from Ireland, and only while
  Davies is there** (reference §2d, §6). The United Kingdom is "close-only
  on the frontend AND the API"; Ireland is close-only on the frontend only
  ("the API itself is not restricted"), and Davies is resident in both
  (his word, 2026-09-24). So the order path (`_shared/polymarket_orders.ts`,
  `agents/pm_live.ts`; built inert by `0074`, readied for its live
  calibration by `0076` on 2026-10-01, `reviews/2026-10-01-polymarket-live-calibration.md`)
  runs only in Supabase's `eu-west-1` (its cron row carries
  `forceFunctionRegion=eu-west-1`; every POST refuses unless `SB_REGION`
  is `eu-west-1`), and opens a position only while his attestation that
  he is in Ireland is current. **Since `0076` the code's switch
  `PM_ORDER_SENDS_ENABLED` is true and the action loads
  `POLYMARKET_PRIVATE_KEY`, kept only when its address IS the stored
  signer (held in a private field, scrubbed from every message): what
  keeps every order home is the config row, `dry_run` true and
  `live_confirmed_at` null.** Setting the constant false again is the
  code's own kill switch. The calibration (Davies: "同意你polymarket的方案";
  about $400, "polymarket的策略我决定还是听你的转400美元进去追求最优效果") is
  RW's rule as RW-E applies it on rewarded markets of $6 to under $10 a
  day, outside RW's and RW-C's universe, measuring R = actual ÷ formula
  rewards; caps $320 in all (the deposit less the $75 stop and $5) and
  $60 a market, stops −$25 a day and −$75 in all (the day's counts only the day's change since 2026-10-07, "只算当天变化":
  each holding from its mark at 00:00 UTC, or its cost if bought that day; the total counts every holding from cost, a
  carried loss included; mid-pool's the same, and live-prep has no day stop). Going live is ONE
  statement, in the conversation where he says go, which sets the cap
  from the balance the path itself read (refused when unread, stale or
  too small, and since `0084` without the key loaded, outside eu-west-1,
  without a current attestation, or while mid-pool is armed) and arms
  it — the design doc has it word for word. A cancel
  is read again before its slot freezes (`PM_LIVE_CANCEL_REREAD_MS`, as
  PR5's), and a refused quote waits for new information.
  **It is standing since 2026-10-01** ("我之后长期在爱尔兰，如果变动需要更改会和你说，
  不和你说关就一直没事 也不用问我"): current until he says it changed — then
  one statement revokes it (`update public.pm_live_config set
  ireland_until = now() where id = 1;`) — and nobody asks him. Not
  current, the path may only reduce or close, which the UK allows. Never a VPN,
  a proxy or anyone else's account. `_shared/polymarket.ts` (the probe's
  client) is read-only (GET only, a fixed list of URLs, the L2 headers to
  the CLOB host only); the key controls real funds.
  Its paper row is "Reward quotes mini-pool" ("small-pool" until
  2026-10-02, and first "live-prep", the name the third instance carries
  since `0091`; mini-pool's check windows were closed on 2026-10-04 by
  its pre-registration's Addendum 7, so it is no longer a go-live
  candidate; since `0103`, 2026-10-08, its row is off the page and its two calls are off, on Davies' word, its config row
  untouched, so mid-pool's readout finds its column empty from 10-09); since `0080` its dry-run runs at the go-live size, eight
  markets and $160 of first quotes, and only Davies' word in the
  conversation arms it: no routine runs the go-time statement ("什么时候
  上线我说了算不自动转了"). **Since 2026-10-04** (its pre-registration's Addendum 6) each minute's formula scores our quotes in
  the book as the venue holds them, the paper pays a matched minute that figure, and mini-pool's selection takes first
  the books with two levels of the reward minimum within 10 ¢ of the touch on each side, the rest only for what they leave
  (`PM_MINI_QUALITY`); mid-pool takes the formula only (its Addendum 2). **"Reward quotes mid-pool"** (`0081`,
  `agents/pm_mid.ts`, 2026-10-02) runs the same path and paper layer again
  as a second instance on $10–$50 pools, at mini-pool's go-live size, and
  since `0084` (Davies: "把mid-pool 的结构和路径也做成和mini-pool一样的真实下单路径，
  按上线规模跑 dry-run") on the same footing: the key loaded for the stored
  signer, the same keyed wire, its config row the lock (`dry_run` true,
  `live_confirmed_at` null). **The two trade one account and are never
  both armed**: a trigger on both configs refuses arming one while the
  other is, and each go-time statement refuses it too (the design doc's
  steps 8 and 8m). **A funded mid-pool is being readied** (Davies,
  2026-10-04: "准备mid-pool的上线，确保和现在的策略一致"): its
  pre-registration is a draft (`reviews/2026-10-04-polymarket-mid-pool-live-prereg.md`)
  that freezes on his go date, no earlier than the overlap audit
  (2026-10-23 00:05 UTC); its margin was measured again on 2026-10-04
  (0.67 overlapped in 4 of 111 pairs, 0.8 in none; the draft keeps 0.67,
  the dry-run's rule); and a change that makes each path book only the
  payouts of the markets it quoted live was built on 2026-10-04 and
  applied on 2026-10-08 for live-prep's go (its pre-registration's
  Addendum 4); mid-pool's own go-live stays his. It
  leaves out every market RW's frozen selection, recomputed from
  public data, takes or scores at ≥ 0.33 of its last pick, never reading
  `pm_rw_*` or `pm_rwc_*`. Its config holds a copy of the attestation, so
  a revocation also runs `update public.pm_mid_config set ireland_until =
  now() where id = 1;`. **"Reward quotes live-prep" is the lead candidate
  to go live** (`0091`, `agents/pm_lp.ts`, reference §4 item 54; Davies,
  2026-10-04: "目前上线live的最大candidate是这个live-prep策略", and mini-pool's
  check windows closed by its Addendum 7): the same path and layer as a
  third instance on every pool of $10 a day and over, RW's and RW-C's
  markets included ("不考虑其他一切因素"), with its own rules as options only
  its instance sets (a sell of what is held before a buy, 5N, x2's pause,
  exits from carried markets, no end-date horizon, no weather market, ten
  markets and $200, $100 a market, a −$75 stop on fills plus what was paid,
  no day stop); in dry-run it decides on its paper layer's holdings. **Since 2026-10-10 it reads each quoted market's
  reward programme every minute before anything rests** (Addendum 9, `0111`; Davies: "策略每分钟读的时候都检查奖励配置"): a
  market whose programme ended, fell under $10 or now asks more than N = 20 takes no entry that minute (its sells rest
  on), three live minutes of Polymarket reading neither side scoring take it out for the day, and R and today's estimate
  rest on the formula Polymarket scored. **Live, its total cap follows its equity since
  `0106`** (Davies, 2026-10-09: payouts and deposits used at once; its pre-registration's Addendum 8): every turn
  floor(pUSD + held at cost + unredeemed − $75 − $5), at most $1,000, down at once, up only on two agreeing readings with
  no fill settling, never on an unread balance (`lpCapital`); `reinvest = false` on its config puts the fixed $320 back. Its
  pre-registration (`reviews/2026-10-04-polymarket-lp-prereg.md`) checks
  d1, the first full UTC day after `pm_lp_config.created_at`; its go-time
  statement is the design doc's step 8lp, and its go also needs the
  payouts-per-path change (applied 2026-10-08), the account funded (pUSD ≥ $81) and the
  probe's read of the conditional-token allowances. **The three trade one
  account and only one is ever armed**: 0091's trigger refuses arming any
  config while another is. Its config also holds a copy of the attestation:
  a revocation runs `update public.pm_lp_config set ireland_until = now()
  where id = 1;` too. **Their dry-run record keeps 14 days** (`0101`,
  review F4, 2026-10-08): `pm_paths_prune()`, daily, deletes each path's
  dry-run minutes and ended dry-run orders (never one a fill names) and its
  paper layer's minutes older than 14 days, and never later than a day
  before what the paper layer has decided; nothing of mode `live`, no fill,
  day, settlement, event or state row. Every frozen check that read those
  rows has run, and what is left to run reads none of them (the
  migration's header lists each). A new instance's tables join it in the
  migration that adds them, or that migration says why not; a check or
  study that needs older dry-run rows says so before they age out.
- **RW — quotes for Polymarket's liquidity rewards — runs on PAPER for
  fourteen days** (§3.33, §4 item 36, migration `0053`, 2026-09-24 on
  Davies' word): 2026-09-25 → 10-09 UTC, the spec frozen at
  `reviews/2026-09-24-polymarket-rw-paper-spec.md`. `agents?action=pmrw`
  (every minute) stores each minute's book and decides it two minutes
  later from the public prints; `agents?action=pmrw-select` (every five
  minutes) picks the UTC day's portfolio once. Every read is keyless
  (`_shared/polymarket_public.ts`) and nothing is placed. Two limits
  shaped it: the data API and Gamma are cached by CloudFront for five
  minutes, so a read that must be current carries a parameter no earlier
  read carried; and an Edge request gets 2 s of CPU, so the selection asks
  Gamma only about the markets it takes. After 10-09 both calls do nothing;
  `0103` (written 2026-10-08, ahead of the verdict) takes them out of the list once `pm_rw_days` holds 10-08, and
  `pmrw-e`, `pmrw-x` once their replays hold it on every arm (`public.retire_after_rw()`, every five minutes). On the Agents page it is
  the last row of TESTING STRATEGIES, "Reward quotes" on Polymarket, with a
  page of its own (Davies, 2026-09-24; `agents/pmrw_view.ts`). TESTING's
  scoreboard includes it, on the Polymarket card rather than Revolut X's.
- **Polymarket's rewarded markets are recorded for research** (`0092`, `agents/pm_book_rec.ts`, reference §4 item 55;
  Davies, 2026-10-04): every minute the books of every market paying $10 a day or more and of every market a Reward
  quotes path holds or quotes, a fifteenth of all ~18,900 rewarded markets summarised, and the set's prints, as gzip'd
  frames in `pm_rec_frames`, moved each closed hour to the private Storage bucket `pm-rec` and indexed in
  `pm_rec_archive`. Keyless reads, its own tables, leases and `edge_calls` rows; nothing of a trading path reads it, and
  a new Reward quotes path is one line of `PM_REC_OURS_SOURCES`. An archive row's signed URL opens its object to anyone
  for a year: read it with SQL, never commit it. Frames the archive has not taken in six hours are dropped: the
  database's budget outranks the record.
- Secrets already in Supabase: `Revolut_X_API_kEY` + `REVOLUT_X_PRIVATE_KEY`,
  `Revolut_X_API_kEY_2` + `REVOLUT_X_PRIVATE_KEY_2` (a second Revolut X
  sub-account for PR5's GBP stablecoin quotes, Davies 2026-09-24; read by
  the probe and by PR5's live executor — balances every minute, the order
  endpoints only once it is live),
  `KRAKEN_PRO_API_KEY` + `KRAKEN_PRO_PRIVATE_KEY`, `openrouter_api_key`,
  `typesafe_API_KEY` (fallback), `Binance_API_KEY` + `Binance_SECRET_KEY`,
  `Deribit_CLIENT_ID` + `Deribit_CLIENT_SECRET` (both accounts unfunded as
  of 2026-09-23; Deribit cannot be funded from here), and the Polymarket
  account another tool stored on 2026-09-24: `POLYMARKET_PRIVATE_KEY` (the
  Magic-exported key; it controls the funds), `POLYMARKET_CLOB_API_KEY` /
  `_SECRET` / `_PASSPHRASE` (each also as `POLYMARKET_API_*`), and the
  settings `POLYMARKET_FUNDER_ADDRESS`, `POLYMARKET_SIGNER_ADDRESS`,
  `POLYMARKET_SIG_TYPE`, `POLYMARKET_HOST`, `POLYMARKET_CHAIN_ID` — read by
  the probe only; and `YOUTUBE_API_KEY` (Davies, 2026-09-26), a Google API
  key for the YouTube Data API's public view counts, sent in the
  `X-Goog-Api-Key` header and never in a URL, 10,000 units a day, read by
  the probe and by the view-count recorder (`agents?action=views`, `0062`,
  reference §4 item 38); and the weather feeds another tool stored on
  2026-09-27 on Davies' sign-ups: `METEO_FRANCE_API_KEY` +
  `METEO_FRANCE_USERNAME` (Météo-France's DPObs v2, Paris-Le Bourget's
  6-minute readings, 100 requests a minute; the key first stored was an
  access token that lived six minutes, so the API needs a long-lived API
  key there or the portal's `METEO_FRANCE_APPLICATION_ID`, from which the
  function mints its own tokens; the username is the portal login,
  `daviesluo`, which the API never reads) and fourteen `FAA_SWIM_*` (the
  FAA's SWIM SCDS subscription: ITWS, a Solace queue reached over SMF on
  TLS only, holding seconds of messages; a subscription idle for 60 days
  may be disabled; ITWS carries no temperature, only terminal hazard
  products, and SCDS offers no METAR until CSS-Wx joins it, expected in
  Q4 2026, reference §6), read by the `weather` function. Never print
  them, never move them.
- **A study prices speed at one second** (Davies, 2026-09-26): pg_cron 1.6.4
  on the project runs a job every 1–59 seconds, so a strategy that needs to
  act faster than a minute is studied at 1 s, not at the minute the loop
  happens to run. Below a second, the thing to study is an always-on
  Cloudflare Worker (the Cloudflare connector is on; a session reads it,
  and deploying anything there is his call). A source's own limit can bind
  first, and a study names it with its number: YouTube's 10,000 units a
  day is one read every 8.6 s on average. The speed study (reference
  §3.39) found the source binds temperature, post counts and view counts,
  the venue binds PR5 and nothing binds the crypto rows: the loop stays
  at a minute and no Worker is deployed until a source faster than every
  keyless one is found.
- **Every recurring Edge call is a row of ONE cron job,
  `edge-calls-every-minute`** (`0063`, 2026-09-27) — all but the
  `monitor` function's, which the Cloudflare Worker calls on its own clock
  precisely so that it runs while pg_cron does not (see "The production
  monitor") — and that job queues every call
  due in its minute in one statement. pg_net 0.20 runs a batch until every
  request of it has answered and only then reads its queue again, so a call
  queued by a job of its own waits behind the slowest call already running
  (`books` ~44 s, a view window ~56 s): with nine jobs the tick started more
  than 5 s late in 145 of 1,393 minutes. **Since `0075` (2026-10-01) the
  list is a table, `public.edge_calls`** (path, timeout, every N minutes,
  last UTC hour, `enabled`, `retry`): a new recurring call is a row a
  migration inserts, and a call leaves by `update public.edge_calls set
  enabled = false where path in (…)`; `src/cron_jobs.test.js` replays every
  statement on the table and fails on a second job that calls pg_net.
  **No call is lost to the platform's boot failures** (503 `BOOT_ERROR`,
  about 0.1 % of calls; Davies: "彻底修复"): every function the job calls
  writes a beat before its work (`_shared/beats.ts`, `edge_call_beats`,
  minute stamped by the database), and `edge-watchdog`, a row of the job,
  runs a due call with no beat again 13 s into its minute, once, recorded
  in `edge_call_retries`. **A new recurring call joins the watchdog in the
  migration that adds it** (Davies, 2026-10-01: "之后如果有新的调用适合加入
  看门狗的也记得及时更新"): its function writes its beat before its work
  (`beatKeyOfRequest("<fn>", req.url)`, which the test checks), or it runs
  twice a minute, and its row's `retry` is true unless a second run in its
  minute would change what the first did — then false, with the reason in
  the migration, as 0075's table gives one for every call (`pmrw`, `pmrwc`:
  their frozen specs read the book at `t`). When that reason goes away, the
  change that removes it switches the call on (`update public.edge_calls
  set retry = true where path in (…)`). A call fired by hand through
  pg_net waits for the batch in flight and holds the next minute's for as
  long as it runs past the minute. **Every row waits under a minute**
  (`0099`, review F6: the two selections' 290 s became 55 s; a selection
  still running goes on under its lease, `runSelectKeptAlive`), and a new
  row's `timeout_ms` stays under 60,000, which the test checks. **A new row waits fifteen minutes** (`0104`, 2026-10-09,
  review D1: 0100's row first called `trading212` 21 s before its new code
  deployed): `edge_calls.active_from` defaults to `now() + 15 minutes`, the
  minute job and `edge-watchdog` skip a row until then, and an insert never
  names it, which the test checks.
- **The interview showcase mirrors this section** (Davies, 2026-09-30):
  `showcase/daviesportfolios/README.md` in the private `daviesluo/personal`
  repository explains every strategy for his interviews, with no figure from
  the real book. A change to the strategy set, a verdict, or a moved number it
  quotes updates that page and rebuilds its PDF in the same week (the
  working-with-davies skill has the steps).
