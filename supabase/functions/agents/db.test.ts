import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertPagedOrder, DB_ERROR_CHARS, dbErrorText, makeDb, PAGE_ROWS, PAGE_WAVE, UPSERT_FIRST_WINS, upsertRows } from "./db.ts";
import { isUniqueViolation } from "./tick.ts";
import { fetchFx } from "./quotes.ts";
import { memDb } from "./testing.ts";

// PostgREST's refusal as it arrives: `code, details, hint, message`, with `details` quoting the whole failing row.
const failingRow = `Failing row contains (${Array.from({ length: 40 }, (_, i) => `v${i}`).join(", ")}, paused, sell).`;
const checkBody = JSON.stringify({ code: "23514", details: failingRow, hint: null, message: 'new row for relation "agent_orders" violates check constraint "agent_orders_mode_check"' });
const refusing = (status: number, body: string) => (() => Promise.resolve(new Response(body, { status }))) as typeof fetch;

Deno.test("a database refusal keeps the name of what refused it: PostgREST's message goes ahead of the failing row it quotes", async () => {
  assert(failingRow.length > 200);                                   // the real shape: the row alone outruns the old 200-character cut
  const db = makeDb("https://db.example", "k", refusing(400, checkBody));
  const err = await db.insert("agent_orders", { mode: "paused" }).then(() => null, (e: Error) => e);
  assert(err, "the insert must be refused");
  assert(err.message.includes("agent_orders_mode_check"), err.message);
  assert(err.message.startsWith('db POST agent_orders → 400: {"code":"23514","message":'), err.message);
  // A NOT NULL refusal keeps its column the same way.
  const nn = JSON.stringify({ code: "23502", details: failingRow, hint: null, message: 'null value in column "fee_usd" of relation "agent_orders" violates not-null constraint' });
  const err2 = await makeDb("https://db.example", "k", refusing(400, nn)).update("agent_orders", "id=eq.1", { fee_usd: null }).then(() => null, (e: Error) => e);
  assert(err2?.message.includes('null value in column \\"fee_usd\\"'), err2?.message);
});

Deno.test("dbErrorText: PostgREST's JSON is reordered and cut; anything else is kept as it came, cut the same way", () => {
  const t = dbErrorText(checkBody);
  assertEquals(JSON.parse(t.length < DB_ERROR_CHARS ? t : `${t.slice(0, t.indexOf(',"hint"'))}}`).code, "23514");
  assert(t.length <= DB_ERROR_CHARS);
  assertEquals(dbErrorText("upstream timeout"), "upstream timeout");
  assertEquals(dbErrorText("x".repeat(1000)).length, DB_ERROR_CHARS);
  assertEquals(dbErrorText("[1,2]"), "[1,2]");                      // JSON, but not an error object
});

Deno.test("the reordered text still tells another turn's claim (23505) from a real refusal", async () => {
  const dup = JSON.stringify({ code: "23505", details: "Key (strategy_id, symbol, bar_start)=(trend-4h, BTC/USD, 2026-09-22 12:00:00+00) already exists.", hint: null, message: 'duplicate key value violates unique constraint "agent_decisions_one_per_bar"' });
  const e409 = await makeDb("https://db.example", "k", refusing(409, dup)).insert("agent_decisions", {}).then(() => null, (e: Error) => e);
  assert(e409 && isUniqueViolation(e409), e409?.message);
  const e400 = await makeDb("https://db.example", "k", refusing(400, checkBody)).insert("agent_orders", {}).then(() => null, (e: Error) => e);
  assert(e400 && !isUniqueViolation(e400), e400?.message);
});

Deno.test("a paged read names an order and ends it with the unique id: rows that tie on every column named can repeat or vanish between pages", () => {
  assertPagedOrder("agent_orders", "state=in.(pending,new)&select=*&order=id.asc");
  assertPagedOrder("agent_orders", "select=*&order=ts.asc,id.asc");
  assertPagedOrder("agent_orders", "order=ts.desc,id.desc&select=*");
  assertThrows(() => assertPagedOrder("agent_orders", "select=*"), Error, "needs an explicit order");
  // A table keyed by more than one column, with no `id`: its whole key, in order, is the total order.
  assertPagedOrder("agent_quote_inputs", "kind=eq.fx&select=t,value&order=kind.asc,t.asc");
  assertThrows(() => assertPagedOrder("agent_quote_inputs", "kind=eq.fx&order=t.asc"), Error, "must order by");
  assertThrows(() => assertPagedOrder("agent_orders", "order=kind.asc,t.asc"), Error, "must order by");
  assertPagedOrder("agent_quote_events", "kind=in.(order,fill)&select=kind&order=book.asc,minute.asc,side.asc,k.asc,kind.asc");
  assertThrows(() => assertPagedOrder("agent_quote_events", "select=kind&order=minute.asc"), Error, "must order by");
  // RW's fills (`0053`), keyed by the market, the minute it filled and the print that proved it: the page reads them all.
  assertPagedOrder("pm_rw_fills", "select=cond,minute,ts,side,price,size,print_id&order=cond.asc,minute.asc,print_id.asc");
  assertThrows(() => assertPagedOrder("pm_rw_fills", "select=*&order=ts.asc,minute.asc"), Error, "must order by");
  // The probe's read before 2026-09-22: ordered, but by a column two orders can share.
  assertThrows(() => assertPagedOrder("agent_orders", "select=*&order=ts.asc"), Error, "unique id last");
  assertThrows(() => assertPagedOrder("agent_orders", "order=id.asc,ts.asc"), Error, "unique id last");
  // The stub pages through the same function, so a test cannot certify a query production would refuse.
  const db = makeDb("https://db.example", "k", (() => Promise.resolve(new Response("[]"))) as typeof fetch);
  return db.selectAll("agent_orders", "select=*&order=ts.asc").then(
    () => { throw new Error("the real client must refuse it too"); },
    (e: Error) => assert(e.message.includes("unique id last"), e.message),
  );
});

