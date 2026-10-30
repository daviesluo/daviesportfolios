// `bin/site-check.mjs`' own rules (Davies, 2026-10-29: every page change checked on the real site as a viewer): only a
// read-only token that has not lapsed is used, and the error never repeats it; screenshots of the real site never land
// inside the repository; the options; and the snapshot's text. The browser run itself is checked by hand against the
// built `dist/` (the ledger records it), since it needs the site or a server.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkToken, expectedReason, insideRepo, parseArgs, pickRow, slug, snapshotText, TOKEN_ENV, WIDTHS } from '../bin/site-check.mjs';

const tok = (/** @type {object} */ claims) => `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.c2lnbmF0dXJl`;
const NOW = Date.UTC(2026, 9, 29, 23, 30);

describe('site-check', () => {
  it('uses only a read-only token that has not lapsed, and never repeats it', () => {
    expect(checkToken(tok({ role: 'ro', exp: NOW + 29 * 60_000 + 5_000 }), NOW)).toEqual({ role: 'ro', minutesLeft: 29 });
    const admin = tok({ role: 'admin', exp: NOW + 60_000 });
    const lapsed = tok({ role: 'ro', exp: NOW - 1 });
    for (const [t, want] of [[undefined, TOKEN_ENV], ['', TOKEN_ENV], ['nodot', 'form'], ['a b.c', 'form'], [admin, 'read-only'], [lapsed, 'lapsed'], ['e30.c2ln', 'read-only']]) {
      const r = checkToken(/** @type {string | undefined} */ (t), NOW);
      expect('error' in r && r.error).toContain(want);
      if (t) expect(JSON.stringify(r)).not.toContain(t);
    }
  });

  it('refuses an output folder inside the repository', () => {
    const repo = path.resolve('/r/daviesportfolios');
    expect(insideRepo('/r/daviesportfolios', repo)).toBe(true);
    expect(insideRepo('/r/daviesportfolios/dist/shots', repo)).toBe(true);
    expect(insideRepo('/tmp/scratch/site', repo)).toBe(false);
    expect(insideRepo('/r/daviesportfolios-shots', repo)).toBe(false);
  });

  it('reads its options', () => {
    expect(parseArgs(['/tmp/x', '--tab', 'live', '--row', 'Stablecoin quotes USDT/GBP', '--width', 'phone'])).toEqual({
      out: '/tmp/x', tab: 'live', row: 'Stablecoin quotes USDT/GBP', venue: null, widths: ['phone'], page: 'agents', url: 'https://daviesluo.com', showValues: false, offline: false,
    });
    expect(parseArgs(['/tmp/x', '--url', 'http://127.0.0.1:4173', '--offline'])).toMatchObject({ url: 'http://127.0.0.1:4173', offline: true });
    expect(parseArgs(['/tmp/x'])).toMatchObject({ widths: ['desktop', 'phone'], page: 'agents' });
    expect(parseArgs(['/tmp/x', '--show-values', '--url', 'https://daviesportfolios.pages.dev'])).toMatchObject({ showValues: true, url: 'https://daviesportfolios.pages.dev' });
    for (const bad of [[], ['/tmp/x', '--tab', 'paper'], ['/tmp/x', '--width', 'tablet'], ['/tmp/x', '--row'], ['/tmp/x', '--url', 'http://x'], ['/tmp/x', '--url', 'http://example.com'], ['/tmp/x', '--page', 'board', '--tab', 'live'], ['/tmp/x', '--nope'], ['/tmp/x', '/tmp/y']]) {
      expect(parseArgs(bad)).toHaveProperty('error');
    }
    expect(parseArgs(['/tmp/x', '--row', 'R', '--venue', 'coinbase'])).toMatchObject({ row: 'R', venue: 'coinbase' });
    for (const bad of [['/tmp/x', '--venue', 'coinbase'], ['/tmp/x', '--row', 'R', '--venue', 'Coin base']]) expect(parseArgs(bad)).toHaveProperty('error');
    expect(WIDTHS).toEqual({ desktop: { width: 1400, height: 1000 }, phone: { width: 390, height: 844 } });
  });

  it('writes a readable snapshot: a table row per line, its cells joined, the problems after', () => {
    const s = snapshotText({
      url: 'https://daviesluo.com', width: 'phone', size: WIDTHS.phone, hidden: true, at: '2026-10-29T23:30:00.000Z',
      trail: ['https://daviesluo.com', 'Agents', 'LIVE', 'Stablecoin quotes USDT/GBP'],
      text: 'INVENTORY\n\n\n\nGBP\t£•••.••\nTIME\tSIDE\tPRICE\n23:01\tSELL\t•.••••\n', problems: [],
    });
    expect(s).toBe([
      '# site-check https://daviesluo.com · phone 390×844 · values hidden · read 2026-10-29T23:30:00.000Z',
      '## https://daviesluo.com › Agents › LIVE › Stablecoin quotes USDT/GBP',
      'INVENTORY\n\nGBP | £•••.••\nTIME | SIDE | PRICE\n23:01 | SELL | •.••••',
      '## problems', 'none seen', "## expected (a viewer's page, and the board's fallbacks)", 'none seen', '',
    ].join('\n'));
    expect(slug('Stablecoin quotes USDT/GBP')).toBe('stablecoin-quotes-usdt-gbp');
  });

  // Lines from the first real run (2026-10-30 00:15 UTC), shortened: the viewer's expected noise, and the one real
  // problem among it, the Agents call whose preflight was refused.
  const AGENTS = "console: Access to fetch at 'https://flmvxigozjuizpckllvk.supabase.co/functions/v1/agents?action=dashboard&forceFunctionRegion=eu-west-2' from origin 'https://daviesluo.com' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: It does not have HTTP ok status.";
  const NOISE = [
    "console: Refused to load the script 'https://static.cloudflareinsights.com/beacon.min.js/v1' because it violates the following Content Security Policy directive",
    "console: Access to fetch at 'https://cors.eu.org/https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=5m' from origin 'https://daviesluo.com' has been blocked by CORS policy",
    "console: Access to fetch at 'https://api.cors.lol/?url=https%3A%2F%2Fdanjuanapp.com%2Fdjapi%2Ffund' from origin 'https://daviesluo.com' has been blocked by CORS policy",
    'GET api.cors.lol/ answered 403',
    'GET flmvxigozjuizpckllvk.supabase.co/functions/v1/ops-error?action=summary answered 401',
    'GET flmvxigozjuizpckllvk.supabase.co/functions/v1/chart failed: net::ERR_ABORTED',
    'console: Failed to load resource: the server responded with a status of 401 (Unauthorized)',
  ];

  it('sorts the expected lines of a viewer\'s page from the real problems', () => {
    for (const l of NOISE) expect(expectedReason(l), l).not.toBeNull();
    for (const l of [AGENTS, 'GET flmvxigozjuizpckllvk.supabase.co/functions/v1/agents?action=dashboard failed: net::ERR_FAILED',
      'GET flmvxigozjuizpckllvk.supabase.co/functions/v1/data answered 401', 'GET flmvxigozjuizpckllvk.supabase.co/functions/v1/agents?action=dashboard answered 503',
      'page error: x is undefined', 'the Agents page showed its error card: "Could not reach the server"']) {
      expect(expectedReason(l), l).toBeNull();
    }
    const s = snapshotText({ url: 'https://daviesluo.com', width: 'desktop', size: WIDTHS.desktop, hidden: true, at: 'T', trail: ['u', 'Agents'], text: 'x',
      problems: [...NOISE, NOISE[6], AGENTS], failed: '"load the Agents page": the Agents page showed its error card three times' });
    const [head, rest] = s.split('## problems\n');
    expect(head).toContain('## FAILED at "load the Agents page"');
    const [real, expected] = rest.split("## expected (a viewer's page, and the board's fallbacks)\n");
    expect(real.trim()).toBe(AGENTS);
    expect(expected).toContain("### the browser's own line for a load that failed, which names no address (the calls are listed by address) (2)");
    expect(expected).toContain('console: Failed to load resource: the server responded with a status of 401 (Unauthorized) (×2)');
    expect(expected).toContain("### the board's CORS-proxy fallbacks (Yahoo, the CN funds): one refuses, the next is tried (3)");
  });

  it("picks a row by its name, and by its venue when two share one (Revolut X's and Coinbase's USDC/GBP LIVE twin, 2026-10-30)", () => {
    const N = 'Stablecoin quotes USDC/GBP LIVE twin';
    const rows = [{ name: 'Stablecoin quotes USDT/GBP LIVE twin', venue: 'revx' }, { name: N, venue: 'revx' }, { name: 'Stablecoin quotes variant-1', venue: 'revx' }, { name: N, venue: 'coinbase' }];
    expect(pickRow(rows, 'Stablecoin quotes variant-1', null)).toEqual({ index: 2 });
    expect(pickRow(rows, N, 'coinbase')).toEqual({ index: 3 });
    expect(pickRow(rows, N, 'revx')).toEqual({ index: 1 });
    expect(pickRow(rows, N, null)).toEqual({ error: `2 rows are named "${N}" (on revx, coinbase): pass --venue` });
    expect(pickRow(rows, N, 'okx')).toEqual({ error: `no row "${N}" on okx; it is on revx, coinbase` });
    expect(pickRow(rows, 'nope', null)).toHaveProperty('error');
  });
});
