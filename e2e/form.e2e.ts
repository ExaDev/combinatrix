import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { EXAMPLES, exampleText } from '../site/src/examples';
import type { Json, JsonObject } from '../site/src/json';
import { getIn, isJsonArray, isJsonObject } from '../site/src/json';
import { EXPRESSION_KINDS, PREDICATE_KINDS } from '../site/src/nodes';
import { SCHEMA_URL } from '../site/src/schema';
import { Explorer, inOrder, reference, RESULT_TIMEOUT_MS, textEquals, textLiteral, trackExternalRequests } from './explorer';

/** The model the first test builds by hand, written as the form writes it, naming the schema it is written against. The rule excludes a combination on Windows or macOS that is not arm64. */
const BUILT_BY_HAND: JsonObject = {
  $schema: SCHEMA_URL,
  dimensions: [
    { kind: 'choice', name: 'os', values: ['linux', 'macos', 'windows'] },
    { kind: 'choice', name: 'arch', values: ['x64', 'arm64'] },
    { kind: 'choice', name: 'runtime', values: ['node', 'bun', 'deno'] },
  ],
  rules: [
    {
      excludes: {
        kind: 'and',
        left: { kind: 'or', left: textEquals('os', 'windows'), right: textEquals('os', 'macos') },
        right: { kind: 'not', operand: textEquals('arch', 'arm64') },
      },
    },
  ],
};

/** The size of that model, worked out by hand: 3 systems by 2 architectures by 3 runtimes is 18, and the rule removes 2 systems by 1 architecture by 3 runtimes, which is 6. */
const BUILT_BY_HAND_SIZE = 12;

/** How many of those combinations are on Linux (all 2 by 3 of them) and how many on the other two systems (the arm64 ones, 2 systems by 3 runtimes). */
const LINUX_ROWS = 6;
const ARM_ROWS = 6;

/** A model with two number dimensions and a text one, for the tests that build conditions of each kind. */
/** How many values the number dimension of the mixed model has, and how many dimensions and rules the page's starting example has. */
const LEVEL_COUNT = 3;
const STARTING_DIMENSIONS = 3;

/** A level written as a long number, and what it is. */
const SCIENTIFIC_LEVEL = '1e2';
const SCIENTIFIC_LEVEL_VALUE = 100;

const levels = (): number[] => Array.from({ length: LEVEL_COUNT }, (_, index) => index + 1);

const MIXED_MODEL: JsonObject = {
  dimensions: [
    { kind: 'choice', name: 'n', values: levels() },
    { kind: 'choice', name: 't', values: ['a', 'b'] },
  ],
  rules: [{ excludes: { kind: 'exists', operand: reference('t') } }],
};

/** The size of that model once its rule is `n > 2`: 3 numbers by 2 texts is 6 and `n = 3` removes 2. */
const MIXED_MODEL_SIZE_WITH_RULE = 4;

/** A first-valid dimension with an activity condition, for the dimension tests, and the size it makes: `mode = fast` keeps 2 levels, `slow` leaves the level unset, so 2 plus 1. */
const ACTIVITY_MODEL_SIZE = 3;

/** The two dimensions added to the starting example by the keyboard test, and the value typed. */
const TYPED_VALUE = 'freebsd';

/** A name and a rule label long enough to test wrapping at phone width. */
const LONG_NAME = 'a-dimension-with-a-rather-long-name-to-test-wrapping';
const PHONE_WIDTH = 375;
const PHONE_HEIGHT = 800;
const NESTING = 8;

/** The dark scheme's page background and the light one's, which the tokens in style.css give. */
const DARK_BACKGROUND = 'rgb(18, 21, 26)';
const LIGHT_BACKGROUND = 'rgb(255, 255, 255)';

/** Adds a dimension with values through the form, at a position, as a person does. */
async function addDimension(explorer: Explorer, position: number, name: string, values: readonly string[]): Promise<void> {
  await explorer.field('dimensions:add').click();
  const nameField = explorer.field(`dimensions.${String(position)}:name`);
  await nameField.fill(name);
  await nameField.blur();
  await inOrder(
    values.map((value, index) => ({ value, index })),
    async ({ value, index }) => {
      if (index > 0) await explorer.field(`dimensions.${String(position)}.values:add`).click();
      await explorer.field(`dimensions.${String(position)}.values.${String(index)}:value`).fill(value);
    },
  );
}

/** Opens the page and replaces the model by the given one, through the Advanced view. A model the library refuses (data the form keeps but the engine cannot use) is opened with `valid: false`, and the form is waited for instead. */
async function openWith(page: Page, model: Json, options: { readonly valid?: boolean } = {}): Promise<Explorer> {
  const explorer = await Explorer.open(page);
  await explorer.setJson(model, { expectValid: options.valid !== false });

  return explorer;
}

