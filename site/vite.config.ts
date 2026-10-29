import { join } from "node:path";

import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  // The site is served from the repository's project page, https://exadev.github.io/combinatrix/.
  base: "/combinatrix/",
  resolve: {
    // The site runs the library from this repository's source, never from a published package, so it always reflects the commit it is built from.
    alias: [{ find: /^combinatrix$/, replacement: join(import.meta.dirname, "../src/index.ts") }],
  },
  // The page starts the engine worker with `type: "module"`, so it is built as an ES module.
  worker: { format: "es" },
  build: { outDir: "dist", emptyOutDir: true },
});
