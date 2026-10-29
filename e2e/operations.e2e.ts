import { expect, test } from '@playwright/test';

import type { JsonObject } from '../site/src/json';

import { Explorer, reference, RESULT_TIMEOUT_MS, textEquals, trackExternalRequests } from './explorer';

/** Sizes the README states for the explorer's examples: the product of an operating system and an architecture, and the same with a runtime and the rule that bun is not offered on Windows. */
const PRODUCT_EXAMPLE = 'Operating systems and architectures';
const PRODUCT_SIZE = 6;
const RULE_EXAMPLE_SIZE = 16;
const PAIRWISE_ROWS = 8;

/** A list limit that is below the size of the product example, and the rows the page then shows besides the heading row. */
const SMALL_LIMIT = 4;

/** The most rows the list may be asked for, which the page states in its own text. */
const OVER_LIMIT = 10_001;

/** A model whose one rule reads every dimension, so that counting it visits every node and the solution set is beyond anything that could finish: used to cancel a count and to list only the start of a huge set. */
const HEAVY_DIMENSIONS = 40;

/** How long the test lets a count run before it cancels, in milliseconds: long enough that the count is certainly still running, which a model this size guarantees, not long enough to slow the run. */
const LET_COUNT_RUN_MS = 500;

function heavyModel(): JsonObject {
  const names = Array.from({ length: HEAVY_DIMENSIONS }, (_, index) => `d${String(index)}`);
  const [first, ...rest] = names;
  if (first === undefined) throw new Error('the heavy model has dimensions');
  const allA = rest.reduce<JsonObject>((tree, key) => ({ kind: 'and', left: tree, right: textEquals(key, 'a') }), textEquals(first, 'a'));

  return { dimensions: names.map((name) => ({ kind: 'choice', name, values: ['a', 'b'] })), rules: [{ excludes: allA }] };
}

