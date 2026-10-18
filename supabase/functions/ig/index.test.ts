// Pins for the `ig` function: demo host only, the read-only list, no secret in any output, the beat first, the windows,
// the allowance discipline, and the recorder's shape. Run: deno test --allow-env supabase/functions/
import { assert, assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import frozen from "../../../docs/agents/backtests/ig_deepdive/params/g2_s1a_frozen.json" with { type: "json" };
import {
  adoptTokens, assertAllowed, demoCreds, IG_DEMO_BASE, IG_DEMO_SECRET_NAMES, IG_ENVIRONMENT, IgClient, IgRefused, scrubDeep, stripBalances,
} from "./client.ts";
import { candidates, expiryOrder, parsePins, pickEpics, type SearchMarket } from "./epics.ts";
import {
  activeWindows, DB_WINDOW, HISTORY_ANCHOR_FRIDAY, HISTORY_PAD_MS, HISTORY_PLANS, HISTORY_WEEKENDS, historyFridays, historyWindows,
  inDbWindow, QUOTE_WINDOWS, ukClock, ukOffsetMs, ukToUtcMs,
} from "./windows.ts";
import {
  accountOf, ALLOWANCE_RESERVE, knownAllowance, quoteEpics, runFacts, runHistory, runQuotes, samplesOf, shouldReport, type Rest,
} from "./actions.ts";
import { authorise, handle, type Deps } from "./index.ts";

const CREDS = { key: "demo-key-0123456789abcdef", username: "davies-demo-user", password: "p@ss w0rd/secret" };
const ENV = {
  [IG_DEMO_SECRET_NAMES.key]: CREDS.key, [IG_DEMO_SECRET_NAMES.username]: CREDS.username, [IG_DEMO_SECRET_NAMES.password]: CREDS.password,
  CRON_SECRET: "cron-secret-for-tests",
};
const CST = "CST-token-abcdef0123456789";
const XST = "XST-token-fedcba9876543210";
const SECRETS = [CREDS.key, CREDS.username, CREDS.password, CST, XST];

/** No secret, and no URL-encoded secret, anywhere in a value. */
function assertClean(v: unknown, where: string) {
  const s = JSON.stringify(v);
  for (const sec of SECRETS) {
    assert(!s.includes(sec), `${where} leaks a secret`);
    assert(!s.includes(encodeURIComponent(sec)), `${where} leaks an encoded secret`);
  }
}

type Call = { method: string; url: string; headers: Record<string, string>; body: string | null };

/** A fake IG demo API. Each answer echoes what a careless server might: the username, and the CST in an error. */
function fakeIg(o: {
  markets?: Record<string, SearchMarket[]>;
  prices?: (epic: string, q: URLSearchParams) => { status: number; body: unknown };
  snapshot?: (epic: string, account: string) => Record<string, unknown>;
  tokenInvalidOnce?: boolean;
  /** Every call but a login answers 401 account-token-invalid (the recorder's state on 10-17/18, whatever IG's cause). */
  accountTokenAlwaysInvalid?: boolean;
  /** A token is refused (account-token-invalid) until this long after it was issued, on the clock `now`. */
  warmupMs?: number;
  now?: () => number;
} = {}) {
  const calls: Call[] = [];
  let account = "Z6F18J";
  // IG's X-SECURITY-TOKEN names the current account: a login hands out the default account's, a switch a new one in the
  // answer's headers alone (no CST), and from then on only the new one is accepted (production, 2026-10-15).
  let accountToken = XST;
  let invalid = o.tokenInvalidOnce ?? false;
  let issuedAt = 0;
  const clock = o.now ?? (() => 0);
  const res = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", date: "Sun, 18 Oct 2026 20:00:00 GMT", ...headers } });
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    calls.push({ method: init?.method ?? "GET", url: url.toString(), headers, body: (init?.body as string) ?? null });
    const path = url.pathname.replace("/gateway/deal", "");
    const method = init?.method ?? "GET";
    if (method === "POST" && path === "/session") {
      account = "Z6F18J";
      accountToken = XST;
      issuedAt = clock();
      return res(200, {
        accountType: "CFD", currencyIsoCode: "GBP", currentAccountId: "Z6F18J", clientId: "CLIENT-1", timezoneOffset: 1,
        lightstreamerEndpoint: "https://demo-apd.marketdatasystems.com", hasActiveDemoAccounts: true, hasActiveLiveAccounts: true,
        accountInfo: { balance: 10000, deposit: 0, profitLoss: 0, available: 10000 },
        accounts: [
          { accountId: "Z6F18J", accountName: "CFD", accountType: "CFD", preferred: true },
          { accountId: "Z6F18K", accountName: "Spread bet", accountType: "SPREADBET", preferred: false },
        ],
        echo: `welcome ${CREDS.username}`,
      }, { CST, "X-SECURITY-TOKEN": XST });
    }
    if (headers["cst"] !== CST) return res(401, { errorCode: "error.security.client-token-invalid" });
    if (headers["x-security-token"] !== accountToken) return res(401, { errorCode: "error.security.account-token-invalid" });
    if (o.accountTokenAlwaysInvalid) return res(401, { errorCode: "error.security.account-token-invalid" });
    if (o.warmupMs && clock() - issuedAt < o.warmupMs) return res(401, { errorCode: "error.security.account-token-invalid" });
    if (invalid && method === "GET") {
      invalid = false;
      return res(401, { errorCode: "error.security.client-token-invalid", token: CST });
    }
    if (method === "PUT" && path === "/session") {
      const b = JSON.parse(init?.body as string);
      if (b.accountId === account) return res(412, { errorCode: "error.switch.accountId-must-be-different" });
      account = b.accountId;
      accountToken = `${XST}-${account}`;
      issuedAt = clock();
      return res(200, { dealingEnabled: true }, { "X-SECURITY-TOKEN": accountToken });
    }
    if (path === "/accounts") {
      return res(200, { accounts: [{ accountId: account, accountName: "x", accountType: account === "Z6F18K" ? "SPREADBET" : "CFD", balance: { balance: 10000, available: 10000 }, currency: "GBP", status: "ENABLED" }] });
    }
    if (path === "/marketnavigation") return res(200, { nodes: [{ id: "1", name: "Indices" }], markets: null });
    if (path === "/markets" && url.searchParams.has("searchTerm")) {
      const term = url.searchParams.get("searchTerm")!;
      return res(200, { markets: (o.markets ?? {})[`${account}|${term}`] ?? [] });
    }
    if (path === "/markets" && url.searchParams.has("epics")) {
      const epics = url.searchParams.get("epics")!.split(",");
      return res(200, { marketDetails: epics.map((e) => ({ instrument: { epic: e, type: "CURRENCIES" }, snapshot: o.snapshot?.(e, account) ?? { bid: 6543.1, offer: 6544.0, marketStatus: "TRADEABLE", updateTime: "21:01:00", delayTime: 0 } })) });
    }
    if (path.startsWith("/markets/")) {
      const epic = path.split("/")[2];
      return res(200, { instrument: { epic, marketId: "AUDUSD", openingHours: null, marginDepositBands: [{ min: 0, max: 1000, margin: 3.33 }] }, dealingRules: { minDealSize: { unit: "POINTS", value: 0.5 } }, snapshot: { marketStatus: "CLOSED" } });
    }
    if (path.startsWith("/clientsentiment/")) return res(200, { longPositionPercentage: 60, shortPositionPercentage: 40, marketId: "AUDUSD" });
    if (path.startsWith("/prices/")) {
      const a = o.prices?.(path.split("/")[2], url.searchParams) ?? { status: 200, body: { prices: [], metadata: { allowance: { remainingAllowance: 9990, totalAllowance: 10000, allowanceExpiry: 500000 } } } };
      return res(a.status, a.body);
    }
    return res(404, { errorCode: "not.found" });
  }) as typeof fetch;
  return { impl, calls, account: () => account };
}

