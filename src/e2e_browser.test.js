// @vitest-environment node
// The browser checks run in Playwright's full Chromium, never its headless shell (review T2, 2026-10-08): the shell lays
// text out a few pixels differently from the Chrome the site's visitors run, and four layout checks failed in it with
// the site's own Inter that pass in full Chrome (e2e/browser.mjs). Both checks launch with one set of options, and CI
// installs the build those options ask for and not the shell, which nothing launches.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchOptions } from './e2e/browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (/** @type {string} */ rel) => fs.readFileSync(path.join(HERE, rel), 'utf8');

describe('the browser checks launch the full Chromium', () => {
  it("asks Playwright for its full Chromium when no browser is named (channel 'chromium', the new headless mode)", () => {
    expect(launchOptions({})).toEqual({ channel: 'chromium', args: ['--no-sandbox'] });
  });

  it('launches the browser PLAYWRIGHT_CHROMIUM_PATH names, with no channel', () => {
    expect(launchOptions({ PLAYWRIGHT_CHROMIUM_PATH: '/opt/chrome/chrome' }))
      .toEqual({ executablePath: '/opt/chrome/chrome', args: ['--no-sandbox'] });
  });

  it.each(['e2e/app-sweep.mjs', 'e2e/perf-matrix.mjs'])('%s launches with those options and in no other way', (file) => {
    const text = read(file);
    const calls = [...text.matchAll(/\bchromium\.\w+\(/g)].map((m) => text.slice(m.index, m.index + 'chromium.launch(launchOptions())'.length));
    expect(calls).toEqual(['chromium.launch(launchOptions())']);
    expect(text).toMatch(/^import \{ launchOptions \} from '\.\/browser\.mjs';$/m);
  });

  it('CI installs the full Chromium for both jobs, and not the headless shell', () => {
    const installs = read('../.github/workflows/check.yml').match(/playwright install[^\n]*/g) || [];
    expect(installs).toEqual(['playwright install --no-shell chromium', 'playwright install --no-shell chromium']);
  });
});
