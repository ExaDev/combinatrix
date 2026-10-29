import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import type { Page } from '@playwright/test';
import { ADDRESS_DEBOUNCE_MS, MAX_ADDRESS_LENGTH } from '../site/src/address';
import { decodeState, encodedStateOf } from '../site/src/fragment';
import type { JsonObject } from '../site/src/json';
import { Explorer, RESULT_TIMEOUT_MS, STARTING_EXAMPLE } from './explorer';

/** The index a link carries, so the page that opens it shows that combination. */
const SHARED_INDEX = 5;

/** A public gist's id, which is hexadecimal, and the model it holds. */
const GIST_ID = '0123456789abcdef0123';
const GIST_MODEL: JsonObject = { dimensions: [{ kind: 'choice', name: 'from-gist', values: ['one', 'two', 'three'] }] };

/** The HTTP status of an answer that is fine, and of one that says the gist is not there. */
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

/** Characters in a model too large for the address bar, as multiples of the longest address the page writes. Deflate shrinks random base-36 text to about five eighths of its length and base64url grows that by a third, so a text this many times the limit makes a link comfortably longer than it. */
const OVERSIZE_FACTOR = 1.5;

/** The multiplier and increment of a linear congruential generator, so the large model is the same on every run. */
const LCG_MULTIPLIER = 1_103_515_245;
const LCG_INCREMENT = 12_345;

/** The radix that writes a number in the fewest characters, and the characters one number is written in. */
const BASE_36 = 36;
const DIGITS_PER_NUMBER = 6;

