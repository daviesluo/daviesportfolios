// Supabase Edge Function: overnight-record
//
// Cron-triggered every 5 min across the UTC window covering the US
// overnight session (see migration 0016_overnight_cron.sql). Fetches
// T212's `/equity/positions` once and upserts the currentPrice of
// every US-equity holding into `public.overnight_intraday_points`,
// keyed by (ticker, current 5-min bucket). The ticker chart modal
// then reads these via `overnight-fetch` to draw a real overnight
// LINE (20:00-04:00 ET) instead of the single live "heartbeat dot".
//
// Why server-side: Yahoo has no overnight bars and T212 returns only
// one realtime point per call, so the only way to get an overnight
// trend is to sample T212 every few minutes — and that has to run
// even when no browser tab is open, hence a cron worker.
//
// Auth: caller MUST present `Authorization: Bearer <CRON_SECRET>`.
// The cron job sends it (inlined in the cron.schedule body, or via
// the `app.cron_secret` Postgres setting where ALTER DATABASE is
// permitted). Because CRON_SECRET is NOT a Supabase JWT, this
// function MUST be deployed with `--no-verify-jwt` (see PUBLIC_FNS in
// .github/workflows/edge-functions.yml) — otherwise the platform's
// JWT gate 401s the cron call before this handler's own check runs.
//
// Returns:
//   200 { ok: true, bucketTime, recorded: <n> }     — n tickers written
//   200 { ok: true, skipped: "not-overnight" }       — outside 20:00-04:00 ET
//   200 { ok: true, skipped: "weekend-dead-zone" }    — Fri 20:00 → Sun 20:00 ET
//   200 { ok: true, skipped: "no-prices" }            — T212 returned nothing usable
//   403 — bad auth
//   500 — DB write failed

import { isUsMarketHolidayAt } from "../_shared/us_market_calendar.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const SB_URL          = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET     = Deno.env.get("CRON_SECRET") ?? "";
const T212_API_KEY    = Deno.env.get("T212_API_KEY") ?? "";
const T212_API_SECRET = Deno.env.get("T212_API_SECRET") ?? "";
// Optional ISA account — same two-account scheme the trading212
// function uses. Either/both may be set.
const T212_ISA_API_KEY    = Deno.env.get("T212_ISA_API_KEY") ?? "";
const T212_ISA_API_SECRET = Deno.env.get("T212_ISA_API_SECRET") ?? "";

const T212_POSITIONS_URL = "https://live.trading212.com/api/v0/equity/positions";
const BUCKET_MS = 5 * 60 * 1000;

// OTC ADRs that are US-shaped but quote only their regular session —
// no real overnight tape — so they must NOT be recorded as overnight
// points. Mirrors the client's `NO_OVERNIGHT_SESSION` set in
// src/ticker_class.js. Compared upper-cased.
const NO_OVERNIGHT_SESSION = new Set(["SFTBY"]);

// ---------------- Pure helpers (test-pinned) ----------------

/** UTC ISO of the 5-min bucket the given epoch-ms falls into. */
export function bucketTimeIso(now: number): string {
  return new Date(Math.floor(now / BUCKET_MS) * BUCKET_MS).toISOString();
}

/**
 * ET hour-of-week helpers via Intl so DST is resolved by the runtime
 * (no hand-coded offset table). Returns { weekday: 0-6 (Sun=0),
 * minutes: 0-1439 } in America/New_York local time.
 */
export function etParts(at: Date): { weekday: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(at);
  const wdStr = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hh = parseInt(parts.find((p) => p.type === "hour")?.value ?? "", 10);
  const mm = parseInt(parts.find((p) => p.type === "minute")?.value ?? "", 10);
  const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = WD[wdStr] ?? 0;
  // Intl can emit "24" for midnight in some runtimes; normalise.
  const hour = hh === 24 ? 0 : hh;
  return { weekday, minutes: (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(mm) ? mm : 0) };
}

