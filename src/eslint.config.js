// Flat ESLint config. It lives in src/, the web app's npm project and all
// it lints; ESLint 10 looks for a config from each file's own folder
// upwards, and knip finds it beside package.json. Deliberately narrow: the value
// here is catching the bug classes tsc + knip don't — chiefly React hook
// misuse (the `react-hooks` plugin), which is what shipped the React-#310
// hook-ordering crash once. Stylistic / unused-locals rules are left to
// tsconfig (`checkJs`) + knip so this stays a *bug* gate, not a
// formatting one. `exhaustive-deps` is a warning (not an error) because
// several effects intentionally use a narrowed dep set (documented
// inline) — surfaced for review, not blocking CI.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  {
    // Static files Vite copies into the build as they are. supabase/ is
    // Deno (different globals, its own `deno check`) and sits outside
    // src/, so this config never sees it.
    ignores: ['public/**'],
  },
  js.configs.recommended,
  {
    // .mjs: the browser tests in e2e/, Node scripts whose page callbacks
    // run in the browser, hence both sets of globals.
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // tsc (checkJs) + knip already own unused-locals / dead-code; not
      // re-litigating it here keeps this config to genuine bug rules.
      'no-unused-vars': 'off',
      // Intentional in a few spots (e.g. `while (true)` poll guards) —
      // tsc's noFallthroughCasesInSwitch is the switch-specific guard.
      'no-constant-condition': ['error', { checkLoops: false }],
      // Empty `catch {}` is the codebase's deliberate best-effort-swallow
      // pattern (cache writes, BroadcastChannel nudges, localStorage in
      // private mode). Still flag other empty blocks, which usually are
      // a real mistake.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // Test files add the vitest globals via imports, but also touch
    // jsdom globals freely.
    files: ['**/*.test.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
];
