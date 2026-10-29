import { defineConfig, devices } from '@playwright/test';

/** The port `vite preview` serves the built site on: 4173 unless `E2E_PORT` names another, for a machine where something else already holds it. With `--strictPort`, a port something holds fails the run instead of testing whatever answers there. */
const DEFAULT_PORT = 4173;
const PORT = Number(process.env['E2E_PORT'] ?? DEFAULT_PORT);

/** The address the server listens on, named rather than left to `localhost`, which a machine may resolve to the IPv6 loopback alone while the tests ask for the IPv4 one: the server then runs and nothing reaches it. */
const HOST = '127.0.0.1';

/** The page's address: vite's `base` in site/vite.config.ts is the repository's project-page path. */
export const BASE_URL = `http://${HOST}:${String(PORT)}/combinatrix/`;

/** Whether this run is on a CI machine, which GitHub Actions marks with `CI`. */
const CI = process.env['CI'] !== undefined;

/** The most a build and its server may take to come up, in milliseconds. A bound on a hang, not a measure of speed: the work is one bundle. */
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
    command: `pnpm run site:build && pnpm run site:preview --host ${HOST} --port ${String(PORT)} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !CI,
    timeout: SERVER_START_TIMEOUT_MS,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