test.describe('operations', () => {
  test('starts on an example, checks it, and runs the engine in a worker', async ({ page }) => {
    const explorer = await Explorer.open(page);

    await expect(explorer.id('validation')).toContainText('Valid model with 3 dimensions');
    expect(page.workers().some((worker) => worker.url().includes('worker'))).toBe(true);
    expect(await explorer.at(['rules', 0, 'name'])).toBe('bun is not offered on windows');
  });

  test('counts the combinations of an example', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await explorer.loadExample(PRODUCT_EXAMPLE);
    await explorer.run('count');

    await expect(explorer.result('count')).toContainText(`${String(PRODUCT_SIZE)} combinations satisfy the model.`, { timeout: RESULT_TIMEOUT_MS });
  });

  test('lists as many combinations as the limit, says more exist, and lists them all at the size of the set', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await explorer.loadExample(PRODUCT_EXAMPLE);
    await explorer.setNumber('list-limit', SMALL_LIMIT);
    await explorer.run('list');

    await expect(explorer.result('list').locator('tr')).toHaveCount(SMALL_LIMIT + 1);
    await expect(explorer.result('list')).toContainText(`The first ${String(SMALL_LIMIT)} combinations. There are more`);
    await explorer.setNumber('list-limit', PRODUCT_SIZE);
    await explorer.run('list');

    await expect(explorer.result('list')).toContainText(`All ${String(PRODUCT_SIZE)} combinations.`);
    await expect(explorer.result('list').locator('tr')).toHaveCount(PRODUCT_SIZE + 1);
  });

  test('refuses a list limit past the maximum, without asking the engine', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await explorer.setNumber('list-limit', OVER_LIMIT);
    await explorer.run('list');

    await expect(explorer.result('list')).toContainText('whole number from 0 to 10000');
  });

  test('finds the value no combination uses', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await explorer.setJson({
      dimensions: [
        { kind: 'choice', name: 'a', values: ['x', 'y'] },
        { kind: 'choice', name: 'b', values: ['p'] },
      ],
      rules: [{ excludes: textEquals('a', 'y') }],
    });
    await explorer.run('diagnose');

    await expect(explorer.result('diagnose')).toContainText('a = "y"', { timeout: RESULT_TIMEOUT_MS });
    await expect(explorer.result('diagnose')).toContainText('1 combination satisfy');
  });

  test('builds a pairwise covering array and reports it checked against the whole set', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await explorer.run('covering');

    await expect(explorer.result('covering')).toContainText(`Checked with isCoveringArray against all ${String(RULE_EXAMPLE_SIZE)} combinations: it covers`, { timeout: RESULT_TIMEOUT_MS });
    await expect(explorer.result('covering')).toContainText(`${String(PAIRWISE_ROWS)} rows cover every combination of 2 dimension values`);
  });

  test('names the rule that excludes a combination, gives the index of one that is valid, and shows the combination at an index', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await explorer.id('pick-os').selectOption({ label: '"windows"' });
    await explorer.id('pick-arch').selectOption({ label: '"x64"' });
    await explorer.id('pick-runtime').selectOption({ label: '"bun"' });
    await explorer.run('explain');

    await expect(explorer.result('combination')).toContainText('rule 1, "bun is not offered on windows", rejects it', { timeout: RESULT_TIMEOUT_MS });
    await explorer.id('pick-runtime').selectOption({ label: '"node"' });
    await explorer.run('explain');

    await expect(explorer.result('combination')).toContainText(/This is a combination of the model, at index \d+/);
    const index = await explorer.id('index').inputValue();
    await explorer.run('at');

    await expect(explorer.result('combination')).toContainText(`The combination at index ${index}`);
  });

  test('shows the library text for an invalid model and for text that is not JSON, and turns the operations off', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await explorer.setJson(
      { dimensions: [{ kind: 'choice', name: 'os', values: ['linux'] }], rules: [{ requires: { kind: 'exists', operand: reference('arch') } }] },
      { expectValid: false },
    );

    await expect(explorer.id('validation')).toContainText('unknown dimension "arch"', { timeout: RESULT_TIMEOUT_MS });
    await expect(explorer.id('count')).toBeDisabled();
    await explorer.setText('{ not json');

    await expect(explorer.id('validation')).toContainText('not valid JSON', { timeout: RESULT_TIMEOUT_MS });
  });

  test('cancels a count that would never finish, keeps the page responsive meanwhile, and runs the next operation on a fresh engine', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await explorer.setJson(heavyModel());
    await explorer.run('count');

    await expect(explorer.id('busy')).toHaveText('Counting…');
    await expect(explorer.id('cancel')).toBeEnabled();
    await expect(explorer.id('count')).toBeDisabled();
    await expect(explorer.id('form-fieldset')).toHaveJSProperty('disabled', true);
    // The page itself answers while the engine is busy.
    await explorer.id('save-name').fill('typed while counting');
    await expect(explorer.id('save-name')).toHaveValue('typed while counting');
    await page.waitForTimeout(LET_COUNT_RUN_MS);
    await expect(explorer.id('busy')).toHaveText('Counting…');
    await explorer.id('cancel').click();

    await expect(explorer.result('count')).toHaveText('Cancelled.');
    await expect(explorer.id('busy')).toHaveText('');
    await expect(explorer.id('cancel')).toBeDisabled();
    await expect(explorer.id('form-fieldset')).toHaveJSProperty('disabled', false);
    await explorer.loadExample(PRODUCT_EXAMPLE);
    await explorer.run('count');

    await expect(explorer.result('count')).toContainText(`${String(PRODUCT_SIZE)} combinations satisfy the model.`, { timeout: RESULT_TIMEOUT_MS });
  });

  test('lists only the start of a set far too large to list', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await explorer.setJson(heavyModel());
    await explorer.setNumber('list-limit', SMALL_LIMIT + 1);
    await explorer.run('list');

    await expect(explorer.result('list')).toContainText(`The first ${String(SMALL_LIMIT + 1)} combinations`, { timeout: RESULT_TIMEOUT_MS });
  });

  test('makes no request outside its own origin while it runs an operation', async ({ page, baseURL }) => {
    const outside = trackExternalRequests(page, baseURL);
    const explorer = await Explorer.open(page);
    await explorer.run('count');

    await expect(explorer.result('count')).toContainText('combinations satisfy', { timeout: RESULT_TIMEOUT_MS });
    expect(outside).toEqual([]);
  });

  test('works with localStorage blocked: it loads, counts, and says it cannot save', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        },
      });
    });
    const explorer = await Explorer.open(page);
    await explorer.run('count');

    await expect(explorer.result('count')).toContainText(`${String(RULE_EXAMPLE_SIZE)} combinations satisfy the model.`, { timeout: RESULT_TIMEOUT_MS });
    await explorer.id('save-name').fill('anything');
    await explorer.id('save').click();

    await expect(explorer.id('saved-status')).toContainText('not letting this page save');
    await expect(explorer.page.locator('#saved-list li')).toHaveCount(0);
  });
});
