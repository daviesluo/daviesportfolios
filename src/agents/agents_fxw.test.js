// "FXW-AUD weekend" (0162; supabase/functions/ig/fxw.ts, agents/fxw_view.ts): a row of TESTING after OKX's, in pounds,
// on a card of IG's own, opening its own page.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FXW_ROW_ID, fmtFx, fxwAudRow, fxwTiles, paperTestRows, rowMoney, strategyNameParts, venueLabel, VENUE_HUES, venueRows } from './agents.js';

/** `fxwView`'s answer, cut to what the row and the page read: the agents Deno test's first case (1,000 funded, +30 closed,
 *  an open long marked +14.78, today +29.78, GBP/USD 1.30). */
const fxw = (over = {}) => ({
  name: 'FXW-AUD weekend', started: true, running: true, lagMinutes: 2, lastError: null, startAt: '2026-10-30T21:35:00Z', stakeGbp: 1.5,
  daysRun: 9, trades: 1, weekends: 2, equityGbp: 1044.78,
  capitalGbp: 1000, valueGbp: 493.5, costGbp: 493.5, realisedGbp: 30, unrealisedGbp: 14.78, todayGbp: 29.78, feesGbp: 0,
  capitalUsd: 1300, valueUsd: 641.55, costUsd: 641.55, realisedUsd: 39, unrealisedUsd: 19.21, todayUsd: 38.71, feesUsd: 0,
  open: { friday: '2026-11-06', side: 'long', entryTs: '2026-11-08T21:00:05Z', entryPrice: 0.658, markTs: '2026-11-09T07:55:00Z', markPrice: 0.659, marginGbp: 493.5, netGbp: 14.78 },
  nextText: "exit at Friday's mid, or +24 h", rows: [],
  ...over,
});

describe('FXW-AUD weekend', () => {
  it('is a paper row on IG, in pounds, after the OKX twins, its percents on funded and on the margin', () => {
    const r = fxwAudRow(fxw());
    expect([r?.id, r?.name, r?.venue, r?.venueId, r?.mode, r?.ccy, r?.openPositions, r?.openOrders]).toEqual([FXW_ROW_ID, 'FXW-AUD weekend', 'IG', 'ig', 'paper', 'GBP', 1, 0]);
    const x = rowMoney(r);
    // Realised 30 of 1,000 = 3 %; today 29.78 of 1,000 = 2.978 %; unrealised 14.78 on the 493.50 margin = 2.9949 %.
    expect([x.capital, x.value, x.realised, x.unrealised, x.today]).toEqual([1000, 493.5, 30, 14.78, 29.78]);
    expect(x.realisedPct).toBeCloseTo(3, 9);
    expect(x.todayPct).toBeCloseTo(2.978, 9);
    expect(x.unrealisedPct).toBeCloseTo((14.78 / 493.5) * 100, 9);
    expect(r?.status).toMatchObject({ running: true, tone: 'running' });
    const dash = { strategies: [], quotesTwins: [], quotesOkx: [], fxwAud: fxw() };
    expect(paperTestRows(dash).map((t) => t.id).at(-1)).toBe(FXW_ROW_ID);
    expect(fxwAudRow(null)).toBe(null);
    expect(paperTestRows({ strategies: [] }).some((t) => t.id === FXW_ROW_ID)).toBe(false);
    expect(strategyNameParts('FXW-AUD weekend')).toEqual({ head: 'FXW-AUD weekend', qual: null, twoLines: false });
  });

  it('before its start is funded and idle (grey); a stopped run is amber', () => {
    expect(fxwAudRow(fxw({ started: false, trades: 0, open: null }))?.status).toMatchObject({ running: false, tone: 'paused' });
    expect(fxwAudRow(fxw({ started: false }))?.status.detail).toMatch(/^starts .* UK, the first weekend on IG's live quotes$/);
    expect(fxwAudRow(fxw({ running: false, lagMinutes: 17 }))?.status).toMatchObject({ running: false, tone: 'stale', detail: 'its last run was 17 min ago' });
  });

  it('has a card of its own on TESTING, in dollars at the books\' rate, paper', () => {
    const tests = [fxwAudRow(fxw())];
    const ig = venueRows({ strategies: [] }, 'testing', tests).find((c) => c.id === 'ig');
    expect(ig).toMatchObject({ label: 'IG', paper: true, capitalUsd: 1300, realisedUsd: 39 });
    expect([venueLabel('ig'), VENUE_HUES.ig]).toEqual(['IG', '#d6a2e8']);
  });

  it('shows its status tiles: equity, trades, the open position, the stake (no days run, Davies, 2026-10-29)', () => {
    expect(fxwTiles(fxw()).map((t) => [t.k, t.v])).toEqual([
      ['EQUITY', '£1,045'], ['TRADES', '1'], ['OPEN POSITION', 'long @ 0.65800'], ['STAKE', '£1.50 a pip'],
    ]);
    expect(fxwTiles(fxw({ open: null }))[2]).toMatchObject({ v: 'none', note: null });
    expect([fmtFx(0.66), fmtFx(null)]).toEqual(['0.66000', '—']);
  });
});

describe('FXW-AUD weekend, the name (0166)', () => {
  it("is one string in the run, the page's fallback and the migration that renames the stored row, guarded by the old name", () => {
    const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..');
    const read = (/** @type {string} */ f) => fs.readFileSync(path.join(root, f), 'utf8');
    expect(read('supabase/functions/ig/fxw.ts')).toContain('name: "FXW-AUD weekend",');
    expect(read('supabase/functions/agents/fxw_view.ts')).toContain('String(st.name ?? "FXW-AUD weekend")');
    const sql = read('supabase/migrations/0166_fxw_display_name.sql').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
    expect(sql).toContain("update public.ig_fxw_state set name = 'FXW-AUD weekend' where name = 'AUD weekend (FXW-AUD)';");
  });
});
