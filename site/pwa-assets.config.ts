import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config";

/** The install icons (transparent, maskable and Apple touch sizes) are made from the one SVG at build time and never committed. */
export default defineConfig({
  preset: minimal2023Preset,
  images: ["public/icon.svg"],
});
