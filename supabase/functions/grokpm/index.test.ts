// Pins GROKPM's journal ingest: the secret before anything, the contract's every field (the pre-registration's appendix
// examples are accepted as written, and each kind of bad row is refused with its reason), all-or-nothing storage, duplicates
// by id, and the hourly budget. The database double holds 0124's tables as the migration writes them: a row with a column
// the table does not have is refused, as PostgREST refuses it, and a stored id is a duplicate, as the primary key makes it.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import examples from "../../../docs/agents/backtests/grokpm/contract_examples.json" with { type: "json" };
import { GROKPM_TABLES } from "../_shared/grokpm_schema.ts";
import { handle, type IngestDb } from "./index.ts";
import {
  GROKPM_MAX_BODY_BYTES, GROKPM_MAX_REQUESTS_PER_HOUR, GROKPM_MAX_ROWS_PER_HOUR, GROKPM_MAX_ROWS_PER_REQUEST, isAuthorised, rateVerdict, tableRows,
  validateBatch,
} from "./ingest.ts";

const T0 = Date.parse("2026-10-16T09:30:00Z");
const SECRET = "s".repeat(40);
/** A table's columns as 0124 creates it (`src/grokpm_prereg.test.js` holds the list to the migration's text). */
const columnsOf = (table: string): readonly string[] => GROKPM_TABLES[table].columns;

class FakeDb implements IngestDb {
  tables: Record<string, Map<string, Record<string, unknown>>> = { grokpm_decisions: new Map(), grokpm_cycles: new Map(), grokpm_daily: new Map() };
  requests: Array<{ at: string; status: number; rows: number; error: string | null }> = [];
  fail = false;
  constructor(public now: () => number) {}
  recentRequests(sinceIso: string) {
    return Promise.resolve(this.requests.filter((r) => r.at > sinceIso).map(({ at, status, rows }) => ({ at, status, rows })));
  }
  insertIgnore(table: string, rows: unknown[]) {
    if (this.fail) return Promise.reject(new Error("db down"));
    const cols = columnsOf(table), t = this.tables[table];
    // PostgREST refuses the whole insert on one unknown column.
    for (const r of rows as Array<Record<string, unknown>>) for (const k of Object.keys(r)) if (!cols.includes(k)) return Promise.reject(new Error(`${table}: no column ${k}`));
    let n = 0;
    for (const r of rows as Array<Record<string, unknown>>) if (!t.has(String(r.id))) { t.set(String(r.id), r); n++; }
    return Promise.resolve(n);
  }
  logRequest(row: { status: number; rows: number; error: string | null }) {
    for (const k of Object.keys(row)) assert(columnsOf("grokpm_requests").includes(k), k);
    this.requests.push({ at: new Date(this.now()).toISOString(), ...row });
    return Promise.resolve();
  }
}

/** The appendix's three examples (`src/grokpm_prereg.test.js` checks the pre-registration prints exactly these). */
const DECISION: Record<string, unknown> = examples.decision, CYCLE: Record<string, unknown> = examples.cycle, DAILY: Record<string, unknown> = examples.daily;

const post = (body: unknown, h: Record<string, string> = {}) => new Request("https://x.test/functions/v1/grokpm", {
  method: "POST", headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json", ...h }, body: typeof body === "string" ? body : JSON.stringify(body),
});
const run = async (req: Request, db: FakeDb, secret = SECRET, now = T0) => {
  const res = await handle(req, { secret, db, now: () => now, report: () => Promise.resolve() });
  return { status: res.status, body: await res.json(), headers: res.headers };
};

Deno.test("without the secret, or with a short one, every request is refused before anything is read", async () => {
  for (const secret of ["", "short"]) {
    const db = new FakeDb(() => T0);
    const r = await run(post({ decisions: [DECISION] }), db, secret);
    assertEquals(r.status, 503);
    assertEquals(db.requests.length, 0);
    assertEquals(db.tables.grokpm_decisions.size, 0);
  }
});

Deno.test("a wrong or missing bearer is 401 and leaves no trace in the database", async () => {
  const db = new FakeDb(() => T0);
  for (const h of [{ Authorization: "Bearer " + "x".repeat(40) }, { Authorization: SECRET }, { Authorization: "" }]) {
    const r = await run(post({ decisions: [DECISION] }, h), db);
    assertEquals(r.status, 401);
    assertEquals(JSON.stringify(r.body).includes(SECRET), false);
  }
  assertEquals(db.requests.length, 0);
  assertEquals(await isAuthorised(`Bearer ${SECRET}`, SECRET), true);
  assertEquals(await isAuthorised(`Bearer ${SECRET}x`, SECRET), false);
});

