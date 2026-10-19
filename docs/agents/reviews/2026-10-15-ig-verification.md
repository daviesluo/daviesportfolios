# IG verification on the demo account: the read-only function, G0, G3, S1a's frozen run, and a wider strategy search (2026-10-15)

Davies, 2026-10-15: "ig我的账户开好了，api也加了" and "FXW-AUD你继续验证研究并记录，除此之外你再深度研究下ig的spread
betting和cfd的策略，如果策略够好我愿意承担一定风险".

**Headline.** The `ig` function and its recorder are built, gated and ready to land before Saturday 10-17; nothing of
IG's has been read yet, so S1a is frozen and scripted, not run. FXW-AUD's historical bar passes on an independent
recomputation, IG's documented hours put its Sunday quote an hour ahead of FXCM's, and FXCM's minute paths show a tight
stop destroys the rule while a ~200 bps guaranteed stop caps its tail for ~3 bps a trade. The wider search (intraday
momentum, emerging-market carry) found nothing; FXW-AUD stays first.

**What this is.** The first run of `backtests/ig_deepdive/SPEC-for-verification.md` (Muse's frozen spec, G0-G4 and S1-S5).
His message meets the spec's starting condition for the demo read-only work: the accounts exist, he stored the demo
credentials himself as Edge secrets, and he said to continue. Because those secrets live only in Supabase, reaching IG is
a small Edge Function, which is the separate build the spec's hard rule 3 reserved for his ask. Nothing in this work
places, amends or closes anything, reads the live credentials, or calls the live host. No live trading is designed to
start without his explicit go.

## 1. What was built: the `ig` Edge Function and migration 0122

| part | what it does | spec |
|---|---|---|
| `ig/client.ts` | The only door to IG. Every request is built on `https://demo-api.ig.com/gateway/deal` and checked before `fetch`: any other host (the live `api.ig.com` above all), scheme, port, path or query parameter throws. Allowed: `POST /session` (log in), `PUT /session` (switch between the two demo accounts), GET `/accounts`, `/markets` (by epics or a search term), `/markets/{epic}`, `/marketnavigation[/{node}]`, `/prices/{epic}`, `/clientsentiment[/{marketId}]`. Reads only `IG_API_KEY_DEMO`, `IG_DEMO_USERNAME`, `IG_DEMO_PASSWORD`. Scrubs the key, username, password, CST and X-SECURITY-TOKEN (raw and URL-encoded) from every answer, row and error. A request budget per run and a gap between requests keep a run inside IG's 30 non-trading requests a minute per account. | hard rules 1, 2, 8 |
| `ig/epics.ts` | Picks the epic for each role (AUD/USD, US 500 cash and dated, Wall Street, US Tech 100, UK 100, Germany 40, and the seven weekend markets) from IG's own search answers on each account, keeps every candidate seen, and accepts a pin (`?pin=role:EPIC`) if a person disagrees. | G1 |
| `ig/windows.ts` | UK wall-clock time written out from the law (BST from 01:00 UTC on the last Sunday of March to the last Sunday of October), the recorder's windows, and the frozen G2 pull windows. | G2, G4 |
| `?action=facts&account=sb\|cfd` | One account a call: session and account list with every balance and the client id removed, the market navigation's root, the search answers, the chosen epics and each one's `/markets/{epic}` details (dealing rules, minimum size, margin bands, opening hours, rollover), AUD/USD's client sentiment, IG's `Date` header against the function's clock. One `ig_facts` row. About 34 requests 2.5 s apart. | G1 |
| `?action=history&account=…&plan=probe\|fxw\|wknd\|esg` | The plan's frozen windows, one `/prices` HOUR request each (`pageSize=0`), newest weekend first; the raw answer and the allowance IG reports go to `ig_price_pulls`. The probe plan runs first and a bulk plan is refused until it has; no window is asked for if it could take the week's remaining allowance under 500 points; IG's "allowance exceeded" stops the run. `dry=1` lists what would be pulled and calls nothing. | G2 |
| `?action=quotes` | In the weekend windows, two snapshots a minute (at the minute and 30 s in) of each demo account's epics, by `GET /markets?epics=…&filter=SNAPSHOT_ONLY`. A quote row starts when bid, offer or market status changes and is extended while they do not (`ig_quotes_record`); every run is a row of `ig_quote_runs` (snapshots, requests, logins, switches, clock offset, error). The first failure of a streak goes to the errors box (`ig.quotes`), then one an hour. | G4 (deviation 1) |
| `0122_ig_demo_recorder.sql` | The five tables (the four above and `ig_action_log`, where `facts` and `history` write their report: they answer 202 at once and run on under `waitUntil`) (row level security on, no grant or policy for anon or authenticated), the record function (service role only), and the recorder's row of the one-minute job (`ig?action=quotes`, 55 s, `retry` true, the 15-minute `active_from` hold), switched on and off every five minutes by `ig-quotes-window` (at :03, :08 …) inside Friday 21:35–22:20 and Saturday 07:40 → Monday 22:20 UK. | repository rules |

**The recorder's windows (UK time).** FRI Friday 21:50–22:05: the six weekday roles (AUD/USD, US 500 and the four weekday
indices). WKND Saturday 07:55 → Monday 01:00: the seven weekend markets. SUNIDX Sunday 20:50 → Monday 01:00: the four weekday
index counterparts. SUN Sunday 20:50 → Monday 22:05: AUD/USD and US 500. Every recorder minute lies inside the database's wider
window with ten minutes to spare at each end, checked at every minute from 2025-10-01 to 2026-11-05.

