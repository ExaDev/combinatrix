import { join } from 'node:path';

import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { BASE_URL } from '../playwright.config';
import { shareUrl } from '../site/src/fragment';

import { Explorer, RESULT_TIMEOUT_MS } from './explorer';
import type { StaticSite } from './staticSite';
import { serveSite } from './staticSite';

/** The model a share link carries in the offline tests, with one dimension of two values so its size is known. */
const SHARED_MODEL = JSON.stringify({ dimensions: [{ kind: 'choice', name: 'shared', values: ['one', 'two'] }] });
const SHARED_SIZE = 2;

/** The icon sizes an installable app needs: the smaller of the two Chrome requires and the larger it uses for the splash screen. */
const REQUIRED_ICON_SIZES = ['192x192', '512x512'];

/** The built site, which the web server in playwright.config.ts has just built, and the path it is built to be served under. */
const DIST = join(import.meta.dirname, '../site/dist');
const BASE = new URL(BASE_URL).pathname;

/** The build the served service worker reports. A test calls `deploy` to give the browser a different worker to find, as a deployment of a newer build would. */
class Deployment {
  build = 1;

  deploy(): void {
    this.build += 1;
  }
}

/** Runs a test against the built site served from an origin of its own, with the service worker's script carrying the deployment's build number, and stops the server afterwards. */
async function withSite(run: (site: StaticSite, deployment: Deployment) => Promise<void>): Promise<void> {
  const deployment = new Deployment();
  const site = await serveSite(DIST, BASE, (path, body) => (path === 'sw.js' ? Buffer.concat([body, Buffer.from(`\nself.__build = ${String(deployment.build)};\n`)]) : body));
  try {
    await run(site, deployment);
  } finally {
    await site.stop();
  }
}

/** The explorer opened at the site's start page, or at a path under it. */
async function openAt(page: Page, site: StaticSite, path = ''): Promise<Explorer> {
  await page.goto(`${site.url}${path}`);
  const explorer = new Explorer(page);
  await explorer.ready();

  return explorer;
}

/** A page controlled by the service worker, which does not claim the page that registered it: the page is loaded again once the worker is active. */
async function controlledPage(page: Page, site: StaticSite): Promise<Explorer> {
  await openAt(page, site);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(async () => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: RESULT_TIMEOUT_MS }).toBe(true);
  const explorer = new Explorer(page);
  await explorer.ready();

  return explorer;
}

/** The longest a read of one service worker may take, in milliseconds. A worker that is being replaced can leave a call into it pending for good, so the read is given up and the poll that asked for it asks again, rather than waiting on a worker that will never answer. */
const WORKER_READ_TIMEOUT_MS = 1000;

