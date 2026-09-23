// Pins for the read-only Deribit client: credentials only ever in a POST body, the token only ever in a header, only
// the read methods it lists, and a report with no token, no secret and no amount.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DERIBIT_READ_METHODS, deribitProbe } from "./deribit.ts";

type Seen = { method: string; url: string; auth: string | null; body: Record<string, unknown> };
function venue(authError = false) {
  const seen: Seen[] = [];
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    seen.push({ method: body.method, url: String(input), auth: new Headers(init?.headers).get("Authorization"), body });
    if (authError && body.method === "public/auth") {
      return Promise.resolve(new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 13004, message: "invalid_credentials" } }), { status: 400 }));
    }
    const result = body.method === "public/get_index_price" ? { index_price: 86000 }
      : body.method === "public/auth" ? { access_token: "TOKEN-123", refresh_token: "REFRESH-456", expires_in: 900, scope: "account:read trade:read wallet:none" }
      : body.method === "private/get_account_summary" ? { currency: "BTC", equity: 0, balance: 0, available_funds: 0 }
      : { data: [[1, 30, 31, 29, 30.5], [2, 30.5, 32, 30, 31.2]], continuation: null };
    return Promise.resolve(new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 }));
  }) as typeof fetch;
  return { seen, fetchImpl };
}

Deno.test("deribitProbe authenticates in a POST body, reads only, and reports no token, secret or amount", async () => {
  const v = venue();
  const out = await deribitProbe({ clientId: "CID-1", clientSecret: "CSECRET-2", fetchImpl: v.fetchImpl, now: () => 1_000_000_000_000 });
  assertEquals(v.seen.map((s) => s.method), ["public/get_index_price", "public/auth", "private/get_account_summary", "public/get_volatility_index_data", "public/get_volatility_index_data"]);
  for (const s of v.seen) {
    assert((DERIBIT_READ_METHODS as readonly string[]).includes(s.method), s.method);
    assert(!s.url.includes("CSECRET-2") && !s.url.includes("CID-1"), "credentials never in a URL");
  }
  assertEquals(v.seen[1].body.params, { grant_type: "client_credentials", client_id: "CID-1", client_secret: "CSECRET-2" });
  assertEquals(v.seen[2].auth, "Bearer TOKEN-123");
  assertEquals(v.seen.filter((s) => s.auth).length, 1);   // the token goes to the private read and nowhere else
  const text = JSON.stringify(out);
  assert(!text.includes("TOKEN-123") && !text.includes("REFRESH-456") && !text.includes("CSECRET-2"), "no credential in the report");
  assertEquals((out.auth as Record<string, unknown>).scope, "account:read trade:read wallet:none");
  assertEquals((out.account as Record<string, unknown>).funded, false);
  assertEquals((out.dvolBTC as Record<string, unknown>).last, [2, 30.5, 32, 30, 31.2]);
});

Deno.test("deribitProbe reports a refused key and makes no private call with it", async () => {
  const v = venue(true);
  const out = await deribitProbe({ clientId: "CID-1", clientSecret: "wrong", fetchImpl: v.fetchImpl, now: () => 1_000_000_000_000 });
  assert(!v.seen.some((s) => s.method.startsWith("private/")));
  assert(String((out.auth as Record<string, unknown>).error).includes("invalid_credentials"));
  assert("dvolBTC" in out, "the public DVOL read does not need the key");
});
