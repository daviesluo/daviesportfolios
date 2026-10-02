// @vitest-environment node
// The production monitor's Worker (workers/monitor), run minute by minute against doubles of what it talks to: the
// live site, the `monitor` Edge Function's three actions, GitHub's dispatch endpoint and Workers KV. It pins the state
// machine — an alert after two failing runs in a row, once, and once more on recovery; one failing run between passes
// never pages — that KV is written only when something changed, the queue that holds a report while Supabase is down
// and flushes it when Supabase answers, GitHub skipped without its token, Workers Free's limits, and the configuration
// it is deployed with. Like cron_jobs.test.js, it sits in src/ because vitest runs here, not because the Worker is the
// page's.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../workers/monitor/src/index.js';
import {
  CHECKS, checkSite, dispatchInputs, emptyState, FAILS_TO_ALERT, healthOutput, KV_KEY, OUTBOX_MAX, parseState, runMinute, stepCheck, WRITE_BUDGET,
} from '../workers/monitor/src/monitor.js';
import { SB_ANON, SB_URL } from './app/supabase_config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** JSON with comments, as wrangler reads it: `//` comments out, strings (URLs) left alone. */
function jsonc(text) {
  let out = '', inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) { out += c; if (c === '\\') out += text[++i]; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    out += c;
  }
  return JSON.parse(out);
}
const CONFIG = jsonc(read('workers/monitor/wrangler.jsonc'));
const ENV = { ...CONFIG.vars, MONITOR_SECRET: 'the-shared-secret', MONITOR_GITHUB_PAT: 'github_pat_x' };
const MINUTE = Date.parse('2026-10-02T13:05:00Z');
const at = (n) => MINUTE + n * 60e3;

/** Workers KV: one map, every get and put counted; `failGet` makes a read throw. */
function fakeKv() {
  /** @type {any} */
  const kv = { store: new Map(), gets: 0, puts: 0, failGet: false, ttls: [] };
  kv.get = async (k, o) => { kv.gets++; kv.ttls.push(o?.cacheTtl); if (kv.failGet) throw new Error('KV unavailable'); return kv.store.get(k) ?? null; };
  kv.put = async (k, v) => { kv.puts++; kv.store.set(k, v); };
  return kv;
}

const HEALTHY = {
  at: 't', ok: true,
  checks: { tickBeat: { ok: true, ageS: 5, limitS: 180 }, tickTurn: { ok: true, ageS: -50, limitS: 180 }, quotes: { ok: true, ageS: 35, limitS: 180 }, decisions: { ok: true, ageS: 300, limitS: 4500 } },
};
const STALE_LOOP = {
  at: 't', ok: false,
  checks: { ...HEALTHY.checks, tickBeat: { ok: false, ageS: 482, limitS: 180 }, quotes: { ok: false, ageS: 455, limitS: 180 } },
};
const FRESH = { verdict: 'fresh', why: "PR5's executor finished a turn 35 s ago", acted: false, listed: null, orders: [], error: null, recorded: null };
const cancelled = (n, recorded = { events: true, ops: true }) => ({
  verdict: 'stale', why: "PR5's executor last finished a turn 4 min 12 s ago (13:00:50 UTC)", acted: true, listed: n, error: null, recorded,
  orders: Array.from({ length: n }, (_, i) => ({ id: `rx-${i}`, outcome: 'cancelled' })),
});

/**
 * Everything the Worker reaches over the network. Each part answers what the test sets; every request is recorded with
 * its headers and body. `supabase: 'down'` makes every Supabase call throw, as a project that does not answer.
 */
