// `defineConfig` from vitest/config is the same as vite's but with the
// `test` block typed. Stays compatible with `vite build` / `vite dev`
// (the runtime ignores the test block) so we don't need a second
// config file.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Build-time CalVer with minute-precision timestamp → `YYYY.M.D.HHMM`.
// Deliberately SHA-less: Cloudflare Pages serves the repo root as-is
// (wrangler.jsonc `assets.directory = "."` — no build at deploy time),
// so the build SHA we'd bake in would be the parent commit's SHA, not
// the commit that actually ships the bundle (chicken-and-egg: writing
// the bundle into git changes the SHA the bundle references). After
// squash-merge the PR-commit SHA also disappears from main entirely.
// A minute-precision UTC timestamp side-steps both: every rebuild
// produces a unique stamp, and `ops_error.ver` → git log around that
// UTC minute → commit is a 30-second triage path.
function computeAppVersion() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}.${d.getUTCMonth() + 1}.${d.getUTCDate()}.` +
         `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}
const APP_VERSION = computeAppVersion();

// Source root is `src/` and Vite emits the production bundle to the
// project root (repo root). Cloudflare Pages serves the project root,
// so the deploy works without any dashboard build-output config — index.html
// and the hashed `assets/` end up exactly where CF expects.
//
// `emptyOutDir: false` means Vite won't wipe the project root on each
// build (which would delete src/, package.json, etc.). The trade-off is
// stale hashed bundles can pile up under `assets/` over time; the
// `prebuild` npm script handles that by clearing it before each build.
export default defineConfig({
  root: 'src',
  publicDir: '../public',
  plugins: [
    react(),
    // Service worker via Workbox. registerType:'prompt' installs the new
    // SW in the background but waits for the user to click RELOAD on the
    // banner before it takes over. `autoUpdate` (the previous setting)
    // calls skipWaiting + clientsClaim under the hood, which auto-reloads
    // the page mid-session — and on a `?pwd=…` deep link that reload
    // wiped the URL pwd and re-prompted the user for the password 1-2 s
    // after they'd just typed it. devOptions:{ enabled:false } keeps the
    // SW out of `vite dev` so HMR isn't fighting the cache.
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'auto',
      devOptions: { enabled: false },
      workbox: {
        // outDir is the repo root, so the default `**/*` glob would scoop up
        // src/, vite.config.js, random PNGs, etc. Scope the precache to the
        // actual built artefacts only and ignore everything else under the
        // outDir. Runtime caches (network-first for Supabase, stale-while-
        // revalidate for fonts) are picked up via `runtimeCaching` so the
        // chart's live data never gets stuck on a stale snapshot.
        globPatterns: [
          'index.html',
          'manifest.webmanifest',
          'assets/*.{js,css}',
        ],
        globIgnores: [
          '**/node_modules/**/*',
          'src/**/*',
          'public/**/*',
          'supabase/**/*',
          'scraps/**/*',
          'uploads/**/*',
          '_*.png',
          'sw.js',
          'sw.js.map',
          'workbox-*.js',
          'workbox-*.js.map',
          '**/*.map',
          // The screenshot library (html2canvas-pro) is a lazy chunk loaded
          // only when a user clicks copy/save in the chart modal. Keep it
          // OUT of the precache so it isn't pushed to every install — it's
          // runtime-cached on first use instead (see runtimeCaching below).
          'assets/html2canvas-pro*.js',
        ],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            // Supabase / Edge Functions / Yahoo — always fresh, fall back to
            // cached only for a SHORT window.
            //
            // These are live quotes, so a stale hit here is worse than no
            // hit: NetworkFirst falls back to cache whenever the network
            // takes longer than `networkTimeoutSeconds`, and the app treats
            // that response as a completed refresh — it stamps "Last
            // updated" and keeps the pill on LIVE, which defeats the STALE
            // indicator entirely. With the old 6-hour `maxAgeSeconds` a
            // phone on a slow connection could be shown hours-old quotes
            // labelled LIVE. That reads as an outright data bug: an
            // hours-stale ext quote fails `extPriceIsRealAh`, so every US
            // equity collapses to exactly 0.00 % while crypto / non-US rows
            // (which never take the ext path) still look alive.
            //
            // 5 min bounds the damage to roughly one refresh cadence while
            // still smoothing a single slow request. Genuine offline use is
            // served by the app's OWN caches (`dp.marketCache`,
            // `dp.portfolioCache`, the IndexedDB chart stores), which the
            // UI renders with honest stale/error affordances — so nothing
            // depends on this cache surviving for hours. The 6 s timeout
            // also went to 10 s: it sits below the app's own 8–12 s fetch
            // timeouts, so a merely-slow request now resolves for real
            // instead of being pre-empted by a cached one.
            urlPattern: /^https:\/\/(.*\.supabase\.co|query[12]\.finance\.yahoo\.com|.*\.cloudflare\.com)\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'data-api',
              networkTimeoutSeconds: 10,
              expiration: { maxEntries: 80, maxAgeSeconds: 5 * 60 },
            },
          },
          {
            // The lazy screenshot chunk (excluded from precache above).
            // Content-hashed → immutable, so CacheFirst is safe: a new
            // build ships a new filename and re-fetches. This makes the
            // screenshot buttons work offline once they've been used once.
            urlPattern: /\/assets\/html2canvas-pro[^/]*\.js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'lazy-chunks',
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      manifest: {
        name: "Davies' Portfolios",
        short_name: "Portfolio",
        description: 'Personal portfolio tactics board',
        theme_color: '#0c1310',
        background_color: '#0c1310',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          // Icons are missing for now — the PWA still works without them, but
          // iOS will fall back to a screenshot of the page for the home-screen
          // badge. A follow-up should add proper 192/512 PNGs.
        ],
      },
    }),
  ],
  build: {
    outDir: '..',
    emptyOutDir: false,
    // `'hidden'` emits .map files for local debugging but strips the
    // `//# sourceMappingURL=` comment from the JS so the browser
    // never fetches them in production. Combined with .gitignore'ing
    // *.js.map (so the ~900 KB maps don't ride along on every push),
    // this keeps prod bundles lean without losing local sourcemaps.
    sourcemap: 'hidden',
    target: 'es2020',
    // Force lower-case hex hashes instead of Vite's default base64
    // so the bundle filename can never contain a substring like "ad",
    // "ads", "track" etc. that AdGuard / uBlock / similar content
    // filters strip. We hit exactly that: a build named
    // `index-DIMhU_Ad.js` was being silently rewritten out of the
    // served HTML by AdGuard's system-level proxy because the URL
    // contained `Ad`. The page loaded a blank <div id="root"> and no
    // errors fired — the script tag was just missing entirely.
    // Hex (0-9a-f) is alphabet-safe against every variant of that
    // class of false positive, and the explicit `app-` prefix keeps
    // the path obviously app-scoped.
    rollupOptions: {
      output: {
        hashCharacters: 'hex',
        entryFileNames: 'assets/app-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    port: 5173,
  },
  // Inlined as a string literal in every file that references
  // __APP_VERSION__ (currently src/version.js). String-replace, not
  // a runtime read, so dead-code elimination still works.
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  // vitest config — uses jsdom for component tests (TickerChartModal /
  // PerfChart / App) so React-Testing-Library can mount + query the
  // DOM. Pure-helper tests don't need jsdom but the overhead is tiny
  // (~30ms per file) so a single env is simpler than splitting node
  // vs jsdom by globbed pattern. `setupFiles` brings in jest-dom's
  // matcher extensions (toBeInTheDocument etc.) globally.
  test: {
    environment: 'jsdom',
    setupFiles: ['./test_setup.js'],
    // Tests live under src/, alongside the modules they pin.
    include: ['./**/*.test.{js,jsx,ts,tsx}'],
  },
});
