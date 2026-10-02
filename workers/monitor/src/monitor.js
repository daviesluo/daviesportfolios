// @ts-check
// The production monitor's minute, as a Cloudflare Worker cron (`daviesportfolios-monitor`, every minute).
//
// On whose word. Davies, 2026-10-02, to "用 Cloudflare Worker 定时器，每 1–5 分钟检查一次，出问题开 issue 或推送到手机": "可以的，
// 有问题开github issue吧并且也可以在网站中的error框发给我，我看到后可以叫你来处理" — open a GitHub issue, and send it to the
// site's errors box too. Why a clock outside GitHub and Supabase: on 2026-10-02 the database thrashed from about 13:00 to
// 14:20 UTC, pg_cron's minute job barely ran, and nothing alerted; `healthcheck.yml` asks GitHub for every 10 minutes
// and GitHub ran it 9 times in the 48 hours to 17:00 UTC, none between 13:11 and 17:00.
//
// Each run, three checks at once:
//   site  the live site's shell answers 200 and the `assets/app-*.js` it names answers 200 as JavaScript (as
//         healthcheck.yml checks them);
//   loop  Supabase's minute loop, by the `monitor` Edge Function's read-only health action (supabase/functions/monitor/
//         health.ts: the tick's beat and finished turn, PR5's executor, the newest decision, each against a limit);
//   pr5   PR5's dead-man (supabase/functions/monitor/deadman.ts): it cancels PR5's resting orders itself when the
//         executor has missed three turns; this check fails whenever it found the executor stale or could not run.
// A check alerts after `FAILS_TO_ALERT` failing runs in a row, so one slow minute never pages (each Supabase reading is
// already allowed three minutes), and once more when it recovers. An alert goes two ways: to the site's errors box (the
// function's report action → `ops_errors`, kinds `monitor.*`) and, when the Worker holds a GitHub token, to GitHub, where
// `monitor-alert.yml` opens one issue labelled `monitor` or comments on the one open. Without the token GitHub is skipped
// and the health output says so.
//
// State lives in Workers KV, one key, written only when it changes: Workers Free allows 1,000 KV writes a day and this
// runs 1,440 times. A check that stays failing after its alert writes nothing more; a run that changes nothing writes
// nothing; and a daily budget keeps a flapping check from reaching the limit. A report the errors box could not take
// (Supabase down) waits in the state's outbox and goes when Supabase answers again; a dispatch GitHub refused for a
// moment the same. Workers Free also allows 10 ms of CPU and 50 subrequests a run: a run makes at most eight (the KV
// read and write, two site fetches, two function calls, one report, one dispatch) and parses a few kilobytes.

/** Failing runs in a row before a check alerts. */
export const FAILS_TO_ALERT = 2;
/** The checks, in the order their lines are written. */
export const CHECKS = /** @type {const} */ (['site', 'loop', 'pr5']);
/** @typedef {typeof CHECKS[number]} CheckName */
export const LABELS = {
  site: 'The live site (daviesluo.com)',
  loop: "Supabase's minute loop",
  pr5: "PR5's live quotes (the dead-man switch)",
};
export const KV_KEY = 'state';
/** KV's shortest edge cache: a read never sees a copy older than this, and runs are a minute apart. */
export const KV_CACHE_TTL_S = 30;
/** A UTC day's KV writes this Worker allows itself before it writes only alerts, recoveries and queued reports (Free: 1,000). */
export const WRITE_BUDGET = 900;
export const OUTBOX_MAX = 50;
export const OUTBOX_MAX_AGE_MS = 24 * 3600e3;
export const TIMEOUT_MS = { site: 10_000, deadman: 55_000, health: 20_000, report: 15_000, github: 10_000 };
/** A browser's User-Agent, as healthcheck.yml sends: a bot-shaped one can be challenged by the CDN. */
export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * @typedef {{ fails: number, alerted: boolean, since: string | null, detail: string | null }} CheckState
 * @typedef {{ id: string, at: string, kind: string, check: string, text: string, site: boolean, github: boolean }} OutboxItem
 * @typedef {{ v: 1, checks: Record<CheckName, CheckState>, outbox: OutboxItem[], github: { status: number, error: string, at: string } | null, writes: { day: string, n: number }, dropped: number }} State
 * @typedef {{ get(key: string, opts?: { cacheTtl?: number }): Promise<string | null>, put(key: string, value: string): Promise<unknown> }} Kv
 * @typedef {{ SITE_URL: string, SB_URL: string, SB_ANON: string, GITHUB_REPO: string, GITHUB_WORKFLOW: string, MONITOR_SECRET?: string, MONITOR_GITHUB_PAT?: string }} Env
 * @typedef {(input: string, init?: RequestInit) => Promise<Response>} Fetch
 * @typedef {{ ok: boolean, detail: string }} CheckResult
 */