test.describe('building a model with the form', () => {
  test('shows the starting example in the form, with the JSON view collapsed', async ({ page }) => {
    const explorer = await Explorer.open(page);

    await expect(explorer.id('advanced')).not.toHaveAttribute('open');
    await expect(explorer.cards('dimensions')).toHaveCount(STARTING_DIMENSIONS);
    await expect(explorer.cards('rules')).toHaveCount(1);
    await expect(explorer.field('dimensions.0:name')).toHaveValue('os');
    await expect(explorer.field('dimensions.0.values.2:value')).toHaveValue('windows');
    await expect(explorer.field('rules.0:name')).toHaveValue('bun is not offered on windows');
  });

  test('states each rule as a sentence, which follows an edit of the rule as it is typed', async ({ page }) => {
    const explorer = await Explorer.open(page);
    const sentence = page.locator('[data-summary="0"]');

    await expect(sentence).toHaveText('No combination may satisfy: os is "windows", when runtime is "bun".');
    await explorer.field('rules.0.when.right.value:value').fill('deno');

    await expect(sentence).toHaveText('No combination may satisfy: os is "windows", when runtime is "deno".');
  });

  test('builds a model from nothing with only the form, and the JSON view and the engine agree with it', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await explorer.id('empty-model').click();
    await explorer.ready();

    await expect(explorer.id('form')).toContainText('No dimensions yet');
    await addDimension(explorer, 0, 'os', ['linux', 'macos', 'windows']);
    await addDimension(explorer, 1, 'arch', ['x64', 'arm64']);
    await addDimension(explorer, 2, 'runtime', ['node', 'bun', 'deno']);
    await explorer.field('rules:add').click();
    await explorer.field('rules.0.excludes:kind').selectOption({ label: 'both' });
    await explorer.field('rules.0.excludes.left:kind').selectOption({ label: 'either' });
    await inOrder(
      [
        ['left', 'windows'],
        ['right', 'macos'],
      ] as const,
      async ([side, value]) => {
        await explorer.field(`rules.0.excludes.left.${side}:kind`).selectOption({ label: 'compares text' });
        await explorer.field(`rules.0.excludes.left.${side}.right.value:value`).fill(value);
      },
    );
    await explorer.field('rules.0.excludes.right:kind').selectOption({ label: 'not' });
    await explorer.field('rules.0.excludes.right.operand:kind').selectOption({ label: 'compares text' });
    await explorer.field('rules.0.excludes.right.operand.left:key').selectOption({ label: 'arch' });
    await explorer.field('rules.0.excludes.right.operand.right.value:value').fill('arm64');
    await explorer.ready();

    expect(await explorer.json()).toEqual(BUILT_BY_HAND);
    await explorer.run('count');
    await expect(explorer.result('count')).toContainText(`${String(BUILT_BY_HAND_SIZE)} combinations satisfy the model.`, { timeout: RESULT_TIMEOUT_MS });
    await explorer.id('list-limit').fill('100');
    await explorer.run('list');
    await expect(explorer.result('list')).toContainText(`All ${String(BUILT_BY_HAND_SIZE)} combinations.`, { timeout: RESULT_TIMEOUT_MS });
    const rows = await explorer.result('list').locator('tr').allInnerTexts();
    const body = rows.slice(1).map((row) => row.replaceAll(/\s+/g, ' '));

    expect(body).toHaveLength(BUILT_BY_HAND_SIZE);
    expect(body.filter((row) => /"(windows|macos)" "x64"/.test(row))).toEqual([]);
    expect(body.filter((row) => /"(windows|macos)" "arm64"/.test(row))).toHaveLength(ARM_ROWS);
    expect(body.filter((row) => row.includes('"linux"'))).toHaveLength(LINUX_ROWS);
  });

  test('keeps the caret and every character while typing in a field, and the JSON follows each keystroke', async ({ page }) => {
    const explorer = await Explorer.open(page);
    const field = explorer.field('dimensions.2.values.0:value');
    await field.fill('');
    await field.focus();
    await page.keyboard.type('node-twenty');

    await expect(field).toHaveValue('node-twenty');
    expect(await explorer.focused()).toBe('dimensions.2.values.0:value');
    expect(await explorer.at(['dimensions', 2, 'values', 0])).toBe('node-twenty');
  });

  test('renames a dimension together with every reference to it, and the model stays valid', async ({ page }) => {
    const explorer = await Explorer.open(page);
    const name = explorer.field('dimensions.0:name');
    await name.fill('system');
    await name.blur();
    await explorer.ready();

    const model = await explorer.json();
    expect(JSON.stringify(model['rules'])).toContain('"key":"system"');
    expect(JSON.stringify(model['rules'])).not.toContain('"key":"os"');
    await expect(explorer.field('rules.0.excludes.left:key')).toHaveValue('system');
  });
});

