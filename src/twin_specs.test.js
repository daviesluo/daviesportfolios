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
 * "variant-4", Davies 2026-10-09: the new p50x1 takes its name and place; 0109: back to "variant-3", p50x1 withdrawn).
 */
const RENAME = /update public\.agent_quote_twin_specs\s+set display_name = '([^']+)'\s+where id = '(\w+)' and display_name = '([^']+)';/g;
/** A row a later migration takes off, by its id (0109: p50x1, Davies 2026-10-09: "删掉 p50x1"), its tables dropped with it. */
const DELETE = /delete from public\.agent_quote_twin_specs\s+where id = '(\w+)';/g;
/**
 * Since 0141 (Davies, 2026-10-26): a rule added to a row that has none of that key, guarded on its absence (the £120 LIVE twin's
 * weekend); a row switched off (variant-3); rows left off the page but still running (`hidden`, the column 0141 adds).
 */
const RULE_ADD = /update public\.agent_quote_twin_specs\s+set rules = rules \|\| '(\{[^']*\})'::jsonb\s+where id = '(\w+)' and not \(rules \? '(\w+)'\);/g;
const OFF = /update public\.agent_quote_twin_specs\s+set enabled = false\s+where id = '(\w+)';/g;
const HIDE = /update public\.agent_quote_twin_specs\s+set hidden = (true|false)\s+where id in \(([^)]*)\);/g;
const ADD_HIDDEN = /alter table public\.agent_quote_twin_specs add column if not exists hidden boolean;/g;
/**
 * A rule's instant moved, guarded on the instant it replaces (0090: TAKE's take.from; 0154: the five PR5-OPT twins' rules), and
 * a row's start moved the same way (0154, Davies 2026-10-28: "修好了的话现在就开始").
 */
const RULE_MOVE_OP = /update public\.agent_quote_twin_specs\s+set rules = jsonb_set\(rules, '\{(\w+),from\}', '"([0-9T:Z-]+)"'::jsonb\)\s+where id = '(\w+)' and rules->'(\w+)'->>'from' = '([0-9T:Z-]+)';/g;
const START = /update public\.agent_quote_twin_specs\s+set start = '([0-9T:Z-]+)'\s+where id = '(\w+)' and start = '([0-9T:Z-]+)';/g;
/**
 * Since 0178 (Davies, 2026-10-29: LIVE on USDT-GBP alone, the twins with it): a rule replaced whole, guarded on the rule it
 * replaces (jsonb equality: the same keys and values in any order), and a row's place moved, guarded on the place it leaves.
 */
