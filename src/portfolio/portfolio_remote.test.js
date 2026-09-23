// Pin tests for portfolioUserFingerprint. The fingerprint is what
// the auto-save debounce uses to decide "did the user actually edit
// something?" — if it ever stops being stable across price refreshes
// or starts mis-detecting an edit as a no-op, we re-introduce the
// multi-tab silent-overwrite bug from the session that added this
// helper. Each `it` corresponds to one failure mode.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  portfolioUserFingerprint,
  loadPortfolioRemote,
  savePortfolioRemote,
  migrate,
  _peekLastKnownVersion,
  _resetLastKnownVersion,
  TAB_ID,
} from './portfolio_remote.js';

// Both ops_error.js and auth.js read browser-only globals at module
// init; mock them at the module level so the version-tracking tests
// below don't have to spin up a fake window.
vi.mock('../app/ops_error.js', () => ({ reportError: vi.fn() }));
vi.mock('../app/auth.js', () => ({ getAppToken: () => 'fake-token' }));

const baseHolding = (over = {}) => ({
  shares: 10,
  cost: 100,
  currency: 'USD',
  lastPrice: 105,
  prevClose: 104,
  dayPct: 0.96,
  extPrice: 105.2,
  extDayPct: 0.19,
  lots: [{ date: '2025-01-01', shares: 10, cost: 100 }],
  ...over,
});

const basePortfolio = (over = {}) => ({
  positions: {
    GK: { role: 'GK', label: 'Cash', subtitle: '', tickers: ['CASH'] },
    ST: { role: 'FWD', label: 'Striker', subtitle: 'Growth', tickers: ['NVDA', 'AAPL'] },
  },
  holdings: {
    CASH: { ...baseHolding({ isCash: true, shares: 0, cost: 0, lots: [] }), currency: 'USD' },
    NVDA: baseHolding({ shares: 5, cost: 100 }),
    AAPL: baseHolding({ shares: 2, cost: 150 }),
  },
  ...over,
});

