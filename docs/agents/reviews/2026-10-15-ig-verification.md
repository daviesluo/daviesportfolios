# IG verification on the demo account: the read-only function, G0, G3, S1a's frozen run, and a wider strategy search (2026-10-15)

Davies, 2026-10-15: "ig我的账户开好了，api也加了" and "FXW-AUD你继续验证研究并记录，除此之外你再深度研究下ig的spread
betting和cfd的策略，如果策略够好我愿意承担一定风险".

**What this is.** The first run of `backtests/ig_deepdive/SPEC-for-verification.md` (Muse's frozen spec, G0-G4 and S1-S5).
His message meets the spec's starting condition for the demo read-only work: the accounts exist, he stored the demo
credentials himself as Edge secrets, and he said to continue. Because those secrets live only in Supabase, reaching IG is
a small Edge Function, which is the separate build the spec's hard rule 3 reserved for his ask. Nothing in this work
places, amends or closes anything, reads the live credentials, or calls the live host. No live trading is designed to
start without his explicit go.

## 1. What was built: the `ig` Edge Function and migration 0122

| part | what it does | spec |
|---|---|---|
| `ig/client.ts` | The only door to IG. Every request is built on `https://demo-api.ig.com/gateway/deal` and checked before `fetch`: any other host (the live `api.ig.com` above all), scheme, port, path or query parameter throws. Allowed: `POST /session` (log in), `PUT /session` (switch between the two demo accounts), GET `/accounts`, `/markets` (by epics or a search term), `/markets/{epic}`, `/marketnavigation[/{node}]`, `/prices/{epic}`, `/client-sentiment[/{marketId}]`. Reads only `IG_API_KEY_DEMO`, `IG_DEMO_USERNAME`, `IG_DEMO_PASSWORD`. Scrubs the key, username, password, CST and X-SECURITY-TOKEN (raw and URL-encoded) from every answer, row and error. A request budget per run and a gap between requests keep a run inside IG's 30 non-trading requests a minute per account. | hard rules 1, 2, 8 |
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
3. **The client-sentiment path is `/client-sentiment`** (IG's REST reference, saved in `ig_research/inputs/ig_pages`); the
   brief's `/clientsentiment` does not exist.
4. **Options and VIX are not in `facts`.** S4's option sampler is not built; the volatility screen's breakevens are printed by
   G3 (section 3) so that S4 can start from them when its sampler is asked for.

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

## 3-6. G0, G3, S1a and the wider search

Written up in the following commit of this verification.
