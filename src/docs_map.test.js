// docs/map.md is the map of the system, and a map is only useful while it
// is complete. "Every change updates the docs" lived in prose and was
// followed by appending each change's story to one row, until the README
// that held the map reached 275 KB. The rows are one line now; this pins
// the part a machine can check: every client module, Edge Function,
// shared module and migration has a row, and every file a row names
// still exists.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAP = fs.readFileSync(path.join(ROOT, 'docs/map.md'), 'utf8');
const TABLES = MAP.slice(MAP.indexOf('## File map'), MAP.indexOf('## Data flow'));

const entries = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true });
const filesIn = (dir, pattern) => entries(dir)
  .filter((e) => e.isFile() && pattern.test(e.name) && !/\.test\.[jt]sx?$/.test(e.name))
  .map((e) => e.name);
const unnamed = (labels) => labels.filter((label) => !TABLES.includes('`' + label + '`'));

// Every file under the repository, as paths relative to it, for the
// reverse check. Build output and installed packages are not the map's.
function allFiles(dir = '', out = []) {
  for (const e of entries(dir)) {
    if (['.git', 'node_modules', 'dist'].includes(e.name)) continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) allFiles(rel, out);
    else out.push(rel);
  }
  return out;
}

describe('docs/map.md', () => {
  it('finds its file map between "## File map" and "## Data flow"', () => {
    expect(TABLES.length).toBeGreaterThan(1000);
  });

  it('has a row for every client module, named with its folder', () => {
    // Paths under src/: `app/auth.js`, or `vite.config.js` at its top.
    // e2e/ holds the browser tests, public/ files Vite copies as they are.
    const files = allFiles('src')
      .map((f) => f.slice('src/'.length))
      .filter((f) => /\.(js|jsx|ts|css|html)$/.test(f) && !/\.test\.[jt]sx?$/.test(f))
      .filter((f) => !/^(e2e|public)\//.test(f));
    expect(files.length).toBeGreaterThan(50);
    expect(files.filter((f) => f.includes('/')).length).toBeGreaterThan(50);
    expect(unnamed(files)).toEqual([]);
  });

  it('has a row for every Edge Function and every module beside them', () => {
    const functions = entries('supabase/functions')
      .filter((e) => e.isDirectory() && e.name !== '_shared')
      .map((e) => e.name);
    expect(functions.length).toBeGreaterThan(10);
    expect(unnamed(functions)).toEqual([]);
    expect(unnamed(filesIn('supabase/functions/_shared', /\.ts$/).map((f) => `_shared/${f}`))).toEqual([]);
    expect(unnamed(filesIn('supabase/functions/fundamentals', /^_.*\.ts$/))).toEqual([]);
    const agents = filesIn('supabase/functions/agents', /\.ts$/)
      .map((f) => (f.startsWith('backtest_') ? 'agents/backtest_*.ts' : `agents/${f}`));
    expect(unnamed([...new Set(agents)])).toEqual([]);
  });

  it('has a row for every migration', () => {
    const migrations = filesIn('supabase/migrations', /\.sql$/);
    expect(migrations.length).toBeGreaterThan(40);
    expect(unnamed(migrations)).toEqual([]);
  });

  it('names no file that is not there', () => {
    const files = allFiles();
    const named = [...TABLES.matchAll(/`([\w./-]+\.(?:js|jsx|mjs|ts|sql|md|sh|json|jsonc|yml|css|html|svg|py|draft))`/g)]
      .map((m) => m[1]);
    expect(named.length).toBeGreaterThan(150);
    const missing = named.filter((n) => !files.some((f) => f === n || f.endsWith(`/${n}`)));
    expect(missing).toEqual([]);
  });
});
