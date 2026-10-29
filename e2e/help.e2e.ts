import { expect, test } from '@playwright/test';

import { keysOf } from '../site/src/exhaustive';
import { HELP } from '../site/src/help';
import { Explorer, RESULT_TIMEOUT_MS } from './explorer';

/** The description each control of an operation is wired to, by the control's id. */
const DESCRIBED_BY: Readonly<Record<string, string>> = {
  count: 'count-help',
  'list-limit': 'list-limit-help',
  list: 'list-help',
  diagnose: 'diagnose-help',
  strength: 'strength-help',
  covering: 'covering-help',
  index: 'one-help',
  at: 'one-help',
  pickers: 'explain-help',
  explain: 'explain-help',
};

/** The id of the paragraph that carries each description in `site/src/help.ts`. */
const PARAGRAPH_OF: Readonly<Record<keyof typeof HELP, string>> = {
  count: 'count-help',
  list: 'list-help',
  'list-limit': 'list-limit-help',
  diagnose: 'diagnose-help',
  covering: 'covering-help',
  strength: 'strength-help',
  one: 'one-help',
  explain: 'explain-help',
};

/** The least contrast ratio between text and the panel behind it that WCAG asks for ordinary text. */
const MINIMUM_CONTRAST = 4.5;

/** The constants of WCAG's relative luminance and contrast ratio: the channel weights, the sRGB transfer function's break and its parts, and the flare added to both luminances. */
const WCAG = { channels: 3, red: 0.2126, green: 0.7152, blue: 0.0722, byteMax: 255, linearBreak: 0.03928, linearScale: 12.92, offset: 0.055, divisor: 1.055, exponent: 2.4, flare: 0.05 } as const;

const PHONE_WIDTH = 375;
const PHONE_HEIGHT = 800;

test.describe('operation descriptions', () => {
  test('shows each description as visible text, word for word what help.ts says', async ({ page }) => {
    const explorer = await Explorer.open(page);

    await Promise.all(keysOf(PARAGRAPH_OF).map(async (key) => expect(explorer.id(PARAGRAPH_OF[key])).toHaveText(HELP[key])));
  });

  test('explains the covering array and its strength in the words asked for', async ({ page }) => {
    const explorer = await Explorer.open(page);

    await expect(explorer.id('covering-help')).toContainText('short list of valid combinations that tests every interaction you care about without listing them all');
    await expect(explorer.id('strength-help')).toContainText('How many options at a time must be covered together');
    await expect(explorer.id('strength-help')).toContainText('2, pairwise and the default, means every pair of values from any two dimensions');
    await expect(explorer.id('strength-help')).toContainText('3 means every triple');
    await expect(explorer.id('strength-help')).toContainText('rules make impossible are not required');
  });

  test('names each control\'s description, and the browser reports it as the control\'s accessible description', async ({ page }) => {
    const explorer = await Explorer.open(page);

    await Promise.all(
      Object.entries(DESCRIBED_BY).map(async ([control, paragraph]) => {
        await expect(explorer.id(control)).toHaveAttribute('aria-describedby', paragraph);
        await expect(explorer.id(control)).toHaveAccessibleDescription((await explorer.id(paragraph).innerText()).trim());
      }),
    );
  });

  test('shows the description of the Strength field when it has keyboard focus', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await explorer.id('strength').focus();

    await expect(explorer.id('strength')).toBeFocused();
    await expect(explorer.id('strength-help')).toBeVisible();
  });

  test('still builds a covering array', async ({ page }) => {
    const explorer = await Explorer.open(page);
    await explorer.run('covering');

    await expect(explorer.result('covering')).toContainText('it covers', { timeout: RESULT_TIMEOUT_MS });
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`keeps the description inside its panel at phone width, with enough contrast in the ${scheme} scheme`, async ({ page }) => {
      await page.setViewportSize({ width: PHONE_WIDTH, height: PHONE_HEIGHT });
      await page.emulateMedia({ colorScheme: scheme });
      await Explorer.open(page);

      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      const inside = await page.evaluate(() =>
        [...document.querySelectorAll('.operation .hint')].every((hint) => {
          const panel = hint.closest('.operation')?.getBoundingClientRect();
          const box = hint.getBoundingClientRect();

          return panel !== undefined && box.left >= panel.left - 1 && box.right <= panel.right + 1;
        }),
      );

      expect(inside).toBe(true);
      const contrast = await page.evaluate((wcag) => {
        const channels = (colour: string): number[] => (colour.match(/[\d.]+/g) ?? []).slice(0, wcag.channels).map(Number);
        const luminance = ([red = 0, green = 0, blue = 0]: number[]): number => {
          const linear = (value: number): number => {
            const unit = value / wcag.byteMax;

            return unit <= wcag.linearBreak ? unit / wcag.linearScale : ((unit + wcag.offset) / wcag.divisor) ** wcag.exponent;
          };

          return wcag.red * linear(red) + wcag.green * linear(green) + wcag.blue * linear(blue);
        };
        const hint = document.querySelector('#strength-help');
        const panel = hint?.closest('.operation');
        if (hint === null || panel === null || panel === undefined) throw new Error('the strength description is not in an operation');
        const text = luminance(channels(getComputedStyle(hint).color));
        const background = luminance(channels(getComputedStyle(panel).backgroundColor));

        return (Math.max(text, background) + wcag.flare) / (Math.min(text, background) + wcag.flare);
      }, WCAG);

      expect(contrast).toBeGreaterThanOrEqual(MINIMUM_CONTRAST);
    });
  }
});
