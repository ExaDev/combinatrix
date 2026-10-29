import { join } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The README's examples import the package by name, so tests resolve that name to the source, not to a build.
    alias: [{ find: /^combinatrix$/, replacement: join(import.meta.dirname, 'src/index.ts') }],
  },
  test: {
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
});
