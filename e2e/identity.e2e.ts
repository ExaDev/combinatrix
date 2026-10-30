import { expect, test } from '@playwright/test';

import type { Page } from '@playwright/test';
import { decodeState, encodedStateOf, encodeState } from '../site/src/fragment';
import type { JsonObject } from '../site/src/json';
import { parseJson } from '../site/src/json';
import { Explorer, RESULT_TIMEOUT_MS, STARTING_EXAMPLE } from './explorer';

/** A durable id as the page mints it: a UUID. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The keys of the model after the form has written a title and a description, in front of the definition. */
const LEADING_KEYS = ['$schema', 'title', 'description'];

/** The model user A saved, and the model user B edited from a copy of it and sent back: the same id and different content. */
const MINE: JsonObject = { id: 'foo', title: 'Builds', dimensions: [{ kind: 'choice', name: 'os', values: ['linux', 'macos'] }] };
const THEIRS: JsonObject = { id: 'foo', title: 'Builds', dimensions: [{ kind: 'choice', name: 'os', values: ['linux', 'macos'] }, { kind: 'choice', name: 'arch', values: ['x64', 'arm64'] }] };

/** Saves a model under a name from the editor. */
async function saveAs(explorer: Explorer, model: JsonObject, name: string): Promise<void> {
  await explorer.setJson(model);
  await explorer.id('save-name').fill(name);
  await explorer.id('save').click();
  await expect(explorer.id('saved-status')).toContainText(`Saved ${name}.`);
}

/** The fragment of a link to a model, as the page's Copy link writes it. */
async function linkTo(model: JsonObject): Promise<string> {
  return `#s=${await encodeState({ model: JSON.stringify(model) })}`;
}

/** Waits until the address bar holds a link to this model, which is where "keep mine" leaves it. */
async function addressHolds(page: Page, model: JsonObject): Promise<void> {
  await expect
    .poll(
      async () => {
        const encoded = encodedStateOf(new URL(page.url()).hash);

        return encoded === undefined ? undefined : parseJson((await decodeState(encoded)).model);
      },
      { timeout: RESULT_TIMEOUT_MS },
    )
    .toEqual(model);
}

/** Opens a link to a model in the page that is open, as following a link to the same page does. */
async function follow(page: Page, model: JsonObject): Promise<void> {
  await page.goto(await linkTo(model));
}

