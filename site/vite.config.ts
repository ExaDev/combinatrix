import { join } from "node:path";

import { loadCommitAnalyzer, predictNextVersion, resolveBuildIdentity, resolvePredictedIdentity } from "@exadev/build-identity";
import type { UserConfig } from "vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

import { releaseRules } from "../release.config.ts";

/** The repository root, which holds the git history the build's identity is read from. */
const REPOSITORY_ROOT = join(import.meta.dirname, "..");

/** The repository the explorer is built from, which its release and commit links point into. */
const REPOSITORY = "ExaDev/combinatrix";

/** The path the explorer is served under: the repository's project page, https://exadev.github.io/combinatrix/. */
const BASE = "/combinatrix/";

/** The colour of the install icon's squares and of the title bar of an installed window in the light scheme; the page's `--accent`. */
const THEME_COLOR = "#1d5fc4";

/** The page's `--bg`, shown while an installed window starts. */
const BACKGROUND_COLOR = "#ffffff";

export default defineConfig(async ({ command }): Promise<UserConfig> => {
  // Read from git at build time and never committed: a release if a release tag is on this commit, else the version this commit will release as, else the commit. The history must include the tags (a full checkout).
  const identity = resolvePredictedIdentity(
    resolveBuildIdentity(REPOSITORY_ROOT, REPOSITORY),
    await predictNextVersion(REPOSITORY_ROOT, releaseRules, await loadCommitAnalyzer()),
  );

  return {
    root: import.meta.dirname,
    // The site is served from the repository's project page, https://exadev.github.io/combinatrix/.
    base: BASE,
    define: {
      __BUILD_IDENTITY__: JSON.stringify(identity),
      // The service worker exists only in a build, so the dev server never registers one.
      __REGISTER_SERVICE_WORKER__: JSON.stringify(command === "build"),
    },
    resolve: {
      // The site runs the library from this repository's source, never from a published package, so it always reflects the commit it is built from.
      alias: [{ find: /^combinatrix$/, replacement: join(import.meta.dirname, "../src/index.ts") }],
    },
    // The page starts the engine worker with `type: "module"`, so it is built as an ES module.
    worker: { format: "es" },
    build: { outDir: "dist", emptyOutDir: true },
    plugins: [
      VitePWA({
        // A waiting service worker is left waiting until the page asks for it, so the page can offer the update instead of swapping the code under an open session.
        registerType: "prompt",
        // The page registers it itself (site/src/updates.ts), so it can report a waiting worker in its own markup.
        injectRegister: false,
        // The theme colour is set in index.html for each colour scheme, which a manifest cannot express.
        pwaAssets: { config: true, injectThemeColor: false },
        manifest: {
          id: BASE,
          name: "Combinatrix Explorer",
          short_name: "combinatrix",
          description: "Describe the options of a system and the rules between them, then count, list, explain and cover the valid combinations, in the browser and offline.",
          lang: "en-GB",
          start_url: BASE,
          scope: BASE,
          display: "standalone",
          theme_color: THEME_COLOR,
          background_color: BACKGROUND_COLOR,
        },
        workbox: {
          // The whole built site, the engine worker's chunk included, so every operation runs with no network. The manifest is left out because the plugin adds it to the precache itself, and Workbox refuses to start when one address is listed twice with different revisions: the worker would install without caching anything.
          globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
          // Any address under the app, a `?gist=` or `#s=` link included, opens the cached page.
          navigateFallback: `${BASE}index.html`,
          cleanupOutdatedCaches: true,
        },
      }),
    ],
  };
});
