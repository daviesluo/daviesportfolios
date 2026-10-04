// Keyless, read-only: the Polymarket book recorder's read path (supabase/functions/agents/pm_book_rec.ts) run against the
// public API through its own code, on the shared in-memory database the tests use (agents/testing.ts's memDb), with an
// in-memory store in place of Supabase Storage. Nothing is written anywhere but the output file.
//   1. The meta call's first run, on an empty table: the reward listing read whole, every new market's tokens from the
//      CLOB's short list, a slice of Gamma's metadata. Timed.
//   2. The minute call for <minutes> minutes, each started half a second into its minute as the cron job starts it:
//      its report, wall time, its frames' sizes, and the main thread's CPU (from /proc, 10 ms ticks), less the in-memory
//      database's own time (`dbMs`, the work Postgres and PostgREST do in production): `ownCpuMs`.
//   3. The meta call again, its clock moved past the hour's end: the hour's frames archived into the store (and the
//      day's dump of the markets), each object read back with node:zlib (every gzip member) and the module's own
//      decoder (`readFrames`), its frames and lines counted against what the archive row says, and every books line's
//      prices checked inside (0, 1) once scaled back. With a directory as the third argument, each object is saved
//      there (for `read.ts`).
// Run from the repository root:
//   npx --yes deno@1.46.3 run --allow-all docs/agents/backtests/pmrec/scripts/measure.ts <minutes> <out.txt> [<save dir>]
// (--allow-all because Deno 1.46 grants /proc/self/task/<pid>/stat, the main thread's CPU, to nothing less.)
import { gunzipSync } from "node:zlib";
import { memDb, type Row } from "../../../../../supabase/functions/agents/testing.ts";
import { assertPagedOrder, type Db, PAGE_ROWS } from "../../../../../supabase/functions/agents/db.ts";
import { pmVenue } from "../../../../../supabase/functions/_shared/polymarket_orders.ts";
import { PM_REC_OURS_SOURCES, PM_REC_VENUE_TIMEOUT_MS, type PmRecStorage, readFrames, runPmRec, runPmRecMeta } from "../../../../../supabase/functions/agents/pm_book_rec.ts";

const MINUTES = Number(Deno.args[0] ?? 3);
const OUT = Deno.args[1];
const SAVE = Deno.args[2] ?? null;
if (!OUT) throw new Error("usage: measure.ts <minutes> <out.txt>");
const lines: string[] = [];
const say = (x: unknown) => { const s = JSON.stringify(x); console.log(s); lines.push(s); };

/** The main thread's CPU (utime + stime of the thread V8 runs on), in ms. */
const cpu = () => {
  const s = Deno.readTextFileSync(`/proc/self/task/${Deno.pid}/stat`);
  const f = s.slice(s.lastIndexOf(")") + 2).split(" ");
  return (Number(f[11]) + Number(f[12])) * 10;
};

const seed: Record<string, Row[]> = {
  agent_locks: [{ name: "pm-rec", lease_until: "1970-01-01T00:00:00.000Z", holder: null }, { name: "pm-rec-meta", lease_until: "1970-01-01T00:00:00.000Z", holder: null }],
  pm_rec_state: [{ id: 1, state: {}, updated_at: new Date().toISOString() }, { id: 2, state: {}, updated_at: new Date().toISOString() }],
  pm_rec_markets: [], pm_rec_frames: [], pm_rec_archive: [],
};
for (const s of PM_REC_OURS_SOURCES) seed[s.table] = [];
let fakeNow = 0;
const mem = memDb(seed, { now: () => fakeNow || Date.now() });
const tables = mem.tables;
// The double does its work before it returns (a resolved promise), on this thread: timed here, it is the part of the CPU
// that Postgres and PostgREST do in production, reported apart (`dbMs`) from the recorder's own (`ownCpuMs`).
let dbMs = 0;
const timed = <A extends unknown[], R>(f: (...a: A) => R) => (...a: A): R => { const t = performance.now(); try { return f(...a); } finally { dbMs += performance.now() - t; } };
const select = timed(mem.db.select) as Db["select"];
const db: Db = {
  select, insert: timed(mem.db.insert) as Db["insert"], upsert: timed(mem.db.upsert), update: timed(mem.db.update), claim: timed(mem.db.claim) as Db["claim"],
  // The real client's paging, through the timed `select` (memDb's own selectAll would call its untimed one).
  selectAll: async <T>(table: string, query: string) => {
    assertPagedOrder(table, query);
    const out: T[] = [];
    for (let offset = 0; ; offset += PAGE_ROWS) {
      const page = await select<T>(table, `${query}&limit=${PAGE_ROWS}&offset=${offset}`);
      out.push(...page);
      if (page.length < PAGE_ROWS) break;
    }
    return out;
  },
};
const store = new Map<string, Uint8Array>();
const storage: PmRecStorage = {
  upload: (path, bytes) => { store.set(path, bytes); return Promise.resolve({ ok: true, status: 200 }); },
  sign: (paths) => Promise.resolve(new Map(paths.map((p) => [p, `https://store.invalid/${p}?token=x`]))),
  createBucket: () => Promise.resolve({ ok: true, status: 200 }),
};
const venue = pmVenue({ sigType: 1, creds: null, address: null, timeoutMs: PM_REC_VENUE_TIMEOUT_MS, sendsEnabled: false });
/** Wall time, the main thread's CPU, the double's share of it, and the rest: the recorder's own. */
async function measured<T>(f: () => Promise<T>) {
  const w0 = Date.now(), c0 = cpu(), d0 = dbMs;
  const r = await f();
  const cpuMs = cpu() - c0, db = Math.round(dbMs - d0);
  return { r, ms: Date.now() - w0, cpuMs, dbMs: db, ownCpuMs: Math.max(0, cpuMs - db) };
}