const iso = (/** @type {number} */ ms) => new Date(ms).toISOString();
const hhmm = (/** @type {string | null} */ t) => (t ? t.slice(11, 16) : '?');
const msg = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/** "4 min 12 s", "1 h 05 min", "35 s". */
export function ago(/** @type {number} */ seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} min`;
}

/** @returns {CheckState} */
const cleanCheck = () => ({ fails: 0, alerted: false, since: null, detail: null });

/** @returns {State} */
export function emptyState() {
  return { v: 1, checks: { site: cleanCheck(), loop: cleanCheck(), pr5: cleanCheck() }, outbox: [], github: null, writes: { day: '', n: 0 }, dropped: 0 };
}

/** The stored state, or a clean one: an unreadable or foreign value is never trusted half-way. @returns {State} */
export function parseState(/** @type {string | null} */ raw) {
  const s = emptyState();
  if (!raw) return s;
  let j;
  try { j = JSON.parse(raw); } catch { return s; }
  if (!j || j.v !== 1) return s;
  for (const c of CHECKS) {
    const x = j.checks?.[c];
    if (x && typeof x.fails === 'number') s.checks[c] = { fails: x.fails, alerted: !!x.alerted, since: x.since ?? null, detail: x.detail ?? null };
  }
  if (Array.isArray(j.outbox)) s.outbox = j.outbox.filter((/** @type {any} */ i) => i && typeof i.id === 'string' && typeof i.text === 'string');
  s.github = j.github && typeof j.github.status === 'number' ? j.github : null;
  if (j.writes && typeof j.writes.n === 'number') s.writes = { day: String(j.writes.day ?? ''), n: j.writes.n };
  s.dropped = Number(j.dropped) || 0;
  return s;
}

/**
 * One check's step. Passing, an alerted check recovers (one event) and any count is cleared. Failing, the count grows to
 * `FAILS_TO_ALERT`, which alerts (one event); after that nothing changes until it passes, so nothing is written.
 * @param {CheckState} prev @param {CheckResult} r @param {string} nowIso
 * @returns {{ next: CheckState, event: { kind: 'alert' | 'recovered', text: string } | null }}
 */
export function stepCheck(prev, r, nowIso, label = '') {
  if (r.ok) {
    if (prev.alerted) {
      const down = prev.since ? Math.round((Date.parse(nowIso) - Date.parse(prev.since)) / 1000) : null;
      return { next: cleanCheck(), event: { kind: 'recovered', text: `${label} recovered at ${hhmm(nowIso)} UTC${prev.since ? `, failing since ${hhmm(prev.since)} UTC (${ago(down ?? 0)})` : ''}.` } };
    }
    return { next: cleanCheck(), event: null };
  }
  if (prev.alerted) return { next: prev, event: null };
  const fails = prev.fails + 1, since = prev.since ?? nowIso, first = prev.detail ?? r.detail;
  if (fails >= FAILS_TO_ALERT) {
    const text = `${label} failing since ${hhmm(since)} UTC: ${r.detail}${first !== r.detail ? ` (at first: ${first})` : ''}`;
    return { next: { fails, alerted: true, since, detail: first }, event: { kind: 'alert', text } };
  }
  return { next: { fails, alerted: false, since, detail: first }, event: null };
}

// ---------------------------------------------------------------------------------------------------------- checks

/** The live site: the shell 200, and the app chunk it names 200 as JavaScript. Its body is not read. @returns {Promise<CheckResult>} */
export async function checkSite(/** @type {Fetch} */ f, /** @type {string} */ siteUrl) {
  let res;
  try {
    res = await f(`${siteUrl}/`, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(TIMEOUT_MS.site) });
  } catch (e) {
    return { ok: false, detail: `the site did not answer (${msg(e)})` };
  }
  const html = await res.text().catch(() => '');
  if (res.status !== 200) return { ok: false, detail: `the site answered ${res.status}` };
  const app = /assets\/app-[A-Za-z0-9_-]+\.js/.exec(html)?.[0];
  if (!app) return { ok: false, detail: 'the served page names no assets/app-*.js' };
  let r2;
  try {
    r2 = await f(`${siteUrl}/${app}`, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(TIMEOUT_MS.site) });
  } catch (e) {
    return { ok: false, detail: `${app} did not answer (${msg(e)})` };
  }
  const type = r2.headers.get('content-type') ?? '';
  try { await r2.body?.cancel(); } catch { /* the body is not needed */ }
  if (r2.status !== 200 || !/^(application|text)\/javascript\b/i.test(type)) return { ok: false, detail: `${app} answered ${r2.status} ${type || 'with no content type'}` };
  return { ok: true, detail: `${app} 200` };
}

/**
 * A call of the `monitor` Edge Function: the anon key for Supabase's gateway, the shared secret for the function.
 * @returns {Promise<{ ok: boolean, status: number, json: any, text: string }>}
 */
export async function callMonitor(/** @type {Fetch} */ f, /** @type {Env} */ env, /** @type {string} */ action, /** @type {unknown} */ body, /** @type {number} */ timeoutMs) {
  try {
    const res = await f(`${env.SB_URL}/functions/v1/monitor?action=${action}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.SB_ANON}`, apikey: env.SB_ANON, 'Content-Type': 'application/json', 'x-monitor-secret': env.MONITOR_SECRET ?? '' },
      body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON: the status says enough */ }
    return { ok: res.ok, status: res.status, json, text: text.slice(0, 200) };
  } catch (e) {
    return { ok: false, status: 0, json: null, text: msg(e) };
  }
}

const NO_SECRET = 'MONITOR_SECRET is not set on the Worker, so the monitor function cannot be called';
const HEALTH_LABELS = {
  tickBeat: "the tick's call last started",
  tickTurn: 'the tick last finished a turn',
  quotes: "PR5's executor last finished a turn",
  decisions: 'the newest strategy decision is',
};

/** The loop check from the health action's answer. @returns {CheckResult} */
export function loopResult(/** @type {{ ok: boolean, status: number, json: any, text: string } | null} */ res) {
  if (!res) return { ok: false, detail: NO_SECRET };
  const j = res.json;
  if (!res.ok || !j || typeof j.ok !== 'boolean' || !j.checks) return { ok: false, detail: `the health call failed (${res.status || 'no answer'}: ${res.text})` };
  if (j.ok) return { ok: true, detail: 'every reading within its limit' };
  const bad = Object.entries(j.checks).filter(([, c]) => !(/** @type {any} */ (c)).ok).map(([name, c]) => {
    const x = /** @type {any} */ (c), label = HEALTH_LABELS[/** @type {keyof typeof HEALTH_LABELS} */ (name)] ?? name;
    return x.error ? `${label}: unreadable (${String(x.error).slice(0, 80)})` : `${label} ${ago(x.ageS)} ago (limit ${ago(x.limitS)})`;
  });
  return { ok: false, detail: bad.join('; ') || 'the health reading says not ok' };
}

/**
 * The pr5 check from the dead-man's answer: passing only when it found the executor fresh. Its report rides along so a
 * cancel the database did not record can be queued for the errors box.
 * @returns {CheckResult & { report: any }}
 */
export function pr5Result(/** @type {{ ok: boolean, status: number, json: any, text: string } | null} */ res) {
  if (!res) return { ok: false, detail: `${NO_SECRET}: nothing protects PR5's resting orders`, report: null };
  const j = res.json;
  if (!res.ok || !j || typeof j.verdict !== 'string') {
    return { ok: false, detail: `the dead-man call failed (${res.status || 'no answer'}: ${res.text}): nothing protects PR5's resting orders while it does`, report: null };
  }
  if (j.verdict === 'fresh') return { ok: true, detail: String(j.why ?? 'fresh'), report: j };
  return { ok: false, detail: deadmanLine(j), report: j };
}

