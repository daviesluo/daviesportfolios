// The Agents page's dashboard call, made faster (Davies, 2026-10-30: "agent页和子策略页点刷新加载很慢的问题也解决下"; its p50 was 2.9 s
// and p90 5.7 s in the function over the 24 hours before, by the edge logs). Pins on the source of what was slow: every page's reads
// start before the loop's and are awaited together, never one after another; the browser keeps its preflight; and the answer
// says how long it took to make. `venueAsks` (the venues asked nothing while every loop row is retired and flat) is pinned in
// the agents function's own test.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'supabase/functions/agents/index.ts'), 'utf8');
const dash = src.slice(src.indexOf('async function dashboard(now: number) {'), src.indexOf('\n}\n', src.indexOf('async function dashboard(now: number) {')));

describe('the dashboard call', () => {
  it("starts every page's reads before the loop's own and awaits them together", () => {
    const firstLoopAwait = dash.indexOf('const [strategies, riskRows,');
    for (const read of ['const quotesRead = (async', 'const lpLiveRead = readLpLive(', 'const cbLiveRead = readCbLive(', 'const quotesRxuRead = readQuotesRxu(',
      'const grokPmRead = readGrokPm(', 'const grokTestsRead = Promise.all(', 'const makerWatchRead =', 'const quotesTwinsRead =', 'const quotesXhedgeRead =']) {
      const at = dash.indexOf(read);
      expect(at, read).toBeGreaterThan(0);
      expect(at, read).toBeLessThan(firstLoopAwait);
    }
    // None of them awaited alone any more.
    expect(dash).not.toMatch(/= await (readLpLive|readCbLive|readQuotesRxu|readGrokPm)\(/);
    expect(dash).toContain('await Promise.all([\n    quotesRead, lpLiveRead, cbLiveRead, quotesRxuRead, grokPmRead, grokTestsRead, quotesVariantRead, quotesRuledRead, makerWatchRead]);');
    // The venues: only for the rows on the page, asked at once.
    expect(dash).toContain('venueAsks(strategies, filled, dayStartMs)');
    expect(dash).toContain('await Promise.all([...symbolsByVenue].map(async ([vid, syms]) => {');
    expect(dash).toContain('serverMs: Date.now() - t0,');
  });

  it('lets the browser keep its preflight for two hours', () => {
    expect(src).toContain('"Access-Control-Max-Age": "7200",');
  });
});
