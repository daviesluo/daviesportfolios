// "Stablecoin quotes variant-8" and its control (0175; docs/agents/reviews/2026-10-29-revx-exit-tick-twin-prereg.md): the rows
// the pre-registration shows are the migration's, the two differ only by the exit offset, both carry LIVE's rules exactly as
// the LIVE twin (`live600`) has them, the files it froze are those files by sha256, and its bar is as written.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p));
const sha = (p) => crypto.createHash('sha256').update(read(p)).digest('hex');
const M = '0175_quote_twin_exit_tick.sql';
const sqlOf = (f) => read(`supabase/migrations/${f}`).toString('utf8').replace(/--[^\n]*/g, '');
const rowsOf = (f) => JSON.parse(/null::public\.agent_quote_twin_specs, \$json\$(\[[\s\S]*?\])\$json\$/.exec(sqlOf(f))?.[1] ?? '[]');
const DOC = read('docs/agents/reviews/2026-10-29-revx-exit-tick-twin-prereg.md').toString('utf8');
const named = (f) => [...DOC.matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);
/** The holding-line deviation (0176), recorded apart: the files as they are, under this pre-registration's own heading. */
const HOLD = read('docs/agents/reviews/2026-10-29-holdmin-deviation.md').toString('utf8');
const holdNamed = (f) => {
  const s = HOLD.indexOf('### `docs/agents/reviews/2026-10-29-revx-exit-tick-twin-prereg.md`'), rest = s < 0 ? '' : HOLD.slice(s + 1), e = rest.search(/\n##/);
  return [...rest.slice(0, e < 0 ? undefined : e).matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);
};

/** The USDT-only deviation (0178), recorded apart: the files as they are, under this pre-registration's own heading. */
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
  const s = USDT.indexOf('### `docs/agents/reviews/2026-10-29-revx-exit-tick-twin-prereg.md`'), rest = s < 0 ? '' : USDT.slice(s + 1), e = rest.search(/\n##/);
  return [...rest.slice(0, e < 0 ? undefined : e).matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);
};

describe("variant-8's pre-registration", () => {
  it('shows the rows 0175 inserts, frozen; the two are the same but for the offset, its id, name, place, tables, lease and hiding', () => {
    const rows = rowsOf(M);
    const shown = [...DOC.matchAll(/```json\n(\{[^\n]*\})\n```/g)].map((m) => JSON.parse(m[1]));
    expect(shown).toEqual(rows);
    expect(DOC).toContain('**Status: FROZEN**');
    const [x1, ctl] = rows;
    expect([x1.id, x1.display_name, x1.hidden, ctl.id, ctl.hidden]).toEqual(['live600x1', 'Stablecoin quotes variant-8', false, 'live600ctl', true]);
    const { exitOffset, ...x1Rules } = x1.rules;
    expect(x1Rules).toEqual(ctl.rules);
    expect(exitOffset).toEqual({ ticks: 1, from: x1.start });
    const strip = (r) => ({ ...r, id: null, display_name: null, display_order: null, table_prefix: null, lease: null, hidden: null, rules: null });
    expect(strip(x1)).toEqual(strip(ctl));
    expect([x1.start, x1.backfill, x1.capital_gbp, x1.engine, x1.gov]).toEqual(['2026-10-29T19:00:00Z', null, 600, 'pr5', 'account']);
  });

  it("carries LIVE's rules exactly as the LIVE twin has them: its fill rule in force, its weekend from the same closure, no take, no weights", () => {
    const live600 = rowsOf('0141_quote_twins_relayout.sql').find((r) => r.id === 'live600');
    const [x1, ctl] = rowsOf(M);
    expect(live600.rules).toEqual({ fill: { model: 'at', from: '2026-10-27T00:00:00Z' }, weekend: { from: '2026-10-30T21:00:00Z' } });
    expect([ctl.capital_gbp, ctl.engine, ctl.gov]).toEqual([live600.capital_gbp, live600.engine, live600.gov]);
    // The fill rule from the twins' start, which is after the LIVE twin's: in force over every minute of the window for all three.
    expect(ctl.rules.fill).toEqual({ model: 'at', from: ctl.start });
    expect(Date.parse(live600.rules.fill.from)).toBeLessThan(Date.parse(ctl.start));
    expect(ctl.rules.weekend).toEqual(live600.rules.weekend);
    expect(Object.keys(ctl.rules).sort()).toEqual(['fill', 'weekend']);
    expect(Object.keys(x1.rules).sort()).toEqual(['exitOffset', 'fill', 'weekend']);
    // No FX closure falls between the start and the weekend rule's instant (Friday 2026-10-30 21:00 UTC is the first).
    expect(new Date('2026-10-30T21:00:00Z').getUTCDay()).toBe(5);
    // LIVE's exits meet the book on every instance from 2026-10-29 00:00, before the start; no rule key moves it.
    const live = read('supabase/functions/agents/quotes_live.ts').toString('utf8');
    expect(live).toContain('export const QUOTE_LIVE_EXIT_INSIDE_FROM = Date.parse("2026-10-29T00:00:00Z");');
    expect(Date.parse('2026-10-29T00:00:00Z')).toBeLessThan(Date.parse(ctl.start));
    expect(read('supabase/functions/agents/quotes_twin.ts').toString('utf8')).not.toMatch(/exitInside/);
  });

  it('makes its tables, and touches no live table, capital, call or other twin', () => {
    const sql = sqlOf(M);
    for (const id of ['live600x1', 'live600ctl']) expect(sql).toContain(`select public.create_quote_twin_tables('${id}');`);
    expect(/capital_gbp\s*=|agent_quote_live_config|edge_calls|take_mode|weekend_mode|cron\.|\bgrant\b|create policy|\bupdate\b|\bdelete\b|create table/i.test(sql)).toBe(false);
  });

  it('names the sha256 of each file it froze, once, and each file is that one (the executor as the holding-line deviation names it); the driver and executor were the bytes variant-7 froze', () => {
    for (const f of [
      `supabase/migrations/${M}`, 'supabase/functions/agents/quotes_twin.ts',
      'supabase/functions/agents/revx_sim.ts', 'supabase/functions/agents/quotes_weekend.ts',
      'docs/agents/backtests/revx_lag/scripts/power.py', 'docs/agents/backtests/revx_lag/results/power.json',
    ]) expect(named(f), f).toEqual([sha(f)]);
    // The deviation of 2026-10-29 (0176: variant-4's £1 holding line on LIVE and every twin), recorded apart: the executor as it is.
    const live = 'supabase/functions/agents/quotes_live.ts';
    // Then the USDT-only deviation of 2026-10-29 (0178: LIVE on USDT-GBP alone, the coin rebooked), recorded apart.
    expect([...named(live), ...holdNamed(live), ...usdtNamed(live), ...named2230('2026-10-29-revx-exit-tick-twin-prereg.md', live), ...namedRxu('2026-10-29-revx-exit-tick-twin-prereg.md', live), ...namedX1('2026-10-29-revx-exit-tick-twin-prereg.md', live)], live).toEqual([
      '12e3dad7cc9058cedc7cd840fc4ac5d3396b955c842e39fd70f22f18cfad25eb', '99ce22c051431df2fc179ebaf93717460b953f95f87d109466d6f91d55d40bd8', 'eb9790f61931636ca0ee58d7d4fbbb0d2d515fd2e2dc197303fd8f805d79136a', 'aa770ef6fc40301e4d7bbfbf4f9f2e66f6e7a8b010f4c4a8b5646cc1075d80cc', 'd683bb5a4f1accf144c630a7d69bd565953a23879be847eade2ce2868d8bc86c', sha(live)]);
    const v7 = read('docs/agents/reviews/2026-10-29-revx-usdc-nudge-twin-prereg.md').toString('utf8');
    for (const f of ['quotes_twin.ts', 'quotes_live.ts', 'revx_sim.ts', 'quotes_weekend.ts']) {
      expect(v7, f).toContain(`| \`supabase/functions/agents/${f}\` | ${named(`supabase/functions/agents/${f}`)[0]} |`);
    }
  });

  it('holds its bar, its comparison and its expectation as written, the expectation from the committed replay', () => {
    for (const w of [
      'The bar: PASS when the mean is above 0 and the share at or below 0 is under 0.10.', 'seed 20261127', 'circular 3-day block bootstrap',
      '2026-10-29 19:00 → 2026-11-26 19:00', 'The control is the comparison.', '**+1.20 bps of capital a day**', '+0.27 bps a day',
      '**94.3 % pass**', '85.5 % of the 55', '`exitTicksOnBook` is not in the replay.', 'The F3 replay of 2026-10-09 found the contrary.',
      "LIVE's own fills are in the tape.", 'The gain has faded.',
    ]) expect(DOC).toContain(w);
    const p = JSON.parse(read('docs/agents/backtests/revx_lag/results/power.json').toString('utf8'));
    expect([p.oos_mean_bps_day, p.oos_sd_bps_day, p.sep_oct_mean_bps_day, p.oos_days]).toEqual([1.198, 3.514, 0.269, 167]);
    expect([p.windows_oos.windows, p.windows_oos.pass_share, p.windows_oos_ending_sep_oct.windows, p.windows_oos_ending_sep_oct.pass_share]).toEqual([140, 0.943, 55, 0.855]);
    // +£26.2 a year on £600 is the same figure (REVX-LAG §5).
    expect(Math.round(p.oos_mean_bps_day * 600 / 1e4 * 365 * 10) / 10).toBe(26.2);
  });
});