test.describe('the form and the JSON view are one model', () => {
  test('shows an edit of the JSON in the form: a value, a new dimension and a changed operator', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await explorer.setJson({
      dimensions: [
        { kind: 'choice', name: 'os', values: ['linux', 'windows'] },
        { kind: 'choice', name: 'arch', values: ['x64', 'arm64', 'riscv'] },
        { kind: 'first-valid', name: 'codec', candidates: ['zstd', 'gzip'] },
      ],
      rules: [{ excludes: { kind: 'textCompare', op: 'notEquals', left: reference('os'), right: textLiteral('windows') } }],
    });

    await expect(explorer.field('dimensions.1.values.2:value')).toHaveValue('riscv');
    await expect(explorer.field('dimensions.2:name')).toHaveValue('codec');
    await expect(explorer.field('dimensions.2:kind')).toHaveValue('first-valid');
    await expect(explorer.field('rules.0.excludes:op')).toHaveValue('notEquals');
  });

  test('keeps the last valid model in the form, read-only, with the error and the typed text kept, when the JSON is broken', async ({ page }) => {
    const explorer = await Explorer.open(page);
    const broken = '{ "dimensions": [ { "kind": "choice", "name": "oops" ';
    await explorer.setText(broken);

    await expect(explorer.id('validation')).toContainText('not valid JSON', { timeout: RESULT_TIMEOUT_MS });
    await expect(explorer.id('form-notice')).toBeVisible();
    await expect(explorer.id('model')).toHaveValue(broken);
    await expect(explorer.field('dimensions.0:name')).toHaveValue('os');
    await expect(explorer.id('form-fieldset')).toHaveJSProperty('disabled', true);
    await expect(explorer.field('dimensions.0:name')).toBeDisabled();
    await expect(explorer.id('count')).toBeDisabled();
  });

  test('explains JSON that is valid but is not a model, and keeps the last valid model in the form', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await explorer.setText('[1, 2, 3]');

    await expect(explorer.id('form-problem')).toContainText('cannot show it');
    await expect(explorer.field('dimensions.0:name')).toHaveValue('os');
    await expect(explorer.id('model')).toHaveValue('[1, 2, 3]');
  });

  test('brings the form back when the JSON is fixed, and replaces broken text by the last valid model on request', async ({ page }) => {
    const explorer = await Explorer.open(page);
    const only: JsonObject = { dimensions: [{ kind: 'choice', name: 'only', values: ['a', 'b'] }] };
    await explorer.setText('{ broken');
    await expect(explorer.id('form-notice')).toBeVisible();
    await explorer.setJson(only);

    await expect(explorer.id('form-notice')).toBeHidden();
    await expect(explorer.field('dimensions.0:name')).toHaveValue('only');
    await expect(explorer.id('form-fieldset')).toHaveJSProperty('disabled', false);
    await explorer.setText('{ broken again');
    await explorer.id('use-last-valid').click();
    await explorer.ready();

    expect(await explorer.json()).toEqual(only);
    await expect(explorer.id('form-notice')).toBeHidden();
  });

  for (const example of EXAMPLES) {
    test(`shows the example "${example.name}" in the form, every dimension and rule drawn with controls`, async ({ page }) => {
      const explorer = await Explorer.open(page);
      await explorer.loadExample(example.name);
      const model = await explorer.json();
      const dimensions = getIn(model, ['dimensions']);
      const rules = getIn(model, ['rules']) ?? [];
      if (dimensions === undefined || !isJsonArray(dimensions) || !isJsonArray(rules)) throw new Error('the example is a model with dimensions');

      expect(model).toEqual(JSON.parse(exampleText(example)));
      await expect(explorer.cards('dimensions')).toHaveCount(dimensions.length);
      await expect(explorer.cards('rules')).toHaveCount(rules.length);
      await expect(explorer.page.locator('textarea.raw-json')).toHaveCount(0);
      // The schema a model names is part of the model, not a key the form leaves unshown.
      await expect(explorer.page.getByText('which the form does not show and keeps')).toHaveCount(0);
      await inOrder(
        dimensions.map((dimension, index) => ({ dimension, index })),
        async ({ dimension, index }) => {
          const expected = isJsonObject(dimension) ? dimension['name'] : undefined;
          if (typeof expected !== 'string') throw new Error(`dimension ${String(index)} of the example has no name`);
          await expect(explorer.field(`dimensions.${String(index)}:name`)).toHaveValue(expected);
        },
      );
    });
  }
});

