// PROGF: 0115's SQL (`pm_prog_rate_at`, `pm_prog_day`) on PGlite, against the closed-form case pm_prog.test.ts pins for
// `programmeFactor`, and against scripts/factor.py on the real record (one source's minutes, the archive's readings).
// node scripts/pglite_check.mjs <pglite module dir> <reads.json from factor.py DUMP_READS> <saved minute pull> <source>
import fs from "node:fs";
const [pgDir, readsFile, pullFile, source] = process.argv.slice(2);
const { PGlite } = await import(`${pgDir}/dist/index.js`);
const db = new PGlite();
const mig = fs.readFileSync(new URL("../../../../../supabase/migrations/0115_pm_prog_factor.sql", import.meta.url), "utf8");
// The schema 0115 reads (the columns its functions name), then its own tables and functions as written.
await db.exec(`
  create table public.pm_rwc_minutes (cond text, minute timestamptz, reward numeric);
  create table public.pm_rwc_selection (day date, cond text, rate numeric);
  create table public.pm_prep_minutes (cond text, minute timestamptz, reward numeric);
  create table public.pm_midprep_minutes (cond text, minute timestamptz, reward numeric);
  create table public.pm_lpprep_minutes (cond text, minute timestamptz, reward numeric);
  create table public.pm_live_minutes (mode text, cond text, minute timestamptz, rate numeric);
  create table public.pm_mid_minutes (mode text, cond text, minute timestamptz, rate numeric);
  create table public.pm_lp_minutes (mode text, cond text, minute timestamptz, rate numeric);
  create table public.agent_locks (name text primary key, lease_until timestamptz, holder text);
  create role anon; create role authenticated;`);
const stmts = mig.replace(/--[^\n]*/g, "").split(/;\s*\n(?=create|insert|alter|revoke|select)/);
for (const s of stmts) {
  const t = s.trim();
  if (!t || /cron\.schedule|edge_calls/.test(t)) continue;   // the scheduler and the call list are not this check's
  await db.exec(t.endsWith(";") ? t : t + ";");
}
// 1. The closed-form case: reads 00:00 rate 40, 00:15 rate 3, 00:30 no programme; minutes 00:10, 00:20, 00:40 (formula 1
// each) and 2026-10-08 23:20 (formula 2, uncovered), each priced at 40. pm_prog.test.ts: formula 5, true 3.075.
await db.exec(`
  insert into public.pm_prog_reads (cond, minute, rate) values ('0xk', '2026-10-09T00:00Z', 40), ('0xk', '2026-10-09T00:15Z', 3), ('0xk', '2026-10-09T00:30Z', null);
  insert into public.pm_rwc_selection values ('2026-10-09', '0xk', 40), ('2026-10-08', '0xk', 40);
  insert into public.pm_rwc_minutes values ('0xk', '2026-10-09T00:10Z', 1), ('0xk', '2026-10-09T00:20Z', 1), ('0xk', '2026-10-09T00:40Z', 1), ('0xk', '2026-10-09T00:50Z', 0), ('0xk', '2026-10-08T23:20Z', 2);`);
await db.query("select public.pm_prog_day('rwc', '2026-10-09'::date)");
await db.query("select public.pm_prog_day('rwc', '2026-10-08'::date)");
const k = (await db.query("select day::text, formula::float8, formula_true::float8, minutes, uncovered from public.pm_prog_factors where source = 'rwc' order by day")).rows;
console.log("closed form:", JSON.stringify(k));
const ok1 = k.length === 2 && k[0].formula === 2 && k[0].formula_true === 2 && k[0].uncovered === 1 && k[1].formula === 3 && Math.abs(k[1].formula_true - 1.075) < 1e-12 && k[1].uncovered === 0;
console.log(ok1 ? "closed form: MATCHES programmeFactor (5 in all, 3.075 true, 1 uncovered)" : "closed form: DIFFERS");
// 2. The real record: one source's rewarded minutes and the archive's readings, against factor.py.
await db.exec("delete from public.pm_prog_reads; delete from public.pm_prog_factors; delete from public.pm_rwc_minutes; delete from public.pm_rwc_selection;");
const reads = JSON.parse(fs.readFileSync(readsFile, "utf8"));
for (let i = 0; i < reads.length; i += 2000) {
  const chunk = reads.slice(i, i + 2000).map(([c, t, r]) => `('${c}', to_timestamp(${t}), ${r === null ? "null" : Number(r)})`).join(",");
  await db.exec(`insert into public.pm_prog_reads (cond, minute, rate) values ${chunk} on conflict do nothing;`);
}
const pull = JSON.parse(fs.readFileSync(pullFile, "utf8"));
const rows = pull.rows.split(";").map((r) => r.split(","));
const [layer, path] = { rwc: ["pm_rwc_minutes", null], prep: ["pm_prep_minutes", "pm_live_minutes"], midprep: ["pm_midprep_minutes", "pm_mid_minutes"], lpprep: ["pm_lpprep_minutes", "pm_lp_minutes"] }[source];
for (let i = 0; i < rows.length; i += 2000) {
  const ch = rows.slice(i, i + 2000);
  await db.exec(`insert into public.${layer} (cond, minute, reward) values ${ch.map(([c, t, r]) => `('${c}', to_timestamp(${t}), ${r})`).join(",")};`);
  if (path) await db.exec(`insert into public.${path} (mode, cond, minute, rate) values ${ch.map(([c, t, , u]) => `('dry_run', '${c}', to_timestamp(${t}), ${u})`).join(",")};`);
  else await db.exec(`insert into public.pm_rwc_selection (day, cond, rate) select distinct (to_timestamp(t) at time zone 'UTC')::date, c, u from (values ${ch.map(([c, t, , u]) => `('${c}', ${t}::bigint, ${u}::numeric)`).join(",")}) v(c, t, u) on conflict do nothing;`);
}
if (!path) await db.exec("delete from public.pm_rwc_selection a using public.pm_rwc_selection b where a.ctid < b.ctid and a.day = b.day and a.cond = b.cond;");
const days = (await db.query(`select distinct (minute at time zone 'UTC')::date::text d from public.${layer} order by 1`)).rows.map((r) => r.d);
for (const d of days) await db.query(`select public.pm_prog_day('${source}', '${d}'::date)`);
const out = (await db.query("select day::text, sum(formula)::float8 f, sum(formula_true)::float8 t, sum(uncovered)::int u, sum(minutes)::int n from public.pm_prog_factors group by day order by day")).rows;
for (const r of out) console.log(`${r.day}  formula ${r.f.toFixed(2)}  true ${r.t.toFixed(2)}  factor ${(r.t / r.f).toFixed(3)}  uncovered ${r.u} of ${r.n}`);