/** A text of at least `length` characters that deflate cannot shrink much, the same on every run. */
function incompressibleText(length: number): string {
  let seed = 1;
  let text = '';
  while (text.length < length) {
    seed = (Math.imul(seed, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
    text += seed.toString(BASE_36).padStart(DIGITS_PER_NUMBER, '0');
  }

  return text;
}

/** The index the state in a fragment holds, or `undefined` when the fragment holds no state or no index. */
async function decodedIndexOf(hash: string): Promise<number | undefined> {
  const encoded = encodedStateOf(hash);

  return encoded === undefined ? undefined : (await decodeState(encoded)).index;
}

/** What the page logs when its fragment changes by anything but its own address writes. */
const HASH_CHANGE_MESSAGE = 'hashchange fired';

/** The fragment of the page's address now. */
async function hashOf(page: Page): Promise<string> {
  return page.evaluate((): string => location.hash);
}

/** Answers GitHub's gist API from the test, so no request leaves the machine. */
async function serveGist(page: Page, status: number, body: unknown): Promise<string[]> {
  const requested: string[] = [];
  await page.route('https://api.github.com/gists/**', async (route) => {
    requested.push(route.request().url());
    await route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });

  return requested;
}

/** The link the page's Copy link button makes, with a combination selected. */
async function copiedLink(explorer: Explorer): Promise<string> {
  await explorer.id('index').fill(String(SHARED_INDEX));
  await explorer.id('copy-link').click();
  await expect(explorer.id('link-status')).toContainText('Link copied', { timeout: RESULT_TIMEOUT_MS });

  return explorer.id('link').inputValue();
}

test.describe('share links', () => {
  test('carries the model and the selected combination to a fresh page, and puts the link on the clipboard', async ({ page, context, baseURL }) => {
    const explorer = await Explorer.open(page);
    await explorer.loadExample(STARTING_EXAMPLE);
    await explorer.field('dimensions.2.values:add').click();
    await explorer.field('dimensions.2.values.3:value').fill('wasmtime');
    await explorer.ready();
    const model = await explorer.json();
    const link = await copiedLink(explorer);

    expect(link.startsWith(`${String(baseURL)}#s=`)).toBe(true);
    expect(await page.evaluate(async () => navigator.clipboard.readText())).toBe(link);
    const fresh = await context.newPage();
    await fresh.goto(link);
    const opened = new Explorer(fresh);
    await opened.ready();

    await expect(opened.result('combination')).toContainText(`The combination at index ${String(SHARED_INDEX)}`, { timeout: RESULT_TIMEOUT_MS });
    await expect(opened.field('dimensions.2.values.3:value')).toHaveValue('wasmtime');
    await expect(opened.id('index')).toHaveValue(String(SHARED_INDEX));
    expect(await opened.json()).toEqual(model);
  });

  test('never sends the fragment to a server', async ({ page, context, baseURL }) => {
    const link = await copiedLink(await Explorer.open(page));
    const requested: string[] = [];
    const fresh = await context.newPage();
    fresh.on('request', (request) => requested.push(request.url()));
    await fresh.goto(link);
    await new Explorer(fresh).ready();

    expect(requested.length).toBeGreaterThan(0);
    expect(requested.filter((url) => url.includes('#') || url.includes('s='))).toEqual([]);
    expect(requested.filter((url) => !url.startsWith(new URL(String(baseURL)).origin))).toEqual([]);
  });

  test('restores the state when only the fragment of the open page changes', async ({ page, context }) => {
    const link = await copiedLink(await Explorer.open(page));
    const second = await context.newPage();
    const explorer = await Explorer.open(second);
    await second.evaluate((target) => {
      location.hash = new URL(target).hash;
    }, link);

    await expect(explorer.result('combination')).toContainText(`The combination at index ${String(SHARED_INDEX)}`, { timeout: RESULT_TIMEOUT_MS });
  });

  test('shows a message, not a crash, for a link that holds no state', async ({ page }) => {
    await page.goto('#s=AAAA');

    await expect(page.locator('#notice')).toContainText('could not be loaded', { timeout: RESULT_TIMEOUT_MS });
    await new Explorer(page).ready();
  });
});

test.describe('the address bar', () => {
  test('stays as it was opened until the model is changed, and returns to it when the model is changed back', async ({ page }) => {
    const explorer = await Explorer.open(page);
    const opened = page.url();
    const text = await (await explorer.advanced()).inputValue();
    await page.waitForTimeout(ADDRESS_DEBOUNCE_MS * 2);

    expect(page.url()).toBe(opened);
    await explorer.setJson({ dimensions: [{ kind: 'choice', name: 'changed', values: ['yes'] }] });
    await expect.poll(async () => hashOf(page), { timeout: RESULT_TIMEOUT_MS }).toMatch(/^#s=/);
    await explorer.setText(text);

    await expect.poll(() => page.url(), { timeout: RESULT_TIMEOUT_MS }).toBe(opened);
  });

  test('follows an edit made in the form, without adding history entries or firing hashchange', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await explorer.loadExample(STARTING_EXAMPLE);
    const hashChanges: string[] = [];
    page.on('console', (message) => {
      if (message.text() === HASH_CHANGE_MESSAGE) hashChanges.push(message.text());
    });
    await page.evaluate((message) => {
      window.addEventListener('hashchange', () => {
        console.log(message);
      });
    }, HASH_CHANGE_MESSAGE);
    const history = await page.evaluate(() => window.history.length);
    await explorer.field('dimensions.2.values:add').click();
    await explorer.field('dimensions.2.values.3:value').fill('wasmtime');
    await explorer.ready();
    await expect.poll(async () => hashOf(page), { timeout: RESULT_TIMEOUT_MS }).toMatch(/^#s=/);

    expect(await page.evaluate(() => window.history.length)).toBe(history);
    expect(hashChanges).toEqual([]);
  });

  test('is the link Copy link makes, so reloading it, or opening it elsewhere, shows the same model and combination', async ({ page, context }) => {
    const explorer = await Explorer.open(page);
    await explorer.loadExample(STARTING_EXAMPLE);
    await explorer.field('dimensions.2.values:add').click();
    await explorer.field('dimensions.2.values.3:value').fill('wasmtime');
    await explorer.ready();
    await explorer.setNumber('index', SHARED_INDEX);
    await expect.poll(async () => decodedIndexOf(await hashOf(page)), { timeout: RESULT_TIMEOUT_MS }).toBe(SHARED_INDEX);
    const model = await explorer.json();
    const link = page.url();
    await explorer.id('copy-link').click();
    await expect(explorer.id('link-status')).toContainText('Link copied', { timeout: RESULT_TIMEOUT_MS });

    expect(await explorer.id('link').inputValue()).toBe(link);
    await page.reload();
    await explorer.ready();
    expect(await explorer.json()).toEqual(model);
    await expect(explorer.id('index')).toHaveValue(String(SHARED_INDEX));
    const fresh = await context.newPage();
    await fresh.goto(link);
    const opened = new Explorer(fresh);
    await opened.ready();

    expect(await opened.json()).toEqual(model);
  });

  test('keeps text that is not yet valid JSON, so reloading does not lose it', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await explorer.setText('{ not json yet');
    await expect.poll(async () => hashOf(page), { timeout: RESULT_TIMEOUT_MS }).toMatch(/^#s=/);
    await page.reload();

    await expect(explorer.id('model')).toHaveValue('{ not json yet', { timeout: RESULT_TIMEOUT_MS });
  });

  test('replaces the gist of the address with the edited model, which a reload then shows instead of the gist', async ({ page }) => {
    const requested = await serveGist(page, HTTP_OK, { files: { 'model.json': { content: JSON.stringify(GIST_MODEL) } } });
    await page.goto(`?gist=${GIST_ID}`);
    const explorer = new Explorer(page);
    await explorer.ready();
    await page.waitForTimeout(ADDRESS_DEBOUNCE_MS * 2);

    expect(new URL(page.url()).search).toBe(`?gist=${GIST_ID}`);
    await explorer.field('dimensions.0.values:add').click();
    await explorer.field('dimensions.0.values.3:value').fill('four');
    await explorer.ready();
    await expect.poll(async () => hashOf(page), { timeout: RESULT_TIMEOUT_MS }).toMatch(/^#s=/);
    const edited = await explorer.json();
    await page.reload();
    await explorer.ready();

    expect(new URL(page.url()).search).toBe('');
    expect(await explorer.json()).toEqual(edited);
    expect(requested).toEqual([`https://api.github.com/gists/${GIST_ID}`]);
  });

  test('stops following a model too large for an address, says so, and follows again once it is small', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await explorer.setJson({ dimensions: [{ kind: 'choice', name: 'small', values: ['yes'] }] });
    await expect.poll(async () => hashOf(page), { timeout: RESULT_TIMEOUT_MS }).toMatch(/^#s=/);
    const large = JSON.stringify({ dimensions: [{ kind: 'choice', name: incompressibleText(Math.ceil(MAX_ADDRESS_LENGTH * OVERSIZE_FACTOR)), values: ['yes'] }] });
    await explorer.setJson(large);

    await expect(explorer.id('address-status')).toContainText('too large', { timeout: RESULT_TIMEOUT_MS });
    expect(await hashOf(page)).toBe('');
    await explorer.setJson({ dimensions: [{ kind: 'choice', name: 'small again', values: ['yes'] }] });

    await expect(explorer.id('address-status')).toHaveText('', { timeout: RESULT_TIMEOUT_MS });
    await expect.poll(async () => hashOf(page), { timeout: RESULT_TIMEOUT_MS }).toMatch(/^#s=/);
  });
});

test.describe('gists', () => {
  test('loads the first .json file of a public gist by id, asking only GitHub for it', async ({ page }) => {
    const requested = await serveGist(page, HTTP_OK, { files: { 'notes.md': { content: 'ignore me' }, 'model.json': { content: JSON.stringify(GIST_MODEL) } } });
    await page.goto(`?gist=${GIST_ID}`);
    const explorer = new Explorer(page);
    await explorer.ready();

    expect(await explorer.json()).toEqual(GIST_MODEL);
    expect(requested).toEqual([`https://api.github.com/gists/${GIST_ID}`]);
  });

  test('says so when GitHub does not have the gist', async ({ page }) => {
    await serveGist(page, HTTP_NOT_FOUND, {});
    await page.goto('?gist=deadbeef');

    await expect(page.locator('#notice')).toContainText('GitHub answered 404', { timeout: RESULT_TIMEOUT_MS });
  });

  test('keeps the text of a gist that is not JSON in the Advanced view, opened, and the form on its last model', async ({ page }) => {
    await serveGist(page, HTTP_OK, { files: { 'model.json': { content: '{ not json' } } });
    await page.goto('?gist=cafe0123');
    const explorer = new Explorer(page);

    await expect(explorer.id('form-notice')).toBeVisible({ timeout: RESULT_TIMEOUT_MS });
    await expect(explorer.id('model')).toHaveValue('{ not json');
    await expect(explorer.id('advanced')).toHaveAttribute('open', '');
  });
});

test.describe('saved models, import and export', () => {
  test('saves a model by name, opens it again after changing the model and after a reload, and deletes it', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await explorer.loadExample(STARTING_EXAMPLE);
    const saved = await explorer.json();
    await explorer.id('save-name').fill('my rule model');
    await explorer.id('save').click();
    await expect(explorer.id('saved-status')).toContainText('Saved my rule model.');
    await explorer.loadExample('Operating systems and architectures');

    expect(await explorer.json()).not.toEqual(saved);
    await page.getByRole('button', { name: 'Open my rule model' }).click();
    await explorer.ready();

    expect(await explorer.json()).toEqual(saved);
    await page.reload();
    await explorer.ready();
    await expect(page.getByRole('button', { name: 'Open my rule model' })).toBeVisible();
    await page.getByRole('button', { name: 'Delete my rule model' }).click();

    await expect(page.getByRole('button', { name: 'Open my rule model' })).toHaveCount(0);
  });

  test('exports the editor text as a file, and imports a file into the form', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await explorer.loadExample('A conditional, derived dimension');
    const text = await (await explorer.advanced()).inputValue();
    const download = page.waitForEvent('download');
    await explorer.id('export').click();
    const file = await download;
    const folder = await mkdtemp(join(tmpdir(), 'combinatrix-e2e-'));
    const exported = join(folder, 'exported.json');
    await file.saveAs(exported);

    expect(file.suggestedFilename()).toBe('combinatrix-model.json');
    expect(await readFile(exported, 'utf8')).toBe(text);
    const imported = join(folder, 'imported.json');
    await writeFile(imported, JSON.stringify({ dimensions: [{ kind: 'choice', name: 'imported', values: ['yes'] }] }));
    await explorer.id('import').setInputFiles(imported);

    await expect(explorer.field('dimensions.0:name')).toHaveValue('imported', { timeout: RESULT_TIMEOUT_MS });
    await explorer.ready();
  });
});
