// The chart store against an IndexedDB that behaves like the real one in
// the two ways that decided this bug:
//
//   * an object store can only be created inside `onupgradeneeded`, which
//     fires only when the database is new or its version goes up — opening
//     an existing database without a version never upgrades it;
//   * a transaction on a store the database does not have throws
//     NotFoundError.
//
// The three stores used to come from idb-keyval's `createStore` under one
// shared database name. The first to open it created the database with its
// own store; the other two never existed, every write to them was swallowed
// and every reload read them back empty — so the vs-S&P chart's bars, the
// recorded prices and the moving-average history never survived a reload.
// The other tests run with no IndexedDB at all (memory only), which is why
// none of them could see it. A double looser than this one would not either.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

function fakeIndexedDB() {
  /** @type {Map<string, { version: number, stores: Map<string, Map<any, any>> }>} */
  const dbs = new Map();
  const later = (/** @type {() => void} */ fn) => { setTimeout(fn, 0); };
  const request = () => /** @type {any} */ ({ result: undefined, error: null });
  const fire = (/** @type {any} */ target, /** @type {string} */ type) => {
    const h = target['on' + type];
    if (typeof h === 'function') h.call(target, { target });
  };

  /** @param {Map<any, any>} data @param {string} mode */
  function transaction(data, mode) {
    let pending = 0;
    let done = false;
    const tx = /** @type {any} */ ({ error: null });
    const finish = () => { if (!done) { done = true; fire(tx, 'complete'); } };
    /** @param {() => any} fn */
    const op = (fn) => {
      pending++;
      const req = request();
      later(() => {
        try { req.result = fn(); fire(req, 'success'); } catch (e) { req.error = e; fire(req, 'error'); }
        if (--pending === 0) later(finish);
      });
      return req;
    };
    const writable = () => {
      if (mode !== 'readwrite') throw new DOMException('read-only transaction', 'ReadOnlyError');
    };
    const store = {
      transaction: tx,
      put(/** @type {any} */ value, /** @type {any} */ key) { writable(); const v = structuredClone(value); return op(() => { data.set(key, v); return key; }); },
      delete(/** @type {any} */ key) { writable(); return op(() => { data.delete(key); }); },
      get(/** @type {any} */ key) { return op(() => structuredClone(data.get(key))); },
      getAll() { return op(() => [...data.values()].map((v) => structuredClone(v))); },
      getAllKeys() { return op(() => [...data.keys()]); },
    };
    tx.objectStore = () => store;
    later(() => { if (pending === 0) finish(); });
    return tx;
  }

  const api = {
    open(/** @type {string} */ name, /** @type {number | undefined} */ version) {
      const req = request();
      later(() => {
        const existing = dbs.get(name);
        const rec = existing || { version: 0, stores: new Map() };
        if (!existing) dbs.set(name, rec);
        const target = version ?? (existing ? rec.version : 1);
        if (target < rec.version) { req.error = new DOMException('lower version', 'VersionError'); fire(req, 'error'); return; }
        let upgrading = false;
        const db = /** @type {any} */ ({
          get objectStoreNames() {
            const names = [...rec.stores.keys()];
            return Object.assign(names, { contains: (/** @type {string} */ n) => rec.stores.has(n) });
          },
          createObjectStore(/** @type {string} */ n) {
            if (!upgrading) throw new DOMException('not inside an upgrade', 'InvalidStateError');
            rec.stores.set(n, new Map());
            return {};
          },
          transaction(/** @type {string} */ n, mode = 'readonly') {
            const data = rec.stores.get(n);
            if (!data) throw new DOMException(`No objectStore named ${n} in this database`, 'NotFoundError');
            return transaction(data, mode);
          },
          close() {},
        });
        req.result = db;
        if (target > rec.version) {
          rec.version = target;
          upgrading = true;
          fire(req, 'upgradeneeded');
          upgrading = false;
        }
        fire(req, 'success');
      });
      return req;
    },
    deleteDatabase(/** @type {string} */ name) {
      const req = request();
      later(() => { dbs.delete(name); fire(req, 'success'); });
      return req;
    },
  };
  return { api, dbs };
}

/** @type {ReturnType<typeof fakeIndexedDB>} */
let fake;
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
// A page load: a fresh module (fresh in-memory mirror) over the same disk.
async function pageLoad() {
  vi.resetModules();
  const m = await import('./chart_store.js');
  await m.hydrateAllChartStores();
  return m;
}

beforeEach(() => {
  fake = fakeIndexedDB();
  /** @type {any} */ (globalThis).indexedDB = fake.api;
});
afterEach(() => {
  delete /** @type {any} */ (globalThis).indexedDB;
  vi.resetModules();
});

describe('chart store on a real-shaped IndexedDB', () => {
  it('keeps all three stores across a reload — the vs-S&P bars and the moving averages included', async () => {
    const row = { ts: Date.now(), data: [{ date: '2026-09-17T14:00', close: 5000 }, { date: '2026-09-17T19:55', close: 5200 }] };
    let m = await pageLoad();
    m.ChartStore.set('ACME|1D|reg|afterhours', row);
    m.MaStore.set('ACME|MA|1M', row);
    m.YtdStore.set('y2026|1D:closed|^GSPC', row);
    await settle();

    m = await pageLoad();
    expect(m.ChartStore.get('ACME|1D|reg|afterhours')).toEqual(row);
    expect(m.MaStore.get('ACME|MA|1M')).toEqual(row);
    expect(m.YtdStore.get('y2026|1D:closed|^GSPC')).toEqual(row);
  });

  it('opens one database holding every store, whichever store asks first', async () => {
    await pageLoad();
    const stores = [...(fake.dbs.get('dp-charts')?.stores.keys() || [])].sort();
    expect(stores).toEqual(['maCache', 'tickerChart', 'ytd']);
  });

  it('says when it has loaded, so an empty read before then is not taken for "not cached"', async () => {
    vi.resetModules();
    const m = await import('./chart_store.js');
    expect(m.chartStoresReady()).toBe(false);
    await m.hydrateAllChartStores();
    expect(m.chartStoresReady()).toBe(true);
  });

  it('does not put back an older stored row over one written while it was still loading', async () => {
    const old = { ts: Date.now() - 60_000, data: [{ date: '2026-09-16T19:55', close: 1 }] };
    const fresh = { ts: Date.now(), data: [{ date: '2026-09-17T19:55', close: 2 }] };
    let m = await pageLoad();
    m.YtdStore.set('pxsnap|1D', old);
    await settle();

    // Next load: the fetch answers before the store has finished reading.
    vi.resetModules();
    m = await import('./chart_store.js');
    m.YtdStore.set('pxsnap|1D', fresh);
    await m.hydrateAllChartStores();
    expect(m.YtdStore.get('pxsnap|1D')).toEqual(fresh);
  });
});