/** The promise's result, or a rejection if it has not settled within `ms`. */
async function within<T>(ms: number, promise: Readonly<Promise<T>>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`no answer within ${String(ms)} ms`));
    }, ms);
  });
  try {
    return await Promise.race([promise, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** What a service worker reports from inside itself: the build its script was served with and its lifecycle state. */
interface WorkerReport {
  readonly build: unknown;
  readonly state: unknown;
}

/** The build the service worker now in charge of the page reports. The context lists every worker it has seen, one waiting for its turn and one it replaced included, so each is asked for its state and only the activated one is believed. */
async function activeBuild(context: BrowserContext): Promise<unknown> {
  const reports = await Promise.allSettled(
    context.serviceWorkers().map(async (worker): Promise<WorkerReport> =>
      within(
        WORKER_READ_TIMEOUT_MS,
        worker.evaluate(() => {
          const serviceWorker: unknown = Reflect.get(self, 'serviceWorker');
          const state: unknown = typeof serviceWorker === 'object' && serviceWorker !== null && 'state' in serviceWorker ? serviceWorker.state : undefined;
          const build: unknown = Reflect.get(self, '__build');

          return { build, state };
        }),
      ),
    ),
  );
  const active = reports.flatMap((report) => (report.status === 'fulfilled' && report.value.state === 'activated' ? [report.value.build] : []));

  return active.at(-1);
}

/** The parts of an icon entry of the manifest that the tests read. */
interface ManifestIcon {
  readonly src: string;
  readonly sizes: string;
  readonly purpose?: string;
}

/** Whether a value is a plain object, whose properties are read by name. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a value is the list of icons of a manifest. */
function isIconList(value: unknown): value is readonly ManifestIcon[] {
  return Array.isArray(value) && value.every((icon: unknown) => isRecord(icon) && typeof icon['src'] === 'string' && typeof icon['sizes'] === 'string');
}

/** Lets a waiting service worker be found now, as the page becoming visible again does. */
async function checkForUpdate(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** Has the page report itself hidden, as switching to another tab does: the visibility state is replaced and the event the browser would send is sent. */
async function hide(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** Waits until the address bar holds the page's model, which is when a reload would restore it. */
async function addressFollows(page: Page): Promise<void> {
  await expect.poll(() => new URL(page.url()).hash, { timeout: RESULT_TIMEOUT_MS }).toContain('#s=');
}

test.describe('installable', () => {
  test('serves a manifest that makes the page an installable app under its own address', async ({ page }) => {
    await withSite(async (site) => {
      await openAt(page, site);
      const href = new URL(String(await page.locator('link[rel=manifest]').getAttribute('href')), site.url).href;
      const response = await page.request.get(href);
      const manifest: unknown = await response.json();

      expect(response.ok()).toBe(true);
      expect(manifest).toMatchObject({ display: 'standalone', scope: BASE, start_url: BASE });
      const icons = isRecord(manifest) ? manifest['icons'] : undefined;
      if (!isIconList(icons)) throw new Error('the manifest lists no icons');
      for (const size of REQUIRED_ICON_SIZES) expect(icons.some((icon) => icon.sizes === size && icon.purpose === undefined)).toBe(true);
      expect(icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
      const statuses = await Promise.all(icons.map(async (icon) => (await page.request.get(new URL(icon.src, href).href)).ok()));
      expect(statuses.every(Boolean)).toBe(true);
    });
  });

  test("passes the browser's own installability checks", async ({ page, context }) => {
    await withSite(async (site) => {
      await controlledPage(page, site);
      const { installabilityErrors } = await (await context.newCDPSession(page)).send('Page.getInstallabilityErrors');

      expect(installabilityErrors).toEqual([]);
    });
  });

  test('names the colour of an installed window for each colour scheme and has an icon for the home screen', async ({ page }) => {
    await withSite(async (site) => {
      await openAt(page, site);

      await expect(page.locator('meta[name=theme-color][media*=light]')).toHaveCount(1);
      await expect(page.locator('meta[name=theme-color][media*=dark]')).toHaveCount(1);
      await expect(page.locator('link[rel=apple-touch-icon]')).toHaveCount(1);
    });
  });
});

test.describe('the version link', () => {
  test('links to the release or the commit the page was built from', async ({ page }) => {
    await withSite(async (site) => {
      await openAt(page, site);
      const link = page.locator('#build-link');

      await expect(link).toHaveText(/^(v\d+\.\d+\.\d+|[0-9a-f]{7,})$/);
      await expect(link).toHaveAttribute('href', /^https:\/\/github\.com\/ExaDev\/combinatrix\/(releases\/tag\/v\d+\.\d+\.\d+|commit\/[0-9a-f]{40})$/);
      await expect(link).toHaveAttribute('title', /^(Released on|Built from commit) /);
    });
  });
});

test.describe('offline', () => {
  test('says the site is ready to work offline once the first load has cached it, and not on later loads', async ({ page }) => {
    await withSite(async (site) => {
      await openAt(page, site);

      await expect(page.locator('#offline-status')).toHaveText('Ready to work offline.', { timeout: RESULT_TIMEOUT_MS });

      await page.reload();
      await new Explorer(page).ready();

      await expect(page.locator('#offline-status')).toHaveText('');
    });
  });

  test('opens, runs an operation and shows the engine with no network once it has been loaded', async ({ page }) => {
    await withSite(async (site) => {
      const explorer = await controlledPage(page, site);
      await site.stop();
      await page.reload();
      await explorer.ready();
      await explorer.run('count');

      await expect(explorer.result('count')).toContainText('combinations satisfy the model.', { timeout: RESULT_TIMEOUT_MS });
    });
  });

  test('opens a share link in a new page with no network', async ({ page, context }) => {
    await withSite(async (site) => {
      await controlledPage(page, site);
      await site.stop();
      const fresh = await context.newPage();
      await fresh.goto(await shareUrl(site.url, { model: SHARED_MODEL }));
      const explorer = new Explorer(fresh);
      await explorer.ready();
      await explorer.run('count');

      await expect(explorer.result('count')).toContainText(`${String(SHARED_SIZE)} combinations satisfy the model.`, { timeout: RESULT_TIMEOUT_MS });
    });
  });

  test('says a gist cannot be loaded with no network, instead of failing silently', async ({ page }) => {
    await withSite(async (site) => {
      await controlledPage(page, site);
      await site.stop();
      await page.goto(`${site.url}?gist=0123abcd`);

      await expect(page.locator('#notice')).toContainText('could not be loaded', { timeout: RESULT_TIMEOUT_MS });
    });
  });
});

test.describe('updates', () => {
  test('offers a newer build when one is waiting and installs it only when the user asks', async ({ page, context }) => {
    await withSite(async (site, deployment) => {
      const explorer = await controlledPage(page, site);
      await expect(explorer.id('update-prompt')).toBeHidden();

      deployment.deploy();
      await checkForUpdate(page);

      await expect(explorer.id('update-prompt')).toBeVisible({ timeout: RESULT_TIMEOUT_MS });
      expect(await activeBuild(context)).toBe(1);

      await explorer.id('update-now').click();

      await expect.poll(async () => activeBuild(context), { timeout: RESULT_TIMEOUT_MS }).toBe(2);
      await explorer.ready();
      await expect(explorer.id('update-prompt')).toBeHidden();
    });
  });

  test('keeps the running build when the user puts the update off', async ({ page, context }) => {
    await withSite(async (site, deployment) => {
      const explorer = await controlledPage(page, site);
      deployment.deploy();
      await checkForUpdate(page);
      await expect(explorer.id('update-prompt')).toBeVisible({ timeout: RESULT_TIMEOUT_MS });
      await explorer.id('update-later').click();

      await expect(explorer.id('update-prompt')).toBeHidden();
      expect(await activeBuild(context)).toBe(1);
    });
  });

  test('installs a waiting update by itself when the page is hidden, and the reloaded page shows the same model', async ({ page, context }) => {
    await withSite(async (site, deployment) => {
      const explorer = await controlledPage(page, site);
      await explorer.field('title:text').fill('Kept across the update');
      await addressFollows(page);
      deployment.deploy();
      await checkForUpdate(page);
      await expect(explorer.id('update-prompt')).toBeVisible({ timeout: RESULT_TIMEOUT_MS });
      expect(await activeBuild(context)).toBe(1);

      await hide(page);

      await expect.poll(async () => activeBuild(context), { timeout: RESULT_TIMEOUT_MS }).toBe(2);
      await explorer.ready();
      await expect(explorer.field('title:text')).toHaveValue('Kept across the update');
      await expect(explorer.id('update-prompt')).toBeHidden();
    });
  });

  test('leaves a waiting update for the prompt when the page is hidden with a model it cannot restore from its address', async ({ page, context }) => {
    await withSite(async (site, deployment) => {
      const explorer = await controlledPage(page, site);
      await explorer.setJson({ id: 'foo', dimensions: [{ kind: 'choice', name: 'os', values: ['linux'] }] });
      await explorer.id('save-name').fill('mine');
      await explorer.id('save').click();
      await expect(explorer.id('saved-status')).toContainText('Saved mine.');
      // A copy with the same id and other content waits for the person to choose, which is state the address does not hold.
      await page.goto(await shareUrl(site.url, { model: JSON.stringify({ id: 'foo', dimensions: [{ kind: 'choice', name: 'os', values: ['linux', 'macos'] }] }) }));
      await expect(explorer.id('clash')).toBeVisible({ timeout: RESULT_TIMEOUT_MS });
      deployment.deploy();
      await checkForUpdate(page);
      await expect(explorer.id('update-prompt')).toBeVisible({ timeout: RESULT_TIMEOUT_MS });

      await hide(page);

      await expect(explorer.id('clash')).toBeVisible();
      expect(await activeBuild(context)).toBe(1);
      // Once the choice is made and the address holds the model, the same update installs on hiding.
      await explorer.id('clash-keep').click();
      await addressFollows(page);
      await hide(page);

      await expect.poll(async () => activeBuild(context), { timeout: RESULT_TIMEOUT_MS }).toBe(2);
    });
  });
});
