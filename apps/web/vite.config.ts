import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      // Shared with the Worker so client and server cannot drift. Only `domain.ts` is
      // imported: it is plain TypeScript with no Workers-specific types or runtime.
      '@api': path.resolve(import.meta.dirname, '../api/src'),
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
