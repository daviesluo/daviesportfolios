// Remote portfolio CRUD against the `data` Edge Function. The browser
// never sees Supabase's service-role key; every request carries the HMAC
// app token issued by the `auth` Edge Function (gates row access by
// role: admin reads/writes, ro reads only). SB_ANON is still required by
// the Supabase Edge runtime for invocation auth, but it's separate from
// the app-level token that gates the actual data.

import { SB_ANON, EDGE_DATA_URL } from './supabase_config.js';
import { getAppToken } from './auth.js';
import { detectCurrency } from './fx.js';
import { INITIAL_PORTFOLIO } from './data.js';
import { reportError } from './ops_error.js';
import { netPosition } from './transactions.js';
import { Storage } from './storage.js';

// Cross-tab notification channel. When this tab successfully saves the
// portfolio, every OTHER tab gets a `portfolio-saved` message and
// refetches its own copy from the server. Without this:
//   Tab A edits, saves V1 → server = V1
//   Tab B (idle, still showing V0) does its next 30 s price refresh →
//     setPortfolio with V0 + fresh prices → debounced save → server = V0
//   Tab A's edit silently lost.
//
// IMPORTANT: BroadcastChannel only withholds a message from the exact
// CHANNEL OBJECT that posted it — NOT from other channel objects in the
// same tab. `savePortfolioRemote` posts on a throwaway channel while the
// app.jsx listener is a separate channel, so the SAVING tab also
// receives its own `portfolio-saved` and would reload from the server
// mid-edit. In a multi-edit session that self-reload lands during a
// save's round-trip and overwrites the next edit with the one-behind
// server copy — the "edited my holdings, gone after a refresh"
// data-loss. So every message carries a `sender` tab id and the
// listener ignores its own (see `TAB_ID` + the handler in app.jsx).
export const PORTFOLIO_BROADCAST_CHANNEL = 'dp.portfolio';

// Stable per-tab / per-page-load id. Lets a tab recognise — and ignore —
// the `portfolio-saved` broadcast it posted itself (BroadcastChannel
// delivers a tab's own post to its other channel objects; see above).
export const TAB_ID = (typeof crypto !== 'undefined' && crypto.randomUUID)
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function dataHeaders() {
  return {
    "apikey": SB_ANON,
    "Authorization": `Bearer ${SB_ANON}`,
    "X-App-Token": getAppToken(),
    "Content-Type": "application/json",
  };
}

// Optimistic-concurrency state. The `data` Edge Function (per
// migration 0013) bumps a `version` counter on every successful save
// and returns it on every load. We send the last-seen version as
// `If-Match` on subsequent saves; if another tab / device saved in
// between, the server returns 412 and we surface a conflict to the
// caller instead of clobbering their change. Module-scoped on
// purpose: the value lives across the load/save lifecycle of a
// single tab without leaking into per-call argument lists, and a
// missed update from the server (cold project, error response) just
// falls back to "no If-Match" — the server then writes through
// (backward-compatible path) and we re-acquire the version on the
// reply.
let lastKnownVersion = null;

/**
 * Test hook — lets the per-callsite tests assert that loadPortfolioRemote
 * / savePortfolioRemote behave correctly against a stubbed version
 * without exposing the module-private state to production code.
 *
 * @returns {number | null}
 */
export function _peekLastKnownVersion() {
  return lastKnownVersion;
}

/** Test hook — resets the version cache between tests. */
export function _resetLastKnownVersion() {
  lastKnownVersion = null;
}

// Tag the seeded fallback so the UI can warn the user that they're
// looking at demo data (Davies's 33-ticker book) rather than their
// own portfolio. The save effect ALSO skips while `_isDemo` is true
// so touching edit mode doesn't accidentally overwrite the user's
// (empty) Supabase row with the demo positions. The banner gives
// them a Reset-to-empty button to start clean.
//
// Runs `migrate()` over the seed before returning so the demo path
// produces a fully-shaped portfolio (currency on every holding,
// `lots` arrays backfilled from shares+cost, label/subtitle
// normalisation). INITIAL_PORTFOLIO is hand-edited in data.js and
// has historically been missing those fields; without the migrate
// pass the demo render briefly hit "h.currency is undefined" → 1:1
// USD fallback in fxRateToUSD + an empty lots branch in code that
// destructures it.
function demoFallback() {
  return { ...migrate(JSON.parse(JSON.stringify(INITIAL_PORTFOLIO))), _isDemo: true };
}