// 1. The meta call's first run.
{
  const m = await measured(() => runPmRecMeta({ db, now: Date.now(), holder: "measure", venue, pm: { timeoutMs: 20_000 }, storage }));
  const rows = tables.pm_rec_markets;
  const band = (lo: number) => rows.filter((x) => Number(x.rate) >= lo && x.delisted_at == null).length;
  say({
    step: "meta, first run", at: m.r.at, ms: m.ms, cpuMs: m.cpuMs, dbMs: m.dbMs, ownCpuMs: m.ownCpuMs, listing: m.r.listing, gamma: m.r.gamma, errors: m.r.errors,
    markets: rows.length, listedAt: { ">=0": band(0), ">=6": band(6), ">=10": band(10), ">=20": band(20), ">=50": band(50), ">=100": band(100) },
  });
}

// 2. The minute call, minute after minute.
const frames0 = tables.pm_rec_frames.length;
for (let k = 0; k < MINUTES; k++) {
  const next = Math.ceil(Date.now() / 60e3) * 60e3 + 500;
  await new Promise((r) => setTimeout(r, Math.max(0, next - Date.now())));
  const m = await measured(() => runPmRec({ db, now: Date.now(), holder: `measure-${k}` }));
  say({
    step: "minute", minute: m.r.minute, phase: m.r.phase, ms: m.ms, cpuMs: m.cpuMs, dbMs: m.dbMs, ownCpuMs: m.ownCpuMs, books: m.r.books, universe: m.r.universe,
    prints: m.r.prints, frameBytes: m.r.frames, errors: m.r.errors, skipped: m.r.skipped ?? null,
  });
}
const written = tables.pm_rec_frames.slice(frames0);
const perKind = (kind: string) => written.filter((f) => f.kind === kind).map((f) => Number(f.bytes));
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
say({ step: "frames", minutes: MINUTES, avgBytes: { books: avg(perKind("books")), universe: avg(perKind("universe")), prints: avg(perKind("prints")) } });

// 3. The archive: the meta call with its clock past the hour's end (and the listing marked fresh, so the run archives).
{
  const last = Math.max(...written.map((f) => Date.parse(String(f.minute))));
  fakeNow = Math.ceil((last + 1) / 3600e3) * 3600e3 + 3 * 60e3;
  const st = tables.pm_rec_state.find((s) => s.id === 2)!;
  st.state = { ...(st.state as Row), listingAt: fakeNow };
  const m = await measured(() => runPmRecMeta({ db, now: fakeNow, holder: "measure-archive", venue, pm: { timeoutMs: 20_000 }, storage }));
  const checks = [];
  for (const a of tables.pm_rec_archive) {
    const bytes = store.get(String(a.path))!;
    if (SAVE) await Deno.writeFile(`${SAVE}/${String(a.path).replaceAll("/", "_")}`, bytes);
    const text = new TextDecoder().decode(gunzipSync(bytes));
    // Each frame is a header and its lines; the day's dump is one header and an object a market.
    const frames = readFrames(text);
    const lines = frames.reduce((s, f) => s + f.rows.length, 0);
    // Scaled back, every books line's prices lie inside (0, 1) and its sizes are positive.
    const badBooks = a.kind !== "books" ? 0 : frames.flatMap((f) => f.rows).filter((r) => {
      const px = [...(r.bid_px as number[]), ...(r.ask_px as number[])], sz = [...(r.bid_sz as number[]), ...(r.ask_sz as number[])];
      return px.some((p) => !(p > 0 && p < 1)) || sz.some((x) => !(x > 0));
    }).length;
    checks.push({
      path: a.path, frames: a.frames, read: frames.length, lines, expected: a.lines, bytes: a.bytes, rawBytes: text.length, badBooks,
      ok: frames.length === Number(a.frames) && lines === Number(a.lines) && badBooks === 0,
    });
  }
  const held = tables.pm_rec_frames.filter((f) => f.data != null).length;
  say({
    step: "archive", ms: m.ms, cpuMs: m.cpuMs, dbMs: m.dbMs, ownCpuMs: m.ownCpuMs, archive: m.r.archive, dump: m.r.dump, gamma: m.r.gamma, errors: m.r.errors,
    objects: checks, framesStillHoldingData: held,
  });
}
await Deno.writeTextFile(OUT, lines.join("\n") + "\n");