Deno.test("the appendix's examples are accepted as written, stored with every typed column and the row as sent", async () => {
  const db = new FakeDb(() => T0);
  const r = await run(post({ decisions: [DECISION], cycles: [CYCLE], daily: [DAILY] }), db);
  assertEquals(r.status, 200, JSON.stringify(r.body));
  assertEquals(r.body.stored, { decisions: 1, cycles: 1, daily: 1 });
  assertEquals(r.body.duplicates, 0);
  assertEquals(r.body.rows_left_this_hour, GROKPM_MAX_ROWS_PER_HOUR - 3);
  const d = db.tables.grokpm_decisions.get(String(DECISION.id))!;
  assertEquals(d.raw, DECISION);
  assertEquals(d.p, DECISION.p);
  assertEquals(d.ts, new Date(String(DECISION.ts)).toISOString());
  assertEquals(db.requests.map((x) => [x.status, x.rows]), [[200, 3]]);
});

Deno.test("a resend is a duplicate, not a second row", async () => {
  const db = new FakeDb(() => T0);
  await run(post({ decisions: [DECISION] }), db);
  const r = await run(post({ decisions: [DECISION, { ...DECISION, id: "d-2" }] }), db);
  assertEquals(r.body.stored.decisions, 1);
  assertEquals(r.body.duplicates, 1);
  assertEquals(db.tables.grokpm_decisions.size, 2);
});

Deno.test("one bad row refuses the whole request, every reason named", async () => {
  const db = new FakeDb(() => T0);
  const bad = [
    [{ ...DECISION, extra: 1 }, "decisions[0].extra: unknown field"],
    [{ ...DECISION, p: 1.2 }, "decisions[0].p: must be between 0 and 1"],
    [{ ...DECISION, p: "0.7" }, "decisions[0].p: must be a number"],
    [{ ...DECISION, price: 1 }, "decisions[0].price: must be strictly between 0 and 1"],
    [{ ...DECISION, side: "SELL" }, "decisions[0].side: an open is a BUY of the outcome's token"],
    [{ ...DECISION, market_id: "0xABC" }, "decisions[0].market_id: must be a condition id: 0x and 64 lower-case hex digits"],
    [{ ...DECISION, sources: [] }, "decisions[0].sources: at least one source is required for category A or B"],
    [{ ...DECISION, sources: ["javascript:alert(1)"] }, "decisions[0].sources[0]: must be http or https"],
    [{ ...DECISION, reason: "x".repeat(2001) }, "decisions[0].reason: must be 1–2000 characters"],
    [{ ...DECISION, reason: "a\u0000b" }, "decisions[0].reason: must not contain NUL"],
    [{ ...DECISION, ts: "2026-10-16 09:30" }, "decisions[0].ts: must be an ISO 8601 time with a zone, e.g. 2026-10-16T09:30:00Z"],
    [{ ...DECISION, ts: "2026-10-16T10:00:00Z" }, "decisions[0].ts: is more than 10 minutes in the future"],
    [{ ...DECISION, ts: "2026-10-08T09:00:00Z" }, "decisions[0].ts: is more than 7 days old"],
    [{ ...DECISION, invalidation: undefined }, "decisions[0].invalidation: required"],
    [{ ...DECISION, id: "has space" }, "decisions[0].id: must be 1–64 of A–Z a–z 0–9 . _ : -"],
  ] as const;
  for (const [row, why] of bad) {
    const r = await run(post({ decisions: [row], cycles: [CYCLE] }), db);
    assertEquals(r.status, 422, why);
    assert((r.body.errors as string[]).includes(why), `${why} in ${JSON.stringify(r.body.errors)}`);
  }
  assertEquals(db.tables.grokpm_decisions.size + db.tables.grokpm_cycles.size, 0);
  // Refusals count as requests and store no rows.
  assert(db.requests.every((x) => x.status === 422 && x.rows === 0));
  const twice = await run(post({ cycles: [CYCLE, CYCLE] }), db);
  assertEquals(twice.status, 422);
  assertEquals(validateBatch({ cycles: [{ ...CYCLE, kind: "nap" }] }, T0), { ok: false, errors: ["cycles[0].kind: must be one of light, full, event"] });
  assertEquals(validateBatch({ daily: [{ ...DAILY, day: "2026-10-17" }] }, T0), { ok: false, errors: ["daily[0].day: is in the future"] });
  assertEquals(validateBatch({ decisions: [] }, T0), { ok: false, errors: ["body: no rows"] });
  assertEquals(validateBatch([], T0).ok, false);
  assertEquals(validateBatch({ notes: "hi", cycles: [CYCLE] }, T0), { ok: false, errors: ["notes: unknown field"] });
});