export async function loadPortfolioRemote() {
  try {
    const res = await fetch(`${EDGE_DATA_URL}?action=load`, {
      headers: dataHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // Route to ops_errors so the admin badge surfaces the failure
      // alongside other operational signals (auth.unexpected,
      // render.crash, etc.). Status 401 is special-cased — it's the
      // normal "token expired" path the user fixes by re-auth'ing,
      // not a backend incident worth flagging.
      if (res.status !== 401) {
        reportError('data.load.failed', { context: { status: res.status } });
      }
      return demoFallback();
    }
    const body = await res.json();
    // Cache the server's version so the next save can prove it
    // hasn't been clobbered. Server always sends `version` (0 for
    // cold project); a missing field means we're talking to a
    // pre-0013 deploy and should skip If-Match entirely.
    if (typeof body?.version === 'number') {
      lastKnownVersion = body.version;
    }
    const data = body?.data;
    if (data) {
      const loaded = migrate(data);
      if (!loaded.holdings || Object.keys(loaded.holdings).length === 0) {
        return demoFallback();
      }
      // Write-through: seed the next cold start's instant first paint
      // (Storage.loadPortfolioCache, read by app.jsx's useState
      // initializer). Best-effort — savePortfolioCache already refuses
      // demo rows, so this can never seed a stranger's data.
      Storage.savePortfolioCache(loaded);
      return loaded;
    }
    return demoFallback();
  } catch (e) {
    reportError('data.load.error', { message: String(e?.message || e) });
    return demoFallback();
  }
}

/**
 * Persist the portfolio. Returns one of:
 *   { ok: true,  version }             — server accepted the write
 *   { ok: false, conflict: true }      — another tab/device saved in
 *                                        between (server returned 412);
 *                                        caller should reload, not retry
 *   { ok: false }                      — other failure (network, 5xx,
 *                                        token expired) — caller leaves
 *                                        the pending-save draft for the
 *                                        next debounce attempt
 *
 * The caller (app.jsx) uses `ok` to decide whether to clear its
 * sessionStorage `dp.pendingSave` mirror, and `conflict` to decide
 * whether to surface a "another tab saved newer changes" banner.
 *
 * @param {{ holdings?: object } | null | undefined} p
 * @returns {Promise<{ ok: true, version: number } | { ok: false, conflict?: boolean }>}
 */
export async function savePortfolioRemote(p) {
  if (!p || !p.holdings || Object.keys(p.holdings).length === 0) {
    return { ok: false };
  }
  try {
    const headers = dataHeaders();
    // Send If-Match only when we have a server-supplied version. A
    // null lastKnownVersion (cold mount before any load completed, or
    // an old pre-0013 deploy) means we skip the optimistic check and
    // fall through to the legacy unconditional write — same behaviour
    // as before this PR.
    if (lastKnownVersion != null) {
      headers['If-Match'] = String(lastKnownVersion);
    }
    const res = await fetch(`${EDGE_DATA_URL}?action=save`, {
      method: "POST",
      headers,
      body: JSON.stringify(p),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 412) {
      // Another tab/device wrote between our load and our save.
      // Update lastKnownVersion from the server's reply so a manual
      // reload (or the caller-driven refresh below) doesn't loop.
      try {
        const body = await res.json();
        if (typeof body?.currentVersion === 'number') {
          lastKnownVersion = body.currentVersion;
        }
      } catch { /* swallow — best-effort */ }
      // Deliberately NOT reported to ops_errors. A 412 is the normal,
      // self-healing multi-tab/device outcome — the conflict banner +
      // the next auto-refresh fetch the latest and move on. It's a
      // benign concurrency event, not a backend incident, so logging
      // it was pure noise in the ops badge (user asked to drop it).
      return { ok: false, conflict: true };
    }
    if (!res.ok) {
      if (res.status !== 401) {
        reportError('data.save.failed', { context: { status: res.status } });
      }
      return { ok: false };
    }
    // Capture the new version so the next save's If-Match matches.
    let nextVersion = null;
    try {
      const body = await res.json();
      if (typeof body?.version === 'number') {
        nextVersion = body.version;
        lastKnownVersion = body.version;
      }
    } catch { /* swallow — server may have returned no body */ }
    // Write-through the just-saved portfolio to the same first-paint
    // cache loadPortfolioRemote() seeds — keeps it current for the user's
    // OWN edits too, not just fresh server loads, so the next cold start
    // (or a reload right after saving) sees the latest state instantly.
    Storage.savePortfolioCache(p);
    // Tell every other tab on this origin that the persisted portfolio
    // just changed so they can refetch instead of carrying a stale copy
    // that might overwrite our save on their next price-refresh tick.
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel(PORTFOLIO_BROADCAST_CHANNEL);
        // `sender` lets the posting tab ignore its own message (the
        // listener compares against TAB_ID) so it doesn't self-reload
        // mid-edit and clobber a follow-up edit.
        bc.postMessage({ kind: 'portfolio-saved', sender: TAB_ID, ts: Date.now() });
        bc.close();
      }
    } catch { /* swallow — best-effort cross-tab nudge */ }
    return { ok: true, version: nextVersion ?? 0 };
  } catch (e) {
    reportError('data.save.error', { message: String(e?.message || e) });
    return { ok: false };
  }
}

