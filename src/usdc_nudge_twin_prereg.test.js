// "Stablecoin quotes variant-7" and its control (0169; docs/agents/reviews/2026-10-29-revx-usdc-nudge-twin-prereg.md): the rows
// the pre-registration shows are the migration's, the two differ only by the nudge, the files it froze are those files by
// sha256, and its bar is as written.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p));
const sha = (p) => crypto.createHash('sha256').update(read(p)).digest('hex');
const M = '0169_quote_twin_usdc_nudge.sql';
const sqlOf = (f) => read(`supabase/migrations/${f}`).toString('utf8').replace(/--[^\n]*/g, '');
const rowsOf = (f) => JSON.parse(/null::public\.agent_quote_twin_specs, \$json\$(\[[\s\S]*?\])\$json\$/.exec(sqlOf(f))?.[1] ?? '[]');
const DOC = read('docs/agents/reviews/2026-10-29-revx-usdc-nudge-twin-prereg.md').toString('utf8');
const named = (f) => [...DOC.matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);
/** The holding-line deviation (0176), recorded apart: the files as they are, under this pre-registration's own heading. */
const HOLD = read('docs/agents/reviews/2026-10-29-holdmin-deviation.md').toString('utf8');
const holdNamed = (f) => {
  const s = HOLD.indexOf('### `docs/agents/reviews/2026-10-29-revx-usdc-nudge-twin-prereg.md`'), rest = s < 0 ? '' : HOLD.slice(s + 1), e = rest.search(/\n##/);
  return [...rest.slice(0, e < 0 ? undefined : e).matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);
};

/** The USDT-only deviation (0178), recorded apart: the files as they are, under this pre-registration's own heading. */
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
const USDT = read('docs/agents/reviews/2026-10-29-usdt-only-deviation.md').toString('utf8');
const usdtNamed = (f) => {
  const s = USDT.indexOf('### `docs/agents/reviews/2026-10-29-revx-usdc-nudge-twin-prereg.md`'), rest = s < 0 ? '' : USDT.slice(s + 1), e = rest.search(/\n##/);
  return [...rest.slice(0, e < 0 ? undefined : e).matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);
};

describe("variant-7's pre-registration", () => {
  it('shows the rows 0169 inserts, frozen; the two are the same but for the nudge, its id, name, place, tables, lease and hiding', () => {
    const rows = rowsOf(M);
    const shown = [...DOC.matchAll(/```json\n(\{[^\n]*\})\n```/g)].map((m) => JSON.parse(m[1]));
    expect(shown).toEqual(rows);
    expect(DOC).toContain('**Status: FROZEN**');
    const [nu, ctl] = rows;
    expect([nu.id, nu.display_name, nu.hidden, ctl.id, ctl.hidden]).toEqual(['u300nudge', 'Stablecoin quotes variant-7', false, 'u300ctl', true]);
    const { fairNudge, ...nuRules } = nu.rules;
    expect(nuRules).toEqual(ctl.rules);
    expect(fairNudge).toEqual({ from: nu.start, book: 'USDC-GBP', w: 0.5, halfLifeMin: 1440 });
    const strip = (r) => ({ ...r, id: null, display_name: null, display_order: null, table_prefix: null, lease: null, hidden: null, rules: null });
    expect(strip(nu)).toEqual(strip(ctl));
    // $300 at the fixed rate, to the penny; six rungs of £37.55 on USDC-GBP alone; from 2026-10-30 00:00 UTC, no backfill.
    expect(Math.round((300 / 1.3314) * 100) / 100).toBe(nu.capital_gbp);
    expect(Math.floor((nu.capital_gbp / 6) * 100) / 100).toBe(37.55);
    expect([nu.start, nu.backfill, nu.rules.weights.book]).toEqual(['2026-10-30T00:00:00Z', null, { 'USDC-GBP': 1, 'USDT-GBP': 0 }]);
  });

  it('makes its tables and the nudge record, and touches no live table, capital, call or other twin', () => {
    const sql = sqlOf(M);
    for (const id of ['u300nudge', 'u300ctl']) expect(sql).toContain(`select public.create_quote_twin_tables('${id}');`);
    expect(sql).toContain('create table if not exists public.agent_quote_twin_nudge');
    expect(sql).toContain('alter table public.agent_quote_twin_nudge enable row level security;');
    expect(/capital_gbp\s*=|agent_quote_live_config|edge_calls|take_mode|weekend_mode|cron\.|\bgrant\b|create policy/i.test(sql)).toBe(false);
  });

  it('names the sha256 of each file it froze, once, and each file is that one (the executor as the holding-line deviation names it)', () => {
    for (const f of [
      `supabase/migrations/${M}`, 'supabase/functions/agents/quotes_nudge.ts', 'supabase/functions/agents/quotes_twin.ts',
      'supabase/functions/agents/revx_sim.ts', 'supabase/functions/agents/quotes_weekend.ts',
    ]) expect(named(f), f).toEqual([sha(f)]);
    // The deviation of 2026-10-29 (0176: variant-4's £1 holding line on LIVE and every twin), recorded apart: the executor as it is.
    const live = 'supabase/functions/agents/quotes_live.ts';
    // Then the USDT-only deviation of 2026-10-29 (0178: LIVE on USDT-GBP alone, the coin rebooked), recorded apart.
    expect([...named(live), ...holdNamed(live), ...usdtNamed(live), ...named2230('2026-10-29-revx-usdc-nudge-twin-prereg.md', live), ...namedRxu('2026-10-29-revx-usdc-nudge-twin-prereg.md', live), ...namedX1('2026-10-29-revx-usdc-nudge-twin-prereg.md', live), ...namedTD('2026-10-29-revx-usdc-nudge-twin-prereg.md', live), ...namedTC('2026-10-29-revx-usdc-nudge-twin-prereg.md', live)], live).toEqual([
      '12e3dad7cc9058cedc7cd840fc4ac5d3396b955c842e39fd70f22f18cfad25eb', '99ce22c051431df2fc179ebaf93717460b953f95f87d109466d6f91d55d40bd8', 'eb9790f61931636ca0ee58d7d4fbbb0d2d515fd2e2dc197303fd8f805d79136a', 'aa770ef6fc40301e4d7bbfbf4f9f2e66f6e7a8b010f4c4a8b5646cc1075d80cc', 'd683bb5a4f1accf144c630a7d69bd565953a23879be847eade2ce2868d8bc86c', 'b6bdbd8cc1947b0949923322988290b6928f679798f7042c100b1776ffbcc3a1', '2ec5455b525f8f5d5d9996e994e9b512154cc0abfe4890df14dd33e786b06270', sha(live)]);
  });

  it('holds its bar and its comparison as written', () => {
    for (const w of [
      'The bar: PASS when the mean is above 0 and the share at or below 0 is under 0.10.', 'seed 20261127', 'circular 3-day block bootstrap',
      '2026-10-30 00:00 → 2026-11-27 00:00', 'about +1.28 bps of capital a day', '24-hour half-life', 'f′ = f × (1 + 0.5 × dev)',
      'The control is the comparison.',
    ]) expect(DOC).toContain(w);
  });
});
