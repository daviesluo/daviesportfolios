// Pin tests for the auth Edge Function's pure helpers — HMAC token
// signing, base64url encoding, IP extraction. The Deno.serve(...)
// entry point is guarded by `import.meta.main`, so importing the
// helpers here does NOT bind a port.
//
// Run locally: `deno test --allow-env supabase/functions/auth/`
// CI runs the same via the deploy workflow.

import { assertEquals, assert, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  b64url,
  sign,
  makeToken,
  clientIpFromHeaders,
  WRONG_PASSWORD_DELAY_MS,
  VIEWER_TOKEN_TTL_MS,
  viewerToken,
  viewerTokenResponse,
} from "./index.ts";
import { verifyToken } from "../data/index.ts";

Deno.test("b64url: url-safe alphabet, no padding", () => {
  const s = b64url("hello world!?");
  // base64url has no '+', '/', or '='. It uses '-' and '_' in their place.
  assert(!s.includes("+"));
  assert(!s.includes("/"));
  assert(!s.includes("="));
});

Deno.test("sign: deterministic HMAC-SHA256 — same payload + secret = same sig", async () => {
  const a = await sign("payload", "secret");
  const b = await sign("payload", "secret");
  assertEquals(a, b);
});

Deno.test("sign: different secret produces a different signature", async () => {
  const a = await sign("payload", "secret-1");
  const b = await sign("payload", "secret-2");
  assertNotEquals(a, b);
});

Deno.test("makeToken + verifyToken roundtrip with the same secret succeeds", async () => {
  const secret = "test-secret-1234";
  const token = await makeToken("admin", secret);
  const v = await verifyToken(token, secret);
  assertEquals(v?.role, "admin");
  // exp is "future" (now + 24h by default).
  assert((v?.exp ?? 0) > Date.now());
});

Deno.test("verifyToken: rejects token signed with a different secret", async () => {
  const token = await makeToken("admin", "secret-A");
  const v = await verifyToken(token, "secret-B");
  assertEquals(v, null);
});

Deno.test("verifyToken: rejects expired tokens", async () => {
  const secret = "test-secret-expired";
  // Negative TTL = exp is in the past → must be rejected even with valid signature.
  const token = await makeToken("admin", secret, -1);
  const v = await verifyToken(token, secret);
  assertEquals(v, null);
});

Deno.test("verifyToken: rejects malformed tokens (no dot, empty parts)", async () => {
  assertEquals(await verifyToken("",        "any"), null);
  assertEquals(await verifyToken("nodothere", "any"), null);
  assertEquals(await verifyToken(".",        "any"), null);
});

Deno.test("verifyToken: refuses to operate with an empty secret", async () => {
  // Edge Function bootstraps with SECRET="" if APP_AUTH_SECRET isn't set.
  // verifyToken must short-circuit rather than match an empty HMAC.
  assertEquals(await verifyToken("a.b", ""), null);
});

Deno.test("clientIpFromHeaders: cf-connecting-ip is IGNORED (Supabase-direct path, header is client-supplied)", () => {
  // Critical security pin: the browser calls *.supabase.co directly,
  // no Cloudflare in front, so `cf-connecting-ip` is whatever the
  // attacker wrote. Honouring it would let them rotate the value per
  // request and bypass per-IP lockout entirely. Only x-real-ip /
  // last-xff (both gateway-set) are trusted.
  const req = new Request("https://x", {
    headers: {
      "cf-connecting-ip": "1.2.3.4",       // attacker-supplied
      "x-real-ip":        "9.9.9.9",       // gateway-truth
      "x-forwarded-for":  "5.6.7.8",
    },
  });
  assertEquals(clientIpFromHeaders(req), "9.9.9.9");
});

Deno.test("clientIpFromHeaders: x-real-ip wins over x-forwarded-for when no cf header", () => {
  const req = new Request("https://x", {
    headers: { "x-real-ip": "9.9.9.9", "x-forwarded-for": "5.6.7.8" },
  });
  assertEquals(clientIpFromHeaders(req), "9.9.9.9");
});

Deno.test("clientIpFromHeaders: x-forwarded-for takes the LAST entry, not the first", () => {
  // Proxies append as they forward, so the last hop is the gateway's
  // truth. The first entry is what the original client sent and is
  // trivially spoofable — a per-IP limiter that keys off the first
  // entry can be bypassed by rotating `x-forwarded-for: 1.2.3.4`.
  const req = new Request("https://x", {
    headers: { "x-forwarded-for": "spoofed-by-client, 10.0.0.2, 172.16.0.5" },
  });
  assertEquals(clientIpFromHeaders(req), "172.16.0.5");
});

Deno.test("clientIpFromHeaders: x-forwarded-for with one entry returns that entry", () => {
  const req = new Request("https://x", { headers: { "x-forwarded-for": "10.0.0.1" } });
  assertEquals(clientIpFromHeaders(req), "10.0.0.1");
});

Deno.test("clientIpFromHeaders: missing headers → 'unknown' sentinel (limiter keys safely)", () => {
  assertEquals(clientIpFromHeaders(new Request("https://x")), "unknown");
});

