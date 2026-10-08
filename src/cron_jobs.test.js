// Every call pg_cron makes through pg_net is queued by ONE job, in one
// statement. pg_net 0.20's worker takes what the queue holds when a commit
// wakes it as one batch, and reads the queue again only when every request
// of that batch has answered. While nine jobs each queued their own call at
// :00, a call that committed a moment late waited behind `books` (~44 s) or
// a view run (~56 s): the tick started more than 5 s into its minute in 145
// of 1,393 runs (2026-09-27, migration 0063). This replays the migrations'
// cron calls in the order `db push` applies them and pins what they leave.
//
// From 0075 the job's list is a table, `public.edge_calls`, and this also
// replays every statement on it: the seed must be 0074's list row for row
// plus the watchdog's, every minute of a day must queue what 0074 queued,
// and every function the list calls must write its beat
// (`_shared/beats.ts`), or `edge-watchdog` would run it twice a minute.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'supabase/migrations');
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const EDGE = 'https://flmvxigozjuizpckllvk.supabase.co/functions/v1/';

/** The cron jobs a list of migrations leaves: name → { schedule, command }. */
function cronJobs(files) {
  const jobs = new Map();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(DIR, f), 'utf8').replace(/--[^\n]*/g, '');
    const ops = [];
    for (const m of sql.matchAll(/cron\.schedule\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*(\$[a-z_]*\$)([\s\S]*?)\3\s*\)/g)) {
      ops.push({ at: m.index, name: m[1], schedule: m[2], command: m[4] });
    }
    for (const m of sql.matchAll(/cron\.unschedule\(\s*'([^']+)'\s*\)/g)) ops.push({ at: m.index, drop: [m[1]] });
    for (const m of sql.matchAll(/cron\.unschedule\(\s*jobid\s*\)\s+from\s+cron\.job\s+where\s+jobname\s+in\s*\(([^)]*)\)/g)) {
      ops.push({ at: m.index, drop: [...m[1].matchAll(/'([^']+)'/g)].map((n) => n[1]) });
    }
    for (const op of ops.sort((a, b) => a.at - b.at)) {
      if (op.drop) op.drop.forEach((n) => jobs.delete(n));
      else jobs.set(op.name, { schedule: op.schedule, command: op.command });
    }
  }
  return jobs;
}

const httpJobs = (jobs) => [...jobs].filter(([, j]) => j.command.includes('net.http_post'));
const count = (s, needle) => s.split(needle).length - 1;

/**
 * `public.edge_calls` as a list of migrations leaves it, in the job's order (`id`). Every statement on the table is
 * replayed, and one this cannot read fails the test: a later change to the list has to teach it, so the list stays
 * pinned. `sqls` is [[name, sql], …] in the order `db push` applies them.
 */
function replayList(sqls) {
  const rows = new Map();
  let nextId = 1;
  for (const [name, raw] of sqls) {
    // Comments out, and dollar-quoted bodies (a cron job's command) out: what is left splits on `;`.
    const sql = raw.replace(/--[^\n]*/g, '').replace(/(\$[a-z_]*\$)[\s\S]*?\1/g, "''");
    for (const stmt of sql.split(';')) {
      if (!/\bpublic\.edge_calls\b/.test(stmt)) continue;
      const s = stmt.trim().replace(/\s+/g, ' ');
      if (/^create table if not exists public\.edge_calls \(/.test(s)) continue;
      if (/^alter table public\.edge_calls enable row level security$/.test(s)) continue;
      let m = /^insert into public\.edge_calls \(path, timeout_ms, every_minutes, last_utc_hour, retry\) values (.*) on conflict \(path\) do nothing$/.exec(s);
      if (m) {
        const values = [...m[1].matchAll(/\('([^']+)', (\d+), (\d+), (\d+), (true|false)\)/g)];
        // Every row of the VALUES read, or the statement is one this cannot read.
        if (values.map((v) => v[0]).join(', ') !== m[1]) throw new Error(`${name}: an insert into public.edge_calls this test cannot read: ${s.slice(0, 160)}`);
        for (const v of values) {
          if (!rows.has(v[1])) rows.set(v[1], { id: nextId++, path: v[1], timeout: Number(v[2]), every: Number(v[3]), lastHour: Number(v[4]), enabled: true, retry: v[5] === 'true' });
        }
        continue;
      }
      m = /^update public\.edge_calls set (enabled|retry) = (true|false) where path in \(('[^']+'(?:, '[^']+')*)\)$/.exec(s);
      if (m) {
        for (const p of m[3].matchAll(/'([^']+)'/g)) {
          if (!rows.has(p[1])) throw new Error(`${name}: updates '${p[1]}', which public.edge_calls does not hold`);
          rows.get(p[1])[m[1]] = m[2] === 'true';
        }
        continue;
      }
      m = /^delete from public\.edge_calls where path in \(('[^']+'(?:, '[^']+')*)\)$/.exec(s);
      if (m) {
        for (const p of m[1].matchAll(/'([^']+)'/g)) {
          if (!rows.delete(p[1])) throw new Error(`${name}: deletes '${p[1]}', which public.edge_calls does not hold`);
        }
        continue;
      }
      throw new Error(`${name}: a statement on public.edge_calls this test cannot replay (teach replayList): ${s.slice(0, 160)}`);
    }
  }
  return [...rows.values()].sort((a, b) => a.id - b.id);
}
const sqlsOf = (files) => files.map((f) => [f, fs.readFileSync(path.join(DIR, f), 'utf8')]);