### How the limits are proven

- `supabase/functions/ig/index.test.ts` (18 Deno tests). The guard refuses 29 named calls (the live host, plain http, another
  port, a look-alike host, every positions, working-orders, confirms, watchlist, history, application and costs path in every
  method, logout, traversal, a query on a write, an unlisted query parameter) and accepts the 10 listed ones; the client refuses
  an order path before `fetch` is reached (the fake server's call count does not move) and refuses the request after its budget;
  only the three demo secret names are read, with the live ones present in the environment; a fake IG that echoes the username
  and the session token in its answers leaves no secret in any stored row or answer; `facts` stores no balance or client id;
  a token IG calls invalid is replaced by one login and the account switched back; history is refused before the probe, skips
  pulled windows, stops at the reserve and on IG's "allowance exceeded"; the quote windows in summer and winter time; the
  beat is written before anything else; only the cron bearer or an admin token gets in.
- `src/cron_jobs.test.js`: the new row and job replay as described; the toggle writes `enabled` on its one row only; the SQL
  window's text is pinned; and the function's source holds no live secret name, no IG host but the demo base, and no dealing
  path, and `ig` deploys with `--no-verify-jwt`.
- Counterfactuals, run and reverted: with the guard's call removed from the client, the order-path test fails; with the
  session and row scrubbing removed, the `facts` test fails.
- `0122` applied twice to a scratch PostgreSQL 16 with stub `cron` and `edge_calls`; `public.ig_quotes_window` agreed with
  `inDbWindow` at all 115,201 five-minute instants from 2025-10-01 to 2026-11-05 (43,389 on, 0 disagreements, both clock
  changes inside); `ig_quotes_record` started two rows, then extended both on an unchanged snapshot, then started a third on a
  change.

### Deviations from the spec, recorded the spec's way

1. **G4 by REST polling, in production.** The spec's recorder is one local Lightstreamer connection with tick-by-tick chart
   data. This seat cannot hold a connection over a weekend and the secrets cannot leave Supabase, so the recorder is a row of
   the one-minute job taking two REST snapshots a minute. Consequences: a quote's time is known to about 30 s, not to the
   tick; the "first TRADEABLE quote" is the first snapshot that shows it, up to 30 s late; IG's own `updateTime` (a time of
   day) is kept beside the received time and never replaces it. S1b's +1-minute reading is therefore coarse; +5 minutes and
   later are not affected. The clock check is IG's `Date` header (one-second resolution) against the function's clock, every
   run, not a named NTP source at start and end.
2. **SUNIDX.** The spec records weekend indices from Saturday 07:55 to Monday 01:00. The weekday counterparts of those indices
   are added from Sunday 20:50 to Monday 01:00, because S2 needs the first weekday bid/offer after rollover and the request
   that reads the weekend markets reads them at no extra request.
3. **The client-sentiment path is `/clientsentiment`**, as the brief said. IG's reference page is titled
   `/client-sentiment`, which the first build followed; that path answered 404 in production on 2026-10-15, and the fix
   commit moved to `/clientsentiment`. `/marketnavigation` also answered 404 on the demo; `facts` records it and goes on.
4. **Options and VIX are not in `facts`.** S4's option sampler is not built; the volatility screen's breakevens are printed by
   G3 (section 3) so that S4 can start from them when its sampler is asked for.

### Fix after the first production run (2026-10-15 16:25 UTC)

