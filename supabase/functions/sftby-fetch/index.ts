// Supabase Edge Function: sftby-fetch
//
// Returns SFTBY's intraday series + prevClose, both derived from
// `public.sftby_intraday_points` (populated by `sftby-record` on a
// pg_cron schedule — see migration 0011 + 0012). The client modal
// reads this on every doRefresh to keep its chart + the "since
// previous close" pct in sync with the broker's last trade, since
// Yahoo's tape for this OTC pink-sheet ADR is unreliable.
//
// Response:
//   { series: [{date: 'YYYY-MM-DDTHH:MM', close, volume: 0}, ...],
//     prevClose: number | null,
//     prevCloseDate: string | null }   // YYYY-MM-DD of the prevClose bucket
//
// `series` is TODAY's points (London-local date), oldest-first.
// `prevClose` is the close of the LAST bucket in the most recent
// previous trading day (skips weekends / cron-missed days
// automatically — we just pick the latest pre-today bucket on file).
//
// Auth: anon-readable (the apikey check Supabase does on every Edge
// Function is enough — this is the public surface the modal hits on
// every refresh). No additional secret.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

const SB_URL      = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ---------------- Pure helpers (test-pinned) ----------------

/**
 * London-local YYYY-MM-DD for a given moment. The "today" boundary
 * for SFTBY's chart is the London calendar day so the chart resets
 * when the next session opens at UK 13:00, not at UTC midnight.
 */
export function londonDateIso(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

/**
 * Shape DB rows into the response. Splits points into today's series
 * (London-local) and the rest; takes the LAST row of the rest as
 * prevClose (the close of the most recent pre-today bucket).
 *
 * Rows are expected oldest-first.
 */
export function shapeResponse(
  rows: Array<{ bucket_time: string; price: number | string }>,
  now: Date,
): { series: Array<{ date: string; close: number; volume: number }>; prevClose: number | null; prevCloseDate: string | null } {
  const todayKey = londonDateIso(now);
  const todays: typeof rows = [];
  const before: typeof rows = [];
  for (const r of rows) {
    const dateOnly = londonDateIso(new Date(r.bucket_time));
    if (dateOnly === todayKey) todays.push(r);
    else before.push(r);
  }
  const series = todays.map((r) => ({
    date: r.bucket_time.slice(0, 16),
    close: typeof r.price === "number" ? r.price : parseFloat(String(r.price)),
    volume: 0,
  }));
  const prev = before.length > 0 ? before[before.length - 1] : null;
  return {
    series,
    prevClose: prev ? (typeof prev.price === "number" ? prev.price : parseFloat(String(prev.price))) : null,
    prevCloseDate: prev ? londonDateIso(new Date(prev.bucket_time)) : null,
  };
}

// ---------------- I/O ----------------

async function readPoints(cutoff: string): Promise<Array<{ bucket_time: string; price: number | string }>> {
  if (!SB_URL || !SERVICE_KEY) return [];
  const url = `${SB_URL}/rest/v1/sftby_intraday_points` +
    `?bucket_time=gte.${encodeURIComponent(cutoff)}` +
    `&order=bucket_time.asc` +
    `&select=bucket_time,price`;
  const res = await fetch(url, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return [];
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

// ---------------- Server ----------------

if (import.meta.main) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    // 26h covers today's session + at least one prior trading day's
    // session for prevClose (with margin for cron-missed firings or
    // long weekends). Older points stay on disk for debugging but
    // don't need to ride along on every fetch.
    const now = new Date();
    const cutoff = new Date(now.getTime() - 26 * 3_600_000).toISOString();
    let rows: Array<{ bucket_time: string; price: number | string }> = [];
    try { rows = await readPoints(cutoff); }
    catch { rows = []; }
    const body = shapeResponse(rows, now);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        ...CORS,
        "Content-Type": "application/json",
        // Browser cache 0 — let the client decide TTL via its own cache.
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  });
}
