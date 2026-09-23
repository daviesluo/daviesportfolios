// Public CORS proxy chain + per-proxy backoff cache.
//
// The Edge Function /functions/v1/prices does the bulk of Yahoo
// fetching server-side, but a CORS-proxy fallback exists for:
//   - cold Edge deploys / outages,
//   - CN funds where Deno Deploy's egress IPs sometimes get
//     geo-blocked from eastmoney / pingzhongdata.
// All 5 hosts are free public proxies with aggressive per-IP rate
// limits; without the backoff cache, one bad proxy poisons every
// 30s refresh until the user reloads.

export const PROXIES = [
  (url) => `https://api.cors.lol/?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  (url) => `https://cors.eu.org/${url}`,
];

// Per-proxy backoff cache. When a proxy returns 429 / 403 / 5xx (or
// times out) we mark it "dead" for `PROXY_BACKOFF_MS` so the next
// 30-second refresh tick skips it instead of immediately re-hammering
// the same broken host. Cleared on success and on natural expiry.
//
// In-memory only — resets on page reload (intentional; proxies recover
// over time and we'd rather re-probe a fresh tab than carry a 10-min
// suspicion across sessions).
export const PROXY_BACKOFF_MS = 10 * 60_000;
const _proxyBackoff = new Map(); // index → expire-at ms

export function proxyIsAvailable(i, now = Date.now()) {
  const t = _proxyBackoff.get(i);
  if (t == null) return true;
  if (t > now) return false;
  _proxyBackoff.delete(i);   // expired — clear and let it back in
  return true;
}
export function markProxyDead(i, durationMs = PROXY_BACKOFF_MS) {
  _proxyBackoff.set(i, Date.now() + durationMs);
}
export function clearProxyBackoff(i) {
  if (i == null) _proxyBackoff.clear();
  else _proxyBackoff.delete(i);
}

// Bounded-concurrency map for per-ticker proxy fallbacks. Each ticker's
// fallback races ALL proxies at once, so an unbounded `missing.map(...)`
// over a 30-ticker portfolio fires 30 × 5 = 150 simultaneous fetches
// the moment the Edge Function is down — enough for Chromium to start
// rejecting them outright with net::ERR_INSUFFICIENT_RESOURCES, turning
// a degraded refresh into a totally failed one. 6 tickers at a time
// (≤30 in-flight fetches) keeps the fallback fast without the pile-up.
export async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
