// The agents function loads each action's modules when the request asks for it, not when it boots (2026-10-31 audit: the
// whole 2.2 MB graph was evaluated at every boot, and about one request in ten failed to boot, 503 BOOT_ERROR). A binding
// `index.ts` imports lazily is unset until its module's loader runs, so an action that reaches a binding outside its list in
// `AGENTS_ROUTE_MODULES` would throw where it never did. This test reads the code the way the rewrite did and fails on that.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'supabase/functions/agents/index.ts');
const src = fs.readFileSync(FILE, 'utf8');
const sf = ts.createSourceFile(FILE, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
/** The modules the request's preamble (auth, the beat, the database, the errors box) imports, loaded at boot. */
const STATIC = ['../_shared/ops.ts', '../_shared/beats.ts', '../_shared/token.ts', '../_shared/venue.ts', './db.ts'];

/** Identifiers a node refers to, property names left out: by name, so a local that shadows a binding only adds to a list. */
function refs(node) {
  const out = new Set();
  const visit = (n) => {
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      const isName = p && ((ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n)
        || (ts.isPropertySignature(p) && p.name === n) || (ts.isMethodDeclaration(p) && p.name === n) || (ts.isPropertyDeclaration(p) && p.name === n));
      if (!isName) out.add(n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

// The lazy bindings: `import type * as $ns from "<module>";` then `let a!: typeof $ns.a, …;`.
const nsModule = new Map();
const lazyName = new Map();
const valueImports = [];
const decls = new Map();
for (const st of sf.statements) {
  if (ts.isImportDeclaration(st) && st.importClause) {
    const ic = st.importClause, mod = /** @type {import('typescript').StringLiteral} */ (st.moduleSpecifier).text;
    if (ic.isTypeOnly && ic.namedBindings && ts.isNamespaceImport(ic.namedBindings)) nsModule.set(ic.namedBindings.name.text, mod);
    else if (!ic.isTypeOnly) valueImports.push(mod);
  }
  if (ts.isVariableStatement(st)) {
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name)) continue;
      const t = d.type;
      if (d.exclamationToken && t && ts.isTypeQueryNode(t) && ts.isQualifiedName(t.exprName) && ts.isIdentifier(t.exprName.left) && nsModule.has(t.exprName.left.text)) {
        lazyName.set(d.name.text, nsModule.get(t.exprName.left.text));
      } else decls.set(d.name.text, d);
    }
  }
  if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) decls.set(st.name.text, st);
}
const declRefs = new Map([...decls].map(([k, n]) => [k, refs(n)]));
/** The lazy modules what `start` names reaches, through every top-level declaration it names. */
function modulesOf(start) {
  const seen = new Set(), mods = new Set(), todo = [...start];
  while (todo.length) {
    const n = todo.pop();
    if (seen.has(n)) continue;
    seen.add(n);
    if (lazyName.has(n)) mods.add(lazyName.get(n));
    if (declRefs.has(n)) todo.push(.../** @type {Set<string>} */ (declRefs.get(n)));
  }
  return mods;
}
/** `AGENTS_ROUTE_MODULES` as the file writes it. */
function routeTable() {
  const d = decls.get('AGENTS_ROUTE_MODULES');
  const out = {};
  for (const p of d.initializer.properties) out[p.name.text] = p.initializer.elements.map((e) => e.text);
  return out;
}
/** Each action of `route()` and what its statements name; the statements of no action are every action's. */
function routeRefs() {
  const fn = decls.get('route');
  const byAction = new Map(), common = new Set();
  for (const st of fn.body.statements) {
    const acts = [];
    if (ts.isIfStatement(st)) {
      const look = (n) => { if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken && ts.isIdentifier(n.left) && n.left.text === 'action' && ts.isStringLiteral(n.right)) acts.push(n.right.text); ts.forEachChild(n, look); };
      look(st.expression);
    }
    const r = refs(st);
    if (!acts.length) { for (const x of r) common.add(x); continue; }
    for (const a of acts) byAction.set(a, new Set([...(byAction.get(a) ?? []), ...r]));
  }
  return { byAction, common };
}

describe('the agents function loads each action\'s modules when it is asked for (2026-10-31)', () => {
  it('boots with the preamble\'s modules alone: every other import is a lazy binding with a loader', () => {
    expect([...new Set(valueImports)].sort()).toEqual([...STATIC].filter((m) => m !== '../_shared/venue.ts').sort());
    expect(lazyName.size).toBeGreaterThan(150);
    const loaders = decls.get('AGENTS_MODULE_LOADERS').initializer.properties.map((p) => p.name.text);
    expect(loaders.sort()).toEqual([...new Set(lazyName.values())].sort());
    // Each loader imports its own module by a literal specifier, so the deployed bundle carries it.
    for (const m of loaders) expect(src, m).toContain(`  "${m}": () => import("${m}").then((m) => {`);
  });

  it('every action of route() is listed, and its list holds every module its code reaches', () => {
    const table = routeTable(), { byAction, common } = routeRefs();
    expect(Object.keys(table).sort()).toEqual([...byAction.keys()].sort());
    const commonMods = modulesOf(common);
    for (const [action, r] of byAction) {
      const need = [...new Set([...modulesOf(r), ...commonMods])].sort();
      expect(table[action].filter((m) => need.includes(m)), action).toEqual(need);
    }
    // The live executors' minute loads their own modules, not the whole graph.
    expect(table.quotes).toEqual(['../_shared/revx.ts', './quotes.ts', './quotes_compound.ts', './quotes_live.ts', './quotes_live_weekend.ts']);
    expect(table.cblive).toEqual(['./cb_live.ts', './cb_live_probe.ts']);
  });

  it('the preamble needs no lazy module, the beat is written before an action\'s modules load, and module scope reads none', () => {
    const fn = (name) => modulesOf(new Set([name]));
    expect([...fn('serveRequest'), ...fn('authorise'), ...fn('crashReport'), ...fn('json')]).toEqual([]);
    expect(src).toContain('  beat: (key) => writeBeat(key),\n  // Its modules after the beat, so a call that started is still told apart from one whose worker never did.\n  route: async (req, who, url, action) => { await loadAgentsModules(action); return route(req, who, url, action); },');
    // serveRequest writes a cron call's beat, then calls its route: the beat stays the first thing a call does.
    const serve = src.slice(src.indexOf('export async function serveRequest('), src.indexOf('/** `EdgeRuntime.waitUntil`'));
    expect(serve.indexOf('await deps.beat(beatKeyOfRequest("agents", req.url))')).toBeLessThan(serve.indexOf('return await deps.route('));
    // Nothing evaluated at module scope reads a lazy binding (it would be unset when the function boots).
    const topLevel = [];
    const isFn = (n) => ts.isFunctionLike(n);
    const walk = (n, inFn) => {
      if (ts.isImportDeclaration(n) || ts.isTypeNode(n) || ts.isTypeAliasDeclaration(n) || ts.isInterfaceDeclaration(n)) return;
      if (ts.isVariableDeclaration(n) && n.exclamationToken) return;
      if (ts.isIdentifier(n) && !inFn && lazyName.has(n.text)) {
        const p = n.parent;
        const exportOnly = p && ts.isExportSpecifier(p);
        const assigned = p && ts.isShorthandPropertyAssignment(p);
        if (!exportOnly && !assigned) topLevel.push(n.text);
      }
      ts.forEachChild(n, (c) => walk(c, inFn || isFn(n)));
    };
    walk(sf, false);
    expect(topLevel).toEqual([]);
  });
});