Deno.test("a no_action needs no market; a cancel needs its market; close is a SELL", () => {
  const na = validateBatch({ decisions: [{ id: "n1", ts: "2026-10-16T09:00:00Z", action: "no_action", reason: "nothing cleared the bars" }] }, T0);
  assert(na.ok);
  const cancel = validateBatch({ decisions: [{ id: "c1", ts: "2026-10-16T09:00:00Z", action: "cancel", reason: "stale", order_id: "0xabc" }] }, T0);
  assertEquals(cancel, { ok: false, errors: ["decisions[0].market_id: required"] });
  const close = validateBatch({ decisions: [{ ...DECISION, id: "x1", action: "close", side: "BUY" }] }, T0);
  assertEquals(close, { ok: false, errors: ["decisions[0].side: a close is a SELL of the outcome's token"] });
});

Deno.test("the body's limits: content type, size, JSON, rows a request", async () => {
  const db = new FakeDb(() => T0);
  assertEquals((await run(post({ cycles: [CYCLE] }, { "Content-Type": "text/plain" }), db)).status, 415);
  assertEquals((await run(post("x".repeat(GROKPM_MAX_BODY_BYTES + 1)), db)).status, 413);
  assertEquals((await run(post("{not json"), db)).status, 400);
  const many = Array.from({ length: GROKPM_MAX_ROWS_PER_REQUEST + 1 }, (_, i) => ({ ...CYCLE, id: `c${i}` }));
  const r = await run(post({ cycles: many }), db);
  assertEquals([r.status, r.body.errors], [422, [`body: ${GROKPM_MAX_ROWS_PER_REQUEST + 1} rows, at most ${GROKPM_MAX_ROWS_PER_REQUEST} a request`]]);
  assertEquals((await run(new Request("https://x.test/", { method: "PUT", headers: { Authorization: `Bearer ${SECRET}` } }), db)).status, 405);
});

Deno.test("the hour's budget: 200 rows, 120 requests, and Retry-After when the oldest leaves the hour", async () => {
  let now = T0;
  const db = new FakeDb(() => now);
  for (let k = 0; k < 4; k++) {
    const rows = Array.from({ length: 50 }, (_, i) => ({ ...CYCLE, id: `h${k}-${i}` }));
    const r = await run(post({ cycles: rows }), db, SECRET, now);
    assertEquals(r.status, 200);
    now += 60e3;
  }
  const r = await run(post({ cycles: [{ ...CYCLE, id: "one-more" }] }), db, SECRET, now);
  assertEquals(r.status, 429);
  assertEquals(r.headers.get("Retry-After"), String(3600 - 4 * 60));
  // An hour after the first, its 50 rows leave the window.
  now = T0 + 3600e3 + 1;
  const r2 = await run(post({ cycles: [{ ...CYCLE, id: "one-more", ts: new Date(now).toISOString() }] }), db, SECRET, now);
  assertEquals(r2.status, 200, JSON.stringify(r2.body));
  const reqs = Array.from({ length: GROKPM_MAX_REQUESTS_PER_HOUR }, () => ({ at: new Date(T0).toISOString(), status: 422, rows: 0 }));
  assertEquals(rateVerdict(reqs, 1, T0 + 1).ok, false);
  assertEquals(rateVerdict(reqs.slice(1), 1, T0 + 1).ok, true);
});

Deno.test("GET is a ping: the time and the hour's budget, nothing stored", async () => {
  const db = new FakeDb(() => T0);
  const r = await run(new Request("https://x.test/", { headers: { Authorization: `Bearer ${SECRET}` } }), db);
  assertEquals(r.status, 200);
  assertEquals(r.body, { ok: true, now: new Date(T0).toISOString(), rows_left_this_hour: GROKPM_MAX_ROWS_PER_HOUR, requests_this_hour: 0 });
  assertEquals(db.requests.length, 0);
});

Deno.test("a database that fails answers 500 and asks for the rows again; nothing half-stored is claimed", async () => {
  const db = new FakeDb(() => T0);
  db.fail = true;
  let reported = "";
  const res = await handle(post({ cycles: [CYCLE] }), { secret: SECRET, db, now: () => T0, report: (k) => { reported = k; return Promise.resolve(); } });
  assertEquals(res.status, 500);
  assertEquals(reported, "grokpm.ingest");
});

Deno.test("tableRows keeps each row as sent in raw, beside its typed columns", () => {
  const body = { decisions: [DECISION], cycles: [CYCLE] };
  const v = validateBatch(body, T0);
  assert(v.ok);
  const t = tableRows(v.batch, body);
  assertEquals(t.grokpm_decisions[0].raw, DECISION);
  assertEquals(t.grokpm_cycles[0].raw, CYCLE);
  for (const [table, rows] of Object.entries(t)) for (const r of rows) for (const k of Object.keys(r)) assert(columnsOf(table).includes(k), `${table}.${k}`);
});
