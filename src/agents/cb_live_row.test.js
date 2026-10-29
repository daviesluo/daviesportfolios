// "Stablecoin quotes USDC/GBP" on LIVE (`cbLiveRow`; the Coinbase live executor, cb_live.ts, 0177): no row while it is built
// dry-run and unarmed; from its arm or its first live order a row of LIVE, after PR5's, with Davies' name for it, on
// Coinbase, its money in pounds and its dollars at the paper arm's GBP/USD.
import { describe, expect, it } from 'vitest';
import { CB_LIVE_ROW_ID, cbLiveRow, liveExtraRows, QUOTES_LIVE_ROW_ID } from './agents.js';

const base = {
  name: 'Stablecoin quotes USDC/GBP', dryRun: true, armed: false, tradedLive: false, running: true, lagMinutes: 0, capitalGbp: 120, rungGbp: 20, gbpUsd: 1.25,
  realisedGbp: 0.5, unrealisedGbp: -0.1, todayGbp: 0.2, costGbp: 20, feesGbp: 0.01, heldRungs: 1, openOrders: 5, lossStopped: false,
};

describe('the Coinbase live row', () => {
  it('is not on LIVE while dry-run and unarmed', () => {
    expect(cbLiveRow(base)).toBeNull();
    expect(cbLiveRow(null)).toBeNull();
    expect(liveExtraRows({ cbLive: base }).map((r) => r.id)).toEqual([]);
  });

  it('armed, it is a LIVE row on Coinbase in pounds, its dollars at GBP/USD, after PR5 LIVE', () => {
    const r = cbLiveRow({ ...base, dryRun: false, armed: true });
    expect(r).toMatchObject({ id: CB_LIVE_ROW_ID, name: 'Stablecoin quotes USDC/GBP', venueId: 'coinbase', mode: 'live', armed: true, holdsLive: true, ccy: 'GBP',
      openPositions: 1, openOrders: 5, status: { label: 'live', running: true, tone: 'running', detail: 'quoting real money' } });
    expect(r?.capitalUsd).toBeCloseTo(150, 9);
    expect(r?.gbp.capital).toBe(120);
    expect(r?.gbp.realised).toBe(0.5);
    expect(r?.realisedUsd).toBeCloseTo(0.625, 9);
    const live = { live: { tradedLive: true, capitalUsd: 600 } };
    expect(liveExtraRows({ quotes: live, cbLive: { ...base, armed: true } }).map((x) => x.id)).toEqual([QUOTES_LIVE_ROW_ID, CB_LIVE_ROW_ID]);
    // Disarmed after trading live, it stays on LIVE with its exits running; a tripped loss stop says so.
    expect(cbLiveRow({ ...base, tradedLive: true })?.status.detail).toBe('disarmed · its exits still run');
    expect(cbLiveRow({ ...base, armed: true, lossStopped: true })?.status.tone).toBe('stale');
  });
});