const RULE_SET = /update public\.agent_quote_twin_specs\s+set rules = jsonb_set\(rules, '\{(\w+)\}', '(\{[^']*\})'::jsonb\)\s+where id = '(\w+)' and rules->'(\w+)' = '(\{[^']*\})'::jsonb;/g;
const PLACE = /update public\.agent_quote_twin_specs\s+set display_order = (\d+)\s+where id = '(\w+)' and display_order = (\d+);/g;
/** A value with its keys sorted at every depth: two jsonb values are equal when these are. */
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const renames = FILES.flatMap((file) => [...sqlOf(file).matchAll(RENAME)].map((m) => ({ file, to: m[1], id: m[2], from: m[3] })));
const deletes = FILES.flatMap((file) => [...sqlOf(file).matchAll(DELETE)].map((m) => ({ file, id: m[1] })));
/**
 * What later migrations did to the rows, in the migrations' order and each file's: renames and deletes, as
 * docs/agents/backtests/twins/scripts/fixture.ts applies them.
 */
const OPS = FILES.flatMap((file) => [
  ...[...sqlOf(file).matchAll(RENAME)].map((m) => ({ at: m.index ?? 0, op: { kind: 'rename', to: m[1], id: m[2], from: m[3] } })),
  ...[...sqlOf(file).matchAll(DELETE)].map((m) => ({ at: m.index ?? 0, op: { kind: 'delete', id: m[1] } })),
  ...[...sqlOf(file).matchAll(RULE_ADD)].map((m) => ({ at: m.index ?? 0, op: { kind: 'rule', add: JSON.parse(m[1]), id: m[2], key: m[3] } })),
  ...[...sqlOf(file).matchAll(OFF)].map((m) => ({ at: m.index ?? 0, op: { kind: 'off', id: m[1] } })),
  ...[...sqlOf(file).matchAll(HIDE)].map((m) => ({ at: m.index ?? 0, op: { kind: 'hide', hidden: m[1] === 'true', ids: m[2].split(',').map((x) => x.trim().replace(/^'|'$/g, '')) } })),
  ...[...sqlOf(file).matchAll(RULE_MOVE_OP)].map((m) => ({ at: m.index ?? 0, op: { kind: 'move', key: m[1], to: m[2], id: m[3], from: m[5] } })),
  ...[...sqlOf(file).matchAll(START)].map((m) => ({ at: m.index ?? 0, op: { kind: 'start', to: m[1], id: m[2], from: m[3] } })),
  ...[...sqlOf(file).matchAll(RULE_SET)].map((m) => ({ at: m.index ?? 0, op: { kind: 'set', key: m[1], to: JSON.parse(m[2]), id: m[3], guard: m[4], from: JSON.parse(m[5]) } })),
  ...[...sqlOf(file).matchAll(PLACE)].map((m) => ({ at: m.index ?? 0, op: { kind: 'place', to: Number(m[1]), id: m[2], from: Number(m[3]) } })),
].sort((a, b) => a.at - b.at).map((x) => x.op));
/**
 * The rows as the migrations leave them: the first insert of an id stands (`on conflict do nothing`), each rename and
 * delete applied in the migrations' order, in the page's order.
 */
const ROWS = OPS.reduce((rows, n) => n.kind === 'delete' ? rows.filter((r) => r.id !== n.id)
  : n.kind === 'rule' ? rows.map((r) => (r.id === n.id && !(n.key in (r.rules ?? {})) ? { ...r, rules: { ...(r.rules ?? {}), ...n.add } } : r))
  : n.kind === 'off' ? rows.map((r) => (r.id === n.id ? { ...r, enabled: false } : r))
  : n.kind === 'hide' ? rows.map((r) => (n.ids.includes(r.id) ? { ...r, hidden: n.hidden } : r))
  : n.kind === 'move' ? rows.map((r) => (r.id === n.id && r.rules?.[n.key]?.from === n.from ? { ...r, rules: { ...r.rules, [n.key]: { ...r.rules[n.key], from: n.to } } } : r))
  : n.kind === 'start' ? rows.map((r) => (r.id === n.id && Date.parse(r.start) === Date.parse(n.from) ? { ...r, start: n.to } : r))
  : n.kind === 'set' ? rows.map((r) => (r.id === n.id && n.key === n.guard && canon(r.rules?.[n.key]) === canon(n.from) ? { ...r, rules: { ...r.rules, [n.key]: n.to } } : r))
  : n.kind === 'place' ? rows.map((r) => (r.id === n.id && r.display_order === n.from ? { ...r, display_order: n.to } : r))
  : rows.map((r) => (n.id === r.id && n.from === r.display_name ? { ...r, display_name: n.to } : r)),
inserted.filter((x, i) => inserted.findIndex((y) => y.row.id === x.row.id) === i).map((x) => ({ ...x.row })))
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

  it('are touched by no migration in any other way than 0088 creates them, a migration inserts them, moves one rule date, renames one, or takes one off', () => {
    for (const f of FILES) {
      const sql = sqlOf(f);
      const named = (sql.match(/agent_quote_twin_specs/g) ?? []).length;
      const inserts = [...sql.matchAll(INSERT)].length;
      const moves = [...sql.matchAll(RULE_MOVE)].length + [...sql.matchAll(START)].length;
      const names = [...sql.matchAll(RENAME)].length;
      const offs = [...sql.matchAll(DELETE)].length;
      const later = [RULE_ADD, OFF, HIDE, ADD_HIDDEN, RULE_SET, PLACE].reduce((a, re) => a + [...sql.matchAll(re)].length, 0);
      // An insert names the table twice; 0088 also creates it, enables its row level security, and its function reads it
      // (its type, its select and its refusal). A pre-registration's addendum may move one rule's date of one row, guarded
      // on the date it replaces (0090: TAKE's take.from, its Addendum 1): that names it once. A page name may change,
      // guarded on the name it replaces (0108, 0109, 0130, 0141): once. A row may be taken off by its id (0109): once.
      // 0141 adds `hidden`, one rule to one row, switches one row off and hides four: once each. 0154 moves five rows' start
      // and their rules' instants, each guarded on the value it replaces: once each. 0170 does the same for variant-7 and its
      // control (Davies, 2026-10-29: "你新做好的两个测试策略现在就上线"). 0176 adds one rule to each of eleven rows, switches one
      // off, hides it and renames five: once each. 0178 adds a rule to five rows, replaces one in two, switches three off, hides two,
      // renames five, moves one row's place and inserts one: once each (twice the insert).
      expect(named, f).toBe(2 * inserts + moves + names + offs + later + (f === SPECS_0088 ? 5 : 0));
    }
    expect(FILES.filter((f) => [RULE_ADD, OFF, HIDE, ADD_HIDDEN].some((re) => [...sqlOf(f).matchAll(re)].length)).map((f) => f.slice(0, 4))).toEqual(['0141', '0142', '0144', '0149', '0151', '0152', '0167', '0176', '0178', '0181', '0190']);
    expect(FILES.filter((f) => [RULE_SET, PLACE].some((re) => [...sqlOf(f).matchAll(re)].length)).map((f) => f.slice(0, 4))).toEqual(['0178', '0180']);
    // A rule is replaced only under its own key, and every replacement and move parses (each `jsonb_set(rules, '{key}'` is one).
    for (const n of OPS.filter((x) => x.kind === 'set')) expect(n.guard, n.id).toBe(n.key);
    for (const f of FILES) expect([...sqlOf(f).matchAll(RULE_SET)].length, f).toBe((sqlOf(f).match(/jsonb_set\(rules, '\{\w+\}'/g) ?? []).length);
    expect(FILES.filter((f) => [...sqlOf(f).matchAll(RULE_MOVE)].length).map((f) => f.slice(0, 4))).toEqual(['0090', '0154', '0170', '0179']);
    expect(FILES.filter((f) => [...sqlOf(f).matchAll(START)].length).map((f) => f.slice(0, 4))).toEqual(['0154', '0170', '0179']);
    // Every rule move matches the parser that applies it.
    for (const f of FILES) expect([...sqlOf(f).matchAll(RULE_MOVE_OP)].length, f).toBe([...sqlOf(f).matchAll(RULE_MOVE)].length);
    expect(renames.map((n) => [n.file.slice(0, 4), n.id, n.from, n.to])).toEqual([
      ['0108', 'd', 'Stablecoin quotes variant-3', 'Stablecoin quotes variant-4'], ['0109', 'd', 'Stablecoin quotes variant-4', 'Stablecoin quotes variant-3'],
      ['0130', 'd', 'Stablecoin quotes variant-3', 'Stablecoin quotes variant-4'],
      ['0141', 'take50', 'Stablecoin quotes variant-2', 'Stablecoin quotes TAKE'], ['0141', 'p50', 'Stablecoin quotes variant-1', 'Stablecoin quotes size twin'],
      ['0141', 'live', 'Stablecoin quotes LIVE twin', 'Stablecoin quotes variant-2'],
      ['0142', 'take50wk', 'Stablecoin quotes variant-3', 'Stablecoin quotes weekend twin'], ['0142', 'take50', 'Stablecoin quotes TAKE', 'Stablecoin quotes variant-3'],
      ['0144', 'live300', 'Stablecoin quotes LIVE twin', 'Stablecoin quotes 300 twin'], ['0144', 'live600', 'Stablecoin quotes variant-1', 'Stablecoin quotes LIVE twin'],
      ['0148', 'd', 'Stablecoin quotes variant-4', 'Stablecoin quotes rule-D twin'],
      ['0149', 'live600usdt2', 'Stablecoin quotes variant-4', 'Stablecoin quotes USDT 2:1 from 10-29'],
      ['0149', 'live600no03', 'Stablecoin quotes variant-5', 'Stablecoin quotes no 0.3 % from 10-29'],
      ['0149', 'live600hold1', 'Stablecoin quotes variant-6', 'Stablecoin quotes hold £1 from 10-29'],
      ['0152', 'o600no03', 'Stablecoin quotes variant-4', 'Stablecoin quotes no 0.3 % from 10-27'],
      ['0152', 'o600hold1', 'Stablecoin quotes variant-5', 'Stablecoin quotes hold £1 from 10-27'],
      ['0152', 'o600usdt2', 'Stablecoin quotes variant-6', 'Stablecoin quotes USDT 2:1 from 10-27'],
      ['0152', 'o600usdt3', 'Stablecoin quotes variant-7', 'Stablecoin quotes USDT 3:1 from 10-27'],
      ['0152', 'o600usdt', 'Stablecoin quotes variant-8', 'Stablecoin quotes USDT only from 10-27'],
      ['0167', 'live', 'Stablecoin quotes variant-2', 'Stablecoin quotes £120 twin'], ['0167', 'n600usdt2', 'Stablecoin quotes variant-6', 'Stablecoin quotes USDT 2:1 from 10-28'],
      ['0167', 'take50', 'Stablecoin quotes variant-3', 'Stablecoin quotes variant-2'], ['0167', 'n600no03', 'Stablecoin quotes variant-4', 'Stablecoin quotes variant-3'],
      ['0167', 'n600hold1', 'Stablecoin quotes variant-5', 'Stablecoin quotes variant-4'], ['0167', 'n600usdt3', 'Stablecoin quotes variant-7', 'Stablecoin quotes variant-5'],
      ['0167', 'n600usdt', 'Stablecoin quotes variant-8', 'Stablecoin quotes variant-6'],
      // 0176 (Davies, 2026-10-29: "…并且把variant-4删了，之后的数字都-1"): variant-4 named for what it was, the rest down by one.
      ['0176', 'n600hold1', 'Stablecoin quotes variant-4', 'Stablecoin quotes hold £1 from 10-28'],
      ['0176', 'n600usdt3', 'Stablecoin quotes variant-5', 'Stablecoin quotes variant-4'], ['0176', 'n600usdt', 'Stablecoin quotes variant-6', 'Stablecoin quotes variant-5'],
      ['0176', 'u300nudge', 'Stablecoin quotes variant-7', 'Stablecoin quotes variant-6'], ['0176', 'live600x1', 'Stablecoin quotes variant-8', 'Stablecoin quotes variant-7'],
      // 0178 (Davies, 2026-10-29: LIVE on USDT-GBP alone; "原 variant-5 …这个可以删了"; "原 variant-7 …在…USDC:USDT 1:1…这个基础上做"):
      // the 3:1 twin and the $300 nudge named for what they were, the rest down the chain, the LIVE twin named as LIVE is.
      ['0178', 'n600usdt3', 'Stablecoin quotes variant-4', 'Stablecoin quotes USDT 3:1 from 10-28'],
      ['0178', 'u300nudge', 'Stablecoin quotes variant-6', 'Stablecoin quotes USDC nudge $300 from 10-29'],
      ['0178', 'n600usdt', 'Stablecoin quotes variant-5', 'Stablecoin quotes variant-4'], ['0178', 'live600x1', 'Stablecoin quotes variant-7', 'Stablecoin quotes variant-6'],
      ['0178', 'live600', 'Stablecoin quotes LIVE twin', 'Stablecoin quotes USDT/GBP LIVE twin'],
      // 0181 (Davies, 2026-10-29: "加进 LIVE"): variant-6's rule on LIVE and its twins; variant-6 named for what it was, the last variant.
      ['0181', 'live600x1', 'Stablecoin quotes variant-6', 'Stablecoin quotes exit +1 tick from 10-29'],
    ]);
    expect(deletes.map((n) => [n.file.slice(0, 4), n.id])).toEqual([['0109', 'p50x1']]);
    // Names are unique, so a rename comes before an insert in the same migration that takes the old name (0108), and a
    // delete before a rename that takes the deleted row's name (0109); every name as the rows stand is distinct.
    const sql0108 = sqlOf('0108_quote_twin_p50x1.sql'), sql0109 = sqlOf('0109_quote_twin_p50x1_off.sql'), sql0130 = sqlOf('0130_quote_twin_take50wk.sql');
    const sql0141 = sqlOf('0141_quote_twins_relayout.sql');
    expect(sql0108.search(RENAME)).toBeLessThan(sql0108.search(INSERT));
    expect(sql0130.search(RENAME)).toBeLessThan(sql0130.search(INSERT));
    // 0141: each rename frees the name the next takes (variant-2, then variant-1, then LIVE twin), all before its insert;
    // and the column comes before the rows that set it.
    const at = (t) => sql0141.indexOf(t);
    expect(at("set display_name = 'Stablecoin quotes TAKE'")).toBeLessThan(at("set display_name = 'Stablecoin quotes variant-2'"));
    expect(at("set display_name = 'Stablecoin quotes size twin'")).toBeLessThan(sql0141.search(INSERT));
    expect(at("set display_name = 'Stablecoin quotes variant-2'")).toBeLessThan(sql0141.search(INSERT));
    expect(sql0141.search(ADD_HIDDEN)).toBeLessThan(sql0141.search(HIDE));
    // 0142 (Davies, 2026-10-26: "那这个加到variant-3吧"): the switched-off weekend twin gives up "variant-3" before TAKE's twin
    // takes it, and TAKE's twin comes back on the page.
    const sql0142 = sqlOf('0142_quote_twins_take50_cb_usdc.sql');
    expect(sql0142.indexOf("set display_name = 'Stablecoin quotes weekend twin'")).toBeLessThan(sql0142.indexOf("set display_name = 'Stablecoin quotes variant-3'"));
    expect(sql0142).toContain("set hidden = false\n where id in ('take50');");
    // 0144 (Davies, 2026-10-27: LIVE at £600): the £300 twin gives up "LIVE twin" before the £600 twin takes it, which gives up
    // "variant-1" before the £1,200 twin's insert takes it; no twin's capital changes.
    const sql0144 = sqlOf('0144_quote_twins_live_at_600.sql');
    expect(sql0144.indexOf("set display_name = 'Stablecoin quotes 300 twin'")).toBeLessThan(sql0144.indexOf("set display_name = 'Stablecoin quotes LIVE twin'"));
    expect(sql0144.indexOf("set display_name = 'Stablecoin quotes LIVE twin'")).toBeLessThan(sql0144.search(INSERT));
    expect(/capital_gbp\s*=/.test(sql0144)).toBe(false);
    // 0148 (PR5-OPT, 2026-10-27): rule D's hidden twin gives up "variant-4" before the first of the three new rows takes it.
    const sql0148 = sqlOf('0148_quote_twins_pr5_opt.sql');
    expect(sql0148.indexOf("set display_name = 'Stablecoin quotes rule-D twin'")).toBeLessThan(sql0148.search(INSERT));
    // 0149 (Davies, 2026-10-27: "现在就开始"): 0148's three give up "variant-4" to "-6" and are switched off before the five
    // rows from 06:00 take those names and two more; no twin's capital changes.
    const sql0149 = sqlOf('0149_quote_twins_pr5_opt_now.sql');
    for (const id of ['live600usdt2', 'live600no03', 'live600hold1']) {
      expect(sql0149.indexOf(`where id = '${id}' and display_name`), id).toBeLessThan(sql0149.search(INSERT));
      expect(sql0149.indexOf(`set enabled = false\n where id = '${id}';`), id).toBeGreaterThan(-1);
      expect(sql0149.indexOf(`set enabled = false\n where id = '${id}';`), id).toBeLessThan(sql0149.search(INSERT));
    }
    expect(/capital_gbp\s*=/.test(sql0149)).toBe(false);
    // 0152 (2026-10-28, the five's pre-registration's deviation 1): 0149's five give up "variant-4" to "-8" and are switched off
    // before the five from 2026-10-29 06:00 take those names; no twin's capital changes.
    const sql0152 = sqlOf('0152_quote_twins_pr5_opt_restart.sql');
    for (const id of ['o600no03', 'o600hold1', 'o600usdt2', 'o600usdt3', 'o600usdt']) {
      expect(sql0152.indexOf(`where id = '${id}' and display_name`), id).toBeGreaterThan(-1);
      expect(sql0152.indexOf(`where id = '${id}' and display_name`), id).toBeLessThan(sql0152.search(INSERT));
      expect(sql0152.indexOf(`set enabled = false\n where id = '${id}';`), id).toBeGreaterThan(-1);
      expect(sql0152.indexOf(`set enabled = false\n where id = '${id}';`), id).toBeLessThan(sql0152.search(INSERT));
    }
    expect(/capital_gbp\s*=/.test(sql0152)).toBe(false);
    // 0167 (Davies, 2026-10-29: "变体2直接删了吧 / 变体 7隐藏 / 数字依然用变体1-6", then "还是这个隐藏吧，变体 5改为变体 7"): variant-2 (`live`)
    // switched off and hidden, the USDT 2:1 twin (`n600usdt2`) hidden and still on, the USDT 3:1 twin variant-5; each rename follows the one that frees its name; no capital, place or rule changes.
    const sql0167 = sqlOf('0167_quote_twins_renumber.sql');
    const from0167 = (t) => sql0167.indexOf(`set display_name = '${t}'`);
    expect(from0167('Stablecoin quotes £120 twin')).toBeLessThan(from0167('Stablecoin quotes variant-2'));
    expect(from0167('Stablecoin quotes variant-2')).toBeLessThan(from0167('Stablecoin quotes variant-3'));
    expect(from0167('Stablecoin quotes variant-3')).toBeLessThan(from0167('Stablecoin quotes variant-4'));
    expect(from0167('Stablecoin quotes variant-4')).toBeLessThan(from0167('Stablecoin quotes variant-5'));
    expect(from0167('Stablecoin quotes variant-5')).toBeLessThan(from0167('Stablecoin quotes variant-6'));
    expect(sql0167).toContain("set enabled = false\n where id = 'live';");
    expect(sql0167).toContain("set hidden = true\n where id in ('live', 'n600usdt2');");
    expect(/capital_gbp\s*=|display_order\s*=|rules\s*=/.test(sql0167)).toBe(false);
    // 0176 (Davies, 2026-10-29: "…并且把variant-4删了，之后的数字都-1"): variant-4 gives up its name before variant-5 takes it, and so
    // down the chain; it is switched off and hidden; the holding line is added to rows' rules, nothing else of a row changes.
    const sql0176 = sqlOf('0176_quote_twins_hold_min.sql');
    const from0176 = (t) => sql0176.indexOf(`set display_name = '${t}'`);
    expect(from0176('Stablecoin quotes hold £1 from 10-28')).toBeLessThan(from0176('Stablecoin quotes variant-4'));
    expect(from0176('Stablecoin quotes variant-4')).toBeLessThan(from0176('Stablecoin quotes variant-5'));
    expect(from0176('Stablecoin quotes variant-5')).toBeLessThan(from0176('Stablecoin quotes variant-6'));
    expect(from0176('Stablecoin quotes variant-6')).toBeLessThan(from0176('Stablecoin quotes variant-7'));
    expect(sql0176).toContain("set enabled = false\n where id = 'n600hold1';");
    expect(sql0176).toContain("set hidden = true\n where id in ('n600hold1');");
    expect(/capital_gbp\s*=|display_order\s*=/.test(sql0176)).toBe(false);
    expect((sql0176.match(/set rules = /g) ?? []).length).toBe((sql0176.match(/set rules = rules \|\| '\{"holdMin": /g) ?? []).length);
    expect((sql0176.match(/set rules = /g) ?? []).length).toBe(11);
    // 0178 (Davies, 2026-10-29: LIVE on USDT-GBP alone, the twins on its new rules): each rename after the one that frees its name,
    // the place 52 freed before the new variant-5 takes it, and its name freed before its insert; no capital changes.
    const sql0178 = sqlOf('0178_quote_twins_usdt_only.sql');
    const from0178 = (t) => sql0178.indexOf(`set display_name = '${t}'`);
    expect(from0178('Stablecoin quotes USDT 3:1 from 10-28')).toBeLessThan(from0178('Stablecoin quotes variant-4'));
    expect(from0178('Stablecoin quotes USDC nudge $300 from 10-29')).toBeLessThan(from0178('Stablecoin quotes variant-6'));
    expect(from0178('Stablecoin quotes variant-4')).toBeLessThan(sql0178.search(INSERT));
    expect(sql0178.indexOf('set display_order = 56')).toBeLessThan(sql0178.search(INSERT));
    for (const id of ['n600usdt3', 'u300nudge', 'u300ctl']) expect(sql0178).toContain(`set enabled = false\n where id = '${id}';`);
    expect(sql0178).toContain("set hidden = true\n where id in ('n600usdt3', 'u300nudge');");
    expect(/capital_gbp\s*=/.test(sql0178)).toBe(false);
    // 0181: seven rows take the exit offset; variant-6 and its control off, variant-6 hidden, renamed before it goes off.
    const sql0181 = sqlOf('0181_quote_twins_exit_tick.sql');
    expect((sql0181.match(/set rules = /g) ?? []).length).toBe((sql0181.match(/set rules = rules \|\| '\{"exitOffset": /g) ?? []).length);
    expect((sql0181.match(/set rules = /g) ?? []).length).toBe(7);
    for (const id of ['live600x1', 'live600ctl']) expect(sql0181).toContain(`set enabled = false\n where id = '${id}';`);
    expect(sql0181).toContain("set hidden = true\n where id in ('live600x1');");
    expect(/capital_gbp\s*=|display_order\s*=/.test(sql0181)).toBe(false);
    expect(sql0109.search(DELETE)).toBeGreaterThanOrEqual(0);
    expect(sql0109.search(DELETE)).toBeLessThan(sql0109.search(RENAME));
    expect(new Set(ROWS.map((r) => r.display_name)).size).toBe(ROWS.length);
    // A row taken off takes its six tables and its lease with it, in the same migration, after the row.
    for (const n of deletes) {
      const sql = sqlOf(n.file);
      for (const t of ['config', 'orders', 'events', 'state', 'paper', 'sim']) {
        expect(sql.indexOf(`public.agent_quote_twin_${n.id}_${t}`), `${n.id}_${t}`).toBeGreaterThan(sql.search(DELETE));
      }
      expect(/drop table if exists\s+public\.agent_quote_twin_/.test(sql), n.id).toBe(true);
      expect(sql.includes(`delete from public.agent_locks where name = 'quotes-twin-${n.id}';`), n.id).toBe(true);
    }
  });

  it("are, as they stand, the stablecoin twins in Davies' order (2026-10-27, renumbered 0167, 0176 and 0178 on 10-29: the USDT/GBP LIVE twin £600 as LIVE, variant-1 £1,200 the next step, variant-2 TAKE's twin, variant-3 PR5-OPT's no-0.3 %, variant-4 USDC:USDT 1:1 and variant-5 the same with the USDC-GBP nudge, variant-6 the exit a tick beyond; all on LIVE's USDT-GBP alone from 2026-10-30 00:00 but the two on both books; the rest off or hidden)", () => {
    expect(ROWS.map((r) => [r.id, r.display_name, r.display_order, Number(r.capital_gbp), r.enabled, r.hidden === true])).toEqual([
      ['pr5', 'Stablecoin quotes', 10, 1200, false, true], ['live300', 'Stablecoin quotes 300 twin', 11, 300, false, false],
      ['live600', 'Stablecoin quotes USDT/GBP LIVE twin', 12, 600, true, false],
      // 0180 (Davies, 2026-10-29: "testing列表中Stablecoin quotes USDT/GBP LIVE twin底下也做一个usdc的twin"): right under it, the £1,200 twin moved down a place.
      ['rxu120', 'Stablecoin quotes USDC/GBP LIVE twin', 13, 120, true, false], ['live1200', 'Stablecoin quotes variant-1', 14, 1200, true, false],
      ['live', 'Stablecoin quotes £120 twin', 15, 120, false, true],
      ['p50', 'Stablecoin quotes size twin', 20, 600, false, true], ['take50', 'Stablecoin quotes variant-2', 30, 600, true, false],
      ['live600usdt2', 'Stablecoin quotes USDT 2:1 from 10-29', 31, 600, false, false], ['live600no03', 'Stablecoin quotes no 0.3 % from 10-29', 32, 600, false, false],
      ['live600hold1', 'Stablecoin quotes hold £1 from 10-29', 33, 600, false, false],
      ['take50wk', 'Stablecoin quotes weekend twin', 35, 600, false, false], ['d', 'Stablecoin quotes rule-D twin', 40, 1800, false, true],
      ['o600no03', 'Stablecoin quotes no 0.3 % from 10-27', 41, 600, false, false], ['o600hold1', 'Stablecoin quotes hold £1 from 10-27', 42, 600, false, false],
      ['o600usdt2', 'Stablecoin quotes USDT 2:1 from 10-27', 43, 600, false, false], ['o600usdt3', 'Stablecoin quotes USDT 3:1 from 10-27', 44, 600, false, false],
      ['o600usdt', 'Stablecoin quotes USDT only from 10-27', 45, 600, false, false], ['n600no03', 'Stablecoin quotes variant-3', 46, 600, true, false],
      // 0176 (Davies, 2026-10-29): variant-4 (the £1 holding line's own twin) off and hidden, its rule now everyone's; the rest down by one.
      ['n600hold1', 'Stablecoin quotes hold £1 from 10-28', 47, 600, false, true], ['n600usdt2', 'Stablecoin quotes USDT 2:1 from 10-28', 48, 600, true, true],
      // 0178 (Davies, 2026-10-29: "原 variant-5 …这个可以删了"): the USDT 3:1 twin off and hidden; the USDT-only twin now USDC:USDT 1:1.
      ['n600usdt3', 'Stablecoin quotes USDT 3:1 from 10-28', 49, 600, false, true], ['n600usdt', 'Stablecoin quotes variant-4', 50, 600, true, false],
      // 0169's $300 nudge and its control, off since 0178 (the nudge goes on at £600 on the 1:1 twin's rules, `n600nudge`).
      ['u300nudge', 'Stablecoin quotes USDC nudge $300 from 10-29', 51, 225.33, false, true],
      ['n600nudge', 'Stablecoin quotes variant-5', 52, 600, true, false],
      // 0175 (Davies, 2026-10-29: REVX-LAG's one pass, "好的，建 variant-8，在实盘live的基础上"): LIVE's rules with every exit a tick beyond fair, and its control, hidden.
      // 0181 (Davies, 2026-10-29: "加进 LIVE"): its rule on LIVE and every twin on LIVE's rules from 10-30 00:00; it and its control off.
      ['live600x1', 'Stablecoin quotes exit +1 tick from 10-29', 53, 600, false, true], ['live600ctl', 'Stablecoin quotes LIVE control from 10-29', 54, 600, false, true],
      ['u300ctl', 'Stablecoin quotes USDC control from 10-30', 56, 225.33, false, true],
    ]);
    const onPage = ROWS.filter((r) => r.enabled && !r.hidden);
    expect(onPage.map((r) => r.id)).toEqual(['live600', 'rxu120', 'live1200', 'take50', 'n600no03', 'n600usdt', 'n600nudge']);
    // TAKE's twin keeps its own rule (a take from 2026-10-04 16:00); LIVE's twin takes as LIVE does from the minute LIVE's take
    // went live (0190, Davies 2026-10-31: "同意"); the others on LIVE's rules do not take. The two first carry LIVE's fill rule
    // and, from the closure of 2026-10-30 21:00 UTC, LIVE's weekend.
    expect(onPage.find((r) => r.id === 'take50').rules.take).toBeTruthy();
    for (const r of onPage.filter((x) => x.id === 'live600' || x.id === 'live1200')) {
      expect([r.rules.fill.model, r.rules.weekend.from, 'take' in r.rules], r.id).toEqual(['at', '2026-10-30T21:00:00Z', r.id === 'live600']);
    }
    expect(onPage.find((r) => r.id === 'live600').rules.take).toEqual({ from: '2026-10-31T02:10:43Z' });
    // 0178 (Davies, 2026-10-29: "把live全换成只做USDT-GBP的…variant-1，2，3，5，7和8也改为在新的实盘基础上做"): LIVE's weights at LIVE's own instant
    // (QUOTE_LIVE_USDT_ONLY_FROM) on every twin on LIVE's rules, both arms of the exit-tick test together; variant-3 keeps its
    // 0.3 % rung at 0 within them; variant-4 and variant-5 USDC:USDT 1:1 from the same instant.
    const U = '2026-10-29T22:30:00Z', ONLY = { 'USDC-GBP': 0, 'USDT-GBP': 1 }, BOTH = { 'USDC-GBP': 1, 'USDT-GBP': 1 };
    const byId = (id) => ROWS.find((r) => r.id === id);
    for (const id of ['live600', 'live1200', 'take50', 'live600x1', 'live600ctl']) expect(byId(id).rules.weights, id).toEqual({ from: U, book: ONLY });
    expect(byId('n600no03').rules.weights).toEqual({ from: U, book: ONLY, k: { '0.001': 1, '0.002': 1, '0.003': 0 } });
    for (const id of ['n600usdt', 'n600nudge']) expect(byId(id).rules.weights, id).toEqual({ from: U, book: BOTH });
    // The hidden USDT 2:1 twin keeps its own weights from 10-28.
    const S = '2026-10-28T22:00:00Z';
    expect(byId('n600usdt2').rules.weights).toEqual({ from: S, book: { 'USDC-GBP': 1, 'USDT-GBP': 2 } });
    // Variant-5 is variant-4's rules from its start with the nudge (0169's) on USDC-GBP: the 1:1 twin is its control.
    const [nn, ctl] = ['n600nudge', 'n600usdt'].map(byId);
    expect([nn.start, nn.rules.fill, nn.rules.weekend.from, nn.rules.holdMin, Number(nn.capital_gbp)]).toEqual([U, { model: 'at', from: U }, U, { from: U, gbp: 1 }, Number(ctl.capital_gbp)]);
    expect(nn.rules.fairNudge).toEqual({ from: U, book: 'USDC-GBP', w: 0.5, halfLifeMin: 1440 });
    expect(Object.keys(nn.rules).sort()).toEqual(['exitOffset', 'fairNudge', 'fill', 'holdMin', 'weekend', 'weights']);
    expect(Object.keys(ctl.rules).sort()).toEqual(['exitOffset', 'fill', 'holdMin', 'weekend', 'weights']);
    expect([ctl.rules.fill.model, ctl.rules.weekend.from, ctl.rules.holdMin.gbp]).toEqual(['at', S, 1]);
    // 0175's variant-8 (variant-6 since 0178) and its hidden control: £600, LIVE's fill rule from their start (2026-10-29 19:00),
    // LIVE's weekend from the LIVE twin's own instant, the offset on variant-6 alone, the same weights.
    const X = '2026-10-29T19:00:00Z';
    const live600 = byId('live600');
    const [x1, xctl] = ['live600x1', 'live600ctl'].map(byId);
    for (const r of [x1, xctl]) {
      expect([r.start, r.rules.fill, r.rules.weekend, Number(r.capital_gbp), 'take' in r.rules, r.rules.weights], r.id)
        .toEqual([X, { model: 'at', from: X }, live600.rules.weekend, Number(live600.capital_gbp), false, live600.rules.weights]);
    }
    expect(x1.rules.exitOffset).toEqual({ ticks: 1, from: X });
    expect('exitOffset' in xctl.rules).toBe(false);
    // 0176 (Davies, 2026-10-29: "…加入实盘live的规则里和所有测试策略包括所有variant里"): every twin running then took variant-4's £1
    // holding line at LIVE's own instant (QUOTE_LIVE_HOLD_MIN_FROM); 0178's new twin has it from its start.
    const H = { from: '2026-10-29T22:00:00Z', gbp: 1 };
    const running = ROWS.filter((r) => r.enabled);
    expect(running.map((r) => r.id)).toEqual(['live600', 'rxu120', 'live1200', 'take50', 'n600no03', 'n600usdt2', 'n600usdt', 'n600nudge']);
    for (const r of running.filter((x) => x.id !== 'n600nudge' && x.id !== 'rxu120')) expect(r.rules.holdMin, r.id).toEqual(H);
    // 0180's USDC/GBP LIVE twin: the USDC/GBP executor's rules (`QUOTE_RXU_INSTANCE`) on £120 from 2026-10-30 00:00: LIVE's fill rule,
    // the weekend, the £1 line, USDC-GBP alone with the 0.3 % rungs at 0, and every exit a tick beyond fair.
    const R0 = '2026-10-30T00:00:00Z', rx = byId('rxu120');
    expect([rx.start, Number(rx.capital_gbp), rx.rules]).toEqual([R0, 120, {
      fill: { model: 'at', from: R0 }, weekend: { from: R0 }, holdMin: { from: R0, gbp: 1 },
      weights: { from: R0, book: { 'USDC-GBP': 1, 'USDT-GBP': 0 }, k: { '0.001': 1, '0.002': 1, '0.003': 0 } }, exitOffset: { from: R0, ticks: 1 },
    }]);
    const executor = read('supabase/functions/agents/quotes_live.ts').toString('utf8');
    expect(executor).toContain('weights: { from: 0, book: { "USDC-GBP": 1, "USDT-GBP": 0 }, k: { "0.003": 0 } },');
    expect(executor).toContain('exitOffset: { ticks: 1, from: 0 },');
    expect(byId('n600hold1').rules.holdMin).toEqual({ from: S, gbp: 1 });
    const live = read('supabase/functions/agents/quotes_live.ts').toString('utf8');
    expect(live).toContain(`export const QUOTE_LIVE_HOLD_MIN_FROM = Date.parse("${H.from}");`);
    expect(live).toContain(`export const QUOTE_LIVE_USDT_ONLY_FROM = Date.parse("${U}");`);
    expect(live).toContain('weights: { from: QUOTE_LIVE_USDT_ONLY_FROM, book: { "USDC-GBP": 0, "USDT-GBP": 1 } },');
    // 0181 (Davies, 2026-10-29 ~23:00 UTC: "加进 LIVE"): variant-6's exit a tick beyond fair at LIVE's own instant
    // (QUOTE_LIVE_EXIT_OFFSET_FROM) on every running twin on LIVE's rules; rxu120 has had it from its start.
    const X1 = { from: '2026-10-30T00:00:00Z', ticks: 1 };
    for (const r of running.filter((x) => x.id !== 'rxu120')) expect(r.rules.exitOffset, r.id).toEqual(X1);
    expect(live).toContain(`export const QUOTE_LIVE_EXIT_OFFSET_FROM = Date.parse("${X1.from}");`);
    expect(live).toContain('exitOffset: { ticks: 1, from: QUOTE_LIVE_EXIT_OFFSET_FROM },');
  });

  it("make the browser test's fixture as they stand: every enabled row, in the page's order, a hidden one too (it still runs)", () => {
    const enabled = ROWS.filter((r) => r.enabled);
    expect(fixture.specs).toEqual(enabled);
    expect(fixture.twins.map((t) => [t.twin.id, t.twin.name, t.capitalGbp])).toEqual(enabled.map((r) => [r.id, r.display_name, Number(r.capital_gbp)]));
  });
});