/** An in-memory `Rest` with the few queries the actions make. */
function fakeRest() {
  const tables: Record<string, Record<string, unknown>[]> = { ig_facts: [], ig_price_pulls: [], ig_quote_runs: [] };
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
  let id = 0;
  const rest: Rest = {
    insert(table, rows) {
      for (const r of Array.isArray(rows) ? rows : [rows]) (tables[table] ??= []).push({ id: ++id, at: new Date(Date.UTC(2026, 9, 18, 20)).toISOString(), ...(r as object) });
      return Promise.resolve();
    },
    select<T>(table: string, query: string, limit?: number): Promise<T[]> {
      let rows = [...(tables[table] ?? [])];
      for (const [k, v] of new URLSearchParams(query)) {
        if (v.startsWith("eq.")) rows = rows.filter((r) => String(r[k]) === v.slice(3));
      }
      if (/order=id\.desc/.test(query)) rows.sort((a, b) => Number(b.id) - Number(a.id));
      return Promise.resolve((limit ? rows.slice(0, limit) : rows) as T[]);
    },
    rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      rpcs.push({ fn, args });
      return Promise.resolve(((args.samples as unknown[])?.length ?? 0) as T);
    },
  };
  return { rest, tables, rpcs };
}

const noSleep = () => Promise.resolve();

// ---------------------------------------------------------------------------------------------------------------------
// The guard: demo host only, read-only list only, before fetch.

Deno.test("assertAllowed takes the demo host's listed calls and nothing else", () => {
  const ok: [string, string][] = [
    ["POST", "/session"], ["PUT", "/session"], ["GET", "/accounts"], ["GET", "/markets?epics=CS.D.AUDUSD.TODAY.IP&filter=SNAPSHOT_ONLY"],
    ["GET", "/markets?searchTerm=AUD%2FUSD"], ["GET", "/markets/IX.D.SPTRD.DAILY.IP"], ["GET", "/marketnavigation"], ["GET", "/marketnavigation/123"],
    ["GET", "/prices/CS.D.AUDUSD.TODAY.IP?resolution=HOUR&from=2026-10-09T17:00:00&to=2026-10-12T23:00:00&pageSize=0"],
    ["GET", "/clientsentiment/AUDUSD"],
  ];
  for (const [m, p] of ok) assertAllowed(m, IG_DEMO_BASE + p);
  const refused: [string, string][] = [
    // The live host, any other host, scheme or port.
    ["POST", "https://api.ig.com/gateway/deal/session"], ["GET", "https://api.ig.com/gateway/deal/markets/CS.D.AUDUSD.TODAY.IP"],
    ["GET", "http://demo-api.ig.com/gateway/deal/accounts"], ["GET", "https://demo-api.ig.com:8443/gateway/deal/accounts"],
    ["GET", "https://demo-api.ig.com.evil.example/gateway/deal/accounts"], ["GET", "https://demo-api.ig.com/gateway/other/accounts"],
    // Every dealing, position, order, watchlist, history and application path, whatever the method.
    ["POST", IG_DEMO_BASE + "/positions/otc"], ["DELETE", IG_DEMO_BASE + "/positions/otc"], ["PUT", IG_DEMO_BASE + "/positions/otc/DIAAAA"],
    ["GET", IG_DEMO_BASE + "/positions"], ["POST", IG_DEMO_BASE + "/workingorders/otc"], ["GET", IG_DEMO_BASE + "/workingorders"],
    ["GET", IG_DEMO_BASE + "/confirms/REF1"], ["POST", IG_DEMO_BASE + "/watchlists"], ["PUT", IG_DEMO_BASE + "/watchlists/1"],
    ["DELETE", IG_DEMO_BASE + "/watchlists/1/CS.D.AUDUSD.TODAY.IP"], ["GET", IG_DEMO_BASE + "/history/activity"],
    ["POST", IG_DEMO_BASE + "/operations/application"], ["PUT", IG_DEMO_BASE + "/operations/application/disable"],
    ["DELETE", IG_DEMO_BASE + "/session"], ["GET", IG_DEMO_BASE + "/session"], ["POST", IG_DEMO_BASE + "/session/refresh-token"],
    ["POST", IG_DEMO_BASE + "/markets"], ["POST", IG_DEMO_BASE + "/prices/CS.D.AUDUSD.TODAY.IP"],
    ["POST", IG_DEMO_BASE + "/indicativecostsandcharges/open"], ["GET", IG_DEMO_BASE + "/client-sentiment/AUDUSD"],
    // Tricks: traversal, a query on a write, an unlisted query parameter.
    ["GET", IG_DEMO_BASE + "/markets/../positions"], ["POST", IG_DEMO_BASE + "/session?x=1"], ["GET", IG_DEMO_BASE + "/accounts?x=1"],
    ["GET", IG_DEMO_BASE + "/markets?epics=A.B.C.D&dealId=1"],
  ];
  for (const [m, u] of refused) assertThrows(() => assertAllowed(m, u), IgRefused, undefined, `${m} ${u}`);
});

