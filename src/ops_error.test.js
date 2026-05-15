// Pin the rate-limiting + capping behavior of reportError so a noisy
// retry loop can't accidentally DDoS the ops-error Edge Function.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  // Browser stubs — ops_error.js reads navigator + window.location and
  // POSTs via fetch. `vi.stubGlobal` works around `navigator` being a
  // non-configurable getter in some node environments.
  vi.stubGlobal('navigator', { userAgent: 'vitest' });
  vi.stubGlobal('window',    { location: { pathname: '/' } });
  vi.stubGlobal('fetch',     vi.fn(() => Promise.resolve(/** @type {any} */ ({ ok: true, status: 202 }))));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Loads a fresh reportError with auth.js's getAppToken stubbed to
// `token`. Each test calls this EXACTLY ONCE so there's a single
// vi.doMock('./auth.js') per test. The old setup registered the mock
// in beforeEach AND again (with a different token) in the no-token
// test body, with a vi.resetModules() in between — registering the
// same module twice within one test raced and intermittently let the
// beforeEach default leak into the override, a ~50% flake under
// full-suite scheduling.
async function loadReportError(token = 'fake.admin.token') {
  vi.doMock('./auth.js', () => ({ getAppToken: () => token }));
  return (await import('./ops_error.js')).reportError;
}

describe('reportError dedup', () => {
  it('coalesces same (kind, symbol) within the cooldown window', async () => {
    const reportError = await loadReportError();
    reportError('fetch.histsingle', { symbol: 'NVDA', message: 'fail #1' });
    reportError('fetch.histsingle', { symbol: 'NVDA', message: 'fail #2' });
    reportError('fetch.histsingle', { symbol: 'NVDA', message: 'fail #3' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('lets a different symbol through immediately', async () => {
    const reportError = await loadReportError();
    reportError('fetch.histsingle', { symbol: 'NVDA' });
    reportError('fetch.histsingle', { symbol: 'GOOG' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('lets the same (kind, symbol) through again after the cooldown elapses', async () => {
    const reportError = await loadReportError();
    reportError('fetch.histsingle', { symbol: 'NVDA' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    // Default cooldown is 60 s; advance past it.
    vi.setSystemTime(Date.now() + 61_000);
    reportError('fetch.histsingle', { symbol: 'NVDA' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('caps total reports per page-load even on a flood of unique keys', async () => {
    const reportError = await loadReportError();
    for (let i = 0; i < 75; i++) {
      reportError('flood', { symbol: `T${i}` });
    }
    // MAX_PER_LOAD is 50.
    expect(globalThis.fetch).toHaveBeenCalledTimes(50);
  });

  it('drops the call when kind is empty', async () => {
    const reportError = await loadReportError();
    reportError('', { symbol: 'NVDA' });
    reportError(undefined, { symbol: 'NVDA' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('drops the call when no admin token is available (pre-auth render crash)', async () => {
    // getAppToken returns null — simulates the window between mount
    // and the user's pwd round-trip completing.
    const reportError = await loadReportError(null);
    reportError('render.crash', { symbol: 'NVDA', message: 'pre-auth crash' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('attaches x-app-token to the POST request', async () => {
    const reportError = await loadReportError();
    reportError('fetch.histsingle', { symbol: 'NVDA' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const fetchMock = /** @type {any} */ (globalThis.fetch);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['x-app-token']).toBe('fake.admin.token');
  });
});
