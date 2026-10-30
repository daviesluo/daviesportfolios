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
    expect(dash).toContain('= await Promise.all([\n    quotesRead, lpLiveRead, cbLiveRead, quotesRxuRead, grokPmRead, grokTestsRead, makerWatchRead, quotesTwinsRead, quotesCoinbaseHoldRead,');
    // The venues: only for the rows on the page, asked at once.
    expect(dash).toContain('venueAsks(strategies, filled, dayStartMs)');
    expect(dash).toContain('await Promise.all([...symbolsByVenue].map(async ([vid, syms]) => {');
    // Taken once every read has settled, never inside the answer's object while it still awaits pages (it read short so).
    const taken = dash.indexOf('const serverMs = Date.now() - t0;');
    expect(taken).toBeGreaterThan(dash.indexOf('fxwAudRead]);'));
    expect(dash.slice(taken)).not.toMatch(/: await /);
    expect(dash).toContain('stagesMs: stages,');
  });

  // The second round (Davies, 2026-10-30: "好的接着优化"). pg_stat_statements put two reads of pages nobody draws at the top of
  // every call (the variant's and rule D's days views, ~0.95 s each), PR5's paper test's trips and events beside them, and
  // live-prep's whole book while it is disarmed and off LIVE (its hours view, 0.33 s).
  it('reads no page nobody draws', () => {
    for (const gone of ['agent_quotev_days', 'agent_quoted_days', 'agent_quotev_trips', 'agent_quoted_trips', 'quotesVariantSummary(', 'quotesRuledSummary(',
      '"agent_quote_trips"', '"agent_quote_days"', 'quotesSummary(']) expect(dash, gone).not.toContain(gone);
    expect(dash).toContain('return { live };');
    const lp = src.slice(src.indexOf('export async function readLpLive('), src.indexOf('export async function readGrokPm('));
    const off = lp.indexOf('if (!lpLiveArmed(cfg[0])) return lpLiveOff(cfg[0]);');
    expect(off).toBeGreaterThan(0);
    expect(off).toBeLessThan(lp.indexOf('LP_LIVE_HOURS_VIEW'));
  });

  it('has the indexes its minute and decision reads need (0186)', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0186_dashboard_read_indexes.sql'), 'utf8');
    for (const t of ['cb_hold_minutes', 'cb_usdc_minutes', 'cb_nudge_minutes', 'okx_quote_minutes', 'okx_basis_minutes']) {
      expect(sql).toContain(`on public.${t} (minute);`);
    }
    expect(sql).toContain('on public.agent_decisions (ts desc);');
  });

  it('lets the browser keep its preflight for two hours', () => {
    expect(src).toContain('"Access-Control-Max-Age": "7200",');
  });
});
