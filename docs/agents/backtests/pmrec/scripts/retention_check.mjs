// 0092 against Postgres itself: PGlite 0.2.17 (PostgreSQL 16.4) with the migration applied twice over stubs
// (`cron.schedule`, `agent_locks`, `edge_calls`), then its hourly job's statements, taken from the migration's own
// text, run on frames and markets placed around now(): what the job keeps, what it drops, and what it marks lost. Then
// the sizes the budget rests on: a frame of a minute's books as measured (176 KB of gzip) held, cleared and vacuumed,
// and 20,000 markets with fields of the lengths Polymarket's have. Read-only against the repository; it writes nothing.
//
// Run from the repository root, with PGlite installed anywhere (it is not a dependency of this repository):
//   npm i --prefix /tmp/pglite @electric-sql/pglite@0.2.17
//   PGLITE=/tmp/pglite/node_modules/@electric-sql/pglite/dist/index.js node docs/agents/backtests/pmrec/scripts/retention_check.mjs
// A counterfactual as the second argument: `no-prune` (the job never runs) or `keep-held` (the job without its first
// statement, the six-hour cap on data the archive has not taken). Output: docs/agents/backtests/pmrec/results/
// retention_check_out.txt (exit 0 when every check passes).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const { PGlite } = await import(process.env.PGLITE ?? '@electric-sql/pglite');
const REPO = process.cwd();
const SQL = fs.readFileSync(path.join(REPO, 'supabase/migrations/0092_pm_book_recorder.sql'), 'utf8');
const mode = process.argv[2] ?? '';
const out = [];
const say = (x) => { const s = JSON.stringify(x); console.log(s); out.push(s); };
let failed = 0;
const check = (name, ok, detail) => { if (!ok) failed++; say({ check: name, ok, ...(detail === undefined ? {} : { detail }) }); };

const db = new PGlite();
await db.exec(`
  create schema cron;
  create table cron.job (jobname text primary key, schedule text, command text);
  create function cron.schedule(n text, s text, c text) returns bigint language sql as
    $$ insert into cron.job values (n, s, c) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning 1::bigint $$;
  create table public.agent_locks (name text primary key, lease_until timestamptz not null default 'epoch', holder text);
  create table public.edge_calls (
    id integer generated always as identity primary key, path text not null unique, timeout_ms integer not null, every_minutes integer not null,
    last_utc_hour integer not null, enabled boolean not null default true, retry boolean not null default true);
`);
// Twice: a `db push` that runs it again must change nothing.
await db.exec(SQL);
await db.exec(SQL);
const q = async (s) => (await db.query(s)).rows;
check('the four tables, two leases, two calls and one job, after the migration ran twice',
  (await q(`select count(*)::int n from information_schema.tables where table_schema = 'public' and table_name like 'pm_rec_%'`))[0].n === 4
  && (await q(`select count(*)::int n from public.agent_locks where name in ('pm-rec', 'pm-rec-meta')`))[0].n === 2
  && JSON.stringify(await q(`select path, timeout_ms, every_minutes, last_utc_hour, enabled, retry from public.edge_calls order by id`)) === JSON.stringify([
    { path: 'agents?action=pmrec', timeout_ms: 58000, every_minutes: 1, last_utc_hour: 23, enabled: true, retry: true },
    { path: 'agents?action=pmrec-meta', timeout_ms: 58000, every_minutes: 5, last_utc_hour: 23, enabled: true, retry: true },
  ])
  && (await q(`select count(*)::int n from cron.job`))[0].n === 1
  && (await q(`select count(*)::int n from public.pm_rec_state where updated_at is not null`))[0].n === 2);
check('a market takes its id and its phase from the database, id % 15',
  JSON.stringify(await q(`insert into public.pm_rec_markets (cond, yes, no) values ('0x${'a'.repeat(64)}', '1', '2') returning id, phase`)) === '[{"id":1,"phase":1}]');
let refused = '';
try { await db.exec(`insert into public.pm_rec_markets (cond, yes, no, phase) values ('0x${'b'.repeat(64)}', '1', '2', 3)`); } catch (e) { refused = e.message; }
check('a write may not name the phase', /non-DEFAULT value into column "phase"/.test(refused), refused);
refused = '';
try { await db.exec(`insert into public.pm_rec_frames (minute, kind, n, bytes) values (now(), 'book', 0, 0)`); } catch (e) { refused = e.message; }
check('a frame of an unknown kind is refused', /pm_rec_frames_kind_check/.test(refused), refused);