/** What the dead-man found and did, in a line. */
export function deadmanLine(/** @type {any} */ j) {
  if (j.error) return `${j.why}; ${j.error}`;
  if (!j.listed) return `${j.why}; no order rested on the venue`;
  const n = (/** @type {string} */ k) => (Array.isArray(j.orders) ? j.orders : []).filter((/** @type {any} */ o) => o.outcome === k).length;
  const parts = [`the dead-man cancelled ${n('cancelled')} of ${j.listed} resting orders`];
  if (n('filled')) parts.push(`${n('filled')} had filled`);
  if (n('open')) parts.push(`${n('open')} still open on the venue`);
  if (n('unread')) parts.push(`${n('unread')} not read back`);
  if (n('skipped')) parts.push(`${n('skipped')} left for the next minute`);
  return `${j.why}; ${parts.join(', ')}`;
}

// ------------------------------------------------------------------------------------------------------- delivery

/** The site's errors box: the outbox's pending items, as the report action takes them. */
export function reportBody(/** @type {OutboxItem[]} */ items, /** @type {string} */ githubNote) {
  return {
    reports: items.map((i) => ({
      kind: `monitor.${i.kind}`, check: i.check, message: `${i.text} (${hhmm(i.at)} UTC)`.slice(0, 512),
      context: { at: i.at, worker: 'daviesportfolios-monitor', github: githubNote },
    })),
  };
}