/**
 * Stable string fingerprint of the user-EDITED subset of a portfolio.
 * Deliberately omits every field that gets mutated by the price-refresh
 * loop (lastPrice / extPrice / prevClose / dayPct / extDayPct /
 * todayRegularClose). Used by the debounced auto-save effect to skip
 * server writes when only ephemeral price data changed — without
 * which a backgrounded tab's 30 s refresh would re-serialize its stale
 * snapshot to the server and overwrite an edit made in another tab.
 *
 * Keys are sorted so two portfolios with identical user data but
 * different insertion orders produce the same fingerprint. Returns ''
 * for null / malformed inputs so the caller's "saved ref" comparison
 * falls back to the previous behaviour (first valid render seeds the
 * ref, subsequent reads match by string equality).
 *
 * @param {{
 *   positions: Record<string, any>,
 *   holdings: Record<string, any>,
 *   depositFxRates?: Record<string, number>,
 * } | null | undefined} p
 */
export function portfolioUserFingerprint(p) {
  if (!p || typeof p !== 'object' || !p.holdings || !p.positions) return '';
  const parts = [];
  const rates = p.depositFxRates;
  const depositFxRates = rates && typeof rates === 'object'
    ? Object.keys(rates).sort()
      .map((currency) => `${currency}:${rates[currency]}`)
      .join(',')
    : '';
  parts.push(`deposit-fx:${depositFxRates}`);
  for (const k of Object.keys(p.positions).sort()) {
    const pos = p.positions[k] || {};
    const tickers = Array.isArray(pos.tickers) ? [...pos.tickers].sort() : [];
    parts.push(`p:${k}=${pos.role || ''}|${pos.label || ''}|${pos.subtitle || ''}|${tickers.join(',')}`);
  }
  for (const t of Object.keys(p.holdings).sort()) {
    const h = p.holdings[t] || {};
    const lots = Array.isArray(h.lots)
      ? h.lots.map(l =>
          `${l?.date || ''},${l?.shares ?? ''},${l?.cost ?? ''},${l?.source || ''}`
        ).join(';')
      : '';
    // Sells and `closed` are part of the user-edited ledger, so they
    // belong in the fingerprint. Without them a CLOSED holding
    // (shares 0, cost 0, ledger retained) was invisible to the diff:
    // correcting a sell's date or price, or adding an offsetting sell,
    // left every fingerprinted field identical, so the debounced save
    // treated a real edit as a no-op and the change was silently lost
    // on the next load. Live positions usually moved shares/cost too,
    // which is why this only bit the closed ones.
    const sells = Array.isArray(h.sells)
      ? h.sells.map(x => `${x?.date || ''},${x?.shares ?? ''},${x?.price ?? ''},${x?.ts ?? ''}`).join(';')
      : '';
    parts.push(
      `h:${t}=${h.shares ?? ''}|${h.cost ?? ''}|${h.currency || ''}|${!!h.isCash}|${!!h.closed}`
      + `|t212:${h.t212Shares ?? ''},${h.t212Cost ?? ''},${h.t212PositionKey ?? ''}`
      + `|${lots}|s:${sells}`,
    );
  }
  return parts.join('\n');
}

