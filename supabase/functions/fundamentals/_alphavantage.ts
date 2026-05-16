// Alpha Vantage integration for the 4 big US indices via ETF proxies
// (^GSPC → SPY, ^NDX → QQQ, ^RUT → IWM, ^SOX → SOXX). AV's free
// tier is the strict-est of the three vendors at 1 req/s + 25 req/day
// so we layer it as: fresh cache → live AV → stale cache → hardcoded
// fallback. `resolveIndexPe` walks that fallback chain per symbol.

import {
  ALPHAVANTAGE_API_KEY,
  INDEX_ETF_PROXY,
  INDEX_PE_3Y_AVG,
  INDEX_PE_FALLBACK,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  sleep,
  type AvResult,
  type Fundamentals,
} from "./_shared.ts";
import { readCachedPe, writeCachedPe, CACHE_TTL_MS } from "./_caches.ts";

// Inter-request delay enforced by AV's free tier. The header allowance
// is 1 req / sec; 1.2 s gives a 20% safety margin so back-to-back
// queries never trip the throttle even when network jitter is
// counted as request time on AV's side.
const AV_INTER_REQUEST_MS = 1_200;

// Daily quota cap. AV free tier = 25/day; cap our claim at 20 so
// there's a 5-call buffer for human-triggered tests / one-off
// probes outside the Edge Function. Counter lives in `av_quota`
// per migration 0012; the `try_claim_av_call` RPC atomically
// increments and returns whether we're under the cap.
const AV_DAILY_CAP = 20;

async function tryClaimAvCall(): Promise<boolean> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return true; // dev / env-missing → don't block
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/try_claim_av_call`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ max_calls: AV_DAILY_CAP }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      // 404 → migration 0012 not applied; fall open (don't block)
      // and log the missing-migration symptom for the maintainer.
      const snippet = (await res.text().catch(() => "")).slice(0, 200);
      if (snippet.includes("42883") || snippet.includes("42P01")) {
        console.error(
          `AV quota RPC ${res.status} — re-apply migration 0012 ` +
          `(av_quota table + try_claim_av_call RPC). Falling open. Raw: ${snippet}`,
        );
      } else {
        console.error(`AV quota RPC ${res.status}: ${snippet}`);
      }
      return true;
    }
    return (await res.json()) === true;
  } catch (e) {
    console.error("AV quota RPC error:", e instanceof Error ? e.message : e);
    return true; // fail open
  }
}

export async function fetchAlphaVantageEtfPe(etfSymbol: string): Promise<AvResult> {
  if (!ALPHAVANTAGE_API_KEY) return { ok: false, rateLimited: false };
  // Circuit breaker: refuse to fire the live AV call once we've
  // burned through the daily budget. Behaves like a rate-limited
  // response so `resolveIndexPe` falls through to stale cache or
  // hardcoded fallback. Without this guard a cache-bypass scenario
  // (RLS regression, env-typo) would drain the 25 / day in an hour
  // and leave 23 h of users on the static fallback.
  const allowed = await tryClaimAvCall();
  if (!allowed) {
    console.error(`AV daily cap (${AV_DAILY_CAP}) reached — refusing live call for ${etfSymbol}`);
    return { ok: false, rateLimited: true };
  }
  const url = `https://www.alphavantage.co/query?function=OVERVIEW` +
    `&symbol=${encodeURIComponent(etfSymbol)}` +
    `&apikey=${encodeURIComponent(ALPHAVANTAGE_API_KEY)}`;
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return { ok: false, rateLimited: false };
    const data = await res.json();
    // AV signals throttle / quota issues by returning a JSON envelope
    // with `Information` (per-second rate hint) or `Note` (daily
    // quota). Bail loudly so the caller can stop pounding AV with the
    // remaining ETFs in the same batch.
    if (data?.Information || data?.Note) {
      return { ok: false, rateLimited: true };
    }
    const pe = Number(data?.PERatio);
    if (isFinite(pe) && pe > 0) return { ok: true, pe };
    // Empty `{}` shape on free tier when bursts overlap — also treat
    // as rate-limit so we don't keep firing.
    if (!data || Object.keys(data).length === 0) {
      return { ok: false, rateLimited: true };
    }
    return { ok: false, rateLimited: false };
  } catch {
    return { ok: false, rateLimited: false };
  }
}

// Index dispatcher — sequential per call site (the handler runs it
// in a single-threaded loop) to respect AV's 1 req/s cap. The two
// little mutable boxes (`avBlocked`, `isFirstAvCall`) are how the
// caller threads state across iterations without globals.
export async function resolveIndexPe(
  indexSymbol: string,
  avBlocked: { value: boolean },
  isFirstAvCall: { value: boolean },
): Promise<Fundamentals | null> {
  const etf = INDEX_ETF_PROXY[indexSymbol];
  if (!etf) return null;

  const cached = await readCachedPe(etf);
  if (cached && cached.ageMs < CACHE_TTL_MS) {
    // (a) fresh cache
    return { pe: cached.pe, eps: 0, pe3yAvg: INDEX_PE_3Y_AVG[indexSymbol] ?? null };
  }

  // Stale or missing — try AV unless the batch already saw a rate
  // limit (any further calls would just compound the problem and burn
  // daily quota for nothing).
  if (!avBlocked.value && ALPHAVANTAGE_API_KEY) {
    if (!isFirstAvCall.value) {
      // Pace consecutive AV calls to honour the free-tier 1 req/s cap.
      await sleep(AV_INTER_REQUEST_MS);
    }
    isFirstAvCall.value = false;
    const av = await fetchAlphaVantageEtfPe(etf);
    if (av.ok) {
      // (b) live AV — write back and use.
      await writeCachedPe(etf, av.pe);
      return { pe: av.pe, eps: 0, pe3yAvg: INDEX_PE_3Y_AVG[indexSymbol] ?? null };
    }
    if (av.rateLimited) avBlocked.value = true;
  }

  // (c) stale cache — better than the static fallback because it's
  // still real AV-sourced data, just possibly a few days old.
  if (cached) {
    return { pe: cached.pe, eps: 0, pe3yAvg: INDEX_PE_3Y_AVG[indexSymbol] ?? null };
  }

  // (d) hardcoded fallback — only on first deploy or total outage.
  const fb = INDEX_PE_FALLBACK[indexSymbol];
  if (fb) {
    return { pe: fb, eps: 0, pe3yAvg: INDEX_PE_3Y_AVG[indexSymbol] ?? null };
  }
  return null;
}
