# Working on this repo

A few standing instructions for Claude Code sessions.

How the owner actually works — what "done" means, what counts as
evidence, settled chart/ledger rules, past mistakes — is
`.claude/skills/working-with-davies/SKILL.md` (auto-loaded). Cursor
loads the same text from `.cursor/rules/working-with-davies.mdc`. The
live handover record is `LEDGER.md`; `docs/handover.md` is its archive.

## Documentation

- **Keep the docs in sync as part of every change** — don't wait to be
  asked. `docs/map.md` is the source-of-truth map of the system: when a
  change adds or removes an Edge Function, migration, `src/` module,
  workflow or script, update its row there (and the engineering notes,
  stack or data flow if they change) in the same commit. A row is ONE
  line saying what the file is for; why it is built that way goes in the
  file's own comments, never back into the row — appending each change's
  story to its row is how the README reached 275 KB.
  `src/docs_map.test.js` fails when a file has no row or a row names a
  file that is gone. `docs/guide.md` says how to use the site, in plain
  words for a user; update it when a user-facing feature changes. A
  change that lands without its docs update is incomplete.
- **`README.md` is the public front page, and it stays one page**
  (Davies shows the repo in interviews; he had it cut from 275 KB to
  10 KB on 2026-09-23): the pitch, the live example at daviesluo.com
  (password: contact Davies), screenshots in `docs/screenshots/` with
  every dollar amount masked by the site's hide-values mode, what it
  does, how it's built, how he works, the crypto loop, and a
  one-row-per-folder map. Touch it only when one of those changes. It is
  written in his voice — first person, plain words, short sentences, no
  slogans — and detail goes to `docs/map.md`, never back into it.
- **No personal financial figure goes into `README.md`, `docs/guide.md`
  or `docs/map.md`** — no balance, position value, share count, lot
  price or P&L in dollars from the real book; describe the engineering
  with neutral wording instead.

## The ledger

This repository runs the **ledger protocol**, whose full text is
`.ledger/SKILL.md` (invoke it as `/ledger`; pointers sit at
`.claude/skills/ledger/`, `.cursor/skills/ledger/` and
`.agents/skills/ledger/`). Read it before your first ledger entry. What
follows is only this repository's half of the arrangement.

**`LEDGER.md` at the root is the live record.** Three parts in order:
what remains right now, machine and platform setup, then history newest
first. A resuming session reads it first and works down the list. It is
kept SMALL on purpose — every session on every platform pays context for
it on every wake.

**`docs/handover.md` is its ARCHIVE**, not a second live document. It holds
the decision log and the raw session transcripts, 35k lines of them, and
is opened only when a closed item is reopened or audited. When an
operation closes, its block moves there verbatim and one line at the head
of the ledger's history records the move. Do not maintain both as
running records: two handover documents drifting apart is the exact
failure the protocol exists to prevent.

**The rule: the ledger moves with the work.** Every commit that changes
anything a later session would need to know about carries its ledger line
in the SAME commit, or the very next one. Never at the end of the day.
The session that plans to write it later is the session a usage limit
cuts off first.

**The hook enforces it.** `bin/hooks/pre-commit`, reached through
`core.hooksPath`, refuses a commit whose ledger is two behind, and
refuses a new history section that does not open with a source header.
Both are per-clone config a rebuilt container loses — the commands are
in `LEDGER.md`'s machine-setup section. The escape hatch is
`LEDGER_OK=1 git commit`, for the three cases the refusal names; reach
for it before `--no-verify`, which switches off every gate rather than
the one that does not fit.

**Source headers.** Each history section opens with a timestamped header
naming the platform and the model, in the exact shape the hook checks —
see `.ledger/SKILL.md`, and `.ledger/EXAMPLE.md` for a filled-in one.
Sessions running under an operator rule that forbids model identifiers in
pushed artifacts write `Model: not recorded (session policy)`; that
satisfies the gate and says why the field is empty.

**Before you finish**, and the moment a usage limit looks near: stop
opening new work, land the smallest COMPLETE unit, write its ledger line,
push, and spend what is left making the what-remains list exact. That
list is the entire briefing the next session gets.

Keep `.claude/skills/working-with-davies/SKILL.md` (and its two Cursor
copies) in step whenever a session learns something durable about how the
owner works, or pays for a mistake worth not repeating. The skill is the
distilled agreement; the ledger and its archive are the evidence behind
it.