// Migrate old saved shapes to current schema. Keeps the legacy v1→v2
// ("CB" split into CB1/CB2), v2→v3 (BRK-B move), per-holding currency
// backfill, and per-purchase `lots` backfill. Idempotent — safe to run
// every load.
export function migrate(p) {
  if (!p || typeof p !== "object") return JSON.parse(JSON.stringify(INITIAL_PORTFOLIO));
  if (!p.positions) p.positions = {};
  if (!p.holdings)  p.holdings  = {};
  // v1 → v2: split single "CB" into "CB1" + "CB2"
  if (p.positions.CB && !p.positions.CB1) {
    const old = p.positions.CB;
    const tickers = old.tickers || [];
    const mid = Math.ceil(tickers.length / 2);
    p.positions = {
      GK: p.positions.GK,
      CB1: { label: "Centerback", subtitle: old.subtitle || "", role: "DEF", tickers: tickers.slice(0, mid) },
      CB2: { label: "Centerback", subtitle: "", role: "DEF", tickers: tickers.slice(mid) },
      ...Object.fromEntries(Object.entries(p.positions).filter(([k]) => k !== "GK" && k !== "CB")),
    };
  }
  // v2 → v3 (BRK-B): move BRK-B from RB to CB2 and sync its shares/cost
  if (p.positions.RB?.tickers?.includes("BRK-B") && !(p.positions.CB2?.tickers || []).includes("BRK-B")) {
    p.positions.RB.tickers = p.positions.RB.tickers.filter(t => t !== "BRK-B");
    if (p.positions.CB2) p.positions.CB2.tickers = [...(p.positions.CB2.tickers || []), "BRK-B"];
    if (p.holdings["BRK-B"]) {
      if (p.holdings["BRK-B"].shares === 5)      p.holdings["BRK-B"].shares = 5.25;
      if (p.holdings["BRK-B"].cost   === 469.99) p.holdings["BRK-B"].cost   = 469.94;
    }
  }
  // Backfill currency on holdings that pre-date the multi-currency migration.
  // detectCurrency is purely ticker-pattern based (and override-aware), so this
  // is safe to run on every load. Two passes of logic:
  //   - no currency yet → stamp the detected one.
  //   - currency is the USD default but the ticker pattern now resolves to a
  //     foreign currency → upgrade it. This catches holdings entered before a
  //     new exchange suffix was added to detectCurrency (e.g. an .PA holding
  //     stamped USD before EUR support landed). USD-denominated foreign-suffix
  //     tickers (VUAA.L / SAEM.L) stay USD via TICKER_CURRENCY_OVERRIDES, so
  //     they're never mis-upgraded.
  for (const [t, h] of Object.entries(p.holdings)) {
    if (h.isCash || t === "CASH") continue;
    if (!h.currency) { h.currency = detectCurrency(t); continue; }
    if (h.currency === "USD") {
      const detected = detectCurrency(t);
      if (detected !== "USD") h.currency = detected;
    }
  }

  // Backfill `lots` (per-purchase history) on any holding that's missing
  // it (legacy data from before the lot editor existed), stamping a
  // single lot with current shares + avg cost so the user can refine it
  // in the EditTickerModal lot editor.
  //
  // The date is TODAY, not a hardcoded 2025-01-01. Lots are the source
  // of truth for the YTD chart: a lot dated before Jan 1 is treated as
  // held-since-last-year and anchored at the Jan-1 close, so once the
  // calendar rolled past 2025 that constant quietly recategorised every
  // backfilled holding as a prior-year position and skewed both sides of
  // the YTD ratio — the same class of bug as the +80% / +21% / +9%
  // misreports. Dating it today makes the holding an in-year buy at its
  // own cost basis, which contributes 0 to YTD rather than a fabricated
  // return, so an unedited backfill understates rather than invents.
  const backfillDate = new Date().toISOString().slice(0, 10);
  for (const [t, h] of Object.entries(p.holdings)) {
    if (h.isCash || t === "CASH") continue;
    if (Array.isArray(h.lots) && h.lots.length > 0) continue;
    h.lots = [{ date: backfillDate, shares: h.shares, cost: h.cost }];
  }

  // v2 → v3: refresh labels + default subtitles from INITIAL_PORTFOLIO for untouched slots.
  const validKeys = new Set(Object.keys(INITIAL_PORTFOLIO.positions));
  for (const k of Object.keys(p.positions)) {
    if (!validKeys.has(k)) delete p.positions[k];
  }
  const LEGACY_SUBTITLES = new Set(["", "Cash reserves", "Growth", "Value", "Speculative"]);
  for (const [k, defaults] of Object.entries(INITIAL_PORTFOLIO.positions)) {
    const cur = p.positions[k];
    if (!cur) { p.positions[k] = JSON.parse(JSON.stringify(defaults)); continue; }
    if (!cur.label || cur.label.length > 4 || cur.label !== defaults.label) cur.label = defaults.label;
    if (cur.subtitle == null || LEGACY_SUBTITLES.has(cur.subtitle)) cur.subtitle = defaults.subtitle || "";
    if (!cur.role) cur.role = defaults.role;
  }

  // Heal "sold out but never closed" holdings. Before netPosition snapped
  // float dust, a full sale of fractional lots could net to ~5e-17 shares
  // instead of 0, so updateHolding's `np.shares <= 0` close never fired —
  // the holding stayed on the board (and in the header ticker count) with
  // a ~zero position. Re-run the same close here for any holding that HAS
  // sells and nets to ≤0 under the (now snapped) netPosition: mark closed,
  // zero the board fields, strip it from every position's tickers. Only
  // sold holdings are touched (sells present) — legacy rows without a
  // ledger are left alone. Idempotent; mirrors portfolio_edits' close.
  for (const [t, h] of Object.entries(p.holdings)) {
    if (h.isCash || t === "CASH") continue;
    if (!Array.isArray(h.sells) || h.sells.length === 0) continue;
    const np = netPosition(h.lots || [], h.sells);
    if (np.shares > 0) continue;
    const boardShares = Number(h.shares);
    // Only heal float dust when the board ALREADY agrees that this is
    // effectively a zero position. A machine-written / incomplete
    // ledger can net to zero while the board still holds shares at
    // another broker. Closing that mismatch is what removed live
    // positions from the scoreboard after the T212 backfill landed.
    if (Number.isFinite(boardShares) && Math.abs(boardShares) >= 1e-9) continue;
    h.closed = true;
    h.shares = np.shares;
    h.cost   = np.avgCost;
    for (const pos of Object.values(p.positions)) {
      if (pos && Array.isArray(pos.tickers)) pos.tickers = pos.tickers.filter((x) => x !== t);
    }
  }

  // Inverse heal: a closed / zeroed board row whose lot ledger still
  // nets long. The T212 backfill closed live leftovers (NET / TSLA /
  // VST) and dropped them from every tactics slot, so PORTFOLIO
  // silently lost those shares. Put them back. Never raise an OPEN
  // mixed-broker row to its shorter lot-net — that undercounts.
  restoreLeftoverClosedHoldings(p);
  return p;
}

