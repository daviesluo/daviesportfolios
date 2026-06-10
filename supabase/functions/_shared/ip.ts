// Shared client-IP extraction for the Edge Functions.
//
// Single source of truth for "which header identifies the caller".
// Extracted from auth/index.ts (which keys its per-IP lockout on this)
// so other functions that record an IP — e.g. ops-error's error rows —
// can't drift back to the spoofable first-entry parse: ops-error
// carried `xff.split(",")[0]` for months while auth had already moved
// to the last entry for exactly the reason documented below.
//
// IP priority (most-trusted first):
//   1. `x-real-ip` — Supabase's gateway sets this to the actual
//      client IP; not client-settable end-to-end since the gateway
//      overwrites whatever the caller sent.
//   2. **Last** entry of `x-forwarded-for`, NOT the first. Proxies
//      append their source as they forward, so the last value is the
//      most-trusted (set by Supabase's edge); the first entry is
//      whatever the original client sent and is trivially spoofable.
//      The pre-2026 implementation took `xff[0]`, which let an
//      attacker rotate `x-forwarded-for: 1.2.3.4` per request and
//      bypass the per-IP lockout entirely.
//   3. "unknown" sentinel — keeps the limiter keyed per-deploy so a
//      missing header doesn't silently bypass everything.
//
// `cf-connecting-ip` is NOT honoured here even though it would be the
// safest header IF Cloudflare were in our path. The browser calls
// `*.supabase.co` directly — no CF in front — so any incoming
// `cf-connecting-ip` is purely client-supplied and would let an
// attacker pin it to a different value per request to defeat the
// per-IP lockout entirely. Worth re-adding only when the project
// moves behind a CF-managed origin.
export function clientIpFromHeaders(req: Request): string {
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return "unknown";
}
