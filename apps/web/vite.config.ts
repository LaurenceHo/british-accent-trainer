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
  server: {
    // The Worker API runs separately under wrangler. Proxying keeps the browser on one
    // origin, so no CORS configuration is needed in development.
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
  },
});