Deno.test("WRONG_PASSWORD_DELAY_MS is on (regressions to 0 would re-open the brute-force window)", () => {
  // 4-digit numeric passwords have a 10⁴ keyspace; per-IP lockout
  // can be bypassed by IP rotation, so the response-latency throttle
  // is the secondary defense. Pin it on so a future refactor that
  // accidentally drops the await would break CI.
  assert(WRONG_PASSWORD_DELAY_MS >= 200);
});

// ---- The operator's viewer token (`?action=viewer-token`; Davies, 2026-10-29) --------------------------------------
// Invented secrets, as every fixture's.
const VT_ENV = { cronSecret: "cron-test-secret", viewerPwd: "ro-pass-test", roPwd: "ro-pass-test", adminPwd: "admin-pass-test", secret: "sign-test-secret" };
const leaks = (body: Record<string, unknown>) =>
  [VT_ENV.cronSecret, VT_ENV.viewerPwd, VT_ENV.roPwd, VT_ENV.adminPwd, VT_ENV.secret].filter((v) => JSON.stringify(body).includes(v));

Deno.test("viewerToken: only the cron bearer gets one; a missing, wrong or empty bearer is 401 and says nothing else", async () => {
  for (const auth of [null, "", "Bearer ", "Bearer wrong", "cron-test-secret", "Basic cron-test-secret", `Bearer ${VT_ENV.cronSecret}x`]) {
    const out = await viewerToken(auth, VT_ENV);
    assertEquals(out.status, 401, String(auth));
    assertEquals(out.body, { error: "unauthorised" });
  }
  // No CRON_SECRET configured: nothing, not even an empty bearer, opens it.
  assertEquals((await viewerToken("Bearer ", { ...VT_ENV, cronSecret: "" })).status, 503);
});

Deno.test("viewerToken: a read-only token of 30 minutes that the verifying functions accept, and never a password", async () => {
  const t0 = Date.now();
  const out = await viewerToken(`Bearer ${VT_ENV.cronSecret}`, VT_ENV);
  assertEquals(out.status, 200);
  assertEquals(Object.keys(out.body).sort(), ["exp", "role", "token"]);
  assertEquals(out.body.role, "ro");
  const v = await verifyToken(out.body.token as string, VT_ENV.secret);
  assertEquals(v?.role, "ro");
  assertEquals(v?.exp, out.body.exp);
  assert(VIEWER_TOKEN_TTL_MS <= 30 * 60 * 1000);
  assert((out.body.exp as number) >= t0 + VIEWER_TOKEN_TTL_MS && (out.body.exp as number) <= Date.now() + VIEWER_TOKEN_TTL_MS);
  // Signed with the app's secret, so another secret's check refuses it.
  assertEquals(await verifyToken(out.body.token as string, "another-secret"), null);
  assertEquals(leaks(out.body), []);
});

Deno.test("viewerToken: no token unless the stored password IS the read-only one; never admin", async () => {
  const bearer = `Bearer ${VT_ENV.cronSecret}`;
  const admin = await viewerToken(bearer, { ...VT_ENV, viewerPwd: VT_ENV.adminPwd });
  assertEquals(admin.status, 409);
  const other = await viewerToken(bearer, { ...VT_ENV, viewerPwd: "something-else" });
  assertEquals(other.status, 409);
  const unset = await viewerToken(bearer, { ...VT_ENV, viewerPwd: "" });
  assertEquals(unset.status, 503);
  const unconfigured = await viewerToken(bearer, { ...VT_ENV, secret: "" });
  assertEquals(unconfigured.status, 500);
  for (const o of [admin, other, unset, unconfigured]) {
    assertEquals(o.body.token, undefined);
    assertEquals(leaks(o.body), []);
  }
});

Deno.test("viewer-token route: other requests go on to the password form; a refusal waits, nothing is cached", async () => {
  assertEquals(await viewerTokenResponse(new Request("https://x/auth", { method: "POST" }), VT_ENV), null);
  assertEquals(await viewerTokenResponse(new Request("https://x/auth?action=other", { method: "POST" }), VT_ENV), null);
  const t0 = Date.now();
  const refused = await viewerTokenResponse(new Request("https://x/auth?action=viewer-token", { method: "POST", headers: { authorization: "Bearer nope" } }), VT_ENV);
  assertEquals(refused?.status, 401);
  assert(Date.now() - t0 >= WRONG_PASSWORD_DELAY_MS - 5);
  assertEquals(refused?.headers.get("cache-control"), "no-store");
  await refused?.body?.cancel();
  const ok = await viewerTokenResponse(new Request("https://x/auth?action=viewer-token", { method: "POST", headers: { authorization: `Bearer ${VT_ENV.cronSecret}` } }), VT_ENV);
  assertEquals(ok?.status, 200);
  assertEquals(ok?.headers.get("cache-control"), "no-store");
  const body = await ok!.json();
  assertEquals(body.role, "ro");
  assertEquals(leaks(body), []);
});
