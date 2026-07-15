import { describe, it, expect } from 'vitest';
import {
  isCrypto, isFutures, isForex, isIndex, isExchangeListed,
  isCnFund, isPvt, isDailyOnly, isUsEquity, hasOvernightSession,
  isEuroExchange, isRegularSessionOnly, venueSessionFor,
} from './ticker_class.js';

describe('ticker_class', () => {
  it('crypto by `-USD` suffix', () => {
    expect(isCrypto('BTC-USD')).toBe(true);
    expect(isCrypto('ETH-USD')).toBe(true);
    expect(isCrypto('btc-usd')).toBe(true);  // case-insensitive
    expect(isCrypto('NVDA')).toBe(false);
    expect(isCrypto('GBPUSD=X')).toBe(false);
  });

  it('futures by `=F` suffix', () => {
    expect(isFutures('ES=F')).toBe(true);
    expect(isFutures('NQ=F')).toBe(true);
    expect(isFutures('BZ=F')).toBe(true);
    expect(isFutures('NVDA')).toBe(false);
  });

  it('forex by `=X` suffix', () => {
    expect(isForex('GBPUSD=X')).toBe(true);
    expect(isForex('USDCNY=X')).toBe(true);
    expect(isForex('NVDA')).toBe(false);
  });

  it('index by leading `^`', () => {
    expect(isIndex('^GSPC')).toBe(true);
    expect(isIndex('^VIX')).toBe(true);
    expect(isIndex('^TNX')).toBe(true);
    expect(isIndex('NVDA')).toBe(false);
  });

  it('exchange-listed by `.AB` suffix (LSE / HK / TO etc.)', () => {
    expect(isExchangeListed('VUAG.L')).toBe(true);  // LSE
    expect(isExchangeListed('0700.HK')).toBe(true); // HK
    expect(isExchangeListed('NVDA')).toBe(false);
    expect(isExchangeListed('SPAX.PVT')).toBe(true); // unfortunate overlap; isPvt also true
  });

  it('euro-zone exchange by Yahoo suffix (drives the ext-hours gate)', () => {
    // Same list fx.detectCurrency maps to EUR — kept in sync via this
    // single source. If it regresses, euro holdings either lose EUR
    // conversion (detectCurrency) or paint a stale close as ext-hours
    // movement (computeMetrics' euroSuppress).
    expect(isEuroExchange('XFAB.PA')).toBe(true);  // Euronext Paris
    expect(isEuroExchange('ASML.AS')).toBe(true);  // Amsterdam
    expect(isEuroExchange('SAP.DE')).toBe(true);   // XETRA
    expect(isEuroExchange('ENEL.MI')).toBe(true);  // Milan
    expect(isEuroExchange('xfab.pa')).toBe(true);  // case-insensitive
    // German regional venues (all EUR): Stuttgart / Berlin / Munich / …
    expect(isEuroExchange('2DG.SG')).toBe(true);   // Stuttgart
    expect(isEuroExchange('BMW.BE')).toBe(true);   // Berlin
    expect(isEuroExchange('SIE.MU')).toBe(true);   // Munich
    expect(isEuroExchange('VOW.DU')).toBe(true);   // Düsseldorf
    // Non-euro European venues and other classes are excluded.
    expect(isEuroExchange('VOLV-B.ST')).toBe(false); // Stockholm / SEK
    expect(isEuroExchange('NESN.SW')).toBe(false);   // Switzerland / CHF
    expect(isEuroExchange('VUAG.L')).toBe(false);    // LSE (own gate)
    expect(isEuroExchange('NVDA')).toBe(false);
    expect(isEuroExchange('')).toBe(false);
  });

  it('CN fund by 6 ASCII digits', () => {
    expect(isCnFund('017731')).toBe(true);
    expect(isCnFund('000001')).toBe(true);
    expect(isCnFund('NVDA')).toBe(false);
    expect(isCnFund('1234567')).toBe(false); // 7 digits, not a fund code
    expect(isCnFund('12345')).toBe(false);   // 5 digits
  });

  it('PVT placeholder by `.PVT` suffix', () => {
    expect(isPvt('SPAX.PVT')).toBe(true);
    expect(isPvt('spax.pvt')).toBe(true);
    expect(isPvt('NVDA')).toBe(false);
  });

  it('dailyOnly = CN fund OR PVT', () => {
    expect(isDailyOnly('017731')).toBe(true);
    expect(isDailyOnly('SPAX.PVT')).toBe(true);
    expect(isDailyOnly('NVDA')).toBe(false);
    expect(isDailyOnly('BTC-USD')).toBe(false);
  });

  it('isUsEquity strips out every other class', () => {
    // Positive: plain US tickers
    expect(isUsEquity('NVDA')).toBe(true);
    expect(isUsEquity('AAPL')).toBe(true);
    expect(isUsEquity('BRK-B')).toBe(true);  // hyphen in ticker, not -USD
    expect(isUsEquity('GOOG')).toBe(true);
    // Negative: every other class
    expect(isUsEquity('BTC-USD')).toBe(false);
    expect(isUsEquity('ES=F')).toBe(false);
    expect(isUsEquity('GBPUSD=X')).toBe(false);
    expect(isUsEquity('^GSPC')).toBe(false);
    expect(isUsEquity('VUAG.L')).toBe(false);
    expect(isUsEquity('017731')).toBe(false);
    expect(isUsEquity('SPAX.PVT')).toBe(false);
    expect(isUsEquity('')).toBe(false);
  });

  it('hasOvernightSession = isUsEquity minus OTC ADRs (SFTBY)', () => {
    // Normal US equities trade T212's overnight session.
    expect(hasOvernightSession('NVDA')).toBe(true);
    expect(hasOvernightSession('NBIS')).toBe(true);
    expect(hasOvernightSession('GOOG')).toBe(true);
    expect(hasOvernightSession('META')).toBe(true);
    // SFTBY / MRAAY are US-shaped OTC ADRs with no overnight session —
    // excluded (case-insensitive) so they don't show a stale close as a
    // fake dot.
    expect(hasOvernightSession('SFTBY')).toBe(false);
    expect(hasOvernightSession('sftby')).toBe(false);
    expect(hasOvernightSession('MRAAY')).toBe(false);
    // Everything isUsEquity already rejects stays rejected.
    expect(hasOvernightSession('VUAA.L')).toBe(false);
    expect(hasOvernightSession('017731')).toBe(false);
    expect(hasOvernightSession('BTC-USD')).toBe(false);
    expect(hasOvernightSession('')).toBe(false);
  });

  it('isRegularSessionOnly = foreign listings + OTC ADRs (drives the 1D no-OPEN-line rule)', () => {
    // Foreign exchange listings: a single daily session, no US ext-hours.
    expect(isRegularSessionOnly('VUAG.L')).toBe(true);   // LSE
    expect(isRegularSessionOnly('XFAB.PA')).toBe(true);  // Euronext
    expect(isRegularSessionOnly('0700.HK')).toBe(true);  // Hong Kong
    // US-shaped OTC ADRs (the NO_OVERNIGHT_SESSION set).
    expect(isRegularSessionOnly('SFTBY')).toBe(true);
    expect(isRegularSessionOnly('MRAAY')).toBe(true);
    // Normal US equities DO have extended hours — excluded.
    expect(isRegularSessionOnly('NVDA')).toBe(false);
    expect(isRegularSessionOnly('GOOG')).toBe(false);
    // Non-equity classes are not "regular-session equities" either.
    expect(isRegularSessionOnly('BTC-USD')).toBe(false);
    expect(isRegularSessionOnly('^GSPC')).toBe(false);
    expect(isRegularSessionOnly('')).toBe(false);
  });

  it('venueSessionFor — the fixed 1D session frame for sparse-tape venue listings', () => {
    expect(venueSessionFor('2DG.F')).toEqual({ tz: 'Europe/London', startMin: 420, endMin: 1260 });
    expect(venueSessionFor('2dg.f')).toEqual({ tz: 'Europe/London', startMin: 420, endMin: 1260 });
    expect(venueSessionFor('NVDA')).toBeNull();
    expect(venueSessionFor('VUAA.L')).toBeNull();
    expect(venueSessionFor('')).toBeNull();
  });
});