Deno.test("the client refuses an order path and a live host before fetch is reached", async () => {
  const ig = fakeIg();
  const client = new IgClient({ creds: CREDS, fetchImpl: ig.impl, maxRequests: 10, minGapMs: 0, sleep: noSleep });
  await client.login();
  const before = ig.calls.length;
  for (const [m, p] of [["POST", "/positions/otc"], ["DELETE", "/positions/otc"], ["POST", "/workingorders/otc"], ["PUT", "/positions/otc/X"], ["GET", "/history/transactions"]]) {
    await assertRejects(() => client.call(m, p, { version: 1, body: { epic: "CS.D.AUDUSD.TODAY.IP", direction: "BUY", size: 1 } }), IgRefused);
  }
  assertEquals(ig.calls.length, before);
  // The base is a constant; a path cannot escape it.
  assertEquals(IG_DEMO_BASE, "https://demo-api.ig.com/gateway/deal");
  await assertRejects(() => client.get("/../positions", 1), IgRefused);
  assertEquals(ig.calls.length, before);
  // And the budget: the eleventh request is refused, not sent.
  const tight = new IgClient({ creds: CREDS, fetchImpl: ig.impl, maxRequests: 2, minGapMs: 0, sleep: noSleep });
  await tight.get("/accounts", 1);
  const n = ig.calls.length;
  await assertRejects(() => tight.get("/accounts", 1), IgRefused, "budget");
  assertEquals(ig.calls.length, n);
});

Deno.test("only the demo secrets are read", () => {
  assertEquals(IG_ENVIRONMENT, "demo");
  assertEquals(IG_DEMO_SECRET_NAMES, { key: "IG_API_KEY_DEMO", username: "IG_DEMO_USERNAME", password: "IG_DEMO_PASSWORD" });
  const c = demoCreds({ ...ENV, IG_API_KEY_LIVE: "live-key", IG_LIVE_USERNAME: "live-user", IG_LIVE_PASSWORD: "live-pass" });
  assertEquals(c, CREDS);
  assertEquals(demoCreds({ IG_API_KEY_LIVE: "live-key", IG_LIVE_USERNAME: "u", IG_LIVE_PASSWORD: "p" }), { missing: ["IG_API_KEY_DEMO", "IG_DEMO_USERNAME", "IG_DEMO_PASSWORD"] });
});

// ---------------------------------------------------------------------------------------------------------------------
// Secrets and balances.

Deno.test("scrubDeep removes every secret, encoded too, from keys and values", () => {
  const v = { a: `user ${CREDS.username} pw ${encodeURIComponent(CREDS.password)}`, [CST]: [XST, { k: CREDS.key }], n: 3 };
  const out = scrubDeep(v, SECRETS);
  assertClean(out, "scrubDeep");
  assertEquals(out.n, 3);
  assert(JSON.stringify(out).includes("[redacted]"));
});

Deno.test("stripBalances takes balances and the client id out of session and account answers", () => {
  const out = stripBalances({ accountInfo: { balance: 1 }, clientId: "C", accounts: [{ accountId: "Z6F18J", balance: { balance: 5, available: 5 }, currency: "GBP" }] });
  assertEquals(out as unknown, { accounts: [{ accountId: "Z6F18J", currency: "GBP" }] });
});

Deno.test("a switch's new account token (X-SECURITY-TOKEN alone, no CST) is used from then on (2026-10-15 16:25 UTC)", async () => {
  const ig = fakeIg();
  const client = new IgClient({ creds: CREDS, fetchImpl: ig.impl, maxRequests: 10, minGapMs: 0, sleep: noSleep });
  await client.login();
  await client.switchTo("Z6F18K");
  await client.get("/accounts", 1);
  // One login, one switch, one GET: no 401 and no second login.
  assertEquals([client.logins, client.switches, ig.calls.length], [1, 1, 3]);
  assertEquals(ig.calls[2].headers["x-security-token"], `${XST}-Z6F18K`);
  assertEquals(ig.calls[2].headers["cst"], CST);
  // Each header is taken on its own; an answer with neither leaves the session as it was.
  const s0 = { cst: "c0", xst: "x0", accountId: "A", at: 0 };
  assertEquals(adoptTokens(s0, new Headers({ "X-SECURITY-TOKEN": "x1" })), { ...s0, xst: "x1" });
  assertEquals(adoptTokens(s0, new Headers({ CST: "c1" })), { ...s0, cst: "c1" });
  assertEquals(adoptTokens(s0, new Headers()), s0);
  assertEquals(adoptTokens(null, new Headers({ CST: "c1" })), null);
  // And the old account token is still scrubbed after it is replaced.
  assertEquals(client.scrub(`old ${XST} new ${XST}-Z6F18K`), "old [redacted] new [redacted]");
});

