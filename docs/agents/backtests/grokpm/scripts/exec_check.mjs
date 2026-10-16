// GROKPM's order path schema (0125) against Postgres itself: PGlite 0.2.17 (PostgreSQL 16.4) with EVERY migration applied
// in order over stubs of what Supabase alone provides, as `backtests/pmlp/scripts/lp_live_check.mjs` does. Before 0125,
// live-prep is set armed with a record shaped as production's on 2026-10-16 (a settled holding of 69.8, an unsettled one
// of 4.28 under the 5-share minimum, nothing resting); then 0125 is applied and checked: live-prep disarmed only when it
// holds nothing sellable and nothing rests (each counter-case run on a fresh database), GROKPM's config disarmed by
// default with the attestation copied, the one-armed trigger covering GROKPM both ways, the go statement read word for
// word from 0125's header refused while the wallet is null or live-prep armed and taking effect otherwise, and the
// orders' check that only a category-C SELL may take. Read-only against the repository; it never connects to any
// database but its own.
//
// Run from the repository root, with PGlite installed anywhere (it is not a dependency of this repository):
//   npm i --prefix /tmp/pglite @electric-sql/pglite@0.2.17
//   PGLITE=/tmp/pglite/node_modules/@electric-sql/pglite/dist/index.js node docs/agents/backtests/grokpm/scripts/exec_check.mjs
// A counterfactual as the argument: `trigger` (0125 without GROKPM in the one-armed function) or `disarm` (0125 without
// its update of live-prep); each must fail the checks that hold it.
// Output: docs/agents/backtests/grokpm/results/exec_check_out.txt (exit 0 when every check passes).
import fs from 'node:fs';
import path from 'node:path';

const { PGlite } = await import(process.env.PGLITE ?? '@electric-sql/pglite');
const REPO = process.cwd();
const MIG = path.join(REPO, 'supabase/migrations');
const CF = process.argv[2] ?? '';
const log = [];
let fails = 0;
const ok = (cond, label) => { log.push(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) fails++; };

let M0125 = fs.readFileSync(path.join(MIG, '0125_grokpm_exec.sql'), 'utf8');
if (CF === 'trigger') M0125 = M0125.replace(`          union all
          select 'grokpm_config'::text from public.grokpm_config g where g.armed_at is not null) x`, ') x');
if (CF === 'disarm') M0125 = M0125.replace(/update public\.pm_lp_config c\s+set live_confirmed_at = null[\s\S]*?< 5;/, '');
if (CF && M0125 === fs.readFileSync(path.join(MIG, '0125_grokpm_exec.sql'), 'utf8')) throw new Error(`counterfactual ${CF} changed nothing`);
/** The go statement, word for word from 0125's header (its comment lines from `update public.grokpm_config set dry_run = false`). */
const GO = (() => {
  const lines = M0125.split('\n');
  const i = lines.findIndex((l) => l.startsWith('--   update public.grokpm_config set dry_run = false'));
  const out = [];
  for (let k = i; k < lines.length; k++) { out.push(lines[k].replace(/^--\s+/, '')); if (lines[k].trim().endsWith(';')) break; }
  return out.join('\n');
})();