test.describe('a model with a durable id', () => {
  test('is given an id when it is saved, and shows it in the form and the JSON', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await explorer.loadExample(STARTING_EXAMPLE);
    expect((await explorer.json())['id']).toBeUndefined();
    await expect(page.getByText('The model has no id yet')).toBeVisible();

    await explorer.id('save-name').fill('rules');
    await explorer.id('save').click();

    const id = (await explorer.json())['id'];
    if (typeof id !== 'string') throw new Error('the model has no id');
    expect(id).toMatch(UUID);
    await expect(page.locator('#form code')).toHaveText(id);
  });

  test('is given an id when its link is copied, and keeps it when it is saved afterwards', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await explorer.loadExample(STARTING_EXAMPLE);

    await explorer.id('copy-link').click();
    await expect(explorer.id('link-status')).toContainText('Link copied', { timeout: RESULT_TIMEOUT_MS });
    const id = (await explorer.json())['id'];
    await explorer.id('save-name').fill('rules');
    await explorer.id('save').click();

    expect(id).toMatch(UUID);
    expect((await explorer.json())['id']).toBe(id);
  });

  test('moves the models saved by name before they had ids, keeping their names', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await page.evaluate(() => {
      window.localStorage.setItem('combinatrix.models', JSON.stringify({ older: JSON.stringify({ dimensions: [] }) }));
    });

    await page.reload();
    await explorer.ready();

    await page.getByRole('button', { name: 'Open older' }).click();
    expect((await explorer.json())['id']).toMatch(UUID);
    expect(await page.evaluate(() => window.localStorage.getItem('combinatrix.models'))).toBeNull();
  });

  test('takes a title and a description from the form, written in front of the definition', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await explorer.loadExample(STARTING_EXAMPLE);

    await explorer.field('title:text').fill('Builds');
    await explorer.field('description:text').fill('Where it builds.');

    const model = await explorer.json();
    expect(model['title']).toBe('Builds');
    expect(model['description']).toBe('Where it builds.');
    expect(Object.keys(model).slice(0, LEADING_KEYS.length)).toEqual(LEADING_KEYS);
  });

  test.describe('arriving from a link with the id of a saved model, with different content', () => {
    test('is not opened over the saved model: it shows what differs and waits, and keeping mine leaves everything as it was', async ({ page }) => {
      const explorer = await Explorer.open(page);
      await saveAs(explorer, MINE, 'mine');
      const before = await explorer.json();

      await follow(page, THEIRS);

      await expect(explorer.id('clash')).toBeVisible();
      await expect(explorer.id('clash-changes')).toContainText('dimension "arch" is only in theirs');
      expect(await explorer.json()).toEqual(before);
      await explorer.id('clash-keep').click();

      await expect(explorer.id('clash')).toBeHidden();
      expect(await explorer.json()).toEqual(before);
      await addressHolds(page, before);
      await expect(page.locator('#saved-list li')).toHaveCount(1);
    });

    test('replacing with theirs opens theirs and keeps mine as a saved copy under an id of its own', async ({ page }) => {
      const explorer = await Explorer.open(page);
      await saveAs(explorer, MINE, 'mine');
      await follow(page, THEIRS);
      await expect(explorer.id('clash')).toBeVisible();

      await explorer.id('clash-replace').click();

      await expect(explorer.id('clash')).toBeHidden();
      await expect(explorer.field('dimensions.1:name')).toHaveValue('arch', { timeout: RESULT_TIMEOUT_MS });
      expect((await explorer.json())['id']).toBe('foo');
      await expect(page.getByRole('button', { name: 'Open Builds (replaced)' })).toBeVisible();
      await page.getByRole('button', { name: 'Open Builds (replaced)' }).click();
      await expect(explorer.id('clash')).toBeHidden();
      const kept = await explorer.json();
      expect(kept['id']).not.toBe('foo');
      expect(kept['dimensions']).toEqual(MINE['dimensions']);
    });

    test('saving theirs as a copy opens it under a new id and leaves mine as it was', async ({ page }) => {
      const explorer = await Explorer.open(page);
      await saveAs(explorer, MINE, 'mine');
      await follow(page, THEIRS);
      await expect(explorer.id('clash')).toBeVisible();

      await explorer.id('clash-copy').click();

      await expect(explorer.id('clash')).toBeHidden();
      await expect(explorer.field('dimensions.1:name')).toHaveValue('arch', { timeout: RESULT_TIMEOUT_MS });
      const copy = await explorer.json();
      expect(copy['id']).toMatch(UUID);
      await page.getByRole('button', { name: 'Open mine' }).click();
      await expect(explorer.id('clash')).toBeHidden();
      expect(await explorer.json()).toEqual(MINE);
    });

    test('is held when the page opens on the link, and keeping mine opens the saved model', async ({ page }) => {
      const explorer = await Explorer.open(page);
      await saveAs(explorer, MINE, 'mine');

      await follow(page, THEIRS);
      await page.reload();

      await expect(explorer.id('clash')).toBeVisible();
      await expect(explorer.id('clash-summary')).toContainText('already saved');
      await explorer.id('clash-keep').click();
      await explorer.ready();
      expect(await explorer.json()).toEqual(MINE);
      await addressHolds(page, MINE);
    });

    test('opens without asking when the content is the same', async ({ page }) => {
      const explorer = await Explorer.open(page);
      await saveAs(explorer, MINE, 'mine');

      await follow(page, { ...MINE, dimensions: MINE['dimensions'] ?? [] });

      await expect(explorer.id('clash')).toBeHidden();
    });
  });

  test('opening a saved model over unsaved edits to it asks, and keeping mine keeps the edits', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await saveAs(explorer, MINE, 'mine');
    await explorer.field('title:text').fill('Builds, edited');

    await page.getByRole('button', { name: 'Open mine' }).click();

    await expect(explorer.id('clash')).toBeVisible();
    await expect(explorer.id('clash-summary')).toContainText('open in the editor');
    await expect(explorer.id('clash-changes')).toContainText('title is "Builds, edited" in mine and "Builds" in theirs');
    await explorer.id('clash-keep').click();
    expect((await explorer.json())['title']).toBe('Builds, edited');
  });
});