// A paged read past its first page asks for the next pages together (2026-10-31 audit: LIVE's 10,443 orders were eleven
// page reads one after another on every dashboard call, its slowest stage at 1.5 s), and still returns every row once, in
// order, up to the first short page. A one-page read is still one request.
Deno.test("selectAll: past the first page, pages go out PAGE_WAVE at a time and join in order; one page is one request", async () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
  const serve = (total: number) => {
    const seen: number[] = [];
    let inFlight = 0, most = 0;
    const f = (async (url: string) => {
      const u = new URL(url), offset = Number(u.searchParams.get("offset")), limit = Number(u.searchParams.get("limit"));
      seen.push(offset);
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return new Response(JSON.stringify(rows(total).slice(offset, offset + limit)));
    }) as unknown as typeof fetch;
    return { f, seen, most: () => most };
  };
  for (const total of [0, 1, 999, 1000, 1001, 4999, 5000, 10443]) {
    const s = serve(total);
    const got = await makeDb("https://db.example", "k", s.f).selectAll<{ id: number }>("agent_orders", "select=id&order=id.asc");
    assertEquals(got.map((r) => r.id), rows(total).map((r) => r.id), `${total} rows`);
    const pages = Math.floor(total / PAGE_ROWS) + 1; // the last page is the short (or empty) one
    assert(s.seen.length >= pages && s.seen.length <= pages + PAGE_WAVE - 1, `${total} rows: ${s.seen.length} requests`);
    if (total < PAGE_ROWS) assertEquals(s.seen, [0]);
  }
  const big = serve(10443);
  await makeDb("https://db.example", "k", big.f).selectAll("agent_orders", "select=id&order=id.asc");
  assertEquals(big.most(), PAGE_WAVE); // one after another before: never more than one in flight
});

// One batch, one conflict key twice (2026-10-31 audit): Postgres fails the whole statement (21000), and the double does too, as xhedge's
// trips did on 10-30. Yahoo's minutes carry a stray in-minute point on Friday evenings, so the EUR/USD batch into `cb_quote_inputs`
// failed 33 times from 10-16: a vendor's bar series keeps each key's first row, the bar; nothing else is merged unseen.
Deno.test("a batch with a key twice: a vendor's bar series keeps its first row, sent once; any other table fails whole, in production and the double", async () => {
  // Yahoo's answer as it came on those evenings: the 21:48 bar, then a point at 21:48:37 inside the same minute.
  const bar = Date.parse("2026-10-30T21:48:00Z") / 1000;
  const yahoo = { chart: { result: [{ timestamp: [bar - 60, bar, bar + 37], indicators: { quote: [{ close: [1.0861, 1.0862, 1.08625] }] } }] } };
  const fx = await fetchFx(Date.parse("2026-10-30T21:50:00Z"), (() => Promise.resolve(new Response(JSON.stringify(yahoo)))) as unknown as typeof fetch, "EURUSD=X");
  assertEquals(fx.map(([t]) => new Date(t).toISOString()), ["2026-10-30T21:47:00.000Z", "2026-10-30T21:48:00.000Z", "2026-10-30T21:48:00.000Z"]);
  const rows = fx.map(([t, v]) => ({ kind: "fx:EURUSD", t: new Date(t).toISOString(), value: v }));
  // The double: the batch is stored, the 21:48 bar's own close kept.
  const m = memDb({ cb_quote_inputs: [] }, { now: () => Date.now() });
  await m.db.upsert("cb_quote_inputs", rows, "kind,t");
  assertEquals((m.tables.cb_quote_inputs as Array<{ t: string; value: number }>).map((r) => [r.t, r.value]), [["2026-10-30T21:47:00.000Z", 1.0861], ["2026-10-30T21:48:00.000Z", 1.0862]]);
  // Production's client sends each key once.
  const sent: unknown[] = [];
  const f = ((_: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return Promise.resolve(new Response(null, { status: 201 })); }) as unknown as typeof fetch;
  await makeDb("https://db.example", "k", f).upsert("cb_quote_inputs", rows, "kind,t");
  assertEquals((sent[0] as unknown[]).length, 2);
  // A trip twice (xhedge's key) is never merged: the double fails it whole, as Postgres does, and the client sends it as given.
  const trip = { arm: "inside", book: "USDT-GBP", side: "bid", t_fill: "2026-10-30T09:57:00Z", t_hedge: "2026-10-30T09:57:31Z", qty: 1 };
  const x = memDb({ agent_xhedge_trips: [] }, { now: () => Date.now() });
  const err = await x.db.upsert("agent_xhedge_trips", [trip, { ...trip, qty: 2 }], "arm,book,side,t_fill,t_hedge").then(() => null, (e: Error) => e.message);
  assert(err?.includes("21000"), String(err));
  assertEquals((x.tables.agent_xhedge_trips ?? []).length, 0);
  assertEquals(upsertRows("agent_xhedge_trips", [trip, trip], "arm,book,side,t_fill,t_hedge").length, 2);
  assertEquals(Object.keys(UPSERT_FIRST_WINS).sort(), ["agent_quote_inputs", "cb_quote_inputs", "cxbot_tape", "igbot_bars"]);
});
