// Live-prep's go-time statement (the design doc's step 8lp) and the one-armed trigger on three configs, against Postgres
// itself, on the schema as production will have it: PGlite 0.2.17 (PostgreSQL 16.4) with EVERY migration applied in
// order, 0001 through 0091, over stubs of what Supabase alone provides (pg_cron's `cron` schema, pg_net's
// `net.http_post`, the vault, the three API roles). Then the statement, read word for word from
// docs/agents/reviews/2026-10-01-polymarket-live-calibration.md, is run on each of its refusals and on five balances,
// and, armed, every table of the schema is compared before and after: the statement may change live-prep's config row's
// arm (`dry_run`, `live_confirmed_at`, `updated_at`) and its total cap from the balance, and nothing else anywhere. With
// live-prep armed, neither mini-pool nor mid-pool can be armed, by its own statement or by hand; with either armed,
// live-prep cannot be (2026-10-04, for "Reward quotes live-prep", the lead candidate to go live). Read-only against the
// repository; it writes nothing but its output. Never the production database: it never connects to one.
//
// Run from the repository root, with PGlite installed anywhere (it is not a dependency of this repository):
//   npm i --prefix /tmp/pglite @electric-sql/pglite@0.2.17
//   PGLITE=/tmp/pglite/node_modules/@electric-sql/pglite/dist/index.js node docs/agents/backtests/pmlp/scripts/lp_live_check.mjs
// A counterfactual as the second argument changes the statement before it runs: `nokey` drops its check that the key is
// loaded, `widen` makes it also set the day's market count; each must fail the checks that hold it.
// Output: docs/agents/backtests/pmlp/results/lp_live_check_out.txt (exit 0 when every check passes).
import fs from 'node:fs';
import path from 'node:path';

const { PGlite } = await import(process.env.PGLITE ?? '@electric-sql/pglite');
const REPO = process.cwd();
const MIG = path.join(REPO, 'supabase/migrations');
const DOC = fs.readFileSync(path.join(REPO, 'docs/agents/reviews/2026-10-01-polymarket-live-calibration.md'), 'utf8');
const CF = process.argv[2] ?? '';

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
const one = async (sql, params) => (await db.query(sql, params)).rows[0];

// What Supabase provides and PGlite does not: the roles PostgREST uses, pg_cron, pg_net and the vault, each as small as
// the migrations' own calls need. `create extension` lines are left out of each file (none of the three exists here).
await db.exec(`
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $$;
  create schema if not exists extensions;
  create schema cron;
  create table cron.job (jobid bigserial primary key, jobname text unique, schedule text not null, command text not null, active boolean not null default true);
  create table cron.job_run_details (runid bigserial primary key, jobid bigint, status text, return_message text, start_time timestamptz, end_time timestamptz);
  create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $f$
    insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
    on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $f$;
  create function cron.schedule(schedule text, command text) returns bigint language sql as $f$
    insert into cron.job (schedule, command) values (schedule, command) returning jobid $f$;
  create function cron.unschedule(job_name text) returns boolean language sql as $f$
    with d as (delete from cron.job where jobname = job_name returning 1) select exists (select 1 from d) $f$;
  create function cron.unschedule(job_id bigint) returns boolean language sql as $f$
    with d as (delete from cron.job where jobid = job_id returning 1) select exists (select 1 from d) $f$;
  create schema net;
  create table net._http_response (id bigserial primary key, status_code int, content text, created timestamptz default now());
  create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000)
    returns bigint language sql as $f$ select 1::bigint $f$;
  create schema vault;
  create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text);
  create view vault.decrypted_secrets as select id, name, secret as decrypted_secret, description from vault.secrets;
  create function vault.create_secret(new_secret text, new_name text default null, new_description text default '') returns uuid language sql as $f$
    insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id $f$;
`);

