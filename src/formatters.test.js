// Pin tests for fmtMoney's magnitude tiers. The trillion tier was
// added for the ticker modal's live market-cap line — NVDA-scale
// numbers would otherwise read "$3456.78B". The B / M tiers are
// pinned alongside it so a future tweak to one can't silently shift
// the others. (Locale-dependent tiers below $1M aren't asserted
// exactly — only that they carry no magnitude suffix.)

import { describe, it, expect } from 'vitest';
import { fmtMoney, fmtPct, fmtShares } from './formatters.js';

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

  it('compact:false expands the M / B / T tiers to full digits', () => {
    // The mobile scoreboard's CNY cycle uses this so a $159 K USD
    // portfolio renders as `¥1,079,451`, not `¥1.08M`.
    expect(fmtMoney(1_079_451, { symbol: '¥', compact: false })).toBe('¥1,079,451');
    expect(fmtMoney(2_500_000_000, { symbol: '£', compact: false })).toBe('£2,500,000,000');
    expect(fmtMoney(3_460_000_000_000, { compact: false })).toBe('$3,460,000,000,000');
    // Sub-1M values fall through to the same toLocaleString path so
    // compact:false is a no-op there — still tests the contract.
    expect(fmtMoney(12_345, { compact: false })).toBe('$12,345');
  });

  it('compact:true (default) preserves M / B / T abbreviation', () => {
    expect(fmtMoney(1_079_451, { symbol: '¥' })).toBe('¥1.08M');
    expect(fmtMoney(1_079_451, { symbol: '¥', compact: true })).toBe('¥1.08M');
  });

  it('precision opt strips decimals on the sub-1000 path', () => {
    // Mobile scoreboard DAY CHANGE prefers integer dollars for the
    // small-swing case.
    expect(fmtMoney(500.50, { precision: 0, signed: true })).toBe('+$501');
    expect(fmtMoney(-12.34, { precision: 0 })).toBe('-$12');
    // Default (2) preserves the legacy "$500.50" surface.
    expect(fmtMoney(500.50, { signed: true })).toBe('+$500.50');
    // >=1000 path was always integer; precision doesn't change it.
    expect(fmtMoney(12_345, { precision: 0 })).toBe('$12,345');
    expect(fmtMoney(12_345, { precision: 2 })).toBe('$12,345');
  });
});

describe('fmtPct', () => {
  it('defaults to 2-decimal precision', () => {
    expect(fmtPct(1.44)).toBe('+1.44%');
    expect(fmtPct(-3.5)).toBe('-3.50%');
    expect(fmtPct(0)).toBe('0.00%');
  });

  it('precision opt drops decimals (mobile scoreboard DAY CHANGE)', () => {
    expect(fmtPct(1.44, { precision: 0 })).toBe('+1%');
    expect(fmtPct(-3.5, { precision: 0 })).toBe('-4%');
    expect(fmtPct(1.44, { precision: 1 })).toBe('+1.4%');
  });

  it('null / NaN / undefined → em dash', () => {
    expect(fmtPct(null)).toBe('—');
    expect(fmtPct(NaN)).toBe('—');
    expect(fmtPct(undefined)).toBe('—');
  });
});

describe('fmtShares', () => {
  it('caps at 2 decimals without padding whole / single-decimal shares', () => {
    expect(fmtShares(5)).toBe('5');
    expect(fmtShares(18.5)).toBe('18.5');
    expect(fmtShares(5.25)).toBe('5.25');
  });

  it('rounds longer fractional share counts to 2 decimals', () => {
    expect(fmtShares(5.123)).toBe('5.12');
    expect(fmtShares(0.33333)).toBe('0.33');
    expect(fmtShares(100.005)).toBe('100'); // float: 100.005 → "100.00" → 100
  });

  it('null / NaN / undefined → em dash', () => {
    expect(fmtShares(null)).toBe('—');
    expect(fmtShares(NaN)).toBe('—');
    expect(fmtShares(undefined)).toBe('—');
  });
});
