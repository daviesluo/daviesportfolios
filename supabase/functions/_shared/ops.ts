// Shared server-side error reporter for the Edge Functions.
//
// Every function had its own byte-for-byte copy of this (differing only
// in which local alias it read the service key from — SERVICE_KEY vs
// SUPABASE_SERVICE_ROLE_KEY vs the SB_HEADERS spread), so a change to the
// ops_errors row shape had to be made in six places. Supabase deploys
// each `supabase/functions/<name>/` as its own unit, but functions may
// import from a sibling `_shared/` directory (the `_` prefix keeps it
// from being deployed as a function — see the deploy workflow's
// `grep -v '^_'` guard).
//
// Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY straight from the env
// (Supabase auto-injects both into every function), so callers just
// `import { reportServerError } from "../_shared/ops.ts"` and call it.
// Best-effort: never throws, 3 s timeout, RLS bypassed via service role.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

export async function reportServerError(
  kind: string,
  opts: { message?: string; symbol?: string; context?: unknown } = {},
): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/ops_errors`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        kind,
        symbol: opts.symbol ?? null,
        message: opts.message ? opts.message.slice(0, 512) : null,
        context: opts.context ?? null,
        ip: "edge",
      }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    // best-effort — a failed error-report must not mask the original error
  }
}
