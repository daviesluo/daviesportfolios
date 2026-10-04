// The meta call's archive of one FULL hour (`measure.ts` archives the few minutes it records): sixty frames of each
// kind at the sizes `measure.ts` measured (books 177 KB, universe 41 KB, prints 2 KB of gzip), archived by
// `runPmRecMeta` on the shared in-memory database into an in-memory store, its main thread's CPU from /proc. Each read
// of frames goes through JSON as PostgREST sends it: the stringify is the database's (`dbMs`, with the double's own
// work), the parse the function's. The frames are pseudo-random bytes: the hex decode, the concatenation and the sha256
// cost the same whatever the bytes are. Nothing leaves the process.
// Run from the repository root:
//   npx --yes deno@1.46.3 run --allow-all docs/agents/backtests/pmrec/scripts/archive_hour.ts <out.txt>
import { memDb, type Row } from "../../../../../supabase/functions/agents/testing.ts";
import type { Db } from "../../../../../supabase/functions/agents/db.ts";
import { pmVenue } from "../../../../../supabase/functions/_shared/polymarket_orders.ts";
import { byteaHex, PM_REC_OURS_SOURCES, type PmRecStorage, runPmRecMeta } from "../../../../../supabase/functions/agents/pm_book_rec.ts";

const OUT = Deno.args[0];
if (!OUT) throw new Error("usage: archive_hour.ts <out.txt>");
/** The main thread's CPU (utime + stime of the thread V8 runs on), in ms. */
const cpu = () => {
  const s = Deno.readTextFileSync(`/proc/self/task/${Deno.pid}/stat`);
  const f = s.slice(s.lastIndexOf(")") + 2).split(" ");
  return (Number(f[11]) + Number(f[12])) * 10;
};

const SIZES = { books: 177_000, universe: 41_100, prints: 2_000 } as const;
const H0 = Date.UTC(2026, 9, 4, 18, 0), T = H0 + 63 * 60e3;
let seed = 7;
const bytesOf = (n: number) => {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; b[i] = seed >> 16; }
  return b;
};
const frames: Row[] = [];
for (let m = 0; m < 60; m++) {
  for (const [kind, n] of Object.entries(SIZES)) {
    const at = new Date(H0 + m * 60e3).toISOString();
    frames.push({ minute: at, kind, n: 100, bytes: n, ms: 1, detail: {}, data: byteaHex(bytesOf(n)), recorded_at: at, archived_at: null, lost: false });
  }
}
const seedTables: Record<string, Row[]> = {
  agent_locks: [{ name: "pm-rec-meta", lease_until: "1970-01-01T00:00:00.000Z", holder: null }],
  // The listing read this hour and the day's dump made: the run archives and does nothing else.
  pm_rec_state: [{ id: 2, state: { listingAt: T, firstListingAt: T, dumpDay: "2026-10-04" }, updated_at: new Date(T).toISOString() }],
  pm_rec_markets: [], pm_rec_frames: frames, pm_rec_archive: [],
};
for (const s of PM_REC_OURS_SOURCES) seedTables[s.table] = [];
const mem = memDb(seedTables, { now: () => T });
let dbMs = 0, parseMs = 0;
const db: Db = {
  ...mem.db,
  select: (async (table: string, query: string) => {
    const t0 = performance.now();
    const text = JSON.stringify(await mem.db.select(table, query));
    const t1 = performance.now();
    dbMs += t1 - t0;
    const rows = JSON.parse(text);
    parseMs += performance.now() - t1;
    return rows;
  }) as Db["select"],
};
const uploaded = new Map<string, number>();
const storage: PmRecStorage = {
  upload: (p, b) => { uploaded.set(p, b.length); return Promise.resolve({ ok: true, status: 200 }); },
  sign: (ps) => Promise.resolve(new Map(ps.map((p) => [p, `https://store.invalid/${p}?token=x`]))),
  createBucket: () => Promise.resolve({ ok: true, status: 200 }),
};
// Gamma's refresh finds the table empty and asks nothing; no other read leaves the process.
const venue = pmVenue({ sigType: 1, creds: null, address: null, timeoutMs: 1_000, sendsEnabled: false, fetchImpl: (() => Promise.reject(new Error("no network here"))) as typeof fetch });
const c0 = cpu(), w0 = Date.now();
const r = await runPmRecMeta({ db, now: T, holder: "archive-hour", venue, storage, clock: () => T + 1_000 });
const cpuMs = cpu() - c0;
const out = {
  step: "a full hour archived", wallMs: Date.now() - w0, cpuMs, dbMs: Math.round(dbMs), jsonParseMs: Math.round(parseMs), ownCpuMs: Math.max(0, Math.round(cpuMs - dbMs)),
  archive: r.archive, errors: r.errors, uploaded: Object.fromEntries(uploaded), framesStillHoldingData: mem.tables.pm_rec_frames.filter((f) => f.data != null).length,
};
console.log(JSON.stringify(out));
await Deno.writeTextFile(OUT, JSON.stringify(out) + "\n");
