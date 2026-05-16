// Ambient-only declarations: globals that need to live in a file with
// no top-level `export` so TypeScript treats them as truly ambient
// (a file with any export becomes a module).

/** Vite `define` replaces this with the build's CalVer timestamp. */
declare const __APP_VERSION__: string;
