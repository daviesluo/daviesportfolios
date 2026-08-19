// Pin tests for the prices Edge Function's pure helpers — UTC →
// exchange-local minute conversion, the outside-RTH predicate, and
// the day-pct formula. The Deno.serve entry point is guarded by
// `import.meta.main` so importing the helpers here does NOT bind a
// port.
//
// Run locally: `deno test --allow-env supabase/functions/prices/`

import { assertEquals, assertAlmostEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { localMinOfDay, isOutsideRth, pctChange, localDayNumber, rthSessionCloses, etOffsetSec, cryptoUsSessionQuote, parseFundgz, navPairToResult, raceCnSources } from "./index.ts";

Deno.test("localMinOfDay: New York 09:30 ET (EDT, gmtoffset=-14400) at 13:30 UTC = 570 minutes", () => {
  // 2026-05-11 13:30:00 UTC → 09:30:00 EDT (gmtoffset -14400 s)
  const utcSec = Math.floor(new Date("2026-05-11T13:30:00Z").getTime() / 1000);
  assertEquals(localMinOfDay(utcSec, -14400), 9 * 60 + 30);
});

Deno.test("localMinOfDay: New York 16:00 ET (EST, gmtoffset=-18000) at 21:00 UTC = 960 minutes", () => {
  // 2026-01-15 21:00:00 UTC → 16:00:00 EST (gmtoffset -18000 s)
  const utcSec = Math.floor(new Date("2026-01-15T21:00:00Z").getTime() / 1000);
  assertEquals(localMinOfDay(utcSec, -18000), 16 * 60);
});

Deno.test("localMinOfDay: wraps day boundaries cleanly", () => {
  // 2026-05-11 00:00:00 UTC with offset +28800 (Asia/Hong Kong) →
  // local 08:00 same day, but with the prior-day-overflow modulo path.
  const utcSec = Math.floor(new Date("2026-05-11T00:00:00Z").getTime() / 1000);
  assertEquals(localMinOfDay(utcSec, 8 * 3600), 8 * 60);
  // 2026-05-11 23:30:00 UTC, exchange offset -18000 (NY EST) → 18:30 ET (1110 min)
  const utcSec2 = Math.floor(new Date("2026-05-11T23:30:00Z").getTime() / 1000);
  assertEquals(localMinOfDay(utcSec2, -18000), 18 * 60 + 30);
});

Deno.test("isOutsideRth: pre-market and after-hours = true", () => {
  assertEquals(isOutsideRth(8 * 60),       true);   // 08:00 pre-market
  assertEquals(isOutsideRth(9 * 60 + 29),  true);   // one minute before open
  assertEquals(isOutsideRth(16 * 60),      true);   // 16:00 is the close → first AH bar
  assertEquals(isOutsideRth(20 * 60),      true);   // 20:00 after-hours
});

Deno.test("isOutsideRth: regular session = false", () => {
  assertEquals(isOutsideRth(9 * 60 + 30),  false);  // 09:30 opening minute
  assertEquals(isOutsideRth(12 * 60),      false);  // 12:00 mid-session
  assertEquals(isOutsideRth(15 * 60 + 59), false);  // last regular-session minute
});

Deno.test("pctChange: positive / negative / no-change", () => {
  assertAlmostEquals(pctChange(110, 100),  10,   1e-9);
  assertAlmostEquals(pctChange( 90, 100), -10,   1e-9);
  assertAlmostEquals(pctChange(100, 100),   0,   1e-9);
});

Deno.test("pctChange: returns 0 when prevClose is missing / non-positive", () => {
  assertEquals(pctChange(100, 0),   0);
  assertEquals(pctChange(100, -1),  0);
  assertEquals(pctChange(100, NaN), 0);
});

const EDT = -14400; // America/New_York summer offset (seconds)
const tsOf = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

Deno.test("localDayNumber: same local day within RTH, +1 across local midnight", () => {
  // 09:30 and 16:00 ET on the same date → same day number.
  assertEquals(
    localDayNumber(tsOf("2026-06-15T09:30:00-04:00"), EDT),
    localDayNumber(tsOf("2026-06-15T16:00:00-04:00"), EDT),
  );
  // 23:00 ET → next-day 01:00 ET differ by exactly 1.
  assertEquals(
    localDayNumber(tsOf("2026-06-16T01:00:00-04:00"), EDT) -
    localDayNumber(tsOf("2026-06-15T23:00:00-04:00"), EDT),
    1,
  );
});

Deno.test("rthSessionCloses: real 16:00-ET close today + previous session close", () => {
  // Pre / post-market bars (bogus) must be skipped; a missing (null) 16:00
  // print falls back to the 15:55 close. Walk picks today's last in-session
  // close (`last`) and the prior local day's last in-session close (`prev`).
  const rows: Array<[string, number | null]> = [
    ["2026-06-12T15:50:00-04:00", 49],   // RTH (prev day)
    ["2026-06-12T15:55:00-04:00", 50],   // prev-day close ← prev
    ["2026-06-12T17:00:00-04:00", 99],   // post-market bogus (skip)
    ["2026-06-15T09:00:00-04:00", 98],   // pre-market bogus (skip)
    ["2026-06-15T15:50:00-04:00", 51],   // RTH (today)
    ["2026-06-15T15:55:00-04:00", 52],   // today close ← last
    ["2026-06-15T16:00:00-04:00", null], // missing close (skip → 15:55 wins)
    ["2026-06-15T18:00:00-04:00", 97],   // post-market bogus (skip)
  ];
  const timestamps = rows.map((r) => tsOf(r[0] as string));
  const closes = rows.map((r) => r[1]);
  assertEquals(rthSessionCloses(timestamps, closes, EDT), { last: 52, prev: 50 });
});

Deno.test("rthSessionCloses: prev null when only one session is present", () => {
  const timestamps = [tsOf("2026-06-15T15:50:00-04:00"), tsOf("2026-06-15T15:55:00-04:00")];
  assertEquals(rthSessionCloses(timestamps, [51, 52], EDT), { last: 52, prev: null });
});

Deno.test("rthSessionCloses: null/null when every candle is out of session", () => {
  const timestamps = [tsOf("2026-06-15T08:00:00-04:00"), tsOf("2026-06-15T18:00:00-04:00")];
  assertEquals(rthSessionCloses(timestamps, [10, 11], EDT), { last: null, prev: null });
  assertEquals(rthSessionCloses(null as unknown as number[], [], EDT), { last: null, prev: null });
});

Deno.test("etOffsetSec: DST-aware America/New_York offset (EDT summer, EST winter)", () => {
  assertEquals(etOffsetSec(new Date("2026-07-01T12:00:00Z").getTime()), -14400); // EDT
  assertEquals(etOffsetSec(new Date("2026-01-15T12:00:00Z").getTime()), -18000); // EST
});

// Shared crypto candle fixture: prev-day 16:00-ET close = 50, today's
// 16:00-ET close = 52, with pre/post bogus bars that must be skipped.
const CRYPTO_ROWS: Array<[string, number | null]> = [
  ["2026-06-12T15:55:00-04:00", 50],   // prev-day close ← prev
  ["2026-06-12T20:00:00-04:00", 70],   // overnight (skipped by rthSessionCloses)
  ["2026-06-15T09:35:00-04:00", 51],   // today RTH
  ["2026-06-15T16:00:00-04:00", 52],   // today's 16:00 close ← last
  ["2026-06-15T18:00:00-04:00", 61],   // post-close (skipped)
];
const CRYPTO_TS = CRYPTO_ROWS.map((r) => tsOf(r[0] as string));
const CRYPTO_CL = CRYPTO_ROWS.map((r) => r[1]);

Deno.test("cryptoUsSessionQuote: after the US close → lastPrice=today 16:00, prevClose=prev close, extPrice=live", () => {
  const nowSec = tsOf("2026-06-15T18:00:00-04:00"); // 18:00 ET = outside RTH
  const q = cryptoUsSessionQuote(CRYPTO_TS, CRYPTO_CL, /*live*/ 60, /*prevMeta*/ 40, nowSec, EDT);
  assertEquals(q, { lastPrice: 52, extPrice: 60, prevClose: 50 });
});

Deno.test("cryptoUsSessionQuote: during US RTH → lastPrice=live, extPrice=null (ext ignored intraday)", () => {
  const nowSec = tsOf("2026-06-15T12:00:00-04:00"); // 12:00 ET = inside RTH
  const q = cryptoUsSessionQuote(CRYPTO_TS, CRYPTO_CL, /*live*/ 55, /*prevMeta*/ 40, nowSec, EDT);
  assertEquals(q, { lastPrice: 55, extPrice: null, prevClose: 50 });
});

Deno.test("cryptoUsSessionQuote: no in-session candles (holiday) → falls back to live / prevClose meta", () => {
  const ts = [tsOf("2026-06-15T08:00:00-04:00"), tsOf("2026-06-15T20:00:00-04:00")]; // all outside RTH
  const nowSec = tsOf("2026-06-15T20:00:00-04:00");
  const q = cryptoUsSessionQuote(ts, [10, 11], /*live*/ 60, /*prevMeta*/ 58, nowSec, EDT);
  assertEquals(q, { lastPrice: 60, extPrice: 60, prevClose: 58 });
});

Deno.test("cryptoUsSessionQuote: US HOLIDAY during RTH clock → off-session (extPrice=live, lastPrice=last REAL close)", () => {
  // Fri 2026-07-03 is the observed Independence Day holiday. The clock reads
  // 13:45 ET (inside 9:30-16:00) but the market is closed all day, so the
  // 24/7 crypto is off-session: its live price must land in extPrice and
  // lastPrice must be the last REAL trading-day close (Thu 07-02), NOT the
  // holiday's own mid-day candle. This is the "BTC shows 0.00% on July 3" bug.
  const rows: Array<[string, number]> = [
    ["2026-07-01T16:00:00-04:00", 100],  // Wed close ← prev
    ["2026-07-02T16:00:00-04:00", 110],  // Thu close ← last (last real close)
    ["2026-07-03T11:00:00-04:00", 120],  // Fri HOLIDAY mid-day — must be skipped
    ["2026-07-03T13:45:00-04:00", 125],  // Fri HOLIDAY mid-day — must be skipped
  ];
  const ts = rows.map((r) => tsOf(r[0]));
  const cl = rows.map((r) => r[1]);
  const nowSec = tsOf("2026-07-03T13:45:00-04:00");
  const q = cryptoUsSessionQuote(ts, cl, /*live*/ 125, /*prevMeta*/ 40, nowSec, EDT);
  // lastPrice = Thu close (110), extPrice = live (125), prevClose = Wed close (100).
  // Client shows (125-110)/110 ≈ +13.6% "since the last close" instead of 0%.
  assertEquals(q, { lastPrice: 110, extPrice: 125, prevClose: 100 });
});

// ---------------- CN fund parsing (fundgz + NAV-pair fallbacks) ----------------
// Pins the fetchCNFund upstream chain added when fundgz got geo-blocked
// from Deno egress IPs: every prices response silently omitted the CN
// fund, which pushed the client onto its (slow, proxy-based) fallback
// and stalled the first refresh ~20 s. The pure parsers are pinned here
// so the deploy gate catches any regression in either path.

Deno.test("parseFundgz: intraday estimate present → gsz is lastPrice, dwjz prevClose", () => {
  const body = `jsonpgz({"fundcode":"017731","name":"x","jzrq":"2026-07-17","dwjz":"1.2345","gsz":"1.2456","gszzl":"0.89","gztime":"2026-07-17 15:00"});`;
  const q = parseFundgz(body)!;
  assertEquals(q.lastPrice, 1.2456);
  assertEquals(q.prevClose, 1.2345);
  assertEquals(q.currency, "CNY");
  assertAlmostEquals(q.dayPct, ((1.2456 - 1.2345) / 1.2345) * 100, 1e-9);
  assertEquals(q.extPrice, null);
});

Deno.test("parseFundgz: weekend/holiday (no gsz) → flat at last NAV, dayPct 0", () => {
  const body = `jsonpgz({"fundcode":"017731","name":"x","jzrq":"2026-07-17","dwjz":"1.2345","gsz":"","gszzl":"","gztime":""})`;
  const q = parseFundgz(body)!;
  assertEquals(q.lastPrice, 1.2345);
  assertEquals(q.prevClose, 1.2345);
  assertEquals(q.dayPct, 0);
});

Deno.test("parseFundgz: non-JSONP body (geo-block error page) → null", () => {
  assertEquals(parseFundgz("<html>blocked</html>"), null);
  assertEquals(parseFundgz(""), null);
  assertEquals(parseFundgz(`jsonpgz({"dwjz":"0"});`), null); // non-positive NAV
});

Deno.test("navPairToResult: two NAVs → last vs prev official close", () => {
  const q = navPairToResult([{ nav: 1.25 }, { nav: 1.20 }])!;
  assertEquals(q.lastPrice, 1.25);
  assertEquals(q.prevClose, 1.20);
  assertAlmostEquals(q.dayPct, ((1.25 - 1.20) / 1.20) * 100, 1e-9);
  assertEquals(q.currency, "CNY");
});

Deno.test("navPairToResult: single NAV → flat (prevClose = lastPrice, dayPct 0)", () => {
  const q = navPairToResult([{ nav: 1.25 }])!;
  assertEquals(q.lastPrice, 1.25);
  assertEquals(q.prevClose, 1.25);
  assertEquals(q.dayPct, 0);
});

Deno.test("navPairToResult: NaN / non-positive rows are skipped; all-bad → null", () => {
  const q = navPairToResult([{ nav: NaN }, { nav: 1.10 }, { nav: 1.05 }])!;
  assertEquals(q.lastPrice, 1.10);
  assertEquals(q.prevClose, 1.05);
  assertEquals(navPairToResult([{ nav: NaN }, { nav: 0 }]), null);
  assertEquals(navPairToResult([]), null);
});

// ---------------- raceCnSources (fundgz-preferred, non-stalling) ----------------
// Codex #202 P2: a hung (geo-blocked) fundgz must not stall the batched
// /prices response behind its full timeout when lsjz already answered —
// but a merely-slower-than-lsjz HEALTHY fundgz must still win, because
// its intraday-estimate reading differs from lsjz's official-NAV one
// and letting raw race order decide would flicker the fund's quote
// between the two on every 30 s refresh.

const QUOTE_GZ = { lastPrice: 1.25, extPrice: null, prevClose: 1.20, currency: "CNY", dayPct: 4.1667, extDayPct: null };
const QUOTE_LS = { lastPrice: 1.20, extPrice: null, prevClose: 1.18, currency: "CNY", dayPct: 1.6949, extDayPct: null };
// Cancellable delayed promise — Deno's test sanitizer fails any test
// whose timers are still pending at the end, so every fixture timer
// must be cleared once the assertion is done.
const after = <T,>(ms: number, v: T): { promise: Promise<T>; cancel: () => void } => {
  let id: ReturnType<typeof setTimeout>;
  const promise = new Promise<T>((r) => { id = setTimeout(() => r(v), ms); });
  return { promise, cancel: () => clearTimeout(id) };
};

Deno.test("raceCnSources: healthy-but-slower fundgz still wins within the grace window", async () => {
  // lsjz answers at 5 ms, fundgz at 20 ms — grace (50 ms) covers it.
  const gz = after(20, QUOTE_GZ), ls = after(5, QUOTE_LS);
  try {
    assertEquals(await raceCnSources(gz.promise, ls.promise, 50), QUOTE_GZ);
  } finally { gz.cancel(); ls.cancel(); }
});

Deno.test("raceCnSources: hung fundgz is preempted by a usable lsjz after the grace", async () => {
  const t0 = Date.now();
  // fundgz "hangs" far past everything; lsjz usable at 5 ms, grace 30 ms.
  const gz = after(5_000, null), ls = after(5, QUOTE_LS);
  try {
    assertEquals(await raceCnSources(gz.promise, ls.promise, 30), QUOTE_LS);
    assert(Date.now() - t0 < 1_000, "must resolve on lsjz+grace, not fundgz's timeout");
  } finally { gz.cancel(); ls.cancel(); }
});

Deno.test("raceCnSources: fast-null fundgz falls straight back to lsjz (no grace wait)", async () => {
  const gz = after(2, null), ls = after(10, QUOTE_LS);
  try {
    assertEquals(await raceCnSources(gz.promise, ls.promise, 5_000), QUOTE_LS);
  } finally { gz.cancel(); ls.cancel(); }
});

Deno.test("raceCnSources: useless lsjz never preempts — fundgz gets its full timeout", async () => {
  // lsjz nulls out immediately; fundgz succeeds later.
  const gz = after(30, QUOTE_GZ), ls = after(2, null);
  try {
    assertEquals(await raceCnSources(gz.promise, ls.promise, 5), QUOTE_GZ);
  } finally { gz.cancel(); ls.cancel(); }
});

Deno.test("raceCnSources: both sources null → null (caller falls through to danjuan)", async () => {
  const gz = after(5, null), ls = after(2, null);
  try {
    assertEquals(await raceCnSources(gz.promise, ls.promise, 10), null);
  } finally { gz.cancel(); ls.cancel(); }
});

// A client that sends the app token must survive the CORS preflight.
// A custom header makes the request non-simple, so the browser asks
// first, and a preflight response that doesn't list the header blocks
// the call before this function ever runs — which is how a Cloudflare
// preview build (always pointed at the PRODUCTION functions) lost live
// prices, the market-conditions panel and every historical series at
// once. Advertising the header has to ship before anything sends it.
import { CORS as CORS_PREFLIGHT } from "./index.ts";
Deno.test("CORS preflight advertises x-app-token", () => {
  assert(CORS_PREFLIGHT["Access-Control-Allow-Headers"].includes("x-app-token"));
});
