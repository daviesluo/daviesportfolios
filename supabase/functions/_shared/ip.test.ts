// Pins for the shared client-IP extraction. auth/index.test.ts pins the
// same behaviours through auth's re-export; this copy keeps the shared
// module covered on its own so a future consumer can't silently change
// the trust order.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { clientIpFromHeaders } from "./ip.ts";

function reqWith(headers: Record<string, string>): Request {
  return new Request("https://example.test/", { headers });
}

Deno.test("clientIpFromHeaders: x-real-ip wins over x-forwarded-for", () => {
  const req = reqWith({
    "x-real-ip": "9.9.9.9",
    "x-forwarded-for": "1.2.3.4, 5.6.7.8",
  });
  assertEquals(clientIpFromHeaders(req), "9.9.9.9");
});

Deno.test("clientIpFromHeaders: x-forwarded-for takes the LAST entry, not the first", () => {
  // First entry is client-supplied (spoofable); last is appended by the
  // most-trusted proxy hop. See the module comment.
  const req = reqWith({ "x-forwarded-for": "6.6.6.6, 7.7.7.7, 8.8.8.8" });
  assertEquals(clientIpFromHeaders(req), "8.8.8.8");
});

Deno.test("clientIpFromHeaders: cf-connecting-ip is ignored (client-supplied on the Supabase-direct path)", () => {
  const req = reqWith({
    "cf-connecting-ip": "6.6.6.6",
    "x-forwarded-for": "1.2.3.4",
  });
  assertEquals(clientIpFromHeaders(req), "1.2.3.4");
});

Deno.test("clientIpFromHeaders: missing headers fall back to the 'unknown' sentinel", () => {
  assertEquals(clientIpFromHeaders(reqWith({})), "unknown");
});
