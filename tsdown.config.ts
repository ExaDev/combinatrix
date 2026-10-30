import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    root: 'src',
    format: ['esm'],
    dts: true,
    platform: 'neutral',
    clean: true,
  },
  {
    // The command line is the one part that needs Node, so it is built apart from the library, which stays runtime-agnostic. It imports the library by its package name and leaves it external, so the installed package holds one copy of the library, which `combinatrix` resolves to through the package's own `exports`.
    entry: { cli: 'cli/main.ts' },
    root: 'cli',
    format: ['esm'],
    dts: false,
    platform: 'node',
    clean: false,
    deps: { neverBundle: ['combinatrix'] },
  },
]);