test.describe('data the schema does not accept', () => {
  test('is shown as JSON and kept exactly through every edit around it', async ({ page }) => {
    const mystery: JsonObject = { kind: 'mystery', collection: 'os', item: { kind: 'exists', operand: reference('os') } };
    const computed: JsonObject = { kind: 'computed', name: 'target', reads: ['os'] };
    const withUnknownKey: JsonObject = { requires: { kind: 'and', left: mystery, right: { kind: 'exists', operand: reference('os') } }, note: 'a key the form does not know' };
    const extra: JsonObject = { anything: [1, 2, { deep: true }] };
    const strange: JsonObject = {
      dimensions: [computed, { kind: 'choice', name: 'os', values: ['linux', 'windows'] }],
      rules: [withUnknownKey, { excludes: { kind: 'and', left: mystery, right: textEquals('os', 'windows') } }],
      extra,
    };
    const explorer = await openWith(page, strange, { valid: false });

    await expect(explorer.field('dimensions.0:raw')).toBeVisible();
    await expect(explorer.field('rules.0:raw')).toBeVisible();
    await expect(explorer.field('rules.1.excludes.left:raw')).toBeVisible();
    expect(JSON.parse(await explorer.field('dimensions.0:raw').inputValue())).toEqual(computed);
    const name = explorer.field('dimensions.1:name');
    await name.fill('system');
    await name.blur();
    await explorer.field('dimensions.1.values:add').click();
    await explorer.field('dimensions.1:up').click();
    await explorer.field('rules.1:form').selectOption({ label: 'requires: every combination must satisfy' });
    await explorer.field('dimensions:add').click();
    await explorer.field('rules:add').click();
    const model = await explorer.json();

    expect(await explorer.at(['dimensions', 1])).toEqual(computed);
    expect(await explorer.at(['rules', 0])).toEqual(withUnknownKey);
    expect(await explorer.at(['rules', 1, 'requires', 'left'])).toEqual(mystery);
    expect(model['extra']).toEqual(extra);
    expect(await explorer.at(['dimensions', 0, 'values'])).toEqual(['linux', 'windows', 'value']);
    await expect(explorer.id('form')).toContainText('which the form does not show and keeps');
  });

  test('can be edited in its own box, and an invalid edit leaves the model on the last valid JSON', async ({ page }) => {
    const explorer = await openWith(page, { dimensions: [{ kind: 'computed', name: 'target', reads: [] }], rules: [] }, { valid: false });
    const raw = explorer.field('dimensions.0:raw');
    await raw.fill(JSON.stringify({ kind: 'computed', name: 'renamed', reads: [] }));

    expect(await explorer.at(['dimensions', 0, 'name'])).toBe('renamed');
    await raw.fill('{ not json');

    await expect(explorer.page.locator('.field-problem', { hasText: 'Not JSON' }).first()).toBeVisible();
    expect(await explorer.at(['dimensions', 0, 'name'])).toBe('renamed');
  });
});

