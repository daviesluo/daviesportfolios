// IGBOT ("IG analyst", docs/agents/reviews/2026-10-29-igbot-research.md, migration 0157): the tables the code writes are
// the migration's, column for column; every table is locked to the service role; the environment can only be the demo;
// the function's source knows no IG host but the demo gateway and no secret but its own demo ones; and the prompt Grok is
// given prints the examples the Edge tests prove valid and the limits the code enforces. The Edge tests run without file
// access to the migration, so this is where the code's copies are held to the files.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SQL = read('supabase/migrations/0157_igbot.sql');
const SQL_NC = SQL.replace(/--[^\n]*/g, '');
// 0159 (the 2026-10-29 audit): a column on igbot_requests and the hour bars' table.
const SQL2_NC = read('supabase/migrations/0159_igbot_audit.sql').replace(/--[^\n]*/g, '');
// 0165: the IG session every isolate shares, sealed, and the claim that lets one isolate at a time log in.
const SQL3_NC = read('supabase/migrations/0165_igbot_session.sql').replace(/--[^\n]*/g, '');
const SCHEMA = read('supabase/functions/igbot/schema.ts');
const RULES = read('supabase/functions/igbot/rules.ts');
const PROMPT = read('docs/agents/igbot/GROK_PROMPT.md');
const EXAMPLES = JSON.parse(read('docs/agents/igbot/examples.json'));
const DIR = path.join(ROOT, 'supabase/functions/igbot');
const stripComments = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** Each `create table` of the migrations: its columns, in order, with every `add column` after them. */
function tablesOf(...sqls) {
  const out = {};
  for (const sql of sqls) {
    for (const m of sql.matchAll(/create table if not exists public\.(\w+) \(([\s\S]*?)\n\);/g)) {
      out[m[1]] = m[2].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('constraint') && !l.startsWith('primary key')).map((l) => l.split(/\s+/)[0]);
    }
    for (const m of sql.matchAll(/alter table public\.(\w+) add column if not exists (\w+) /g)) out[m[1]].push(m[2]);
  }
  return out;
}
/** `schema.ts`'s list, read as text: table → columns. */
function schemaOf(src) {
  const out = {};
  for (const m of src.matchAll(/(igbot_\w+): \{\s*key: "([\w,]+)",\s*columns: \[([\s\S]*?)\]/g)) out[m[1]] = [...m[3].matchAll(/"(\w+)"/g)].map((x) => x[1]);
  return out;
}

describe('IGBOT, the demo-only IG path', () => {
  it("writes only the migrations' columns: schema.ts lists every table of 0157 and 0159 with exactly its columns", () => {
    const t = tablesOf(SQL_NC, SQL2_NC, SQL3_NC), s = schemaOf(SCHEMA);
    expect(t.igbot_exec_state.slice(-2)).toEqual(['session_box', 'login_until']);
    expect(Object.keys(t).sort()).toEqual(Object.keys(s).sort());
    expect(Object.keys(t).length).toBe(11);
    expect(t.igbot_requests.at(-1)).toBe('ig_calls');
    for (const k of Object.keys(t)) expect([k, t[k]]).toEqual([k, s[k]]);
  });

  it('locks every table to the service role: row level security on, no grant and no policy for anon or authenticated', () => {
    for (const k of Object.keys(tablesOf(SQL_NC))) expect(SQL_NC).toMatch(new RegExp(`alter table public\\.${k} +enable row level security;`));
    expect(SQL_NC).not.toMatch(/\bgrant\b|create policy/i);
    expect(SQL2_NC).toMatch(/alter table public\.igbot_bars enable row level security;/);
    expect(SQL2_NC).not.toMatch(/\bgrant\b|create policy|edge_calls|igbot_config/i);
    expect(SQL3_NC).not.toMatch(/\bgrant\b|create policy|edge_calls|igbot_config|create table/i);
  });

  it("holds the environment to the demo, starts in dry-run, ties the arm to the mode, and adds one call a minute", () => {
    expect(SQL_NC).toContain("environment     text not null default 'demo' check (environment = 'demo')");
    expect(SQL_NC).toContain("mode            text not null default 'dry_run' check (mode in ('dry_run', 'demo'))");
    expect(SQL_NC).toContain("constraint igbot_config_armed_check check ((mode = 'demo') = (armed_at is not null) and (armed_at is null or started_at is not null))");
    expect(SQL_NC).toContain("insert into public.edge_calls (path, timeout_ms, every_minutes, last_utc_hour, retry) values ('igbot?action=sync', 30000, 1, 23, true) on conflict (path) do nothing;");
    // The arm and its undo are in the header, never run by the migration.
    expect(SQL).toContain("--   update public.igbot_config set mode = 'demo', armed_at = now(), started_at = coalesce(started_at, now())");
    expect(SQL_NC).not.toMatch(/update public\.igbot_config/);
    // The defaults the prompt and the pre-registration name.
    for (const d of ['budget_gbp      numeric not null default 1000', 'day_stop_gbp    numeric not null default 20', 'total_stop_gbp  numeric not null default 100', 'max_orders_day  integer not null default 40']) expect(SQL_NC).toContain(d);
  });

  it('knows no IG host but the demo gateway and reads no secret but its own demo ones', () => {
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).sort();
    expect(files).toEqual(['client.ts', 'exec.ts', 'fxw_watch.ts', 'index.ts', 'ingest.ts', 'rules.ts', 'schema.ts']);
    for (const f of files) {
      const code = stripComments(fs.readFileSync(path.join(DIR, f), 'utf8'));
      const hosts = [...code.matchAll(/https?:\/\/[a-z0-9.-]*ig\.com[^"'`\s]*/g)].map((m) => m[0]);
      expect(hosts.every((h) => h === 'https://demo-api.ig.com/gateway/deal'), f).toBe(true);
      expect(code, f).not.toMatch(/IG_API_KEY|IG_LIVE|_LIVE\b|IG_DEMO_USERNAME|IG_DEMO_PASSWORD/);
      expect([...code.matchAll(/Deno\.env\.get\("([A-Z_]+)"\)/g)].map((m) => m[1]).filter((n) => !['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET', 'IGBOT_TOKEN'].includes(n)), f).toEqual([]);
    }
    const client = read('supabase/functions/igbot/client.ts');
    expect(client).toContain('export const IGBOT_DEMO_BASE = "https://demo-api.ig.com/gateway/deal";');
    expect(client).toContain('key: "IGBOT_DEMO_API_KEY", username: "IGBOT_DEMO_USERNAME", password: "IGBOT_DEMO_PASSWORD", account: "IGBOT_DEMO_ACCOUNT_ID",');
    const yml = read('.github/workflows/edge-functions.yml');
    expect(/PUBLIC_FNS="([^"]*)"/.exec(yml)?.[1].split(' ')).toContain('igbot');
  });

  it("prints in the prompt exactly the examples the Edge tests prove valid", () => {
    const blocks = Object.fromEntries([...PROMPT.matchAll(/<!-- example:(\w+) -->\n```json\n([\s\S]*?)\n```/g)].map((m) => [m[1], JSON.parse(m[2])]));
    expect(Object.keys(blocks).sort()).toEqual(Object.keys(EXAMPLES).sort());
    for (const k of Object.keys(EXAMPLES)) expect([k, blocks[k]]).toEqual([k, EXAMPLES[k]]);
  });

  it('states in the prompt the limits the code enforces', () => {
    const pins = [
      ['riskPerTradeFrac: 0.01', '1 % of the budget (£10 of £1,000)'], ['maxTotalRiskFrac: 0.03', 'at most 3 % (£30)'], ['maxOpen: 3', 'at most 3 positions and working orders'],
      ['maxNotionalMult: 5', 'at most 5 × the budget'], ['minRewardRisk: 1.5', 'at least 1.5 × the stop'], ['edgeMin: 0.08', 'at least 0.08 over m'],
      ['kellyFraction: 0.25', 'a quarter Kelly'], ['maxSlippageFrac: 0.1', 'by at most a tenth of the stop distance'], ['maxOrdersPerMinute: 3', '3 a minute'],
      ['blackoutLeadMs: 5 * M, blackoutTrailMs: 2 * M', 'from 5 minutes before to 2 minutes after'], ['weekendFromFriUtcHour: 20, weekendToSunUtcHour: 22', 'from Friday 20:00 to Sunday 22:00 UTC'],
      ['maxHoldMs: 5 * DAY', 'held five days'], ['minWorkingMs: 5 * M, maxWorkingMs: 24 * H', '5 minutes to 24 hours'],
    ];
    for (const [code, words] of pins) {
      expect(RULES, code).toContain(code);
      expect(PROMPT, words).toContain(words);
    }
    expect(PROMPT).toContain('−£20 today');
    expect(PROMPT).toContain('−£100 from the start');
    expect(PROMPT).toContain('40 orders a UTC day');
  });

  it('names in the prompt every rule the server can refuse by, and the limits the 2026-10-29 audit added', () => {
    const named = new Set([...stripComments(RULES + read('supabase/functions/igbot/exec.ts')).matchAll(/rule: "(\w+)"/g)].map((m) => m[1]));
    expect(named.size).toBeGreaterThan(25);
    for (const r of named) expect(PROMPT, r).toContain('`' + r + '`');
    expect(RULES).toContain('pendingBlockMs: 2 * H,');
    expect(PROMPT).toContain('for up to two hours');
    expect(read('supabase/functions/igbot/ingest.ts')).toContain('export const IGBOT_IG_CALLS_PER_MINUTE = 24;');
    expect(PROMPT).toContain('past 24 IG requests in a minute');
    expect(RULES).toContain('export const IGBOT_CALENDAR_UNTIL_MS = Date.parse("2027-01-01T00:00:00Z");');
    expect(PROMPT).toContain('the release list ends 2026-12-31');
    // The wake schedule: event wakes before T−5 (the blackout), holding checks every 10 minutes.
    expect(PROMPT).toContain('| T−60, T−20, T+5, T+15, T+60, T+180 |');
    expect(PROMPT).toContain('every 10 minutes while you hold a position or a working order');
  });

  // Davies, 2026-10-29: "我想让ig trader bot帮我也盯着澳元策略的记录和run的情况". The agent reads FXW-AUD's health through one
  // read-only action; the prompt names it and every problem it can report, exactly as the code does.
  it('serves the AUD weekend watch read-only, and the prompt names its action and every problem as the code does', () => {
    const src = read('supabase/functions/igbot/fxw_watch.ts');
    const code = stripComments(src);
    // The database only: no client, no fetch, no environment, no secret name, and from the ig function only its pure windows.
    expect(code).not.toMatch(/IgbotClient|igbotCreds|IgClient|liveCreds|fetch\(|Deno\.env|IG_API_KEY|IG_LIVE|IGBOT_DEMO|_DEMO_/);
    expect([...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]).sort()).toEqual(['../agents/db.ts', '../ig/windows.ts']);
    // Its copy of the strategy's terms is fxw.ts' own.
    const fxw = read('supabase/functions/ig/fxw.ts');
    expect(fxw).toContain('fundedGbp: 1000,');
    expect(fxw).toContain('horizonMs: 24 * 3_600_000,');
    expect(fxw).toContain('startFriday: "2026-10-30",');
    expect(fxw).toContain('startUk: { hh: 21, mm: 35 },');
    expect(code).toContain('fundedGbp: 1000, horizonMs: 24 * 3_600_000, startFriday: "2026-10-30"');
    // The handler: a GET, answered before IG's client (and its secrets) is built.
    const idx = read('supabase/functions/igbot/index.ts');
    expect(idx).toMatch(/fxw_watch: "GET"/);
    expect(src).toContain('export const FXW_WATCH_ACTION = "fxw_watch";');
    const branch = idx.indexOf('if (action === FXW_WATCH_ACTION)');
    expect(branch).toBeGreaterThan(idx.indexOf('const rate = rateVerdict(last, 0, t, true);'));
    expect(branch).toBeLessThan(idx.indexOf('const x = { ...deps.exec(t), igBudget'));
    // The prompt: the action in the server's table and in its own section, and the codes both ways.
    expect(PROMPT).toContain('| `?action=fxw_watch` | GET |');
    const at = PROMPT.indexOf('## Watching the AUD weekend strategy (FXW-AUD) for Davies');
    expect(at).toBeGreaterThan(0);
    const section = PROMPT.slice(at, PROMPT.indexOf('\n## ', at + 5));
    expect(section).toContain('`GET ?action=fxw_watch`');
    const codes = [...(/FXW_WATCH_PROBLEMS = \{([\s\S]*?)\} as const;/.exec(src)?.[1] ?? '').matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort();
    expect(codes).toEqual(['facts_not_ok', 'fxw_error', 'missing_accounts', 'no_beat', 'recorder_failing', 'weekend_missed']);
    const named = [...section.matchAll(/^- `(\w+)`:/gm)].map((m) => m[1]).filter((c) => !['strategy', 'weekends', 'recorder', 'window', 'facts', 'calls', 'problems'].includes(c)).sort();
    expect(named).toEqual(codes);
    // Its schedule and its one way of acting on a problem.
    for (const t of ['once at each **full scan**', '**Friday 21:40 and 22:10**', '**every hour on the hour from Saturday 08:00 to Monday 22:00, and once at Monday 22:20**', '**Sunday 21:05 and 21:30**',
      '**in Chinese**', '**"Grok → Claude"**', '**Never try to fix it**', 'never log in to IG', '**separate, frozen paper strategy**']) expect(section).toContain(t);
  });

  it('seeds a desk ledger under 10 KB', () => {
    expect(fs.statSync(path.join(ROOT, 'docs/agents/igbot/ledger_seed.md')).size).toBeLessThan(10240);
  });
});