Deno.test("a token IG calls invalid (weekend maintenance) is replaced by one login, and the account is switched back", async () => {
  const ig = fakeIg({ tokenInvalidOnce: true });
  const client = new IgClient({ creds: CREDS, fetchImpl: ig.impl, maxRequests: 10, minGapMs: 0, sleep: noSleep });
  await client.login();
  await client.switchTo("Z6F18K");
  const body = await client.get("/accounts", 1);
  assertEquals(client.logins, 2);
  assertEquals(ig.account(), "Z6F18K");
  assertEquals((body as { accounts: { accountId: string }[] }).accounts[0].accountId, "Z6F18K");
});

// ---------------------------------------------------------------------------------------------------------------------
// facts (G1).

const SEARCH: Record<string, SearchMarket[]> = {
  "Z6F18K|AUD/USD": [
    { epic: "CS.D.AUDUSD.TODAY.IP", instrumentName: "AUD/USD", instrumentType: "CURRENCIES", expiry: "DFB" },
    { epic: "CS.D.AUDUSD.FWM2.IP", instrumentName: "AUD/USD", instrumentType: "CURRENCIES", expiry: "DEC-26" },
    { epic: "CS.D.AUDUSD.MINI.IP", instrumentName: "AUD/USD Mini", instrumentType: "CURRENCIES", expiry: "DFB" },
    { epic: "OP.D.AUDUSD.1.IP", instrumentName: "AUD/USD 6550 CALL", instrumentType: "OPT_CURRENCIES", expiry: "DFB" },
  ],
  "Z6F18K|US 500": [
    { epic: "IX.D.SPTRD.DAILY.IP", instrumentName: "US 500", instrumentType: "INDICES", expiry: "DFB" },
    { epic: "IX.D.SPTRD.DEC.IP", instrumentName: "US 500", instrumentType: "INDICES", expiry: "DEC-26" },
    { epic: "IX.D.SPTRD.MAR.IP", instrumentName: "US 500", instrumentType: "INDICES", expiry: "MAR-27" },
  ],
  "Z6F18K|Weekend": [
    { epic: "IX.D.SUNDOW.DAILY.IP", instrumentName: "Weekend Wall Street", instrumentType: "INDICES", expiry: "DFB" },
    { epic: "CS.D.WKGBPUSD.DAILY.IP", instrumentName: "Weekend GBP/USD", instrumentType: "CURRENCIES", expiry: "DFB" },
  ],
};

Deno.test("pickEpics takes the rolling market for each role, keeps the candidates, and lets a pin win", () => {
  const all = Object.values(SEARCH).flat();
  const p = pickEpics(all);
  assertEquals(p.selected.fx_audusd, "CS.D.AUDUSD.TODAY.IP");
  assertEquals(p.selected.us500, "IX.D.SPTRD.DAILY.IP");
  assertEquals(p.selected.us500_fut, "IX.D.SPTRD.DEC.IP");
  assertEquals(p.selected.wknd_wallst, "IX.D.SUNDOW.DAILY.IP");
  assertEquals(p.selected.wknd_gbpusd, "CS.D.WKGBPUSD.DAILY.IP");
  assert(p.missing.includes("wknd_de40"));
  assertEquals(candidates("fx_audusd", all).map((m) => m.epic), ["CS.D.AUDUSD.TODAY.IP"]);
  assertEquals(expiryOrder("DEC-26")! < expiryOrder("MAR-27")!, true);
  assertEquals(pickEpics(all, parsePins("fx_audusd:CS.D.AUDUSD.CFD.IP")).selected.fx_audusd, "CS.D.AUDUSD.CFD.IP");
  assertThrows(() => parsePins("nope:CS.D.AUDUSD.CFD.IP"));
  assertThrows(() => parsePins("fx_audusd:bad epic!"));
});

Deno.test("facts reads one account, strips balances, picks epics and stores one clean row", async () => {
  const ig = fakeIg({ markets: SEARCH });
  const { rest, tables } = fakeRest();
  const client = new IgClient({ creds: CREDS, fetchImpl: ig.impl, maxRequests: 36, minGapMs: 0, sleep: noSleep });
  const out = await runFacts({ client, rest, kind: "sb", pin: null });
  assertEquals(out.account_id, "Z6F18K");
  assertEquals(ig.account(), "Z6F18K");
  const row = tables.ig_facts[0] as Record<string, unknown> & { payload: Record<string, unknown>; selected: Record<string, string> };
  assertEquals(row.ok, true);
  assertEquals(row.selected.fx_audusd, "CS.D.AUDUSD.TODAY.IP");
  assertEquals(row.payload.expected_account_matches, true);
  const s = JSON.stringify(row);
  for (const k of ['"balance"', '"available"', '"accountInfo"', '"clientId"']) assert(!s.includes(k), `facts row keeps ${k}`);
  assertClean(row, "facts row");
  assertClean(out, "facts answer");
  // Read-only: every call it made is on the list (the guard ran on each), and none is a write but login and the switch.
  for (const c of ig.calls) {
    assertAllowed(c.method, c.url);
    if (c.method !== "GET") assert(c.url.endsWith("/session"), c.url);
  }
  assert(ig.calls.length <= 36);
  assertEquals(accountOf({ accounts: [{ accountId: "Z6F18J", accountType: "CFD" }] }, "sb"), null);
});

// ---------------------------------------------------------------------------------------------------------------------
// The windows.

Deno.test("ukOffsetMs is the UK rule, the same as the time-zone database, every hour of 2025-2027", () => {
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  for (let t = Date.UTC(2025, 0, 1); t < Date.UTC(2028, 0, 1); t += 3_600_000) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
    assertEquals(ukOffsetMs(t), wall - t, new Date(t).toISOString());
  }
  // A clock change: 2026-10-25 01:00 UTC.
  assertEquals(ukOffsetMs(Date.UTC(2026, 9, 25, 0, 59)), 3_600_000);
  assertEquals(ukOffsetMs(Date.UTC(2026, 9, 25, 1, 0)), 0);
  assertEquals(ukToUtcMs(2026, 10, 18, 21, 0), Date.UTC(2026, 9, 18, 20, 0));
  assertEquals(ukToUtcMs(2026, 11, 1, 21, 0), Date.UTC(2026, 10, 1, 21, 0));
});

