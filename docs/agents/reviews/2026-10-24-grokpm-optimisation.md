# GROKPM: what can be improved beyond the bars (2026-10-24)

Davies, 2026-10-24: "同意 另外看看有什么可以优化的地方" — agreed (C-005), and look at what else can be improved. The rules study
of 10-23 (`reviews/2026-10-23-grokpm-rules-study.md`) settled the bars: they are kept. This review looks at everything
around them:
- the server (`supabase/functions/grokpm/`);
- the keyless recorder (`agents?action=grokpmrec`);
- the hourly redemption;
- the record D7's and D10's reading needs;
- the schedule;
- Grok's working method.

Sources:
- read-only SQL, 2026-10-24 07:0x UTC (§5);
- the desk ledger at `cb176b9f`/`5202f77e`;
- the main session's desk check of 10-23 22:45 UTC.

The findings are in two lists:
- **§2, fixes that change no rule**, made here with pin tests;
- **§3, proposals that would change a rule, the budget, the categories or Grok's prompt**, for Davies only.

The frozen pre-registration is untouched. Not blind (no-peek rules cancelled 2026-10-04). No account amount appears here.

## 1. What the record showed

- **No outcome is recorded for any shadow forecast.**
  - `grokpm_resolutions` is empty: the recorder looked up resolutions only for markets the agent traded, and it has
    traded none.
  - Since D7, 24 markets have a counted first forecast (D9's sample, 10-20 16:58 to 10-24 00:13 UTC).
  - At least four have resolved (Bank of Israel, Tesla, the 21-Oct earthquake, the 22-Oct gas price), but only the
    rules study's hand-read knows it.
- **D10's column has no source.**
  - The market's last trade before a forecast is in no table. The data API's public tape serves only a market's newest
    trades, so an active market's older trades fall off it.
  - The rules study already found Alberta 40–60's page full (1,000 trades).
  - D10's "thin" mark needs the book the forecast saw, and the journal keeps only the agent's m.
- **Busy answers reached the errors box.** 2026-10-17 to 10-24, `ops_errors`:
  - `agents.grokpm_rec` "activity → 429": 8 times, each gone by the next five-minute slot;
  - `grokpm.redeem` "redeemable positions unread: positions: 429": twice (10-20 20:00 and 10-23 14:00 UTC), each gone
    by the next hour;
  - the public Polygon RPC's 429 or a timeout: 3 times (information only).
  None of these lost a record.
- **Malformed market reads.** 35 market reads were refused since 10-18 (`grokpm_requests`, 422), all with one fixed
  message: "cond (0x and 64 lower-case hex digits) or token (decimal) is required". The table keeps no input, so what
  Grok sent cannot be read back.
- **The sample's shape.**
  - Nine of the 24 counted first forecasts are one 12:20 UTC batch on 10-23: category A at p 0.995 against m 0.9995,
    markets already settled.
  - Since C-004, every shadow market has ended within a day. C-005 (posted 10-24, Davies: "同意") asks Grok to choose far
    markets by title before any price.
- **The schedule** is Grok's: the 10-23 16:05 full scan began 11 minutes late. Nothing on this side can change that.

## 2. Fixes that change no rule (made, pinned, not deployed until the landing push)

| # | what | where | pinned by |
|---|---|---|---|
| F1 | Every half hour the recorder looks up, on Gamma, each market a forecast names (a journal row with p and m) that `grokpm_resolutions` lacks. It writes the market there only once it has closed at a payout of 0, ½ or 1; any other closed price waits for the next look. The traded path is unchanged. | `agents/grokpm_rec.ts` (`forecastMarkets`, `forecastResolution`) | `grokpm_rec.test.ts`: "forecasts: each one gets…" and "the pure parts" |
| F2 | Each forecast gets the market's last trade at or before its time, in a new table `grokpm_shadow_marks` (migration `0138`). Each run takes a few markets, newest first, with one taker-tape read each, all at once. The trade is priced as the forecast token (a trade of the other outcome at q is 1 − q). With no trade that old it records why: `none_before` (the market had not traded) or `beyond_window` (the page ends after it); no gap is filled with a guess. Beside it the token's best bid and ask, kept only when read within 10 minutes of the forecast, which is D10's thin mark. Written once; read by no trading path, page or book. | `agents/grokpm_rec.ts` (`pendingForecasts`, `lastTradeBefore`, `touchOf`); `0138_grokpm_shadow_marks.sql`; `_shared/grokpm_schema.ts` | `grokpm_rec.test.ts` (four tests); `src/grokpm_prereg.test.js` holds the table to 0138 column for column, with RLS and no grant |
| F3 | Busy answers are retried. The redemption's positions read waits 2 s, then 5 s, after a 429 or a 5xx. Still busy, it plans and sends nothing, as before, and records `rateLimited`. It becomes an error only when the previous run was busy too, so one busy hour is quiet and two in a row reach the errors box. A 404 is still an error at once. The recorder's activity and tape reads are tried once more after 1.5 s. | `grokpm/redeem.ts` (`callRetrying`, `GROKPM_REDEEM.retryWaitsMs`); `agents/grokpm_rec.ts` (`getJsonRetry`, `GROKPM_BUSY_RETRY_MS`) | `redeem.test.ts`: "a busy positions read…"; `grokpm_rec.test.ts`: "activity: a 429…" and the tape-failure test |
| F4 | A market read takes a condition id in either case, trimmed (the venue's are lower case). A refusal says what was wrong with what was sent: no 0x, a non-hex character, or the hex digit count. | `grokpm/index.ts` (`marketQuery`) | `index.test.ts`: "marketQuery…" |
| F5 | D7's secondary reading with D9's sample and D10's column, written before the end. It gives each market's first counted forecast with p, m, the last trade, the thin mark and the outcome, and the two Brier pairs on the same rows; §6.2's bootstrap runs over these rows in the end script. Validated read-only against production on 10-24 with an empty stand-in for 0138's table: 24 counted markets, 0 resolved. That second number is F1's gap. | `docs/agents/backtests/grokpm_reading/d7_d10_shadow.sql` | none (an SQL draft; the end reading runs it) |

**What deploying does.**
- The push redeploys `agents` and `grokpm` (`edge-functions.yml`), and `migrations.yml` applies `0138`.
- If the function lands before the table, the recorder's forecasts step fails with a `forecasts:` line in the errors box
  for those runs. It stops nothing else; the snapshot, activity and titles are separate steps.
- No `edge_calls` row changes: the recorder's call already runs every five minutes under the watchdog.
- **Backlog:** the first runs mark the backlog, four markets a run, newest first, so about 24 markets take half an hour.
  - Forecasts older than the tape's page come out `beyond_window`.
  - Forecasts made before the deploy have no book.
  - The end report states both counts.

## 3. Proposals (each changes a rule, the reading, the budget or Grok's prompt: Davies decides; nothing applied)

| # | proposal | expected effect | risk |
|---|---|---|---|
| P1 | A server read that lists low-attention markets ending 3–30 days out by title, slug and end date only, with no price field (for example `?action=scan&tag=…`). Grok picks blind as C-005 asks, without fighting Gamma's 100-a-page cap. | B forecasts on far markets, the sample the test lacks; maybe a few a full scan | None to money. A new endpoint in Grok's prompt (Appendix A.2 is in the frozen file, so it is a deviation) |
| P2 | Add `last_trade` (price, time) to the `market` read. Grok then sees that an empty book's midpoint is stale before it writes "edge exists but thin". | Fewer illusory gaps in the journal; the same orders (the thin rule refuses them anyway) | None to money; one field more in A.2 (a deviation) |
| P3 | D7's reading also reports the forecasts with m between 0.05 and 0.95 apart from the rest. The 9 forecasts at p 0.995/m 0.9995 score near 0 for both sides and dilute any difference. | A reading that measures forecasting where there is something to forecast | None; a reading change (a deviation, like D10) |
| P4 | The traded path's resolutions accept only a payout of 0, ½ or 1, as F1 does. Today a market Gamma calls closed with a price such as 0.9995 would settle the agent's holding into cash at that price (D4). | Settlement only on a final outcome | It changes when D4 settles a holding (a rule of the book), so it is Davies'. Nothing is held now |
| P5 | Event wakes at a held or watched market's release time (prereg §7.5 item 3, never set up), where Grok's scheduler allows them. | A confirmation seen minutes after the fact, not hours (Tesla 25 min, the earthquakes ~10 h). The rules study's tape says even minutes may be late | Grok's plan limits; no money |
| P6 | Rules, budget, categories: **no change proposed**. The rules study's finding stands: the bars are not what binds. | — | — |

## 4. Limits

- The fixes are tested against doubles held to the migrations' columns and keys. Their first production runs come only
  after the landing push; a later read of `grokpm_shadow_marks` and `grokpm_resolutions` should confirm them.
- The tape's page is the newest 1,000 taker trades. A busy market's forecast older than that cannot get its last trade
  after the fact, which is why the recorder reads each new forecast within minutes.
- Whether the 35 malformed reads were upper-case ids, slugs or something else cannot be told: nothing kept them. F4's
  message will say.
- Nothing here changes Grok. C-005 is Grok's to follow, and §3 is Davies'.

## 5. The SQL (read-only, 2026-10-24)

```sql
select kind, left(message, 140), count(*), min(created_at), max(created_at) from public.ops_errors
 where kind ilike '%grokpm%' and created_at > now() - interval '8 days' group by 1, 2;  -- the busy answers in §1
select updated_at, last_error, state from public.grokpm_rec_state;                     -- the recorder's state
select count(*) from public.grokpm_resolutions;                                         -- 0
-- F5's reading, with an empty stand-in for grokpm_shadow_marks (not yet in production): 24 counted markets, 0 resolved
```
