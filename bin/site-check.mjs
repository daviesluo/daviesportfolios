#!/usr/bin/env node
// The real site, as a viewer sees it (Davies, 2026-10-29: "以后每次页面改动等你都去网站实际验证，不要再出现类似的问题了",
// after the LIVE page hid the USDC conversion orders while the fixtures and the sweep passed). Opens daviesluo.com in
// the full Chromium the sweep uses, signed in with a read-only token the `auth` function minted for the operator
// (`?action=viewer-token`, cron bearer, 30 minutes), goes to the page named, waits until what it shows has stopped
// changing, and writes a text snapshot of it and screenshots into a scratch folder outside the repository.
//
//   SITE_VIEWER_TOKEN=<token> node bin/site-check.mjs <out-dir> [--tab live|testing] [--row "<strategy name>"]
//       [--width desktop|phone|both] [--page agents|board] [--url https://daviesluo.com] [--show-values] [--offline]
//
// The token, minted by the database with its own cron bearer (the reply holds the token alone; it lapses in 30 minutes):
//   select net.http_post(
//     url := 'https://flmvxigozjuizpckllvk.supabase.co/functions/v1/auth?action=viewer-token',
//     headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
//       concat('Bearer ', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'))),
//     body := '{}'::jsonb) as id;
//   select status_code, content::jsonb ->> 'token' as token from net._http_response where id = <id>;
// A 409 there means DAVIESLUO_VIEWER_PASSWORD is not the site's read-only password; a 503 that it is not set.
//
// `--offline` stops every call to Supabase, for a dry run against a local `dist/` (`--url http://127.0.0.1:<port>`):
// it checks the script's own path (the browser, the token in place, the menu, the snapshot and the shots), not the page.
//
// The token is read from the environment and goes into the page's sessionStorage (`dp.token`, as the login leaves it)
// through an init script: it is never printed, written to a file or put in a URL, and a token that is not read-only,
// or has lapsed, is refused before the browser starts. Values are hidden with the site's own eye (`dp.prefs`
// hideValues) unless `--show-values`; either way the screenshots and the snapshot stay in the scratch folder, never in
// git (the folder is refused when it is inside the repository).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The sweep's two widths (`src/e2e/app-sweep.mjs`' VIEWPORTS). */
export const WIDTHS = { desktop: { width: 1400, height: 1000 }, phone: { width: 390, height: 844 } };
export const TOKEN_ENV = 'SITE_VIEWER_TOKEN';
const SETTLE_MS = 20_000;

/**
 * @typedef {{ out: string | null, tab: string | null, row: string | null, widths: string[], page: string, url: string, showValues: boolean, offline: boolean }} Options
 */

/**
 * The options, or `{ error }`.
 * @param {string[]} argv
 * @returns {Options | { error: string }}
 */
export function parseArgs(argv) {
  /** @type {Options} */
  const o = { out: null, tab: null, row: null, widths: ['desktop', 'phone'], page: 'agents', url: 'https://daviesluo.com', showValues: false, offline: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v == null) throw new Error(`${a} needs a value`); return v; };
    try {
      if (a === '--tab') o.tab = val();
      else if (a === '--row') o.row = val();
      else if (a === '--width') { const w = val(); o.widths = w === 'both' ? ['desktop', 'phone'] : [w]; }
      else if (a === '--page') o.page = val();
      else if (a === '--url') o.url = val();
      else if (a === '--show-values') o.showValues = true;
      else if (a === '--offline') o.offline = true;
      else if (a.startsWith('--')) return { error: `unknown option ${a}` };
      else if (o.out == null) o.out = a;
      else return { error: `one output folder, not "${a}" too` };
    } catch (e) { return { error: /** @type {Error} */ (e).message }; }
  }
  if (!o.out) return { error: 'name the scratch folder to write into' };
  if (o.tab != null && !['live', 'testing'].includes(o.tab)) return { error: '--tab is live or testing' };
  if (!o.widths.every((w) => w in WIDTHS)) return { error: '--width is desktop, phone or both' };
  if (!['agents', 'board'].includes(o.page)) return { error: '--page is agents or board' };
  if (o.page === 'board' && (o.tab || o.row)) return { error: '--tab and --row are the Agents page\'s' };
  if (!/^https:\/\//.test(o.url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(o.url)) return { error: '--url is an https address, or a local one' };
  return o;
}