// The job's statements, from the migration's text: what `pm-rec-prune` runs every hour.
const job = (await q(`select command from cron.job where jobname = 'pm-rec-prune'`))[0].command;
const statements = job.split(';').map((s) => s.trim()).filter(Boolean);
check('the hourly job is three statements: the cap on held data, the frames after seven days, the markets after a week delisted', statements.length === 3, statements);

// Frames around now(): the data of each as a few bytes (the sizes come later).
await db.exec(`
  insert into public.pm_rec_frames (minute, kind, n, bytes, data, archived_at, lost) values
    (date_trunc('minute', now() - interval '30 minutes'), 'books', 1, 3, '\\x010203', null, false),   -- held, young
    (date_trunc('minute', now() - interval '5 hours'),    'books', 1, 3, '\\x010203', null, false),   -- held, under the cap
    (date_trunc('minute', now() - interval '7 hours'),    'books', 1, 3, '\\x010203', null, false),   -- held past the cap: lost
    (date_trunc('minute', now() - interval '7 hours'),    'prints', 1, 3, null, now() - interval '6 hours', false), -- archived
    (date_trunc('minute', now() - interval '6 days'),     'books', 1, 3, null, now() - interval '6 days', false),   -- archived, kept
    (date_trunc('minute', now() - interval '8 days'),     'books', 1, 3, null, now() - interval '8 days', false),   -- archived, gone
    (date_trunc('minute', now() - interval '8 days'),     'universe', 1, 3, null, null, true);                      -- lost, gone
  insert into public.pm_rec_markets (cond, yes, no, delisted_at, ours_until) values
    ('0x${'c'.repeat(64)}', '1', '2', now() - interval '8 days', null),                          -- dropped a week ago: gone
    ('0x${'d'.repeat(64)}', '1', '2', now() - interval '8 days', now() + interval '10 minutes'),  -- but held: kept
    ('0x${'e'.repeat(64)}', '1', '2', now() - interval '2 days', null),                          -- dropped two days ago: kept
    ('0x${'f'.repeat(64)}', '1', '2', null, null);                                               -- listed: kept
`);
const run = mode === 'no-prune' ? [] : mode === 'keep-held' ? statements.slice(1) : statements;
for (const s of run) await db.exec(s);
const frames = await q(`select kind, round(extract(epoch from now() - minute) / 3600) as h, data is not null as held, archived_at is not null as archived, lost from public.pm_rec_frames order by minute desc, kind`);
say({ frames });
const held = frames.filter((f) => f.held).map((f) => Number(f.h));
check('held data under six hours old stays held', JSON.stringify(held) === '[1,5]', held);
check('held data past six hours is dropped and marked lost', frames.some((f) => Number(f.h) === 7 && f.kind === 'books' && f.lost && !f.held));
check("a frame's counts are kept seven days, archived or lost, and then deleted", frames.length === 5 && !frames.some((f) => Number(f.h) >= 192));
const markets = await q(`select substr(cond, 3, 1) as c from public.pm_rec_markets order by id`);
check('a market delisted a week ago goes unless a path holds it', JSON.stringify(markets.map((m) => m.c)) === '["a","d","e","f"]', markets.map((m) => m.c));

// Sizes. A frame of a minute's books as measured (176 KB of gzip: random bytes, as gzip's are), sixty of them (an hour).
await db.exec(`delete from public.pm_rec_frames`);
await db.exec(`vacuum full public.pm_rec_frames`);   // VACUUM runs alone, outside a transaction
const frame = crypto.randomBytes(176_000).toString('hex');
const hourOfFrames = async (hour) => {
  for (let i = 0; i < 60; i++) {
    await db.query(`insert into public.pm_rec_frames (minute, kind, n, bytes, ms, detail, data) values ($1, 'books', 2804, 176000, 2500, $2, decode($3, 'hex'))`,
      [new Date(Date.UTC(2026, 9, 4, hour, i)).toISOString(), JSON.stringify({ set: 2804, ours: 81, cut: 0, booksBelowRate: null, read: 2804, twoSided: 2760, levels: 37400, requests: 39, failed: 0, skipped: 0, ms: 2100 }), frame]);
  }
};
const size = async () => Number((await q(`select pg_total_relation_size('public.pm_rec_frames') as b`))[0].b);
await hourOfFrames(18);
const heldHour = await size();
// The archive clears the hour (as the meta call does), autovacuum frees its space, and the next hour is held in it.
await db.exec(`update public.pm_rec_frames set data = null, archived_at = now()`);
await db.exec(`vacuum public.pm_rec_frames`);
const clearedHour = await size();
await hourOfFrames(19);
const nextHour = await size();
say({ framesSize: { anHourOfBooksHeldMB: +(heldHour / 1e6).toFixed(2), perFrameKB: Math.round(heldHour / 60 / 1e3), afterArchiveAndVacuumMB: +(clearedHour / 1e6).toFixed(2), withTheNextHourHeldMB: +(nextHour / 1e6).toFixed(2) } });
check('an hour of book frames held is about its gzip (176 KB a frame), and the next hour is held in the space the archive freed',
  heldHour > 60 * 176_000 && heldHour < 60 * 200_000 && nextHour < heldHour * 1.1, { heldHour, clearedHour, nextHour });
