// Which Chromium the two browser checks launch (review T2, 2026-10-08). Asked for a headless Chromium with no channel,
// Playwright 1.63 launches its headless shell, the old headless Chrome kept as a build of its own, which lays text out
// a few pixels differently from the Chrome the site's visitors run: with the site's own Inter four layout checks failed
// in the shell (141 and 153) and passed in full Chrome (141 and 153). `channel: 'chromium'` is Playwright's documented
// switch to its full Chromium in the new headless mode ("Use "chromium" to opt in to new headless mode"), the build
// `playwright install --no-shell chromium` downloads (check.yml). A container that ships its own Chromium names it with
// PLAYWRIGHT_CHROMIUM_PATH, which wins. `e2e_browser.test.js` pins all three.

/**
 * The options `chromium.launch` takes in the sweep and the perf matrix.
 * @param {Record<string, string | undefined>} [env]
 */
export function launchOptions(env = process.env) {
  const executablePath = env.PLAYWRIGHT_CHROMIUM_PATH;
  return {
    ...(executablePath ? { executablePath } : { channel: 'chromium' }),
    args: ['--no-sandbox'],
  };
}
