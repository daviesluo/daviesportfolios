// @ts-check
// The Cloudflare Worker `daviesportfolios-monitor`: its cron runs the production monitor every minute (`monitor.js`
// has what a run does and why), and a GET answers with its own health output. Deployed by
// `.github/workflows/monitor-deploy.yml`; configured by `../wrangler.jsonc`.
//
// Secrets, never in the repository: MONITOR_SECRET (shared with the `monitor` Edge Function, set on both sides by the
// deploy workflow, which generates it) and MONITOR_GITHUB_PAT (optional: a fine-grained token with Actions: write on
// daviesportfolios, from the repository secret of that name; without it the Worker skips GitHub and says so).

import { healthOutput, KV_CACHE_TTL_S, KV_KEY, parseState, runMinute } from './monitor.js';

/**
 * @typedef {import('./monitor.js').Env & { MONITOR_KV: import('./monitor.js').Kv }} WorkerEnv
 */

export default {
  /**
   * The minute. Its log line is the run's summary: what each check found, what was delivered, whether KV was written.
   * @param {{ scheduledTime: number }} controller @param {WorkerEnv} env
   */
  async scheduled(controller, env) {
    const r = await runMinute({ now: controller.scheduledTime, fetch: (input, init) => fetch(input, init), kv: env.MONITOR_KV, env });
    const { state: _state, ...line } = r;
    console.log(JSON.stringify(line));
  },

  /** The health output: configuration and where each check stands. GET only; nothing here runs a check. */
  async fetch(/** @type {Request} */ request, /** @type {WorkerEnv} */ env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('GET only', { status: 405 });
    let state = null;
    try { state = parseState(await env.MONITOR_KV.get(KV_KEY, { cacheTtl: KV_CACHE_TTL_S })); } catch { /* shown as unreadable */ }
    return new Response(JSON.stringify(healthOutput(env, state), null, 2), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  },
};
