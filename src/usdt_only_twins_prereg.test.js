// "Stablecoin quotes variant-5" (0178; docs/agents/reviews/2026-10-29-usdt-only-twins-prereg.md): the row the pre-registration
// shows is the migration's, it is variant-4's rules from the switch with the nudge, the files it froze are those files by
// sha256, and its bar is as written; and the USDT-only deviation names the executor as it is (Davies, 2026-10-29: "把live全换成
// 只做USDT-GBP的…").
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p));
const sha = (p) => crypto.createHash('sha256').update(read(p)).digest('hex');
const M = '0178_quote_twins_usdt_only.sql';
const sqlOf = (f) => read(`supabase/migrations/${f}`).toString('utf8').replace(/--[^\n]*/g, '');
const rowsOf = (f) => JSON.parse(/null::public\.agent_quote_twin_specs, \$json\$(\[[\s\S]*?\])\$json\$/.exec(sqlOf(f))?.[1] ?? '[]');
const DOC = read('docs/agents/reviews/2026-10-29-usdt-only-twins-prereg.md').toString('utf8');
const DEV = read('docs/agents/reviews/2026-10-29-usdt-only-deviation.md').toString('utf8');
const namedIn = (doc, f) => [...doc.matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);
const U = '2026-10-30T00:00:00Z';

describe("variant-5's pre-registration (the USDC-GBP nudge on USDC:USDT 1:1)", () => {
  it('shows the row 0178 inserts, frozen: variant-4\'s rules from the switch, both books 1:1, and the nudge on USDC-GBP', () => {
    const rows = rowsOf(M);
    const shown = [...DOC.matchAll(/```json\n(\{[^\n]*\})\n```/g)].map((m) => JSON.parse(m[1]));
    expect(shown).toEqual(rows);
    expect(DOC).toContain('**Status: FROZEN**');
    const [nn] = rows;
    expect([rows.length, nn.id, nn.display_name, nn.hidden, nn.start, nn.capital_gbp, nn.backfill, nn.migration]).toEqual([1, 'n600nudge', 'Stablecoin quotes variant-5', false, U, 600, null, '0178']);
    expect(nn.rules).toEqual({
      fill: { model: 'at', from: U }, weekend: { from: U }, holdMin: { from: U, gbp: 1 },
      weights: { from: U, book: { 'USDC-GBP': 1, 'USDT-GBP': 1 } }, fairNudge: { from: U, book: 'USDC-GBP', w: 0.5, halfLifeMin: 1440 },
    });
    // Its control's weights, as 0178 sets them: the same from the same instant.
    expect(sqlOf(M)).toContain(`set rules = jsonb_set(rules, '{weights}', '{"from": "${U}", "book": {"USDC-GBP": 1, "USDT-GBP": 1}}'::jsonb)\n where id = 'n600usdt'`);
  });

  it('names the sha256 of each file it froze, once, and each file is that one', () => {
    for (const f of [
      `supabase/migrations/${M}`, 'supabase/functions/agents/quotes_nudge.ts', 'supabase/functions/agents/quotes_twin.ts',
      'supabase/functions/agents/quotes_live.ts', 'supabase/functions/agents/revx_sim.ts', 'supabase/functions/agents/quotes_weekend.ts',
    ]) expect(namedIn(DOC, f), f).toEqual([sha(f)]);
  });

  it('holds its bar and its comparison as written', () => {
    for (const w of [
      'The bar: PASS when the mean is above 0 and the share at or below 0 is under 0.10.', 'seed 20261130', 'circular 3-day block bootstrap',
      '2026-10-30 00:00 → 2026-11-27 00:00', '+0.64 bps of capital a day', 'The control is the comparison.', 'the days from 2026-11-02 00:00 apart',
    ]) expect(DOC).toContain(w);
  });
});

describe('the USDT-only deviation (0178)', () => {
  it('names the executor as it is under every pre-registration that froze it, and the executor before it', () => {
    const live = 'supabase/functions/agents/quotes_live.ts';
    expect(namedIn(DEV, live)).toEqual([sha(live), sha(live), sha(live)]);
    expect(DEV).toContain('the executor was `99ce22c051431df2fc179ebaf93717460b953f95f87d109466d6f91d55d40bd8` before this change');
    // The frozen executor beside which the live instance still runs, unchanged.
    expect(sha('supabase/functions/agents/quotes_live_frozen.ts')).toBe('60d3f33f2bb8d328fe14693d570396afdffcc2cae9b75e05e2d4eed5ea459a52');
    expect(DEV).toContain('60d3f33f2bb8d328fe14693d570396afdffcc2cae9b75e05e2d4eed5ea459a52');
  });
});