function fakeNet() {
  /** @type {any} */
  const n = {
    site: 200, appType: 'application/javascript', shell: '<script type="module" crossorigin src="/assets/app-45dc70df.js"></script>',
    supabase: 'up', health: HEALTHY, deadman: FRESH, report: 200, github: 204, calls: [],
  };
  n.fetch = async (input, init = {}) => {
    const url = String(input), body = init.body ? JSON.parse(String(init.body)) : null;
    n.calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body });
    if (url === `${ENV.SITE_URL}/`) return new Response(n.shell, { status: n.site, headers: { 'Content-Type': 'text/html' } });
    if (url === `${ENV.SITE_URL}/assets/app-45dc70df.js`) return new Response('export{}', { status: 200, headers: { 'Content-Type': n.appType } });
    if (url.startsWith(`${ENV.SB_URL}/functions/v1/monitor?action=`)) {
      if (n.supabase === 'down') throw new TypeError('fetch failed');
      const action = new URL(url).searchParams.get('action');
      if (action === 'health') return Response.json(n.health);
      if (action === 'deadman') return Response.json(n.deadman);
      if (action === 'report') return new Response(JSON.stringify(n.report === 200 ? { inserted: body.reports.length } : { error: 'db' }), { status: n.report });
    }
    if (url === `https://api.github.com/repos/${ENV.GITHUB_REPO}/actions/workflows/${ENV.GITHUB_WORKFLOW}/dispatches`) {
      return new Response(n.github === 204 ? null : JSON.stringify({ message: n.github === 401 ? 'Bad credentials' : 'Server Error' }), { status: n.github });
    }
    return new Response('no route', { status: 599 });
  };
  n.reports = () => n.calls.filter((c) => c.url.endsWith('action=report')).map((c) => c.body.reports);
  n.dispatches = () => n.calls.filter((c) => c.url.includes('api.github.com')).map((c) => c.body);
  return n;
}
const run = (net, kv, minute, env = ENV) => runMinute({ now: at(minute), fetch: net.fetch, kv, env });
const stored = (kv) => parseState(kv.store.get(KV_KEY) ?? null);

afterEach(() => { vi.unstubAllGlobals(); });

describe('the state machine', () => {
  const step = (prev, ok, minute) => stepCheck(prev, { ok, detail: ok ? 'fine' : `bad at ${minute}` }, new Date(at(minute)).toISOString(), 'X');

  it('alerts after two failing runs in a row, once, and once more when it recovers', () => {
    expect(FAILS_TO_ALERT).toBe(2);
    let s = emptyState().checks.loop;
    const events = [];
    for (const [m, ok] of [[0, false], [1, false], [2, false], [3, false], [4, true], [5, true]]) {
      const r = step(s, ok, m);
      s = r.next;
      events.push(r.event ? `${m} ${r.event.kind}` : null);
    }
    expect(events).toEqual([null, '1 alert', null, null, '4 recovered', null]);
    // The alert names when it began and how it was found at first; the recovery how long it lasted.
    const a = step(step(emptyState().checks.loop, false, 0).next, false, 1).event;
    expect(a?.text).toBe('X failing since 13:05 UTC: bad at 1 (at first: bad at 0)');
    let t = step(emptyState().checks.loop, false, 0).next;
    t = step(t, false, 1).next;
    expect(step(t, true, 12).event?.text).toBe('X recovered at 13:17 UTC, failing since 13:05 UTC (12 min 00 s).');
  });

  it('one failing run between passes never alerts', () => {
    let s = emptyState().checks.site;
    for (let m = 0; m < 10; m++) {
      const r = step(s, m % 2 === 1, m);
      expect(r.event).toBeNull();
      s = r.next;
    }
    expect(s).toEqual({ fails: 0, alerted: false, since: null, detail: null });
  });

  it('an alerted check that stays failing does not change: nothing to write', () => {
    let s = step(step(emptyState().checks.pr5, false, 0).next, false, 1).next;
    expect(s.alerted).toBe(true);
    for (let m = 2; m < 60; m++) expect(step(s, false, m)).toEqual({ next: s, event: null });
  });

  it('a stored state that cannot be read is a clean one, never half-trusted', () => {
    for (const raw of [null, '', 'not json', '{"v":2}', '[]']) expect(parseState(raw)).toEqual(emptyState());
    const s = emptyState();
    s.checks.loop = { fails: 2, alerted: true, since: '2026-10-02T13:05:00.000Z', detail: 'd' };
    expect(parseState(JSON.stringify(s))).toEqual(s);
  });
});

