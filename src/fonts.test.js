// @vitest-environment node
// The page's first paint waits on nothing third-party, and no source map is published (review M7, 2026-10-08). The
// fonts came from Google Fonts through a stylesheet in <head> that held the first paint until a third party answered;
// they are the site's own files now, Google's rules word for word but for the URL. Source maps were never published:
// `*.js.map` is ignored, the deploy uploads the committed dist/, and the live site answers a map with its 404 page.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SRC, '..');
const read = (/** @type {string} */ f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('the fonts are the site\'s own', () => {
  it('index.html asks no third party for a stylesheet, and preloads the two Latin files', () => {
    const html = read('src/index.html');
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
    const preloads = [...html.matchAll(/<link rel="preload" href="([^"]+)" as="font" type="font\/woff2" crossorigin>/g)].map((m) => m[1]);
    expect(preloads).toEqual(['/app/fonts/inter-latin.woff2', '/app/fonts/jetbrains-mono-latin.woff2']);
    for (const p of preloads) expect(fs.existsSync(path.join(SRC, p))).toBe(true);
  });

  it('fonts.css is Google\'s 52 rules for the two families, each file on disk, every face swapping', () => {
    const css = read('src/app/fonts.css');
    const faces = css.match(/@font-face \{[^}]*\}/g) ?? [];
    expect(faces).toHaveLength(52);
    expect(new Set(faces.map((f) => /font-family: '([^']+)'/.exec(f)?.[1]))).toEqual(new Set(['Inter', 'JetBrains Mono']));
    expect(faces.every((f) => /font-display: swap;/.test(f) && /unicode-range: /.test(f))).toBe(true);
    const files = [...new Set([...css.matchAll(/url\('\.\/(fonts\/[a-z-]+\.woff2)'\)/g)].map((m) => m[1]))];
    expect(files).toHaveLength(13);
    for (const f of files) expect(fs.existsSync(path.join(SRC, 'app', f))).toBe(true);
    expect(read('src/app/main.jsx')).toMatch(/import '\.\/fonts\.css';\nimport '\.\/styles\.css';/);
  });

  it('the CSP allows fonts from this site alone, and the committed page carries no Google link', () => {
    const csp = /Content-Security-Policy: (.*)/.exec(read('src/public/_headers'))?.[1] ?? '';
    expect(csp).toMatch(/font-src 'self' data:;/);
    expect(csp).not.toMatch(/googleapis|gstatic/);
    expect(read('dist/index.html')).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
  });
});

describe('no source map is published', () => {
  it('none is committed, so none is in the dist/ the deploy uploads', () => {
    const committed = execFileSync('git', ['ls-files', 'dist'], { cwd: ROOT, encoding: 'utf8' }).split('\n');
    expect(committed.length).toBeGreaterThan(10);
    expect(committed.filter((f) => f.endsWith('.map'))).toEqual([]);
    expect(read('.gitignore')).toMatch(/^\*\.js\.map$/m);
  });
});
