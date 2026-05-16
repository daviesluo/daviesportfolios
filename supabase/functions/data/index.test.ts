// Pin tests for the data Edge Function's HMAC token verification.
// The interesting roundtrip case (sign in auth → verify in data) is
// already exercised in auth/index.test.ts; this file pins the
// data-side helpers in isolation so a refactor that breaks one
// without breaking the other doesn't silently land.
//
// Run locally: `deno test --allow-env supabase/functions/data/`

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { b64url, sign, verifyToken, constantTimeEqual } from "./index.ts";

Deno.test("b64url: url-safe alphabet, no padding", () => {
  const s = b64url("hello world!?");
  for (const ch of ["+", "/", "="]) {
    assertEquals(s.includes(ch), false);
  }
});

Deno.test("sign + verifyToken roundtrip: payload.signature accepted with same secret", async () => {
  const secret = "data-test-secret";
  // Hand-build a token using data's own sign/b64url so we don't depend on auth here.
  const payload = b64url(JSON.stringify({ role: "admin", exp: Date.now() + 60_000 }));
  const signature = await sign(payload, secret);
  const token = `${payload}.${signature}`;
  const v = await verifyToken(token, secret);
  assertEquals(v?.role, "admin");
});

Deno.test("verifyToken: rejects ro tokens? — no, ro is valid; admin enforcement is the caller's job", async () => {
  // verifyToken's job is to confirm the signature + exp; the caller in
  // ./index.ts does `if (verified.role !== 'admin') return 403` for
  // write actions. This test pins that semantic.
  const secret = "data-test-secret";
  const payload = b64url(JSON.stringify({ role: "ro", exp: Date.now() + 60_000 }));
  const signature = await sign(payload, secret);
  const v = await verifyToken(`${payload}.${signature}`, secret);
  assertEquals(v?.role, "ro");
});

Deno.test("verifyToken: rejects token with role outside admin/ro", async () => {
  const secret = "data-test-secret";
  const payload = b64url(JSON.stringify({ role: "other", exp: Date.now() + 60_000 }));
  const signature = await sign(payload, secret);
  assertEquals(await verifyToken(`${payload}.${signature}`, secret), null);
});

Deno.test("constantTimeEqual: equal strings return true", () => {
  assert(constantTimeEqual("hello", "hello"));
  assert(constantTimeEqual("", ""));
});

Deno.test("constantTimeEqual: different content returns false", () => {
  assert(!constantTimeEqual("hello", "world"));
  assert(!constantTimeEqual("hello", "hellp"));   // last byte differs
  assert(!constantTimeEqual("aello", "hello"));   // first byte differs
});

Deno.test("constantTimeEqual: different length returns false", () => {
  assert(!constantTimeEqual("hello", "helloo"));
  assert(!constantTimeEqual("hello", "hell"));
  assert(!constantTimeEqual("", "x"));
});
