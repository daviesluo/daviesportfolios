// Pin tests for the ops-error Edge Function's pure helpers — the
// length clipper (anti-spam) and admin token verification (mirrors
// data/auth's HMAC logic, but lives here so the bot summary endpoint
// can stand alone without depending on the data function).
//
// Run locally: `deno test --allow-env supabase/functions/ops-error/`

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { clip, verifyAdminToken } from "./index.ts";
import { makeToken } from "../auth/index.ts";

Deno.test("clip: returns input unchanged when under cap", () => {
  assertEquals(clip("hello", 10), "hello");
  assertEquals(clip("",      10), "");
});

Deno.test("clip: trims to first `max` chars when over cap", () => {
  assertEquals(clip("hello world", 5), "hello");
});

Deno.test("clip: null / undefined → null (keeps row column NULL on insert)", () => {
  assertEquals(clip(null,      32), null);
  assertEquals(clip(undefined, 32), null);
});

Deno.test("clip: coerces non-strings via String() then trims", () => {
  // Sentry-ish payloads sometimes pass numbers (line numbers, etc.)
  // — coercing keeps the insert happy rather than 400ing the report.
  // @ts-expect-error testing wrong type
  assertEquals(clip(12345, 3), "123");
});

Deno.test("verifyAdminToken: accepts a token signed by makeToken with the same secret", async () => {
  const secret = "ops-test-secret-1234";
  const token = await makeToken("admin", secret);
  assertEquals(await verifyAdminToken(token, secret), "admin");
});

Deno.test("verifyAdminToken: returns 'ro' for read-only tokens (caller must enforce admin separately)", async () => {
  const secret = "ops-test-secret-1234";
  const token = await makeToken("ro", secret);
  assertEquals(await verifyAdminToken(token, secret), "ro");
});

Deno.test("verifyAdminToken: rejects empty / malformed / expired", async () => {
  const secret = "ops-test-secret-1234";
  assertEquals(await verifyAdminToken("",          secret), null);
  assertEquals(await verifyAdminToken("nodot",     secret), null);
  assertEquals(await verifyAdminToken(".onlydot",  secret), null);
  // Expired token: TTL is in the past → must fail even with a valid signature.
  const expired = await makeToken("admin", secret, -1);
  assertEquals(await verifyAdminToken(expired, secret), null);
});

Deno.test("verifyAdminToken: rejects when secret is empty (short-circuit)", async () => {
  // Edge Function bootstraps with APP_AUTH_SECRET="" if the env var
  // isn't set; verifyAdminToken must short-circuit rather than try
  // to validate an HMAC under an empty key.
  assertEquals(await verifyAdminToken("anything.signature", ""), null);
});
