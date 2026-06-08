// Pin test for the heatmap tile's display-label helper. The label drops
// the Yahoo exchange suffix so tight tiles aren't cluttered by ".PA" /
// ".L"; the FULL symbol still rides on tile.ticker for clicks + the
// chart-open title, so this strip must never touch anything that would
// change which instrument the click resolves.

import { describe, it, expect } from 'vitest';
import { displayTicker } from './heatmap.jsx';

describe('displayTicker', () => {
  it('strips the exchange suffix from foreign-listed tickers', () => {
    expect(displayTicker('XFAB.PA')).toBe('XFAB'); // Euronext Paris
    expect(displayTicker('VUAG.L')).toBe('VUAG');   // London
    expect(displayTicker('0700.HK')).toBe('0700');  // Hong Kong
    expect(displayTicker('ASML.AS')).toBe('ASML');  // Amsterdam
    expect(displayTicker('SAP.DE')).toBe('SAP');    // XETRA
  });

  it('leaves US equities, indices and bare fund codes untouched', () => {
    expect(displayTicker('NVDA')).toBe('NVDA');
    expect(displayTicker('^GSPC')).toBe('^GSPC');
    expect(displayTicker('017731')).toBe('017731'); // CN fund code
  });

  it('does not strip hyphenated symbols (no exchange dot)', () => {
    // The dot-suffix shape is what we strip — BRK-B / BTC-USD use a
    // hyphen, so the part after it is NOT an exchange and must stay.
    expect(displayTicker('BRK-B')).toBe('BRK-B');
    expect(displayTicker('BTC-USD')).toBe('BTC-USD');
  });
});