/**
 * One workflow_dispatch for every pending GitHub item: the events, then where every check stands now.
 * @returns {{ event: string, title: string, body: string }}
 */
export function dispatchInputs(/** @type {OutboxItem[]} */ items, /** @type {State} */ state, /** @type {string} */ nowIso) {
  const rank = { alert: 3, deadman: 2, github: 1, recovered: 0 };
  const top = [...items].sort((a, b) => (rank[/** @type {keyof typeof rank} */ (b.kind)] ?? 1) - (rank[/** @type {keyof typeof rank} */ (a.kind)] ?? 1))[0];
  const event = top.kind === 'recovered' ? 'recovered' : top.kind === 'alert' ? 'alert' : 'notice';
  const title = `Production monitor: ${LABELS[/** @type {CheckName} */ (top.check)] ?? top.check} ${top.kind === 'recovered' ? 'recovered' : 'failing'}`.slice(0, 120);
  const lines = items.map((i) => `- **${i.kind.toUpperCase()}** (${hhmm(i.at)} UTC) ${i.text}`);
  const status = CHECKS.map((c) => {
    const s = state.checks[c];
    return `| ${LABELS[c]} | ${s.alerted ? 'failing' : s.fails ? 'failed once' : 'ok'} | ${s.since ? `${s.since.slice(0, 16).replace('T', ' ')} UTC` : ''} |`;
  });
  const body = [
    ...lines, '', `Where each check stands at ${nowIso.slice(0, 16).replace('T', ' ')} UTC:`, '', '| check | state | failing since |', '|---|---|---|', ...status, '',
    'From the Cloudflare Worker `daviesportfolios-monitor` (`workers/monitor`), every minute. The same lines are in the site\'s errors box (`monitor.*`).',
  ].join('\n').slice(0, 6000);
  return { event, title, body };
}

