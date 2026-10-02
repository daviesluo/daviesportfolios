// 0084 against Postgres itself: PGlite 0.2.17 (PostgreSQL 16.4) with 0074, 0076, 0077, 0080 and 0081 applied over stubs
// (`cron.schedule`, `agent_locks`, `agent_risk`, `edge_calls`), then 0084 (twice), its rules, the trigger that keeps the two
// Polymarket configs from both being armed, and both go-time statements exactly as the design doc words them (read from
// docs/agents/reviews/2026-10-01-polymarket-live-calibration.md, steps 8 and 8m, word for word) on each refusal and on
// four balances. Read-only against the repository; it writes nothing.
//
// Run from the repository root, with PGlite installed anywhere (it is not a dependency of this repository):
//   npm i --prefix /tmp/pglite @electric-sql/pglite@0.2.17
//   PGLITE=/tmp/pglite/node_modules/@electric-sql/pglite/dist/index.js node docs/agents/backtests/pmlive/scripts/one_armed_check.mjs
// A counterfactual as the second argument: `trigger` (0084 without its two triggers) or `migration` (no 0084 at all).
// Output: docs/agents/backtests/pmlive/results/one_armed_check_out.txt (exit 0 when every check passes).
import fs from 'node:fs';
import path from 'node:path';

const { PGlite } = await import(process.env.PGLITE ?? '@electric-sql/pglite');
const REPO = process.cwd();
const MIG = path.join(REPO, 'supabase/migrations');
const DOC = fs.readFileSync(path.join(REPO, 'docs/agents/reviews/2026-10-01-polymarket-live-calibration.md'), 'utf8');
const without = new Set((process.argv[2] ?? '').split(',').filter(Boolean));   // counterfactual switches

/** The indented statement in the doc that begins with `first`, through its `where c.id = 1;`. */
function statement(first) {
  const lines = DOC.split('\n');
  const i = lines.findIndex((l) => l.trim() === first);
  if (i < 0) throw new Error(`not in the doc: ${first}`);
  const out = [];
  for (let k = i; k < lines.length; k++) {
    out.push(lines[k].trim());
    if (lines[k].trim() === 'where c.id = 1;') break;
  }
  return out.join('\n');
}

const db = new PGlite();
const log = [];
let fails = 0;
const ok = (cond, label) => { log.push(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) fails++; };
const tryExec = async (sql) => { try { await db.exec(sql); return null; } catch (e) { return String(e.message ?? e); } };
const row = async (t) => (await db.query(`select dry_run, live_confirmed_at, cap_total_usd::float8 as cap from public.${t} where id = 1`)).rows[0];

await db.exec(`
  create schema cron;
  create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
  create table public.agent_locks (name text primary key, lease_until timestamptz not null default now(), holder text);
  create table public.agent_risk (id int primary key, global_pause boolean not null default false);
  create table public.edge_calls (id serial, path text primary key, timeout_ms int, every_minutes int, last_utc_hour int, retry boolean, enabled boolean not null default true);
`);
const apply = async (f) => {
  const sql = fs.readFileSync(path.join(MIG, f), 'utf8');
  const err = await tryExec(sql);
  ok(err === null, `applied ${f}${err ? `: ${err}` : ''}`);
};
for (const f of ['0074_pm_live.sql', '0076_pm_live_calibration.sql', '0077_pm_live_prep.sql', '0080_pm_live_full_size.sql', '0081_pm_mid.sql']) await apply(f);

// Before 0084, 0081's own checks refuse what 0084 lets through.
ok(/pm_mid_config_dry_run_check/.test(await tryExec(`update public.pm_mid_config set dry_run = false where id = 1`) ?? ''), 'before 0084: pm_mid_config refuses dry_run false (0081)');
ok(/pm_mid_config_live_confirmed_at_check/.test(await tryExec(`update public.pm_mid_config set live_confirmed_at = now() where id = 1`) ?? ''), 'before 0084: pm_mid_config refuses live_confirmed_at (0081)');

