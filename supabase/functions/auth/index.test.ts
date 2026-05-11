// Pin tests for the auth Edge Function's pure helpers — HMAC token
// signing, base64url encoding, IP extraction. The Deno.serve(...)
// entry point is guarded by `import.meta.main`, so importing the
// helpers here does NOT bind a port.
//
// Run locally: `deno test --allow-env supabase/functions/auth/`
// CI runs the same via the deploy workflow.

import { assertEquals, assert, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { b64url, sign, makeToken, clientIpFromHeaders } from "./index.ts";
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

Deno.test("clientIpFromHeaders: cf-connecting-ip wins over x-forwarded-for", () => {
  const req = new Request("https://x", {
    headers: { "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8" },
  });
  assertEquals(clientIpFromHeaders(req), "1.2.3.4");
});

Deno.test("clientIpFromHeaders: x-forwarded-for falls back when no cf header; first IP only", () => {
  const req = new Request("https://x", { headers: { "x-forwarded-for": "10.0.0.1, 10.0.0.2" } });
  assertEquals(clientIpFromHeaders(req), "10.0.0.1");
});

Deno.test("clientIpFromHeaders: missing headers → 'unknown' sentinel (limiter keys safely)", () => {
  assertEquals(clientIpFromHeaders(new Request("https://x")), "unknown");
});