The spread-bet account's first `facts` stopped after its account switch with `401 error.security.account-token-invalid`
(7 requests, no epic). IG's X-SECURITY-TOKEN names the current account (IG Labs REST guide: "a token identifying the
current account"), so `PUT /session` answers with a new one, and with no CST; the client took new tokens only when an
answer carried both, kept the old account token, and every call after a switch was refused, a fresh login included. The
fix takes each header on its own (`adoptTokens`) and keeps a replaced token on the scrub list. `quotes` and `history`
switch through the same `switchTo`, so they had the bug too: on the old rule six Deno tests fail (the new pin, `facts`,
both `history` tests, `quotes`, and the token-renewal test), since the fake IG now hands out an account token per account
the way the documentation describes. The CFD account's `facts` (16:27 UTC, no switch) worked: 11 roles chosen with
11 detail answers in 25 requests; `/marketnavigation` and `/client-sentiment` answered 404 (the second moved to
`/clientsentiment`); the CFD account lists no weekend FX market. Until a spread-bet `facts` row exists, the recorder
reads the CFD account alone, which needs no switch.

## 2. What the main session does to deploy, and what to check after

1. Land the commit (`supabase/functions/ig/`, `0122_ig_demo_recorder.sql`, the workflow line, the tests). `migrations.yml`
   applies 0122 and `edge-functions.yml` deploys `ig` with `--no-verify-jwt`. Read both runs; then the Supabase dashboard's
   Edge Functions list shows `ig`.
2. `facts` for each account, with the Vault bearer, outside the recorder's windows (before Friday 21:35 UK). The call answers
   202 at once and runs ~90 s under `waitUntil`, so it never holds the one-minute job's batch; its report lands in
   `ig_action_log`:
   `select net.http_post(url := 'https://flmvxigozjuizpckllvk.supabase.co/functions/v1/ig?action=facts&account=sb', headers := jsonb_build_object('Authorization', concat('Bearer ', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'))), body := '{}'::jsonb, timeout_milliseconds := 10000);`
   then the same with `account=cfd` two minutes later (IG allows 30 requests a minute per account).
3. Read `select id, account_kind, account_id, ok, selected, payload->'missing', payload->'expected_account_matches', errors from public.ig_facts order by id;`.
   Expect `account_id` `Z6F18K` for `sb` and `Z6F18J` for `cfd`, `fx_audusd` and the seven `wknd_*` roles selected on both.
   If a role is wrong or missing, compare `payload->'candidates'->'<role>'` and re-run `facts` with `&pin=<role>:<EPIC>`.
4. `history&account=sb&plan=probe` (two small requests; 202, report in `ig_action_log`). Read `select window_key, epic, ok, points, remaining_allowance, total_allowance, allowance_expiry_s, error, jsonb_path_query_array(raw, '$.prices[0 to 2]') from public.ig_price_pulls order by id;`:
   that bid and ask are both present, what `snapshotTime` and `snapshotTimeUTC` say against the request's `from`/`to` (the
   padding is two hours each side), and the allowance.
5. Then `history&account=sb&plan=fxw&max=15` four times, a few minutes apart (51 windows; each call checks the allowance).
6. Recorder: from Friday 10-16 21:35 UK the row is on. Read `select started_at, windows, ok, snapshots, samples, changed, requests, logins, switches, clock_offset_ms, error from public.ig_quote_runs order by id desc limit 20;`
   and `select account_kind, epic, count(*), min(ts), max(seen_until), array_agg(distinct market_status) from public.ig_quotes group by 1, 2;`
   and the errors box (`kind like 'ig.%'`). The Friday window is short (21:50–22:05 UK); Saturday 07:55 is the first long one.
7. Export for S1a (section 5): the `fxw` rows' `raw` to `docs/agents/backtests/ig_deepdive/inputs/ig/fxw_sb.json`, then run the
   parser and S1a there.

## 3. G0: the primary sources, re-read at source on 2026-10-15

`scripts/g0_sources.py --fetch` read 26 pages (IG Labs, IG UK's product, charges, funding, guaranteed-stop, weekend and
negative-balance pages, both IG UK customer agreements, the FCA, HMRC, TCGA 1992 s.51 and the Irish TCA 1997 s.613),
kept their text under `backtests/ig_deepdive/inputs/sources/` with each raw page's sha256 (`source_index.csv`, the spec's
columns), and checked 40 facts against the words on the page (`facts.csv`): all 40 found. The ones this work rests on:

