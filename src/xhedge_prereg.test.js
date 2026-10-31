// "Stablecoin quotes RX↔Coinbase hedge" and "… - 1" (xhedge.ts, 0184; docs/agents/reviews/2026-10-30-xhedge-prereg.md): the files
// its pre-registration froze are those files, and the rule's numbers, its two arms and its bars are the ones it states.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p));
const sha = (p) => crypto.createHash('sha256').update(read(p)).digest('hex');
const DOC = read('docs/agents/reviews/2026-10-30-xhedge-prereg.md').toString('utf8');
const named = (doc, f) => [...doc.matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);

describe("'Stablecoin quotes RX↔Coinbase hedge' and '… - 1'", () => {
  it('names the sha256 of each file it froze, once, and each file is that one', () => {
    for (const f of ['supabase/migrations/0184_xhedge_paper.sql', 'docs/agents/backtests/mmcomp/scripts/xhedge_reading.py']) {
      expect(named(DOC, f), f).toEqual([sha(f)]);
    }
    // Deviation 2 (2026-10-31, two hedges of one key settle as one trip) changed these two, recorded apart: §8 keeps the bytes
    // it froze, and each file is the one Deviation 2 names.
    const DEV = read('docs/agents/reviews/2026-10-30-xhedge-deviation.md').toString('utf8');
    const dev2 = DEV.slice(DEV.indexOf('## Deviation 2'));
    for (const [f, frozen] of [['supabase/functions/agents/xhedge.ts', 'c62279eb50650e9901ba525c5a1e20379128c6c0d65f7561b1de210118c09d49'],
      ['supabase/functions/agents/xhedge.test.ts', 'a117703abf82c5da475121e459bdb5170365bd99d89af79a99819553cffaf7f0']]) {
      expect(named(DOC, f), f).toEqual([frozen]);
      expect(named(dev2, f), f).toEqual([sha(f)]);
    }
    expect(DOC).toContain('Recorded apart in `2026-10-30-xhedge-deviation.md`: Deviation 1');
    expect(DOC).toContain('**Status: FROZEN**');
  });

  it('is the rule and the bar it states: two arms, £600 a venue, £100, ±2 bps, 10 bps behind, 0.45 bps, 30 s, 60 s, no transfers, P < 0.10, 300 and 100 fills', () => {
    const src = read('supabase/functions/agents/xhedge.ts').toString('utf8');
    for (const line of [
      'export const XH_VENUE_GBP = 600;', 'export const XH_Q_GBP = 100;', 'export const XH_MARGIN = 0.0002;', 'export const XH_CB_FEE = 0.000045;',
      'export const XH_HEDGE_DELAY_MS = 30e3;', 'export const XH_CB_STALE_MS = 60e3;', 'export const XH_RX_FRESH_MS = 75e3;', 'export const XH_TURN_MS = 30e3;',
      'export const XH_BOOKS = ["USDT-GBP", "USDC-GBP"] as const;', 'export const XH_ID = "xhedge";', 'export const XH_BEHIND_BPS = 10;',
      '{ arm: "inside", id: "xhedge", name: "Stablecoin quotes RX↔Coinbase hedge", dBps: 0 },',
      '{ arm: "behind", id: "xhedgebehind", name: "Stablecoin quotes RX↔Coinbase hedge - 1", dBps: XH_BEHIND_BPS },',
    ]) expect(src).toContain(line);
    const reading = read('docs/agents/backtests/mmcomp/scripts/xhedge_reading.py').toString('utf8');
    expect(reading).toContain('SEED, NB, BLOCK, P_BAR = 20261030, 10000, 3, 0.10');
    expect(reading).toContain('MIN_FILLS = {"inside": 300, "behind": 100}');
    for (const w of ['如果真的可以实现的话就做成实时纸面测试加到testing里', 'A 策略可以单独做吗还是只能做像你刚才说的和做市商抢生意的那个做法？', '**P(mean ≤ 0) < 0.10**',
      '**at least 300 fills** (`inside`)', '**at least 100 fills** (`behind`)', 'S + 28 days 01:00 UTC', 'No coin or pound ever moves between the venues',
      '`random.Random(20261030)`', '**Competing for the same prints.**']) expect(DOC).toContain(w);
  });
});
