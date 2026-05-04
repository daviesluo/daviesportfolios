import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

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
            // cached on offline.
            urlPattern: /^https:\/\/(.*\.supabase\.co|query[12]\.finance\.yahoo\.com|.*\.cloudflare\.com)\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'data-api',
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 6 },
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
    sourcemap: true,
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
});
