// The build's stamp (`__APP_VERSION__`, which ops_error.js sends with every report as `ver`), worked out by
// vite.config.js at build time from what the bundle is built from, never from the clock (review F7, 2026-10-08).
//
// It was the build's UTC minute (`YYYY.M.D.HHMM`), so two builds of one commit differed in every hashed chunk: no
// commit's bundle could be rebuilt to the bytes it holds, CI tested a bundle of its own rather than the one Cloudflare
// serves, and every deploy made every client download the whole bundle again. Now it is `src.` and the first 12 hex
// digits of a SHA-256 over the app's files as git would commit them (tracked, or new and not ignored), path and bytes
// in path order, with its tests, its browser checks and its notes (`*.test.*`, `e2e/`, `*.md`) left out, since none of
// them is in the bundle. The same source gives the same stamp on any machine, which is what lets CI build a commit and
// require the committed `dist/` byte for byte. A stamp still finds its commit in one command:
// `git log -S<stamp> --oneline -- dist`.
//
// `APP_VERSION` in the environment overrides it. Where git cannot list the files (no git, not a work tree), the
// minute stamp as before: a build that cannot be reproduced says so by its shape.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Whether a path (relative to the app's folder) is outside the bundle's inputs: a test, a browser check or a note. */
export const notInBundle = (/** @type {string} */ f) => /\.test\.[cm]?[jt]sx?$/.test(f) || f.startsWith('e2e/') || f.endsWith('.md');

/**
 * @param {string} dir  the app's folder (`src/`)
 * @param {{ env?: Record<string, string | undefined>, now?: () => Date }} [o]
 * @returns {string}
 */
export function buildStamp(dir, o = {}) {
  const env = o.env ?? process.env;
  if (env.APP_VERSION) return env.APP_VERSION;
  try {
    const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'], { cwd: dir })
      .toString().split('\0').filter(Boolean).filter((f) => !notInBundle(f)).sort();
    const h = createHash('sha256');
    for (const f of listed) {
      const abs = path.join(dir, f);
      if (!existsSync(abs)) continue;   // deleted in the working tree, not yet in a commit
      h.update(f); h.update('\0'); h.update(readFileSync(abs)); h.update('\0');
    }
    return `src.${h.digest('hex').slice(0, 12)}`;
  } catch {
    const d = (o.now ?? (() => new Date()))();
    const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}.${d.getUTCMonth() + 1}.${d.getUTCDate()}.${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
  }
}
