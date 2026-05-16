// Build-stamp surfaced to the rest of the app. The actual string is
// inlined by Vite's `define` block in vite.config.js — a minute-
// precision UTC CalVer (`YYYY.M.D.HHMM`). ops_error.js attaches this
// to every report so a stack trace from production maps back to a
// `git log --until="<that minute>"` lookup in seconds.
//
// No git SHA on purpose: Cloudflare serves the committed bundle as-is,
// so any SHA we'd bake in points to the PARENT commit (the one
// committing the bundle changes the SHA), and on squash-merge the
// PR-commit SHA disappears from main entirely — the version string
// would dangle. Timestamp alone is stable across both.

/* global __APP_VERSION__ */
export const APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev-local';
