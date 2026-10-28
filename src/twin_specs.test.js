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
      const later = [RULE_ADD, OFF, HIDE, ADD_HIDDEN].reduce((a, re) => a + [...sql.matchAll(re)].length, 0);
      // An insert names the table twice; 0088 also creates it, enables its row level security, and its function reads it
      // (its type, its select and its refusal). A pre-registration's addendum may move one rule's date of one row, guarded
      // on the date it replaces (0090: TAKE's take.from, its Addendum 1): that names it once. A page name may change,
      // guarded on the name it replaces (0108, 0109, 0130, 0141): once. A row may be taken off by its id (0109): once.
      // 0141 adds `hidden`, one rule to one row, switches one row off and hides four: once each. 0154 moves five rows' start
      // and their rules' instants, each guarded on the value it replaces: once each.
      expect(named, f).toBe(2 * inserts + moves + names + offs + later + (f === SPECS_0088 ? 5 : 0));
    }
    expect(FILES.filter((f) => [RULE_ADD, OFF, HIDE, ADD_HIDDEN].some((re) => [...sqlOf(f).matchAll(re)].length)).map((f) => f.slice(0, 4))).toEqual(['0141', '0142', '0144', '0149', '0151', '0152']);
    expect(FILES.filter((f) => [...sqlOf(f).matchAll(RULE_MOVE)].length).map((f) => f.slice(0, 4))).toEqual(['0090', '0154']);
    expect(FILES.filter((f) => [...sqlOf(f).matchAll(START)].length).map((f) => f.slice(0, 4))).toEqual(['0154']);
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

  it("are, as they stand, the stablecoin twins in Davies' order (2026-10-27: the LIVE twin £600 as LIVE, variant-1 £1,200 the next step, variant-2 the £120 twin, variant-3 TAKE's twin, variant-4 to -8 PR5-OPT's five, from 2026-10-29 06:00 since 0152, the USDT weightings last; the £300 and weekend twins, 0148's three and 0149's five off; the three hidden ones off since 0151, their 10-28 readouts written)", () => {
    expect(ROWS.map((r) => [r.id, r.display_name, r.display_order, Number(r.capital_gbp), r.enabled, r.hidden === true])).toEqual([
      ['pr5', 'Stablecoin quotes', 10, 1200, false, true], ['live300', 'Stablecoin quotes 300 twin', 11, 300, false, false],
      ['live600', 'Stablecoin quotes LIVE twin', 12, 600, true, false], ['live1200', 'Stablecoin quotes variant-1', 13, 1200, true, false],
      ['live', 'Stablecoin quotes variant-2', 15, 120, true, false],
      ['p50', 'Stablecoin quotes size twin', 20, 600, false, true], ['take50', 'Stablecoin quotes variant-3', 30, 600, true, false],
      ['live600usdt2', 'Stablecoin quotes USDT 2:1 from 10-29', 31, 600, false, false], ['live600no03', 'Stablecoin quotes no 0.3 % from 10-29', 32, 600, false, false],
      ['live600hold1', 'Stablecoin quotes hold £1 from 10-29', 33, 600, false, false],
      ['take50wk', 'Stablecoin quotes weekend twin', 35, 600, false, false], ['d', 'Stablecoin quotes rule-D twin', 40, 1800, false, true],
      ['o600no03', 'Stablecoin quotes no 0.3 % from 10-27', 41, 600, false, false], ['o600hold1', 'Stablecoin quotes hold £1 from 10-27', 42, 600, false, false],
      ['o600usdt2', 'Stablecoin quotes USDT 2:1 from 10-27', 43, 600, false, false], ['o600usdt3', 'Stablecoin quotes USDT 3:1 from 10-27', 44, 600, false, false],
      ['o600usdt', 'Stablecoin quotes USDT only from 10-27', 45, 600, false, false], ['n600no03', 'Stablecoin quotes variant-4', 46, 600, true, false],
      ['n600hold1', 'Stablecoin quotes variant-5', 47, 600, true, false], ['n600usdt2', 'Stablecoin quotes variant-6', 48, 600, true, false],
      ['n600usdt3', 'Stablecoin quotes variant-7', 49, 600, true, false], ['n600usdt', 'Stablecoin quotes variant-8', 50, 600, true, false],
    ]);
    // The page shows the three on LIVE's rules, each with LIVE's fill rule and, from the closure of 2026-10-30 21:00 UTC,
    // LIVE's weekend; none takes (LIVE's take is in shadow, which sends nothing).
    const onPage = ROWS.filter((r) => r.enabled && !r.hidden);
    expect(onPage.map((r) => r.id)).toEqual(['live600', 'live1200', 'live', 'take50', 'n600no03', 'n600hold1', 'n600usdt2', 'n600usdt3', 'n600usdt']);
    // TAKE's twin keeps its own rule (a take from 2026-10-04 16:00); the six on LIVE's rules do not take.
    expect(onPage[3].rules.take).toBeTruthy();
    for (const r of onPage.slice(0, 3)) {
      expect([r.rules.fill.model, r.rules.weekend.from, 'take' in r.rules], r.id).toEqual(['at', '2026-10-30T21:00:00Z', false]);
    }
    // PR5-OPT's five (0149, restarted by 0152, started at once by 0154): LIVE's fill rule and weekend from their start,
    // 2026-10-28 22:00, and one rule each from it.
    const S = '2026-10-28T22:00:00Z';
    for (const r of onPage.slice(4)) {
      expect([r.start, r.rules.fill.model, r.rules.fill.from, r.rules.weekend.from, 'take' in r.rules], r.id).toEqual([S, 'at', S, S, false]);
    }
    expect(onPage.slice(4).map((r) => Object.keys(r.rules).filter((k) => k !== 'fill' && k !== 'weekend'))).toEqual([['weights'], ['holdMin'], ['weights'], ['weights'], ['weights']]);
    expect(onPage.slice(4).map((r) => (r.rules.weights ?? r.rules.holdMin).from)).toEqual([S, S, S, S, S]);
  });

  it("make the browser test's fixture as they stand: every enabled row, in the page's order, a hidden one too (it still runs)", () => {
    const enabled = ROWS.filter((r) => r.enabled);
    expect(fixture.specs).toEqual(enabled);
    expect(fixture.twins.map((t) => [t.twin.id, t.twin.name, t.capitalGbp])).toEqual(enabled.map((r) => [r.id, r.display_name, Number(r.capital_gbp)]));
  });
});