describe('portfolioUserFingerprint', () => {
  it('returns "" on null / non-object / missing-keys inputs', () => {
    expect(portfolioUserFingerprint(null)).toBe('');
    expect(portfolioUserFingerprint(undefined)).toBe('');
    expect(portfolioUserFingerprint(/** @type {any} */ ('junk'))).toBe('');
    expect(portfolioUserFingerprint(/** @type {any} */ ({}))).toBe('');
    expect(portfolioUserFingerprint(/** @type {any} */ ({ positions: {} }))).toBe('');
  });

  it('produces identical output for two structurally-equal portfolios', () => {
    const a = basePortfolio();
    const b = basePortfolio();
    expect(portfolioUserFingerprint(a)).toBe(portfolioUserFingerprint(b));
  });

  it('IGNORES every field the price-refresh loop mutates (this is the load-bearing case)', () => {
    // The bug this guards against: backgrounded Tab B's 30 s refresh
    // mutates lastPrice / prevClose / extPrice / dayPct / extDayPct
    // and would otherwise look like an "edit" to the debounced save
    // effect — triggering a write that overwrites Tab A's actual
    // edit. None of those fields should appear in the fingerprint.
    const before = basePortfolio();
    const after = basePortfolio();
    after.holdings.NVDA = /** @type {any} */ ({
      ...after.holdings.NVDA,
      lastPrice: 999,
      prevClose: 888,
      extPrice: 777,
      dayPct: -5,
      extDayPct: -2,
      todayRegularClose: 666,
    });
    expect(portfolioUserFingerprint(before)).toBe(portfolioUserFingerprint(after));
  });

  it('CHANGES when the user edits shares', () => {
    const before = basePortfolio();
    const after = basePortfolio();
    after.holdings.NVDA = { ...after.holdings.NVDA, shares: 6 };
    expect(portfolioUserFingerprint(before)).not.toBe(portfolioUserFingerprint(after));
  });

  it('CHANGES when the user edits cost', () => {
    const before = basePortfolio();
    const after = basePortfolio();
    after.holdings.NVDA = { ...after.holdings.NVDA, cost: 101 };
    expect(portfolioUserFingerprint(before)).not.toBe(portfolioUserFingerprint(after));
  });

  it('CHANGES when the user edits a lot', () => {
    const before = basePortfolio();
    const after = basePortfolio();
    after.holdings.NVDA = {
      ...after.holdings.NVDA,
      lots: [{ date: '2025-06-01', shares: 5, cost: 110 }],
    };
    expect(portfolioUserFingerprint(before)).not.toBe(portfolioUserFingerprint(after));
  });

  it('CHANGES when the user adds a new lot', () => {
    const before = basePortfolio();
    const after = basePortfolio();
    after.holdings.NVDA = {
      ...after.holdings.NVDA,
      lots: [
        ...after.holdings.NVDA.lots,
        { date: '2025-06-01', shares: 3, cost: 120 },
      ],
    };
    expect(portfolioUserFingerprint(before)).not.toBe(portfolioUserFingerprint(after));
  });

  it('CHANGES when a ticker is dragged between positions', () => {
    const before = basePortfolio();
    const after = basePortfolio();
    after.positions = {
      ...after.positions,
      GK: { ...after.positions.GK, tickers: [...after.positions.GK.tickers, 'NVDA'] },
      ST: { ...after.positions.ST, tickers: ['AAPL'] },
    };
    expect(portfolioUserFingerprint(before)).not.toBe(portfolioUserFingerprint(after));
  });

  it('CHANGES when a position subtitle is renamed', () => {
    const before = basePortfolio();
    const after = basePortfolio();
    after.positions = {
      ...after.positions,
      ST: { ...after.positions.ST, subtitle: 'Speculative' },
    };
    expect(portfolioUserFingerprint(before)).not.toBe(portfolioUserFingerprint(after));
  });

  it('CHANGES when a holding is added', () => {
    const before = basePortfolio();
    const after = basePortfolio();
    after.holdings = { ...after.holdings, GOOG: baseHolding({ shares: 1, cost: 180 }) };
    expect(portfolioUserFingerprint(before)).not.toBe(portfolioUserFingerprint(after));
  });

  it('CHANGES when a holding is removed', () => {
    const before = basePortfolio();
    const after = basePortfolio();
    const { NVDA: _drop, ...rest } = after.holdings;
    after.holdings = /** @type {any} */ (rest);
    expect(portfolioUserFingerprint(before)).not.toBe(portfolioUserFingerprint(after));
  });

  it('is stable across insertion-order shuffles (sort-keys invariance)', () => {
    const a = basePortfolio();
    const b = { ...a };
    // Reorder positions / holdings object keys — Object.keys preserves
    // insertion order, so a naïve JSON.stringify-based fingerprint would
    // diverge. Sorted-keys serialisation in portfolioUserFingerprint
    // protects against that.
    b.positions = { ST: a.positions.ST, GK: a.positions.GK };
    b.holdings = { AAPL: a.holdings.AAPL, NVDA: a.holdings.NVDA, CASH: a.holdings.CASH };
    expect(portfolioUserFingerprint(a)).toBe(portfolioUserFingerprint(b));
  });

  it('is stable across ticker-array shuffles within a position', () => {
    const a = basePortfolio();
    const b = basePortfolio();
    b.positions.ST = { ...b.positions.ST, tickers: ['AAPL', 'NVDA'] }; // a is ['NVDA','AAPL']
    expect(portfolioUserFingerprint(a)).toBe(portfolioUserFingerprint(b));
  });
});