Deno.test("the recorder's windows, in summer and winter time", () => {
  const at = (y: number, m: number, d: number, hh: number, mm: number) => activeWindows(ukToUtcMs(y, m, d, hh, mm));
  // Sunday 2026-10-18 (BST): AUD/USD opens; the weekend markets are still on.
  assertEquals(at(2026, 10, 18, 20, 49).ids, ["WKND"]);
  assertEquals(at(2026, 10, 18, 20, 50).ids, ["WKND", "SUNIDX", "SUN"]);
  assert(at(2026, 10, 18, 20, 50).roles.includes("fx_audusd"));
  assertEquals(at(2026, 10, 19, 0, 59).ids, ["WKND", "SUNIDX", "SUN"]);
  assertEquals(at(2026, 10, 19, 1, 0).ids, ["SUN"]);
  assertEquals(at(2026, 10, 19, 22, 4).ids, ["SUN"]);
  assertEquals(at(2026, 10, 19, 22, 5).ids, []);
  // Friday 21:50-22:05, Saturday 07:55.
  assertEquals(at(2026, 10, 16, 21, 49).ids, []);
  assertEquals(at(2026, 10, 16, 21, 50).ids, ["FRI"]);
  assertEquals(at(2026, 10, 16, 22, 5).ids, []);
  assertEquals(at(2026, 10, 17, 7, 54).ids, []);
  assertEquals(at(2026, 10, 17, 7, 55).ids, ["WKND"]);
  // Winter time: Sunday 2026-11-01 20:50 UK is 20:50 UTC.
  assertEquals(activeWindows(Date.UTC(2026, 10, 1, 20, 50)).ids, ["WKND", "SUNIDX", "SUN"]);
  assertEquals(activeWindows(Date.UTC(2026, 10, 1, 19, 50)).ids, ["WKND"]);
  // Tuesday to Thursday: nothing.
  for (const d of [20, 21, 22]) for (let h = 0; h < 24; h++) assertEquals(at(2026, 10, d, h, 30).ids, []);
  assertEquals(QUOTE_WINDOWS.map((w) => w.id), ["FRI", "WKND", "SUNIDX", "SUN"]);
});

Deno.test("every recorder minute lies inside the database's window with ten minutes either side, for a year", () => {
  assertEquals(DB_WINDOW, { fri: [21 * 60 + 35, 22 * 60 + 20], satFrom: 7 * 60 + 40, monTo: 22 * 60 + 20 });
  for (let t = Date.UTC(2025, 9, 1); t < Date.UTC(2026, 10, 5); t += 60_000) {
    if (activeWindows(t).ids.length) {
      assert(inDbWindow(t - 10 * 60_000) && inDbWindow(t) && inDbWindow(t + 10 * 60_000), new Date(t).toISOString());
    }
  }
  // And it is not on midweek.
  assertEquals(inDbWindow(ukToUtcMs(2026, 10, 21, 12, 0)), false);
  assertEquals(ukClock(ukToUtcMs(2026, 10, 18, 20, 50)).dow, 0);
});

Deno.test("the history plans are the frozen parameters, window for window", () => {
  const g2 = frozen.g2;
  assertEquals(g2.anchor_friday, HISTORY_ANCHOR_FRIDAY);
  assertEquals(g2.weekends, HISTORY_WEEKENDS);
  assertEquals(g2.pad_hours_each_side_utc * 3_600_000, HISTORY_PAD_MS);
  assertEquals(g2.allowance_reserve_points, ALLOWANCE_RESERVE);
  for (const p of ["probe", "fxw", "wknd", "esg"] as const) assertEquals([...HISTORY_PLANS[p].roles], g2.plans[p].roles);
  const f = historyFridays();
  assertEquals([f.length, f[0], f.at(-1)], [51, "2026-10-09", "2025-10-24"]);
  const fxw = historyWindows("fxw");
  assertEquals(fxw.length, 51);
  // Friday 20:00 to Monday 22:00 UK, in summer and in winter, padded two hours.
  assertEquals([fxw[0].startMs, fxw[0].endMs], [Date.UTC(2026, 9, 9, 19), Date.UTC(2026, 9, 12, 21)]);
  assertEquals([fxw[0].from, fxw[0].to], ["2026-10-09T17:00:00", "2026-10-12T23:00:00"]);
  const winter = fxw.find((w) => w.friday === "2025-12-05")!;
  assertEquals([winter.startMs, winter.endMs], [Date.UTC(2025, 11, 5, 20), Date.UTC(2025, 11, 8, 22)]);
  // The clock change inside a window (2025-10-26): Friday in summer time, Monday in winter time.
  const change = fxw.find((w) => w.friday === "2025-10-24")!;
  assertEquals([change.startMs, change.endMs], [Date.UTC(2025, 9, 24, 19), Date.UTC(2025, 9, 27, 22)]);
  assertEquals(fxw.reduce((s, w) => s + w.maxPoints, 0), g2.budget_upper_bound_points.fxw_total);
  assertEquals(historyWindows("wknd").reduce((s, w) => s + w.maxPoints, 0), g2.budget_upper_bound_points.wknd_total_8_roles);
  assertEquals(historyWindows("probe").map((w) => [w.role, w.maxPoints]), [["fx_audusd", 8], ["wknd_wallst", 8]]);
});

// ---------------------------------------------------------------------------------------------------------------------
// history (G2).