Do not copy live balances out of `LEDGER.md` or `docs/handover.md` into new
files, issues, or anything public. The repo is private; those files quote
real positions.
## Agents (crypto, Revolut X + Kraken + TypeSafe Jev)

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
  record whether the book came back and where price went 15 and 60 minutes
  after; that gap is the adverse selection §3.13 could not compute, and a
  probe is never an order and never reaches any book; the dashboard computes
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
  clears window A alone now. Its seat was re-judged on the windows it has:
  keep it, because the evidence cannot decide either way (the pre-registered
  test's p = 0.18 / 0.26). A coin joins a rule by that bar, never by a
  result alone; SUI's round trip is ~33 bps at its median book (§3.20;
  §3.8 assumed ~42) against the majors' 20. **A coin one venue lacks may run on the other
  alone** (Davies, 2026-09-21; §4.16): the two venues' symbol lists need
  not match — each `agent_strategies` row carries its own. A Kraken-only
  coin clears the same bar on Kraken's costs (40 bps maker a side, 80 bps
  a round trip before the spread) and a Kraken book of ≥ $100k a day, and
  joins the Kraken row only, paper first like everything else.
- **The set that is recommended for live is ONE row**: `trend-4h` on
  Revolut X, BTC/ETH/SOL/AVAX/SUI, five equal $20 slots, $100 — the
  allocation study's answer (§3.11) and the go-live brief's
  (`docs/agents/go-live.md`), reached independently. Equal slots per
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
  migration is drafted at `docs/agents/0048_go_live.sql.draft` — a NEW
  row `trend-4h-live`, with `trend-4h` kept paper as its same-venue
  control — and moving it into `supabase/migrations/` IS going live.
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
  (`version`, `kind`) and priced before the loop asks it.
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
- **THREE ROWS run after migration `0046` (2026-09-22, §3.17, §4.22)**: `trend-4h`
  on Revolut X (the live candidate, $100),
  `momentum-1d` on Revolut X (paper, $40) and `trend-1h` on Revolut X
  (paper, $40 — kept for feedback speed, 31.7–56.1 fills per 90 days
  against the live row's 14.6–26.8, and because at 0.63 it is the only row
  with no near-duplicate; its return is inside chance and inside the
  spread error bar and is NOT read as evidence). Row capital $440 → $280;
  no cap moves. **`trend-4h-kraken` was DELETED by `0046`** (Davies'
  word): it made no decision of its own — 50 of 50 paired decisions matched
  `trend-4h` exactly — nothing read its fill path, that path's accuracy was
  measured keylessly in 18 minutes (79 % / 91 % of resting orders reached
  in 1 / 5 minutes against the loop's model's 82 % / 92 %), and it paid
  4.44× the fee for identical fills. **Kraken is a SIGNAL venue only from
  here**: every rule reads its candles; nothing executes there, and the
  page is swept in that shape. **Retired**: `momentum-1d-kraken`, `rotation-1d`,
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
  rejected; a BTC-regime filter on entries is the one written-down
  candidate, to be re-tested on a non-bear window before any paper twin)
  were tested and rejected with numbers — a faster rule is a fee schedule
  until data says otherwise.
  Backtests: reference §3.3a–§3.7, run with the loop's own fills, stops
  and cooldown — including the rotation rule since 2026-09-21, where the
  8 % floor turns out to make it WORSE on five variants of six (§3.4); the backtester writes `docs/agents/backtests/summary.json`
  itself and reports a parameter plateau per coin; `frequency.json` there
  is §3.6's raw output, `universe.json` (`--study universe`) §3.7's,
  `universe20*.json` §3.8's and `ideas.json` §3.9's.
- The tick claims a bar by inserting its decision (unique index on
  strategy, symbol, bar_start; a protective decision claims one second
  INTO its minute, never a bar start; a dislocation decision the minute).
  An allowed decision whose order never reached the book is placed on a
  later turn, and the order insert is the claim on that attempt (`0041`).
  A live order is written as `pending` BEFORE the venue is called and
  reconciled by client id next turn; **one the venue does not list stays
  pending for a person to settle — never marked rejected on a guess** (a
  marketable order fills or dies inside the turn). A cancel whose
  read-back fails leaves the row open. The fills query is paged. The
  daily loss limit blocks new risk only, never an exit; a resting exit
  order never outranks a stop (it is cancelled first); a re-quote passes
  the same gate as any order. Paper twins have their own exposure cap
  (`paper_exposure_usd`) so they measure independently. The pre-live
  review that found these is `docs/agents/reviews/`, its status §4.17.