/**
 * Is `at` inside the US overnight session window (20:00-04:00 ET)?
 * 20:00→23:59 OR 00:00→03:59 ET. Day-of-week agnostic here — the
 * weekend dead zone is a separate gate (a Friday-night 20:00 is in
 * the overnight window by clock but excluded by isWeekendDeadZone).
 */
export function isOvernightWindow(at: Date): boolean {
  const { minutes } = etParts(at);
  return minutes >= 20 * 60 || minutes < 4 * 60;
}

/**
 * Weekend dead zone: Fri 20:00 ET → Sun 20:00 ET. US equities incl.
 * the 24/5 overnight session don't trade then, so T212's quote can't
 * move and there's nothing to record. Mirrors src/market_hours.js
 * `isWeekendDeadZone`.
 */
export function isWeekendDeadZone(at: Date): boolean {
  const { weekday, minutes } = etParts(at);
  if (weekday === 6) return true;                 // all Saturday ET
  if (weekday === 5) return minutes >= 20 * 60;   // Fri from 20:00 ET
  if (weekday === 0) return minutes < 20 * 60;    // Sun until 20:00 ET
  return false;
}

/**
 * Is this overnight timestamp part of a session that belongs to a US market
 * HOLIDAY? The overnight session 20:00 ET (D-1) → 04:00 ET (D) belongs to
 * trading day D, so an evening bar (≥20:00 ET) keys off TOMORROW and the
 * 00:00-04:00 tail keys off today. The overnight ATS is shut on full
 * holidays (like the weekend), so T212 returns a frozen close — recording
 * it would draw a flat carry-forward line (the "MSTR flat on July 3" bug).
 * Weekends are the separate isWeekendDeadZone gate. Uses the shared
 * rule-based calendar (`isUsMarketHolidayAt`).
 */
export function isHolidaySession(at: Date): boolean {
  const { minutes } = etParts(at);
  const sessionAt = minutes >= 20 * 60 ? new Date(at.getTime() + 24 * 3_600_000) : at;
  return isUsMarketHolidayAt(sessionAt);
}

/** True when we should be recording right now. */
export function shouldRecord(at: Date): boolean {
  return isOvernightWindow(at) && !isWeekendDeadZone(at) && !isHolidaySession(at);
}

/**
 * Map a T212-internal instrument code to its Yahoo ticker. Replicates
 * `t212TickerToYahoo` from supabase/functions/trading212/index.ts
 * (Edge Functions can't import across function dirs). Kept in lockstep
 * with that table — if a new rename/merge alias is added there, add it
 * here too.
 */
const T212_TO_YAHOO: Record<string, string> = {
  "VUAAl_EQ": "VUAA.L",
  "SAEMl_EQ": "SAEM.L",
};
const T212_US_ALIASES: Record<string, string> = {
  "FB_US_EQ": "META",
  "YNDX_US_EQ": "NBIS",
  "IIVI_US_EQ": "COHR",
  "VACQ_US_EQ": "RKLB",
  "LOKB_US_EQ": "NVTS",
  "GOOGL_US_EQ": "GOOG",
};
export function t212TickerToYahoo(t212Ticker: string): string | null {
  if (typeof t212Ticker !== "string" || !t212Ticker) return null;
  if (T212_TO_YAHOO[t212Ticker]) return T212_TO_YAHOO[t212Ticker];
  if (T212_US_ALIASES[t212Ticker]) return T212_US_ALIASES[t212Ticker];
  const us = t212Ticker.match(/^([A-Za-z]+)_US_EQ$/);
  if (us) return us[1].toUpperCase();
  const lse = t212Ticker.match(/^([A-Za-z]+)l_EQ$/);
  if (lse) return lse[1].toUpperCase() + ".L";
  return null;
}

/** Is this Yahoo ticker a US equity with a real overnight session? */
export function hasOvernightSession(yahooTicker: string): boolean {
  if (typeof yahooTicker !== "string" || !yahooTicker) return false;
  if (NO_OVERNIGHT_SESSION.has(yahooTicker.toUpperCase())) return false;
  // US equity = no dotted exchange suffix, no `^index` / `=futures` /
  // `-USD crypto` markers. The overnight recorder only cares about
  // plain US-listed equities (the set T212 quotes overnight).
  if (yahooTicker.includes(".")) return false;   // .L / .HK / …
  if (yahooTicker.startsWith("^")) return false; // indices
  if (yahooTicker.includes("=")) return false;   // futures / forex
  if (/-USD$/i.test(yahooTicker)) return false;  // crypto
  return true;
}