test.describe('every kind of the schema has controls', () => {
  test('offers every predicate kind and every expression kind of the schema in the kind menus, and each can be chosen without raw JSON', async ({ page }) => {
    const explorer = await openWith(page, MIXED_MODEL);
    const predicateMenu = explorer.field('rules.0.excludes:kind');
    const offered = await predicateMenu.evaluate((menu) => (menu instanceof HTMLSelectElement ? [...menu.options].map((option) => option.value) : []));

    expect(offered.toSorted((left, right) => left.localeCompare(right))).toEqual([...PREDICATE_KINDS].toSorted((left, right) => left.localeCompare(right)));
    await inOrder(offered, async (kind) => {
      await predicateMenu.selectOption({ value: kind });
      await expect(predicateMenu).toHaveValue(kind);
      await expect(explorer.page.locator('textarea.raw-json')).toHaveCount(0);
    });
    await predicateMenu.selectOption({ value: 'compare' });
    const expressionMenu = explorer.field('rules.0.excludes.right:kind');
    const expressions = await expressionMenu.evaluate((menu) => (menu instanceof HTMLSelectElement ? [...menu.options].map((option) => option.value) : []));

    expect(expressions.toSorted((left, right) => left.localeCompare(right))).toEqual([...EXPRESSION_KINDS].toSorted((left, right) => left.localeCompare(right)));
    await inOrder(expressions, async (kind) => {
      await expressionMenu.selectOption({ value: kind });
      await expect(expressionMenu).toHaveValue(kind);
      await expect(explorer.page.locator('textarea.raw-json')).toHaveCount(0);
    });
  });

  test('builds a comparison through the controls, and the engine counts it', async ({ page }) => {
    const explorer = await openWith(page, MIXED_MODEL);
    await explorer.field('rules.0.excludes:kind').selectOption({ value: 'compare' });
    await explorer.field('rules.0.excludes.right:kind').selectOption({ value: 'numberLiteral' });
    await explorer.field('rules.0.excludes.right.value:value').fill('2');
    await explorer.field('rules.0.excludes:op').selectOption({ label: 'is greater than' });
    await explorer.field('rules.0.excludes.left:key').selectOption({ label: 'n' });
    await explorer.ready();

    expect(await explorer.at(['rules', 0, 'excludes'])).toEqual({ kind: 'compare', op: 'gt', left: reference('n'), right: { kind: 'numberLiteral', value: 2 } });
    await explorer.run('count');
    await expect(explorer.result('count')).toContainText(`${String(MIXED_MODEL_SIZE_WITH_RULE)} combinations satisfy the model.`, { timeout: RESULT_TIMEOUT_MS });
  });

  test('builds the kinds the library refuses (some, every, tree references) with controls, the check says why, and the data stays editable', async ({ page }) => {
    const explorer = await openWith(page, { dimensions: [{ kind: 'choice', name: 'n', values: [1, 2] }], rules: [{ requires: { kind: 'exists', operand: reference('n') } }] });
    const rule = 'rules.0.requires';
    await explorer.field(`${rule}:kind`).selectOption({ value: 'some' });
    await explorer.field(`${rule}.collection:type`).selectOption({ value: 'list' });
    await explorer.field(`${rule}.collection:add`).click();
    await explorer.field(`${rule}.collection.0:value`).fill('first');
    await explorer.field(`${rule}.collection:add`).click();
    await explorer.field(`${rule}.collection.1:type`).selectOption({ value: 'object' });
    await explorer.field(`${rule}.collection.1:add`).click();
    const key = explorer.field(`${rule}.collection.1.key:key`);
    await key.fill('price');
    await key.blur();
    await explorer.field(`${rule}.collection.1.price:type`).selectOption({ value: 'number' });
    await explorer.field(`${rule}.collection.1.price:value`).fill('4.5');
    await explorer.field(`${rule}.filter:add`).click();
    await explorer.field(`${rule}.filter:kind`).selectOption({ value: 'not' });

    expect(await explorer.at(['rules', 0, 'requires', 'collection'])).toEqual(['first', { price: 4.5 }]);
    expect(await explorer.at(['rules', 0, 'requires', 'filter', 'kind'])).toBe('not');
    await expect(explorer.id('validation')).toContainText('"some" is not supported', { timeout: RESULT_TIMEOUT_MS });
    await expect(explorer.id('form')).toContainText('The library refuses this kind in a model');
    await explorer.field(`${rule}.filter:remove-condition`).click();
    await explorer.field(`${rule}:kind`).selectOption({ value: 'treeReference' });
    await explorer.field(`${rule}.key:type`).selectOption({ value: 'object' });

    expect(await explorer.at(['rules', 0, 'requires'])).toEqual({ kind: 'treeReference', key: {} });
  });

  test('builds a fold with each combiner, a call with arguments, a lookup, an accumulator and a delegate', async ({ page }) => {
    const explorer = await openWith(page, { dimensions: [{ kind: 'choice', name: 'n', values: [1] }], rules: [{ requires: { kind: 'compare', op: 'gt', left: reference('n'), right: { kind: 'numberLiteral', value: 1 } } }] });
    const right = 'rules.0.requires.right';
    await explorer.field(`${right}:kind`).selectOption({ value: 'fold' });
    await explorer.field(`${right}.collection:type`).selectOption({ value: 'text' });
    await explorer.field(`${right}.collection:value`).fill('xs');
    await inOrder(['max', 'min', 'reduce'], async (mode) => {
      await explorer.field(`${right}.combiner:mode`).selectOption({ value: mode });
      const combiner = await explorer.at(['rules', 0, 'requires', 'right', 'combiner']);

      expect(combiner).toMatchObject({ mode });
      expect(typeof combiner === 'object' && combiner !== null && !Array.isArray(combiner) && 'initial' in combiner).toBe(mode === 'reduce');
    });
    await explorer.field(`${right}.combiner.initial:kind`).selectOption({ value: 'accumulator' });
    await explorer.field(`${right}.combiner.combine:kind`).selectOption({ value: 'delegate' });
    await explorer.field(`${right}.combiner.combine.system:value`).fill('rules-engine');
    await explorer.field(`${right}.combiner.combine.payload:type`).selectOption({ value: 'list' });

    expect(await explorer.at(['rules', 0, 'requires', 'right', 'combiner', 'combine'])).toEqual({ kind: 'delegate', system: 'rules-engine', payload: [] });
    await explorer.field(`${right}:kind`).selectOption({ value: 'call' });
    await explorer.field(`${right}.fn:value`).fill('max');
    await explorer.field(`${right}.args:add`).click();
    await explorer.field(`${right}:kind`).selectOption({ value: 'lookup' });
    await explorer.field(`${right}.table:value`).fill('prices');

    expect(await explorer.at(['rules', 0, 'requires', 'right', 'table'])).toBe('prices');
    await explorer.field(`${right}:kind`).selectOption({ value: 'treeReference' });

    expect(await explorer.at(['rules', 0, 'requires', 'right'])).toEqual({ kind: 'treeReference', key: '' });
  });

  test('gives a number, a complex number and a reference a unit of symbols with exponents, and a reference with a key that is not text a value editor', async ({ page }) => {
    const explorer = await openWith(page, { dimensions: [{ kind: 'choice', name: 'n', values: [1] }], rules: [{ requires: { kind: 'compare', op: 'gt', left: reference('n'), right: { kind: 'numberLiteral', value: 1 } } }] });
    const left = 'rules.0.requires.left';
    const right = 'rules.0.requires.right';
    await explorer.field(`${left}.unit:add`).click();
    await explorer.field(`${left}.unit:add`).click();
    const symbol = explorer.field(`${left}.unit.symbol:key`);
    await symbol.fill('m');
    await symbol.blur();
    await explorer.field(`${left}.unit.m:exponent`).fill('2');

    expect(await explorer.at(['rules', 0, 'requires', 'left'])).toEqual({ kind: 'reference', key: 'n', unit: { m: 2 } });
    await explorer.field(`${right}:kind`).selectOption({ value: 'complexLiteral' });
    await explorer.field(`${right}.unit:add`).click();
    await explorer.field(`${right}.unit:add`).click();
    await explorer.field(`${right}:form`).selectOption({ label: 'magnitude and phase' });

    expect(await explorer.at(['rules', 0, 'requires', 'right'])).toEqual({ kind: 'complexLiteral', magnitude: 0, phase: 0, unit: { symbol: 1 } });
    await explorer.field(`${left}.unit:remove-unit`).click();
    expect(await explorer.at(['rules', 0, 'requires', 'left'])).toEqual(reference('n'));
    await explorer.field(`${left}:not-text`).click();
    await explorer.field(`${left}.key:type`).selectOption({ value: 'list' });
    await explorer.field(`${left}.key:add`).click();

    expect(await explorer.at(['rules', 0, 'requires', 'left', 'key'])).toEqual(['']);
  });

  test('builds a conditional, arithmetic, a duration and a complex literal through their own fields', async ({ page }) => {
    const explorer = await openWith(page, { dimensions: [{ kind: 'choice', name: 'n', values: levels() }], rules: [{ excludes: { kind: 'compare', op: 'gt', left: reference('n'), right: { kind: 'numberLiteral', value: 2 } } }] });
    const right = 'rules.0.excludes.right';
    await explorer.field(`${right}:kind`).selectOption({ value: 'conditional' });
    await explorer.field(`${right}:hitPolicy`).selectOption({ label: 'the one case that holds' });
    await explorer.field(`${right}.cases:add`).click();
    await explorer.field(`${right}.cases.1:up`).click();
    await explorer.field(`${right}.cases.0:remove`).click();
    const conditional = await explorer.at(['rules', 0, 'excludes', 'right']);

    expect(conditional).toMatchObject({ kind: 'conditional', hitPolicy: 'unique' });
    expect(await explorer.at(['rules', 0, 'excludes', 'right', 'cases'])).toHaveLength(1);
    await explorer.field(`${right}:kind`).selectOption({ value: 'arithmetic' });
    await explorer.field(`${right}:op`).selectOption({ label: 'times' });
    await explorer.field(`${right}:kind`).selectOption({ value: 'durationLiteral' });
    await explorer.field(`${right}:unit`).selectOption({ label: 'min' });

    expect(await explorer.at(['rules', 0, 'excludes', 'right'])).toEqual({ kind: 'durationLiteral', value: 1, unit: 'min' });
  });
});

