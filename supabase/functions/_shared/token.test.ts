// Pins for the shared HMAC token verify. Mirrors the per-function
// token tests so the relocated helper can't silently regress.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sign, verifyToken, b64url, constantTimeEqual } from "./token.ts";

const SECRET = "test-secret-deadbeef-deadbeef-deadbeef";

async function makeToken(role: string, exp: number): Promise<string> {
  const payload = b64url(JSON.stringify({ role, exp }));
  const sig = await sign(payload, SECRET);
  return `${payload}.${sig}`;
}

Deno.test("verifyToken accepts a valid admin token", async () => {
  const v = await verifyToken(await makeToken("admin", Date.now() + 60_000), SECRET);
  assertEquals(v?.role, "admin");
});

Deno.test("verifyToken accepts a valid ro token", async () => {
  const v = await verifyToken(await makeToken("ro", Date.now() + 60_000), SECRET);
  assertEquals(v?.role, "ro");
});

Deno.test("verifyToken rejects an expired token", async () => {
  assertEquals(await verifyToken(await makeToken("admin", Date.now() - 1000), SECRET), null);
});

Deno.test("verifyToken rejects a tampered signature", async () => {
  const t = await makeToken("admin", Date.now() + 60_000);
  const bad = t.slice(0, -1) + (t.endsWith("A") ? "B" : "A");
  assertEquals(await verifyToken(bad, SECRET), null);
});

Deno.test("verifyToken rejects an unknown role", async () => {
  assertEquals(await verifyToken(await makeToken("superuser", Date.now() + 60_000), SECRET), null);
});

Deno.test("verifyToken rejects malformed and wrong-secret tokens", async () => {
  assertEquals(await verifyToken("", SECRET), null);
  assertEquals(await verifyToken("no-dot-here", SECRET), null);
  const t = await makeToken("admin", Date.now() + 60_000);
  assertEquals(await verifyToken(t, "the-wrong-secret"), null);
});

Deno.test("constantTimeEqual basic correctness", () => {
  assertEquals(constantTimeEqual("abc", "abc"), true);
  assertEquals(constantTimeEqual("abc", "abd"), false);
  assertEquals(constantTimeEqual("abc", "ab"), false);
  assertEquals(constantTimeEqual("", ""), true);
});
