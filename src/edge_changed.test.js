// @vitest-environment node
// bin/edge-changed.sh, the Edge Functions a push to main deploys (edge-functions.yml's detect step), run against a
// scratch repository. Until 2026-10-08 the step diffed from the push's own `before`, so the functions of a push whose
// run was cancelled by a newer push (`cancel-in-progress`) or failed before its deploy were never deployed (review F8).
// Like cron_jobs.test.js, it sits in src/ because vitest runs here.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'bin/edge-changed.sh');
const ZEROS = '0'.repeat(40);

/** @type {string} */ let dir;
const git = (/** @type {string[]} */ ...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' }).trim();
const write = (/** @type {string} */ f, /** @type {string} */ text) => {
  fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  fs.writeFileSync(path.join(dir, f), text);
};
const commit = (/** @type {string} */ msg) => { git('add', '-A'); git('commit', '-q', '-m', msg); return git('rev-parse', 'HEAD'); };
/** The functions the script names, and what it said on stderr: run as the workflow runs it, with AFTER checked out. */
function runWithStderr(/** @type {{ BEFORE: string, AFTER: string, LAST?: string }} */ env) {
  git('checkout', '-q', env.AFTER);
  const r = spawnSync('sh', [SCRIPT], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, LAST: '', ...env } });
  if (r.status !== 0) throw new Error(`edge-changed.sh exited ${r.status}: ${r.stderr}`);
  return { names: r.stdout.split('\n').filter(Boolean), said: r.stderr };
}
const run = (/** @type {{ BEFORE: string, AFTER: string, LAST?: string }} */ env) => runWithStderr(env).names;

/** @type {Record<string, string>} */ const c = {};
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-changed-'));
  git('init', '-q', '-b', 'main');
  write('supabase/functions/_shared/token.ts', 'export const t = 1;\n');
  write('supabase/functions/alpha/index.ts', 'a1\n');
  write('supabase/functions/beta/index.ts', 'b1\n');
  write('supabase/functions/gamma/index.ts', 'g1\n');
  write('supabase/functions/.env.example', 'X=\n');
  c.base = commit('base: the last deployed commit');
  write('supabase/functions/alpha/index.ts', 'a2\n');
  c.pushA = commit('push A: its run is cancelled by push B before it deploys');
  write('supabase/functions/beta/helper.ts', 'b2\n');
  c.pushB = commit('push B');
  write('supabase/functions/gamma/index.test.ts', 'test\n');
  write('supabase/functions/gamma/CLAUDE.md', 'note\n');
  c.notes = commit('a test and a note only');
  write('supabase/functions/_shared/token.ts', 'export const t = 2;\n');
  c.shared = commit('a shared module');
  fs.rmSync(path.join(dir, 'supabase/functions/gamma'), { recursive: true });
  c.deleted = commit('gamma deleted');
});
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('bin/edge-changed.sh', () => {
  it('deploys the cancelled push\'s functions too: it diffs from the last successful run, not from the push\'s before', () => {
    expect(run({ BEFORE: c.pushA, AFTER: c.pushB, LAST: c.base })).toEqual(['alpha', 'beta']);
  });

  it('takes a function\'s sibling module as a change of that function', () => {
    expect(run({ BEFORE: c.pushA, AFTER: c.pushB, LAST: c.pushA })).toEqual(['beta']);
  });

  it('deploys nothing for a test file or a note beside a function', () => {
    expect(run({ BEFORE: c.pushB, AFTER: c.notes, LAST: c.pushB })).toEqual([]);
  });

  it('deploys every function, never `_shared` or a file, when a shared module changed', () => {
    expect(run({ BEFORE: c.notes, AFTER: c.shared, LAST: c.notes })).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('never names a function the push deleted', () => {
    const r = runWithStderr({ BEFORE: c.shared, AFTER: c.deleted, LAST: c.shared });
    expect(r.names).toEqual([]);
    expect(r.said).toMatch(/gamma was deleted/);
  });

  it('falls back to the push\'s before, and warns, with no successful run, one the clone does not hold, or one ahead of this commit', () => {
    for (const LAST of ['', 'f'.repeat(40), c.deleted]) {
      const r = runWithStderr({ BEFORE: c.pushA, AFTER: c.pushB, LAST });
      expect(r.names).toEqual(['beta']);
      expect(r.said).toMatch(/^::warning::edge-changed:/m);
    }
  });

  it('deploys every function with no base at all: a branch\'s creation, or a before the clone does not hold', () => {
    expect(run({ BEFORE: ZEROS, AFTER: c.pushB })).toEqual(['alpha', 'beta', 'gamma']);
    expect(run({ BEFORE: 'e'.repeat(40), AFTER: c.pushB })).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('is what the workflow runs, with the last successful push run\'s commit as LAST', () => {
    const yml = fs.readFileSync(path.join(ROOT, '.github/workflows/edge-functions.yml'), 'utf8');
    expect(yml).toMatch(/actions\/workflows\/edge-functions\.yml\/runs\?branch=main&event=push&status=success&per_page=1/);
    expect(yml).toMatch(/CHANGED=\$\(LAST="\$LAST" sh bin\/edge-changed\.sh\)/);
    expect(yml).toMatch(/\n {2}actions: read\n/);
  });
});
