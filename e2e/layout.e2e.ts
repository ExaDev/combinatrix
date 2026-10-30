import { expect, test } from '@playwright/test';

import { Explorer } from './explorer';

/** A window wide enough for the Run section to sit beside the model, and one too narrow for that. */
const WIDE = { width: 1400, height: 900 };
const NARROW = { width: 700, height: 900 };

/** How far the page is scrolled for the Run section to be shown holding to the top of the window: more than the height of the window, and less than the model column is tall. */
const SCROLLED_PAST_THE_TOP = 1500;

test.describe('layout', () => {
  test('puts the Run section beside the model in a wide window, in view while the model scrolls', async ({ page }) => {
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