/**
 * The token's own claims, read without its signature (the site checks that on every call): a read-only token that
 * has not lapsed, or `{ error }`. The error never repeats the token.
 * @param {string | undefined} token @param {number} [now]
 */
export function checkToken(token, now = Date.now()) {
  if (!token) return { error: `set ${TOKEN_ENV} to the token the auth function's viewer-token route returned` };
  const dot = token.indexOf('.');
  if (dot <= 0 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return { error: 'the token is not in the site\'s <payload>.<signature> form' };
  let claims;
  try { claims = JSON.parse(Buffer.from(token.slice(0, dot), 'base64url').toString('utf8')); } catch { return { error: 'the token\'s payload does not decode' }; }
  if (claims?.role !== 'ro') return { error: `the token's role is ${JSON.stringify(claims?.role)}: only a read-only (viewer) token is used here` };
  if (typeof claims.exp !== 'number' || claims.exp <= now) return { error: 'the token has lapsed: mint another' };
  return { role: 'ro', minutesLeft: Math.floor((claims.exp - now) / 60_000) };
}

/** True when `dir` is the repository or inside it: screenshots of the real book never go near git. @param {string} dir */
export function insideRepo(dir, repo = REPO) {
  const rel = path.relative(repo, path.resolve(dir));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** A file name's part for a strategy's name. @param {string} s */
export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/** The same problem once, with how many times it happened. @param {string[]} list */
export function tally(list) {
  const n = new Map();
  for (const p of list) n.set(p, (n.get(p) ?? 0) + 1);
  return [...n].map(([p, k]) => (k > 1 ? `${p} (×${k})` : p));
}

/**
 * The snapshot's text: a header, then what the page shows (a table's cells joined by " | "), then what went wrong.
 * @param {{ url: string, width: string, size: { width: number, height: number }, hidden: boolean, at: string, trail: string[], text: string, problems: string[] }} s
 */
export function snapshotText(s) {
  const body = s.text.split('\n').map((l) => l.replace(/\t+/g, ' | ').replace(/[  ]+/g, ' ').trim()).filter((l, i, a) => l !== '' || (a[i - 1] ?? '') !== '').join('\n');
  return [
    `# site-check ${s.url} · ${s.width} ${s.size.width}×${s.size.height} · values ${s.hidden ? 'hidden' : 'shown'} · read ${s.at}`,
    `## ${s.trail.join(' › ')}`,
    body.trim(),
    '## problems',
    ...(s.problems.length ? tally(s.problems) : ['none seen']),
    '',
  ].join('\n');
}

/**
 * Waits until `read()` has given the same answer three times running with no call to Supabase still out: what the
 * page shows has stopped changing. A polling loop, never a fixed sleep. False when it did not settle within `ms`.
 * @param {() => Promise<string>} read @param {() => number} inflight
 */
async function settle(read, inflight, ms = SETTLE_MS) {
  const by = Date.now() + ms;
  let last = null, same = 0;
  while (Date.now() < by) {
    const now = await read().catch(() => null);
    same = now != null && now === last && inflight() === 0 ? same + 1 : 0;
    if (same >= 2 && now) return true;
    last = now;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/** @param {any} page */
const topModal = (page) => page.evaluate(() => document.querySelectorAll('.modal').length);

/**
 * One width: sign in, go where asked, settle, write the snapshot and screenshots. Returns the files written, or throws
 * an Error whose message says what was not found.
 * @param {any} browser @param {Options & { out: string }} o @param {string} width @param {string} token
 */
async function checkWidth(browser, o, width, token) {
  const size = WIDTHS[/** @type {'desktop' | 'phone'} */ (width)];
  const ctx = await browser.newContext({ viewport: size, serviceWorkers: 'block', deviceScaleFactor: width === 'phone' ? 2 : 1 });
  await ctx.addInitScript(([t, hide]) => {
    sessionStorage.setItem('dp.token', t);
    let prefs = {};
    try { prefs = JSON.parse(localStorage.getItem('dp.prefs') || '{}') || {}; } catch { /* a fresh profile */ }
    localStorage.setItem('dp.prefs', JSON.stringify({ ...prefs, hideValues: hide }));
  }, [token, !o.showValues]);
  if (o.offline) await ctx.route(/supabase\.co/, (r) => r.abort());
  const page = await ctx.newPage();
  /** @type {string[]} */
  const problems = [];
  let inflight = 0;
  const isCall = (/** @type {any} */ r) => /\/functions\/v1\//.test(r.url());
  page.on('request', (r) => { if (isCall(r)) inflight++; });
  page.on('requestfinished', async (r) => {
    if (!isCall(r)) return;
    inflight--;
    const res = await r.response().catch(() => null);
    if (res && res.status() >= 400) problems.push(`call ${new URL(r.url()).pathname}${new URL(r.url()).search} answered ${res.status()}`);
  });
  page.on('requestfailed', (r) => { if (isCall(r)) { inflight--; problems.push(`call ${new URL(r.url()).pathname} failed: ${r.failure()?.errorText}`); } });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => problems.push(`page error: ${String(e.message).slice(0, 300)}`));
  const trail = [o.url];
  try {
    await page.goto(o.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // Signed in (the header's menu) or refused (the password form, which a 401 to the token brings back).
    const signedIn = await Promise.race([
      page.waitForSelector('.header-menu-btn', { timeout: 30_000 }).then(() => true),
      page.waitForSelector('input[type="password"]', { timeout: 30_000 }).then(() => false),
    ]).catch(() => null);
    if (signedIn !== true) throw new Error(signedIn === false ? 'the site showed its password form: the token was refused or has lapsed' : 'the page drew neither the board nor the password form in 30 s');
    if (o.page === 'agents') {
      trail.push('Agents');
      await page.locator('.header-menu-btn').first().click();
      await page.locator('.header-menu-item:text-is("Agents (beta)")').first().click({ timeout: 10_000 });
      await page.waitForSelector('.ag-modebar', { timeout: 20_000 });
      if (o.tab) {
        trail.push(o.tab.toUpperCase());
        await page.locator(`#ag-modetab-${o.tab}`).click();
        await page.waitForFunction((id) => document.getElementById(`ag-modetab-${id}`)?.getAttribute('aria-selected') === 'true', o.tab, { timeout: 10_000 });
      }
      await settle(() => page.evaluate(() => document.querySelector('.ag-modepanel')?.textContent ?? ''), () => inflight);
      if (await page.locator('input[type="password"]').count()) throw new Error('the site signed out to its password form: the token was refused (a 401) or has lapsed');
      if (o.row) {
        trail.push(o.row);
        const names = (await page.locator('.ag-modepanel .ag-row .ag-name-btn').allTextContents()).map((t) => t.trim());
        if (!names.includes(o.row)) throw new Error(`no row "${o.row}" on ${o.tab ? o.tab.toUpperCase() : 'the tab the page opened on'}; its rows: ${names.join(' / ') || 'none'}`);
        const before = await topModal(page);
        const esc = o.row.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        await page.locator('.ag-modepanel .ag-row', { has: page.locator('.ag-name-btn', { hasText: new RegExp(`^\\s*${esc}\\s*$`) }) }).first().click();
        await page.waitForFunction((n) => document.querySelectorAll('.modal').length > n, before, { timeout: 15_000 });
      }
    } else {
      trail.push('board');
    }
    const read = () => page.evaluate(() => {
      const modals = document.querySelectorAll('.modal');
      return /** @type {HTMLElement} */ (modals[modals.length - 1] ?? document.body).innerText;
    });
    const settled = await settle(read, () => inflight);
    // A token the functions refuse signs the page out: the password form comes back after the first calls answer.
    if (await page.locator('input[type="password"]').count()) throw new Error('the site signed out to its password form: the token was refused (a 401) or has lapsed');
    if (!settled) problems.push(`the page was still changing after ${SETTLE_MS / 1000} s: the snapshot is the last reading`);
    const base = [width, o.page === 'agents' ? (o.tab ?? 'agents') : 'board', o.row ? slug(o.row) : null].filter(Boolean).join('-');
    const files = [];
    const txt = path.join(o.out, `${base}.txt`);
    fs.writeFileSync(txt, snapshotText({ url: o.url, width, size, hidden: !o.showValues, at: new Date().toISOString(), trail, text: await read(), problems }));
    files.push(txt);
    // Screenshots: the window, then each further screenful of the open page's own scroller (a modal scrolls inside
    // itself, so a full-page shot would show only its first screen).
    const steps = await page.evaluate(() => {
      const modals = document.querySelectorAll('.modal');
      const root = modals[modals.length - 1];
      if (!root) return 0;
      const scroller = /** @type {HTMLElement[]} */ ([root, ...root.querySelectorAll('*')])
        .filter((el) => el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))
        .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      if (!scroller) return 0;
      scroller.setAttribute('data-site-check-scroller', '');
      return Math.min(11, Math.ceil(scroller.scrollHeight / Math.max(1, scroller.clientHeight)) - 1);
    });
    const shot = (/** @type {number} */ i) => path.join(o.out, `${base}${i ? `-${i + 1}` : ''}.png`);
    if (o.page === 'board') { await page.screenshot({ path: shot(0), fullPage: true }); files.push(shot(0)); }
    else {
      for (let i = 0; i <= steps; i++) {
        if (i) {
          const moved = await page.evaluate((k) => {
            const el = /** @type {HTMLElement | null} */ (document.querySelector('[data-site-check-scroller]'));
            if (!el) return false;
            el.scrollTop = k * el.clientHeight * 0.9;
            return true;
          }, i);
          if (!moved) break;
          // Two frames: the scroll drawn before the shot.
          await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))));
        }
        await page.screenshot({ path: shot(i) });
        files.push(shot(i));
      }
    }
    return { files, problems };
  } catch (e) {
    // What the page showed when it went wrong, beside the reason: a snapshot and a shot named `-failed`.
    const base = path.join(o.out, `${width}-failed`);
    const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
    fs.writeFileSync(`${base}.txt`, snapshotText({ url: o.url, width, size, hidden: !o.showValues, at: new Date().toISOString(), trail, text, problems: [/** @type {Error} */ (e).message, ...problems] }));
    await page.screenshot({ path: `${base}.png` }).catch(() => {});
    throw new Error(`${/** @type {Error} */ (e).message} (what it showed: ${base}.txt, .png)`);
  } finally {
    await ctx.close();
  }
}