// Pin tests for the optimistic-concurrency wiring added in PR #N
// (migration 0013 + If-Match header). Two failure modes we want
// blocked: (a) a successful load not caching the server version, so
// the next save can't send If-Match and silently degrades to
// last-write-wins; (b) a 412 response not flipping into the conflict
// branch, so the caller's "ok ? clearDraft : leaveDraft" gate would
// either spam-retry or never alert the user.
describe('optimistic concurrency (load → save → conflict)', () => {
  beforeEach(() => {
    _resetLastKnownVersion();
    vi.restoreAllMocks();
  });

  it('loadPortfolioRemote caches the server version for the next save', async () => {
    const portfolio = { positions: { GK: { role: 'GK', tickers: ['CASH'] } }, holdings: { CASH: { isCash: true, shares: 0, cost: 0 }, NVDA: { shares: 1, cost: 100 } } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: portfolio, version: 7 }),
    }));
    await loadPortfolioRemote();
    expect(_peekLastKnownVersion()).toBe(7);
  });

  it('savePortfolioRemote sends If-Match using the cached version', async () => {
    // Seed the version cache via a fake load.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { holdings: { CASH: {}, X: {} } }, version: 12 }),
    }));
    await loadPortfolioRemote();
    expect(_peekLastKnownVersion()).toBe(12);

    // Now save and inspect the headers fetch was called with.
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, version: 13 }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const result = await savePortfolioRemote({ holdings: { X: { shares: 1, cost: 1 } } });
    expect(result).toEqual({ ok: true, version: 13 });
    expect(_peekLastKnownVersion()).toBe(13);
    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers['If-Match']).toBe('12');
  });

  it('savePortfolioRemote returns { ok: false, conflict: true } on 412 and re-caches the server version', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { holdings: { CASH: {}, X: {} } }, version: 4 }),
    }));
    await loadPortfolioRemote();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 412,
      json: async () => ({ error: 'conflict', currentVersion: 9 }),
    }));
    const result = await savePortfolioRemote({ holdings: { X: { shares: 1, cost: 1 } } });
    expect(result).toEqual({ ok: false, conflict: true });
    // Crucial: the server-supplied currentVersion is now what's
    // cached, so a subsequent retry against the same row goes
    // through cleanly instead of looping on the stale local version.
    expect(_peekLastKnownVersion()).toBe(9);
  });

  it('savePortfolioRemote skips If-Match when no version has been observed yet', async () => {
    // Cold mount, no prior load. We still want the legacy
    // unconditional-write path to work so a fresh tab doesn't
    // require a load round-trip before its first save.
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, version: 1 }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const result = await savePortfolioRemote({ holdings: { X: { shares: 1, cost: 1 } } });
    expect(result.ok).toBe(true);
    const [, init] = fetchSpy.mock.calls[0];
    expect('If-Match' in init.headers).toBe(false);
  });

  it('savePortfolioRemote returns { ok: false } (no conflict) on non-412 failures so the caller can retry / log', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' }),
    }));
    const result = await savePortfolioRemote({ holdings: { X: { shares: 1, cost: 1 } } });
    expect(result).toEqual({ ok: false });
  });
});

describe('save broadcast — self-reload guard (the "edit vanished" data-loss)', () => {
  beforeEach(() => { _resetLastKnownVersion(); vi.restoreAllMocks(); });

  it('TAB_ID is a stable, non-empty string', () => {
    expect(typeof TAB_ID).toBe('string');
    expect(TAB_ID.length).toBeGreaterThan(0);
  });

  it('a successful save broadcasts `portfolio-saved` tagged with this tab’s sender id', async () => {
    // Capture the broadcast deterministically (BroadcastChannel
    // delivery semantics across envs aren’t the thing under test — the
    // message SHAPE is, so the saving tab’s listener can drop its own).
    const posted = [];
    class FakeBC {
      constructor(name) { this.name = name; }
      postMessage(m) { posted.push(m); }
      close() {}
    }
    vi.stubGlobal('BroadcastChannel', FakeBC);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ ok: true, version: 1 }),
    }));
    await savePortfolioRemote({ holdings: { X: { shares: 1, cost: 1 } } });
    expect(posted).toContainEqual(
      expect.objectContaining({ kind: 'portfolio-saved', sender: TAB_ID }),
    );
  });

  it('a FAILED save does not broadcast (nothing to sync)', async () => {
    const posted = [];
    class FakeBC { postMessage(m) { posted.push(m); } close() {} }
    vi.stubGlobal('BroadcastChannel', FakeBC);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 500, json: async () => ({ error: 'boom' }),
    }));
    await savePortfolioRemote({ holdings: { X: { shares: 1, cost: 1 } } });
    expect(posted).toHaveLength(0);
  });
});

