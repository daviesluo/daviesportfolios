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

// Cross-tab notification channel. When this tab successfully saves the
// portfolio, every other tab gets a `portfolio-saved` message and
// refetches its own copy from the server. Without this:
//   Tab A edits, saves V1 → server = V1
//   Tab B (idle, still showing V0) does its next 30 s price refresh →
//     setPortfolio with V0 + fresh prices → debounced save → server = V0
//   Tab A's edit silently lost.
// BroadcastChannel doesn't deliver to the sender, so a save in Tab A
// only wakes Tab B. The `portfolioUserFingerprint` guard below also
// prevents the price-refresh-triggered re-save in the first place,
// but the broadcast keeps Tab B's UI in sync so the user doesn't
// have to refresh manually to see their own edit.
export const PORTFOLIO_BROADCAST_CHANNEL = 'dp.portfolio';

function dataHeaders() {
  return {
    "apikey": SB_ANON,
    "Authorization": `Bearer ${SB_ANON}`,
    "X-App-Token": getAppToken(),
    "Content-Type": "application/json",
  };
}

export async function loadPortfolioRemote() {
  try {
    const res = await fetch(`${EDGE_DATA_URL}?action=load`, {
      headers: dataHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error("[data] load failed:", res.status, await res.text());
      return JSON.parse(JSON.stringify(INITIAL_PORTFOLIO));
    }
    const { data } = await res.json();
    if (data) {
      const loaded = migrate(data);
      if (!loaded.holdings || Object.keys(loaded.holdings).length === 0) {
        return JSON.parse(JSON.stringify(INITIAL_PORTFOLIO));
      }
      return loaded;
    }
    return JSON.parse(JSON.stringify(INITIAL_PORTFOLIO));
  } catch (e) {
    console.error("[data] load error:", e);
    return JSON.parse(JSON.stringify(INITIAL_PORTFOLIO));
  }
}

export async function savePortfolioRemote(p) {
  if (!p || !p.holdings || Object.keys(p.holdings).length === 0) return;
  try {
    const res = await fetch(`${EDGE_DATA_URL}?action=save`, {
      method: "POST",
      headers: dataHeaders(),
      body: JSON.stringify(p),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error("[data] save failed:", res.status, await res.text());
      return;
    }
    // Tell every other tab on this origin that the persisted portfolio
    // just changed so they can refetch instead of carrying a stale copy
    // that might overwrite our save on their next price-refresh tick.
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel(PORTFOLIO_BROADCAST_CHANNEL);
        bc.postMessage({ kind: 'portfolio-saved', ts: Date.now() });
        bc.close();
      }
    } catch { /* swallow — best-effort cross-tab nudge */ }
  } catch (e) {
    console.error("[data] save error:", e);
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
 * @param {{ positions: Record<string, any>, holdings: Record<string, any> } | null | undefined} p
 */
export function portfolioUserFingerprint(p) {
  if (!p || typeof p !== 'object' || !p.holdings || !p.positions) return '';
  const parts = [];
  for (const k of Object.keys(p.positions).sort()) {
    const pos = p.positions[k] || {};
    const tickers = Array.isArray(pos.tickers) ? [...pos.tickers].sort() : [];
    parts.push(`p:${k}=${pos.role || ''}|${pos.label || ''}|${pos.subtitle || ''}|${tickers.join(',')}`);
  }
  for (const t of Object.keys(p.holdings).sort()) {
    const h = p.holdings[t] || {};
    const lots = Array.isArray(h.lots)
      ? h.lots.map(l => `${l?.date || ''},${l?.shares ?? ''},${l?.cost ?? ''}`).join(';')
      : '';
    parts.push(`h:${t}=${h.shares ?? ''}|${h.cost ?? ''}|${h.currency || ''}|${!!h.isCash}|${lots}`);
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
  // detectCurrency is purely ticker-pattern based, so this is safe to run on
  // every load without overwriting an explicitly-set currency.
  for (const [t, h] of Object.entries(p.holdings)) {
    if (h.currency || h.isCash || t === "CASH") continue;
    h.currency = detectCurrency(t);
  }

  // Backfill `lots` (per-purchase history) on any holding that's missing it
  // (legacy data from before the lot editor existed). Just stamps a single
  // lot dated 2025-01-01 with current shares + avg cost — the user can then
  // refine via the EditTickerModal lot editor. Lots are the source of truth
  // for the YTD chart, so post-migration nothing else should mutate them
  // outside that modal.
  for (const [t, h] of Object.entries(p.holdings)) {
    if (h.isCash || t === "CASH") continue;
    if (Array.isArray(h.lots) && h.lots.length > 0) continue;
    h.lots = [{ date: "2025-01-01", shares: h.shares, cost: h.cost }];
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
  return p;
}
