// `bin/site-check.mjs`' own rules (Davies, 2026-10-29: every page change checked on the real site as a viewer): only a
// read-only token that has not lapsed is used, and the error never repeats it; screenshots of the real site never land
// inside the repository; the options; and the snapshot's text. The browser run itself is checked by hand against the
// built `dist/` (the ledger records it), since it needs the site or a server.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkToken, insideRepo, parseArgs, slug, snapshotText, TOKEN_ENV, WIDTHS } from '../bin/site-check.mjs';

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
      out: '/tmp/x', tab: 'live', row: 'Stablecoin quotes USDT/GBP', widths: ['phone'], page: 'agents', url: 'https://daviesluo.com', showValues: false, offline: false,
    });
    expect(parseArgs(['/tmp/x', '--url', 'http://127.0.0.1:4173', '--offline'])).toMatchObject({ url: 'http://127.0.0.1:4173', offline: true });
    expect(parseArgs(['/tmp/x'])).toMatchObject({ widths: ['desktop', 'phone'], page: 'agents' });
    expect(parseArgs(['/tmp/x', '--show-values', '--url', 'https://daviesportfolios.pages.dev'])).toMatchObject({ showValues: true, url: 'https://daviesportfolios.pages.dev' });
    for (const bad of [[], ['/tmp/x', '--tab', 'paper'], ['/tmp/x', '--width', 'tablet'], ['/tmp/x', '--row'], ['/tmp/x', '--url', 'http://x'], ['/tmp/x', '--url', 'http://example.com'], ['/tmp/x', '--page', 'board', '--tab', 'live'], ['/tmp/x', '--nope'], ['/tmp/x', '/tmp/y']]) {
      expect(parseArgs(bad)).toHaveProperty('error');
    }
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
      '## problems', 'none seen', '',
    ].join('\n'));
    expect(slug('Stablecoin quotes USDT/GBP')).toBe('stablecoin-quotes-usdt-gbp');
  });
});
