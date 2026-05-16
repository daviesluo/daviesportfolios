// Ambient-only declarations: globals + module shims that need to live
// in a file with no top-level `export` so TypeScript treats them as
// truly ambient (a file with any export becomes a module, and ambient
// `declare module 'X'` blocks inside a module would only augment X
// — they don't add a new shim).
//
// We deliberately don't pull in @types/node: the only Node surface
// we touch is `process.env` + `child_process.execSync` from
// vite.config.js, both for the CalVer build stamp. Declaring just
// those bits keeps the dependency tree from carrying the entire
// Node runtime typings for one helper.

/** Vite `define` replaces this with the build's CalVer + git SHA. */
declare const __APP_VERSION__: string;

/** Node's process.env, narrowed to what vite.config.js reads. */
declare const process: { env: Record<string, string | undefined> };

declare module 'child_process' {
  type StdioOption = 'ignore' | 'pipe' | 'inherit';
  interface ExecSyncOptions {
    stdio?: [StdioOption, StdioOption, StdioOption];
  }
  export function execSync(command: string, options?: ExecSyncOptions): { toString(): string };
}