/**
 * Behind a TLS-intercepting egress proxy (a cloud container's), the proxy's own CA, which Chromium's store may not
 * hold: its key's SPKI hash, so Chromium accepts certificates that CA signed and still refuses any other bad one (no
 * certificate check is switched off). The CA file is `SITE_CHECK_PROXY_CA`, else the container's; none, nothing added.
 */
function proxyCaSpki() {
  const file = process.env.SITE_CHECK_PROXY_CA || '/root/.ccr/agent-proxy-ca.crt';
  if (!fs.existsSync(file)) return null;
  const der = new crypto.X509Certificate(fs.readFileSync(file)).publicKey.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(der).digest('base64');
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if ('error' in o) { console.error(`site-check: ${o.error}`); process.exit(64); }
  const out = /** @type {string} */ (o.out);
  if (insideRepo(out)) { console.error('site-check: the output folder is inside the repository; screenshots of the real site stay out of git'); process.exit(64); }
  const token = process.env[TOKEN_ENV];
  const t = checkToken(token);
  if ('error' in t) { console.error(`site-check: ${t.error}`); process.exit(65); }
  fs.mkdirSync(out, { recursive: true });
  const require = createRequire(path.join(REPO, 'src', 'package.json'));
  const pw = 'playwright';
  const { chromium } = require(pw);
  const { launchOptions } = await import(pathToFileURL(path.join(REPO, 'src', 'e2e', 'browser.mjs')).href);
  const env = { ...process.env };
  if (!env.PLAYWRIGHT_CHROMIUM_PATH && fs.existsSync('/opt/pw-browsers/chromium')) env.PLAYWRIGHT_CHROMIUM_PATH = '/opt/pw-browsers/chromium';
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const opts = launchOptions(env);
  const ca = proxy ? proxyCaSpki() : null;
  const browser = await chromium.launch({
    ...opts,
    args: [...opts.args, ...(ca ? [`--ignore-certificate-errors-spki-list=${ca}`] : [])],
    ...(proxy ? { proxy: { server: proxy, bypass: '127.0.0.1,localhost' } } : {}),
  });
  console.log(`site-check: ${o.url}, a read-only token with ${t.minutesLeft} min left, values ${o.showValues ? 'shown' : 'hidden'}`);
  let failed = 0;
  try {
    for (const w of o.widths) {
      try {
        const r = await checkWidth(browser, /** @type {any} */ (o), w, /** @type {string} */ (token));
        console.log(`  ${w}: ${r.files.join(', ')}${r.problems.length ? `\n    ${r.problems.length} problem(s): ${tally(r.problems).slice(0, 5).join(' / ')}` : ''}`);
      } catch (e) {
        failed++;
        console.error(`  ${w}: ${/** @type {Error} */ (e).message}`);
      }
    }
  } finally {
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
