import { expect, test } from '@playwright/test';

import { Explorer } from './explorer';

/** A window wide enough for the Run section to sit beside the model, tall enough for it to fit in, and one too narrow for that. */
const WIDE = { width: 1400, height: 2400 };
const NARROW = { width: 700, height: 900 };

/** The narrowest window the page is held to fit: a small phone. A menu that is as wide as its longest option made the page wider than this one. */
const SMALLEST = { width: 320, height: 700 };

/** How far the page is scrolled for the Run section to be shown held away from its place beside the heading: past its top, and less than the model column is tall. */
const SCROLLED_PAST_THE_TOP = 1500;

test.describe('layout', () => {
  test('puts the Run section beside the model in a wide window, held to the top while it fits and the model scrolls', async ({ page }) => {
    await page.setViewportSize(WIDE);
    const explorer = await Explorer.open(page);
    const model = await page.locator('[aria-labelledby="model-heading"]').boundingBox();
    const run = await page.locator('.run-panel').boundingBox();
    if (model === null || run === null) throw new Error('the sections are drawn');

    expect(run.x).toBeGreaterThanOrEqual(model.x + model.width);
    expect(run.y).toBeLessThan(WIDE.height);
    await page.evaluate((scrollTo) => {
      window.scrollTo(0, scrollTo);
    }, SCROLLED_PAST_THE_TOP);
    const scrolled = await page.locator('.run-panel').boundingBox();
    expect(scrolled?.y).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await explorer.run('count');
    await expect(explorer.result('count')).toContainText('combinations satisfy the model');
  });

  test('stacks the sections in a narrow window, with nothing wider than the window', async ({ page }) => {
    await page.setViewportSize(NARROW);
    await Explorer.open(page);
    const model = await page.locator('[aria-labelledby="model-heading"]').boundingBox();
    const run = await page.locator('.run-panel').boundingBox();
    if (model === null || run === null) throw new Error('the sections are drawn');

    expect(run.y).toBeGreaterThanOrEqual(model.y + model.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

/** The least size of the text of a field on a touch screen, in CSS pixels: under it Safari zooms the page when the field is focused. */
const MINIMUM_FIELD_TEXT = 16;

/** A window too short for the Run section to fit in, so that it is taller than the window. */
const SHORT = { width: 1400, height: 500 };

test.describe('scrolling', () => {
  test('never scrolls inside the Run section: when it is taller than the window it scrolls with the page and holds at its bottom edge', async ({ page }) => {
    await page.setViewportSize(SHORT);
    await Explorer.open(page);
    const panel = page.locator('.run-panel');
    const height = (await panel.boundingBox())?.height ?? 0;
    expect(height).toBeGreaterThan(SHORT.height);
    expect(await panel.evaluate((element) => getComputedStyle(element).overflowY)).toBe('visible');
    expect(await panel.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);

    await page.evaluate((scrollTo) => {
      window.scrollTo(0, scrollTo);
    }, SCROLLED_PAST_THE_TOP);
    const held = await panel.boundingBox();

    expect(held === null ? Number.NaN : held.y + held.height).toBeCloseTo(SHORT.height, 0);
    expect(held?.y).toBeLessThan(0);
  });

  test('scrolls a result into view when an operation the person asked for finishes, and not when opening a link runs one', async ({ page }) => {
    await page.setViewportSize(NARROW);
    const explorer = await Explorer.open(page);
    await explorer.run('count');
    await expect(explorer.result('count')).toContainText('combinations satisfy the model');

    const box = await explorer.result('count').boundingBox();
    expect(box === null ? Number.NaN : box.y).toBeLessThan(NARROW.height);
    expect(box === null ? Number.NaN : box.y).toBeGreaterThanOrEqual(0);
  });
});

test.describe('width', () => {
  test('has nothing wider than the window at the narrowest width, with the longest example name in its menu', async ({ page }) => {
    await page.setViewportSize(SMALLEST);
    const explorer = await Explorer.open(page);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const longest = await explorer.id('example').evaluate((select) => (select instanceof HTMLSelectElement ? [...select.options].map((option) => option.text.length).reduce((most, length) => Math.max(most, length), 0) : 0));
    expect(longest).toBeGreaterThan(0);
  });

  test('has nothing wider than the window when the text is enlarged to twice its size, on a small phone', async ({ page }) => {
    await page.setViewportSize(SMALLEST);
    await Explorer.open(page);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });

    await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });

  test('keeps a field at 16 pixels or more on a touch screen, so that Safari does not zoom the page to it', async ({ browser }) => {
    const context = await browser.newContext({ viewport: SMALLEST, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await Explorer.open(page);

    const small = await page.evaluate((least) => {
      const fields = [...document.querySelectorAll('input[type="text"], input[type="number"], select, textarea')];

      return fields.flatMap((field) => (field.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(field).fontSize) < least ? [field.tagName.toLowerCase()] : []));
    }, MINIMUM_FIELD_TEXT);

    expect(small).toEqual([]);
    await context.close();
  });
});