test.describe('rules and dimensions', () => {
  test('edits a rule: its form, label, unless condition, and the two conditions of implies', async ({ page }) => {
    const explorer = await openWith(page, { dimensions: [{ kind: 'choice', name: 'a', values: ['x', 'y'] }, { kind: 'choice', name: 'b', values: ['p', 'q'] }], rules: [{ excludes: textEquals('a', 'x') }] });
    await explorer.field('rules.0:form').selectOption({ label: 'implies: if the first holds, the second must' });
    await explorer.field('rules.0.implies.0:kind').selectOption({ label: 'compares text' });
    await explorer.field('rules.0.implies.0.right.value:value').fill('x');
    await explorer.field('rules.0.implies.1:kind').selectOption({ label: 'compares text' });
    await explorer.field('rules.0.implies.1.left:key').selectOption({ label: 'b' });
    await explorer.field('rules.0.implies.1.right.value:value').fill('p');
    await explorer.field('rules.0:name').fill('x needs p');
    await explorer.field('rules.0.unless:add').click();
    await explorer.field('rules.0.unless:kind').selectOption({ label: 'compares text' });
    await explorer.field('rules.0.unless.right.value:value').fill('y');
    await explorer.ready();

    expect(await explorer.at(['rules', 0])).toEqual({ implies: [textEquals('a', 'x'), textEquals('b', 'p')], name: 'x needs p', unless: textEquals('a', 'y') });
    await explorer.run('count');
    // a = x requires b = p (1 of 2 values of b), and a = y is exempt by `unless` (2 values of b): 1 and 2.
    await expect(explorer.result('count')).toContainText('3 combinations satisfy the model.', { timeout: RESULT_TIMEOUT_MS });
    await explorer.field('rules.0.unless:remove-condition').click();

    expect(await explorer.at(['rules', 0, 'unless'])).toBeUndefined();
  });

  test('edits a dimension: its kind, the type of each value, numbers that are not yet numbers, and an activity condition', async ({ page }) => {
    const explorer = await openWith(page, { dimensions: [{ kind: 'choice', name: 'mode', values: ['fast', 'slow'] }, { kind: 'choice', name: 'level', values: [1, 2] }], rules: [] });
    await explorer.field('dimensions.0:kind').selectOption({ label: 'first valid candidate' });

    expect(await explorer.at(['dimensions', 0])).toEqual({ kind: 'first-valid', name: 'mode', candidates: ['fast', 'slow'] });
    await explorer.field('dimensions.0:kind').selectOption({ label: 'free choice' });
    await explorer.field('dimensions.0.values.1:type').selectOption({ label: 'true or false' });
    await explorer.field('dimensions.0.values.1:value').selectOption({ label: 'false' });

    expect(await explorer.at(['dimensions', 0, 'values'])).toEqual(['fast', false]);
    await explorer.field('dimensions.0.values.1:type').selectOption({ label: 'null' });

    expect(await explorer.at(['dimensions', 0, 'values'])).toEqual(['fast', null]);
    const level = explorer.field('dimensions.1.values.0:value');
    await level.fill('abc');

    await expect(explorer.page.locator('.field-problem', { hasText: 'Not a finite number' }).first()).toBeVisible();
    expect(await explorer.at(['dimensions', 1, 'values', 0])).toBe(1);
    await level.blur();
    await expect(level).toHaveValue('1');
    await level.fill(SCIENTIFIC_LEVEL);

    expect(await explorer.at(['dimensions', 1, 'values', 0])).toBe(SCIENTIFIC_LEVEL_VALUE);
    await explorer.field('dimensions.1.activeWhen:add').click();
    await explorer.field('dimensions.1.activeWhen:kind').selectOption({ label: 'compares text' });
    await explorer.field('dimensions.1.activeWhen.right.value:value').fill('fast');
    await explorer.field('dimensions.0.values.1:type').selectOption({ label: 'text' });
    await explorer.field('dimensions.0.values.1:value').fill('slow');
    await explorer.ready();

    expect(await explorer.at(['dimensions', 1, 'activeWhen'])).toEqual(textEquals('mode', 'fast'));
    await explorer.run('count');
    await expect(explorer.result('count')).toContainText(`${String(ACTIVITY_MODEL_SIZE)} combinations satisfy the model.`, { timeout: RESULT_TIMEOUT_MS });
    await explorer.field('dimensions.1.activeWhen:remove-condition').click();

    expect(await explorer.at(['dimensions', 1, 'activeWhen'])).toBeUndefined();
  });
});

