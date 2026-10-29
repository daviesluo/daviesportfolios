// Every Coinbase paper arm on the rate at second resolution (Davies, 2026-10-29: "coinbase的所有策略用更多秒级数据更长时间再深度回测验证下，
// 如果还是正向优化的话把所有coinbase策略的汇率数据源从yahoo换为刚才研究的最佳秒级数据源+fallbacks"; FX-SECOND §8): each pre-registration
// carries it as a dated deviation that quotes him, states the rule (the cap, the sources, the raw level, the freshness, the fallback,
// the closures, the instant), cites §8's figures for that arm and names the bytes; every driver takes its rates from the one function;
// the base call still stores Yahoo's EUR/USD and Coinbase's USDT-USD; and Revolut X's engine is untouched.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
const A = 'supabase/functions/agents/';
const MIG = 'supabase/migrations/0173_cb_fx_src.sql';
const QUOTE = 'coinbase的所有策略用更多秒级数据更长时间再深度回测验证下，如果还是正向优化的话把所有coinbase策略的汇率数据源从yahoo换为刚才研究的最佳秒级数据源+fallbacks';
const DEVS = [
  { doc: 'docs/agents/reviews/2026-10-10-coinbase-paper-prereg.md', head: '### Deviation 7 (2026-10-29', files: ['cb_fx.ts', 'cb_fx.test.ts', 'cb_quotes.ts', 'cb_quotes.test.ts'],
    figures: ['**+£25.5 a year [+12.9, +40.3], P(≤ 0) 0.0000**', '**23 of 25 months positive**', '+£26.8 a year out of sample'], closure: 'This test goes dark where it did.' },
  { doc: 'docs/agents/reviews/2026-10-13-coinbase-weekend-prereg.md', head: '**Deviation 6 (2026-10-29', files: ['cb_fx.ts', 'cb_fx.test.ts', 'cb_hold.ts', 'cb_hold.test.ts', 'cb_quotes.ts'],
    figures: ['**+£31.3 a year [+17.9, +46.8], P(≤ 0) 0.0000**', '**23 of 25 months positive**', '+£28.0 a year out of sample'], closure: '(`cbHoldBarAt`, 60 hours)' },
  { doc: 'docs/agents/reviews/2026-10-26-cb-usdc-prereg.md', head: '**Deviation 5 (2026-10-29', files: ['cb_fx.ts', 'cb_fx.test.ts', 'cb_usdc.ts', 'cb_hold.ts', 'cb_quotes.ts'],
    figures: ['**+£5.9 a year [+2.2, +10.1], P(≤ 0) 0.003**', '**23 of 25 months positive**', '+£4.5 a year out of sample'], closure: '(`cbHoldBarAt`, 60 hours)' },
  { doc: 'docs/agents/reviews/2026-10-29-cb-usdc-nudge-prereg.md', head: '**Deviation 4 (2026-10-29', files: ['cb_fx.ts', 'cb_fx.test.ts', 'cb_usdc.ts', 'cb_quotes.ts'],
    figures: ['**+£3.2 a year [+0.3, +6.4], P(≤ 0) 0.032**', '**20 of 25 months positive**', '**The nudge keeps its definition.**'], closure: '(`cbHoldBarAt`, 60 hours)' },
];

