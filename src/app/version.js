// Build-stamp surfaced to the rest of the app. The actual string is
// inlined by Vite's `define` block in vite.config.js: `src.` and 12 hex
// digits of a hash of the source the bundle was built from (until
// 2026-10-08 the build's UTC minute, which made every build of one
// commit a different bundle; review F7). ops_error.js attaches it to
// every report, and `git log -S<stamp> --oneline -- dist` names the
// commit that shipped it.
//
// No git SHA on purpose: Cloudflare serves the committed bundle as-is,
// so any SHA we'd bake in points to the PARENT commit (the one
// committing the bundle changes the SHA), and on squash-merge the
// PR-commit SHA disappears from main entirely. A hash of the source
// names the bundle itself, wherever its commit lands.

/* global __APP_VERSION__ */
export const APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev-local';
