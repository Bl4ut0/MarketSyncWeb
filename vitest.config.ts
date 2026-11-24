import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@marketsync/shared': path.resolve(rootDir, 'shared/src/index.ts'),
      '@marketsync/server': path.resolve(rootDir, 'server/src/index.ts'),
    },
  },
  test: {
    include: [
      'shared/tests/**/*.test.ts',
      'server/tests/**/*.test.ts',
      'client/tests/**/*.test.ts',
    ],
    environment: 'node',
    globals: false,
  },
});