/** @returns {Promise<{ ok: boolean, status: number, permanent: boolean, error: string }>} */
export async function dispatchGithub(/** @type {Fetch} */ f, /** @type {Env} */ env, /** @type {{ event: string, title: string, body: string }} */ inputs) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW}/dispatches`;
  try {
    const res = await f(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.MONITOR_GITHUB_PAT}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'daviesportfolios-monitor', 'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main', inputs }), signal: AbortSignal.timeout(TIMEOUT_MS.github),
    });
    const text = (await res.text().catch(() => '')).slice(0, 160);
    if (res.status === 204 || res.status === 200) return { ok: true, status: res.status, permanent: false, error: '' };
    // A refusal that a retry cannot change: the token, its permission, the workflow, or the inputs.
    return { ok: false, status: res.status, permanent: [400, 401, 403, 404, 422].includes(res.status), error: text };
  } catch (e) {
    return { ok: false, status: 0, permanent: false, error: msg(e) };
  }
}

// ------------------------------------------------------------------------------------------------------------ run

/** The state without its write counter: what decides whether anything changed. */
const essence = (/** @type {State} */ s) => JSON.stringify({ ...s, writes: null });

/**
 * One minute. Never throws: a failure is a failing check, or a delivery that waits.
 * @param {{ now: number, fetch: Fetch, kv: Kv, env: Env }} d
 */
export async function runMinute(d) {
  const nowIso = iso(d.now), day = nowIso.slice(0, 10), env = d.env;
  let raw = null, kvRead = true;
  try { raw = await d.kv.get(KV_KEY, { cacheTtl: KV_CACHE_TTL_S }); } catch { kvRead = false; }
  const prev = parseState(raw);
  const secret = !!env.MONITOR_SECRET, gh = !!env.MONITOR_GITHUB_PAT;
  const githubNote = gh ? 'an issue is dispatched to GitHub' : 'GitHub skipped: the Worker has no MONITOR_GITHUB_PAT';

  const [site, health, deadman] = await Promise.all([
    checkSite(d.fetch, env.SITE_URL),
    secret ? callMonitor(d.fetch, env, 'health', {}, TIMEOUT_MS.health) : Promise.resolve(null),
    secret ? callMonitor(d.fetch, env, 'deadman', {}, TIMEOUT_MS.deadman) : Promise.resolve(null),
  ]);
  const pr5 = pr5Result(deadman);
  /** @type {Record<CheckName, CheckResult>} */
  const results = { site, loop: loopResult(health), pr5 };

  /** @type {State} */
  const next = { ...prev, checks: { ...prev.checks }, outbox: [...prev.outbox] };
  /** @type {OutboxItem[]} */
  const fresh = [];
  for (const c of CHECKS) {
    const { next: cs, event } = stepCheck(prev.checks[c], results[c], nowIso, LABELS[c]);
    next.checks[c] = cs;
    if (event) fresh.push({ id: `${nowIso}|${c}|${event.kind}`, at: nowIso, kind: event.kind, check: c, text: event.text, site: true, github: gh });
  }
  // A cancel the database did not record is queued for the errors box; the check's alert carries it to GitHub.
  const r = pr5.report;
  if (r && r.acted && !(r.recorded && r.recorded.ops)) {
    fresh.push({ id: `${nowIso}|pr5|deadman`, at: nowIso, kind: 'deadman', check: 'pr5', text: deadmanLine(r), site: true, github: false });
  }
  next.outbox.push(...fresh);
  // Kept a day at most and fifty deep: what is dropped is counted.
  const kept = next.outbox.filter((i) => d.now - Date.parse(i.at) <= OUTBOX_MAX_AGE_MS).slice(-OUTBOX_MAX);
  next.dropped += next.outbox.length - kept.length;
  next.outbox = kept;

  // Deliveries: GitHub, then the errors box (which then also hears of a GitHub refusal in the same run), each item
  // marked when it went.
  const toGithub = next.outbox.filter((i) => i.github);
  /** @type {{ site: string | null, github: string | null }} */
  const delivery = { site: null, github: null };
  if (toGithub.length && gh) {
    const res = await dispatchGithub(d.fetch, env, dispatchInputs(toGithub, next, nowIso));
    if (res.ok) {
      next.outbox = next.outbox.map((i) => (i.github ? { ...i, github: false } : i));
      next.github = null;
      delivery.github = `${toGithub.length} dispatched`;
    } else if (res.permanent) {
      // Retried, it would fail every minute: the items go to the errors box only, and the refusal is said there once.
      next.outbox = next.outbox.map((i) => (i.github ? { ...i, github: false } : i));
      if (!prev.github || prev.github.status !== res.status) {
        next.outbox.push({
          id: `${nowIso}|github|${res.status}`, at: nowIso, kind: 'github', check: 'github', site: true, github: false,
          text: `GitHub refused the alert dispatch (${res.status} ${res.error}): MONITOR_GITHUB_PAT is expired, revoked or lacks Actions: write on daviesportfolios; alerts reach this box only until it is replaced`,
        });
      }
      next.github = { status: res.status, error: res.error.slice(0, 120), at: prev.github?.status === res.status ? prev.github.at : nowIso };
      delivery.github = `refused ${res.status}`;
    } else delivery.github = `queued (${res.status || 'no answer'})`;
  }
  const toSite = next.outbox.filter((i) => i.site);
  if (toSite.length && secret) {
    const res = await callMonitor(d.fetch, env, 'report', reportBody(toSite, githubNote), TIMEOUT_MS.report);
    if (res.ok) { next.outbox = next.outbox.map((i) => (i.site ? { ...i, site: false } : i)); delivery.site = `${toSite.length} reported`; }
    else delivery.site = `queued (${res.status || 'no answer'}: ${res.text.slice(0, 80)})`;
  }
  next.outbox = next.outbox.filter((i) => i.site || i.github);

  // Written only when something changed; past the day's budget, only when an alert, a recovery or the outbox did.
  const changed = essence(next) !== essence(prev);
  const essential = fresh.length > 0 || JSON.stringify(next.outbox) !== JSON.stringify(prev.outbox) || JSON.stringify(next.github) !== JSON.stringify(prev.github);
  const writesToday = prev.writes.day === day ? prev.writes.n : 0;
  let wrote = false, writeError = null;
  if (changed && kvRead && (essential || writesToday < WRITE_BUDGET)) {
    next.writes = { day, n: writesToday + 1 };
    try { await d.kv.put(KV_KEY, JSON.stringify(next)); wrote = true; } catch (e) { writeError = msg(e); }
  } else next.writes = prev.writes;

  return {
    at: nowIso, results: Object.fromEntries(CHECKS.map((c) => [c, { ok: results[c].ok, detail: results[c].detail }])),
    events: fresh.map((i) => `${i.kind} ${i.check}`), delivery, wrote, writeError, kvRead,
    outbox: next.outbox.length, github: gh ? (next.github ? `refused ${next.github.status}` : 'configured') : 'skipped: no MONITOR_GITHUB_PAT', state: next,
  };
}

/**
 * The Worker's own health output (GET): its configuration and where each check stands, from KV. No detail of what the
 * checks found is shown here: the address is public.
 */
export function healthOutput(/** @type {Partial<Env>} */ env, /** @type {State | null} */ state) {
  const checks = state ? Object.fromEntries(CHECKS.map((c) => {
    const s = state.checks[c];
    return [c, { state: s.alerted ? 'failing (alerted)' : s.fails ? 'failed once' : 'ok', since: s.since }];
  })) : 'state unreadable';
  return {
    worker: 'daviesportfolios-monitor', schedule: 'every minute', failsToAlert: FAILS_TO_ALERT,
    github: env.MONITOR_GITHUB_PAT
      ? (state?.github ? `configured, but GitHub refused the last dispatch (${state.github.status}) since ${state.github.at}` : 'configured: an alert opens or comments on the issue labelled monitor')
      : 'skipped: the Worker has no MONITOR_GITHUB_PAT secret, so alerts go to the site\'s errors box only',
    monitorSecret: env.MONITOR_SECRET ? 'configured' : 'missing: the Supabase checks and the dead-man cannot be called',
    checks, queued: state ? state.outbox.length : null, writesToday: state ? state.writes : null,
  };
}