const H = (c) => '0x' + c.repeat(64);
async function build(seed) {
  const db = new PGlite();
  const tryExec = async (sql) => { try { await db.exec(sql); return null; } catch (e) { return String(e.message ?? e); } };
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
  const files = fs.readdirSync(MIG).filter((f) => /\.sql$/.test(f)).sort();
  for (const f of files) {
    if (f === '0125_grokpm_exec.sql') continue;
    const err = await tryExec(fs.readFileSync(path.join(MIG, f), 'utf8').replace(/^\s*create extension[^;]*;/gim, '-- (extension: stubbed)'));
    if (err) throw new Error(`${f}: ${err.split('\n')[0]}`);
  }
  // Live-prep as production had it on 2026-10-16: armed, liquidating, attested; a settled holding and dust under 5.
  await db.exec(`
    update public.pm_lp_config set dry_run = false, live_confirmed_at = now(), ireland_attested_at = timestamptz '2026-10-01 05:29:45+00', ireland_until = null where id = 1;
    insert into public.pm_lp_orders (mode, cond, token, outcome, side, price, size, order_type, post_only, expiration, neg_risk, hash, state, gate) values
      ('live', 'A', 'TA', 'yes', 'BUY', 0.5, 69.8, 'GTD', true, 1, false, '${H('1')}', 'filled', 'open'),
      ('live', 'B', 'TB', 'yes', 'BUY', 0.5, 10, 'GTD', true, 1, false, '${H('2')}', 'filled', 'open'),
      ('live', 'B', 'TB', 'yes', 'SELL', 0.5, 5.7213, 'GTD', true, 1, false, '${H('3')}', 'filled', 'reduce');
    insert into public.pm_lp_fills (trade_id, hash, cond, token, side, price, size, status) values
      ('t1', '${H('1')}', 'A', 'TA', 'BUY', 0.5, 69.8, 'CONFIRMED'),
      ('t2', '${H('2')}', 'B', 'TB', 'BUY', 0.5, 10, 'CONFIRMED'),
      ('t3', '${H('3')}', 'B', 'TB', 'SELL', 0.5, 5.7213, 'CONFIRMED'),
      ('t4', '${H('2')}', 'B', 'TB', 'BUY', 0.5, 50, 'FAILED');
    insert into public.pm_lp_settlements (cond, yes_token, no_token, payout) values ('A', 'TA', 'TA2', 0);
  `);
  if (seed) await db.exec(seed);
  const err = await tryExec(M0125);
  if (err) throw new Error(`0125: ${err.split('\n')[0]}`);
  return { db, tryExec, one: async (sql, p) => (await db.query(sql, p)).rows[0] };
}

// ── live-prep: disarmed only with nothing to sell and nothing resting ────────────────────────────────────────────────
{
  const { one } = await build();
  const lp = await one('select dry_run, live_confirmed_at is null as disarmed, liquidate_at is not null as liquidating from public.pm_lp_config');
  ok(lp.disarmed === true, `0125 disarms live-prep holding 4.2787 unsettled (the settled 69.8 aside): ${JSON.stringify(lp)}`);
}
{
  const { one } = await build(`insert into public.pm_lp_orders (mode, cond, token, outcome, side, price, size, order_type, post_only, expiration, neg_risk, hash, state, gate)
    values ('live', 'C', 'TC', 'yes', 'BUY', 0.5, 6, 'GTD', true, 1, false, '${H('4')}', 'filled', 'open');
    insert into public.pm_lp_fills (trade_id, hash, cond, token, side, price, size, status) values ('t5', '${H('4')}', 'C', 'TC', 'BUY', 0.5, 6, 'MATCHED');`);
  ok((await one('select live_confirmed_at is null as d from public.pm_lp_config')).d === false, '0125 leaves live-prep armed while it holds 6 shares of an unsettled token (sellable)');
}
{
  const { one } = await build(`insert into public.pm_lp_orders (mode, cond, token, outcome, side, price, size, order_type, post_only, expiration, neg_risk, hash, state, gate)
    values ('live', 'B', 'TB', 'yes', 'SELL', 0.6, 4, 'GTD', true, 1, false, '${H('5')}', 'live', 'reduce');`);
  ok((await one('select live_confirmed_at is null as d from public.pm_lp_config')).d === false, '0125 leaves live-prep armed while an order of it rests');
}