async function factsFor(rest: Rest, kind: "sb" | "cfd") {
  await rest.insert("ig_facts", { account_kind: kind, account_id: kind === "sb" ? "Z6F18K" : "Z6F18J", ok: true, selected: { fx_audusd: "CS.D.AUDUSD.TODAY.IP", wknd_wallst: "IX.D.SUNDOW.DAILY.IP", us500: "IX.D.SPTRD.DAILY.IP" } });
}

Deno.test("history: the probe first, then bulk within the allowance less the reserve, each answer stored raw and scrubbed", async () => {
  let remaining = 10_000;
  const ig = fakeIg({
    prices: () => {
      remaining -= 30;
      return { status: 200, body: { prices: Array.from({ length: 30 }, (_, i) => ({ snapshotTimeUTC: `2026-10-11T${String(i % 24).padStart(2, "0")}:00:00`, openPrice: { bid: 1, ask: 1.1, lastTraded: null } })), metadata: { allowance: { remainingAllowance: remaining, totalAllowance: 10000, allowanceExpiry: 600000 } }, echo: CREDS.username } };
    },
  });
  const { rest, tables } = fakeRest();
  await factsFor(rest, "sb");
  const now = () => Date.UTC(2026, 9, 18, 20);
  const mk = () => new IgClient({ creds: CREDS, fetchImpl: ig.impl, maxRequests: 22, minGapMs: 0, sleep: noSleep });
  // Bulk before the probe is refused, and calls nothing.
  const refused = await runHistory({ client: mk(), rest, kind: "sb", plan: "fxw", max: 6, dry: false, now });
  assert(String(refused.refused).includes("probe"));
  assertEquals(ig.calls.length, 0);
  // A dry run calls nothing either.
  const dry = await runHistory({ client: null, rest, kind: "sb", plan: "fxw", max: 3, dry: true, now });
  assertEquals((dry.next as unknown[]).length, 3);
  assertEquals(ig.calls.length, 0);
  // The probe: two small windows.
  const probe = await runHistory({ client: mk(), rest, kind: "sb", plan: "probe", max: 6, dry: false, now });
  assertEquals((probe.pulled as unknown[]).length, 2);
  // Bulk: six windows, then the next call goes on from the seventh.
  const a = await runHistory({ client: mk(), rest, kind: "sb", plan: "fxw", max: 6, dry: false, now });
  assertEquals((a.pulled as { key: string }[]).map((p) => p.key)[0], "fxw:fx_audusd:2026-10-09");
  const b = await runHistory({ client: mk(), rest, kind: "sb", plan: "fxw", max: 6, dry: false, now });
  assertEquals((b.pulled as { key: string }[])[0].key, "fxw:fx_audusd:2026-08-28");
  for (const r of tables.ig_price_pulls) {
    assertClean(r, "pull row");
    assertEquals((r as { ok: boolean }).ok, true);
  }
  assertClean([refused, dry, probe, a, b], "history answers");
  for (const c of ig.calls) {
    assertAllowed(c.method, c.url);
    if (c.url.includes("/prices/")) assertEquals(new URL(c.url).searchParams.get("resolution"), "HOUR");
  }
  // The reserve: with 560 left, a window that may cost 79 is not asked for.
  await rest.insert("ig_price_pulls", { account_kind: "sb", window_key: "fxw:x", epic: "e", ok: false, remaining_allowance: 560, allowance_expiry_s: 600000 });
  const c = await runHistory({ client: mk(), rest, kind: "sb", plan: "fxw", max: 6, dry: false, now });
  assertEquals((c.pulled as unknown[]).length, 0);
  assert(String(c.stop).includes("reserve"));
});

Deno.test("history stops when IG says the allowance is spent, and knownAllowance forgets an expired period", async () => {
  const ig = fakeIg({ prices: () => ({ status: 403, body: { errorCode: "error.public-api.exceeded-account-historical-data-allowance" } }) });
  const { rest, tables } = fakeRest();
  await factsFor(rest, "sb");
  const now = () => Date.UTC(2026, 9, 18, 20);
  const out = await runHistory({ client: new IgClient({ creds: CREDS, fetchImpl: ig.impl, maxRequests: 22, minGapMs: 0, sleep: noSleep }), rest, kind: "sb", plan: "probe", max: 6, dry: false, now });
  assertEquals((out.pulled as unknown[]).length, 1);
  assert(String(out.stop).includes("spent"));
  assertEquals((tables.ig_price_pulls[0] as { ok: boolean }).ok, false);
  const pulls = [{ window_key: "x", epic: "e", ok: true, at: "2026-10-18T00:00:00Z", remaining_allowance: 100, allowance_expiry_s: 60 }];
  assertEquals(knownAllowance(pulls, Date.parse("2026-10-18T00:00:30Z")), { remaining: 100, resetsAt: Date.parse("2026-10-18T00:01:00Z") });
  assertEquals(knownAllowance(pulls, Date.parse("2026-10-18T00:02:00Z")), null);
});

// ---------------------------------------------------------------------------------------------------------------------
// quotes (G4 by REST).