if (!without.has('migration')) {
  let sql = fs.readFileSync(path.join(MIG, '0084_pm_mid_order_path.sql'), 'utf8');
  if (without.has('trigger')) sql = sql.replace(/create trigger[\s\S]*?;/g, '');
  const err = await tryExec(sql);
  ok(err === null, `applied 0084${err ? `: ${err}` : ''}`);
  ok(await tryExec(sql) === null, '0084 applied a second time: no error (every statement guarded)');
}

// The rows as 0084 leaves them: dry-run, unarmed, the $400 sizes.
const mid0 = (await db.query(`select dry_run, live_confirmed_at, cap_total_usd::float8 cap, cap_market_usd::float8 cm, loss_day_usd::float8 ld, loss_total_usd::float8 lt, max_markets, select_budget_usd::float8 b, gtd_lifetime_s from public.pm_mid_config`)).rows;
ok(JSON.stringify(mid0) === JSON.stringify([{ dry_run: true, live_confirmed_at: null, cap: 320, cm: 60, ld: 25, lt: 75, max_markets: 8, b: 160, gtd_lifetime_s: 600 }]), `pm_mid_config after 0084: ${JSON.stringify(mid0)}`);
const live0 = (await db.query(`select dry_run, live_confirmed_at, max_markets, select_budget_usd::float8 b, cap_total_usd::float8 cap from public.pm_live_config`)).rows;
ok(JSON.stringify(live0) === JSON.stringify([{ dry_run: true, live_confirmed_at: null, max_markets: 8, b: 160, cap: 320 }]), `pm_live_config after 0084: ${JSON.stringify(live0)}`);

// Orders: a live order may be written; any other mode is refused under 0074's name for the check.
const order = (mode, hash) => `insert into public.pm_mid_orders (mode, cond, token, outcome, side, price, size, order_type, post_only, expiration, neg_risk, hash, gate)
  values ('${mode}', '0xc', '1', 'yes', 'BUY', 0.45, 20, 'GTD', true, 1, false, '0x${hash.repeat(64)}', 'open')`;
ok(await tryExec(order('live', 'a')) === null, 'pm_mid_orders takes a live order');
ok(await tryExec(order('dry_run', 'b')) === null, 'pm_mid_orders takes a dry-run order');
ok(/pm_mid_orders_mode_check/.test(await tryExec(order('paper', 'c')) ?? ''), 'pm_mid_orders refuses any other mode (pm_mid_orders_mode_check)');
await db.exec(`delete from public.pm_mid_orders`);

// The paths' states, as each turn writes them: the balance read, when, from where, and whether the key is loaded.
await db.exec(`insert into public.pm_live_state (id, state) values (1, '{}'::jsonb) on conflict (id) do nothing;
               insert into public.pm_mid_state (id, state) values (1, '{}'::jsonb) on conflict (id) do nothing;`);
const setState = async (t, s) => db.query(`update public.${t} set state = $1::jsonb where id = 1`, [JSON.stringify(s)]);
const fresh = async (t, pusd, extra = {}) => setState(t, { pusd, at: (await db.query(`select now()::text as n`)).rows[0].n, sbRegion: 'eu-west-1', keyed: true, ...extra });
const ago = async (min) => (await db.query(`select (now() - make_interval(mins => $1))::text as t`, [min])).rows[0].t;

const LIVE = statement('update public.pm_live_config c');
const MID = statement('update public.pm_mid_config c');
log.push(`mini-pool's statement, as the doc words it:\n${LIVE}\nmid-pool's:\n${MID}`);

const unarm = async () => db.exec(`update public.pm_live_config set dry_run = true, live_confirmed_at = null, cap_total_usd = 320 where id = 1;
                                   update public.pm_mid_config set dry_run = true, live_confirmed_at = null, cap_total_usd = 320 where id = 1;`);

