// @vitest-environment node
// The build is reproducible, and CI and the deploy hold to the bundle that is committed (review F7, 2026-10-08):
// build_stamp.js against a scratch repository, then the workflows and the gates as written.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStamp, notInBundle } from './build_stamp.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** @type {string} */ let dir;
const write = (/** @type {string} */ f, /** @type {string} */ text) => {
  fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  fs.writeFileSync(path.join(dir, f), text);
};
const at = (/** @type {string} */ iso) => ({ env: {}, now: () => new Date(iso) });

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-stamp-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  write('.gitignore', 'ignored.js\n');
  write('app/a.js', 'export const a = 1;\n');
  write('app/a.test.js', 'test\n');
  write('e2e/sweep.mjs', 'sweep\n');
  write('notes.md', 'note\n');
  write('ignored.js', 'ignored\n');
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', 'add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'one'], { cwd: dir });
});
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('build_stamp.js', () => {
  it('is the same at any hour for the same source: no clock in it', () => {
    const s = buildStamp(dir, at('2026-10-08T15:01:00Z'));
    expect(s).toMatch(/^src\.[0-9a-f]{12}$/);
    expect(buildStamp(dir, at('2026-10-09T03:47:00Z'))).toBe(s);
  });

  it('does not move for a test, a browser check, a note or an ignored file, and moves for the source', () => {
    const s = buildStamp(dir, at('2026-10-08T15:01:00Z'));
    write('app/a.test.js', 'test, changed\n');
    write('e2e/sweep.mjs', 'sweep, changed\n');
    write('notes.md', 'note, changed\n');
    write('ignored.js', 'ignored, changed\n');
    expect(buildStamp(dir, at('2026-10-08T15:01:00Z'))).toBe(s);
    write('app/a.js', 'export const a = 2;\n');
    const changed = buildStamp(dir, at('2026-10-08T15:01:00Z'));
    expect(changed).not.toBe(s);
    // A new file not yet added counts, as it will be committed with the change.
    write('app/b.js', 'export const b = 1;\n');
    expect(buildStamp(dir, at('2026-10-08T15:01:00Z'))).not.toBe(changed);
  });

  it('takes APP_VERSION from the environment, and falls back to the minute where git cannot list the files', () => {
    expect(buildStamp(dir, { env: { APP_VERSION: 'given' } })).toBe('given');
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'build-stamp-bare-'));
    try {
      expect(buildStamp(bare, at('2026-10-08T15:01:00Z'))).toBe('2026.10.8.1501');
    } finally { fs.rmSync(bare, { recursive: true, force: true }); }
    expect([notInBundle('x.test.jsx'), notInBundle('e2e/a.mjs'), notInBundle('CLAUDE.md'), notInBundle('app/app.jsx')]).toEqual([true, true, true, false]);
  });
});

describe('CI and the deploy hold to the committed bundle', () => {
  const job = (yml, name) => {
    const i = yml.indexOf(`\n  ${name}:\n`);
    const next = yml.slice(i + 1).search(/\n {2}[a-z][a-z-]*:\n/);
    return yml.slice(i, next < 0 ? undefined : i + 1 + next);
  };

  it('check.yml: the source job builds and requires the committed dist/ unchanged; the bundle jobs build nothing of their own', () => {
    const yml = read('.github/workflows/check.yml');
    const src = job(yml, 'typecheck-and-build');
    const build = src.indexOf('run: npm run build');
    const fresh = src.indexOf('git status --porcelain -- dist');
    expect(build).toBeGreaterThan(0);
    expect(fresh).toBeGreaterThan(build);
    expect(src).not.toMatch(/grep -E '\^src\/\.\*\\\.\(js\|jsx\|css\)\$'/);   // the old path-only check is gone
    for (const name of ['sweep', 'perf-and-size']) expect(job(yml, name)).not.toContain('npm run build');
  });

  it('pages-deploy.yml: a push is published only once check.yml has passed on the same commit', () => {
    const yml = read('.github/workflows/pages-deploy.yml');
    expect(yml).toMatch(/actions\/workflows\/check\.yml\/runs\?head_sha=\$SHA&event=push&per_page=1/);
    expect(yml).toContain(`if: steps.creds.outputs.ready == '1' && (github.event_name != 'push' || steps.checked.outputs.ok == '1')`);
    expect(yml).toMatch(/\n {2}actions: read\n/);
  });

  it('vite.config.js takes its stamp from build_stamp.js, and the gates check freshness after their build', () => {
    const cfg = read('src/vite.config.js');
    expect(cfg).toContain("const APP_VERSION = buildStamp(fileURLToPath(new URL('.', import.meta.url)));");
    expect(cfg).not.toMatch(/new Date\(\)/);
    const gates = read('bin/gates.sh');
    const b = gates.indexOf('npm run build > "$LOGS/build.log"');
    expect(gates.indexOf('status --porcelain -- dist', b)).toBeGreaterThan(b);
  });
});
