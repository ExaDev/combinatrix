import { defineConfig, devices } from '@playwright/test';

/** The port `vite preview` serves the built site on. A fixed one, with `--strictPort`, so a server another process already holds fails the run instead of being tested by mistake. */
const PORT = 4173;

/** The page's address: vite's `base` in site/vite.config.ts is the repository's project-page path. */
export const BASE_URL = `http://127.0.0.1:${String(PORT)}/combinatrix/`;

/** The most a build and its server may take to come up, in milliseconds. A bound on a hang, not a measure of speed: the work is one bundle. */
/** Whether this run is on a CI machine, which GitHub Actions marks with `CI`. */
const CI = process.env['CI'] !== undefined;

const SERVER_START_TIMEOUT_MS = 120_000;

/** The most one test may take, in milliseconds. The slowest cancels a count that never finishes, which waits on the page's own controls, so this bounds a hang. */
const TEST_TIMEOUT_MS = 60_000;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: CI,
  // A test that passes only on a retry is a flake, and a flake is a defect to fix, so nothing is retried.
  retries: 0,
  timeout: TEST_TIMEOUT_MS,
  reporter: CI ? [['list'], ['github']] : 'list',
  outputDir: 'test-results',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    // The share-link tests read and write the clipboard.
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // The site as it is deployed: the production build, served by vite's own preview, not the dev server.
    command: `pnpm run site:build && pnpm run site:preview --port ${String(PORT)} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !CI,
    timeout: SERVER_START_TIMEOUT_MS,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
