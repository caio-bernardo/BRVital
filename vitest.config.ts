import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/**/*.test.ts', 'apps/**/*.test.tsx', 'packages/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
    coverage: {
      provider: 'v8',
      include: ['apps/core-api/src/domain/**/*.ts'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 80 },
    },
  },
});
