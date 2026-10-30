import type { DisplayIdentity } from "@exadev/build-identity";

/** Constants Vite substitutes into the page at build time (site/vite.config.ts). */
declare global {
  /** The release or commit the page was built from. */
  const __BUILD_IDENTITY__: DisplayIdentity;
  /** Whether the page registers its service worker: a build does, the dev server does not. */
  const __REGISTER_SERVICE_WORKER__: boolean;
}