- **The Revolut X account the key sees is the loop's alone.** The floor counts a live buy it cannot read back by
  the venue's balance beyond the settled book, and every live sell is capped at that balance (reference §4.24).
  A trade made there by hand would be counted and could be sold by the floor: never trade by hand in that
  account, and tell Davies so whenever the subject comes up.
- Verify a key read-only before anything depends on it: the `probe`
  action (balances, pair config for every symbol on an active row, a
  signed call with a query, Revolut X active orders and Kraken closed
  orders — the field names the settlement path will read — Kraken
  `AddOrder validate=true`, Jev on both transports). It places nothing.
- Secrets already in Supabase: `Revolut_X_API_kEY` + `REVOLUT_X_PRIVATE_KEY`,
  `KRAKEN_PRO_API_KEY` + `KRAKEN_PRO_PRIVATE_KEY`, `openrouter_api_key`,
  `typesafe_API_KEY` (fallback). Never print them, never move them.

## Git workflow

- **Push `main` directly.** No feature branch, no PR, unless he
  explicitly asks for Codex review. Each commit is its own logical
  unit; if the work spans multiple concerns, split into multiple
  commits before pushing.
- **PR only when he asks.** `@codex` only reviews PRs — e.g. a new
  Edge Function, anything that touches `auth` or migration state, if
  he wants that second look. Don't open one otherwise.
- Run `sh bin/gates.sh` before every push: it runs every gate CI runs,
  in CI's order, and stops at the first failure. Push only when it ends
  with `all gates green`.
- Cloudflare Pages and the `typecheck-and-build` GitHub Action run on
  every push. If a push leaves `main` red, fix-up commit on `main` is
  the next priority — don't move on to new features while CI is broken.
- Never force-push `main` and never bypass hooks (`--no-verify`)
  without explicit user confirmation in the same message.
- Keep commit messages focused on **why**, not **what**.
- **Commit as the repo owner, never as Claude / Anthropic.** Every
  GitHub contribution must land in the owner's name so the graph
  reflects them. At the start of each session set the git identity
  before committing:
  `git config user.name "daviesluo" && git config user.email "daviesluo@gmail.com"`
  (containers clone fresh, so this resets every session — set it each
  time). Do NOT author/commit as `Claude <noreply@anthropic.com>`, and
  do NOT add a `Co-Authored-By: Claude …` trailer.

## Edge Function deploys

`.github/workflows/edge-functions.yml` auto-deploys every changed
`supabase/functions/<name>/index.ts` on push to `main`, gated by
`deno test supabase/functions/`. Requires repo secrets
`SUPABASE_ACCESS_TOKEN` (account PAT) and `SUPABASE_PROJECT_REF`
(project ref id). When a commit changes an Edge Function:

1. Add / update the matching `index.test.ts` so the pure helpers stay
   pinned — the workflow's deploy step won't run if `deno test` fails.
2. Commit + push as usual. The workflow takes care of the deploy.
3. Verify in the Supabase dashboard → Edge Functions list that the
   "Last updated" timestamp jumped to the deploy run.

If the deploy secrets are missing or revoked the workflow logs a
warning and exits 0 — the push doesn't go red, but production stays
on the previous version. Fallback in that case: paste the new
`index.ts` into Supabase dashboard → Edge Functions manually, same as
the pre-CI workflow.

The `Deno.serve(...)` entry in each `index.ts` is wrapped in
`if (import.meta.main)`. Preserve that guard — without it, importing
the function's pure helpers from `index.test.ts` would bind a port.

## Testing

- `npm run typecheck` — tsc with `checkJs` + `strictNullChecks`, no type
  errors should slip through. The `useState(null)` / `useRef(null)` slots
  carry JSDoc `@type` annotations; keep new ones annotated.
- `npm run lint` — ESLint (flat config, `src/eslint.config.js`). A bug gate,
  not a formatter: errors on `react-hooks/rules-of-hooks`, warns on
  `exhaustive-deps` (a few effects intentionally narrow their deps). Runs
  in CI between typecheck and test.
- `npm test` — vitest. Over 900 cases covering: YTD chart math, fetch /
  proxy strategy, ticker-shape predicates, cache TTL + LRU, per-proxy
  backoff, market-cache + legacy fallback, SW banner suppression
  window, ops-badge desktop gate, portfolio user-fingerprint diffing,
  T212 sync application, and the chart-modal indicator math (MA /
  VWAP / TTM-EPS-P/E / extended-hours-bar detection). Add a pin
  test whenever a regression is fixed so the bug can't quietly come
  back.
