// Supabase Edge Function: sftby-record
//
// Cron-triggered (every 5 min during the UK 13:00-21:00 SFTBY trading
// window — see migration 0012_sftby_cron.sql). Fetches T212's
// currentPrice for SFTBY and upserts it into the
// `public.sftby_intraday_points` table keyed by the current 5-min
// bucket. The modal's chart and the position card's prevClose then
// read from this table via `sftby-fetch`.
//
// Why server-side: until this function existed, SFTBY's chart only
// got new data while the user had the browser tab open. Closing the
// laptop overnight meant the next day's chart was missing the bars
// the user couldn't trade through anyway (UK 13:00-21:00 != US RTH,
// and Yahoo's tape skips the first 1.5h regardless), so we now poll
// T212 from a worker that doesn't need a client to wake it up.
//
// Auth: caller MUST present a Bearer token matching the `CRON_SECRET`
// env var. The cron job sets it from the `app.cron_secret` Postgres
// setting (configured once, out-of-band — see the migration header).
// No other caller is meant to reach this endpoint; if you find
// yourself wanting to test it from curl, set the env var locally.
//
// Returns:
//   200 { ok: true, bucketTime, price } — recorded
//   200 { ok: true, skipped: "session-closed" } — outside UK Mon-Fri 13:00-21:00
//   200 { ok: true, skipped: "no-sftby-price" } — T212 returned nothing for SFTBY (suspended, etc.)
//   403 — bad auth
//   500 — T212 / DB call failed

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

const T212_POSITIONS_URL = "https://live.trading212.com/api/v0/equity/positions";
const BUCKET_MS = 5 * 60 * 1000;

// ---------------- Pure helpers (test-pinned) ----------------

/**
 * UTC ISO of the 5-min bucket the given timestamp falls into. Mirrors
 * the client recorder's bucket math so a server-recorded point lines
 * up exactly with a hypothetical client-recorded one at the same
 * moment.
 */
export function bucketTimeIso(now: number): string {
  return new Date(Math.floor(now / BUCKET_MS) * BUCKET_MS).toISOString();
}

/**
 * Is SFTBY's T212 trading window currently open? Mon-Fri 13:00-21:00
 * London time (BST or GMT depending on the season). We rely on the
 * Intl.DateTimeFormat tz machinery so DST changeover Just Works
 * without a hand-coded offset table.
 */
export function isSftbySessionOpen(at: Date): boolean {
  const day = at.getUTCDay();
  if (day === 0 || day === 6) return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const hh = parseInt(parts.find((p) => p.type === "hour")?.value ?? "", 10);
  if (!Number.isFinite(hh)) return false;
  return hh >= 13 && hh < 21;
}

/**
 * Extract SFTBY's currentPrice from a T212 `/equity/positions` JSON
 * array. T212 labels US-listed instruments with the `_US_EQ` suffix
 * (`SFTBY_US_EQ`), and the ticker can live either flat on the row
 * (`p.ticker`) or under a nested `instrument` object — both shapes
 * appear in the wild, so we accept either.
 */
export function pickSftbyCurrentPrice(positions: unknown): number | null {
  if (!Array.isArray(positions)) return null;
  for (const raw of positions) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    let t = typeof p.ticker === "string" ? p.ticker : null;
    if (!t && p.instrument && typeof p.instrument === "object") {
      const inst = p.instrument as Record<string, unknown>;
      if (typeof inst.ticker === "string") t = inst.ticker;
    }
    if (t !== "SFTBY_US_EQ") continue;
    const cp = Number(p.currentPrice);
    return Number.isFinite(cp) && cp > 0 ? cp : null;
  }
  return null;
}

// ---------------- I/O ----------------

async function fetchT212SftbyPrice(): Promise<number | null> {
  if (!T212_API_KEY || !T212_API_SECRET) return null;
  const cred = btoa(`${T212_API_KEY}:${T212_API_SECRET}`);
  try {
    const res = await fetch(T212_POSITIONS_URL, {
      headers: {
        Authorization: `Basic ${cred}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return pickSftbyCurrentPrice(await res.json());
  } catch { return null; }
}

async function upsertPoint(bucketTime: string, price: number): Promise<boolean> {
  if (!SB_URL || !SERVICE_KEY) return false;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/sftby_intraday_points`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ bucket_time: bucketTime, price }),
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
    if (!isSftbySessionOpen(now)) {
      return new Response(
        JSON.stringify({ ok: true, skipped: "session-closed" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const price = await fetchT212SftbyPrice();
    if (price == null) {
      return new Response(
        JSON.stringify({ ok: true, skipped: "no-sftby-price" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const bucketTime = bucketTimeIso(now.getTime());
    const ok = await upsertPoint(bucketTime, price);
    if (!ok) {
      return new Response(
        JSON.stringify({ ok: false, error: "db-write-failed" }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, bucketTime, price }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  });
}