// ── GROKPM's config, the trigger, the go statement and the orders' check ───────────────────────────────────────────
{
  const { db, tryExec, one } = await build();
  const g = await one('select dry_run, armed_at, started_at, wallet, ireland_attested_at is not null as attested, ireland_until, max_orders_day from public.grokpm_config');
  ok(g.dry_run === true && g.armed_at === null && g.started_at === null && g.wallet === null && g.attested === true && g.ireland_until === null && g.max_orders_day === 50,
    `grokpm_config after 0125: disarmed, attestation copied: ${JSON.stringify(g)}`);
  const trig = (await db.query(`select tgrelid::regclass::text t from pg_trigger where tgname like '%one_armed' order by 1`)).rows.map((r) => r.t);
  ok(JSON.stringify(trig) === JSON.stringify(['grokpm_config', 'pm_live_config', 'pm_lp_config', 'pm_mid_config']), `the one-armed trigger on four configs: ${trig.join(', ')}`);
  log.push(`the go statement, word for word from 0125's header:\n${GO}`);
  ok((await db.query(GO)).rows.length === 0, 'the go statement takes no effect while the wallet is null');
  await db.exec(`update public.grokpm_config set wallet = '0x${'ab'.repeat(20)}' where id = 1`);
  // Live-prep armed again: the statement's own clause, and the trigger behind it.
  await db.exec(`update public.pm_lp_config set live_confirmed_at = now() where id = 1`);
  ok((await db.query(GO)).rows.length === 0, 'the go statement takes no effect while live-prep is armed');
  const byHand = await tryExec(`update public.grokpm_config set dry_run = false, armed_at = now(), started_at = now() where id = 1`);
  ok(/cannot be armed while pm_lp_config is armed/.test(byHand ?? ''), `arming GROKPM by hand while live-prep is armed is refused: ${byHand?.split('\n')[0]}`);
  await db.exec(`update public.pm_lp_config set live_confirmed_at = null where id = 1`);
  const go = (await db.query(GO)).rows;
  ok(go.length === 1 && go[0].dry_run === false && go[0].armed_at !== null && go[0].started_at !== null, `the go statement arms GROKPM: ${JSON.stringify(go)}`);
  ok((await db.query(GO)).rows.length === 0, 'run twice, the go statement changes nothing more');
  const lpArm = await tryExec(`update public.pm_lp_config set live_confirmed_at = now() where id = 1`);
  ok(/cannot be armed while grokpm_config is armed/.test(lpArm ?? ''), `arming live-prep while GROKPM is armed is refused: ${lpArm?.split('\n')[0]}`);
  ok(/grokpm_config_armed_check/.test(await tryExec(`update public.grokpm_config set dry_run = true where id = 1`) ?? ''), 'armed with dry_run true is refused (grokpm_config_armed_check)');
  await db.exec(`update public.grokpm_config set dry_run = true, armed_at = null where id = 1`);
  ok((await one('select dry_run, armed_at from public.grokpm_config')).armed_at === null, 'the undo disarms it');
  // The orders: a BUY always rests; only a category-C SELL may take.
  await db.exec(`insert into public.grokpm_decisions (id, ts, action, reason, raw) values ('d1', now(), 'close', 'x', '{}'), ('d2', now(), 'open', 'x', '{}'), ('d3', now(), 'close', 'x', '{}')`);
  const order = (d, side, postOnly, category, hash) => tryExec(`insert into public.grokpm_orders (mode, decision_id, cond, token, side, price, size, post_only, expiration, neg_risk, hash, category, state)
    values ('live', '${d}', '0x${'c1'.repeat(32)}', '101', '${side}', 0.5, 10, ${postOnly}, 1, false, '${hash}', '${category}', 'pending')`);
  ok(/grokpm_orders_check/.test(await order('d2', 'BUY', false, 'A', H('a')) ?? ''), 'a BUY not post-only is refused, even of category A');
  ok(/grokpm_orders_check/.test(await order('d3', 'SELL', false, 'B', H('b')) ?? ''), 'a SELL not post-only of category B is refused');
  ok(await order('d1', 'SELL', false, 'C', H('c')) === null, 'a SELL not post-only of category C is taken');
  const call = await one(`select path, enabled, retry, every_minutes from public.edge_calls where path like 'grokpm%'`);
  ok(JSON.stringify(call) === JSON.stringify({ path: 'grokpm?action=sync&forceFunctionRegion=eu-west-1', enabled: true, retry: true, every_minutes: 1 }), `its call: ${JSON.stringify(call)}`);
  const rls = (await db.query(`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'grokpm%' order by 1`)).rows;
  ok(rls.length === 13 && rls.every((r) => r.relrowsecurity), `row level security on its ${rls.length} tables`);
}

log.push(fails ? `${fails} FAILED` : 'ALL PASS');
const out = path.join(REPO, 'docs/agents/backtests/grokpm/results', `exec_check${CF ? `_${CF}` : ''}_out.txt`);
fs.writeFileSync(out, log.join('\n') + '\n');
console.log(log.join('\n'));
process.exit(fails ? 1 : 0);
