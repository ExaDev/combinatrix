import { expect, test } from '@playwright/test';

import { Explorer } from './explorer';

/** A window wide enough for the Run section to sit beside the model, tall enough for it to fit in, and one too narrow for that. */
const WIDE = { width: 1400, height: 2400 };
const NARROW = { width: 700, height: 900 };

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
