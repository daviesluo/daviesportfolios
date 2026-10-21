#!/usr/bin/env node
// The Edge Functions' tests, as `deno test --allow-env --no-check supabase/functions/` runs them (edge-functions.yml),
// split over several Deno processes at once: bin/gates.sh's `edge-test` step.
//
// Why (Davies, 2026-10-21: "gates怎么又这么慢了"). One `deno test` runs its 88 files one after another on one core: 116 s
// of wall time on an idle machine and 122 s of CPU, and inside the gates, sharing four cores, 225-279 s, the longest
// step of every run and the end of it. Three processes over the same files take about a third of the wall time.
//
// Why processes and not `deno test --parallel`. `--parallel` runs the files on threads of ONE process, and a Deno
// process has one environment: pm_live, pm_mid and polymarket_orders set and restore SB_REGION around their tests,
// agents/index plants and deletes the venue keys, and on threads of one process one file's value would be read by
// another's test. Each process here has its own environment, as the single `deno test` gave every file.
//
// Why `--no-check`, as CI's test step: the `edge-check` step beside this one runs `deno check supabase/functions/`,
// which type-checks every file, the tests among them (a type error planted in a test file fails it, 2026-10-21);
// three processes checking the same graph again would triple that work for nothing.
//
// Which file goes where only decides the speed, never what runs: every test file under supabase/functions/ is in
// exactly one shard. The shards are balanced by each file's seconds in the last run here (kept in the clone's git
// folder, `gates-edge-times.json`; a file not yet timed counts as the median), longest first onto the lightest shard.
//
//   node bin/edge-test.mjs            EDGE_TEST_SHARDS (default 3) processes
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DENO = ['--yes', 'deno@1.46.3'];

/** Deno's own rule for a test file: `test.ts`, `*_test.ts` or `*.test.ts`, in any of the extensions it runs. */
export const isTestFile = (/** @type {string} */ name) => /(^|[._])test\.(ts|tsx|mts|js|mjs|jsx)$/.test(name);

/**
 * Every test file under `dir`, as paths relative to `root` with a leading `./`, sorted.
 * @param {string} root @param {string} dir
 * @returns {string[]}
 */
export function testFiles(root, dir) {
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {string} */ d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && isTestFile(e.name)) out.push(`./${path.relative(root, p).split(path.sep).join('/')}`);
    }
  };
  walk(path.join(root, dir));
  return out.sort();
}

/**
 * The files split into `n` shards, longest first onto the lightest shard, by `times` (ms; a file without one counts
 * as their median, or 1000 ms when there are none). Every file lands in exactly one shard; no shard is empty unless
 * there are fewer files than shards.
 * @param {string[]} files @param {number} n @param {Record<string, number>} times
 * @returns {string[][]}
 */
export function partition(files, n, times) {
  const known = files.map((f) => times[f]).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  const fallback = known.length ? known[Math.floor(known.length / 2)] : 1000;
  const weight = (/** @type {string} */ f) => (Number.isFinite(times[f]) ? times[f] : fallback);
  const order = [...files].sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : 1));
  const shards = Array.from({ length: Math.max(1, Math.min(n, files.length)) }, () => ({ load: 0, files: /** @type {string[]} */ ([]) }));
  for (const f of order) {
    const s = shards.reduce((a, b) => (b.load < a.load ? b : a));
    s.files.push(f);
    s.load += weight(f);
  }
  return shards.map((s) => s.files.sort());
}

/**
 * Each file's milliseconds in a `deno test` output: the sum of its tests' own times, under its "running … from" line.
 * @param {string} output
 * @returns {Record<string, number>}
 */
export function fileTimes(output) {
  /** @type {Record<string, number>} */
  const out = {};
  let file = '';
  // eslint-disable-next-line no-control-regex
  for (const raw of output.replace(/\x1b\[[0-9;]*m/g, '').split('\n')) {
    const line = raw.trimEnd();
    const head = /^running \d+ tests? from (\S+)$/.exec(line);
    if (head) { file = head[1]; out[file] = out[file] ?? 0; continue; }
    const t = /\((?:(\d+)m)?(\d+(?:\.\d+)?)(ms|s)\)$/.exec(line);
    if (file && t && / \.\.\. /.test(line)) {
      out[file] += (Number(t[1] || 0) * 60_000) + Number(t[2]) * (t[3] === 's' ? 1000 : 1);
    }
  }
  return out;
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const n = Math.max(1, Number(process.env.EDGE_TEST_SHARDS) || 3);
  const files = testFiles(root, 'supabase/functions');
  if (!files.length) { console.error('edge-test: no test files under supabase/functions/'); process.exit(1); }
  let cache = '';
  /** @type {Record<string, number>} */
  let times = {};
  try {
    cache = path.resolve(root, execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim(), 'gates-edge-times.json');
    times = JSON.parse(fs.readFileSync(cache, 'utf8'));
  } catch { /* no timings yet: every file weighs the same */ }
  const shards = partition(files, n, times);
  const t0 = Date.now();
  const runs = shards.map((list, i) => new Promise((resolve) => {
    const child = spawn('npx', [...DENO, 'test', '--allow-env', '--no-check', ...list], { cwd: root, env: { ...process.env, NO_COLOR: '1' } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ i, list, code, out, secs: Math.round((Date.now() - t0) / 1000) }));
  }));
  Promise.all(runs).then((done) => {
    /** @type {Record<string, number>} */
    const measured = {};
    let failed = false;
    for (const r of /** @type {any[]} */ (done)) {
      Object.assign(measured, fileTimes(r.out));
      const summary = (/^(ok|FAILED) \|.*$/m.exec(r.out) || [''])[0];
      const ok = r.code === 0 && summary.startsWith('ok');
      console.log(`${ok ? 'ok  ' : 'FAIL'} edge-test shard ${r.i + 1}/${done.length}: ${r.list.length} files, ${r.secs} s: ${summary || 'no summary'}`);
      if (!ok) { failed = true; console.log(r.out); }
    }
    if (cache && !failed) {
      try { fs.writeFileSync(cache, `${JSON.stringify(measured, null, 1)}\n`); } catch { /* a read-only clone keeps the old timings */ }
    }
    process.exit(failed ? 1 : 0);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
