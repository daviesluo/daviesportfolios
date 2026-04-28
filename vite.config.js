import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config — single-page app, output `dist/` for Cloudflare Pages.
// React/ReactDOM are bundled from npm, replacing the previous Babel-in-browser
// + CDN setup. The window-globals pattern from the legacy files is kept intact
// during this initial migration; src/main.jsx imports each module for its
// side effects (each still attaches its exports to `window.*`).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2020',
  },
  server: {
    port: 5173,
  },
});
