// The realistic twins are rows of `agent_quote_twin_specs` (0088, the twins' pre-registration's deviation 1): the call and
// the page read them, and a variant that differs only in its parameters is a migration's row and its tables, not code.
// This holds the rows to what the code and the browser test assume of them: the code's seed rows are 0088's; every row a
// migration inserts names its own tables and lease, an engine and governed keys the code has, a pre-registration and a
// backfill that exist (the backfill its own twin's, the bytes its row pins), and tables a migration made; migrations touch
// the table in no other way; and the browser test's fixture is made from the rows as they stand.
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import fixture from './e2e/quotes_twin_fixture.json';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p));
const sha = (p) => crypto.createHash('sha256').update(read(p)).digest('hex');
/** A migration's SQL without its comments (0088's comment gives the next variant's statements as an example). */
const sqlOf = (f) => read(`supabase/migrations/${f}`).toString('utf8').replace(/--[^\n]*/g, '');
const FILES = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const INSERT = /insert into public\.agent_quote_twin_specs\s+select \* from jsonb_populate_recordset\(null::public\.agent_quote_twin_specs, \$json\$(\[[\s\S]*?\])\$json\$::jsonb\)\s+on conflict \(id\) do nothing;/g;
const inserted = FILES.flatMap((file) => [...sqlOf(file).matchAll(INSERT)].flatMap((m) => JSON.parse(m[1]).map((row) => ({ file, row }))));
/**
 * A page name a later migration gives a row, guarded on the name it replaces (0108: rule D's twin "variant-3" to
 * "variant-4", Davies 2026-10-09: the new p50x1 takes its name and place).
 */