test.describe('the form by keyboard alone', () => {
  test('reorders, removes, adds and types, with focus kept on the control a person is using', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await explorer.loadExample('Operating systems and architectures');
    await explorer.advanced();
    await explorer.id('example').focus();
    // Moving "macos" down lands it on the last position, where Down is disabled, so focus goes to its Up button.
    await explorer.tabTo('dimensions.0.values.1:down');
    await page.keyboard.press('Enter');

    expect(await explorer.at(['dimensions', 0, 'values'])).toEqual(['linux', 'windows', 'macos']);
    expect(await explorer.focused()).toBe('dimensions.0.values.2:up');
    await page.keyboard.press('Enter');

    expect(await explorer.at(['dimensions', 0, 'values'])).toEqual(['linux', 'macos', 'windows']);
    expect(await explorer.focused()).toBe('dimensions.0.values.1:up');
    await explorer.id('example').focus();
    await explorer.tabTo('dimensions.0.values.0:remove');
    await page.keyboard.press('Enter');

    expect(await explorer.at(['dimensions', 0, 'values'])).toEqual(['macos', 'windows']);
    expect(await explorer.focused()).toBe('dimensions.0.values:add');
    await page.keyboard.press('Space');

    expect(await explorer.at(['dimensions', 0, 'values'])).toEqual(['macos', 'windows', 'value']);
    expect(await explorer.focused()).toBe('dimensions.0.values:add');
    await explorer.tabTo('dimensions.0.values.2:type');
    await page.keyboard.press('Tab');
    expect(await explorer.focused()).toBe('dimensions.0.values.2:value');
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type(TYPED_VALUE);

    expect(await explorer.at(['dimensions', 0, 'values'])).toEqual(['macos', 'windows', TYPED_VALUE]);
    await explorer.id('example').focus();
    await explorer.tabTo('dimensions.1:up');
    await page.keyboard.press('Enter');

    expect((await explorer.json())['dimensions']).toMatchObject([{ name: 'arch' }, { name: 'os' }]);
    expect(await explorer.focused()).toBe('dimensions.0:down');
    await explorer.id('example').focus();
    await explorer.tabTo('rules:add');
    await page.keyboard.press('Enter');
    await explorer.tabTo('rules.0.excludes:kind');
    // Typing the first letter of an option's name chooses it in a closed menu ("both" is the only kind that starts with b).
    await page.keyboard.type('b');

    expect(await explorer.at(['rules', 0, 'excludes', 'kind'])).toBe('and');
    await expect(explorer.id('form-status')).not.toHaveText('');
  });
});