// Every migration, in the order of its version (the four out-of-band files of August, dated 2026081…, sort last).
const files = fs.readdirSync(MIG).filter((f) => /\.sql$/.test(f)).sort();
for (const f of files) {
  const sql = fs.readFileSync(path.join(MIG, f), 'utf8').replace(/^\s*create extension[^;]*;/gim, '-- (extension: stubbed)');
  const err = await tryExec(sql);
  ok(err === null, `applied ${f}${err ? `: ${err.split('\n')[0]}` : ''}`);
}
const latest = files.filter((f) => /^\d{4}_/.test(f)).at(-1);
ok(latest === '0091_pm_lp.sql', `the latest numbered migration is ${latest}`);

// ── live-prep's config as the chain leaves it: its strategy's sizes, unarmed, no day stop ───────────────────────────
const CFG = (t) => `select dry_run, live_confirmed_at, cap_total_usd::float8 cap, cap_market_usd::float8 cm, loss_day_usd::float8 ld, loss_total_usd::float8 lt,
                    max_posts_day mp, gtd_lifetime_s gtd, max_markets mm, select_budget_usd::float8 b from public.${t} where id = 1`;
const want = { dry_run: true, live_confirmed_at: null, cap: 320, cm: 100, ld: null, lt: 75, mp: 6000, gtd: 600, mm: 10, b: 200 };
const lp0 = await one(CFG('pm_lp_config'));
ok(JSON.stringify(lp0) === JSON.stringify(want), `pm_lp_config after the chain: ${JSON.stringify(lp0)}`);
const other = { dry_run: true, live_confirmed_at: null, cap: 320, cm: 60, ld: 25, lt: 75, mp: 6000, gtd: 600, mm: 8, b: 160 };
for (const t of ['pm_live_config', 'pm_mid_config']) {
  const r = await one(CFG(t));
  ok(JSON.stringify(r) === JSON.stringify(other), `${t} after the chain, as it was: ${JSON.stringify(r)}`);
}
// Its config holds what S2 holds and nothing looser: $100 a market at most, no day stop, ten markets at most twelve.
ok(await tryExec(`update public.pm_lp_config set cap_market_usd = 100.01 where id = 1`) !== null, 'a market cap over $100 refused');
ok(await tryExec(`update public.pm_lp_config set loss_day_usd = 25 where id = 1`) !== null, 'a day stop refused: live-prep has none');
ok(await tryExec(`update public.pm_lp_config set loss_total_usd = 75.01 where id = 1`) !== null, 'a total stop past -$75 refused');
ok(await tryExec(`update public.pm_lp_config set max_markets = 13 where id = 1`) !== null, 'more than twelve markets refused');
// The band on the day's markets and on every minute: $10 and over, no ceiling.
const bandOf = async (t) => (await db.query(`select pg_get_constraintdef(c.oid) d from pg_constraint c where c.conrelid = 'public.${t}'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%rate%'`)).rows.map((r) => r.d);
ok(JSON.stringify(await bandOf('pm_lp_markets')) === JSON.stringify(['CHECK ((reward_rate >= (10)::numeric))']), `pm_lp_markets' band: ${JSON.stringify(await bandOf('pm_lp_markets'))}`);
ok(JSON.stringify(await bandOf('pm_lp_minutes')) === JSON.stringify(['CHECK ((rate >= (10)::numeric))']), `pm_lp_minutes' band: ${JSON.stringify(await bandOf('pm_lp_minutes'))}`);
ok(/'dry_run'::text, 'live'::text/.test((await one(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'pm_lp_orders_mode_check'`))?.d ?? ''), 'pm_lp_orders may hold live orders');
// RLS on every table of its sixteen, as on every table of public.
const rls = (await db.query(`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname ~ '^pm_lp(prep)?_' order by 1`)).rows;
ok(rls.length === 16 && rls.every((r) => r.relrowsecurity), `row level security on its ${rls.length} tables`);
// Its two calls of the one-minute job: the path from eu-west-1 and its paper layer, each retried; its two leases.
const calls = (await db.query(`select path, enabled, retry from public.edge_calls where path like 'agents?action=pmlp%' order by path`)).rows;
ok(JSON.stringify(calls) === JSON.stringify([{ path: 'agents?action=pmlp&forceFunctionRegion=eu-west-1', enabled: true, retry: true }, { path: 'agents?action=pmlpprep', enabled: true, retry: true }]),
  `its calls in public.edge_calls: ${JSON.stringify(calls)}`);
const locks = (await db.query(`select name from public.agent_locks where name in ('pm-lp', 'pm-lpprep') order by name`)).rows.map((r) => r.name);
ok(JSON.stringify(locks) === JSON.stringify(['pm-lp', 'pm-lpprep']), `its leases: ${locks.join(', ')}`);
// The trigger on all three configs, one function.
const trig = (await db.query(`select tgname, tgrelid::regclass::text t from pg_trigger where tgname like '%one_armed' order by 1`)).rows.map((r) => `${r.t}:${r.tgname}`);
ok(JSON.stringify(trig) === JSON.stringify(['pm_live_config:pm_live_config_one_armed', 'pm_lp_config:pm_lp_config_one_armed', 'pm_mid_config:pm_mid_config_one_armed']), `the one-armed trigger: ${trig.join(', ')}`);

// ── the statement, word for word ──────────────────────────────────────────────────────────────────────────────────
let LP = statement('update public.pm_lp_config c');
if (CF === 'nokey') LP = LP.replace('or s.keyed is not true ', '');
if (CF === 'widen') LP = LP.replace('dry_run = false,', 'dry_run = false, max_markets = 9,');
if (CF && LP === statement('update public.pm_lp_config c')) throw new Error(`counterfactual ${CF} changed nothing`);
log.push(`live-prep's statement (step 8lp), as the doc words it${CF ? ` (counterfactual ${CF})` : ''}:\n${LP}`);
await db.exec(`insert into public.pm_live_state (id, state) values (1, '{}'::jsonb) on conflict (id) do nothing;
               insert into public.pm_mid_state (id, state) values (1, '{}'::jsonb) on conflict (id) do nothing;
               insert into public.pm_lp_state (id, state) values (1, '{}'::jsonb) on conflict (id) do nothing;`);
const setState = async (s) => db.query(`update public.pm_lp_state set state = $1::jsonb where id = 1`, [JSON.stringify(s)]);
const nowText = async () => (await one(`select now()::text n`)).n;
const fresh = async (pusd, extra = {}) => setState({ pusd, at: await nowText(), sbRegion: 'eu-west-1', keyed: true, signerProblem: null, ...extra });
const ago = async (min) => (await one(`select (now() - make_interval(mins => $1))::text t`, [min])).t;
const attest = `update public.pm_lp_config set ireland_attested_at = timestamptz '2026-10-01 05:29:45.546613+00', ireland_until = null where id = 1;`;
// Before each case the three rows go back to what the chain left, every column, so no case inherits another's writes.
const COLS = 'dry_run, live_confirmed_at, ireland_attested_at, ireland_until, cap_total_usd, cap_market_usd, loss_day_usd, loss_total_usd, max_posts_day, gtd_lifetime_s, max_markets, select_budget_usd';
const asLeft = {};
const CONFIGS = ['pm_live_config', 'pm_mid_config', 'pm_lp_config'];
for (const t of CONFIGS) asLeft[t] = JSON.stringify((await one(`select to_jsonb(c) j from public.${t} c where id = 1`)).j);
const reset = async () => {
  // Unarmed first, all three, so the trigger never sees two armed rows while they are put back.
  for (const t of CONFIGS) await db.exec(`update public.${t} set live_confirmed_at = null where id = 1`);
  for (const t of CONFIGS) {
    await db.query(`update public.${t} c set (${COLS}) = (select ${COLS} from jsonb_populate_record(null::public.${t}, $1::jsonb)) where c.id = 1`, [asLeft[t]]);
  }
  await db.exec(attest);
};
const lpRow = async () => one(`select dry_run, live_confirmed_at, cap_total_usd::float8 cap from public.pm_lp_config where id = 1`);
const cases = [
  ['the balance unread', async () => setState({ at: await nowText(), sbRegion: 'eu-west-1', keyed: true })],
  ['the balance six minutes old', async () => setState({ pusd: 401.37, at: await ago(6), sbRegion: 'eu-west-1', keyed: true })],
  ['$0.036673, the balance on 2026-10-04', async () => fresh(0.036673)],
  ['$80.99', async () => fresh(80.99)],
  ['the last turn from eu-west-2', async () => fresh(401.37, { sbRegion: 'eu-west-2' })],
  ['no region recorded', async () => fresh(401.37, { sbRegion: null })],
  ['the key not loaded', async () => fresh(401.37, { keyed: false })],
  ['keyed unrecorded', async () => fresh(401.37, { keyed: undefined })],
  ['the attestation revoked', async () => { await fresh(401.37); await db.exec(`update public.pm_lp_config set ireland_until = now() - interval '1 second' where id = 1`); }],
  ['no attestation', async () => { await fresh(401.37); await db.exec(`update public.pm_lp_config set ireland_until = null, ireland_attested_at = null where id = 1`); }],
  ['an attestation dated ahead', async () => { await fresh(401.37); await db.exec(`update public.pm_lp_config set ireland_attested_at = now() + interval '1 hour', ireland_until = null where id = 1`); }],
  ['mini-pool armed', async () => { await fresh(401.37); await db.exec(`update public.pm_live_config set dry_run = false, live_confirmed_at = now() where id = 1`); }],
  ['mid-pool armed', async () => { await fresh(401.37); await db.exec(`update public.pm_mid_config set dry_run = false, live_confirmed_at = now() where id = 1`); }],
];
for (const [label, setup] of cases) {
  await reset();
  await setup();
  const err = await tryExec(LP);
  const r = await lpRow();
  ok(err !== null && r.dry_run === true && r.live_confirmed_at === null && r.cap === 320, `refused (${label}), the row as it was: ${String(err).split('\n')[0]}`);
}
// The statement's own checks, with the trigger's: mini-pool or mid-pool armed, a plain update arming live-prep is refused too.
for (const t of ['pm_live_config', 'pm_mid_config']) {
  await reset();
  await db.exec(`update public.${t} set dry_run = false, live_confirmed_at = now() where id = 1`);
  const err = await tryExec(`update public.pm_lp_config set live_confirmed_at = now() where id = 1`);
  ok(new RegExp(`pm_lp_config cannot be armed while ${t} is armed`).test(err ?? '') && (await lpRow()).live_confirmed_at === null, `a plain update arming live-prep refused by the trigger while ${t} is armed`);
}
for (const [pusd, cap] of [[401.37, 320], [400, 320], [398.2, 318], [300, 220], [81, 1]]) {
  await reset();
  await fresh(pusd);
  const err = await tryExec(LP);
  const r = await lpRow();
  ok(err === null && r.dry_run === false && r.live_confirmed_at !== null && r.cap === cap, `on $${pusd}: armed, cap ${r.cap} (want ${cap})${err ? ` — ${err}` : ''}`);
}

// ── armed: exactly the current config, and nothing else anywhere ──────────────────────────────────────────────────
await reset();
await fresh(401.37);
const tables = (await db.query(`select n.nspname || '.' || c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
                                 where c.relkind = 'r' and n.nspname in ('public', 'cron', 'net', 'vault') order by 1`)).rows.map((r) => r.t);
const snapshot = async () => {
  const out = {};
  for (const t of tables) out[t] = (await one(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)), '') h from ${t} x`));
  return out;
};
const cols = async () => one(`select to_jsonb(c) - 'live_confirmed_at' - 'updated_at' - 'dry_run' j from public.pm_lp_config c where id = 1`);
const before = await snapshot(), colsBefore = (await cols()).j;
const err = await tryExec(LP);
ok(err === null, `armed on $401.37${err ? `: ${err}` : ''}`);
const after = await snapshot(), colsAfter = (await cols()).j;
const changed = tables.filter((t) => JSON.stringify(before[t]) !== JSON.stringify(after[t]));
ok(JSON.stringify(changed) === JSON.stringify(['public.pm_lp_config']), `the tables the statement changed, of ${tables.length}: ${JSON.stringify(changed)}`);
ok(JSON.stringify(colsAfter) === JSON.stringify(colsBefore), `every other column of the row as it was (the cap stays 320 on $401.37): ${JSON.stringify(colsAfter)}`);
const armed = await one(CFG('pm_lp_config'));
ok(JSON.stringify({ ...armed, live_confirmed_at: null }) === JSON.stringify({ ...want, dry_run: false }) && armed.live_confirmed_at !== null,
  `armed, the strategy's sizes unchanged: ${JSON.stringify({ ...armed, live_confirmed_at: armed.live_confirmed_at ? 'set' : null })}`);
// Armed, neither mini-pool nor mid-pool may be armed beside it, by its own statement or by a plain update.
for (const [t, state, first] of [['pm_live_config', 'pm_live_state', 'update public.pm_live_config c'], ['pm_mid_config', 'pm_mid_state', 'update public.pm_mid_config c']]) {
  await db.exec(`update public.${state} set state = (select state from public.pm_lp_state where id = 1) where id = 1`);
  ok(await tryExec(statement(first)) !== null && (await one(`select live_confirmed_at from public.${t}`)).live_confirmed_at === null, `${t}'s own statement refused while live-prep is armed`);
  ok(new RegExp(`${t} cannot be armed while pm_lp_config is armed`).test(await tryExec(`update public.${t} set live_confirmed_at = now() where id = 1`) ?? ''), `a plain update arming ${t} refused by the trigger`);
}
// Its kill switches, as the design words them.
ok(await tryExec(`update public.pm_lp_config set live_confirmed_at = null where id = 1;`) === null && (await lpRow()).live_confirmed_at === null, 'its kill switch (live_confirmed_at = null) runs');
ok(await tryExec(`update public.pm_lp_config set dry_run = true where id = 1;`) === null && (await lpRow()).dry_run === true, 'its back-to-dry-run switch runs');
// Disarmed, mini-pool may be armed again (by hand here; by its own statement in production), and then live-prep may not.
ok(await tryExec(`update public.pm_live_config set live_confirmed_at = now() where id = 1`) === null, 'live-prep disarmed: mini-pool may be armed');
ok(/pm_lp_config cannot be armed while pm_live_config is armed/.test(await tryExec(`update public.pm_lp_config set live_confirmed_at = now() where id = 1`) ?? ''), '…and then live-prep may not');
// A revocation of the attestation, as docs/agents/CLAUDE.md words it, reaches all three rows.
ok(await tryExec(`update public.pm_live_config set ireland_until = now() where id = 1; update public.pm_mid_config set ireland_until = now() where id = 1; update public.pm_lp_config set ireland_until = now() where id = 1;`) === null, 'the revocation statement runs on all three rows');

const out = `${log.join('\n')}\n\n${fails ? `${fails} FAILED` : 'every check passed'} (PGlite ${(await one('select version()')).version.split(',')[0]}; ${files.length} migrations)`;
console.log(out);
if (!CF) fs.writeFileSync(path.join(REPO, 'docs/agents/backtests/pmlp/results/lp_live_check_out.txt'), out + '\n');
process.exit(fails ? 1 : 0);