| fact | what the source says |
|---|---|
| F01-F05 | 30 non-trading requests a minute per account, 60 per app; 10,000 history points a week; HOUR history about 360 days; weekend maintenance invalidates every token (IG Labs FAQ). |
| F08 | `/prices` `from`/`to` are `yyyy-MM-dd'T'HH:mm:ss` with no zone: hence the two-hour padding and placing bars by `snapshotTimeUTC`. |
| F10 | AUD/USD spot spread bet: £0.50 minimum a point, 0.6 minimum spread, 0.82 average (00:00-21:00, 12 weeks to 2021-01-08), guaranteed-stop premium 1.5, 5 % retail margin. |
| F11 | IG's forex dealing hours: **Sunday 21:00 to Friday 21:59, London time**. IG quotes AUD/USD about an hour before FXCM's first Sunday minute, which falls in the 22:00 UK hour on 491 of the table's weekend rows (21:00 on 37). |
| F12 vs F13 | **The two IG pages disagree on forex funding**: tom-next plus 0.0022 % a day (about 0.80 % a year, forex product page) against tom-next plus 1.5 % (overnight-funding page). Both are carried; G1's demo read cannot settle it, a live funding statement can. |
| F14-F16 | Index spread bets: (3.4 % ± the benchmark) / 365 a night, CFDs 3 %; positions held through 22:00 UK on Friday pay three nights. |
| F17-F25 | US 500 DFB £1 a point, 0.4 pt 14:30-21:00, 0.6 21:00-14:30, 1.5 22:00-23:00; Weekend Wall Street 20 pt, UK 100 8, Germany 40 14, US Tech 100 16, Saturday 08:00 to Sunday 22:40; weekend FX 6/6/4 pips to Sunday 20:40; weekend index prices are "our own view", moved by other clients' business. |
| F28-F30 | FCA: retail leverage 30:1 to 2:1, close-out at 50 % of required margin, and the rules include financial spread bets and rolling spot forex. |
| F31, F33, F34 | HMRC CG56105: "no chargeable gains or allowable losses arise from spread betting"; TCGA 1992 s.51(1) exempts betting winnings; BIM22020: taxable only if the wins arise from carrying on a trade. |
| F35 | Ireland, TCA 1997 s.613(2): betting winnings are not chargeable gains. Whether Davies is taxed in the UK, Ireland or both is for an adviser. |
| F36 | CFD accounts are IG Markets Ltd, spread betting IG Index Ltd, both FCA-authorised: the UK route. Davies' live `LT8QC` (CFD) and `LT8Q2` (spread bet) fit it, but the entity is proven only by his account documents. |
| F39, F40 | IG Index's agreement (July 2023): no automated software, algorithm or betting strategy beyond IG's own without its prior written consent; nothing that takes unfair advantage of how IG constructs or conveys prices (latency abuse named). |
| F37 vs F38 | IG UK's retail-loss warning reads 69 % on the product pages and 70 % on the weekend page on the same day. |

## 4. G3: the 2026-10-14 numbers, recomputed independently

