// Vitest setup. Imported once via vite.config.js `test.setupFiles`.
// Brings in jest-dom's custom matchers (toBeInTheDocument,
// toHaveTextContent, etc.) so component tests can assert on the
// rendered DOM with the standard RTL idioms instead of hand-rolling
// `expect(el.textContent).toMatch(...)`.
import '@testing-library/jest-dom/vitest';

// RTL unmounts what a test rendered only when vitest's globals are on, and they are off, so
// every component and hook a test mounted stayed mounted for the rest of its file: a hook's
// poll from one test counted in the next (charts/use_ticker_chart_data.test.jsx pins it).
import { afterAll, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
afterEach(() => { cleanup(); });

// No test reaches the network (review T1, 2026-10-08). Four performance-chart test files left the recorded snapshots
// and the overnight points unmocked, and every run sent 25 GETs to production's Edge Functions with the anon key: about
// 560 a day from the gates here and on CI. A fetch to anything but this machine now rejects, as a network failure does,
// and the test that made it fails when it ends, naming the URL; one made after its file's last test fails the file. A
// test that wants an answer mocks the module or stubs `fetch` (`vi.stubGlobal`), and the guard is back when it unstubs.
// `network_guard.test.js` pins all of it.
const realFetch = globalThis.fetch;
/** @type {string[]} */
let leaked = [];
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i;
/** @param {any} input */
const urlOf = (input) => String(input && typeof input === 'object' && 'url' in input ? input.url : input);
globalThis.fetch = /** @type {typeof fetch} */ (async (input, init) => {
  const url = urlOf(input);
  if (/^https?:\/\//i.test(url) && !LOCAL.test(url)) {
    leaked.push(url);
    throw new TypeError(`test_setup.js: no test reaches the network (${url}); mock the module that fetched it`);
  }
  return realFetch(input, init);
});
/** The refused URLs since the last check, cleared: what `afterEach` fails a test on, and what a test may read itself. */
function takeLeakedFetches() {
  const urls = [...new Set(leaked)];
  leaked = [];
  return urls;
}
/** @type {any} */ (globalThis).__takeLeakedFetches = takeLeakedFetches;
const reportLeaks = () => {
  const urls = takeLeakedFetches();
  if (urls.length) throw new Error(`a test tried to reach the network (refused): ${urls.join(', ')}`);
};
afterEach(reportLeaks);
afterAll(reportLeaks);
