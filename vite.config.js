import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
  plugins: [react()],
  build: {
    outDir: '..',
    emptyOutDir: false,
    sourcemap: true,
    target: 'es2020',
  },
  server: {
    port: 5173,
  },
});
