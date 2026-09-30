// The board's saves (portfolio_saver.js): a change is saved only when the server says so, a failed save is said and
// tried again with a bounded backoff, a conflict is never retried, and one request is in flight at a time.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPortfolioSaver, SAVE_RETRY_DELAYS_MS } from './portfolio_saver.js';

/** A server whose answers the test hands out one at a time, and which records the boards it was sent. */
function server() {
  /** @type {{ portfolio: any, resolve: (r: any) => void }[]} */
  const calls = [];
  let open = 0, maxOpen = 0;
  const save = (/** @type {any} */ portfolio) => new Promise((resolve) => {
    open += 1; maxOpen = Math.max(maxOpen, open);
    calls.push({ portfolio, resolve: (r) => { open -= 1; resolve(r); } });
  });
  return { calls, save, maxOpen: () => maxOpen };
}

function world() {
  const s = server();
  /** @type {string | null} */
  let confirmed = 'fp0';
  const failing = /** @type {any[]} */ ([]);
  const conflicts = /** @type {string[]} */ ([]);
  const saver = createPortfolioSaver({
    save: s.save,
    onSaved: (fp) => { confirmed = fp; },
    onConflict: (fp) => { confirmed = fp; conflicts.push(fp); },
    onFailing: (f) => failing.push(f),
  });
  return { s, saver, failing, conflicts, confirmed: () => confirmed };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('createPortfolioSaver', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('marks a change saved only when the server says so', async () => {
    const w = world();
    w.saver.request('fp1', { n: 1 });
    await flush();
    expect(w.s.calls).toHaveLength(1);
    expect(w.confirmed()).toBe('fp0');                       // the old code marked fp1 saved here
    expect(w.saver.target(w.confirmed())).toBe('fp1');       // and the effect sends nothing more meanwhile
    w.s.calls[0].resolve({ ok: true, version: 2 });
    await flush();
    expect(w.confirmed()).toBe('fp1');
    expect(w.saver.target(w.confirmed())).toBe('fp1');
    expect(w.failing.at(-1)).toBe(null);
  });

  it('says a failed save and tries it again after the backoff, until it is saved', async () => {
    const w = world();
    w.saver.request('fp1', { n: 1 });
    await flush();
    w.s.calls[0].resolve({ ok: false });
    await flush();
    expect(w.failing.at(-1)).toEqual({ attempt: 1, retryInMs: SAVE_RETRY_DELAYS_MS[0] });
    expect(w.confirmed()).toBe('fp0');
    expect(w.saver.target(w.confirmed())).toBe('fp1');       // still heading for fp1: the effect does not re-send it
    await vi.advanceTimersByTimeAsync(SAVE_RETRY_DELAYS_MS[0] - 1);
    expect(w.s.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(w.s.calls).toHaveLength(2);
    expect(w.s.calls[1].portfolio).toEqual({ n: 1 });
    w.s.calls[1].resolve({ ok: true });
    await flush();
    expect(w.confirmed()).toBe('fp1');
    expect(w.failing.at(-1)).toBe(null);
  });

  it('stops after the last wait, and a retry by hand sends it again', async () => {
    const w = world();
    w.saver.request('fp1', { n: 1 });
    await flush();
    for (let i = 0; i <= SAVE_RETRY_DELAYS_MS.length; i++) {
      w.s.calls[i].resolve({ ok: false });
      await flush();
      if (i < SAVE_RETRY_DELAYS_MS.length) await vi.advanceTimersByTimeAsync(SAVE_RETRY_DELAYS_MS[i]);
    }
    expect(w.s.calls).toHaveLength(SAVE_RETRY_DELAYS_MS.length + 1);
    expect(w.failing.at(-1)).toEqual({ attempt: SAVE_RETRY_DELAYS_MS.length + 1, retryInMs: null });
    await vi.advanceTimersByTimeAsync(24 * 3600e3);
    expect(w.s.calls).toHaveLength(SAVE_RETRY_DELAYS_MS.length + 1);
    w.saver.retryNow();
    await flush();
    expect(w.s.calls).toHaveLength(SAVE_RETRY_DELAYS_MS.length + 2);
    w.s.calls.at(-1)?.resolve({ ok: true });
    await flush();
    expect(w.confirmed()).toBe('fp1');
  });

  it('never tries a conflict again: the server\'s newer copy is the user\'s to choose', async () => {
    const w = world();
    w.saver.request('fp1', { n: 1 });
    await flush();
    w.s.calls[0].resolve({ ok: false, conflict: true });
    await flush();
    expect(w.conflicts).toEqual(['fp1']);
    expect(w.failing.at(-1)).toBe(null);
    await vi.advanceTimersByTimeAsync(3600e3);
    expect(w.s.calls).toHaveLength(1);
    expect(w.saver.target(w.confirmed())).toBe('fp1');
  });

  it('a newer edit takes over from a waiting retry, which never fires', async () => {
    const w = world();
    w.saver.request('fp1', { n: 1 });
    await flush();
    w.s.calls[0].resolve({ ok: false });
    await flush();
    w.saver.request('fp2', { n: 2 });
    await flush();
    expect(w.failing.at(-1)).toBe(null);
    expect(w.s.calls[1].portfolio).toEqual({ n: 2 });
    w.s.calls[1].resolve({ ok: true });
    await flush();
    await vi.advanceTimersByTimeAsync(3600e3);
    expect(w.s.calls).toHaveLength(2);
    expect(w.confirmed()).toBe('fp2');
  });

  it('sends one request at a time, and an edit undone while its save is in flight is sent afterwards', async () => {
    const w = world();
    w.saver.request('fp1', { n: 1 });
    await flush();
    w.saver.request('fp0', { n: 0 });                        // undone: back to what the server had
    await flush();
    expect(w.s.calls).toHaveLength(1);
    expect(w.saver.target(w.confirmed())).toBe('fp0');
    w.s.calls[0].resolve({ ok: true });                       // the server now holds fp1 …
    await flush();
    expect(w.s.calls).toHaveLength(2);                        // … so fp0 goes out after it
    expect(w.s.calls[1].portfolio).toEqual({ n: 0 });
    w.s.calls[1].resolve({ ok: true });
    await flush();
    expect(w.confirmed()).toBe('fp0');
    expect(w.s.maxOpen()).toBe(1);
  });

  it('a failed save with a newer board queued sends the newer board at once', async () => {
    const w = world();
    w.saver.request('fp1', { n: 1 });
    await flush();
    w.saver.request('fp2', { n: 2 });
    w.s.calls[0].resolve({ ok: false });
    await flush();
    expect(w.s.calls).toHaveLength(2);
    expect(w.s.calls[1].portfolio).toEqual({ n: 2 });
    expect(w.failing.every((f) => f === null)).toBe(true);
  });

  it('after a reset nothing sent before counts, and no retry fires', async () => {
    const w = world();
    w.saver.request('fp1', { n: 1 });
    await flush();
    w.saver.reset();
    w.s.calls[0].resolve({ ok: true });
    await flush();
    expect(w.confirmed()).toBe('fp0');
    w.saver.request('fp2', { n: 2 });
    await flush();
    w.s.calls[1].resolve({ ok: false });
    await flush();
    w.saver.reset();
    await vi.advanceTimersByTimeAsync(3600e3);
    expect(w.s.calls).toHaveLength(2);
    expect(w.failing.at(-1)).toBe(null);
  });
});