describe('migrate — heal sold-out-but-never-closed holdings (float-dust full sales)', () => {
  it('closes a netted-to-dust holding, zeroes it, and strips it from every position', () => {
    const p = migrate({
      holdings: {
        // Sold out via fractional lots: raw float math left ~5.55e-17
        // shares, so the close flow never fired pre-fix. migrate must
        // finish the job: closed, shares 0, off the board.
        ZZZZ: {
          shares: 5.551115123125783e-17, cost: 105, currency: 'USD',
          lots:  [{ date: '2026-01-02', shares: 0.1, cost: 100 }, { date: '2026-02-02', shares: 0.2, cost: 110 }],
          sells: [{ date: '2026-07-10', shares: 0.3, price: 120 }],
        },
        // Open holding with a PARTIAL sale — must stay on the board untouched.
        AAPL: {
          shares: 5, cost: 100, currency: 'USD',
          lots:  [{ date: '2026-01-02', shares: 10, cost: 100 }],
          sells: [{ date: '2026-06-01', shares: 5, price: 120 }],
        },
        // Legacy holding with NO ledger — never touched by the heal.
        NVDA: { shares: 2, cost: 400, currency: 'USD' },
      },
      positions: {
        CM: { label: 'CM', role: 'MID', tickers: ['ZZZZ', 'AAPL'] },
        ST: { label: 'ST', role: 'FWD', tickers: ['NVDA'] },
      },
    });
    expect(p.holdings.ZZZZ.closed).toBe(true);
    expect(p.holdings.ZZZZ.shares).toBe(0);
    for (const pos of Object.values(p.positions)) {
      expect(pos.tickers).not.toContain('ZZZZ');
    }
    // The ledger survives for Transaction History.
    expect(p.holdings.ZZZZ.sells).toHaveLength(1);
    // Partial-sale + legacy holdings stay on the board.
    expect(p.positions.CM.tickers).toContain('AAPL');
    expect(p.holdings.AAPL.shares).toBe(5);
    expect(p.positions.ST.tickers).toContain('NVDA');
    expect(p.holdings.NVDA.shares).toBe(2);
  });
});

// The fingerprint drives the debounced save's "did the user actually
// change anything" check, so anything in the user-edited ledger has to
// be in it. Sells and `closed` weren't — and a CLOSED holding carries
// shares 0 / cost 0, so on those rows EVERY fingerprinted field was
// identical no matter what you did to the sell history. Correcting a
// sale's date or price on a sold-out position looked like a no-op and
// the edit was silently dropped on the next load.
describe('portfolioUserFingerprint — covers the sell ledger', () => {
  const closedBook = (sells) => ({
    positions: { ST: { role: 'FWD', label: '', subtitle: '', tickers: [] } },
    holdings: {
      OLDCO: {
        shares: 0, cost: 0, currency: 'USD', closed: true,
        lots: [{ date: '2025-01-01', shares: 10, cost: 100 }],
        sells,
      },
    },
  });

  it('changes when a closed holding\'s sell DATE is edited', () => {
    const a = portfolioUserFingerprint(closedBook([{ date: '2026-03-01', shares: 10, price: 150 }]));
    const b = portfolioUserFingerprint(closedBook([{ date: '2026-03-02', shares: 10, price: 150 }]));
    expect(a).not.toBe(b);
  });

  it('changes when a sell PRICE is edited, and when a sell is added', () => {
    const base = closedBook([{ date: '2026-03-01', shares: 10, price: 150 }]);
    const repriced = closedBook([{ date: '2026-03-01', shares: 10, price: 155 }]);
    const extra = closedBook([
      { date: '2026-03-01', shares: 10, price: 150 },
      { date: '2026-03-05', shares: 5, price: 160 },
    ]);
    expect(portfolioUserFingerprint(base)).not.toBe(portfolioUserFingerprint(repriced));
    expect(portfolioUserFingerprint(base)).not.toBe(portfolioUserFingerprint(extra));
  });

  it('changes when `closed` flips, and is stable for an identical book', () => {
    const sells = [{ date: '2026-03-01', shares: 10, price: 150 }];
    const open = closedBook(sells);
    open.holdings.OLDCO.closed = false;
    expect(portfolioUserFingerprint(closedBook(sells))).not.toBe(portfolioUserFingerprint(open));
    expect(portfolioUserFingerprint(closedBook(sells))).toBe(portfolioUserFingerprint(closedBook(sells)));
  });
});

