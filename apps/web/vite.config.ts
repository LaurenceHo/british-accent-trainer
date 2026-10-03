import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      // Shared with the Worker so client and server cannot drift. Deliberately this one
      // file, not the API's whole src tree: domain.ts has no imports and is enforced import-
      // free by lint, so nothing server-side can be pulled into the browser bundle.
      '@api/domain': path.resolve(import.meta.dirname, '../api/src/domain.ts'),
    },
  },
  define: {
    // Baked into the service worker so every build changes its bytes, which is what makes
    // browsers install the new worker and drop the previous build's caches.
    __BUILD_ID__: JSON.stringify(Date.now().toString(36)),
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, 'index.html'),
        // A second entry, at a fixed URL: a service worker's scope comes from its path,
        // and the page must be able to name it without knowing a build hash.
        sw: path.resolve(import.meta.dirname, 'src/sw/sw.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  server: {
    // The Worker API runs separately under wrangler. Proxying keeps the browser on one
    // origin, so no CORS configuration is needed in development.
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  test: {
    environment: 'jsdom',
    // Far from UTC, which CI runs in: a date helper that slips into UTC (toISOString, say)
    // gives a different calendar day here for much of the day, so it fails rather than passes.
    env: { TZ: 'Pacific/Auckland' },
    setupFiles: ['./test/setup.ts'],
  },
});