test.describe('labels and layout', () => {
  test('gives every control of the form an accessible name, and every name and field id is unique', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await explorer.loadExample('A conditional, derived dimension');

    expect(await explorer.unnamedControls()).toEqual([]);
    const names = await page.evaluate(() => [...document.querySelectorAll('#form [data-field]')].map((element) => element.getAttribute('aria-label')).filter((label) => label !== null));
    const fields = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#form [data-field]')].map((element) => element.dataset['field'] ?? ''));

    expect(new Set(names).size).toBe(names.length);
    expect(new Set(fields).size).toBe(fields.length);
  });

  test('does not scroll sideways at phone width with a deeply nested rule and long names, and follows the colour scheme', async ({ page }) => {
    const nested = Array.from({ length: NESTING }).reduce<Json>(
      (tree, _unused, depth) => (depth % 2 === 0 ? { kind: 'not', operand: tree } : { kind: 'and', left: tree, right: textEquals(LONG_NAME, 'y') }),
      textEquals(LONG_NAME, 'x'),
    );
    const explorer = await openWith(page, { dimensions: [{ kind: 'choice', name: LONG_NAME, values: ['x', 'y'] }], rules: [{ name: 'a rule with a label that is rather long indeed for a phone', excludes: nested }] });
    await page.setViewportSize({ width: PHONE_WIDTH, height: PHONE_HEIGHT });
    await page.emulateMedia({ colorScheme: 'dark' });

    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await expect(page.locator('body')).toHaveCSS('background-color', DARK_BACKGROUND);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('body')).toHaveCSS('background-color', LIGHT_BACKGROUND);
    await expect(explorer.cards('rules')).toHaveCount(1);
  });

  test('makes no request outside its own origin while the form edits a model', async ({ page, baseURL }) => {
    const outside = trackExternalRequests(page, baseURL);
    const explorer = await Explorer.open(page);
    await explorer.field('dimensions:add').click();
    await explorer.field('rules:add').click();
    await explorer.run('count');

    await expect(explorer.result('count')).toContainText(/combinations? satisf/, { timeout: RESULT_TIMEOUT_MS });
    expect(outside).toEqual([]);
  });
});
