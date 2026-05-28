// Pin tests for fmtMoney's magnitude tiers. The trillion tier was
// added for the ticker modal's live market-cap line — NVDA-scale
// numbers would otherwise read "$3456.78B". The B / M tiers are
// pinned alongside it so a future tweak to one can't silently shift
// the others. (Locale-dependent tiers below $1M aren't asserted
// exactly — only that they carry no magnitude suffix.)

import { describe, it, expect } from 'vitest';
import { fmtMoney } from './formatters.js';

describe('fmtMoney — magnitude tiers', () => {
  it('>= $1T → trillions with a T suffix', () => {
    expect(fmtMoney(3_460_000_000_000)).toBe('$3.46T');
    expect(fmtMoney(1_000_000_000_000)).toBe('$1.00T');
  });

  it('$1B–$1T → billions with a B suffix', () => {
    expect(fmtMoney(3_460_000_000)).toBe('$3.46B');
    expect(fmtMoney(999_000_000_000)).toBe('$999.00B'); // just under $1T
  });

  it('$1M–$1B → millions with an M suffix', () => {
    expect(fmtMoney(45_870_000)).toBe('$45.87M');
  });

  it('< $1M → no magnitude suffix (T/B/M only kick in above their thresholds)', () => {
    expect(fmtMoney(950_000)).not.toMatch(/[TBM]$/);
    expect(fmtMoney(237.87)).not.toMatch(/[TBM]$/);
  });

  it('signed option prefixes + on positives; negatives always show -', () => {
    expect(fmtMoney(3_460_000_000_000, { signed: true })).toBe('+$3.46T');
    expect(fmtMoney(-3_460_000_000_000)).toBe('-$3.46T');
  });

  it('null / NaN / undefined → em dash', () => {
    expect(fmtMoney(null)).toBe('—');
    expect(fmtMoney(NaN)).toBe('—');
    expect(fmtMoney(undefined)).toBe('—');
  });

  it('symbol opt swaps the currency prefix across every magnitude tier', () => {
    // Used by the mobile scoreboard's USD → GBP → CNY cycle button.
    expect(fmtMoney(1_234_567_890_123, { symbol: '£' })).toBe('£1.23T');
    expect(fmtMoney(2_500_000_000,    { symbol: '¥' })).toBe('¥2.50B');
    expect(fmtMoney(4_750_000,        { symbol: '£' })).toBe('£4.75M');
    expect(fmtMoney(12_345,           { symbol: '¥' })).toBe('¥12,345');
    expect(fmtMoney(42.5,             { symbol: '£' })).toBe('£42.50');
  });

  it('symbol opt combines with signed for ±-prefixed currency strings', () => {
    expect(fmtMoney(123.45,  { symbol: '£', signed: true })).toBe('+£123.45');
    expect(fmtMoney(-123.45, { symbol: '£', signed: true })).toBe('-£123.45');
  });

  it('omitting symbol stays byte-identical to the legacy "$" default', () => {
    expect(fmtMoney(12_345)).toBe('$12,345');
    expect(fmtMoney(12_345, { signed: true })).toBe('+$12,345');
  });
});
