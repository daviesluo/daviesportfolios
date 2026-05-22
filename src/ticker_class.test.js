import { describe, it, expect } from 'vitest';
import {
  isCrypto, isFutures, isForex, isIndex, isExchangeListed,
  isCnFund, isPvt, isDailyOnly, isUsEquity, hasOvernightSession,
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
    // SFTBY is a US-shaped OTC ADR with no overnight session — excluded
    // (case-insensitive) so it doesn't show a stale close as a fake dot.
    expect(hasOvernightSession('SFTBY')).toBe(false);
    expect(hasOvernightSession('sftby')).toBe(false);
    // Everything isUsEquity already rejects stays rejected.
    expect(hasOvernightSession('VUAA.L')).toBe(false);
    expect(hasOvernightSession('017731')).toBe(false);
    expect(hasOvernightSession('BTC-USD')).toBe(false);
    expect(hasOvernightSession('')).toBe(false);
  });
});