/**
 * Default tactics slot for a leftover ticker, from the seed book.
 * @param {string} ticker
 */
function defaultPositionKeyForTicker(ticker) {
  for (const [key, pos] of Object.entries(INITIAL_PORTFOLIO.positions)) {
    if ((pos.tickers || []).includes(ticker)) return key;
  }
  return null;
}

/**
 * Re-open closed holdings that still have a leftover long lot-net and
 * put them back on the board. Used by `migrate` so the scoreboard and
 * the tactics board see the same shares.
 *
 * @param {{
 *   holdings?: Record<string, any>,
 *   positions?: Record<string, { tickers?: string[] }>,
 * }} p
 */
export function restoreLeftoverClosedHoldings(p) {
  if (!p?.holdings || !p?.positions) return p;
  for (const [ticker, holding] of Object.entries(p.holdings)) {
    if (!holding || holding.isCash || ticker === 'CASH') continue;
    const leftover = netPosition(holding.lots || [], holding.sells || []);
    if (!(leftover.shares > 1e-6)) continue;
    const boardShares = Number(holding.shares);
    const markedClosed = holding.closed === true
      || !(Number.isFinite(boardShares) && boardShares > 0);
    if (!markedClosed) continue;
    holding.closed = false;
    holding.shares = leftover.shares;
    holding.cost = leftover.avgCost;
    const alreadyOnBoard = Object.values(p.positions).some(
      (pos) => Array.isArray(pos?.tickers) && pos.tickers.includes(ticker),
    );
    const remembered = typeof holding.t212PositionKey === 'string'
      ? holding.t212PositionKey
      : '';
    const key = (remembered && p.positions[remembered])
      ? remembered
      : defaultPositionKeyForTicker(ticker);
    if (!alreadyOnBoard && key && p.positions[key] && Array.isArray(p.positions[key].tickers)) {
      p.positions[key].tickers = [...p.positions[key].tickers, ticker];
    }
    if ('t212PositionKey' in holding) delete holding.t212PositionKey;
  }
  return p;
}
