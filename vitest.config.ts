import { join } from 'node:path';

import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The README's examples import the package by name, so tests resolve that name to the source, not to a build.
    alias: [{ find: /^combinatrix$/, replacement: join(import.meta.dirname, 'src/index.ts') }],
  },
  test: {
    // The browser tests under e2e/ are Playwright's, run by `pnpm test:e2e`, and a unit run neither needs a browser nor may start one.
    exclude: [...configDefaults.exclude, 'e2e/**'],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
});
