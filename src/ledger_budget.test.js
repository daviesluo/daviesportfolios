// @vitest-environment node
// The ledger stays small (review F15, 2026-10-08): every resume reads it whole, and it had grown to 373 KB, about
// 93,000 tokens a wake. The commit hook's gate 3 refuses a commit that leaves it over 80 KiB, naming the move to make;
// here the hook itself runs in a scratch repository, and the repository's own ledger is held under the budget.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = path.join(ROOT, 'bin/hooks');
const BUDGET = 81920;

/** @type {string} */ let dir;
const git = (/** @type {string[]} */ args, env = {}) => spawnSync('git',
  ['-c', `core.hooksPath=${HOOKS}`, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args],
  { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
const header = '### [2026-10-08 18:00 UTC] Platform: Claude Code | Model: not recorded (session policy)\n';
const ledgerOf = (/** @type {number} */ bytes) => {
  const head = `# Ledger\n\n## History, newest first\n\n${header}`;
  return head + '- x\n'.repeat(Math.ceil((bytes - head.length) / 4)).slice(0, bytes - head.length);
};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-budget-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.writeFileSync(path.join(dir, 'docs/LEDGER.md'), ledgerOf(1000));
  expect(git(['add', '-A']).status).toBe(0);
  expect(git(['commit', '-q', '-m', 'one']).status).toBe(0);
});
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('the ledger budget (bin/hooks/pre-commit, gate 3)', () => {
  it('takes a ledger at the budget, and refuses one a byte over it with the move to make', () => {
    fs.writeFileSync(path.join(dir, 'docs/LEDGER.md'), ledgerOf(BUDGET));
    git(['add', 'docs/LEDGER.md']);
    expect(git(['commit', '-q', '-m', 'at']).status).toBe(0);

    fs.writeFileSync(path.join(dir, 'docs/LEDGER.md'), ledgerOf(BUDGET + 1));
    git(['add', 'docs/LEDGER.md']);
    const over = git(['commit', '-q', '-m', 'over']);
    expect(over.status).toBe(1);
    // git hands a hook's output to its own stderr.
    const said = `${over.stdout}${over.stderr}`;
    expect(said).toContain(`docs/LEDGER.md would be ${BUDGET + 1} bytes, over its budget of`);
    expect(said).toContain('LEDGER_BUDGET_OK=1 git commit');
  });

  it('lets LEDGER_BUDGET_OK=1 through, and weighs only a commit that stages the ledger', () => {
    expect(git(['commit', '-q', '-m', 'over, on purpose'], { LEDGER_BUDGET_OK: '1' }).status).toBe(0);
    // The ledger is now over budget in HEAD; a commit that does not touch it is not weighed (gate 1's slack covers it).
    fs.writeFileSync(path.join(dir, 'other.txt'), 'x\n');
    git(['add', 'other.txt']);
    expect(git(['commit', '-q', '-m', 'other']).status).toBe(0);
  });

  it('the repository\'s own ledger is under the budget', () => {
    expect(fs.statSync(path.join(ROOT, 'docs/LEDGER.md')).size).toBeLessThanOrEqual(BUDGET);
  });
});
