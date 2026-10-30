import { expect, test } from '@playwright/test';

import { Explorer } from './explorer';

/** The dimensions of the starting example, and the count after one is added. */
const STARTING_DIMENSIONS = 3;
const WITH_ADDED = STARTING_DIMENSIONS + 1;

test.describe('undo and redo', () => {
  test('has nothing to undo or redo when the page opens, and undoes a whole example load', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await expect(explorer.id('undo')).toBeDisabled();
    await expect(explorer.id('redo')).toBeDisabled();
    const before = await explorer.json();

    await explorer.loadExample('A CI matrix: membership, any-of and not');
    await expect(explorer.id('undo')).toBeEnabled();
    await explorer.id('undo').click();

    expect(await explorer.json()).toEqual(before);
    await expect(explorer.id('undo')).toBeDisabled();
    await explorer.id('redo').click();
    expect(await explorer.at(['dimensions', 0, 'name'])).toBe('os');
    expect(await explorer.at(['dimensions', 2, 'name'])).toBe('browser');
  });

  test('undoes the typing in one field as one step, and redoes it', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await explorer.id('empty-model').click();
    await expect(explorer.field('title:text')).toHaveValue('');

    await explorer.field('title:text').pressSequentially('Builds');
    expect((await explorer.json())['title']).toBe('Builds');
    await explorer.id('undo').click();

    expect((await explorer.json())['title']).toBeUndefined();
    await expect(explorer.field('title:text')).toHaveValue('');
    await explorer.id('redo').click();
    await expect(explorer.field('title:text')).toHaveValue('Builds');
  });

  test('undoes a structural edit with the keyboard shortcut, and redoes it with the shifted one', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await explorer.field('dimensions:add').click();
    await expect(explorer.cards('dimensions')).toHaveCount(WITH_ADDED);

    await page.locator('h1').click();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(explorer.cards('dimensions')).toHaveCount(STARTING_DIMENSIONS);
    await page.keyboard.press('ControlOrMeta+Shift+z');

    await expect(explorer.cards('dimensions')).toHaveCount(WITH_ADDED);
  });

  test('leaves the browser to undo the text of a box that is being typed in', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await explorer.field('dimensions.0:name').fill('renamed');
    await explorer.field('dimensions.0:name').press('ControlOrMeta+z');

    await expect(explorer.field('dimensions.0:name')).not.toHaveValue('renamed');
  });
});