`scripts/g3_replicate.py` (written from the spec's words; imports nothing from the earlier scripts) →
`results/g3_replication.json`, which lists 74 comparisons with the earlier results: 72 equal, two explained by convention.

| check | this recomputation | 2026-10-14 | |
|---|---|---|---|
| AUD/USD trades (|gap| ≥ 20 bps, 524 weekends 2016-01-08 → 2026-09-25) | 85 | 85 | equal |
| mean at 12 / 20 / 30 / 40 bps | +18.88 / +14.88 / +9.88 / +4.89 | same | equal |
| EUR, GBP, JPY at 20 bps | −1.02 / −13.34 / −11.70 | same | equal |
| eras at 12 bps (2016-18 / 19-21 / 22-24 / 25-26) | +10.90 / +18.35 / +16.90 / +31.42 | same | equal |
| 60 / 240 min late at 12 bps | +7.06 / +9.91 | same | equal |
| worst trade, adverse excursion maximum | −129.3, 440.1 bps | same | equal |
| bootstrap at 12 bps | +10.93 to +26.23 | +10.93 to +26.24 | percentile index convention |
| adverse excursion p90 / p95 | 116.3 / 129.8 (interpolated) | 117.5 / 130.3 (nearest rank) | quantile convention |
| straddle gates, 14 cells; front VX, 5 rows with stop counts; ESG n 18, +50.21 | all | all | equal |

**The AUD historical bar passes, every condition** (spec G3, on the sample-sd t): 85 trades (≥ 80); at 20 bps the mean is
+14.88 bps, t 3.78 (≥ 3.4; the population-sd t the earlier scripts printed is 3.80), bootstrap 95 % +6.93 to +22.23 (> 0);
12 and 30 bps both positive; 2022-2026 at 20 bps +20.57, t 3.04, n 36. Era intervals at 20 bps: 2016-18 −10.0 to +21.2,
2019-21 +4.9 to +23.3, 2022-24 −10.8 to +33.6, 2025-26 +14.0 to +41.5. Directions at 20 bps: long after a fall +18.20
(t 3.69, n 61), short after a rise +6.44 (t 1.08, n 24); the headline stays two-sided.

**Breakeven pricing ratios for S4** (the ratio of IG's straddle-implied volatility to the Cboe index at which the ungated
model's mean is zero, after the 2026-10-09 leg cost): daily (VIX1D, 1,104 days 2022-05-13 → 2026-10-08) **0.951** naked,
0.942 iron butterfly; weekly (VIX9D, 769 Fridays 2011 → 2026) **0.872** naked, 0.896 iron butterfly. At ratio 1.0 the
model makes +3.83 bps a day and +23.52 a week naked. S4's screen asks for a median `k_bid` 0.05 above these.

**Front VX**: unchanged; always-short +22.75 % a year at a +30 % stop with 28 of 161 cycles stopped and a −150.5 % worst
drawdown; no gate helps. Closed.

**ESG (S3): not run, coverage.** The Yahoo result reproduces exactly (18 trades at 0.5 %, +50.21 bps to Monday 16:00 ET,
t 1.53 sample-sd). The source search found no lawfully reusable hourly ES history of eight years: FirstRate Data sells
ES hourly from 2008 (paid, licence unread), Barchart's intraday downloads reach about ten years on a paid tier,
Dukascopy's free index series is a CFD, not ES, under a "personal use" prompt. Splicing any of them to Yahoo is what
the spec forbids. If Davies wants S3, buying FirstRate's ES file (about $100) is the decision.

## 5. S1a: frozen, scripted, and waiting for the deploy

**Verdict: NOT RUN, operator** (the function that pulls IG's history is built and gated but not yet deployed). Nothing
of IG's history has been read, so nothing here is a result.

- Frozen in the first commit, before any pull: `params/g2_s1a_frozen.json` (51 weekends from Friday 2026-10-09 back to
  2025-10-24, Friday 20:00 to Monday 22:00 UK, HOUR, padded two hours, the 500-point reserve, every S1a definition and
  the transfer bar's five conditions).
- `scripts/ig_parse.py` turns the exported `ig_price_pulls` rows into the spec's CSV columns (a missing side stays empty;
  `--selftest` checks a two-bar answer in IG's documented shape by hand). `scripts/s1a_transfer.py` applies the frozen
  definitions, pairs each weekend with the FXCM table and prints the five conditions and the two hourly scorings
  (`--selftest`: two hand-built weekends, gap −71.67 bps, range-crossing +70.24, close-only +61.66, all asserted).
- What runs after the deploy (section 2, steps 4-7): `history&account=sb&plan=probe`; read the bars' timestamps; then
  `plan=fxw` until the 51 windows are in (about 1,500 points expected, 4,029 at most); export with the SQL in
  `ig_parse.py`'s header to `inputs/ig/fxw_sb.json`; `python3 -I .../ig_parse.py inputs/ig/fxw_sb.json`; then
  `python3 -I .../s1a_transfer.py data/fxw_sb_<EPIC>.csv --account sb`. The same for `cfd` is a second reading.
- One fact changes what S1a will mean (F11): IG opens AUD/USD at Sunday 21:00 UK, FXCM about an hour later. G3 shows the
  FXCM trade is mostly gone an hour after FXCM's open; S1a's correlation and gap-ratio conditions say whether IG's
  21:00 quote carries the same gap, or a smaller one already partly faded.

## 6. A wider search for IG strategies, and how they rank

`scripts/fxw_paths.py` and `scripts/ig_search.py` → `results/fxw_paths.json`, `results/ig_search.json`. Rules were written
in each script's header before its first run; the family is eight arms with a bar of t ≥ 3.0 and the same sign in both
halves.

### 6.1 FXW-AUD with stops, on FXCM's own minutes

The weekend table could not price a stop. FXCM's public weekly minute files for the 85 trade weeks (201 of 205 files
read, every URL and sha256 in `inputs/fxcm_paths/pull_log.json`) do: the table's fill minute and 24 h extremes were
recomputed from them and agree on 85 of 85 trades. An ordinary stop fills at its level or at the first minute's open
beyond it; IG's guaranteed stop fills at its level and charges 1.5 points (F10) when it triggers; a stop and the target in
one minute is scored stop first.

| at a 20 bps opening spread | mean bps a trade | t | bootstrap 95 % | worst trade | stopped |
|---|---:|---:|---|---:|---:|
| no stop | +14.88 | 3.78 | +6.93 to +22.23 | −133.3 | — |
| guaranteed stop 50 bps | +6.97 | 1.75 | −0.83 to +14.68 | −54.6 | 15 |
| guaranteed stop 100 bps | +5.27 | 1.06 | −4.67 to +14.57 | −105.0 | 9 |
| guaranteed stop 150 bps | +10.05 | 1.99 | −0.27 to +19.36 | −155.4 | 3 |
| guaranteed stop 200 bps | +11.88 | 2.53 | +2.29 to +20.55 | −206.3 | 1 |

On the exit side the 24 h adverse excursion is p50 20.3, p90 101.2, p95 134.6 and at most 453.3 bps. **A tight stop sells
the recovery the rule is paid for**: from 50 to 100 bps it removes half or more of the mean and the statistical case. A
guaranteed stop at 200 bps costs about 3 bps a trade and caps the worst trade near 2.1 % instead of an open 4.5 %. Whether
IG accepts 200 bps as a guaranteed distance on AUD/USD is a G1 fact (`dealingRules.minControlledRiskStopDistance`), and
the premium IG quotes going into a weekend may differ from 1.5 (F10's note 3).

Funding: a trade opened at or after Sunday 21:00 UK and closed within 24 hours is closed before Monday 22:00, so it does
not cross a weekday 22:00 funding time (F16); whether IG funds at Sunday 22:00 is a G1/demo fact not yet read. The frozen
2 bps funding line stays in every number above.

### 6.2 New candidates measured on public data

| arm | rule | measured, net of IG's costs | verdict |
|---|---|---|---|
| IM_SPY | first hour (prior close → 10:30 ET) signs the last half hour, US 500 at 0.4 pt | −1.07 bps a day, t −1.33, n 719 (2023-11 → 2026-10) | dead |
| IM_QQQ | the same on US Tech 100 at 1 pt | −0.84, t −0.84 | dead |
| IM_SPY_BIG / IM_QQQ_BIG | only days whose first hour beats the trailing 60-day median | −2.15 (t −1.70) / −0.56 (t −0.33) | dead |
| CARRY_BASKET (fee 0.80 %) | long MXN, ZAR, HUF, PLN against USD as spot spread bets while the 3-month rate gap beats IG's fee | +0.17 % a year, Sharpe 0.02, worst drawdown −41.0 %, 262 months 2005-2026; since 2015 +0.91 %, Sharpe 0.12 | dead |
| CARRY_BASKET (fee 1.5 %) | the same at the other page's fee | −0.28 % a year, Sharpe −0.03, −45.7 % | dead |

The carry basket's worst months are 2008-09 (−15.5 %), 2011-08 (−12.1 %) and 2009-01 (−11.7 %): the crash risk is there,
the premium is not, after IG's fee and these currencies' depreciation. MXN alone was the best pair (+1.66 % a year,
Sharpe 0.14, −43 % drawdown).

**Funding structure (descriptive, not an edge).** A long US 500 DFB held through 22:00 pays SOFR (3.88 % on 2026-10-14)
+ 3.4 % = 7.28 % a year of notional. Stepping out over 22:00 each weekday (out at 21:59, back at 23:00, one 0.6-point
spread a day) costs about 1.95 % a year, and on the committed 730 days of hourly ES the hours it misses averaged +0.29 bps
a weekday (t 0.28) and the weekend gap −5.1 bps (t −1.26). Any multi-day IG idea should be judged against that 7.28 %; a
twice-daily step-out by software needs IG's written consent (F39).

**Tax wrapper.** For a winning rule the spread bet dominates: FXW's +1.18 % a year of notional at 20 bps is untaxed as a
spread bet (F31, F33) and +0.97 % / +0.90 % as a CFD after 18 % / 24 % capital gains tax; the CFD's only advantage is that
losses are allowable. Ireland's s.613(2) reads the same for betting winnings (F35). Which country taxes Davies, and
whether systematic betting could be a trade (F34), are for an adviser.

### 6.3 The ranking

| rank | candidate | evidence now | risk it would carry | next step |
|---:|---|---|---|---|
| 1 | **FXW-AUD-IG** (spread bet) | FXCM history passes the spec's bar (recomputed); IG transfer unmeasured | about 8 trades a year; worst 24 h excursion 453 bps (4.5 % of notional) open, about 2.1 % with a 200 bps guaranteed stop at a cost of ~3 bps a trade. At the £0.50 minimum (about £3,500 of notional at 0.70): worst finished trade about £47, worst open excursion about £159, at most about £72 with that stop; about £41 a year expected before tax at 20 bps | deploy, S1a on IG's history, then S1b's twelve recorded Sundays |
| 2 | **WKND** (IG weekend index prices against the reopen) | none: IG's own prices are the whole question | a measurement, no position | the recorder from 10-17; S2 on G2's `wknd` plan |
| 3 | **IG-VOL-K** (short-dated straddle bids) | breakevens printed (0.95 daily, 0.87 weekly) | a naked option's tail; the £10-a-point minimum is about £78k of notional | an option sampler, only if Davies asks for S4 |
| 4 | ESG-US500 | 18 Yahoo trades | — | not run, coverage; a paid ES history is Davies' call |
| — | intraday momentum, EM carry, front VX, FX majors' carry, calendar effects | measured, dead | — | closed |

**Headline.** Nothing new beats FXW-AUD. The one structural finding worth keeping is that IG's overnight funding (7.28 % a
year on a long index DFB today) makes every multi-day index idea expensive, and that FXW's own window (Sunday evening to
before Monday 22:00) avoids it. FXW's tail is the real risk, and the minute paths now price the tool for it: a guaranteed
stop wide enough (≈ 200 bps) to leave the recoveries alone.

## 7. What was not checked

- No IG answer of any kind: the function is not deployed, so no account fact, epic, history bar or quote has been read.
  Every IG cost above is from IG's public pages (G0), not from the account.
- The live credentials were not read and no live host was called by any code. One unauthenticated GET from this
  container to `demo-api.ig.com/gateway/deal/session` (no key, no body) checked the host is reachable (400, key missing).
- The `facts` epic picker is written against IG's documented search answer, not a real one; its candidates are stored
  so a wrong pick is seen and pinned.
- IG's minimum guaranteed-stop distance and weekend premium for AUD/USD, Sunday 22:00 funding, the CFD epic's size and
  margin, and the option chain were not read (G1).
- The intraday momentum test has two years of data (Yahoo's hourly limit); the carry test uses monthly bars and 3-month
  interbank rates as IG's tom-next, an approximation.
- S1b, S2, S4 and S5 are not run (they need the recorder's weekends or the option sampler).

## 8. Files

- `supabase/functions/ig/` and `supabase/migrations/0122_ig_demo_recorder.sql` (section 1).
- `backtests/ig_deepdive/params/g2_s1a_frozen.json`; `scripts/g0_sources.py`, `g3_replicate.py`, `ig_parse.py`,
  `s1a_transfer.py`, `fxw_paths.py`, `ig_search.py`, `build_manifest.py`; `inputs/sources/`, `inputs/fxcm_paths/`,
  `inputs/search/`; `results/g3_replication.json`, `fxw_paths.json`, `ig_search.json`; `MANIFEST.json` with the sha256 of
  each.

## 9. S1a, run on IG's own history (2026-10-16)

**Verdict: the S1a transfer bar passes, all five conditions.** S1a is the first half of S1; FXW-AUD reaches
PASS-TO-PAPER only when S1b's twelve recorded Sundays pass too. This run is **not blind**: it used the frozen script
(`s1a_transfer.py`), definitions and bar (`params/g2_s1a_frozen.json`), all committed before the pulls, but sample bars
of the export had been read before the script ran.

- **The data.** The main session pulled the `fxw` plan on the spread-bet demo account on 2026-10-16, 16:03-16:09 UTC:
  - epic `CS.D.AUDUSD.TODAY.IP`, HOUR bars;
  - 50 of the 51 frozen weekends, 1,588 points, 8,407 of the week's 10,000 left.
  - Weekend 2025-11-28 failed with `401 account-token-invalid` on the first request of the fourth call (`ig_price_pulls` id 47, status null). It stays missing and is counted in condition 5b; a re-pull would cost about 32 points.
- **The export.** The rows were exported with the read-only connector to `inputs/ig/fxw_sb_bars.csv`. Its sha256 is `e6bddfab…c59e`, equal to the sha256 the database computed for the same text. `s1a_export.py` checks that hash and writes the normalized CSV through `ig_parse.py`.
- **Timestamps.** IG reads `from`/`to` in UK time: a 17:00 request returns a first bar stamped 16:00 UTC in summer.
  - Bars are placed by `snapshotTimeUTC`, and the first Sunday bar starts at the documented 21:00 UK open on 48 of 50 weekends.
  - The other two first quotes came later: 2026-04-05, Easter, at 01:00 Monday; and 2026-07-19 at 00:00 Monday.
  - So the stamp is the bar's start.

| condition | bar | IG demo | |
|---|---|---|---|
| 1 complete weekends | ≥ 45 | 50 | pass |
| 2 median opening spread | ≤ 20 bps | 10.13 bps | pass |
| 2 p75 opening spread | ≤ 30 bps | 16.66 bps (p25 9.48, p90 17.98) | pass |
| 3 IG vs FXCM gap correlation | ≥ 0.50 | 0.957 on 33 paired weekends | pass |
| 4 median abs(IG gap) / abs(FXCM gap), FXCM gap ≥ 20 bps | ≥ 0.70 | 0.973 on 12 weekends | pass |
| 5a first tradable bar by 22:00 UK | ≥ 80 % | 96 % | pass |
| 5b unexplained timestamp gaps | < 10 % | 2 % (the missing 2025-11-28 weekend) | pass |

FXCM's committed weekend table stops at 2026-09-25 and has no rows from 2026-05 to 2026-08, so conditions 3 and 4 rest on 33 paired weekends. The pairing also shows IG's quote leading FXCM's by about an hour (F11). On two of the 12 weekends where FXCM's gap was 20 bps or more, IG's 21:00 gap was already near zero: 2026-09-25 (−1.6 against −22.9) and 2025-12-26 (+1.6 against −21.0).

**IG's actual Sunday-open spreads against the 20 bps assumed:**
- median 10.1 bps over all 50 weekends;
- median 9.6 bps on the ten trade weekends, ranging from 1.4 to 18.0.
- The 2026-10-14 deep dive priced FXW at 12-30 bps. IG's demo quote sits at the cheap end of that range.

**The rule at IG's own executable quotes:**
- ten trades with an abs(gap) of 20 bps or more in the 50 weekends;
- entered at the first bar's ask (long) or bid (short), target Friday's IG mid, out within 24 h, minus the frozen 2 bps funding line;
- neither scoring is a fill claim.

| hourly scoring | mean bps a trade | median | t | bootstrap 95 % | worst | at target |
|---|---:|---:|---:|---|---:|---:|
| close-only | +37.6 | +35.9 | 3.50 | +17.8 to +57.6 | −21.8 | 7 of 10 |
| range-crossing | +30.2 | +26.4 | 3.19 | +12.8 to +48.1 | −21.8 | 7 of 10 |

Ten trades is a small sample. The interval is wide, and the mean sits above FXCM's ten-year +14.88 bps at 20 bps because both IG's spread and this year's gaps were larger. The year's ten gaps were mostly falls of 25-90 bps (eight longs, two shorts).

**G1 facts the funding question needs** (read-only, `ig_facts` id 3, spread-bet demo):
- minimum deal 0.04 (the demo; the public page says £0.50 a pip live);
- margin 5 % in the first bands, 6 % above $4,720;
- minimum guaranteed-stop distance 6 points (0.0006, about 9 bps), so a 200 bps guaranteed stop is allowed;
- guaranteed-stop premium 1.5 points;
- no opening hours stated, so the documented hours were used.

**What it means for funding `LT8Q2`.** These are figures; the decision is Davies'.
- At £0.50 a pip (about £3,500 of notional at 0.70) the exposure is:

  | item | amount |
  |---|---|
  | margin, at 5 % | about £175 |
  | worst finished FXCM trade | about −£47 |
  | worst 24 h open excursion (453 bps) | about −£159 |
  | with a 200 bps guaranteed stop | about −£72, plus its £0.75 premium if triggered |

- **£350-400 in the account covers one minimum position through the worst historical excursion without margin close-out**: equity stays well above 50 % of £175. Adding a 200 bps guaranteed stop makes the worst case about £73.
- Expected value at this year's IG numbers: about £105-130 a year before tax (10 trades × 30-38 bps × £3,500). On FXCM's ten years at a 20 bps spread it is about £41 a year. Ten trades cannot say which is nearer the truth.
- **The spec's order still holds**: S1b's twelve recorded Sundays come before PASS-TO-PAPER, and this spec can never yield PASS-TO-LIVE. Funding now would put money in before the forward check. That is Davies' call to make; it is not this result's recommendation.
- The demo minimum (0.04) is not the live minimum, and the live account's own minimum and spread are read only when he logs in.

**Fault found.** The fourth `history` call's first request was refused `account-token-invalid` straight after its account switch, and the client's one re-login also failed at once; the next window, 2.5 s later, worked. The likely cause is a token that becomes valid a moment after the switch. A short wait before that retry is the fix, not built here (no IG call or code change was in this task's scope).


## 10. S1b's usable-weekend rule: Deviation 1 (2026-10-19)

Recorded before any S1b weekend is scored, on Davies' word of 2026-10-19 ("都按你推荐的来"):
`backtests/ig_deepdive/DEVIATION-1-S1b-coverage.md`. G4's "95% connection uptime" is replaced, for the REST recorder,
by quote coverage: a quote for the S1b epic no older than 2 minutes in at least 95% of the FX window's minutes. The
first TRADEABLE quote after the open must still be captured. None of the first ten minutes may be uncovered, and no
uncovered stretch may run longer than 5 minutes. The run-level success rate is reported beside it. The reading is
`sql/s1b_coverage.sql`.
- **The spec is unchanged.**
- **The first weekend so far** (read 10-19 03:17 UTC): 448 of 448 minutes covered, first TRADEABLE quote at 21:00:05 UK.
- **Runs ok:** 338 of 448.