describe('the Coinbase arms on the rate at second resolution', () => {
  for (const d of DEVS) {
    it(`${d.doc.split('/').pop()}: a dated deviation quoting Davies, the rule, §8's figures for the arm, the instant, and its bytes`, () => {
      const doc = read(d.doc), at = doc.indexOf(d.head);
      expect(at, d.head).toBeGreaterThan(doc.indexOf('## 7. Deviations'));
      const dev = doc.slice(at);
      for (const w of [QUOTE, '§8', '**t + 58 s**', 'A read that arrived at t + 59 s is not used', 'marked it `fallback`', 'unmarked reads are never used',
        '**The level is raw.**', '+2.82 bps', '**120 s**', '`FX_STALE_MS`', '`fxBarAt`', '[t − 10 min, t − 1 min]', '`fx_src`', '`fxCount`', '`fxFrom`',
        '**2026-10-29 10:00 UTC**', 'There is no backfill', 'keeps fetching both', '0782ed8140a2e490f19b9e92fe7093c2cb9a6f205866180314f609537277f517',
        'read on the record as it ran', d.closure, ...d.figures]) expect(dev, w).toContain(w);
      for (const f of d.files) expect(dev, f).toContain(sha(A + f));
      expect(dev, MIG).toContain(sha(MIG));
    });
  }

  it('the rule: the cap at t + 58 s, fresh for 120 s (the recorder\'s staleness), from 2026-10-29 10:00 UTC; TrueFX, then Kraken marked, then Yahoo', () => {
    const fx = read(A + 'cb_fx.ts');
    for (const line of ['export const CB_FX_NOT_BEFORE = Date.UTC(2026, 9, 29, 10);', 'export const CB_FX_CUTOFF_MS = 58_000;', 'export const CB_FX_FRESH_MS = 120_000;',
      'if (src === "kraken" && !r.fallback?.[i]) continue;', 'return kr && (!tf || kr.at > tf.at) ? kr : tf;',
      'if (f && t + CB_FX_CUTOFF_MS - f.at <= CB_FX_FRESH_MS) return { x: f.mid, at: f.at, src: f.source };',
      'const y = fxBarAt(t, bars);', 'if (f && f.at >= h[0]) return', '"&fallback=cs.%7Btrue%7D"']) expect(fx).toContain(line);
    expect(read(A + 'fx_rec.ts')).toContain('export const FX_STALE_MS = 120_000;');
  });

  it('every driver takes its rates from cbRatesAt after cbFxSwitch, with its own lookup and hold, and records the source', () => {
    const drivers = { 'cb_quotes.ts': ['fxBarAt, false', 'null'], 'cb_hold.ts': ['cbHoldBarAt, true', 'CB_HOLD_MS'], 'cb_usdc.ts': ['cbHoldBarAt, true', 'CB_HOLD_MS'] };
    for (const [f, [lookup, hold]] of Object.entries(drivers)) {
      const src = read(A + f);
      expect(src, f).toContain('cbFxSwitch(st, first);');
      expect(src, f).toContain(`const fx = st.fxFrom != null ? await readCbFx(d.db, first, horizon, ${hold}) : emptyFx();`);
      expect(src, f).toContain(`const { bar, eb, gbpSrc, eurSrc } = cbRatesAt(st, t, gbpBars, eurBars, fx, ${lookup})`);
      expect(src, f).toContain('if (fxSrc !== undefined) cbFxCount(st, fxSrc);');
      expect(src, f).toMatch(/cbMinuteRow\(b, t, bar, CB_BOOK\[b\]\.quote === "EUR" \? eb : null, window\.length, inp, io\.xGbp, fxSrc\)/);
    }
    // "with Euros - 2" (the nudge) is "- 1"'s driver: it switches with it.
    expect(read(A + 'cb_nudge.ts')).toContain('runCbUsdcArm(');
    // The base call still stores Yahoo's EUR/USD and Coinbase's USDT-USD for every arm (the fallback and the coin need them).
    const q = read(A + 'cb_quotes.ts');
    expect(q).toContain('const fx = await fetchFx(d.now, f, "EURUSD=X");');
    expect(q).toContain('const u = await fetchCbUsdtUsd(d.now, f);');
  });

  it("Revolut X untouched: quotes.ts is the bytes every frozen list names, and only the three Coinbase drivers import cb_fx.ts", () => {
    expect(sha(A + 'quotes.ts')).toBe('0782ed8140a2e490f19b9e92fe7093c2cb9a6f205866180314f609537277f517');
    const importers = fs.readdirSync(path.join(ROOT, A)).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && read(A + f).includes('from "./cb_fx.ts"')).sort();
    expect(importers).toEqual(['cb_hold.ts', 'cb_quotes.ts', 'cb_usdc.ts']);
  });

  it('0173 adds the source column to the four minute records, with its values, and nothing else', () => {
    const sql = read(MIG).replace(/--[^\n]*/g, '');
    for (const t of ['cb_quote_minutes', 'cb_hold_minutes', 'cb_usdc_minutes', 'cb_nudge_minutes']) expect(sql).toMatch(new RegExp(`alter table public\\.${t} +add column if not exists fx_src text;`));
    expect(sql).toContain("check (fx_src in (''truefx'', ''kraken'', ''yahoo'', ''held:truefx'', ''held:kraken'', ''held:yahoo'', ''dark''))");
    expect(sql).not.toMatch(/\b(drop|delete|update|insert|grant|create policy)\b/i);
  });
});