const RENAME = /update public\.agent_quote_twin_specs\s+set display_name = '([^']+)'\s+where id = '(\w+)' and display_name = '([^']+)';/g;
const renames = FILES.flatMap((file) => [...sqlOf(file).matchAll(RENAME)].map((m) => ({ file, to: m[1], id: m[2], from: m[3] })));
/**
 * The rows as the migrations leave them: the first insert of an id stands (`on conflict do nothing`), each rename applied
 * in the migrations' order, in the page's order.
 */
const ROWS = inserted.filter((x, i) => inserted.findIndex((y) => y.row.id === x.row.id) === i).map((x) => ({ ...x.row }))
  .map((r) => { for (const n of renames) if (n.id === r.id && n.from === r.display_name) r.display_name = n.to; return r; })
  .sort((a, b) => a.display_order - b.display_order);
const firstOf = (id) => inserted.find((x) => x.row.id === id);
const RULE_MOVE = /update public\.agent_quote_twin_specs\s+set rules = jsonb_set\(rules, '\{\w+,from\}', '"[0-9T:Z-]+"'::jsonb\)\s+where id = '\w+' and rules->'\w+'->>'from' = '[0-9T:Z-]+';/g;
const SPECS_0088 = FILES.find((f) => f.startsWith('0088_')) ?? '';

describe("the twins' spec rows", () => {
  it("are 0088's three first, and the code's seed rows are those, field for field", () => {
    const driver = read('supabase/functions/agents/quotes_twin.ts').toString('utf8');
    const seed = JSON.parse(/\/\* spec rows \*\/ (\[[\s\S]*?\]) \/\* end spec rows \*\//.exec(driver)?.[1] ?? '[]');
    expect(SPECS_0088).toBe('0088_quote_twin_specs.sql');
    expect(seed).toEqual(inserted.filter((x) => x.file === SPECS_0088).map((x) => x.row));
    expect(seed.map((r) => [r.id, r.display_name, r.display_order])).toEqual([
      ['pr5', 'Stablecoin quotes', 10], ['p50', 'Stablecoin quotes variant-1', 20], ['d', 'Stablecoin quotes variant-3', 40],
    ]);
  });

  it('each names its own tables and lease, what the code can run, and a pre-registration and a backfill that exist', () => {
    expect(ROWS.length).toBeGreaterThanOrEqual(3);
    for (const r of ROWS) {
      expect([r.table_prefix, r.lease], r.id).toEqual([`agent_quote_twin_${r.id}`, `quotes-twin-${r.id}`]);
      expect(r.id, r.id).toMatch(/^[a-z][a-z0-9]{0,15}$/);
      expect(['pr5', 'ruled-d'], r.id).toContain(r.engine);
      expect(['account', 'variant-keys'], r.id).toContain(r.gov);
      expect([Number(r.capital_gbp) > 0, Number.isFinite(Date.parse(r.start)), typeof r.enabled], r.id).toEqual([true, true, 'boolean']);
      expect(fs.existsSync(path.join(ROOT, r.prereg)), `${r.id}: ${r.prereg}`).toBe(true);
      if (r.backfill) {
        expect(sha(r.backfill.file), r.id).toBe(r.backfill.sha256);
        const data = JSON.parse(zlib.gunzipSync(read(r.backfill.file)).toString('utf8'));
        expect([data.v, data.twin, data.until, Number(data.config.capital_gbp)], r.id).toEqual([1, r.id, r.backfill.until, Number(r.capital_gbp)]);
      }
    }
  });

  it('each has tables a migration made: 0087 for its two, create_quote_twin_tables after its row for every other', () => {
    for (const r of ROWS) {
      const { file } = firstOf(r.id);
      expect(file.slice(0, 4) >= r.migration, r.id).toBe(true);
      if (r.migration === '0087') {
        expect(/foreach t in array array\[([^\]]*)\]/.exec(sqlOf('0087_quote_twins.sql'))?.[1], r.id).toContain(`'${r.id}'`);
      } else {
        const sql = sqlOf(file);
        expect(file.slice(0, 4), r.id).toBe(r.migration);
        expect(sql.indexOf(`select public.create_quote_twin_tables('${r.id}');`), r.id).toBeGreaterThan(sql.search(INSERT));
      }
    }
  });

  it('are touched by no migration in any other way than 0088 creates them, a migration inserts them, moves one rule date, or renames one', () => {
    for (const f of FILES) {
      const sql = sqlOf(f);
      const named = (sql.match(/agent_quote_twin_specs/g) ?? []).length;
      const inserts = [...sql.matchAll(INSERT)].length;
      const moves = [...sql.matchAll(RULE_MOVE)].length;
      const names = [...sql.matchAll(RENAME)].length;
      // An insert names the table twice; 0088 also creates it, enables its row level security, and its function reads it
      // (its type, its select and its refusal). A pre-registration's addendum may move one rule's date of one row, guarded
      // on the date it replaces (0090: TAKE's take.from, its Addendum 1): that names it once. A page name may change,
      // guarded on the name it replaces (0108): once.
      expect(named, f).toBe(2 * inserts + moves + names + (f === SPECS_0088 ? 5 : 0));
    }
    expect(FILES.filter((f) => [...sqlOf(f).matchAll(RULE_MOVE)].length).map((f) => f.slice(0, 4))).toEqual(['0090']);
    expect(renames.map((n) => [n.file.slice(0, 4), n.id, n.from, n.to])).toEqual([['0108', 'd', 'Stablecoin quotes variant-3', 'Stablecoin quotes variant-4']]);
    // A rename comes before an insert in the same migration that takes the old name (names are unique), and every name
    // as the rows stand is distinct.
    const sql0108 = sqlOf('0108_quote_twin_p50x1.sql');
    expect(sql0108.search(RENAME)).toBeLessThan(sql0108.search(INSERT));
    expect(new Set(ROWS.map((r) => r.display_name)).size).toBe(ROWS.length);
  });

  it("are, as they stand, the page's five stablecoin rows in Davies' order (2026-10-09: p50x1 in variant-3's place, rule D's twin variant-4 after it)", () => {
    expect(ROWS.map((r) => [r.id, r.display_name, r.display_order])).toEqual([
      ['pr5', 'Stablecoin quotes', 10], ['p50', 'Stablecoin quotes variant-1', 20], ['take50', 'Stablecoin quotes variant-2', 30],
      ['p50x1', 'Stablecoin quotes variant-3', 35], ['d', 'Stablecoin quotes variant-4', 40],
    ]);
  });

  it("make the browser test's fixture as they stand: every enabled row, in the page's order", () => {
    const enabled = ROWS.filter((r) => r.enabled);
    expect(fixture.specs).toEqual(enabled);
    expect(fixture.twins.map((t) => [t.twin.id, t.twin.name, t.capitalGbp])).toEqual(enabled.map((r) => [r.id, r.display_name, Number(r.capital_gbp)]));
  });
});
