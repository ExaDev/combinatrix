import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import type axeCore from 'axe-core';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { Explorer } from './explorer';

/** The windows and colour schemes the page is scanned in: a desktop and a phone, light and dark. */
const WINDOWS = [
  { name: 'desktop', size: { width: 1440, height: 900 } },
  { name: 'phone', size: { width: 390, height: 844 } },
] as const;
const SCHEMES = ['light', 'dark'] as const;

/** The least height of a control on a touch screen, in CSS pixels: what the stylesheet's `--touch-target` states. */
const TOUCH_TARGET = 44;

/** axe-core's global, which `violationsOn` loads into the page. */
declare const axe: typeof axeCore;

/** How many characters of an element's markup, and of a control's text, are put in a failure so that the element can be found. */
const MARKUP_LENGTH = 120;
const TEXT_LENGTH = 20;

/** The violations axe-core finds on the page as it is now, each as its rule, the number of elements and the first of them. */
async function violationsOn(page: Page): Promise<string[]> {
  const source = await readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
  await page.addScriptTag({ content: source });

  return page.evaluate(async (length) => {
    const { violations } = await axe.run(document);

    return violations.map((violation) => `${violation.id} x${String(violation.nodes.length)}: ${violation.nodes[0]?.html.slice(0, length) ?? ''}`);
  }, MARKUP_LENGTH);
}

test.describe('accessibility', () => {
  for (const { name, size } of WINDOWS) {
    for (const scheme of SCHEMES) {
      test(`has no violations axe-core finds, in a ${scheme} ${name} window with a result shown`, async ({ browser }) => {
        const context = await browser.newContext({ viewport: size, colorScheme: scheme });
        const page = await context.newPage();
        const explorer = await Explorer.open(page);
        await explorer.run('covering');
        await expect(explorer.result('covering')).toContainText('rows cover every combination');

        expect(await violationsOn(page)).toEqual([]);
        await context.close();
      });
    }
  }

  test(`makes every control at least ${String(TOUCH_TARGET)} pixels high on a touch screen`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: WINDOWS[1].size, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await Explorer.open(page);

    const small = await page.evaluate(({ least, length }) => {
      const controls = [...document.querySelectorAll('button, select, summary, input[type="text"], input[type="number"], .file-button')];

      return controls.flatMap((element) => {
        const box = element.getBoundingClientRect();

        return box.width > 0 && box.height > 0 && box.height < least ? [`${element.tagName.toLowerCase()} ${element.textContent.trim().slice(0, length)} ${String(Math.round(box.height))}px`] : [];
      });
    }, { least: TOUCH_TARGET, length: TEXT_LENGTH });

    expect(small).toEqual([]);
    await context.close();
  });
});
