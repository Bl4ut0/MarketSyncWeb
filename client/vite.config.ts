import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const clientDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: clientDir,
  plugins: [react()],
  resolve: {
    alias: {
      '@marketsync/shared': path.resolve(clientDir, '../shared/src/index.ts'),
    },
  },
  build: {
    outDir: path.resolve(clientDir, '../dist/client'),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: path.resolve(clientDir, 'index.html'),
        harborAuction: path.resolve(clientDir, 'harbor-auction.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  worker: {
    format: 'es',
  },
});