Deno.test("quotes outside the windows calls nothing; inside, two snapshots an account and one record call", async () => {
  const ig = fakeIg();
  const { rest, tables, rpcs } = fakeRest();
  await factsFor(rest, "sb");
  await factsFor(rest, "cfd");
  const mk = (s: unknown) => new IgClient({ creds: CREDS, fetchImpl: ig.impl, maxRequests: 14, minGapMs: 0, sleep: noSleep, session: s as null });
  const tue = Date.UTC(2026, 9, 20, 12);
  const off = await runQuotes({ makeClient: mk, session: null, rest, now: () => tue, sleep: noSleep, report: () => Promise.resolve() });
  assertEquals(off.result.skipped, "outside the recorder's windows");
  assertEquals(ig.calls.length, 0);
  // Sunday 2026-10-18 21:00 UK (20:00 UTC).
  let t = Date.UTC(2026, 9, 18, 20, 0, 0, 400);
  const sleeps: number[] = [];
  const on = await runQuotes({
    makeClient: mk, session: null, rest, now: () => t, sleep: (ms) => { sleeps.push(ms); t += ms; return Promise.resolve(); }, report: () => Promise.resolve(),
  });
  assertEquals(on.result.ok, true);
  assertEquals(on.result.snapshots, 4);
  assertEquals(sleeps.length, 1);
  assertEquals(rpcs.length, 1);
  const samples = rpcs[0].args.samples as { account_kind: string; epic: string; market_status: string }[];
  // SUN and SUNIDX and WKND: the roles the facts row names (AUD/USD, US 500, Weekend Wall Street), on both accounts, twice.
  assertEquals(samples.length, 12);
  assertEquals(new Set(samples.map((s) => s.account_kind)), new Set(["sb", "cfd"]));
  // One switch a snapshot pair at most: login (CFD), CFD, switch, SB; then SB, switch, CFD.
  assertEquals([on.result.logins, on.result.switches], [1, 2]);
  for (const c of ig.calls) assertAllowed(c.method, c.url);
  assertEquals(tables.ig_quote_runs.length, 1);
  assertClean([on.result, tables.ig_quote_runs, rpcs], "quotes");
  // The session is kept for the next run in this isolate; it is never in the answer.
  assertEquals(on.session?.cst, CST);
});

Deno.test("a market IG returns without a status is recorded UNKNOWN, and failures go to the errors box once, then hourly", () => {
  const s = samplesOf({ marketDetails: [{ instrument: { epic: "A.B.C.D.IP" }, snapshot: { bid: null, offer: 1 } }] }, "sb", "Z6F18K", "2026-10-18T20:00:00Z");
  assertEquals(s[0].market_status, "UNKNOWN");
  assertEquals(s[0].bid, null);
  const t = Date.parse("2026-10-18T20:00:00Z");
  const r = (min: number, ok: boolean, reported = false) => ({ id: min, ok, reported, started_at: new Date(t - min * 60_000).toISOString() });
  assertEquals(shouldReport([], t), true);
  assertEquals(shouldReport([r(1, true)], t), true);
  assertEquals(shouldReport([r(1, false, true), r(2, true)], t), false);
  assertEquals(shouldReport([r(1, false), r(61, false, true), r(62, true)], t), true);
  assertEquals(quoteEpics({ sb: { account_kind: "sb", account_id: "Z6F18K", ok: true, selected: { fx_audusd: "E1.E1.E1", us500: "E2.E2.E2" } } }, ["fx_audusd", "wknd_de40"]),
    [{ kind: "sb", accountId: "Z6F18K", epics: ["E1.E1.E1"] }]);
});

// ---------------------------------------------------------------------------------------------------------------------
// The request: beat first, then who may call.

function deps(o: Partial<Deps> = {}): Deps & { order: string[]; kept: Promise<unknown>[] } {
  const order: string[] = [];
  const kept: Promise<unknown>[] = [];
  const { rest } = fakeRest();
  return {
    order, kept, keepAlive: (p) => { kept.push(p); }, env: ENV, rest: { ...rest, select: (...a: Parameters<Rest["select"]>) => { order.push("select"); return rest.select(...a); } } as Rest,
    beat: (k) => { order.push(`beat:${k}`); return Promise.resolve(true); },
    report: () => Promise.resolve(), now: () => Date.UTC(2026, 9, 20, 12), sleep: noSleep,
    verify: (tok: string) => Promise.resolve(tok === "admin-token" ? { role: "admin" as const, exp: 0 } : tok === "ro-token" ? { role: "ro" as const, exp: 0 } : null),
    fetchImpl: fakeIg().impl, ...o,
  };
}
const req = (action: string, h: Record<string, string>, method = "POST") => new Request(`https://x.supabase.co/functions/v1/ig?action=${action}`, { method, headers: h });

Deno.test("the beat is written before anything else, and only the cron bearer or an admin token gets in", async () => {
  const d = deps();
  const r1 = await handle(req("quotes", {}), d);
  assertEquals(r1.status, 401);
  assertEquals(d.order, ["beat:ig?action=quotes"]);
  assertEquals((await handle(req("quotes", { "x-app-token": "ro-token" }), deps())).status, 401);
  assertEquals((await handle(req("quotes", { authorization: "Bearer wrong" }), deps())).status, 401);
  assertEquals((await handle(req("quotes", { authorization: `Bearer ${ENV.CRON_SECRET}` }, "GET"), deps())).status, 405);
  const d2 = deps();
  const ok = await handle(req("quotes", { authorization: `Bearer ${ENV.CRON_SECRET}` }), d2);
  assertEquals(ok.status, 200);
  assertEquals(d2.order[0], "beat:ig?action=quotes");
  assertEquals((await ok.json()).skipped, "outside the recorder's windows");
  assertEquals((await handle(req("history&account=sb&plan=fxw&dry=1", { "x-app-token": "admin-token" }), deps())).status, 200);
  assertEquals((await handle(req("history&account=live", { "x-app-token": "admin-token" }), deps())).status, 400);
  assertEquals((await handle(req("order", { "x-app-token": "admin-token" }), deps())).status, 404);
  assertEquals(await authorise(req("x", { authorization: `Bearer ${ENV.CRON_SECRET}` }), ENV.CRON_SECRET), "cron");
  // Without the demo secrets nothing is called, and the answer names what is missing.
  const r = await handle(req("quotes", { authorization: `Bearer ${ENV.CRON_SECRET}` }), deps({ env: { CRON_SECRET: ENV.CRON_SECRET, IG_API_KEY_LIVE: "live" } }));
  assertEquals(r.status, 503);
  assertEquals((await r.json()).missing, ["IG_API_KEY_DEMO", "IG_DEMO_USERNAME", "IG_DEMO_PASSWORD"]);
});

