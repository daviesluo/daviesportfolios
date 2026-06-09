// Pin tests for detectCurrency. Especially the TICKER_CURRENCY_OVERRIDES
// branch — if the override map regresses, USD-denominated UCITS ETFs
// on LSE (VUAA.L / SAEM.L, the two the T212 sync currently mirrors)
// get classified as GBP and the FX path mis-converts them by ~1.27×
// (the GBPUSD rate), inflating cost basis + market value by the same
// factor. The suffix-fallback cases are pinned for completeness so
// a future "simplify the regex" refactor doesn't quietly drop CN /
// HK detection.

import { describe, it, expect } from 'vitest';
import { detectCurrency, fxRateToUSD, currencySymbol } from './fx.js';

describe('detectCurrency', () => {
  it('per-ticker overrides win over suffix rules — USD-denominated LSE ETFs', () => {
    // These would default to GBP under the .L suffix rule. The
    // override exists because T212 reports their averagePrice in USD
    // (they're USD-denominated UCITS) and Yahoo's quote feed prices
    // them in USD too — so the holding currency MUST agree with what
    // both upstreams report, otherwise the FX path applies GBPUSD on
    // top of an already-USD number.
    expect(detectCurrency('VUAA.L')).toBe('USD');
    expect(detectCurrency('SAEM.L')).toBe('USD');
  });

  it('falls back to the suffix rules for non-overridden tickers', () => {
    // GBP-denominated LSE listings (the historical T212 allow-list +
    // anything else the user adds manually) still hit the .L → GBP
    // path.
    expect(detectCurrency('VUAG.L')).toBe('GBP');
    expect(detectCurrency('SEGM.L')).toBe('GBP');
    expect(detectCurrency('TSCO.L')).toBe('GBP');
  });

  it('6-digit numeric → CNY (Chinese mutual fund codes)', () => {
    expect(detectCurrency('017731')).toBe('CNY');
    expect(detectCurrency('512880')).toBe('CNY');
  });

  it('.HK suffix → HKD', () => {
    expect(detectCurrency('0700.HK')).toBe('HKD');
  });

  it('euro-zone exchange suffixes → EUR', () => {
    // Euronext Paris (XFAB.PA is the one the user actually holds),
    // Amsterdam, Brussels, Lisbon, Dublin, plus XETRA / Frankfurt /
    // Milan / Madrid / Vienna / Helsinki / Athens. If this regresses,
    // a euro holding's price + cost get read as USD (no FX conversion),
    // overstating market value by ~1.08× (the EURUSD rate).
    expect(detectCurrency('XFAB.PA')).toBe('EUR');
    expect(detectCurrency('ASML.AS')).toBe('EUR');
    expect(detectCurrency('SAP.DE')).toBe('EUR');
    expect(detectCurrency('2DG.SG')).toBe('EUR'); // Stuttgart (German regional)
    expect(detectCurrency('ENEL.MI')).toBe('EUR');
    expect(detectCurrency('SAN.MC')).toBe('EUR');
  });

  it('non-euro European venues stay USD (no FX pair wired up)', () => {
    // Deliberately excluded from the EUR regex — these settle in their
    // own non-euro currencies and we don't fetch their FX pairs, so
    // classifying them EUR would mis-convert. They fall through to USD
    // until a dedicated currency + pair is added.
    expect(detectCurrency('VOLV-B.ST')).toBe('USD'); // Stockholm / SEK
    expect(detectCurrency('EQNR.OL')).toBe('USD');   // Oslo / NOK
    expect(detectCurrency('NOVO-B.CO')).toBe('USD');  // Copenhagen / DKK
    expect(detectCurrency('NESN.SW')).toBe('USD');    // Switzerland / CHF
  });

  it('default → USD (US equities, crypto, indices, FX pairs)', () => {
    expect(detectCurrency('NVDA')).toBe('USD');
    expect(detectCurrency('BTC-USD')).toBe('USD');
    expect(detectCurrency('^GSPC')).toBe('USD');
    expect(detectCurrency('GBPUSD=X')).toBe('USD');
  });
});

describe('fxRateToUSD — EUR', () => {
  it('reads EURUSD=X directly (quoted EUR→USD, like GBP)', () => {
    const md = { 'EURUSD=X': { lastPrice: 1.08 } };
    expect(fxRateToUSD('EUR', md)).toEqual({ rate: 1.08, missing: false });
  });

  it('flags missing when the EUR pair has not landed yet', () => {
    expect(fxRateToUSD('EUR', {})).toEqual({ rate: 1, missing: true });
    expect(fxRateToUSD('EUR', { 'EURUSD=X': { lastPrice: 0 } })).toEqual({ rate: 1, missing: true });
  });

  it('€ symbol resolves for the price + avg-cost display', () => {
    expect(currencySymbol('EUR')).toBe('€');
  });
});