/**
 * Extract { yahooTicker → currentPrice } for every overnight-eligible
 * US equity in a T212 `/equity/positions` array. Accepts both the
 * flat-`ticker` and nested-`instrument.ticker` row shapes. Drops
 * non-positive / non-finite prices and non-eligible tickers.
 */
export function extractOvernightPrices(positions: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(positions)) return out;
  for (const raw of positions) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    let t212 = typeof p.ticker === "string" ? p.ticker : null;
    if (!t212 && p.instrument && typeof p.instrument === "object") {
      const inst = p.instrument as Record<string, unknown>;
      if (typeof inst.ticker === "string") t212 = inst.ticker;
    }
    if (!t212) continue;
    const yahoo = t212TickerToYahoo(t212);
    if (!yahoo || !hasOvernightSession(yahoo)) continue;
    const cp = Number(p.currentPrice);
    if (Number.isFinite(cp) && cp > 0) out[yahoo] = cp;
  }
  return out;
}

/** Merge two price maps (ISA + invest), invest wins ties. */
export function mergePriceMaps(
  a: Record<string, number>,
  b: Record<string, number>,
): Record<string, number> {
  return { ...b, ...a };
}

// ---------------- I/O ----------------

async function fetchPositions(apiKey: string, apiSecret: string): Promise<unknown> {
  if (!apiKey) return null;
  // Basic when a secret is set (two-key accounts), else raw key — same
  // scheme the trading212 function uses.
  const authHeader = apiSecret ? `Basic ${btoa(`${apiKey}:${apiSecret}`)}` : apiKey;
  try {
    const res = await fetch(T212_POSITIONS_URL, {
      headers: { Authorization: authHeader, Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchAllOvernightPrices(): Promise<Record<string, number>> {
  const [invest, isa] = await Promise.all([
    fetchPositions(T212_API_KEY, T212_API_SECRET),
    T212_ISA_API_KEY ? fetchPositions(T212_ISA_API_KEY, T212_ISA_API_SECRET) : Promise.resolve(null),
  ]);
  const investPrices = extractOvernightPrices(invest);
  const isaPrices    = extractOvernightPrices(isa);
  return mergePriceMaps(investPrices, isaPrices);
}

async function upsertPoints(
  bucketTime: string,
  prices: Record<string, number>,
): Promise<boolean> {
  if (!SB_URL || !SERVICE_KEY) return false;
  const rows = Object.entries(prices).map(([ticker, price]) => ({ ticker, bucket_time: bucketTime, price }));
  if (rows.length === 0) return true;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/overnight_intraday_points`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(rows),
    });
    return res.ok;
  } catch { return false; }
}

// ---------------- Server ----------------

if (import.meta.main) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    const auth = req.headers.get("Authorization") ?? "";
    if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
      return new Response("forbidden", { status: 403, headers: CORS });
    }

    const now = new Date();
    if (isWeekendDeadZone(now)) {
      return new Response(JSON.stringify({ ok: true, skipped: "weekend-dead-zone" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    if (!isOvernightWindow(now)) {
      return new Response(JSON.stringify({ ok: true, skipped: "not-overnight" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const prices = await fetchAllOvernightPrices();
    if (Object.keys(prices).length === 0) {
      return new Response(JSON.stringify({ ok: true, skipped: "no-prices" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const bucketTime = bucketTimeIso(now.getTime());
    const ok = await upsertPoints(bucketTime, prices);
    if (!ok) {
      return new Response(JSON.stringify({ ok: false, error: "db-write-failed" }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    return new Response(
      JSON.stringify({ ok: true, bucketTime, recorded: Object.keys(prices).length }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  });
}