// 20,000 markets with Polymarket's lengths: a condition id, two 77-digit tokens, a question, a slug, an event slug.
await db.exec(`delete from public.pm_rec_markets;`);
await db.exec(`
  insert into public.pm_rec_markets (cond, yes, no, rate, max_spread, min_size, params_at, question, slug, event_slug, fee_type, neg_risk, end_date, gamma_at,
    volume24hr, volume, liquidity, competitive, accepting, closed)
  select '0x' || lpad(to_hex(g), 64, '0'), rpad(g::text, 77, '7'), rpad(g::text, 77, '9'), 5, 4.5, 20, now(),
    rpad('Will the Republican Party candidate win the 2026 IA-02 House election by ', 90, 'x'), rpad('will-the-republican-party-candidate-win', 70, 'y'),
    rpad('ia-02-house-election-margin', 40, 'z'), 'politics_fees', true, now() + interval '30 days', now(), 40.1, 1470.32, 15040.85, 0.88, true, false
  from generate_series(1, 20000) g`);
await db.exec(`vacuum analyze public.pm_rec_markets`);
const mk = Number((await q(`select pg_total_relation_size('public.pm_rec_markets') as b`))[0].b);
say({ marketsSize: { rows: 20000, totalMB: +(mk / 1e6).toFixed(2), perRowB: Math.round(mk / 20000) } });
check('20,000 markets take under 15 MB with their indexes', mk < 15e6, mk);

// The shape not taken: a row per book per minute, levels as arrays (prices as smallint in 0.0001, sizes as bigint
// hundredths) and the summary as columns, keyed by market and minute. 20,000 rows of the measured median book (13 levels
// in the window, 7 bids and 6 asks), then what a day of it would be: the $10 set's 2,810 books, 63 % of them changed
// each minute (1,731 and 1,819 of 2,810 in design_out.txt, 2026-10-04), so stored only when they change.
await db.exec(`
  create table public.book_rows (market integer not null, minute timestamptz not null, bp smallint[] not null, bs bigint[] not null, ap smallint[] not null,
    "as" bigint[] not null, ab smallint, aa smallint, q1 real, q2 real, dvb real, dva real, ltp real, primary key (market, minute));
  insert into public.book_rows
  select g % 2810, timestamptz '2026-10-04 00:00+00' + (g / 2810) * interval '1 minute',
    array[4500,4490,4480,4470,4460,4450,4440]::smallint[], array[123456,5000,250000,1000000,20000,700,9900]::bigint[],
    array[4510,4520,4530,4540,4550,4560]::smallint[], array[123456,5000,250000,1000000,20000,700]::bigint[], 4500, 4510, 25.5, 50.25, 110, 220, 0.45
  from generate_series(1, 20000) g`);
await db.exec(`vacuum analyze public.book_rows`);
const rowBytes = Number((await q(`select pg_total_relation_size('public.book_rows') as b`))[0].b) / 20000;
const perDay = rowBytes * 2810 * 0.63 * 1440;
say({ shapeNotTaken: { perRowB: Math.round(rowBytes), rowsPerDay: Math.round(2810 * 0.63 * 1440), mbPerDay: Math.round(perDay / 1e6) } });
check('a row per book per minute would be several hundred MB a day, over the budget in a day', perDay > 300e6, Math.round(perDay / 1e6));

say({ failed, mode: mode || 'as written' });
if (!mode) fs.writeFileSync(path.join(REPO, 'docs/agents/backtests/pmrec/results/retention_check_out.txt'), out.join('\n') + '\n');
process.exit(failed ? 1 : 0);