- `npm run build` — Vite production bundle, output to `dist/` (committed;
  Cloudflare Pages serves only that directory).
- `npm run verify:browser` — the whole-app browser sweep in
  `bin/app-sweep.mjs`: serves the COMMITTED bundle over http and
  drives it in real Chromium at both breakpoints (208 checks). A hard CI
  gate since 2026-09-17. Its clock is pinned, so it gives the same answer
  at any hour — do not replace `CLOCK` with a live `Date`. Needs
  `npx playwright install chromium` once per machine; a container that
  ships its own Chromium can set `PLAYWRIGHT_CHROMIUM_PATH` instead.
  Every bug it has caught was live while `npm test` and the Edge suite
  were green, because each was an integration failure.
- `npm run verify:perf` — the performance-panel matrix in
  `bin/verify-perf-matrix.mjs`: 60 cases (two views × five ranges ×
  three recorded-data states × two books) read back from the committed
  bundle and compared with answers worked out by hand. A hard CI gate
  since 2026-09-23. Its clock is pinned too (`PERF_MATRIX_CLOCK` moves
  it), and it refuses an instant its fixture cannot serve: its "18
  failures" were all 14:00–20:00 UTC, where the fixture's first bar has
  left the 24H window and the app was right.
- `deno test --allow-env supabase/functions/` — Edge Function pin
  tests. Required locally before pushing changes to any
  `supabase/functions/<name>/index.ts`; CI runs the same on every PR
  and push to main. Each function's pure helpers are `export`ed and
  pinned by a co-located `index.test.ts`.

When refactoring chart math, add a test pinning the formula's output
for the affected case so the YTD bugs (+80% / +21% / +9% misreports)
can't quietly come back. Same rule applies to Edge Function helpers
— extract the pure logic and pin it in `index.test.ts`.

Note: `vitest` 4 runs on the project's own Vite 8 (rolldown / oxc), the
same pipeline `npm run build` uses; the esbuild-deprecation warnings of
the Vite 5 era are gone. A transpile-sensitive change is still worth
eyeballing in a real `npm run build`, because the browser sweep tests the
bundle and vitest tests the modules.

## Storage

Persisted state lives under the `dp.*` namespace with a single schema
version (`Storage.migrate()` in `src/storage.js`). When the data shape
changes, bump `CURRENT_SCHEMA_VERSION` in `src/storage.js` and add a
migration step instead of inventing a new key.

## Pull requests

Codex's `@codex` bot reviews PRs only, not direct commits to `main`.
Default is direct push; the owner catches issues via Cloudflare
preview deploys and real-world testing. Open a PR only when he asks
for Codex — then wait for the review and respond to
`get_review_comments` before merging. The T212 rollout (PR #129)
caught both the per-share-vs-total cost bug and the boundary-race
concern this way.

**While a PR is open its description is part of the branch, and it is
maintained the way `LEDGER.md` is — in real time.** Every push that
changes the diff rewrites the description in the same step, before the
turn ends. Never leave it describing the previous push: it is read as
the current state of the branch, so a stale one actively misinforms.

Each rewrite has to leave these true:

- **It describes only what the PR would add to `main` right now.** Work
  that lands on `main` separately stops being this PR's work — take it
  out of the summary, and out of the branch. **Rebase onto `main`;
  don't merge `main` in.** A merge drags `main`'s own commits into the
  PR's commit list, where they read as unreviewed work the PR is
  proposing.
- The commit table matches the commits. Rewrite it whenever the history
  is rewritten.
- The test plan names what was actually run against the tree being
  pushed — the gates, the browser verification, the counterfactuals.
- Risks say what merging does to production: a migration
  `migrations.yml` will apply, an Edge Function that redeploys, a
  behaviour change that touches live data.
- **The Cloudflare Pages preview link is in it**, near the top, so the
  branch can be checked on a real machine before it merges.

Cloudflare Pages aliases every branch to
`https://<slug>.daviesportfolios.pages.dev`, where `<slug>` is the
branch name lowercased with every non-alphanumeric run collapsed to `-`
and truncated to 28 characters — `claude/repo-audit-restore-uverhn`
becomes `claude-repo-audit-restore-uv`. Verify it before quoting it:
fetch the URL and check the `assets/app-<hash>.js` it references is the
one committed on the branch, not the one on `main`.
