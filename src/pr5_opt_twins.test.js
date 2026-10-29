// PR5-OPT's three twins on LIVE's rules (`live600usdt2`, `live600no03`, `live600hold1`; "Stablecoin quotes variant-4", "-5",
// "-6"; docs/agents/reviews/2026-10-27-pr5-opt-twins-prereg.md): their rows as 0148 inserts them (the £600 LIVE twin's but for
// the id, name, place, tables, lease, start, rules' dates, one rule each and the pre-registration), the rename that frees
// "variant-4", the rows the pre-registration shows, and the files it froze, by sha256.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p));
const sha = (p) => crypto.createHash('sha256').update(read(p)).digest('hex');
const sqlOf = (f) => read(`supabase/migrations/${f}`).toString('utf8').replace(/--[^\n]*/g, '');
const rowsOf = (f) => JSON.parse(/null::public\.agent_quote_twin_specs, \$json\$(\[[\s\S]*?\])\$json\$/.exec(sqlOf(f))?.[1] ?? '[]');
const M = '0148_quote_twins_pr5_opt.sql';
const BASE = rowsOf('0141_quote_twins_relayout.sql').find((r) => r.id === 'live600');
const DOC = read('docs/agents/reviews/2026-10-27-pr5-opt-twins-prereg.md').toString('utf8');
/**
 * The deviation of 2026-10-29 (0169: the driver gains variant-7's rules `fairNudge` and `usdCapital`), recorded apart from the
 * frozen text: the files as they are, under this pre-registration's own heading of that record.
 */
const V7 = read('docs/agents/reviews/2026-10-29-variant7-frozen-files-deviation.md').toString('utf8');
const v7Named = (f) => {
  const s = V7.indexOf('### `docs/agents/reviews/2026-10-27-pr5-opt-twins-prereg.md`'), rest = s < 0 ? '' : V7.slice(s + 1), e = rest.search(/\n##/);
  return [...rest.slice(0, e < 0 ? undefined : e).matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);
};
const S = '2026-10-29T00:00:00Z';

describe("PR5-OPT's three twins on LIVE's rules", () => {
  it("are 0148's rows: the £600 LIVE twin's but for id, name, place, tables, lease, start, rules' dates and one rule each", () => {
    const like = (id, name, order, rule) => ({
      ...BASE, id, display_name: name, display_order: order, table_prefix: `agent_quote_twin_${id}`, lease: `quotes-twin-${id}`, start: S,
      rules: { fill: { model: 'at', from: S }, weekend: { from: S }, ...rule },
      prereg: 'docs/agents/reviews/2026-10-27-pr5-opt-twins-prereg.md', migration: '0148',
    });
    const rows = rowsOf(M);
    expect(rows).toEqual([
      like('live600usdt2', 'Stablecoin quotes variant-4', 31, { weights: { from: S, book: { 'USDC-GBP': 1, 'USDT-GBP': 2 } } }),
      like('live600no03', 'Stablecoin quotes variant-5', 32, { weights: { from: S, k: { '0.001': 1, '0.002': 1, '0.003': 0 } } }),
      like('live600hold1', 'Stablecoin quotes variant-6', 33, { holdMin: { from: S, gbp: 1 } }),
    ]);
    // £600 each, on PR5's engine, one key, no take.
    for (const r of rows) expect([Number(r.capital_gbp), r.engine, r.gov, 'take' in r.rules], r.id).toEqual([600, 'pr5', 'account', false]);
    // The pre-registration shows the rows as the migration inserts them, and is frozen.
    const shown = [...DOC.matchAll(/```json\n(\{[^\n]*\})\n```/g)].map((m) => JSON.parse(m[1]));
    expect(shown).toEqual(rows);
    expect(DOC).toContain('**Status: FROZEN**');
  });

  it('renames rule D\'s hidden twin before the inserts, so "variant-4" is free, and touches no live table or capital', () => {
    const sql = sqlOf(M);
    const rename = sql.indexOf("set display_name = 'Stablecoin quotes rule-D twin'\n where id = 'd' and display_name = 'Stablecoin quotes variant-4';");
    expect(rename).toBeGreaterThan(-1);
    expect(rename).toBeLessThan(sql.indexOf('insert into public.agent_quote_twin_specs'));
    expect(/capital_gbp\s*=|agent_quote_live_config|edge_calls|take_mode|weekend_mode/.test(sql)).toBe(false);
    for (const id of ['live600usdt2', 'live600no03', 'live600hold1']) expect(sql).toContain(`select public.create_quote_twin_tables('${id}');`);
  });

  it('names the sha256 of each file it froze, once, and each file is that one, as its last deviation left it', () => {
    // Its deviation of 2026-10-28 (`0152`): the driver turns no twin before the minute after its start; §5 keeps the hash
    // it was frozen at and the deviation names the file as it is. That of 2026-10-29 (`0169`, variant-7's rules), recorded apart
    // (V7), names the driver as it is.
    const before = { 'supabase/functions/agents/quotes_twin.ts': ['015f3af08ba852c372e6b0a9f9d6815999731bd3322e03c8b5f944cdac8f4544', '2b84a1ebbdc1172375ff7c783a463ce39e266c490b2256314eae8893b5548e68'] };
    const named = (f) => [...DOC.matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);
    for (const f of [
      `supabase/migrations/${M}`, 'supabase/functions/agents/quotes_twin.ts', 'supabase/functions/agents/revx_sim.ts',
      'supabase/functions/agents/quotes_weekend.ts',
    ]) expect([...named(f), ...v7Named(f)], f).toEqual(before[f] ? [...before[f], sha(f)] : [sha(f)]);
  });

  it("the code each rule needs exists; the live account's instance names weights only from 0178's instant (USDT-GBP alone), and the holding line only from 0176's instant", () => {
    const driver = read('supabase/functions/agents/quotes_twin.ts').toString('utf8');
    const live = read('supabase/functions/agents/quotes_live.ts').toString('utf8');
    expect(driver).toMatch(/\n {2}weights: \(v\) => \{/);
    expect(driver).toMatch(/\n {2}holdMin: \(v\) => \{/);
    const inst = /export const QUOTE_LIVE_INSTANCE: QuoteLiveInstance = \{([\s\S]*?)\n\};/.exec(live)?.[1] ?? '';
    expect(inst).toContain('agent_quote_live_config');
    // Davies, 2026-10-29 (docs/agents/reviews/2026-10-29-usdt-only-deviation.md): LIVE quotes USDT-GBP alone from 2026-10-29 22:30 UTC (0179).
    expect([...inst.matchAll(/weights/g)].length).toBe(1);
    expect(inst).toContain('weights: { from: QUOTE_LIVE_USDT_ONLY_FROM, book: { "USDC-GBP": 0, "USDT-GBP": 1 } },');
    expect(live).toContain('export const QUOTE_LIVE_USDT_ONLY_FROM = Date.parse("2026-10-29T22:30:00Z");');
    // Davies, 2026-10-29 (docs/agents/reviews/2026-10-29-holdmin-deviation.md): variant-6's rule (the £1 holding line, this
    // pre-registration's) goes to LIVE from 2026-10-29 22:00 UTC, with every running twin.
    expect([...inst.matchAll(/holdMin/g)].length).toBe(1);
    expect(inst).toContain('holdMin: { from: QUOTE_LIVE_HOLD_MIN_FROM, gbp: 1 },');
    expect(live).toContain('export const QUOTE_LIVE_HOLD_MIN_FROM = Date.parse("2026-10-29T22:00:00Z");');
  });
});
