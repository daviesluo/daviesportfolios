import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertPagedOrder, DB_ERROR_CHARS, dbErrorText, makeDb } from "./db.ts";
import { isUniqueViolation } from "./tick.ts";

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
