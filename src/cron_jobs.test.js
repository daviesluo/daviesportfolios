// Every call pg_cron makes through pg_net is queued by ONE job, in one
// statement. pg_net 0.20's worker takes what the queue holds when a commit
// wakes it as one batch, and reads the queue again only when every request
// of that batch has answered. While nine jobs each queued their own call at
// :00, a call that committed a moment late waited behind `books` (~44 s) or
// a view run (~56 s): the tick started more than 5 s into its minute in 145
// of 1,393 runs (2026-09-27, migration 0063). This replays the migrations'
// cron calls in the order `db push` applies them and pins what they leave.
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
});
