// PR5-OPT's five twins on LIVE's rules from 2026-10-27 06:00 UTC ("Stablecoin quotes variant-4" to "-8", the USDT weightings last;
// docs/agents/reviews/2026-10-27-pr5-opt-twins-now-prereg.md): their rows as 0149 inserts them (the £600 LIVE twin's but for the
// id, name, place, tables, lease, start, rules' dates, one rule each and the pre-registration), 0148's three switched off, the
// rows the pre-registration shows, its first deviation in 0148's pre-registration, and the files it froze, by sha256.
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
const M = '0149_quote_twins_pr5_opt_now.sql';
const BASE = rowsOf('0141_quote_twins_relayout.sql').find((r) => r.id === 'live600');
const DOC = read('docs/agents/reviews/2026-10-27-pr5-opt-twins-now-prereg.md').toString('utf8');
const FIRST = read('docs/agents/reviews/2026-10-27-pr5-opt-twins-prereg.md').toString('utf8');
const S = '2026-10-27T06:00:00Z';

describe("PR5-OPT's five twins on LIVE's rules from 06:00", () => {
  it("are 0149's rows: the £600 LIVE twin's but for id, name, place, tables, lease, start, rules' dates and one rule each", () => {
    const like = (id, name, order, rule) => ({
      ...BASE, id, display_name: name, display_order: order, table_prefix: `agent_quote_twin_${id}`, lease: `quotes-twin-${id}`, start: S,
      rules: { fill: { model: 'at', from: S }, weekend: { from: S }, ...rule },
      prereg: 'docs/agents/reviews/2026-10-27-pr5-opt-twins-now-prereg.md', migration: '0149',
    });
    const rows = rowsOf(M);
    expect(rows).toEqual([
      like('o600no03', 'Stablecoin quotes variant-4', 41, { weights: { from: S, k: { '0.001': 1, '0.002': 1, '0.003': 0 } } }),
      like('o600hold1', 'Stablecoin quotes variant-5', 42, { holdMin: { from: S, gbp: 1 } }),
      like('o600usdt2', 'Stablecoin quotes variant-6', 43, { weights: { from: S, book: { 'USDC-GBP': 1, 'USDT-GBP': 2 } } }),
      like('o600usdt3', 'Stablecoin quotes variant-7', 44, { weights: { from: S, book: { 'USDC-GBP': 1, 'USDT-GBP': 3 } } }),
      like('o600usdt', 'Stablecoin quotes variant-8', 45, { weights: { from: S, book: { 'USDC-GBP': 0, 'USDT-GBP': 1 } } }),
    ]);
    // Three are 0148's rules from 06:00 rather than 10-29; the USDT weightings sit together (Davies, 2026-10-27:
    // "做好后variant-4和5与5和6替换，这样的话usdt比例大的放一起", then his final numbering): 0148's three are "-6", "-4" and "-5".
    const old = rowsOf('0148_quote_twins_pr5_opt.sql');
    const dated = (r) => JSON.parse(JSON.stringify(r.rules).replaceAll('2026-10-29T00:00:00Z', S));
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(['o600usdt2', 'o600no03', 'o600hold1'].map((id) => byId[id].rules)).toEqual(old.map(dated));
    expect(old.map((r) => r.display_name)).toEqual(['Stablecoin quotes variant-4', 'Stablecoin quotes variant-5', 'Stablecoin quotes variant-6']);
    for (const r of rows) expect([Number(r.capital_gbp), r.engine, r.gov, 'take' in r.rules], r.id).toEqual([600, 'pr5', 'account', false]);
    // The pre-registration shows the rows as the migration inserts them, and is frozen.
    const shown = [...DOC.matchAll(/```json\n(\{[^\n]*\})\n```/g)].map((m) => JSON.parse(m[1]));
    expect(shown).toEqual(rows);
    expect(DOC).toContain('**Status: FROZEN**');
  });

  it("switches 0148's three off and frees their names before the inserts, and touches no live table, capital or call", () => {
    const sql = sqlOf(M);
    const insert = sql.indexOf('insert into public.agent_quote_twin_specs');
    for (const id of ['live600usdt2', 'live600no03', 'live600hold1']) {
      const off = sql.indexOf(`set enabled = false\n where id = '${id}';`);
      expect([off > -1, off < insert, sql.indexOf(`where id = '${id}' and display_name = 'Stablecoin quotes variant-`) < insert], id).toEqual([true, true, true]);
    }
    expect(/capital_gbp\s*=|agent_quote_live_config|edge_calls|take_mode|weekend_mode|cron\./.test(sql)).toBe(false);
    for (const r of rowsOf(M)) expect(sql).toContain(`select public.create_quote_twin_tables('${r.id}');`);
  });

  it("is deviation 1 of 0148's pre-registration, which keeps its rows' blocks", () => {
    const dev = FIRST.slice(FIRST.indexOf('## 7. Deviations'));
    expect(dev).toContain('**Deviation 1 (2026-10-27, before the start; migration `0149`)');
    expect(dev).toContain('2026-10-27-pr5-opt-twins-now-prereg.md');
    expect(/```json/.test(dev)).toBe(false);
  });

  it('names the sha256 of each file it froze, once, and each file is that one', () => {
    const named = (f) => [...DOC.matchAll(new RegExp('\\| `' + f.replace(/[.]/g, '\\.') + '` \\| ([0-9a-f]{64}) \\|', 'g'))].map((m) => m[1]);
    for (const f of [
      `supabase/migrations/${M}`, 'supabase/functions/agents/quotes_twin.ts', 'supabase/functions/agents/revx_sim.ts',
      'supabase/functions/agents/quotes_weekend.ts',
    ]) expect(named(f), f).toEqual([sha(f)]);
  });

  it("answers a weighted book with no pounds 'already holds', where the live account's instance has no weights", () => {
    const live = read('supabase/functions/agents/quotes_live.ts').toString('utf8');
    expect(live).toMatch(/if \(weightsOn\(inst, d\.now\) && !\(cap > 0\)\) return \{ error: `the account already holds what /);
    const inst = /export const QUOTE_LIVE_INSTANCE: QuoteLiveInstance = \{([\s\S]*?)\n\};/.exec(live)?.[1] ?? '';
    expect(inst).toContain('agent_quote_live_config');
    expect(/weights|holdMin/.test(inst)).toBe(false);
  });
});