// Each refusal leaves the row as it was; each pass arms it with the cap the balance gives.
for (const [t, st, stmt] of [['pm_live_config', 'pm_live_state', LIVE], ['pm_mid_config', 'pm_mid_state', MID]]) {
  const name = t === 'pm_live_config' ? 'mini-pool' : 'mid-pool';
  const cases = [
    ['unread', async () => setState(st, { at: (await db.query(`select now()::text n`)).rows[0].n, sbRegion: 'eu-west-1', keyed: true })],
    ['six minutes old', async () => setState(st, { pusd: 401.37, at: await ago(6), sbRegion: 'eu-west-1', keyed: true })],
    ['$60', async () => fresh(st, 60)],
    ['$80.99', async () => fresh(st, 80.99)],
    ['from eu-west-2', async () => fresh(st, 401.37, { sbRegion: 'eu-west-2' })],
    ['no region recorded', async () => fresh(st, 401.37, { sbRegion: null })],
    ['the key not loaded', async () => fresh(st, 401.37, { keyed: false })],
    ['keyed unrecorded', async () => fresh(st, 401.37, { keyed: undefined })],
    ['the attestation revoked', async () => { await fresh(st, 401.37); await db.exec(`update public.${t} set ireland_until = now() - interval '1 second' where id = 1`); }],
    ['no attestation', async () => { await fresh(st, 401.37); await db.exec(`update public.${t} set ireland_until = null, ireland_attested_at = null where id = 1`); }],
    ['an attestation dated ahead', async () => { await fresh(st, 401.37); await db.exec(`update public.${t} set ireland_attested_at = now() + interval '1 hour', ireland_until = null where id = 1`); }],
  ];
  for (const [label, setup] of cases) {
    await unarm();
    await db.exec(`update public.${t} set ireland_attested_at = timestamptz '2026-10-01 04:00+00', ireland_until = null where id = 1`);
    await setup();
    const err = await tryExec(stmt);
    const r = await row(t);
    ok(err !== null && r.dry_run === true && r.live_confirmed_at === null && r.cap === 320, `${name}'s statement refused (${label}): ${String(err).split('\n')[0]}`);
  }
  for (const [pusd, cap] of [[401.37, 320], [398.2, 318], [300, 220], [81, 1]]) {
    await unarm();
    await db.exec(`update public.${t} set ireland_attested_at = timestamptz '2026-10-01 04:00+00', ireland_until = null where id = 1`);
    await fresh(st, pusd);
    const err = await tryExec(stmt);
    const r = await row(t);
    ok(err === null && r.dry_run === false && r.live_confirmed_at !== null && r.cap === cap, `${name}'s statement on $${pusd}: armed, cap ${r.cap} (want ${cap})${err ? ` — ${err}` : ''}`);
  }
}

// Never both armed: through the statements, and through a plain update the statements do not guard.
await unarm();
await fresh('pm_live_state', 401.37); await fresh('pm_mid_state', 401.37);
ok(await tryExec(LIVE) === null && (await row('pm_live_config')).live_confirmed_at !== null, 'mini-pool armed by its statement');
let err = await tryExec(MID);
ok(err !== null && (await row('pm_mid_config')).live_confirmed_at === null, `mid-pool's statement refused while mini-pool is armed: ${String(err).split('\n')[0]}`);
err = await tryExec(`update public.pm_mid_config set dry_run = false, live_confirmed_at = now() where id = 1`);
ok(/pm_mid_config cannot be armed while pm_live_config is armed/.test(err ?? '') && (await row('pm_mid_config')).live_confirmed_at === null, `a plain update arming mid-pool while mini-pool is armed: ${String(err).split('\n')[0]}`);
// Mid-pool may still be put out of dry-run unarmed (it opens nothing; mini-pool's trigger reads only live_confirmed_at).
ok(await tryExec(`update public.pm_mid_config set dry_run = false where id = 1`) === null, 'mid-pool out of dry-run but unarmed while mini-pool is armed: allowed (it opens nothing)');
await db.exec(`update public.pm_mid_config set dry_run = true where id = 1`);
// Mini-pool's kill switch: cleared, it is unarmed; then mid-pool may be armed, and mini-pool may not be armed again.
ok(await tryExec(`update public.pm_live_config set live_confirmed_at = null where id = 1;`) === null, "mini-pool's kill switch (live_confirmed_at = null) runs");
ok(await tryExec(MID) === null && (await row('pm_mid_config')).live_confirmed_at !== null, 'mid-pool armed by its statement once mini-pool is not');
err = await tryExec(LIVE);
ok(err !== null && (await row('pm_live_config')).live_confirmed_at === null, `mini-pool's statement refused while mid-pool is armed: ${String(err).split('\n')[0]}`);
err = await tryExec(`update public.pm_live_config set dry_run = false, live_confirmed_at = now() where id = 1`);
ok(/pm_live_config cannot be armed while pm_mid_config is armed/.test(err ?? '') && (await row('pm_live_config')).live_confirmed_at === null, `a plain update arming mini-pool while mid-pool is armed: ${String(err).split('\n')[0]}`);
// An armed row's other columns still change (a revocation of the attestation, a resize): the other row is unarmed.
ok(await tryExec(`update public.pm_mid_config set ireland_until = now() where id = 1`) === null, "the armed row's attestation revoked: allowed");
// Mid-pool's kill switches, as the design words them.
ok(await tryExec(`update public.pm_mid_config set live_confirmed_at = null where id = 1;`) === null && (await row('pm_mid_config')).live_confirmed_at === null, "mid-pool's kill switch (live_confirmed_at = null) runs");
ok(await tryExec(`update public.pm_mid_config set dry_run = true where id = 1;`) === null && (await row('pm_mid_config')).dry_run === true, "mid-pool's back-to-dry-run switch runs");
// Both in one statement: refused whole.
await unarm();
err = await tryExec(`with a as (update public.pm_live_config set live_confirmed_at = now() where id = 1 returning 1)
                     update public.pm_mid_config set live_confirmed_at = now() where id = 1`);