Deno.test("facts and history answer 202 at once, run on under keepAlive, and log a clean report; a crash logs no secret", async () => {
  const ig = fakeIg({ markets: SEARCH });
  const { rest, tables } = fakeRest();
  const d = deps({ rest, fetchImpl: ig.impl });
  const r = await handle(req("facts&account=sb", { authorization: `Bearer ${ENV.CRON_SECRET}` }), d);
  assertEquals(r.status, 202);
  assertEquals(d.kept.length, 1);
  await Promise.all(d.kept);
  assertEquals(tables.ig_facts.length, 1);
  assertEquals((tables.ig_action_log[0] as { action: string }).action, "facts");
  assertClean(tables.ig_action_log, "action log");
  assertEquals((await handle(req("history&account=sb&plan=nope", { authorization: `Bearer ${ENV.CRON_SECRET}` }), d)).status, 400);
  // A transport that throws with the password and username in its message.
  const boom = (() => Promise.reject(new Error(`boom ${CREDS.password} ${CREDS.username}`))) as unknown as typeof fetch;
  const reports: unknown[] = [];
  const d2 = deps({ rest, fetchImpl: boom, report: (k, m, c) => { reports.push([k, m, c]); return Promise.resolve(); } });
  const r2 = await handle(req("history&account=sb&plan=probe", { authorization: `Bearer ${ENV.CRON_SECRET}` }), d2);
  assertEquals(r2.status, 202);
  await Promise.all(d2.kept);
  assertClean([await r2.json(), tables.ig_action_log, tables.ig_price_pulls, reports], "crash");
  assertEquals(tables.ig_action_log.length, 2);
});

// ---------------------------------------------------------------------------------------------------------------------
// The recorder's sessions (2026-10-18): from 10-16 20:52 UTC two runs in three failed with 401 account-token-invalid,
// every failing run having started on the session the previous minute's run left in its isolate, with up to five logins
// a run (~190 an hour). Each run now logs in once at its start, re-logs in at most once, stops at the next refusal, and
// pauses after a switch.

Deno.test("each quotes run starts with its own login, never the previous run's session (2026-10-18)", async () => {
  const ig = fakeIg();
  const { rest } = fakeRest();
  await factsFor(rest, "sb");
  await factsFor(rest, "cfd");
  let t = Date.UTC(2026, 9, 18, 20, 0, 0, 400);
  const sleeps: number[] = [];
  const d = deps({ rest, fetchImpl: ig.impl, now: () => t, sleep: (ms) => { sleeps.push(ms); t += ms; return Promise.resolve(); } });
  const r1 = await (await handle(req("quotes", { authorization: `Bearer ${ENV.CRON_SECRET}` }), d)).json();
  assertEquals([r1.ok, r1.logins, r1.switches, r1.snapshots], [true, 1, 2, 4]);
  const before = ig.calls.length;
  t = Date.UTC(2026, 9, 18, 20, 1, 0, 400);
  const r2 = await (await handle(req("quotes", { authorization: `Bearer ${ENV.CRON_SECRET}` }), d)).json();
  // The second minute's first request is a login, not a call on the tokens the first minute left behind.
  const second = ig.calls.slice(before);
  assertEquals([second[0].method, new URL(second[0].url).pathname.endsWith("/session")], ["POST", true]);
  assertEquals([r2.ok, r2.logins, r2.switches, r2.snapshots], [true, 1, 2, 4]);
  // A pause after each login and each switch (two of each a run), before the next call.
  assertEquals(sleeps.filter((ms) => ms === 2_000).length, 6);
});

Deno.test("a run whose tokens IG keeps refusing logs in at most twice and stops (no login storm)", async () => {
  const ig = fakeIg({ accountTokenAlwaysInvalid: true });
  const { rest, tables } = fakeRest();
  await factsFor(rest, "sb");
  await factsFor(rest, "cfd");
  let t = Date.UTC(2026, 9, 18, 20, 0, 0, 400);
  const d = deps({ rest, fetchImpl: ig.impl, now: () => t, sleep: (ms) => { t += ms; return Promise.resolve(); } });
  const r = await (await handle(req("quotes", { authorization: `Bearer ${ENV.CRON_SECRET}` }), d)).json();
  assertEquals(r.ok, false);
  assertEquals(r.snapshots, 0);
  // The run's login, one re-login, and nothing more this minute: the first account's call, its two same-token retries,
  // the re-login's call, and out.
  assertEquals(r.logins, 2);
  assertEquals(ig.calls.filter((c) => c.method === "POST").length, 2);
  assert(ig.calls.length <= 6, `${ig.calls.length} requests`);
  assert(/account-token-invalid/.test(String(r.error)));
  assertEquals(tables.ig_quote_runs.length, 1);
  assertClean([r, tables.ig_quote_runs], "refused run");
});

Deno.test("a fresh token refused for a moment is waited for, not logged in again (2026-10-18 04:21 UTC)", async () => {
  const { rest } = fakeRest();
  await factsFor(rest, "sb");
  await factsFor(rest, "cfd");
  let t = Date.UTC(2026, 9, 18, 20, 0, 0, 400);
  const run = async (warmupMs: number) => {
    const ig = fakeIg({ warmupMs, now: () => t });
    const d = deps({ rest, fetchImpl: ig.impl, now: () => t, sleep: (ms) => { t += ms; return Promise.resolve(); } });
    t += 60_000;
    return { r: await (await handle(req("quotes", { authorization: `Bearer ${ENV.CRON_SECRET}` }), d)).json(), ig };
  };
  // A token good one second after it is issued: the 2 s pause after the login and each switch covers it.
  const a = await run(1_000);
  assertEquals([a.r.ok, a.r.logins, a.r.switches, a.r.snapshots, a.r.token_retries], [true, 1, 2, 4, 0]);
  // Good only after four seconds: each first call is refused once and its same-token retry 3 s later works.
  const b = await run(4_000);
  assertEquals([b.r.ok, b.r.logins, b.r.snapshots], [true, 1, 4]);
  assert(b.r.token_retries >= 1);
  assertEquals(b.ig.calls.filter((c) => c.method === "POST").length, 1);
});