describe('a minute of the Worker', () => {
  it('writes KV only when something changed: a healthy hour writes nothing', async () => {
    const net = fakeNet(), kv = fakeKv();
    for (let m = 0; m < 60; m++) {
      const r = await run(net, kv, m);
      expect(r.wrote).toBe(false);
      expect(Object.values(r.results).every((x) => x.ok)).toBe(true);
    }
    expect([kv.gets, kv.puts]).toEqual([60, 0]);
    expect(kv.ttls.every((t) => t === 30)).toBe(true);
    expect(net.reports()).toEqual([]);
  });

  it('a stall: one write at the first failure, one at the alert, none while it lasts, one at the recovery — and each alert reaches both ways', async () => {
    const net = fakeNet(), kv = fakeKv();
    await run(net, kv, 0);
    net.health = STALE_LOOP;
    const r1 = await run(net, kv, 1);
    expect([r1.wrote, r1.events, kv.puts]).toEqual([true, [], 1]);
    const r2 = await run(net, kv, 2);
    expect([r2.wrote, r2.events, kv.puts]).toEqual([true, ['alert loop'], 2]);
    // To the errors box, through the function's report action, with the shared secret …
    const [box] = net.reports();
    expect(box).toEqual([{
      kind: 'monitor.alert', check: 'loop',
      message: "Supabase's minute loop failing since 13:06 UTC: the tick's call last started 8 min 02 s ago (limit 3 min 00 s); PR5's executor last finished a turn 7 min 35 s ago (limit 3 min 00 s) (13:07 UTC)",
      context: { at: '2026-10-02T13:07:00.000Z', worker: 'daviesportfolios-monitor', github: 'an issue is dispatched to GitHub' },
    }]);
    // … and to GitHub, as one dispatch of the alert workflow.
    const [d] = net.dispatches();
    expect(d.ref).toBe('main');
    expect(d.inputs.event).toBe('alert');
    expect(d.inputs.title).toBe("Production monitor: Supabase's minute loop failing");
    expect(d.inputs.body).toContain("**ALERT** (13:07 UTC) Supabase's minute loop failing since 13:06 UTC");
    expect(d.inputs.body).toContain("| Supabase's minute loop | failing | 2026-10-02 13:06 UTC |");
    for (let m = 3; m < 30; m++) expect((await run(net, kv, m)).wrote).toBe(false);
    expect([kv.puts, net.reports().length, net.dispatches().length]).toEqual([2, 1, 1]);
    net.health = HEALTHY;
    const back = await run(net, kv, 30);
    expect([back.wrote, back.events, kv.puts]).toEqual([true, ['recovered loop'], 3]);
    expect(net.reports()[1][0].message).toBe("Supabase's minute loop recovered at 13:35 UTC, failing since 13:06 UTC (29 min 00 s). (13:35 UTC)");
    expect(net.dispatches()[1].inputs.event).toBe('recovered');
    expect(stored(kv).checks.loop).toEqual({ fails: 0, alerted: false, since: null, detail: null });
  });

  it('the queue: with Supabase down the alert waits in KV, and goes when Supabase answers again, the recovery with it', async () => {
    const net = fakeNet(), kv = fakeKv();
    net.supabase = 'down';
    await run(net, kv, 0);
    const r = await run(net, kv, 1);
    expect(r.events.sort()).toEqual(['alert loop', 'alert pr5']);
    expect(r.delivery.site).toMatch(/^queued/);
    expect(stored(kv).outbox.map((i) => [i.kind, i.check, i.site, i.github])).toEqual([['alert', 'loop', true, false], ['alert', 'pr5', true, false]]);
    // GitHub does not need Supabase: it was told at once.
    expect(net.dispatches().length).toBe(1);
    const puts = kv.puts;
    for (let m = 2; m < 10; m++) expect((await run(net, kv, m)).wrote).toBe(false);   // retried each minute, nothing new to write
    expect(kv.puts).toBe(puts);
    expect(net.calls.filter((c) => c.url.endsWith('action=report')).length).toBe(9);
    net.supabase = 'up';
    const back = await run(net, kv, 10);
    expect(back.delivery.site).toBe('4 reported');
    expect(net.reports().at(-1).map((x) => [x.kind, x.check])).toEqual([['monitor.alert', 'loop'], ['monitor.alert', 'pr5'], ['monitor.recovered', 'loop'], ['monitor.recovered', 'pr5']]);
    expect(stored(kv).outbox).toEqual([]);
    expect(back.wrote).toBe(true);
  });

  it('the dead-man: fresh passes; stale fails with what it did; a cancel the database did not record is queued for the errors box', async () => {
    const net = fakeNet(), kv = fakeKv();
    net.deadman = cancelled(10, { events: false, ops: false });
    const r = await run(net, kv, 0);
    expect(r.results.pr5).toMatchObject({ ok: false, detail: "PR5's executor last finished a turn 4 min 12 s ago (13:00:50 UTC); the dead-man cancelled 10 of 10 resting orders" });
    expect(r.events).toEqual(['deadman pr5']);                         // not an alert: one failing run never pages
    expect(net.reports()[0]).toEqual([expect.objectContaining({ kind: 'monitor.deadman', check: 'pr5' })]);
    expect(net.dispatches()).toEqual([]);
    // Recorded by the function itself, it is not reported twice.
    net.deadman = cancelled(3);
    const r2 = await run(net, kv, 1);
    expect(r2.events).toEqual(['alert pr5']);
    expect(net.reports()[1][0].message).toContain('(at first: PR5\'s executor last finished a turn 4 min 12 s ago (13:00:50 UTC); the dead-man cancelled 10 of 10 resting orders)');
    // A dead-man call that fails is a failure: nothing protects the orders while it does.
    net.deadman = { error: 'unauthorised' };
    const r3 = await run(net, kv, 5);
    expect(r3.results.pr5.detail).toMatch(/^the dead-man call failed \(200: .*nothing protects PR5's resting orders/);
  });

  it('without MONITOR_SECRET nothing calls Supabase, and both of its checks fail saying why', async () => {
    const net = fakeNet(), kv = fakeKv();
    const { MONITOR_SECRET: _s, ...env } = ENV;
    const r = await run(net, kv, 0, env);
    expect(net.calls.some((c) => c.url.startsWith(ENV.SB_URL))).toBe(false);
    expect([r.results.loop.ok, r.results.pr5.ok, r.results.site.ok]).toEqual([false, false, true]);
    expect(r.results.pr5.detail).toBe("MONITOR_SECRET is not set on the Worker, so the monitor function cannot be called: nothing protects PR5's resting orders");
  });

  it('every Supabase call carries the anon key for the gateway and the shared secret for the function', async () => {
    const net = fakeNet();
    await run(net, fakeKv(), 0);
    const sb = net.calls.filter((c) => c.url.startsWith(ENV.SB_URL));
    expect(sb.map((c) => [c.method, new URL(c.url).searchParams.get('action')]).sort()).toEqual([['POST', 'deadman'], ['POST', 'health']]);
    for (const c of sb) {
      expect(c.headers.Authorization).toBe(`Bearer ${SB_ANON}`);
      expect(c.headers['x-monitor-secret']).toBe('the-shared-secret');
    }
  });
});

describe('GitHub', () => {
  it('skipped without the token: nothing is dispatched, the errors box is told so, and the health output says so', async () => {
    const net = fakeNet(), kv = fakeKv();
    const { MONITOR_GITHUB_PAT: _p, ...env } = ENV;
    net.site = 503;
    await run(net, kv, 0, env);
    const r = await run(net, kv, 1, env);
    expect([r.events, r.github, net.dispatches()]).toEqual([['alert site'], 'skipped: no MONITOR_GITHUB_PAT', []]);
    expect(net.reports()[0][0].context.github).toBe('GitHub skipped: the Worker has no MONITOR_GITHUB_PAT');
    expect(healthOutput(env, stored(kv)).github).toBe("skipped: the Worker has no MONITOR_GITHUB_PAT secret, so alerts go to the site's errors box only");
    expect(healthOutput(ENV, stored(kv)).github).toBe('configured: an alert opens or comments on the issue labelled monitor');
  });

  it('a 5xx is tried again next minute; a 401 is said once in the errors box and not retried', async () => {
    const net = fakeNet(), kv = fakeKv();
    net.site = 503; net.github = 500;
    await run(net, kv, 0);
    await run(net, kv, 1);                                             // the alert: GitHub answers 500
    expect(stored(kv).outbox.map((i) => [i.kind, i.site, i.github])).toEqual([['alert', false, true]]);
    net.github = 204;
    await run(net, kv, 2);                                             // retried, and delivered
    expect([net.dispatches().length, stored(kv).outbox]).toEqual([2, []]);
    net.site = 200; net.github = 401;
    await run(net, kv, 3);                                             // the recovery: refused for good
    const notices = net.reports().flat().filter((x) => x.kind === 'monitor.github');
    expect(notices.map((x) => x.message.slice(0, 54))).toEqual(['GitHub refused the alert dispatch (401 {"message":"Bad']);
    expect([stored(kv).outbox, stored(kv).github?.status]).toEqual([[], 401]);
    net.site = 503;
    await run(net, kv, 4); await run(net, kv, 5);                      // a new alert: dispatched, refused again, not said again
    expect(net.reports().flat().filter((x) => x.kind === 'monitor.github').length).toBe(1);
    expect(healthOutput(ENV, stored(kv)).github).toMatch(/^configured, but GitHub refused the last dispatch \(401\)/);
  });

  it('the dispatch carries the three inputs monitor-alert.yml declares, and the workflow reads them only through its environment', () => {
    const s = emptyState();
    const items = [{ id: 'a', at: '2026-10-02T13:07:00.000Z', kind: 'alert', check: 'pr5', text: 'down', site: false, github: true }];
    const inputs = dispatchInputs(items, s, '2026-10-02T13:07:30.000Z');
    expect(Object.keys(inputs).sort()).toEqual(['body', 'event', 'title']);
    const yml = read('.github/workflows/monitor-alert.yml');
    for (const k of Object.keys(inputs)) expect(yml).toMatch(new RegExp(`\\n      ${k}:\\n`));
    // An input is untrusted text: it may only reach the script as an environment variable, never spliced into it.
    const uses = yml.split('\n').filter((l) => l.includes('${{ inputs.'));
    expect(uses.length).toBe(3);
    for (const l of uses) expect(l).toMatch(/^\s+[A-Z_]+: \$\{\{ inputs\.[a-z]+ \}\}$/);
  });
});

describe('the site check', () => {
  it('the shell 200 and the app chunk it names 200 JavaScript, as healthcheck.yml checks them', async () => {
    const net = fakeNet();
    expect(await checkSite(net.fetch, ENV.SITE_URL)).toEqual({ ok: true, detail: 'assets/app-45dc70df.js 200' });
    net.appType = 'text/html';                                         // the not-found shell served under a chunk's name
    expect((await checkSite(net.fetch, ENV.SITE_URL)).detail).toBe('assets/app-45dc70df.js answered 200 text/html');
    net.appType = 'application/javascript'; net.shell = '<html></html>';
    expect((await checkSite(net.fetch, ENV.SITE_URL)).detail).toBe('the served page names no assets/app-*.js');
    net.site = 522;
    expect(await checkSite(net.fetch, ENV.SITE_URL)).toEqual({ ok: false, detail: 'the site answered 522' });
    const dead = async () => { throw new TypeError('fetch failed'); };
    expect((await checkSite(dead, ENV.SITE_URL)).ok).toBe(false);
  });
});

describe("Workers Free's limits", () => {
  it('the daily write budget: past it a count is not written, an alert still is', async () => {
    const net = fakeNet(), kv = fakeKv();
    const s = emptyState();
    s.writes = { day: '2026-10-02', n: WRITE_BUDGET };
    kv.store.set(KV_KEY, JSON.stringify(s));
    net.health = STALE_LOOP;
    const r1 = await run(net, kv, 0);                                  // the first failure: only a count changed
    expect(r1.wrote).toBe(false);
    const r2 = await run(net, kv, 1);                                  // read back clean, so the count starts again …
    expect([r2.events, r2.wrote]).toEqual([[], false]);
    // … a budget that blocked the count blocks its alert too, until the UTC day turns: the cost of bounding writes.
    const tomorrow = await runMinute({ now: Date.parse('2026-10-03T00:00:00Z'), fetch: net.fetch, kv, env: ENV });
    expect(tomorrow.wrote).toBe(true);
    expect(stored(kv).writes).toEqual({ day: '2026-10-03', n: 1 });
  });

  it('a run makes at most eight subrequests, with everything failing and the queue full', async () => {
    const net = fakeNet(), kv = fakeKv();
    const s = emptyState();
    s.outbox = Array.from({ length: OUTBOX_MAX }, (_, i) => ({ id: `q${i}`, at: new Date(at(0)).toISOString(), kind: 'alert', check: 'loop', text: 't', site: true, github: true }));
    kv.store.set(KV_KEY, JSON.stringify(s));
    // The site fails on its chunk, so both of its fetches are made: the most a run can send.
    net.appType = 'text/html'; net.report = 503; net.github = 500; net.health = STALE_LOOP; net.deadman = cancelled(12, { events: false, ops: false });
    const r = await run(net, kv, 1);
    expect(net.calls.length + kv.gets + kv.puts).toBeLessThanOrEqual(8);
    expect(stored(kv).outbox.length).toBe(OUTBOX_MAX);                  // kept fifty deep, the oldest dropped and counted
    expect(stored(kv).dropped).toBe(1);
    expect(r.wrote).toBe(true);
  });

  it('an unreadable KV is not overwritten: the checks and the dead-man still run', async () => {
    const net = fakeNet(), kv = fakeKv();
    kv.failGet = true;
    net.health = STALE_LOOP;
    const r = await run(net, kv, 0);
    expect([r.kvRead, r.wrote, kv.puts]).toEqual([false, false, 0]);
    expect(net.calls.some((c) => c.url.endsWith('action=deadman'))).toBe(true);
  });
});

describe('the Worker as deployed', () => {
  it('runs every minute with its KV bound, and sends the page\'s own anon key to the page\'s own project', () => {
    expect(CONFIG.name).toBe('daviesportfolios-monitor');
    expect(CONFIG.triggers.crons).toEqual(['* * * * *']);
    expect(CONFIG.kv_namespaces).toEqual([{ binding: 'MONITOR_KV', id: '98f4596d95c8454e901cae2ae1b97da5' }]);
    expect([CONFIG.vars.SB_ANON, CONFIG.vars.SB_URL]).toEqual([SB_ANON, SB_URL]);
    expect(CONFIG.vars.GITHUB_WORKFLOW).toBe('monitor-alert.yml');
    expect(fs.existsSync(path.join(ROOT, '.github/workflows', CONFIG.vars.GITHUB_WORKFLOW))).toBe(true);
    // No secret in the configuration: both are set by the deploy workflow.
    expect(Object.keys(CONFIG.vars).filter((k) => /SECRET|PAT|TOKEN/.test(k))).toEqual([]);
  });

  it('the scheduled handler runs a minute on its bindings; GET answers the health output and runs nothing', async () => {
    const net = fakeNet(), kv = fakeKv();
    vi.stubGlobal('fetch', net.fetch);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await worker.scheduled({ scheduledTime: at(0) }, { ...ENV, MONITOR_KV: kv });
    expect(net.calls.length).toBe(4);                                   // the shell, the chunk, health and the dead-man
    const line = JSON.parse(log.mock.calls[0][0]);
    expect([line.wrote, Object.keys(line.results)]).toEqual([false, [...CHECKS]]);
    expect(line.state).toBeUndefined();
    log.mockRestore();
    const res = await worker.fetch(new Request('https://monitor.example/'), { ...ENV, MONITOR_KV: kv });
    const out = await res.json();
    expect([res.status, out.monitorSecret, out.checks.loop.state, out.queued]).toEqual([200, 'configured', 'ok', 0]);
    expect(JSON.stringify(out)).not.toContain('the-shared-secret');
    expect(JSON.stringify(out)).not.toContain('github_pat_x');
    expect(net.calls.length).toBe(4);
    expect((await worker.fetch(new Request('https://monitor.example/', { method: 'POST' }), { ...ENV, MONITOR_KV: kv })).status).toBe(405);
  });
});

describe('the record it shares with the Edge Function', () => {
  const kinds = (sql) => [...(/check \(kind in \(([^)]*)\)\)/.exec(sql.replace(/--[^\n]*/g, ''))?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);

  it('0086 adds `deadman` to 0052\'s kinds and nothing else, and the Deno double holds the same lists', () => {
    const k52 = kinds(read('supabase/migrations/0052_live_quotes.sql')), k86 = kinds(read('supabase/migrations/0086_quote_live_deadman.sql'));
    expect(k86).toEqual([...k52, 'deadman']);
    const test = read('supabase/functions/monitor/index.test.ts');
    const list = (name) => JSON.parse(/** @type {RegExpMatchArray} */ (test.match(new RegExp(`const ${name} = (\\[[^\\]]*\\]);`)))[1]);
    expect([list('KINDS_0052'), list('KINDS_0086')]).toEqual([k52, k86]);
    expect(read('supabase/functions/monitor/deadman.ts')).toContain('kind: "deadman"');
  });
});