const both = [(await row('pm_live_config')).live_confirmed_at, (await row('pm_mid_config')).live_confirmed_at];
ok(err !== null && both.every((x) => x === null), `both armed in one statement: refused whole (${String(err).split('\n')[0]})`);
// Both in one transaction, one after the other: refused whole.
err = await tryExec(`begin; update public.pm_live_config set live_confirmed_at = now() where id = 1; update public.pm_mid_config set live_confirmed_at = now() where id = 1; commit;`);
await tryExec('rollback');
const both2 = [(await row('pm_live_config')).live_confirmed_at, (await row('pm_mid_config')).live_confirmed_at];
ok(err !== null && both2.every((x) => x === null), `both armed in one transaction: refused whole (${String(err).split('\n')[0]})`);
// An insert of an armed row (a row recreated) is held to the same rule.
await db.exec(`update public.pm_live_config set live_confirmed_at = now() where id = 1`);
await db.exec(`delete from public.pm_mid_config where id = 1`);
err = await tryExec(`insert into public.pm_mid_config (id, dry_run, live_confirmed_at) values (1, false, now())`);
ok(/pm_mid_config cannot be armed/.test(err ?? ''), `an armed mid-pool row inserted while mini-pool is armed: ${String(err).split('\n')[0]}`);

// The trigger function: no PUBLIC execute needed (a trigger runs whoever writes), its search_path fixed.
const fn = (await db.query(`select prosecdef, proconfig from pg_proc where proname = 'pm_one_account_one_armed'`)).rows;
ok(fn.length === 1 && fn[0].prosecdef === false && JSON.stringify(fn[0].proconfig) === JSON.stringify(['search_path=""']), `the function: security invoker, search_path '' (${JSON.stringify(fn)})`);
const trg = (await db.query(`select tgname, tgrelid::regclass::text as rel from pg_trigger where not tgisinternal order by 1`)).rows;
ok(JSON.stringify(trg) === JSON.stringify([{ tgname: 'pm_live_config_one_armed', rel: 'pm_live_config' }, { tgname: 'pm_mid_config_one_armed', rel: 'pm_mid_config' }]), `the triggers: ${JSON.stringify(trg)}`);

console.log(log.join('\n'));
console.log(`\n${fails ? `${fails} FAILED` : 'every check passed'} (PGlite ${(await db.query('select version()')).rows[0].version.split(',')[0]})`);
process.exit(fails ? 1 : 0);
