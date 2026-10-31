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
/** The closure deviation (2026-10-31, no take inside an FX closure), recorded apart: the files as they are, under a pre-registration's own heading. */
const DTC = read('docs/agents/reviews/2026-10-31-take-closure-deviation.md').toString('utf8');
const namedTC = (head, f) => {
  const s = DTC.indexOf('### `docs/agents/reviews/' + head + '`'), rest = s < 0 ? '' : DTC.slice(s + 1), e = rest.search(/\n##/);
  return [...rest.slice(0, e < 0 ? undefined : e).matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);
};
/** TAKE-DEPTH's deviation (2026-10-31), recorded apart: the files as they are, under a pre-registration's own heading. */
const DTD = read('docs/agents/reviews/2026-10-31-take-depth-deviation.md').toString('utf8');
const namedTD = (head, f) => {
  const s = DTD.indexOf('### `docs/agents/reviews/' + head + '`'), rest = s < 0 ? '' : DTD.slice(s + 1), e = rest.search(/\n##/);
  return [...rest.slice(0, e < 0 ? undefined : e).matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);
};
/** LIVE's exit-tick deviation (0181), recorded apart: the files as they are, under a pre-registration's own heading. */
const DX1 = read('docs/agents/reviews/2026-10-29-live-exit-tick-deviation.md').toString('utf8');
const namedX1 = (head, f) => {
  const s = DX1.indexOf('### `docs/agents/reviews/' + head + '`'), rest = s < 0 ? '' : DX1.slice(s + 1), e = rest.search(/\n##/);
  return [...rest.slice(0, e < 0 ? undefined : e).matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);
};
/** The USDC/GBP executor's deviation (0180), recorded apart: the files as they are, under a pre-registration's own heading. */
const DRXU = read('docs/agents/reviews/2026-10-29-rx-usdc-live-deviation.md').toString('utf8');
const namedRxu = (head, f) => {
  const s = DRXU.indexOf('### `docs/agents/reviews/' + head + '`'), rest = s < 0 ? '' : DRXU.slice(s + 1), e = rest.search(/\n##/);
  return [...rest.slice(0, e < 0 ? undefined : e).matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);
};
/** The 22:30 deviation (0179), recorded apart: the files as they are, under a pre-registration's own heading. */
const D2230 = read('docs/agents/reviews/2026-10-29-usdt-only-2230-deviation.md').toString('utf8');
const named2230 = (head, f) => {
  const s = D2230.indexOf('### `docs/agents/reviews/' + head + '`'), rest = s < 0 ? '' : D2230.slice(s + 1), e = rest.search(/\n##/);
  return [...rest.slice(0, e < 0 ? undefined : e).matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);
};

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
      'supabase/functions/agents/revx_sim.ts', 'supabase/functions/agents/quotes_weekend.ts',
    ]) expect(namedIn(DOC, f), f).toEqual([sha(f)]);
    // The executor as frozen, then as the 22:30 deviation (0179) names it.
    const live = 'supabase/functions/agents/quotes_live.ts';
    expect([...namedIn(DOC, live), ...named2230('2026-10-29-usdt-only-twins-prereg.md', live), ...namedRxu('2026-10-29-usdt-only-twins-prereg.md', live), ...namedX1('2026-10-29-usdt-only-twins-prereg.md', live), ...namedTD('2026-10-29-usdt-only-twins-prereg.md', live), ...namedTC('2026-10-29-usdt-only-twins-prereg.md', live)], live).toEqual(['eb9790f61931636ca0ee58d7d4fbbb0d2d515fd2e2dc197303fd8f805d79136a', 'aa770ef6fc40301e4d7bbfbf4f9f2e66f6e7a8b010f4c4a8b5646cc1075d80cc', 'd683bb5a4f1accf144c630a7d69bd565953a23879be847eade2ce2868d8bc86c', 'b6bdbd8cc1947b0949923322988290b6928f679798f7042c100b1776ffbcc3a1', '2ec5455b525f8f5d5d9996e994e9b512154cc0abfe4890df14dd33e786b06270', sha(live)]);
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
    expect(namedIn(DEV, live)).toEqual(['eb9790f61931636ca0ee58d7d4fbbb0d2d515fd2e2dc197303fd8f805d79136a', 'eb9790f61931636ca0ee58d7d4fbbb0d2d515fd2e2dc197303fd8f805d79136a', 'eb9790f61931636ca0ee58d7d4fbbb0d2d515fd2e2dc197303fd8f805d79136a']);
    // Then the 22:30 deviation (0179): the executor as it is, under each pre-registration that froze it.
    for (const h of ['2026-10-29-usdt-only-twins-prereg.md', '2026-10-29-revx-usdc-nudge-twin-prereg.md', '2026-10-29-revx-exit-tick-twin-prereg.md']) {
      expect(named2230(h, live), h).toEqual(['aa770ef6fc40301e4d7bbfbf4f9f2e66f6e7a8b010f4c4a8b5646cc1075d80cc']);
      // Then the USDC/GBP executor's deviation (0180): the executor as it is.
      expect(namedRxu(h, live), h).toEqual(['d683bb5a4f1accf144c630a7d69bd565953a23879be847eade2ce2868d8bc86c']);
      // Then LIVE's exit-tick deviation (0181), then TAKE-DEPTH's (2026-10-31): the executor as it is.
      expect(namedX1(h, live), h).toEqual(['b6bdbd8cc1947b0949923322988290b6928f679798f7042c100b1776ffbcc3a1']);
      expect(namedTD(h, live), h).toEqual(['2ec5455b525f8f5d5d9996e994e9b512154cc0abfe4890df14dd33e786b06270']);
      // Then the closure deviation (2026-10-31): the executor as it is.
      expect(namedTC(h, live), h).toEqual([sha(live)]);
    }
    expect(DTD).toContain('the executor was `b6bdbd8cc1947b0949923322988290b6928f679798f7042c100b1776ffbcc3a1` before this change');
    expect(DTC).toContain('the executor was `2ec5455b525f8f5d5d9996e994e9b512154cc0abfe4890df14dd33e786b06270` before this change');
    expect(DRXU).toContain('the executor was `aa770ef6fc40301e4d7bbfbf4f9f2e66f6e7a8b010f4c4a8b5646cc1075d80cc` before this change');
    expect(D2230).toContain('the executor was `eb9790f61931636ca0ee58d7d4fbbb0d2d515fd2e2dc197303fd8f805d79136a` before this change');
    expect(DEV).toContain('the executor was `99ce22c051431df2fc179ebaf93717460b953f95f87d109466d6f91d55d40bd8` before this change');
    // The frozen executor beside which the live instance still runs, unchanged.
    expect(sha('supabase/functions/agents/quotes_live_frozen.ts')).toBe('60d3f33f2bb8d328fe14693d570396afdffcc2cae9b75e05e2d4eed5ea459a52');
    expect(DEV).toContain('60d3f33f2bb8d328fe14693d570396afdffcc2cae9b75e05e2d4eed5ea459a52');
  });
});
