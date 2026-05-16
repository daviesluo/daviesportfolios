// Build-stamp surfaced to the rest of the app. The actual string is
// inlined by Vite's `define` block in vite.config.js — it computes a
// CalVer `YYYY.M.D-shortsha` at build time so every bundle the user
// could be holding has a deploy identity we can grep for in logs.
// ops_error.js attaches this to every report, so a stack trace from
// production maps back to a commit in seconds.
//
// In dev (`vite` with no env), `define` still runs and stamps the
// current `git rev-parse HEAD` short SHA + today's date. In a fresh
// checkout with no git history the fallback is 'YYYY.M.D-dev'.

/* global __APP_VERSION__ */
export const APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev-local';