/** The rows of the job's VALUES list (0063 to 0074), in order. */
const valuesOf = (command) => [...command.match(/\(values([\s\S]*?)\) as call/)[1].matchAll(/\('([^']+)',\s*(\d+),\s*(\d+),\s*(\d+)\)/g)]
  .map((m) => ({ path: m[1], timeout: Number(m[2]), every: Number(m[3]), lastHour: Number(m[4]) }));

/** The job's filter, in code: due in the minute when its minute of the hour is a multiple and its hour not past the last. */
const isDue = (c, minuteMs) => {
  const at = new Date(minuteMs);
  return at.getUTCMinutes() % c.every === 0 && at.getUTCHours() <= c.lastHour;
};

/** `_shared/beats.ts`'s `beatKeyOfPath`, for the list's rows: the function, and `?action=` with the action. */
const beatKeyOfPath = (p) => {
  const q = p.indexOf('?');
  if (q < 0) return p;
  const action = new URLSearchParams(p.slice(q + 1)).get('action');
  return action ? `${p.slice(0, q)}?action=${action}` : p.slice(0, q);
};

describe('pg_cron jobs', () => {
  it('reads the nine jobs that queued their own call before 0063', () => {
    const before = httpJobs(cronJobs(FILES.filter((f) => f < '0063')));
    expect(before.map(([name]) => name).sort()).toEqual([
      'agents-books-every-minute', 'agents-pmrw-e', 'agents-pmrw-every-minute', 'agents-pmrw-select',
      'agents-quotes-every-minute', 'agents-tick-every-minute', 'agents-views-every-minute',
      'overnight-record-every-5min', 'snapshot-record-every-5min',
    ]);
  });

  it('leaves one job queuing pg_net calls, with one statement', () => {
    const jobs = httpJobs(cronJobs(FILES));
    expect(jobs.map(([name]) => name)).toEqual(['edge-calls-every-minute']);
    const [[, job]] = jobs;
    expect(job.schedule).toBe('* * * * *');
    expect(count(job.command, 'net.http_post(')).toBe(1);
    expect(count(job.command, ';')).toBe(1);
  });

  it('queues each old job\'s call unchanged, in the minutes its schedule named', () => {
    const before = httpJobs(cronJobs(FILES.filter((f) => f < '0063'))).map(([, j]) => {
      const [minute, hour] = j.schedule.split(' ');
      const url = j.command.match(/url\s*:=\s*'([^']+)'/)[1];
      expect(url.startsWith(EDGE)).toBe(true);
      expect(minute === '*' || minute === '*/5').toBe(true);
      expect(hour === '*' || hour === '0-9').toBe(true);
      return {
        path: url.slice(EDGE.length),
        timeout: Number(j.command.match(/timeout_milliseconds\s*:=\s*(\d+)/)[1]),
        every: minute === '*' ? 1 : 5,
        lastHour: hour === '*' ? 23 : 9,
      };
    });
    const job = cronJobs(FILES.filter((f) => f < '0064')).get('edge-calls-every-minute');
    expect(job.command).toContain(`url     := '${EDGE}' || call.path`);
    expect(job.command).toContain('timeout_milliseconds := call.timeout_ms');
    expect(job.command).toMatch(/where extract\(minute from now\(\) at time zone 'utc'\)::int % call\.every_minutes = 0\s+and extract\(hour from now\(\) at time zone 'utc'\)::int <= call\.last_utc_hour;/);
    const calls = [...job.command.matchAll(/\('([^']+)',\s*(\d+),\s*(\d+),\s*(\d+)\)/g)].map((m) => ({
      path: m[1], timeout: Number(m[2]), every: Number(m[3]), lastHour: Number(m[4]),
    }));
    const byPath = (a, b) => a.path.localeCompare(b.path);
    expect(calls.sort(byPath)).toEqual(before.sort(byPath));
    // The headers and body every old job sent, word for word.
    for (const [, j] of httpJobs(cronJobs(FILES.filter((f) => f < '0063')))) {
      const norm = (s) => s.replace(/\s+/g, ' ');
      expect(norm(job.command)).toContain(norm(j.command.match(/headers\s*:=[\s\S]*?\),\s*body\s*:=\s*'\{\}'::jsonb,/)[0]));
    }
  });

  it("adds RW-C's four calls to the one job (0069), leaving every other call as it was", () => {
    const callsOf = (files) => {
      const job = cronJobs(files).get('edge-calls-every-minute');
      return [...job.command.matchAll(/\('([^']+)',\s*(\d+),\s*(\d+),\s*(\d+)\)/g)].map((m) => ({
        path: m[1], timeout: Number(m[2]), every: Number(m[3]), lastHour: Number(m[4]),
      }));
    };
    // By its name, not its number: the migration before it and the one itself.
    const RWC = FILES.find((f) => /^\d{4}_pm_rwc\.sql$/.test(f)) ?? '';
    expect(RWC).not.toBe('');
    const before = callsOf(FILES.filter((f) => f < RWC));
    const after = callsOf(FILES.filter((f) => f <= RWC));
    // RW-C's engine every minute and its selection every five, as RW's; its two replays every minute, as RW's.
    const rwc = [
      { path: 'agents?action=pmrwc', timeout: 58000, every: 1, lastHour: 23 },
      { path: 'agents?action=pmrwc-e', timeout: 58000, every: 1, lastHour: 23 },
      { path: 'agents?action=pmrwc-x', timeout: 58000, every: 1, lastHour: 23 },
      { path: 'agents?action=pmrwc-select', timeout: 290000, every: 5, lastHour: 23 },
    ];
    const byPath = (a, b) => a.path.localeCompare(b.path);
    expect(after.filter((c) => !c.path.startsWith('agents?action=pmrwc')).sort(byPath)).toEqual(before.slice().sort(byPath));
    expect(after.filter((c) => c.path.startsWith('agents?action=pmrwc')).sort(byPath)).toEqual(rwc.slice().sort(byPath));
    // Each is RW's call with a `c`: the same timeout and the same minutes.
    for (const c of rwc) expect(before.find((b) => b.path === c.path.replace('pmrwc', 'pmrw'))).toEqual({ ...c, path: c.path.replace('pmrwc', 'pmrw') });
    // The headers, body and filter are the job's as it was: only the list grew.
    const cmd = (files) => cronJobs(files).get('edge-calls-every-minute').command.replace(/\(values[\s\S]*?\) as call/, '(values …) as call');
    expect(cmd(FILES.filter((f) => f <= RWC))).toBe(cmd(FILES.filter((f) => f < RWC)));
  });

  it("adds the stablecoin quote variant's call to the one job (0071), leaving every other call as it was", () => {
    const callsOf = (files) => {
      const job = cronJobs(files).get('edge-calls-every-minute');
      return [...job.command.matchAll(/\('([^']+)',\s*(\d+),\s*(\d+),\s*(\d+)\)/g)].map((m) => ({
        path: m[1], timeout: Number(m[2]), every: Number(m[3]), lastHour: Number(m[4]),
      }));
    };
    const QV = FILES.find((f) => /^\d{4}_quotes_variant\.sql$/.test(f)) ?? '';
    expect(QV).not.toBe('');
    const before = callsOf(FILES.filter((f) => f < QV));
    const after = callsOf(FILES.filter((f) => f <= QV));
    const byPath = (a, b) => a.path.localeCompare(b.path);
    // Every minute, all day, with PR5's own timeout: it replays what PR5's call decided.
    expect(after.filter((c) => c.path !== 'agents?action=quotesv').sort(byPath)).toEqual(before.slice().sort(byPath));
    expect(after.filter((c) => c.path === 'agents?action=quotesv')).toEqual([{ path: 'agents?action=quotesv', timeout: 58000, every: 1, lastHour: 23 }]);
    expect(before.find((c) => c.path === 'agents?action=quotes')).toEqual({ path: 'agents?action=quotes', timeout: 58000, every: 1, lastHour: 23 });
    // The headers, body and filter are the job's as it was: only the list grew.
    const cmd = (files) => cronJobs(files).get('edge-calls-every-minute').command.replace(/\(values[\s\S]*?\) as call/, '(values …) as call');
    expect(cmd(FILES.filter((f) => f <= QV))).toBe(cmd(FILES.filter((f) => f < QV)));
  });

  it("adds rule D's call to the one job (0072), leaving every other call as it was", () => {
    const callsOf = (files) => {
      const job = cronJobs(files).get('edge-calls-every-minute');
      return [...job.command.matchAll(/\('([^']+)',\s*(\d+),\s*(\d+),\s*(\d+)\)/g)].map((m) => ({
        path: m[1], timeout: Number(m[2]), every: Number(m[3]), lastHour: Number(m[4]),
      }));
    };
    const QD = FILES.find((f) => /^\d{4}_quotes_ruled\.sql$/.test(f)) ?? '';
    expect(QD).not.toBe('');
    const before = callsOf(FILES.filter((f) => f < QD));
    const after = callsOf(FILES.filter((f) => f <= QD));
    const byPath = (a, b) => a.path.localeCompare(b.path);
    expect(after.filter((c) => c.path !== 'agents?action=quotesd').sort(byPath)).toEqual(before.slice().sort(byPath));
    expect(after.filter((c) => c.path === 'agents?action=quotesd')).toEqual([{ path: 'agents?action=quotesd', timeout: 58000, every: 1, lastHour: 23 }]);
    expect(before.find((c) => c.path === 'agents?action=quotesv')).toEqual({ path: 'agents?action=quotesv', timeout: 58000, every: 1, lastHour: 23 });
    const cmd = (files) => cronJobs(files).get('edge-calls-every-minute').command.replace(/\(values[\s\S]*?\) as call/, '(values …) as call');
    expect(cmd(FILES.filter((f) => f <= QD))).toBe(cmd(FILES.filter((f) => f < QD)));
  });

  // The job also runs RW (`pmrw*`, until 10-09) and RW-C (`pmrwc*`): the order path's migration must add its one row
  // and leave every other row, the headers, the body and the filter exactly as they were, byte for byte.
  it("adds the Polymarket order path's call to the one job (0074): the list before it plus one row, every other row byte for byte", () => {
    const PL = FILES.find((f) => /^\d{4}_pm_live\.sql$/.test(f)) ?? '';
    expect(PL).not.toBe('');
    const job = (files) => cronJobs(files).get('edge-calls-every-minute');
    const rowsOf = (files) => job(files).command.match(/\(values([\s\S]*?)\) as call/)[1].split('\n').map((l) => l.trim()).filter(Boolean);
    const before = rowsOf(FILES.filter((f) => f < PL));
    const after = rowsOf(FILES.filter((f) => f <= PL));
    const mine = "('agents?action=pmlive&forceFunctionRegion=eu-west-1', 58000, 1, 23),";
    // Exactly one row more, and it is this one: every minute, all day, with the other minute calls' timeout. The region
    // rides in the call's own path because the job sends one set of headers for every call.
    expect(after.length).toBe(before.length + 1);
    expect(after.filter((l) => !before.includes(l))).toEqual([mine]);
    // Every row that was there is there, in the same order, as the same text.
    expect(after.filter((l) => l !== mine)).toEqual(before);
    // RW's and RW-C's calls among them, unchanged.
    for (const p of ['pmrw', 'pmrw-e', 'pmrw-x', 'pmrwc', 'pmrwc-e', 'pmrwc-x', 'pmrw-select', 'pmrwc-select']) {
      expect(after.filter((l) => l.startsWith(`('agents?action=${p}'`))).toEqual(before.filter((l) => l.startsWith(`('agents?action=${p}'`)));
      expect(after.some((l) => l.startsWith(`('agents?action=${p}'`))).toBe(true);
    }
    // The headers, body and filter are the job's as it was: only the list grew. And still one job, one statement.
    const cmd = (files) => job(files).command.replace(/\(values[\s\S]*?\) as call/, '(values …) as call');
    expect(cmd(FILES.filter((f) => f <= PL))).toBe(cmd(FILES.filter((f) => f < PL)));
    expect(job(FILES.filter((f) => f <= PL)).schedule).toBe(job(FILES.filter((f) => f < PL)).schedule);
  });

  // 0075: the list leaves the job's command for `public.edge_calls`, and `edge-watchdog` joins it.
  const WD = FILES.find((f) => /^\d{4}_edge_call_watchdog\.sql$/.test(f)) ?? '';
  const WATCHDOG = { path: 'edge-watchdog', timeout: 58000, every: 1, lastHour: 23 };
  const norm = (s) => s.replace(/\s+/g, ' ').trim();

  it("seeds public.edge_calls with 0074's list row for row, in its order, and the watchdog's row (0075)", () => {
    expect(WD).not.toBe('');
    const before = valuesOf(cronJobs(FILES.filter((f) => f < WD)).get('edge-calls-every-minute').command);
    expect(before.length).toBe(17);
    expect(replayList(sqlsOf(FILES.filter((f) => f < WD)))).toEqual([]);
    const seed = replayList(sqlsOf(FILES.filter((f) => f <= WD)));
    const shape = ({ path: p, timeout, every, lastHour }) => ({ path: p, timeout, every, lastHour });
    expect(seed.map(shape)).toEqual([...before, WATCHDOG]);
    expect(seed.every((r) => r.enabled)).toBe(true);
    // Run again when the worker never started: every call but RW's and RW-C's paper engines (their frozen specs: a
    // minute whose book was not read at `t` quotes nothing) and the watchdog itself.
    expect(seed.filter((r) => !r.retry).map((r) => r.path)).toEqual(['agents?action=pmrw', 'agents?action=pmrwc', 'edge-watchdog']);
  });

  it('queues, in every minute of a day, exactly the requests 0074 queued, in its order, and the watchdog once (0075)', () => {
    const old = cronJobs(FILES.filter((f) => f < WD)).get('edge-calls-every-minute');
    const now = cronJobs(FILES.filter((f) => f <= WD)).get('edge-calls-every-minute');
    expect(now.schedule).toBe(old.schedule);
    // The request each row makes is 0074's word for word: the same URL, headers, body and timeout expressions…
    // (Everything before the outer FROM: the headers' own sub-select reads the bearer `from vault.decrypted_secrets`.)
    const requestOf = (c) => norm(c).replace(/ from \(values .*$/, '').replace(/ from public\.edge_calls as call .*$/, '');
    expect(requestOf(now.command)).toMatch(/^select net\.http_post\( .* timeout_milliseconds := call\.timeout_ms \)$/);
    expect(requestOf(now.command)).toBe(requestOf(old.command));
    expect(requestOf(now.command)).toContain("headers := jsonb_build_object( 'Authorization', concat('Bearer ', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')), 'Content-Type', 'application/json' ), body := '{}'::jsonb,");
    expect(requestOf(now.command)).toContain(`url := '${EDGE}' || call.path`);
    expect(requestOf(now.command)).toContain('timeout_milliseconds := call.timeout_ms');
    // …from the table, with 0074's filter and `enabled`, in the seed's order.
    const oldWhere = norm(old.command).match(/ as call\(path, timeout_ms, every_minutes, last_utc_hour\) where (.*);$/)[1];
    expect(norm(now.command)).toMatch(/ from public\.edge_calls as call where call\.enabled and (.*) order by call\.id;$/);
    expect(norm(now.command).match(/ where call\.enabled and (.*) order by call\.id;$/)[1]).toBe(oldWhere);
    expect(oldWhere).toBe("extract(minute from now() at time zone 'utc')::int % call.every_minutes = 0 and extract(hour from now() at time zone 'utc')::int <= call.last_utc_hour");
    // And so, minute by minute: the requests 0074's list made and those the table makes, the watchdog aside.
    const before = valuesOf(old.command);
    const seed = replayList(sqlsOf(FILES.filter((f) => f <= WD)));
    const day = Date.UTC(2026, 9, 1);
    let requests = 0;
    for (let m = 0; m < 1440; m++) {
      const at = day + m * 60e3;
      const was = before.filter((c) => isDue(c, at)).map((c) => `${EDGE}${c.path} ${c.timeout}`);
      const is = seed.filter((c) => c.enabled && isDue(c, at)).map((c) => `${EDGE}${c.path} ${c.timeout}`);
      expect(is.filter((r) => r !== `${EDGE}edge-watchdog 58000`)).toEqual(was);
      expect(is.filter((r) => r === `${EDGE}edge-watchdog 58000`).length).toBe(1);
      requests += was.length;
    }
    // 13 calls a minute, 16 at a five-minute mark, 17 at one before 10:00 UTC: the ~19,700 a day the logs count.
    expect(requests).toBe(13 * 1152 + 16 * 168 + 17 * 120);
  });

  it('reads the list the migrations leave: unique paths and beat keys, and every function it calls writes its beat first', () => {
    const list = replayList(sqlsOf(FILES));
    expect(list.length).toBeGreaterThan(0);
    expect(new Set(list.map((r) => r.path)).size).toBe(list.length);
    // Two rows with one beat key could not be told apart by the watchdog.
    expect(new Set(list.map((r) => beatKeyOfPath(r.path))).size).toBe(list.length);
    expect(beatKeyOfPath('agents?action=pmlive&forceFunctionRegion=eu-west-1')).toBe('agents?action=pmlive');
    expect(beatKeyOfPath('snapshot-record')).toBe('snapshot-record');
    for (const r of list) expect(r.path).toMatch(/^[a-z][a-z0-9-]*(\?action=[a-z][a-z0-9-]*(&[A-Za-z]+=[A-Za-z0-9-]+)*)?$/);
    // A function the list calls that wrote no beat would be run again every minute. Each writes one under its own name,
    // with the shared helpers, before its work (the order is pinned in each function's own Deno test).
    for (const fn of new Set(list.map((r) => r.path.split('?')[0]))) {
      const src = fs.readFileSync(path.join(ROOT, 'supabase/functions', fn, 'index.ts'), 'utf8');
      expect(src, fn).toMatch(/import \{[^}]*\bbeatKeyOfRequest\b[^}]*\} from "\.\.\/_shared\/beats\.ts";/);
      expect(src, fn).toMatch(/\bwriteBeat\(/);
      expect([...src.matchAll(/beatKeyOfRequest\("([^"]+)", req\.url\)/g)].map((m) => m[1]), fn).toEqual([fn]);
    }
    // And the job is still one job and one statement, reading the table.
    const jobs = httpJobs(cronJobs(FILES));
    expect(jobs.map(([n]) => n)).toEqual(['edge-calls-every-minute']);
    expect(norm(jobs[0][1].command)).toContain('from public.edge_calls as call where call.enabled and ');
  });

  // 0081: "Reward quotes mid-pool", the order path and its paper layer run again under their own tables.
  const MID = FILES.find((f) => /^\d{4}_pm_mid\.sql$/.test(f)) ?? '';

  it("adds mid-pool's two calls to the list (0081): the list before it plus two rows, every other row as it was, the jobs unchanged", () => {
    expect(MID).not.toBe('');
    const before = replayList(sqlsOf(FILES.filter((f) => f < MID)));
    const after = replayList(sqlsOf(FILES.filter((f) => f <= MID)));
    expect(after.slice(0, before.length)).toEqual(before);
    const shape = ({ path: p, timeout, every, lastHour, enabled, retry }) => ({ path: p, timeout, every, lastHour, enabled, retry });
    // Every minute, as mini-pool's two; the path's from Ireland, as mini-pool's; both run again by the watchdog when
    // the platform failed to boot them (the migration gives the reason: a second run in a minute changes nothing).
    expect(after.slice(before.length).map(shape)).toEqual([
      { path: 'agents?action=pmmid&forceFunctionRegion=eu-west-1', timeout: 58000, every: 1, lastHour: 23, enabled: true, retry: true },
      { path: 'agents?action=pmmidprep', timeout: 58000, every: 1, lastHour: 23, enabled: true, retry: true },
    ]);
    expect(after.slice(before.length).map((r) => beatKeyOfPath(r.path))).toEqual(['agents?action=pmmid', 'agents?action=pmmidprep']);
    expect(shape(before.find((r) => r.path === 'agents?action=pmlive&forceFunctionRegion=eu-west-1'))).toEqual({ ...shape(after.at(-2)), path: 'agents?action=pmlive&forceFunctionRegion=eu-west-1' });
    expect(shape(before.find((r) => r.path === 'agents?action=pmprep'))).toEqual({ ...shape(after.at(-1)), path: 'agents?action=pmprep' });
    // No job is added, dropped or changed: the one-minute job reads the table.
    expect([...cronJobs(FILES.filter((f) => f <= MID))]).toEqual([...cronJobs(FILES.filter((f) => f < MID))]);
  });

  // 0087: the realistic twins of PR5's live executor, both run by one call.
  const TWINS = FILES.find((f) => /^\d{4}_quote_twins\.sql$/.test(f)) ?? '';

  it("adds the twins' one call to the list (0087): the list before it plus one row, every other row as it was, the jobs unchanged", () => {
    expect(TWINS).not.toBe('');
    const before = replayList(sqlsOf(FILES.filter((f) => f < TWINS)));
    const after = replayList(sqlsOf(FILES.filter((f) => f <= TWINS)));
    expect(after.slice(0, before.length)).toEqual(before);
    const shape = ({ path: p, timeout, every, lastHour, enabled, retry }) => ({ path: p, timeout, every, lastHour, enabled, retry });
    // Every minute, as PR5's own call; run again by the watchdog when the platform failed to boot it (the migration gives
    // the reason: a second run in its minute finds nothing new and writes nothing).
    expect(after.slice(before.length).map(shape)).toEqual([
      { path: 'agents?action=quotestwins', timeout: 58000, every: 1, lastHour: 23, enabled: true, retry: true },
    ]);
    expect(after.slice(before.length).map((r) => beatKeyOfPath(r.path))).toEqual(['agents?action=quotestwins']);
    expect([...cronJobs(FILES.filter((f) => f <= TWINS))]).toEqual([...cronJobs(FILES.filter((f) => f < TWINS))]);
  });

  // 0088: the twins become rows, p50 ("Stablecoin quotes variant-1") the first new one, run by 0087's own call (every enabled
  // twin in turn): no call and no job of its own.
  const TWIN_SPECS = FILES.find((f) => /^\d{4}_quote_twin_specs\.sql$/.test(f)) ?? '';

  it("adds no call for the twins' rows (0088): the list and the jobs are what they were before it", () => {
    expect(TWIN_SPECS).not.toBe('');
    expect(replayList(sqlsOf(FILES.filter((f) => f <= TWIN_SPECS)))).toEqual(replayList(sqlsOf(FILES.filter((f) => f < TWIN_SPECS))));
    expect([...cronJobs(FILES.filter((f) => f <= TWIN_SPECS))]).toEqual([...cronJobs(FILES.filter((f) => f < TWIN_SPECS))]);
    expect(replayList(sqlsOf(FILES)).filter((r) => r.path === 'agents?action=quotestwins').map((r) => [r.timeout, r.every, r.enabled, r.retry])).toEqual([[58000, 1, true, true]]);
  });

  // 0091: "Reward quotes live-prep", the order path and its paper layer run a third time under their own tables.
  const LP = FILES.find((f) => /^\d{4}_pm_lp\.sql$/.test(f)) ?? '';

  it("adds live-prep's two calls to the list (0091): the list before it plus two rows, every other row as it was, the jobs unchanged", () => {
    expect(LP).not.toBe('');
    const before = replayList(sqlsOf(FILES.filter((f) => f < LP)));
    const after = replayList(sqlsOf(FILES.filter((f) => f <= LP)));
    expect(after.slice(0, before.length)).toEqual(before);
    const shape = ({ path: p, timeout, every, lastHour, enabled, retry }) => ({ path: p, timeout, every, lastHour, enabled, retry });
    // Every minute, as mini-pool's and mid-pool's; the path's from Ireland; both run again by the watchdog when the
    // platform failed to boot them (the migration gives the reason: a second run in a minute changes nothing).
    expect(after.slice(before.length).map(shape)).toEqual([
      { path: 'agents?action=pmlp&forceFunctionRegion=eu-west-1', timeout: 58000, every: 1, lastHour: 23, enabled: true, retry: true },
      { path: 'agents?action=pmlpprep', timeout: 58000, every: 1, lastHour: 23, enabled: true, retry: true },
    ]);
    expect(after.slice(before.length).map((r) => beatKeyOfPath(r.path))).toEqual(['agents?action=pmlp', 'agents?action=pmlpprep']);
    // Mid-pool's two rows, its namesakes, are as they were.
    expect(after.filter((r) => /^agents\?action=pmmid/.test(r.path)).map(shape)).toEqual(before.filter((r) => /^agents\?action=pmmid/.test(r.path)).map(shape));
    // The functions they call route both actions, and the path's only for the cron bearer, as mid-pool's.
    const src = fs.readFileSync(path.join(ROOT, 'supabase/functions/agents/index.ts'), 'utf8');
    expect(src).toContain('if (action === "pmlp" && req.method === "POST" && who === "cron") return json(200, await runPmLpAction());');
    expect(src).toContain('if (action === "pmlpprep" && req.method === "POST" && operator) return json(200, await runPmLpPrepAction());');
    expect([...cronJobs(FILES.filter((f) => f <= LP))]).toEqual([...cronJobs(FILES.filter((f) => f < LP))]);
  });

  // 0092: the Polymarket book recorder, its minute call and its housekeeping call, and an hourly prune of its own.
  const REC = FILES.find((f) => /^\d{4}_pm_book_recorder\.sql$/.test(f)) ?? '';

  it("adds the book recorder's two calls to the list (0092), every other row as it was, and one job that calls nothing", () => {
    expect(REC).not.toBe('');
    const before = replayList(sqlsOf(FILES.filter((f) => f < REC)));
    const after = replayList(sqlsOf(FILES.filter((f) => f <= REC)));
    expect(after.slice(0, before.length)).toEqual(before);
    const shape = ({ path: p, timeout, every, lastHour, enabled, retry }) => ({ path: p, timeout, every, lastHour, enabled, retry });
    // The minute's reads every minute; the listing, Gamma and the archive every fifth. Both run again by the watchdog when
    // the platform failed to boot them (the migration gives the reason: a lease each, frames upserted on their minute and
    // kind, every housekeeping step idempotent).
    expect(after.slice(before.length).map(shape)).toEqual([
      { path: 'agents?action=pmrec', timeout: 58000, every: 1, lastHour: 23, enabled: true, retry: true },
      { path: 'agents?action=pmrec-meta', timeout: 58000, every: 5, lastHour: 23, enabled: true, retry: true },
    ]);
    expect(after.slice(before.length).map((r) => beatKeyOfPath(r.path))).toEqual(['agents?action=pmrec', 'agents?action=pmrec-meta']);
    // A day: 1,440 minute calls and 288 housekeeping calls more, the rest of the list's minutes unchanged.
    const day = Date.UTC(2026, 9, 5);
    let added = 0;
    for (let m = 0; m < 1440; m++) {
      const at = day + m * 60e3;
      const was = before.filter((c) => c.enabled && isDue(c, at)).map((c) => c.path);
      const is = after.filter((c) => c.enabled && isDue(c, at)).map((c) => c.path);
      expect(is.slice(0, was.length)).toEqual(was);
      added += is.length - was.length;
    }
    expect(added).toBe(1440 + 288);
    // The function routes both actions, for the cron bearer or an admin, as the stablecoin books' recorder.
    const src = fs.readFileSync(path.join(ROOT, 'supabase/functions/agents/index.ts'), 'utf8');
    expect(src).toContain('if (action === "pmrec" && req.method === "POST" && operator) return json(200, await runPmRecAction());');
    expect(src).toContain('if (action === "pmrec-meta" && req.method === "POST" && operator) return json(200, await runPmRecMetaAction());');
    // One job more, hourly, of SQL alone: still one job queues pg_net calls.
    const jobsBefore = cronJobs(FILES.filter((f) => f < REC)), jobsAfter = cronJobs(FILES.filter((f) => f <= REC));
    expect([...jobsAfter.keys()].filter((n) => !jobsBefore.has(n))).toEqual(['pm-rec-prune']);
    expect(jobsAfter.get('pm-rec-prune').schedule).toBe('41 * * * *');
    expect(jobsAfter.get('pm-rec-prune').command).not.toContain('net.http_post');
    expect(httpJobs(jobsAfter).map(([n]) => n)).toEqual(['edge-calls-every-minute']);
    // A market's generated phase and the module's cycle are one modulus: a change to either alone would leave a
    // fifteenth of the rewarded markets never read into the universe frames.
    const rec = fs.readFileSync(path.join(ROOT, 'supabase/functions/agents/pm_book_rec.ts'), 'utf8');
    const phases = Number(/^export const PM_REC_PHASES = (\d+);$/m.exec(rec)?.[1]);
    expect(phases).toBe(15);
    expect(fs.readFileSync(path.join(DIR, REC), 'utf8')).toContain(`phase       smallint generated always as ((id % ${phases})::smallint) stored`);
  });

  it('empties pg_net\'s response table every ten minutes, waiting at most 30 s for its lock (0093)', () => {
    // 10-07: the table held 297 MB of dead space its own six-hour pruning had to read, and the database stalled on it.
    const T = '0093_http_response_truncate.sql';
    const jobsBefore = cronJobs(FILES.filter((f) => f < T)), jobsAfter = cronJobs(FILES.filter((f) => f <= T));
    expect([...jobsAfter.keys()].filter((n) => !jobsBefore.has(n))).toEqual(['http-response-truncate']);
    const job = jobsAfter.get('http-response-truncate');
    expect(job.schedule).toBe('*/10 * * * *');
    expect(job.command).toContain('truncate net._http_response;');
    expect(job.command).toContain("set_config('lock_timeout', '30s', true)");
    expect(job.command).toContain('exception when lock_not_available');
    // SQL alone: still one job queues every pg_net call.
    expect(job.command).not.toContain('net.http_post');
    expect(httpJobs(jobsAfter).map(([n]) => n)).toEqual(['edge-calls-every-minute']);
  });

  it('prunes pg_net\'s response table with a DELETE off the batch\'s :X0 minutes, never a TRUNCATE (0097)', () => {
    // 10-08: the TRUNCATE's exclusive lock at :X0 put the one-minute batch a minute late at 18 of 24 :X0 minutes.
    const T = '0097_http_response_prune.sql';
    const jobsBefore = cronJobs(FILES.filter((f) => f < T)), jobsAfter = cronJobs(FILES.filter((f) => f <= T));
    expect(jobsAfter.has('http-response-truncate')).toBe(false);
    expect([...jobsAfter.keys()].filter((n) => !jobsBefore.has(n))).toEqual(['http-response-prune']);
    const job = jobsAfter.get('http-response-prune');
    expect(job.schedule).toBe('5-59/10 * * * *');
    expect(job.command).toContain("delete from net._http_response where created < now() - interval '10 minutes';");
    // No job may take the table's exclusive lock again: pg_net's worker inserts every minute's responses into it.
    for (const [, j] of jobsAfter) expect(j.command.toLowerCase()).not.toMatch(/truncate\s+net\._http_response/);
    expect(httpJobs(jobsAfter).map(([n]) => n)).toEqual(['edge-calls-every-minute']);
  });

  it('refuses a statement on the list it cannot replay, so a later change to the list must be taught here', () => {
    const seed = "insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('a?action=x', 1000, 1, 23, true), ('b', 2000, 5, 9, false) on conflict (path) do nothing;";
    expect(replayList([['seed', seed]]).map((r) => [r.path, r.timeout, r.every, r.lastHour, r.enabled, r.retry]))
      .toEqual([['a?action=x', 1000, 1, 23, true, true], ['b', 2000, 5, 9, true, false]]);
    // The verdict migrations' shape: rows out of the job, kept as a record.
    expect(replayList([['seed', seed], ['off', "update public.edge_calls set enabled = false where path in ('b');"]]).map((r) => r.enabled)).toEqual([true, false]);
    expect(replayList([['seed', seed], ['gone', "delete from public.edge_calls where path in ('a?action=x');"]]).map((r) => r.path)).toEqual(['b']);
    expect(() => replayList([['seed', seed], ['x', "update public.edge_calls set timeout_ms = 1 where path = 'b';"]])).toThrow(/cannot replay/);
    expect(() => replayList([['seed', seed], ['x', "update public.edge_calls set enabled = false where path in ('zz');"]])).toThrow(/does not hold/);
    expect(() => replayList([['x', "insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('a', 1, 1, 23, true), ('b', 1, 1, 23) on conflict (path) do nothing;"]])).toThrow(/cannot read/);
  });
});