// Lots are the YTD chart's source of truth: a lot dated before Jan 1 is
// treated as held-since-last-year and anchored at the Jan-1 close. The
// backfill used to stamp a hardcoded 2025-01-01, so every calendar year
// after 2025 it silently recategorised legacy holdings as prior-year
// positions and skewed both sides of the YTD ratio.
describe('migrate — lots backfill is dated today, not a fixed 2025-01-01', () => {
  it('stamps the current date on a holding with no lots', () => {
    const today = new Date().toISOString().slice(0, 10);
    const out = migrate({
      positions: {}, holdings: { NVDA: { shares: 5, cost: 100, currency: 'USD' } },
    });
    expect(out.holdings.NVDA.lots).toHaveLength(1);
    expect(out.holdings.NVDA.lots[0].date).toBe(today);
    expect(out.holdings.NVDA.lots[0].date).not.toBe('2025-01-01');
  });

  it('leaves an existing lot history untouched', () => {
    const out = migrate({
      positions: {},
      holdings: { NVDA: { shares: 5, cost: 100, currency: 'USD', lots: [{ date: '2024-06-01', shares: 5, cost: 100 }] } },
    });
    expect(out.holdings.NVDA.lots).toEqual([{ date: '2024-06-01', shares: 5, cost: 100 }]);
  });
});

describe('migrate — the sold-out heal must not zero a real position', () => {
  // PLTR, exactly as it sat in the live book: a complete 2024 round trip
  // in the ledger (6.5 bought, 6.5 sold) while 55 shares were held in
  // the account. The heal read the ledger, called it sold out, wrote
  // shares 0 and stripped it off the board — on EVERY load, so typing
  // the shares back in survived until the next reload.
  const pltrLedger = () => ({
    shares: 55, cost: 123.29, lastPrice: 171.54, currency: 'USD',
    lots: [
      { date: '2024-07-24', shares: 1.75, cost: 26.78 },
      { date: '2024-07-24', shares: 0.25, cost: 26.6 },
      { date: '2024-07-30', shares: 2, cost: 26.35 },
      { date: '2024-08-02', shares: 2.5, cost: 24.8 },
    ],
    sells: [{ date: '2024-08-08', shares: 6.5, price: 28.1 }],
  });

  it('leaves a holding the board says it still owns', () => {
    const out = migrate({
      holdings: { PLTR: pltrLedger() },
      positions: { CM: { label: 'CM', role: 'MID', subtitle: 'AI Appli', tickers: ['PLTR'] } },
    });
    expect(out.holdings.PLTR.shares).toBe(55);
    expect(out.holdings.PLTR.closed).toBeUndefined();
    expect(out.positions.CM.tickers).toContain('PLTR');
  });

  it('still heals the float dust it was built for', () => {
    // A full sale of fractional lots that netted to ~5e-17 instead of 0:
    // the board already reads ~empty, so the heal is the right call.
    const out = migrate({
      holdings: {
        DUST: {
          shares: 5e-17, cost: 0, currency: 'USD',
          lots: [{ date: '2025-01-02', shares: 1.1, cost: 10 }],
          sells: [{ date: '2025-06-01', shares: 1.1, price: 12 }],
        },
      },
      positions: { ST: { label: 'ST', role: 'FWD', subtitle: '', tickers: ['DUST'] } },
    });
    expect(out.holdings.DUST.closed).toBe(true);
    expect(out.holdings.DUST.shares).toBe(0);
    expect(out.positions.ST.tickers).not.toContain('DUST');
  });

  it('still heals an outright zero the ledger agrees with', () => {
    const out = migrate({
      holdings: {
        GONE: {
          shares: 0, cost: 0, currency: 'USD',
          lots: [{ date: '2025-01-02', shares: 3, cost: 10 }],
          sells: [{ date: '2025-06-01', shares: 3, price: 12 }],
        },
      },
      positions: { ST: { label: 'ST', role: 'FWD', subtitle: '', tickers: ['GONE'] } },
    });
    expect(out.holdings.GONE.closed).toBe(true);
    expect(out.positions.ST.tickers).not.toContain('GONE');
  });
});
